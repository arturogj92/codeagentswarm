// Standalone version of database-mcp.js that uses sqlite3 CLI
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

class DatabaseManagerMCP {
  constructor() {
    // Check for environment override (for testing)
    if (process.env.CODEAGENTSWARM_DB_PATH) {
      this.dbPath = process.env.CODEAGENTSWARM_DB_PATH;
      // Ensure parent directory exists
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } else {
      // Use the system path for MCP
      const homeDir = os.homedir();
      const appDataDir = path.join(homeDir, 'Library', 'Application Support', 'codeagentswarm');
      
      if (!fs.existsSync(appDataDir)) {
        fs.mkdirSync(appDataDir, { recursive: true });
      }
      
      this.dbPath = path.join(appDataDir, 'codeagentswarm.db');
    }
    console.log('[MCP Database] Using database at:', this.dbPath);
    
    // Initialize database if needed
    this.initialize();
  }

  // Execute SQL using sqlite3 command line
  execSQL(sql, params = []) {
    try {
      let finalSQL = sql;
      
      if (params.length > 0) {
        // Replace ? placeholders with properly escaped values
        let paramIndex = 0;
        finalSQL = sql.replace(/\?/g, () => {
          if (paramIndex < params.length) {
            const param = params[paramIndex++];
            if (param === null || param === undefined) {
              return 'NULL';
            } else if (typeof param === 'number') {
              return param;
            } else {
              // Escape single quotes by doubling them
              const escaped = String(param).replace(/'/g, "''");
              return `'${escaped}'`;
            }
          }
          return '?';
        });
      }
      
      // Use echo and pipe to avoid shell interpretation issues
      // Create a temporary file to avoid command line length limits and escaping issues
      const tempFile = path.join(os.tmpdir(), `mcp-sql-${Date.now()}.sql`);
      fs.writeFileSync(tempFile, finalSQL);
      
      const result = execSync(`sqlite3 "${this.dbPath}" < "${tempFile}"`, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });
      
      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      return result.trim();
    } catch (error) {
      console.error('[MCP Database] SQL Error:', error.message);
      console.error('[MCP Database] SQL Query:', sql);
      console.error('[MCP Database] SQL Params:', params);
      throw error;
    }
  }

  // Parse SQLite output into objects
  parseRows(output, columns) {
    if (!output) return [];
    
    const lines = output.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const values = line.split('|');
      const obj = {};
      columns.forEach((col, i) => {
        obj[col] = values[i] || null;
      });
      return obj;
    });
  }

  initialize() {
    try {
      // Create tables if they don't exist
      const createTables = `
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT,
          plan TEXT,
          implementation TEXT,
          status TEXT DEFAULT 'pending',
          terminal_id INTEGER,
          project TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          parent_task_id INTEGER,
          FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL
        );
        
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          path TEXT UNIQUE,
          display_name TEXT,
          color TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS terminal_directories (
          terminal_id INTEGER PRIMARY KEY,
          directory TEXT,
          last_used DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `;
      
      // Execute each statement separately
      const statements = createTables.split(';').filter(s => s.trim());
      statements.forEach(stmt => {
        if (stmt.trim()) {
          this.execSQL(stmt);
        }
      });
      
      console.log('[MCP Database] Database initialized successfully');
    } catch (error) {
      console.error('[MCP Database] Failed to initialize:', error.message);
    }
  }

  // Task management methods
  async createTask(title, description, terminalId, project = null, parentTaskId = null) {
    try {
      // Combine INSERT and SELECT in a single SQLite session to get the correct ID
      // Using a temporary file to avoid command line escaping issues
      const tempFile = path.join(os.tmpdir(), `mcp_task_${Date.now()}.sql`);
      const sqlCommands = `
        INSERT INTO tasks (title, description, terminal_id, project, parent_task_id) 
        VALUES ('${(title || '').replace(/'/g, "''")}', 
                '${(description || '').replace(/'/g, "''")}', 
                ${terminalId || 0}, 
                ${project ? `'${project.replace(/'/g, "''")}'` : 'NULL'},
                ${parentTaskId || 'NULL'});
        SELECT last_insert_rowid();
      `;
      
      fs.writeFileSync(tempFile, sqlCommands);
      const result = execSync(`sqlite3 "${this.dbPath}" < "${tempFile}"`, {
        encoding: 'utf8'
      }).trim();
      
      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      const lastId = result.split('\n').pop(); // Get the last line which should be the ID
      const taskId = parseInt(lastId) || 0;
      
      // Return the created task
      if (taskId > 0) {
        const task = this.getTaskById(taskId);
        if (task) {
          return task;
        }
      }
      
      return {
        id: taskId,
        title,
        description,
        terminal_id: terminalId,
        project,
        parent_task_id: parentTaskId,
        status: 'pending'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  updateTaskStatus(taskId, status) {
    try {
      const sql = `UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      this.execSQL(sql, [status, taskId]);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  startTask(taskId, terminalId) {
    return this.updateTaskStatus(taskId, 'in_progress');
  }

  completeTask(taskId) {
    // First time moves to in_testing, second time to completed
    const currentTask = this.getTaskById(taskId);
    if (!currentTask) {
      return { success: false, error: 'Task not found' };
    }
    
    const newStatus = currentTask.status === 'in_testing' ? 'completed' : 'in_testing';
    return this.updateTaskStatus(taskId, newStatus);
  }

  async getAllTasks() {
    try {
      // Use JSON mode for better handling of multiline fields
      const query = 'SELECT id, title, description, plan, implementation, status, terminal_id, project, sort_order, created_at, updated_at FROM tasks ORDER BY sort_order ASC, created_at DESC';
      const result = execSync(`sqlite3 "${this.dbPath}" ".mode json" "${query}"`, { encoding: 'utf8' });
      
      if (!result || result.trim() === '') {
        return [];
      }
      
      const tasks = JSON.parse(result);
      
      // Convert numeric fields and handle nulls
      return tasks.map(task => ({
        ...task,
        id: parseInt(task.id),
        terminal_id: task.terminal_id ? parseInt(task.terminal_id) : null,
        sort_order: parseInt(task.sort_order) || 0
      }));
    } catch (error) {
      console.error('[MCP Database] Error getting all tasks:', error.message);
      return [];
    }
  }

  async getTasksByStatus(status) {
    try {
      // Use JSON mode for better handling of multiline fields
      // SQLite doesn't support parameterized queries with .mode json directly, so we need to escape the status
      const escapedStatus = status.replace(/'/g, "''");
      const query = `SELECT id, title, description, plan, implementation, status, terminal_id, project, sort_order, created_at, updated_at FROM tasks WHERE status = '${escapedStatus}' ORDER BY sort_order ASC, created_at DESC`;
      const result = execSync(`sqlite3 "${this.dbPath}" ".mode json" "${query}"`, { encoding: 'utf8' });
      
      if (!result || result.trim() === '') {
        return [];
      }
      
      const tasks = JSON.parse(result);
      
      return tasks.map(task => ({
        ...task,
        id: parseInt(task.id),
        terminal_id: task.terminal_id ? parseInt(task.terminal_id) : null,
        sort_order: parseInt(task.sort_order) || 0
      }));
    } catch (error) {
      console.error('[MCP Database] Error getting tasks by status:', error.message);
      return [];
    }
  }

  async getRecentTasks(days = 30) {
    try {
      // First set the output mode to list with pipe separator
      this.execSQL('.mode list');
      this.execSQL('.separator "|"');
      
      // Only get root tasks (not subtasks) from recent days, limit to 15
      const query = `
        SELECT id, title, description, plan, implementation, status, terminal_id, project, parent_task_id, sort_order, created_at, updated_at
        FROM tasks
        WHERE datetime(updated_at) > datetime('now', '-${days} days')
          AND parent_task_id IS NULL
        ORDER BY updated_at DESC
        LIMIT 15
      `;
      
      const output = this.execSQL(query);
      
      if (!output) return [];
      
      const lines = output.split('\n').filter(line => line.trim());
      
      return lines.map(line => {
        const values = line.split('|');
        return {
          id: parseInt(values[0]) || 0,
          title: values[1] || '',
          description: values[2] || '',
          plan: values[3] || '',
          implementation: values[4] || '',
          status: values[5] || 'pending',
          terminal_id: values[6] ? parseInt(values[6]) : null,
          project: values[7] || null,
          parent_task_id: values[8] ? parseInt(values[8]) : null,
          sort_order: parseInt(values[9] || 0),
          created_at: values[10] || '',
          updated_at: values[11] || ''
        };
      });
    } catch (error) {
      console.error('[MCP Database] Error getting recent tasks:', error.message);
      return [];
    }
  }

  async searchTasks(searchQuery, options = {}) {
    try {
      // Sanitize search query for SQL LIKE
      const sanitizedQuery = searchQuery.replace(/'/g, "''").toLowerCase();
      
      // Build WHERE clause for searching in multiple fields
      const searchConditions = [
        `LOWER(title) LIKE '%${sanitizedQuery}%'`,
        `LOWER(description) LIKE '%${sanitizedQuery}%'`,
        `LOWER(plan) LIKE '%${sanitizedQuery}%'`,
        `LOWER(implementation) LIKE '%${sanitizedQuery}%'`
      ];
      
      let whereClause = `(${searchConditions.join(' OR ')})`;
      
      // Add status filter if provided
      if (options.status) {
        const escapedStatus = options.status.replace(/'/g, "''");
        whereClause += ` AND status = '${escapedStatus}'`;
      }
      
      // Add time filter for recent tasks (last 48 hours by default)
      if (options.recentOnly !== false) {
        whereClause += ` AND datetime(updated_at) > datetime('now', '-2 days')`;
      }
      
      // Limit results to prevent token overflow
      const limit = options.limit || 20;
      
      const query = `
        SELECT id, title, description, plan, implementation, status, terminal_id, project, sort_order, created_at, updated_at 
        FROM tasks 
        WHERE ${whereClause}
        ORDER BY 
          CASE 
            WHEN status = 'in_testing' THEN 1
            WHEN status = 'in_progress' THEN 2
            WHEN status = 'pending' THEN 3
            WHEN status = 'completed' THEN 4
          END,
          updated_at DESC
        LIMIT ${limit}
      `;
      
      const result = execSync(`sqlite3 "${this.dbPath}" ".mode json" "${query}"`, { encoding: 'utf8' });
      
      if (!result || result.trim() === '') {
        return [];
      }
      
      const tasks = JSON.parse(result);
      
      return tasks.map(task => ({
        ...task,
        id: parseInt(task.id),
        terminal_id: task.terminal_id ? parseInt(task.terminal_id) : null,
        sort_order: parseInt(task.sort_order) || 0
      }));
    } catch (error) {
      console.error('[MCP Database] Error searching tasks:', error.message);
      return [];
    }
  }

  async getTaskById(taskId) {
    try {
      // Use JSON mode for better handling of multiline fields
      console.error(`[MCP Database] getTaskById called with ID: ${taskId}`);
      console.error(`[MCP Database] Using database path: ${this.dbPath}`);
      const query = `SELECT id, title, description, plan, implementation, status, terminal_id, project, sort_order, created_at, updated_at, parent_task_id FROM tasks WHERE id = ${parseInt(taskId)}`;
      const result = execSync(`sqlite3 "${this.dbPath}" ".mode json" "${query}"`, { encoding: 'utf8' });
      
      if (!result || result.trim() === '') {
        console.error(`[MCP Database] No task found with ID ${taskId}`);
        return null;
      }
      
      const tasks = JSON.parse(result);
      
      if (tasks.length === 0) {
        console.error(`[MCP Database] Empty result for task ID ${taskId}`);
        return null;
      }
      
      const task = tasks[0];
      console.error(`[MCP Database] Found task ${taskId} with status: ${task.status}`);
      console.error(`[MCP Database] Raw task object:`, JSON.stringify(task));
      
      // Ensure all fields are present
      const formattedTask = {
        id: parseInt(task.id),
        title: task.title || '',
        description: task.description || '',
        plan: task.plan || null,
        implementation: task.implementation || null,
        status: task.status || 'pending',
        terminal_id: task.terminal_id ? parseInt(task.terminal_id) : null,
        project: task.project || null,
        sort_order: parseInt(task.sort_order) || 0,
        created_at: task.created_at || null,
        updated_at: task.updated_at || null,
        parent_task_id: task.parent_task_id ? parseInt(task.parent_task_id) : null
      };
      
      console.error(`[MCP Database] Formatted task:`, JSON.stringify(formattedTask));
      return formattedTask;
    } catch (error) {
      console.error('[MCP Database] Error getting task by ID:', error.message);
      console.error('[MCP Database] Query was:', `SELECT * FROM tasks WHERE id = ${parseInt(taskId)}`);
      return null;
    }
  }

  updateTaskPlan(taskId, plan) {
    try {
      const sql = `UPDATE tasks SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      this.execSQL(sql, [plan || '', taskId]);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  updateTaskImplementation(taskId, implementation) {
    try {
      const sql = `UPDATE tasks SET implementation = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      this.execSQL(sql, [implementation || '', taskId]);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  updateTaskTerminal(taskId, terminalId) {
    try {
      const sql = `UPDATE tasks SET terminal_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      this.execSQL(sql, [terminalId === '' ? null : terminalId, taskId]);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  updateTask(taskId, title, description) {
    try {
      const sql = `UPDATE tasks SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      this.execSQL(sql, [title, description || '', taskId]);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  deleteTask(taskId) {
    try {
      const sql = `DELETE FROM tasks WHERE id = ?`;
      this.execSQL(sql, [taskId]);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateTasksOrder(taskOrders) {
    try {
      // Update each task's sort order
      for (const order of taskOrders) {
        const sql = `UPDATE tasks SET sort_order = ? WHERE id = ?`;
        this.execSQL(sql, [order.sortOrder, order.taskId]);
      }
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Project management methods
  async createProject(name, color = null) {
    try {
      // If no color provided, pick from predefined palette
      if (!color) {
        const colors = [
          '#007ACC', '#00C853', '#FF6B6B', '#FFA726', '#AB47BC',
          '#26A69A', '#EC407A', '#7E57C2', '#29B6F6', '#66BB6A'
        ];
        
        // Get existing projects to avoid color duplication
        const existingProjects = await this.getProjects();
        const usedColors = existingProjects.map(p => p.color);
        color = colors.find(c => !usedColors.includes(c)) || colors[0];
      }
      
      // Combine INSERT and SELECT in a single SQLite session to get the correct ID
      const tempFile = path.join(os.tmpdir(), `mcp_project_${Date.now()}.sql`);
      const sqlCommands = `
        INSERT INTO projects (name, display_name, color) 
        VALUES ('${name.replace(/'/g, "''")}', 
                '${name.replace(/'/g, "''")}', 
                '${color.replace(/'/g, "''")}');
        SELECT last_insert_rowid();
      `;
      
      fs.writeFileSync(tempFile, sqlCommands);
      const result = execSync(`sqlite3 "${this.dbPath}" < "${tempFile}"`, {
        encoding: 'utf8'
      }).trim();
      
      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      const lastId = result.split('\n').pop(); // Get the last line which should be the ID
      
      return {
        success: true,
        projectId: parseInt(lastId) || 0,
        name,
        color
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getProjects() {
    try {
      // Use JSON mode for better handling
      const query = 'SELECT id, name, display_name, color, created_at FROM projects ORDER BY name ASC';
      const result = execSync(`sqlite3 "${this.dbPath}" ".mode json" "${query}"`, { encoding: 'utf8' });
      
      if (!result || result.trim() === '') {
        return [];
      }
      
      const projects = JSON.parse(result);
      
      return projects.map(project => ({
        ...project,
        id: parseInt(project.id)
      }));
    } catch (error) {
      console.error('[MCP Database] Error getting projects:', error.message);
      return [];
    }
  }

  async getProjectByName(name) {
    try {
      // Use JSON mode for better handling
      const escapedName = name.replace(/'/g, "''");
      const query = `SELECT id, name, display_name, color, created_at FROM projects WHERE name = '${escapedName}'`;
      const result = execSync(`sqlite3 "${this.dbPath}" ".mode json" "${query}"`, { encoding: 'utf8' });
      
      if (!result || result.trim() === '') {
        return null;
      }
      
      const projects = JSON.parse(result);
      
      if (projects.length === 0) return null;
      
      const project = projects[0];
      return {
        ...project,
        id: parseInt(project.id)
      };
    } catch (error) {
      console.error('[MCP Database] Error getting project by name:', error.message);
      return null;
    }
  }

  async getTasksByProject(projectName) {
    try {
      // Use JSON mode for better handling of multiline fields
      const escapedProjectName = projectName.replace(/'/g, "''");
      const query = `SELECT id, title, description, plan, implementation, status, terminal_id, project, sort_order, created_at, updated_at FROM tasks WHERE project = '${escapedProjectName}' ORDER BY sort_order ASC, created_at DESC`;
      const result = execSync(`sqlite3 "${this.dbPath}" ".mode json" "${query}"`, { encoding: 'utf8' });
      
      if (!result || result.trim() === '') {
        return [];
      }
      
      const tasks = JSON.parse(result);
      
      return tasks.map(task => ({
        ...task,
        id: parseInt(task.id),
        terminal_id: task.terminal_id ? parseInt(task.terminal_id) : null,
        sort_order: parseInt(task.sort_order) || 0
      }));
    } catch (error) {
      console.error('[MCP Database] Error getting tasks by project:', error.message);
      return [];
    }
  }

  // Get terminal working directory (for project detection)
  get(sql, params = []) {
    try {
      execSync(`sqlite3 "${this.dbPath}" ".mode list"`, { encoding: 'utf8' });
      execSync(`sqlite3 "${this.dbPath}" ".separator |"`, { encoding: 'utf8' });
      
      const result = this.execSQL(sql, params);
      
      if (!result) return null;
      
      // For simple queries like getting terminal directory
      if (sql.includes('terminal_directories')) {
        const values = result.split('|');
        return {
          terminal_id: parseInt(values[0]),
          directory: values[1],
          last_used: values[2]
        };
      }
      
      return result;
    } catch (error) {
      console.error('[MCP Database] Error in get():', error.message);
      return null;
    }
  }

  // Compatibility shim
  get db() {
    return {
      get: (sql, params, callback) => {
        try {
          const result = this.get(sql, params);
          callback(null, result);
        } catch (error) {
          callback(error);
        }
      }
    };
  }

  logTaskAction(taskId, action, details) {
    // Not implemented in standalone version
  }

  // Subtask management methods
  
  async createSubtask(title, description, parentTaskId, terminalId) {
    try {
      // Get parent task to inherit project
      const parentTask = this.getTaskById(parentTaskId);
      if (!parentTask) {
        throw new Error('Parent task not found');
      }
      
      const project = parentTask.project;
      
      // Create task with parent_task_id
      return await this.createTask(title, description, terminalId, project, parentTaskId);
    } catch (error) {
      console.error('[MCP Database] Error creating subtask:', error);
      throw error;
    }
  }
  
  getSubtasks(parentTaskId) {
    try {
      // Enable column mode for parsing
      const result = this.execSQL('.mode list\n.separator |\nSELECT * FROM tasks WHERE parent_task_id = ? ORDER BY sort_order ASC, created_at DESC;', [parentTaskId]);
      
      if (!result) return [];
      
      const columns = ['id', 'title', 'description', 'plan', 'implementation', 'status', 'terminal_id', 'project', 'sort_order', 'created_at', 'updated_at', 'parent_task_id'];
      return this.parseRows(result, columns);
    } catch (error) {
      console.error('[MCP Database] Error getting subtasks:', error);
      return [];
    }
  }

  linkTaskToParent(taskId, parentTaskId) {
    try {
      // Check if parent task exists
      const parentResult = this.execSQL('.mode list\nSELECT id FROM tasks WHERE id = ?;', [parentTaskId]);
      if (!parentResult) {
        return { success: false, error: 'Parent task not found' };
      }
      
      // Check for circular dependency
      if (this.wouldCreateCircularDependency(taskId, parentTaskId)) {
        return { success: false, error: 'Cannot create circular dependency' };
      }
      
      this.execSQL('UPDATE tasks SET parent_task_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;', [parentTaskId, taskId]);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  unlinkTaskFromParent(taskId) {
    try {
      this.execSQL('UPDATE tasks SET parent_task_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?;', [taskId]);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  wouldCreateCircularDependency(taskId, potentialParentId) {
    try {
      // If task and parent are the same, it's circular
      if (taskId === potentialParentId) {
        return true;
      }
      
      // Check if potentialParentId is already a descendant of taskId
      const checkDescendants = (currentId) => {
        const result = this.execSQL('.mode list\nSELECT id FROM tasks WHERE parent_task_id = ?;', [currentId]);
        if (!result) return false;
        
        const childIds = result.split('\n').filter(id => id).map(id => parseInt(id));
        
        for (const childId of childIds) {
          if (childId === potentialParentId) {
            return true;
          }
          if (checkDescendants(childId)) {
            return true;
          }
        }
        return false;
      };
      
      return checkDescendants(taskId);
    } catch (error) {
      // On error, play it safe and prevent the operation
      return true;
    }
  }

  getTaskWithParent(taskId) {
    try {
      const result = this.execSQL(`.mode list
.separator |
SELECT 
  t.*,
  p.id as parent_id,
  p.title as parent_title,
  p.status as parent_status
FROM tasks t
LEFT JOIN tasks p ON t.parent_task_id = p.id
WHERE t.id = ?;`, [taskId]);
      
      if (!result) return null;
      
      const columns = ['id', 'title', 'description', 'plan', 'implementation', 'status', 'terminal_id', 'project', 'sort_order', 'created_at', 'updated_at', 'parent_task_id', 'parent_id', 'parent_title', 'parent_status'];
      const rows = this.parseRows(result, columns);
      return rows[0] || null;
    } catch (error) {
      console.error('[MCP Database] Error getting task with parent:', error);
      return null;
    }
  }

  async getTaskHierarchy(taskId) {
    try {
      const task = await this.getTaskById(taskId);
      
      if (!task) {
        return null;
      }
      
      const getSubtasksRecursive = (parentId) => {
        const subtasks = this.getSubtasks(parentId);
        return subtasks.map(subtask => ({
          ...subtask,
          subtasks: getSubtasksRecursive(subtask.id)
        }));
      };
      
      return {
        ...task,
        subtasks: getSubtasksRecursive(taskId)
      };
    } catch (error) {
      console.error('[MCP Database] Error getting task hierarchy:', error);
      return null;
    }
  }

  // Synchronous version removed - use async getTaskById instead
  // This was causing conflicts with the async version

  close() {
    // Nothing to close when using CLI
  }
}

module.exports = DatabaseManagerMCP;
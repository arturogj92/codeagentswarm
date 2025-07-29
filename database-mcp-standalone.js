// Standalone version of database-mcp.js that uses sqlite3 CLI
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

class DatabaseManagerMCP {
  constructor() {
    // Always use the system path for MCP
    const homeDir = os.homedir();
    const appDataDir = path.join(homeDir, 'Library', 'Application Support', 'codeagentswarm');
    
    if (!fs.existsSync(appDataDir)) {
      fs.mkdirSync(appDataDir, { recursive: true });
    }
    
    this.dbPath = path.join(appDataDir, 'codeagentswarm.db');
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
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
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
  async createTask(title, description, terminalId, project = null) {
    try {
      const sql = `INSERT INTO tasks (title, description, terminal_id, project) VALUES (?, ?, ?, ?)`;
      this.execSQL(sql, [title, description || '', terminalId || 0, project || 'CodeAgentSwarm']);
      
      // Get the last inserted ID in a separate command
      const lastId = execSync(`sqlite3 "${this.dbPath}" "SELECT seq FROM sqlite_sequence WHERE name='tasks';"`, {
        encoding: 'utf8'
      }).trim();
      
      return {
        success: true,
        taskId: parseInt(lastId) || 0
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

  async getAllTasks() {
    try {
      // Set output mode to list with pipe separator
      execSync(`sqlite3 "${this.dbPath}" ".mode list"`, { encoding: 'utf8' });
      execSync(`sqlite3 "${this.dbPath}" ".separator |"`, { encoding: 'utf8' });
      
      const result = this.execSQL('SELECT id, title, description, plan, implementation, status, terminal_id, project, sort_order, created_at, updated_at FROM tasks ORDER BY sort_order ASC, created_at DESC');
      
      const columns = ['id', 'title', 'description', 'plan', 'implementation', 'status', 'terminal_id', 'project', 'sort_order', 'created_at', 'updated_at'];
      const tasks = this.parseRows(result, columns);
      
      // Convert numeric fields
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
      execSync(`sqlite3 "${this.dbPath}" ".mode list"`, { encoding: 'utf8' });
      execSync(`sqlite3 "${this.dbPath}" ".separator |"`, { encoding: 'utf8' });
      
      const sql = 'SELECT id, title, description, plan, implementation, status, terminal_id, project, sort_order, created_at, updated_at FROM tasks WHERE status = ? ORDER BY sort_order ASC, created_at DESC';
      const result = this.execSQL(sql, [status]);
      
      const columns = ['id', 'title', 'description', 'plan', 'implementation', 'status', 'terminal_id', 'project', 'sort_order', 'created_at', 'updated_at'];
      const tasks = this.parseRows(result, columns);
      
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

  async getTaskById(taskId) {
    try {
      execSync(`sqlite3 "${this.dbPath}" ".mode list"`, { encoding: 'utf8' });
      execSync(`sqlite3 "${this.dbPath}" ".separator |"`, { encoding: 'utf8' });
      
      const sql = 'SELECT id, title, description, plan, implementation, status, terminal_id, project, sort_order, created_at, updated_at FROM tasks WHERE id = ?';
      const result = this.execSQL(sql, [taskId]);
      
      if (!result) return null;
      
      const columns = ['id', 'title', 'description', 'plan', 'implementation', 'status', 'terminal_id', 'project', 'sort_order', 'created_at', 'updated_at'];
      const tasks = this.parseRows(result, columns);
      
      if (tasks.length === 0) return null;
      
      const task = tasks[0];
      return {
        ...task,
        id: parseInt(task.id),
        terminal_id: task.terminal_id ? parseInt(task.terminal_id) : null,
        sort_order: parseInt(task.sort_order) || 0
      };
    } catch (error) {
      console.error('[MCP Database] Error getting task by ID:', error.message);
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
      
      const sql = `INSERT INTO projects (name, display_name, color) VALUES (?, ?, ?)`;
      this.execSQL(sql, [name, name, color]);
      
      // Get the last inserted ID from sqlite_sequence
      const lastId = execSync(`sqlite3 "${this.dbPath}" "SELECT seq FROM sqlite_sequence WHERE name='projects';"`, {
        encoding: 'utf8'
      }).trim();
      
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
      execSync(`sqlite3 "${this.dbPath}" ".mode list"`, { encoding: 'utf8' });
      execSync(`sqlite3 "${this.dbPath}" ".separator |"`, { encoding: 'utf8' });
      
      const result = this.execSQL('SELECT id, name, display_name, color, created_at FROM projects ORDER BY name ASC');
      
      const columns = ['id', 'name', 'display_name', 'color', 'created_at'];
      const projects = this.parseRows(result, columns);
      
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
      execSync(`sqlite3 "${this.dbPath}" ".mode list"`, { encoding: 'utf8' });
      execSync(`sqlite3 "${this.dbPath}" ".separator |"`, { encoding: 'utf8' });
      
      const sql = 'SELECT id, name, display_name, color, created_at FROM projects WHERE name = ?';
      const result = this.execSQL(sql, [name]);
      
      if (!result) return null;
      
      const columns = ['id', 'name', 'display_name', 'color', 'created_at'];
      const projects = this.parseRows(result, columns);
      
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
      execSync(`sqlite3 "${this.dbPath}" ".mode list"`, { encoding: 'utf8' });
      execSync(`sqlite3 "${this.dbPath}" ".separator |"`, { encoding: 'utf8' });
      
      const sql = 'SELECT id, title, description, plan, implementation, status, terminal_id, project, sort_order, created_at, updated_at FROM tasks WHERE project = ? ORDER BY sort_order ASC, created_at DESC';
      const result = this.execSQL(sql, [projectName]);
      
      const columns = ['id', 'title', 'description', 'plan', 'implementation', 'status', 'terminal_id', 'project', 'sort_order', 'created_at', 'updated_at'];
      const tasks = this.parseRows(result, columns);
      
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

  close() {
    // Nothing to close when using CLI
  }
}

module.exports = DatabaseManagerMCP;
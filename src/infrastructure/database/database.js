const Database = require('better-sqlite3');
const path = require('path');

// Try to import electron app, but handle gracefully if not available
let app;
try {
    app = require('electron').app;
} catch (e) {
    // Running outside Electron (e.g., as MCP server))
    app = null;
}

class DatabaseManager {
    constructor() {
        // Store database in user data directory
        let dbPath;
        
        // Check if running as MCP server (outside Electron)
        if (process.env.CODEAGENTSWARM_DB_PATH) {
            dbPath = process.env.CODEAGENTSWARM_DB_PATH;
        } else if (app && app.getPath) {
            dbPath = path.join(app.getPath('userData'), 'codeagentswarm.db');
        } else {
            // Fallback for MCP server mode
            const os = require('os');
            const dataDir = path.join(os.homedir(), '.codeagentswarm');
            if (!require('fs').existsSync(dataDir)) {
                require('fs').mkdirSync(dataDir, { recursive: true });
            }
            dbPath = path.join(dataDir, 'codeagentswarm.db');
        }
        
        this.db = new Database(dbPath);
        
        // Enable foreign key constraints
        this.db.pragma('foreign_keys = ON');
        
        this.initialize();
    }

    initialize() {

        // Create tables if they don't exist
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS terminal_directories (
                terminal_id INTEGER PRIMARY KEY,
                directory TEXT,
                last_used DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create a table for app settings/preferences
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create tasks table for MCP task management
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                plan TEXT,
                status TEXT CHECK(status IN ('pending', 'in_progress', 'in_testing', 'completed')) DEFAULT 'pending',
                terminal_id INTEGER,
                sort_order INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                project TEXT,
                parent_task_id INTEGER,
                FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL
            )
        `);
        
        // Create projects table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                display_name TEXT,
                color TEXT NOT NULL,
                path TEXT UNIQUE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // project_folders table is deprecated - using projects.path instead
        // Drop the table if it exists
        this.dropProjectFoldersTable();
        
        // Add sort_order column if it doesn't exist (migration)
        this.addSortOrderColumnIfNeeded();
        
        // Add plan column if it doesn't exist (migration)
        this.addPlanColumnIfNeeded();
        
        // Add implementation column if it doesn't exist (migration)
        this.addImplementationColumnIfNeeded();
        
        // Update status constraint to include in_testing (migration)
        this.updateStatusConstraintIfNeeded();
        
        // Add project column if it doesn't exist (migration)
        this.addProjectColumnIfNeeded();
        
        // Initialize default project if needed
        // Default project initialization removed - projects are created on demand
        
        // Add display_name column if it doesn't exist (migration)
        this.addDisplayNameColumnIfNeeded();
        
        // Add path column if it doesn't exist (migration)
        this.addPathColumnIfNeeded();
        
        // Enforce path constraints (migration)
        this.enforcePathConstraints();
        
        // Add last_opened column if it doesn't exist (migration)
        this.addLastOpenedColumnIfNeeded();
        
        // Add parent_task_id column if it doesn't exist (migration)
        this.addParentTaskIdColumnIfNeeded();

    }

    addSortOrderColumnIfNeeded() {
        try {
            // Check if sort_order column exists
            const columns = this.db.prepare("PRAGMA table_info(tasks)").all();
            const hasSortOrder = columns.some(col => col.name === 'sort_order');
            
            if (!hasSortOrder) {
                this.db.exec("ALTER TABLE tasks ADD COLUMN sort_order INTEGER DEFAULT 0");

                // Initialize sort_order values for existing tasks
                this.initializeSortOrder();
            }
        } catch (error) {
            console.error('Error checking/adding sort_order column:', error);
        }
    }

    initializeSortOrder() {
        try {
            const tasks = this.db.prepare("SELECT id FROM tasks ORDER BY created_at ASC").all();
            tasks.forEach((task, index) => {
                this.db.prepare("UPDATE tasks SET sort_order = ? WHERE id = ?").run(index, task.id);
            });
        } catch (error) {
            console.error('Error initializing sort order:', error);
        }
    }

    addPlanColumnIfNeeded() {
        try {
            // Check if plan column exists
            const columns = this.db.prepare("PRAGMA table_info(tasks)").all();
            const hasPlan = columns.some(col => col.name === 'plan');
            
            if (!hasPlan) {
                this.db.exec("ALTER TABLE tasks ADD COLUMN plan TEXT");

            }
        } catch (error) {
            console.error('Error checking/adding plan column:', error);
        }
    }

    addImplementationColumnIfNeeded() {
        try {
            // Check if implementation column exists
            const columns = this.db.prepare("PRAGMA table_info(tasks)").all();
            const hasImplementation = columns.some(col => col.name === 'implementation');
            
            if (!hasImplementation) {
                this.db.exec("ALTER TABLE tasks ADD COLUMN implementation TEXT");

            }
        } catch (error) {
            console.error('Error checking/adding implementation column:', error);
        }
    }

    updateStatusConstraintIfNeeded() {

        try {
            // Always try to insert a test record to check if constraint allows in_testing
            try {
                // Test if we can insert in_testing status
                const testStmt = this.db.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)");
                const testResult = testStmt.run('__TEST_STATUS__', 'in_testing');
                
                // If successful, delete the test record and we're good
                this.db.prepare("DELETE FROM tasks WHERE id = ?").run(testResult.lastInsertRowid);

            } catch (constraintError) {
                // If it fails, we need to recreate the table using a simpler approach

                this.simpleTableRecreation();

            }
        } catch (error) {
            console.error('❌ Error checking/updating status constraint:', error);
        }
    }

    recreateTasksTableWithNewConstraint() {
        try {

            this.db.exec('BEGIN TRANSACTION');

            this.db.exec('PRAGMA foreign_keys = OFF');

            this.db.exec(`
                CREATE TABLE tasks_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT,
                    plan TEXT,
                    status TEXT CHECK(status IN ('pending', 'in_progress', 'in_testing', 'completed')) DEFAULT 'pending',
                    terminal_id INTEGER,
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    implementation TEXT
                )
            `);

            this.db.exec(`
                INSERT INTO tasks_new (id, title, description, plan, status, terminal_id, sort_order, created_at, updated_at, implementation)
                SELECT id, title, description, plan, status, terminal_id, sort_order, created_at, updated_at, implementation
                FROM tasks
            `);

            this.db.exec('DROP TABLE tasks');
            this.db.exec('ALTER TABLE tasks_new RENAME TO tasks');

            this.db.exec('PRAGMA foreign_keys = ON');

            this.db.exec('COMMIT');

        } catch (error) {

            this.db.exec('ROLLBACK');
            this.db.exec('PRAGMA foreign_keys = ON'); // Re-enable foreign keys even on error
            console.error('❌ Failed to update status constraint:', error);
            throw error;
        }
    }

    simpleTableRecreation() {
        try {
            // First, disable foreign keys
            this.db.exec('PRAGMA foreign_keys = OFF');

            // Get all existing data
            const existingTasks = this.db.prepare("SELECT * FROM tasks").all();

            // Drop the old table
            this.db.exec('DROP TABLE IF EXISTS tasks');

            // Create new table with correct constraint
            this.db.exec(`
                CREATE TABLE tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT,
                    plan TEXT,
                    status TEXT CHECK(status IN ('pending', 'in_progress', 'in_testing', 'completed')) DEFAULT 'pending',
                    terminal_id INTEGER,
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    implementation TEXT,
                    project TEXT,
                    parent_task_id INTEGER,
                    FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL
                )
            `);

            // Restore data
            if (existingTasks.length > 0) {
                const insertStmt = this.db.prepare(`
                    INSERT INTO tasks (id, title, description, plan, status, terminal_id, sort_order, created_at, updated_at, implementation, project, parent_task_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                
                for (const task of existingTasks) {
                    insertStmt.run(
                        task.id,
                        task.title,
                        task.description,
                        task.plan,
                        task.status,
                        task.terminal_id,
                        task.sort_order,
                        task.created_at,
                        task.updated_at,
                        task.implementation,
                        task.project || null,
                        task.parent_task_id || null
                    );
                }
            }

            // Re-enable foreign keys
            this.db.exec('PRAGMA foreign_keys = ON');

        } catch (error) {

            this.db.exec('PRAGMA foreign_keys = ON');
            console.error('❌ Simple table recreation failed:', error);
            throw error;
        }
    }

    addProjectColumnIfNeeded() {
        try {
            // Check if project column exists
            const columns = this.db.prepare("PRAGMA table_info(tasks)").all();
            const hasProject = columns.some(col => col.name === 'project');
            
            if (!hasProject) {
                this.db.exec("ALTER TABLE tasks ADD COLUMN project TEXT");

                // Update existing tasks with default project
                // Tasks without projects remain NULL - will be assigned based on directory

            }
        } catch (error) {
            console.error('Error checking/adding project column:', error);
        }
    }

    // Removed initializeDefaultProject - projects are created on demand based on directory
    
    addDisplayNameColumnIfNeeded() {
        try {
            // Check if display_name column exists
            const columns = this.db.prepare("PRAGMA table_info(projects)").all();
            const hasDisplayName = columns.some(col => col.name === 'display_name');
            
            if (!hasDisplayName) {
                this.db.exec("ALTER TABLE projects ADD COLUMN display_name TEXT");

                // Update existing projects with display_name = name
                this.db.prepare("UPDATE projects SET display_name = name WHERE display_name IS NULL").run();

            }
        } catch (error) {
            console.error('Error checking/adding display_name column:', error);
        }
    }
    
    addPathColumnIfNeeded() {
        try {
            // Check if path column exists
            const columns = this.db.prepare("PRAGMA table_info(projects)").all();
            const hasPath = columns.some(col => col.name === 'path');
            
            if (!hasPath) {
                // First, check if it's truly missing or if the table needs to be recreated
                // Since path is NOT NULL, we need to provide a default value
                this.db.exec("ALTER TABLE projects ADD COLUMN path TEXT");

                // Update existing projects with path = name converted to slug
                const projects = this.db.prepare("SELECT id, name FROM projects WHERE path IS NULL").all();
                const updateStmt = this.db.prepare("UPDATE projects SET path = ? WHERE id = ?");
                
                projects.forEach(project => {
                    const path = project.name.toLowerCase().replace(/\s+/g, '-');
                    updateStmt.run(path, project.id);
                });

            }
        } catch (error) {
            console.error('Error checking/adding path column:', error);
        }
    }
    
    enforcePathConstraints() {
        try {

            // Check current schema
            const columns = this.db.prepare("PRAGMA table_info(projects)").all();
            const pathColumn = columns.find(col => col.name === 'path');
            
            if (!pathColumn || pathColumn.notnull === 0) {

                // Need to recreate table to change NOT NULL constraint
                this.db.exec('BEGIN TRANSACTION');
                
                try {
                    // Create new table with path NOT NULL and UNIQUE
                    this.db.exec(`
                        CREATE TABLE projects_new (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            name TEXT UNIQUE NOT NULL,
                            path TEXT UNIQUE NOT NULL,
                            display_name TEXT,
                            color TEXT NOT NULL DEFAULT '#007ACC',
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    
                    // Copy data (only projects with path)
                    this.db.exec(`
                        INSERT INTO projects_new (id, name, path, display_name, color, created_at, updated_at)
                        SELECT id, name, path, display_name, color, created_at, updated_at
                        FROM projects
                        WHERE path IS NOT NULL
                    `);
                    
                    // Drop old table and rename new one
                    this.db.exec('DROP TABLE projects');
                    this.db.exec('ALTER TABLE projects_new RENAME TO projects');
                    
                    this.db.exec('COMMIT');

                } catch (error) {
                    this.db.exec('ROLLBACK');
                    throw error;
                }
            } else {

            }
        } catch (error) {
            console.error('Error updating path column constraint:', error);
        }
    }

    addLastOpenedColumnIfNeeded() {
        try {
            // Check if last_opened column exists
            const columns = this.db.prepare("PRAGMA table_info(projects)").all();
            const hasLastOpened = columns.some(col => col.name === 'last_opened');
            
            if (!hasLastOpened) {
                this.db.exec("ALTER TABLE projects ADD COLUMN last_opened DATETIME");

                // Initialize last_opened with created_at for existing projects
                this.db.prepare("UPDATE projects SET last_opened = created_at WHERE last_opened IS NULL").run();

            }
        } catch (error) {
            console.error('Error checking/adding last_opened column:', error);
        }
    }

    addParentTaskIdColumnIfNeeded() {
        try {
            // Check if parent_task_id column exists
            const columns = this.db.prepare("PRAGMA table_info(tasks)").all();
            const hasParentTaskId = columns.some(col => col.name === 'parent_task_id');
            
            if (!hasParentTaskId) {
                this.db.exec("ALTER TABLE tasks ADD COLUMN parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL");

            }
        } catch (error) {
            console.error('Error checking/adding parent_task_id column:', error);
        }
    }

    // Save or update directory for a terminal
    saveTerminalDirectory(terminalId, directory) {
        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO terminal_directories (terminal_id, directory, last_used)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            `);
            
            stmt.run(terminalId, directory);
            
            // Check if there's a CLAUDE.md with a project in this directory
            const fs = require('fs');
            const path = require('path');
            const claudeMdPath = path.join(directory, 'CLAUDE.md');
            
            if (fs.existsSync(claudeMdPath)) {
                try {
                    const content = fs.readFileSync(claudeMdPath, 'utf8');
                    const projectMatch = content.match(/\*\*Project Name\*\*:\s*([^\n]+)/);
                    
                    if (projectMatch && projectMatch[1]) {
                        const projectName = projectMatch[1].trim();
                        // Check if project exists with this path
                        const existingProject = this.getProjectByPath(directory);
                        if (!existingProject) {
                            // Check if a project with this name exists
                            const projectByName = this.getProjectByName(projectName);
                            if (!projectByName) {
                                // Create new project
                                this.createProject(projectName, directory);

                            }
                        }
                    } else {
                        // CLAUDE.md exists but no project name found
                        // Use directory name as project name
                        const projectName = path.basename(directory);

                        // Check if project exists at this path
                        const existingProject = this.getProjectByPath(directory);
                        if (!existingProject) {
                            const result = this.createProject(projectName, directory);
                            if (result.success) {

                            }
                        }
                        
                        // Update CLAUDE.md with project configuration section
                        const { getCodeAgentSwarmSection, SECTION_START, SECTION_END } = require('./claude-md-config');
                        
                        // Check if CodeAgentSwarm section exists
                        const startIndex = content.indexOf(SECTION_START);
                        const endIndex = content.indexOf(SECTION_END);
                        
                        if (startIndex !== -1 && endIndex !== -1) {
                            // Replace existing section with project info
                            const newContent = content.substring(0, startIndex) +
                                             getCodeAgentSwarmSection(projectName) +
                                             content.substring(endIndex + SECTION_END.length);
                            fs.writeFileSync(claudeMdPath, newContent, 'utf8');

                        }
                    }
                } catch (error) {
                    console.error('Error reading CLAUDE.md for project association:', error);
                }
            }
            
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Get directory for a terminal
    getTerminalDirectory(terminalId) {
        try {
            const stmt = this.db.prepare(`
                SELECT directory FROM terminal_directories
                WHERE terminal_id = ?
            `);
            
            const row = stmt.get(terminalId);
            return row ? row.directory : null;
        } catch (err) {
            return null;
        }
    }

    // Get all terminal directories
    getAllTerminalDirectories() {
        try {
            const stmt = this.db.prepare(`
                SELECT terminal_id, directory FROM terminal_directories
                ORDER BY terminal_id
            `);
            
            const rows = stmt.all();
            const directories = {};
            rows.forEach(row => {
                directories[row.terminal_id] = row.directory;
            });
            return directories;
        } catch (err) {
            return {};
        }
    }

    // Delete directory for a terminal
    deleteTerminalDirectory(terminalId) {
        try {
            const stmt = this.db.prepare(`DELETE FROM terminal_directories WHERE terminal_id = ?`);
            stmt.run(terminalId);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Save app setting
    saveSetting(key, value) {
        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO app_settings (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            `);
            
            stmt.run(key, JSON.stringify(value));
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Get app setting
    getSetting(key) {
        try {
            const stmt = this.db.prepare(`SELECT value FROM app_settings WHERE key = ?`);
            const row = stmt.get(key);
            return row ? JSON.parse(row.value) : null;
        } catch (err) {
            return null;
        }
    }
    
    // Set app setting
    setSetting(key, value) {
        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO app_settings (key, value, updated_at)
                VALUES (?, ?, datetime('now'))
            `);
            const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
            stmt.run(key, valueStr);
            return true;
        } catch (err) {
            console.error('Error setting preference:', err);
            return false;
        }
    }

    // Get user's preferred shell
    getUserShell() {
        const shellSetting = this.getSetting('preferred_shell');
        if (shellSetting && shellSetting.type) {
            if (shellSetting.type === 'system') {
                return process.env.SHELL || '/bin/zsh';
            } else if (shellSetting.type === 'custom') {
                return shellSetting.path || process.env.SHELL || '/bin/zsh';
            } else {
                // For specific shell names, try to find them in common locations
                const shellName = shellSetting.type;
                const commonPaths = [
                    `/bin/${shellName}`,
                    `/usr/bin/${shellName}`,
                    `/usr/local/bin/${shellName}`,
                    `/opt/homebrew/bin/${shellName}`
                ];
                
                const fs = require('fs');
                for (const path of commonPaths) {
                    if (fs.existsSync(path)) {
                        return path;
                    }
                }
                
                // If not found, default to system shell
                return process.env.SHELL || '/bin/zsh';
            }
        }
        // Default to system shell
        return process.env.SHELL || '/bin/zsh';
    }

    // Task management methods
    
    // Create a new task
    createTask(title, description, terminalId = null, project = null, parentTaskId = null) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO tasks (title, description, terminal_id, status, project, parent_task_id)
                VALUES (?, ?, ?, 'pending', ?, ?)
            `);
            
            // Allow null project for tasks without a project
            const result = stmt.run(title, description, terminalId, project || null, parentTaskId || null);
            return { success: true, taskId: result.lastInsertRowid };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Update task status
    updateTaskStatus(taskId, status) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            
            stmt.run(status, taskId);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Get all tasks
    getAllTasks() {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM tasks 
                ORDER BY sort_order ASC, created_at DESC
            `);
            
            return stmt.all();
        } catch (err) {
            return [];
        }
    }

    // Get tasks by status
    getTasksByStatus(status) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM tasks 
                WHERE status = ?
                ORDER BY sort_order ASC, created_at DESC
            `);
            
            return stmt.all(status);
        } catch (err) {
            return [];
        }
    }

    // Search tasks by title or ID
    searchTasks(query, limit = 10) {
        try {
            // If query is a number, search by ID as well
            const isNumeric = !isNaN(query);
            
            let stmt;
            if (isNumeric) {
                stmt = this.db.prepare(`
                    SELECT * FROM tasks 
                    WHERE title LIKE ? OR id = ?
                    ORDER BY 
                        CASE WHEN id = ? THEN 0 ELSE 1 END,
                        created_at DESC
                    LIMIT ?
                `);
                return stmt.all(`%${query}%`, parseInt(query), parseInt(query), limit);
            } else {
                stmt = this.db.prepare(`
                    SELECT * FROM tasks 
                    WHERE title LIKE ? OR description LIKE ?
                    ORDER BY created_at DESC
                    LIMIT ?
                `);
                return stmt.all(`%${query}%`, `%${query}%`, limit);
            }
        } catch (err) {
            console.error('Error searching tasks:', err);
            return [];
        }
    }

    // Get current task for a terminal (in_progress status)
    getCurrentTask(terminalId) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM tasks 
                WHERE terminal_id = ? AND status = 'in_progress'
                ORDER BY created_at ASC
                LIMIT 1
            `);
            
            return stmt.get(terminalId);
        } catch (err) {
            return null;
        }
    }

    // Delete a task
    deleteTask(taskId) {
        try {
            const stmt = this.db.prepare(`DELETE FROM tasks WHERE id = ?`);
            stmt.run(taskId);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Update task details
    updateTask(taskId, title, description) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            
            stmt.run(title, description, taskId);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Update task terminal_id
    updateTaskTerminal(taskId, terminalId) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET terminal_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            
            stmt.run(terminalId, taskId);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Update task plan
    updateTaskPlan(taskId, plan) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET plan = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            
            stmt.run(plan || '', taskId);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Update task implementation
    updateTaskImplementation(taskId, implementation) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET implementation = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            
            stmt.run(implementation || '', taskId);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Update task order
    updateTasksOrder(taskOrders) {
        try {
            const updateStmt = this.db.prepare("UPDATE tasks SET sort_order = ? WHERE id = ?");
            
            this.db.transaction(() => {
                for (const order of taskOrders) {
                    updateStmt.run(order.sortOrder, order.taskId);
                }
            })();
            
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Update task project
    updateTaskProject(taskId, project) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET project = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            
            // Allow null project for tasks without a project
            stmt.run(project || null, taskId);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Subtask management methods
    
    // Get subtasks of a parent task
    getSubtasks(parentTaskId) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM tasks 
                WHERE parent_task_id = ?
                ORDER BY sort_order ASC, created_at DESC
            `);
            
            return stmt.all(parentTaskId);
        } catch (err) {
            return [];
        }
    }

    // Link a task to a parent (make it a subtask)
    linkTaskToParent(taskId, parentTaskId) {
        try {
            // Check if parent task exists
            const parentStmt = this.db.prepare(`SELECT id FROM tasks WHERE id = ?`);
            const parent = parentStmt.get(parentTaskId);
            
            if (!parent) {
                return { success: false, error: 'Parent task not found' };
            }
            
            // Check for circular dependency
            if (this.wouldCreateCircularDependency(taskId, parentTaskId)) {
                return { success: false, error: 'Cannot create circular dependency' };
            }
            
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET parent_task_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            
            stmt.run(parentTaskId, taskId);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Unlink a task from its parent (make it a standalone task)
    unlinkTaskFromParent(taskId) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET parent_task_id = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            
            stmt.run(taskId);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Check if linking would create a circular dependency
    wouldCreateCircularDependency(taskId, potentialParentId) {
        try {
            // If task and parent are the same, it's circular
            if (taskId === potentialParentId) {
                return true;
            }
            
            // Check if potentialParentId is already a descendant of taskId
            const checkDescendants = (currentId) => {
                const stmt = this.db.prepare(`SELECT id FROM tasks WHERE parent_task_id = ?`);
                const children = stmt.all(currentId);
                
                for (const child of children) {
                    if (child.id === potentialParentId) {
                        return true;
                    }
                    if (checkDescendants(child.id)) {
                        return true;
                    }
                }
                return false;
            };
            
            return checkDescendants(taskId);
        } catch (err) {
            // On error, play it safe and prevent the operation
            return true;
        }
    }

    // Get task with its parent info
    getTaskWithParent(taskId) {
        try {
            const stmt = this.db.prepare(`
                SELECT 
                    t.*,
                    p.id as parent_id,
                    p.title as parent_title,
                    p.status as parent_status
                FROM tasks t
                LEFT JOIN tasks p ON t.parent_task_id = p.id
                WHERE t.id = ?
            `);
            
            return stmt.get(taskId);
        } catch (err) {
            return null;
        }
    }

    // Get task hierarchy (task with all its subtasks recursively)
    getTaskHierarchy(taskId) {
        try {
            const task = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
            
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
        } catch (err) {
            return null;
        }
    }

    // Project management methods
    
    // Create a new project
    createProject(name, path, color = null) {
        try {
            // First check if project already exists
            const existingProject = this.getProjectByName(name);
            if (existingProject) {

                // Path is already stored in projects table
                return { 
                    success: true, 
                    projectId: existingProject.id, 
                    name: existingProject.name, 
                    color: existingProject.color,
                    alreadyExists: true 
                };
            }
            
            // If no color provided, pick from predefined palette
            if (!color) {
                const colors = [
                    '#007ACC', // Blue
                    '#00C853', // Green
                    '#FF6B6B', // Red
                    '#FFA726', // Orange
                    '#AB47BC', // Purple
                    '#26A69A', // Teal
                    '#EC407A', // Pink
                    '#7E57C2', // Deep Purple
                    '#29B6F6', // Light Blue
                    '#66BB6A'  // Light Green
                ];
                
                // Get existing projects to avoid color duplication
                const existingProjects = this.getProjects();
                const usedColors = existingProjects.map(p => p.color);
                
                // Find first unused color
                color = colors.find(c => !usedColors.includes(c)) || colors[0];
            }
            
            // Path is now required
            if (!path) {
                return { success: false, error: 'Path is required for project creation' };
            }
            
            // Check if another project already uses this path
            const existingProjectWithPath = this.getProjectByPath(path);
            if (existingProjectWithPath) {
                return { 
                    success: false, 
                    error: `Path already used by project "${existingProjectWithPath.name}"` 
                };
            }

            const stmt = this.db.prepare(`
                INSERT INTO projects (name, display_name, color, path)
                VALUES (?, ?, ?, ?)
            `);
            
            const result = stmt.run(name, name, color, path); // display_name defaults to name
            
            return { success: true, projectId: result.lastInsertRowid, name, color };
        } catch (err) {
            console.error('Database error creating project:', err);
            return { success: false, error: err.message };
        }
    }
    
    // Get all projects
    getProjects() {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM projects
                ORDER BY 
                    CASE 
                        WHEN last_opened IS NOT NULL THEN last_opened 
                        ELSE created_at 
                    END DESC
            `);
            
            return stmt.all();
        } catch (err) {
            return [];
        }
    }
    
    // Update project last opened timestamp
    updateProjectLastOpened(projectPath) {
        try {
            const stmt = this.db.prepare(`
                UPDATE projects 
                SET last_opened = CURRENT_TIMESTAMP 
                WHERE path = ?
            `);
            
            const result = stmt.run(projectPath);
            
            if (result.changes > 0) {

                return { success: true };
            } else {

                return { success: false, error: 'Project not found' };
            }
        } catch (err) {
            console.error('Error updating project last_opened:', err);
            return { success: false, error: err.message };
        }
    }
    
    // Get project by name
    getProjectByName(name) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM projects
                WHERE name = ?
            `);
            
            return stmt.get(name);
        } catch (err) {
            return null;
        }
    }
    
    // Get project by path
    getProjectByPath(path) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM projects
                WHERE path = ?
            `);
            
            return stmt.get(path);
        } catch (err) {
            return null;
        }
    }
    
    // Update project path
    updateProjectPath(name, newPath) {
        try {
            // Check if another project already uses this path
            const existingProject = this.getProjectByPath(newPath);
            if (existingProject && existingProject.name !== name) {
                return { 
                    success: false, 
                    error: `Path already used by project "${existingProject.name}"` 
                };
            }
            
            const stmt = this.db.prepare(`
                UPDATE projects
                SET path = ?, updated_at = CURRENT_TIMESTAMP
                WHERE name = ?
            `);
            
            const result = stmt.run(newPath, name);
            if (result.changes > 0) {
                return { success: true };
            } else {
                return { success: false, error: 'Project not found' };
            }
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
    
    // Get tasks by project
    getTasksByProject(projectName) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM tasks
                WHERE project = ?
                ORDER BY sort_order ASC, created_at DESC
            `);
            
            return stmt.all(projectName);
        } catch (err) {
            return [];
        }
    }
    
    // Deprecated - project folders are now stored in projects.path
    // addProjectFolder and getProjectFolders removed
    
    // Drop project_folders table migration
    dropProjectFoldersTable() {
        try {
            // Check if table exists
            const tableExists = this.db.prepare(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='project_folders'
            `).get();
            
            if (tableExists) {

                this.db.exec('DROP TABLE project_folders');

            }
        } catch (err) {
            console.error('Error dropping project_folders table:', err);
        }
    }
    
    // Update project display name
    updateProjectDisplayName(name, displayName) {
        try {
            const stmt = this.db.prepare(`
                UPDATE projects 
                SET display_name = ?
                WHERE name = ?
            `);
            
            const result = stmt.run(displayName, name);
            if (result.changes > 0) {
                return { success: true };
            } else {
                return { success: false, error: 'Project not found' };
            }
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
    
    // Update project color
    updateProjectColor(name, color) {
        try {
            const stmt = this.db.prepare(`
                UPDATE projects 
                SET color = ?
                WHERE name = ?
            `);
            
            const result = stmt.run(color, name);
            if (result.changes > 0) {
                return { success: true };
            } else {
                return { success: false, error: 'Project not found' };
            }
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
    
    // Delete project
    deleteProject(name) {
        try {
            // Don't allow deleting the default project
            // No default project protection needed anymore
            
            const deleteProject = this.db.prepare(`DELETE FROM projects WHERE name = ?`);
            const result = deleteProject.run(name);
            
            if (result.changes === 0) {
                return { success: false, error: 'Project not found' };
            }
            
            return { success: true };
        } catch (err) {
            console.error('Error in deleteProject:', err);
            return { success: false, error: err.message };
        }
    }

    // Close database connection
    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = DatabaseManager;
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class DatabaseManagerMCP {
    constructor() {
        // Use the same database path as the main app
        let dbPath;
        
        // Use the exact same logic as database.js to find Electron's database
        if (process.env.CODEAGENTSWARM_DB_PATH) {
            dbPath = process.env.CODEAGENTSWARM_DB_PATH;
        } else {
            // Try to get Electron app path first
            let app;
            try {
                app = require('electron').app;
            } catch (e) {
                app = null;
            }
            
            if (app && app.getPath) {
                // Same as Electron: app.getPath('userData')
                dbPath = path.join(app.getPath('userData'), 'codeagentswarm.db');
            } else {
                // Fallback: use the typical Electron userData directory structure
                const os = require('os');
                const dataDir = path.join(os.homedir(), 'Library', 'Application Support', 'codeagentswarm');
                if (!fs.existsSync(dataDir)) {
                    fs.mkdirSync(dataDir, { recursive: true });
                }
                dbPath = path.join(dataDir, 'codeagentswarm.db');
            }
        }
        
        this.db = new sqlite3.Database(dbPath);
        this.initialize();
    }

    initialize() {
        // Create tables if they don't exist - same structure as main app
        const createTables = `
            CREATE TABLE IF NOT EXISTS terminal_directories (
                terminal_id INTEGER PRIMARY KEY,
                directory TEXT,
                last_used DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                path TEXT UNIQUE,
                display_name TEXT,
                color TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                plan TEXT,
                status TEXT DEFAULT 'pending',
                terminal_id INTEGER,
                project TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                implementation TEXT
            );

            CREATE TABLE IF NOT EXISTS task_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER,
                action TEXT,
                details TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks (id)
            );

            -- Create indexes for better performance
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_terminal_id ON tasks(terminal_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
            CREATE INDEX IF NOT EXISTS idx_tasks_sort_order ON tasks(sort_order, created_at DESC);
        `;

        this.db.exec(createTables, (err) => {
            if (err) {
                console.error('Failed to initialize database:', err);
            } else {
                // Check if sort_order column exists and add it if not
                this.addSortOrderColumnIfNeeded();
                // Check if plan column exists and add it if not
                this.addPlanColumnIfNeeded();
                // Check if implementation column exists and add it if not
                this.addImplementationColumnIfNeeded();
                // Update status constraint to include in_testing
                this.updateStatusConstraintIfNeeded();
                // Add project column if it doesn't exist
                this.addProjectColumnIfNeeded();
                // Default project initialization removed - projects are created on demand
                // Add display_name column if it doesn't exist
                this.addDisplayNameColumnIfNeeded();
                // Add path column if it doesn't exist
                this.addPathColumnIfNeeded();
            }
        });
    }

    addSortOrderColumnIfNeeded() {
        // Check if sort_order column exists
        this.db.all("PRAGMA table_info(tasks)", (err, columns) => {
            if (err) {
                console.error('Failed to check table info:', err);
                return;
            }
            
            const hasSortOrder = columns.some(col => col.name === 'sort_order');
            if (!hasSortOrder) {
                this.db.run("ALTER TABLE tasks ADD COLUMN sort_order INTEGER DEFAULT 0", (err) => {
                    if (err) {
                        console.error('Failed to add sort_order column:', err);
                    } else {
                        console.log('Added sort_order column to tasks table');
                        // Initialize sort_order values for existing tasks
                        this.initializeSortOrder();
                    }
                });
            }
        });
    }

    initializeSortOrder() {
        // Set sort_order based on existing order (by creation date)
        this.db.all("SELECT id FROM tasks ORDER BY created_at ASC", (err, rows) => {
            if (err) {
                console.error('Failed to get tasks for sort order initialization:', err);
                return;
            }
            
            rows.forEach((row, index) => {
                this.db.run("UPDATE tasks SET sort_order = ? WHERE id = ?", [index, row.id], (err) => {
                    if (err) {
                        console.error('Failed to set sort_order for task:', row.id, err);
                    }
                });
            });
        });
    }

    addPlanColumnIfNeeded() {
        // Check if plan column exists
        this.db.all("PRAGMA table_info(tasks)", (err, columns) => {
            if (err) {
                console.error('Failed to check table info:', err);
                return;
            }
            
            const hasPlan = columns.some(col => col.name === 'plan');
            if (!hasPlan) {
                this.db.run("ALTER TABLE tasks ADD COLUMN plan TEXT", (err) => {
                    if (err) {
                        console.error('Failed to add plan column:', err);
                    } else {
                        console.log('Added plan column to tasks table');
                    }
                });
            }
        });
    }

    addImplementationColumnIfNeeded() {
        // Check if implementation column exists
        this.db.all("PRAGMA table_info(tasks)", (err, columns) => {
            if (err) {
                console.error('Failed to check table info:', err);
                return;
            }
            
            const hasImplementation = columns.some(col => col.name === 'implementation');
            if (!hasImplementation) {
                this.db.run("ALTER TABLE tasks ADD COLUMN implementation TEXT", (err) => {
                    if (err) {
                        console.error('Failed to add implementation column:', err);
                    } else {
                        console.log('Added implementation column to tasks table');
                    }
                });
            }
        });
    }

    updateStatusConstraintIfNeeded() {
        // SQLite doesn't allow modifying CHECK constraints directly
        // But since database-mcp.js doesn't have CHECK constraints, this is mainly informational
        // The main database.js already has the constraint updated
        console.log('Status constraint includes in_testing support');
    }
    
    addProjectColumnIfNeeded() {
        // Check if project column exists
        this.db.all("PRAGMA table_info(tasks)", (err, columns) => {
            if (err) {
                console.error('Error checking for project column:', err);
                return;
            }
            
            const hasProject = columns.some(col => col.name === 'project');
            if (!hasProject) {
                this.db.run("ALTER TABLE tasks ADD COLUMN project TEXT", (err) => {
                    if (err) {
                        console.error('Error adding project column:', err);
                    } else {
                        console.log('Added project column to tasks table');
                        // Tasks without projects remain NULL - will be assigned based on directory
                    }
                });
            }
        });
    }
    
    // Removed initializeDefaultProject - projects are created on demand based on directory
    
    addDisplayNameColumnIfNeeded() {
        // Check if display_name column exists
        this.db.all("PRAGMA table_info(projects)", (err, columns) => {
            if (err) {
                console.error('Failed to check table info:', err);
                return;
            }
            
            const hasDisplayName = columns.some(col => col.name === 'display_name');
            if (!hasDisplayName) {
                this.db.run("ALTER TABLE projects ADD COLUMN display_name TEXT", (err) => {
                    if (err) {
                        console.error('Failed to add display_name column:', err);
                    } else {
                        console.log('Added display_name column to projects table');
                        // Update existing projects with display_name = name
                        this.db.run("UPDATE projects SET display_name = name WHERE display_name IS NULL", (err) => {
                            if (err) {
                                console.error('Failed to update display names:', err);
                            } else {
                                console.log('Updated existing projects with display_name');
                            }
                        });
                    }
                });
            }
        });
    }
    
    addPathColumnIfNeeded() {
        // Check if path column exists
        this.db.all("PRAGMA table_info(projects)", (err, columns) => {
            if (err) {
                console.error('Failed to check table info:', err);
                return;
            }
            
            const hasPath = columns.some(col => col.name === 'path');
            if (!hasPath) {
                this.db.run("ALTER TABLE projects ADD COLUMN path TEXT", (err) => {
                    if (err) {
                        console.error('Failed to add path column:', err);
                    } else {
                        console.log('Added path column to projects table');
                        // Update existing projects with a path based on their name
                        this.db.all("SELECT id, name FROM projects WHERE path IS NULL", (err, projects) => {
                            if (err) {
                                console.error('Failed to fetch projects for path update:', err);
                                return;
                            }
                            
                            projects.forEach(project => {
                                // Convert project name to slug for path
                                const path = project.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                                this.db.run("UPDATE projects SET path = ? WHERE id = ?", [path, project.id], (err) => {
                                    if (err) {
                                        console.error(`Failed to update path for project ${project.name}:`, err);
                                    }
                                });
                            });
                        });
                    }
                });
            }
        });
    }

    // Promisify database operations for async/await support
    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Task management methods - same interface as main DatabaseManager
    createTask(title, description, terminalId, project = null) {
        const db = this.db; // Capture db reference for use in callback
        return new Promise((resolve) => {
            db.run(
                `INSERT INTO tasks (title, description, terminal_id, project) VALUES (?, ?, ?, ?)`,
                [title, description || '', terminalId || 0, project || null],
                function(err) {
                    if (err) {
                        resolve({
                            success: false,
                            error: err.message
                        });
                    } else {
                        // In sqlite3, 'this' in the callback refers to the statement object
                        const taskId = this.lastID;
                        
                        // Log the action
                        db.run(
                            `INSERT INTO task_history (task_id, action, details) VALUES (?, ?, ?)`,
                            [taskId, 'created', `Task created: ${title}`],
                            () => {} // Ignore errors in logging
                        );
                        
                        resolve({
                            success: true,
                            taskId: taskId
                        });
                    }
                }
            );
        });
    }

    updateTaskStatus(taskId, status) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET status = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `);
            const result = stmt.run(status, taskId);
            stmt.finalize();
            
            if (result.changes === 0) {
                return {
                    success: false,
                    error: 'Task not found'
                };
            }
            
            // Log the action
            this.logTaskAction(taskId, 'status_updated', `Status changed to: ${status}`);
            
            return {
                success: true
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    getAllTasks() {
        // sqlite3 doesn't support synchronous operations like better-sqlite3
        // We need to use a different approach or make it async
        return new Promise((resolve, reject) => {
            this.db.all("SELECT * FROM tasks ORDER BY sort_order ASC, created_at DESC", (err, rows) => {
                if (err) {
                    console.error('Error getting all tasks:', err);
                    resolve([]);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    getTasksByStatus(status) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM tasks 
                WHERE status = ? 
                ORDER BY sort_order ASC, created_at DESC`,
                [status],
                (err, rows) => {
                    if (err) {
                        console.error('Error getting tasks by status:', err);
                        resolve([]);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });
    }

    getCurrentTask(terminalId) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM tasks 
                WHERE terminal_id = ? AND status = 'in_progress' 
                ORDER BY updated_at DESC 
                LIMIT 1
            `);
            const task = stmt.get(terminalId);
            stmt.finalize();
            return task || null;
        } catch (error) {
            console.error('Error getting current task:', error);
            return null;
        }
    }

    getTaskById(taskId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM tasks WHERE id = ?`,
                [taskId],
                (err, row) => {
                    if (err) {
                        console.error('Error getting task by ID:', err);
                        resolve(null);
                    } else {
                        resolve(row || null);
                    }
                }
            );
        });
    }

    deleteTask(taskId) {
        try {
            // Delete the task directly (no task_history table exists)
            const stmt = this.db.prepare(`
                DELETE FROM tasks WHERE id = ?
            `);
            const result = stmt.run(taskId);
            stmt.finalize();
            
            if (result.changes === 0) {
                return {
                    success: false,
                    error: 'Task not found'
                };
            }
            
            return {
                success: true
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    updateTask(taskId, title, description) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `);
            const result = stmt.run(title, description || '', taskId);
            stmt.finalize();
            
            if (result.changes === 0) {
                return {
                    success: false,
                    error: 'Task not found'
                };
            }
            
            // Log the action
            this.logTaskAction(taskId, 'updated', `Task updated: ${title}`);
            
            return {
                success: true
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    updateTaskPlan(taskId, plan) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET plan = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `);
            const result = stmt.run(plan || '', taskId);
            stmt.finalize();
            
            if (result.changes === 0) {
                return {
                    success: false,
                    error: 'Task not found'
                };
            }
            
            // Log the action
            this.logTaskAction(taskId, 'plan_updated', `Task plan updated`);
            
            return {
                success: true
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    updateTaskTerminal(taskId, terminalId) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET terminal_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            const result = stmt.run(terminalId === '' ? null : terminalId, taskId);
            stmt.finalize();
            
            if (result.changes === 0) {
                return {
                    success: false,
                    error: 'Task not found'
                };
            }
            
            // Log the action
            this.logTaskAction(taskId, 'terminal_updated', `Task terminal changed to ${terminalId || 'none'}`);
            
            return {
                success: true
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    updateTaskImplementation(taskId, implementation) {
        try {
            const stmt = this.db.prepare(`
                UPDATE tasks 
                SET implementation = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `);
            const result = stmt.run(implementation || '', taskId);
            stmt.finalize();
            
            if (result.changes === 0) {
                return {
                    success: false,
                    error: 'Task not found'
                };
            }
            
            // Log the action
            this.logTaskAction(taskId, 'implementation_updated', `Task implementation updated`);
            
            return {
                success: true
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    logTaskAction(taskId, action, details) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO task_history (task_id, action, details)
                VALUES (?, ?, ?)
            `);
            stmt.run(taskId, action, details);
            stmt.finalize();
        } catch (error) {
            console.error('Error logging task action:', error);
        }
    }

    updateTasksOrder(taskOrders) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run("BEGIN TRANSACTION");
                
                let hasError = false;
                let completed = 0;
                const total = taskOrders.length;
                
                if (total === 0) {
                    this.db.run("COMMIT");
                    resolve({ success: true });
                    return;
                }
                
                taskOrders.forEach((order, index) => {
                    this.db.run(
                        "UPDATE tasks SET sort_order = ? WHERE id = ?",
                        [order.sortOrder, order.taskId],
                        (err) => {
                            if (err && !hasError) {
                                hasError = true;
                                this.db.run("ROLLBACK");
                                resolve({ success: false, error: err.message });
                                return;
                            }
                            
                            completed++;
                            if (completed === total && !hasError) {
                                this.db.run("COMMIT");
                                resolve({ success: true });
                            }
                        }
                    );
                });
            });
        });
    }

    // ===== PROJECT METHODS =====

    // Project management methods
    
    async createProject(name, color = null) {
        return new Promise((resolve, reject) => {
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
                this.getProjects().then(existingProjects => {
                    const usedColors = existingProjects.map(p => p.color);
                    color = colors.find(c => !usedColors.includes(c)) || colors[0];
                    
                    // Projects created from UI don't have a path
                    const path = null;
                    this.db.run(
                        `INSERT INTO projects (name, display_name, color, path) VALUES (?, ?, ?, ?)`,
                        [name, name, color, path],
                        function(err) {
                            if (err) {
                                console.error('Error creating project:', err);
                                resolve({ success: false, error: err.message });
                            } else {
                                resolve({ success: true, projectId: this.lastID, name, color });
                            }
                        }
                    );
                });
            } else {
                // Projects created from UI don't have a path
                const path = null;
                this.db.run(
                    `INSERT INTO projects (name, display_name, color, path) VALUES (?, ?, ?, ?)`,
                    [name, name, color, path],
                    function(err) {
                        if (err) {
                            console.error('Error creating project:', err);
                            resolve({ success: false, error: err.message });
                        } else {
                            resolve({ success: true, projectId: this.lastID, name, color });
                        }
                    }
                );
            }
        });
    }
    
    async getProjects() {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM projects ORDER BY name ASC`,
                [],
                (err, rows) => {
                    if (err) {
                        console.error('Error getting all projects:', err);
                        resolve([]);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });
    }
    
    // Alias for consistency with getAllTasks
    async getAllProjects() {
        return this.getProjects();
    }
    
    async getProjectByName(name) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM projects WHERE name = ?`,
                [name],
                (err, row) => {
                    if (err) {
                        console.error('Error getting project by name:', err);
                        resolve(null);
                    } else {
                        resolve(row);
                    }
                }
            );
        });
    }
    
    async getProjectByPath(path) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM projects WHERE path = ?`,
                [path],
                (err, row) => {
                    if (err) {
                        console.error('Error getting project by path:', err);
                        resolve(null);
                    } else {
                        resolve(row);
                    }
                }
            );
        });
    }
    
    async updateProject(id, name, color) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE projects SET name = ?, color = ? WHERE id = ?`,
                [name, color, id],
                function(err) {
                    if (err) {
                        console.error('Error updating project:', err);
                        resolve({ success: false, error: err.message });
                    } else {
                        resolve({ success: true });
                    }
                }
            );
        });
    }
    
    async getTasksByProject(projectName) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM tasks WHERE project = ? ORDER BY sort_order ASC, created_at DESC`,
                [projectName],
                (err, rows) => {
                    if (err) {
                        console.error('Error getting project tasks:', err);
                        resolve([]);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });
    }
    
    async updateProjectDisplayName(name, displayName) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE projects SET display_name = ? WHERE name = ?`,
                [displayName, name],
                function(err) {
                    if (err) {
                        console.error('Error updating project display name:', err);
                        resolve({ success: false, error: err.message });
                    } else if (this.changes > 0) {
                        resolve({ success: true });
                    } else {
                        resolve({ success: false, error: 'Project not found' });
                    }
                }
            );
        });
    }
    
    async updateProjectColor(name, color) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE projects SET color = ? WHERE name = ?`,
                [color, name],
                function(err) {
                    if (err) {
                        console.error('Error updating project color:', err);
                        resolve({ success: false, error: err.message });
                    } else if (this.changes > 0) {
                        resolve({ success: true });
                    } else {
                        resolve({ success: false, error: 'Project not found' });
                    }
                }
            );
        });
    }
    
    async deleteProject(name) {
        return new Promise((resolve, reject) => {
            // No default project protection needed anymore
            
            this.db.run(
                `DELETE FROM projects WHERE name = ?`,
                [name],
                function(err) {
                    if (err) {
                        console.error('Error deleting project:', err);
                        resolve({ success: false, error: err.message });
                    } else if (this.changes > 0) {
                        resolve({ success: true });
                    } else {
                        resolve({ success: false, error: 'Project not found' });
                    }
                }
            );
        });
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = DatabaseManagerMCP;
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

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'pending',
                terminal_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS task_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER,
                action TEXT,
                details TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks (id)
            );
        `;

        this.db.exec(createTables, (err) => {
            if (err) {
                console.error('Failed to initialize database:', err);
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
    createTask(title, description, terminalId) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO tasks (title, description, terminal_id)
                VALUES (?, ?, ?)
            `);
            const result = stmt.run(title, description || '', terminalId || 0);
            stmt.finalize();
            
            // Log the action
            this.logTaskAction(result.lastID, 'created', `Task created: ${title}`);
            
            return {
                success: true,
                taskId: result.lastID
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
            this.db.all("SELECT * FROM tasks ORDER BY created_at DESC", (err, rows) => {
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
                ORDER BY created_at DESC`,
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

    deleteTask(taskId) {
        try {
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
            
            // Clean up task history
            const historyStmt = this.db.prepare(`
                DELETE FROM task_history WHERE task_id = ?
            `);
            historyStmt.run(taskId);
            historyStmt.finalize();
            
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

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = DatabaseManagerMCP;
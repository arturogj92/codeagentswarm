const Database = require('better-sqlite3');
const path = require('path');

// Try to import electron app, but handle gracefully if not available
let app;
try {
    app = require('electron').app;
} catch (e) {
    // Running outside Electron (e.g., as MCP server)
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
                status TEXT CHECK(status IN ('pending', 'in_progress', 'completed')) DEFAULT 'pending',
                terminal_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    // Save or update directory for a terminal
    saveTerminalDirectory(terminalId, directory) {
        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO terminal_directories (terminal_id, directory, last_used)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            `);
            
            stmt.run(terminalId, directory);
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

    // Task management methods
    
    // Create a new task
    createTask(title, description, terminalId = null) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO tasks (title, description, terminal_id, status)
                VALUES (?, ?, ?, 'pending')
            `);
            
            const result = stmt.run(title, description, terminalId);
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
                ORDER BY created_at DESC
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
                ORDER BY created_at DESC
            `);
            
            return stmt.all(status);
        } catch (err) {
            return [];
        }
    }

    // Get current task for a terminal (in_progress status)
    getCurrentTask(terminalId) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM tasks 
                WHERE terminal_id = ? AND status = 'in_progress'
                ORDER BY updated_at DESC
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

    // Close database connection
    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = DatabaseManager;
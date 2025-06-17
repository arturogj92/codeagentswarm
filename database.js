const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

class DatabaseManager {
    constructor() {
        // Store database in user data directory
        const dbPath = path.join(app.getPath('userData'), 'codeagentswarm.db');
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

    // Close database connection
    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = DatabaseManager;
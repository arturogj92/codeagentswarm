const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');

class Database {
    constructor() {
        // Store database in user data directory
        const dbPath = path.join(app.getPath('userData'), 'codeagentswarm.db');
        console.log('Database path:', dbPath);
        
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err);
            } else {
                console.log('Connected to SQLite database');
                this.initialize();
            }
        });
    }

    initialize() {
        // Create tables if they don't exist
        this.db.run(`
            CREATE TABLE IF NOT EXISTS terminal_directories (
                terminal_id INTEGER PRIMARY KEY,
                directory TEXT,
                last_used DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) {
                console.error('Error creating table:', err);
            } else {
                console.log('Terminal directories table ready');
            }
        });

        // Create a table for app settings/preferences
        this.db.run(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) {
                console.error('Error creating settings table:', err);
            }
        });
    }

    // Save or update directory for a terminal
    saveTerminalDirectory(terminalId, directory) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT OR REPLACE INTO terminal_directories (terminal_id, directory, last_used)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            `;
            
            this.db.run(query, [terminalId, directory], (err) => {
                if (err) {
                    console.error('Error saving directory:', err);
                    reject(err);
                } else {
                    console.log(`Saved directory for terminal ${terminalId}: ${directory}`);
                    resolve();
                }
            });
        });
    }

    // Get directory for a terminal
    getTerminalDirectory(terminalId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT directory FROM terminal_directories
                WHERE terminal_id = ?
            `;
            
            this.db.get(query, [terminalId], (err, row) => {
                if (err) {
                    console.error('Error getting directory:', err);
                    reject(err);
                } else {
                    resolve(row ? row.directory : null);
                }
            });
        });
    }

    // Get all terminal directories
    getAllTerminalDirectories() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT terminal_id, directory FROM terminal_directories
                ORDER BY terminal_id
            `;
            
            this.db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error getting all directories:', err);
                    reject(err);
                } else {
                    const directories = {};
                    rows.forEach(row => {
                        directories[row.terminal_id] = row.directory;
                    });
                    resolve(directories);
                }
            });
        });
    }

    // Delete directory for a terminal
    deleteTerminalDirectory(terminalId) {
        return new Promise((resolve, reject) => {
            const query = `DELETE FROM terminal_directories WHERE terminal_id = ?`;
            
            this.db.run(query, [terminalId], (err) => {
                if (err) {
                    console.error('Error deleting directory:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    // Save app setting
    saveSetting(key, value) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT OR REPLACE INTO app_settings (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            `;
            
            this.db.run(query, [key, JSON.stringify(value)], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    // Get app setting
    getSetting(key) {
        return new Promise((resolve, reject) => {
            const query = `SELECT value FROM app_settings WHERE key = ?`;
            
            this.db.get(query, [key], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row ? JSON.parse(row.value) : null);
                }
            });
        });
    }

    // Close database connection
    close() {
        this.db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            } else {
                console.log('Database connection closed');
            }
        });
    }
}

module.exports = Database;
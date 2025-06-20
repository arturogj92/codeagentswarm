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
        console.log('🚀 Initializing DatabaseManager...');
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
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add sort_order column if it doesn't exist (migration)
        this.addSortOrderColumnIfNeeded();
        
        // Add plan column if it doesn't exist (migration)
        this.addPlanColumnIfNeeded();
        
        // Add implementation column if it doesn't exist (migration)
        this.addImplementationColumnIfNeeded();
        
        // Update status constraint to include in_testing (migration)
        this.updateStatusConstraintIfNeeded();
        
        console.log('✅ DatabaseManager initialization completed');
    }

    addSortOrderColumnIfNeeded() {
        try {
            // Check if sort_order column exists
            const columns = this.db.prepare("PRAGMA table_info(tasks)").all();
            const hasSortOrder = columns.some(col => col.name === 'sort_order');
            
            if (!hasSortOrder) {
                this.db.exec("ALTER TABLE tasks ADD COLUMN sort_order INTEGER DEFAULT 0");
                console.log('Added sort_order column to tasks table');
                
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
                console.log('Added plan column to tasks table');
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
                console.log('Added implementation column to tasks table');
            }
        } catch (error) {
            console.error('Error checking/adding implementation column:', error);
        }
    }

    updateStatusConstraintIfNeeded() {
        console.log('🔍 Checking if status constraint supports in_testing...');
        try {
            // Always try to insert a test record to check if constraint allows in_testing
            try {
                // Test if we can insert in_testing status
                const testStmt = this.db.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)");
                const testResult = testStmt.run('__TEST_STATUS__', 'in_testing');
                
                // If successful, delete the test record and we're good
                this.db.prepare("DELETE FROM tasks WHERE id = ?").run(testResult.lastInsertRowid);
                console.log('✅ Status constraint already supports in_testing');
            } catch (constraintError) {
                // If it fails, we need to recreate the table using a simpler approach
                console.log('❌ Status constraint needs updating. Error:', constraintError.message);
                console.log('🔄 Attempting simple table recreation...');
                this.simpleTableRecreation();
                console.log('✅ Table recreation completed');
            }
        } catch (error) {
            console.error('❌ Error checking/updating status constraint:', error);
        }
    }

    recreateTasksTableWithNewConstraint() {
        try {
            console.log('  📦 Beginning transaction...');
            this.db.exec('BEGIN TRANSACTION');
            
            console.log('  🔓 Disabling foreign key constraints...');
            this.db.exec('PRAGMA foreign_keys = OFF');
            
            console.log('  🏗️  Creating new table with updated constraint...');
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
            
            console.log('  📋 Copying existing data...');
            this.db.exec(`
                INSERT INTO tasks_new (id, title, description, plan, status, terminal_id, sort_order, created_at, updated_at, implementation)
                SELECT id, title, description, plan, status, terminal_id, sort_order, created_at, updated_at, implementation
                FROM tasks
            `);
            
            console.log('  🔄 Replacing old table...');
            this.db.exec('DROP TABLE tasks');
            this.db.exec('ALTER TABLE tasks_new RENAME TO tasks');
            
            console.log('  🔒 Re-enabling foreign key constraints...');
            this.db.exec('PRAGMA foreign_keys = ON');
            
            console.log('  💾 Committing transaction...');
            this.db.exec('COMMIT');
            
            console.log('✅ Successfully updated tasks table with in_testing status constraint');
        } catch (error) {
            console.log('  ❌ Rolling back transaction due to error...');
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
            
            console.log('  📋 Backing up existing data...');
            // Get all existing data
            const existingTasks = this.db.prepare("SELECT * FROM tasks").all();
            
            console.log('  🗑️  Dropping old table...');
            // Drop the old table
            this.db.exec('DROP TABLE IF EXISTS tasks');
            
            console.log('  🏗️  Creating new table...');
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
                    implementation TEXT
                )
            `);
            
            console.log('  📤 Restoring data...');
            // Restore data
            if (existingTasks.length > 0) {
                const insertStmt = this.db.prepare(`
                    INSERT INTO tasks (id, title, description, plan, status, terminal_id, sort_order, created_at, updated_at, implementation)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        task.implementation
                    );
                }
            }
            
            console.log('  🔒 Re-enabling foreign keys...');
            // Re-enable foreign keys
            this.db.exec('PRAGMA foreign_keys = ON');
            
            console.log('✅ Simple table recreation completed successfully');
        } catch (error) {
            console.log('  ❌ Simple recreation failed, re-enabling foreign keys...');
            this.db.exec('PRAGMA foreign_keys = ON');
            console.error('❌ Simple table recreation failed:', error);
            throw error;
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

    // Close database connection
    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = DatabaseManager;
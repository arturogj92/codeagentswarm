#!/usr/bin/env node

/**
 * Manual database migration script to add in_testing status support
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Get the database path (same logic as main app)
const dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'codeagentswarm', 'codeagentswarm.db');

console.log('Starting database migration...');
console.log('Database path:', dbPath);

try {
    const db = new Database(dbPath);
    
    console.log('Connected to database successfully');
    
    // Check current table schema
    const tableInfo = db.prepare("PRAGMA table_info(tasks)").all();
    console.log('Current table columns:', tableInfo.map(col => `${col.name} (${col.type})`));
    
    // Test if we can insert in_testing status
    let needsMigration = false;
    try {
        const testStmt = db.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)");
        const testResult = testStmt.run('__TEST_MIGRATION__', 'in_testing');
        
        // Clean up test record
        db.prepare("DELETE FROM tasks WHERE id = ?").run(testResult.lastInsertRowid);
        console.log('✅ Database already supports in_testing status');
    } catch (error) {
        console.log('❌ Database does not support in_testing status');
        console.log('Error:', error.message);
        needsMigration = true;
    }
    
    if (needsMigration) {
        console.log('🔄 Starting migration to add in_testing support...');
        
        // Begin transaction
        db.exec('BEGIN TRANSACTION');
        
        try {
            // Create new tasks table with updated constraint
            console.log('Creating new table with updated constraint...');
            db.exec(`
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
            
            // Copy data from old table to new table
            console.log('Copying existing data...');
            const copyResult = db.exec(`
                INSERT INTO tasks_new (id, title, description, plan, status, terminal_id, sort_order, created_at, updated_at, implementation)
                SELECT id, title, description, plan, status, terminal_id, sort_order, created_at, updated_at, implementation
                FROM tasks
            `);
            
            // Drop old table and rename new table
            console.log('Replacing old table...');
            db.exec('DROP TABLE tasks');
            db.exec('ALTER TABLE tasks_new RENAME TO tasks');
            
            // Commit transaction
            db.exec('COMMIT');
            
            console.log('✅ Migration completed successfully!');
            
            // Test the new constraint
            const testStmt = db.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)");
            const testResult = testStmt.run('__TEST_FINAL__', 'in_testing');
            db.prepare("DELETE FROM tasks WHERE id = ?").run(testResult.lastInsertRowid);
            
            console.log('✅ Verified: in_testing status now works correctly');
            
        } catch (migrationError) {
            // Rollback on error
            db.exec('ROLLBACK');
            console.error('❌ Migration failed:', migrationError.message);
            throw migrationError;
        }
    }
    
    // Show final table info
    const finalTableInfo = db.prepare("PRAGMA table_info(tasks)").all();
    console.log('Final table columns:', finalTableInfo.map(col => `${col.name} (${col.type})`));
    
    db.close();
    console.log('✅ Database migration completed successfully!');
    console.log('You can now restart the app and use in_testing status.');
    
} catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
}
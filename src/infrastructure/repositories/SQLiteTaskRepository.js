/**
 * SQLiteTaskRepository - Infrastructure Layer
 * Implementación concreta del TaskRepository usando SQLite
 */
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

class SQLiteTaskRepository {
  constructor() {
    const dbPath = path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'codeagentswarm',
      'codeagentswarm.db'
    );
    this.db = new Database(dbPath);
  }

  async findById(id) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? this._mapRowToTask(row) : null;
  }

  async findAll(filters = {}) {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.project) {
      query += ' AND project = ?';
      params.push(filters.project);
    }

    if (filters.terminalId) {
      query += ' AND terminal_id = ?';
      params.push(filters.terminalId);
    }

    query += ' ORDER BY sort_order ASC, created_at DESC';

    const rows = this.db.prepare(query).all(...params);
    return rows.map(row => this._mapRowToTask(row));
  }

  async save(task) {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        title, description, status, project, terminal_id,
        parent_task_id, plan, implementation, sort_order,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      task.title,
      task.description || '',
      task.status,
      task.project,
      task.terminalId,
      task.parentTaskId,
      task.plan,
      task.implementation,
      task.sortOrder,
      task.createdAt.toISOString(),
      task.updatedAt.toISOString()
    );

    task.id = result.lastInsertRowid;
    return task;
  }

  async update(task) {
    const stmt = this.db.prepare(`
      UPDATE tasks SET
        title = ?, description = ?, status = ?, project = ?,
        terminal_id = ?, parent_task_id = ?, plan = ?,
        implementation = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      task.title,
      task.description,
      task.status,
      task.project,
      task.terminalId,
      task.parentTaskId,
      task.plan,
      task.implementation,
      task.sortOrder,
      task.updatedAt.toISOString(),
      task.id
    );

    return task;
  }

  async delete(id) {
    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async findByProject(projectName) {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE project = ? ORDER BY created_at DESC')
      .all(projectName);
    return rows.map(row => this._mapRowToTask(row));
  }

  async findByTerminal(terminalId) {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE terminal_id = ? ORDER BY created_at DESC')
      .all(terminalId);
    return rows.map(row => this._mapRowToTask(row));
  }

  async findSubtasks(parentTaskId) {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY sort_order ASC')
      .all(parentTaskId);
    return rows.map(row => this._mapRowToTask(row));
  }

  async findPendingTasks() {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE status = "pending" ORDER BY created_at DESC')
      .all();
    return rows.map(row => this._mapRowToTask(row));
  }

  async findInProgressTasks() {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE status = "in_progress" ORDER BY created_at DESC')
      .all();
    return rows.map(row => this._mapRowToTask(row));
  }

  async searchTasks(query, options = {}) {
    const searchQuery = `%${query}%`;
    let sql = `
      SELECT * FROM tasks 
      WHERE (title LIKE ? OR description LIKE ? OR plan LIKE ? OR implementation LIKE ?)
    `;
    const params = [searchQuery, searchQuery, searchQuery, searchQuery];

    if (options.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }

    if (options.recentOnly) {
      sql += ' AND datetime(updated_at) > datetime("now", "-48 hours")';
    }

    sql += ' ORDER BY updated_at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(row => this._mapRowToTask(row));
  }

  _mapRowToTask(row) {
    const Task = require('../../core/domain/entities/Task');
    return new Task({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      project: row.project,
      terminalId: row.terminal_id,
      parentTaskId: row.parent_task_id,
      plan: row.plan,
      implementation: row.implementation,
      sortOrder: row.sort_order,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    });
  }
}

module.exports = SQLiteTaskRepository;
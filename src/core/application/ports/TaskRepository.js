/**
 * TaskRepository Port (Interface)
 * Define el contrato para la persistencia de tareas
 */
class TaskRepository {
  async findById(id) {
    throw new Error('Method not implemented');
  }

  async findAll(filters = {}) {
    throw new Error('Method not implemented');
  }

  async save(task) {
    throw new Error('Method not implemented');
  }

  async update(task) {
    throw new Error('Method not implemented');
  }

  async delete(id) {
    throw new Error('Method not implemented');
  }

  async findByProject(projectName) {
    throw new Error('Method not implemented');
  }

  async findByTerminal(terminalId) {
    throw new Error('Method not implemented');
  }

  async findSubtasks(parentTaskId) {
    throw new Error('Method not implemented');
  }

  async findPendingTasks() {
    throw new Error('Method not implemented');
  }

  async findInProgressTasks() {
    throw new Error('Method not implemented');
  }

  async searchTasks(query, options = {}) {
    throw new Error('Method not implemented');
  }
}

module.exports = TaskRepository;
/**
 * Task Entity - Core Domain
 * Representa una tarea en el sistema
 */
class Task {
  constructor({
    id,
    title,
    description,
    status = 'pending',
    project,
    terminalId,
    parentTaskId = null,
    plan = null,
    implementation = null,
    sortOrder = 0,
    createdAt = new Date(),
    updatedAt = new Date()
  }) {
    this.id = id;
    this.title = title;
    this.description = description;
    this.status = status;
    this.project = project;
    this.terminalId = terminalId;
    this.parentTaskId = parentTaskId;
    this.plan = plan;
    this.implementation = implementation;
    this.sortOrder = sortOrder;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  // Business logic methods
  canTransitionTo(newStatus) {
    const validTransitions = {
      'pending': ['in_progress'],
      'in_progress': ['in_testing', 'pending'],
      'in_testing': ['completed', 'in_progress'],
      'completed': ['in_progress']
    };

    return validTransitions[this.status]?.includes(newStatus) || false;
  }

  markAsInProgress() {
    if (!this.canTransitionTo('in_progress')) {
      throw new Error(`Cannot transition from ${this.status} to in_progress`);
    }
    this.status = 'in_progress';
    this.updatedAt = new Date();
  }

  markAsInTesting() {
    if (!this.canTransitionTo('in_testing')) {
      throw new Error(`Cannot transition from ${this.status} to in_testing`);
    }
    this.status = 'in_testing';
    this.updatedAt = new Date();
  }

  markAsCompleted() {
    if (!this.canTransitionTo('completed')) {
      throw new Error(`Cannot transition from ${this.status} to completed`);
    }
    if (!this.implementation) {
      throw new Error('Task must have implementation documented before completion');
    }
    this.status = 'completed';
    this.updatedAt = new Date();
  }

  updatePlan(plan) {
    this.plan = plan;
    this.updatedAt = new Date();
  }

  updateImplementation(implementation) {
    this.implementation = implementation;
    this.updatedAt = new Date();
  }

  isSubtask() {
    return this.parentTaskId !== null;
  }

  canBeParentOf(task) {
    // Prevent circular dependencies
    if (task.id === this.id) return false;
    if (task.id === this.parentTaskId) return false;
    return true;
  }
}

module.exports = Task;
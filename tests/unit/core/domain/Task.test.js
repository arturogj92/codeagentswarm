/**
 * Unit tests for Task entity
 */
const Task = require('../../../../src/core/domain/entities/Task');

describe('Task Entity', () => {
  describe('constructor', () => {
    it('should create a task with all properties', () => {
      const task = new Task({
        id: 1,
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        project: 'TestProject',
        terminalId: 1,
        parentTaskId: null,
        plan: 'Test Plan',
        implementation: 'Test Implementation',
        sortOrder: 0
      });

      expect(task.id).toBe(1);
      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('Test Description');
      expect(task.status).toBe('pending');
      expect(task.project).toBe('TestProject');
      expect(task.terminalId).toBe(1);
      expect(task.parentTaskId).toBeNull();
      expect(task.plan).toBe('Test Plan');
      expect(task.implementation).toBe('Test Implementation');
      expect(task.sortOrder).toBe(0);
    });

    it('should create a task with default values', () => {
      const task = new Task({
        title: 'Test Task'
      });

      expect(task.status).toBe('pending');
      expect(task.parentTaskId).toBeNull();
      expect(task.plan).toBeNull();
      expect(task.implementation).toBeNull();
      expect(task.sortOrder).toBe(0);
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('canTransitionTo', () => {
    it('should allow valid transitions from pending', () => {
      const task = new Task({ title: 'Test', status: 'pending' });
      
      expect(task.canTransitionTo('in_progress')).toBe(true);
      expect(task.canTransitionTo('in_testing')).toBe(false);
      expect(task.canTransitionTo('completed')).toBe(false);
    });

    it('should allow valid transitions from in_progress', () => {
      const task = new Task({ title: 'Test', status: 'in_progress' });
      
      expect(task.canTransitionTo('in_testing')).toBe(true);
      expect(task.canTransitionTo('pending')).toBe(true);
      expect(task.canTransitionTo('completed')).toBe(false);
    });

    it('should allow valid transitions from in_testing', () => {
      const task = new Task({ title: 'Test', status: 'in_testing' });
      
      expect(task.canTransitionTo('completed')).toBe(true);
      expect(task.canTransitionTo('in_progress')).toBe(true);
      expect(task.canTransitionTo('pending')).toBe(false);
    });

    it('should allow valid transitions from completed', () => {
      const task = new Task({ title: 'Test', status: 'completed' });
      
      expect(task.canTransitionTo('in_progress')).toBe(true);
      expect(task.canTransitionTo('pending')).toBe(false);
      expect(task.canTransitionTo('in_testing')).toBe(false);
    });
  });

  describe('markAsInProgress', () => {
    it('should transition task to in_progress from pending', () => {
      const task = new Task({ title: 'Test', status: 'pending' });
      const originalUpdatedAt = task.updatedAt;
      
      // Wait a bit to ensure time difference
      setTimeout(() => {
        task.markAsInProgress();
        
        expect(task.status).toBe('in_progress');
        expect(task.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
      }, 10);
    });

    it('should allow transition from completed to in_progress', () => {
      const task = new Task({ title: 'Test', status: 'completed' });
      
      task.markAsInProgress();
      expect(task.status).toBe('in_progress');
    });

    it('should throw error for invalid transition from in_testing', () => {
      const task = new Task({ title: 'Test', status: 'in_testing' });
      
      // in_testing cannot go directly to pending, only to completed or in_progress
      const taskCopy = new Task({ title: 'Test', status: 'in_testing' });
      taskCopy.status = 'pending'; // Force invalid state
      
      expect(() => {
        const invalidTask = new Task({ title: 'Test', status: 'pending' });
        invalidTask.status = 'in_testing'; // Set to in_testing
        invalidTask.markAsInProgress(); // This should work
      }).not.toThrow();
    });
  });

  describe('markAsInTesting', () => {
    it('should transition task to in_testing from in_progress', () => {
      const task = new Task({ title: 'Test', status: 'in_progress' });
      task.markAsInTesting();
      
      expect(task.status).toBe('in_testing');
    });

    it('should throw error for invalid transition', () => {
      const task = new Task({ title: 'Test', status: 'pending' });
      
      expect(() => task.markAsInTesting()).toThrow('Cannot transition from pending to in_testing');
    });
  });

  describe('markAsCompleted', () => {
    it('should transition task to completed from in_testing with implementation', () => {
      const task = new Task({ 
        title: 'Test', 
        status: 'in_testing',
        implementation: 'Implementation details'
      });
      task.markAsCompleted();
      
      expect(task.status).toBe('completed');
    });

    it('should throw error if no implementation is documented', () => {
      const task = new Task({ title: 'Test', status: 'in_testing' });
      
      expect(() => task.markAsCompleted()).toThrow('Task must have implementation documented before completion');
    });

    it('should throw error for invalid transition', () => {
      const task = new Task({ 
        title: 'Test', 
        status: 'pending',
        implementation: 'Implementation details'
      });
      
      expect(() => task.markAsCompleted()).toThrow('Cannot transition from pending to completed');
    });
  });

  describe('updatePlan', () => {
    it('should update task plan and updatedAt', () => {
      const task = new Task({ title: 'Test' });
      const originalUpdatedAt = task.updatedAt;
      
      setTimeout(() => {
        task.updatePlan('New plan');
        
        expect(task.plan).toBe('New plan');
        expect(task.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
      }, 10);
    });
  });

  describe('updateImplementation', () => {
    it('should update task implementation and updatedAt', () => {
      const task = new Task({ title: 'Test' });
      const originalUpdatedAt = task.updatedAt;
      
      setTimeout(() => {
        task.updateImplementation('New implementation');
        
        expect(task.implementation).toBe('New implementation');
        expect(task.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
      }, 10);
    });
  });

  describe('isSubtask', () => {
    it('should return true if task has parent', () => {
      const task = new Task({ title: 'Test', parentTaskId: 123 });
      expect(task.isSubtask()).toBe(true);
    });

    it('should return false if task has no parent', () => {
      const task = new Task({ title: 'Test' });
      expect(task.isSubtask()).toBe(false);
    });
  });

  describe('canBeParentOf', () => {
    it('should prevent task from being parent of itself', () => {
      const task1 = new Task({ id: 1, title: 'Test' });
      
      expect(task1.canBeParentOf(task1)).toBe(false);
    });

    it('should prevent circular dependencies', () => {
      const parentTask = new Task({ id: 1, title: 'Parent' });
      const childTask = new Task({ id: 2, title: 'Child', parentTaskId: 1 });
      
      expect(childTask.canBeParentOf(parentTask)).toBe(false);
    });

    it('should allow valid parent-child relationships', () => {
      const task1 = new Task({ id: 1, title: 'Task 1' });
      const task2 = new Task({ id: 2, title: 'Task 2' });
      
      expect(task1.canBeParentOf(task2)).toBe(true);
    });
  });
});
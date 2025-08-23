/**
 * Dependency Injection Container
 * Gestiona las dependencias y su inyección
 */
class DIContainer {
  constructor() {
    this.services = new Map();
    this.singletons = new Map();
  }

  register(name, factory, options = {}) {
    this.services.set(name, {
      factory,
      singleton: options.singleton || false
    });
  }

  get(name) {
    const service = this.services.get(name);
    
    if (!service) {
      throw new Error(`Service ${name} not found`);
    }

    if (service.singleton) {
      if (!this.singletons.has(name)) {
        this.singletons.set(name, service.factory(this));
      }
      return this.singletons.get(name);
    }

    return service.factory(this);
  }

  // Configuración de servicios
  configure() {
    // Repositories
    this.register('taskRepository', () => {
      const SQLiteTaskRepository = require('../repositories/SQLiteTaskRepository');
      return new SQLiteTaskRepository();
    }, { singleton: true });

    this.register('projectRepository', () => {
      const SQLiteProjectRepository = require('../repositories/SQLiteProjectRepository');
      return new SQLiteProjectRepository();
    }, { singleton: true });

    // Use Cases
    this.register('createTaskUseCase', (container) => {
      const CreateTaskUseCase = require('../../core/application/use-cases/CreateTaskUseCase');
      return new CreateTaskUseCase(
        container.get('taskRepository'),
        container.get('projectRepository')
      );
    });

    this.register('updateTaskStatusUseCase', (container) => {
      const UpdateTaskStatusUseCase = require('../../core/application/use-cases/UpdateTaskStatusUseCase');
      return new UpdateTaskStatusUseCase(
        container.get('taskRepository')
      );
    });

    this.register('generateCommitUseCase', (container) => {
      const GenerateCommitUseCase = require('../../core/application/use-cases/commit/GenerateCommitUseCase');
      return new GenerateCommitUseCase(
        container.get('gitService'),
        container.get('commitMessageGenerator')
      );
    });

    // Services
    this.register('gitService', () => {
      const GitServiceAdapter = require('../adapters/GitServiceAdapter');
      return new GitServiceAdapter();
    }, { singleton: true });

    this.register('mcpService', () => {
      const MCPServiceAdapter = require('../adapters/MCPServiceAdapter');
      return new MCPServiceAdapter();
    }, { singleton: true });

    // External Services
    this.register('electronStore', () => {
      const Store = require('electron-store');
      return new Store();
    }, { singleton: true });

    this.register('logger', () => {
      const Logger = require('../services/Logger');
      return new Logger();
    }, { singleton: true });
  }
}

// Singleton instance
let instance = null;

module.exports = {
  getContainer() {
    if (!instance) {
      instance = new DIContainer();
      instance.configure();
    }
    return instance;
  }
};
/**
 * CreateTaskUseCase - Application Layer
 * Caso de uso para crear una nueva tarea
 */
class CreateTaskUseCase {
  constructor(taskRepository, projectRepository) {
    this.taskRepository = taskRepository;
    this.projectRepository = projectRepository;
  }

  async execute({
    title,
    description = '',
    project,
    terminalId,
    parentTaskId = null
  }) {
    // Validaciones de negocio
    if (!title || title.trim().length === 0) {
      throw new Error('Task title is required');
    }

    if (title.length > 200) {
      throw new Error('Task title must be less than 200 characters');
    }

    // Verificar que el proyecto existe
    if (project) {
      const projectExists = await this.projectRepository.exists(project);
      if (!projectExists) {
        // Crear proyecto si no existe
        await this.projectRepository.create({ name: project });
      }
    }

    // Verificar tarea padre si existe
    if (parentTaskId) {
      const parentTask = await this.taskRepository.findById(parentTaskId);
      if (!parentTask) {
        throw new Error('Parent task not found');
      }
      // Heredar proyecto del padre si no se especifica
      if (!project) {
        project = parentTask.project;
      }
    }

    // Crear la entidad Task
    const Task = require('../../domain/entities/Task');
    const task = new Task({
      title: title.trim(),
      description: description.trim(),
      project,
      terminalId,
      parentTaskId,
      status: 'pending'
    });

    // Persistir la tarea
    const savedTask = await this.taskRepository.save(task);

    return {
      success: true,
      task: savedTask
    };
  }
}

module.exports = CreateTaskUseCase;
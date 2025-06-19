# CodeAgentSwarm Project Configuration

This file is automatically managed by CodeAgentSwarm to ensure proper MCP (Model Context Protocol) integration.

## MCP Servers

### Task Manager

- **Command**: `node mcp-stdio-server.js`
- **Description**: Task management system for CodeAgentSwarm
- **Tools**: create_task, start_task, complete_task, list_tasks
- **Resources**: All tasks, pending tasks, in-progress tasks, completed tasks

_Note: This MCP configuration is automatically managed by CodeAgentSwarm. Do not remove this section as it's required for task management functionality._

## Gestión de Tareas - IMPORTANTE

### Uso obligatorio del sistema de tareas

**SIEMPRE** que comiences a trabajar en una nueva tarea, debes:

1. **Primero verificar** si ya existe una tarea similar creada usando `list_tasks` del MCP
2. Si no existe una tarea similar, **crear una nueva tarea** usando `create_task` del MCP
3. **Iniciar la tarea** usando `start_task` antes de comenzar cualquier trabajo
4. **Completar la tarea** usando `complete_task` cuando termines
5. **Si detectas que la tarea actual se desvía del foco o cambia significativamente el objetivo, debes crear una nueva tarea y continuar el trabajo bajo esa nueva tarea.**

### Flujo de trabajo

1. **Al recibir una solicitud del usuario:**

   - Revisar las tareas existentes con `list_tasks`
   - Si existe una tarea relacionada, usarla
   - Si no existe, crear una nueva tarea descriptiva

2. **Durante el trabajo:**

   - La tarea actual se mostrará en la barra del terminal
   - Mantener actualizado el estado de la tarea
   - Una sola tarea activa por terminal

3. **Al finalizar:**
   - Marcar la tarea como completada
   - Esto actualiza automáticamente la interfaz

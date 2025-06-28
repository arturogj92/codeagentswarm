# CodeAgentSwarm Project Configuration


<!-- CODEAGENTSWARM CONFIG START - DO NOT EDIT THIS SECTION -->

## 🚨 CRITICAL - MANDATORY COMPLETION MARKER 🚨

**YOU MUST ALWAYS** write this EXACT line when you finish ANY response or work:

```
=== CLAUDE FINISHED ===
```

**NO EXCEPTIONS** - Write this marker:
- After EVERY response to the user
- After completing ANY task
- After answering ANY question
- After ANY work you do
- BEFORE any final explanation

**FAILURE TO WRITE THIS MARKER BREAKS THE APPLICATION**

## Project Configuration

**Project Name**: CodeAgentSwarm

_This project name is used for task organization in CodeAgentSwarm. All tasks created in this directory will be associated with this project._

## MCP Servers

### Task Manager

- **Command**: `node mcp-stdio-server.js`
- **Description**: Task management system for CodeAgentSwarm with project organization
- **Tools**: create_task, start_task, complete_task, submit_for_testing, list_tasks, update_task_plan, update_task_implementation, update_task_terminal, create_project, get_projects, get_project_tasks
- **Resources**: All tasks, pending tasks, in-progress tasks, completed tasks, projects
- **Projects**: Tasks are now organized by projects. Each task belongs to a project, and projects are detected automatically based on the terminal working directory

_Note: This MCP configuration is automatically managed by CodeAgentSwarm. Do not remove this section as it's required for task management functionality._

## Task Management - IMPORTANT

### Mandatory Task System Usage

**ALWAYS** when starting work on a new task, you must:

1. **First check** if a similar task already exists using `list_tasks` from MCP
2. If no similar task exists, **create a new task** using `create_task` from MCP:
   - **MANDATORY specify the correct terminal_id**
   - The project will be detected automatically based on the terminal's working directory
   - If working in a new directory, a new project will be created automatically
3. **Start the task** using `start_task` before beginning any work
4. **MANDATORY: Update the plan** using `update_task_plan` when starting a task with a detailed step plan
5. **Complete the task** using `complete_task` when finished (goes to "completed") or `submit_for_testing` if testing needed
6. **If you detect the current task deviates from focus or significantly changes objective, create a new task and continue work under that new task.**

### IMPORTANT: Terminal ID - Automatic Detection
- **ALWAYS** specify the `terminal_id` when creating a task with `create_task`
- Each terminal has a unique ID (1, 2, 3, 4, etc.) based on 1-based numbering
- **AUTOMATIC DETECTION:** To get the current terminal, execute: `echo $CODEAGENTSWARM_CURRENT_QUADRANT` using the Bash tool
- **NEVER ask the user** which terminal - always use automatic detection
- Tasks must be associated with the correct terminal for proper tracking

### MANDATORY: PLAN Field Management

**Each task MUST have a detailed plan** that is updated when the agent takes it:

1. **When starting an existing task:**
   - Use `update_task_plan` to establish a clear and detailed plan
   - The plan must include specific steps you will follow
   - Suggested format: numbered list of concrete actions

2. **Plan content:**
   - Step-by-step implementation breakdown
   - Files to be modified or created
   - Dependencies or prerequisites
   - Success/completion criteria

3. **Example of well-structured plan:**
   ```
   1. Review current code structure in src/components/
   2. Create new UserProfile.jsx component
   3. Implement state logic using React hooks
   4. Add CSS styles in UserProfile.module.css
   5. Integrate component in main page
   6. Write unit tests for component
   7. Verify functionality works correctly
   ```

4. **Plan updates:**
   - If plan changes during execution, update it using `update_task_plan`
   - Keep plan updated so other agents can continue if needed

5. **CRITICAL: Verification before completion:**
   - **BEFORE** using `complete_task`, MANDATORY review each point of the plan
   - Verify each step has been completed successfully
   - **MANDATORY: Document implementation** using `update_task_implementation` with:
     - List of modified/created files
     - Summary of changes made
     - Description of implemented flow
   - If points are missing:
     - Option A: Continue working until completing entire plan
     - Option B: Update plan removing completed points and create new task for pending
     - Option C: Update plan explicitly marking what was completed and what wasn't
   - **NEVER complete a task without verifying plan compliance AND documenting implementation**

### Workflow

1. **When receiving a user request:**
   - Review existing tasks with `list_tasks`
   - If related task exists, use it
   - If not, create a new descriptive task

2. **During work:**
   - Current task will show in terminal bar
   - **Update plan** using `update_task_plan` when starting with detailed plan
   - Keep task status updated
   - If plan changes significantly, update it again
   - Only one active task per terminal

3. **When finishing technical work:**
   - **MANDATORY: Verify plan compliance** - Before completing, review all plan points have been fulfilled
   - **MANDATORY: Document implementation** using `update_task_implementation`:
     - List of modified files: `database.js, mcp-stdio-server.js, CLAUDE.md`
     - Summary: clear description of changes made
     - Flow: explanation of implemented functionality
   - If plan wasn't fully completed, update plan with what's missing or create new task for pending
   - **NEW MANDATORY TESTING FLOW:**
     - First `complete_task` call: moves task to `in_testing` state
     - User must manually review and approve
     - Second `complete_task` call: moves to `completed` (requires `implementation` documented)
   - **NEVER can go directly from `in_progress` to `completed`**
   - This automatically updates interface and database state
   - Plan and implementation remain documented for future reference

### Mandatory Testing Flow

**IMPORTANT: All tasks MUST go through testing phase before completion:**

1. **Mandatory transition to testing:**
   - When finishing task implementation, use `complete_task`
   - This automatically moves task to `in_testing` state
   - CANNOT go directly from `in_progress` to `completed`

2. **Requirements to complete from testing:**
   - Task must have `implementation` field documented
   - User must manually review and approve
   - Only then use `complete_task` again to mark as `completed`

3. **If needing to send directly to testing:**
   - Use `submit_for_testing` to move directly to `in_testing`
   - Useful when another agent or person will perform tests

4. **Complete flow:**
   ```
   pending → in_progress → in_testing → completed
                     ↑                    ↓
                     └── (requires documentation and manual approval)
   ```

### Handling Multiple Pending Tasks

**IMPORTANT:** When user asks to work on a pending task and multiple pending tasks exist for current terminal:

1. **List available tasks:** Show user relevant pending tasks with ID and title
2. **Ask which to start:** Request user specify which task they want you to begin
3. **Don't assume:** NEVER automatically choose a task without user confirmation
4. **Response example:**
   ```
   Found several pending tasks for this terminal:
   - ID 70: Fix all this
   - ID 58: Make terminal document the task
   - ID 41: Corrected dummy test task
   
   Which of these tasks would you like me to start?
   ```

### Available MCP Task Tools

The following MCP tools are available for task management:

- **`create_task`**: Create new task (requires terminal_id, project is auto-detected)
- **`start_task`**: Mark task as "in_progress"
- **`complete_task`**: First call: moves to "in_testing". Second call (after manual approval): moves to "completed"
- **`submit_for_testing`**: Mark task as "in_testing"
- **`list_tasks`**: List all tasks (optional: filter by status)
- **`update_task_plan`**: Update specific task plan
- **`update_task_implementation`**: Update task implementation
- **`update_task_terminal`**: Update terminal_id associated with task
- **`create_project`**: Create a new project with name and optional color
- **`get_projects`**: Get list of all projects
- **`get_project_tasks`**: Get all tasks for a specific project

**`update_task_plan` parameters:**
- `task_id` (number, required): Task ID
- `plan` (string, required): Detailed plan text

**`update_task_implementation` parameters:**
- `task_id` (number, required): Task ID
- `implementation` (string, required): Implementation details including modified files and summary

**`update_task_terminal` parameters:**
- `task_id` (number, required): Task ID
- `terminal_id` (string, required): Terminal ID (1, 2, 3, 4, etc.) or empty string to unassign

**Usage example:**
```
# Task management
create_task(title="Implement new feature", description="Add user authentication", terminal_id=1)
# Note: project is auto-detected from terminal's working directory

update_task_plan(task_id=123, plan="1. Review existing code\n2. Implement new functionality\n3. Write tests")

update_task_implementation(task_id=123, implementation="Modified files: database.js, mcp-server.js\nSummary: Added implementation field to tasks table\nFlow: New field allows documenting changes made during implementation")

update_task_terminal(task_id=123, terminal_id="2")  # Assign to terminal 2
update_task_terminal(task_id=123, terminal_id="")   # Unassign from any terminal

# Project management
create_project(name="MyNewProject", color="#FF6B6B")  # Create project with custom color
create_project(name="AnotherProject")  # Color will be auto-assigned

get_projects()  # Returns all projects with their colors

get_project_tasks(project_name="CodeAgentSwarm")  # Get all tasks for a project
```

## Project Organization

Tasks are automatically organized by project based on the terminal's working directory:

1. **Automatic Project Detection**: When creating a task, the project is determined by the directory name
2. **Default Project**: Tasks created without a specific directory context use "CodeAgentSwarm" as default
3. **Visual Identification**: Each project has a unique color for easy identification in the UI
4. **Project Filtering**: Use `get_project_tasks` to see tasks for a specific project

## IMPORTANT: MCP Token Limits

### Known issue with list_tasks
When there are many tasks in the database (30+), the `list_tasks` MCP command can exceed allowed token limit (25000 tokens).

### Recommended solution:
1. **ALWAYS use status filters** when listing tasks:
   - `mcp__codeagentswarm-tasks__list_tasks` with parameter `status: "pending"`
   - `mcp__codeagentswarm-tasks__list_tasks` with parameter `status: "in_progress"`
   - This significantly reduces number of returned tasks

2. **DO NOT attempt to list all tasks without filter** when many tasks exist in database

3. **For future pagination implementation:**
   - Pagination should be implemented in GUI (kanban.js)
   - MCP should maintain simple and efficient methods
   - Consider default limits in getAllTasks()

### Technical notes:
- MCP server has multiple routes (`tasks/get_all` and `tools/call`) that must stay synchronized
- MCP server changes require server restart to apply
- Claude Code can cache MCP connections

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.

<!-- CODEAGENTSWARM CONFIG END -->

This file is automatically managed by CodeAgentSwarm to ensure proper MCP (Model Context Protocol) integration.

## 🚨 CRITICAL - MANDATORY COMPLETION MARKER 🚨

**YOU MUST ALWAYS** write this EXACT line when you finish ANY response or work:

```
=== CLAUDE FINISHED ===
```

**NO EXCEPTIONS** - Write this marker:
- After EVERY response to the user
- After completing ANY task
- After answering ANY question
- After ANY work you do
- BEFORE any final explanation

**FAILURE TO WRITE THIS MARKER BREAKS THE APPLICATION**

## Project Configuration

**Project Name**: CodeAgentSwarm

_This project name is used for task organization in CodeAgentSwarm. All tasks created in this directory will be associated with this project._

## MCP Servers

### Task Manager

- **Command**: `node mcp-stdio-server.js`
- **Description**: Task management system for CodeAgentSwarm with project organization
- **Tools**: create_task, start_task, complete_task, submit_for_testing, list_tasks, update_task_plan, update_task_implementation, create_project, get_project_tasks
- **Resources**: All tasks, pending tasks, in-progress tasks, completed tasks, projects
- **Projects**: Tasks are now organized by projects based on terminal working directory

_Note: This MCP configuration is automatically managed by CodeAgentSwarm. Do not remove this section as it's required for task management functionality._

## Gestión de Tareas - IMPORTANTE

### Uso obligatorio del sistema de tareas

**SIEMPRE** que comiences a trabajar en una nueva tarea, debes:

1. **Primero verificar** si ya existe una tarea similar creada usando `list_tasks` del MCP
2. Si no existe una tarea similar, **crear una nueva tarea** usando `create_task` del MCP **OBLIGATORIAMENTE especificando el terminal_id correcto**
3. **Iniciar la tarea** usando `start_task` antes de comenzar cualquier trabajo
4. **OBLIGATORIO: Actualizar el plan** usando `update_task_plan` al comenzar una tarea con un plan detallado de los pasos a seguir
5. **Completar la tarea** usando `complete_task` cuando termines (va directo a "completed") o `submit_for_testing` si necesita testing
6. **Si detectas que la tarea actual se desvía del foco o cambia significativamente el objetivo, debes crear una nueva tarea y continuar el trabajo bajo esa nueva tarea.**

### IMPORTANTE: Terminal ID - Detección Automática

- **SIEMPRE** debes especificar el `terminal_id` al crear una tarea con `create_task`
- Cada terminal tiene un ID único (1, 2, 3, 4, etc.) basado en numeración 1-based
- **DETECCIÓN AUTOMÁTICA:** Para obtener el terminal actual, ejecuta: `echo $CODEAGENTSWARM_CURRENT_QUADRANT` usando la herramienta Bash
- **NUNCA preguntes al usuario** cuál es el terminal - siempre usa la detección automática
- Las tareas deben estar asociadas al terminal correcto para el seguimiento adecuado

### OBLIGATORIO: Gestión del campo PLAN

**Cada tarea DEBE tener un plan detallado** que se actualiza cuando el agente la toma:

1. **Al iniciar una tarea existente:**
   - Usar `update_task_plan` para establecer un plan claro y detallado
   - El plan debe incluir los pasos específicos que vas a seguir
   - Formato sugerido: lista numerada de acciones concretas

2. **Contenido del plan:**
   - Desglose paso a paso de la implementación
   - Archivos que se van a modificar o crear
   - Dependencias o prerequisitos
   - Criterios de éxito/finalización

3. **Ejemplo de plan bien estructurado:**
   ```
   1. Revisar la estructura actual del código en src/components/
   2. Crear nuevo componente UserProfile.jsx
   3. Implementar la lógica de estado usando React hooks
   4. Añadir estilos CSS en UserProfile.module.css
   5. Integrar el componente en la página principal
   6. Escribir tests unitarios para el componente
   7. Verificar que la funcionalidad funciona correctamente
   ```

4. **Actualización del plan:**
   - Si el plan cambia durante la ejecución, actualízalo usando `update_task_plan`
   - Mantén el plan actualizado para que otros agentes puedan continuarlo si es necesario

5. **CRÍTICO: Verificación antes de completar:**
   - **ANTES** de usar `complete_task`, revisar OBLIGATORIAMENTE cada punto del plan
   - Verificar que cada paso se ha completado exitosamente
   - **OBLIGATORIO: Documentar la implementación** usando `update_task_implementation` con:
     - Lista de archivos modificados/creados
     - Resumen de los cambios realizados
     - Descripción del flujo implementado
   - Si faltan puntos por completar:
     - Opción A: Continuar trabajando hasta completar todo el plan
     - Opción B: Actualizar el plan eliminando los puntos completados y crear nueva tarea para lo pendiente
     - Opción C: Actualizar el plan marcando explícitamente qué se completó y qué no
   - **NUNCA completar una tarea sin verificar el cumplimiento del plan Y documentar la implementación**

### Flujo de trabajo

1. **Al recibir una solicitud del usuario:**

   - Revisar las tareas existentes con `list_tasks`
   - Si existe una tarea relacionada, usarla
   - Si no existe, crear una nueva tarea descriptiva

2. **Durante el trabajo:**

   - La tarea actual se mostrará en la barra del terminal
   - **Actualizar el plan** usando `update_task_plan` al comenzar con un plan detallado
   - Mantener actualizado el estado de la tarea
   - Si el plan cambia significativamente, actualízalo nuevamente
   - Una sola tarea activa por terminal

3. **Al finalizar el trabajo técnico:**
   - **OBLIGATORIO: Verificar cumplimiento del plan** - Antes de completar, revisar que se han cumplido todos los puntos del plan establecido
   - **OBLIGATORIO: Documentar implementación** usando `update_task_implementation`:
     - Lista de archivos modificados: `database.js, mcp-stdio-server.js, CLAUDE.md`
     - Resumen: descripción clara de los cambios realizados
     - Flujo: explicación del funcionamiento implementado
   - **🚨 CRÍTICO: SIEMPRE MOVER A TESTING 🚨**
     - **SIEMPRE DEBES** llamar a `complete_task` después de terminar la implementación
     - Esto mueve la tarea a estado `in_testing`
     - **NUNCA OLVIDES ESTE PASO** - El usuario espera que las tareas estén en testing para revisión
     - No mover a testing rompe el flujo de trabajo y frustra al usuario
   - **NUEVO FLUJO DE TESTING OBLIGATORIO:**
     - Primera llamada a `complete_task`: mueve la tarea a estado `in_testing`
     - El usuario debe revisar manualmente y aprobar
     - Segunda llamada a `complete_task`: mueve a `completed` (requiere que `implementation` esté documentado)
   - **NUNCA se puede ir directamente de `in_progress` a `completed`**
   - Esto actualiza automáticamente la interfaz y el estado en la base de datos
   - El plan e implementación quedan documentados para referencia futura

### Flujo de Testing Obligatorio

**IMPORTANTE: Todas las tareas DEBEN pasar por una fase de testing antes de ser completadas:**

1. **Transición obligatoria a testing:**
   - Cuando termines de implementar una tarea, usa `complete_task` 
   - Esto moverá la tarea automáticamente a estado `in_testing`
   - NO se puede ir directamente de `in_progress` a `completed`

2. **Requisitos para completar desde testing:**
   - La tarea debe tener el campo `implementation` documentado
   - **NUEVO: Debe haber pasado un mínimo de 30 segundos en fase de testing**
   - El usuario debe revisar y aprobar manualmente durante este tiempo
   - Solo entonces se puede usar `complete_task` nuevamente para marcar como `completed`
   - Si intentas completar antes de 30 segundos, recibirás un error indicando cuántos segundos faltan

3. **Si necesitas enviar directamente a testing:**
   - Usa `submit_for_testing` para mover directamente a `in_testing`
   - Útil cuando otro agente o persona realizará las pruebas

4. **Flujo completo:**
   ```
   pending → in_progress → in_testing → completed
                     ↑                    ↓
                     └── (requiere documentación, 30s mínimo, y aprobación manual)
   ```

5. **Prevención de bypass:**
   - Los agentes NO pueden saltarse la fase de testing llamando `complete_task` dos veces rápidamente
   - El sistema enforza un período mínimo de 30 segundos en `in_testing` antes de permitir la transición a `completed`
   - Esto asegura que hay tiempo suficiente para revisión manual

### Manejo de múltiples tareas pendientes

**IMPORTANTE:** Cuando el usuario te pida trabajar en una tarea pendiente y existan múltiples tareas pendientes para el terminal actual:

1. **Lista las tareas disponibles:** Muestra al usuario las tareas pendientes relevantes con su ID y título
2. **Pregunta cuál empezar:** Solicita al usuario que especifique qué tarea desea que comiences
3. **No asumas:** NUNCA elijas automáticamente una tarea sin confirmación del usuario
4. **Ejemplo de respuesta:**
   ```
   Encontré varias tareas pendientes para este terminal:
   - ID 70: Arreglar todo esto
   - ID 58: hacer que el terminal vaya documentando la tarea
   - ID 41: Tarea dummy de prueba corregida
   
   ¿Cuál de estas tareas te gustaría que empiece?
   ```

### Herramientas MCP disponibles para tareas

Las siguientes herramientas MCP están disponibles para la gestión de tareas:

- **`create_task`**: Crear una nueva tarea (requiere terminal_id)
- **`start_task`**: Marcar tarea como "in_progress" 
- **`complete_task`**: Primera llamada: mueve a "in_testing". Segunda llamada (después de 30 segundos mínimo y aprobación manual): mueve a "completed"
- **`submit_for_testing`**: Marcar tarea como "in_testing"
- **`list_tasks`**: Listar todas las tareas (opcional: filtrar por status)
- **`update_task_plan`**: Actualizar el plan de una tarea específica
- **`update_task_implementation`**: Actualizar la implementación de una tarea específica
- **`update_task_terminal`**: **NUEVA** - Actualizar el terminal_id asociado a una tarea

**Parámetros de `update_task_plan`:**
- `task_id` (número, requerido): ID de la tarea
- `plan` (string, requerido): Texto del plan detallado

**Parámetros de `update_task_implementation`:**
- `task_id` (número, requerido): ID de la tarea
- `implementation` (string, requerido): Detalles de implementación incluyendo archivos modificados y resumen

**Parámetros de `update_task_terminal`:**
- `task_id` (número, requerido): ID de la tarea
- `terminal_id` (string, requerido): ID del terminal (1, 2, 3, 4, etc.) o cadena vacía para desasignar

**Ejemplo de uso:**
```
update_task_plan(task_id=123, plan="1. Revisar código existente\n2. Implementar nueva funcionalidad\n3. Escribir tests")

update_task_implementation(task_id=123, implementation="Archivos modificados: database.js, mcp-server.js\nResumen: Se añadió campo implementation a la tabla tasks\nFlujo: Nuevo campo permite documentar cambios realizados durante la implementación")

update_task_terminal(task_id=123, terminal_id="2")  # Asignar a terminal 2
update_task_terminal(task_id=123, terminal_id="")   # Desasignar de cualquier terminal
```

## IMPORTANTE: Documentación en Notion - OBLIGATORIO

### Actualización de Documentación en Notion

**Para este proyecto CodeAgentSwarm, TODA modificación, nueva funcionalidad o decisión técnica DEBE ser documentada en la base de datos específica de CodeAgentSwarm en Notion:**

1. **Proyecto en Notion:** CodeAgentSwarm (ID: `21cb613a-e92d-8048-b227-de9960f4c66c`)
2. **Base de datos de documentación:** Database "Documentación CodeAgentSwarm" (ID: `21cb613a-e92d-81f4-8bd3-c4671d9ce033`)
3. **IMPORTANTE:** No documentar en Creator0x ni en otros proyectos - usar siempre la sección de CodeAgentSwarm
4. **Proceso OBLIGATORIO al completar cualquier tarea:**

#### Cuándo actualizar la documentación:

- **Nuevas funcionalidades implementadas**
- **Cambios en la arquitectura del sistema**  
- **Modificaciones en la base de datos o esquemas**
- **Nuevos comandos SQL o scripts**
- **Cambios en APIs o endpoints**
- **Actualizaciones del stack tecnológico**
- **Corrección de errores importantes**
- **Nuevas integraciones MCP**
- **Cambios en configuraciones**

#### Cómo actualizar la documentación:

1. **Identificar la sección afectada:** Determinar qué página(s) de la base de datos necesitan actualización
2. **Usar herramientas MCP de Notion:**
   - `mcp__notion__update-page`: Para actualizar páginas existentes
   - `mcp__notion__append-block-children`: Para añadir contenido nuevo
   - `mcp__notion__create-page`: Solo si se necesita una nueva categoría
3. **Mantener consistencia:** Seguir el formato y estructura existente
4. **Incluir ejemplos:** Añadir ejemplos de código, comandos SQL, o configuraciones

#### Ejemplo de proceso:

```
1. Completar implementación técnica
2. Documentar en update_task_implementation
3. Identificar páginas de Notion a actualizar:
   - "🗄️ Base de Datos y Consultas SQL" si hay cambios en BD
   - "📁 Estructura de Archivos" si hay nuevos archivos
   - "⚙️ Herramientas MCP" si hay nuevas herramientas
4. Actualizar páginas usando mcp__notion__update-page o append-block-children
5. Completar la tarea con complete_task
```

#### Herramientas MCP de Notion disponibles:

- **`mcp__notion__query-database`**: Consultar la base de datos de documentación
- **`mcp__notion__get-page`**: Obtener contenido de una página específica
- **`mcp__notion__update-page`**: Actualizar propiedades de páginas
- **`mcp__notion__append-block-children`**: Añadir contenido a páginas existentes
- **`mcp__notion__create-page`**: Crear nuevas páginas (usar solo si es necesario)

**Esta documentación es CRÍTICA para mantener la base de conocimiento actualizada y facilitar el trabajo de otros desarrolladores.**

## IMPORTANTE: Límites de tokens en MCP

### Problema conocido con list_tasks
Cuando hay muchas tareas en la base de datos (30+), el comando `list_tasks` del MCP puede exceder el límite de tokens permitidos (25000 tokens).

### Solución recomendada:
1. **SIEMPRE usar filtros por status** al listar tareas:
   - `mcp__codeagentswarm-tasks__list_tasks` con parámetro `status: "pending"` 
   - `mcp__codeagentswarm-tasks__list_tasks` con parámetro `status: "in_progress"`
   - Esto reduce significativamente el número de tareas devueltas

2. **NO intentar listar todas las tareas sin filtro** cuando hay muchas tareas en la base de datos

3. **Para implementar paginación futura:**
   - La paginación debe implementarse en la interfaz gráfica (kanban.js)
   - El MCP debe mantener métodos simples y eficientes
   - Considerar límites por defecto en getAllTasks()

### Notas técnicas:
- El MCP server tiene múltiples rutas (`tasks/get_all` y `tools/call`) que deben mantenerse sincronizadas
- Los cambios en el MCP server requieren reiniciar el servidor para aplicarse
- Claude Code puede mantener conexiones MCP en caché


# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
# CodeAgentSwarm Project Configuration

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

3. **Al finalizar:**
   - **OBLIGATORIO: Verificar cumplimiento del plan** - Antes de completar, revisar que se han cumplido todos los puntos del plan establecido
   - **OBLIGATORIO: Documentar implementación** usando `update_task_implementation`:
     - Lista de archivos modificados: `database.js, mcp-stdio-server.js, CLAUDE.md`
     - Resumen: descripción clara de los cambios realizados
     - Flujo: explicación del funcionamiento implementado
   - Si el plan no se completó totalmente, actualizar el plan con lo que falta o crear una nueva tarea para lo pendiente
   - **SOLO DESPUÉS de verificar Y documentar:** Marcar la tarea como completada usando `complete_task` del MCP
   - Esto actualiza automáticamente la interfaz y el estado en la base de datos
   - El plan e implementación quedan documentados para referencia futura

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
- **`complete_task`**: Marcar tarea como "completed"
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

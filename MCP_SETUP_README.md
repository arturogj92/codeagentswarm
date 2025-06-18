# CodeAgentSwarm MCP Task Management

Este documento explica cómo instalar y usar el servidor MCP de gestión de tareas de CodeAgentSwarm con Claude Code.

## 📋 Descripción

El MCP (Model Context Protocol) de CodeAgentSwarm permite a Claude Code gestionar tareas directamente, con persistencia de datos y sincronización con la interfaz Kanban de la aplicación.

## 🚀 Instalación

### Prerrequisitos

1. **Claude Code** instalado y funcionando
2. **Node.js** instalado (versión 16 o superior)
3. **CodeAgentSwarm** aplicación (para persistencia de datos)

### Instalación Automática

```bash
# Desde el directorio de CodeAgentSwarm
./install-mcp.sh
```

### Instalación Manual

```bash
# Registrar el servidor MCP
claude mcp add codeagentswarm node ./mcp-stdio-server.js
```

### Verificar Instalación

```bash
# Listar servidores MCP instalados
claude mcp list

# Debería mostrar:
# codeagentswarm: node /path/to/codeagentswarm/mcp-stdio-server.js
```

## 🔧 Uso en Claude Code

### Herramientas Disponibles

El MCP proporciona las siguientes herramientas que puedes usar directamente:

#### 1. `create_task`
Crea una nueva tarea.

```javascript
create_task("Implementar autenticación", "Añadir sistema de login OAuth", 0)
```

**Parámetros:**
- `title` (requerido): Título de la tarea
- `description` (opcional): Descripción detallada
- `terminal_id` (opcional): ID del terminal (0-3)

#### 2. `start_task`
Marca una tarea como "en progreso".

```javascript
start_task(1)
```

**Parámetros:**
- `task_id` (requerido): ID de la tarea

#### 3. `complete_task`
Marca una tarea como completada.

```javascript
complete_task(1)
```

**Parámetros:**
- `task_id` (requerido): ID de la tarea

#### 4. `list_tasks`
Lista todas las tareas o filtra por estado.

```javascript
// Listar todas las tareas
list_tasks()

// Filtrar por estado
list_tasks({"status": "in_progress"})
```

**Parámetros:**
- `status` (opcional): `"pending"`, `"in_progress"`, o `"completed"`

### Comandos Slash (Prompts)

#### `/mcp__codeagentswarm__start_coding_session`
Inicia una nueva sesión de trabajo con una tarea.

```
/mcp__codeagentswarm__start_coding_session "Refactorizar API" "Mejorar estructura y añadir tests"
```

#### `/mcp__codeagentswarm__task_summary`
Obtiene un resumen del estado actual de las tareas.

```
/mcp__codeagentswarm__task_summary
```

### Recursos (@ mentions)

Puedes referenciar las tareas usando @ mentions:

```
@codeagentswarm:task://all           # Todas las tareas
@codeagentswarm:task://pending       # Tareas pendientes
@codeagentswarm:task://in_progress   # Tareas en progreso
@codeagentswarm:task://completed     # Tareas completadas
```

**Ejemplo de uso:**
```
Analiza @codeagentswarm:task://in_progress y sugiere qué hacer después
```

## 🔄 Flujo de Trabajo Recomendado

### 1. Inicio de Sesión de Trabajo
```
/mcp__codeagentswarm__start_coding_session "Nueva funcionalidad" "Implementar sistema de notificaciones"
```

### 2. Durante el Desarrollo
```javascript
// Crear subtareas según sea necesario
create_task("Diseñar API endpoints", "Definir rutas y schemas", 0)
create_task("Implementar tests", "Unit tests para nuevas funciones", 1)

// Marcar tareas como iniciadas
start_task(2)
```

### 3. Al Completar Tareas
```javascript
// Marcar como completada
complete_task(2)

// Ver progreso general
/mcp__codeagentswarm__task_summary
```

### 4. Revisar Estado
```
Muéstrame el estado de @codeagentswarm:task://all y recomienda próximos pasos
```

## 🎯 Integración con CodeAgentSwarm

### Sincronización de Datos
- Las tareas creadas vía MCP aparecen automáticamente en el Kanban de CodeAgentSwarm
- Los cambios de estado se reflejan en tiempo real en la interfaz
- Los indicadores de tarea actual se actualizan en los headers de los terminales

### Estados de Tareas
- **pending**: Tarea creada pero no iniciada
- **in_progress**: Tarea actualmente en desarrollo
- **completed**: Tarea finalizada

### Asociación con Terminales
- Las tareas pueden asociarse a terminales específicos (0-3)
- Los terminales muestran la tarea actual en su header
- Útil para organizar trabajo por contexto/proyecto

## 🔍 Resolución de Problemas

### Error: "Database not initialized"
```bash
# Asegúrate de que la aplicación CodeAgentSwarm esté ejecutándose
# O que el archivo de base de datos exista en ~/.codeagentswarm/
```

### Error: "MCP server not found"
```bash
# Reinstalar el servidor MCP
./uninstall-mcp.sh
./install-mcp.sh
```

### Error: "Node.js not found"
```bash
# Verificar que Node.js esté instalado y en el PATH
node --version
```

### Logs del Servidor MCP
El servidor MCP escribe logs a stderr, que puedes ver si ejecutas Claude Code desde terminal:

```bash
claude 2>&1 | grep "MCP Server"
```

## 🗑️ Desinstalación

```bash
# Desinstalar el servidor MCP
./uninstall-mcp.sh

# O manualmente:
claude mcp remove codeagentswarm
```

## 📝 Ejemplos Prácticos

### Ejemplo 1: Gestión de Bug Fix

```javascript
// 1. Crear tarea para el bug
create_task("Fix: Login no funciona", "El formulario de login no valida correctamente", 0)

// 2. Iniciar trabajo
start_task(1)

// 3. Crear subtareas
create_task("Investigar validación", "Revisar lógica de validación en frontend", 0)
create_task("Fix backend", "Corregir validación en API", 1)
create_task("Añadir tests", "Tests para evitar regresión", 2)

// 4. Ir completando
complete_task(2)  // Investigación completada
start_task(3)     // Empezar fix backend
```

### Ejemplo 2: Sprint Planning

```
/mcp__codeagentswarm__task_summary

Basado en @codeagentswarm:task://pending, ayúdame a priorizar las tareas para esta semana
```

### Ejemplo 3: Code Review

```
Revisa @codeagentswarm:task://completed de esta semana y genera un resumen para el equipo
```

## 🆘 Soporte

Si encuentras problemas:

1. Verifica que CodeAgentSwarm esté ejecutándose
2. Comprueba que Claude Code tenga la versión más reciente
3. Revisa los logs del servidor MCP
4. Reinstala el servidor MCP si es necesario

## 🔄 Actualizaciones

Para actualizar el servidor MCP:

```bash
# Desinstalar versión actual
./uninstall-mcp.sh

# Actualizar CodeAgentSwarm (git pull, etc.)

# Reinstalar
./install-mcp.sh
```
# Development Rules - CodeAgentSwarm

## ⚠️ REGLA CRÍTICA: Actualización de CLAUDE.md

**SIEMPRE que modifiques el archivo CLAUDE.md, DEBES también actualizar la función que genera este archivo automáticamente.**

### Por qué es importante:
- El archivo CLAUDE.md se genera automáticamente por la función `ensureClaudeMdConfiguration()` en `main.js`
- Si solo modificas CLAUDE.md manualmente, los cambios se perderán la próxima vez que se ejecute la función
- Esto causa inconsistencias y pérdida de configuraciones importantes

### Proceso obligatorio:

1. **Modifica CLAUDE.md** con los cambios necesarios
2. **Actualiza la función generadora** en `main.js`:
   - Archivo: `/main.js`
   - Función: `ensureClaudeMdConfiguration(projectPath)` (líneas ~1507-1699)
   - Ubicación del contenido: Variable `claudeMdContent` (línea ~1514)
3. **Verifica ambos cambios** antes de hacer commit

### Ejemplo de cambios sincronizados:

```javascript
// En main.js - función ensureClaudeMdConfiguration()
const claudeMdContent = `# ${projectName} Project Configuration
...
- **\`submit_for_testing\`**: Marcar tarea como "in_testing"
- **\`complete_task\`**: Marcar tarea como "completed"
...`;
```

```markdown
<!-- En CLAUDE.md -->
- **`submit_for_testing`**: Marcar tarea como "in_testing"
- **`complete_task`**: Marcar tarea como "completed"
```

### Cuándo se ejecuta la función generadora:
- Automáticamente cuando un usuario selecciona un directorio para trabajar con Claude Code
- Se ejecuta en `ipcMain.handle('select-directory')` (línea ~568 en main.js)

### ❌ Lo que NO debes hacer:
- Modificar solo CLAUDE.md sin actualizar la función
- Modificar solo la función sin verificar CLAUDE.md
- Asumir que un cambio se aplicará automáticamente

### ✅ Lo que SÍ debes hacer:
- Siempre modificar ambos archivos
- Probar que la generación automática funciona correctamente
- Documentar los cambios en ambos lugares

---

## Otras reglas de desarrollo

### Gestión de Base de Datos
- Evaluar si los cambios afectan a `database.js`, `database-mcp.js` o ambos según el contexto
- Crear métodos de migración cuando sea necesario
- Verificar compatibilidad entre implementaciones si ambas se modifican

### Interfaz de Usuario
- Actualizar tanto el HTML como el JavaScript para nuevas funcionalidades
- Mantener consistencia en iconos y estilos
- Probar drag & drop después de cambios en columnas

### MCP Server
- Actualizar herramientas, recursos y validaciones en `mcp-stdio-server.js`
- Mantener sincronizados los estados válidos entre front y back
- Probar todas las herramientas MCP después de cambios
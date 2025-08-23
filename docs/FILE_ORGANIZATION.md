# 📁 Organización de Archivos - CodeAgentSwarm

## ✅ Refactorización Completada

Se han movido los archivos de la raíz a una estructura organizada, manteniendo compatibilidad mediante archivos proxy.

## 📊 Estructura Nueva

```
src/
├── core/                           # Lógica de negocio
│   ├── domain/entities/            # Entidades del dominio
│   ├── application/                # Casos de uso
│   │   ├── use-cases/
│   │   └── ports/
│   └── shared/
│
├── infrastructure/                 # Implementaciones
│   ├── database/                   # Base de datos
│   │   └── database.js
│   ├── services/                   # Servicios
│   │   ├── git-service.js
│   │   └── webhook-server.js
│   ├── mcp/                        # Model Context Protocol
│   │   ├── mcp-client.js
│   │   ├── mcp-server.js
│   │   ├── mcp-stdio-server.js
│   │   └── ...
│   ├── hooks/                      # Hooks system
│   │   ├── hooks-manager.js
│   │   └── debug-hooks.js
│   ├── config/                     # Configuración
│   │   ├── claude-md-config.js
│   │   └── DIContainer.js
│   └── repositories/               # Repositorios
│
├── presentation/                   # Interfaz de usuario
│   ├── electron/                   # Main process
│   │   └── main.js
│   ├── renderer/                   # Renderer process
│   │   ├── renderer.js
│   │   └── kanban.js (copiado)
│   ├── pages/                      # Páginas HTML
│   │   ├── kanban.js
│   │   ├── index.html
│   │   └── kanban.html
│   ├── components/                 # Componentes
│   │   ├── log-viewer.js
│   │   └── markdown-editor.js
│   ├── windows/                    # Ventanas
│   │   └── wizard-window.js
│   ├── styles/                     # CSS
│   │   ├── styles.css
│   │   ├── kanban.css
│   │   └── ...
│   └── assets/                     # Recursos
│
└── shared/                         # Utilidades compartidas
    ├── logger/
    │   ├── logger.js
    │   └── child-process-logger.js
    ├── parsers/
    │   └── diff-parser.js
    └── utils/
        ├── feature-highlight.js
        ├── performance-monitor.js
        └── settings-optimizer.js
```

## 🔄 Archivos Proxy

Los siguientes archivos en la raíz son ahora **proxies** que redirigen a las nuevas ubicaciones:

- `database.js` → `src/infrastructure/database/database.js`
- `git-service.js` → `src/infrastructure/services/git-service.js`
- `logger.js` → `src/shared/logger/logger.js`
- `child-process-logger.js` → `src/shared/logger/child-process-logger.js`
- `diff-parser.js` → `src/shared/parsers/diff-parser.js`
- `mcp-*.js` → `src/infrastructure/mcp/mcp-*.js`
- `hooks-manager.js` → `src/infrastructure/hooks/hooks-manager.js`
- `claude-md-*.js` → `src/infrastructure/config/claude-md-*.js`
- Y más...

## 🚀 Próximos Pasos

1. **Gradualmente actualizar imports**: Cambiar las referencias de los archivos proxy a las rutas directas
2. **Eliminar proxies**: Una vez actualizados todos los imports, eliminar los archivos proxy
3. **Mover main.js**: Considerar mover main.js pero requiere actualizar package.json
4. **Limpiar raíz**: Mover archivos restantes como `.db`, `.sh`, `.py` a carpetas apropiadas

## ✅ Tests

**Todos los tests pasan**: 914 tests, 53 suites

## 📝 Notas

- Los archivos proxy mantienen compatibilidad total
- No se rompió ninguna funcionalidad
- La estructura es más mantenible y escalable
- Sigue los principios de Clean Architecture
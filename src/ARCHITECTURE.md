# 🏗️ CodeAgentSwarm - Arquitectura Hexagonal

## 📁 Estructura de Carpetas

```
src/
├── core/                    # Núcleo de negocio (independiente de frameworks)
│   ├── domain/             # Capa de Dominio
│   │   ├── entities/       # Entidades del dominio
│   │   ├── value-objects/  # Objetos de valor
│   │   └── services/       # Servicios de dominio
│   │
│   ├── application/        # Capa de Aplicación
│   │   ├── use-cases/      # Casos de uso
│   │   ├── dto/            # Data Transfer Objects
│   │   └── ports/          # Puertos (interfaces)
│   │
│   └── shared/             # Código compartido del core
│
├── infrastructure/         # Capa de Infraestructura
│   ├── adapters/          # Adaptadores (implementación de puertos)
│   ├── repositories/      # Implementación de repositorios
│   ├── services/          # Servicios externos
│   └── config/            # Configuración de infraestructura
│
├── presentation/          # Capa de Presentación
│   ├── electron/         # Main process de Electron
│   ├── renderer/         # Renderer process
│   ├── components/       # Componentes UI
│   ├── styles/           # Estilos CSS
│   └── assets/           # Recursos estáticos
│
└── shared/               # Utilidades compartidas
    ├── utils/           # Funciones de utilidad
    ├── constants/       # Constantes globales
    └── types/           # Tipos TypeScript/JSDoc
```

## 🎯 Principios de la Arquitectura

### 1. **Separación de Responsabilidades**
- **Core/Domain**: Lógica de negocio pura, sin dependencias externas
- **Application**: Orquestación de casos de uso
- **Infrastructure**: Implementaciones concretas y adaptadores
- **Presentation**: Interfaz de usuario y manejo de eventos

### 2. **Inversión de Dependencias**
- Las capas internas no dependen de las externas
- Se usan interfaces (ports) para la comunicación
- Los adaptadores implementan los puertos

### 3. **Flujo de Datos**
```
Presentation → Application (Use Case) → Domain → Infrastructure
                    ↑                               ↓
                    └──────── Ports & Adapters ────┘
```

## 📦 Módulos Principales

### Core Domain
- **Task**: Gestión de tareas
- **Project**: Gestión de proyectos
- **Terminal**: Gestión de terminales
- **MCP**: Model Context Protocol
- **Git**: Operaciones Git

### Application Use Cases
- `CreateTaskUseCase`
- `UpdateTaskStatusUseCase`
- `GenerateCommitMessageUseCase`
- `ManageMCPServersUseCase`

### Infrastructure Adapters
- `SQLiteTaskRepository`
- `GitServiceAdapter`
- `MCPClientAdapter`
- `ElectronStorageAdapter`

## 🧪 Testing Strategy

```
tests/
├── unit/           # Tests de unidades individuales
├── integration/    # Tests de integración entre módulos
├── e2e/           # Tests end-to-end
└── fixtures/      # Datos de prueba
```

## 🚀 Beneficios

1. **Mantenibilidad**: Código organizado y fácil de localizar
2. **Escalabilidad**: Fácil agregar nuevas funcionalidades
3. **Testabilidad**: Cada capa se puede testear independientemente
4. **Flexibilidad**: Cambiar implementaciones sin afectar el core
5. **Claridad**: Separación clara de responsabilidades
# 🏗️ CodeAgentSwarm - Nueva Arquitectura

## 📚 Introducción

CodeAgentSwarm ahora utiliza una **Arquitectura Hexagonal (Clean Architecture)** que separa claramente las responsabilidades y hace el código más mantenible, testeable y escalable.

## 🎯 Principios Clave

1. **Inversión de Dependencias**: El dominio no depende de la infraestructura
2. **Separación de Responsabilidades**: Cada capa tiene una responsabilidad clara
3. **Testabilidad**: Cada componente se puede testear de forma aislada
4. **Flexibilidad**: Fácil cambiar implementaciones sin afectar el core

## 📁 Estructura de Carpetas

```
src/
├── core/                   # Lógica de negocio pura
│   ├── domain/            # Entidades y reglas de negocio
│   ├── application/       # Casos de uso y puertos
│   └── shared/            # Código compartido del core
│
├── infrastructure/        # Implementaciones concretas
│   ├── adapters/         # Adaptadores externos
│   ├── repositories/     # Acceso a datos
│   └── services/         # Servicios externos
│
├── presentation/         # Interfaz de usuario
│   ├── electron/        # Main process
│   ├── renderer/        # Renderer process
│   └── components/      # Componentes UI
│
└── shared/              # Utilidades globales
```

## 🔄 Flujo de Trabajo

### Crear una nueva funcionalidad:

1. **Definir la entidad** en `core/domain/entities/`
2. **Crear el caso de uso** en `core/application/use-cases/`
3. **Definir el puerto** en `core/application/ports/`
4. **Implementar el adaptador** en `infrastructure/adapters/`
5. **Conectar con la UI** en `presentation/`

### Ejemplo: Agregar nueva funcionalidad de Task

```javascript
// 1. Entidad (core/domain/entities/Task.js)
class Task {
  constructor(data) {
    this.id = data.id;
    this.title = data.title;
    // ... business logic
  }
}

// 2. Puerto (core/application/ports/TaskRepository.js)
class TaskRepository {
  async save(task) { throw new Error('Not implemented'); }
  async findById(id) { throw new Error('Not implemented'); }
}

// 3. Caso de uso (core/application/use-cases/CreateTaskUseCase.js)
class CreateTaskUseCase {
  constructor(taskRepository) {
    this.taskRepository = taskRepository;
  }
  
  async execute(data) {
    const task = new Task(data);
    return await this.taskRepository.save(task);
  }
}

// 4. Implementación (infrastructure/repositories/SQLiteTaskRepository.js)
class SQLiteTaskRepository extends TaskRepository {
  async save(task) {
    // Implementación real con SQLite
  }
}

// 5. Inyección de dependencias (infrastructure/config/DIContainer.js)
container.register('taskRepository', () => new SQLiteTaskRepository());
container.register('createTaskUseCase', (c) => 
  new CreateTaskUseCase(c.get('taskRepository'))
);
```

## 🧪 Testing

### Estructura de Tests

```
tests/
├── unit/          # Tests unitarios (sin dependencias)
├── integration/   # Tests de integración
├── e2e/          # Tests end-to-end
└── fixtures/     # Datos de prueba
```

### Ejecutar Tests

```bash
# Tests unitarios
npm run test:unit

# Tests de integración
npm run test:integration

# Tests e2e
npm run test:e2e

# Coverage
npm run test:coverage
```

### Escribir Tests

```javascript
// tests/unit/core/domain/Task.test.js
describe('Task Entity', () => {
  it('should create a valid task', () => {
    const task = new Task({
      title: 'Test Task'
    });
    expect(task.title).toBe('Test Task');
  });
});

// tests/unit/core/application/CreateTaskUseCase.test.js
describe('CreateTaskUseCase', () => {
  it('should create a task', async () => {
    const mockRepo = {
      save: jest.fn().mockResolvedValue({ id: 1 })
    };
    
    const useCase = new CreateTaskUseCase(mockRepo);
    const result = await useCase.execute({ title: 'Test' });
    
    expect(mockRepo.save).toHaveBeenCalled();
    expect(result.id).toBe(1);
  });
});
```

## 🔌 Inyección de Dependencias

Usamos un contenedor DI para gestionar las dependencias:

```javascript
// Obtener el contenedor
const { getContainer } = require('./infrastructure/config/DIContainer');
const container = getContainer();

// Usar un servicio
const createTaskUseCase = container.get('createTaskUseCase');
const result = await createTaskUseCase.execute({ title: 'Nueva tarea' });
```

## 📝 Mejores Prácticas

1. **No mezclar capas**: Mantén la separación estricta
2. **Usar interfaces**: Define contratos claros con puertos
3. **Inyectar dependencias**: No uses `require` directo en casos de uso
4. **Tests primero**: Escribe tests antes de implementar
5. **Nombres descriptivos**: Usa nombres que expresen la intención

## 🚀 Migración Gradual

Para migrar código existente:

1. Ejecuta el script de migración:
   ```bash
   node scripts/migrate-to-hexagonal.js
   ```

2. Revisa y ajusta los imports manualmente si es necesario

3. Actualiza los tests para la nueva estructura

## 📚 Recursos

- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/)
- [Domain-Driven Design](https://martinfowler.com/bliki/DomainDrivenDesign.html)

## ❓ FAQ

**¿Por qué esta arquitectura?**
- Facilita el mantenimiento y testing
- Permite cambiar tecnologías sin afectar el core
- Mejora la organización del código

**¿Cómo agrego una nueva feature?**
- Empieza por el dominio (entidades)
- Define el caso de uso
- Implementa los adaptadores necesarios
- Conecta con la UI

**¿Dónde va mi código?**
- Lógica de negocio → `core/domain`
- Orquestación → `core/application`
- Acceso a BD/APIs → `infrastructure`
- UI/Electron → `presentation`
/**
 * Tests for database.js
 */

const Database = require('../database');
const fs = require('fs');
const path = require('path');

// Mock better-sqlite3
jest.mock('better-sqlite3', () => {
    return jest.fn(() => ({
        prepare: jest.fn(() => ({
            run: jest.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
            get: jest.fn(() => ({ id: 1, title: 'Test Task' })),
            all: jest.fn(() => [])
        })),
        exec: jest.fn(),
        pragma: jest.fn(),
        close: jest.fn(),
        transaction: jest.fn(fn => fn)
    }));
});

// Mock fs
jest.mock('fs', () => ({
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn()
}));

describe('Database', () => {
    let db;

    beforeEach(() => {
        jest.clearAllMocks();
        // Mock process.platform
        Object.defineProperty(process, 'platform', {
            value: 'darwin',
            writable: true
        });
    });

    afterEach(() => {
        if (db && db.db && db.db.close) {
            db.db.close();
        }
    });

    describe('constructor', () => {
        test('should create database instance', () => {
            db = new Database();
            expect(db).toBeDefined();
            expect(db.db).toBeDefined();
        });

        test('should initialize database tables', () => {
            db = new Database();
            expect(db.db.exec).toHaveBeenCalled();
        });
    });

    describe('task operations', () => {
        beforeEach(() => {
            db = new Database();
        });

        test('should create task', () => {
            const result = db.createTask('Test Task', 'Test Description', 1, 'TestProject');
            expect(result.success).toBe(true);
            expect(result.taskId).toBe(1);
            expect(db.db.prepare).toHaveBeenCalled();
        });

        test('should update task status', () => {
            const result = db.updateTaskStatus(1, 'completed');
            expect(result.success).toBe(true);
            expect(db.db.prepare).toHaveBeenCalled();
        });

        test('should get all tasks', () => {
            const mockTasks = [
                { id: 1, title: 'Task 1', status: 'pending' },
                { id: 2, title: 'Task 2', status: 'completed' }
            ];
            db.db.prepare = jest.fn(() => ({
                all: jest.fn(() => mockTasks)
            }));

            const tasks = db.getAllTasks();
            expect(tasks).toEqual(mockTasks);
        });

        test('should get tasks by status', () => {
            const mockTasks = [{ id: 1, title: 'Task 1', status: 'pending' }];
            db.db.prepare = jest.fn(() => ({
                all: jest.fn(() => mockTasks)
            }));

            const tasks = db.getTasksByStatus('pending');
            expect(tasks).toEqual(mockTasks);
        });

        test('should get current task', () => {
            const mockTask = { id: 1, title: 'Current Task' };
            db.db.prepare = jest.fn(() => ({
                get: jest.fn(() => mockTask)
            }));

            const task = db.getCurrentTask(1);
            expect(task).toEqual(mockTask);
        });

        test('should update task plan', () => {
            const result = db.updateTaskPlan(1, 'New plan');
            expect(result.success).toBe(true);
        });

        test('should update task implementation', () => {
            const result = db.updateTaskImplementation(1, 'Implementation details');
            expect(result.success).toBe(true);
        });

        test('should delete task', () => {
            const result = db.deleteTask(1);
            expect(result.success).toBe(true);
        });

        test('should update task terminal', () => {
            const result = db.updateTaskTerminal(1, '2');
            expect(result.success).toBe(true);
        });
    });

    describe('terminal operations', () => {
        beforeEach(() => {
            db = new Database();
        });

        test('should save terminal directory', () => {
            const result = db.saveTerminalDirectory(1, '/test/path');
            expect(result.success).toBe(true);
        });

        test('should get terminal directory', () => {
            const mockDir = '/test/path';
            db.db.prepare = jest.fn(() => ({
                get: jest.fn(() => ({ directory: mockDir }))
            }));

            const dir = db.getTerminalDirectory(1);
            expect(dir).toBe(mockDir);
        });

        test('should get all terminal directories', () => {
            const mockDirs = [
                { terminal_id: 1, directory: '/path1' },
                { terminal_id: 2, directory: '/path2' }
            ];
            db.db.prepare = jest.fn(() => ({
                all: jest.fn(() => mockDirs)
            }));

            const dirs = db.getAllTerminalDirectories();
            expect(dirs).toEqual({
                1: '/path1',
                2: '/path2'
            });
        });

        test('should delete terminal directory', () => {
            const result = db.deleteTerminalDirectory(1);
            expect(result.success).toBe(true);
        });
    });

    describe('settings operations', () => {
        beforeEach(() => {
            db = new Database();
        });

        test('should save setting', () => {
            const result = db.saveSetting('key', 'value');
            expect(result.success).toBe(true);
        });

        test('should get setting', () => {
            const mockSetting = { value: '"test value"' };
            db.db.prepare = jest.fn(() => ({
                get: jest.fn(() => mockSetting)
            }));

            const value = db.getSetting('key');
            expect(value).toBe('test value');
        });

        test('should set setting', () => {
            const result = db.setSetting('key', 'new value');
            expect(result).toBe(true);
        });

        test('should get user shell', () => {
            db.db.prepare = jest.fn(() => ({
                get: jest.fn(() => null)
            }));

            const shell = db.getUserShell();
            expect(shell).toBe(process.env.SHELL || '/bin/zsh');
        });
    });

    describe('project operations', () => {
        beforeEach(() => {
            db = new Database();
        });

        test('should create project', () => {
            const result = db.createProject('TestProject', '/test/path', '#FF0000');
            expect(result.success).toBe(true);
            // When creating new project, 'name' is returned. When already exists, it's not.
            if (result.name) {
                expect(result.name).toBe('TestProject');
            } else if (result.alreadyExists) {
                expect(result.alreadyExists).toBe(true);
            }
        });

        test('should get all projects', () => {
            const mockProjects = [
                { name: 'Project1', color: '#FF0000' },
                { name: 'Project2', color: '#00FF00' }
            ];
            db.db.prepare = jest.fn(() => ({
                all: jest.fn(() => mockProjects)
            }));

            const projects = db.getProjects();
            expect(projects).toEqual(mockProjects);
        });

        test('should get tasks by project', () => {
            const mockTasks = [
                { id: 1, title: 'Task 1', project: 'TestProject' }
            ];
            db.db.prepare = jest.fn(() => ({
                all: jest.fn(() => mockTasks)
            }));

            const tasks = db.getTasksByProject('TestProject');
            expect(tasks).toEqual(mockTasks);
        });
    });

    describe('subtask operations', () => {
        beforeEach(() => {
            db = new Database();
        });

        test('should create subtask', () => {
            const result = db.createTask('Subtask', 'Description', null, null, 1);
            expect(result.success).toBe(true);
            expect(result.taskId).toBe(1);
        });

        test('should get subtasks', () => {
            const mockSubtasks = [
                { id: 2, title: 'Subtask 1', parent_task_id: 1 }
            ];
            db.db.prepare = jest.fn(() => ({
                all: jest.fn(() => mockSubtasks)
            }));

            const result = db.getSubtasks(1);
            expect(result).toEqual(mockSubtasks);
        });

        test('should link task to parent', () => {
            const result = db.linkTaskToParent(2, 1);
            expect(result.success).toBe(true);
        });

        test('should unlink task from parent', () => {
            const result = db.unlinkTaskFromParent(2);
            expect(result.success).toBe(true);
        });

        test('should get task hierarchy', () => {
            const mockTask = { id: 1, title: 'Parent' };
            const mockSubtasks = [{ id: 2, title: 'Child' }];
            
            db.db.prepare = jest.fn(() => ({
                get: jest.fn(() => mockTask)
            }));
            
            db.getSubtasks = jest.fn((parentId) => {
                if (parentId === 1) return mockSubtasks;
                return [];
            });

            const result = db.getTaskHierarchy(1);
            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(result.title).toBe('Parent');
            expect(result.subtasks).toBeDefined();
        });
    });

    describe('additional coverage tests', () => {
        beforeEach(() => {
            // Reset mocks between tests
            jest.clearAllMocks();
            db = new Database();
        });
        
        it('should handle getTasksByStatus', () => {
            const mockTasks = [
                { id: 1, status: 'in_progress' },
                { id: 2, status: 'in_progress' }
            ];
            
            db.db.prepare = jest.fn(() => ({
                all: jest.fn(() => mockTasks)
            }));
            
            const result = db.getTasksByStatus('in_progress');
            expect(result).toEqual(mockTasks);
            expect(db.db.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE status = ?'));
        });
        
        it('should handle getCurrentTask', () => {
            const mockTask = { id: 1, terminal_id: 1, status: 'in_progress' };
            
            db.db.prepare = jest.fn(() => ({
                get: jest.fn(() => mockTask)
            }));
            
            const result = db.getCurrentTask(1);
            expect(result).toEqual(mockTask);
        });
        
        it('should handle updateTask', () => {
            const mockRun = jest.fn();
            db.db.prepare = jest.fn(() => ({
                run: mockRun
            }));
            
            db.updateTask(1, 'New Title', 'New Description');
            expect(mockRun).toHaveBeenCalledWith('New Title', 'New Description', 1);
        });
        
        it('should handle updateTaskTerminal', () => {
            const mockRun = jest.fn();
            db.db.prepare = jest.fn(() => ({
                run: mockRun
            }));
            
            db.updateTaskTerminal(1, 2);
            expect(mockRun).toHaveBeenCalledWith(2, 1);
        });
        
        it('should handle updateTaskPlan', () => {
            const mockRun = jest.fn();
            db.db.prepare = jest.fn(() => ({
                run: mockRun
            }));
            
            db.updateTaskPlan(1, 'Task plan');
            expect(mockRun).toHaveBeenCalledWith('Task plan', 1);
        });
        
        it('should handle updateTaskImplementation', () => {
            const mockRun = jest.fn();
            db.db.prepare = jest.fn(() => ({
                run: mockRun
            }));
            
            db.updateTaskImplementation(1, 'Implementation details');
            expect(mockRun).toHaveBeenCalledWith('Implementation details', 1);
        });
        
        it('should handle deleteTask', () => {
            const mockRun = jest.fn();
            db.db.prepare = jest.fn(() => ({
                run: mockRun
            }));
            
            db.deleteTask(1);
            expect(mockRun).toHaveBeenCalledWith(1);
        });
        
        it('should handle updateTasksOrder', () => {
            const mockRun = jest.fn();
            db.db.prepare = jest.fn(() => ({
                run: mockRun
            }));
            
            const orders = [
                { id: 1, sort_order: 0 },
                { id: 2, sort_order: 1 }
            ];
            
            db.updateTasksOrder(orders);
            expect(mockRun).toHaveBeenCalledTimes(2);
        });
        
        it('should handle updateTaskProject', () => {
            const mockRun = jest.fn();
            db.db.prepare = jest.fn(() => ({
                run: mockRun
            }));
            
            db.updateTaskProject(1, 'ProjectName');
            expect(mockRun).toHaveBeenCalledWith('ProjectName', 1);
        });
        
        it('should handle getSubtasks', () => {
            const mockSubtasks = [{ id: 2, parent_task_id: 1 }];
            
            db.db.prepare = jest.fn(() => ({
                all: jest.fn(() => mockSubtasks)
            }));
            
            const result = db.getSubtasks(1);
            expect(result).toEqual(mockSubtasks);
        });
        
        it('should handle linkTaskToParent', () => {
            const mockRun = jest.fn();
            let callCount = 0;
            db.db.prepare = jest.fn(() => {
                callCount++;
                if (callCount === 1) {
                    // First call: check if parent exists
                    return {
                        get: jest.fn(() => ({ id: 1 })) // Parent exists
                    };
                } else {
                    // Subsequent calls
                    return {
                        run: mockRun,
                        get: jest.fn(() => null) // No circular dependency
                    };
                }
            });
            
            // Mock wouldCreateCircularDependency to return false
            db.wouldCreateCircularDependency = jest.fn(() => false);
            
            const result = db.linkTaskToParent(2, 1);
            expect(result.success).toBe(true);
        });
        
        it('should handle unlinkTaskFromParent', () => {
            const mockRun = jest.fn();
            db.db.prepare = jest.fn(() => ({
                run: mockRun
            }));
            
            db.unlinkTaskFromParent(1);
            expect(mockRun).toHaveBeenCalledWith(1);
        });
        
        it('should handle wouldCreateCircularDependency', () => {
            // Mock a chain: task3 -> task2 -> task1
            db.db.prepare = jest.fn(() => ({
                get: jest.fn((id) => {
                    if (id === 3) return { id: 3, parent_task_id: 2 };
                    if (id === 2) return { id: 2, parent_task_id: 1 };
                    if (id === 1) return { id: 1, parent_task_id: null };
                    return null;
                })
            }));
            
            // Trying to make task1 a child of task3 would create a circle
            const result = db.wouldCreateCircularDependency(1, 3);
            expect(result).toBe(true);
        });
        
        it('should handle getTaskWithParent', () => {
            const mockTask = {
                id: 2,
                parent_task_id: 1,
                parent_title: 'Parent Task'
            };
            
            db.db.prepare = jest.fn(() => ({
                get: jest.fn(() => mockTask)
            }));
            
            const result = db.getTaskWithParent(2);
            expect(result).toEqual(mockTask);
        });
        
        it('should handle project operations', () => {
            // getProjectByName
            const mockProject = { name: 'TestProject', path: '/test' };
            db.db.prepare = jest.fn(() => ({
                get: jest.fn(() => mockProject),
                run: jest.fn(),
                all: jest.fn(() => [mockProject])
            }));
            
            let result = db.getProjectByName('TestProject');
            expect(result).toEqual(mockProject);
            
            // getProjectByPath
            result = db.getProjectByPath('/test');
            expect(result).toEqual(mockProject);
            
            // updateProjectPath
            db.updateProjectPath('TestProject', '/new/path');
            expect(db.db.prepare).toHaveBeenCalled();
            
            // updateProjectDisplayName
            db.updateProjectDisplayName('TestProject', 'Test Project');
            expect(db.db.prepare).toHaveBeenCalled();
            
            // updateProjectColor
            db.updateProjectColor('TestProject', '#FF0000');
            expect(db.db.prepare).toHaveBeenCalled();
            
            // getTasksByProject
            const tasks = db.getTasksByProject('TestProject');
            expect(Array.isArray(tasks)).toBe(true);
            
            // updateProjectLastOpened
            db.updateProjectLastOpened('/test');
            expect(db.db.prepare).toHaveBeenCalled();
            
            // deleteProject
            db.deleteProject('TestProject');
            expect(db.db.prepare).toHaveBeenCalled();
        });
        
        it('should handle terminal directory operations', () => {
            const mockRun = jest.fn();
            const mockGet = jest.fn(() => ({ directory: '/test/dir' }));
            const mockAll = jest.fn(() => [
                { terminal_id: 1, directory: '/dir1' },
                { terminal_id: 2, directory: '/dir2' }
            ]);
            
            db.db.prepare = jest.fn(() => ({
                run: mockRun,
                get: mockGet,
                all: mockAll
            }));
            
            // saveTerminalDirectory
            db.saveTerminalDirectory(1, '/test/dir');
            expect(mockRun).toHaveBeenCalled();
            
            // getTerminalDirectory
            const dir = db.getTerminalDirectory(1);
            expect(dir).toBe('/test/dir');
            
            // getAllTerminalDirectories
            const allDirs = db.getAllTerminalDirectories();
            expect(Object.keys(allDirs)).toHaveLength(2);
            expect(allDirs['1']).toBe('/dir1');
            expect(allDirs['2']).toBe('/dir2');
            
            // deleteTerminalDirectory
            db.deleteTerminalDirectory(1);
            expect(mockRun).toHaveBeenCalled();
        });
        
        it('should handle getUserShell', () => {
            db.db.prepare = jest.fn(() => ({
                get: jest.fn(() => ({ value: '/bin/zsh' }))
            }));
            
            const shell = db.getUserShell();
            expect(shell).toBe('/bin/zsh');
        });
        
        it('should handle close', () => {
            const mockClose = jest.fn();
            db.db.close = mockClose;
            
            db.close();
            expect(mockClose).toHaveBeenCalled();
        });
    });

});
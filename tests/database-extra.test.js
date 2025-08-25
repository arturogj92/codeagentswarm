// Extra tests for database
const Database = require('../src/infrastructure/database/database');
const sqlite3 = require('better-sqlite3');
const fs = require('fs');
const os = require('os');

jest.mock('better-sqlite3');
jest.mock('fs');
jest.mock('os');

describe('Database Extra Tests', () => {
    let db;
    let mockDb;
    let mockRun;
    let mockPrepare;
    
    beforeEach(() => {
        jest.clearAllMocks();
        
        mockRun = jest.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 });
        const mockAll = jest.fn().mockReturnValue([]);
        const mockGet = jest.fn().mockReturnValue(null);
        
        mockPrepare = jest.fn().mockReturnValue({
            run: mockRun,
            all: mockAll,
            get: mockGet
        });
        
        mockDb = {
            prepare: mockPrepare,
            exec: jest.fn(),
            close: jest.fn(),
            pragma: jest.fn()
        };
        
        sqlite3.mockReturnValue(mockDb);
        os.homedir.mockReturnValue('/home/user');
        fs.existsSync.mockReturnValue(true);
        fs.mkdirSync.mockImplementation(() => {});
        
        db = new Database();
    });
    
    test('should create a task', () => {
        const result = db.createTask('Test Task', 'Test Description');
        expect(result.success).toBe(true);
        expect(result.taskId).toBe(1);
        expect(mockPrepare).toHaveBeenCalled();
    });
    
    test('should update task status', () => {
        mockRun.mockReturnValue({ changes: 1 });
        const result = db.updateTaskStatus(1, 'in_progress');
        expect(result.success).toBe(true);
        expect(mockPrepare).toHaveBeenCalled();
    });
    
    test('should get all tasks', () => {
        const mockAll = jest.fn().mockReturnValue([
            { id: 1, title: 'Task 1' },
            { id: 2, title: 'Task 2' }
        ]);
        mockPrepare.mockReturnValue({ all: mockAll });
        
        const tasks = db.getAllTasks();
        expect(tasks).toHaveLength(2);
        expect(tasks[0].title).toBe('Task 1');
    });
});
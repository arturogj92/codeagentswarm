/**
 * Tests for logger.js
 */

// Mock fs and path before requiring logger
jest.mock('fs', () => ({
    existsSync: jest.fn(() => false),
    readFileSync: jest.fn(() => '{}')
}));

jest.mock('path', () => ({
    join: jest.fn((...args) => args.join('/'))
}));

describe('Logger', () => {
    let logger;
    const originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info,
        debug: console.debug
    };

    beforeEach(() => {
        // Clear module cache to get fresh instance
        jest.resetModules();
        jest.clearAllMocks();
        
        // Mock console methods
        console.log = jest.fn();
        console.error = jest.fn();
        console.warn = jest.fn();
        console.info = jest.fn();
        console.debug = jest.fn();
        
        // Mock process.send to simulate main process
        process.send = undefined;
        
        // Get fresh logger instance
        logger = require('../logger');
        logger.logs = []; // Clear logs
        logger.listeners = []; // Clear listeners
        logger.enable(); // Enable logging for tests
    });

    afterEach(() => {
        // Restore console
        console.log = originalConsole.log;
        console.error = originalConsole.error;
        console.warn = originalConsole.warn;
        console.info = originalConsole.info;
        console.debug = originalConsole.debug;
    });

    describe('logger singleton', () => {
        test('should initialize with default values', () => {
            expect(logger.logs).toBeDefined();
            expect(logger.maxLogs).toBe(1000);
            expect(logger.listeners).toBeDefined();
        });

        test('should enable and disable logging', () => {
            logger.enable();
            expect(logger.isEnabled()).toBe(true);
            
            logger.disable();
            expect(logger.isEnabled()).toBe(false);
        });
    });

    describe('console interception', () => {
        test('should intercept console.log', () => {
            const testMessage = 'Test log message';
            console.log(testMessage);
            
            expect(logger.logs).toHaveLength(1);
            expect(logger.logs[0].level).toBe('log');
            expect(logger.logs[0].message).toBe(testMessage);
        });

        test('should intercept console.error', () => {
            const errorMessage = 'Test error';
            console.error(errorMessage);
            
            expect(logger.logs).toHaveLength(1);
            expect(logger.logs[0].level).toBe('error');
            expect(logger.logs[0].message).toBe(errorMessage);
        });

        test('should intercept console.warn', () => {
            const warnMessage = 'Test warning';
            console.warn(warnMessage);
            
            expect(logger.logs).toHaveLength(1);
            expect(logger.logs[0].level).toBe('warn');
            expect(logger.logs[0].message).toBe(warnMessage);
        });

        test('should intercept console.info', () => {
            const infoMessage = 'Test info';
            console.info(infoMessage);
            
            expect(logger.logs).toHaveLength(1);
            expect(logger.logs[0].level).toBe('info');
            expect(logger.logs[0].message).toBe(infoMessage);
        });

        test('should intercept console.debug', () => {
            const debugMessage = 'Test debug';
            console.debug(debugMessage);
            
            expect(logger.logs).toHaveLength(1);
            expect(logger.logs[0].level).toBe('debug');
            expect(logger.logs[0].message).toBe(debugMessage);
        });

        test('should handle multiple arguments', () => {
            console.log('Message', 'with', 'multiple', 'parts');
            
            expect(logger.logs).toHaveLength(1);
            expect(logger.logs[0].message).toBe('Message with multiple parts');
        });

        test('should handle objects', () => {
            const obj = { key: 'value', nested: { prop: 'test' } };
            console.log(obj);
            
            expect(logger.logs).toHaveLength(1);
            expect(logger.logs[0].message).toContain('"key": "value"');
            expect(logger.logs[0].message).toContain('"prop": "test"');
        });

        test('should not log when disabled', () => {
            logger.disable();
            console.log('This should not be logged');
            
            expect(logger.logs).toHaveLength(0);
        });
    });

    describe('log management', () => {
        test('should respect maxLogs limit', () => {
            logger.maxLogs = 5;
            for (let i = 0; i < 10; i++) {
                console.log(`Message ${i}`);
            }
            expect(logger.logs).toHaveLength(5);
            // Should keep the most recent logs
            expect(logger.logs[4].message).toBe('Message 9');
        });

        test('should clear logs', () => {
            console.log('Test 1');
            console.log('Test 2');
            expect(logger.logs).toHaveLength(2);
            
            logger.clearLogs();
            expect(logger.logs).toHaveLength(0);
        });

        test('should get logs copy', () => {
            console.log('Test 1');
            console.log('Test 2');
            const logs = logger.getLogs();
            
            expect(logs).toHaveLength(2);
            // Should be a copy, not the original array
            expect(logs).not.toBe(logger.logs);
        });

        test('should include timestamp', () => {
            console.log('Test');
            expect(logger.logs[0]).toHaveProperty('timestamp');
            expect(typeof logger.logs[0].timestamp).toBe('string');
            // Should be ISO format
            expect(logger.logs[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });
    });

    describe('export functionality', () => {
        test('should export logs as text', () => {
            console.log('First message');
            console.error('Error message');
            console.warn('Warning message');
            
            const exported = logger.exportLogs();
            
            expect(exported).toContain('[LOG] First message');
            expect(exported).toContain('[ERROR] Error message');
            expect(exported).toContain('[WARN] Warning message');
            // Should have timestamps
            expect(exported).toMatch(/\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\]/);
        });
    });

    describe('listeners', () => {
        test('should subscribe listener', () => {
            const listener = jest.fn();
            const unsubscribe = logger.subscribe(listener);
            
            expect(logger.listeners).toContain(listener);
            
            // Should return unsubscribe function
            unsubscribe();
            expect(logger.listeners).not.toContain(listener);
        });

        test('should notify listeners on log', () => {
            const listener = jest.fn();
            logger.subscribe(listener);
            
            console.log('Test message');
            
            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'log',
                    message: 'Test message',
                    timestamp: expect.any(String)
                })
            );
        });

        test('should notify listeners on clear', () => {
            const listener = jest.fn();
            logger.subscribe(listener);
            
            logger.clearLogs();
            
            expect(listener).toHaveBeenCalledWith({ type: 'clear' });
        });

        test('should handle multiple listeners', () => {
            const listener1 = jest.fn();
            const listener2 = jest.fn();
            
            logger.subscribe(listener1);
            logger.subscribe(listener2);
            
            console.log('Test');
            
            expect(listener1).toHaveBeenCalled();
            expect(listener2).toHaveBeenCalled();
        });
    });
});
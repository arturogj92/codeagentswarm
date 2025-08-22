/**
 * Tests for child-process-logger.js
 * Testing console interception and event emission functionality
 */

const ChildProcessLogger = require('../child-process-logger');
const EventEmitter = require('events');

describe('ChildProcessLogger', () => {
    let logger;
    
    beforeEach(() => {
        // Clear environment variables
        delete process.env.ENABLE_DEBUG_LOGS;
        delete process.env.NODE_ENV;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('constructor', () => {
        test('should initialize with source name', () => {
            logger = new ChildProcessLogger('TestSource');
            expect(logger.sourceName).toBe('TestSource');
            expect(logger).toBeInstanceOf(EventEmitter);
        });

        test('should be enabled in development mode', () => {
            process.env.NODE_ENV = 'development';
            logger = new ChildProcessLogger('Test');
            expect(logger.enabled).toBe(true);
        });

        test('should be enabled with ENABLE_DEBUG_LOGS', () => {
            process.env.ENABLE_DEBUG_LOGS = 'true';
            logger = new ChildProcessLogger('Test');
            expect(logger.enabled).toBe(true);
        });

        test('should be disabled by default', () => {
            logger = new ChildProcessLogger('Test');
            expect(logger.enabled).toBe(false);
        });
    });

    describe('interceptConsole', () => {
        beforeEach(() => {
            logger = new ChildProcessLogger('Test');
        });

        test('should intercept console methods', () => {
            logger.interceptConsole();
            // originalConsole is set when interceptConsole is called
            expect(logger.originalConsole).toBeDefined();
            expect(logger.originalConsole.log).toBeDefined();
            expect(logger.originalConsole.error).toBeDefined();
        });

        test('should emit log events when enabled', () => {
            logger.enabled = true;
            logger.interceptConsole();
            const logSpy = jest.fn();
            logger.on('log', logSpy);
            
            console.log('test message');
            
            expect(logSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'log',
                    source: 'Test',
                    message: 'test message'
                })
            );
        });

        test('should not emit when disabled', () => {
            logger.enabled = false;
            logger.interceptConsole();
            const logSpy = jest.fn();
            logger.on('log', logSpy);
            
            console.log('test message');
            
            expect(logSpy).not.toHaveBeenCalled();
        });

        test('should handle error level', () => {
            logger.enabled = true;
            logger.interceptConsole();
            const logSpy = jest.fn();
            logger.on('log', logSpy);
            
            console.error('error message');
            
            expect(logSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'error',
                    source: 'Test',
                    message: 'error message'
                })
            );
        });

        test('should handle warn level', () => {
            logger.enabled = true;
            logger.interceptConsole();
            const logSpy = jest.fn();
            logger.on('log', logSpy);
            
            console.warn('warning message');
            
            expect(logSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'warn',
                    source: 'Test',
                    message: 'warning message'
                })
            );
        });

        test('should handle info level', () => {
            logger.enabled = true;
            logger.interceptConsole();
            const logSpy = jest.fn();
            logger.on('log', logSpy);
            
            console.info('info message');
            
            expect(logSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'info',
                    source: 'Test',
                    message: 'info message'
                })
            );
        });
    });

    describe('log method', () => {
        beforeEach(() => {
            logger = new ChildProcessLogger('Test');
            logger.enabled = true;
        });

        test('should emit log event', () => {
            const logSpy = jest.fn();
            logger.on('log', logSpy);
            
            logger.log('info', ['test', 'message']);
            
            expect(logSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'info',
                    source: 'Test',
                    message: 'test message',
                    args: ['test', 'message']
                })
            );
        });

        test('should include timestamp', () => {
            const logSpy = jest.fn();
            logger.on('log', logSpy);
            
            logger.log('debug', ['debug message']);
            
            expect(logSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'debug',
                    source: 'Test',
                    message: 'debug message',
                    timestamp: expect.any(Date)
                })
            );
        });

        test('should not emit when disabled', () => {
            logger.enabled = false;
            const logSpy = jest.fn();
            logger.on('log', logSpy);
            
            logger.log('info', ['test']);
            
            expect(logSpy).not.toHaveBeenCalled();
        });
    });

    describe('event handling', () => {
        test('should be an EventEmitter', () => {
            logger = new ChildProcessLogger('Test');
            expect(logger).toBeInstanceOf(EventEmitter);
            
            const callback = jest.fn();
            logger.on('test-event', callback);
            logger.emit('test-event', 'data');
            
            expect(callback).toHaveBeenCalledWith('data');
        });
    });
});
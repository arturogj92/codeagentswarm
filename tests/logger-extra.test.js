// Extra tests for logger
const logger = require('../src/shared/logger/logger');

describe('Logger Extra Tests', () => {
    beforeEach(() => {
        logger.clearLogs();
        logger.enable();
    });
    
    test('should add log entry', () => {
        logger.addLog('info', ['test message']);
        const logs = logger.getLogs();
        expect(logs.length).toBeGreaterThan(0);
        expect(logs[logs.length - 1].level).toBe('info');
    });
    
    test('should clear logs', () => {
        logger.addLog('info', ['message 1']);
        logger.addLog('error', ['message 2']);
        logger.clearLogs();
        const logs = logger.getLogs();
        expect(logs.length).toBe(0);
    });
    
    test('should enable and disable logging', () => {
        logger.disable();
        expect(logger.isEnabled()).toBe(false);
        
        logger.enable();
        expect(logger.isEnabled()).toBe(true);
    });
    
    test('should export logs', () => {
        logger.addLog('info', ['test 1']);
        logger.addLog('error', ['test 2']);
        
        const exported = logger.exportLogs();
        expect(typeof exported).toBe('string');
        expect(exported).toContain('INFO');
        expect(exported).toContain('ERROR');
    });
    
    test('should subscribe to log updates', () => {
        const listener = jest.fn();
        logger.subscribe(listener);
        
        logger.addLog('info', ['test message']);
        
        expect(listener).toHaveBeenCalled();
    });
});
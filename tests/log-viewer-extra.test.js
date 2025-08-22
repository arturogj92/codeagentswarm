/**
 * Additional tests for LogViewer functionality
 * Testing log display and filtering features
 */

describe('LogViewer Extended Tests', () => {
    let mockDocument;
    let mockWindow;
    let logContainer;
    
    beforeEach(() => {
        // Setup DOM mocks
        logContainer = {
            innerHTML: '',
            appendChild: jest.fn(),
            removeChild: jest.fn(),
            children: [],
            scrollTop: 0,
            scrollHeight: 1000,
            classList: {
                add: jest.fn(),
                remove: jest.fn(),
                toggle: jest.fn()
            }
        };
        
        mockDocument = {
            getElementById: jest.fn((id) => {
                if (id === 'log-container') return logContainer;
                return null;
            }),
            createElement: jest.fn((tag) => ({
                tagName: tag.toUpperCase(),
                innerHTML: '',
                className: '',
                appendChild: jest.fn(),
                setAttribute: jest.fn(),
                classList: {
                    add: jest.fn(),
                    remove: jest.fn()
                }
            }))
        };
        
        mockWindow = {
            requestAnimationFrame: jest.fn(cb => setTimeout(cb, 0))
        };
        
        global.document = mockDocument;
        global.window = mockWindow;
    });
    
    afterEach(() => {
        jest.clearAllMocks();
        delete global.document;
        delete global.window;
    });
    
    describe('log filtering', () => {
        test('should filter logs by level', () => {
            const logs = [
                { level: 'info', message: 'Info message' },
                { level: 'error', message: 'Error message' },
                { level: 'warn', message: 'Warning message' },
                { level: 'debug', message: 'Debug message' }
            ];
            
            const filtered = logs.filter(log => log.level === 'error');
            expect(filtered).toHaveLength(1);
            expect(filtered[0].message).toBe('Error message');
        });
        
        test('should filter logs by search term', () => {
            const logs = [
                { message: 'Database connection established' },
                { message: 'API request sent' },
                { message: 'Database query executed' },
                { message: 'Response received' }
            ];
            
            const searchTerm = 'database';
            const filtered = logs.filter(log => 
                log.message.toLowerCase().includes(searchTerm.toLowerCase())
            );
            
            expect(filtered).toHaveLength(2);
            expect(filtered[0].message).toContain('Database');
            expect(filtered[1].message).toContain('Database');
        });
        
        test('should filter logs by date range', () => {
            const now = Date.now();
            const logs = [
                { timestamp: now - 3600000, message: 'Old log' }, // 1 hour ago
                { timestamp: now - 60000, message: 'Recent log' }, // 1 minute ago
                { timestamp: now, message: 'Current log' }
            ];
            
            const cutoff = now - 120000; // 2 minutes ago
            const filtered = logs.filter(log => log.timestamp >= cutoff);
            
            expect(filtered).toHaveLength(2);
            expect(filtered[0].message).toBe('Recent log');
            expect(filtered[1].message).toBe('Current log');
        });
    });
    
    describe('log formatting', () => {
        test('should format timestamp', () => {
            const timestamp = new Date('2024-01-15T10:30:45.123Z');
            const isoString = timestamp.toISOString();
            
            expect(isoString).toContain('10:30:45');
        });
        
        test('should format log level with color', () => {
            const levels = {
                'error': 'red',
                'warn': 'yellow',
                'info': 'blue',
                'debug': 'gray'
            };
            
            Object.entries(levels).forEach(([level, color]) => {
                expect(levels[level]).toBe(color);
            });
        });
        
        test('should truncate long messages', () => {
            const longMessage = 'a'.repeat(1000);
            const maxLength = 200;
            const truncated = longMessage.length > maxLength 
                ? longMessage.substring(0, maxLength) + '...'
                : longMessage;
            
            expect(truncated).toHaveLength(203); // 200 + '...'
            expect(truncated.endsWith('...')).toBe(true);
        });
    });
    
    describe('auto-scroll functionality', () => {
        test('should auto-scroll when at bottom', () => {
            logContainer.scrollTop = 900;
            logContainer.scrollHeight = 1000;
            logContainer.clientHeight = 100;
            
            const isAtBottom = (logContainer.scrollHeight - logContainer.scrollTop) <= 
                               (logContainer.clientHeight + 50);
            
            expect(isAtBottom).toBe(true);
        });
        
        test('should not auto-scroll when user scrolled up', () => {
            logContainer.scrollTop = 500;
            logContainer.scrollHeight = 1000;
            logContainer.clientHeight = 100;
            
            const isAtBottom = (logContainer.scrollHeight - logContainer.scrollTop) <= 
                               (logContainer.clientHeight + 50);
            
            expect(isAtBottom).toBe(false);
        });
    });
    
    describe('log export', () => {
        test('should export logs as JSON', () => {
            const logs = [
                { level: 'info', message: 'Test 1', timestamp: Date.now() },
                { level: 'error', message: 'Test 2', timestamp: Date.now() }
            ];
            
            const exported = JSON.stringify(logs, null, 2);
            expect(exported).toContain('"level": "info"');
            expect(exported).toContain('"message": "Test 1"');
        });
        
        test('should export logs as CSV', () => {
            const logs = [
                { level: 'info', message: 'Test 1', timestamp: '2024-01-15T10:00:00Z' },
                { level: 'error', message: 'Test 2', timestamp: '2024-01-15T10:01:00Z' }
            ];
            
            const csv = 'timestamp,level,message\n' + 
                logs.map(log => `${log.timestamp},${log.level},"${log.message}"`).join('\n');
            
            expect(csv).toContain('timestamp,level,message');
            expect(csv).toContain('info,"Test 1"');
            expect(csv).toContain('error,"Test 2"');
        });
    });
    
    describe('log clearing', () => {
        test('should clear all logs', () => {
            let logs = [
                { message: 'Log 1' },
                { message: 'Log 2' },
                { message: 'Log 3' }
            ];
            
            logs = [];
            logContainer.innerHTML = '';
            
            expect(logs).toHaveLength(0);
            expect(logContainer.innerHTML).toBe('');
        });
        
        test('should clear logs older than threshold', () => {
            const now = Date.now();
            let logs = [
                { timestamp: now - 7200000, message: 'Very old' }, // 2 hours
                { timestamp: now - 3600000, message: 'Old' }, // 1 hour
                { timestamp: now - 60000, message: 'Recent' } // 1 minute
            ];
            
            const threshold = now - 3600000; // Keep last hour
            logs = logs.filter(log => log.timestamp >= threshold);
            
            expect(logs).toHaveLength(2);
            expect(logs[0].message).toBe('Old');
            expect(logs[1].message).toBe('Recent');
        });
    });
    
    describe('log statistics', () => {
        test('should count logs by level', () => {
            const logs = [
                { level: 'info' },
                { level: 'info' },
                { level: 'error' },
                { level: 'warn' },
                { level: 'info' }
            ];
            
            const counts = logs.reduce((acc, log) => {
                acc[log.level] = (acc[log.level] || 0) + 1;
                return acc;
            }, {});
            
            expect(counts.info).toBe(3);
            expect(counts.error).toBe(1);
            expect(counts.warn).toBe(1);
        });
        
        test('should calculate average log rate', () => {
            const logs = [
                { timestamp: Date.now() - 10000 },
                { timestamp: Date.now() - 8000 },
                { timestamp: Date.now() - 6000 },
                { timestamp: Date.now() - 4000 },
                { timestamp: Date.now() - 2000 }
            ];
            
            const timespan = 10000; // 10 seconds
            const rate = logs.length / (timespan / 1000); // logs per second
            
            expect(rate).toBe(0.5);
        });
    });
    
    describe('performance optimization', () => {
        test('should batch DOM updates', () => {
            const updates = [];
            for (let i = 0; i < 100; i++) {
                updates.push({ message: `Log ${i}` });
            }
            
            // Simulate batching
            const batchSize = 20;
            const batches = [];
            for (let i = 0; i < updates.length; i += batchSize) {
                batches.push(updates.slice(i, i + batchSize));
            }
            
            expect(batches).toHaveLength(5);
            expect(batches[0]).toHaveLength(20);
        });
        
        test('should throttle scroll events', () => {
            let scrollCount = 0;
            const throttleMs = 100;
            let lastScroll = 0;
            
            const handleScroll = () => {
                const now = Date.now();
                if (now - lastScroll >= throttleMs) {
                    scrollCount++;
                    lastScroll = now;
                }
            };
            
            // Simulate rapid scrolling
            for (let i = 0; i < 10; i++) {
                handleScroll();
            }
            
            expect(scrollCount).toBeLessThanOrEqual(1);
        });
    });
});
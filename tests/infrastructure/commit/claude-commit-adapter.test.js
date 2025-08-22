/**
 * Simple working tests for claude-commit-adapter.js
 */

const ClaudeCommitAdapter = require('../../../infrastructure/commit/claude-commit-adapter');
const CommitRepository = require('../../../domain/commit/commit-repository');
const CommitMessage = require('../../../domain/commit/commit-message');
const { spawn, exec } = require('child_process');
const EventEmitter = require('events');

// Mock child_process
jest.mock('child_process', () => ({
    spawn: jest.fn(),
    exec: jest.fn()
}));

describe('ClaudeCommitAdapter', () => {
    let adapter;

    beforeEach(() => {
        adapter = new ClaudeCommitAdapter();
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        test('should initialize with default values', () => {
            expect(adapter.maxRetries).toBe(1);
            expect(adapter.timeout).toBe(60000);
            expect(adapter.claudePath).toBe('claude');
        });

        test('should inherit from CommitRepository', () => {
            expect(adapter).toBeInstanceOf(CommitRepository);
        });
    });

    describe('generateCommitMessage', () => {
        test('should generate commit message successfully', async () => {
            const mockResponse = 'feat: add new feature';
            
            // Mock spawn for successful response
            spawn.mockImplementation(() => {
                const mockProcess = new EventEmitter();
                mockProcess.stdin = {
                    write: jest.fn(),
                    end: jest.fn()
                };
                mockProcess.stdout = new EventEmitter();
                mockProcess.stderr = new EventEmitter();
                
                setTimeout(() => {
                    mockProcess.stdout.emit('data', Buffer.from(mockResponse));
                    mockProcess.emit('close', 0);
                }, 10);
                
                return mockProcess;
            });

            const result = await adapter.generateCommitMessage({
                diff: 'diff content',
                modifiedFiles: [{ path: 'test.js', status: 'modified' }],
                style: 'concise'
            });

            expect(result).toBeInstanceOf(CommitMessage);
            expect(result.title).toBe('feat: add new feature');
        });

        test('should handle errors gracefully with fallback', async () => {
            spawn.mockImplementation(() => {
                const mockProcess = new EventEmitter();
                mockProcess.stdin = {
                    write: jest.fn(),
                    end: jest.fn()
                };
                mockProcess.stdout = new EventEmitter();
                mockProcess.stderr = new EventEmitter();
                mockProcess.kill = jest.fn();
                
                setTimeout(() => {
                    mockProcess.emit('error', new Error('Command failed'));
                }, 10);
                
                return mockProcess;
            });

            // The adapter should return a fallback message instead of throwing
            const result = await adapter.generateCommitMessage({
                diff: 'diff content',
                modifiedFiles: []
            });
            
            expect(result).toBeInstanceOf(CommitMessage);
            expect(result.title).toBeTruthy(); // Should have a fallback title
        });

        test('should handle empty response with fallback', async () => {
            spawn.mockImplementation(() => {
                const mockProcess = new EventEmitter();
                mockProcess.stdin = {
                    write: jest.fn(),
                    end: jest.fn()
                };
                mockProcess.stdout = new EventEmitter();
                mockProcess.stderr = new EventEmitter();
                
                setTimeout(() => {
                    mockProcess.stdout.emit('data', Buffer.from(''));
                    mockProcess.emit('close', 0);
                }, 10);
                
                return mockProcess;
            });

            const result = await adapter.generateCommitMessage({
                diff: 'diff content',
                modifiedFiles: [{ path: 'test.js', status: 'modified' }],
                style: 'concise'
            });

            // Should use fallback message
            expect(result).toBeInstanceOf(CommitMessage);
            expect(result.title).toBeTruthy(); // Will have some fallback message
        });
    });

    describe('isAvailable', () => {
        test('should return boolean for availability check', async () => {
            // Mock exec to simulate claude not found
            exec.mockImplementation((cmd, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                }
                // Simulate command not found
                callback(new Error('Command not found'), '', 'claude: command not found');
            });
            
            const result = await adapter.isAvailable();
            expect(typeof result).toBe('boolean');
            expect(result).toBe(false); // Should be false when claude is not found
        });
    });

    describe('getName', () => {
        test('should return adapter name', () => {
            expect(adapter.getName()).toBe('Claude');
        });
    });
});
const ClaudeCommitAdapter = require('../../../infrastructure/commit/claude-commit-adapter');
const CommitMessage = require('../../../domain/commit/commit-message');
const { exec, spawn } = require('child_process');
const EventEmitter = require('events');

// Mock child_process
jest.mock('child_process');

describe('ClaudeCommitAdapter', () => {
    let adapter;
    let mockExecCallback;

    beforeEach(() => {
        adapter = new ClaudeCommitAdapter();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('generateCommitMessage', () => {
        test('should generate a concise commit message', async () => {
            const mockResponse = 'feat: add user authentication';
            
            // Mock spawn for the new stdin-based approach
            spawn.mockImplementation((command, args, options) => {
                const mockProcess = new EventEmitter();
                mockProcess.stdin = {
                    write: jest.fn(),
                    end: jest.fn()
                };
                mockProcess.stdout = new EventEmitter();
                mockProcess.stderr = new EventEmitter();
                
                // Simulate successful command execution
                process.nextTick(() => {
                    mockProcess.stdout.emit('data', Buffer.from(mockResponse));
                    mockProcess.emit('close', 0);
                });
                
                return mockProcess;
            });
            
            // Keep exec mock for isAvailable check
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('--version')) {
                        callback(null, '1.0.70 (Claude Code)', '');
                    } else {
                        callback(null, '', '');
                    }
                });
            });

            const params = {
                diff: 'diff --git a/auth.js b/auth.js\n+function login() {}',
                modifiedFiles: [{ path: 'auth.js', status: 'modified' }],
                style: 'concise',
                workingDirectory: '/test/repo'
            };

            const result = await adapter.generateCommitMessage(params);
            
            expect(result).toBeInstanceOf(CommitMessage);
            expect(result.title).toBe('feat: add user authentication');
        });

        test('should generate a detailed commit message', async () => {
            const mockResponse = `feat: add user authentication

- Implement login function in auth.js
- Add password hashing logic
- Create session management

Closes #123`;
            
            // Mock spawn for the new stdin-based approach
            spawn.mockImplementation((command, args, options) => {
                const mockProcess = new EventEmitter();
                mockProcess.stdin = {
                    write: jest.fn(),
                    end: jest.fn()
                };
                mockProcess.stdout = new EventEmitter();
                mockProcess.stderr = new EventEmitter();
                
                // Simulate successful command execution
                process.nextTick(() => {
                    mockProcess.stdout.emit('data', Buffer.from(mockResponse));
                    mockProcess.emit('close', 0);
                });
                
                return mockProcess;
            });
            
            // Keep exec mock for isAvailable check
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('--version')) {
                        callback(null, '1.0.70 (Claude Code)', '');
                    } else {
                        callback(null, '', '');
                    }
                });
            });

            const params = {
                diff: 'diff --git a/auth.js b/auth.js\n+function login() {}',
                modifiedFiles: [{ path: 'auth.js', status: 'modified' }],
                style: 'detailed',
                workingDirectory: '/test/repo'
            };

            const result = await adapter.generateCommitMessage(params);
            
            expect(result).toBeInstanceOf(CommitMessage);
            expect(result.title).toBe('feat: add user authentication');
            expect(result.body).toContain('Implement login function');
            expect(result.footer).toBe('Closes #123');
        });

        test('should handle errors gracefully', async () => {
            // Mock spawn to fail
            spawn.mockImplementation((command, args, options) => {
                const mockProcess = new EventEmitter();
                mockProcess.stdin = {
                    write: jest.fn(),
                    end: jest.fn()
                };
                mockProcess.stdout = new EventEmitter();
                mockProcess.stderr = new EventEmitter();
                
                // Simulate command failure
                process.nextTick(() => {
                    mockProcess.emit('close', 1);
                });
                
                return mockProcess;
            });
            
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('--version')) {
                        callback(null, '1.0.70 (Claude Code)', '');
                    } else {
                        callback(new Error('Command failed'), '', 'error');
                    }
                });
            });

            const params = {
                diff: 'some diff',
                modifiedFiles: [{ path: 'file.js', status: 'modified' }],
                style: 'concise',
                workingDirectory: '/test/repo'
            };

            await expect(adapter.generateCommitMessage(params)).rejects.toThrow('Failed to generate commit message');
        });

        test('should retry on failure', async () => {
            let callCount = 0;
            
            spawn.mockImplementation((command, args, options) => {
                callCount++;
                const mockProcess = new EventEmitter();
                mockProcess.stdin = {
                    write: jest.fn(),
                    end: jest.fn()
                };
                mockProcess.stdout = new EventEmitter();
                mockProcess.stderr = new EventEmitter();
                
                // First call fails, second succeeds
                process.nextTick(() => {
                    if (callCount <= 2) {
                        // First and second attempts fail (main prompt)
                        mockProcess.emit('close', 1);
                    } else {
                        // Third attempt (fallback) succeeds
                        mockProcess.stdout.emit('data', Buffer.from('fix: resolve bug'));
                        mockProcess.emit('close', 0);
                    }
                });
                
                return mockProcess;
            });
            
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('--version')) {
                        callback(null, '1.0.70 (Claude Code)', '');
                    } else {
                        callback(null, '', '');
                    }
                });
            });

            const params = {
                diff: 'some diff',
                modifiedFiles: [{ path: 'file.js', status: 'modified' }],
                style: 'concise',
                workingDirectory: '/test/repo'
            };

            const result = await adapter.generateCommitMessage(params);
            
            expect(callCount).toBeGreaterThanOrEqual(3); // Main attempt x2 + fallback
            expect(result.title).toBe('fix: resolve bug');
        });

        test('should clean output from ANSI codes and markdown', () => {
            const dirtyOutput = `\x1b[32mfeat: test\x1b[0m
\`\`\`
Some code block content
\`\`\`
[System] Generated successfully`;

            const cleaned = adapter.cleanOutput(dirtyOutput);
            
            expect(cleaned).not.toContain('\x1b[');
            expect(cleaned).not.toContain('```');
            expect(cleaned).not.toContain('[System]');
            expect(cleaned).toContain('feat: test');
            expect(cleaned).toContain('Some code block content');
            // The exact formatting may vary based on cleaning logic
        });

        test('should validate commit message format', () => {
            expect(adapter.isValidCommitMessage('feat: valid message')).toBe(true);
            expect(adapter.isValidCommitMessage('fix(scope): valid message')).toBe(true);
            expect(adapter.isValidCommitMessage('Invalid message')).toBe(true); // Accepts capital letters
            expect(adapter.isValidCommitMessage('')).toBe(false);
            expect(adapter.isValidCommitMessage(null)).toBe(false);
        });
    });

    describe('isAvailable', () => {
        test('should return true when claude CLI is available', async () => {
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('--version')) {
                        callback(null, '1.0.70 (Claude Code)', '');
                    } else if (command.includes('which claude') || command.includes('where claude') || command.includes('command -v')) {
                        callback(null, '/usr/local/bin/claude', '');
                    } else {
                        callback(new Error('Command not found'), '', 'error');
                    }
                });
            });

            const available = await adapter.isAvailable();
            expect(available).toBe(true);
        });

        test('should return false when claude CLI is not available', async () => {
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    callback(new Error('Command not found'), '', 'error');
                });
            });

            const available = await adapter.isAvailable();
            expect(available).toBe(false);
        });
    });

    describe('getName', () => {
        test('should return service name', () => {
            expect(adapter.getName()).toBe('Claude');
        });
    });

    describe('buildPrompt', () => {
        test('should build concise prompt correctly', () => {
            const diff = 'diff content';
            const modifiedFiles = [
                { path: 'file1.js', status: 'modified' },
                { path: 'file2.js', status: 'added' }
            ];
            
            const prompt = adapter.buildPrompt(diff, modifiedFiles, 'concise');
            
            expect(prompt).toContain('Output: Single line commit title only');
            expect(prompt).toContain('file1.js (modified)');
            expect(prompt).toContain('file2.js (added)');
            expect(prompt).toContain('max 72 chars');
        });

        test('should build detailed prompt correctly', () => {
            const diff = 'diff content';
            const modifiedFiles = [
                { path: 'file1.js', status: 'modified' }
            ];
            
            const prompt = adapter.buildPrompt(diff, modifiedFiles, 'detailed');
            
            expect(prompt).toContain('Format:');
            expect(prompt).toContain('bullet points');
            expect(prompt).not.toContain('Single line commit title only');
        });

        test('should truncate long diffs', () => {
            const longDiff = 'a'.repeat(5000);
            const modifiedFiles = [{ path: 'file.js', status: 'modified' }];
            
            const prompt = adapter.buildPrompt(longDiff, modifiedFiles, 'concise');
            
            // The prompt now uses a different format, just check it's reasonably sized
            expect(prompt.length).toBeLessThan(3000); // Reduced size for optimized prompt
            expect(prompt).toContain('file.js');
        });
    });
});
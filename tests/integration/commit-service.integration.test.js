const commitServiceFactory = require('../../infrastructure/commit/commit-service-factory');
const ClaudeCommitAdapter = require('../../infrastructure/commit/claude-commit-adapter');
// DeepSeek adapter removed - using Claude only
const { exec, spawn } = require('child_process');
const { execSync } = require('child_process');
const EventEmitter = require('events');

// Mock child_process
jest.mock('child_process');

describe('Commit Service Integration', () => {
    beforeEach(() => {
        // Reset factory state
        commitServiceFactory.adapters = new Map();
        commitServiceFactory.defaultAdapter = null;
        
        // Mock git commands
        execSync.mockImplementation((command) => {
            if (command.includes('git rev-parse --is-inside-work-tree')) {
                return 'true';
            }
            // Order matters - check more specific commands first
            if (command.includes('git diff --staged --name-status')) {
                return 'M\tfile.js';
            }
            if (command.includes('git diff --staged')) {
                return 'diff --git a/file.js b/file.js\n+added line';
            }
            if (command.includes('git diff --name-status')) {
                return 'M\tfile.js';
            }
            if (command.includes('git diff')) {
                return 'diff --git a/file.js b/file.js\n+added line';
            }
            return '';
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Factory initialization', () => {
        test('should initialize with Claude when available', async () => {
            // Mock Claude CLI availability
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('claude --version')) {
                        callback(null, 'claude version 1.0.0', '');
                    } else if (command.includes('which claude') || command.includes('where claude')) {
                        callback(null, '/usr/local/bin/claude', '');
                    } else {
                        callback(null, '', '');
                    }
                });
            });

            await commitServiceFactory.initialize({
                preferredService: 'claude'
            });

            expect(commitServiceFactory.getAvailableAdapters()).toContain('claude');
            expect(commitServiceFactory.getDefaultAdapterName()).toBe('claude');
        });

        test('should throw error when Claude is not available', async () => {
            // Mock Claude not available
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('claude')) {
                        callback(new Error('Command not found'), '', 'error');
                    } else {
                        callback(null, '', '');
                    }
                });
            });

            await expect(commitServiceFactory.initialize()).rejects.toThrow(
                'Claude CLI is not installed'
            );
        });

        test('should only use Claude adapter', async () => {
            // Mock Claude available
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('claude --version')) {
                        callback(null, 'claude version 1.0.0', '');
                    } else if (command.includes('which claude') || command.includes('where claude')) {
                        callback(null, '/usr/local/bin/claude', '');
                    } else {
                        callback(null, '', '');
                    }
                });
            });

            await commitServiceFactory.initialize();

            expect(commitServiceFactory.getAvailableAdapters()).toEqual(['claude']);
            expect(commitServiceFactory.getDefaultAdapterName()).toBe('claude');
        });

        test('should throw error when no service available', async () => {
            // Mock Claude not available
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    callback(new Error('Command not found'), '', 'error');
                });
            });

            await expect(commitServiceFactory.initialize({})).rejects.toThrow(
                'Claude CLI is not installed'
            );
        });
    });

    describe('Use case creation', () => {
        test('should create use case with default adapter', async () => {
            // Mock Claude available
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('claude --version')) {
                        callback(null, 'claude version 1.0.0', '');
                    } else if (command.includes('which claude') || command.includes('where claude')) {
                        callback(null, '/usr/local/bin/claude', '');
                    } else {
                        callback(null, '', '');
                    }
                });
            });

            await commitServiceFactory.initialize({});
            
            const useCase = commitServiceFactory.createUseCase();
            expect(useCase).toBeDefined();
            expect(useCase.repository).toBeDefined();
        });

        test('should create use case with Claude adapter', async () => {
            // Mock Claude available
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('claude --version')) {
                        callback(null, 'claude version 1.0.0', '');
                    } else if (command.includes('which claude') || command.includes('where claude')) {
                        callback(null, '/usr/local/bin/claude', '');
                    } else {
                        callback(null, '', '');
                    }
                });
            });

            await commitServiceFactory.initialize();
            
            const useCase = commitServiceFactory.createUseCase('claude');
            expect(useCase).toBeDefined();
        });

        test('should throw error when adapter not available', () => {
            expect(() => {
                commitServiceFactory.createUseCase();
            }).toThrow('No commit service adapter available');
        });
    });

    describe('End-to-end flow', () => {
        test('should generate commit message using Claude', async () => {
            // Mock spawn for Claude CLI
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
                    mockProcess.stdout.emit('data', Buffer.from('feat: add new feature\n\n- Added login functionality\n- Updated tests'));
                    mockProcess.emit('close', 0);
                });
                
                return mockProcess;
            });
            
            // Mock exec for isAvailable and other checks
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('claude --version')) {
                        callback(null, 'claude version 1.0.0', '');
                    } else if (command.includes('which claude') || command.includes('where claude')) {
                        callback(null, '/usr/local/bin/claude', '');
                    } else {
                        callback(null, '', '');
                    }
                });
            });

            await commitServiceFactory.initialize({});
            const useCase = commitServiceFactory.createUseCase();
            
            const result = await useCase.execute({
                workingDirectory: '/test/repo',
                style: 'detailed'
            });

            expect(result.success).toBe(true);
            expect(result.message).toContain('feat: add new feature');
            expect(result.metadata.service).toBe('Claude');
        });
    });

    describe('Adapter switching', () => {
        test('should allow reinitializing factory', async () => {
            // First init with Claude
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('claude --version')) {
                        callback(null, 'claude version 1.0.0', '');
                    } else if (command.includes('which claude') || command.includes('where claude')) {
                        callback(null, '/usr/local/bin/claude', '');
                    } else {
                        callback(null, '', '');
                    }
                });
            });

            await commitServiceFactory.initialize({});
            expect(commitServiceFactory.getDefaultAdapterName()).toBe('claude');

            // Reinit should work and keep Claude
            await commitServiceFactory.reinitialize();
            expect(commitServiceFactory.getDefaultAdapterName()).toBe('claude');
        });
    });

    describe('hasAdapter', () => {
        test('should check if adapter exists', async () => {
            exec.mockImplementation((command, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                process.nextTick(() => {
                    if (command.includes('claude --version')) {
                        callback(null, 'claude version 1.0.0', '');
                    } else if (command.includes('which claude') || command.includes('where claude')) {
                        callback(null, '/usr/local/bin/claude', '');
                    } else {
                        callback(null, '', '');
                    }
                });
            });

            await commitServiceFactory.initialize({});
            
            expect(commitServiceFactory.hasAdapter('claude')).toBe(true);
            expect(commitServiceFactory.hasAdapter('nonexistent')).toBe(false);
            expect(commitServiceFactory.hasAdapter('unknown')).toBe(false);
        });
    });
});
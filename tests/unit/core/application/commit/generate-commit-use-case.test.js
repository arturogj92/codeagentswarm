const GenerateCommitUseCase = require('../../../../../application/commit/generate-commit-use-case');
const CommitMessage = require('../../../../../domain/entities/commit/commit-message');
const { execSync } = require('child_process');

// Mock child_process
jest.mock('child_process', () => ({
    execSync: jest.fn()
}));

// Mock repository implementation
class MockCommitRepository {
    constructor() {
        this.available = true;
        this.name = 'MockService';
        this.shouldFail = false;
    }

    async generateCommitMessage({ diff, modifiedFiles, style, workingDirectory }) {
        if (this.shouldFail) {
            throw new Error('Mock generation failed');
        }
        
        return new CommitMessage({
            title: 'feat: mock commit message',
            body: 'This is a mock body',
            footer: 'Closes #123'
        });
    }

    async isAvailable() {
        return this.available;
    }

    getName() {
        return this.name;
    }
}

describe('GenerateCommitUseCase', () => {
    let useCase;
    let mockRepository;
    let mockLogger;

    beforeEach(() => {
        mockRepository = new MockCommitRepository();
        mockLogger = {
            log: jest.fn(),
            error: jest.fn()
        };
        useCase = new GenerateCommitUseCase(mockRepository, mockLogger);
        
        // Default mock for git commands
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

    describe('constructor', () => {
        test('should require a repository', () => {
            expect(() => {
                new GenerateCommitUseCase(null);
            }).toThrow('CommitRepository is required');
        });

        test('should accept optional logger', () => {
            const useCaseWithoutLogger = new GenerateCommitUseCase(mockRepository);
            expect(useCaseWithoutLogger.logger).toBe(console);
        });
    });

    describe('execute', () => {
        test('should generate commit message successfully', async () => {
            const result = await useCase.execute({
                workingDirectory: '/test/repo',
                style: 'detailed'
            });

            expect(result.success).toBe(true);
            expect(result.message).toContain('feat: mock commit message');
            expect(result.metadata).toEqual({
                type: 'feat',
                scope: null,
                filesChanged: 1,
                service: 'MockService'
            });
        });

        test('should handle non-git repository', async () => {
            execSync.mockImplementation((command) => {
                if (command.includes('git rev-parse')) {
                    throw new Error('Not a git repo');
                }
                return '';
            });

            const result = await useCase.execute({
                workingDirectory: '/not/a/repo'
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Not a git repository');
        });

        test('should handle no changes to commit', async () => {
            execSync.mockImplementation((command) => {
                if (command.includes('git rev-parse')) {
                    return 'true';
                }
                if (command.includes('git diff')) {
                    return '';
                }
                return '';
            });

            const result = await useCase.execute({
                workingDirectory: '/test/repo'
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('No changes to commit');
        });

        test('should handle no modified files', async () => {
            execSync.mockImplementation((command) => {
                if (command.includes('git rev-parse')) {
                    return 'true';
                }
                if (command.includes('git diff') && !command.includes('--name-status')) {
                    return 'some diff';
                }
                if (command.includes('--name-status')) {
                    return '';
                }
                return '';
            });

            const result = await useCase.execute({
                workingDirectory: '/test/repo'
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('No modified files found');
        });

        test('should handle service not available', async () => {
            mockRepository.available = false;

            const result = await useCase.execute({
                workingDirectory: '/test/repo'
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('MockService service is not available');
        });

        test('should handle generation failure', async () => {
            mockRepository.shouldFail = true;

            const result = await useCase.execute({
                workingDirectory: '/test/repo'
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Mock generation failed');
        });

        test('should use detailed style by default', async () => {
            const result = await useCase.execute({
                workingDirectory: '/test/repo'
            });

            expect(result.success).toBe(true);
            expect(mockLogger.log).toHaveBeenCalledWith(
                expect.stringContaining('detailed')
            );
        });

        test('should respect style parameter', async () => {
            const result = await useCase.execute({
                workingDirectory: '/test/repo',
                style: 'concise'
            });

            expect(result.success).toBe(true);
            expect(mockLogger.log).toHaveBeenCalledWith(
                expect.stringContaining('concise')
            );
        });

        test('should get staged diff first, then all diff if no staged', async () => {
            let diffCalls = [];
            
            execSync.mockImplementation((command) => {
                if (command.includes('git rev-parse')) {
                    return 'true';
                }
                // Track order of diff calls
                if (command === 'git diff --staged') {
                    diffCalls.push(command);
                    return ''; // No staged changes
                }
                if (command === 'git diff') {
                    diffCalls.push(command);
                    return 'unstaged diff'; // Unstaged changes exist
                }
                if (command === 'git diff --staged --name-status') {
                    return ''; // No staged files
                }
                if (command === 'git diff --name-status') {
                    return 'M\tfile.js'; // Unstaged file
                }
                return '';
            });

            const result = await useCase.execute({
                workingDirectory: '/test/repo'
            });

            expect(result.success).toBe(true);
            expect(diffCalls).toEqual(['git diff --staged', 'git diff']);
            expect(result.message).toContain('feat: mock commit message');
        });
    });

    describe('parseFileStatus', () => {
        test('should parse file status correctly', () => {
            const statusOutput = `M\tmodified.js
A\tadded.js
D\tdeleted.js
R\trenamed.js`;

            const files = useCase.parseFileStatus(statusOutput);

            expect(files).toEqual([
                { path: 'modified.js', status: 'modified' },
                { path: 'added.js', status: 'added' },
                { path: 'deleted.js', status: 'deleted' },
                { path: 'renamed.js', status: 'renamed' }
            ]);
        });

        test('should handle empty status output', () => {
            const files = useCase.parseFileStatus('');
            expect(files).toEqual([]);
        });

        test('should handle files with tabs in path', () => {
            const statusOutput = 'M\tfile\twith\ttabs.js';
            const files = useCase.parseFileStatus(statusOutput);
            
            expect(files).toEqual([
                { path: 'file\twith\ttabs.js', status: 'modified' }
            ]);
        });
    });

    describe('getStatusDescription', () => {
        test('should map status codes correctly', () => {
            expect(useCase.getStatusDescription('M')).toBe('modified');
            expect(useCase.getStatusDescription('A')).toBe('added');
            expect(useCase.getStatusDescription('D')).toBe('deleted');
            expect(useCase.getStatusDescription('R')).toBe('renamed');
            expect(useCase.getStatusDescription('C')).toBe('copied');
            expect(useCase.getStatusDescription('U')).toBe('updated');
            expect(useCase.getStatusDescription('X')).toBe('X'); // Unknown status
        });
    });
});
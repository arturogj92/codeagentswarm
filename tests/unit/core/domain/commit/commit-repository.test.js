/**
 * Tests for CommitRepository abstract class
 */

const CommitRepository = require('../../../../../domain/entities/commit/commit-repository');

describe('CommitRepository', () => {
    let repository;

    beforeEach(() => {
        repository = new CommitRepository();
    });

    describe('generateCommitMessage', () => {
        it('should throw error for unimplemented generateCommitMessage', async () => {
            const params = {
                diff: 'test diff',
                modifiedFiles: ['file1.js', 'file2.js'],
                style: 'concise',
                workingDirectory: '/test/dir'
            };

            await expect(repository.generateCommitMessage(params))
                .rejects
                .toThrow('generateCommitMessage must be implemented by concrete repository');
        });

        it('should throw error with all parameter variations', async () => {
            const testCases = [
                {
                    diff: '',
                    modifiedFiles: [],
                    style: 'detailed',
                    workingDirectory: '/'
                },
                {
                    diff: 'long diff content\nwith multiple lines',
                    modifiedFiles: ['file.txt'],
                    style: 'concise',
                    workingDirectory: '/path/to/project'
                },
                {
                    diff: null,
                    modifiedFiles: null,
                    style: null,
                    workingDirectory: null
                },
                {
                    // Missing parameters
                }
            ];

            for (const params of testCases) {
                await expect(repository.generateCommitMessage(params))
                    .rejects
                    .toThrow('generateCommitMessage must be implemented by concrete repository');
            }
        });
    });

    describe('isAvailable', () => {
        it('should throw error for unimplemented isAvailable', async () => {
            await expect(repository.isAvailable())
                .rejects
                .toThrow('isAvailable must be implemented by concrete repository');
        });

        it('should throw error when called with arguments', async () => {
            await expect(repository.isAvailable('arg1', 'arg2'))
                .rejects
                .toThrow('isAvailable must be implemented by concrete repository');
        });
    });

    describe('getName', () => {
        it('should throw error for unimplemented getName', () => {
            expect(() => repository.getName())
                .toThrow('getName must be implemented by concrete repository');
        });

        it('should throw error when called with arguments', () => {
            expect(() => repository.getName('arg1'))
                .toThrow('getName must be implemented by concrete repository');
        });
    });

    describe('Concrete Implementation', () => {
        class ConcreteCommitRepository extends CommitRepository {
            async generateCommitMessage({ diff, modifiedFiles, style, workingDirectory }) {
                return {
                    title: 'Test commit',
                    body: 'Test body',
                    footer: 'Test footer',
                    toString() {
                        return `${this.title}\n\n${this.body}\n\n${this.footer}`;
                    }
                };
            }

            async isAvailable() {
                return true;
            }

            getName() {
                return 'ConcreteRepository';
            }
        }

        let concreteRepo;

        beforeEach(() => {
            concreteRepo = new ConcreteCommitRepository();
        });

        it('should implement generateCommitMessage', async () => {
            const result = await concreteRepo.generateCommitMessage({
                diff: 'test diff',
                modifiedFiles: ['file.js'],
                style: 'concise',
                workingDirectory: '/test'
            });

            expect(result).toHaveProperty('title', 'Test commit');
            expect(result).toHaveProperty('body', 'Test body');
            expect(result).toHaveProperty('footer', 'Test footer');
            expect(result.toString()).toBe('Test commit\n\nTest body\n\nTest footer');
        });

        it('should implement isAvailable', async () => {
            const result = await concreteRepo.isAvailable();
            expect(result).toBe(true);
        });

        it('should implement getName', () => {
            const result = concreteRepo.getName();
            expect(result).toBe('ConcreteRepository');
        });
    });

    describe('Interface Contract', () => {
        it('should be a class', () => {
            expect(typeof CommitRepository).toBe('function');
            expect(CommitRepository.prototype).toBeDefined();
        });

        it('should have all required methods', () => {
            expect(typeof CommitRepository.prototype.generateCommitMessage).toBe('function');
            expect(typeof CommitRepository.prototype.isAvailable).toBe('function');
            expect(typeof CommitRepository.prototype.getName).toBe('function');
        });

        it('should be instantiable', () => {
            expect(() => new CommitRepository()).not.toThrow();
        });

        it('should allow inheritance', () => {
            class TestRepository extends CommitRepository {}
            const testRepo = new TestRepository();
            expect(testRepo instanceof CommitRepository).toBe(true);
            expect(testRepo instanceof TestRepository).toBe(true);
        });
    });

    describe('Error Messages', () => {
        it('should have consistent error messages', () => {
            const errorMessages = {
                generateCommitMessage: 'generateCommitMessage must be implemented by concrete repository',
                isAvailable: 'isAvailable must be implemented by concrete repository',
                getName: 'getName must be implemented by concrete repository'
            };

            expect(() => repository.getName()).toThrow(errorMessages.getName);
        });

        it('should preserve stack trace in errors', async () => {
            try {
                await repository.generateCommitMessage({});
            } catch (error) {
                expect(error.stack).toBeDefined();
                expect(error.stack).toContain('CommitRepository.generateCommitMessage');
            }
        });
    });

    describe('Multiple Inheritance Levels', () => {
        class MiddleRepository extends CommitRepository {
            async isAvailable() {
                return false;
            }
        }

        class FinalRepository extends MiddleRepository {
            async generateCommitMessage(params) {
                return { title: 'Final', body: '', footer: '' };
            }

            getName() {
                return 'FinalRepository';
            }
        }

        it('should support multiple levels of inheritance', async () => {
            const finalRepo = new FinalRepository();
            
            expect(finalRepo instanceof CommitRepository).toBe(true);
            expect(finalRepo instanceof MiddleRepository).toBe(true);
            expect(finalRepo instanceof FinalRepository).toBe(true);
            
            const result = await finalRepo.generateCommitMessage({});
            expect(result.title).toBe('Final');
            
            const available = await finalRepo.isAvailable();
            expect(available).toBe(false);
            
            const name = finalRepo.getName();
            expect(name).toBe('FinalRepository');
        });
    });

    describe('Parameter Validation', () => {
        class ValidatingRepository extends CommitRepository {
            async generateCommitMessage({ diff, modifiedFiles, style, workingDirectory }) {
                if (!diff) throw new Error('diff is required');
                if (!modifiedFiles) throw new Error('modifiedFiles is required');
                if (!style) throw new Error('style is required');
                if (!workingDirectory) throw new Error('workingDirectory is required');
                
                return { title: 'Valid', body: '', footer: '' };
            }

            async isAvailable() {
                return true;
            }

            getName() {
                return 'ValidatingRepository';
            }
        }

        it('should allow implementations to validate parameters', async () => {
            const validatingRepo = new ValidatingRepository();
            
            await expect(validatingRepo.generateCommitMessage({}))
                .rejects
                .toThrow('diff is required');
            
            await expect(validatingRepo.generateCommitMessage({ diff: 'test' }))
                .rejects
                .toThrow('modifiedFiles is required');
            
            await expect(validatingRepo.generateCommitMessage({ 
                diff: 'test', 
                modifiedFiles: [] 
            }))
                .rejects
                .toThrow('style is required');
            
            await expect(validatingRepo.generateCommitMessage({ 
                diff: 'test', 
                modifiedFiles: [], 
                style: 'concise' 
            }))
                .rejects
                .toThrow('workingDirectory is required');
            
            const result = await validatingRepo.generateCommitMessage({
                diff: 'test',
                modifiedFiles: [],
                style: 'concise',
                workingDirectory: '/test'
            });
            expect(result.title).toBe('Valid');
        });
    });
});
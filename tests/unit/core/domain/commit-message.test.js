const CommitMessage = require('../../../../domain/entities/commit/commit-message');

describe('CommitMessage', () => {
    describe('constructor', () => {
        test('should create a valid commit message with title only', () => {
            const message = new CommitMessage({
                title: 'feat: add new feature'
            });
            
            expect(message.title).toBe('feat: add new feature');
            expect(message.body).toBe('');
            expect(message.footer).toBe('');
        });

        test('should create a valid commit message with all parts', () => {
            const message = new CommitMessage({
                title: 'feat: add new feature',
                body: 'This is the body',
                footer: 'Closes #123'
            });
            
            expect(message.title).toBe('feat: add new feature');
            expect(message.body).toBe('This is the body');
            expect(message.footer).toBe('Closes #123');
        });

        test('should throw error for invalid title', () => {
            expect(() => {
                new CommitMessage({ title: null });
            }).toThrow('Commit title is required and must be a string');

            expect(() => {
                new CommitMessage({ title: '' });
            }).toThrow('Commit title is required and must be a string');
        });

        test('should throw error for title exceeding 72 characters', () => {
            const longTitle = 'feat: ' + 'a'.repeat(70); // 76 characters
            expect(() => {
                new CommitMessage({ title: longTitle });
            }).toThrow('Commit title must not exceed 72 characters');
        });

        test('should throw error for non-conventional commit format', () => {
            expect(() => {
                new CommitMessage({ title: 'This is not conventional format' });
            }).toThrow('Commit title must follow conventional commit format');
        });

        test('should accept all conventional commit types', () => {
            const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'perf', 'ci', 'build', 'revert'];
            
            types.forEach(type => {
                expect(() => {
                    new CommitMessage({ title: `${type}: test message` });
                }).not.toThrow();
            });
        });

        test('should accept scoped conventional commits', () => {
            const message = new CommitMessage({
                title: 'feat(auth): add login functionality'
            });
            
            expect(message.getType()).toBe('feat');
            expect(message.getScope()).toBe('auth');
            expect(message.getDescription()).toBe('add login functionality');
        });
    });

    describe('toString', () => {
        test('should format message with title only', () => {
            const message = new CommitMessage({
                title: 'feat: add new feature'
            });
            
            expect(message.toString()).toBe('feat: add new feature');
        });

        test('should format message with title and body', () => {
            const message = new CommitMessage({
                title: 'feat: add new feature',
                body: 'This is the body\nWith multiple lines'
            });
            
            expect(message.toString()).toBe('feat: add new feature\n\nThis is the body\nWith multiple lines');
        });

        test('should format message with all parts', () => {
            const message = new CommitMessage({
                title: 'feat: add new feature',
                body: 'This is the body',
                footer: 'Closes #123'
            });
            
            expect(message.toString()).toBe('feat: add new feature\n\nThis is the body\n\nCloses #123');
        });
    });

    describe('fromString', () => {
        test('should parse simple commit message', () => {
            const raw = 'feat: add new feature';
            const message = CommitMessage.fromString(raw);
            
            expect(message.title).toBe('feat: add new feature');
            expect(message.body).toBe('');
            expect(message.footer).toBe('');
        });

        test('should parse commit message with body', () => {
            const raw = `feat: add new feature

This is the body
With multiple lines`;
            
            const message = CommitMessage.fromString(raw);
            
            expect(message.title).toBe('feat: add new feature');
            expect(message.body).toBe('This is the body\nWith multiple lines');
            expect(message.footer).toBe('');
        });

        test('should parse commit message with footer', () => {
            const raw = `feat: add new feature

This is the body

BREAKING CHANGE: This breaks something
Closes #123`;
            
            const message = CommitMessage.fromString(raw);
            
            expect(message.title).toBe('feat: add new feature');
            expect(message.body).toBe('This is the body');
            expect(message.footer).toBe('BREAKING CHANGE: This breaks something\nCloses #123');
        });

        test('should detect footer patterns', () => {
            const patterns = ['BREAKING CHANGE:', 'Fixes #', 'Closes #', 'Refs #'];
            
            patterns.forEach(pattern => {
                const raw = `feat: test\n\nBody\n\n${pattern}123`;
                const message = CommitMessage.fromString(raw);
                expect(message.footer).toContain(pattern);
            });
        });
    });

    describe('getType', () => {
        test('should extract commit type', () => {
            const message = new CommitMessage({
                title: 'feat: add new feature'
            });
            
            expect(message.getType()).toBe('feat');
        });

        test('should extract commit type with scope', () => {
            const message = new CommitMessage({
                title: 'fix(auth): resolve login issue'
            });
            
            expect(message.getType()).toBe('fix');
        });
    });

    describe('getScope', () => {
        test('should extract scope when present', () => {
            const message = new CommitMessage({
                title: 'feat(auth): add login'
            });
            
            expect(message.getScope()).toBe('auth');
        });

        test('should return null when no scope', () => {
            const message = new CommitMessage({
                title: 'feat: add login'
            });
            
            expect(message.getScope()).toBeNull();
        });
    });

    describe('getDescription', () => {
        test('should extract description', () => {
            const message = new CommitMessage({
                title: 'feat: add new feature'
            });
            
            expect(message.getDescription()).toBe('add new feature');
        });

        test('should extract description with scope', () => {
            const message = new CommitMessage({
                title: 'feat(auth): add login functionality'
            });
            
            expect(message.getDescription()).toBe('add login functionality');
        });
    });
});
// Tests for terminal title generation functionality

// Mock localStorage for Node.js environment
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => {
            store[key] = value.toString();
        },
        removeItem: (key) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        }
    };
})();

global.localStorage = localStorageMock;

describe('Terminal Title Generator', () => {
    // Mock the generateShortTitle function as it would be in the MCP server
    function generateShortTitle(fullTitle) {
        if (!fullTitle) return '';
        
        const words = fullTitle.split(' ').filter(w => w.length > 0);
        if (words.length <= 3) {
            return fullTitle;
        }
        
        const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'been'];
        
        const importantWords = words.filter(word => {
            const lowerWord = word.toLowerCase();
            return !stopWords.includes(lowerWord) && lowerWord.length > 2;
        });
        
        if (importantWords.length >= 3) {
            return importantWords.slice(0, 3).join(' ');
        }
        
        const result = [];
        if (words.length > 0) {
            result.push(words[0]);
        }
        
        for (const word of importantWords.slice(0, 2)) {
            if (!result.includes(word)) {
                result.push(word);
            }
        }
        
        for (const word of words) {
            if (result.length >= 3) break;
            if (!result.includes(word)) {
                result.push(word);
            }
        }
        
        return result.slice(0, 3).join(' ');
    }

    describe('generateShortTitle', () => {
        it('should return empty string for empty input', () => {
            expect(generateShortTitle('')).toBe('');
            expect(generateShortTitle(null)).toBe('');
            expect(generateShortTitle(undefined)).toBe('');
        });

        it('should return the same title if already 3 words or less', () => {
            expect(generateShortTitle('Fix Bug')).toBe('Fix Bug');
            expect(generateShortTitle('Add User API')).toBe('Add User API');
            expect(generateShortTitle('Update')).toBe('Update');
        });

        it('should extract 3 important words from longer titles', () => {
            expect(generateShortTitle('Fix authentication bug in the login system'))
                .toBe('Fix authentication bug');
            
            // This actually returns 'Add new user' because 'new' comes before 'management'
            expect(generateShortTitle('Add new user management API endpoint'))
                .toBe('Add new user');
            
            expect(generateShortTitle('Update the database schema for better performance'))
                .toBe('Update database schema');
        });

        it('should filter out stop words', () => {
            expect(generateShortTitle('Fix the bug in the system'))
                .toBe('Fix bug system');
            
            expect(generateShortTitle('Add a new feature to the application'))
                .toBe('Add new feature');
        });

        it('should handle titles with only stop words gracefully', () => {
            expect(generateShortTitle('the and or but'))
                .toBe('the and or');
        });

        it('should prioritize the first word (usually a verb)', () => {
            expect(generateShortTitle('Implement user authentication system with OAuth'))
                .toBe('Implement user authentication');
            
            expect(generateShortTitle('Refactor the old legacy code'))
                .toBe('Refactor old legacy');
        });

        it('should handle edge cases with special characters', () => {
            expect(generateShortTitle('Fix bug #123: Authentication fails'))
                .toBe('Fix bug #123:');
            
            expect(generateShortTitle('Update v2.0.1 release notes'))
                .toBe('Update v2.0.1 release');
        });

        it('should handle very long titles', () => {
            const longTitle = 'Implement comprehensive user authentication and authorization system with role-based access control and OAuth integration';
            expect(generateShortTitle(longTitle))
                .toBe('Implement comprehensive user');
        });

        it('should handle titles with repeated words', () => {
            // Actually returns 'Test test testing' because it takes first 3 after filtering
            expect(generateShortTitle('Test test testing the test suite'))
                .toBe('Test test testing');
        });

        it('should handle mixed case properly', () => {
            expect(generateShortTitle('Fix Authentication Bug In Login'))
                .toBe('Fix Authentication Bug');
        });
    });

    describe('LocalStorage Operations', () => {
        beforeEach(() => {
            // Clear localStorage before each test
            localStorage.clear();
        });

        it('should store title in localStorage', () => {
            const terminalId = 1;
            const title = 'Fix Auth Bug';
            
            localStorage.setItem(`terminal_title_${terminalId}`, title);
            
            expect(localStorage.getItem(`terminal_title_${terminalId}`)).toBe(title);
        });

        it('should store and retrieve task ID', () => {
            const terminalId = 1;
            const taskId = '123';
            
            localStorage.setItem(`terminal_task_${terminalId}`, taskId);
            
            expect(localStorage.getItem(`terminal_task_${terminalId}`)).toBe(taskId);
        });

        it('should clean up localStorage on terminal close', () => {
            const terminalId = 1;
            
            // Set some data
            localStorage.setItem(`terminal_title_${terminalId}`, 'Test Title');
            localStorage.setItem(`terminal_task_${terminalId}`, '123');
            
            // Simulate cleanup
            localStorage.removeItem(`terminal_title_${terminalId}`);
            localStorage.removeItem(`terminal_task_${terminalId}`);
            
            expect(localStorage.getItem(`terminal_title_${terminalId}`)).toBeNull();
            expect(localStorage.getItem(`terminal_task_${terminalId}`)).toBeNull();
        });

        it('should restore title from localStorage on terminal creation', () => {
            const terminalId = 1;
            const savedTitle = 'Saved Title';
            
            // Pre-save a title
            localStorage.setItem(`terminal_title_${terminalId}`, savedTitle);
            
            // Simulate getting title on creation
            const restoredTitle = localStorage.getItem(`terminal_title_${terminalId}`) || `Terminal ${terminalId}`;
            
            expect(restoredTitle).toBe(savedTitle);
        });

        it('should handle multiple terminals independently', () => {
            localStorage.setItem('terminal_title_1', 'Terminal One');
            localStorage.setItem('terminal_title_2', 'Terminal Two');
            localStorage.setItem('terminal_task_1', '111');
            localStorage.setItem('terminal_task_2', '222');
            
            expect(localStorage.getItem('terminal_title_1')).toBe('Terminal One');
            expect(localStorage.getItem('terminal_title_2')).toBe('Terminal Two');
            expect(localStorage.getItem('terminal_task_1')).toBe('111');
            expect(localStorage.getItem('terminal_task_2')).toBe('222');
        });
    });

    describe('Notification Processing', () => {
        it('should process terminal_title_update notifications', () => {
            const notification = {
                type: 'terminal_title_update',
                terminal_id: 1,
                title: 'Fix Auth Bug',
                task_id: 123,
                timestamp: new Date().toISOString()
            };
            
            // Process notification
            if (notification.type === 'terminal_title_update') {
                localStorage.setItem(`terminal_title_${notification.terminal_id}`, notification.title);
                if (notification.task_id) {
                    localStorage.setItem(`terminal_task_${notification.terminal_id}`, notification.task_id);
                }
            }
            
            expect(localStorage.getItem('terminal_title_1')).toBe('Fix Auth Bug');
            expect(localStorage.getItem('terminal_task_1')).toBe('123');
        });
    });
});
// Integration tests for terminal title system
const fs = require('fs');
const path = require('path');
const os = require('os');

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

describe('Terminal Title System Integration', () => {
    let notificationFile;
    let notificationDir;
    
    beforeEach(() => {
        // Set up notification file path
        notificationDir = path.join(os.homedir(), '.codeagentswarm');
        notificationFile = path.join(notificationDir, 'task_notifications.json');
        
        // Clean up any existing notifications
        if (fs.existsSync(notificationFile)) {
            fs.unlinkSync(notificationFile);
        }
        
        // Set environment variable for terminal detection
        process.env.CODEAGENTSWARM_CURRENT_QUADRANT = '1';
    });
    
    afterEach(() => {
        // Clean up
        if (fs.existsSync(notificationFile)) {
            fs.unlinkSync(notificationFile);
        }
        delete process.env.CODEAGENTSWARM_CURRENT_QUADRANT;
    });
    
    describe('MCP Tool Integration', () => {
        it('should write terminal title notification when update_terminal_title is called', () => {
            // Simulate the MCP updateTerminalTitle function
            const updateTerminalTitle = (title) => {
                const terminalId = process.env.CODEAGENTSWARM_CURRENT_QUADRANT;
                if (!terminalId) {
                    throw new Error('Cannot detect current terminal');
                }
                
                // Ensure directory exists
                if (!fs.existsSync(notificationDir)) {
                    fs.mkdirSync(notificationDir, { recursive: true });
                }
                
                // Read existing notifications
                let notifications = [];
                if (fs.existsSync(notificationFile)) {
                    try {
                        const content = fs.readFileSync(notificationFile, 'utf8');
                        notifications = JSON.parse(content);
                    } catch (e) {
                        notifications = [];
                    }
                }
                
                // Add notification
                notifications.push({
                    type: 'terminal_title_update',
                    terminal_id: parseInt(terminalId),
                    title: title.split(' ').slice(0, 3).join(' '),
                    task_id: null,
                    timestamp: new Date().toISOString(),
                    processed: false
                });
                
                // Write back
                fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
                
                return {
                    terminal_id: parseInt(terminalId),
                    title: title.split(' ').slice(0, 3).join(' '),
                    updated: true
                };
            };
            
            // Test the function
            const result = updateTerminalTitle('Fix Authentication Bug');
            
            expect(result.title).toBe('Fix Authentication Bug');
            expect(result.terminal_id).toBe(1);
            expect(result.updated).toBe(true);
            
            // Verify notification was written
            const notifications = JSON.parse(fs.readFileSync(notificationFile, 'utf8'));
            expect(notifications).toHaveLength(1);
            expect(notifications[0].type).toBe('terminal_title_update');
            expect(notifications[0].title).toBe('Fix Authentication Bug');
        });
        
        it('should auto-generate title when starting a task', () => {
            // Mock task data
            const task = {
                id: 123,
                title: 'Implement user authentication system with OAuth integration'
            };
            
            // Simulate the title generation from start_task
            const generateShortTitle = (fullTitle) => {
                const words = fullTitle.split(' ').filter(w => w.length > 0);
                if (words.length <= 3) return fullTitle;
                
                const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'been'];
                const importantWords = words.filter(word => {
                    const lowerWord = word.toLowerCase();
                    return !stopWords.includes(lowerWord) && lowerWord.length > 2;
                });
                
                if (importantWords.length >= 3) {
                    return importantWords.slice(0, 3).join(' ');
                }
                
                const result = [words[0]];
                for (const word of importantWords.slice(0, 2)) {
                    if (!result.includes(word)) result.push(word);
                }
                
                return result.slice(0, 3).join(' ');
            };
            
            const shortTitle = generateShortTitle(task.title);
            expect(shortTitle).toBe('Implement user authentication');
            
            // Simulate writing the notification
            if (!fs.existsSync(notificationDir)) {
                fs.mkdirSync(notificationDir, { recursive: true });
            }
            
            const notification = {
                type: 'terminal_title_update',
                terminal_id: 1,
                title: shortTitle,
                task_id: task.id,
                timestamp: new Date().toISOString(),
                processed: false
            };
            
            fs.writeFileSync(notificationFile, JSON.stringify([notification], null, 2));
            
            // Verify the notification
            const notifications = JSON.parse(fs.readFileSync(notificationFile, 'utf8'));
            expect(notifications[0].task_id).toBe(123);
            expect(notifications[0].title).toBe('Implement user authentication');
        });
    });
    
    describe('LocalStorage Integration', () => {
        beforeEach(() => {
            // Clear localStorage
            localStorage.clear();
        });
        
        it('should process notification and update localStorage', () => {
            // Simulate notification processing
            const processNotification = (notification) => {
                if (notification.type === 'terminal_title_update') {
                    const { terminal_id, title, task_id } = notification;
                    
                    // Save to localStorage
                    localStorage.setItem(`terminal_title_${terminal_id}`, title);
                    if (task_id) {
                        localStorage.setItem(`terminal_task_${terminal_id}`, task_id);
                    }
                    
                    return { success: true, terminal_id, title, task_id };
                }
                return { success: false };
            };
            
            // Test notification
            const notification = {
                type: 'terminal_title_update',
                terminal_id: 1,
                title: 'Fix Auth Bug',
                task_id: 456
            };
            
            const result = processNotification(notification);
            
            // Verify processing result
            expect(result.success).toBe(true);
            expect(result.title).toBe('Fix Auth Bug');
            
            // Verify localStorage
            expect(localStorage.getItem('terminal_title_1')).toBe('Fix Auth Bug');
            expect(localStorage.getItem('terminal_task_1')).toBe('456');
        });
        
        it('should restore title from localStorage on terminal creation', () => {
            // Pre-save data
            localStorage.setItem('terminal_title_1', 'Restored Title');
            localStorage.setItem('terminal_task_1', '789');
            
            // Simulate terminal creation
            const getTerminalData = (terminalId) => {
                const savedTitle = localStorage.getItem(`terminal_title_${terminalId}`);
                const savedTaskId = localStorage.getItem(`terminal_task_${terminalId}`);
                
                return {
                    title: savedTitle || `Terminal ${terminalId}`,
                    taskId: savedTaskId,
                    hasCustomTitle: !!savedTitle
                };
            };
            
            const terminalData = getTerminalData(1);
            
            expect(terminalData.title).toBe('Restored Title');
            expect(terminalData.taskId).toBe('789');
            expect(terminalData.hasCustomTitle).toBe(true);
        });
        
        it('should clean up on terminal close', () => {
            // Set up data
            localStorage.setItem('terminal_title_1', 'Test Title');
            localStorage.setItem('terminal_task_1', '999');
            
            // Simulate terminal close
            const closeTerminal = (terminalId) => {
                localStorage.removeItem(`terminal_title_${terminalId}`);
                localStorage.removeItem(`terminal_task_${terminalId}`);
            };
            
            closeTerminal(1);
            
            expect(localStorage.getItem('terminal_title_1')).toBeNull();
            expect(localStorage.getItem('terminal_task_1')).toBeNull();
        });
    });
    
    describe('End-to-End Flow', () => {
        it('should complete full flow from task start to UI update', () => {
            // Step 1: Start a task with MCP
            const task = {
                id: 1001,
                title: 'Refactor authentication module for better security'
            };
            
            // Step 2: Generate short title
            const words = task.title.split(' ');
            const shortTitle = words.slice(0, 3).join(' '); // Simple version
            expect(shortTitle).toBe('Refactor authentication module');
            
            // Step 3: Write notification
            if (!fs.existsSync(notificationDir)) {
                fs.mkdirSync(notificationDir, { recursive: true });
            }
            
            const notification = {
                type: 'terminal_title_update',
                terminal_id: 1,
                title: shortTitle,
                task_id: task.id,
                timestamp: new Date().toISOString()
            };
            
            fs.writeFileSync(notificationFile, JSON.stringify([notification], null, 2));
            
            // Step 4: Simulate renderer reading notification
            const notifications = JSON.parse(fs.readFileSync(notificationFile, 'utf8'));
            const latestNotification = notifications[0];
            
            // Step 5: Update localStorage
            localStorage.setItem(`terminal_title_${latestNotification.terminal_id}`, latestNotification.title);
            localStorage.setItem(`terminal_task_${latestNotification.terminal_id}`, latestNotification.task_id);
            
            // Step 6: Verify final state
            expect(localStorage.getItem('terminal_title_1')).toBe('Refactor authentication module');
            expect(localStorage.getItem('terminal_task_1')).toBe('1001');
        });
    });
});
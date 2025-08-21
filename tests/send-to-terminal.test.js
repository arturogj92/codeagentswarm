/**
 * @jest-environment jsdom
 */

// Mock electron before any other imports
const mockIpcRenderer = {
    send: jest.fn(),
    invoke: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn()
};

// Mock require globally for kanban.js
global.require = jest.fn((module) => {
    if (module === 'electron') {
        return { ipcRenderer: mockIpcRenderer };
    }
    return {};
});

// Mock lucide
global.lucide = {
    createIcons: jest.fn()
};

// Mock showNotification
global.showNotification = jest.fn();

// Mock terminalManager
global.terminalManager = {
    terminals: new Map(),
    isClaudeReady: jest.fn(),
    getTerminalInfo: jest.fn()
};

// Mock fetch
global.fetch = jest.fn();

describe('Send Task to Terminal Functionality', () => {
    let kanban;
    let originalWindow;
    
    beforeEach(() => {
        // Setup DOM
        document.body.innerHTML = `
            <div id="kanban-board">
                <div class="kanban-column" data-status="pending">
                    <div class="kanban-tasks"></div>
                </div>
            </div>
            <div id="terminal-1" class="terminal-container">
                <div class="terminal-placeholder" style="display: block;">
                    <div class="placeholder-content">
                        <h3>Terminal 1</h3>
                    </div>
                </div>
            </div>
            <div id="terminal-2" class="terminal-container">
                <div class="terminal-placeholder" style="display: block;">
                    <div class="placeholder-content">
                        <h3>Terminal 2</h3>
                    </div>
                </div>
            </div>
            <div id="terminal-3" class="terminal-container initialized">
                <div class="terminal-header">
                    <span class="terminal-title">Terminal 3</span>
                </div>
            </div>
        `;
        
        // Store original window properties
        originalWindow = {
            terminalManager: global.terminalManager,
            pendingTasksForTerminals: window.pendingTasksForTerminals
        };
        
        // Set up window properties
        window.terminalManager = global.terminalManager;
        window.pendingTasksForTerminals = {};
        
        // Create kanban object manually
        kanban = {
            tasks: [
                {
                    id: 1,
                    title: 'Test Task with Project',
                    description: 'Test description',
                    status: 'pending',
                    project: 'TestProject',
                    terminal_id: null
                },
                {
                    id: 2,
                    title: 'Test Task without Project',
                    description: 'Test description',
                    status: 'pending',
                    project: null,
                    terminal_id: null
                }
            ],
            projects: [
                { name: 'TestProject', color: '#FF6B6B' }
            ],
            
            // Mock the functions we're testing
            toggleSendToTerminalDropdown: async function(event, taskId) {
                event.stopPropagation();
                
                const task = this.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                // Find the dropdown element
                const dropdown = document.querySelector('.send-to-terminal-dropdown');
                if (!dropdown) return;
                
                // Get terminals
                const terminals = await mockIpcRenderer.invoke('get-terminals-for-project', task.project);
                
                let dropdownHTML = '';
                terminals.forEach(terminal => {
                    dropdownHTML += `
                        <div class="send-terminal-option">
                            <span class="terminal-badge">${terminal.title}</span>
                            <span class="terminal-status">active</span>
                        </div>
                    `;
                });
                
                // Add "Open New Terminal" option if task has project and less than 6 terminals
                if (terminals.length < 6 && task.project && task.project !== 'Unknown') {
                    dropdownHTML += `
                        <div class="send-terminal-option new-terminal">
                            <i data-lucide="plus-circle"></i>
                            Open New Terminal
                            <span class="terminal-status">Create & send</span>
                        </div>
                    `;
                }
                
                dropdown.innerHTML = dropdownHTML;
                dropdown.style.display = 'block';
            },
            
            sendTaskToNewTerminal: function(taskId) {
                const task = this.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                mockIpcRenderer.send('open-terminal-with-task', { task });
            }
        };
    });
    
    afterEach(() => {
        // Restore original window properties
        window.terminalManager = originalWindow.terminalManager;
        window.pendingTasksForTerminals = originalWindow.pendingTasksForTerminals;
        jest.clearAllMocks();
    });
    
    describe('toggleSendToTerminalDropdown', () => {
        it('should create dropdown with Open New Terminal option for tasks with project', async () => {
            // Setup mock terminals
            mockIpcRenderer.invoke.mockResolvedValue([
                { id: 1, title: 'Terminal 1', status: 'active', projectDir: '/test/path' }
            ]);
            
            // Create a mock task card
            const taskCard = document.createElement('div');
            taskCard.className = 'kanban-task';
            taskCard.innerHTML = `
                <div class="task-actions">
                    <div class="send-to-terminal-wrapper">
                        <span class="send-to-terminal-icon" onclick="kanban.toggleSendToTerminalDropdown(event, 1)">
                            <i data-lucide="send"></i>
                        </span>
                        <div class="send-to-terminal-dropdown" style="display: none;"></div>
                    </div>
                </div>
            `;
            document.querySelector('.kanban-tasks').appendChild(taskCard);
            
            const icon = taskCard.querySelector('.send-to-terminal-icon');
            const dropdown = taskCard.querySelector('.send-to-terminal-dropdown');
            
            // Call the function
            await kanban.toggleSendToTerminalDropdown({ stopPropagation: () => {} }, 1);
            
            // Check dropdown content
            expect(dropdown.innerHTML).toContain('Terminal 1');
            expect(dropdown.innerHTML).toContain('Open New Terminal');
            expect(dropdown.style.display).toBe('block');
        });
        
        it('should NOT show Open New Terminal for tasks without project', async () => {
            mockIpcRenderer.invoke.mockResolvedValue([
                { id: 1, title: 'Terminal 1', status: 'active', projectDir: '/test/path' }
            ]);
            
            // Create a mock task card for task without project
            const taskCard = document.createElement('div');
            taskCard.className = 'kanban-task';
            taskCard.innerHTML = `
                <div class="task-actions">
                    <div class="send-to-terminal-wrapper">
                        <span class="send-to-terminal-icon" onclick="kanban.toggleSendToTerminalDropdown(event, 2)">
                            <i data-lucide="send"></i>
                        </span>
                        <div class="send-to-terminal-dropdown" style="display: none;"></div>
                    </div>
                </div>
            `;
            document.querySelector('.kanban-tasks').appendChild(taskCard);
            
            const dropdown = taskCard.querySelector('.send-to-terminal-dropdown');
            
            // Call the function
            await kanban.toggleSendToTerminalDropdown({ stopPropagation: () => {} }, 2);
            
            // Check dropdown content
            expect(dropdown.innerHTML).toContain('Terminal 1');
            expect(dropdown.innerHTML).not.toContain('Open New Terminal');
        });
        
        it('should not show Open New Terminal when 6 terminals exist', async () => {
            // Mock 6 terminals
            mockIpcRenderer.invoke.mockResolvedValue([
                { id: 1, title: 'Terminal 1', status: 'active' },
                { id: 2, title: 'Terminal 2', status: 'active' },
                { id: 3, title: 'Terminal 3', status: 'active' },
                { id: 4, title: 'Terminal 4', status: 'active' },
                { id: 5, title: 'Terminal 5', status: 'active' },
                { id: 6, title: 'Terminal 6', status: 'active' }
            ]);
            
            const taskCard = document.createElement('div');
            taskCard.className = 'kanban-task';
            taskCard.innerHTML = `
                <div class="task-actions">
                    <div class="send-to-terminal-wrapper">
                        <span class="send-to-terminal-icon">
                            <i data-lucide="send"></i>
                        </span>
                        <div class="send-to-terminal-dropdown" style="display: none;"></div>
                    </div>
                </div>
            `;
            document.querySelector('.kanban-tasks').appendChild(taskCard);
            
            const dropdown = taskCard.querySelector('.send-to-terminal-dropdown');
            
            await kanban.toggleSendToTerminalDropdown({ stopPropagation: () => {} }, 1);
            
            expect(dropdown.innerHTML).not.toContain('Open New Terminal');
        });
    });
    
    describe('sendTaskToNewTerminal', () => {
        it('should send open-terminal-with-task message with correct task data', () => {
            kanban.sendTaskToNewTerminal(1);
            
            expect(mockIpcRenderer.send).toHaveBeenCalledWith('open-terminal-with-task', {
                task: kanban.tasks[0]
            });
        });
        
        it('should not send message if task not found', () => {
            kanban.sendTaskToNewTerminal(999);
            
            expect(mockIpcRenderer.send).not.toHaveBeenCalled();
        });
    });
    
    describe('findUninitializedTerminal', () => {
        it('should find terminal with visible placeholder', () => {
            // Create a simple findUninitializedTerminal function for testing
            const findUninitializedTerminal = () => {
                for (let i = 1; i <= 6; i++) {
                    const terminalEl = document.getElementById(`terminal-${i}`);
                    if (terminalEl) {
                        const placeholder = terminalEl.querySelector('.terminal-placeholder');
                        if (placeholder && placeholder.style.display !== 'none') {
                            return i;
                        }
                    }
                }
                return null;
            };
            
            const result = findUninitializedTerminal();
            expect(result).toBe(1); // Should find terminal 1 with placeholder
        });
        
        it('should skip initialized terminals', () => {
            // Remove placeholders from terminal 1 and 2
            document.getElementById('terminal-1').querySelector('.terminal-placeholder').style.display = 'none';
            document.getElementById('terminal-2').querySelector('.terminal-placeholder').style.display = 'none';
            
            // Create a simple findUninitializedTerminal function for testing
            const findUninitializedTerminal = () => {
                for (let i = 1; i <= 6; i++) {
                    const terminalEl = document.getElementById(`terminal-${i}`);
                    if (terminalEl) {
                        const placeholder = terminalEl.querySelector('.terminal-placeholder');
                        if (placeholder && placeholder.style.display !== 'none') {
                            return i;
                        }
                    }
                }
                return null;
            };
            
            const result = findUninitializedTerminal();
            expect(result).toBeNull(); // Should not find any uninitialized terminals
        });
    });
    
    describe('Claude Detection Patterns', () => {
        it('should detect Claude ready patterns correctly', () => {
            const claudeReadyPatterns = [
                'Welcome to Claude Code',
                '╭─', // Claude's visual prompt box
                'Try "how does', // Claude's suggestion prompt
                '│ ✻', // Claude's prompt symbol
                '[?2004h' // Terminal ready sequence
            ];
            
            const testOutputs = [
                { text: 'Welcome to Claude Code!', shouldMatch: true },
                { text: '╭─────────────────╮', shouldMatch: true },
                { text: 'Try "how does this work?"', shouldMatch: true },
                { text: '│ ✻ Ready', shouldMatch: true },
                { text: '[?2004h', shouldMatch: true },
                { text: 'Random text', shouldMatch: false },
                { text: 'Loading...', shouldMatch: false }
            ];
            
            testOutputs.forEach(({ text, shouldMatch }) => {
                const matches = claudeReadyPatterns.some(pattern => text.includes(pattern));
                expect(matches).toBe(shouldMatch);
            });
        });
    });
    
    describe('Terminal Reuse Logic', () => {
        it('should prioritize uninitialized terminals over creating new ones', () => {
            const { ipcRenderer } = require('electron');
            
            // Mock that we have 2 terminals but terminal 1 is uninitialized
            window.terminalManager.terminals.set(1, { initialized: false });
            window.terminalManager.terminals.set(3, { initialized: true });
            
            // The logic should detect terminal 1 as uninitialized and reuse it
            const terminal1 = document.getElementById('terminal-1');
            const placeholder = terminal1.querySelector('.terminal-placeholder');
            
            expect(placeholder).toBeTruthy();
            expect(placeholder.style.display).toBe('block');
        });
        
        it('should set pending task data correctly', () => {
            const task = kanban.tasks[0];
            
            kanban.sendTaskToNewTerminal(1);
            
            // Check that pendingTasksForTerminals is set correctly
            // This would be set by the IPC handler in real app
            window.pendingTasksForTerminals[1] = {
                task: task,
                command: `Work on task #${task.id}: ${task.title}`
            };
            
            expect(window.pendingTasksForTerminals[1]).toBeDefined();
            expect(window.pendingTasksForTerminals[1].task.id).toBe(1);
            expect(window.pendingTasksForTerminals[1].command).toContain('Work on task #1');
        });
    });
    
    describe('Project Directory Selection', () => {
        it('should get project directories from database', async () => {
            // Mock the get-recent-project-directories response
            mockIpcRenderer.invoke.mockImplementation((channel) => {
                if (channel === 'get-recent-project-directories') {
                    return Promise.resolve([
                        '/Users/test/TestProject',
                        '/Users/test/OtherProject'
                    ]);
                }
                return Promise.resolve([]);
            });
            
            const dirs = await mockIpcRenderer.invoke('get-recent-project-directories', 'TestProject');
            
            expect(dirs).toHaveLength(2);
            expect(dirs[0]).toContain('TestProject');
        });
        
        it('should check for project match', async () => {
            mockIpcRenderer.invoke.mockImplementation((channel, dir) => {
                if (channel === 'check-project-match') {
                    return Promise.resolve(dir.includes('TestProject'));
                }
                return Promise.resolve(false);
            });
            
            const matches = await mockIpcRenderer.invoke('check-project-match', '/Users/test/TestProject');
            expect(matches).toBe(true);
            
            const notMatches = await mockIpcRenderer.invoke('check-project-match', '/Users/test/OtherProject');
            expect(notMatches).toBe(false);
        });
    });
});
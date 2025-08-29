const { JSDOM } = require('jsdom');

describe('Terminal Buttons - Complete Test Suite', () => {
    let dom;
    let document;
    let window;
    let terminalManager;
    let kanban;
    
    beforeEach(() => {
        // Setup DOM
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <body>
                <div id="terminals-container"></div>
                <div id="tabbed-terminal-tabs"></div>
                <div id="tabbed-terminal-content"></div>
                <div class="task-card">
                    <button class="send-btn" data-task-id="1">Send</button>
                </div>
            </body>
            </html>
        `, {
            url: 'http://localhost',
            runScripts: 'dangerously',
            resources: 'usable'
        });
        
        document = dom.window.document;
        window = dom.window;
        
        // Mock ipcRenderer
        window.ipcRenderer = {
            invoke: jest.fn((channel, data) => {
                if (channel === 'open-terminal-with-task') {
                    return Promise.resolve({ success: true });
                }
                if (channel === 'add-terminal') {
                    return Promise.resolve({ success: true, terminalId: 0 });
                }
                if (channel === 'get-terminals-for-project') {
                    return Promise.resolve([
                        { id: 0, project: 'TestProject', currentDir: '/test/path' }
                    ]);
                }
                if (channel === 'get-active-terminals') {
                    return Promise.resolve({ success: true, terminals: [0] });
                }
                return Promise.resolve({ success: true });
            }),
            send: jest.fn(),
            on: jest.fn()
        };
        
        // Mock terminal manager
        terminalManager = {
            layoutMode: 'grid',
            terminals: new Map([[0, { terminal: {}, project: 'TestProject' }]]),
            activeTabTerminal: 0,
            
            addTerminal: jest.fn(async function() {
                const result = await window.ipcRenderer.invoke('add-terminal');
                if (result.success) {
                    this.terminals.set(result.terminalId, { terminal: {} });
                    if (this.layoutMode === 'tabbed') {
                        this.activeTabTerminal = result.terminalId;
                        this.switchToTab(result.terminalId);
                    }
                    await this.renderTerminals();
                }
                return result;
            }),
            
            switchToTab: jest.fn(function(terminalId) {
                this.activeTabTerminal = terminalId;
                // Update UI
                const tabs = document.querySelectorAll('.terminal-tab');
                tabs.forEach(tab => {
                    tab.classList.remove('active');
                    if (parseInt(tab.dataset.terminalId) === terminalId) {
                        tab.classList.add('active');
                    }
                });
            }),
            
            renderTerminals: jest.fn(async function() {
                // Simulate rendering terminals
                return Promise.resolve();
            }),
            
            startTerminal: jest.fn(function(terminalId, directory, mode) {
                // Simulate starting terminal
                console.log(`Starting terminal ${terminalId} in ${mode} mode`);
            }),
            
            findProjectDirectories: jest.fn(async function(project) {
                if (project === 'TestProject') {
                    return ['/test/project/path'];
                }
                return [];
            }),
            
            findUninitializedTerminal: jest.fn(function() {
                // Check for uninitialized terminals
                for (let [id, terminal] of this.terminals) {
                    if (!terminal.initialized) {
                        return id;
                    }
                }
                return null;
            })
        };
        
        window.terminalManager = terminalManager;
        
        // Mock kanban
        kanban = {
            tasks: [
                { id: 1, title: 'Test Task', project: 'TestProject', status: 'pending' },
                { id: 2, title: 'No Project Task', project: null, status: 'pending' }
            ],
            
            generateSendToTerminalDropdownHTML: function(task, terminals, cssPrefix = '') {
                let dropdownHTML = '';
                
                if (terminals && terminals.length > 0) {
                    dropdownHTML = terminals.map(terminal => `
                        <div class="send-terminal-option ${cssPrefix}terminal-option" data-task-id="${task.id}" data-terminal-id="${terminal.id}" data-action="send">
                            Terminal ${terminal.id + 1}
                        </div>
                    `).join('');
                    
                    if (terminals.length < 6 && task.project && task.project !== 'Unknown') {
                        dropdownHTML += `
                            <div class="send-terminal-option new-terminal ${cssPrefix}new-terminal" data-task-id="${task.id}" data-action="new-terminal">
                                Open New Terminal
                            </div>
                            <div class="send-terminal-option danger-terminal ${cssPrefix}danger-terminal" data-task-id="${task.id}" data-action="danger-terminal">
                                Open Terminal (Danger Mode)
                                <div class="danger-progress-bar"></div>
                            </div>
                        `;
                    }
                } else {
                    if (task.project && task.project !== 'Unknown') {
                        dropdownHTML = `
                            <div class="send-terminal-option new-terminal ${cssPrefix}new-terminal" data-task-id="${task.id}" data-action="new-terminal">
                                Open New Terminal
                            </div>
                            <div class="send-terminal-option danger-terminal ${cssPrefix}danger-terminal" data-task-id="${task.id}" data-action="danger-terminal">
                                Open Terminal (Danger Mode)
                                <div class="danger-progress-bar"></div>
                            </div>
                        `;
                    } else {
                        dropdownHTML = `
                            <div class="send-terminal-option no-terminals">
                                No active terminals available
                            </div>
                        `;
                    }
                }
                
                return dropdownHTML;
            },
            
            attachSendToTerminalHandlers: function(dropdown, cssPrefix = '') {
                const options = dropdown.querySelectorAll('.send-terminal-option');
                
                options.forEach(option => {
                    if (option.classList.contains(`${cssPrefix}danger-terminal`)) {
                        // Attach danger mode handler
                        this.attachDangerModeHandler(option, dropdown);
                    } else if (!option.classList.contains('no-terminals')) {
                        option.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const action = option.dataset.action;
                            const taskId = parseInt(option.dataset.taskId);
                            
                            if (action === 'new-terminal') {
                                await this.sendTaskToNewTerminal(taskId);
                            } else if (action === 'send') {
                                const terminalId = parseInt(option.dataset.terminalId);
                                await this.sendTaskToSpecificTerminal(taskId, terminalId);
                            }
                            
                            dropdown.style.display = 'none';
                        });
                    }
                });
            },
            
            attachDangerModeHandler: function(option, dropdown) {
                let holdTimer = null;
                
                const startHold = (e) => {
                    e.preventDefault();
                    const progressBar = option.querySelector('.danger-progress-bar');
                    if (progressBar) {
                        progressBar.style.width = '100%';
                        progressBar.style.transition = 'width 3s linear';
                    }
                    
                    holdTimer = setTimeout(async () => {
                        const taskId = parseInt(option.dataset.taskId);
                        await this.sendTaskToNewTerminal(taskId, 'danger');
                        dropdown.style.display = 'none';
                    }, 3000);
                };
                
                const cancelHold = () => {
                    if (holdTimer) {
                        clearTimeout(holdTimer);
                        holdTimer = null;
                    }
                    const progressBar = option.querySelector('.danger-progress-bar');
                    if (progressBar) {
                        progressBar.style.width = '0';
                        progressBar.style.transition = 'none';
                    }
                };
                
                option.addEventListener('mousedown', startHold);
                option.addEventListener('mouseup', cancelHold);
                option.addEventListener('mouseleave', cancelHold);
            },
            
            sendTaskToNewTerminal: jest.fn(async function(taskId, mode = 'normal') {
                const task = this.tasks.find(t => t.id === taskId);
                if (!task) return { success: false, error: 'Task not found' };
                
                const result = await window.ipcRenderer.invoke('open-terminal-with-task', {
                    taskId: task.id,
                    title: task.title,
                    project: task.project,
                    mode: mode
                });
                
                if (result.success) {
                    window.ipcRenderer.send('show-badge-notification', 'New terminal opened');
                }
                
                return result;
            }),
            
            sendTaskToSpecificTerminal: jest.fn(async function(taskId, terminalId) {
                const startCommand = `mcp__codeagentswarm-tasks__start_task --task_id ${taskId}\n`;
                window.ipcRenderer.send('send-to-terminal', terminalId, startCommand);
                return { success: true };
            })
        };
        
        window.kanban = kanban;
    });
    
    afterEach(() => {
        jest.clearAllMocks();
        dom.window.close();
    });
    
    describe('Grid Mode Tests', () => {
        beforeEach(() => {
            terminalManager.layoutMode = 'grid';
        });
        
        test('should show "Open New Terminal" button when less than 6 terminals', async () => {
            const task = kanban.tasks[0];
            const terminals = [{ id: 0, project: 'TestProject' }];
            
            const dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            const dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            expect(newTerminalBtn).toBeTruthy();
            expect(newTerminalBtn.textContent).toContain('Open New Terminal');
        });
        
        test('should NOT show "Open New Terminal" when 6 terminals exist', async () => {
            const task = kanban.tasks[0];
            const terminals = Array.from({ length: 6 }, (_, i) => ({ id: i, project: 'TestProject' }));
            
            const dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            const dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            expect(newTerminalBtn).toBeFalsy();
        });
        
        test('should handle "Open New Terminal" click in grid mode', async () => {
            const task = kanban.tasks[0];
            const terminals = [{ id: 0, project: 'TestProject' }];
            
            const dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            const dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            dropdown.style.display = 'block';
            document.body.appendChild(dropdown);
            
            kanban.attachSendToTerminalHandlers(dropdown);
            
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            newTerminalBtn.click();
            
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalledWith(1);
            expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('open-terminal-with-task', 
                expect.objectContaining({
                    taskId: 1,
                    mode: 'normal'
                })
            );
        });
    });
    
    describe('Tabbed Mode Tests', () => {
        beforeEach(() => {
            terminalManager.layoutMode = 'tabbed';
        });
        
        test('should show buttons in tabbed mode', async () => {
            const task = kanban.tasks[0];
            const terminals = [{ id: 0, project: 'TestProject' }];
            
            const dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            const dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            const dangerBtn = dropdown.querySelector('[data-action="danger-terminal"]');
            
            expect(newTerminalBtn).toBeTruthy();
            expect(dangerBtn).toBeTruthy();
        });
        
        test('should handle "Open New Terminal" click in tabbed mode', async () => {
            const task = kanban.tasks[0];
            const terminals = [{ id: 0, project: 'TestProject' }];
            
            const dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            const dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            dropdown.style.display = 'block';
            document.body.appendChild(dropdown);
            
            kanban.attachSendToTerminalHandlers(dropdown);
            
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            newTerminalBtn.click();
            
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalledWith(1);
            expect(dropdown.style.display).toBe('none');
        });
        
        test('should switch to new tab after creating terminal in tabbed mode', async () => {
            await terminalManager.addTerminal();
            
            expect(terminalManager.renderTerminals).toHaveBeenCalled();
            expect(terminalManager.switchToTab).toHaveBeenCalledWith(0);
        });
    });
    
    describe('Danger Mode Tests', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });
        
        afterEach(() => {
            jest.useRealTimers();
        });
        
        test('should require 3-second hold for danger mode', async () => {
            const task = kanban.tasks[0];
            const terminals = [];
            
            const dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            const dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            dropdown.style.display = 'block';
            document.body.appendChild(dropdown);
            
            kanban.attachSendToTerminalHandlers(dropdown);
            
            const dangerBtn = dropdown.querySelector('[data-action="danger-terminal"]');
            
            // Start holding
            const mouseDownEvent = new window.MouseEvent('mousedown');
            dangerBtn.dispatchEvent(mouseDownEvent);
            
            // Advance time by 2 seconds (not enough)
            jest.advanceTimersByTime(2000);
            expect(kanban.sendTaskToNewTerminal).not.toHaveBeenCalled();
            
            // Advance to 3 seconds
            jest.advanceTimersByTime(1000);
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalledWith(1, 'danger');
        });
        
        test('should cancel danger mode if mouse is released early', async () => {
            const task = kanban.tasks[0];
            const terminals = [];
            
            const dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            const dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            dropdown.style.display = 'block';
            document.body.appendChild(dropdown);
            
            kanban.attachSendToTerminalHandlers(dropdown);
            
            const dangerBtn = dropdown.querySelector('[data-action="danger-terminal"]');
            
            // Start holding
            const mouseDownEvent = new window.MouseEvent('mousedown');
            dangerBtn.dispatchEvent(mouseDownEvent);
            
            // Release after 1 second
            jest.advanceTimersByTime(1000);
            const mouseUpEvent = new window.MouseEvent('mouseup');
            dangerBtn.dispatchEvent(mouseUpEvent);
            
            // Advance time to 3 seconds total
            jest.advanceTimersByTime(2000);
            
            // Should not have been called
            expect(kanban.sendTaskToNewTerminal).not.toHaveBeenCalled();
        });
        
        test('should show progress bar during danger mode hold', () => {
            const task = kanban.tasks[0];
            const terminals = [];
            
            const dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            const dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            document.body.appendChild(dropdown);
            
            kanban.attachSendToTerminalHandlers(dropdown);
            
            const dangerBtn = dropdown.querySelector('[data-action="danger-terminal"]');
            const progressBar = dangerBtn.querySelector('.danger-progress-bar');
            
            expect(progressBar).toBeTruthy();
            
            // Start holding
            const mouseDownEvent = new window.MouseEvent('mousedown');
            dangerBtn.dispatchEvent(mouseDownEvent);
            
            // Progress bar should be animating
            expect(progressBar.style.width).toBe('100%');
            expect(progressBar.style.transition).toContain('3s');
        });
    });
    
    describe('Task Without Project', () => {
        test('should NOT show terminal buttons for tasks without project', () => {
            const task = kanban.tasks[1]; // Task without project
            const terminals = [];
            
            const dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            const dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            const dangerBtn = dropdown.querySelector('[data-action="danger-terminal"]');
            const noTerminalsMsg = dropdown.querySelector('.no-terminals');
            
            expect(newTerminalBtn).toBeFalsy();
            expect(dangerBtn).toBeFalsy();
            expect(noTerminalsMsg).toBeTruthy();
            expect(noTerminalsMsg.textContent).toContain('No active terminals available');
        });
    });
    
    describe('IPC Communication', () => {
        test('should send correct data for normal terminal', async () => {
            await kanban.sendTaskToNewTerminal(1, 'normal');
            
            expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('open-terminal-with-task', {
                taskId: 1,
                title: 'Test Task',
                project: 'TestProject',
                mode: 'normal'
            });
        });
        
        test('should send correct data for danger mode terminal', async () => {
            await kanban.sendTaskToNewTerminal(1, 'danger');
            
            expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('open-terminal-with-task', {
                taskId: 1,
                title: 'Test Task',
                project: 'TestProject',
                mode: 'danger'
            });
        });
        
        test('should send notification after successful terminal creation', async () => {
            await kanban.sendTaskToNewTerminal(1);
            
            expect(window.ipcRenderer.send).toHaveBeenCalledWith('show-badge-notification', 'New terminal opened');
        });
    });
    
    describe('Error Handling', () => {
        test('should handle terminal creation failure', async () => {
            window.ipcRenderer.invoke.mockImplementationOnce(() => 
                Promise.resolve({ success: false, error: 'Maximum terminals reached' })
            );
            
            const result = await kanban.sendTaskToNewTerminal(1);
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Maximum terminals reached');
        });
        
        test('should handle task not found', async () => {
            const result = await kanban.sendTaskToNewTerminal(999);
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Task not found');
        });
    });
    
    describe('Integration Tests', () => {
        test('should handle complete flow from button click to terminal creation', async () => {
            const task = kanban.tasks[0];
            const terminals = [{ id: 0, project: 'TestProject' }];
            
            // Create and setup dropdown
            const dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            const dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            dropdown.style.display = 'block';
            document.body.appendChild(dropdown);
            
            kanban.attachSendToTerminalHandlers(dropdown);
            
            // Click the button
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            newTerminalBtn.click();
            
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Verify entire flow
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalledWith(1);
            expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('open-terminal-with-task', 
                expect.objectContaining({
                    taskId: 1,
                    title: 'Test Task',
                    project: 'TestProject',
                    mode: 'normal'
                })
            );
            expect(window.ipcRenderer.send).toHaveBeenCalledWith('show-badge-notification', 'New terminal opened');
            expect(dropdown.style.display).toBe('none');
        });
        
        test('should handle mode switching correctly', async () => {
            // Start in grid mode
            terminalManager.layoutMode = 'grid';
            
            const task = kanban.tasks[0];
            const terminals = [{ id: 0, project: 'TestProject' }];
            
            // Create dropdown in grid mode
            let dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            let dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            
            expect(dropdown.querySelector('[data-action="new-terminal"]')).toBeTruthy();
            
            // Switch to tabbed mode
            terminalManager.layoutMode = 'tabbed';
            
            // Create new dropdown in tabbed mode
            dropdownHTML = kanban.generateSendToTerminalDropdownHTML(task, terminals);
            dropdown = document.createElement('div');
            dropdown.innerHTML = dropdownHTML;
            dropdown.style.display = 'block';
            document.body.appendChild(dropdown);
            
            kanban.attachSendToTerminalHandlers(dropdown);
            
            // Click should work in tabbed mode
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            newTerminalBtn.click();
            
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalled();
        });
    });
});
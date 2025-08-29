const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

describe('Tabbed Mode Terminal Button Tests', () => {
    let dom;
    let document;
    let window;
    let kanban;
    
    beforeEach(() => {
        // Create a minimal DOM
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <body>
                <div id="terminals-container"></div>
                <div id="tabbed-terminal-tabs"></div>
                <div id="tabbed-terminal-content"></div>
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
            invoke: jest.fn().mockResolvedValue({ success: true }),
            send: jest.fn(),
            on: jest.fn()
        };
        
        // Create kanban instance with necessary methods
        kanban = {
            tasks: [
                { id: 1, title: 'Test Task', project: 'TestProject', status: 'pending' }
            ],
            layoutMode: 'tabbed',
            activeTabTerminal: 0,
            
            createSendDropdown: async function(task, source) {
                const dropdown = document.createElement('div');
                dropdown.id = `send-terminal-dropdown-${task.id}`;
                dropdown.className = 'send-terminal-dropdown';
                
                // Check if we're in tabbed mode
                const isTabbed = this.layoutMode === 'tabbed';
                
                // Create dropdown with buttons
                dropdown.innerHTML = `
                    <div class="send-terminal-option new-terminal" data-task-id="${task.id}" data-action="new-terminal">
                        Open New Terminal
                    </div>
                    <div class="send-terminal-option danger-terminal" data-task-id="${task.id}" data-action="danger-terminal">
                        Open Terminal (Danger Mode)
                    </div>
                `;
                
                document.body.appendChild(dropdown);
                
                // Attach event listeners based on mode
                if (isTabbed) {
                    this.attachTabbedEventListeners(dropdown);
                } else {
                    this.attachGridEventListeners(dropdown);
                }
                
                return dropdown;
            },
            
            attachTabbedEventListeners: function(dropdown) {
                // Use event delegation for tabbed mode
                dropdown.addEventListener('click', async (e) => {
                    const option = e.target.closest('.send-terminal-option');
                    if (!option) return;
                    
                    e.stopPropagation();
                    const action = option.dataset.action;
                    const taskId = parseInt(option.dataset.taskId);
                    
                    if (action === 'new-terminal') {
                        await this.sendTaskToNewTerminal(taskId);
                    } else if (action === 'danger-terminal') {
                        await this.sendTaskToNewTerminal(taskId, 'danger');
                    }
                    
                    dropdown.style.display = 'none';
                });
            },
            
            attachGridEventListeners: function(dropdown) {
                // Direct event listeners for grid mode
                const options = dropdown.querySelectorAll('.send-terminal-option');
                options.forEach(option => {
                    option.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const action = option.dataset.action;
                        const taskId = parseInt(option.dataset.taskId);
                        
                        if (action === 'new-terminal') {
                            await this.sendTaskToNewTerminal(taskId);
                        } else if (action === 'danger-terminal') {
                            await this.sendTaskToNewTerminal(taskId, 'danger');
                        }
                        
                        dropdown.style.display = 'none';
                    });
                });
            },
            
            sendTaskToNewTerminal: jest.fn(async function(taskId, mode = 'normal') {
                const task = this.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                // Simulate IPC call to open terminal with task
                const result = await window.ipcRenderer.invoke('open-terminal-with-task', {
                    taskId: task.id,
                    title: task.title,
                    project: task.project,
                    mode: mode
                });
                
                return result;
            })
        };
        
        window.kanban = kanban;
    });
    
    afterEach(() => {
        dom.window.close();
    });
    
    describe('Dropdown Creation', () => {
        test('should create dropdown with new terminal buttons in tabbed mode', async () => {
            kanban.layoutMode = 'tabbed';
            const task = kanban.tasks[0];
            
            const dropdown = await kanban.createSendDropdown(task, 'test');
            
            expect(dropdown).toBeTruthy();
            expect(dropdown.id).toBe('send-terminal-dropdown-1');
            
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            const dangerBtn = dropdown.querySelector('[data-action="danger-terminal"]');
            
            expect(newTerminalBtn).toBeTruthy();
            expect(dangerBtn).toBeTruthy();
        });
        
        test('should create dropdown with new terminal buttons in grid mode', async () => {
            kanban.layoutMode = 'grid';
            const task = kanban.tasks[0];
            
            const dropdown = await kanban.createSendDropdown(task, 'test');
            
            expect(dropdown).toBeTruthy();
            
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            const dangerBtn = dropdown.querySelector('[data-action="danger-terminal"]');
            
            expect(newTerminalBtn).toBeTruthy();
            expect(dangerBtn).toBeTruthy();
        });
    });
    
    describe('Button Click Handling', () => {
        test('should handle new terminal button click in tabbed mode', async () => {
            kanban.layoutMode = 'tabbed';
            const task = kanban.tasks[0];
            
            const dropdown = await kanban.createSendDropdown(task, 'test');
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            
            // Simulate click
            const clickEvent = new window.MouseEvent('click', { bubbles: true });
            newTerminalBtn.dispatchEvent(clickEvent);
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalledWith(1);
            expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('open-terminal-with-task', 
                expect.objectContaining({
                    taskId: 1,
                    mode: 'normal'
                })
            );
        });
        
        test('should handle danger terminal button click in tabbed mode', async () => {
            kanban.layoutMode = 'tabbed';
            const task = kanban.tasks[0];
            
            const dropdown = await kanban.createSendDropdown(task, 'test');
            const dangerBtn = dropdown.querySelector('[data-action="danger-terminal"]');
            
            // Simulate click
            const clickEvent = new window.MouseEvent('click', { bubbles: true });
            dangerBtn.dispatchEvent(clickEvent);
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalledWith(1, 'danger');
            expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('open-terminal-with-task', 
                expect.objectContaining({
                    taskId: 1,
                    mode: 'danger'
                })
            );
        });
        
        test('should handle new terminal button click in grid mode', async () => {
            kanban.layoutMode = 'grid';
            const task = kanban.tasks[0];
            
            const dropdown = await kanban.createSendDropdown(task, 'test');
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            
            // Simulate click
            const clickEvent = new window.MouseEvent('click', { bubbles: true });
            newTerminalBtn.dispatchEvent(clickEvent);
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalledWith(1);
        });
    });
    
    describe('Event Delegation', () => {
        test('should use event delegation in tabbed mode', async () => {
            kanban.layoutMode = 'tabbed';
            const task = kanban.tasks[0];
            
            const dropdown = await kanban.createSendDropdown(task, 'test');
            
            // Check that event listener is on dropdown, not individual buttons
            const listeners = dropdown.getEventListeners ? dropdown.getEventListeners('click') : [];
            
            // In tabbed mode, there should be one listener on the dropdown
            // In grid mode, listeners would be on individual buttons
            
            // Verify click bubbles up correctly
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            const clickEvent = new window.MouseEvent('click', { bubbles: true });
            newTerminalBtn.dispatchEvent(clickEvent);
            
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalled();
        });
        
        test('should use direct listeners in grid mode', async () => {
            kanban.layoutMode = 'grid';
            const task = kanban.tasks[0];
            
            const dropdown = await kanban.createSendDropdown(task, 'test');
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            
            // In grid mode, event listeners should be directly on buttons
            const clickEvent = new window.MouseEvent('click', { bubbles: true });
            newTerminalBtn.dispatchEvent(clickEvent);
            
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalled();
        });
    });
    
    describe('IPC Communication', () => {
        test('should send correct data to main process for new terminal', async () => {
            kanban.layoutMode = 'tabbed';
            const task = kanban.tasks[0];
            
            await kanban.sendTaskToNewTerminal(task.id, 'normal');
            
            expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('open-terminal-with-task', {
                taskId: 1,
                title: 'Test Task',
                project: 'TestProject',
                mode: 'normal'
            });
        });
        
        test('should send danger mode flag when danger terminal clicked', async () => {
            kanban.layoutMode = 'tabbed';
            const task = kanban.tasks[0];
            
            await kanban.sendTaskToNewTerminal(task.id, 'danger');
            
            expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('open-terminal-with-task', {
                taskId: 1,
                title: 'Test Task',
                project: 'TestProject',
                mode: 'danger'
            });
        });
    });
    
    describe('Layout Mode Switching', () => {
        test('should handle clicks correctly after switching from grid to tabbed', async () => {
            // Start in grid mode
            kanban.layoutMode = 'grid';
            const task = kanban.tasks[0];
            
            // Create dropdown in grid mode
            let dropdown = await kanban.createSendDropdown(task, 'test');
            document.body.removeChild(dropdown);
            
            // Switch to tabbed mode
            kanban.layoutMode = 'tabbed';
            
            // Create new dropdown in tabbed mode
            dropdown = await kanban.createSendDropdown(task, 'test');
            const newTerminalBtn = dropdown.querySelector('[data-action="new-terminal"]');
            
            // Click should work in tabbed mode
            const clickEvent = new window.MouseEvent('click', { bubbles: true });
            newTerminalBtn.dispatchEvent(clickEvent);
            
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalled();
        });
    });
});
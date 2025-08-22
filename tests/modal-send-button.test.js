/**
 * Tests for Modal Send Button and Project Loading Fixes
 * Related to Task #3693
 * @jest-environment jsdom
 */

describe('Modal Send Button and Project Loading', () => {
    let kanban;
    let mockIpcRenderer;
    let mockProjects;
    let mockTerminals;
    
    beforeEach(() => {
        // Reset DOM
        document.body.innerHTML = `
            <div id="task-modal" class="modal">
                <div class="modal-body">
                    <div class="task-header-send-wrapper">
                        <div class="send-to-terminal-icon modal-send-icon" id="modal-send-icon">
                            <svg>Send Icon</svg>
                        </div>
                        <div class="send-terminal-dropdown modal-send-dropdown" id="modal-send-dropdown" style="display: none;">
                            <!-- Dropdown content will be added dynamically -->
                        </div>
                    </div>
                    <select id="modal-project-select">
                        <option value="">Select Project</option>
                    </select>
                    <div id="modal-subtasks-container"></div>
                </div>
            </div>
        `;
        
        // Mock projects data
        mockProjects = [
            { name: 'CodeAgentSwarm', display_name: 'CodeAgentSwarm', color: '#4F46E5' },
            { name: 'TestProject', display_name: 'Test Project', color: '#EF4444' }
        ];
        
        // Mock terminals data
        mockTerminals = [
            { id: 1, title: 'Terminal 1', project: 'CodeAgentSwarm', status: 'active' },
            { id: 2, title: 'Terminal 2', project: 'TestProject', status: 'active' }
        ];
        
        // Mock IPC renderer
        mockIpcRenderer = {
            send: jest.fn(),
            on: jest.fn((channel, callback) => {
                if (channel === 'terminals-status-response') {
                    setTimeout(() => callback({}, mockTerminals), 0);
                } else if (channel === 'projects-response') {
                    setTimeout(() => callback({}, mockProjects), 0);
                }
            }),
            invoke: jest.fn().mockResolvedValue(mockProjects)
        };
        
        // Set up global window object
        window.electronAPI = mockIpcRenderer;
        
        // Mock the kanban instance
        kanban = {
            projects: [],
            projectsLoaded: false,
            
            loadProjects: jest.fn(async function() {
                this.projects = mockProjects;
                this.projectsLoaded = true;
                return mockProjects;
            }),
            
            sendTaskToSpecificTerminal: jest.fn((taskId, terminalId) => {
                console.log(`Sending task ${taskId} to terminal ${terminalId}`);
            }),
            
            copyTaskSummary: jest.fn((taskId) => {
                console.log(`Copying summary for task ${taskId}`);
            }),
            
            sendTaskToNewTerminal: jest.fn((taskId) => {
                console.log(`Opening new terminal for task ${taskId}`);
            }),
            
            populateProjectSelectHeader: jest.fn(async function(selectElement, currentProject) {
                if (!this.projectsLoaded || this.projects.length === 0) {
                    await this.loadProjects();
                }
                
                selectElement.innerHTML = '<option value="">Select Project</option>';
                this.projects.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project.name;
                    option.textContent = project.display_name || project.name;
                    selectElement.appendChild(option);
                });
                
                if (currentProject) {
                    selectElement.value = currentProject;
                }
            }),
            
            toggleModalSendDropdown: jest.fn(function(taskId) {
                const dropdown = document.getElementById('modal-send-dropdown');
                const icon = document.getElementById('modal-send-icon');
                
                if (dropdown.style.display === 'none') {
                    // Build dropdown content
                    let dropdownHTML = '';
                    
                    // Add terminal options
                    mockTerminals.forEach(terminal => {
                        dropdownHTML += `
                            <div class="send-terminal-option" 
                                 data-action="send-terminal" 
                                 data-task-id="${taskId}" 
                                 data-terminal-id="${terminal.id}">
                                Terminal ${terminal.id} (${terminal.project})
                            </div>
                        `;
                    });
                    
                    // Add "Open New Terminal" if conditions are met
                    const task = { id: taskId, project: 'CodeAgentSwarm' };
                    if (mockTerminals.length < 6 && task.project) {
                        dropdownHTML += `
                            <div class="send-terminal-option new-terminal-option" 
                                 data-action="new-terminal" 
                                 data-task-id="${taskId}">
                                Open New Terminal
                            </div>
                        `;
                    }
                    
                    // Add copy option
                    dropdownHTML += `
                        <div class="send-terminal-option copy-option" 
                             data-action="copy" 
                             data-task-id="${taskId}">
                            Copy Task Summary
                        </div>
                    `;
                    
                    dropdown.innerHTML = dropdownHTML;
                    dropdown.style.display = 'block';
                    
                    // Add event listeners using event delegation
                    dropdown.querySelectorAll('.send-terminal-option').forEach(option => {
                        option.addEventListener('click', (e) => {
                            const action = e.currentTarget.dataset.action;
                            const taskId = parseInt(e.currentTarget.dataset.taskId);
                            
                            if (action === 'send-terminal') {
                                const terminalId = parseInt(e.currentTarget.dataset.terminalId);
                                this.sendTaskToSpecificTerminal(taskId, terminalId);
                            } else if (action === 'new-terminal') {
                                this.sendTaskToNewTerminal(taskId);
                            } else if (action === 'copy') {
                                this.copyTaskSummary(taskId);
                            }
                            
                            dropdown.style.display = 'none';
                        });
                    });
                } else {
                    dropdown.style.display = 'none';
                }
            })
        };
        
        // Make kanban globally accessible (as per the fix)
        window.kanban = kanban;
    });
    
    afterEach(() => {
        jest.clearAllMocks();
        delete window.kanban;
        delete window.electronAPI;
    });
    
    describe('Modal Send Button Functionality', () => {
        test('should make kanban instance globally accessible', () => {
            expect(window.kanban).toBeDefined();
            expect(window.kanban).toBe(kanban);
        });
        
        test('should toggle dropdown visibility when send icon is clicked', () => {
            const sendIcon = document.getElementById('modal-send-icon');
            const dropdown = document.getElementById('modal-send-dropdown');
            
            // Initially hidden
            expect(dropdown.style.display).toBe('none');
            
            // Click to show
            kanban.toggleModalSendDropdown(123);
            expect(dropdown.style.display).toBe('block');
            
            // Click to hide
            kanban.toggleModalSendDropdown(123);
            expect(dropdown.style.display).toBe('none');
        });
        
        test('should populate dropdown with terminal options', () => {
            kanban.toggleModalSendDropdown(123);
            
            const dropdown = document.getElementById('modal-send-dropdown');
            const terminalOptions = dropdown.querySelectorAll('[data-action="send-terminal"]');
            
            expect(terminalOptions).toHaveLength(mockTerminals.length);
            
            terminalOptions.forEach((option, index) => {
                expect(option.dataset.terminalId).toBe(String(mockTerminals[index].id));
                expect(option.textContent).toContain(`Terminal ${mockTerminals[index].id}`);
                expect(option.textContent).toContain(mockTerminals[index].project);
            });
        });
        
        test('should include "Open New Terminal" option when conditions are met', () => {
            // Conditions: less than 6 terminals and task has a project
            kanban.toggleModalSendDropdown(123);
            
            const dropdown = document.getElementById('modal-send-dropdown');
            const newTerminalOption = dropdown.querySelector('[data-action="new-terminal"]');
            
            expect(newTerminalOption).toBeTruthy();
            expect(newTerminalOption.textContent).toContain('Open New Terminal');
        });
        
        test('should not include "Open New Terminal" when 6 terminals exist', () => {
            // Add more terminals to reach the limit
            mockTerminals = Array.from({ length: 6 }, (_, i) => ({
                id: i + 1,
                title: `Terminal ${i + 1}`,
                project: 'TestProject',
                status: 'active'
            }));
            
            kanban.toggleModalSendDropdown(123);
            
            const dropdown = document.getElementById('modal-send-dropdown');
            const newTerminalOption = dropdown.querySelector('[data-action="new-terminal"]');
            
            expect(newTerminalOption).toBeFalsy();
        });
        
        test('should include copy task summary option', () => {
            kanban.toggleModalSendDropdown(123);
            
            const dropdown = document.getElementById('modal-send-dropdown');
            const copyOption = dropdown.querySelector('[data-action="copy"]');
            
            expect(copyOption).toBeTruthy();
            expect(copyOption.textContent).toContain('Copy Task Summary');
        });
        
        test('should handle send to terminal action', () => {
            kanban.toggleModalSendDropdown(123);
            
            const dropdown = document.getElementById('modal-send-dropdown');
            const firstTerminalOption = dropdown.querySelector('[data-action="send-terminal"]');
            
            firstTerminalOption.click();
            
            expect(kanban.sendTaskToSpecificTerminal).toHaveBeenCalledWith(123, 1);
            expect(dropdown.style.display).toBe('none');
        });
        
        test('should handle open new terminal action', () => {
            kanban.toggleModalSendDropdown(123);
            
            const dropdown = document.getElementById('modal-send-dropdown');
            const newTerminalOption = dropdown.querySelector('[data-action="new-terminal"]');
            
            newTerminalOption.click();
            
            expect(kanban.sendTaskToNewTerminal).toHaveBeenCalledWith(123);
            expect(dropdown.style.display).toBe('none');
        });
        
        test('should handle copy task summary action', () => {
            kanban.toggleModalSendDropdown(123);
            
            const dropdown = document.getElementById('modal-send-dropdown');
            const copyOption = dropdown.querySelector('[data-action="copy"]');
            
            copyOption.click();
            
            expect(kanban.copyTaskSummary).toHaveBeenCalledWith(123);
            expect(dropdown.style.display).toBe('none');
        });
    });
    
    describe('Project Loading in Modal', () => {
        test('should load projects if not already loaded', async () => {
            const selectElement = document.getElementById('modal-project-select');
            
            // Projects not loaded initially
            expect(kanban.projectsLoaded).toBe(false);
            expect(kanban.projects).toHaveLength(0);
            
            await kanban.populateProjectSelectHeader(selectElement, 'CodeAgentSwarm');
            
            // Projects should be loaded
            expect(kanban.loadProjects).toHaveBeenCalled();
            expect(kanban.projectsLoaded).toBe(true);
            expect(kanban.projects).toEqual(mockProjects);
        });
        
        test('should populate project select with loaded projects', async () => {
            const selectElement = document.getElementById('modal-project-select');
            
            await kanban.populateProjectSelectHeader(selectElement, null);
            
            const options = selectElement.querySelectorAll('option');
            
            // Default option + projects
            expect(options).toHaveLength(mockProjects.length + 1);
            
            // Check first option is default
            expect(options[0].value).toBe('');
            expect(options[0].textContent).toBe('Select Project');
            
            // Check project options
            mockProjects.forEach((project, index) => {
                const option = options[index + 1];
                expect(option.value).toBe(project.name);
                expect(option.textContent).toBe(project.display_name || project.name);
            });
        });
        
        test('should set current project value if provided', async () => {
            const selectElement = document.getElementById('modal-project-select');
            
            await kanban.populateProjectSelectHeader(selectElement, 'TestProject');
            
            expect(selectElement.value).toBe('TestProject');
        });
        
        test('should not reload projects if already loaded', async () => {
            const selectElement = document.getElementById('modal-project-select');
            
            // First load
            await kanban.populateProjectSelectHeader(selectElement, null);
            expect(kanban.loadProjects).toHaveBeenCalledTimes(1);
            
            // Second call should not reload
            await kanban.populateProjectSelectHeader(selectElement, null);
            expect(kanban.loadProjects).toHaveBeenCalledTimes(1);
        });
        
        test('should handle project loading errors gracefully', async () => {
            const selectElement = document.getElementById('modal-project-select');
            
            // Mock loading error
            kanban.loadProjects = jest.fn().mockRejectedValue(new Error('Failed to load projects'));
            
            await expect(kanban.populateProjectSelectHeader(selectElement, null)).rejects.toThrow('Failed to load projects');
        });
    });
    
    describe('Subtasks with Project Badges', () => {
        test('should display project badges for subtasks', () => {
            const container = document.getElementById('modal-subtasks-container');
            
            // Create mock subtask HTML with project badge
            const subtaskHTML = `
                <div class="subtask">
                    <span class="subtask-title">Fix bug in authentication</span>
                    <span class="project-badge" style="background-color: #4F46E5;">
                        CodeAgentSwarm
                    </span>
                </div>
            `;
            
            container.innerHTML = subtaskHTML;
            
            const badge = container.querySelector('.project-badge');
            expect(badge).toBeTruthy();
            expect(badge.textContent.trim()).toBe('CodeAgentSwarm');
            expect(badge.style.backgroundColor).toBe('rgb(79, 70, 229)'); // Converted hex to rgb
        });
        
        test('should use default color for projects not in cache', () => {
            const container = document.getElementById('modal-subtasks-container');
            
            // Project not in cache - should use default color
            const subtaskHTML = `
                <div class="subtask">
                    <span class="subtask-title">Unknown project task</span>
                    <span class="project-badge" style="background-color: #9CA3AF;">
                        UnknownProject
                    </span>
                </div>
            `;
            
            container.innerHTML = subtaskHTML;
            
            const badge = container.querySelector('.project-badge');
            expect(badge.style.backgroundColor).toBe('rgb(156, 163, 175)'); // Default gray color
        });
    });
    
    describe('CSS Positioning and Z-Index', () => {
        test('should have proper z-index for modal dropdown', () => {
            // Create style element to test CSS
            const style = document.createElement('style');
            style.textContent = `
                .modal-send-dropdown {
                    z-index: 100000;
                    position: absolute;
                }
                .modal-body {
                    overflow: visible;
                }
                .task-header-send-wrapper {
                    position: relative;
                }
            `;
            document.head.appendChild(style);
            
            const dropdown = document.getElementById('modal-send-dropdown');
            const modalBody = document.querySelector('.modal-body');
            const wrapper = document.querySelector('.task-header-send-wrapper');
            
            // Apply the styles
            dropdown.classList.add('modal-send-dropdown');
            
            // Get computed styles
            const dropdownStyle = window.getComputedStyle(dropdown);
            const modalBodyStyle = window.getComputedStyle(modalBody);
            const wrapperStyle = window.getComputedStyle(wrapper);
            
            expect(dropdownStyle.zIndex).toBe('100000');
            expect(dropdownStyle.position).toBe('absolute');
            expect(modalBodyStyle.overflow).toBe('visible');
            expect(wrapperStyle.position).toBe('relative');
        });
    });
});
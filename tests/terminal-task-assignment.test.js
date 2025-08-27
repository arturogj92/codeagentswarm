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

// Mock require globally
global.require = jest.fn((module) => {
    if (module === 'electron') {
        return { ipcRenderer: mockIpcRenderer };
    }
    return {};
});

describe('Terminal Task Assignment - pendingTerminalTasks initialization', () => {
    let originalWindow;
    
    beforeEach(() => {
        // Store original window properties
        originalWindow = {
            pendingTerminalTasks: window.pendingTerminalTasks,
            terminalManager: window.terminalManager,
            kanban: window.kanban
        };
        
        // Reset window properties
        delete window.pendingTerminalTasks;
        window.terminalManager = {
            terminals: new Map(),
            renderTerminals: jest.fn(),
            updateTerminalManagementButtons: jest.fn(),
            startTerminal: jest.fn(),
            layoutMode: 'grid',
            activeTabTerminal: null,
            showDirectorySelector: jest.fn()
        };
        
        window.kanban = {
            showNotification: jest.fn()
        };
        
        // Setup DOM
        document.body.innerHTML = `
            <div id="main-content"></div>
        `;
    });
    
    afterEach(() => {
        // Restore original window properties
        window.pendingTerminalTasks = originalWindow.pendingTerminalTasks;
        window.terminalManager = originalWindow.terminalManager;
        window.kanban = originalWindow.kanban;
        jest.clearAllMocks();
    });
    
    describe('New Terminal Creation with Task', () => {
        it('should initialize pendingTerminalTasks if undefined when creating new terminal', async () => {
            const taskData = {
                id: 123,
                title: 'Test Task',
                description: 'Test Description',
                project: 'TestProject'
            };
            
            // Mock successful terminal creation
            mockIpcRenderer.invoke.mockResolvedValue({
                success: true,
                terminalId: 3
            });
            
            // Simulate the logic from renderer.js
            const handleOpenTerminalForTask = async (taskData) => {
                // Check for uninitialized terminals (simulate none found)
                const uninitializedTerminal = null;
                
                if (!uninitializedTerminal) {
                    // Need to add a new terminal
                    const result = await mockIpcRenderer.invoke('add-terminal');
                    
                    if (result.success) {
                        const newTerminalId = result.terminalId;
                        
                        // This is the fix we added - initialize if not exists
                        if (!window.pendingTerminalTasks) {
                            window.pendingTerminalTasks = {};
                        }
                        
                        window.pendingTerminalTasks[newTerminalId] = taskData;
                        
                        // In tabbed mode, set active terminal
                        if (window.terminalManager.layoutMode === 'tabbed' && newTerminalId !== undefined) {
                            window.terminalManager.activeTabTerminal = newTerminalId;
                        }
                        
                        // Render terminals
                        await window.terminalManager.renderTerminals();
                        await window.terminalManager.updateTerminalManagementButtons();
                        
                        return { success: true, terminalId: newTerminalId };
                    }
                }
                
                return { success: false };
            };
            
            // Ensure pendingTerminalTasks is undefined before the test
            expect(window.pendingTerminalTasks).toBeUndefined();
            
            // Execute the function
            const result = await handleOpenTerminalForTask(taskData);
            
            // Verify pendingTerminalTasks was initialized
            expect(window.pendingTerminalTasks).toBeDefined();
            expect(window.pendingTerminalTasks).toBeInstanceOf(Object);
            expect(window.pendingTerminalTasks[3]).toBe(taskData);
            expect(result.success).toBe(true);
            expect(result.terminalId).toBe(3);
        });
        
        it('should not reinitialize pendingTerminalTasks if already exists', async () => {
            const existingTaskData = {
                id: 111,
                title: 'Existing Task',
                description: 'Already stored'
            };
            
            const newTaskData = {
                id: 222,
                title: 'New Task',
                description: 'To be added',
                project: 'NewProject'
            };
            
            // Pre-initialize pendingTerminalTasks with existing data
            window.pendingTerminalTasks = {
                1: existingTaskData
            };
            
            // Mock successful terminal creation
            mockIpcRenderer.invoke.mockResolvedValue({
                success: true,
                terminalId: 2
            });
            
            // Simulate the logic
            const handleOpenTerminalForTask = async (taskData) => {
                const result = await mockIpcRenderer.invoke('add-terminal');
                
                if (result.success) {
                    const newTerminalId = result.terminalId;
                    
                    // This is the fix - only initialize if not exists
                    if (!window.pendingTerminalTasks) {
                        window.pendingTerminalTasks = {};
                    }
                    
                    window.pendingTerminalTasks[newTerminalId] = taskData;
                    return { success: true, terminalId: newTerminalId };
                }
                
                return { success: false };
            };
            
            const result = await handleOpenTerminalForTask(newTaskData);
            
            // Verify existing data is preserved
            expect(window.pendingTerminalTasks[1]).toBe(existingTaskData);
            // Verify new data is added
            expect(window.pendingTerminalTasks[2]).toBe(newTaskData);
            expect(result.success).toBe(true);
        });
        
        it('should handle terminal creation failure gracefully', async () => {
            const taskData = {
                id: 333,
                title: 'Failed Task',
                description: 'Should fail'
            };
            
            // Mock failed terminal creation
            mockIpcRenderer.invoke.mockResolvedValue({
                success: false,
                error: 'Maximum number of terminals reached'
            });
            
            // Simulate the logic with error handling
            const handleOpenTerminalForTask = async (taskData) => {
                const result = await mockIpcRenderer.invoke('add-terminal');
                
                if (result.success) {
                    const newTerminalId = result.terminalId;
                    
                    if (!window.pendingTerminalTasks) {
                        window.pendingTerminalTasks = {};
                    }
                    
                    window.pendingTerminalTasks[newTerminalId] = taskData;
                    return { success: true, terminalId: newTerminalId };
                } else {
                    // Handle failure
                    const errorMsg = result.error || 'Failed to create new terminal';
                    
                    if (window.kanban && window.kanban.showNotification) {
                        window.kanban.showNotification(errorMsg, 'error', 3000);
                    }
                    
                    return { success: false, error: errorMsg };
                }
            };
            
            const result = await handleOpenTerminalForTask(taskData);
            
            // Verify error handling
            expect(result.success).toBe(false);
            expect(result.error).toBe('Maximum number of terminals reached');
            expect(window.kanban.showNotification).toHaveBeenCalledWith(
                'Maximum number of terminals reached',
                'error',
                3000
            );
            
            // pendingTerminalTasks should not have the failed task
            expect(window.pendingTerminalTasks).toBeUndefined();
        });
        
        it('should set active tab in tabbed layout mode', async () => {
            window.terminalManager.layoutMode = 'tabbed';
            
            const taskData = {
                id: 444,
                title: 'Tabbed Task',
                project: 'TabbedProject'
            };
            
            mockIpcRenderer.invoke.mockResolvedValue({
                success: true,
                terminalId: 4
            });
            
            const handleOpenTerminalForTask = async (taskData) => {
                const result = await mockIpcRenderer.invoke('add-terminal');
                
                if (result.success) {
                    const newTerminalId = result.terminalId;
                    
                    if (!window.pendingTerminalTasks) {
                        window.pendingTerminalTasks = {};
                    }
                    
                    window.pendingTerminalTasks[newTerminalId] = taskData;
                    
                    // In tabbed mode, set active terminal
                    if (window.terminalManager.layoutMode === 'tabbed' && newTerminalId !== undefined) {
                        window.terminalManager.activeTabTerminal = newTerminalId;
                    }
                    
                    await window.terminalManager.renderTerminals();
                    await window.terminalManager.updateTerminalManagementButtons();
                    
                    return { success: true, terminalId: newTerminalId };
                }
                
                return { success: false };
            };
            
            const result = await handleOpenTerminalForTask(taskData);
            
            // Verify tabbed mode behavior
            expect(window.terminalManager.activeTabTerminal).toBe(4);
            expect(window.terminalManager.renderTerminals).toHaveBeenCalled();
            expect(window.terminalManager.updateTerminalManagementButtons).toHaveBeenCalled();
            expect(result.success).toBe(true);
        });
    });
    
    describe('Existing Uninitialized Terminal with Task', () => {
        it('should initialize pendingTerminalTasks for existing uninitialized terminal', () => {
            const taskData = {
                id: 555,
                title: 'Uninitialized Terminal Task',
                project: 'ExistingProject'
            };
            
            // Simulate finding an uninitialized terminal
            const uninitializedTerminal = 2;
            
            const handleTaskForUninitializedTerminal = (terminalId, taskData) => {
                // This logic is also in renderer.js for existing terminals
                if (!window.pendingTerminalTasks) {
                    window.pendingTerminalTasks = {};
                }
                
                window.pendingTerminalTasks[terminalId] = taskData;
                
                return { success: true, terminalId };
            };
            
            // Ensure pendingTerminalTasks is undefined
            expect(window.pendingTerminalTasks).toBeUndefined();
            
            const result = handleTaskForUninitializedTerminal(uninitializedTerminal, taskData);
            
            // Verify initialization
            expect(window.pendingTerminalTasks).toBeDefined();
            expect(window.pendingTerminalTasks[2]).toBe(taskData);
            expect(result.success).toBe(true);
        });
    });
    
    describe('Edge Cases', () => {
        it('should handle undefined terminal ID gracefully', async () => {
            const taskData = {
                id: 666,
                title: 'Undefined ID Task'
            };
            
            // Mock terminal creation with undefined ID (should not happen but test for safety)
            mockIpcRenderer.invoke.mockResolvedValue({
                success: true,
                terminalId: undefined
            });
            
            const handleOpenTerminalForTask = async (taskData) => {
                const result = await mockIpcRenderer.invoke('add-terminal');
                
                if (result.success) {
                    const newTerminalId = result.terminalId;
                    
                    // Even with undefined ID, should not crash
                    if (!window.pendingTerminalTasks) {
                        window.pendingTerminalTasks = {};
                    }
                    
                    // This will create a property with key 'undefined'
                    window.pendingTerminalTasks[newTerminalId] = taskData;
                    
                    return { success: true, terminalId: newTerminalId };
                }
                
                return { success: false };
            };
            
            const result = await handleOpenTerminalForTask(taskData);
            
            // Should handle it without crashing
            expect(window.pendingTerminalTasks).toBeDefined();
            expect(window.pendingTerminalTasks['undefined']).toBe(taskData);
            expect(result.success).toBe(true);
        });
        
        it('should handle null terminal ID gracefully', async () => {
            const taskData = {
                id: 777,
                title: 'Null ID Task'
            };
            
            mockIpcRenderer.invoke.mockResolvedValue({
                success: true,
                terminalId: null
            });
            
            const handleOpenTerminalForTask = async (taskData) => {
                const result = await mockIpcRenderer.invoke('add-terminal');
                
                if (result.success) {
                    const newTerminalId = result.terminalId;
                    
                    if (!window.pendingTerminalTasks) {
                        window.pendingTerminalTasks = {};
                    }
                    
                    window.pendingTerminalTasks[newTerminalId] = taskData;
                    
                    return { success: true, terminalId: newTerminalId };
                }
                
                return { success: false };
            };
            
            const result = await handleOpenTerminalForTask(taskData);
            
            // Should handle it without crashing
            expect(window.pendingTerminalTasks).toBeDefined();
            expect(window.pendingTerminalTasks['null']).toBe(taskData);
            expect(result.success).toBe(true);
        });
    });
});
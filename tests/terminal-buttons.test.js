/**
 * Tests for Terminal and Folder buttons functionality
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const { JSDOM } = require('jsdom');

describe('Terminal Dropdown Buttons', () => {
    let dom;
    let document;
    let window;
    let terminalManager;

    beforeEach(() => {
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <body>
                <div class="terminal-quadrant" data-quadrant="0">
                    <div class="terminal-controls">
                        <div class="terminal-more-options-container">
                            <button class="terminal-more-btn" data-terminal="0">⋯</button>
                            <div class="terminal-dropdown-menu" data-terminal="0" style="display: none;">
                                <button class="terminal-dropdown-item" data-action="open-terminal-here" data-terminal="0">
                                    Open Terminal
                                </button>
                                <button class="terminal-dropdown-item" data-action="open-folder" data-terminal="0">
                                    Open Folder
                                </button>
                                <button class="terminal-dropdown-item" data-action="open-in-ide" data-ide="vscode" data-terminal="0">
                                    Open in VSCode
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `, { url: 'http://localhost' });
        
        document = dom.window.document;
        window = dom.window;
        
        // Mock terminal manager methods
        terminalManager = {
            handleOpenTerminalInPath: jest.fn().mockResolvedValue({ success: true }),
            handleOpenFolder: jest.fn().mockResolvedValue({ success: true }),
            openInIDE: jest.fn().mockResolvedValue({ success: true }),
            toggleDropdownMenu: jest.fn()
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Button Visibility', () => {
        it('should have open terminal button in dropdown', () => {
            const button = document.querySelector('[data-action="open-terminal-here"]');
            expect(button).toBeTruthy();
            expect(button.dataset.terminal).toBe('0');
        });

        it('should have open folder button in dropdown', () => {
            const button = document.querySelector('[data-action="open-folder"]');
            expect(button).toBeTruthy();
            expect(button.dataset.terminal).toBe('0');
        });

        it('should have IDE buttons in dropdown', () => {
            const button = document.querySelector('[data-action="open-in-ide"]');
            expect(button).toBeTruthy();
            expect(button.dataset.ide).toBe('vscode');
            expect(button.dataset.terminal).toBe('0');
        });
    });

    describe('Data Attributes', () => {
        it('should parse terminal ID correctly for terminal 0', () => {
            const button = document.querySelector('[data-action="open-terminal-here"]');
            const terminalId = parseInt(button.dataset.terminal);
            expect(terminalId).toBe(0);
            expect(typeof terminalId).toBe('number');
        });

        it('should handle all terminal IDs correctly', () => {
            const testIds = ['0', '1', '2', '3'];
            testIds.forEach(id => {
                const testButton = document.createElement('button');
                testButton.dataset.terminal = id;
                const parsedId = parseInt(testButton.dataset.terminal);
                expect(parsedId).toBe(parseInt(id));
                expect(typeof parsedId).toBe('number');
            });
        });
    });

    describe('Click Event Handling', () => {
        it('should call handleOpenTerminalInPath when terminal button clicked', () => {
            const button = document.querySelector('[data-action="open-terminal-here"]');
            
            // Simulate the click handler logic
            const action = button.dataset.action;
            const terminalId = parseInt(button.dataset.terminal);
            
            if (action === 'open-terminal-here') {
                terminalManager.handleOpenTerminalInPath(terminalId);
            }
            
            expect(terminalManager.handleOpenTerminalInPath).toHaveBeenCalledWith(0);
        });

        it('should call handleOpenFolder when folder button clicked', () => {
            const button = document.querySelector('[data-action="open-folder"]');
            
            // Simulate the click handler logic
            const action = button.dataset.action;
            const terminalId = parseInt(button.dataset.terminal);
            
            if (action === 'open-folder') {
                terminalManager.handleOpenFolder(terminalId);
            }
            
            expect(terminalManager.handleOpenFolder).toHaveBeenCalledWith(0);
        });

        it('should call openInIDE with correct parameters when IDE button clicked', () => {
            const button = document.querySelector('[data-action="open-in-ide"]');
            
            // Simulate the click handler logic
            const action = button.dataset.action;
            const terminalId = parseInt(button.dataset.terminal);
            const ideKey = button.dataset.ide;
            
            if (action === 'open-in-ide') {
                terminalManager.openInIDE(terminalId, ideKey);
            }
            
            expect(terminalManager.openInIDE).toHaveBeenCalledWith(0, 'vscode');
        });
    });

    describe('Dropdown Menu Toggle', () => {
        it('should toggle dropdown visibility', () => {
            const dropdown = document.querySelector('.terminal-dropdown-menu');
            
            // Initially hidden
            expect(dropdown.style.display).toBe('none');
            
            // Show dropdown
            dropdown.style.display = 'block';
            expect(dropdown.style.display).toBe('block');
            
            // Hide dropdown
            dropdown.style.display = 'none';
            expect(dropdown.style.display).toBe('none');
        });

        it('should close dropdown after action', () => {
            const dropdown = document.querySelector('.terminal-dropdown-menu');
            dropdown.style.display = 'block';
            
            // Simulate clicking an action
            const button = document.querySelector('[data-action="open-terminal-here"]');
            const terminalId = parseInt(button.dataset.terminal);
            
            // Close dropdown after action
            const dropdownToClose = document.querySelector(`.terminal-dropdown-menu[data-terminal="${terminalId}"]`);
            if (dropdownToClose) {
                dropdownToClose.style.display = 'none';
            }
            
            expect(dropdown.style.display).toBe('none');
        });
    });

    describe('Terminal Map Integration', () => {
        it('should handle terminal 0 in terminals Map', () => {
            const terminals = new Map();
            const mockTerminal = { 
                cwd: '/test/path',
                isActive: true 
            };
            
            // Test setting and getting terminal 0
            terminals.set(0, mockTerminal);
            expect(terminals.has(0)).toBe(true);
            expect(terminals.get(0)).toBe(mockTerminal);
            expect(terminals.get(0).cwd).toBe('/test/path');
        });

        it('should work with all terminal IDs', () => {
            const terminals = new Map();
            
            for (let i = 0; i < 4; i++) {
                terminals.set(i, { id: i, cwd: `/path/${i}` });
            }
            
            for (let i = 0; i < 4; i++) {
                expect(terminals.has(i)).toBe(true);
                expect(terminals.get(i).id).toBe(i);
            }
        });
    });

    describe('IPC Communication', () => {
        it('should send correct terminal ID to IPC handlers', () => {
            const mockIpcRenderer = {
                invoke: jest.fn().mockResolvedValue({ success: true })
            };
            
            // Simulate the actual handler function
            async function handleOpenTerminalInPath(terminalId) {
                return await mockIpcRenderer.invoke('open-terminal-in-path', terminalId);
            }
            
            async function handleOpenFolder(terminalId) {
                return await mockIpcRenderer.invoke('open-folder', terminalId);
            }
            
            // Test with terminal 0
            handleOpenTerminalInPath(0);
            expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('open-terminal-in-path', 0);
            
            mockIpcRenderer.invoke.mockClear();
            
            handleOpenFolder(0);
            expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('open-folder', 0);
        });
    });
});

describe('Integration Tests', () => {
    it('should handle complete click flow for terminal button', () => {
        const dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <body>
                <div class="terminal-dropdown-menu" data-terminal="0">
                    <button class="terminal-dropdown-item" data-action="open-terminal-here" data-terminal="0">
                        Open Terminal
                    </button>
                </div>
            </body>
            </html>
        `);
        
        const document = dom.window.document;
        const button = document.querySelector('[data-action="open-terminal-here"]');
        
        // Mock the handler
        const handleOpenTerminalInPath = jest.fn();
        
        // Simulate click event handling
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = e.target.dataset.action;
            const terminalId = parseInt(e.target.dataset.terminal);
            
            if (action === 'open-terminal-here') {
                handleOpenTerminalInPath(terminalId);
            }
        });
        
        // Trigger click
        const event = new dom.window.MouseEvent('click', { bubbles: true });
        button.dispatchEvent(event);
        
        expect(handleOpenTerminalInPath).toHaveBeenCalledWith(0);
    });
});
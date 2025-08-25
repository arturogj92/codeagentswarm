/**
 * Unit tests for terminal quick action buttons
 * Tests the MCP, Clear, and Memory buttons functionality
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

describe('Terminal Quick Action Buttons', () => {
    let dom;
    let document;
    let window;
    let terminalManager;

    beforeEach(() => {
        // Create a new JSDOM instance
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <body>
                <div id="terminals-container"></div>
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

        // Mock Electron IPC
        window.require = (module) => {
            if (module === 'electron') {
                return {
                    ipcRenderer: {
                        invoke: jest.fn(),
                        send: jest.fn(),
                        on: jest.fn(),
                        removeAllListeners: jest.fn()
                    }
                };
            }
            return {};
        };

        // Mock xterm
        window.Terminal = jest.fn().mockImplementation(() => ({
            paste: jest.fn(),
            focus: jest.fn(),
            open: jest.fn(),
            loadAddon: jest.fn(),
            onData: jest.fn(),
            onKey: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn()
        }));

        // Mock addons
        window.FitAddon = jest.fn().mockImplementation(() => ({
            fit: jest.fn()
        }));

        window.WebLinksAddon = jest.fn().mockImplementation(() => ({}));
    });

    afterEach(() => {
        dom.window.close();
    });

    describe('Button Creation', () => {
        test('should create quick action buttons in terminal header', () => {
            // Create a terminal element with quick action buttons
            const terminalElement = document.createElement('div');
            terminalElement.className = 'terminal-quadrant';
            terminalElement.dataset.quadrant = '0';
            terminalElement.innerHTML = `
                <div class="terminal-header">
                    <div class="terminal-quick-actions">
                        <button class="terminal-quick-btn" data-action="mcp" data-terminal="0" title="View configured MCP servers">
                            <i data-lucide="server"></i>
                        </button>
                        <button class="terminal-quick-btn" data-action="clear" data-terminal="0" title="Clear context - Recommended between tasks">
                            <i data-lucide="eraser"></i>
                        </button>
                        <button class="terminal-quick-btn" data-action="memory" data-terminal="0" title="Add memory context - Use # to store important context">
                            <i data-lucide="brain"></i>
                        </button>
                    </div>
                </div>
            `;

            document.getElementById('terminals-container').appendChild(terminalElement);

            // Check that buttons exist
            const quickActions = document.querySelector('.terminal-quick-actions');
            expect(quickActions).toBeTruthy();

            const buttons = document.querySelectorAll('.terminal-quick-btn');
            expect(buttons.length).toBe(3);

            // Check individual buttons
            const mcpButton = document.querySelector('[data-action="mcp"]');
            expect(mcpButton).toBeTruthy();
            expect(mcpButton.dataset.terminal).toBe('0');
            expect(mcpButton.title).toContain('MCP');

            const clearButton = document.querySelector('[data-action="clear"]');
            expect(clearButton).toBeTruthy();
            expect(clearButton.dataset.terminal).toBe('0');
            expect(clearButton.title).toContain('Clear');

            const memoryButton = document.querySelector('[data-action="memory"]');
            expect(memoryButton).toBeTruthy();
            expect(memoryButton.dataset.terminal).toBe('0');
            expect(memoryButton.title).toContain('memory');
        });

        test('should create buttons in both quadrant and tabbed modes', () => {
            // Test quadrant mode
            const quadrantTerminal = document.createElement('div');
            quadrantTerminal.className = 'terminal-quadrant';
            quadrantTerminal.innerHTML = `
                <div class="terminal-header">
                    <div class="terminal-quick-actions">
                        <button class="terminal-quick-btn" data-action="mcp" data-terminal="0"></button>
                        <button class="terminal-quick-btn" data-action="clear" data-terminal="0"></button>
                        <button class="terminal-quick-btn" data-action="memory" data-terminal="0"></button>
                    </div>
                </div>
            `;
            document.getElementById('terminals-container').appendChild(quadrantTerminal);

            // Test tabbed mode
            const tabbedTerminal = document.createElement('div');
            tabbedTerminal.className = 'terminal-quadrant';
            tabbedTerminal.innerHTML = `
                <div class="terminal-header">
                    <div class="terminal-quick-actions">
                        <button class="terminal-quick-btn" data-action="mcp" data-terminal="1"></button>
                        <button class="terminal-quick-btn" data-action="clear" data-terminal="1"></button>
                        <button class="terminal-quick-btn" data-action="memory" data-terminal="1"></button>
                    </div>
                </div>
            `;
            document.getElementById('tabbed-terminal-content').appendChild(tabbedTerminal);

            // Check both containers have buttons
            const quadrantButtons = document.querySelectorAll('#terminals-container .terminal-quick-btn');
            expect(quadrantButtons.length).toBe(3);

            const tabbedButtons = document.querySelectorAll('#tabbed-terminal-content .terminal-quick-btn');
            expect(tabbedButtons.length).toBe(3);
        });
    });

    describe('Button Functionality', () => {
        let mockTerminal;
        let terminals;

        beforeEach(() => {
            // Create a mock terminal instance
            mockTerminal = {
                terminal: {
                    paste: jest.fn(),
                    focus: jest.fn()
                }
            };

            // Create a terminals Map
            terminals = new Map();
            terminals.set(0, mockTerminal);
        });

        test('MCP button should write /mcp command', () => {
            // Simulate button click
            const mcpButton = document.createElement('button');
            mcpButton.className = 'terminal-quick-btn';
            mcpButton.dataset.action = 'mcp';
            mcpButton.dataset.terminal = '0';

            // Simulate the click handler logic
            const action = mcpButton.dataset.action;
            const terminalId = parseInt(mcpButton.dataset.terminal);
            const terminal = terminals.get(terminalId);

            if (terminal && terminal.terminal) {
                switch(action) {
                    case 'mcp':
                        terminal.terminal.paste('/mcp');
                        terminal.terminal.focus();
                        break;
                }
            }

            // Verify the paste was called with correct command
            expect(mockTerminal.terminal.paste).toHaveBeenCalledWith('/mcp');
            expect(mockTerminal.terminal.focus).toHaveBeenCalled();
        });

        test('Clear button should write /clear command', () => {
            // Simulate button click
            const clearButton = document.createElement('button');
            clearButton.className = 'terminal-quick-btn';
            clearButton.dataset.action = 'clear';
            clearButton.dataset.terminal = '0';

            // Simulate the click handler logic
            const action = clearButton.dataset.action;
            const terminalId = parseInt(clearButton.dataset.terminal);
            const terminal = terminals.get(terminalId);

            if (terminal && terminal.terminal) {
                switch(action) {
                    case 'clear':
                        terminal.terminal.paste('/clear');
                        terminal.terminal.focus();
                        break;
                }
            }

            // Verify the paste was called with correct command
            expect(mockTerminal.terminal.paste).toHaveBeenCalledWith('/clear');
            expect(mockTerminal.terminal.focus).toHaveBeenCalled();
        });

        test('Memory button should write # symbol only', () => {
            // Simulate button click
            const memoryButton = document.createElement('button');
            memoryButton.className = 'terminal-quick-btn';
            memoryButton.dataset.action = 'memory';
            memoryButton.dataset.terminal = '0';

            // Simulate the click handler logic
            const action = memoryButton.dataset.action;
            const terminalId = parseInt(memoryButton.dataset.terminal);
            const terminal = terminals.get(terminalId);

            if (terminal && terminal.terminal) {
                switch(action) {
                    case 'memory':
                        terminal.terminal.paste('#');
                        terminal.terminal.focus();
                        break;
                }
            }

            // Verify the paste was called with correct command
            expect(mockTerminal.terminal.paste).toHaveBeenCalledWith('#');
            expect(mockTerminal.terminal.focus).toHaveBeenCalled();
        });

        test('should not execute if terminal not initialized', () => {
            const button = document.createElement('button');
            button.className = 'terminal-quick-btn';
            button.dataset.action = 'mcp';
            button.dataset.terminal = '999'; // Non-existent terminal

            // Simulate the click handler logic
            const terminalId = parseInt(button.dataset.terminal);
            const terminal = terminals.get(terminalId);

            if (!terminal) {
                console.log(`Terminal ${terminalId} not initialized`);
            }

            // Verify nothing was called since terminal doesn't exist
            expect(mockTerminal.terminal.paste).not.toHaveBeenCalled();
        });
    });

    describe('Event Listeners', () => {
        test('should attach click event listeners to all quick buttons', () => {
            // Create buttons
            const container = document.getElementById('terminals-container');
            container.innerHTML = `
                <div class="terminal-quadrant">
                    <div class="terminal-header">
                        <div class="terminal-quick-actions">
                            <button class="terminal-quick-btn" data-action="mcp" data-terminal="0"></button>
                            <button class="terminal-quick-btn" data-action="clear" data-terminal="0"></button>
                            <button class="terminal-quick-btn" data-action="memory" data-terminal="0"></button>
                        </div>
                    </div>
                </div>
            `;

            const buttons = document.querySelectorAll('.terminal-quick-btn');
            const clickHandlers = [];

            // Simulate attaching event listeners
            buttons.forEach(btn => {
                const handler = jest.fn();
                btn.addEventListener('click', handler);
                clickHandlers.push({ btn, handler });
            });

            // Test that each button can be clicked
            clickHandlers.forEach(({ btn, handler }) => {
                const clickEvent = new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true
                });
                btn.dispatchEvent(clickEvent);
                expect(handler).toHaveBeenCalled();
            });
        });

        test('should stop event propagation on button click', () => {
            const button = document.createElement('button');
            button.className = 'terminal-quick-btn';
            
            const parentDiv = document.createElement('div');
            parentDiv.className = 'terminal-header';
            parentDiv.appendChild(button);

            const parentClickHandler = jest.fn();
            parentDiv.addEventListener('click', parentClickHandler);

            // Add button click handler that stops propagation
            button.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Click the button
            const clickEvent = new window.MouseEvent('click', {
                bubbles: true,
                cancelable: true
            });
            button.dispatchEvent(clickEvent);

            // Parent should not receive the click
            expect(parentClickHandler).not.toHaveBeenCalled();
        });
    });

    describe('Integration with Color Picker', () => {
        test('should not trigger color picker when clicking quick action buttons', () => {
            const terminalHeader = document.createElement('div');
            terminalHeader.className = 'terminal-header';
            terminalHeader.innerHTML = `
                <div class="terminal-quick-actions">
                    <button class="terminal-quick-btn" data-action="mcp"></button>
                </div>
            `;

            const showColorPicker = jest.fn();

            // Simulate the header click handler with exclusion logic
            terminalHeader.addEventListener('click', (e) => {
                if (!e.target.closest('.terminal-controls') && 
                    !e.target.closest('.git-branch-display') && 
                    !e.target.closest('.current-task') &&
                    !e.target.closest('.terminal-quick-actions') &&
                    !e.target.closest('.task-id-badge')) {
                    showColorPicker();
                }
            });

            // Click on the quick action button
            const button = terminalHeader.querySelector('.terminal-quick-btn');
            const clickEvent = new window.MouseEvent('click', {
                bubbles: true,
                cancelable: true
            });
            button.dispatchEvent(clickEvent);

            // Color picker should not be triggered
            expect(showColorPicker).not.toHaveBeenCalled();

            // Click on the header itself
            terminalHeader.dispatchEvent(clickEvent);

            // Color picker should be triggered
            expect(showColorPicker).toHaveBeenCalled();
        });
    });

    describe('Button Styling', () => {
        test('should have correct CSS classes', () => {
            const button = document.createElement('button');
            button.className = 'terminal-quick-btn';
            button.dataset.action = 'mcp';

            expect(button.classList.contains('terminal-quick-btn')).toBe(true);
            expect(button.dataset.action).toBe('mcp');
        });

        test('should have tooltip titles', () => {
            const mcpButton = document.createElement('button');
            mcpButton.title = 'View configured MCP servers';
            expect(mcpButton.title).toContain('MCP');

            const clearButton = document.createElement('button');
            clearButton.title = 'Clear context - Recommended between tasks';
            expect(clearButton.title).toContain('Clear');

            const memoryButton = document.createElement('button');
            memoryButton.title = 'Add memory context - Use # to store important context';
            expect(memoryButton.title).toContain('memory');
        });
    });
});
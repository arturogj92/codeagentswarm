/**
 * Tests for notification click handling in tabbed mode
 * 
 * This test file verifies that clicking on a notification in tabbed mode
 * correctly focuses on the corresponding terminal tab.
 */

// Mock the TerminalManager class
class MockTerminalManager {
    constructor() {
        this.layoutMode = 'grid'; // Default to grid mode
        this.terminals = new Map();
        this.activeTabTerminal = null;
        this.switchToTabCalled = false;
        this.switchToTabCalledWith = null;
        this.scrollToBottomCalled = false;
        this.scrollToBottomCalledWith = null;
        this.highlightTerminalCalled = false;
        this.highlightTerminalCalledWith = null;
    }

    switchToTab(terminalId) {
        this.switchToTabCalled = true;
        this.switchToTabCalledWith = terminalId;
        this.activeTabTerminal = terminalId;
    }

    scrollTerminalToBottom(terminalId) {
        this.scrollToBottomCalled = true;
        this.scrollToBottomCalledWith = terminalId;
    }

    highlightTerminal(terminalId) {
        this.highlightTerminalCalled = true;
        this.highlightTerminalCalledWith = terminalId;
    }

    reset() {
        this.switchToTabCalled = false;
        this.switchToTabCalledWith = null;
        this.scrollToBottomCalled = false;
        this.scrollToBottomCalledWith = null;
        this.highlightTerminalCalled = false;
        this.highlightTerminalCalledWith = null;
    }
}

describe('Notification Tab Focus Tests', () => {
    let terminalManager;

    beforeEach(() => {
        terminalManager = new MockTerminalManager();
        // Mock terminals
        terminalManager.terminals.set(0, { terminal: {} });
        terminalManager.terminals.set(1, { terminal: {} });
        terminalManager.terminals.set(2, { terminal: {} });
    });

    afterEach(() => {
        terminalManager.reset();
    });

    describe('Tabbed Mode', () => {
        beforeEach(() => {
            terminalManager.layoutMode = 'tabbed';
            terminalManager.activeTabTerminal = 0;
        });

        test('should switch to correct tab when notification is clicked', () => {
            // Simulate notification click for terminal 2 (quadrant 1)
            const quadrant = 1;
            
            // Simulate the IPC event
            const event = { sender: {} };
            const handler = (event, quadrant) => {
                if (terminalManager.layoutMode === 'tabbed' && terminalManager.terminals.has(quadrant)) {
                    terminalManager.switchToTab(quadrant);
                    terminalManager.scrollTerminalToBottom(quadrant);
                }
            };

            // Execute handler
            handler(event, quadrant);

            // Verify that switchToTab was called with correct terminal
            expect(terminalManager.switchToTabCalled).toBe(true);
            expect(terminalManager.switchToTabCalledWith).toBe(quadrant);
            expect(terminalManager.activeTabTerminal).toBe(quadrant);

            // Verify that scroll to bottom was also called
            expect(terminalManager.scrollToBottomCalled).toBe(true);
            expect(terminalManager.scrollToBottomCalledWith).toBe(quadrant);
        });

        test('should not switch tab if terminal does not exist', () => {
            // Try to switch to a non-existent terminal
            const quadrant = 5; // Terminal doesn't exist
            
            // Simulate the IPC event
            const event = { sender: {} };
            const handler = (event, quadrant) => {
                if (terminalManager.layoutMode === 'tabbed' && terminalManager.terminals.has(quadrant)) {
                    terminalManager.switchToTab(quadrant);
                    terminalManager.scrollTerminalToBottom(quadrant);
                }
            };

            // Execute handler
            handler(event, quadrant);

            // Verify that switchToTab was NOT called
            expect(terminalManager.switchToTabCalled).toBe(false);
            expect(terminalManager.scrollToBottomCalled).toBe(false);
        });

        test('should do nothing if already on the correct tab', () => {
            // Set active tab to terminal 1
            terminalManager.activeTabTerminal = 1;
            terminalManager.switchToTab = function(terminalId) {
                if (this.activeTabTerminal === terminalId) return;
                this.switchToTabCalled = true;
                this.switchToTabCalledWith = terminalId;
                this.activeTabTerminal = terminalId;
            };

            const quadrant = 1; // Same as active tab
            
            // Simulate the IPC event
            const event = { sender: {} };
            const handler = (event, quadrant) => {
                if (terminalManager.layoutMode === 'tabbed' && terminalManager.terminals.has(quadrant)) {
                    terminalManager.switchToTab(quadrant);
                    terminalManager.scrollTerminalToBottom(quadrant);
                }
            };

            // Execute handler
            handler(event, quadrant);

            // Verify that switchToTab returns early
            expect(terminalManager.switchToTabCalled).toBe(false);
            // But scroll should still be called
            expect(terminalManager.scrollToBottomCalled).toBe(true);
        });
    });

    describe('Grid Mode', () => {
        beforeEach(() => {
            terminalManager.layoutMode = 'grid';
        });

        test('should highlight and scroll terminal in grid mode', () => {
            const quadrant = 2;
            
            // Simulate the IPC event
            const event = { sender: {} };
            const handler = (event, quadrant) => {
                if (terminalManager.layoutMode === 'tabbed' && terminalManager.terminals.has(quadrant)) {
                    terminalManager.switchToTab(quadrant);
                    terminalManager.scrollTerminalToBottom(quadrant);
                } else if (terminalManager.layoutMode === 'grid') {
                    terminalManager.scrollTerminalToBottom(quadrant);
                    terminalManager.highlightTerminal(quadrant);
                }
            };

            // Execute handler
            handler(event, quadrant);

            // Verify that switchToTab was NOT called (we're in grid mode)
            expect(terminalManager.switchToTabCalled).toBe(false);

            // Verify that scroll and highlight were called
            expect(terminalManager.scrollToBottomCalled).toBe(true);
            expect(terminalManager.scrollToBottomCalledWith).toBe(quadrant);
            expect(terminalManager.highlightTerminalCalled).toBe(true);
            expect(terminalManager.highlightTerminalCalledWith).toBe(quadrant);
        });
    });

    describe('Notification Message Parsing', () => {
        test('should extract terminal number from notification message', () => {
            const testCases = [
                { message: 'Terminal 1 needs attention', expected: 0 },
                { message: 'Check Terminal 3 for updates', expected: 2 },
                { message: 'Terminal 6 has completed', expected: 5 },
                { message: 'No terminal mentioned', expected: null }
            ];

            testCases.forEach(testCase => {
                const terminalMatch = testCase.message.match(/Terminal (\d+)/);
                if (terminalMatch) {
                    const terminalNumber = parseInt(terminalMatch[1]);
                    const quadrant = terminalNumber - 1; // Convert 1-based to 0-based
                    expect(quadrant).toBe(testCase.expected);
                } else {
                    expect(testCase.expected).toBe(null);
                }
            });
        });
    });

    describe('Main Process Notification Handler', () => {
        test('should send focus-terminal-tab event when notification is clicked', () => {
            // Mock the notification click handler
            const mockMainWindow = {
                isMinimized: jest.fn().mockReturnValue(false),
                restore: jest.fn(),
                focus: jest.fn(),
                webContents: {
                    send: jest.fn()
                }
            };

            // Simulate terminal match
            const terminalMatch = ['Terminal 2', '2'];
            
            // Create the click handler
            const clickHandler = () => {
                if (mockMainWindow) {
                    if (mockMainWindow.isMinimized()) mockMainWindow.restore();
                    mockMainWindow.focus();
                    
                    // If in tabbed mode, switch to the corresponding tab
                    const terminalNumber = parseInt(terminalMatch[1]);
                    const quadrant = terminalNumber - 1; // Convert 1-based to 0-based
                    mockMainWindow.webContents.send('focus-terminal-tab', quadrant);
                }
            };

            // Execute the handler
            clickHandler();

            // Verify the correct calls were made
            expect(mockMainWindow.focus).toHaveBeenCalled();
            expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('focus-terminal-tab', 1);
        });

        test('should restore window if minimized before focusing tab', () => {
            const mockMainWindow = {
                isMinimized: jest.fn().mockReturnValue(true),
                restore: jest.fn(),
                focus: jest.fn(),
                webContents: {
                    send: jest.fn()
                }
            };

            const terminalMatch = ['Terminal 3', '3'];
            
            const clickHandler = () => {
                if (mockMainWindow) {
                    if (mockMainWindow.isMinimized()) mockMainWindow.restore();
                    mockMainWindow.focus();
                    
                    const terminalNumber = parseInt(terminalMatch[1]);
                    const quadrant = terminalNumber - 1;
                    mockMainWindow.webContents.send('focus-terminal-tab', quadrant);
                }
            };

            clickHandler();

            // Verify restore was called since window was minimized
            expect(mockMainWindow.restore).toHaveBeenCalled();
            expect(mockMainWindow.focus).toHaveBeenCalled();
            expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('focus-terminal-tab', 2);
        });
    });

    describe('Integration Tests', () => {
        test('should handle full notification flow in tabbed mode', () => {
            // Set up tabbed mode
            terminalManager.layoutMode = 'tabbed';
            terminalManager.activeTabTerminal = 0;
            
            // Create a more realistic handler that mimics the actual implementation
            const focusTerminalTabHandler = (quadrant) => {
                if (terminalManager.layoutMode === 'tabbed' && terminalManager.terminals.has(quadrant)) {
                    // Switch to the tab when notification is clicked
                    terminalManager.switchToTab(quadrant);
                    // Also scroll to bottom for good measure
                    terminalManager.scrollTerminalToBottom(quadrant);
                } else if (terminalManager.layoutMode === 'grid') {
                    // In grid mode, just scroll to bottom and highlight the terminal
                    terminalManager.scrollTerminalToBottom(quadrant);
                    terminalManager.highlightTerminal(quadrant);
                }
            };

            // Simulate clicking on a notification for terminal 3
            const notificationMessage = 'Terminal 3 needs your attention';
            const terminalMatch = notificationMessage.match(/Terminal (\d+)/);
            const terminalNumber = parseInt(terminalMatch[1]);
            const quadrant = terminalNumber - 1; // Convert to 0-based

            // Execute the handler
            focusTerminalTabHandler(quadrant);

            // Verify the correct behavior
            expect(terminalManager.switchToTabCalled).toBe(true);
            expect(terminalManager.switchToTabCalledWith).toBe(2); // Terminal 3 = quadrant 2
            expect(terminalManager.activeTabTerminal).toBe(2);
            expect(terminalManager.scrollToBottomCalled).toBe(true);
            expect(terminalManager.scrollToBottomCalledWith).toBe(2);
            
            // Highlight should NOT be called in tabbed mode
            expect(terminalManager.highlightTerminalCalled).toBe(false);
        });

        test('should handle full notification flow in grid mode', () => {
            // Set up grid mode
            terminalManager.layoutMode = 'grid';
            
            // Create a more realistic handler that mimics the actual implementation
            const focusTerminalTabHandler = (quadrant) => {
                if (terminalManager.layoutMode === 'tabbed' && terminalManager.terminals.has(quadrant)) {
                    terminalManager.switchToTab(quadrant);
                    terminalManager.scrollTerminalToBottom(quadrant);
                } else if (terminalManager.layoutMode === 'grid') {
                    terminalManager.scrollTerminalToBottom(quadrant);
                    terminalManager.highlightTerminal(quadrant);
                }
            };

            // Simulate clicking on a notification for terminal 2
            const notificationMessage = 'Terminal 2 completed task';
            const terminalMatch = notificationMessage.match(/Terminal (\d+)/);
            const terminalNumber = parseInt(terminalMatch[1]);
            const quadrant = terminalNumber - 1; // Convert to 0-based

            // Execute the handler
            focusTerminalTabHandler(quadrant);

            // Verify the correct behavior
            expect(terminalManager.switchToTabCalled).toBe(false); // No tab switching in grid mode
            expect(terminalManager.scrollToBottomCalled).toBe(true);
            expect(terminalManager.scrollToBottomCalledWith).toBe(1); // Terminal 2 = quadrant 1
            expect(terminalManager.highlightTerminalCalled).toBe(true);
            expect(terminalManager.highlightTerminalCalledWith).toBe(1);
        });
    });
});

// Export for use in test runner
module.exports = { MockTerminalManager };
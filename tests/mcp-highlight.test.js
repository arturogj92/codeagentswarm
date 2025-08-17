/**
 * Tests for MCP Highlight Features
 */

// Mock localStorage
const localStorageMock = (() => {
    let store = {};
    const mock = {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => store[key] = value.toString(),
        removeItem: (key) => delete store[key],
        clear: () => store = {},
        get length() { return Object.keys(store).length; },
        key: (index) => Object.keys(store)[index] || null,
        getStore: () => store
    };
    return mock;
})();

// Mock window
global.window = {
    appVersion: '0.0.41',
    localStorage: localStorageMock,
    terminalManager: null
};

global.localStorage = localStorageMock;

// Mock DOM
global.document = {
    body: {
        innerHTML: '',
        appendChild: jest.fn(),
        querySelector: jest.fn(),
        querySelectorAll: jest.fn(() => [])
    },
    head: {
        appendChild: jest.fn()
    },
    getElementById: jest.fn(),
    querySelector: jest.fn(),
    querySelectorAll: jest.fn(() => []),
    createElement: jest.fn((tag) => {
        const element = {
            tagName: tag.toUpperCase(),
            id: '',
            className: '',
            textContent: '',
            innerHTML: '',
            style: {},
            classList: {
                add: jest.fn(),
                remove: jest.fn(),
                contains: jest.fn()
            },
            appendChild: jest.fn(),
            removeChild: jest.fn(),
            remove: jest.fn(),
            querySelector: jest.fn(),
            querySelectorAll: jest.fn(() => []),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            click: jest.fn(),
            setAttribute: jest.fn(),
            getAttribute: jest.fn(),
            hasAttribute: jest.fn(),
            removeAttribute: jest.fn()
        };
        
        // Special handling for style element
        if (tag === 'style') {
            element.sheet = {
                insertRule: jest.fn(),
                deleteRule: jest.fn(),
                cssRules: []
            };
        }
        
        return element;
    })
};

// Mock console
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

describe('MCP Highlight Features', () => {
    let terminalManager;
    let originalAppVersion;
    
    beforeEach(() => {
        // Reset store
        localStorageMock.clear();
        
        // Save original appVersion
        originalAppVersion = window.appVersion;
        
        // Reset all mocks
        jest.clearAllMocks();
        
        // Setup DOM structure
        const mcpTabButton = document.createElement('button');
        mcpTabButton.className = 'tab-btn';
        mcpTabButton.setAttribute('data-tab', 'mcp-servers');
        
        const mcpTabContent = document.createElement('div');
        mcpTabContent.id = 'mcp-servers';
        mcpTabContent.className = 'tab-content';
        
        const saveButton = document.createElement('button');
        saveButton.id = 'save-server-config';
        
        // Setup querySelector mock responses
        document.querySelector.mockImplementation((selector) => {
            if (selector === '.tab-btn[data-tab="mcp-servers"]') {
                return mcpTabButton;
            }
            if (selector === '#save-server-config') {
                return saveButton;
            }
            if (selector === '.tab-content.active') {
                return mcpTabContent;
            }
            if (selector === '.mcp-tab-badge') {
                return mcpTabButton.querySelector('.mcp-tab-badge');
            }
            if (selector === '.mcp-highlight-overlay') {
                return document.body.querySelector('.mcp-highlight-overlay');
            }
            return null;
        });
        
        document.getElementById.mockImplementation((id) => {
            if (id === 'mcp-servers') {
                return mcpTabContent;
            }
            if (id === 'save-server-config') {
                return saveButton;
            }
            if (id === 'mcp-tab-badge-styles') {
                return null; // Initially no styles
            }
            return null;
        });
        
        document.querySelectorAll.mockImplementation((selector) => {
            if (selector === '.mcp-tab-badge') {
                const badges = [];
                if (mcpTabButton.querySelector('.mcp-tab-badge')) {
                    badges.push(mcpTabButton.querySelector('.mcp-tab-badge'));
                }
                return badges;
            }
            if (selector === '.mcp-highlight-overlay') {
                const highlights = [];
                if (document.body.querySelector('.mcp-highlight-overlay')) {
                    highlights.push(document.body.querySelector('.mcp-highlight-overlay'));
                }
                return highlights;
            }
            return [];
        });
        
        // Mock button methods
        mcpTabButton.querySelector = jest.fn((selector) => {
            if (selector === '.mcp-tab-badge' && mcpTabButton._badge) {
                return mcpTabButton._badge;
            }
            return null;
        });
        
        mcpTabButton.appendChild = jest.fn((child) => {
            if (child.className === 'mcp-tab-badge') {
                mcpTabButton._badge = child;
            }
        });
        
        mcpTabButton.addEventListener = jest.fn((event, handler, options) => {
            if (event === 'click' && options?.once) {
                mcpTabButton._clickHandler = handler;
            }
        });
        
        mcpTabButton.click = jest.fn(() => {
            if (mcpTabButton._clickHandler) {
                mcpTabButton._clickHandler();
                mcpTabButton._clickHandler = null; // Clear after first click (once: true)
            }
        });
        
        // Mock body methods
        document.body.querySelector = jest.fn((selector) => {
            if (selector === '.mcp-highlight-overlay' && document.body._highlight) {
                return document.body._highlight;
            }
            return null;
        });
        
        document.body.appendChild = jest.fn((child) => {
            if (child.className === 'mcp-highlight-overlay') {
                document.body._highlight = child;
                
                // Setup dismiss button
                const dismissBtn = {
                    addEventListener: jest.fn((event, handler) => {
                        if (event === 'click') {
                            dismissBtn._clickHandler = handler;
                        }
                    }),
                    click: jest.fn(() => {
                        if (dismissBtn._clickHandler) {
                            dismissBtn._clickHandler();
                        }
                    })
                };
                
                child.querySelector = jest.fn((selector) => {
                    if (selector === '.mcp-highlight-dismiss') {
                        return dismissBtn;
                    }
                    if (selector === 'h3') {
                        return { textContent: `💡 New in v${window.appVersion}!` };
                    }
                    return null;
                });
                
                child.remove = jest.fn(() => {
                    document.body._highlight = null;
                });
            }
        });
        
        // Create terminalManager with the actual methods
        terminalManager = {
            addMCPTabBadgeIfNeeded: function() {
                const targetVersions = ['0.0.41', '0.0.42', '0.0.43', '0.0.44', '0.0.45', '0.0.46', '0.0.47', '0.0.48'];
                
                if (!window.appVersion || !targetVersions.includes(window.appVersion)) {
                    return;
                }
                
                const storageKey = `mcpTabBadge_${window.appVersion}_shown`;
                if (localStorage.getItem(storageKey) === 'true') {
                    return;
                }
                
                const mcpTabButton = document.querySelector('.tab-btn[data-tab="mcp-servers"]');
                if (!mcpTabButton || mcpTabButton.querySelector('.mcp-tab-badge')) {
                    return;
                }
                
                const badge = document.createElement('span');
                badge.className = 'mcp-tab-badge';
                badge.textContent = 'NEW!';
                badge.remove = jest.fn(() => {
                    mcpTabButton._badge = null;
                });
                mcpTabButton.appendChild(badge);
                
                // Add styles
                if (!document.getElementById('mcp-tab-badge-styles')) {
                    const styles = document.createElement('style');
                    styles.id = 'mcp-tab-badge-styles';
                    styles.textContent = '.mcp-tab-badge { color: white; }';
                    document.head.appendChild(styles);
                }
                
                // Mark as shown after first click
                mcpTabButton.addEventListener('click', () => {
                    localStorage.setItem(storageKey, 'true');
                    badge.remove();
                }, { once: true });
                
                console.log('MCP tab badge added for version', window.appVersion);
            },
            
            showMCPHighlightIfNeeded: function() {
                const targetVersions = ['0.0.41', '0.0.42', '0.0.43', '0.0.44', '0.0.45', '0.0.46', '0.0.47', '0.0.48'];
                
                if (!window.appVersion || !targetVersions.includes(window.appVersion)) {
                    console.log(`MCP highlight skipped - version ${window.appVersion} not in target range`);
                    return;
                }
                
                const storageKey = `mcpHighlight_${window.appVersion}_shown`;
                if (localStorage.getItem(storageKey) === 'true') {
                    console.log('MCP highlight already shown for version', window.appVersion);
                    return;
                }
                
                const activeTab = document.querySelector('.tab-content.active');
                if (!activeTab || activeTab.id !== 'mcp-servers') {
                    console.log('MCP highlight skipped - not on MCP tab');
                    return;
                }
                
                const saveButton = document.querySelector('#save-server-config');
                if (!saveButton) {
                    console.log('MCP highlight skipped - save button not found');
                    return;
                }
                
                // Remove existing highlight if any
                const existingHighlight = document.querySelector('.mcp-highlight-overlay');
                if (existingHighlight) {
                    existingHighlight.remove();
                }
                
                // Create highlight overlay
                const overlay = document.createElement('div');
                overlay.className = 'mcp-highlight-overlay';
                overlay.innerHTML = `
                    <div class="mcp-highlight-backdrop"></div>
                    <div class="mcp-highlight-content">
                        <div class="mcp-highlight-arrow"></div>
                        <div class="mcp-highlight-message">
                            <h3>💡 New in v${window.appVersion}!</h3>
                            <p>Configure MCP servers here to enhance Claude's capabilities</p>
                            <button class="mcp-highlight-dismiss">Got it!</button>
                        </div>
                    </div>
                `;
                
                document.body.appendChild(overlay);
                
                // Add dismiss handler
                const dismissBtn = overlay.querySelector('.mcp-highlight-dismiss');
                dismissBtn.addEventListener('click', () => {
                    localStorage.setItem(storageKey, 'true');
                    overlay.remove();
                    console.log('MCP highlight dismissed and marked as shown');
                });
                
                console.log('MCP highlight shown for version', window.appVersion);
            }
        };
        window.terminalManager = terminalManager;
    });
    
    afterEach(() => {
        // Restore original appVersion
        window.appVersion = originalAppVersion;
        
        // Clear mocks
        jest.clearAllMocks();
        
        // Clear localStorage
        localStorageMock.clear();
    });
    
    describe('addMCPTabBadgeIfNeeded', () => {
        it('should add badge for version 0.0.41', () => {
            window.appVersion = '0.0.41';
            
            terminalManager.addMCPTabBadgeIfNeeded();
            
            const mcpTabButton = document.querySelector('.tab-btn[data-tab="mcp-servers"]');
            expect(mcpTabButton.appendChild).toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith('MCP tab badge added for version', '0.0.41');
        });
        
        it('should add badge for all target versions (0.0.41-0.0.48)', () => {
            const targetVersions = ['0.0.41', '0.0.42', '0.0.43', '0.0.44', '0.0.45', '0.0.46', '0.0.47', '0.0.48'];
            
            targetVersions.forEach(version => {
                jest.clearAllMocks();
                localStorageMock.clear();
                
                // Reset badge state
                const mcpTabButton = document.querySelector('.tab-btn[data-tab="mcp-servers"]');
                mcpTabButton._badge = null;
                
                window.appVersion = version;
                terminalManager.addMCPTabBadgeIfNeeded();
                
                expect(mcpTabButton.appendChild).toHaveBeenCalled();
                expect(consoleLogSpy).toHaveBeenCalledWith('MCP tab badge added for version', version);
            });
        });
        
        it('should not add badge for versions outside target range', () => {
            const nonTargetVersions = ['0.0.40', '0.0.49', '0.0.50', '1.0.0'];
            
            nonTargetVersions.forEach(version => {
                jest.clearAllMocks();
                
                window.appVersion = version;
                terminalManager.addMCPTabBadgeIfNeeded();
                
                const mcpTabButton = document.querySelector('.tab-btn[data-tab="mcp-servers"]');
                expect(mcpTabButton.appendChild).not.toHaveBeenCalled();
            });
        });
        
        it('should not add badge if already shown', () => {
            window.appVersion = '0.0.41';
            localStorage.setItem('mcpTabBadge_0.0.41_shown', 'true');
            
            terminalManager.addMCPTabBadgeIfNeeded();
            
            const mcpTabButton = document.querySelector('.tab-btn[data-tab="mcp-servers"]');
            expect(mcpTabButton.appendChild).not.toHaveBeenCalled();
        });
        
        it('should not add duplicate badges', () => {
            window.appVersion = '0.0.41';
            
            terminalManager.addMCPTabBadgeIfNeeded();
            jest.clearAllMocks();
            
            // Second call should not add another badge
            terminalManager.addMCPTabBadgeIfNeeded();
            
            const mcpTabButton = document.querySelector('.tab-btn[data-tab="mcp-servers"]');
            expect(mcpTabButton.appendChild).not.toHaveBeenCalled();
        });
        
        it('should add styles for badge', () => {
            window.appVersion = '0.0.41';
            
            terminalManager.addMCPTabBadgeIfNeeded();
            
            expect(document.head.appendChild).toHaveBeenCalled();
        });
        
        it('should remove badge and save to localStorage on tab click', () => {
            window.appVersion = '0.0.41';
            
            terminalManager.addMCPTabBadgeIfNeeded();
            
            const mcpTabButton = document.querySelector('.tab-btn[data-tab="mcp-servers"]');
            
            // Simulate click
            mcpTabButton.click();
            
            // Should be marked as shown in localStorage
            expect(localStorage.getItem('mcpTabBadge_0.0.41_shown')).toBe('true');
        });
    });
    
    describe('showMCPHighlightIfNeeded', () => {
        beforeEach(() => {
            // Make MCP tab active for tests
            const mcpTabContent = document.getElementById('mcp-servers');
            mcpTabContent.classList.add('active');
        });
        
        it('should show highlight for version 0.0.41 on MCP tab', () => {
            window.appVersion = '0.0.41';
            
            terminalManager.showMCPHighlightIfNeeded();
            
            expect(document.body.appendChild).toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith('MCP highlight shown for version', '0.0.41');
        });
        
        it('should show highlight for all target versions (0.0.41-0.0.48)', () => {
            const targetVersions = ['0.0.41', '0.0.42', '0.0.43', '0.0.44', '0.0.45', '0.0.46', '0.0.47', '0.0.48'];
            
            targetVersions.forEach(version => {
                jest.clearAllMocks();
                localStorageMock.clear();
                document.body._highlight = null;
                
                window.appVersion = version;
                terminalManager.showMCPHighlightIfNeeded();
                
                expect(document.body.appendChild).toHaveBeenCalled();
                expect(consoleLogSpy).toHaveBeenCalledWith('MCP highlight shown for version', version);
            });
        });
        
        it('should not show highlight for versions outside target range', () => {
            const nonTargetVersions = ['0.0.40', '0.0.49', '0.0.50', '1.0.0'];
            
            nonTargetVersions.forEach(version => {
                jest.clearAllMocks();
                
                window.appVersion = version;
                terminalManager.showMCPHighlightIfNeeded();
                
                expect(document.body.appendChild).not.toHaveBeenCalled();
                expect(consoleLogSpy).toHaveBeenCalledWith(`MCP highlight skipped - version ${version} not in target range`);
            });
        });
        
        it('should not show highlight if already shown', () => {
            window.appVersion = '0.0.41';
            localStorage.setItem('mcpHighlight_0.0.41_shown', 'true');
            
            terminalManager.showMCPHighlightIfNeeded();
            
            expect(document.body.appendChild).not.toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith('MCP highlight already shown for version', '0.0.41');
        });
        
        it('should not show highlight if not on MCP tab', () => {
            window.appVersion = '0.0.41';
            
            // Remove active class from MCP tab
            const mcpTabContent = document.getElementById('mcp-servers');
            mcpTabContent.classList.remove('active');
            
            // Update mock to return null for active tab query
            const originalQuerySelector = document.querySelector;
            document.querySelector = jest.fn((selector) => {
                if (selector === '.tab-content.active') {
                    return null; // No active tab
                }
                return originalQuerySelector(selector);
            });
            
            terminalManager.showMCPHighlightIfNeeded();
            
            expect(document.body.appendChild).not.toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith('MCP highlight skipped - not on MCP tab');
            
            // Restore original mock
            document.querySelector = originalQuerySelector;
        });
        
        it('should dismiss highlight and save to localStorage on button click', () => {
            window.appVersion = '0.0.41';
            
            terminalManager.showMCPHighlightIfNeeded();
            
            const highlight = document.body._highlight;
            const dismissBtn = highlight.querySelector('.mcp-highlight-dismiss');
            
            // Click dismiss button
            dismissBtn.click();
            
            // Should be marked as shown in localStorage
            expect(localStorage.getItem('mcpHighlight_0.0.41_shown')).toBe('true');
            expect(consoleLogSpy).toHaveBeenCalledWith('MCP highlight dismissed and marked as shown');
        });
    });
    
    describe('Integration between badge and highlight', () => {
        it('should show both badge and highlight for target versions', () => {
            window.appVersion = '0.0.41';
            const mcpTabContent = document.getElementById('mcp-servers');
            mcpTabContent.classList.add('active');
            
            terminalManager.addMCPTabBadgeIfNeeded();
            terminalManager.showMCPHighlightIfNeeded();
            
            const mcpTabButton = document.querySelector('.tab-btn[data-tab="mcp-servers"]');
            expect(mcpTabButton.appendChild).toHaveBeenCalled();
            expect(document.body.appendChild).toHaveBeenCalled();
        });
        
        it('should handle independent localStorage tracking', () => {
            window.appVersion = '0.0.41';
            const mcpTabContent = document.getElementById('mcp-servers');
            mcpTabContent.classList.add('active');
            
            // Show badge but not highlight
            terminalManager.addMCPTabBadgeIfNeeded();
            localStorage.setItem('mcpHighlight_0.0.41_shown', 'true');
            terminalManager.showMCPHighlightIfNeeded();
            
            const mcpTabButton = document.querySelector('.tab-btn[data-tab="mcp-servers"]');
            expect(mcpTabButton.appendChild).toHaveBeenCalled();
            expect(document.body.appendChild).not.toHaveBeenCalled();
            
            // Clear and test opposite
            jest.clearAllMocks();
            localStorageMock.clear();
            mcpTabButton._badge = null;
            
            localStorage.setItem('mcpTabBadge_0.0.41_shown', 'true');
            terminalManager.addMCPTabBadgeIfNeeded();
            terminalManager.showMCPHighlightIfNeeded();
            
            expect(mcpTabButton.appendChild).not.toHaveBeenCalled();
            expect(document.body.appendChild).toHaveBeenCalled();
        });
    });
});
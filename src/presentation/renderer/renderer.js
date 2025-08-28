const { ipcRenderer } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const { WebLinksAddon } = require('xterm-addon-web-links');
const LogViewer = require('../components/log-viewer');
const FeatureHighlight = require('../../shared/utils/feature-highlight');
const UpdateNotificationManager = require('../../shared/utils/update-notification-manager');

// Log renderer initialization
console.log('🔧 [RENDERER] renderer.js loaded');

// Expose ipcRenderer globally for other modules
window.ipcRenderer = ipcRenderer;

// Performance monitor function - lazy loaded
function loadPerformanceMonitor() {
    try {
        return require('./performance-monitor');
    } catch (e) {
        console.log('[RENDERER] Performance monitor not available:', e.message);
        return null;
    }
}

class TerminalManager {
    constructor() {
        this.terminals = new Map();
        this.activeTerminal = null;
        this.fullscreenTerminal = null;
        this.currentLayout = 'horizontal'; // Default layout for 2 terminals
        this.layoutMode = 'grid'; // 'grid' or 'tabbed'
        this.activeTabTerminal = null; // Currently active terminal in tabbed mode
        this.visualOrder = null; // Track visual order after swaps
        this.lastSelectedDirectories = {}; // Initialize empty, will load async
        this.notificationBlocked = new Map(); // Block notifications until user interaction
        this.waitingForUserInteraction = new Map(); // Track terminals waiting for interaction
        this.terminalFocused = new Map(); // Track which terminals are focused
        this.userTypingTimers = new Map(); // Track when user is actively typing
        this.highlightedTerminal = null; // Track which terminal is currently highlighted for confirmation
        this.customProjectColors = {}; // Store custom colors per project
        this.terminalsNeedingAttention = new Set(); // Track terminals that need user attention
        this.isChangingLayout = false; // Flag to prevent re-parsing during layout changes
        this.hooksStatus = { installed: false, webhookRunning: false }; // Track hooks status
        this.terminalActivity = new Map(); // Track activity state for each terminal
        this.userScrolling = new Map(); // Track if user is manually scrolling
        this.scrollTimeouts = new Map(); // Track scroll timeout timers
        this.claudeOutputting = new Map(); // Track if Claude is actively outputting to a terminal
        
        this.init();
        // Load directories asynchronously with error handling
        this.loadSavedDirectories().catch(error => {
            console.warn('Failed to load saved directories on startup:', error);
        });
    }
    
    // Load saved directories asynchronously
    async loadSavedDirectories() {
        try {
            this.lastSelectedDirectories = await this.loadDirectoriesFromStorage();
        } catch (error) {
            console.warn('Failed to load saved directories on startup:', error);
            this.lastSelectedDirectories = {};
        }
    }
    
    // Load saved directories from database
    async loadDirectoriesFromStorage() {
        try {
            const result = await ipcRenderer.invoke('db-get-all-directories');
            if (result && result.success) {
                return result.directories || {};
            } else {
                console.warn('Failed to load directories:', result);
                return {};   
            }
        } catch (error) {
            console.warn('Error loading directories:', error);
            return {};
        }
    }
    
    // Save directory to database
    async saveDirectoryToStorage(quadrant, directory) {
        try {
            const result = await ipcRenderer.invoke('db-save-directory', quadrant, directory);
            if (!result || !result.success) {
                console.warn('Failed to save directory:', result);
            }
        } catch (error) {
            console.warn('Error saving directory:', error);
        }
    }

    init() {
        // Notify main process that renderer is ready (clears notification tracking)
        ipcRenderer.invoke('renderer-ready').then(() => {

        }).catch(err => {
            console.error('Failed to notify main process:', err);
        });
        
        this.setupEventListeners();
        this.setupResizeHandlers();
        this.setupGlobalTerminalFocusDetection(); // Add global focus detection
        this.updateGitButtonVisibility(); // Initialize git button visibility
        this.startTaskIndicatorUpdates(); // Initialize task indicators with periodic updates
        this.checkHooksStatus(); // Check hooks status on startup
        this.startHooksStatusUpdates(); // Periodically check hooks status
        this.startTerminalRefreshInterval(); // Start periodic terminal refresh to fix rendering issues
        
        // Setup delegated event listeners for placeholders early
        this.attachTerminalEventListeners();
        
        // Listen for clear waiting states message
        ipcRenderer.on('clear-waiting-states', () => {
            this.terminalsNeedingAttention.clear();
            this.waitingForUserInteraction.forEach((value, key) => {
                this.waitingForUserInteraction.set(key, false);
            });
            this.notificationBlocked.forEach((value, key) => {
                this.notificationBlocked.set(key, false);
            });
        });
        
        // Listen for webhook events
        ipcRenderer.on('confirmation-needed', (event, data) => {

            const { terminalId, tool } = data;

            if (terminalId !== null && terminalId >= 0 && terminalId < 4) {

                this.terminalsNeedingAttention.add(terminalId);

                this.updateNotificationBadge();
                this.highlightTerminalForConfirmation(terminalId);
                this.scrollTerminalToBottom(terminalId);
            } else {

            }
        });
        
        ipcRenderer.on('claude-finished', (event, data) => {

            const { terminalId } = data;
            if (terminalId !== null && terminalId >= 0 && terminalId < 4) {
                // Don't show notification badge for completion, just scroll
                // The system notification is already shown by webhook-server.js
                this.scrollTerminalToBottom(terminalId);
                
                // In grid mode, add a subtle highlight that auto-removes
                if (this.layoutMode === 'grid') {
                    const terminalElement = document.querySelector(`[data-quadrant="${terminalId}"]`);
                    if (terminalElement) {
                        terminalElement.classList.add('completion-highlight');
                        setTimeout(() => {
                            terminalElement.classList.remove('completion-highlight');
                        }, 2000);
                    }
                }
            }
        });
        
        ipcRenderer.on('play-completion-sound', (event, data) => {
            // Play completion sound
            try {
                const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGBzvLZiTYIG2m98OScTgwOUarm7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWT');
                audio.volume = 0.3;
                audio.play().catch(e => {});
            } catch (e) {
                // Ignore audio errors
            }
        });
        
        // Listen for task created response
        ipcRenderer.on('task-created', (event, result) => {
            if (result.success) {
                // Only refresh task indicators, no internal notification
                this.updateCurrentTaskIndicators();
            } else {
                // Keep error notification as it's important
                this.showNotification(`Failed to create task: ${result.error}`, 'error');
            }
        });
        
        // Listen for refresh tasks
        ipcRenderer.on('refresh-tasks', () => {
            this.updateCurrentTaskIndicators();
        });
        
        // Listen for badge notifications
        ipcRenderer.on('display-badge', (event, message) => {
            this.showBadgeNotification(message);
        });
        
        // Listen for scroll to bottom events
        ipcRenderer.on('scroll-terminal-to-bottom', (event, quadrant) => {

            this.scrollTerminalToBottom(quadrant);
        });
        
        // Listen for focus terminal tab events (when notification is clicked in tabbed mode)
        ipcRenderer.on('focus-terminal-tab', (event, quadrant) => {

            if (this.layoutMode === 'tabbed' && this.terminals.has(quadrant)) {
                // Switch to the tab when notification is clicked
                this.switchToTab(quadrant);
                // Also scroll to bottom for good measure
                this.scrollTerminalToBottom(quadrant);
            } else if (this.layoutMode === 'grid') {
                // In grid mode, just scroll to bottom and highlight the terminal
                this.scrollTerminalToBottom(quadrant);
                this.highlightTerminal(quadrant);
            }
        });
    }

    setupEventListeners() {
        // Setup terminal-closed listeners for all possible terminals
        for (let i = 0; i < 6; i++) {
            ipcRenderer.on(`terminal-closed-${i}`, async () => {

                // Clean up and remove the terminal from UI
                if (this.terminals.has(i)) {
                    const terminal = this.terminals.get(i);
                    if (terminal && terminal.terminal) {
                        try {
                            terminal.terminal.dispose();
                        } catch (e) {
                            console.error(`Error disposing terminal ${i}:`, e);
                        }
                    }
                    this.terminals.delete(i);
                }
                
                // In tabbed mode, if we closed the active tab, switch to another available one
                if (this.layoutMode === 'tabbed' && this.activeTabTerminal === i) {
                    const activeResult = await ipcRenderer.invoke('get-active-terminals');
                    if (activeResult.success && activeResult.terminals.length > 0) {
                        // Switch to the first available terminal
                        this.activeTabTerminal = activeResult.terminals[0];

                    } else {
                        this.activeTabTerminal = null;

                    }
                }
                
                // Update the UI - just render and update buttons since terminal is already removed
                await this.renderTerminals();
                await this.updateTerminalManagementButtons();
                this.updateGitButtonVisibility();

            });
        }
        
        // Listen for directory changes from terminals
        ipcRenderer.on('terminal-directory-changed', (event, quadrant, newDirectory) => {
            // Update the lastSelectedDirectories
            this.lastSelectedDirectories[quadrant] = newDirectory;
            
            // Save to database
            this.saveDirectoryToStorage(quadrant, newDirectory).catch(err => {
                console.warn('Failed to save directory to database:', err);
            });
            
            // Update the terminal tab to reflect the new project
            if (this.layoutMode === 'tabbed') {
                this.updateTerminalTab(quadrant);
            }
            
            // Update terminal header color
            this.updateTerminalHeaderColor(quadrant);
        });

        document.getElementById('add-terminal-btn').addEventListener('click', () => {
            this.addTerminal();
        });

        // Tabbed mode button
        document.getElementById('tabbed-mode-btn').addEventListener('click', () => {
            this.toggleLayoutMode();
        });

        // New tab button in tabbed mode
        document.getElementById('new-tab-btn').addEventListener('click', () => {
            this.addTerminal();
        });

        // Layout selector event listeners for 2 terminals
        document.getElementById('layout-horizontal-btn').addEventListener('click', () => {
            this.setLayout('horizontal');
        });

        document.getElementById('layout-vertical-btn').addEventListener('click', () => {
            this.setLayout('vertical');
        });

        // Layout selector event listeners for 3 terminals
        document.getElementById('layout-3-top1-btn').addEventListener('click', () => {
            this.setLayout('3-top1');
        });

        document.getElementById('layout-3-top2-horiz-btn').addEventListener('click', () => {
            this.setLayout('3-top2-horiz');
        });

        document.getElementById('layout-3-left2-btn').addEventListener('click', () => {
            this.setLayout('3-left2');
        });

        document.getElementById('layout-3-right2-btn').addEventListener('click', () => {
            this.setLayout('3-right2');
        });

        document.getElementById('git-status-btn').addEventListener('click', () => {
            this.showGitStatus();
        });

        document.getElementById('kanban-btn').addEventListener('click', () => {
            this.showKanban();
        });

        document.getElementById('create-task-btn').addEventListener('click', () => {
            this.showCreateTaskDialog();
        });
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.showSettingsModal();
        });
        
        // Add permissions button handler to open settings in permissions tab
        const permissionsBtn = document.getElementById('permissions-btn');
        if (permissionsBtn) {
            permissionsBtn.addEventListener('click', () => {
                this.showSettingsModal('permissions');
            });
        }

        // Placeholder clicks are now handled by event delegation in attachTerminalEventListeners()

        document.querySelectorAll('.terminal-control-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = e.target.dataset.action || e.target.closest('[data-action]')?.dataset.action;
                // Get quadrant from data-terminal attribute first, then fallback to parent quadrant
                let quadrant;
                const btn = e.target.closest('.terminal-control-btn');
                if (btn && btn.dataset.terminal) {
                    quadrant = parseInt(btn.dataset.terminal);
                } else {
                    const quadrantEl = e.target.closest('.terminal-quadrant');
                    if (quadrantEl) {
                        quadrant = parseInt(quadrantEl.dataset.quadrant);
                    }
                }
                
                if (!quadrant && quadrant !== 0) {
                    console.error('Could not determine quadrant for action:', action);
                    return;
                }
                
                if (action === 'fullscreen') {
                    this.toggleFullscreen(quadrant);
                } else if (action === 'close') {
                    this.closeTerminal(quadrant);  // async pero no necesita await aquí
                } else if (action === 'more-options') {
                    this.toggleDropdownMenu(quadrant);
                }
            });
        });

        // Handle dropdown menu item clicks using event delegation
        document.addEventListener('click', (e) => {
            const dropdownItem = e.target.closest('.terminal-dropdown-item');
            if (dropdownItem) {
                e.stopPropagation();
                const action = dropdownItem.dataset.action;
                const quadrant = parseInt(dropdownItem.dataset.terminal);
                
                if (action === 'open-terminal-here') {
                    this.handleOpenTerminalInPath(quadrant);
                    // Close the dropdown
                    const dropdown = document.querySelector(`.terminal-dropdown-menu[data-terminal="${quadrant}"]`);
                    if (dropdown) dropdown.style.display = 'none';
                } else if (action === 'open-folder') {
                    this.handleOpenFolder(quadrant);
                    // Close the dropdown
                    const dropdown = document.querySelector(`.terminal-dropdown-menu[data-terminal="${quadrant}"]`);
                    if (dropdown) dropdown.style.display = 'none';
                } else if (action === 'open-in-ide') {
                    const ideKey = dropdownItem.dataset.ide;
                    this.openInIDE(quadrant, ideKey);
                    // Close the dropdown
                    const dropdown = document.querySelector(`.terminal-dropdown-menu[data-terminal="${quadrant}"]`);
                    if (dropdown) dropdown.style.display = 'none';
                }
            }
        });

        document.addEventListener('keydown', (e) => {
            // Prevent Cmd+R (Mac) or Ctrl+R (Windows/Linux) from refreshing the app
            if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
                e.preventDefault();
                return false;
            }
            
            // Handle Cmd+1-6 for switching terminals
            if (e.metaKey && e.key >= '1' && e.key <= '6') {
                const terminalId = parseInt(e.key) - 1; // Convert to 0-based index
                
                // In tabbed mode, switch tabs
                if (this.layoutMode === 'tabbed') {
                    if (this.terminals.has(terminalId)) {
                        this.switchToTab(terminalId);
                        e.preventDefault();
                    }
                    return;
                }
                
                // In grid mode, focus terminal
                if (this.terminals.has(terminalId)) {
                    this.setActiveTerminal(terminalId);
                    e.preventDefault();
                }
                return false;
            }
            
            // Handle Ctrl+Tab / Ctrl+Shift+Tab for cycling through tabs in tabbed mode
            if (this.layoutMode === 'tabbed' && e.ctrlKey && e.key === 'Tab') {
                e.preventDefault();
                const activeTerminals = Array.from(this.terminals.keys()).sort((a, b) => a - b);
                const currentIndex = activeTerminals.indexOf(this.activeTabTerminal);
                
                if (currentIndex !== -1 && activeTerminals.length > 1) {
                    let nextIndex;
                    if (e.shiftKey) {
                        // Previous tab
                        nextIndex = currentIndex === 0 ? activeTerminals.length - 1 : currentIndex - 1;
                    } else {
                        // Next tab
                        nextIndex = (currentIndex + 1) % activeTerminals.length;
                    }
                    this.switchToTab(activeTerminals[nextIndex]);
                }
                return false;
            }
            
            // Handle Cmd+K for opening Kanban board
            if (e.metaKey && e.key === 'k') {
                this.showKanban();
                e.preventDefault();
                return false;
            }
            
            // Handle Cmd+G for generating AI commit
            if (e.metaKey && e.key === 'g') {
                this.showGitStatus();
                e.preventDefault();
                return false;
            }
            
            // Handle Cmd+T for creating new task
            if (e.metaKey && e.key === 't') {
                this.showCreateTaskDialog();
                e.preventDefault();
                return false;
            }
            
            // Handle Escape if a terminal is in fullscreen mode
            // This works regardless of which element has focus (terminal, buttons, etc.)
            if (e.key === 'Escape' && this.fullscreenTerminal !== null) {
                this.exitFullscreen();
                e.preventDefault(); // Prevent any other Escape handlers
            }
        });

        window.addEventListener('resize', () => {
            this.resizeAllTerminals();
        });
    }

    setupGlobalTerminalFocusDetection() {
        // Global mousedown listener to detect clicks anywhere in terminals
        // This captures clicks even in terminal content, spans, and xterm elements
        document.addEventListener('mousedown', (e) => {
            const terminalQuadrant = this.findTerminalQuadrantFromClick(e.target);
            
            if (terminalQuadrant) {
                const quadrantId = parseInt(terminalQuadrant.dataset.quadrant);
                
                // Skip if clicking on controls, placeholders, or certain interactive elements
                if (e.target.closest('.terminal-control-btn') || 
                    e.target.closest('.terminal-reorder-btn') ||
                    e.target.closest('.terminal-placeholder') ||
                    e.target.closest('.git-branch-display') ||
                    e.target.closest('.current-task') ||
                    e.target.closest('.color-picker-modal')) {
                    return;
                }
                
                // Only set focus if this terminal has an active terminal instance
                const terminal = this.terminals.get(quadrantId);
                if (terminal && terminal.terminal) {
                    // Clear badge when clicking on any terminal
                    this.clearNotificationBadge();
                    
                    // Only update if this isn't already the active terminal to avoid unnecessary updates
                    if (this.activeTerminal !== quadrantId) {

                        this.setActiveTerminal(quadrantId);
                    }
                }
            }
        }, true); // Use capture phase to ensure we get the event before it's consumed
    }

    // Helper function to find which terminal quadrant a click belongs to
    findTerminalQuadrantFromClick(element) {
        // First try direct lookup
        let quadrant = element.closest('.terminal-quadrant');
        if (quadrant) return quadrant;
        
        // Check if element is inside a terminal div
        const terminalDiv = element.closest('.terminal');
        if (terminalDiv) {
            quadrant = terminalDiv.closest('.terminal-quadrant');
            if (quadrant) return quadrant;
        }
        
        // Check if element has xterm classes or is inside xterm elements
        if (element.classList && (
            element.classList.contains('xterm') ||
            element.classList.contains('xterm-screen') ||
            element.classList.contains('xterm-viewport') ||
            element.classList.contains('xterm-rows') ||
            Array.from(element.classList).some(cls => cls.startsWith('xterm-'))
        )) {
            quadrant = element.closest('.terminal-quadrant');
            if (quadrant) return quadrant;
        }
        
        // Walk up the DOM tree looking for xterm elements or terminal quadrants
        let current = element.parentElement;
        while (current && current !== document.body) {
            if (current.classList && current.classList.contains('terminal-quadrant')) {
                return current;
            }
            
            if (current.classList && (
                current.classList.contains('xterm') ||
                Array.from(current.classList).some(cls => cls.startsWith('xterm-'))
            )) {
                quadrant = current.closest('.terminal-quadrant');
                if (quadrant) return quadrant;
            }
            
            current = current.parentElement;
        }
        
        return null;
    }

    setupResizeHandlers() {
        // Setup dynamic resize handlers
        this.setupDynamicResizeHandlers();
    }

    setupDynamicResizeHandlers() {
        const container = document.getElementById('terminals-container');
        let isResizing = false;
        let currentResizer = null;
        let resizeDirection = null;
        
        document.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('vertical-resizer')) {
                isResizing = true;
                currentResizer = e.target;
                resizeDirection = 'vertical';
                document.body.style.cursor = 'col-resize';
                e.preventDefault();
            } else if (e.target.classList.contains('horizontal-resizer')) {
                isResizing = true;
                currentResizer = e.target;
                resizeDirection = 'horizontal';
                document.body.style.cursor = 'row-resize';
                e.preventDefault();
            }
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing || !currentResizer) return;
            
            const containerRect = container.getBoundingClientRect();
            
            if (resizeDirection === 'vertical') {
                const isRow1 = currentResizer.classList.contains('row-1');
                const isRow2 = currentResizer.classList.contains('row-2');
                const isBottomRow = currentResizer.classList.contains('bottom-row');
                
                if (isRow1 || isRow2) {
                    // Handle independent row resizing for 4-terminal layout
                    const leftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
                    const rightWidth = 100 - leftWidth;
                    
                    if (leftWidth > 25 && rightWidth > 25) {
                        if (isRow1) {
                            // Update row 1 column widths
                            container.style.setProperty('--row1-left-width', `${leftWidth}%`);
                            container.style.setProperty('--row1-right-width', `${rightWidth}%`);
                            currentResizer.style.left = `${leftWidth}%`;
                        } else if (isRow2) {
                            // Update row 2 column widths
                            container.style.setProperty('--row2-left-width', `${leftWidth}%`);
                            container.style.setProperty('--row2-right-width', `${rightWidth}%`);
                            currentResizer.style.left = `${leftWidth}%`;
                        }
                    }
                } else if (isBottomRow) {
                    // Handle bottom row resizing for 3-terminal layout (only affects bottom row)
                    const leftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
                    const rightWidth = 100 - leftWidth;
                    
                    if (leftWidth > 25 && rightWidth > 25) {
                        container.style.setProperty('--left-width', `${leftWidth}%`);
                        container.style.setProperty('--right-width', `${rightWidth}%`);
                        currentResizer.style.left = `${leftWidth}%`;
                    }
                } else {
                    // Handle regular vertical resizing (for 2 terminal layout)
                    const leftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
                    const rightWidth = 100 - leftWidth;
                    
                    if (leftWidth > 25 && rightWidth > 25) {
                        container.style.setProperty('--left-width', `${leftWidth}%`);
                        container.style.setProperty('--right-width', `${rightWidth}%`);
                        currentResizer.style.left = `${leftWidth}%`;
                    }
                }
            } else if (resizeDirection === 'horizontal') {
                // Handle horizontal resizing between rows
                const topHeight = ((e.clientY - containerRect.top) / containerRect.height) * 100;
                const bottomHeight = 100 - topHeight;
                
                if (topHeight > 25 && bottomHeight > 25) {
                    container.style.setProperty('--top-height', `${topHeight}%`);
                    container.style.setProperty('--bottom-height', `${bottomHeight}%`);
                    currentResizer.style.top = `${topHeight}%`;
                }
            }
            
            // Resize all active terminals
            setTimeout(() => {
                this.resizeAllTerminals();
            }, 50);
        });
        
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                currentResizer = null;
                resizeDirection = null;
                document.body.style.cursor = 'default';
                
                // Hide resizer lines when not resizing
                const allResizers = container.querySelectorAll('.resizer');
                allResizers.forEach(resizer => {
                    resizer.classList.remove('dragging');
                });
            }
        });
        
        // Show resizer line when dragging starts
        document.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('resizer')) {
                e.target.classList.add('dragging');
            }
        });
    }

    async findUninitializedTerminal() {
        // Find a terminal that exists but hasn't been initialized (is showing placeholder)
        try {
            const activeResult = await ipcRenderer.invoke('get-active-terminals');
            if (!activeResult.success) return null;

            for (const terminalId of activeResult.terminals) {
                // Check if terminal has a placeholder element (not initialized)
                const placeholder = document.querySelector(`[data-quadrant="${terminalId}"] .terminal-placeholder`);
                
                if (placeholder) {

                    return terminalId;
                }
                
                // Alternative check: no directory selected and no active shell
                if (!this.lastSelectedDirectories[terminalId]) {
                    const hasShell = await ipcRenderer.invoke('terminal-has-shell', terminalId);
                    if (!hasShell) {

                        return terminalId;
                    }
                }
            }

            return null;
        } catch (error) {
            console.error('Error finding uninitialized terminal:', error);
            return null;
        }
    }

    async findProjectDirectories(projectName) {
        // Try to find directories that match this project
        try {
            // Check all saved directories in localStorage
            const directories = [];
            for (let i = 0; i < 6; i++) {
                const dir = this.lastSelectedDirectories[i];
                if (dir) {
                    // Check if this directory has a CLAUDE.md with matching project
                    const result = await ipcRenderer.invoke('check-project-match', dir, projectName);
                    if (result && result.matches) {
                        directories.push(dir);
                    }
                }
            }
            
            // Also check recent projects from database
            const recentProjects = await ipcRenderer.invoke('get-recent-project-directories', projectName);
            if (recentProjects && recentProjects.directories) {
                directories.push(...recentProjects.directories);
            }
            
            // Remove duplicates
            return [...new Set(directories)];
        } catch (error) {
            console.error('Error finding project directories:', error);
            return [];
        }
    }

    async showDirectorySelector(quadrant) {

        // Check if there's a pending task for this terminal
        if (window.pendingTerminalTasks && window.pendingTerminalTasks[quadrant]) {
            const taskData = window.pendingTerminalTasks[quadrant];

            // Try to find a directory for the project
            // First check if we have existing directories for this project
            const projectDirs = await this.findProjectDirectories(taskData.project);
            
            if (projectDirs && projectDirs.length > 0) {
                // Use the first matching directory
                const selectedDir = projectDirs[0];

                // Start terminal directly with this directory
                this.lastSelectedDirectories[quadrant] = selectedDir;
                this.saveDirectoryToStorage(quadrant, selectedDir);
                await ipcRenderer.invoke('project-update-last-opened', selectedDir);
                
                // Start terminal with appropriate mode for tasks
                // Use 'dangerous' mode if specified in taskData, otherwise 'new'
                const mode = taskData.mode === 'danger' ? 'dangerous' : 'new';
                this.startTerminal(quadrant, selectedDir, mode);
                return;
            } else {
                // No existing directory, show selector but with project context

            }
        }
        
        // Debug: log all terminal-quadrant elements (not placeholders)
        const allQuadrants = document.querySelectorAll('.terminal-quadrant');

        allQuadrants.forEach(el => {

        });
        
        // Find wrapper with more robust search
        let wrapper;
        let quadrantElement;
        
        if (this.layoutMode === 'tabbed') {
            // In tabbed mode, look in the tabbed content container
            const tabbedContent = document.getElementById('tabbed-terminal-content');
            if (tabbedContent) {
                quadrantElement = tabbedContent.querySelector(`[data-quadrant="${quadrant}"]`);
            }
        } else {
            // In grid mode, look in the terminals-container (could be nested in rows/columns)
            const gridContainer = document.getElementById('terminals-container');
            if (gridContainer) {
                quadrantElement = gridContainer.querySelector(`[data-quadrant="${quadrant}"]`);

            }
        }
        
        // Fallback to document-wide search
        if (!quadrantElement) {
            quadrantElement = document.querySelector(`[data-quadrant="${quadrant}"]`);

        }
        
        if (quadrantElement) {
            wrapper = quadrantElement.querySelector('.terminal-wrapper');

        }
        
        if (!wrapper) {
            console.error(`Terminal wrapper not found for quadrant ${quadrant} in ${this.layoutMode} mode`);
            console.error(`QuadrantElement found: ${!!quadrantElement}`);
            if (quadrantElement) {
                console.error(`QuadrantElement HTML:`, quadrantElement.outerHTML.substring(0, 500));
            }
            return;
        }

        // Remove placeholder if it exists
        const placeholder = wrapper.querySelector('.terminal-placeholder');
        if (placeholder) {
            placeholder.remove();
        }
        
        // Get all projects first
        const projectsResult = await ipcRenderer.invoke('project-get-all');
        const projects = projectsResult.success ? projectsResult.projects : [];
        
        // Create directory selector modal
        const selectorDiv = document.createElement('div');
        selectorDiv.className = 'directory-selector';
        
        // Build recent projects HTML - Show first 20 projects (already sorted by most recent)
        let recentProjectsHTML = '';
        if (projects.length > 0) {
            // Take the first 20 projects (already sorted by most recent first)
            const recentProjects = projects.slice(0, 20);
            recentProjectsHTML = `
                <div class="recent-projects-section">
                    <h4>Recent Projects</h4>
                    <div class="recent-projects-list">
                        ${recentProjects.map(project => {
                            // Get first letter of project name for icon
                            const initial = (project.display_name || project.name).charAt(0).toUpperCase();
                            return `
                            <div class="recent-project-item" data-project-path="${project.path}" data-project-name="${project.name}" data-project-color="${project.color}">
                                <button class="delete-project-btn" data-project-name="${project.name}" title="Remove from recent projects">×</button>
                                <div class="project-info">
                                    <span class="project-color-indicator" style="--project-color: ${project.color}; background-color: ${project.color}" data-initial="${initial}"></span>
                                    <div class="project-details">
                                        <span class="project-name">${project.display_name || project.name}</span>
                                        <span class="project-meta"></span>
                                    </div>
                                </div>
                            </div>
                        `}).join('')}
                    </div>
                    <button id="create-new-project-btn" class="btn-primary">
                        <svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Create New Project
                    </button>
                </div>
            `;
        } else {
            // Empty state when no projects
            recentProjectsHTML = `
                <div class="recent-projects-section">
                    <h4>Recent Projects</h4>
                    <div class="recent-projects-list" style="display: flex; align-items: center; justify-content: center; min-height: 200px;">
                        <div style="text-align: center; color: rgba(255, 255, 255, 0.4);">
                            <div style="font-size: 14px; margin-bottom: 8px;">No recent projects</div>
                            <div style="font-size: 12px;">Select a directory to get started</div>
                        </div>
                    </div>
                    <button id="create-new-project-btn" class="btn-primary">
                        <svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Create New Project
                    </button>
                </div>
            `;
        }
        
        selectorDiv.innerHTML = `
            <div class="directory-selector-content">
                <h3>Select Working Directory</h3>
                <div class="directory-selector-subtitle">Choose a project to continue</div>
                
                <!-- Session info (hidden initially) -->
                <div class="session-info" id="session-info">
                    <div class="session-directory">
                        <div class="session-directory-icon" id="session-icon">C</div>
                        <span id="session-name">Project Name</span>
                    </div>
                    <div class="session-path" id="session-path">/path/to/project</div>
                </div>
                
                <!-- Session buttons (hidden initially) -->
                <div class="session-selector-buttons" id="session-buttons">
                    <button class="btn btn-primary" id="resume-session-btn">
                        <svg class="btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                        </svg>
                        <span class="btn-text">Resume Session</span>
                    </button>
                    <button class="btn btn-secondary" id="new-session-btn">
                        <svg class="btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M12 6v12M6 12h12"></path>
                        </svg>
                        <span class="btn-text">New Session</span>
                    </button>
                </div>
                
                <!-- Danger Mode Option -->
                <div class="danger-mode-option" id="danger-option" style="display: none;">
                    <label class="checkbox-label">
                        <input type="checkbox" id="danger-mode-checkbox">
                        <span class="checkbox-custom"></span>
                        <span class="checkbox-text">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                            </svg>
                            Enable Danger Mode (skip confirmations)
                        </span>
                    </label>
                </div>
                
                <!-- Hold Warning Message -->
                <div class="hold-warning-message" id="hold-warning" style="display: none;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffcc00" stroke="#ffcc00" stroke-width="2">
                        <path d="M12 2L2 20h20L12 2z"></path>
                        <line x1="12" y1="9" x2="12" y2="13" stroke="#1a1a1a" stroke-width="2"></line>
                        <circle cx="12" cy="17" r="1" fill="#1a1a1a"></circle>
                    </svg>
                    <span class="warning-text">You must hold the button for 3 seconds with danger mode enabled</span>
                </div>
                
                <!-- Back button (hidden initially) -->
                <div class="session-back-button" id="back-button">
                    <button class="btn btn-small" id="back-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M19 12H5M12 19l-7-7 7-7"/>
                        </svg>
                        Back
                    </button>
                </div>
                
                <div class="directory-selector-main">
                    ${recentProjectsHTML}
                    <div class="directory-selector-actions">
                        <button class="btn btn-text" id="choose-dir-btn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                            Browse for folder
                        </button>
                        <button class="btn btn-text" id="cancel-btn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        wrapper.appendChild(selectorDiv);
        
        // Pre-apply responsive classes based on terminal count for instant styling
        const terminalCount = document.querySelectorAll('.terminal-wrapper').length;
        if (terminalCount === 4) {
            selectorDiv.classList.add('small-quadrant');
        }
        
        // Force the projects list to expand to full height (fix CSS specificity issue)
        // User confirmed this works: element.style { max-height: 100%; }
        // Skip for small quadrants and vertically constrained views (handled by CSS)
        requestAnimationFrame(() => {
            const projectsList = selectorDiv.querySelector('.recent-projects-list');
            if (projectsList) {
                // Check if we're in a constrained view
                const isSmallQuadrant = selectorDiv.classList.contains('small-quadrant');
                const isVerticallyConstrained = selectorDiv.classList.contains('vertically-constrained');
                const isHorizontalLayout = selectorDiv.classList.contains('horizontal-layout');
                
                // Only apply inline styles for normal sized views
                // Small/constrained/horizontal quadrants are handled purely by CSS
                if (!isSmallQuadrant && !isVerticallyConstrained && !isHorizontalLayout) {
                    projectsList.style.maxHeight = '100%';
                    projectsList.style.flex = '1 1 auto';
                    projectsList.style.minHeight = '0';
                    projectsList.style.overflow = 'auto';
                    
                    // Also ensure the container expands properly
                    const projectsContainer = selectorDiv.querySelector('.recent-projects-container');
                    if (projectsContainer) {
                        projectsContainer.style.flex = '1 1 auto';
                        projectsContainer.style.minHeight = '0';
                        projectsContainer.style.display = 'flex';
                        projectsContainer.style.flexDirection = 'column';
                    }
                    
                    // Ensure the content area expands
                    const contentArea = selectorDiv.querySelector('.directory-selector-content');
                    if (contentArea) {
                        contentArea.style.display = 'flex';
                        contentArea.style.flexDirection = 'column';
                        contentArea.style.height = '100%';
                    }
                }
            }
            
            // Apply responsive layout immediately based on initial detection
            const applyResponsiveLayout = () => {
                const quadrantWidth = wrapper.offsetWidth;
                const quadrantHeight = wrapper.offsetHeight;
                
                // Check if we have 4 terminals active
                const terminalCount = document.querySelectorAll('.terminal-wrapper').length;
                const hasFourQuadrants = terminalCount === 4 || document.querySelector('.terminals-container.count-4');
                
                // Detect different size constraints
                const isSmallWidth = quadrantWidth < 500;
                const isMediumWidth = quadrantWidth < 800;
                const isShortHeight = quadrantHeight < 400;  // Very short vertically
                const isVerticallyConstrained = quadrantHeight < 500;
                
                // Detect horizontal/panoramic layout (width much greater than height)
                const aspectRatio = quadrantWidth / quadrantHeight;
                const isHorizontalLayout = aspectRatio > 2.5 || (quadrantHeight < 350 && quadrantWidth > 800);
                
                // Apply horizontal layout if:
                // 1. We have 4 quadrants AND the individual quadrant is small
                // 2. OR the quadrant is extremely small (less than 500px width)
                // 3. OR the quadrant is very short (less than 400px height)
                const shouldUseSmallLayout = (hasFourQuadrants && isMediumWidth) || isSmallWidth || isShortHeight;

                // Remove all responsive classes first
                selectorDiv.classList.remove('small-quadrant', 'vertically-constrained', 'horizontal-layout');
                
                // Apply appropriate layout class
                if (isHorizontalLayout) {
                    selectorDiv.classList.add('horizontal-layout');
                } else if (shouldUseSmallLayout) {
                    selectorDiv.classList.add('small-quadrant');
                    
                    // Apply compact layout for small quadrants
                    const mainSection = selectorDiv.querySelector('.directory-selector-main');
                    if (mainSection) {
                        // Remove inline styles that break the layout
                        mainSection.style.flexDirection = '';
                        mainSection.style.gap = '';
                        mainSection.style.alignItems = '';
                    }
                } else {
                    // Reset to normal layout
                    const mainSection = selectorDiv.querySelector('.directory-selector-main');
                    if (mainSection) {
                        mainSection.style.flexDirection = '';
                        mainSection.style.gap = '';
                        mainSection.style.alignItems = '';
                    }
                }
                
                // Add class for vertically constrained layouts (even if not using horizontal)
                if (isVerticallyConstrained) {
                    selectorDiv.classList.add('vertically-constrained');
                    // Let CSS handle the styling instead of inline styles
                }
            };
            
            // Apply layout immediately to avoid visual flash
            applyResponsiveLayout();
            
            // Also check again after a small delay in case DOM measurements change
            requestAnimationFrame(() => {
                applyResponsiveLayout();
            });
        });
        
        // Function to restore placeholder if cancelled
        let restorePlaceholder = () => {
            if (wrapper.contains(selectorDiv)) {
                wrapper.removeChild(selectorDiv);
            }
            if (!wrapper.querySelector('.terminal-placeholder') && !wrapper.querySelector('.terminal')) {
                wrapper.innerHTML = `
                    <div class="terminal-placeholder" data-quadrant="${quadrant}">
                        <div class="terminal-placeholder-content">
                            <div class="terminal-placeholder-icon">
                                <img src="../assets/claude_terminal.png" alt="Claude">
                            </div>
                            <div class="terminal-placeholder-text">Start Claude Code</div>
                            <div class="terminal-placeholder-subtext">Click to launch terminal</div>
                        </div>
                    </div>
                `;
                // Event delegation handles the click, no need to add listener here
            }
        };

        // Function to handle directory selection
        const selectDirectory = async () => {
            const selectedDir = await ipcRenderer.invoke('select-directory');
            if (selectedDir) {
                this.lastSelectedDirectories[quadrant] = selectedDir;
                this.saveDirectoryToStorage(quadrant, selectedDir); // Save to database
                
                // Update last opened if this directory corresponds to a project
                await ipcRenderer.invoke('project-update-last-opened', selectedDir);
                
                // Update the UI to show the selected directory info
                const sessionInfo = selectorDiv.querySelector('#session-info');
                const sessionButtons = selectorDiv.querySelector('#session-buttons');
                const backButton = selectorDiv.querySelector('#back-button');
                const mainContent = selectorDiv.querySelector('.directory-selector-main');
                const subtitle = selectorDiv.querySelector('.directory-selector-subtitle');
                
                if (sessionInfo && sessionButtons) {
                    // Extract directory name from path
                    const dirName = selectedDir.split('/').pop() || selectedDir;
                    const firstLetter = dirName.charAt(0).toUpperCase();
                    
                    // Update session info
                    const sessionIcon = selectorDiv.querySelector('#session-icon');
                    const sessionName = selectorDiv.querySelector('#session-name');
                    const sessionPath = selectorDiv.querySelector('#session-path');
                    
                    if (sessionIcon) {
                        sessionIcon.textContent = firstLetter;
                        // Generate a color for the icon
                        const projectColors = [
                            '#007ACC', '#FF6B6B', '#4ECDC4', '#FFA07A', 
                            '#98D8C8', '#FDCB6E', '#6C5CE7', '#A29BFE',
                            '#00B894', '#E17055', '#74B9FF', '#EC407A'
                        ];
                        // Simple hash to get consistent color for same directory
                        let hash = 0;
                        for (let i = 0; i < dirName.length; i++) {
                            hash = dirName.charCodeAt(i) + ((hash << 5) - hash);
                        }
                        const color = projectColors[Math.abs(hash) % projectColors.length];
                        sessionIcon.style.backgroundColor = color;
                    }
                    if (sessionName) sessionName.textContent = dirName;
                    if (sessionPath) sessionPath.textContent = selectedDir;
                    
                    // Show session info and buttons
                    sessionInfo.classList.add('active');
                    sessionButtons.classList.add('active');
                    if (backButton) backButton.classList.add('active');
                    
                    // Show danger mode option
                    const dangerOption = selectorDiv.querySelector('#danger-option');
                    if (dangerOption) {
                        dangerOption.style.display = 'block';
                    }
                    
                    // Collapse the main content
                    if (mainContent) mainContent.classList.add('collapsed');
                    
                    // Update subtitle
                    if (subtitle) subtitle.textContent = 'Ready to continue working';
                }
            } else {
                // User cancelled, do nothing
            }
        };

        // Handle browse button
        selectorDiv.querySelector('#choose-dir-btn').addEventListener('click', selectDirectory);
        
        // Handle clickable directory display (if exists in new design)
        const directoryDisplay = selectorDiv.querySelector('#directory-display');
        if (directoryDisplay) {
            directoryDisplay.addEventListener('click', selectDirectory);
        }
        
        // Handle last directory click (if exists)
        const lastDirectoryDisplay = selectorDiv.querySelector('#last-directory-display');
        if (lastDirectoryDisplay) {
            lastDirectoryDisplay.addEventListener('click', async () => {
                // Update last opened if this directory corresponds to a project
                await ipcRenderer.invoke('project-update-last-opened', this.lastSelectedDirectories[quadrant]);
                
                wrapper.removeChild(selectorDiv);
                this.showSessionSelector(quadrant, this.lastSelectedDirectories[quadrant]);
            });
        }
        
        // Handle use last button if it exists
        const useLastBtn = selectorDiv.querySelector('#use-last-btn');
        if (useLastBtn) {
            useLastBtn.addEventListener('click', async () => {
                // Update last opened if this directory corresponds to a project
                await ipcRenderer.invoke('project-update-last-opened', this.lastSelectedDirectories[quadrant]);
                
                wrapper.removeChild(selectorDiv);
                this.showSessionSelector(quadrant, this.lastSelectedDirectories[quadrant]);
            });
        }
        
        // Handle cancel button
        selectorDiv.querySelector('#cancel-btn').addEventListener('click', () => {
            restorePlaceholder();
        });
        
        // Handle recent project clicks with transition
        selectorDiv.querySelectorAll('.recent-project-item').forEach(projectItem => {
            projectItem.addEventListener('click', async (e) => {
                // Don't trigger if clicking on delete button
                if (e.target.classList.contains('delete-project-btn')) {
                    return;
                }
                
                const projectPath = projectItem.dataset.projectPath;
                const projectName = projectItem.dataset.projectName;
                const projectColor = projectItem.dataset.projectColor;
                
                // Mark as selected
                projectItem.classList.add('selected');
                
                // Get first letter for icon
                const initial = projectName.charAt(0).toUpperCase();
                
                // Update session info
                const sessionInfo = selectorDiv.querySelector('#session-info');
                const sessionIcon = selectorDiv.querySelector('#session-icon');
                const sessionName = selectorDiv.querySelector('#session-name');
                const sessionPath = selectorDiv.querySelector('#session-path');
                const sessionButtons = selectorDiv.querySelector('#session-buttons');
                const backButton = selectorDiv.querySelector('#back-button');
                const mainSection = selectorDiv.querySelector('.directory-selector-main');
                
                sessionIcon.textContent = initial;
                sessionIcon.style.backgroundColor = projectColor;
                sessionName.textContent = projectName;
                sessionPath.textContent = projectPath;
                
                // Show session info with animation
                sessionInfo.classList.add('active');
                sessionButtons.classList.add('active');
                backButton.classList.add('active');
                mainSection.classList.add('collapsed');
                
                // Show danger mode option
                const dangerOption = selectorDiv.querySelector('#danger-option');
                dangerOption.style.display = 'block';
                
                // Update title
                selectorDiv.querySelector('h3').textContent = 'Claude Code Session';
                selectorDiv.querySelector('.directory-selector-subtitle').textContent = 'Ready to continue working';
                
                // Handle Resume button with hold functionality for danger mode
                const resumeBtn = selectorDiv.querySelector('#resume-session-btn');
                const dangerCheckbox = selectorDiv.querySelector('#danger-mode-checkbox');
                let resumeHoldTimer = null;
                let resumeHoldProgress = null;
                
                const executeResume = async () => {
                    // Update last opened timestamp
                    await ipcRenderer.invoke('project-update-last-opened', projectPath);
                    
                    // Update last selected directory
                    this.lastSelectedDirectories[quadrant] = projectPath;
                    this.saveDirectoryToStorage(quadrant, projectPath);
                    
                    // Check if danger mode is enabled
                    const isDangerMode = dangerCheckbox && dangerCheckbox.checked;
                    
                    // Remove selector and launch IDE directly
                    wrapper.removeChild(selectorDiv);
                    if (isDangerMode) {
                        // Launch with danger mode
                        this.startTerminal(quadrant, projectPath, 'dangerous-resume');
                    } else {
                        // Launch normally
                        this.startTerminal(quadrant, projectPath, 'resume');
                    }
                };
                
                const startResumeHold = () => {
                    // Check if danger mode is enabled
                    const isDangerMode = dangerCheckbox && dangerCheckbox.checked;
                    
                    if (!isDangerMode) {
                        // If danger mode is not enabled, execute immediately
                        executeResume();
                        return;
                    }
                    
                    // Create progress indicator
                    if (!resumeHoldProgress) {
                        resumeHoldProgress = document.createElement('div');
                        resumeHoldProgress.className = 'hold-progress';
                        resumeHoldProgress.innerHTML = `
                            <div class="hold-progress-bar"></div>
                            <div class="hold-progress-text">Hold for 3 seconds</div>
                        `;
                        resumeBtn.appendChild(resumeHoldProgress);
                    }
                    
                    // Start the progress animation
                    const progressBar = resumeHoldProgress.querySelector('.hold-progress-bar');
                    progressBar.style.width = '0%';
                    resumeHoldProgress.classList.add('active');
                    
                    // Animate progress over 3 seconds
                    let startTime = Date.now();
                    const animateProgress = () => {
                        const elapsed = Date.now() - startTime;
                        const progress = Math.min((elapsed / 3000) * 100, 100);
                        progressBar.style.width = progress + '%';
                        
                        if (progress < 100) {
                            requestAnimationFrame(animateProgress);
                        }
                    };
                    requestAnimationFrame(animateProgress);
                    
                    // Set timer for 3 seconds
                    resumeHoldTimer = setTimeout(() => {
                        executeResume();
                    }, 3000);
                };
                
                const cancelResumeHold = () => {
                    const wasHolding = resumeHoldTimer !== null;
                    const isDangerMode = dangerCheckbox && dangerCheckbox.checked;
                    
                    if (resumeHoldTimer) {
                        clearTimeout(resumeHoldTimer);
                        resumeHoldTimer = null;
                    }
                    if (resumeHoldProgress) {
                        resumeHoldProgress.classList.remove('active');
                        setTimeout(() => {
                            const progressBar = resumeHoldProgress.querySelector('.hold-progress-bar');
                            if (progressBar) progressBar.style.width = '0%';
                        }, 300);
                    }
                    
                    // Show warning if danger mode is on and user released early
                    if (wasHolding && isDangerMode) {
                        const warningElement = selectorDiv.querySelector('#hold-warning');
                        if (warningElement) {
                            warningElement.style.display = 'flex';
                            warningElement.classList.add('show');
                            
                            // Hide warning after 5 seconds
                            setTimeout(() => {
                                warningElement.classList.remove('show');
                                setTimeout(() => {
                                    warningElement.style.display = 'none';
                                }, 300);
                            }, 5000);
                        }
                    }
                };
                
                // Mouse events
                resumeBtn.addEventListener('mousedown', startResumeHold);
                resumeBtn.addEventListener('mouseup', cancelResumeHold);
                resumeBtn.addEventListener('mouseleave', cancelResumeHold);
                
                // Touch events for mobile
                resumeBtn.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    startResumeHold();
                });
                resumeBtn.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    cancelResumeHold();
                });
                resumeBtn.addEventListener('touchcancel', cancelResumeHold);
                
                // Prevent default click behavior
                resumeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                });
                
                // Handle New Session button with hold functionality for danger mode
                const newBtn = selectorDiv.querySelector('#new-session-btn');
                let newHoldTimer = null;
                let newHoldProgress = null;
                
                const executeNewSession = async () => {
                    // Create new session in the same directory
                    await ipcRenderer.invoke('project-update-last-opened', projectPath);
                    
                    this.lastSelectedDirectories[quadrant] = projectPath;
                    this.saveDirectoryToStorage(quadrant, projectPath);
                    
                    // Check if danger mode is enabled
                    const isDangerMode = dangerCheckbox && dangerCheckbox.checked;
                    
                    // Clear any existing session data before starting new
                    // TODO: Add session clearing logic here if needed
                    
                    // Remove selector and launch IDE directly
                    wrapper.removeChild(selectorDiv);
                    if (isDangerMode) {
                        // Launch new session with danger mode
                        this.startTerminal(quadrant, projectPath, 'dangerous');
                    } else {
                        // Launch new session normally
                        this.startTerminal(quadrant, projectPath, 'new');
                    }
                };
                
                const startNewHold = () => {
                    // Check if danger mode is enabled
                    const isDangerMode = dangerCheckbox && dangerCheckbox.checked;
                    
                    if (!isDangerMode) {
                        // If danger mode is not enabled, execute immediately
                        executeNewSession();
                        return;
                    }
                    
                    // Create progress indicator
                    if (!newHoldProgress) {
                        newHoldProgress = document.createElement('div');
                        newHoldProgress.className = 'hold-progress';
                        newHoldProgress.innerHTML = `
                            <div class="hold-progress-bar"></div>
                            <div class="hold-progress-text">Hold for 3 seconds</div>
                        `;
                        newBtn.appendChild(newHoldProgress);
                    }
                    
                    // Start the progress animation
                    const progressBar = newHoldProgress.querySelector('.hold-progress-bar');
                    progressBar.style.width = '0%';
                    newHoldProgress.classList.add('active');
                    
                    // Animate progress over 3 seconds
                    let startTime = Date.now();
                    const animateProgress = () => {
                        const elapsed = Date.now() - startTime;
                        const progress = Math.min((elapsed / 3000) * 100, 100);
                        progressBar.style.width = progress + '%';
                        
                        if (progress < 100) {
                            requestAnimationFrame(animateProgress);
                        }
                    };
                    requestAnimationFrame(animateProgress);
                    
                    // Set timer for 3 seconds
                    newHoldTimer = setTimeout(() => {
                        executeNewSession();
                    }, 3000);
                };
                
                const cancelNewHold = () => {
                    const wasHolding = newHoldTimer !== null;
                    const isDangerMode = dangerCheckbox && dangerCheckbox.checked;
                    
                    if (newHoldTimer) {
                        clearTimeout(newHoldTimer);
                        newHoldTimer = null;
                    }
                    if (newHoldProgress) {
                        newHoldProgress.classList.remove('active');
                        setTimeout(() => {
                            const progressBar = newHoldProgress.querySelector('.hold-progress-bar');
                            if (progressBar) progressBar.style.width = '0%';
                        }, 300);
                    }
                    
                    // Show warning if danger mode is on and user released early
                    if (wasHolding && isDangerMode) {
                        const warningElement = selectorDiv.querySelector('#hold-warning');
                        if (warningElement) {
                            warningElement.style.display = 'flex';
                            warningElement.classList.add('show');
                            
                            // Hide warning after 5 seconds
                            setTimeout(() => {
                                warningElement.classList.remove('show');
                                setTimeout(() => {
                                    warningElement.style.display = 'none';
                                }, 300);
                            }, 5000);
                        }
                    }
                };
                
                // Mouse events
                newBtn.addEventListener('mousedown', startNewHold);
                newBtn.addEventListener('mouseup', cancelNewHold);
                newBtn.addEventListener('mouseleave', cancelNewHold);
                
                // Touch events for mobile
                newBtn.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    startNewHold();
                });
                newBtn.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    cancelNewHold();
                });
                newBtn.addEventListener('touchcancel', cancelNewHold);
                
                // Prevent default click behavior
                newBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                });
                
                // Handle Back button
                const backBtn = selectorDiv.querySelector('#back-btn');
                backBtn.onclick = () => {
                    // Remove selected state
                    projectItem.classList.remove('selected');
                    
                    // Hide session info
                    sessionInfo.classList.remove('active');
                    sessionButtons.classList.remove('active');
                    backButton.classList.remove('active');
                    mainSection.classList.remove('collapsed');
                    
                    // Hide danger mode checkbox
                    const dangerOption = selectorDiv.querySelector('#danger-option');
                    if (dangerOption) {
                        dangerOption.style.display = 'none';
                    }
                    
                    // Hide hold warning if visible
                    const holdWarning = selectorDiv.querySelector('#hold-warning');
                    if (holdWarning) {
                        holdWarning.style.display = 'none';
                        holdWarning.classList.remove('show');
                    }
                    
                    // Reset title
                    selectorDiv.querySelector('h3').textContent = 'Select Working Directory';
                    selectorDiv.querySelector('.directory-selector-subtitle').textContent = 'Choose a project to continue';
                };
            });
        });
        
        // Handle delete project buttons
        selectorDiv.querySelectorAll('.delete-project-btn').forEach(deleteBtn => {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent triggering the project click
                const projectName = deleteBtn.dataset.projectName;
                
                // Confirm deletion
                const confirmed = await ipcRenderer.invoke('show-confirm-dialog', {
                    title: 'Remove Project',
                    message: `Remove "${projectName}" from recent projects?`,
                    buttons: ['Remove', 'Cancel']
                });
                
                if (confirmed === 0) { // 0 is the index of "Remove" button
                    // Delete the project
                    const result = await ipcRenderer.invoke('project-delete', projectName);
                    
                    if (result.success) {
                        // Refresh the directory selector
                        wrapper.removeChild(selectorDiv);
                        this.showDirectorySelector(quadrant);
                    } else {
                        console.error('Failed to delete project:', result.error);
                    }
                }
            });
        });
        
        // Handle Create New Project button
        const createProjectBtn = selectorDiv.querySelector('#create-new-project-btn');
        if (createProjectBtn) {
            createProjectBtn.addEventListener('click', async () => {
                // Show project creation modal
                this.showCreateProjectModal(quadrant, wrapper, selectorDiv);
            });
        }
        
        // Handle Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape' && wrapper.contains(selectorDiv)) {
                restorePlaceholder();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        // No longer need responsive text handling since we're using icons
        // Icons scale naturally with the button size
    }

    showSessionSelector(quadrant, selectedDirectory) {
        // In tabbed mode, we need to look in the tabbed content container
        let wrapper;
        if (this.layoutMode === 'tabbed') {
            wrapper = document.querySelector(`.tabbed-terminal-content [data-quadrant="${quadrant}"] .terminal-wrapper`);
        } else {
            wrapper = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-wrapper`);
        }
        
        if (!wrapper) {
            console.error(`Terminal wrapper not found for quadrant ${quadrant} in session selector`);
            return;
        }
        
        // Create session selector modal
        const selectorDiv = document.createElement('div');
        selectorDiv.className = 'directory-selector'; // Reuse same styles
        selectorDiv.innerHTML = `
            <div class="directory-selector-content">
                <h3>Claude Code Session</h3>
                <div class="session-info">
                    <div class="session-directory">
                        📁 ${selectedDirectory.split('/').pop() || selectedDirectory}
                    </div>
                    <div class="session-path">
                        ${selectedDirectory}
                    </div>
                </div>
                <div class="session-selector-buttons">
                    <button class="btn btn-primary" id="resume-session-btn">
                        <span class="btn-icon">🔄</span>
                        <span class="btn-text">Resume</span>
                    </button>
                    <button class="btn" id="new-session-btn">
                        <span class="btn-icon">✨</span>
                        <span class="btn-text">New</span>
                    </button>
                </div>
                <div class="session-danger-toggle">
                    <button class="btn btn-danger-toggle" id="danger-mode-toggle" title="Hold for 3 seconds to enable dangerous mode">
                        <span class="toggle-icon">⚡</span>
                        <span class="toggle-text">Enable Danger Mode</span>
                    </button>
                    <div class="danger-mode-indicator" id="danger-mode-indicator" style="display: none;">
                        <span class="danger-active-icon">⚠️</span>
                        <span class="danger-active-text">DANGER MODE ACTIVE</span>
                        <button class="btn btn-small btn-exit-danger" id="exit-danger-btn">Exit</button>
                    </div>
                </div>
                <div class="session-danger-warning" id="danger-warning" style="display: none;">
                    <span class="danger-icon">⚠️</span>
                    <span class="danger-text">Hold button for 3 seconds to enable dangerous mode - skips ALL confirmations!</span>
                </div>
                <div class="session-danger-progress" id="danger-progress" style="display: none;">
                    <div class="progress-bar"></div>
                    <span class="progress-text">Keep holding... <span class="progress-countdown">3</span>s</span>
                </div>
                <div class="session-back-button">
                    <button class="btn btn-small" id="back-btn">← Back</button>
                </div>
            </div>
        `;
        
        wrapper.appendChild(selectorDiv);
        
        // Function to restore directory selector
        const goBack = () => {
            wrapper.removeChild(selectorDiv);
            this.showDirectorySelector(quadrant);
        };

        // Track danger mode state
        let isDangerMode = false;

        const resumeBtn = selectorDiv.querySelector('#resume-session-btn');
        const newBtn = selectorDiv.querySelector('#new-session-btn');
        const dangerToggle = selectorDiv.querySelector('#danger-mode-toggle');
        const dangerIndicator = selectorDiv.querySelector('#danger-mode-indicator');
        const exitDangerBtn = selectorDiv.querySelector('#exit-danger-btn');

        // Function to update button states based on danger mode
        const updateButtonStates = () => {
            if (isDangerMode) {
                resumeBtn.classList.add('btn-danger-mode');
                newBtn.classList.add('btn-danger-mode');
                resumeBtn.querySelector('.btn-icon').textContent = '⚡';
                newBtn.querySelector('.btn-icon').textContent = '⚡';
                resumeBtn.querySelector('.btn-text').textContent = 'Resume (Danger)';
                newBtn.querySelector('.btn-text').textContent = 'New (Danger)';
                dangerToggle.style.display = 'none';
                dangerIndicator.style.display = 'flex';
            } else {
                resumeBtn.classList.remove('btn-danger-mode');
                newBtn.classList.remove('btn-danger-mode');
                resumeBtn.querySelector('.btn-icon').textContent = '🔄';
                newBtn.querySelector('.btn-icon').textContent = '✨';
                resumeBtn.querySelector('.btn-text').textContent = 'Resume';
                newBtn.querySelector('.btn-text').textContent = 'New';
                dangerToggle.style.display = 'block';
                dangerIndicator.style.display = 'none';
            }
        };

        // Handle resume session
        resumeBtn.addEventListener('click', () => {
            wrapper.removeChild(selectorDiv);
            if (isDangerMode) {
                this.startTerminal(quadrant, selectedDirectory, 'dangerous-resume');
            } else {
                this.startTerminal(quadrant, selectedDirectory, 'resume');
            }
        });

        // Handle new session
        newBtn.addEventListener('click', () => {
            wrapper.removeChild(selectorDiv);
            if (isDangerMode) {
                this.startTerminal(quadrant, selectedDirectory, 'dangerous');
            } else {
                this.startTerminal(quadrant, selectedDirectory, 'new');
            }
        });

        // Handle exit danger mode
        if (exitDangerBtn) {
            exitDangerBtn.addEventListener('click', () => {
                isDangerMode = false;
                updateButtonStates();
            });
        }

        // Handle danger mode toggle - requires holding for 3 seconds
        const skipBtn = dangerToggle;
        const warningDiv = selectorDiv.querySelector('#danger-warning');
        const progressDiv = selectorDiv.querySelector('#danger-progress');
        const progressBar = progressDiv?.querySelector('.progress-bar');
        const progressCountdown = progressDiv?.querySelector('.progress-countdown');
        
        let holdTimer = null;
        let holdStartTime = null;
        let progressInterval = null;
        let clickHintTimer = null;
        const HOLD_DURATION = 3000; // 3 seconds
        const CLICK_THRESHOLD = 300; // milliseconds to detect a simple click
        
        const showClickHint = () => {
            // Clear any existing hint timer
            if (clickHintTimer) {
                clearTimeout(clickHintTimer);
            }
            
            // Hide the progress bar immediately
            progressDiv.style.display = 'none';
            
            // Update the warning message for click hint - emphasize the HOLD action
            warningDiv.innerHTML = `
                <span class="danger-icon">⏱️</span>
                <span class="danger-text"><strong>HOLD BUTTON!</strong> You must hold the button for 3 seconds to activate danger mode</span>
            `;
            warningDiv.style.display = 'block';
            warningDiv.classList.add('click-hint');
            
            // Keep the message visible for 4 seconds (more time to read)
            clickHintTimer = setTimeout(() => {
                warningDiv.style.display = 'none';
                warningDiv.classList.remove('click-hint');
                // Restore original warning message
                warningDiv.innerHTML = `
                    <span class="danger-icon">⚠️</span>
                    <span class="danger-text">Hold button for 3 seconds to run in dangerous mode - skips ALL confirmations!</span>
                `;
            }, 4000);
        };
        
        const startHold = () => {
            // Clear any click hint timer
            if (clickHintTimer) {
                clearTimeout(clickHintTimer);
                clickHintTimer = null;
            }
            
            // Show warning and progress
            warningDiv.innerHTML = `
                <span class="danger-icon">⚠️</span>
                <span class="danger-text">Hold button for 3 seconds to run in dangerous mode - skips ALL confirmations!</span>
            `;
            warningDiv.classList.remove('click-hint');
            warningDiv.style.display = 'block';
            progressDiv.style.display = 'block';
            skipBtn.classList.add('btn-danger-active');
            
            holdStartTime = Date.now();
            
            // Update progress bar
            progressInterval = setInterval(() => {
                const elapsed = Date.now() - holdStartTime;
                const progress = Math.min((elapsed / HOLD_DURATION) * 100, 100);
                const remaining = Math.max(0, Math.ceil((HOLD_DURATION - elapsed) / 1000));
                
                if (progressBar) {
                    progressBar.style.width = `${progress}%`;
                }
                if (progressCountdown) {
                    progressCountdown.textContent = remaining;
                }
                
                if (elapsed >= HOLD_DURATION) {
                    clearInterval(progressInterval);
                }
            }, 50);
            
            // Set timer for 3 seconds
            holdTimer = setTimeout(() => {
                // Success! Enable dangerous mode
                isDangerMode = true;
                updateButtonStates();
                
                // Reset UI
                warningDiv.style.display = 'none';
                progressDiv.style.display = 'none';
                skipBtn.classList.remove('btn-danger-active');
                
                // Reset progress
                if (progressBar) {
                    progressBar.style.width = '0%';
                }
                if (progressCountdown) {
                    progressCountdown.textContent = '3';
                }
                
                // Clear intervals
                if (progressInterval) {
                    clearInterval(progressInterval);
                    progressInterval = null;
                }
            }, HOLD_DURATION);
        };
        
        const cancelHold = () => {
            // Check if it was a click (any duration less than full hold time)
            const wasIncompleteHold = holdStartTime && (Date.now() - holdStartTime < HOLD_DURATION);
            
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            
            // Reset UI
            progressDiv.style.display = 'none';
            skipBtn.classList.remove('btn-danger-active');
            
            if (progressBar) {
                progressBar.style.width = '0%';
            }
            if (progressCountdown) {
                progressCountdown.textContent = '3';
            }
            
            // If the user released before completing the hold, show the hint
            if (wasIncompleteHold) {
                showClickHint();
            } else {
                warningDiv.style.display = 'none';
                warningDiv.classList.remove('click-hint');
            }
            
            holdStartTime = null;
        };
        
        // Mouse events
        skipBtn.addEventListener('mousedown', startHold);
        skipBtn.addEventListener('mouseup', cancelHold);
        skipBtn.addEventListener('mouseleave', cancelHold);
        
        // Touch events for mobile
        skipBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startHold();
        });
        skipBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            cancelHold();
        });
        skipBtn.addEventListener('touchcancel', cancelHold);

        // Handle back button
        selectorDiv.querySelector('#back-btn').addEventListener('click', () => {
            goBack();
        });

        // Handle Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape' && wrapper.contains(selectorDiv)) {
                goBack();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    async showCreateProjectModal(quadrant, parentWrapper, directorySelectorDiv) {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.zIndex = '10000';
        
        // Project colors for selection
        const projectColors = [
            '#007ACC', '#FF6B6B', '#4ECDC4', '#FFA07A', 
            '#98D8C8', '#FDCB6E', '#6C5CE7', '#A29BFE',
            '#00B894', '#E17055', '#74B9FF', '#A29BFE'
        ];
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px; background: #0a0a0a;">
                <div class="modal-header">
                    <h2>Create New Project</h2>
                    <button class="modal-close" id="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="project-name">Project Name</label>
                        <input type="text" id="project-name" class="form-input" placeholder="Enter project name" autofocus>
                    </div>
                    
                    <div class="form-group">
                        <label for="project-path">Base Directory <small style="color: var(--text-secondary); font-weight: normal;">(project folder will be created inside)</small></label>
                        <div class="path-input-group" style="display: flex; gap: 8px;">
                            <input type="text" id="project-path" class="form-input" placeholder="Select base directory where project will be created" style="flex: 1;">
                            <button id="browse-path" class="btn">Browse...</button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>Project Color</label>
                        <div class="color-picker-grid" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-top: 8px;">
                            ${projectColors.map((color, index) => `
                                <button class="color-option" data-color="${color}" style="
                                    width: 40px; 
                                    height: 40px; 
                                    background: ${color}; 
                                    border: 2px solid transparent; 
                                    border-radius: 4px; 
                                    cursor: pointer;
                                    ${index === 0 ? 'border-color: #fff;' : ''}
                                "></button>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div class="form-group" style="margin-top: 16px;">
                        <label style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="init-git" checked>
                            Initialize as Git repository
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="cancel-create">Cancel</button>
                    <button class="btn btn-primary" id="confirm-create">Create Project</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Initialize with first color selected
        let selectedColor = projectColors[0];
        
        // Handle color selection
        modal.querySelectorAll('.color-option').forEach(btn => {
            btn.addEventListener('click', () => {
                // Remove previous selection
                modal.querySelectorAll('.color-option').forEach(b => {
                    b.style.borderColor = 'transparent';
                });
                // Add selection to clicked button
                btn.style.borderColor = '#fff';
                selectedColor = btn.dataset.color;
            });
        });
        
        // Handle browse button
        modal.querySelector('#browse-path').addEventListener('click', async () => {
            const result = await ipcRenderer.invoke('select-directory');
            if (result) {
                modal.querySelector('#project-path').value = result;
                // Don't auto-fill project name since this is now a base directory
            }
        });
        
        // Handle create button
        modal.querySelector('#confirm-create').addEventListener('click', async () => {
            const projectName = modal.querySelector('#project-name').value.trim();
            const basePath = modal.querySelector('#project-path').value.trim();
            const initGit = modal.querySelector('#init-git').checked;
            
            if (!projectName) {
                this.showNotification('Please enter a project name', 'error');
                return;
            }
            
            if (!basePath) {
                this.showNotification('Please select a base directory', 'error');
                return;
            }
            
            try {
                // Construct the full project path by combining base path with project name
                const path = require('path');
                const fullProjectPath = path.join(basePath, projectName);
                
                // Create the project directory
                const createDirResult = await ipcRenderer.invoke('create-project-directory', fullProjectPath);
                if (!createDirResult.success) {
                    this.showNotification(createDirResult.error || 'Failed to create directory', 'error');
                    return;
                }
                
                // Initialize git if requested
                if (initGit) {
                    const gitResult = await ipcRenderer.invoke('init-git-repo', fullProjectPath);
                    if (!gitResult.success) {
                        console.warn('Failed to initialize git repo:', gitResult.error);
                        // Continue anyway, git init is optional
                    }
                }
                
                // Create project in database with the full path
                const result = await ipcRenderer.invoke('project-create', projectName, selectedColor, fullProjectPath);
                
                if (result.success) {
                    // Close modal
                    document.body.removeChild(modal);
                    
                    // Update last selected directory with the full project path
                    this.lastSelectedDirectories[quadrant] = fullProjectPath;
                    this.saveDirectoryToStorage(quadrant, fullProjectPath);
                    
                    // Remove directory selector and start the terminal directly with a new session
                    parentWrapper.removeChild(directorySelectorDiv);
                    // Start terminal directly with 'new' session type since we just created the project
                    this.startTerminal(quadrant, fullProjectPath, 'new');
                    
                    this.showNotification(`Project "${projectName}" created successfully`, 'success');
                } else {
                    this.showNotification(result.error || 'Failed to create project', 'error');
                }
            } catch (error) {
                console.error('Error creating project:', error);
                this.showNotification('Failed to create project: ' + error.message, 'error');
            }
        });
        
        // Handle cancel button
        modal.querySelector('#cancel-create').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        // Handle close button
        modal.querySelector('#close-modal').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        // Handle Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape' && document.body.contains(modal)) {
                document.body.removeChild(modal);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        // Focus on project name input
        modal.querySelector('#project-name').focus();
    }

    async startTerminal(quadrant, selectedDirectory, sessionType = 'resume') {

        // Find the terminal element based on current layout mode with more robust search
        let quadrantElement;
        
        // Try mode-specific search first
        if (this.layoutMode === 'tabbed') {
            // In tabbed mode, look in the tabbed content container
            const tabbedContent = document.getElementById('tabbed-terminal-content');
            if (tabbedContent) {
                quadrantElement = tabbedContent.querySelector(`[data-quadrant="${quadrant}"]`);

            }
        } else {
            // In grid mode, look in the terminals container
            const gridContainer = document.getElementById('terminals-container');
            if (gridContainer) {
                // Try to find in any nested structure (could be in rows/columns)
                quadrantElement = gridContainer.querySelector(`[data-quadrant="${quadrant}"]`);

            }
        }
        
        // Fallback to document-wide search if not found
        if (!quadrantElement) {
            quadrantElement = document.querySelector(`[data-quadrant="${quadrant}"]`);

        }
        
        if (!quadrantElement) {
            console.error(`Terminal element not found for quadrant ${quadrant} in ${this.layoutMode} mode`);
            console.error(`Available quadrants:`, document.querySelectorAll('[data-quadrant]'));
            return;
        }
        
        // Find wrapper with verification
        const wrapper = quadrantElement.querySelector('.terminal-wrapper');
        if (!wrapper) {
            console.error(`Terminal wrapper not found for quadrant ${quadrant}`);
            console.error(`QuadrantElement structure:`, quadrantElement.innerHTML.substring(0, 500));
            return;
        }
        
        // Verify wrapper is actually in the DOM
        if (!document.body.contains(wrapper)) {
            console.error(`Wrapper found but not in DOM for quadrant ${quadrant}`);
            return;
        }

        const placeholder = wrapper.querySelector('.terminal-placeholder');
        
        if (placeholder) {

            placeholder.remove();
        }

        // Clean wrapper content before adding new elements

        wrapper.innerHTML = '';
        
        // Create loader
        const loader = document.createElement('div');
        loader.className = 'terminal-loader';
        loader.id = `loader-${quadrant}`;
        loader.innerHTML = `
            <div class="loader-spinner"></div>
            <div class="loader-text">Starting Claude Code...</div>
            <div class="loader-status">Initializing terminal</div>
        `;
        wrapper.appendChild(loader);

        // Track Claude Code readiness
        if (!this.claudeCodeReady) {
            this.claudeCodeReady = {};
        }
        this.claudeCodeReady[quadrant] = false;
        
        // Check if there's a pending task - if so, give more time for Claude to start
        const hasPendingTask = window.pendingTerminalTasks && window.pendingTerminalTasks[quadrant];
        const timeoutDuration = hasPendingTask ? 10000 : 5000; // 10s for tasks, 5s normal
        
        // Set a timeout to show terminal even if Claude Code doesn't start
        setTimeout(() => {
            if (!this.claudeCodeReady[quadrant]) {
                // Timeout reached, showing terminal
                const timeoutLoader = document.getElementById(`loader-${quadrant}`);
                const timeoutTerminalDiv = document.getElementById(`terminal-${quadrant}`);
                
                if (timeoutLoader && timeoutTerminalDiv) {
                    // If we have a pending task and still no Claude, update status
                    if (hasPendingTask) {
                        const loaderStatus = timeoutLoader.querySelector('.loader-status');
                        if (loaderStatus) {
                            loaderStatus.textContent = 'Claude is taking longer than expected...';
                        }
                        // Give it another few seconds for task scenarios
                        setTimeout(() => {
                            timeoutLoader.style.display = 'none';
                            timeoutTerminalDiv.style.display = 'block';
                            
                            const terminalInfo = this.terminals.get(quadrant);
                            if (terminalInfo && terminalInfo.fitAddon) {
                                terminalInfo.fitAddon.fit();
                            }
                        }, 3000);
                    } else {
                        // No task, show terminal immediately
                        timeoutLoader.style.display = 'none';
                        timeoutTerminalDiv.style.display = 'block';
                        
                        const terminalInfo = this.terminals.get(quadrant);
                        if (terminalInfo && terminalInfo.fitAddon) {
                            terminalInfo.fitAddon.fit();
                        }
                    }
                }
            }
        }, timeoutDuration);

        // Create embedded terminal with xterm.js
        const terminalDiv = document.createElement('div');
        terminalDiv.className = 'terminal';
        terminalDiv.id = `terminal-${quadrant}`;
        terminalDiv.style.display = 'none';
        wrapper.appendChild(terminalDiv);
        
        // Verify the terminalDiv was added correctly
        const addedTerminal = wrapper.querySelector(`#terminal-${quadrant}`);
        if (!addedTerminal) {
            console.error(`Failed to add terminalDiv to wrapper for quadrant ${quadrant}`);
            console.error(`Wrapper content after append:`, wrapper.innerHTML.substring(0, 500));
            return;
        }

        // Initialize xterm.js terminal with better config
        const terminal = new Terminal({
            theme: {
                background: '#0a0a0a',
                foreground: '#ffffff',
                cursor: '#667eea',
                selection: '#667eea33',
                black: '#000000',
                red: '#ef4444',
                green: '#10b981',
                yellow: '#f59e0b',
                blue: '#3b82f6',
                magenta: '#8b5cf6',
                cyan: '#06b6d4',
                white: '#ffffff',
                brightBlack: '#404040',
                brightRed: '#f87171',
                brightGreen: '#34d399',
                brightYellow: '#fbbf24',
                brightBlue: '#60a5fa',
                brightMagenta: '#a78bfa',
                brightCyan: '#67e8f9',
                brightWhite: '#ffffff'
            },
            fontFamily: 'JetBrains Mono, SF Mono, Monaco, Inconsolata, "Fira Code", Consolas, "Courier New", monospace',
            fontSize: 13,
            lineHeight: 1.2,
            bracketedPasteMode: false,
            cursorBlink: true,
            cursorStyle: 'block',
            scrollback: 1000,
            allowTransparency: true,
            cols: 100,
            rows: 30,
            // Terminal behavior settings
            macOptionIsMeta: false,
            macOptionClickForcesSelection: false,
            rightClickSelectsWord: false,
            // Ensure proper handling of special keys
            convertEol: true,
            windowsMode: false,
            // Force terminal to send correct escape sequences
            termName: 'xterm-256color'
        });

        const fitAddon = new FitAddon();
        
        // Create WebLinksAddon with custom handler and debouncing
        let linkClickTimeout = null;
        let lastClickTime = 0;
        const DOUBLE_CLICK_DELAY = 300; // milliseconds
        
        const webLinksAddon = new WebLinksAddon((event, uri) => {
            // Prevent double-click crashes with debouncing
            const currentTime = Date.now();
            
            // Ignore if this is a rapid subsequent click
            if (currentTime - lastClickTime < DOUBLE_CLICK_DELAY) {

                return;
            }
            
            // Clear any pending timeout
            if (linkClickTimeout) {
                clearTimeout(linkClickTimeout);
            }
            
            // Set a timeout to handle the click
            linkClickTimeout = setTimeout(() => {

                require('electron').shell.openExternal(uri).catch(err => {
                    console.error('Failed to open link:', err);
                    this.showNotification('Failed to open link', 'error');
                });
            }, 50); // Small delay to catch double-clicks
            
            lastClickTime = currentTime;
        });
        
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(webLinksAddon);
        
        // Verify terminalDiv is still in DOM before opening terminal
        if (!document.body.contains(terminalDiv)) {
            console.error(`TerminalDiv not in DOM before opening for quadrant ${quadrant}`);
            // Try to re-add it
            const currentWrapper = quadrantElement.querySelector('.terminal-wrapper');
            if (currentWrapper) {

                currentWrapper.appendChild(terminalDiv);
            } else {
                console.error(`Cannot find wrapper to re-add terminalDiv for quadrant ${quadrant}`);
                return;
            }
        }
        
        try {
            terminal.open(terminalDiv);

        } catch (error) {
            console.error(`Failed to open terminal for quadrant ${quadrant}:`, error);
            console.error(`TerminalDiv state:`, terminalDiv);
            console.error(`TerminalDiv parent:`, terminalDiv.parentElement);
            return;
        }
        
        fitAddon.fit();
        
        // Add visibility observer to ensure proper fitting when terminal becomes visible
        const visibilityObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && entry.target === terminalDiv) {
                    setTimeout(() => fitAddon.fit(), 100);
                }
            });
        });
        visibilityObserver.observe(terminalDiv);

        // Create PTY terminal process with selected directory
        try {

            const result = await ipcRenderer.invoke('create-terminal', quadrant, selectedDirectory, sessionType);

            // Update only the terminal header to show the "More Options" button
            setTimeout(async () => {
                await this.updateTerminalHeader(quadrant);
            }, 100);
        } catch (error) {
            console.error('Failed to create terminal:', error);
            this.showNotification(`Failed to create terminal: ${error.message || error}`, 'error');
            return;
        }
        
        // Focus the terminal
        terminal.focus();
        
        // DEBUG: Confirm no custom key handler

        // Handle terminal input - let xterm.js handle everything naturally
        terminal.onData(data => {
            // Filter out bracketed paste sequences from input
            let filteredData = data;
            
            // Remove bracketed paste markers if present
            filteredData = filteredData.replace(/\x1b\[200~/g, '');
            filteredData = filteredData.replace(/\x1b\[201~/g, '');
            
            // Send filtered data
            ipcRenderer.send('terminal-input', quadrant, filteredData);
            
            // Block notifications temporarily when user is typing
            this.blockNotificationsWhileTyping(quadrant);
            
            // UNBLOCK notifications when user interacts with waiting terminal
            if (this.waitingForUserInteraction.get(quadrant) && this.activeTerminal === quadrant) {
                // Any meaningful input should unblock (Enter, y, n, etc.)
                if (data === '\r' || data === '\r\n' || data === 'y' || data === 'n' || data === 'Y' || data === 'N') {
                    this.unblockNotifications(quadrant);
                }
            }
        });
        
        // Comment out the custom paste handler to allow normal paste functionality
        // This was blocking image paste in Claude
        /*
        terminal.attachCustomKeyEventHandler((event) => {
            // Intercept paste events (Cmd+V on Mac, Ctrl+V on other platforms)
            if (event.type === 'keydown' && (event.metaKey || event.ctrlKey) && event.key === 'v') {
                // Prevent default to handle paste ourselves
                event.preventDefault();
                
                // Use clipboard API to get clean text
                navigator.clipboard.readText().then(text => {
                    // Send the pasted text directly to the terminal
                    ipcRenderer.send('terminal-input', quadrant, text);
                }).catch(err => {
                    console.error('Failed to read clipboard:', err);
                });
                
                return false; // Prevent xterm from handling this event
            }
            return true;
        });
        */
        
        // Comment out the paste event handler to allow normal paste functionality
        // This was preventing image paste in Claude
        /*
        terminalDiv.addEventListener('paste', async (event) => {
            event.preventDefault();
            
            // Check if there are files (images) in the clipboard
            const items = event.clipboardData.items;
            let imageFound = false;
            
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                
                // Check if it's an image
                if (item.type.indexOf('image') !== -1) {
                    imageFound = true;
                    const blob = item.getAsFile();
                    
                    if (blob) {
                        // Create a temporary file path
                        const timestamp = new Date().getTime();
                        const filename = `clipboard-image-${timestamp}.png`;
                        const tempPath = `/tmp/${filename}`;
                        
                        // Read the blob as array buffer
                        const arrayBuffer = await blob.arrayBuffer();
                        const buffer = Buffer.from(arrayBuffer);
                        
                        // Send to main process to save the file
                        ipcRenderer.send('save-clipboard-image', {
                            quadrant: quadrant,
                            buffer: buffer,
                            filename: filename,
                            path: tempPath
                        });
                    }
                    break;
                }
            }
            
            // If no image found, handle as text
            if (!imageFound) {
                const text = event.clipboardData.getData('text/plain');
                if (text) {
                    // Send the pasted text directly to the terminal
                    ipcRenderer.send('terminal-input', quadrant, text);
                }
            }
        });
        */

        // Handle terminal output
        ipcRenderer.on(`terminal-output-${quadrant}`, (event, data) => {
            // Filter out problematic escape sequences
            let filteredData = data;
            
            // Remove bracketed paste mode sequences if they appear
            filteredData = filteredData.replace(/\x1b\[\?2004[hl]/g, '');
            
            // Write filtered data to terminal
            terminal.write(filteredData);
            
            // Track that output is happening (likely Claude)
            this.claudeOutputting.set(quadrant, true);
            
            // Clear the outputting flag after a short delay if no more output
            if (this.claudeOutputting.timeout) {
                clearTimeout(this.claudeOutputting.timeout);
            }
            this.claudeOutputting.timeout = setTimeout(() => {
                this.claudeOutputting.set(quadrant, false);

            }, 1000);
            
            // Check if Claude is ready and we have a pending task
            const dataStr = data.toString();
            
            // More comprehensive Claude detection patterns including visual prompts
            const claudeReadyPatterns = [
                'Welcome to Claude Code',
                'claude-opus-4-1',
                'Human:',
                'Assistant:',
                'Type your message',
                'Working directory:',
                'Claude Code is ready',
                'Enter your prompt',
                '╭─', // Claude's visual prompt box
                'Try "how does', // Claude's suggestion prompt
                '│ ✻', // Claude's prompt symbol
                '[?2004h' // Terminal ready sequence
            ];
            
            const isClaudeReady = claudeReadyPatterns.some(pattern => 
                dataStr.includes(pattern)
            );
            
            // Debug logging for terminal output
            if (window.pendingTerminalTasks && window.pendingTerminalTasks[quadrant]) {

                this.claudeCodeReady[quadrant] = true;
                
                // Check for pending task for this terminal
                if (window.pendingTerminalTasks && window.pendingTerminalTasks[quadrant]) {
                    const taskData = window.pendingTerminalTasks[quadrant];

                    // Update loader status to show we're sending the task
                    const loader = document.getElementById(`loader-${quadrant}`);
                    if (loader) {
                        const loaderStatus = loader.querySelector('.loader-status');
                        if (loaderStatus) {
                            loaderStatus.textContent = 'Sending task to Claude...';
                        }
                    }
                    
                    // Build the message to send
                    let message = `\n# Work on task #${taskData.taskId}: ${taskData.title}\n\n`;
                    
                    if (taskData.description) {
                        message += `## Description:\n${taskData.description}\n\n`;
                    }
                    
                    if (taskData.implementation) {
                        message += `## Previous Implementation:\n${taskData.implementation}\n\n`;
                    }
                    
                    if (taskData.plan) {
                        message += `## Plan:\n${taskData.plan}\n\n`;
                    }
                    
                    message += `## Command:\nWork on this task\n`;
                    
                    // Send the task info to Claude with a delay to ensure it's ready
                    setTimeout(() => {

                        ipcRenderer.send('send-to-terminal', quadrant, message);
                        
                        // Then send the command to start the task
                        setTimeout(() => {
                            const startCommand = `mcp__codeagentswarm-tasks__start_task --task_id ${taskData.taskId}\n`;

                            ipcRenderer.send('send-to-terminal', quadrant, startCommand);
                            
                            // NOW hide the loader and show the terminal after everything is sent
                            setTimeout(() => {
                                const finalLoader = document.getElementById(`loader-${quadrant}`);
                                const terminalDiv = document.getElementById(`terminal-${quadrant}`);
                                if (finalLoader && terminalDiv) {
                                    finalLoader.style.display = 'none';
                                    terminalDiv.style.display = 'block';
                                    
                                    // Fit terminal after showing
                                    const terminalInfo = this.terminals.get(quadrant);
                                    if (terminalInfo && terminalInfo.fitAddon) {
                                        terminalInfo.fitAddon.fit();
                                    }
                                }
                            }, 500); // Small delay to let the command register visually
                        }, 500);
                    }, 2000); // Increased delay to 2 seconds to ensure Claude is fully ready
                    
                    // Clear the pending task
                    delete window.pendingTerminalTasks[quadrant];
                } else {
                    // No pending task, hide loader immediately
                    const loader = document.getElementById(`loader-${quadrant}`);
                    const terminalDiv = document.getElementById(`terminal-${quadrant}`);
                    if (loader && terminalDiv) {
                        loader.style.display = 'none';
                        terminalDiv.style.display = 'block';
                    }
                }
            }
            
            // Set terminal activity for spinner in tabbed mode
            this.setTerminalActivity(quadrant, true);
            
            // Clear activity after a short delay
            if (this.activityTimers && this.activityTimers.has(quadrant)) {
                clearTimeout(this.activityTimers.get(quadrant));
            }
            if (!this.activityTimers) {
                this.activityTimers = new Map();
            }
            const timer = setTimeout(() => {
                this.setTerminalActivity(quadrant, false);
            }, 500);
            this.activityTimers.set(quadrant, timer);
            
            // DISABLED: Auto-scroll on patterns - this was too aggressive
            // Users reported it was annoying and interrupted their workflow
            // Now only auto-scrolls on explicit events (terminal exit, notifications, etc.)
            // Users can manually scroll or click the scroll button when needed
        });

        // Handle terminal exit
        ipcRenderer.on(`terminal-exit-${quadrant}`, (event, code) => {
            terminal.write(`\r\n\x1b[31]Terminal exited with code: ${code}\x1b[0m\r\n`);
            // Auto-scroll to bottom when terminal exits
            this.scrollTerminalToBottom(quadrant);
        });

        // Handle terminal resize
        terminal.onResize(({ cols, rows }) => {
            ipcRenderer.send('terminal-resize', quadrant, cols, rows);
        });

        // Initialize user scrolling state for this terminal
        this.userScrolling.set(quadrant, false);
        
        // Store terminal info
        this.terminals.set(quadrant, {
            terminal,
            fitAddon,
            element: terminalDiv,
            type: 'embedded'
        });

        this.setActiveTerminal(quadrant);
        
        // Set terminal title based on directory
        let terminalTitle = 'Claude Code';
        if (selectedDirectory) {
            const folderName = selectedDirectory.split('/').pop() || selectedDirectory.split('\\').pop();
            terminalTitle = folderName || 'Claude Code';
            // Remember this directory for this terminal
            this.lastSelectedDirectories[quadrant] = selectedDirectory;
            // Save to database (fire and forget to avoid blocking)
            this.saveDirectoryToStorage(quadrant, selectedDirectory).catch(err => {
                console.warn('Failed to save directory to database:', err);
            });
        }
        this.updateTerminalTitle(quadrant, terminalTitle);
        
        // Update all terminals with the same project to ensure color consistency
        if (selectedDirectory) {
            const projectName = selectedDirectory.split('/').pop() || selectedDirectory.split('\\').pop();
            if (projectName) {
                // Small delay to ensure DOM is ready
                setTimeout(() => {
                    this.updateAllTerminalsWithProject(projectName);
                }, 100);
            }
        }
        
        // Add click event to terminal title for color selection
        const terminalTitleElement = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-title`);
        if (terminalTitleElement) {
            terminalTitleElement.style.cursor = 'pointer'; // Show it's clickable
            terminalTitleElement.title = 'Click to change project color'; // Add tooltip
            terminalTitleElement.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent event bubbling
                this.showColorPicker(quadrant, e);
            });
        }
        
        
        // Ensure terminal gets DOM focus when clicked directly
        terminalDiv.addEventListener('click', () => {
            terminal.focus();
            // Clear badge when clicking on any terminal
            this.clearNotificationBadge();
            // setActiveTerminal will be handled by global click listener
        });
        
        terminalDiv.addEventListener('mousedown', () => {
            terminal.focus();
            // Clear badge when clicking on any terminal
            this.clearNotificationBadge();
        });
        
        // Focus and fit immediately when created
        // Focus and fit on next tick
        setTimeout(() => {
            terminal.focus();
            fitAddon.fit();
        }, 50);
        
        // Single delayed fit for proper sizing
        setTimeout(() => fitAddon.fit(), 300);

        // Add scroll to bottom button
        this.addScrollToBottomButton(terminalDiv, terminal, quadrant);

        // Update git button visibility
        this.updateGitButtonVisibility();
        
        // Update branch display for this specific terminal with a delay to ensure terminal is ready
        setTimeout(() => {
            this.updateBranchDisplay(quadrant);
        }, 2000);
        
        // No need to refresh tabs here - already handled in addTerminal

    }

    highlightTerminal(quadrant) {
        // In tabbed mode, show notification on tab
        if (this.layoutMode === 'tabbed') {
            this.showTerminalNotification(quadrant);
            // Switch to the tab if it's not active
            if (this.activeTabTerminal !== quadrant) {
                // Just show notification, don't auto-switch
                const tab = document.querySelector(`.terminal-tab[data-terminal-id="${quadrant}"]`);
                if (tab) {
                    tab.classList.add('tab-has-notification');
                }
            }
        } else {
            // Grid mode - highlight the terminal element
            const terminalElement = document.querySelector(`[data-quadrant="${quadrant}"]`);
            if (terminalElement) {
                terminalElement.classList.add('confirmation-highlight');
                setTimeout(() => {
                    terminalElement.classList.remove('confirmation-highlight');
                }, 3000);
            }
        }
    }

    scrollTerminalToBottom(quadrant) {
        // Don't force scroll if user is manually scrolling
        if (this.userScrolling.get(quadrant)) {

            return;
        }
        
        const terminal = this.terminals.get(quadrant);
        if (terminal && terminal.terminal) {
            // Use setTimeout to ensure the terminal has rendered any new content
            setTimeout(() => {
                // Double-check user isn't scrolling before actually scrolling
                if (this.userScrolling.get(quadrant)) {

                    return;
                }
                
                try {
                    const terminalDiv = terminal.element || document.querySelector(`[data-quadrant="${quadrant}"] .terminal`);
                    const viewport = terminalDiv?.querySelector('.xterm-viewport');
                    
                    if (viewport) {
                        // Check if already at bottom before scrolling
                        const isAtBottom = (viewport.scrollTop + viewport.clientHeight) >= (viewport.scrollHeight - 10);
                        
                        if (!isAtBottom) {
                            // Method 1: Use xterm's scrollToBottom
                            if (terminal.terminal.scrollToBottom) {
                                terminal.terminal.scrollToBottom();
                            }
                            
                            // Method 2: Also scroll the viewport directly as backup
                            viewport.scrollTop = viewport.scrollHeight;
                            
                            // Method 3: Use the scroll button's stored function if available
                            if (terminal.terminal.scrollToBottomFn) {
                                terminal.terminal.scrollToBottomFn();
                            }

                        }
                    }
                    
                    // Update scroll button visibility
                    const scrollBtn = terminalDiv?.querySelector('.scroll-to-bottom-btn');
                    if (scrollBtn) {
                        scrollBtn.classList.remove('show');
                    }
                    
                    // Don't clear user scrolling flag here - let the scroll event handler manage it
                } catch (e) {
                    console.error(`Error scrolling terminal ${quadrant} to bottom:`, e);
                }
            }, 100); // Small delay to ensure content is rendered
        }
    }

    showNotification(message, type = 'info') {
        // Redirect to the main showNotification method at the end of the class
        return;
    }
    
    showBadgeNotification(message) {
        // Create badge element
        const badge = document.createElement('div');
        badge.className = 'badge-notification';
        badge.innerHTML = `
            <i data-lucide="check-circle"></i>
            <span>${message}</span>
        `;
        
        // Add to body
        document.body.appendChild(badge);
        
        // Initialize lucide icon
        if (window.lucide) {
            window.lucide.createIcons();
        }
        
        // Play subtle sound effect (disabled for now)
        // this.playNotificationSound();
        
        // Trigger animation
        setTimeout(() => {
            badge.classList.add('show');
        }, 10);
        
        // Remove after 4 seconds
        setTimeout(() => {
            badge.classList.remove('show');
            setTimeout(() => {
                if (badge.parentNode) {
                    badge.parentNode.removeChild(badge);
                }
            }, 300);
        }, 4000);
    }

    playNotificationSound() {
        // Create audio element with data URI for a subtle notification sound
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhCCuBzvLZijYIG2m98OScTgwOUarm7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWTAsOUqzn77djGAY2k9T0xHkiBCt9y+/ejjQIHWu+9OGSSwsLUqrl7rllGAU1k9T0xHkiBCt9y+/ejjQIHWu+9OGSSwsLUqrl7rllGAU1k9T0xHkiBCt9yu7blDwLG2S57OuqWg0HTKbg6r1pGAU2k9T0xHkiBCt9yu7blDwLG2S57OuqWg0HTKbg6r1pGAU2k9T0xHkiBCt9yu7blDwLG2S57OuqWg0HTKbg6r1pGAU2k9T0xHkiBCt9yu7blDwLG2S57OuqWg0=');
        audio.volume = 0.3;
        audio.play().catch(e => {
            // Ignore errors - sound is optional

        });
    }

    showDesktopNotification(title, message) {
        // Send IPC message to main process to show native notification
        ipcRenderer.send('show-desktop-notification', title, message);
        
        // Auto-scroll terminal to bottom when showing any desktop notification
        // Extract terminal number from message if present
        const terminalMatch = message.match(/Terminal (\d+)/);
        if (terminalMatch) {
            const terminalNumber = parseInt(terminalMatch[1]);
            const quadrant = terminalNumber - 1; // Convert 1-based to 0-based
            if (quadrant >= 0 && quadrant < 4) {
                this.scrollTerminalToBottom(quadrant);
            }
        }
        
        // Fallback de notificación interna removido - solo notificaciones externas
    }

    // Removed handleConfirmationRequest - now using webhooks
    
    
    unblockNotifications(quadrant) {
        this.notificationBlocked.set(quadrant, false);
        this.waitingForUserInteraction.set(quadrant, false);
        
        // Remove terminal from those needing attention
        this.terminalsNeedingAttention.delete(quadrant);
        this.updateNotificationBadge();
        
        // Remove highlight animation since user is responding
        const terminalElement = document.querySelector(`[data-quadrant="${quadrant}"]`);
        if (terminalElement) {
            terminalElement.classList.remove('confirmation-highlight');
            // Clear the highlighted terminal reference
            if (this.highlightedTerminal === quadrant) {
                this.highlightedTerminal = null;
            }
        }
    }
    
    blockNotificationsWhileTyping(quadrant) {
        // Block notifications temporarily while user is typing
        this.notificationBlocked.set(quadrant, true);
        
        // Clear existing timer
        if (this.userTypingTimers.has(quadrant)) {
            clearTimeout(this.userTypingTimers.get(quadrant));
        }
        
        // Auto-unblock after 3 seconds of no typing
        const timerId = setTimeout(() => {
            this.notificationBlocked.set(quadrant, false);
            this.userTypingTimers.delete(quadrant);
        }, 3000);
        
        this.userTypingTimers.set(quadrant, timerId);
    }
    
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
    }

    highlightTerminalForConfirmation(quadrant) {
        // In tabbed mode, show notification on tab
        if (this.layoutMode === 'tabbed') {
            this.showTerminalNotification(quadrant);
            this.highlightedTerminal = quadrant;
            return;
        }
        
        // Grid mode - existing behavior
        const terminalElement = document.querySelector(`[data-quadrant="${quadrant}"]`);
        if (terminalElement) {
            // Add pulsing highlight effect
            terminalElement.classList.add('confirmation-highlight');
            
            // Store the quadrant that needs attention
            this.highlightedTerminal = quadrant;
            
            // Remove highlight only when user focuses on this terminal
            const removeHighlightOnFocus = () => {
                if (this.activeTerminal === quadrant) {
                    terminalElement.classList.remove('confirmation-highlight');
                    this.highlightedTerminal = null;
                    // Remove the focus listener once used
                    document.removeEventListener('click', handleTerminalClick);
                }
            };
            
            // Handle clicks on the terminal to detect focus
            const handleTerminalClick = (event) => {
                const clickedQuadrant = event.target.closest('[data-quadrant]');
                if (clickedQuadrant && parseInt(clickedQuadrant.dataset.quadrant) === quadrant) {
                    removeHighlightOnFocus();
                }
            };
            
            // Add click listener to detect when user focuses on the terminal
            document.addEventListener('click', handleTerminalClick);
            
            // Fallback: Remove highlight after 30 seconds (increased from 10) as emergency timeout
            setTimeout(() => {
                if (terminalElement.classList.contains('confirmation-highlight')) {
                    terminalElement.classList.remove('confirmation-highlight');
                    this.highlightedTerminal = null;
                    document.removeEventListener('click', handleTerminalClick);
                }
            }, 30000);
        }
    }

    setActiveTerminal(quadrant) {
        if (this.activeTerminal !== null) {
            const prevElement = document.querySelector(`#terminal-${this.activeTerminal}`);
            if (prevElement) {
                prevElement.classList.remove('active');
            }
        }
        
        this.activeTerminal = quadrant;
        const element = document.querySelector(`#terminal-${quadrant}`);
        if (element) {
            element.classList.add('active');
        }
        
        // Focus the active terminal
        const terminal = this.terminals.get(quadrant);
        if (terminal && terminal.terminal) {
            terminal.terminal.focus();
        }
    }

    updateTerminalTitle(quadrant, title) {
        // Get project information for initials
        let projectInitials = '';
        let projectColor = null;
        
        if (this.lastSelectedDirectories[quadrant]) {
            const dir = this.lastSelectedDirectories[quadrant];
            const projectName = dir.split('/').pop() || dir;
            projectInitials = this.getProjectInitials(projectName);
            
            // Get project color
            if (this.customProjectColors[projectName]) {
                projectColor = this.customProjectColors[projectName];
            } else {
                const colors = this.generateProjectColor(projectName);
                projectColor = colors ? colors.primary : null;
            }
        }
        
        // Find the terminal title element based on current layout mode
        let titleElement;
        let headerElement;
        
        if (this.layoutMode === 'tabbed') {
            // Update both the tab title and the terminal header title in tabbed mode
            const tab = document.querySelector(`.terminal-tab[data-terminal-id="${quadrant}"] .tab-title`);
            if (tab) {
                tab.textContent = title;
            }
            titleElement = document.querySelector(`#tabbed-terminal-content [data-quadrant="${quadrant}"] .terminal-title`);
            headerElement = document.querySelector(`#tabbed-terminal-content [data-quadrant="${quadrant}"] .terminal-header`);
        } else {
            titleElement = document.querySelector(`#terminals-container [data-quadrant="${quadrant}"] .terminal-title`);
            headerElement = document.querySelector(`#terminals-container [data-quadrant="${quadrant}"] .terminal-header`);
        }
        
        if (!titleElement) {
            // Fallback to general search
            titleElement = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-title`);
            headerElement = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-header`);
        }
        
        if (titleElement) {
            // Update the title with terminal number and project initials
            const terminalNumber = quadrant + 1;
            
            // Check if we need to add/update project initials badge
            if (headerElement) {
                let initialsElement = headerElement.querySelector('.terminal-project-initials');
                
                if (projectInitials) {
                    if (!initialsElement) {
                        // Create initials element if it doesn't exist
                        initialsElement = document.createElement('span');
                        initialsElement.className = 'terminal-project-initials';
                        // Insert after terminal title
                        titleElement.parentNode.insertBefore(initialsElement, titleElement.nextSibling);
                    }
                    
                    initialsElement.textContent = projectInitials;
                    if (projectColor) {
                        initialsElement.style.background = projectColor;
                        initialsElement.style.color = 'white';
                    }
                } else if (initialsElement) {
                    // Remove initials element if no project
                    initialsElement.remove();
                }
            }
            
            // Check if title already has the terminal number prefix to avoid duplication
            const hasNumberPrefix = /^\d+\s*·\s*/.test(title);
            if (hasNumberPrefix) {
                // Title already has number, use as is
                titleElement.textContent = title;
            } else {
                // Add terminal number prefix
                titleElement.textContent = `${terminalNumber} · ${title}`;
            }
        }
        
        // Update terminal header color based on project
        this.updateTerminalHeaderColor(quadrant);
    }

    // Generate project initials from project name
    getProjectInitials(projectName) {
        if (!projectName) return '';
        
        // Split by camelCase, PascalCase, kebab-case, snake_case, or spaces
        const words = projectName
            .replace(/([A-Z])/g, ' $1') // Add space before capitals
            .replace(/[-_]/g, ' ') // Replace dashes and underscores with spaces
            .split(' ')
            .filter(word => word.length > 0);
        
        if (words.length === 0) return '';
        
        // If single word, return first 2 letters
        if (words.length === 1) {
            return words[0].substring(0, 2).toUpperCase();
        }
        
        // If multiple words, return initials (max 3)
        return words
            .slice(0, 3)
            .map(word => word[0].toUpperCase())
            .join('');
    }
    
    // Generate a unique color based on project name
    generateProjectColor(projectName) {
        if (!projectName) {
            return null; // Return null for default color
        }
        
        // Check if there's a custom color for this project
        if (this.customProjectColors[projectName]) {
            return this.customProjectColors[projectName];
        }
        
        // Predefined beautiful color palettes that match the app design
        const colorPalettes = [
            // Purple/Violet theme (matches app primary)
            { primary: '#7f5af0', light: '#9171f8', dark: '#6d47e8', name: 'purple' },
            // Teal/Cyan theme
            { primary: '#06b6d4', light: '#22d3ee', dark: '#0891b2', name: 'cyan' },
            // Green theme (matches app secondary)
            { primary: '#2cb67d', light: '#34d399', dark: '#10b981', name: 'green' },
            // Orange theme (matches app accent)
            { primary: '#ff8906', light: '#fbbf24', dark: '#f59e0b', name: 'orange' },
            // Pink theme
            { primary: '#ec4899', light: '#f472b6', dark: '#db2777', name: 'pink' },
            // Blue theme
            { primary: '#3b82f6', light: '#60a5fa', dark: '#2563eb', name: 'blue' },
            // Indigo theme
            { primary: '#6366f1', light: '#818cf8', dark: '#4f46e5', name: 'indigo' },
            // Red theme
            { primary: '#ef4444', light: '#f87171', dark: '#dc2626', name: 'red' },
            // Emerald theme
            { primary: '#059669', light: '#10b981', dark: '#047857', name: 'emerald' },
            // Yellow theme
            { primary: '#eab308', light: '#facc15', dark: '#ca8a04', name: 'yellow' },
            // Violet theme
            { primary: '#8b5cf6', light: '#a78bfa', dark: '#7c3aed', name: 'violet' },
            // Rose theme
            { primary: '#f43f5e', light: '#fb7185', dark: '#e11d48', name: 'rose' }
        ];
        
        // Generate a hash from the project name
        let hash = 0;
        for (let i = 0; i < projectName.length; i++) {
            const char = projectName.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        
        // Select a color palette based on the hash
        const paletteIndex = Math.abs(hash) % colorPalettes.length;
        const palette = colorPalettes[paletteIndex];
        
        return {
            name: palette.name,
            primary: palette.primary,
            light: palette.light,
            dark: palette.dark,
            transparent: `${palette.primary}20`, // 20% opacity
            glow: `${palette.primary}40` // 40% opacity for glow effects
        };
    }

    // Update terminal header color based on project
    updateTerminalHeaderColor(quadrant) {
        // Find the terminal header based on current layout mode
        let terminalHeader;
        if (this.layoutMode === 'tabbed') {
            terminalHeader = document.querySelector(`#tabbed-terminal-content [data-quadrant="${quadrant}"] .terminal-header`);
        } else {
            terminalHeader = document.querySelector(`#terminals-container [data-quadrant="${quadrant}"] .terminal-header`);
        }
        
        if (!terminalHeader) {
            // Fallback to general search
            terminalHeader = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-header`);
            if (!terminalHeader) {
                console.warn(`Terminal header not found for quadrant ${quadrant} in mode ${this.layoutMode}`);
                return;
            }
        }

        // Get the project name and color for this terminal (moved outside to be available for tabs)
        const projectName = this.getTerminalProjectName(quadrant);
        let projectColor = null;
        
        if (projectName) {
            // Check for custom color first
            if (this.customProjectColors[projectName]) {
                projectColor = this.customProjectColors[projectName];
            } else {
                // Generate color if not custom
                const colors = this.generateProjectColor(projectName);
                projectColor = colors ? colors.primary : null;
            }
        }
        
        if (terminalHeader) {
            // Only apply colors if terminal is actually running
            if (!this.terminals.has(quadrant)) {
                // Reset to default colors for inactive terminals
                terminalHeader.style.background = 'rgba(255, 255, 255, 0.03)';
                terminalHeader.style.borderBottomColor = 'var(--border)';
                terminalHeader.style.borderBottomWidth = '1px';
                terminalHeader.style.boxShadow = '';
                
                const titleElement = terminalHeader.querySelector('.terminal-title');
                if (titleElement) {
                    titleElement.style.background = '';
                    titleElement.style.webkitBackgroundClip = '';
                    titleElement.style.webkitTextFillColor = '';
                    titleElement.style.backgroundClip = '';
                    titleElement.style.color = 'var(--text-secondary)';
                    titleElement.style.fontWeight = '600';
                    titleElement.style.textShadow = '';
                    titleElement.style.filter = '';
                }
                return;
            }
        
        if (projectName) {
            const colors = this.generateProjectColor(projectName);
            if (colors) {
                // Apply beautiful gradient background with project color
                terminalHeader.style.background = `linear-gradient(135deg, ${colors.transparent}, rgba(255, 255, 255, 0.02))`;
                terminalHeader.style.borderBottomColor = colors.primary;
                terminalHeader.style.borderBottomWidth = '2px';
                terminalHeader.style.boxShadow = `
                    inset 0 1px 0 ${colors.glow},
                    0 1px 0 rgba(0, 0, 0, 0.2),
                    0 0 20px ${colors.transparent}
                `;
                
                // Update the terminal title with gradient text effect
                const titleElement = terminalHeader.querySelector('.terminal-title');
                if (titleElement) {
                    titleElement.style.background = `linear-gradient(135deg, ${colors.primary}, ${colors.light})`;
                    titleElement.style.webkitBackgroundClip = 'text';
                    titleElement.style.webkitTextFillColor = 'transparent';
                    titleElement.style.backgroundClip = 'text';
                    titleElement.style.fontWeight = '700';
                    titleElement.style.textShadow = '';
                    titleElement.style.filter = `drop-shadow(0 0 8px ${colors.glow})`;
                }
                
                // Apply subtle color to git branch display if present
                const gitBranchDisplay = terminalHeader.querySelector('.git-branch-display');
                if (gitBranchDisplay) {
                    gitBranchDisplay.style.background = colors.transparent;
                    gitBranchDisplay.style.borderColor = colors.primary;
                    gitBranchDisplay.style.color = colors.primary;
                }
                
                // Apply subtle color to task indicator if present (only color, no background/border)
                const taskIndicator = terminalHeader.querySelector('.current-task');
                if (taskIndicator) {
                    taskIndicator.style.color = colors.light;
                }
            }
        } else {
            // Reset to default colors when no project
            terminalHeader.style.background = 'rgba(255, 255, 255, 0.03)';
            terminalHeader.style.borderBottomColor = 'var(--border)';
            terminalHeader.style.borderBottomWidth = '1px';
            terminalHeader.style.boxShadow = '';
            
            // Reset title to default styling
            const titleElement = terminalHeader.querySelector('.terminal-title');
            if (titleElement) {
                titleElement.style.background = '';
                titleElement.style.webkitBackgroundClip = '';
                titleElement.style.webkitTextFillColor = '';
                titleElement.style.backgroundClip = '';
                titleElement.style.color = 'var(--text-secondary)';
                titleElement.style.fontWeight = '600';
                titleElement.style.textShadow = '';
                titleElement.style.filter = '';
            }
            
            // Reset git branch display
            const gitBranchDisplay = terminalHeader.querySelector('.git-branch-display');
            if (gitBranchDisplay) {
                gitBranchDisplay.style.background = 'rgba(44, 182, 125, 0.1)';
                gitBranchDisplay.style.borderColor = 'rgba(44, 182, 125, 0.3)';
                gitBranchDisplay.style.color = 'var(--secondary)';
            }
            
            // Reset task indicator
            const taskIndicator = terminalHeader.querySelector('.current-task');
            if (taskIndicator) {
                taskIndicator.style.color = 'rgba(255, 255, 255, 0.7)';
            }
        }
        }
        
        // Update tab color if in tabbed mode (directly without re-rendering)
        if (this.layoutMode === 'tabbed') {
            // Apply color directly to the tab without re-rendering everything
            const tab = document.querySelector(`.terminal-tab[data-terminal-id="${quadrant}"]`);
            if (tab) {
                const tabNumber = tab.querySelector('.tab-terminal-number');
                
                if (projectColor) {
                    // Apply gradient directly to the tab button (same as in createTerminalTab)
                    tab.style.background = `linear-gradient(135deg, ${projectColor}40 0%, ${projectColor}15 100%)`;
                    tab.style.borderLeft = `3px solid ${projectColor}`;
                    
                    if (tabNumber) {
                        tabNumber.style.background = `${projectColor}`;
                        tabNumber.style.color = 'white';
                        tabNumber.style.fontWeight = 'bold';
                    }
                } else {
                    // Reset to default styles when no project color
                    tab.style.background = '';
                    tab.style.borderLeft = '';
                    
                    if (tabNumber) {
                        tabNumber.style.background = '';
                        tabNumber.style.color = '';
                        tabNumber.style.fontWeight = '';
                    }
                }
            }
        }
    }

    // Get the project name for a specific terminal
    getTerminalProjectName(quadrant) {
        // Get the directory for this terminal
        const directory = this.lastSelectedDirectories[quadrant];
        if (!directory) return null;
        
        // Extract project name from directory path
        return directory.split('/').pop() || directory.split('\\').pop() || null;
    }

    // Show color picker for terminal header
    showColorPicker(quadrant, event) {
        // Get the project name
        const projectName = this.getTerminalProjectName(quadrant);
        if (!projectName) {
            this.showNotification('No project selected for this terminal', 'warning');
            return;
        }

        // Remove any existing color picker
        const existingPicker = document.querySelector('.color-picker-modal');
        if (existingPicker) {
            existingPicker.remove();
        }

        // Create color picker modal
        const modal = document.createElement('div');
        modal.className = 'color-picker-modal';
        modal.innerHTML = `
            <div class="color-picker-content">
                <div class="color-picker-header">
                    <h3><i data-lucide="palette"></i> Choose Color for "${projectName}"</h3>
                    <button class="close-btn" id="close-color-picker">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                <div class="color-picker-body">
                    <div class="color-options">
                        <div class="color-option" data-color="purple" style="background: linear-gradient(135deg, #7f5af0, #9171f8)">
                            <span class="color-name">Purple</span>
                        </div>
                        <div class="color-option" data-color="cyan" style="background: linear-gradient(135deg, #06b6d4, #22d3ee)">
                            <span class="color-name">Cyan</span>
                        </div>
                        <div class="color-option" data-color="green" style="background: linear-gradient(135deg, #2cb67d, #34d399)">
                            <span class="color-name">Green</span>
                        </div>
                        <div class="color-option" data-color="orange" style="background: linear-gradient(135deg, #ff8906, #fbbf24)">
                            <span class="color-name">Orange</span>
                        </div>
                        <div class="color-option" data-color="pink" style="background: linear-gradient(135deg, #ec4899, #f472b6)">
                            <span class="color-name">Pink</span>
                        </div>
                        <div class="color-option" data-color="blue" style="background: linear-gradient(135deg, #3b82f6, #60a5fa)">
                            <span class="color-name">Blue</span>
                        </div>
                        <div class="color-option" data-color="indigo" style="background: linear-gradient(135deg, #6366f1, #818cf8)">
                            <span class="color-name">Indigo</span>
                        </div>
                        <div class="color-option" data-color="red" style="background: linear-gradient(135deg, #ef4444, #f87171)">
                            <span class="color-name">Red</span>
                        </div>
                        <div class="color-option" data-color="emerald" style="background: linear-gradient(135deg, #059669, #10b981)">
                            <span class="color-name">Emerald</span>
                        </div>
                        <div class="color-option" data-color="yellow" style="background: linear-gradient(135deg, #eab308, #facc15)">
                            <span class="color-name">Yellow</span>
                        </div>
                        <div class="color-option" data-color="violet" style="background: linear-gradient(135deg, #8b5cf6, #a78bfa)">
                            <span class="color-name">Violet</span>
                        </div>
                        <div class="color-option" data-color="rose" style="background: linear-gradient(135deg, #f43f5e, #fb7185)">
                            <span class="color-name">Rose</span>
                        </div>
                    </div>
                    <div class="color-actions">
                        <button class="btn btn-small" id="reset-color">Reset to Auto</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Position the modal near the clicked element
        const rect = event.currentTarget.getBoundingClientRect();
        const modalContent = modal.querySelector('.color-picker-content');
        modalContent.style.position = 'fixed';
        modalContent.style.top = `${rect.bottom + 10}px`;
        modalContent.style.left = `${Math.min(rect.left, window.innerWidth - 350)}px`;

        // Add event listeners
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        };
        
        const closeModal = () => {
            modal.remove();
            document.removeEventListener('keydown', handleEscape);
        };

        // Close button
        modal.querySelector('#close-color-picker').addEventListener('click', closeModal);

        // Color options
        modal.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', () => {
                const colorName = option.dataset.color;
                this.setProjectColor(projectName, colorName);
                closeModal();
            });
        });

        // Reset color button
        modal.querySelector('#reset-color').addEventListener('click', () => {
            this.resetProjectColor(projectName);
            closeModal();
        });

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', handleEscape);

        // Show modal with animation
        setTimeout(() => {
            modal.classList.add('show');
            // Initialize Lucide icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }, 10);
    }

    // Set custom color for a project
    setProjectColor(projectName, colorName) {
        // Find the color palette
        const colorPalettes = [
            { primary: '#7f5af0', light: '#9171f8', dark: '#6d47e8', name: 'purple' },
            { primary: '#06b6d4', light: '#22d3ee', dark: '#0891b2', name: 'cyan' },
            { primary: '#2cb67d', light: '#34d399', dark: '#10b981', name: 'green' },
            { primary: '#ff8906', light: '#fbbf24', dark: '#f59e0b', name: 'orange' },
            { primary: '#ec4899', light: '#f472b6', dark: '#db2777', name: 'pink' },
            { primary: '#3b82f6', light: '#60a5fa', dark: '#2563eb', name: 'blue' },
            { primary: '#6366f1', light: '#818cf8', dark: '#4f46e5', name: 'indigo' },
            { primary: '#ef4444', light: '#f87171', dark: '#dc2626', name: 'red' },
            { primary: '#059669', light: '#10b981', dark: '#047857', name: 'emerald' },
            { primary: '#eab308', light: '#facc15', dark: '#ca8a04', name: 'yellow' },
            { primary: '#8b5cf6', light: '#a78bfa', dark: '#7c3aed', name: 'violet' },
            { primary: '#f43f5e', light: '#fb7185', dark: '#e11d48', name: 'rose' }
        ];

        const palette = colorPalettes.find(p => p.name === colorName);
        if (palette) {
            this.customProjectColors[projectName] = {
                name: palette.name,
                primary: palette.primary,
                light: palette.light,
                dark: palette.dark,
                transparent: `${palette.primary}20`,
                glow: `${palette.primary}40`
            };

            // Update all terminals with this project
            this.updateAllTerminalsWithProject(projectName);
            
        }
    }

    // Reset project color to auto-generated
    resetProjectColor(projectName) {
        delete this.customProjectColors[projectName];
        
        // Update all terminals with this project
        this.updateAllTerminalsWithProject(projectName);
        
    }

    // Update all terminals that belong to the same project
    updateAllTerminalsWithProject(projectName) {
        for (let i = 0; i < 4; i++) {
            // Only update if terminal is actually active (has a terminal running)
            if (this.terminals.has(i)) {
                const terminalProjectName = this.getTerminalProjectName(i);
                if (terminalProjectName === projectName) {
                    this.updateTerminalHeaderColor(i);
                }
            }
        }
    }

    toggleFullscreen(quadrant) {
        const quadrantElement = document.querySelector(`[data-quadrant="${quadrant}"]`);
        
        if (this.fullscreenTerminal === quadrant) {
            this.exitFullscreen();
        } else {
            if (this.fullscreenTerminal !== null) {
                this.exitFullscreen();
            }
            
            quadrantElement.classList.add('fullscreen');
            this.fullscreenTerminal = quadrant;
            
            // Hide arrow buttons for all terminals when in fullscreen
            this.updateArrowButtonsVisibility();
            
            // Force multiple resize attempts with delays to ensure proper sizing
            setTimeout(() => {
                this.forceTerminalResize(quadrant);
            }, 100);
            setTimeout(() => {
                this.forceTerminalResize(quadrant);
            }, 300);
            setTimeout(() => {
                this.forceTerminalResize(quadrant);
            }, 500);
        }
    }

    async updateTerminalHeader(quadrant) {
        const quadrantElement = document.querySelector(`[data-quadrant="${quadrant}"]`);
        if (!quadrantElement) return;
        
        const terminalHeader = quadrantElement.querySelector('.terminal-header');
        if (!terminalHeader) return;
        
        // Check if terminal is active
        const hasActiveTerminal = this.terminals.has(quadrant);
        
        // Check if More Options button already exists
        const existingMoreOptions = terminalHeader.querySelector('.terminal-more-options-container');
        
        if (hasActiveTerminal && !existingMoreOptions) {
            // Terminal is active but button doesn't exist - add it
            const controlsDiv = terminalHeader.querySelector('.terminal-controls');
            if (controlsDiv) {
                // Find the fullscreen button to insert before it
                const fullscreenBtn = controlsDiv.querySelector('[data-action="fullscreen"]');
                
                // Create the More Options container
                const moreOptionsContainer = document.createElement('div');
                moreOptionsContainer.className = 'terminal-more-options-container';
                // Get detected IDEs and build menu HTML
                const ideMenuItems = await this.buildIDEMenuItems(quadrant);
                
                moreOptionsContainer.innerHTML = `
                    <button class="terminal-control-btn terminal-more-btn" data-action="more-options" data-terminal="${quadrant}" title="More Options">⋯</button>
                    <div class="terminal-dropdown-menu" data-terminal="${quadrant}" style="display: none;">
                        <button class="terminal-dropdown-item" data-action="open-terminal-here" data-terminal="${quadrant}">
                            <i data-lucide="terminal"></i>
                            <span>Open Terminal in Project Path</span>
                        </button>
                        <button class="terminal-dropdown-item" data-action="open-folder" data-terminal="${quadrant}">
                            <i data-lucide="folder-open"></i>
                            <span>Open Folder</span>
                        </button>
                        ${ideMenuItems}
                    </div>
                `;
                
                // Insert before the fullscreen button
                if (fullscreenBtn) {
                    controlsDiv.insertBefore(moreOptionsContainer, fullscreenBtn);
                } else {
                    // If no fullscreen button, append to controls
                    controlsDiv.appendChild(moreOptionsContainer);
                }
                
                // Add event listener to the new button
                const moreBtn = moreOptionsContainer.querySelector('.terminal-more-btn');
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();

                    this.toggleDropdownMenu(quadrant);
                });
                
                // Add event listeners to dropdown items
                const dropdownItems = moreOptionsContainer.querySelectorAll('.terminal-dropdown-item');
                dropdownItems.forEach(item => {
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const action = item.dataset.action;
                        
                        if (action === 'open-terminal-here') {
                            this.handleOpenTerminalInPath(quadrant);
                        } else if (action === 'open-folder') {
                            this.handleOpenFolder(quadrant);
                        } else if (action === 'open-in-ide') {
                            const ideKey = item.dataset.ide;
                            this.openInIDE(quadrant, ideKey);
                        }
                        
                        // Close the dropdown
                        const dropdown = moreOptionsContainer.querySelector('.terminal-dropdown-menu');
                        if (dropdown) dropdown.style.display = 'none';
                    });
                });
                
                // Initialize Lucide icons for the new elements
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }

            }
        } else if (!hasActiveTerminal && existingMoreOptions) {
            // Terminal is not active but button exists - remove it
            existingMoreOptions.remove();

        }
    }

    // Build IDE menu items dynamically based on detected IDEs
    async buildIDEMenuItems(terminalId) {
        try {
            // Check for installed IDEs
            const result = await ipcRenderer.invoke('check-installed-ides');
            if (!result.success || result.ides.length === 0) {
                return ''; // No IDEs detected, return empty string
            }
            
            // Add separator if IDEs found
            let html = '<div class="dropdown-separator"></div>';
            
            // Add menu item for each detected IDE
            for (const ide of result.ides) {
                // Use custom icons for specific IDEs
                let iconHtml;
                if (ide.key === 'cursor') {
                    iconHtml = '<img src="../assets/cursor-icon.png" class="ide-icon" alt="Cursor">';
                } else if (ide.key === 'vscode') {
                    iconHtml = '<img src="../assets/vscode-icon.png" class="ide-icon" alt="VSCode">';
                } else if (ide.key === 'intellij') {
                    iconHtml = '<img src="../assets/intellij-icon.png" class="ide-icon" alt="IntelliJ">';
                } else {
                    // Fallback to Lucide icon
                    iconHtml = `<i data-lucide="${ide.icon}"></i>`;
                }
                
                html += `
                    <button class="terminal-dropdown-item" data-action="open-in-ide" data-ide="${ide.key}" data-terminal="${terminalId}">
                        ${iconHtml}
                        <span>Open in ${ide.name}</span>
                    </button>
                `;
            }
            
            return html;
        } catch (error) {
            console.error('Error building IDE menu items:', error);
            return '';
        }
    }

    attachTerminalControlListeners() {
        // Remove existing listeners to avoid duplicates
        document.querySelectorAll('.terminal-control-btn').forEach(btn => {
            btn.replaceWith(btn.cloneNode(true));
        });
        
        // Re-attach control button listeners
        document.querySelectorAll('.terminal-control-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = e.target.dataset.action || e.target.closest('[data-action]')?.dataset.action;
                
                // Get quadrant from data-terminal attribute first, then fallback to parent quadrant
                let quadrant;
                const btnEl = e.target.closest('.terminal-control-btn');
                if (btnEl && btnEl.dataset.terminal) {
                    quadrant = parseInt(btnEl.dataset.terminal);
                } else {
                    const quadrantEl = e.target.closest('.terminal-quadrant');
                    if (quadrantEl) {
                        quadrant = parseInt(quadrantEl.dataset.quadrant);
                    }
                }
                
                if (!quadrant && quadrant !== 0) {
                    console.error('Could not determine quadrant for action:', action);
                    return;
                }

                if (action === 'fullscreen') {
                    this.toggleFullscreen(quadrant);
                } else if (action === 'close') {
                    this.closeTerminal(quadrant);
                } else if (action === 'more-options') {
                    this.toggleDropdownMenu(quadrant);
                }
            });
        });
        
        // Re-attach dropdown item listeners
        document.querySelectorAll('.terminal-dropdown-item').forEach(item => {
            item.replaceWith(item.cloneNode(true));
        });
        
        document.querySelectorAll('.terminal-dropdown-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                const terminal = parseInt(item.dataset.terminal);

                // Close the dropdown
                const dropdown = item.closest('.terminal-dropdown-menu');
                if (dropdown) {
                    dropdown.style.display = 'none';
                }
                
                // Call methods on the class instance
                if (action === 'open-terminal-here') {
                    await this.handleOpenTerminalInPath(terminal);
                } else if (action === 'open-folder') {
                    await this.handleOpenFolder(terminal);
                } else if (action === 'open-in-ide') {
                    const ideKey = item.dataset.ide;
                    await this.openInIDE(terminal, ideKey);
                }
            });
        });
    }

    attachQuickActionListeners() {

        // Remove existing listeners to avoid duplicates
        document.querySelectorAll('.terminal-quick-btn').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.replaceWith(newBtn);
        });
        
        // Re-attach quick action button listeners
        document.querySelectorAll('.terminal-quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const terminalId = parseInt(btn.dataset.terminal);

                if (!this.terminals.has(terminalId)) {

                    return;
                }
                
                const terminal = this.terminals.get(terminalId);
                if (!terminal || !terminal.terminal) {

                    return;
                }
                
                // Write the appropriate command to the terminal
                switch(action) {
                    case 'mcp':
                        // Write /mcp command to terminal
                        terminal.terminal.paste('/mcp');
                        terminal.terminal.focus();
                        break;
                    case 'clear':
                        // Write /clear command to terminal
                        terminal.terminal.paste('/clear');
                        terminal.terminal.focus();
                        break;
                    case 'memory':
                        // Write # for memory context
                        terminal.terminal.paste('#');
                        terminal.terminal.focus();
                        break;
                    default:

                }
            });
        });

    }

    toggleDropdownMenu(quadrant) {

        const dropdown = document.querySelector(`.terminal-dropdown-menu[data-terminal="${quadrant}"]`);

        if (!dropdown) {
            console.error('No dropdown found for terminal:', quadrant);
            return;
        }
        
        // Close all other dropdowns first
        document.querySelectorAll('.terminal-dropdown-menu').forEach(menu => {
            if (menu !== dropdown) {
                menu.style.display = 'none';
            }
        });
        
        // Toggle this dropdown - check both inline style and computed style
        const currentDisplay = window.getComputedStyle(dropdown).display;
        const isCurrentlyHidden = currentDisplay === 'none' || dropdown.style.display === 'none' || dropdown.style.display === '';

        dropdown.style.display = isCurrentlyHidden ? 'block' : 'none';

        // Ensure dropdown has proper z-index
        if (dropdown.style.display === 'block') {
            dropdown.style.zIndex = '99999';
            
            // Close dropdown when clicking outside
            const closeDropdown = (e) => {
                if (!e.target.closest('.terminal-more-options-container')) {
                    dropdown.style.display = 'none';
                    document.removeEventListener('click', closeDropdown);
                }
            };
            setTimeout(() => {
                document.addEventListener('click', closeDropdown);
            }, 0);
        }
    }

    async handleOpenTerminalInPath(quadrant) {
        try {
            const result = await ipcRenderer.invoke('open-terminal-in-path', quadrant);
            if (!result.success) {
                this.showNotification('Failed to open terminal', 'error');
            }
        } catch (error) {
            console.error('Error opening terminal:', error);
            this.showNotification('Failed to open terminal', 'error');
        }
    }

    async handleOpenFolder(quadrant) {
        try {
            const result = await ipcRenderer.invoke('open-folder', quadrant);
            if (!result.success) {
                this.showNotification('Failed to open folder', 'error');
            }
        } catch (error) {
            console.error('Error opening folder:', error);
            this.showNotification('Failed to open folder', 'error');
        }
    }

    async openInIDE(terminalId, ideKey) {
        try {
            const result = await ipcRenderer.invoke('open-in-ide', terminalId, ideKey);
            if (!result.success) {
                this.showNotification(`Failed to open IDE: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error opening IDE:', error);
            this.showNotification('Failed to open IDE', 'error');
        }
    }

    exitFullscreen() {
        if (this.fullscreenTerminal !== null) {
            const quadrantElement = document.querySelector(`[data-quadrant="${this.fullscreenTerminal}"]`);
            const quadrant = this.fullscreenTerminal;
            
            quadrantElement.classList.remove('fullscreen');
            
            // Force multiple resize attempts with delays to ensure proper sizing when exiting fullscreen
            setTimeout(() => {
                this.forceTerminalResize(quadrant);
                // Reparar controles automáticamente después de salir del fullscreen
                this.repairTerminalControls();
            }, 100);
            setTimeout(() => {
                this.forceTerminalResize(quadrant);
            }, 300);
            setTimeout(() => {
                this.forceTerminalResize(quadrant);
            }, 500);
            
            this.fullscreenTerminal = null;
            
            // Show arrow buttons again when exiting fullscreen
            this.updateArrowButtonsVisibility();
        }
    }

    updateArrowButtonsVisibility() {
        // Update visibility of arrow buttons based on fullscreen state
        const allReorderControls = document.querySelectorAll('.terminal-reorder-controls');
        allReorderControls.forEach(controls => {
            if (this.fullscreenTerminal !== null) {
                controls.style.display = 'none';
            } else {
                controls.style.display = '';
            }
        });
    }

    async closeTerminal(quadrant) {
        // Check if Claude Code is running in this terminal
        const isClaudeActive = this.claudeCodeReady && this.claudeCodeReady[quadrant];
        const terminal = this.terminals.get(quadrant);
        
        // Show confirmation only if Claude is active
        if (isClaudeActive) {
            const confirmed = await this.showCloseTerminalConfirmation(quadrant, isClaudeActive);
            if (!confirmed) {
                return; // User cancelled
            }
        }

        // Clean up Claude Code state
        if (this.claudeCodeReady) {
            this.claudeCodeReady[quadrant] = false;
        }
        
        // Clean up localStorage for this terminal (convert quadrant 0-based to terminal_id 1-based)
        const terminalId = quadrant + 1;
        localStorage.removeItem(`terminal_title_${terminalId}`);
        localStorage.removeItem(`terminal_task_${terminalId}`);

        // Just send kill signal - the terminal-closed event handler will do the cleanup

        ipcRenderer.send('kill-terminal', quadrant, true);
        
        // The UI cleanup will be handled by the terminal-closed event listener

    }

    async showCloseTerminalConfirmation(quadrant, isClaudeActive) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>⚠️ Close Terminal</h3>
                    <p>
                        ${isClaudeActive 
                            ? `Terminal ${quadrant + 1} has an active Claude Code session running.` 
                            : `Terminal ${quadrant + 1} may have active processes.`}
                    </p>
                    <p>Are you sure you want to close this terminal? This will terminate all running processes.</p>
                    <div class="modal-buttons">
                        <button id="confirm-close" class="btn btn-danger">Yes, Close Terminal</button>
                        <button id="cancel-close" class="btn">Cancel</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Handle confirm
            modal.querySelector('#confirm-close').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(true);
            });
            
            // Handle cancel
            modal.querySelector('#cancel-close').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(false);
            });
            
            // Close on overlay click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    document.body.removeChild(modal);
                    resolve(false);
                }
            });
            
            // Close on Escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', handleEscape);
                    if (document.body.contains(modal)) {
                        document.body.removeChild(modal);
                        resolve(false);
                    }
                }
            };
            document.addEventListener('keydown', handleEscape);
        });
    }

    resizeTerminal(quadrant) {
        const terminal = this.terminals.get(quadrant);
        if (terminal && terminal.fitAddon) {
            try {
                // First, fit the terminal to its container
                terminal.fitAddon.fit();
                
                // Then notify the backend about the resize so Claude Code can adjust
                const cols = terminal.terminal.cols;
                const rows = terminal.terminal.rows;

                // Debounce resize signals to avoid spam
                if (terminal.resizeTimeout) {
                    clearTimeout(terminal.resizeTimeout);
                }
                
                terminal.resizeTimeout = setTimeout(() => {
                    // Send resize signal to the PTY (only once after resize stops)
                    ipcRenderer.send('terminal-resize', quadrant, cols, rows);
                    terminal.resizeTimeout = null;
                }, 300); // Wait 300ms after resize stops
                
            } catch (error) {
                console.error(`Error resizing terminal ${quadrant}:`, error);
                // Retry once after a delay
                setTimeout(() => {
                    try {
                        terminal.fitAddon.fit();
                    } catch (retryError) {
                        console.error(`Retry failed for terminal ${quadrant}:`, retryError);
                    }
                }, 100);
            }
        }
    }

    forceTerminalResize(quadrant) {
        const terminal = this.terminals.get(quadrant);
        if (terminal && terminal.fitAddon && terminal.terminal) {
            try {
                // Force refresh of terminal viewport
                const terminalElement = terminal.element;
                if (terminalElement) {
                    // Temporarily hide and show to force recalculation
                    const originalDisplay = terminalElement.style.display;
                    terminalElement.style.display = 'none';
                    terminalElement.offsetHeight; // Force reflow
                    terminalElement.style.display = originalDisplay;
                }
                
                // Clear any existing viewport styles that might be causing issues
                const viewport = terminal.element.querySelector('.xterm-viewport');
                if (viewport) {
                    viewport.style.width = '';
                    viewport.style.height = '';
                }
                
                // Force fit multiple times
                terminal.fitAddon.fit();
                
                // Force terminal to refresh its buffer and scrolling
                terminal.terminal.refresh(0, terminal.terminal.rows - 1);
                
                // Ensure scroll position is maintained
                setTimeout(() => {
                    terminal.terminal.scrollToBottom();
                }, 50);
                
                // Send resize signal to PTY
                const cols = terminal.terminal.cols;
                const rows = terminal.terminal.rows;
                ipcRenderer.send('terminal-resize', quadrant, cols, rows);

                // Re-check scroll button visibility after resize
                const terminalDiv = terminal.element;
                const scrollBtn = terminalDiv.querySelector('.scroll-to-bottom-btn');
                
                if (scrollBtn && viewport) {
                    // Re-check scroll position after resize operations complete
                    setTimeout(() => {
                        const isAtBottom = (viewport.scrollTop + viewport.clientHeight) >= (viewport.scrollHeight - 5);
                        const hasContent = viewport.scrollHeight > viewport.clientHeight;
                        
                        if (!isAtBottom && hasContent) {
                            scrollBtn.classList.add('show');
                        } else {
                            scrollBtn.classList.remove('show');
                        }
                    }, 100);
                }
                
            } catch (error) {
                console.error(`Error force resizing terminal ${quadrant}:`, error);
                // Fallback to regular resize
                this.resizeTerminal(quadrant);
            }
        }
    }

    resizeAllTerminals() {
        this.terminals.forEach((terminal, quadrant) => {
            setTimeout(() => {
                terminal.fitAddon.fit();
            }, 100);
        });
    }

    createNewTerminal() {
        // Find first empty quadrant
        for (let i = 0; i < 4; i++) {
            if (!this.terminals.has(i)) {
                this.startTerminal(i);
                break;
            }
        }
    }

    repairTerminalControls() {
        // Función para reparar terminales que hayan perdido sus controles
        for (let quadrant = 0; quadrant < 4; quadrant++) {
            const quadrantElement = document.querySelector(`[data-quadrant="${quadrant}"]`);
            if (!quadrantElement) continue;

            const terminalHeader = quadrantElement.querySelector('.terminal-header');
            if (!terminalHeader) continue;

            // Verificar si ya existen los controles
            let controls = terminalHeader.querySelector('.terminal-controls');
            
            if (!controls) {
                // Crear los controles faltantes
                controls = document.createElement('div');
                controls.className = 'terminal-controls';
                controls.innerHTML = `
                    <button class="terminal-control-btn" data-action="fullscreen" title="Fullscreen">⛶</button>
                    <button class="terminal-control-btn" data-action="close" title="Close">×</button>
                `;
                
                terminalHeader.appendChild(controls);
                
                // Agregar event listeners
                controls.querySelectorAll('.terminal-control-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const action = e.target.dataset.action;
                        const quadrant = parseInt(e.target.closest('.terminal-quadrant').dataset.quadrant);
                        
                        if (action === 'fullscreen') {
                            this.toggleFullscreen(quadrant);
                        } else if (action === 'close') {
                            this.closeTerminal(quadrant);
                        }
                    });
                });
            }
            
            // También verificar y agregar botón de scroll si falta
            const terminalDiv = quadrantElement.querySelector('.terminal');
            const scrollBtn = terminalDiv?.querySelector('.scroll-to-bottom-btn');
            
            if (terminalDiv && !scrollBtn) {
                // Si no existe el botón, añadirlo
                const terminal = this.terminals.get(quadrant);
                if (terminal && terminal.terminal) {
                    this.addScrollToBottomButton(terminalDiv, terminal.terminal, quadrant);
                }
            } else if (scrollBtn) {
                // Si existe el botón, verificar su visibilidad
                const viewport = terminalDiv.querySelector('.xterm-viewport');
                if (viewport) {
                    const isAtBottom = (viewport.scrollTop + viewport.clientHeight) >= (viewport.scrollHeight - 5);
                    const hasContent = viewport.scrollHeight > viewport.clientHeight;
                    
                    if (!isAtBottom && hasContent) {
                        scrollBtn.classList.add('show');
                    } else {
                        scrollBtn.classList.remove('show');
                    }
                }
            }
        }
    }

    addScrollToBottomButton(terminalDiv, terminal, quadrant) {
        // Check if button already exists
        let scrollBtn = terminalDiv.querySelector('.scroll-to-bottom-btn');
        if (scrollBtn) {

            return; // Button already exists, don't create duplicate
        }
        
        // Create scroll to bottom button
        scrollBtn = document.createElement('button');
        scrollBtn.className = 'scroll-to-bottom-btn';
        scrollBtn.title = 'Scroll to bottom';
        scrollBtn.innerHTML = '⬇';
        
        // Add button to terminal div
        terminalDiv.style.position = 'relative';
        terminalDiv.appendChild(scrollBtn);
        
        // Function to scroll to bottom
        const scrollToBottom = () => {
            const viewport = terminalDiv.querySelector('.xterm-viewport');
            if (viewport) {
                viewport.scrollTop = viewport.scrollHeight;
            }
            // Alternative method using terminal API
            terminal.scrollToBottom();
        };
        
        // Store scrollToBottom function for external use
        terminal.scrollToBottomFn = scrollToBottom;
        
        // Button click handler
        scrollBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            scrollToBottom();
            // Clear user scrolling flag when button is clicked
            this.userScrolling.set(quadrant, false);

        });
        
        // Show/hide button based on scroll position
        const viewport = terminalDiv.querySelector('.xterm-viewport');
        if (viewport) {
            let scrollTimeout;
            
            const checkScrollPosition = () => {
                const isAtBottom = (viewport.scrollTop + viewport.clientHeight) >= (viewport.scrollHeight - 5);
                const hasContent = viewport.scrollHeight > viewport.clientHeight;
                
                if (!isAtBottom && hasContent) {
                    scrollBtn.classList.add('show');
                    // User has scrolled up - mark as user scrolling
                    this.userScrolling.set(quadrant, true);
                    
                    // Clear any existing timeout for this terminal
                    if (this.scrollTimeouts.has(quadrant)) {
                        clearTimeout(this.scrollTimeouts.get(quadrant));
                    }
                    
                    // Don't auto-reset the user scrolling flag with a timeout
                    // Instead, only reset when user scrolls back to bottom or clicks the scroll button
                    // This prevents the annoying auto-scroll behavior

                } else {
                    scrollBtn.classList.remove('show');
                    // User has scrolled back to bottom - clear the user scrolling flag
                    if (this.userScrolling.get(quadrant)) {
                        this.userScrolling.set(quadrant, false);

                    }
                    
                    // Clear timeout if exists
                    if (this.scrollTimeouts.has(quadrant)) {
                        clearTimeout(this.scrollTimeouts.get(quadrant));
                        this.scrollTimeouts.delete(quadrant);
                    }
                }
            };
            
            // Track if scroll is from user interaction
            let isUserScroll = false;
            
            // Detect user scroll interactions
            viewport.addEventListener('wheel', () => {
                isUserScroll = true;
                setTimeout(() => { isUserScroll = false; }, 200);
            });
            
            viewport.addEventListener('touchstart', () => {
                isUserScroll = true;
            });
            
            viewport.addEventListener('touchend', () => {
                setTimeout(() => { isUserScroll = false; }, 200);
            });
            
            // Detect keyboard scrolling (arrows, page up/down)
            terminalDiv.addEventListener('keydown', (e) => {
                const scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
                if (scrollKeys.includes(e.key)) {
                    isUserScroll = true;
                    setTimeout(() => { isUserScroll = false; }, 200);
                }
            });
            
            // Check scroll position on scroll events
            viewport.addEventListener('scroll', () => {
                // Only mark as user scrolling if it was triggered by user interaction
                if (isUserScroll) {
                    const isAtBottom = (viewport.scrollTop + viewport.clientHeight) >= (viewport.scrollHeight - 5);
                    if (!isAtBottom) {
                        this.userScrolling.set(quadrant, true);

                        // Clear and reset timeout
                        if (this.scrollTimeouts.has(quadrant)) {
                            clearTimeout(this.scrollTimeouts.get(quadrant));
                        }
                        
                        const timeoutId = setTimeout(() => {
                            // Don't clear if Claude is still outputting
                            if (!this.claudeOutputting.get(quadrant)) {
                                this.userScrolling.set(quadrant, false);
                                this.scrollTimeouts.delete(quadrant);

                            } else {
                                // Claude is still outputting, extend the timeout

                                const newTimeoutId = setTimeout(() => {
                                    this.userScrolling.set(quadrant, false);
                                    this.scrollTimeouts.delete(quadrant);
                                }, 30000);
                                this.scrollTimeouts.set(quadrant, newTimeoutId);
                            }
                        }, 30000);
                        
                        this.scrollTimeouts.set(quadrant, timeoutId);
                    }
                }
                
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(checkScrollPosition, 100);
            });
            
            // Check when new content is added
            const observer = new MutationObserver(() => {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(checkScrollPosition, 100);
            });
            
            observer.observe(viewport, {
                childList: true,
                subtree: true
            });
            
            // Multiple initial checks to ensure proper detection
            checkScrollPosition(); // Immediate check
            setTimeout(checkScrollPosition, 100);   // 100ms
            setTimeout(checkScrollPosition, 500);   // 500ms
            setTimeout(checkScrollPosition, 1000);  // 1 second
            setTimeout(checkScrollPosition, 2000);  // 2 seconds
            
            // Also check on terminal data events
            terminal.onData(() => {
                setTimeout(checkScrollPosition, 50);
            });
        }
    }

    async checkClaudeCode() {
        const isAvailable = await ipcRenderer.invoke('check-claude-code');
        
        if (isAvailable) {
        } else {
            this.showNotification('❌ Claude Code not found. Install from claude.ai/code', 'warning');
        }
    }

    async showGitStatus() {
        // Blur the git status button to prevent Enter key from reopening it
        const gitStatusBtn = document.getElementById('git-status-btn');
        if (gitStatusBtn) {
            gitStatusBtn.blur();
        }
        
        try {
            // First scan for projects with changes
            const scanResult = await ipcRenderer.invoke('scan-git-projects');
            
            if (scanResult.success && scanResult.projects.length > 0) {
                // Show project selection modal
                this.displayProjectSelectionModal(scanResult.projects);
            } else if (scanResult.success && scanResult.projects.length === 0) {
                if (!this.hasActiveTerminals()) {
                    this.showNotification('No active terminals. Open a terminal first to scan for git projects.', 'info');
                } else {
                    this.showNotification('No git projects found in active terminals', 'info');
                }
            } else {
                // Fallback to current directory
                const result = await ipcRenderer.invoke('get-git-status');
                
                if (result.success) {
                    this.displayGitStatusModal(result);
                } else {
                    this.showNotification(result.error || 'Failed to get git status', 'warning');
                }
            }
        } catch (error) {
            console.error('Error getting git status:', error);
            this.showNotification('Error getting git status', 'error');
        }
    }

    hasActiveTerminals() {
        return this.terminals.size > 0;
    }
    
    showKanban() {
        // Request main process to open Kanban window
        ipcRenderer.send('open-kanban-window');
        
        // Blur the kanban button to prevent Enter key from reopening it
        const kanbanBtn = document.getElementById('kanban-btn');
        if (kanbanBtn) {
            kanbanBtn.blur();
        }
        
        // Return focus to active terminal if one exists
        if (this.activeTerminal !== null) {
            const terminal = this.terminals.get(this.activeTerminal);
            if (terminal && terminal.terminal) {
                terminal.terminal.focus();
            }
        }
    }

    showCreateTaskDialog() {
        // Blur the create task button to prevent Enter key from reopening it
        const createTaskBtn = document.getElementById('create-task-btn');
        if (createTaskBtn) {
            createTaskBtn.blur();
        }
        
        // Check if TaskModal is available or load it
        const loadAndShowModal = () => {

            // Check if TaskModal class exists
            if (typeof window.TaskModal !== 'undefined') {

                const modal = new window.TaskModal({
                    terminals: this.terminals,
                    activeTerminalId: this.activeTerminal,
                    onSave: (taskData) => {
                        // Send task creation request
                        ipcRenderer.send('create-task', {
                            title: taskData.title,
                            description: taskData.description || undefined,
                            plan: taskData.plan || undefined,
                            implementation: taskData.implementation || undefined,
                            project: taskData.project || undefined,
                            terminal_id: taskData.terminal_id ? parseInt(taskData.terminal_id) : undefined,
                            parent_task_id: taskData.parent_task_id ? parseInt(taskData.parent_task_id) : undefined,
                            status: taskData.status || 'pending'
                        });
                    },
                    onCancel: () => {
                        // Modal closed
                    }
                });
                
                modal.show();
            } else {

                this.createSimpleTaskModal(); // Fallback to simple modal
            }
        };
        
        loadAndShowModal();
    }

    createSimpleTaskModal() {
        // Fallback to simple modal if TaskModal component fails to load
        const activeTerminalId = this.activeTerminal;
        
        // Remove existing modal if present
        const existingModal = document.querySelector('.create-task-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'create-task-modal';
        modal.innerHTML = `
            <div class="create-task-content">
                <div class="create-task-header">
                    <h3><i data-lucide="plus-square"></i> Create New Task</h3>
                    <button class="close-btn" id="close-create-task-modal">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                <div class="create-task-body">
                    <form id="create-task-form">
                        <div class="form-group">
                            <label for="task-title">Title *</label>
                            <input type="text" id="task-title" required placeholder="Enter task title">
                        </div>
                        <div class="form-group">
                            <label for="task-description">Description</label>
                            <textarea id="task-description" rows="4" placeholder="Enter task description (optional)"></textarea>
                        </div>
                        <div class="form-group">
                            <label for="task-project">Project</label>
                            <select id="task-project">
                                <option value="">No Project</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="task-terminal">Terminal</label>
                            <select id="task-terminal">
                                <option value="">Terminal no seleccionado</option>
                                ${Array.from(this.terminals.entries()).map(([quadrant, term]) => {
                                    const num = quadrant + 1;
                                    const isActive = activeTerminalId === quadrant;
                                    return `<option value="${num}" ${isActive ? 'selected' : ''}>Terminal ${num}${isActive ? ' (current)' : ''}</option>`;
                                }).join('')}
                            </select>
                        </div>
                    </form>
                </div>
                <div class="create-task-footer">
                    <button type="button" class="btn btn-secondary" id="cancel-create-task">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="confirm-create-task">Create Task</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Add show class for animation
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);
        
        // Initialize Lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }
        
        // Load projects for the dropdown
        this.loadProjectsForModal();
        
        // Focus on title input
        const titleInput = document.getElementById('task-title');
        titleInput.focus();
        
        // Event listeners
        const closeModal = () => {
            modal.classList.remove('show');
            setTimeout(() => modal.remove(), 200);
        };
        
        document.getElementById('close-create-task-modal').addEventListener('click', closeModal);
        document.getElementById('cancel-create-task').addEventListener('click', closeModal);
        
        const self = this;
        document.getElementById('confirm-create-task').addEventListener('click', async () => {
            const title = document.getElementById('task-title').value.trim();
            const description = document.getElementById('task-description').value.trim();
            const project = document.getElementById('task-project').value;
            const terminalId = document.getElementById('task-terminal').value;
            
            if (!title) {
                self.showNotification('Please enter a task title', 'warning');
                document.getElementById('task-title').focus();
                return;
            }
            
            // Send task creation request
            ipcRenderer.send('create-task', {
                title,
                description: description || undefined,
                project: project || undefined,
                terminal_id: terminalId ? parseInt(terminalId) : undefined
            });
            
            closeModal();
        });
        
        // Handle Escape key
        const handleEscKey = (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        };
        document.addEventListener('keydown', handleEscKey);
    }

    displayProjectSelectionModal(projects) {
        // Remove existing modal if present
        const existingModal = document.querySelector('.git-project-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'modal git-project-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2><i data-lucide="git-branch"></i> Git Projects</h2>
                    <button class="close-modal" id="close-project-modal">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                
                <div class="modal-body">
                    <div class="git-project-list">
                        <div class="project-list-header">
                            <span>${this.hasActiveTerminals() ? 'Projects from active terminals:' : 'Git projects with changes:'}</span>
                            <button class="btn btn-small" id="refresh-projects">
                                <i data-lucide="refresh-cw"></i> Refresh
                            </button>
                        </div>
                        ${projects.map(project => `
                            <div class="git-project-item" data-path="${project.path}">
                                <div class="project-info">
                                    <div class="project-name">
                                        <i data-lucide="folder-git-2"></i>
                                        <span class="name">${project.name}</span>
                                        ${project.hasNoCommits ? '<span class="badge-new">NEW</span>' : ''}
                                    </div>
                                    <div class="project-details">
                                        ${project.hasNoCommits ? `
                                            <span class="project-no-commits">
                                                <i data-lucide="alert-circle"></i> No commits yet - ${project.changeCount} untracked files
                                            </span>
                                        ` : `
                                            <span class="project-branch">
                                                <i data-lucide="git-branch"></i> ${project.branch}
                                            </span>
                                            <span class="project-changes ${project.changeCount === 0 ? 'no-changes' : ''}">
                                                <i data-lucide="file-diff"></i> ${project.changeCount} ${project.changeCount === 1 ? 'change' : 'changes'}
                                            </span>
                                            ${project.unpushedCount > 0 ? `
                                                <span class="project-unpushed">
                                                    <i data-lucide="upload"></i> ${project.unpushedCount} unpushed
                                                </span>
                                            ` : ''}
                                        `}
                                    </div>
                                </div>
                                <button class="btn btn-primary btn-small open-project">
                                    <i data-lucide="arrow-right"></i> Open
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="use-current-dir">
                        <i data-lucide="folder"></i> Use Current Directory
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        document.body.classList.add('modal-open');
        
        // Add active class for animation
        setTimeout(() => {
            modal.classList.add('active');
        }, 10);

        // Initialize Lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }

        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeProjectModal();
            }
        });

        // Add event listeners
        const closeProjectModal = () => {
            document.body.classList.remove('modal-open');
            modal.remove();
            document.removeEventListener('keydown', handleProjectEscKey);
        };

        // Handle Escape key
        const handleProjectEscKey = (e) => {
            if (e.key === 'Escape') {
                closeProjectModal();
            }
        };
        document.addEventListener('keydown', handleProjectEscKey);

        document.getElementById('close-project-modal').addEventListener('click', closeProjectModal);

        document.getElementById('refresh-projects').addEventListener('click', async () => {
            closeProjectModal();
            await this.showGitStatus();
        });

        document.getElementById('use-current-dir').addEventListener('click', async () => {
            closeProjectModal();
            const result = await ipcRenderer.invoke('get-git-status');
            if (result.success) {
                this.displayGitStatusModal(result);
            } else {
                this.showNotification(result.error || 'Failed to get git status', 'warning');
            }
        });

        // Add click listeners to project items
        modal.querySelectorAll('.git-project-item').forEach(item => {
            const openBtn = item.querySelector('.open-project');
            openBtn.addEventListener('click', async () => {
                const projectPath = item.dataset.path;
                closeProjectModal();
                
                // Get git status for selected project
                const result = await ipcRenderer.invoke('get-project-git-status', projectPath);
                if (result.success) {
                    this.displayGitStatusModal(result);
                } else {
                    this.showNotification(result.error || 'Failed to get project status', 'warning');
                }
            });
        });
    }

    displayGitStatusModal(gitData) {
        // Debug log

        const directories = gitData.files?.filter(f => f.isDirectory) || [];

        // Remove existing modal if present
        const existingModal = document.querySelector('.git-status-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'git-status-modal';
        modal.innerHTML = `
            <div class="git-status-content">
                <div class="git-status-header">
                    <h3><i data-lucide="git-branch"></i> Git Manager${gitData.projectName ? ` - ${gitData.projectName}` : ''}</h3>
                    <button class="close-btn" id="close-git-modal">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                
                <div class="git-info">
                    <div class="git-branch">
                        <i data-lucide="git-branch"></i>
                        <span class="git-label">Branch:</span>
                        <span class="git-value">${gitData.branch || 'unknown'}</span>
                    </div>
                    <div class="git-directory">
                        <i data-lucide="folder"></i>
                        <span class="git-label">Directory:</span>
                        <span class="git-value git-path">${gitData.workingDirectory}</span>
                    </div>
                </div>

                <div class="git-tabs">
                    <div class="tab-buttons">
                        <button class="tab-btn active" data-tab="changes"><i data-lucide="file-diff"></i> Changes</button>
                        <button class="tab-btn" data-tab="commits"><i data-lucide="history"></i> Commits</button>
                        <div class="tab-actions">
                            <button class="btn btn-small" id="git-pull" title="Pull - Descargar cambios del repositorio remoto">
                                <i data-lucide="download"></i>
                            </button>
                            <div class="push-button-wrapper">
                                ${gitData.unpushedCount > 0 ? `<div class="push-reminder">Pending push!</div>` : ''}
                                <button class="btn btn-small btn-primary ${gitData.unpushedCount > 0 ? 'btn-pulse' : ''}" id="git-push" title="Push - Upload changes to remote repository${gitData.unpushedCount > 0 ? ` (${gitData.unpushedCount} commits pending)` : ''}">
                                    <i data-lucide="upload"></i>
                                    ${gitData.unpushedCount > 0 ? `<span class="badge">${gitData.unpushedCount}</span>` : ''}
                                </button>
                            </div>
                            <button class="btn btn-small" id="refresh-git-status" title="Refresh - Actualizar el estado del repositorio">
                                <i data-lucide="refresh-cw"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="tab-content">
                        <!-- Changes Tab -->
                        <div class="tab-panel active" id="changes-tab">
                            <div class="git-files-section">
                                <div class="files-header">
                                    <h4>Changed Files (${gitData.files.length})</h4>
                                    ${gitData.files.length > 0 ? `
                                        <div class="file-selection-controls">
                                            <button class="btn-small" id="select-all-files">Select All</button>
                                            <button class="btn-small" id="deselect-all-files">Deselect All</button>
                                            <button class="btn-small btn-danger" id="discard-all-changes"><i data-lucide="trash-2"></i> Discard All Changes</button>
                                        </div>
                                    ` : ''}
                                </div>
                                <div class="git-files-list">
                                    ${gitData.files.length === 0 ? 
                                        '<div class="no-changes">No changes detected</div>' : 
                                        gitData.files.map(file => `
                                            <div class="git-file-item" data-file="${file.file}">
                                                <div class="file-info">
                                                    <input type="checkbox" class="file-checkbox" checked data-file="${file.file}">
                                                    <span class="file-status file-status-${file.status.toLowerCase()}">${file.status}${file.isDirectory ? ' (Directory)' : ''}</span>
                                                    <span class="file-name">${file.isDirectory ? '<i data-lucide="folder"></i> ' : ''}${file.file}</span>
                                                </div>
                                                <div class="file-actions">
                                                    ${!file.isDirectory ? `<button class="btn-small" onclick="terminalManager.showFileDiff('${file.file}', '${gitData.workingDirectory}')"><i data-lucide="eye"></i> Diff</button>` : ''}
                                                    <button class="btn-small btn-danger" onclick="terminalManager.discardFileChanges('${file.file}', '${file.status}', '${gitData.workingDirectory}')"><i data-lucide="x"></i> Discard</button>
                                                </div>
                                            </div>
                                        `).join('')
                                    }
                                </div>
                                ${gitData.files.length > 0 ? `
                                    <div class="commit-section">
                                        <div class="commit-message-wrapper">
                                            <textarea id="commit-message" placeholder="Enter commit message..." rows="3"></textarea>
                                            <button class="btn-ai-generate" id="generate-ai-commit" title="Generate commit message with AI">
                                                <i data-lucide="sparkles"></i>
                                            </button>
                                        </div>
                                        <div class="commit-buttons">
                                            <button class="btn btn-primary" id="commit-selected"><i data-lucide="check-square"></i> Commit Selected</button>
                                            <button class="btn" id="commit-all"><i data-lucide="check-square"></i> Commit All</button>
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                        
                        <!-- Commits Tab -->
                        <div class="tab-panel" id="commits-tab">
                            <div class="commits-list">
                                ${gitData.commits ? gitData.commits.map(commit => `
                                    <div class="commit-item">
                                        <div class="commit-hash">${commit.hash}</div>
                                        <div class="commit-message">${commit.message}</div>
                                        <div class="commit-actions">
                                            <button class="btn-small" onclick="terminalManager.resetToCommit('${commit.hash}', false)"><i data-lucide="rotate-ccw"></i> Soft Reset</button>
                                            <button class="btn-small btn-danger" onclick="terminalManager.resetToCommit('${commit.hash}', true)"><i data-lucide="alert-triangle"></i> Hard Reset</button>
                                        </div>
                                    </div>
                                `).join('') : '<div class="no-commits">No commits found</div>'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        
        // Add show class for animation
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);

        // Add event listeners
        const closeModal = () => {
            modal.classList.remove('show');
            setTimeout(() => modal.remove(), 200);
            document.removeEventListener('keydown', handleEscKey);
        };

        // Handle Escape key
        const handleEscKey = (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        };
        document.addEventListener('keydown', handleEscKey);

        // Tab switching
        modal.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                
                // Update tab buttons
                modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                // Update tab content
                modal.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                modal.querySelector(`#${tabName}-tab`).classList.add('active');
            });
        });

        // Git action handlers
        modal.querySelector('#close-git-modal').addEventListener('click', closeModal);
        modal.querySelector('#refresh-git-status').addEventListener('click', () => {
            closeModal();
            this.showGitStatus();
        });
        
        modal.querySelector('#git-pull')?.addEventListener('click', () => this.gitPullProject());
        modal.querySelector('#git-push')?.addEventListener('click', () => this.gitPushProject());
        
        // Store project path for git operations
        this.currentGitProject = gitData.workingDirectory;
        
        // AI Commit generator
        modal.querySelector('#generate-ai-commit')?.addEventListener('click', async () => {
            const button = modal.querySelector('#generate-ai-commit');
            const messageTextarea = modal.querySelector('#commit-message');
            
            // Show loading state with informative message
            button.disabled = true;
            const originalButtonContent = button.innerHTML;
            button.innerHTML = '<i data-lucide="loader-2" class="spinning"></i> <span style="font-size: 11px;">AI analyzing (5-30s)...</span>';
            lucide.createIcons();
            
            // Also add a more detailed status message
            const statusDiv = document.createElement('div');
            statusDiv.className = 'ai-status-message';
            statusDiv.style.cssText = 'margin-top: 8px; padding: 8px; background: rgba(123, 97, 255, 0.1); border-radius: 4px; font-size: 12px; color: #7b61ff; display: flex; align-items: center; gap: 8px;';
            statusDiv.innerHTML = '<i data-lucide="brain" style="width: 14px; height: 14px;"></i> Claude is analyzing your changes to generate a semantic commit message...';
            button.parentElement.appendChild(statusDiv);
            lucide.createIcons();
            
            try {
                // Always use detailed style
                const result = await ipcRenderer.invoke('generate-ai-commit-message', this.currentGitProject, 'detailed');
                
                if (result.success) {
                    messageTextarea.value = result.message;
                    messageTextarea.focus();
                    // Flash the textarea to show it was updated
                    messageTextarea.style.animation = 'flash 0.5s';
                    setTimeout(() => {
                        messageTextarea.style.animation = '';
                    }, 500);
                    
                    // Show success briefly
                    statusDiv.style.background = 'rgba(34, 197, 94, 0.1)';
                    statusDiv.style.color = '#22c55e';
                    statusDiv.innerHTML = '<i data-lucide="check-circle" style="width: 14px; height: 14px;"></i> Commit message generated successfully!';
                    lucide.createIcons();
                    
                    // Remove status after a delay
                    setTimeout(() => {
                        statusDiv.remove();
                    }, 2000);
                } else {
                    this.showNotification(`Failed to generate commit message: ${result.error}`, 'error');
                    statusDiv.remove();
                }
            } catch (error) {
                console.error('Error calling AI service:', error);
                this.showNotification('Failed to connect to AI service', 'error');
                statusDiv.remove();
            } finally {
                // Restore button
                button.disabled = false;
                button.innerHTML = originalButtonContent;
                lucide.createIcons();
            }
        });

        // Commit handlers
        modal.querySelector('#commit-selected')?.addEventListener('click', () => {
            const message = modal.querySelector('#commit-message').value;
            const selectedFiles = Array.from(modal.querySelectorAll('.file-checkbox:checked')).map(cb => cb.dataset.file);
            this.gitCommitProject(message, selectedFiles);
        });
        
        modal.querySelector('#commit-all')?.addEventListener('click', () => {
            const message = modal.querySelector('#commit-message').value;
            this.gitCommitProject(message);
        });
        
        // Select/Deselect all handlers
        modal.querySelector('#select-all-files')?.addEventListener('click', () => {
            const checkboxes = modal.querySelectorAll('.file-checkbox');
            checkboxes.forEach(cb => cb.checked = true);
        });
        
        modal.querySelector('#deselect-all-files')?.addEventListener('click', () => {
            const checkboxes = modal.querySelectorAll('.file-checkbox');
            checkboxes.forEach(cb => cb.checked = false);
        });
        
        // Discard all changes handler
        modal.querySelector('#discard-all-changes')?.addEventListener('click', () => {
            this.discardAllChanges();
        });

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Show modal with animation
        setTimeout(() => {
            modal.classList.add('show');
            // Initialize Lucide icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }, 10);
    }
    
    async gitCommit(message, files = null) {
        if (!message || message.trim() === '') {
            this.showInlineNotification('Please enter a commit message', 'error');
            return;
        }
        
        try {
            const result = await ipcRenderer.invoke('git-commit', message.trim(), files);
            
            if (result.success) {
                this.showInlineNotification('✅ Commit successful', 'success');
                // Refresh the git status
                setTimeout(() => this.showGitStatus(), 1000);
            } else {
                this.showInlineNotification(`❌ Commit failed: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error committing:', error);
            this.showInlineNotification('❌ Error committing changes', 'error');
        }
    }
    
    async gitCommitProject(message, files = null) {
        if (!message || message.trim() === '') {
            this.showInlineNotification('Please enter a commit message', 'error');
            return;
        }
        
        try {
            const projectPath = this.currentGitProject;
            const result = await ipcRenderer.invoke('git-commit-project', projectPath, message.trim(), files);
            
            if (result.success) {
                this.showInlineNotification('✅ Commit successful', 'success');
                // Refresh the git status for the project
                setTimeout(async () => {
                    const gitResult = await ipcRenderer.invoke('get-project-git-status', projectPath);
                    if (gitResult.success) {
                        this.displayGitStatusModal(gitResult);
                    }
                }, 1000);
            } else {
                this.showInlineNotification(`❌ Commit failed: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error committing project:', error);
            this.showInlineNotification('❌ Error committing changes', 'error');
        }
    }
    
    async gitPush() {
        try {
            this.showInlineNotification('🚀 Pushing changes...', 'info');
            const result = await ipcRenderer.invoke('git-push');
            
            if (result.success) {
                this.showInlineNotification('✅ Push successful', 'success');
                // Update push button immediately
                this.updatePushButton();
                // Refresh the git status to update the push button
                setTimeout(() => this.showGitStatus(), 1000);
            } else {
                this.showInlineNotification(`❌ Push failed: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error pushing:', error);
            this.showInlineNotification('❌ Error pushing changes', 'error');
        }
    }
    
    async gitPull() {
        try {
            this.showInlineNotification('⬇️ Pulling changes...', 'info');
            const result = await ipcRenderer.invoke('git-pull');
            
            if (result.success) {
                this.showInlineNotification('✅ Pull successful', 'success');
                // Refresh the git status
                setTimeout(() => this.showGitStatus(), 1000);
            } else {
                this.showInlineNotification(`❌ Pull failed: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error pulling:', error);
            this.showInlineNotification('❌ Error pulling changes', 'error');
        }
    }
    
    async gitPushProject() {
        try {
            this.showInlineNotification('🚀 Pushing changes...', 'info');
            const projectPath = this.currentGitProject;
            const result = await ipcRenderer.invoke('git-push-project', projectPath);
            
            if (result.success) {
                this.showInlineNotification('✅ Push successful', 'success');
                // Update push button immediately
                this.updatePushButton();
                // Refresh the git status to update the push button
                setTimeout(() => this.showGitStatus(), 1000);
            } else {
                this.showInlineNotification(`❌ Push failed: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error pushing project:', error);
            this.showInlineNotification('❌ Error pushing changes', 'error');
        }
    }
    
    updatePushButton() {
        // Remove the pending push reminder immediately
        const pushReminder = document.querySelector('.push-reminder');
        if (pushReminder) {
            pushReminder.remove();
        }
        
        // Remove the pulse animation and badge from push button
        const pushButton = document.querySelector('#git-push');
        if (pushButton) {
            pushButton.classList.remove('btn-pulse');
            const badge = pushButton.querySelector('.badge');
            if (badge) {
                badge.remove();
            }
            // Update the title to remove pending count
            pushButton.title = 'Push - Upload changes to remote repository';
        }
    }
    
    async gitPullProject() {
        try {
            this.showInlineNotification('⬇️ Pulling changes...', 'info');
            const projectPath = this.currentGitProject;
            const result = await ipcRenderer.invoke('git-pull-project', projectPath);
            
            if (result.success) {
                this.showInlineNotification('✅ Pull successful', 'success');
                // Refresh the git status for the project
                setTimeout(async () => {
                    const gitResult = await ipcRenderer.invoke('get-project-git-status', projectPath);
                    if (gitResult.success) {
                        this.displayGitStatusModal(gitResult);
                    }
                }, 1000);
            } else {
                this.showInlineNotification(`❌ Pull failed: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error pulling project:', error);
            this.showInlineNotification('❌ Error pulling changes', 'error');
        }
    }
    
    async resetToCommit(commitHash, hard = false) {
        const confirmMessage = hard ? 
            'Are you sure you want to do a HARD reset? This will PERMANENTLY delete all uncommitted changes.' :
            'Are you sure you want to reset to this commit? Uncommitted changes will be preserved.';
            
        if (!confirm(confirmMessage)) {
            return;
        }
        
        try {
            const resetType = hard ? 'hard' : 'soft';
            this.showInlineNotification(`🔄 Performing ${resetType} reset...`, 'info');
            const result = await ipcRenderer.invoke('git-reset', commitHash, hard);
            
            if (result.success) {
                this.showInlineNotification(`✅ Reset to ${commitHash} successful`, 'success');
                // Refresh the git status
                setTimeout(() => this.showGitStatus(), 1000);
            } else {
                this.showInlineNotification(`❌ Reset failed: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error resetting:', error);
            this.showInlineNotification('❌ Error resetting commit', 'error');
        }
    }
    
    async showFileDiff(fileName, workingDirectory) {
        try {
            // Get diff with file contents for expansion capability
            const result = await ipcRenderer.invoke('git-diff', fileName, workingDirectory, { includeFileContents: true });
            
            if (result.success) {
                // Use new split view diff modal with working directory for file list
                this.displayDiffModalSplitView(fileName, result.diff, result.fileContents, workingDirectory);
            } else {
                this.showInlineNotification(`❌ Failed to get diff: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error getting diff:', error);
            this.showInlineNotification('❌ Error getting file diff', 'error');
        }
    }
    
    displayDiffModal(fileName, diff) {
        const modal = document.createElement('div');
        modal.className = 'diff-modal';
        modal.innerHTML = `
            <div class="diff-content">
                <div class="diff-header">
                    <h3><i data-lucide="file-diff"></i> Diff: ${fileName}</h3>
                    <button class="close-btn" id="close-diff-modal">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                <div class="diff-body">
                    <pre class="diff-text">${this.formatDiff(diff)}</pre>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const closeModal = () => modal.remove();
        modal.querySelector('#close-diff-modal').addEventListener('click', closeModal);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
        // Handle Escape key
        const handleEscKey = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscKey);
            }
        };
        document.addEventListener('keydown', handleEscKey);
        
        setTimeout(() => {
            modal.classList.add('show');
            // Initialize Lucide icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }, 10);
    }
    
    formatDiff(diff) {
        if (!diff || diff.trim() === '') {
            return 'No changes detected';
        }
        
        return diff
            .split('\n')
            .map(line => {
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    return `<span class="diff-added">${this.escapeHtml(line)}</span>`;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    return `<span class="diff-removed">${this.escapeHtml(line)}</span>`;
                } else if (line.startsWith('@@')) {
                    return `<span class="diff-location">${this.escapeHtml(line)}</span>`;
                }
                return this.escapeHtml(line);
            })
            .join('\n');
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    async displayDiffModalSplitView(fileName, diff, fileContents, workingDirectory) {
        // Load the diff parser if not already loaded
        const DiffParser = require('./diff-parser.js');
        const parser = new DiffParser();
        
        // Parse the diff

        const parsedDiff = parser.parseDiff(diff, fileName, fileContents);
        const { leftLines, rightLines } = parser.createSideBySideView(parsedDiff.chunks);
        
        // Get all modified files if workingDirectory is provided
        let modifiedFiles = [];
        if (workingDirectory) {
            try {
                const gitStatus = await ipcRenderer.invoke('get-project-git-status', workingDirectory);
                if (gitStatus.success && gitStatus.files) {
                    modifiedFiles = gitStatus.files;
                }
            } catch (error) {
                console.error('Error getting git status:', error);
            }
        }
        
        const modal = document.createElement('div');
        modal.className = 'diff-modal diff-modal-split';
        
        // Store parser and parsed diff for expansion functionality
        modal.parser = parser;
        modal.parsedDiff = parsedDiff;
        modal.workingDirectory = workingDirectory;
        // Store original state for resetting when switching views
        modal.originalParsedDiff = JSON.parse(JSON.stringify(parsedDiff));
        
        modal.innerHTML = `
            <div class="diff-modal-container">
                ${modifiedFiles.length > 1 ? `
                    <div class="diff-file-sidebar" id="diff-file-sidebar">
                        <div class="diff-file-header">
                            <span>Modified Files (${modifiedFiles.length})</span>
                        </div>
                        <div class="diff-file-list">
                            ${modifiedFiles.map(file => `
                                <div class="diff-file-item ${file.file === fileName ? 'active' : ''}" data-file="${file.file}" data-status="${file.status}">
                                    <span class="diff-file-status ${file.status.toLowerCase()}">${file.status.charAt(0)}</span>
                                    <span class="diff-file-path">${file.file}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <button class="sidebar-toggle" id="sidebar-toggle" title="Toggle sidebar (Ctrl+B)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                    </button>
                ` : ''}
                <div class="diff-content diff-content-split ${modifiedFiles.length > 1 ? 'with-sidebar' : ''}">
                    <div class="diff-header">
                        <h3><i data-lucide="file-diff"></i> ${fileName}</h3>
                        <div class="diff-view-toggle">
                            <button class="btn btn-small active" id="split-view-btn">Split View</button>
                            <button class="btn btn-small" id="unified-view-btn">Unified View</button>
                        </div>
                        <button class="close-btn" id="close-diff-modal">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                    </div>
                    <div class="diff-stats">
                        <span class="stat-added">+${parsedDiff.stats.added}</span>
                        <span class="stat-modified">~${parsedDiff.stats.modified}</span>
                        <span class="stat-removed">-${parsedDiff.stats.removed}</span>
                    </div>
                    <div class="diff-body-split">
                        <div class="diff-panel diff-panel-left">
                            <div class="diff-panel-header">Original</div>
                            <div class="diff-panel-content" id="diff-left-content">
                                ${this.renderDiffLines(leftLines, 'left', parsedDiff)}
                            </div>
                        </div>
                        <div class="diff-resize-handle" id="diff-resize-handle"></div>
                        <div class="diff-panel diff-panel-right">
                            <div class="diff-panel-header">Modified</div>
                            <div class="diff-panel-content" id="diff-right-content">
                                ${this.renderDiffLines(rightLines, 'right', parsedDiff)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Store parsed diff data on modal for expansion
        modal.parsedDiff = parsedDiff;
        modal.parser = parser;
        
        // Set up event handlers
        const closeModal = () => {
            // Clean up resize handlers if they exist
            if (modal.resizeHandlers) {
                document.removeEventListener('mousemove', modal.resizeHandlers.handleMouseMove);
                document.removeEventListener('mouseup', modal.resizeHandlers.handleMouseUp);
            }
            // Clean up escape key listener
            document.removeEventListener('keydown', handleEscKey);
            // Dispatch close event for cleanup
            modal.dispatchEvent(new Event('close'));
            modal.remove();
        };
        modal.querySelector('#close-diff-modal').addEventListener('click', closeModal);
        
        // Handle Escape key
        const handleEscKey = (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        };
        document.addEventListener('keydown', handleEscKey);
        
        // View toggle handlers
        modal.querySelector('#unified-view-btn').addEventListener('click', () => {
            // Switch to unified view
            this.switchToUnifiedView(modal, parsedDiff);
        });
        
        // Sync scrolling between panels
        const leftPanel = modal.querySelector('#diff-left-content');
        const rightPanel = modal.querySelector('#diff-right-content');
        let isSyncing = false;
        
        const syncScroll = (source, target) => {
            if (!isSyncing) {
                isSyncing = true;
                target.scrollTop = source.scrollTop;
                // Don't sync horizontal scroll to allow independent horizontal scrolling
                // target.scrollLeft = source.scrollLeft;
                setTimeout(() => isSyncing = false, 10);
            }
        };
        
        leftPanel.addEventListener('scroll', () => syncScroll(leftPanel, rightPanel));
        rightPanel.addEventListener('scroll', () => syncScroll(rightPanel, leftPanel));
        
        // Resize handle functionality
        const resizeHandle = modal.querySelector('#diff-resize-handle');
        const leftPanelDiv = modal.querySelector('.diff-panel-left');
        const rightPanelDiv = modal.querySelector('.diff-panel-right');
        const diffBody = modal.querySelector('.diff-body-split');
        
        let isResizing = false;
        let startX = 0;
        let startLeftWidth = 0;
        let startRightWidth = 0;
        
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.pageX;
            
            const leftRect = leftPanelDiv.getBoundingClientRect();
            const rightRect = rightPanelDiv.getBoundingClientRect();
            startLeftWidth = leftRect.width;
            startRightWidth = rightRect.width;
            
            // Add resizing class for visual feedback
            diffBody.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            
            // Prevent text selection during resize
            e.preventDefault();
        });
        
        const handleMouseMove = (e) => {
            if (!isResizing) return;
            
            const deltaX = e.pageX - startX;
            const containerWidth = diffBody.getBoundingClientRect().width;
            
            // Calculate new widths
            let newLeftWidth = startLeftWidth + deltaX;
            let newRightWidth = startRightWidth - deltaX;
            
            // Apply minimum width constraints
            const minWidth = 150;
            if (newLeftWidth < minWidth) {
                newLeftWidth = minWidth;
                newRightWidth = containerWidth - minWidth - resizeHandle.offsetWidth;
            }
            if (newRightWidth < minWidth) {
                newRightWidth = minWidth;
                newLeftWidth = containerWidth - minWidth - resizeHandle.offsetWidth;
            }
            
            // Calculate percentages
            const totalPanelWidth = containerWidth - resizeHandle.offsetWidth;
            const leftPercent = (newLeftWidth / totalPanelWidth) * 100;
            const rightPercent = (newRightWidth / totalPanelWidth) * 100;
            
            // Apply new widths
            leftPanelDiv.style.flex = `0 0 ${leftPercent}%`;
            rightPanelDiv.style.flex = `0 0 ${rightPercent}%`;
        };
        
        const handleMouseUp = () => {
            if (isResizing) {
                isResizing = false;
                diffBody.classList.remove('resizing');
                document.body.style.cursor = '';
            }
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        // Store handlers for cleanup
        modal.resizeHandlers = { handleMouseMove, handleMouseUp };
        
        // Expansion handlers
        modal.addEventListener('click', async (e) => {
            if (e.target === modal) {
                closeModal();
            } else if (e.target.classList.contains('expand-btn')) {
                await this.handleDiffExpansion(e.target, modal);
            }
        });
        
        // Sidebar toggle functionality
        const sidebarToggle = modal.querySelector('#sidebar-toggle');
        const sidebar = modal.querySelector('#diff-file-sidebar');
        const diffContent = modal.querySelector('.diff-content-split');
        
        if (sidebarToggle && sidebar && diffContent) {
            // Load collapsed state from localStorage
            const isCollapsed = localStorage.getItem('diffSidebarCollapsed') === 'true';
            if (isCollapsed) {
                sidebar.classList.add('collapsed');
                diffContent.classList.add('sidebar-collapsed');
                sidebarToggle.style.left = '0px';
            }
            
            sidebarToggle.addEventListener('click', () => {
                const isCollapsed = sidebar.classList.toggle('collapsed');
                diffContent.classList.toggle('sidebar-collapsed');
                localStorage.setItem('diffSidebarCollapsed', isCollapsed);
                
                // Update button position
                if (isCollapsed) {
                    sidebarToggle.style.left = '0px';
                } else {
                    sidebarToggle.style.left = '226px';
                }
            });
            
            // Keyboard shortcut (Ctrl+B)
            const handleKeyboard = (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                    e.preventDefault();
                    sidebarToggle.click();
                }
            };
            
            document.addEventListener('keydown', handleKeyboard);
            
            // Clean up keyboard listener when modal closes
            modal.addEventListener('close', () => {
                document.removeEventListener('keydown', handleKeyboard);
            });
        }
        
        // File sidebar click handlers
        if (modifiedFiles.length > 1) {
            modal.querySelectorAll('.diff-file-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const fileName = item.dataset.file;
                    const currentActive = modal.querySelector('.diff-file-item.active');
                    
                    // Don't reload if clicking the same file
                    if (currentActive === item) return;
                    
                    // Update active state
                    if (currentActive) currentActive.classList.remove('active');
                    item.classList.add('active');
                    
                    // Load the new file diff
                    try {
                        const result = await ipcRenderer.invoke('git-diff', fileName, workingDirectory, { includeFileContents: true });
                        if (result.success) {
                            // Parse the new diff
                            const newParsedDiff = parser.parseDiff(result.diff, fileName, result.fileContents);
                            const { leftLines: newLeftLines, rightLines: newRightLines } = parser.createSideBySideView(newParsedDiff.chunks);
                            
                            // Update modal data
                            modal.parsedDiff = newParsedDiff;
                            modal.originalParsedDiff = JSON.parse(JSON.stringify(newParsedDiff));
                            
                            // Update header
                            modal.querySelector('.diff-header h3').innerHTML = `<i data-lucide="file-diff"></i> ${fileName}`;
                            
                            // Update stats
                            modal.querySelector('.stat-added').textContent = `+${newParsedDiff.stats.added}`;
                            modal.querySelector('.stat-modified').textContent = `~${newParsedDiff.stats.modified}`;
                            modal.querySelector('.stat-removed').textContent = `-${newParsedDiff.stats.removed}`;
                            
                            // Update content
                            modal.querySelector('#diff-left-content').innerHTML = this.renderDiffLines(newLeftLines, 'left', newParsedDiff);
                            modal.querySelector('#diff-right-content').innerHTML = this.renderDiffLines(newRightLines, 'right', newParsedDiff);
                            
                            // Re-initialize lucide icons
                            if (typeof lucide !== 'undefined') {
                                lucide.createIcons();
                            }
                        }
                    } catch (error) {
                        console.error('Error loading file diff:', error);
                    }
                });
            });
        }
        
        setTimeout(() => {
            modal.classList.add('show');
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }, 10);
    }
    
    renderDiffLines(lines, side, parsedDiff) {
        return lines.map((line, index) => {
            if (line.type === 'expand') {
                return `
                    <div class="diff-line diff-line-expand">
                        <span class="line-number"></span>
                        <button class="expand-btn" 
                            data-chunk="${line.chunkIndex}" 
                            data-direction="${line.direction}"
                            data-side="${side}">
                            ${line.content}
                        </button>
                    </div>
                `;
            } else if (line.type === 'separator') {
                return '<div class="diff-line diff-line-separator">...</div>';
            } else if (line.type === 'empty') {
                return `
                    <div class="diff-line diff-line-empty">
                        <span class="line-number"></span>
                        <span class="line-content"></span>
                    </div>
                `;
            } else {
                const lineClass = `diff-line diff-line-${line.type}`;
                const lineNumber = line.number || '';
                return `
                    <div class="${lineClass}">
                        <span class="line-number">${lineNumber}</span>
                        <span class="line-content">${this.escapeHtml(line.content)}</span>
                    </div>
                `;
            }
        }).join('');
    }
    
    async handleDiffExpansion(button, modal) {
        const chunkIndex = parseInt(button.dataset.chunk);
        const direction = button.dataset.direction;
        const side = button.dataset.side;

        // Disable button during expansion
        button.disabled = true;
        button.textContent = 'Loading...';
        
        try {
            // Expand the chunk in the parsed diff
            const expandedDiff = modal.parser.expandChunkContext(
                modal.parsedDiff, 
                chunkIndex, 
                direction, 
                50 // Expand 50 lines at a time
            );
            
            // Update stored diff
            modal.parsedDiff = expandedDiff;
            
            // Re-render both panels
            const { leftLines, rightLines } = modal.parser.createSideBySideView(expandedDiff.chunks);
            
            const leftContent = modal.querySelector('#diff-left-content');
            const rightContent = modal.querySelector('#diff-right-content');
            
            // Store scroll positions
            const leftScroll = leftContent.scrollTop;
            const rightScroll = rightContent.scrollTop;
            
            // Update content
            leftContent.innerHTML = this.renderDiffLines(leftLines, 'left', expandedDiff);
            rightContent.innerHTML = this.renderDiffLines(rightLines, 'right', expandedDiff);
            
            // Restore scroll positions
            leftContent.scrollTop = leftScroll;
            rightContent.scrollTop = rightScroll;
            
        } catch (error) {
            console.error('Error expanding diff:', error);
            button.textContent = 'Error - Click to retry';
            button.disabled = false;
        }
    }
    
    switchToUnifiedView(modal, parsedDiff) {
        // Update toggle buttons
        modal.querySelector('#split-view-btn').classList.remove('active');
        modal.querySelector('#unified-view-btn').classList.add('active');
        
        // Reset to original parsed diff (remove expansions)
        const originalDiff = modal.originalParsedDiff || parsedDiff;
        modal.parsedDiff = JSON.parse(JSON.stringify(originalDiff)); // Deep clone
        
        // Create unified view lines from original state
        const unifiedLines = this.createUnifiedViewLines(modal.parsedDiff.chunks);
        
        // Update the modal content
        const diffBody = modal.querySelector('.diff-body-split');
        diffBody.className = 'diff-body-unified';
        diffBody.innerHTML = `
            <div class="diff-panel diff-panel-unified">
                <div class="diff-panel-content" id="diff-unified-content">
                    ${this.renderUnifiedDiffLines(unifiedLines, modal.parsedDiff)}
                </div>
            </div>
        `;
        
        // Update split view button handler
        modal.querySelector('#split-view-btn').addEventListener('click', () => {
            this.switchToSplitView(modal, modal.parsedDiff);
        });
        
        // Add expansion click handler for unified view
        modal.querySelector('#diff-unified-content').addEventListener('click', async (e) => {
            if (e.target.classList.contains('expand-btn')) {
                await this.handleDiffExpansion(e.target, modal);
                // Re-render unified view after expansion
                const expandedDiff = modal.parsedDiff;
                const unifiedLines = this.createUnifiedViewLines(expandedDiff.chunks);
                modal.querySelector('#diff-unified-content').innerHTML = this.renderUnifiedDiffLines(unifiedLines, expandedDiff);
                // Re-initialize icons
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            }
        });
        
        // Re-initialize lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
    
    switchToSplitView(modal, parsedDiff) {
        // Update toggle buttons
        modal.querySelector('#unified-view-btn').classList.remove('active');
        modal.querySelector('#split-view-btn').classList.add('active');
        
        // Reset to original parsed diff (remove expansions)
        const originalDiff = modal.originalParsedDiff || parsedDiff;
        modal.parsedDiff = JSON.parse(JSON.stringify(originalDiff)); // Deep clone
        
        // Recreate split view from original state
        const { leftLines, rightLines } = modal.parser.createSideBySideView(modal.parsedDiff.chunks);
        
        // Update the modal content
        const diffBody = modal.querySelector('.diff-body-unified, .diff-body-split');
        diffBody.className = 'diff-body-split';
        diffBody.innerHTML = `
            <div class="diff-panel diff-panel-left">
                <div class="diff-panel-header">Original</div>
                <div class="diff-panel-content" id="diff-left-content">
                    ${this.renderDiffLines(leftLines, 'left', modal.parsedDiff)}
                </div>
            </div>
            <div class="diff-resize-handle" id="diff-resize-handle"></div>
            <div class="diff-panel diff-panel-right">
                <div class="diff-panel-header">Modified</div>
                <div class="diff-panel-content" id="diff-right-content">
                    ${this.renderDiffLines(rightLines, 'right', modal.parsedDiff)}
                </div>
            </div>
        `;
        
        // Re-setup sync scrolling
        const leftPanel = modal.querySelector('#diff-left-content');
        const rightPanel = modal.querySelector('#diff-right-content');
        let isSyncing = false;
        
        const syncScroll = (source, target) => {
            if (!isSyncing) {
                isSyncing = true;
                target.scrollTop = source.scrollTop;
                // Don't sync horizontal scroll to allow independent horizontal scrolling
                // target.scrollLeft = source.scrollLeft;
                setTimeout(() => isSyncing = false, 10);
            }
        };
        
        leftPanel.addEventListener('scroll', () => syncScroll(leftPanel, rightPanel));
        rightPanel.addEventListener('scroll', () => syncScroll(rightPanel, leftPanel));
        
        // Re-setup resize handle functionality
        const resizeHandle = modal.querySelector('#diff-resize-handle');
        const leftPanelDiv = modal.querySelector('.diff-panel-left');
        const rightPanelDiv = modal.querySelector('.diff-panel-right');
        
        let isResizing = false;
        let startX = 0;
        let startLeftWidth = 0;
        let startRightWidth = 0;
        
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.pageX;
            
            const leftRect = leftPanelDiv.getBoundingClientRect();
            const rightRect = rightPanelDiv.getBoundingClientRect();
            startLeftWidth = leftRect.width;
            startRightWidth = rightRect.width;
            
            diffBody.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });
        
        const handleMouseMove = (e) => {
            if (!isResizing) return;
            
            const deltaX = e.pageX - startX;
            const containerWidth = diffBody.getBoundingClientRect().width;
            
            let newLeftWidth = startLeftWidth + deltaX;
            let newRightWidth = startRightWidth - deltaX;
            
            const minWidth = 150;
            if (newLeftWidth < minWidth) {
                newLeftWidth = minWidth;
                newRightWidth = containerWidth - minWidth - resizeHandle.offsetWidth;
            }
            if (newRightWidth < minWidth) {
                newRightWidth = minWidth;
                newLeftWidth = containerWidth - minWidth - resizeHandle.offsetWidth;
            }
            
            const totalPanelWidth = containerWidth - resizeHandle.offsetWidth;
            const leftPercent = (newLeftWidth / totalPanelWidth) * 100;
            const rightPercent = (newRightWidth / totalPanelWidth) * 100;
            
            leftPanelDiv.style.flex = `0 0 ${leftPercent}%`;
            rightPanelDiv.style.flex = `0 0 ${rightPercent}%`;
        };
        
        const handleMouseUp = () => {
            if (isResizing) {
                isResizing = false;
                diffBody.classList.remove('resizing');
                document.body.style.cursor = '';
            }
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        // Store handlers for cleanup
        modal.resizeHandlers = { handleMouseMove, handleMouseUp };
        
        // Update unified view button handler
        modal.querySelector('#unified-view-btn').addEventListener('click', () => {
            this.switchToUnifiedView(modal, modal.parsedDiff);
        });
        
        // Re-initialize lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
    
    createUnifiedViewLines(chunks) {
        const unifiedLines = [];
        
        chunks.forEach((chunk, chunkIndex) => {
            // Add expansion placeholder at the top if expandable
            if (chunk.expandableTop && (chunk.trimmedTop > 0 || chunk.hiddenTopLines > 0)) {
                unifiedLines.push({
                    type: 'expand',
                    direction: 'top',
                    chunkIndex,
                    content: '↑ Show more lines'
                });
            }
            
            // Add chunk lines
            chunk.lines.forEach(line => {
                unifiedLines.push({
                    type: line.type,
                    oldLine: line.oldLine,
                    newLine: line.newLine,
                    content: line.content
                });
            });
            
            // Add expansion placeholder at the bottom if expandable
            if (chunk.expandableBottom && (chunk.trimmedBottom > 0 || chunk.hiddenBottomLines > 0)) {
                unifiedLines.push({
                    type: 'expand',
                    direction: 'bottom',
                    chunkIndex,
                    content: '↓ Show more lines'
                });
            }
            
            // Add chunk separator if not last chunk
            if (chunkIndex < chunks.length - 1) {
                unifiedLines.push({ type: 'separator' });
            }
        });
        
        return unifiedLines;
    }
    
    renderUnifiedDiffLines(lines, parsedDiff) {
        return lines.map((line, index) => {
            if (line.type === 'expand') {
                return `
                    <div class="diff-line diff-line-expand">
                        <button class="expand-btn" data-chunk="${line.chunkIndex}" data-direction="${line.direction}">
                            ${line.content}
                        </button>
                    </div>
                `;
            } else if (line.type === 'separator') {
                return '<div class="diff-chunk-separator">...</div>';
            } else {
                const lineClass = line.type === 'added' ? 'diff-line-added' : 
                                 line.type === 'removed' ? 'diff-line-removed' : 
                                 'diff-line-unchanged';
                const prefix = line.type === 'added' ? '+' : 
                              line.type === 'removed' ? '-' : 
                              ' ';
                const lineNumber = line.type === 'removed' ? line.oldLine : line.newLine;
                const otherNumber = line.type === 'removed' ? '' : 
                                   line.type === 'added' ? '' : 
                                   line.oldLine;
                
                return `
                    <div class="diff-line ${lineClass}">
                        <span class="line-number">${otherNumber || ''}</span>
                        <span class="line-number">${lineNumber || ''}</span>
                        <span class="line-prefix">${prefix}</span>
                        <span class="line-content">${this.escapeHtml(line.content)}</span>
                    </div>
                `;
            }
        }).join('');
    }

    async discardFileChanges(fileName, fileStatus = 'Modified', workingDirectory) {
        const isNew = fileStatus === 'New';
        const action = isNew ? 'delete' : 'discard all changes to';
        const confirmMessage = `Are you sure you want to ${action} '${fileName}'? This action cannot be undone.`;
        
        if (!confirm(confirmMessage)) {
            return;
        }
        
        try {
            const actionText = isNew ? 'Deleting' : 'Discarding changes to';
            this.showInlineNotification(`🔄 ${actionText} ${fileName}...`, 'info');
            const result = await ipcRenderer.invoke('git-discard-file', fileName, workingDirectory);
            
            if (result.success) {
                this.showInlineNotification(`✅ ${result.message}`, 'success');
                // Refresh the git status
                setTimeout(() => this.showGitStatus(), 1000);
            } else {
                this.showInlineNotification(`❌ Failed: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error discarding file changes:', error);
            this.showInlineNotification('❌ Error processing file', 'error');
        }
    }
    
    async discardAllChanges() {
        // First, get git status to check if there are untracked files
        const gitStatus = await ipcRenderer.invoke('get-git-status');
        const hasNewFiles = gitStatus.success && gitStatus.files.some(f => f.status === 'New');
        
        let includeNew = false;
        
        if (hasNewFiles) {
            // Create a custom dialog for three options
            const confirmMessage = 'You have new files. What would you like to do?\n\n' +
                '• Click OK to discard ALL changes INCLUDING new files (⚠️ new files will be permanently deleted)\n' +
                '• Click Cancel to discard ONLY changes to tracked files (new files will remain)\n\n' +
                'Close this dialog to cancel the operation.';
            
            includeNew = confirm(confirmMessage);
        } else {
            const confirmMessage = 'Are you sure you want to discard ALL changes? This action cannot be undone and will remove all modifications to tracked files.';
            
            if (!confirm(confirmMessage)) {
                return;
            }
        }
        
        try {
            this.showInlineNotification('🔄 Discarding changes...', 'info');
            const result = await ipcRenderer.invoke('git-discard-all', includeNew);
            
            if (result.success) {
                const message = includeNew ? 
                    '✅ All changes and new files discarded' : 
                    '✅ All changes to tracked files discarded';
                this.showInlineNotification(message, 'success');
                // Refresh the git status
                setTimeout(() => this.showGitStatus(), 1000);
            } else {
                this.showInlineNotification(`❌ Failed to discard changes: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error discarding all changes:', error);
            this.showInlineNotification('❌ Error discarding all changes', 'error');
        }
    }
    
    // Update branch display for specific terminal
    async updateBranchDisplay(terminalId = null) {
        try {
            // If no terminalId provided, update all terminals
            if (terminalId === null) {
                for (let i = 0; i < 4; i++) {
                    if (this.terminals.has(i)) {
                        await this.updateBranchDisplay(i);
                    }
                }
                return;
            }
            
            const result = await ipcRenderer.invoke('git-get-branches', terminalId);
            
            // Find git branch display based on current layout mode
            let branchDisplay;
            if (this.layoutMode === 'tabbed') {
                branchDisplay = document.querySelector(`#tabbed-terminal-content [data-quadrant="${terminalId}"] #git-branch-display-${terminalId}`);
            } else {
                branchDisplay = document.querySelector(`#terminals-container [data-quadrant="${terminalId}"] #git-branch-display-${terminalId}`);
            }
            
            if (!branchDisplay) {
                // Fallback to ID search
                branchDisplay = document.getElementById(`git-branch-display-${terminalId}`);
            }
            
            const branchName = branchDisplay?.querySelector('.current-branch-name');
            
            if (result.success && result.currentBranch && branchDisplay && branchName) {
                branchName.textContent = result.currentBranch;
                branchDisplay.style.display = 'flex';
                
                // Set tooltip with branch name
                branchDisplay.title = `Current branch: ${result.currentBranch}\nClick to switch branches`;
                
                // Setup click event for the entire branch display (not just the button)
                if (!branchDisplay.hasAttribute('data-listener-set')) {
                    branchDisplay.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.showBranchSelector(terminalId);
                    });
                    branchDisplay.setAttribute('data-listener-set', 'true');
                }
            } else {
                if (branchDisplay) {
                    branchDisplay.style.display = 'none';
                }
            }
        } catch (error) {
            console.error(`Error updating branch display for terminal ${terminalId}:`, error);
            const branchDisplay = document.getElementById(`git-branch-display-${terminalId}`);
            if (branchDisplay) {
                branchDisplay.style.display = 'none';
            }
        }
    }
    
    // Show branch selector modal
    async showBranchSelector(terminalId) {
        try {
            const result = await ipcRenderer.invoke('git-get-branches', terminalId);
            
            if (result.success) {
                this.displayBranchSelectorModal(result, terminalId);
            } else {
                this.showNotification(result.error || 'Failed to get branches', 'warning');
            }
        } catch (error) {
            console.error('Error getting branches:', error);
            this.showNotification('Error getting branches', 'error');
        }
    }
    
    displayBranchSelectorModal(branchData, terminalId) {
        // Remove existing modal if present
        const existingModal = document.querySelector('.branch-selector-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.className = 'branch-selector-modal';
        modal.innerHTML = `
            <div class="branch-selector-content">
                <div class="branch-selector-header">
                    <h3><i data-lucide="git-branch"></i> Git Branches - Terminal ${terminalId + 1}</h3>
                    <button class="close-btn" id="close-branch-modal">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                
                <div class="branch-current">
                    <div class="branch-info">
                        <span class="branch-label">Current Branch:</span>
                        <span class="branch-name current">${branchData.currentBranch}</span>
                    </div>
                </div>
                
                <div class="branch-create">
                    <h4>Create New Branch</h4>
                    <div class="branch-input-group">
                        <input type="text" id="new-branch-name" placeholder="Enter branch name..." />
                        <div class="branch-options">
                            <label>
                                <input type="checkbox" id="switch-to-branch" checked />
                                Switch to new branch
                            </label>
                        </div>
                        <button class="btn btn-primary" id="create-branch-btn">Create Branch</button>
                    </div>
                </div>
                
                <div class="branch-list">
                    <h4>Switch to Existing Branch</h4>
                    <div class="branch-search">
                        <input type="text" id="branch-search-input" placeholder="Search branches..." />
                        <span class="search-icon"><i data-lucide="search"></i></span>
                    </div>
                    <div class="branches" id="branch-list-container">
                        ${branchData.branches.slice(0, 5).map(branch => `
                            <div class="branch-item ${branch === branchData.currentBranch ? 'current' : ''}" data-branch-name="${branch}">
                                <span class="branch-name">${branch}</span>
                                ${branch !== branchData.currentBranch ? 
                                    `<button class="btn btn-sm switch-branch-btn" data-branch="${branch}">Switch</button>` : 
                                    '<span class="current-indicator">Current</span>'
                                }
                            </div>
                        `).join('')}
                    </div>
                    ${branchData.branches.length > 5 ? 
                        `<div class="branch-list-info">Showing 5 of ${branchData.branches.length} branches. Use search to find more.</div>` : 
                        ''
                    }
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Event listeners
        const closeModal = () => {
            modal.remove();
        };
        
        modal.querySelector('#close-branch-modal').addEventListener('click', closeModal);
        
        // Create branch functionality
        const createBranchBtn = modal.querySelector('#create-branch-btn');
        const branchNameInput = modal.querySelector('#new-branch-name');
        const switchToBranchCheckbox = modal.querySelector('#switch-to-branch');
        
        createBranchBtn.addEventListener('click', async () => {
            const branchName = branchNameInput.value.trim();
            if (!branchName) {
                this.showNotification('Please enter a branch name', 'warning');
                return;
            }
            
            try {
                const result = await ipcRenderer.invoke('git-create-branch', branchName, switchToBranchCheckbox.checked, terminalId);
                
                if (result.success) {
                    closeModal();
                    await this.updateBranchDisplay(terminalId);
                } else {
                    this.showNotification(result.error || 'Failed to create branch', 'error');
                }
            } catch (error) {
                console.error('Error creating branch:', error);
                this.showNotification('Error creating branch', 'error');
            }
        });
        
        // Switch branch functionality
        modal.querySelectorAll('.switch-branch-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const branchName = btn.dataset.branch;
                
                try {
                    const result = await ipcRenderer.invoke('git-switch-branch', branchName, terminalId);
                    
                    if (result.success) {
                        closeModal();
                        await this.updateBranchDisplay(terminalId);
                    } else {
                        this.showNotification(result.error || 'Failed to switch branch', 'error');
                    }
                } catch (error) {
                    console.error('Error switching branch:', error);
                    this.showNotification('Error switching branch', 'error');
                }
            });
        });
        
        // Search functionality
        const searchInput = modal.querySelector('#branch-search-input');
        const branchListContainer = modal.querySelector('#branch-list-container');
        const allBranches = branchData.branches;
        
        const filterBranches = (searchTerm) => {
            const filtered = searchTerm 
                ? allBranches.filter(branch => branch.toLowerCase().includes(searchTerm.toLowerCase()))
                : allBranches.slice(0, 5);
            
            branchListContainer.innerHTML = filtered.map(branch => `
                <div class="branch-item ${branch === branchData.currentBranch ? 'current' : ''}" data-branch-name="${branch}">
                    <span class="branch-name">${branch}</span>
                    ${branch !== branchData.currentBranch ? 
                        `<button class="btn btn-sm switch-branch-btn" data-branch="${branch}">Switch</button>` : 
                        '<span class="current-indicator">Current</span>'
                    }
                </div>
            `).join('');
            
            // Re-attach switch branch event listeners
            branchListContainer.querySelectorAll('.switch-branch-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const branchName = btn.dataset.branch;
                    
                    try {
                        const result = await ipcRenderer.invoke('git-switch-branch', branchName, terminalId);
                        
                        if (result.success) {
                            closeModal();
                            await this.updateBranchDisplay(terminalId);
                        } else {
                            this.showNotification(result.error || 'Failed to switch branch', 'error');
                        }
                    } catch (error) {
                        console.error('Error switching branch:', error);
                        this.showNotification('Error switching branch', 'error');
                    }
                });
            });
            
            // Update Lucide icons
            if (window.lucide) {
                window.lucide.createIcons();
            }
        };
        
        searchInput.addEventListener('input', (e) => {
            filterBranches(e.target.value);
        });
        
        // Enter key for creating branch
        branchNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                createBranchBtn.click();
            }
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
        setTimeout(() => {
            modal.classList.add('show');
            branchNameInput.focus();
            // Initialize Lucide icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }, 10);
    }
    
    showInlineNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `inline-notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    updateGitButtonVisibility() {
        const gitButton = document.getElementById('git-status-btn');
        if (gitButton) {
            // Show git button only if there are active terminals
            const hasActiveTerminals = this.terminals.size > 0;
            gitButton.style.display = hasActiveTerminals ? 'block' : 'none';
            
            // Also update branch display when terminals are active
            if (hasActiveTerminals) {
                // Update branch display for all active terminals
                this.terminals.forEach((terminal, terminalId) => {
                    this.updateBranchDisplay(terminalId);
                });
            }
        }
    }

    // ===== TASK MANAGEMENT METHODS =====
    
    async updateCurrentTaskIndicators() {
        // Update task indicators for all terminals
        for (let i = 0; i < 4; i++) {
            // Convert quadrant (0-3) to terminal_id (1-4)
            await this.updateTerminalTaskIndicator(i + 1);
        }
    }

    async updateTerminalTaskIndicator(terminalId) {
        try {
            const result = await ipcRenderer.invoke('task-get-current', terminalId);
            // Convert terminal_id (1-4) back to quadrant (0-3) for DOM element lookup
            const quadrant = terminalId - 1;
            
            // Find task badge based on current layout mode
            let taskBadge;
            if (this.layoutMode === 'tabbed') {
                taskBadge = document.querySelector(`#tabbed-terminal-content [data-quadrant="${quadrant}"] #task-badge-${quadrant}`);
            } else {
                taskBadge = document.querySelector(`#terminals-container [data-quadrant="${quadrant}"] #task-badge-${quadrant}`);
            }
            
            if (!taskBadge) {
                // Fallback to ID search
                taskBadge = document.getElementById(`task-badge-${quadrant}`);
            }
            
            if (!taskBadge) return;

            if (result.success && result.task) {
                const task = result.task;
                
                // Get the current terminal's project name
                const terminalProjectName = this.getTerminalProjectName(quadrant);
                
                // Only show badge if task project matches terminal project
                // If task has no project (NULL), always show it (backward compatibility)
                // If terminal has no project, show all tasks
                const shouldShowBadge = !task.project || 
                                       !terminalProjectName || 
                                       task.project === terminalProjectName;
                
                if (shouldShowBadge) {
                    const taskIdElement = taskBadge.querySelector('.task-id');
                    
                    if (taskIdElement) {
                        taskIdElement.textContent = task.id;
                        taskBadge.style.display = 'inline-flex';
                        taskBadge.title = `Task #${task.id}: ${task.title}${task.description ? '\n' + task.description : ''}`;
                        
                        // Remove any existing click listener and add new one
                        const newTaskBadge = taskBadge.cloneNode(true);
                        taskBadge.parentNode.replaceChild(newTaskBadge, taskBadge);
                        
                        // Add click event to open task manager with this task
                        newTaskBadge.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.openTaskInKanban(task.id);
                        });
                    }
                } else {
                    // Hide badge if project doesn't match
                    taskBadge.style.display = 'none';
                }
            } else {
                taskBadge.style.display = 'none';
            }
        } catch (error) {
            console.error(`Error updating task indicator for terminal ${terminalId}:`, error);
        }
    }

    // Open task manager and focus on specific task
    openTaskInKanban(taskId) {
        // Open the kanban window
        ipcRenderer.send('open-kanban-window', { focusTaskId: taskId });
    }

    async createTaskForTerminal(terminalId, title, description) {
        try {
            const result = await ipcRenderer.invoke('task-create', title, description, terminalId);
            if (result.success) {
                // Update task status to in_progress
                await ipcRenderer.invoke('task-update-status', result.taskId, 'in_progress');
                // Refresh the task indicator
                await this.updateTerminalTaskIndicator(terminalId);
                return result.taskId;
            } else {
                console.error('Failed to create task:', result.error);
                return null;
            }
        } catch (error) {
            console.error('Error creating task:', error);
            return null;
        }
    }

    async completeCurrentTask(terminalId) {
        try {
            const result = await ipcRenderer.invoke('task-get-current', terminalId);
            if (result.success && result.task) {
                const taskId = result.task.id;
                const updateResult = await ipcRenderer.invoke('task-update-status', taskId, 'completed');
                
                if (updateResult.success) {
                    // Refresh the task indicator
                    await this.updateTerminalTaskIndicator(terminalId);
                    
                    // Show completion notification
                    
                    return true;
                }
            }
            return false;
        } catch (error) {
            console.error('Error completing task:', error);
            return false;
        }
    }

    // Periodically update task indicators (every 5 seconds)
    startTaskIndicatorUpdates() {
        // Initial update
        this.updateCurrentTaskIndicators();
        
        // Set up periodic updates (more frequent for better UX)
        setInterval(() => {
            this.updateCurrentTaskIndicators();
        }, 5000); // 5 seconds instead of 30
        
        // Set up notification file monitoring for immediate task completion alerts
        this.startNotificationFileMonitoring();
    }

    // Monitor notification file for immediate task completion alerts
    startNotificationFileMonitoring() {
        // Check for notifications every 2 seconds for immediate feedback
        setInterval(() => {
            this.checkForTaskCompletionNotifications();
        }, 2000);
    }

    async updateNotificationBadge() {
        try {
            // Update the main process with terminals needing attention
            const waitingTerminals = Array.from(this.terminalsNeedingAttention);
            const count = this.terminalsNeedingAttention.size;
            
            await ipcRenderer.invoke('update-terminals-waiting', waitingTerminals);
            
            // Update badge count
            await ipcRenderer.invoke('update-badge-count', count);
        } catch (error) {
            console.error('Error updating notification badge:', error);
        }
    }

    async clearNotificationBadge() {
        try {
            // Clear all terminals from attention list
            this.terminalsNeedingAttention.clear();
            
            // Update the main process
            await ipcRenderer.invoke('update-terminals-waiting', []);
            
            // Clear badge count
            await ipcRenderer.invoke('update-badge-count', 0);
        } catch (error) {
            console.error('Error clearing notification badge:', error);
        }
    }

    async checkHooksStatus() {
        try {
            // Check hooks installation status
            const hooksResult = await ipcRenderer.invoke('hooks-check-status');
            this.hooksStatus.installed = hooksResult.installed || false;
            
            // Check webhook server status
            const webhookResult = await ipcRenderer.invoke('webhook-status');
            this.hooksStatus.webhookRunning = webhookResult.running || false;
            
            // Update UI indicator
            this.updateHooksStatusIndicator();

        } catch (error) {
            console.error('Error checking hooks status:', error);
            this.hooksStatus = { installed: false, webhookRunning: false };
            this.updateHooksStatusIndicator();
        }
    }

    updateHooksStatusIndicator() {
        // Find or create the hooks status indicator
        let indicator = document.getElementById('hooks-status-indicator');
        
        if (!indicator) {
            // Create the indicator if it doesn't exist
            const header = document.querySelector('.header-left');
            if (!header) return;
            
            indicator = document.createElement('div');
            indicator.id = 'hooks-status-indicator';
            indicator.className = 'hooks-status-indicator';
            indicator.innerHTML = `
                <i data-lucide="webhook"></i>
                <span class="status-text">Hooks</span>
                <span class="status-dot"></span>
            `;
            
            // Insert after the app title
            const title = header.querySelector('h1');
            if (title) {
                title.insertAdjacentElement('afterend', indicator);
            } else {
                header.appendChild(indicator);
            }
            
            // Initialize Lucide icon
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }
        
        // Update the status
        const statusDot = indicator.querySelector('.status-dot');
        const statusText = indicator.querySelector('.status-text');
        
        if (this.hooksStatus.installed && this.hooksStatus.webhookRunning) {
            statusDot.className = 'status-dot status-active';
            statusText.textContent = 'Hooks Active';
            indicator.title = 'Hooks are installed and webhook server is running';
        } else if (this.hooksStatus.webhookRunning && !this.hooksStatus.installed) {
            statusDot.className = 'status-dot status-warning';
            statusText.textContent = 'Hooks Not Installed';
            indicator.title = 'Webhook server is running but hooks are not installed. Click to install.';
            indicator.style.cursor = 'pointer';
            indicator.onclick = () => this.installHooks();
        } else {
            statusDot.className = 'status-dot status-inactive';
            statusText.textContent = 'Hooks Inactive';
            indicator.title = 'Hooks system is not active';
        }
    }

    async installHooks() {
        try {
            const result = await ipcRenderer.invoke('hooks-install');
            if (result.success) {
                this.showNotification('Hooks installed successfully', 'success');
                // Recheck status
                await this.checkHooksStatus();
            } else {
                this.showNotification(`Failed to install hooks: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error installing hooks:', error);
            this.showNotification('Error installing hooks', 'error');
        }
    }

    startHooksStatusUpdates() {
        // Check hooks status every 30 seconds
        setInterval(() => {
            this.checkHooksStatus();
        }, 30000);
    }

    async checkForTaskCompletionNotifications() {

        try {
            const result = await ipcRenderer.invoke('check-task-notifications');
            
            // Debug logging
            if (result.notifications && result.notifications.length > 0) {

                // Log terminal title notifications specifically
                const titleNotifications = result.notifications.filter(n => n.type === 'terminal_title_update');
                if (titleNotifications.length > 0) {

                }
            }
            
            if (result.success && result.notifications && result.notifications.length > 0) {
                result.notifications.forEach(notification => {
                    if (notification.type === 'task_completed') {
                        // Desktop notification removed - only update indicators
                        // Immediately update task indicators to reflect the change
                        this.updateCurrentTaskIndicators();
                    } else if (notification.type === 'terminal_title_update') {
                        // Process terminal title update
                        const { terminal_id, title, task_id } = notification;

                        // Save to localStorage
                        localStorage.setItem(`terminal_title_${terminal_id}`, title);
                        if (task_id) {
                            localStorage.setItem(`terminal_task_${terminal_id}`, task_id);
                        }
                        
                        // Verify localStorage was updated
                        const storedTitle = localStorage.getItem(`terminal_title_${terminal_id}`);

                        // Update UI immediately - convert terminal_id (1-based) to quadrant (0-based)
                        const quadrant = terminal_id - 1;
                        this.updateTerminalTitle(quadrant, title);
                        
                        // Also update the task badge if we have a task
                        if (task_id) {
                            this.updateTerminalTaskIndicator(terminal_id);
                        }

                    }
                });
                
                // After processing all terminal title updates, mark them as processed
                const hasTerminalTitleUpdates = result.notifications.some(n => n.type === 'terminal_title_update');
                if (hasTerminalTitleUpdates) {
                    // Mark terminal title notifications as processed in the file
                    await ipcRenderer.invoke('mark-terminal-titles-processed');

                }
            }
        } catch (error) {
            // Silently fail - this is just for notifications

        }
    }

    // Dynamic terminal management
    async addTerminal() {
        try {
            const result = await ipcRenderer.invoke('add-terminal');
            if (result.success) {
                // Get the new terminal ID from the result
                const newTerminalId = result.terminalId;
                
                // In tabbed mode, set active terminal before rendering
                if (this.layoutMode === 'tabbed' && newTerminalId !== undefined) {
                    this.activeTabTerminal = newTerminalId;
                }
                
                // Render terminals (this will handle both grid and tabbed mode)
                await this.renderTerminals();
                await this.updateTerminalManagementButtons();
                
                // Reparar controles de todos los terminales después de re-renderizar
                // Esto asegura que los botones de scroll se muestren correctamente
                setTimeout(() => {
                    this.repairTerminalControls();
                }, 200);
            } else {
                // Solo mostrar error si es crítico
                console.error('Error adding terminal:', result.error);
            }
        } catch (error) {
            console.error('Error adding terminal:', error);
        }
    }

    async showRemoveTerminalModal() {
        try {
            const activeResult = await ipcRenderer.invoke('get-active-terminals');
            if (!activeResult.success || activeResult.terminals.length === 0) {
                return;
            }

            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Remove Terminal</h3>
                    <p>Select a terminal to remove:</p>
                    <div class="terminal-list">
                        ${activeResult.terminals.map(id => `
                            <button class="terminal-option" data-terminal="${id}">
                                Terminal ${id + 1}
                            </button>
                        `).join('')}
                    </div>
                    <div class="modal-actions">
                        <button class="btn" id="cancel-remove">Cancel</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Handle terminal selection
            modal.querySelectorAll('.terminal-option').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const terminalId = parseInt(btn.dataset.terminal);
                    await this.removeTerminal(terminalId);
                    document.body.removeChild(modal);
                });
            });

            // Handle cancel
            modal.querySelector('#cancel-remove').addEventListener('click', () => {
                document.body.removeChild(modal);
            });

            // Close on overlay click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    document.body.removeChild(modal);
                }
            });

        } catch (error) {
            console.error('Error showing remove terminal modal:', error);
        }
    }

    async removeLastTerminal() {
        try {
            const activeResult = await ipcRenderer.invoke('get-active-terminals');
            if (!activeResult.success || activeResult.terminals.length === 0) {
                // Silently do nothing if no terminals to remove
                return;
            }

            // Get the highest terminal ID (last one added)
            const lastTerminalId = Math.max(...activeResult.terminals);
            await this.removeTerminal(lastTerminalId, true); // silent = true
        } catch (error) {
            console.error('Error removing last terminal:', error);
        }
    }

    async removeTerminal(terminalId, silent = false) {
        try {
            const result = await ipcRenderer.invoke('remove-terminal', terminalId);
            if (result.success) {
                // Remove from local terminals map
                this.terminals.delete(terminalId);
                
                // Remove danger notification if this was a danger terminal
                const dangerNotification = document.querySelector(`#danger-notification-${terminalId}`);
                if (dangerNotification) {
                    dangerNotification.remove();
                }
                if (this.dangerTerminals) {
                    this.dangerTerminals.delete(terminalId);
                }
                
                // In tabbed mode, switch to another tab if removing the active one
                if (this.layoutMode === 'tabbed' && this.activeTabTerminal === terminalId) {
                    const activeResult = await ipcRenderer.invoke('get-active-terminals');
                    if (activeResult.success && activeResult.terminals.length > 0) {
                        // Switch to first available terminal
                        this.activeTabTerminal = activeResult.terminals[0];
                    } else {
                        this.activeTabTerminal = null;
                    }
                }
                
                await this.renderTerminals();
                await this.updateTerminalManagementButtons();
                
                // Reparar controles después de eliminar terminal
                setTimeout(() => {
                    this.repairTerminalControls();
                }, 200);
                
                if (!silent) {
                    // Notification removed as requested
                }
            } else {
                if (!silent) {
                    this.showNotification('Error', result.error, 'error');
                }
            }
        } catch (error) {
            console.error('Error removing terminal:', error);
            if (!silent) {
                this.showNotification('Error', 'Failed to remove terminal', 'error');
            }
        }
    }

    async forceRenderUpdate() {
        // Force a complete re-render of all terminals
        await this.renderTerminals();

    }

    async renderTerminals() {
        try {

            const activeResult = await ipcRenderer.invoke('get-active-terminals');

            if (!activeResult.success) {
                console.error('Failed to get active terminals');
                return;
            }

            const activeTerminals = activeResult.terminals;

            // If in tabbed mode, render tabbed layout instead
            if (this.layoutMode === 'tabbed') {
                await this.renderTabbedLayout(activeTerminals);
                return;
            }

            const container = document.getElementById('terminals-container');

            // Preserve existing terminal information before clearing
            const preservedInfo = {};
            activeTerminals.forEach(terminalId => {
                const existingElement = document.querySelector(`[data-quadrant="${terminalId}"]`);
                if (existingElement) {
                    const titleElement = existingElement.querySelector('.terminal-title');
                    const headerElement = existingElement.querySelector('.terminal-header');
                    
                    // Extract the actual title without the terminal number prefix
                    let actualTitle = `Terminal ${terminalId + 1}`;
                    if (titleElement && titleElement.textContent) {
                        // Remove the terminal number prefix (e.g., "1 · " or "2 · ")
                        const titleText = titleElement.textContent;
                        const match = titleText.match(/^\d+\s*·\s*(.+)$/);
                        actualTitle = match ? match[1] : titleText;
                    }
                    
                    preservedInfo[terminalId] = {
                        title: actualTitle,
                        directory: this.lastSelectedDirectories[terminalId] || null,
                        // Preserve header styling info if any
                        hasProjectStyling: headerElement && headerElement.style.background && headerElement.style.background !== ''
                    };
                }
            });

            // Update container class for layout while preserving existing layout classes
            container.className = `terminals-container count-${activeTerminals.length}`;
            
            // Reset any inline styles that might have been set by resizers
            container.style.removeProperty('--left-width');
            container.style.removeProperty('--right-width');
            container.style.removeProperty('--top-height');
            container.style.removeProperty('--bottom-height');
            container.style.removeProperty('--row1-left-width');
            container.style.removeProperty('--row1-right-width');
            container.style.removeProperty('--row2-left-width');
            container.style.removeProperty('--row2-right-width');
            
            // Re-apply layout class if set
            if (activeTerminals.length === 2 && this.currentLayout === 'vertical') {
                container.classList.add('layout-vertical');
            } else if (activeTerminals.length === 3 && this.currentLayout.startsWith('3-')) {
                container.classList.add(`layout-${this.currentLayout}`);
            }
            
            // Clear existing content
            container.innerHTML = '';

            if (activeTerminals.length === 0) {

                // Show empty state
                container.innerHTML = `
                    <div class="empty-state">
                        <h2>No Terminals Active</h2>
                        <p>Click the + button to add your first terminal</p>
                    </div>
                `;
                return;
            }

            // Create terminal elements with resizers
            await this.createTerminalLayoutWithResizers(container, activeTerminals);

            // Restore preserved terminal information and colors

            activeTerminals.forEach(terminalId => {
                const info = preservedInfo[terminalId];
                if (info) {
                    // Restore title
                    if (info.title !== `Terminal ${terminalId + 1}`) {
                        this.updateTerminalTitle(terminalId, info.title);
                    }
                }
                
                // Always restore project styling if directory exists (whether info exists or not)
                if (this.lastSelectedDirectories[terminalId]) {
                    this.updateTerminalHeaderColor(terminalId);
                }
            });

            // Re-initialize Lucide icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }

            this.attachTerminalEventListeners();
            
            // Restore task indicators and git branch displays
            this.updateCurrentTaskIndicators();
            this.updateGitButtonVisibility();
            
            // Resize all terminals after rendering
            setTimeout(() => {
                this.resizeAllTerminals();
            }, 100);

        } catch (error) {
            console.error('❌ Error rendering terminals:', error);
        }
    }

    async createTerminalElement(terminalId) {
        const element = document.createElement('div');
        element.className = 'terminal-quadrant';
        element.dataset.quadrant = terminalId;
        element.dataset.terminalId = terminalId;
        
        // Check if terminal already exists and is initialized

        const existingTerminal = this.terminals.get(terminalId);
        const hasActiveTerminal = existingTerminal && existingTerminal.terminal;
        
        // Get the terminal title - check localStorage first, then use project name if available
        let terminalTitle = localStorage.getItem(`terminal_title_${terminalId + 1}`);
        
        if (!terminalTitle) {
            // No custom title in localStorage, use default
            terminalTitle = `Terminal ${terminalId + 1}`;
            // Use lastSelectedDirectories even if terminal is not in Map
            if (this.lastSelectedDirectories[terminalId]) {
                const projectPath = this.lastSelectedDirectories[terminalId];
                const projectName = projectPath.split('/').pop() || projectPath;
                terminalTitle = `${terminalId + 1} · ${projectName}`;
            }
        }
        
        // Log for debugging

        element.innerHTML = `
            <div class="terminal-header">
                <div style="display: flex; align-items: center; flex: 1;">
                    <span class="terminal-title">${terminalTitle}</span>
                    <button class="task-id-badge" id="task-badge-${terminalId}" style="display: none;" title="View task in Kanban">
                        #<span class="task-id"></span>
                    </button>
                    <div class="git-branch-display" id="git-branch-display-${terminalId}" style="display: none;">
                        <i data-lucide="git-branch"></i>
                        <span class="current-branch-name">main</span>
                        <button class="branch-switch-btn" data-terminal="${terminalId}" title="Switch/Create Branch">
                            <i data-lucide="chevron-down"></i>
                        </button>
                    </div>
                    <div class="terminal-quick-actions">
                        <button class="terminal-quick-btn" data-action="mcp" data-terminal="${terminalId}" title="View configured MCP servers">
                            <i data-lucide="server"></i>
                        </button>
                        <button class="terminal-quick-btn" data-action="clear" data-terminal="${terminalId}" title="Clear context - Recommended between tasks">
                            <i data-lucide="eraser"></i>
                        </button>
                        <button class="terminal-quick-btn" data-action="memory" data-terminal="${terminalId}" title="Add memory context - Use # to store important context">
                            <i data-lucide="brain"></i>
                        </button>
                    </div>
                </div>
                <div class="terminal-controls">
                    <div class="terminal-reorder-controls" style="${this.fullscreenTerminal !== null ? 'display: none;' : ''}">
                        <button class="terminal-reorder-btn" data-action="move-left" data-terminal="${terminalId}" title="Move Left">
                            ◀
                        </button>
                        <button class="terminal-reorder-btn" data-action="move-right" data-terminal="${terminalId}" title="Move Right">
                            ▶
                        </button>
                    </div>
                    ${hasActiveTerminal ? `
                    <div class="terminal-more-options-container">
                        <button class="terminal-control-btn terminal-more-btn" data-action="more-options" data-terminal="${terminalId}" title="More Options">⋯</button>
                        <div class="terminal-dropdown-menu" data-terminal="${terminalId}" style="display: none;">
                            <button class="terminal-dropdown-item" data-action="open-terminal-here" data-terminal="${terminalId}">
                                <i data-lucide="terminal"></i>
                                <span>Open Terminal in Project Path</span>
                            </button>
                            <button class="terminal-dropdown-item" data-action="open-folder" data-terminal="${terminalId}">
                                <i data-lucide="folder-open"></i>
                                <span>Open Folder</span>
                            </button>
                            ${await this.buildIDEMenuItems(terminalId)}
                        </div>
                    </div>
                    ` : ''}
                    <button class="terminal-control-btn" data-action="fullscreen" title="Fullscreen">⛶</button>
                    <button class="terminal-control-btn" data-action="close" title="Close">×</button>
                </div>
            </div>
            <div class="terminal-wrapper">
                ${hasActiveTerminal ? 
                    `<div class="terminal" id="terminal-${terminalId}"></div>` :
                    `<div class="terminal-placeholder" data-quadrant="${terminalId}">
                        <div class="terminal-placeholder-content">
                            <div class="terminal-placeholder-icon">
                                <img src="../assets/claude_terminal.png" alt="Claude">
                            </div>
                            <div class="terminal-placeholder-text">Start Claude Code</div>
                            <div class="terminal-placeholder-subtext">Click to launch terminal</div>
                        </div>
                    </div>`
                }
            </div>
        `;

        // If terminal exists, reattach it after element is in DOM
        if (hasActiveTerminal) {
            setTimeout(() => {
                const terminalDiv = element.querySelector(`#terminal-${terminalId}`);
                if (terminalDiv && existingTerminal.terminal) {
                    // Clear any existing content to prevent duplication
                    terminalDiv.innerHTML = '';
                    
                    // Make sure the terminal div is visible
                    terminalDiv.style.display = 'block';
                    
                    // Force a reflow to ensure DOM is ready
                    terminalDiv.offsetHeight;
                    
                    // Reopen the terminal in the new element
                    existingTerminal.terminal.open(terminalDiv);
                    
                    // Multiple fit attempts to ensure proper sizing
                    if (existingTerminal.fitAddon) {
                        // Immediate fit
                        existingTerminal.fitAddon.fit();
                        
                        // Delayed fit for after render
                        setTimeout(() => {
                            existingTerminal.fitAddon.fit();
                        }, 50);
                        
                        // Final fit after animations
                        setTimeout(() => {
                            existingTerminal.fitAddon.fit();
                        }, 300);
                    }
                    
                    // Trigger a resize event to force xterm to recalculate properly
                    // This simulates the manual window resize that fixes the rendering
                    setTimeout(() => {
                        window.dispatchEvent(new Event('resize'));
                    }, 100);
                }
            }, 0);
        }

        return element;
    }

    attachTerminalEventListeners() {

        // Use event delegation for placeholders instead of attaching to each one
        // This ensures they work even after DOM changes
        const containers = [
            document.getElementById('terminals-container'),
            document.getElementById('tabbed-terminal-content')
        ];
        
        containers.forEach(container => {
            if (!container) return;
            
            // Remove existing delegated listener if any
            if (container._placeholderClickHandler) {
                container.removeEventListener('click', container._placeholderClickHandler);
            }
            
            // Create new delegated click handler
            container._placeholderClickHandler = (e) => {
                const placeholder = e.target.closest('.terminal-placeholder');
                if (placeholder) {
                    e.stopPropagation();
                    const quadrant = parseInt(placeholder.dataset.quadrant);

                    // Always show directory selector - remove reconnect functionality
                    this.showDirectorySelector(quadrant);
                }
            };
            
            // Attach the delegated listener
            container.addEventListener('click', container._placeholderClickHandler);

        });

        // Re-attach color picker event listeners to terminal titles
        document.querySelectorAll('.terminal-title').forEach(terminalTitleEl => {
            const quadrantElement = terminalTitleEl.closest('.terminal-quadrant');
            if (quadrantElement) {
                const quadrant = parseInt(quadrantElement.dataset.quadrant);
                // Only add listener if terminal is active (has a terminal instance)
                if (this.terminals.has(quadrant)) {
                    terminalTitleEl.style.cursor = 'pointer'; // Show it's clickable
                    terminalTitleEl.title = 'Click to change project color'; // Add tooltip
                    terminalTitleEl.addEventListener('click', (e) => {
                        e.stopPropagation(); // Prevent event bubbling
                        this.showColorPicker(quadrant, e);
                    });
                }
            }
        });

        // Re-attach quick action button listeners
        document.querySelectorAll('.terminal-quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const terminalId = parseInt(btn.dataset.terminal);
                
                if (!this.terminals.has(terminalId)) {

                    return;
                }
                
                const terminal = this.terminals.get(terminalId);
                if (!terminal || !terminal.terminal) {

                    return;
                }
                
                // Write the appropriate command to the terminal
                switch(action) {
                    case 'mcp':
                        // Write /mcp command to terminal
                        terminal.terminal.paste('/mcp');
                        terminal.terminal.focus();
                        break;
                    case 'clear':
                        // Write /clear command to terminal
                        terminal.terminal.paste('/clear');
                        terminal.terminal.focus();
                        break;
                    case 'memory':
                        // Write # for memory context
                        terminal.terminal.paste('#');
                        terminal.terminal.focus();
                        break;
                }
            });
        });

        // Re-attach control button listeners
        document.querySelectorAll('.terminal-control-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = e.target.dataset.action || e.target.closest('[data-action]')?.dataset.action;
                
                // Get quadrant from data-terminal attribute first, then fallback to parent quadrant
                let quadrant;
                const btnEl = e.target.closest('.terminal-control-btn');
                if (btnEl && btnEl.dataset.terminal) {
                    quadrant = parseInt(btnEl.dataset.terminal);
                } else {
                    const quadrantEl = e.target.closest('.terminal-quadrant');
                    if (quadrantEl) {
                        quadrant = parseInt(quadrantEl.dataset.quadrant);
                    }
                }
                
                if (!quadrant && quadrant !== 0) {
                    console.error('Could not determine quadrant for action:', action);
                    return;
                }
                
                if (action === 'fullscreen') {
                    this.toggleFullscreen(quadrant);
                } else if (action === 'close') {
                    this.closeTerminal(quadrant);  // async pero no necesario await aquí
                } else if (action === 'more-options') {
                    this.toggleDropdownMenu(quadrant);
                }
            });
        });

        // Re-attach reorder button listeners
        document.querySelectorAll('.terminal-reorder-btn').forEach(btn => {
            // Click handler
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = e.target.dataset.action || e.target.closest('.terminal-reorder-btn').dataset.action;
                
                // Get the terminal element that contains this button
                const terminalElement = e.target.closest('.terminal-quadrant');
                const allTerminals = Array.from(document.querySelectorAll('.terminal-quadrant'));
                const currentPosition = allTerminals.indexOf(terminalElement);
                
                if (action === 'move-left') {
                    this.moveTerminalByPosition(currentPosition, 'left');
                } else if (action === 'move-right') {
                    this.moveTerminalByPosition(currentPosition, 'right');
                }
            });

            // Hover effect to show which terminals will be swapped
            btn.addEventListener('mouseenter', (e) => {
                const action = e.target.dataset.action || e.target.closest('.terminal-reorder-btn').dataset.action;
                const terminalElement = e.target.closest('.terminal-quadrant');
                const allTerminals = Array.from(document.querySelectorAll('.terminal-quadrant'));
                const currentPosition = allTerminals.indexOf(terminalElement);
                
                const swapTargets = this.getSwapTargets(currentPosition, action, allTerminals);
                if (swapTargets) {
                    this.highlightSwapPreview(swapTargets.current, swapTargets.target);
                }
            });

            btn.addEventListener('mouseleave', (e) => {
                this.clearSwapPreview();
            });
        });

        // Update reorder button states
        this.updateReorderButtonStates();
    }

    updateReorderButtonStates() {
        try {
            const allTerminals = Array.from(document.querySelectorAll('.terminal-quadrant'));
            
            // Show all buttons for circular navigation (wrap-around)
            allTerminals.forEach((terminal, index) => {
                const leftBtn = terminal.querySelector('.terminal-reorder-btn[data-action="move-left"]');
                const rightBtn = terminal.querySelector('.terminal-reorder-btn[data-action="move-right"]');
                
                if (leftBtn) {
                    leftBtn.style.display = 'flex';
                }
                
                if (rightBtn) {
                    rightBtn.style.display = 'flex';
                }
            });
        } catch (error) {
            console.error('Error updating reorder button states:', error);
        }
    }

    async updateTerminalManagementButtons() {
        const addBtn = document.getElementById('add-terminal-btn');
        const layoutSelector = document.getElementById('layout-selector');
        
        try {
            const activeResult = await ipcRenderer.invoke('get-active-terminals');
            const activeCount = activeResult.success ? activeResult.terminals.length : 0;
            
            // Disable add button if we have max terminals (6)
            addBtn.disabled = activeCount >= 6;
            
            // Show/hide layout selector for 2 or 3 terminals
            if (activeCount === 2 || activeCount === 3) {
                layoutSelector.style.display = 'flex';
                this.updateLayoutButtonGroups(activeCount);
                
                // Set default layout if current layout doesn't match terminal count
                const defaultLayout = this.getDefaultLayout(activeCount);
                if ((activeCount === 2 && this.currentLayout.startsWith('3-')) ||
                    (activeCount === 3 && !this.currentLayout.startsWith('3-'))) {
                    this.currentLayout = defaultLayout;
                }
                
                this.updateLayoutButtons();
            } else {
                layoutSelector.style.display = 'none';
            }
        } catch (error) {
            console.error('Error updating terminal management buttons:', error);
            addBtn.disabled = false;
        }
    }

    async setLayout(layout) {

        const validLayouts = ['horizontal', 'vertical', '3-top1', '3-top2-horiz', '3-left2', '3-right2'];
        if (!validLayouts.includes(layout)) return;
        
        // Set flag to prevent notification re-triggering during layout change
        this.isChangingLayout = true;
        
        this.currentLayout = layout;
        const container = document.getElementById('terminals-container');

        // Remove all layout classes first
        container.classList.remove('layout-vertical', 'layout-3-top1', 'layout-3-top2-horiz', 'layout-3-left2', 'layout-3-right2');
        
        // Reset all CSS variables to defaults before applying new layout
        container.style.removeProperty('--left-width');
        container.style.removeProperty('--right-width');
        container.style.removeProperty('--top-height');
        container.style.removeProperty('--bottom-height');
        
        // Update container classes based on layout
        if (layout === 'vertical') {
            container.classList.add('layout-vertical');

        } else if (layout.startsWith('3-')) {
            container.classList.add(`layout-${layout}`);

        }
        
        // Update button states
        this.updateLayoutButtons();
        
        // Re-render terminals with new layout
        await this.renderTerminals();
        
        // Reparar controles después de cambiar layout
        setTimeout(() => {
            this.repairTerminalControls();
            // Clear the flag after layout change is complete
            this.isChangingLayout = false;
        }, 200);
    }

    toggleLayoutMode() {

        if (this.layoutMode === 'grid') {
            this.switchToTabbedMode();
        } else {
            this.switchToGridMode();
        }
    }

    switchToTabbedMode() {

        this.layoutMode = 'tabbed';
        
        // Clean up any open directory selectors before switching modes
        document.querySelectorAll('.directory-selector').forEach(selector => {

            selector.remove();
        });
        
        // Save current terminal titles before switching (without terminal number prefix)
        const savedTitles = new Map();
        this.terminals.forEach((terminal, quadrant) => {
            const titleElement = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-title`);
            if (titleElement && titleElement.textContent) {
                // Remove terminal number prefix if present (e.g., "1 · Title" -> "Title")
                const titleText = titleElement.textContent;
                const match = titleText.match(/^\d+\s*·\s*(.+)$/);
                const cleanTitle = match ? match[1] : titleText;
                savedTitles.set(quadrant, cleanTitle);
            }
        });
        
        // Close all dropdowns before switching
        document.querySelectorAll('.terminal-dropdown-menu').forEach(menu => {
            menu.style.display = 'none';
        });
        
        // Hide grid container and show tabbed container
        const gridContainer = document.getElementById('terminals-container');
        const tabbedContainer = document.getElementById('tabbed-layout-container');
        const tabbedBtn = document.getElementById('tabbed-mode-btn');
        
        gridContainer.style.display = 'none';
        tabbedContainer.style.display = 'flex';
        
        // Update button state
        tabbedBtn.classList.add('active');
        document.body.classList.add('tabbed-layout-active');
        
        // Get first terminal as active if none selected
        const activeResult = ipcRenderer.invoke('get-active-terminals').then(async result => {
            if (result.success && result.terminals.length > 0) {
                if (!this.activeTabTerminal && result.terminals.length > 0) {
                    this.activeTabTerminal = result.terminals[0];
                }
                await this.renderTabbedLayout(result.terminals);
                
                // Restore all terminal states after rendering with a slight delay
                setTimeout(() => {
                    // First restore general terminal states (colors, etc)
                    this.restoreAllTerminalStates();

                    // Then restore custom titles (with higher priority) after a small delay
                    setTimeout(() => {
                        // Restore saved titles from before the switch
                        savedTitles.forEach((title, quadrant) => {

                            this.updateTerminalTitle(quadrant, title);
                        });
                        
                        // Check if we should restore from localStorage (not on fresh app start)
                        if (!window.isAppFreshStart) {
                            for (let i = 0; i < 6; i++) {
                                if (!savedTitles.has(i)) {
                                    const storedTitle = localStorage.getItem(`terminal_title_${i + 1}`);
                                    if (storedTitle) {

                                        this.updateTerminalTitle(i, storedTitle);
                                    }
                                }
                            }
                        } else {

                        }
                    }, 50); // Small delay to ensure restoreAllTerminalStates doesn't override
                    
                    // Refresh the active terminal display to ensure scrollbar is visible
                    if (this.activeTabTerminal !== null) {
                        this.refreshTerminalDisplay(this.activeTabTerminal);
                    }
                }, 100);
                
                // Event delegation is already set up, no need to re-attach

            }
        });
    }

    switchToGridMode() {

        // Clean up any open directory selectors before switching modes
        document.querySelectorAll('.directory-selector').forEach(selector => {

            selector.remove();
        });
        
        // Save current terminal titles before switching (clean titles without numbers)
        const savedTitles = new Map();
        document.querySelectorAll('.terminal-tab').forEach(tab => {
            const terminalId = parseInt(tab.dataset.terminalId);
            const titleElement = tab.querySelector('.tab-title');
            if (titleElement && titleElement.textContent) {
                // Tab titles shouldn't have numbers, but clean just in case
                const titleText = titleElement.textContent;
                const match = titleText.match(/^\d+\s*·\s*(.+)$/);
                const cleanTitle = match ? match[1] : titleText;
                savedTitles.set(terminalId, cleanTitle);
            }
        });
        
        this.layoutMode = 'grid';
        
        // Close all dropdowns before switching
        document.querySelectorAll('.terminal-dropdown-menu').forEach(menu => {
            menu.style.display = 'none';
        });
        
        // Show grid container and hide tabbed container
        const gridContainer = document.getElementById('terminals-container');
        const tabbedContainer = document.getElementById('tabbed-layout-container');
        const tabbedBtn = document.getElementById('tabbed-mode-btn');
        
        // Clean up tabbed mode content to avoid duplicate elements
        const tabbedContent = document.getElementById('tabbed-terminal-content');
        if (tabbedContent) {

            tabbedContent.innerHTML = '';
        }
        
        gridContainer.style.display = '';
        tabbedContainer.style.display = 'none';
        
        // Update button state
        tabbedBtn.classList.remove('active');
        document.body.classList.remove('tabbed-layout-active');
        
        // Re-render grid layout
        this.renderTerminals().then(() => {
            // First restore general terminal states (colors, etc)
            this.restoreAllTerminalStates();
            
            // Then restore custom titles with higher priority after a delay
            setTimeout(() => {
                // Restore saved titles from tabs
                savedTitles.forEach((title, terminalId) => {

                    this.updateTerminalTitle(terminalId, title);
                });
                
                // Check if we should restore from localStorage (not on fresh app start)
                if (!window.isAppFreshStart) {
                    for (let i = 0; i < 6; i++) {
                        if (!savedTitles.has(i)) {
                            const storedTitle = localStorage.getItem(`terminal_title_${i + 1}`);
                            if (storedTitle) {

                                this.updateTerminalTitle(i, storedTitle);
                            }
                        }
                    }
                } else {

                }
            }, 200); // Slightly longer delay for grid mode to ensure DOM is ready
            
            // Re-attach event listeners after rendering new DOM
            this.attachTerminalEventListeners();
            // Also re-attach control button listeners specifically
            this.attachTerminalControlListeners();
            // Re-attach quick action button listeners
            this.attachQuickActionListeners();

        });
    }

    restoreAllTerminalStates() {

        // Get all active terminals
        ipcRenderer.invoke('get-active-terminals').then(result => {
            if (result.success && result.terminals) {
                // Use setTimeout to ensure DOM is fully rendered
                setTimeout(() => {
                    result.terminals.forEach(async terminalId => {
                        // Don't restore project name as title - we want to keep custom titles
                        // Custom titles are already restored from localStorage in switchToTabbedMode/switchToGridMode
                        /* Commented out to preserve custom titles
                        const terminal = this.terminals.get(terminalId);
                        if (terminal && terminal.terminal) {
                            const projectPath = this.lastSelectedDirectories[terminalId];
                            if (projectPath) {
                                const projectName = projectPath.split('/').pop() || projectPath;

                                this.updateTerminalTitle(terminalId, projectName);
                            }
                        }
                        */
                        
                        // Restore header color
                        if (this.lastSelectedDirectories[terminalId]) {

                            this.updateTerminalHeaderColor(terminalId);
                        }
                        
                        // Update current task indicator - fetch from backend
                        await this.updateTerminalTaskIndicator(terminalId + 1); // Convert to terminal_id (1-based)
                        
                        // Update git branch display
                        await this.updateBranchDisplay(terminalId);
                    });
                    
                    // Also re-initialize lucide icons for the new elements
                    if (typeof lucide !== 'undefined') {
                        setTimeout(() => {
                            lucide.createIcons();
                        }, 100);
                    }
                }, 300); // Wait 300ms for DOM to be fully rendered
            }
        });
    }

    async renderTabbedLayout(activeTerminals) {

        const tabsContainer = document.getElementById('terminal-tabs');
        const contentContainer = document.getElementById('tabbed-terminal-content');
        
        // Clear existing tabs and content
        tabsContainer.innerHTML = '';
        contentContainer.innerHTML = '';
        
        // Ensure we have a valid active tab
        // Check if activeTabTerminal is still valid (exists in active terminals)
        if (!activeTerminals.includes(this.activeTabTerminal)) {
            this.activeTabTerminal = null;
        }
        
        // If no active tab or invalid, set to first available
        if (!this.activeTabTerminal && activeTerminals.length > 0) {
            this.activeTabTerminal = activeTerminals[0];

        }
        
        // Create tabs and terminal elements
        for (const terminalId of activeTerminals) {
            // Create tab
            const tab = this.createTerminalTab(terminalId);
            tabsContainer.appendChild(tab);
            
            // Create terminal element
            const terminalElement = await this.createTerminalElement(terminalId);
            if (terminalId === this.activeTabTerminal) {
                terminalElement.classList.add('active');
            }
            contentContainer.appendChild(terminalElement);
            
            // Reattach terminal if it exists
            const existingTerminal = this.terminals.get(terminalId);
            if (existingTerminal && existingTerminal.terminal) {
                setTimeout(() => {
                    const terminalDiv = terminalElement.querySelector(`#terminal-${terminalId}`);
                    if (terminalDiv && existingTerminal.terminal) {
                        // Clear any existing content to prevent duplication
                        terminalDiv.innerHTML = '';
                        
                        terminalDiv.style.display = 'block';
                        
                        // Force a reflow to ensure DOM is ready
                        terminalDiv.offsetHeight;
                        
                        existingTerminal.terminal.open(terminalDiv);
                        
                        if (existingTerminal.fitAddon) {
                            // Immediate fit
                            existingTerminal.fitAddon.fit();
                            
                            // Delayed fit for after render
                            setTimeout(() => {
                                existingTerminal.fitAddon.fit();
                            }, 50);
                            
                            // Final fit after animations
                            setTimeout(() => {
                                existingTerminal.fitAddon.fit();
                            }, 300);
                        }
                        
                        // Trigger a resize event to force xterm to recalculate properly
                        setTimeout(() => {
                            window.dispatchEvent(new Event('resize'));
                        }, 100);
                        
                        // Add scroll to bottom button for tabbed mode

                        this.addScrollToBottomButton(terminalDiv, existingTerminal.terminal, terminalId);
                        
                        // Debug: check if button was added and viewport exists
                        setTimeout(() => {
                            const btn = terminalDiv.querySelector('.scroll-to-bottom-btn');
                            const viewport = terminalDiv.querySelector('.xterm-viewport');

                            if (viewport) {

                            }
                        }, 500);
                    }
                }, 0);
            }
        }
        
        // Attach tab event listeners
        this.attachTabEventListeners();
        
        // Re-attach terminal control button event listeners
        this.attachTerminalControlListeners();
        
        // Re-attach quick action button listeners for tabbed mode
        this.attachQuickActionListeners();

        // Re-initialize icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        
        // Update task indicators
        this.updateCurrentTaskIndicators();
        
        // Apply colors and other styling after everything is rendered
        setTimeout(() => {

            activeTerminals.forEach(terminalId => {
                // Apply header colors if terminal has a project
                if (this.lastSelectedDirectories[terminalId]) {

                    this.updateTerminalHeaderColor(terminalId);
                }
                
                // Update git branch display
                this.updateBranchDisplay(terminalId);
            });
            
            // Refresh the active terminal to ensure scrollbar is visible
            if (this.activeTabTerminal !== null) {
                this.refreshTerminalDisplay(this.activeTabTerminal);
            }
        }, 150); // Slightly longer delay to ensure DOM is ready
    }

    createTerminalTab(terminalId) {
        const tab = document.createElement('button');
        tab.className = 'terminal-tab';
        tab.dataset.terminalId = terminalId;
        // Also add as attribute for easier CSS selection
        tab.setAttribute('data-terminal-id', terminalId);
        
        if (terminalId === this.activeTabTerminal) {
            tab.classList.add('active');
        }
        
        // Check for activity or notifications
        if (this.terminalActivity.get(terminalId)) {
            tab.classList.add('working');
        }
        if (this.terminalsNeedingAttention.has(terminalId)) {
            tab.classList.add('tab-has-notification');
        }
        
        // Get terminal title and apply project color
        let title = `Terminal ${terminalId + 1}`;
        let projectColor = null;
        let projectInitials = '';
        
        // First check localStorage for custom terminal title
        const customTitle = localStorage.getItem(`terminal_title_${terminalId + 1}`);
        if (customTitle) {
            title = customTitle;
        }
        
        // First check if we have a directory for this terminal (might not be fully initialized yet)
        if (this.lastSelectedDirectories[terminalId]) {
            const dir = this.lastSelectedDirectories[terminalId];
            const projectName = dir.split('/').pop() || dir;
            
            // Generate project initials
            projectInitials = this.getProjectInitials(projectName);
            
            // Get or generate project color regardless of terminal state
            if (this.customProjectColors[projectName]) {
                projectColor = this.customProjectColors[projectName];
            } else {
                const colors = this.generateProjectColor(projectName);
                projectColor = colors ? colors.primary : null;
            }
            
            // If no custom title from localStorage, try to get from task or project
            if (!customTitle) {
                const terminal = this.terminals.get(terminalId);
                if (terminal && terminal.terminal) {
                    // Terminal is active, check for task or use project name
                    const currentTask = document.querySelector(`#current-task-${terminalId} .task-text`);
                    if (currentTask && currentTask.textContent) {
                        title = currentTask.textContent;
                    } else {
                        title = projectName;
                    }
                } else {
                    // Terminal not fully initialized yet, but we can still show project name
                    title = projectName;
                }
            }

        } else {
            // No directory selected yet, check if terminal is active
            const terminal = this.terminals.get(terminalId);
            if (terminal && terminal.terminal) {
                // Terminal is active but no directory - shouldn't happen normally

            }
        }
        
        tab.innerHTML = `
            <div class="terminal-tab-content">
                <span class="tab-terminal-number">${terminalId + 1}</span>
                ${projectInitials ? `<span class="tab-project-initials" style="background: ${projectColor}; color: white;">${projectInitials}</span>` : ''}
                <span class="tab-title">${title}</span>
                <div class="tab-activity-spinner"></div>
            </div>
            <button class="tab-close-btn" data-terminal="${terminalId}">
                ×
            </button>
        `;
        
        // Apply color styles directly to the tab button
        if (projectColor) {

            const tabNumber = tab.querySelector('.tab-terminal-number');
            
            // Apply gradient directly to the tab button
            tab.style.background = `linear-gradient(135deg, ${projectColor}40 0%, ${projectColor}15 100%)`;
            tab.style.borderLeft = `3px solid ${projectColor}`;
            
            if (tabNumber) {
                tabNumber.style.background = `${projectColor}`;
                tabNumber.style.color = 'white';
                tabNumber.style.fontWeight = 'bold';
            }
        }
        
        return tab;
    }

    attachTabEventListeners() {
        // Tab click to switch
        document.querySelectorAll('.terminal-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                // Don't switch if clicking close button
                if (e.target.classList.contains('tab-close-btn')) {
                    return;
                }
                
                const terminalId = parseInt(tab.dataset.terminalId);

                // Always clear notification when clicking a tab, even if it's already active
                if (this.terminalsNeedingAttention.has(terminalId)) {

                    this.terminalsNeedingAttention.delete(terminalId);
                    tab.classList.remove('tab-has-notification');

                    this.updateNotificationBadge();
                } else {

                    // Still try to remove the class if it exists
                    if (tab.classList.contains('tab-has-notification')) {

                        tab.classList.remove('tab-has-notification');
                    }
                }
                
                this.switchToTab(terminalId);
            });
        });
        
        // Tab close buttons
        document.querySelectorAll('.tab-close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const terminalId = parseInt(btn.dataset.terminal);
                this.closeTerminal(terminalId);
            });
        });
        
        // Terminal content click to clear notifications
        const tabbedContent = document.getElementById('tabbed-terminal-content');
        if (tabbedContent) {
            tabbedContent.querySelectorAll('[data-quadrant]').forEach(terminalDiv => {
                terminalDiv.addEventListener('click', (e) => {
                    // Get the terminal ID from the data-quadrant attribute
                    const terminalId = parseInt(terminalDiv.dataset.quadrant);
                    
                    // Clear notification if this terminal has one
                    if (this.terminalsNeedingAttention.has(terminalId)) {

                        this.terminalsNeedingAttention.delete(terminalId);
                        
                        // Remove notification class from the tab
                        const tab = document.querySelector(`.terminal-tab[data-terminal-id="${terminalId}"]`);
                        if (tab) {
                            tab.classList.remove('tab-has-notification');
                        }
                        
                        // Update the notification badge count
                        this.updateNotificationBadge();
                    }
                });
            });
        }
    }

    switchToTab(terminalId) {

        // Always clear notification state for this terminal, regardless of whether it's active
        if (this.terminalsNeedingAttention.has(terminalId)) {

            this.terminalsNeedingAttention.delete(terminalId);
            const tab = document.querySelector(`.terminal-tab[data-terminal-id="${terminalId}"]`);

            if (tab) {
                tab.classList.remove('tab-has-notification');

            }
            // Update the notification badge count
            this.updateNotificationBadge();
        }
        
        // Also check and clear notification class even if not in attention set (defensive programming)
        const tab = document.querySelector(`.terminal-tab[data-terminal-id="${terminalId}"]`);
        if (tab && tab.classList.contains('tab-has-notification')) {

            tab.classList.remove('tab-has-notification');
        }
        
        // If already on this tab, we need to still show the terminal (in case of notification clear)
        if (this.activeTabTerminal === terminalId) {

            // Make sure the terminal is visible
            this.showTerminal(terminalId);
            return;
        }

        this.activeTabTerminal = terminalId;
        
        // Update tab states
        document.querySelectorAll('.terminal-tab').forEach(tab => {
            const tabId = parseInt(tab.dataset.terminalId);
            tab.classList.toggle('active', tabId === terminalId);
        });
        
        // Update terminal visibility - use quadrant attribute which is what createTerminalElement sets
        document.querySelectorAll('.tabbed-terminal-content .terminal-quadrant').forEach(terminal => {
            const tId = parseInt(terminal.dataset.quadrant);
            terminal.classList.toggle('active', tId === terminalId);
        });
        
        // Refresh and resize terminal with better cleanup
        this.refreshTerminalDisplay(terminalId);
    }
    
    // Method to refresh terminal display and fix any rendering issues
    refreshTerminalDisplay(terminalId) {
        const terminal = this.terminals.get(terminalId);
        if (!terminal || !terminal.fitAddon) return;
        
        const terminalDiv = document.querySelector(`#terminal-${terminalId}`);
        if (!terminalDiv) return;
        
        // Clear selection to prevent duplication issues
        if (terminal.terminal) {
            terminal.terminal.clearSelection();
        }
        
        // Force fit to recalculate dimensions
        terminal.fitAddon.fit();
        
        // Refresh the terminal to ensure proper rendering
        if (terminal.terminal) {
            terminal.terminal.refresh(0, terminal.terminal.rows - 1);
        }
        
        // Delayed fits to handle any async rendering
        setTimeout(() => {
            terminal.fitAddon.fit();
        }, 50);
        
        setTimeout(() => {
            terminal.fitAddon.fit();
            // Final refresh after all fits
            if (terminal.terminal) {
                terminal.terminal.refresh(0, terminal.terminal.rows - 1);
            }
        }, 200);
        
        // Trigger a resize event to force xterm to recalculate properly
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 100);
    }
    
    // Start periodic refresh to fix any rendering issues automatically
    startTerminalRefreshInterval() {
        // Check and refresh visible terminals every 10 seconds
        setInterval(() => {
            if (this.layoutMode === 'tabbed' && this.activeTabTerminal !== null) {
                // In tabbed mode, only refresh the active tab
                this.refreshTerminalDisplay(this.activeTabTerminal);
            } else if (this.layoutMode === 'grid') {
                // In grid mode, refresh all visible terminals
                this.terminals.forEach((terminal, terminalId) => {
                    const terminalDiv = document.querySelector(`#terminal-${terminalId}`);
                    if (terminalDiv && terminalDiv.offsetParent !== null) {
                        // Only refresh if the terminal is actually visible
                        if (terminal.fitAddon) {
                            terminal.fitAddon.fit();
                        }
                    }
                });
            }
        }, 10000); // Run every 10 seconds
    }

    // Update existing methods to work with tabbed mode
    setTerminalActivity(terminalId, isActive) {
        this.terminalActivity.set(terminalId, isActive);
        
        // Update tab if in tabbed mode
        if (this.layoutMode === 'tabbed') {
            const tab = document.querySelector(`.terminal-tab[data-terminal-id="${terminalId}"]`);
            if (tab) {
                tab.classList.toggle('working', isActive);
            }
        }
    }

    showTerminalNotification(terminalId) {

        this.terminalsNeedingAttention.add(terminalId);

        // Update tab if in tabbed mode
        if (this.layoutMode === 'tabbed') {
            const tab = document.querySelector(`.terminal-tab[data-terminal-id="${terminalId}"]`);

            if (tab && terminalId !== this.activeTabTerminal) {

                tab.classList.add('tab-has-notification');

            } else if (terminalId === this.activeTabTerminal) {

            }
        }
    }

    updateLayoutButtonGroups(terminalCount) {
        const layout2Group = document.getElementById('layout-2-terminals');
        const layout3Group = document.getElementById('layout-3-terminals');
        
        if (terminalCount === 2) {
            layout2Group.style.display = 'flex';
            layout3Group.style.display = 'none';
        } else if (terminalCount === 3) {
            layout2Group.style.display = 'none';
            layout3Group.style.display = 'flex';
        }
    }

    updateLayoutButtons() {
        // Update 2-terminal buttons
        const horizontalBtn = document.getElementById('layout-horizontal-btn');
        const verticalBtn = document.getElementById('layout-vertical-btn');
        
        if (horizontalBtn && verticalBtn) {
            horizontalBtn.classList.toggle('active', this.currentLayout === 'horizontal');
            verticalBtn.classList.toggle('active', this.currentLayout === 'vertical');
        }
        
        // Update 3-terminal buttons
        const layout3Buttons = [
            { id: 'layout-3-top1-btn', layout: '3-top1' },
            { id: 'layout-3-top2-horiz-btn', layout: '3-top2-horiz' },
            { id: 'layout-3-left2-btn', layout: '3-left2' },
            { id: 'layout-3-right2-btn', layout: '3-right2' }
        ];
        
        layout3Buttons.forEach(({ id, layout }) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.classList.toggle('active', this.currentLayout === layout);
            }
        });
    }

    getDefaultLayout(terminalCount) {
        switch (terminalCount) {
            case 2:
                return 'horizontal';
            case 3:
                return '3-top1'; // Default: 1 top + 2 bottom horizontal
            default:
                return 'horizontal';
        }
    }

    async initializeDynamicTerminals() {
        // Check if there are any existing terminals, if not create default ones
        const activeResult = await ipcRenderer.invoke('get-active-terminals');
        if (activeResult.success && activeResult.terminals.length === 0) {
            // Add 2 terminals by default
            await this.addTerminalSilent();
            await this.addTerminalSilent();
        } else if (activeResult.success) {
            // Set the appropriate default layout based on terminal count
            const terminalCount = activeResult.terminals.length;
            // For 3 terminals, ensure we're using a 3-terminal layout
            if (terminalCount === 3 && !this.currentLayout.startsWith('3-')) {
                this.currentLayout = this.getDefaultLayout(terminalCount);
            }
            // For 2 terminals, ensure we're not using a 3-terminal layout
            else if (terminalCount === 2 && this.currentLayout.startsWith('3-')) {
                this.currentLayout = this.getDefaultLayout(terminalCount);
            }
        }
        
        await this.renderTerminals();
        await this.updateTerminalManagementButtons();
    }

    async addTerminalSilent() {
        try {
            const result = await ipcRenderer.invoke('add-terminal');
            return result.success;
        } catch (error) {
            console.error('Error adding terminal silently:', error);
            return false;
        }
    }

    moveTerminalByPosition(position, direction) {

        const allTerminals = Array.from(document.querySelectorAll('.terminal-quadrant'));
        const totalTerminals = allTerminals.length;
        
        if (direction === 'left') {
            if (position > 0) {
                // Normal case: swap with left terminal
                const currentElement = allTerminals[position];
                const leftElement = allTerminals[position - 1];
                this.swapTerminalElements(currentElement, leftElement);
            } else {
                // At leftmost position: wrap around to rightmost
                const currentElement = allTerminals[0];
                const rightmostElement = allTerminals[totalTerminals - 1];
                this.swapTerminalElements(currentElement, rightmostElement);
            }
        } else if (direction === 'right') {
            if (position < totalTerminals - 1) {
                // Normal case: swap with right terminal
                const currentElement = allTerminals[position];
                const rightElement = allTerminals[position + 1];
                this.swapTerminalElements(currentElement, rightElement);
            } else {
                // At rightmost position: wrap around to leftmost
                const currentElement = allTerminals[totalTerminals - 1];
                const leftmostElement = allTerminals[0];
                this.swapTerminalElements(currentElement, leftmostElement);
            }
        }
    }

    swapTerminalElements(element1, element2) {

        // Check if we're in a 3-terminal layout
        const allTerminals = Array.from(document.querySelectorAll('.terminal-quadrant'));
        const terminalCount = allTerminals.length;

        // Use content swap for all terminal counts - it works universally

        this.swapTerminalContent(element1, element2);
    }

    swapTerminalPositions(element1, element2) {

        // Get parent container (should be the same for both in 2-terminal layout)
        const container = element1.parentNode;
        
        if (element1.parentNode !== element2.parentNode) {
            console.error('🔄 Elements have different parents - using content swap instead');
            this.swapTerminalContent(element1, element2);
            return;
        }
        
        // Create temporary placeholder
        const temp = document.createElement('div');
        
        try {
            // Insert temp before element1
            container.insertBefore(temp, element1);
            
            // Move element1 to element2's position
            container.insertBefore(element1, element2);
            
            // Move element2 to temp's position
            container.insertBefore(element2, temp);
            
            // Remove temporary placeholder
            container.removeChild(temp);

            // Update terminal data and fit
            setTimeout(() => {
                this.reattachTerminalsAfterSwap();
                this.fitTerminalsToNewSizes();
            }, 50);
        } catch (error) {
            console.error('🔄 Error swapping DOM positions:', error);
            // Fallback to content swap
            this.swapTerminalContent(element1, element2);
        }
    }

    swapTerminalContent(element1, element2) {

        // Create temporary placeholders
        const placeholder1 = document.createElement('div');
        const placeholder2 = document.createElement('div');
        
        // Get parent containers
        const parent1 = element1.parentNode;
        const parent2 = element2.parentNode;
        
        // Insert placeholders before the elements
        parent1.insertBefore(placeholder1, element1);
        parent2.insertBefore(placeholder2, element2);
        
        // Remove elements from DOM
        element1.remove();
        element2.remove();
        
        // Insert elements in each other's places
        parent1.insertBefore(element2, placeholder1);
        parent2.insertBefore(element1, placeholder2);
        
        // Remove placeholders
        placeholder1.remove();
        placeholder2.remove();

    }

    async swapTerminals(terminalId1, terminalId2) {
        try {
            
            // Store the terminal data temporarily
            const terminal1Data = this.terminals.get(terminalId1);
            const terminal2Data = this.terminals.get(terminalId2);
            
            // Swap the terminal data in our Map
            if (terminal1Data && terminal2Data) {
                this.terminals.set(terminalId1, terminal2Data);
                this.terminals.set(terminalId2, terminal1Data);
            } else if (terminal1Data) {
                this.terminals.delete(terminalId1);
                this.terminals.set(terminalId2, terminal1Data);
            } else if (terminal2Data) {
                this.terminals.delete(terminalId2);
                this.terminals.set(terminalId1, terminal2Data);
            }
            
            // Check if we're in a 3-terminal layout
            const activeResult = await ipcRenderer.invoke('get-active-terminals');
            const terminalCount = activeResult.success ? activeResult.terminals.length : 0;
            
            if (terminalCount === 3 && this.currentLayout.startsWith('3-')) {
                // For 3-terminal layouts, use complete content swap to preserve structure
                this.swapCompleteContent(terminalId1, terminalId2);
            } else {
                // For 2 terminals and other simple layouts, use DOM position swap
                this.swapTerminalPositions(terminalId1, terminalId2);
            }
            
        } catch (error) {
            console.error('Error swapping terminals:', error);
        }
    }

    getCurrentDOMOrder() {
        // Get the actual order of terminals as they appear in the DOM
        const terminalElements = document.querySelectorAll('.terminal-quadrant');
        const currentOrder = [];
        
        terminalElements.forEach((element, index) => {
            // Get terminal ID from the title content, not the dataset
            const titleElement = element.querySelector('.terminal-title');
            if (titleElement) {
                const titleText = titleElement.textContent; // e.g., "Terminal 1"
                const match = titleText.match(/Terminal (\d+)/);
                if (match) {
                    const terminalId = parseInt(match[1]) - 1; // Convert to 0-based
                    currentOrder.push(terminalId);

                }
            }
        });

        return currentOrder;
    }

    swapTerminalPositions(terminalId1, terminalId2) {
        // Get DOM elements to swap their complete positions
        const element1 = document.querySelector(`.terminal-quadrant[data-quadrant="${terminalId1}"]`);
        const element2 = document.querySelector(`.terminal-quadrant[data-quadrant="${terminalId2}"]`);
        
        if (element1 && element2) {
            // Get parent container
            const container = element1.parentNode;
            
            // Create temporary placeholder to maintain position
            const temp = document.createElement('div');
            
            // Insert temp before element1
            container.insertBefore(temp, element1);
            
            // Move element1 to element2's position
            container.insertBefore(element1, element2);
            
            // Move element2 to temp's position (which was element1's position)
            container.insertBefore(element2, temp);
            
            // Remove temporary placeholder
            container.removeChild(temp);
            
            // Re-attach terminals and fit to new sizes
            setTimeout(() => {
                this.reattachTerminalsAfterSwap();
                this.fitTerminalsToNewSizes();
            }, 50);
        }
    }

    async updateReorderButtonStatesAfterSwap() {
        // Wait a bit for the DOM to update, then update button states
        setTimeout(async () => {
            await this.updateReorderButtonStates();
        }, 100);
    }

    reattachTerminalsAfterSwap() {
        this.terminals.forEach((terminalData, terminalId) => {
            if (terminalData && terminalData.terminal) {
                const terminalDiv = document.querySelector(`#terminal-${terminalId}`);
                if (terminalDiv) {
                    // Clear any existing content to prevent duplication
                    terminalDiv.innerHTML = '';
                    
                    // Force a reflow to ensure DOM is ready
                    terminalDiv.offsetHeight;
                    
                    terminalData.terminal.open(terminalDiv);
                    
                    if (terminalData.fitAddon) {
                        // Immediate fit
                        terminalData.fitAddon.fit();
                        
                        // Delayed fit for after render
                        setTimeout(() => {
                            terminalData.fitAddon.fit();
                        }, 50);
                        
                        // Final fit after animations
                        setTimeout(() => {
                            terminalData.fitAddon.fit();
                        }, 300);
                    }
                    
                    // Trigger a resize event to force xterm to recalculate properly
                    setTimeout(() => {
                        window.dispatchEvent(new Event('resize'));
                    }, 100);
                }
            }
        });
    }

    swapCompleteContent(terminalId1, terminalId2) {
        // Get DOM elements
        const element1 = document.querySelector(`.terminal-quadrant[data-quadrant="${terminalId1}"]`);
        const element2 = document.querySelector(`.terminal-quadrant[data-quadrant="${terminalId2}"]`);
        
        if (element1 && element2) {
            // Store complete innerHTML of both elements
            const tempHTML = element1.innerHTML;
            const tempDataQuadrant = element1.dataset.quadrant;
            const tempDataTerminalId = element1.dataset.terminalId;
            
            // Swap complete content
            element1.innerHTML = element2.innerHTML;
            element1.dataset.quadrant = element2.dataset.quadrant;
            element1.dataset.terminalId = element2.dataset.terminalId;
            
            element2.innerHTML = tempHTML;
            element2.dataset.quadrant = tempDataQuadrant;
            element2.dataset.terminalId = tempDataTerminalId;
            
            // Re-attach terminals after content swap
            setTimeout(() => {
                this.reattachTerminalsAfterSwap();
                // Just fit terminals to their new containers (no re-render)
                setTimeout(() => {
                    this.fitTerminalsToNewSizes();
                }, 100);
            }, 50);
        }
    }

    fitTerminalsToNewSizes() {
        // Fit all terminals to their current container sizes without re-rendering
        this.terminals.forEach((terminalData, terminalId) => {
            if (terminalData && terminalData.fitAddon) {
                try {
                    terminalData.fitAddon.fit();
                } catch (e) {
                    console.warn('Could not fit terminal after swap:', terminalId);
                }
            }
        });
        
        // Also re-attach event listeners for the new content
        this.attachTerminalEventListeners();
    }

    adaptTerminalSizesToNewPositions() {
        // Force re-render to make terminals adapt to their new positions
        const container = document.getElementById('terminals-container');
        if (container) {
            // Trigger a complete re-render which will apply correct CSS based on new positions
            setTimeout(async () => {
                await this.renderTerminals();
            }, 100);
        }
    }

    async create3TerminalLayout(container, activeTerminals) {
        const layout = this.currentLayout;

        switch (layout) {
            case '3-top1':
                await this.create3TerminalTop1Layout(container, activeTerminals);
                break;
            case '3-top2-horiz':
                await this.create3TerminalTop2HorizLayout(container, activeTerminals);
                break;
            case '3-left2':
                await this.create3TerminalLeft2Layout(container, activeTerminals);
                break;
            case '3-right2':
                await this.create3TerminalRight2Layout(container, activeTerminals);
                break;
            default:
                // Default to top1 layout
                await this.create3TerminalTop1Layout(container, activeTerminals);
                break;
        }
    }

    async create3TerminalTop1Layout(container, activeTerminals) {
        // Reset CSS variables to ensure 50-50 split for bottom terminals
        const mainContainer = document.getElementById('terminals-container');
        mainContainer.style.setProperty('--left-width', '50%');
        mainContainer.style.setProperty('--right-width', '50%');
        mainContainer.style.setProperty('--top-height', '50%');
        mainContainer.style.setProperty('--bottom-height', '50%');
        
        // Create 1+2 grid with separate rows
        const rowTop = document.createElement('div');
        rowTop.className = 'terminal-row-top';
        
        const rowBottom = document.createElement('div');
        rowBottom.className = 'terminal-row-bottom';
        
        // Add first terminal to top row (full width)
        const terminal1 = await this.createTerminalElement(activeTerminals[0]);
        rowTop.appendChild(terminal1);
        
        // Add remaining two terminals to bottom row
        const terminal2 = await this.createTerminalElement(activeTerminals[1]);
        const terminal3 = await this.createTerminalElement(activeTerminals[2]);
        rowBottom.appendChild(terminal2);
        rowBottom.appendChild(terminal3);
        
        // Add vertical resizer for horizontal bottom layout
        const vResizer = this.createResizer('vertical', 'bottom-row');
        rowBottom.appendChild(vResizer);
        
        // Append top row first
        container.appendChild(rowTop);
        
        // Add horizontal resizer between rows
        const hResizer = this.createResizer('horizontal');
        container.appendChild(hResizer);
        
        // Then append bottom row
        container.appendChild(rowBottom);
    }

    async create3TerminalTop2HorizLayout(container, activeTerminals) {
        // Reset CSS variables to ensure 50-50 split for top terminals
        const mainContainer = document.getElementById('terminals-container');
        mainContainer.style.setProperty('--left-width', '50%');
        mainContainer.style.setProperty('--right-width', '50%');
        mainContainer.style.setProperty('--top-height', '50%');
        mainContainer.style.setProperty('--bottom-height', '50%');
        
        // Create 2+1 grid with separate rows
        const rowTop = document.createElement('div');
        rowTop.className = 'terminal-row-top';
        
        const rowBottom = document.createElement('div');
        rowBottom.className = 'terminal-row-bottom';
        
        // Add first two terminals to top row
        const terminal1 = await this.createTerminalElement(activeTerminals[0]);
        const terminal2 = await this.createTerminalElement(activeTerminals[1]);
        rowTop.appendChild(terminal1);
        rowTop.appendChild(terminal2);
        
        // Add vertical resizer to top row
        const vResizerTop = this.createResizer('vertical', 'top-row');
        rowTop.appendChild(vResizerTop);
        
        // Add third terminal to bottom row (full width)
        const terminal3 = await this.createTerminalElement(activeTerminals[2]);
        rowBottom.appendChild(terminal3);
        
        // Append top row first
        container.appendChild(rowTop);
        
        // Add horizontal resizer between rows
        const hResizer = this.createResizer('horizontal');
        container.appendChild(hResizer);
        
        // Then append bottom row
        container.appendChild(rowBottom);
    }

    async create3TerminalLeft2Layout(container, activeTerminals) {
        // Reset all CSS variables first
        const mainContainer = document.getElementById('terminals-container');
        mainContainer.style.removeProperty('--left-width');
        mainContainer.style.removeProperty('--right-width');
        mainContainer.style.removeProperty('--top-height');
        mainContainer.style.removeProperty('--bottom-height');
        
        // Then set new values to ensure 50-50 split
        mainContainer.style.setProperty('--left-width', '50%');
        mainContainer.style.setProperty('--right-width', '50%');
        mainContainer.style.setProperty('--top-height', '50%');
        mainContainer.style.setProperty('--bottom-height', '50%');
        
        // Create left column with 2 terminals vertically
        const columnLeft = document.createElement('div');
        columnLeft.className = 'terminal-column-left';
        
        // Create right column with 1 terminal
        const columnRight = document.createElement('div');
        columnRight.className = 'terminal-column-right';
        
        // Add first terminal to left column
        const terminal1 = await this.createTerminalElement(activeTerminals[0]);
        columnLeft.appendChild(terminal1);
        
        // Add horizontal resizer BETWEEN left terminals
        const hResizerLeft = this.createResizer('horizontal', 'left-column');
        columnLeft.appendChild(hResizerLeft);
        
        // Add second terminal to left column
        const terminal2 = await this.createTerminalElement(activeTerminals[1]);
        columnLeft.appendChild(terminal2);
        
        // Add third terminal to right column
        const terminal3 = await this.createTerminalElement(activeTerminals[2]);
        columnRight.appendChild(terminal3);
        
        // Append left column first
        container.appendChild(columnLeft);
        
        // Add vertical resizer between columns
        const vResizer = this.createResizer('vertical', 'main-columns');
        container.appendChild(vResizer);
        
        // Then append right column
        container.appendChild(columnRight);
    }

    async create3TerminalRight2Layout(container, activeTerminals) {
        // Reset all CSS variables first
        const mainContainer = document.getElementById('terminals-container');
        mainContainer.style.removeProperty('--left-width');
        mainContainer.style.removeProperty('--right-width');
        mainContainer.style.removeProperty('--top-height');
        mainContainer.style.removeProperty('--bottom-height');
        
        // Then set new values to ensure 50-50 split
        mainContainer.style.setProperty('--left-width', '50%');
        mainContainer.style.setProperty('--right-width', '50%');
        mainContainer.style.setProperty('--top-height', '50%');
        mainContainer.style.setProperty('--bottom-height', '50%');
        
        // Create left column with 1 terminal
        const columnLeft = document.createElement('div');
        columnLeft.className = 'terminal-column-left';
        
        // Create right column with 2 terminals vertically
        const columnRight = document.createElement('div');
        columnRight.className = 'terminal-column-right';
        
        // Add first terminal to left column
        const terminal1 = await this.createTerminalElement(activeTerminals[0]);
        columnLeft.appendChild(terminal1);
        
        // Add first terminal to right column
        const terminal2 = await this.createTerminalElement(activeTerminals[1]);
        columnRight.appendChild(terminal2);
        
        // Add horizontal resizer BETWEEN right terminals
        const hResizerRight = this.createResizer('horizontal', 'right-column');
        columnRight.appendChild(hResizerRight);
        
        // Add second terminal to right column
        const terminal3 = await this.createTerminalElement(activeTerminals[2]);
        columnRight.appendChild(terminal3);
        
        // Append left column first
        container.appendChild(columnLeft);
        
        // Add vertical resizer between columns
        const vResizer = this.createResizer('vertical', 'main-columns');
        container.appendChild(vResizer);
        
        // Then append right column
        container.appendChild(columnRight);
    }

    async createTerminalLayoutWithResizers(container, activeTerminals) {
        const terminalCount = activeTerminals.length;
        
        if (terminalCount === 3) {
            await this.create3TerminalLayout(container, activeTerminals);
        } else if (terminalCount === 4) {
            // Create independent row structure for 4 terminals
            const row1 = document.createElement('div');
            row1.className = 'terminal-row-1';
            
            const row2 = document.createElement('div');
            row2.className = 'terminal-row-2';
            
            // Add first two terminals to row 1
            const terminal1 = await this.createTerminalElement(activeTerminals[0]);
            const terminal2 = await this.createTerminalElement(activeTerminals[1]);
            row1.appendChild(terminal1);
            row1.appendChild(terminal2);
            
            // Add last two terminals to row 2
            const terminal3 = await this.createTerminalElement(activeTerminals[2]);
            const terminal4 = await this.createTerminalElement(activeTerminals[3]);
            row2.appendChild(terminal3);
            row2.appendChild(terminal4);
            
            // Add resizers to each row
            const vResizer1 = this.createResizer('vertical', 'row-1'); // Row 1 vertical resizer
            const vResizer2 = this.createResizer('vertical', 'row-2'); // Row 2 vertical resizer
            row1.appendChild(vResizer1);
            row2.appendChild(vResizer2);
            
            // Add rows to container
            container.appendChild(row1);
            container.appendChild(row2);
            
            // Add horizontal resizer between rows
            const hResizer = this.createResizer('horizontal');
            container.appendChild(hResizer);
            
        } else {
            // Original logic for other terminal counts
            for (const terminalId of activeTerminals) {
                const terminalElement = await this.createTerminalElement(terminalId);
                container.appendChild(terminalElement);
            }
            
            // Add resizers as absolutely positioned elements
            if (terminalCount === 2) {
                // Add resizer based on current layout
                if (this.currentLayout === 'vertical') {
                    // Horizontal resizer for vertical layout
                    const hResizer = this.createResizer('horizontal');
                    container.appendChild(hResizer);
                } else {
                    // Vertical resizer for horizontal layout (default)
                    const vResizer = this.createResizer('vertical');
                    container.appendChild(vResizer);
                }
            } else if (terminalCount >= 5) {
                // Only horizontal resizer for 3x2 grid (vertical resizing between rows)
                const hResizer = this.createResizer('horizontal');
                container.appendChild(hResizer);
            }
        }
    }

    createResizer(direction, extraClass = '') {
        const resizer = document.createElement('div');
        resizer.className = `resizer ${direction}-resizer ${extraClass}`.trim();
        return resizer;
    }

    // Removed duplicate showNotification - using the main one at end of class

    // Get which terminals will be swapped for hover preview
    getSwapTargets(currentPosition, action, allTerminals) {
        const totalTerminals = allTerminals.length;
        
        if (action === 'move-left') {
            if (currentPosition > 0) {
                // Normal case: swap with left terminal
                return {
                    current: allTerminals[currentPosition],
                    target: allTerminals[currentPosition - 1]
                };
            } else {
                // At leftmost position: wrap around to rightmost
                return {
                    current: allTerminals[0],
                    target: allTerminals[totalTerminals - 1]
                };
            }
        } else if (action === 'move-right') {
            if (currentPosition < totalTerminals - 1) {
                // Normal case: swap with right terminal
                return {
                    current: allTerminals[currentPosition],
                    target: allTerminals[currentPosition + 1]
                };
            } else {
                // At rightmost position: wrap around to leftmost
                return {
                    current: allTerminals[totalTerminals - 1],
                    target: allTerminals[0]
                };
            }
        }
        
        return null;
    }

    // Highlight the terminals that will be swapped
    highlightSwapPreview(currentElement, targetElement) {

        // Add preview class to both terminals
        currentElement.classList.add('swap-preview-current');
        targetElement.classList.add('swap-preview-target');
        
        // Store reference for cleanup
        this.previewElements = { current: currentElement, target: targetElement };
    }

    // Clear the swap preview highlighting
    clearSwapPreview() {

        // Remove preview classes from all terminals
        document.querySelectorAll('.terminal-quadrant').forEach(terminal => {
            terminal.classList.remove('swap-preview-current', 'swap-preview-target');
        });
        
        // Clear stored reference
        this.previewElements = null;
    }

    // Update activity and check for completion marker

    async loadProjectsForModal() {
        try {
            const result = await ipcRenderer.invoke('project-get-all');
            if (result.success && result.projects) {
                const projectSelect = document.getElementById('task-project');
                if (!projectSelect) return;
                
                // Clear existing options except the first one
                while (projectSelect.options.length > 1) {
                    projectSelect.remove(1);
                }
                
                // Add project options
                result.projects.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project.name;
                    option.textContent = project.display_name || project.name;
                    option.style.color = project.color;
                    projectSelect.appendChild(option);
                });
                
                // Set default to CodeAgentSwarm if available
                if (projectSelect.options.length > 1) {
                    projectSelect.value = 'CodeAgentSwarm';
                }
            }
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    }

    async showSettingsModal(initialTab = null) {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;

        // Get current shell preference
        const shellPref = await ipcRenderer.invoke('get-shell-preference');
        
        // No longer need to load API key - Claude Code is used instead
        
        // Get debug mode preference
        const debugModeResult = await ipcRenderer.invoke('get-debug-mode');
        if (debugModeResult.success) {
            const debugCheckbox = document.getElementById('debug-mode-checkbox');
            debugCheckbox.checked = debugModeResult.enabled;
        }
        
        // Initialize Updates tab
        this.initializeUpdatesTab();
        
        // Re-render lucide icons after modal content is updated
        setTimeout(() => {
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            
            // Show MCP settings highlight for versions 0.0.41-0.0.44
            this.showMCPHighlightIfNeeded();
            // Show MCP badge (still needed for settings tab)
            this.showMCPServersBadge();
        }, 10);
        
        if (shellPref.success) {
            // Update system shell display
            document.getElementById('system-shell-path').textContent = shellPref.currentShell;
            
            // Dynamically update available shells
            if (shellPref.availableShells && shellPref.availableShells.length > 0) {
                const shellOptions = document.querySelector('.shell-options');
                
                // Keep system default option
                let optionsHTML = `
                    <label class="radio-option">
                        <input type="radio" name="shell-type" value="system" id="shell-system">
                        <span>System Default (<span id="system-shell-path">${shellPref.currentShell}</span>)</span>
                    </label>`;
                
                // Add detected shells
                shellPref.availableShells.forEach(shell => {
                    const shellId = `shell-${shell.name}`;
                    optionsHTML += `
                        <label class="radio-option">
                            <input type="radio" name="shell-type" value="${shell.name}" id="${shellId}">
                            <span>${shell.name.charAt(0).toUpperCase() + shell.name.slice(1)} (${shell.path})</span>
                        </label>`;
                });
                
                // Add custom option
                optionsHTML += `
                    <label class="radio-option">
                        <input type="radio" name="shell-type" value="custom" id="shell-custom">
                        <span>Custom</span>
                    </label>
                    <div class="custom-shell-input" id="custom-shell-container" style="display: none;">
                        <input type="text" id="custom-shell-path" placeholder="/path/to/shell">
                    </div>`;
                
                shellOptions.innerHTML = optionsHTML;
            }
            
            // Set the selected radio button
            const shellType = shellPref.config.type || 'system';
            const radioBtn = document.querySelector(`input[name="shell-type"][value="${shellType}"]`);
            if (radioBtn) {
                radioBtn.checked = true;
            }
            
            // Show/hide custom shell input
            const customContainer = document.getElementById('custom-shell-container');
            if (shellType === 'custom') {
                customContainer.style.display = 'block';
                document.getElementById('custom-shell-path').value = shellPref.config.path || '';
            } else {
                customContainer.style.display = 'none';
            }
        }

        // Show modal
        modal.style.display = 'block';
        // Add class to body to prevent scrolling and jumps
        document.body.classList.add('modal-open');

        // Initialize settings modal handlers
        this.initializeSettingsHandlers();
        
        // Switch to specific tab if requested
        if (initialTab) {
            const tabButton = modal.querySelector(`.tab-btn[data-tab="${initialTab}"]`);
            if (tabButton) {
                tabButton.click();
            }
            
            // Show MCP highlight if opening MCP tab directly
            if (initialTab === 'mcp-servers') {
                setTimeout(() => {
                    this.showMCPHighlightIfNeeded();
                }, 200);
            }
        }
    }

    showMCPServersBadge() {
        // Show MCP Servers badge for versions 0.0.41-0.0.48 (only in settings modal)
        if (window.featureHighlight) {
            window.featureHighlight.show({
                targetSelector: '.tab-btn[data-tab="mcp-servers"]',
                featureName: 'mcpServersTab',
                type: 'badge',
                position: 'top',
                versions: ['0.0.41', '0.0.42', '0.0.43', '0.0.44', '0.0.45', '0.0.46', '0.0.47', '0.0.48'],
                showOnce: true
            });
        }
    }

    // Badge functions removed - now using unified FeatureHighlight system
    // The FeatureHighlight class handles all badges with standardized localStorage keys:
    // Format: featureHighlight_[featureName] (no version numbers)
    showMCPHighlightIfNeeded() {
        // Check if we're in the right version range (0.0.41-0.0.48)
        const targetVersions = ['0.0.41', '0.0.42', '0.0.43', '0.0.44', '0.0.45', '0.0.46', '0.0.47', '0.0.48'];
        
        if (!window.appVersion || !targetVersions.includes(window.appVersion)) {

            return;
        }
        
        // Check if highlight has been shown before for MCP settings
        // Using standardized format: featureHighlight_[featureName]
        const storageKey = `featureHighlight_mcpSettingsHighlight`;
        if (localStorage.getItem(storageKey) === 'true') {

            return;
        }
        
        // Show highlight inside the modal for MCP features
        const mcpPanel = document.querySelector('.tab-panel[data-panel="mcp-servers"].active');
        if (!mcpPanel) {

            return;
        }
        
        // Create an in-modal highlight
        const existingHighlight = document.getElementById('mcp-modal-highlight');
        if (existingHighlight) {
            existingHighlight.remove();
        }
        
        const highlight = document.createElement('div');
        highlight.id = 'mcp-modal-highlight';
        highlight.className = 'mcp-modal-highlight';
        highlight.innerHTML = `
            <div class="mcp-highlight-content">
                <span class="mcp-highlight-badge">NEW!</span>
                <span class="mcp-highlight-text">MCP Servers now available! Add powerful integrations like filesystem access, database connections, and more.</span>
                <button class="mcp-highlight-dismiss" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;
        
        // Add styles for the highlight
        if (!document.getElementById('mcp-highlight-styles')) {
            const styles = document.createElement('style');
            styles.id = 'mcp-highlight-styles';
            styles.textContent = `
                .mcp-modal-highlight {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-radius: 8px;
                    padding: 12px 16px;
                    margin: 0 0 16px 0;
                    animation: slideDown 0.3s ease-out;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                }
                
                .mcp-highlight-content {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    color: white;
                }
                
                .mcp-highlight-badge {
                    background: rgba(255, 255, 255, 0.2);
                    color: white;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: bold;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                
                .mcp-highlight-text {
                    flex: 1;
                    font-size: 14px;
                    line-height: 1.4;
                }
                
                .mcp-highlight-dismiss {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 20px;
                    cursor: pointer;
                    opacity: 0.8;
                    transition: opacity 0.2s;
                    padding: 0;
                    width: 24px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .mcp-highlight-dismiss:hover {
                    opacity: 1;
                }
                
                @keyframes slideDown {
                    from {
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            `;
            document.head.appendChild(styles);
        }
        
        // Insert at the top of the MCP panel
        const mcpHeader = mcpPanel.querySelector('.mcp-header');
        if (mcpHeader && mcpHeader.nextSibling) {
            mcpHeader.parentNode.insertBefore(highlight, mcpHeader.nextSibling);
        } else {
            mcpPanel.insertBefore(highlight, mcpPanel.firstChild);
        }
        
        // Mark as shown
        localStorage.setItem(storageKey, 'true');

        // Auto-dismiss after 30 seconds
        setTimeout(() => {
            const element = document.getElementById('mcp-modal-highlight');
            if (element) {
                element.style.animation = 'slideDown 0.3s ease-out reverse';
                setTimeout(() => element.remove(), 300);
            }
        }, 30000);
    }

    initializeSettingsHandlers() {
        const modal = document.getElementById('settings-modal');
        if (!modal || modal.dataset.handlersInitialized === 'true') return;
        
        modal.dataset.handlersInitialized = 'true';
        
        // Add escape key handler for settings modal
        const handleEscapeKey = (e) => {
            if (e.key === 'Escape' && modal.style.display === 'block') {
                modal.style.display = 'none';
                document.body.classList.remove('modal-open');
            }
        };
        
        // Add the event listener when modal is shown
        if (!modal.dataset.escapeHandlerAdded) {
            document.addEventListener('keydown', handleEscapeKey);
            modal.dataset.escapeHandlerAdded = 'true';
        }
        
        // Initialize settings optimizer for debouncing
        if (!this.settingsOptimizer) {
            try {
                // Try to load settings optimizer if available
                const SettingsOptimizer = require('../../shared/utils/settings-optimizer');
                this.settingsOptimizer = new SettingsOptimizer();
            } catch (e) {
                // Fallback if settings-optimizer is not available in production
                console.warn('Settings optimizer not available, using fallback:', e.message);
                this.settingsOptimizer = {
                    formatChangelogOptimized: (changelog) => this.formatChangelogFallback(changelog),
                    formatChangelogFallback: (changelog) => {
                        // Simple fallback formatting for changelog
                        if (!changelog) return '';
                        
                        // Handle encoding issues
                        let cleaned = changelog
                            .replace(/â€™/g, "'")
                            .replace(/â€œ/g, '"')
                            .replace(/â€/g, '"')
                            .replace(/â€"/g, '—')
                            .replace(/â€"/g, '–')
                            .replace(/â€¦/g, '...')
                            .replace(/Â /g, ' ');
                        
                        // Convert markdown to HTML
                        const lines = cleaned.split('\n');
                        let html = '';
                        let inList = false;
                        
                        lines.forEach(line => {
                            const trimmed = line.trim();
                            
                            if (!trimmed) {
                                if (inList) {
                                    html += '</ul>';
                                    inList = false;
                                }
                                return;
                            }
                            
                            // Headers
                            if (trimmed.startsWith('## ')) {
                                if (inList) {
                                    html += '</ul>';
                                    inList = false;
                                }
                                html += `<h3 class="changelog-section">${trimmed.substring(3)}</h3>`;
                            }
                            // List items
                            else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                                if (!inList) {
                                    html += '<ul>';
                                    inList = true;
                                }
                                const content = trimmed.substring(2);
                                html += `<li>${content}</li>`;
                            }
                            // Regular paragraphs
                            else {
                                if (inList) {
                                    html += '</ul>';
                                    inList = false;
                                }
                                html += `<p>${trimmed}</p>`;
                            }
                        });
                        
                        if (inList) {
                            html += '</ul>';
                        }
                        
                        return html;
                    },
                    debounce: (func, wait) => {
                        let timeout;
                        return (...args) => {
                            clearTimeout(timeout);
                            timeout = setTimeout(() => func.apply(this, args), wait);
                        };
                    },
                    saveSettingDebounced: (key, value) => {
                        // Direct save without debouncing
                        ipcRenderer.invoke('save-setting', key, value);
                    },
                    renderVersionHistoryOptimized: async (changelogs, container) => {
                        // Fallback implementation
                        container.innerHTML = changelogs.map(changelog => {
                            // Try different possible field names for the changelog content
                            const content = changelog.changelog || changelog.changes || changelog.release_notes || '';
                            return `
                                <div class="version-history-item">
                                    <div class="version-history-header" onclick="this.parentElement.classList.toggle('expanded')">
                                        <div class="version-history-info">
                                            <span class="version-history-version">Version ${changelog.version}</span>
                                            <span class="version-history-date">${new Date(changelog.created_at || changelog.date).toLocaleDateString()}</span>
                                        </div>
                                        <i data-lucide="chevron-down" class="version-history-chevron"></i>
                                    </div>
                                    <div class="version-history-content">
                                        <div class="version-history-changelog">
                                            ${this.formatChangelogFallback(content)}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('');
                        
                        // Initialize lucide icons
                        if (window.lucide) {
                            window.lucide.createIcons();
                        }
                    }
                };
            }
        }
        
        // Handle tab switching
        const tabButtons = modal.querySelectorAll('.tab-btn');
        const tabPanels = modal.querySelectorAll('.tab-panel');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                
                // Update active states
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanels.forEach(panel => panel.classList.remove('active'));
                
                button.classList.add('active');
                const targetPanel = modal.querySelector(`.tab-panel[data-panel="${targetTab}"]`);
                if (targetPanel) {
                    targetPanel.classList.add('active');
                }
                
                // Show MCP highlight when MCP tab is opened (versions 0.0.41-0.0.44)
                if (targetTab === 'mcp-servers') {
                    setTimeout(() => {
                        // Call the method directly on terminalManager instance
                        if (window.terminalManager && window.terminalManager.showMCPHighlightIfNeeded) {
                            window.terminalManager.showMCPHighlightIfNeeded();
                        }
                    }, 100);
                }
                
                // Initialize Global Permissions Manager when permissions tab is opened
                if (targetTab === 'permissions') {
                    if (!window.globalPermissionsManager) {
                        window.globalPermissionsManager = new GlobalPermissionsFileManager();
                    } else {
                        // Refresh the permissions view
                        window.globalPermissionsManager.render();
                    }
                }
            });
        });

        // Add auto-save handlers for settings inputs with debouncing
        
        // API key input removed - Claude Code doesn't need API keys
        
        // Auto-save debug mode checkbox
        const debugCheckbox = document.getElementById('debug-mode-checkbox');
        if (debugCheckbox && !debugCheckbox.dataset.autoSaveInitialized) {
            debugCheckbox.dataset.autoSaveInitialized = 'true';
            debugCheckbox.addEventListener('change', async (e) => {
                const debugModeEnabled = e.target.checked;
                const result = await ipcRenderer.invoke('set-debug-mode', debugModeEnabled);
                
                if (result.success) {
                    // Update logger state
                    const logger = require('../../shared/logger/logger');
                    if (debugModeEnabled) {
                        logger.enable();
                    } else {
                        logger.disable();
                    }
                    
                    // Update LogViewer - create or destroy based on debug mode
                    if (debugModeEnabled) {
                        // Create LogViewer if it doesn't exist
                        if (!window.logViewer) {
                            const LogViewer = require('../components/log-viewer');
                            window.logViewer = new LogViewer();
                        }
                        window.logViewer.setDebugMode(true);
                    } else {
                        // Destroy LogViewer when debug mode is disabled
                        if (window.logViewer) {
                            window.logViewer.setDebugMode(false);
                            // Also destroy the instance to fully clean up
                            window.logViewer.destroy();
                            window.logViewer = null;
                        }
                    }
                } else {
                    // Revert checkbox on error
                    e.target.checked = !debugModeEnabled;
                    console.error('Failed to save debug mode:', result.error);
                }
            });
        }

        // Event delegation for shell type changes with auto-save
        modal.addEventListener('change', (e) => {
            if (e.target.name === 'shell-type') {
                const customContainer = document.getElementById('custom-shell-container');
                if (e.target.value === 'custom') {
                    customContainer.style.display = 'block';
                    document.getElementById('custom-shell-path').focus();
                } else {
                    customContainer.style.display = 'none';
                    // Auto-save non-custom shell type
                    const debouncedSaveShell = this.settingsOptimizer.debounce(async (shellType) => {
                        const shellConfig = { type: shellType };
                        const result = await ipcRenderer.invoke('update-shell-preference', shellConfig);
                        if (!result.success) {
                            console.error('Failed to auto-save shell preference:', result.error);
                        }
                    }, 300, 'shell-type');
                    debouncedSaveShell(e.target.value);
                }
            }
        });
        
        // Auto-save custom shell path with debouncing
        const customShellPath = document.getElementById('custom-shell-path');
        if (customShellPath && !customShellPath.dataset.autoSaveInitialized) {
            customShellPath.dataset.autoSaveInitialized = 'true';
            customShellPath.addEventListener('input', (e) => {
                const debouncedSaveCustomShell = this.settingsOptimizer.debounce(async (path) => {
                    if (path.trim()) {
                        const shellConfig = { type: 'custom', path: path.trim() };
                        const result = await ipcRenderer.invoke('update-shell-preference', shellConfig);
                        if (!result.success) {
                            console.error('Failed to auto-save custom shell path:', result.error);
                        }
                    }
                }, 500, 'custom-shell-path');
                debouncedSaveCustomShell(e.target.value);
            });
        }

        // Toggle API key visibility - using delegation
        modal.addEventListener('click', async (e) => {
            // API key visibility toggle removed - no longer needed
            
            // Handle open system notifications button
            if (e.target.closest('#open-system-notifications')) {
                ipcRenderer.send('open-system-notifications');
                return;
            }

            // Handle close button
            if (e.target.id === 'close-settings' || e.target.closest('#close-settings')) {
                modal.style.display = 'none';
                document.body.classList.remove('modal-open');
                return;
            }

            // Settings are now auto-saved, no need for save/cancel buttons

            // Click outside to close
            if (e.target === modal) {
                modal.style.display = 'none';
                document.body.classList.remove('modal-open');
            }
        });
    }
    
    async initializeUpdatesTab() {
        // Get current version
        const version = await ipcRenderer.invoke('get-app-version');
        document.getElementById('current-version').textContent = version || 'Unknown';
        
        // Set initial status
        this.updateStatus('idle');
        
        // Handle check updates button
        const checkUpdatesBtn = document.getElementById('check-updates-btn');
        if (checkUpdatesBtn && !checkUpdatesBtn.dataset.initialized) {
            checkUpdatesBtn.dataset.initialized = 'true';
            checkUpdatesBtn.addEventListener('click', async () => {
                checkUpdatesBtn.disabled = true;
                this.updateStatus('checking');
                
                try {
                    const result = await ipcRenderer.invoke('check-for-updates');
                    if (!result.success) {
                        this.updateStatus('error', result.error);
                    }
                } catch (error) {
                    this.updateStatus('error', error.message);
                } finally {
                    checkUpdatesBtn.disabled = false;
                }
            });
        }
        
        // Automatically load version history when tab is opened
        if (!this.versionHistoryLoaded) {
            this.versionHistoryLoaded = true;
            // Small delay to ensure UI is ready
            setTimeout(() => {
                this.loadVersionHistory();
            }, 100);
        }
        
        // Listen for updater events
        ipcRenderer.on('checking-for-update', () => {
            this.updateStatus('checking');
        });
        
        ipcRenderer.on('update-available', (event, info) => {
            this.updateStatus('available');
            this.showUpdateAvailable(info);
        });
        
        ipcRenderer.on('update-not-available', (event, info) => {
            this.updateStatus('up-to-date');
            this.hideAllUpdateSections();
            document.getElementById('default-update-actions').style.display = 'flex';
        });
        
        ipcRenderer.on('update-downloading', () => {
            this.updateStatus('downloading');
            this.showDownloadProgress();
        });
        
        ipcRenderer.on('update-progress', (event, progressObj) => {
            this.updateDownloadProgress(progressObj);
        });
        
        ipcRenderer.on('update-downloaded', (event, info) => {
            this.updateStatus('ready');
            this.showUpdateReady(info);
        });
        
        ipcRenderer.on('update-error', (event, errorInfo) => {
            this.updateStatus('error', errorInfo.message);
            this.hideAllUpdateSections();
            document.getElementById('default-update-actions').style.display = 'flex';
            
            // Show error notification
            this.showNotification('Update Error', errorInfo.message, 'error');
        });
        
        ipcRenderer.on('update-cancelled', () => {
            this.updateStatus('cancelled');
            this.hideAllUpdateSections();
            document.getElementById('default-update-actions').style.display = 'flex';
        });
        
        // Check update status on startup
        this.checkUpdateStatusOnStartup();
    }
    
    updateStatus(status, message = '') {
        const statusEl = document.getElementById('update-status');
        if (!statusEl) return;
        
        const statusMessages = {
            'idle': { icon: 'check-circle', text: 'Ready to check for updates' },
            'checking': { icon: 'loader-2', text: 'Checking for updates...', spin: true },
            'available': { icon: 'download', text: 'Update available!', color: '#10b981' },
            'downloading': { icon: 'download-cloud', text: 'Downloading update...', spin: true },
            'up-to-date': { icon: 'check-circle', text: 'You\'re up to date!', color: '#10b981' },
            'ready': { icon: 'package-check', text: 'Update ready to install', color: '#10b981' },
            'ready-to-install': { icon: 'package', text: 'Update will install on quit', color: '#f59e0b' },
            'cancelled': { icon: 'x-circle', text: 'Download cancelled', color: '#f59e0b' },
            'skipped': { icon: 'skip-forward', text: 'Update skipped', color: '#6b7280' },
            'error': { icon: 'alert-circle', text: message || 'Update check failed', color: '#ef4444' }
        };
        
        const config = statusMessages[status] || statusMessages.idle;
        
        // Create elements instead of using innerHTML for better performance
        statusEl.textContent = ''; // Clear existing content
        
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', config.icon);
        if (config.spin) icon.className = 'spin';
        if (config.color) icon.style.color = config.color;
        
        const span = document.createElement('span');
        span.textContent = config.text;
        
        statusEl.appendChild(icon);
        statusEl.appendChild(span);
        
        // Initialize only the new icon
        if (window.lucide) {
            window.lucide.createIcons({ el: statusEl });
        }
    }
    
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    async showUpdateAvailable(info) {
        this.hideAllUpdateSections();
        
        const section = document.getElementById('update-available-section');
        section.style.display = 'block';
        
        // Update version info
        document.getElementById('new-version').textContent = info.version;
        
        // Format release date
        if (info.releaseDate) {
            const date = new Date(info.releaseDate);
            document.getElementById('release-date').textContent = `Released ${date.toLocaleDateString()}`;
        }
        
        // Show changelog if available
        const notesEl = document.getElementById('release-notes');
        const fullscreenBtn = document.getElementById('view-changelog-fullscreen');
        
        // If changelog is missing, try to fetch it
        if (!info.changelog && !info.releaseNotes) {
            try {
                const changelog = await ipcRenderer.invoke('fetch-changelog-for-version', info.version);
                if (changelog) {
                    info.changelog = changelog;
                }
            } catch (error) {
                console.error('Failed to fetch changelog:', error);
            }
        }
        
        if (info.changelog || info.releaseNotes) {
            // Store changelog for fullscreen view
            this.currentChangelog = info.changelog || info.releaseNotes;
            
            if (info.changelog) {
                // Use the AI-generated changelog
                notesEl.innerHTML = this.formatChangelog(info.changelog);
                notesEl.style.display = 'block';
            } else if (info.releaseNotes) {
                // Fallback to release notes
                notesEl.innerHTML = this.formatReleaseNotes(info.releaseNotes);
                notesEl.style.display = 'block';
            }
            
            // Show and bind fullscreen button
            fullscreenBtn.style.display = 'inline-flex';
            fullscreenBtn.onclick = () => this.showFullscreenChangelog();
        } else {
            // If still no changelog, show a placeholder message
            notesEl.innerHTML = '<p style="color: #999; font-style: italic;">Changelog information not available</p>';
            notesEl.style.display = 'block';
            fullscreenBtn.style.display = 'none';
        }
        
        // Bind download button
        const downloadBtn = document.getElementById('download-update-btn');
        downloadBtn.onclick = async () => {
            await ipcRenderer.invoke('start-update-download');
        };
        
        // Bind skip button
        const skipBtn = document.getElementById('skip-update-btn');
        skipBtn.onclick = () => {
            this.hideAllUpdateSections();
            document.getElementById('default-update-actions').style.display = 'flex';
            this.updateStatus('skipped');
        };
    }
    
    showDownloadProgress() {
        this.hideAllUpdateSections();
        document.getElementById('update-progress').style.display = 'block';
        
        // Bind cancel button
        const cancelBtn = document.getElementById('cancel-download-btn');
        cancelBtn.onclick = async () => {
            await ipcRenderer.invoke('cancel-update-download');
        };
    }
    
    updateDownloadProgress(progressObj) {
        const percent = Math.round(progressObj.percent);
        document.getElementById('progress-fill').style.width = percent + '%';
        document.getElementById('progress-percent').textContent = percent + '%';
        
        // Show download size
        if (progressObj.transferredFormatted && progressObj.totalFormatted) {
            document.getElementById('progress-size').textContent = 
                `${progressObj.transferredFormatted} / ${progressObj.totalFormatted}`;
        }
        
        // Show speed
        if (progressObj.speedFormatted) {
            document.getElementById('progress-speed').textContent = progressObj.speedFormatted;
        }
        
        // Show ETA
        if (progressObj.eta) {
            document.getElementById('progress-eta').textContent = `ETA: ${progressObj.eta}`;
        }
    }
    
    showUpdateReady(info) {
        this.hideAllUpdateSections();
        document.getElementById('update-ready').style.display = 'block';
        
        // Bind install button
        const installBtn = document.getElementById('install-update-btn');
        installBtn.onclick = async () => {
            await ipcRenderer.invoke('install-update');
        };
        
        // Bind later button
        const laterBtn = document.getElementById('install-later-btn');
        laterBtn.onclick = () => {
            this.hideAllUpdateSections();
            document.getElementById('default-update-actions').style.display = 'flex';
            this.updateStatus('ready-to-install');
            
            // Show reminder notification
            this.showNotification(
                'Update Ready',
                'The update will be installed when you quit the app.',
                'info'
            );
        };
    }
    
    hideAllUpdateSections() {
        document.getElementById('update-available-section').style.display = 'none';
        document.getElementById('update-progress').style.display = 'none';
        document.getElementById('update-ready').style.display = 'none';
        document.getElementById('default-update-actions').style.display = 'none';
    }
    
    formatReleaseNotes(notes) {
        // Convert markdown-style notes to HTML
        return notes
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/^- (.*)/gm, '• $1')
            .replace(/^\d+\. (.*)/gm, '$1');
    }
    
    formatChangelog(changelog) {
        // Use the optimized formatter from SettingsOptimizer
        if (!this.settingsOptimizer) {
            const SettingsOptimizer = require('./settings-optimizer');
            this.settingsOptimizer = new SettingsOptimizer();
        }
        return this.settingsOptimizer.formatChangelogOptimized(changelog);
    }
    
    formatChangelogOld(changelog) {
        let listBuffer = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Headers
            if (line.match(/^## (.*?)$/)) {
                // Close any open lists
                if (inSubList) {
                    listBuffer.push('</ul>');
                    inSubList = false;
                }
                if (inList) {
                    html += '<ul class="changelog-list">' + listBuffer.join('') + '</ul>';
                    listBuffer = [];
                    inList = false;
                }
                html += line.replace(/^## (.*?)$/, '<h3 class="changelog-version">$1</h3>');
            }
            else if (line.match(/^### (.*?)$/)) {
                // Close any open lists
                if (inSubList) {
                    listBuffer.push('</ul>');
                    inSubList = false;
                }
                if (inList) {
                    html += '<ul class="changelog-list">' + listBuffer.join('') + '</ul>';
                    listBuffer = [];
                    inList = false;
                }
                html += line.replace(/^### (.*?)$/, '<h4 class="changelog-section">$1</h4>');
            }
            // Main list items (start with "- ")
            else if (line.match(/^- /)) {
                if (inSubList) {
                    listBuffer.push('</ul>');
                    inSubList = false;
                }
                inList = true;
                let content = line.substring(2);
                // Apply inline formatting
                content = this.applyInlineFormatting(content);
                listBuffer.push('<li>' + content);
            }
            // Sub-list items (start with "  • " or "  - ")
            else if (line.match(/^  [•\-] /)) {
                if (!inSubList) {
                    listBuffer.push('<ul class="changelog-sublist">');
                    inSubList = true;
                }
                let content = line.substring(4);
                // Apply inline formatting
                content = this.applyInlineFormatting(content);
                listBuffer.push('<li>' + content + '</li>');
            }
            // Empty line or other content
            else {
                // Close any open lists
                if (inSubList) {
                    listBuffer.push('</ul>');
                    inSubList = false;
                }
                if (inList && listBuffer.length > 0) {
                    html += '<ul class="changelog-list">' + listBuffer.join('') + '</ul>';
                    listBuffer = [];
                    inList = false;
                }
                
                if (line.trim() !== '') {
                    // Apply inline formatting and add as paragraph
                    html += '<p>' + this.applyInlineFormatting(line) + '</p>';
                }
            }
        }
        
        // Close any remaining open lists
        if (inSubList) {
            listBuffer.push('</ul>');
        }
        if (inList && listBuffer.length > 0) {
            html += '<ul class="changelog-list">' + listBuffer.join('') + '</ul>';
        }
        
        return `<div class="changelog-content">${html}</div>`;
    }
    
    applyInlineFormatting(text) {
        return text
            // Bold text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Italic text
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            // Code
            .replace(/`([^`]+)`/g, '<code>$1</code>');
    }
    
    showFullscreenChangelog() {
        const modal = document.getElementById('fullscreen-changelog-modal');
        const contentEl = document.getElementById('fullscreen-changelog-content');
        
        // Format and display the changelog
        if (this.currentChangelog) {
            contentEl.innerHTML = this.formatChangelog(this.currentChangelog);
        }
        
        // Show modal
        modal.style.display = 'flex';
        
        // Initialize lucide icons
        setTimeout(() => {
            if (window.lucide) {
                window.lucide.createIcons();
            }
        }, 10);
        
        // Focus on modal for keyboard events
        modal.focus();
        
        // Bind close button
        const closeBtn = document.getElementById('close-fullscreen-changelog');
        closeBtn.onclick = () => this.closeFullscreenChangelog();
        
        // Close on ESC key
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                this.closeFullscreenChangelog();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
        
        // Close on backdrop click
        modal.onclick = (e) => {
            if (e.target === modal) {
                this.closeFullscreenChangelog();
            }
        };
    }
    
    closeFullscreenChangelog() {
        const modal = document.getElementById('fullscreen-changelog-modal');
        modal.style.display = 'none';
    }
    
    async loadVersionHistory() {
        const loadingEl = document.getElementById('version-history-loading');
        const errorEl = document.getElementById('version-history-error');
        const listEl = document.getElementById('version-history-list');
        
        // Show loading state
        loadingEl.style.display = 'flex';
        errorEl.style.display = 'none';
        listEl.innerHTML = '';
        
        try {
            // Fetch version history from backend
            const history = await ipcRenderer.invoke('fetch-version-history');
            
            if (history && history.changelogs && history.changelogs.length > 0) {
                // Render version history
                this.renderVersionHistory(history.changelogs);
                loadingEl.style.display = 'none';
            } else {
                throw new Error('No version history available');
            }
        } catch (error) {
            console.error('Failed to load version history:', error);
            loadingEl.style.display = 'none';
            errorEl.style.display = 'flex';
        }
    }
    
    async renderVersionHistory(changelogs) {
        const listEl = document.getElementById('version-history-list');
        
        if (!this.settingsOptimizer) {
            const SettingsOptimizer = require('./settings-optimizer');
            this.settingsOptimizer = new SettingsOptimizer();
        }
        
        if (this.settingsOptimizer && this.settingsOptimizer.renderVersionHistoryOptimized) {
            await this.settingsOptimizer.renderVersionHistoryOptimized(changelogs, listEl);
        } else {
            // Fallback if method doesn't exist
            listEl.innerHTML = changelogs.map(changelog => `
                <div class="version-history-item">
                    <div class="version-history-version">${changelog.version}</div>
                    <div class="version-history-content">
                        ${this.formatChangelogOld ? this.formatChangelogOld(changelog.changes) : ''}
                    </div>
                </div>
            `).join('');
        }
        requestAnimationFrame(() => {
            if (window.lucide) {
                window.lucide.createIcons();
            }
            
            // Force scrollbar repaint for Electron
            // This is a workaround for Electron scrollbar lag issues
            const scrollContainer = document.getElementById('version-history-list');
            if (scrollContainer) {
                // Force a reflow by temporarily changing a style
                scrollContainer.style.display = 'none';
                scrollContainer.offsetHeight; // Force reflow
                scrollContainer.style.display = '';
                
                // Alternative: Force scroll position reset
                scrollContainer.scrollTop = 1;
                scrollContainer.scrollTop = 0;
            }
        });
    }
    
    async checkUpdateStatusOnStartup() {
        try {
            const status = await ipcRenderer.invoke('get-update-status');
            if (status.updateInfo && status.isDownloading) {
                // Resume showing download progress
                this.showDownloadProgress();
            } else if (status.updateInfo && !status.isDownloading) {
                // Show update available
                this.showUpdateAvailable(status.updateInfo);
            }
        } catch (error) {
            console.error('Failed to check update status:', error);
        }
    }
    
    showDangerNotification(quadrant) {
        // Remove any existing danger notification for this quadrant
        const existingNotification = document.querySelector(`#danger-notification-${quadrant}`);
        if (existingNotification) {
            existingNotification.remove();
        }
        
        // Create persistent danger notification
        const notification = document.createElement('div');
        notification.id = `danger-notification-${quadrant}`;
        notification.className = 'app-notification notification-warning danger-mode-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <span class="danger-icon">⚡</span>
                <strong>DANGER MODE ACTIVE</strong>
                <span class="notification-message">Terminal ${quadrant} is running in danger mode - ALL safety confirmations are disabled!</span>
                <button class="notification-close" onclick="window.terminalManager.exitDangerMode(${quadrant})">
                    Exit Danger Mode
                </button>
            </div>
        `;
        
        // Add to notification container or create one
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            document.body.appendChild(container);
        }
        
        container.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Track active danger terminals
        if (!this.dangerTerminals) {
            this.dangerTerminals = new Set();
        }
        this.dangerTerminals.add(quadrant);
    }
    
    exitDangerMode(quadrant) {
        // Remove danger notification
        const notification = document.querySelector(`#danger-notification-${quadrant}`);
        if (notification) {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }
        
        // Remove from tracking
        if (this.dangerTerminals) {
            this.dangerTerminals.delete(quadrant);
        }
        
        // TODO: Actually exit danger mode in the terminal
        this.showNotification('Danger mode disabled for Terminal ' + quadrant, 'success');
    }
    
    showNotification(title, message, type = 'info') {
        // Handle both 2-parameter and 3-parameter calls
        if (typeof message === 'undefined' || (typeof message === 'string' && ['info', 'error', 'warning', 'success'].includes(message))) {
            // 2-parameter call: showNotification(message, type)
            type = message || 'info';
            message = title;
            title = '';
        }
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `app-notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                ${title ? `<strong>${title}</strong>` : ''}
                <span class="notification-message">${message}</span>
                <button class="notification-close">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
        `;
        
        // Add to notification container or create one
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            document.body.appendChild(container);
        }
        
        container.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Close button handler
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn.addEventListener('click', () => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        });
        
        // Auto-hide after 7 seconds
        setTimeout(() => {
            if (document.body.contains(notification)) {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 300);
            }
        }, 7000);
    }
    
    async showAlert(message, type = 'info') {
        // Use Electron's dialog with app icon
        const result = await ipcRenderer.invoke('show-alert', {
            message,
            type
        });
        return result;
    }

}

// Listen for dev mode status from main process
ipcRenderer.on('dev-mode-status', (event, isDevMode) => {
    if (isDevMode) {
        // Enable logger
        const logger = require('../../shared/logger/logger');
        logger.enable();
        
        // Initialize LogViewer if not already initialized
        if (window.logViewer) {
            // LogViewer already exists, just enable debug mode
            window.logViewer.setDebugMode(true);
        } else {
            // Create LogViewer if it doesn't exist
            const LogViewer = require('../components/log-viewer');
            window.logViewer = new LogViewer();
            window.logViewer.setDebugMode(true);
        }
    }
});

// Initialize the terminal manager when the DOM is loaded
// Feature highlights configuration
const FEATURE_HIGHLIGHTS_CONFIG = [
    {
        featureName: 'tabbedMode',
        targetSelector: '#tabbed-mode-btn',
        type: 'badge',  // Changed to badge type
        position: 'bottom',  // Changed to bottom so it's visible
        versions: ['0.0.38', '0.0.39', '0.0.41', '0.0.42', '0.0.43', '0.0.44', '0.0.45', '0.0.46', '0.0.47', '0.0.48', '0.0.49'],
        showOnce: true,
        // NOTE: tabbedMode uses cross-version tracking - shows only ONCE across all versions
        // If user sees it in 0.0.38, won't show again in 0.0.39-0.0.49
        delay: 500 // Delay before showing
    },
    {
        featureName: 'permissionsButton',
        targetSelector: '#permissions-btn',
        type: 'badge',
        position: 'bottom',
        versions: ['0.0.45', '0.0.46', '0.0.47', '0.0.48', '0.0.49'],
        showOnce: true,
        delay: 600 // Slight delay to ensure button is rendered
    },
    // Add more features here in the future:
    // {
    //     featureName: 'someNewFeature',
    //     targetSelector: '#some-button',
    //     message: 'Check out this new feature!',
    //     position: 'left',
    //     duration: 20000,
    //     showInVersions: ['0.0.39', '0.0.40'], // Can show in multiple versions
    //     delay: 1000
    // }
];

// Initialize feature highlights
async function initializeFeatureHighlights() {
    // Get app version from main process
    try {
        const appVersion = await ipcRenderer.invoke('get-app-version');
        window.appVersion = appVersion; // Make it available globally

        // Badges are now configured in FEATURE_HIGHLIGHTS_CONFIG
    } catch (error) {
        console.warn('Could not get app version:', error);
    }
    
    // Create global instance for development testing
    window.featureHighlight = new FeatureHighlight();
    
    // Initialize update notification manager
    window.updateNotificationManager = new UpdateNotificationManager();

    // Process all configured highlights
    FEATURE_HIGHLIGHTS_CONFIG.forEach(config => {
        // Check if this feature should be shown in current version
        // DEV MODE: Uncomment next line to always show highlights in dev
        // if (true) {  // TEMPORARY: Always show in dev
        const showInVersions = config.versions || config.showInVersions || [];
        if (showInVersions.includes(window.appVersion)) {
            setTimeout(() => {
                window.featureHighlight.show({
                    targetSelector: config.targetSelector,
                    featureName: config.featureName,
                    type: config.type || 'highlight',
                    message: config.message,
                    position: config.position,
                    duration: config.duration,
                    versions: showInVersions,
                    showOnce: config.showOnce !== undefined ? config.showOnce : true
                });

            }, config.delay || 500);
        } else {

        }
    });
    
    // For development: expose test functions in console
    if (window.location.href.includes('--dev') || process.env.ENABLE_DEBUG_LOGS) {
        // Development mode features could go here
    }
}

// Main initialization code
document.addEventListener('DOMContentLoaded', async () => {
    // Get loading screen element
    const loadingScreen = document.getElementById('loading-screen');
    
    // Set flag to indicate fresh app start
    window.isAppFreshStart = true;
    
    // Clear terminal titles from localStorage on fresh app start
    // This ensures we don't keep old titles when the app restarts

    for (let i = 1; i <= 6; i++) {
        const titleKey = `terminal_title_${i}`;
        const taskKey = `terminal_task_${i}`;
        if (localStorage.getItem(titleKey)) {

            localStorage.removeItem(titleKey);
        }
        if (localStorage.getItem(taskKey)) {
            localStorage.removeItem(taskKey);
        }
    }

    // Also clear old terminal title notifications from the file
    // This prevents them from being re-processed and put back into localStorage
    try {
        await ipcRenderer.invoke('clear-old-terminal-title-notifications');

    } catch (error) {
        console.error('Error clearing old terminal title notifications:', error);
    }
    
    // Clear the flag after a delay to allow mode switches later
    setTimeout(() => {
        window.isAppFreshStart = false;

    }, 5000); // 5 seconds should be enough for initial setup
    
    try {
        window.terminalManager = new TerminalManager();
        
        // Initialize dynamic terminals
        await window.terminalManager.initializeDynamicTerminals();
        
        // Initialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        
        // Re-initialize icons after a short delay to ensure all elements are rendered
        setTimeout(() => {
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            
            // Hide loading screen after everything is ready
            if (loadingScreen) {
                loadingScreen.style.transition = 'opacity 0.3s';
                loadingScreen.style.opacity = '0';
                setTimeout(() => {
                    loadingScreen.style.display = 'none';
                }, 300);
            }
            
            // Initialize feature highlights after UI is ready
            initializeFeatureHighlights();
        }, 100);
    } catch (error) {
        console.error('Error during initialization:', error);
        // Still hide loading screen on error
        if (loadingScreen) {
            loadingScreen.style.display = 'none';
        }
    }
    
    // Sync debug mode state from settings FIRST
    let debugEnabled = false;
    try {
        const debugModeResult = await ipcRenderer.invoke('get-debug-mode');
        if (debugModeResult.success) {
            debugEnabled = debugModeResult.enabled;
            const logger = require('../../shared/logger/logger');
            if (debugEnabled) {
                logger.enable();
            } else {
                logger.disable();
            }
        }
    } catch (error) {
        console.error('Error syncing debug mode:', error);
    }
    
    // Clean up any orphan log viewer elements from previous sessions
    if (!debugEnabled) {
        const orphanButton = document.querySelector('.log-viewer-button');
        if (orphanButton) {

            orphanButton.remove();
        }
        const orphanContainer = document.querySelector('.log-viewer-container');
        if (orphanContainer) {

            orphanContainer.remove();
        }
    }
    
    // Initialize LogViewer ONLY if debug mode is enabled
    if (debugEnabled && !window.logViewer) {
        window.logViewer = new LogViewer();
        window.logViewer.setDebugMode(true);
    }
    
    // Start performance monitoring in dev mode
    const urlParams = new URLSearchParams(window.location.search);
    const isDevMode = urlParams.get('dev') || process.argv?.includes?.('--dev');
    
    if (isDevMode) {
        const PerformanceMonitor = loadPerformanceMonitor();
        if (PerformanceMonitor) {

            const perfMonitor = new PerformanceMonitor();
            perfMonitor.startMonitoring();
            
            // Wrap critical functions with performance measurement
            const tm = window.terminalManager;
            
            tm.resizeAllTerminals = perfMonitor.measureFunction(
                'resizeAllTerminals',
                tm.resizeAllTerminals.bind(tm)
            );
            
            window.perfMonitor = perfMonitor; // Expose for debugging
        }
    }

    // Listen for keyboard shortcuts from main process
    ipcRenderer.on('add-terminal-shortcut', () => {
        const addTerminalBtn = document.getElementById('add-terminal-btn');
        if (addTerminalBtn) {
            addTerminalBtn.click();
        }
    });

    ipcRenderer.on('create-task-shortcut', () => {
        const createTaskBtn = document.getElementById('create-task-btn');
        if (createTaskBtn) {
            createTaskBtn.click();
        }
    });

    ipcRenderer.on('git-status-shortcut', () => {
        const gitStatusBtn = document.getElementById('git-status-btn');
        if (gitStatusBtn) {
            gitStatusBtn.click();
        }
    });
    
    // Handle opening a new terminal with a task
    ipcRenderer.on('open-terminal-for-task', async (event, terminalId, taskData) => {

        if (!window.terminalManager) {
            console.error('Terminal manager not initialized');
            return;
        }
        
        // Try to find a project directory for automatic initialization
        const projectDirs = await window.terminalManager.findProjectDirectories(taskData.project);
        const selectedDir = projectDirs && projectDirs.length > 0 ? projectDirs[0] : null;
        
        // FIRST: Always check if there are uninitialized terminals we can use
        const uninitializedTerminal = await window.terminalManager.findUninitializedTerminal();
        if (uninitializedTerminal !== null) {

            // Store task data for this terminal
            if (!window.pendingTerminalTasks) {
                window.pendingTerminalTasks = {};
            }
            window.pendingTerminalTasks[uninitializedTerminal] = taskData;
            
            // In tabbed mode, make this terminal active
            if (window.terminalManager.layoutMode === 'tabbed') {
                window.terminalManager.activeTabTerminal = uninitializedTerminal;
                window.terminalManager.switchToTerminal(uninitializedTerminal);
            }
            
            if (selectedDir) {
                // Directly start the terminal with the project directory
                // Use 'dangerous' mode if specified in taskData, otherwise 'new'
                const mode = taskData.mode === 'danger' ? 'dangerous' : 'new';
                window.terminalManager.startTerminal(uninitializedTerminal, selectedDir, mode);
            } else {
                // Show directory selector if no directory found

                window.terminalManager.showDirectorySelector(uninitializedTerminal);
            }
        } else {
            // Need to add a new terminal

            const result = await ipcRenderer.invoke('add-terminal');
            
            if (result.success) {
                const newTerminalId = result.terminalId;

                // Initialize pendingTerminalTasks if not already initialized
                if (!window.pendingTerminalTasks) {
                    window.pendingTerminalTasks = {};

                }
                
                window.pendingTerminalTasks[newTerminalId] = taskData;

                // In tabbed mode, set active terminal before rendering
                if (window.terminalManager.layoutMode === 'tabbed' && newTerminalId !== undefined) {
                    window.terminalManager.activeTabTerminal = newTerminalId;

                }
                
                // Render terminals
                await window.terminalManager.renderTerminals();
                await window.terminalManager.updateTerminalManagementButtons();
                
                // Now initialize the terminal with the directory if we have one
                if (selectedDir) {

                    // Small delay to ensure DOM is ready
                    setTimeout(() => {
                        // Use 'dangerous' mode if specified in taskData, otherwise 'new'
                        const mode = taskData.mode === 'danger' ? 'dangerous' : 'new';
                        window.terminalManager.startTerminal(newTerminalId, selectedDir, mode);
                    }, 200);
                } else {
                    // The placeholder will be shown and user can select directory

                }
            } else {
                // Failed to add terminal
                console.error('❌ Failed to add new terminal:', result.error || 'Unknown error');
                const errorMsg = result.error || 'Failed to create new terminal';
                
                // Show error notification if kanban is available
                if (window.kanban && window.kanban.showNotification) {
                    window.kanban.showNotification(errorMsg, 'error', 3000);
                }
            }
        }
        
        // The task will be sent once Claude is ready (handled in terminal output handler)
    });
    
    // Debug functions for terminal titles
    window.checkTerminalTitles = () => {

        for (let i = 1; i <= 6; i++) {
            const title = localStorage.getItem(`terminal_title_${i}`);
            const taskId = localStorage.getItem(`terminal_task_${i}`);

            localStorage.removeItem(`terminal_task_${i}`);
        }

        return 'Cleared';
    };
    
    window.testTerminalTitle = (terminalId = 1, title = 'Test Title') => {

        localStorage.setItem(`terminal_title_${terminalId}`, title);
        localStorage.setItem(`terminal_task_${terminalId}`, '999');
        
        // Update UI - tm is the TerminalManager instance
        const quadrant = terminalId - 1;
        if (window.terminalManager) {
            window.terminalManager.updateTerminalTitle(quadrant, title);
            window.terminalManager.updateTerminalTaskIndicator(terminalId);
        } else {
            console.warn('TerminalManager not available yet. Title saved to localStorage only.');
        }

        return 'Test applied';
    };
    
    // Function to manually reload terminal title notifications
    window.reloadTerminalTitles = async () => {

        try {
            const fs = require('fs');
            const path = require('path');
            const os = require('os');
            
            const notificationFile = path.join(os.homedir(), '.codeagentswarm', 'task_notifications.json');
            
            if (fs.existsSync(notificationFile)) {
                const content = fs.readFileSync(notificationFile, 'utf8');
                const notifications = JSON.parse(content);
                
                // Find terminal_title_update notifications
                const titleNotifications = notifications.filter(n => n.type === 'terminal_title_update');

                // Process each notification
                titleNotifications.forEach(notification => {
                    const { terminal_id, title, task_id } = notification;

                    // Save to localStorage
                    localStorage.setItem(`terminal_title_${terminal_id}`, title);
                    if (task_id) {
                        localStorage.setItem(`terminal_task_${terminal_id}`, task_id);
                    }
                    
                    // Update UI
                    const quadrant = terminal_id - 1;
                    if (window.terminalManager) {
                        window.terminalManager.updateTerminalTitle(quadrant, title);
                        if (task_id) {
                            window.terminalManager.updateTerminalTaskIndicator(terminal_id);
                        }
                    }
                });

                return 'Reloaded';
            } else {

                return 'File not found';
            }
        } catch (error) {
            console.error('Error reloading terminal titles:', error);
            return 'Error';
        }
    };

    // Initialize MCP Settings Manager
    initializeMCPSettings();
}); // Close DOMContentLoaded event listener

// ================== MCP Settings Initialization ==================
function initializeMCPSettings() {
    try {
        // Load the MCP modules
        const MCPValidator = require('../../modules/mcp/MCPValidator');
        const MCPManager = require('../../modules/mcp/MCPManager');
        const MCPRenderer = require('../../modules/mcp/MCPRenderer');
        const MCPMarketplace = require('../../modules/mcp/MCPMarketplace');
        
        // Create instances
        const validator = new MCPValidator();
        const manager = new MCPManager(ipcRenderer, validator);
        const renderer = new MCPRenderer(manager);
        const marketplace = new MCPMarketplace(manager);
        
        // Store globally for debugging
        window.mcpManager = manager;
        window.mcpRenderer = renderer;
        window.mcpMarketplace = marketplace;
        
        // Get containers
        const marketplaceContainer = document.getElementById('mcp-marketplace-container');
        
        // Initialize when settings modal is opened
        const settingsBtn = document.getElementById('settings-btn');
        const mcpTab = document.querySelector('[data-tab="mcp-servers"]');
        
        let mcpInitialized = false;
        let marketplaceInitialized = false;
        
        const initMCP = async () => {
            if (!mcpInitialized) {

                await renderer.initialize();
                mcpInitialized = true;

            }
        };
        
        const initMarketplace = async () => {
            if (!marketplaceInitialized && marketplaceContainer) {

                await marketplace.render(marketplaceContainer);
                marketplaceInitialized = true;

            }
        };
        
        // Initialize MCP when MCP tab is clicked
        if (mcpTab) {
            mcpTab.addEventListener('click', async () => {
                await initMCP();
            });
        }
        
        // Add permissions button functionality
        const editPermissionsBtn = document.getElementById('edit-permissions-btn');
        if (editPermissionsBtn) {
            editPermissionsBtn.addEventListener('click', async () => {
                // Open permissions modal
                const permissionsModal = new MCPPermissionsModal();
                await permissionsModal.show();
            });
        }
        
        // Add marketplace modal functionality
        const openMarketplaceBtn = document.getElementById('open-marketplace-btn');
        const marketplaceModal = document.getElementById('marketplace-modal');
        const closeMarketplaceBtn = document.getElementById('close-marketplace');
        const newMarketplaceContainer = document.getElementById('mcp-marketplace-container');
        
        if (openMarketplaceBtn && marketplaceModal) {
            openMarketplaceBtn.addEventListener('click', async () => {
                // Show modal
                marketplaceModal.style.display = 'flex';
                document.body.classList.add('modal-open');
                
                // Initialize marketplace if needed
                if (!marketplaceInitialized && newMarketplaceContainer) {
                    await marketplace.render(newMarketplaceContainer);
                    marketplaceInitialized = true;
                }
            });
        }
        
        if (closeMarketplaceBtn && marketplaceModal) {
            closeMarketplaceBtn.addEventListener('click', () => {
                marketplaceModal.style.display = 'none';
                document.body.classList.remove('modal-open');
            });
        }
        
        // Close modal on background click
        if (marketplaceModal) {
            marketplaceModal.addEventListener('click', (e) => {
                if (e.target === marketplaceModal) {
                    marketplaceModal.style.display = 'none';
                    document.body.classList.remove('modal-open');
                }
            });
            
            // Close modal on Escape key press
            const handleEscapeKey = (e) => {
                if (e.key === 'Escape' && marketplaceModal.style.display === 'flex') {
                    marketplaceModal.style.display = 'none';
                    document.body.classList.remove('modal-open');
                }
            };
            
            document.addEventListener('keydown', handleEscapeKey);
        }
        
        // Also initialize if settings is opened directly to MCP tab
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                // Check if MCP tab is active after a short delay
                setTimeout(async () => {
                    const activeMCPTab = document.querySelector('.tab-btn[data-tab="mcp-servers"].active');
                    
                    if (activeMCPTab) {
                        await initMCP();
                    }
                }, 100);
            });
        }
        
        // Listen for manage server events from marketplace
        window.addEventListener('mcp-manage-server', async (event) => {
            const { serverId } = event.detail;
            
            // Switch to MCP Settings tab
            const mcpTab = document.querySelector('[data-tab="mcp-servers"]');
            const mcpPanel = document.querySelector('[data-panel="mcp-servers"]');
            
            if (mcpTab && mcpPanel) {
                // Remove active from all tabs and panels
                document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
                
                // Activate MCP tab
                mcpTab.classList.add('active');
                mcpPanel.classList.add('active');
                
                // Initialize MCP if needed
                await initMCP();
                
                // Highlight the server (optional)
                setTimeout(() => {
                    const serverCard = document.querySelector(`[data-server="${serverId}"]`);
                    if (serverCard) {
                        serverCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        serverCard.classList.add('highlight');
                        setTimeout(() => serverCard.classList.remove('highlight'), 2000);
                    }
                }, 100);
            }
        });

    } catch (error) {
        console.error('Failed to initialize MCP Settings:', error);
    }
}
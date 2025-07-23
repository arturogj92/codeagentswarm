const { ipcRenderer } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const { WebLinksAddon } = require('xterm-addon-web-links');

console.log('🔧 [RENDERER] renderer.js loaded');

// Performance monitor function - lazy loaded
function loadPerformanceMonitor() {
    try {
        return require('./performance-monitor');
    } catch (e) {
        console.log('Performance monitor not available (production build)');
        return null;
    }
}

class TerminalManager {
    constructor() {
        this.terminals = new Map();
        this.activeTerminal = null;
        this.fullscreenTerminal = null;
        this.currentLayout = 'horizontal'; // Default layout for 2 terminals
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
        this.setupEventListeners();
        this.setupResizeHandlers();
        this.setupGlobalTerminalFocusDetection(); // Add global focus detection
        this.updateGitButtonVisibility(); // Initialize git button visibility
        this.startTaskIndicatorUpdates(); // Initialize task indicators with periodic updates
        this.checkHooksStatus(); // Check hooks status on startup
        this.startHooksStatusUpdates(); // Periodically check hooks status
        
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
            console.log('Confirmation needed via webhook:', data);
            const { terminalId, tool } = data;
            if (terminalId !== null && terminalId >= 0 && terminalId < 4) {
                this.terminalsNeedingAttention.add(terminalId);
                this.updateNotificationBadge();
                this.highlightTerminalForConfirmation(terminalId);
                this.scrollTerminalToBottom(terminalId);
            }
        });
        
        ipcRenderer.on('claude-finished', (event, data) => {
            console.log('Claude finished via webhook:', data);
            const { terminalId } = data;
            if (terminalId !== null && terminalId >= 0 && terminalId < 4) {
                this.highlightTerminal(terminalId);
                this.scrollTerminalToBottom(terminalId);
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
                this.updateTaskIndicators();
            } else {
                // Keep error notification as it's important
                this.showNotification(`Failed to create task: ${result.error}`, 'error');
            }
        });
        
        // Listen for refresh tasks
        ipcRenderer.on('refresh-tasks', () => {
            this.updateTaskIndicators();
        });
        
        // Listen for badge notifications
        ipcRenderer.on('display-badge', (event, message) => {
            this.showBadgeNotification(message);
        });
    }

    setupEventListeners() {
        document.getElementById('add-terminal-btn').addEventListener('click', () => {
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


        document.getElementById('mcp-info-btn').addEventListener('click', () => {
            this.showMCPInfoModal();
        });

        document.querySelectorAll('.terminal-placeholder').forEach(placeholder => {
            placeholder.addEventListener('click', (e) => {
                const quadrant = parseInt(e.currentTarget.dataset.quadrant);
                this.showDirectorySelector(quadrant);
            });
        });

        document.querySelectorAll('.terminal-control-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = e.target.dataset.action;
                const quadrant = parseInt(e.target.closest('.terminal-quadrant').dataset.quadrant);
                
                if (action === 'fullscreen') {
                    this.toggleFullscreen(quadrant);
                } else if (action === 'close') {
                    this.closeTerminal(quadrant);  // async pero no necesita await aquí
                }
            });
        });

        document.addEventListener('keydown', (e) => {
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
                        console.log(`🎯 Setting active terminal to ${quadrantId} from mousedown on:`, e.target);
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

    async showDirectorySelector(quadrant) {
        const wrapper = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-wrapper`);
        
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
        
        // Build recent projects HTML - Show only last 4 projects
        let recentProjectsHTML = '';
        if (projects.length > 0) {
            // Take only the last 4 projects
            const recentProjects = projects.slice(-4);
            recentProjectsHTML = `
                <div class="recent-projects-section">
                    <h4>Recent Projects</h4>
                    <div class="recent-projects-list">
                        ${recentProjects.map(project => `
                            <div class="recent-project-item" data-project-path="${project.path}" data-project-name="${project.name}">
                                <button class="delete-project-btn" data-project-name="${project.name}" title="Remove from recent projects">×</button>
                                <div class="project-info">
                                    <span class="project-color-indicator" style="background-color: ${project.color}"></span>
                                    <span class="project-name">${project.display_name || project.name}</span>
                                    <span class="project-path">${project.path}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        selectorDiv.innerHTML = `
            <div class="directory-selector-content">
                <h3>Select Working Directory</h3>
                <div class="directory-selector-main">
                    <div class="directory-selector-left">
                        ${recentProjectsHTML}
                    </div>
                    <div class="directory-selector-right">
                        ${this.lastSelectedDirectories[quadrant] ? `
                            <div class="last-directory-section">
                                <div class="last-directory-label">Last used:</div>
                                <div class="selected-directory-display clickable last-directory" id="last-directory-display">
                                    ${this.lastSelectedDirectories[quadrant]}
                                </div>
                            </div>
                        ` : ''}
                        <div class="selected-directory-display clickable" id="directory-display">
                            ${this.lastSelectedDirectories[quadrant] ? 'Click to select different directory' : 'Click to select directory'}
                        </div>
                        <div class="directory-selector-buttons">
                            <button class="btn" id="choose-dir-btn">Browse...</button>
                            ${this.lastSelectedDirectories[quadrant] ? '<button class="btn btn-primary" id="use-last-btn">Use Last</button>' : ''}
                            <button class="btn" id="cancel-btn">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        wrapper.appendChild(selectorDiv);
        
        // Function to restore placeholder if cancelled
        const restorePlaceholder = () => {
            if (wrapper.contains(selectorDiv)) {
                wrapper.removeChild(selectorDiv);
            }
            if (!wrapper.querySelector('.terminal-placeholder') && !wrapper.querySelector('.terminal')) {
                wrapper.innerHTML = `
                    <div class="terminal-placeholder" data-quadrant="${quadrant}">
                        <div class="terminal-placeholder-icon">⚡</div>
                        <div>Click to start Claude Code</div>
                    </div>
                `;
                wrapper.querySelector('.terminal-placeholder').addEventListener('click', (e) => {
                    const quadrant = parseInt(e.currentTarget.dataset.quadrant);
                    this.showDirectorySelector(quadrant);
                });
            }
        };

        // Function to handle directory selection
        const selectDirectory = async () => {
            const selectedDir = await ipcRenderer.invoke('select-directory');
            if (selectedDir) {
                this.lastSelectedDirectories[quadrant] = selectedDir;
                this.saveDirectoryToStorage(quadrant, selectedDir); // Save to database
                
                // After selecting directory, show session selector
                wrapper.removeChild(selectorDiv);
                this.showSessionSelector(quadrant, selectedDir);
            } else {
                // User cancelled, restore placeholder
                restorePlaceholder();
            }
        };

        // Handle browse button
        selectorDiv.querySelector('#choose-dir-btn').addEventListener('click', selectDirectory);
        
        // Handle clickable directory display
        selectorDiv.querySelector('#directory-display').addEventListener('click', selectDirectory);
        
        // Handle last directory click (if exists)
        const lastDirectoryDisplay = selectorDiv.querySelector('#last-directory-display');
        if (lastDirectoryDisplay) {
            lastDirectoryDisplay.addEventListener('click', () => {
                wrapper.removeChild(selectorDiv);
                this.showSessionSelector(quadrant, this.lastSelectedDirectories[quadrant]);
            });
        }
        
        // Handle use last button if it exists
        const useLastBtn = selectorDiv.querySelector('#use-last-btn');
        if (useLastBtn) {
            useLastBtn.addEventListener('click', () => {
                wrapper.removeChild(selectorDiv);
                this.showSessionSelector(quadrant, this.lastSelectedDirectories[quadrant]);
            });
        }
        
        // Handle cancel button
        selectorDiv.querySelector('#cancel-btn').addEventListener('click', () => {
            restorePlaceholder();
        });
        
        // Handle recent project clicks
        selectorDiv.querySelectorAll('.recent-project-item').forEach(projectItem => {
            projectItem.addEventListener('click', (e) => {
                // Don't trigger if clicking on delete button
                if (e.target.classList.contains('delete-project-btn')) {
                    return;
                }
                
                const projectPath = projectItem.dataset.projectPath;
                const projectName = projectItem.dataset.projectName;
                
                // Update last selected directory
                this.lastSelectedDirectories[quadrant] = projectPath;
                this.saveDirectoryToStorage(quadrant, projectPath);
                
                // Remove selector and show session selector
                wrapper.removeChild(selectorDiv);
                this.showSessionSelector(quadrant, projectPath);
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
        
        // Handle Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape' && wrapper.contains(selectorDiv)) {
                restorePlaceholder();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    showSessionSelector(quadrant, selectedDirectory) {
        const wrapper = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-wrapper`);
        
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
                        🔄 Resume
                    </button>
                    <button class="btn" id="new-session-btn">
                        ✨ New
                    </button>
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

        // Handle resume session
        selectorDiv.querySelector('#resume-session-btn').addEventListener('click', () => {
            wrapper.removeChild(selectorDiv);
            this.startTerminal(quadrant, selectedDirectory, 'resume');
        });

        // Handle new session
        selectorDiv.querySelector('#new-session-btn').addEventListener('click', () => {
            wrapper.removeChild(selectorDiv);
            this.startTerminal(quadrant, selectedDirectory, 'new');
        });

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

    async startTerminal(quadrant, selectedDirectory, sessionType = 'resume') {
        const quadrantElement = document.querySelector(`[data-quadrant="${quadrant}"]`);
        const wrapper = quadrantElement.querySelector('.terminal-wrapper');
        const placeholder = wrapper.querySelector('.terminal-placeholder');
        
        if (placeholder) {
            placeholder.remove();
        }

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
        
        // Set a timeout to show terminal even if Claude Code doesn't start
        setTimeout(() => {
            if (!this.claudeCodeReady[quadrant]) {
                // Timeout reached, showing terminal
                const timeoutLoader = document.getElementById(`loader-${quadrant}`);
                const timeoutTerminalDiv = document.getElementById(`terminal-${quadrant}`);
                
                if (timeoutLoader && timeoutTerminalDiv) {
                    timeoutLoader.style.display = 'none';
                    timeoutTerminalDiv.style.display = 'block';
                    
                    const terminalInfo = this.terminals.get(quadrant);
                    if (terminalInfo && terminalInfo.fitAddon) {
                        terminalInfo.fitAddon.fit();
                    }
                }
            }
        }, 5000); // 5 seconds timeout

        // Create embedded terminal with xterm.js
        const terminalDiv = document.createElement('div');
        terminalDiv.className = 'terminal';
        terminalDiv.id = `terminal-${quadrant}`;
        terminalDiv.style.display = 'none';
        wrapper.appendChild(terminalDiv);

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
            cursorBlink: true,
            cursorStyle: 'block',
            scrollback: 1000,
            allowTransparency: true,
            cols: 100,
            rows: 30,
            // Disable bracketed paste mode to prevent ~200/~201 escape sequences
            bracketedPasteMode: false
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();
        
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(webLinksAddon);
        
        terminal.open(terminalDiv);
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
            await ipcRenderer.invoke('create-terminal', quadrant, selectedDirectory, sessionType);
        } catch (error) {
            console.error('Failed to create terminal:', error);
            this.showNotification('Failed to create terminal', 'error');
            return;
        }
        
        // Focus the terminal
        terminal.focus();
        
        // Handle terminal input with debug
        terminal.onData(data => {
            ipcRenderer.send('terminal-input', quadrant, data);
            
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
        
        // Handle paste events to ensure clean paste without bracketed paste mode sequences
        terminal.attachCustomKeyEventHandler((event) => {
            // Intercept paste events
            if (event.type === 'keydown' && event.ctrlKey && event.key === 'v') {
                // Let the default paste handler work, but with bracketedPasteMode disabled
                return true;
            }
            return true;
        });

        // Handle terminal output
        ipcRenderer.on(`terminal-output-${quadrant}`, (event, data) => {
            terminal.write(data);
        });

        // Handle terminal exit
        ipcRenderer.on(`terminal-exit-${quadrant}`, (event, code) => {
            terminal.write(`\r\n\x1b[31mTerminal exited with code: ${code}\x1b[0m\r\n`);
        });

        // Handle terminal resize
        terminal.onResize(({ cols, rows }) => {
            ipcRenderer.send('terminal-resize', quadrant, cols, rows);
        });

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
        
        // Add click event to terminal header for color selection
        const terminalHeader = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-header`);
        if (terminalHeader) {
            terminalHeader.addEventListener('click', (e) => {
                // Only show color picker if clicking on the header itself (not controls)
                if (!e.target.closest('.terminal-controls') && 
                    !e.target.closest('.git-branch-display') && 
                    !e.target.closest('.current-task')) {
                    this.showColorPicker(quadrant, e);
                }
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

    }


    highlightTerminal(quadrant) {
        const terminalElement = document.querySelector(`[data-quadrant="${quadrant}"]`);
        if (terminalElement) {
            terminalElement.classList.add('confirmation-highlight');
            setTimeout(() => {
                terminalElement.classList.remove('confirmation-highlight');
            }, 3000);
        }
    }

    scrollTerminalToBottom(quadrant) {
        const terminal = this.terminals.get(quadrant);
        if (terminal && terminal.terminal) {
            // Use the stored scroll function if available
            if (terminal.terminal.scrollToBottomFn) {
                terminal.terminal.scrollToBottomFn();
            } else {
                // Fallback: direct scroll
                terminal.terminal.scrollToBottom();
                
                // Also try to scroll the viewport
                const terminalDiv = terminal.element;
                if (terminalDiv) {
                    const viewport = terminalDiv.querySelector('.xterm-viewport');
                    if (viewport) {
                        viewport.scrollTop = viewport.scrollHeight;
                    }
                }
            }
        }
    }

    showNotification(message, type = 'info') {
        // Notificaciones internas deshabilitadas - solo notificaciones externas permitidas
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
        
        // Trigger animation
        setTimeout(() => {
            badge.classList.add('show');
        }, 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            badge.classList.remove('show');
            setTimeout(() => {
                if (badge.parentNode) {
                    badge.parentNode.removeChild(badge);
                }
            }, 300);
        }, 3000);
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
        const titleElement = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-title`);
        if (titleElement) {
            // Add terminal number before the title
            const terminalNumber = quadrant + 1;
            titleElement.textContent = `${terminalNumber} · ${title}`;
        }
        
        // Update terminal header color based on project
        this.updateTerminalHeaderColor(quadrant);
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
        const terminalHeader = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-header`);
        if (!terminalHeader) return;
        
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
        
        // Get the project name for this terminal
        const projectName = this.getTerminalProjectName(quadrant);
        
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
                    <button class="close-btn" id="close-color-picker">×</button>
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
        const closeModal = () => {
            modal.remove();
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
        
        console.log(`🗑️ Closing terminal ${quadrant}...`);
        
        // Clean up Claude Code state
        if (this.claudeCodeReady) {
            this.claudeCodeReady[quadrant] = false;
        }
        
        // Dispose xterm.js terminal first
        if (terminal && terminal.terminal) {
            console.log(`🗑️ Disposing xterm.js terminal ${quadrant}`);
            terminal.terminal.dispose();
        }
        
        // If Claude was active, send force kill to ensure cleanup
        if (isClaudeActive) {
            console.log(`🗑️ Sending force kill signal for Claude session in terminal ${quadrant}`);
            ipcRenderer.send('kill-terminal', quadrant, true);
        }
        
        // Use the standard terminal removal system (like terminals without sessions)
        await this.removeTerminal(quadrant, true);
        
        // Update git button visibility
        this.updateGitButtonVisibility();
        
        console.log(`✅ Terminal ${quadrant} closed completely`);
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
                
                console.log(`Terminal ${quadrant} resized to: ${cols}x${rows}`);
                
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
                
                console.log(`Force resized terminal ${quadrant} to: ${cols}x${rows}`);
                
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
        // Create scroll to bottom button
        const scrollBtn = document.createElement('button');
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
                } else {
                    scrollBtn.classList.remove('show');
                }
            };
            
            // Check scroll position on scroll events
            viewport.addEventListener('scroll', () => {
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
        try {
            // First scan for projects with changes
            const scanResult = await ipcRenderer.invoke('scan-git-projects');
            
            if (scanResult.success && scanResult.projects.length > 0) {
                // Show project selection modal
                this.displayProjectSelectionModal(scanResult.projects);
            } else if (scanResult.success && scanResult.projects.length === 0) {
                if (!this.hasActiveTerminals()) {
                    this.showNotification('No active terminals. Open a terminal first to scan for git changes.', 'info');
                } else {
                    this.showNotification('No git projects with changes found in active terminals', 'info');
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
    }


    showMCPInfoModal() {
        // Remove existing modal if present
        const existingModal = document.querySelector('.mcp-info-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'mcp-info-modal';
        modal.innerHTML = `
            <div class="mcp-info-content">
                <div class="mcp-info-header">
                    <h3><i data-lucide="info"></i> MCP Tips & Information</h3>
                    <button class="close-btn" id="close-mcp-info-modal">×</button>
                </div>
                <div class="mcp-info-body">
                    <div class="info-section">
                        <h4><i data-lucide="alert-circle"></i> MCP Connection Issues</h4>
                        <p>If <code>/mcp</code> command doesn't work in Claude Code:</p>
                        <ul>
                            <li>Try restarting your terminal - MCP connections can sometimes disconnect</li>
                            <li>Close and reopen Claude Code to refresh the connection</li>
                            <li>Make sure CodeAgentSwarm is running</li>
                        </ul>
                    </div>
                    
                    <div class="info-section">
                        <h4><i data-lucide="terminal"></i> About Claude Code</h4>
                        <p>Claude Code is a terminal application that gets updated regularly. If the functionality changes:</p>
                        <ul>
                            <li>CodeAgentSwarm may need updates to maintain compatibility</li>
                            <li>Check for CodeAgentSwarm updates when Claude Code updates</li>
                            <li>Report issues on our GitHub repository</li>
                        </ul>
                    </div>
                    
                    <div class="info-section">
                        <h4><i data-lucide="zap"></i> Quick Tips</h4>
                        <ul>
                            <li>MCP tools are available via <code>/mcp</code> command in Claude Code</li>
                            <li>Task management is integrated with your terminal workflow</li>
                            <li>Each terminal can have its own active task</li>
                            <li>Tasks automatically sync between terminals and the Kanban board</li>
                        </ul>
                    </div>
                    
                    <div class="info-section">
                        <h4><i data-lucide="bell-off"></i> Notifications</h4>
                        <p>Desktop notifications may not always work properly depending on your system settings:</p>
                        <ul>
                            <li>Check your system notification settings</li>
                            <li>Make sure CodeAgentSwarm has permission to show notifications</li>
                            <li>Some systems may block Electron app notifications</li>
                            <li>Task status changes are always visible in the Kanban board</li>
                        </ul>
                        <button class="btn btn-secondary" id="open-system-notifications">
                            <i data-lucide="settings"></i> Open System Notification Settings
                        </button>
                    </div>
                </div>
                <div class="mcp-info-footer">
                    <button class="btn btn-primary" id="close-mcp-info-btn">Got it!</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        
        // Initialize Lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }

        // Add event listeners
        const closeModal = () => {
            modal.remove();
        };

        modal.querySelector('#close-mcp-info-modal').addEventListener('click', closeModal);
        modal.querySelector('#close-mcp-info-btn').addEventListener('click', closeModal);

        // Add handler for system notifications button
        const notificationsBtn = modal.querySelector('#open-system-notifications');
        if (notificationsBtn) {
            notificationsBtn.addEventListener('click', () => {
                ipcRenderer.send('open-system-notifications');
            });
        }

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
        }, 10);
    }

    showCreateTaskDialog() {
        // Remove existing modal if present
        const existingModal = document.querySelector('.create-task-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Get active terminal
        const activeTerminalId = this.activeTerminal;
        const terminalId = activeTerminalId !== null ? activeTerminalId + 1 : null;

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'create-task-modal';
        modal.innerHTML = `
            <div class="create-task-content">
                <div class="create-task-header">
                    <h3><i data-lucide="plus-square"></i> Create New Task</h3>
                    <button class="close-btn" id="close-create-task-modal">
                        <i data-lucide="x"></i>
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
                                <option value="">No terminal assigned</option>
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
        document.getElementById('close-create-task-modal').addEventListener('click', () => {
            modal.remove();
        });

        document.getElementById('cancel-create-task').addEventListener('click', () => {
            modal.remove();
        });

        document.getElementById('confirm-create-task').addEventListener('click', () => {
            const title = document.getElementById('task-title').value.trim();
            const description = document.getElementById('task-description').value.trim();
            const project = document.getElementById('task-project').value;
            const terminalId = document.getElementById('task-terminal').value;

            if (!title) {
                alert('Please enter a task title');
                return;
            }

            // Send task creation request
            ipcRenderer.send('create-task', {
                title,
                description: description || undefined,
                project: project || undefined,
                terminal_id: terminalId ? parseInt(terminalId) : undefined
            });

            modal.remove();
        });

        // Allow Enter key to create task
        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('confirm-create-task').click();
            }
        });

        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    displayProjectSelectionModal(projects) {
        // Remove existing modal if present
        const existingModal = document.querySelector('.git-project-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'git-project-modal';
        modal.innerHTML = `
            <div class="git-project-content">
                <div class="git-project-header">
                    <h3><i data-lucide="git-branch"></i> Git Projects</h3>
                    <button class="close-btn" id="close-project-modal">×</button>
                </div>
                
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
                                </div>
                                <div class="project-details">
                                    <span class="project-branch">
                                        <i data-lucide="git-branch"></i> ${project.branch}
                                    </span>
                                    <span class="project-changes">
                                        <i data-lucide="file-diff"></i> ${project.changeCount} changes
                                    </span>
                                    ${project.terminalId ? `
                                        <span class="project-terminal">
                                            <i data-lucide="terminal"></i> Terminal ${project.terminalId}
                                        </span>
                                    ` : ''}
                                </div>
                                <div class="project-path">${project.path}</div>
                            </div>
                            <button class="btn btn-primary btn-small open-project">
                                <i data-lucide="arrow-right"></i> Open
                            </button>
                        </div>
                    `).join('')}
                </div>
                
                <div class="git-project-footer">
                    <button class="btn btn-secondary" id="use-current-dir">
                        <i data-lucide="folder"></i> Use Current Directory
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Initialize Lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }

        // Add event listeners
        document.getElementById('close-project-modal').addEventListener('click', () => {
            modal.remove();
        });

        document.getElementById('refresh-projects').addEventListener('click', async () => {
            modal.remove();
            await this.showGitStatus();
        });

        document.getElementById('use-current-dir').addEventListener('click', async () => {
            modal.remove();
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
                modal.remove();
                
                // Get git status for selected project
                const result = await ipcRenderer.invoke('get-project-git-status', projectPath);
                if (result.success) {
                    this.displayGitStatusModal(result);
                } else {
                    this.showNotification(result.error || 'Failed to get project status', 'warning');
                }
            });
        });

        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    displayGitStatusModal(gitData) {
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
                    <button class="close-btn" id="close-git-modal">×</button>
                </div>
                
                <div class="git-info">
                    <div class="git-branch">
                        <span class="git-label">Branch:</span>
                        <span class="git-value">${gitData.branch || 'unknown'}</span>
                    </div>
                    <div class="git-directory">
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
                                    <h4>Modified Files (${gitData.files.length})</h4>
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
                                                    <input type="checkbox" class="file-checkbox" ${file.staged ? 'checked' : ''} data-file="${file.file}">
                                                    <span class="file-status file-status-${file.status.toLowerCase()}">${file.status}</span>
                                                    <span class="file-name">${file.file}</span>
                                                </div>
                                                <div class="file-actions">
                                                    <button class="btn-small" onclick="terminalManager.showFileDiff('${file.file}', '${gitData.workingDirectory}')"><i data-lucide="eye"></i> Diff</button>
                                                    <button class="btn-small btn-danger" onclick="terminalManager.discardFileChanges('${file.file}', '${file.status}', '${gitData.workingDirectory}')"><i data-lucide="x"></i> Discard</button>
                                                </div>
                                            </div>
                                        `).join('')
                                    }
                                </div>
                                ${gitData.files.length > 0 ? `
                                    <div class="commit-section">
                                        <textarea id="commit-message" placeholder="Enter commit message..." rows="3"></textarea>
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

        // Add event listeners
        const closeModal = () => {
            modal.remove();
        };

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
            modal.remove();
            this.showGitStatus();
        });
        
        modal.querySelector('#git-pull')?.addEventListener('click', () => this.gitPullProject());
        modal.querySelector('#git-push')?.addEventListener('click', () => this.gitPushProject());
        
        // Store project path for git operations
        this.currentGitProject = gitData.workingDirectory;
        
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
            const result = await ipcRenderer.invoke('git-diff', fileName, workingDirectory);
            
            if (result.success) {
                this.displayDiffModal(fileName, result.diff);
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
                    <button class="close-btn" id="close-diff-modal">×</button>
                </div>
                <div class="diff-body">
                    <pre class="diff-text">${this.formatDiff(diff)}</pre>
                </div>
                <div class="diff-actions">
                    <button class="btn" id="close-diff-btn">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const closeModal = () => modal.remove();
        modal.querySelector('#close-diff-modal').addEventListener('click', closeModal);
        modal.querySelector('#close-diff-btn').addEventListener('click', closeModal);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
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
    
    async discardFileChanges(fileName, fileStatus = 'Modified', workingDirectory) {
        const isUntracked = fileStatus === 'Untracked';
        const action = isUntracked ? 'delete' : 'discard all changes to';
        const confirmMessage = `Are you sure you want to ${action} '${fileName}'? This action cannot be undone.`;
        
        if (!confirm(confirmMessage)) {
            return;
        }
        
        try {
            const actionText = isUntracked ? 'Deleting' : 'Discarding changes to';
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
        const hasUntrackedFiles = gitStatus.success && gitStatus.files.some(f => f.status === 'Untracked');
        
        let includeUntracked = false;
        
        if (hasUntrackedFiles) {
            // Create a custom dialog for three options
            const confirmMessage = 'You have untracked files. What would you like to do?\n\n' +
                '• Click OK to discard ALL changes INCLUDING untracked files (⚠️ untracked files will be permanently deleted)\n' +
                '• Click Cancel to discard ONLY changes to tracked files (untracked files will remain)\n\n' +
                'Close this dialog to cancel the operation.';
            
            includeUntracked = confirm(confirmMessage);
        } else {
            const confirmMessage = 'Are you sure you want to discard ALL changes? This action cannot be undone and will remove all modifications to tracked files.';
            
            if (!confirm(confirmMessage)) {
                return;
            }
        }
        
        try {
            this.showInlineNotification('🔄 Discarding changes...', 'info');
            const result = await ipcRenderer.invoke('git-discard-all', includeUntracked);
            
            if (result.success) {
                const message = includeUntracked ? 
                    '✅ All changes and untracked files discarded' : 
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
            const branchDisplay = document.getElementById(`git-branch-display-${terminalId}`);
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
                    <button class="close-btn" id="close-branch-modal">×</button>
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
            const taskIndicator = document.getElementById(`current-task-${quadrant}`);
            
            if (!taskIndicator) return;

            if (result.success && result.task) {
                const task = result.task;
                const taskText = taskIndicator.querySelector('.task-text');
                
                if (taskText) {
                    taskText.textContent = `#${task.id} ${task.title}`;
                    taskIndicator.style.display = 'flex';
                    taskIndicator.title = `Click to open Task #${task.id}: ${task.title}${task.description ? '\n' + task.description : ''}`;
                    
                    // Remove any existing click listener and add new one
                    const newTaskIndicator = taskIndicator.cloneNode(true);
                    taskIndicator.parentNode.replaceChild(newTaskIndicator, taskIndicator);
                    
                    // Add click event to open task manager with this task
                    newTaskIndicator.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.openTaskInKanban(task.id);
                    });
                }
            } else {
                taskIndicator.style.display = 'none';
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
            
            console.log('Hooks status:', this.hooksStatus);
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
            if (result.success && result.notifications && result.notifications.length > 0) {
                result.notifications.forEach(notification => {
                    if (notification.type === 'task_completed') {
                        // Desktop notification removed - only update indicators
                        // Immediately update task indicators to reflect the change
                        this.updateCurrentTaskIndicators();
                    }
                });
            }
        } catch (error) {
            // Silently fail - this is just for notifications
            console.log('Notification check failed:', error);
        }
    }

    // Dynamic terminal management
    async addTerminal() {
        try {
            const result = await ipcRenderer.invoke('add-terminal');
            if (result.success) {
                await this.renderTerminals();
                await this.updateTerminalManagementButtons();
                // Sin notificación al añadir terminal
                
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
                await this.renderTerminals();
                await this.updateTerminalManagementButtons();
                
                // Reparar controles después de eliminar terminal
                setTimeout(() => {
                    this.repairTerminalControls();
                }, 200);
                
                if (!silent) {
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

    async renderTerminals() {
        try {
            console.log('🔄 Rendering terminals...');
            const activeResult = await ipcRenderer.invoke('get-active-terminals');
            console.log('📊 Active terminals result:', activeResult);
            
            if (!activeResult.success) {
                console.error('Failed to get active terminals');
                return;
            }

            const container = document.getElementById('terminals-container');
            const activeTerminals = activeResult.terminals;

            console.log(`📋 Found ${activeTerminals.length} active terminals:`, activeTerminals);

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
            console.log('💾 Preserved terminal info:', preservedInfo);

            // Update container class for layout while preserving existing layout classes
            container.className = `terminals-container count-${activeTerminals.length}`;
            
            // Re-apply layout class if set
            if (activeTerminals.length === 2 && this.currentLayout === 'vertical') {
                container.classList.add('layout-vertical');
            } else if (activeTerminals.length === 3 && this.currentLayout.startsWith('3-')) {
                container.classList.add(`layout-${this.currentLayout}`);
            }
            
            // Clear existing content
            container.innerHTML = '';

            if (activeTerminals.length === 0) {
                console.log('📭 No terminals - showing empty state');
                // Show empty state
                container.innerHTML = `
                    <div class="empty-state">
                        <h2>No Terminals Active</h2>
                        <p>Click the + button to add your first terminal</p>
                    </div>
                `;
                return;
            }

            console.log('🏗️ Creating terminal elements with resizers...');
            // Create terminal elements with resizers
            this.createTerminalLayoutWithResizers(container, activeTerminals);

            // Restore preserved terminal information
            console.log('🔄 Restoring terminal information...');
            activeTerminals.forEach(terminalId => {
                const info = preservedInfo[terminalId];
                if (info) {
                    // Restore title
                    if (info.title !== `Terminal ${terminalId + 1}`) {
                        this.updateTerminalTitle(terminalId, info.title);
                    }
                    
                    // Restore project styling if it existed
                    if (info.directory && info.hasProjectStyling) {
                        this.updateTerminalHeaderColor(terminalId);
                    }
                }
            });

            console.log('🎨 Re-initializing Lucide icons...');
            // Re-initialize Lucide icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }

            console.log('🔗 Re-attaching event listeners...');
            // Re-attach event listeners
            this.attachTerminalEventListeners();
            
            // Restore task indicators and git branch displays
            this.updateCurrentTaskIndicators();
            this.updateGitButtonVisibility();
            
            // Resize all terminals after rendering
            setTimeout(() => {
                this.resizeAllTerminals();
            }, 100);

            console.log('✅ Terminal rendering completed');

        } catch (error) {
            console.error('❌ Error rendering terminals:', error);
        }
    }

    createTerminalElement(terminalId) {
        const element = document.createElement('div');
        element.className = 'terminal-quadrant';
        element.dataset.quadrant = terminalId;
        element.dataset.terminalId = terminalId;
        
        // Check if terminal already exists
        const existingTerminal = this.terminals.get(terminalId);
        const hasActiveTerminal = existingTerminal && existingTerminal.terminal;
        
        element.innerHTML = `
            <div class="terminal-header">
                <div style="display: flex; align-items: center; flex: 1;">
                    <span class="terminal-title">Terminal ${terminalId + 1}</span>
                    <div class="current-task" id="current-task-${terminalId}" style="display: none;">
                        <i data-lucide="play-circle"></i>
                        <span class="task-text"></span>
                    </div>
                    <div class="git-branch-display" id="git-branch-display-${terminalId}" style="display: none;">
                        <i data-lucide="git-branch"></i>
                        <span class="current-branch-name">main</span>
                        <button class="branch-switch-btn" data-terminal="${terminalId}" title="Switch/Create Branch">
                            <i data-lucide="chevron-down"></i>
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
                    <button class="terminal-control-btn" data-action="fullscreen" title="Fullscreen">⛶</button>
                    <button class="terminal-control-btn" data-action="close" title="Close">×</button>
                </div>
            </div>
            <div class="terminal-wrapper">
                ${hasActiveTerminal ? 
                    `<div class="terminal" id="terminal-${terminalId}"></div>` :
                    `<div class="terminal-placeholder" data-quadrant="${terminalId}">
                        <div class="terminal-placeholder-icon">⚡</div>
                        <div>Click to start Claude Code</div>
                    </div>`
                }
            </div>
        `;

        // If terminal exists, reattach it after element is in DOM
        if (hasActiveTerminal) {
            setTimeout(() => {
                const terminalDiv = element.querySelector(`#terminal-${terminalId}`);
                if (terminalDiv && existingTerminal.terminal) {
                    // Make sure the terminal div is visible
                    terminalDiv.style.display = 'block';
                    // Reopen the terminal in the new element
                    existingTerminal.terminal.open(terminalDiv);
                    if (existingTerminal.fitAddon) {
                        existingTerminal.fitAddon.fit();
                    }
                }
            }, 0);
        }

        return element;
    }

    attachTerminalEventListeners() {
        // Re-attach placeholder listeners
        document.querySelectorAll('.terminal-placeholder').forEach(placeholder => {
            placeholder.addEventListener('click', (e) => {
                const quadrant = parseInt(e.currentTarget.dataset.quadrant);
                this.showDirectorySelector(quadrant);
            });
        });


        // Re-attach control button listeners
        document.querySelectorAll('.terminal-control-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = e.target.dataset.action;
                const quadrant = parseInt(e.target.closest('.terminal-quadrant').dataset.quadrant);
                
                if (action === 'fullscreen') {
                    this.toggleFullscreen(quadrant);
                } else if (action === 'close') {
                    this.closeTerminal(quadrant);  // async pero no necesita await aquí
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

    setLayout(layout) {
        console.log('setLayout called with:', layout);
        
        const validLayouts = ['horizontal', 'vertical', '3-top1', '3-top2-horiz', '3-left2', '3-right2'];
        if (!validLayouts.includes(layout)) return;
        
        // Set flag to prevent notification re-triggering during layout change
        this.isChangingLayout = true;
        
        this.currentLayout = layout;
        const container = document.getElementById('terminals-container');
        console.log('Container found:', container);
        
        // Remove all layout classes first
        container.classList.remove('layout-vertical', 'layout-3-top1', 'layout-3-top2-horiz', 'layout-3-left2', 'layout-3-right2');
        
        // Update container classes based on layout
        if (layout === 'vertical') {
            container.classList.add('layout-vertical');
            console.log('Added layout-vertical class');
        } else if (layout.startsWith('3-')) {
            container.classList.add(`layout-${layout}`);
            console.log(`Added layout-${layout} class`);
        }
        
        // Update button states
        this.updateLayoutButtons();
        
        // Re-render terminals with new layout
        this.renderTerminals();
        
        // Reparar controles después de cambiar layout
        setTimeout(() => {
            this.repairTerminalControls();
            // Clear the flag after layout change is complete
            this.isChangingLayout = false;
        }, 200);
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
        console.log(`🔄 moveTerminalByPosition: position ${position} direction ${direction}`);
        
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
        console.log('🔄 Swapping elements');
        
        // Check if we're in a 3-terminal layout
        const allTerminals = Array.from(document.querySelectorAll('.terminal-quadrant'));
        const terminalCount = allTerminals.length;
        console.log('🔄 Detected terminal count:', terminalCount);
        
        // Use content swap for all terminal counts - it works universally
        console.log('🔄 Using content swap for', terminalCount, 'terminals');
        this.swapTerminalContent(element1, element2);
    }

    swapTerminalPositions(element1, element2) {
        console.log('🔄 Swapping DOM positions for 2 terminals');
        
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
            
            console.log('🔄 DOM positions swapped successfully');
            
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
        console.log('🔄 Swapping terminals by physically moving DOM elements');
        
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
        
        console.log('🔄 Terminals physically swapped - everything preserved');
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
                    console.log(`🔄 Position ${index}: Terminal ${terminalId} (${titleText})`);
                }
            }
        });
        
        console.log('🔄 Current DOM order:', currentOrder);
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
                    terminalData.terminal.open(terminalDiv);
                    if (terminalData.fitAddon) {
                        terminalData.fitAddon.fit();
                    }
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

    create3TerminalLayout(container, activeTerminals) {
        const layout = this.currentLayout;
        console.log('Creating 3-terminal layout:', layout);
        
        switch (layout) {
            case '3-top1':
                this.create3TerminalTop1Layout(container, activeTerminals);
                break;
            case '3-top2-horiz':
                this.create3TerminalTop2HorizLayout(container, activeTerminals);
                break;
            case '3-left2':
                this.create3TerminalLeft2Layout(container, activeTerminals);
                break;
            case '3-right2':
                this.create3TerminalRight2Layout(container, activeTerminals);
                break;
            default:
                // Default to top1 layout
                this.create3TerminalTop1Layout(container, activeTerminals);
                break;
        }
    }

    create3TerminalTop1Layout(container, activeTerminals) {
        // Reset CSS variables to ensure 50-50 split for bottom terminals
        const mainContainer = document.getElementById('terminals-container');
        mainContainer.style.setProperty('--left-width', '50%');
        mainContainer.style.setProperty('--right-width', '50%');
        
        // Create 1+2 grid with separate rows
        const rowTop = document.createElement('div');
        rowTop.className = 'terminal-row-top';
        
        const rowBottom = document.createElement('div');
        rowBottom.className = 'terminal-row-bottom';
        
        // Add first terminal to top row (full width)
        const terminal1 = this.createTerminalElement(activeTerminals[0]);
        rowTop.appendChild(terminal1);
        
        // Add remaining two terminals to bottom row
        const terminal2 = this.createTerminalElement(activeTerminals[1]);
        const terminal3 = this.createTerminalElement(activeTerminals[2]);
        rowBottom.appendChild(terminal2);
        rowBottom.appendChild(terminal3);
        
        // Add vertical resizer for horizontal bottom layout
        const vResizer = this.createResizer('vertical', 'bottom-row');
        rowBottom.appendChild(vResizer);
        
        // Append rows to container
        container.appendChild(rowTop);
        container.appendChild(rowBottom);
        
        // Add horizontal resizer between rows
        const hResizer = this.createResizer('horizontal');
        container.appendChild(hResizer);
    }

    create3TerminalTop2HorizLayout(container, activeTerminals) {
        // Reset CSS variables to ensure 50-50 split for top terminals
        const mainContainer = document.getElementById('terminals-container');
        mainContainer.style.setProperty('--left-width', '50%');
        mainContainer.style.setProperty('--right-width', '50%');
        
        // Create 2+1 grid with separate rows
        const rowTop = document.createElement('div');
        rowTop.className = 'terminal-row-top';
        
        const rowBottom = document.createElement('div');
        rowBottom.className = 'terminal-row-bottom';
        
        // Add first two terminals to top row
        const terminal1 = this.createTerminalElement(activeTerminals[0]);
        const terminal2 = this.createTerminalElement(activeTerminals[1]);
        rowTop.appendChild(terminal1);
        rowTop.appendChild(terminal2);
        
        // Add vertical resizer to top row
        const vResizerTop = this.createResizer('vertical', 'top-row');
        rowTop.appendChild(vResizerTop);
        
        // Add third terminal to bottom row (full width)
        const terminal3 = this.createTerminalElement(activeTerminals[2]);
        rowBottom.appendChild(terminal3);
        
        // Append rows to container
        container.appendChild(rowTop);
        container.appendChild(rowBottom);
        
        // Add horizontal resizer between rows
        const hResizer = this.createResizer('horizontal');
        container.appendChild(hResizer);
    }

    create3TerminalLeft2Layout(container, activeTerminals) {
        // Reset CSS variables to ensure 50-50 split
        const mainContainer = document.getElementById('terminals-container');
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
        
        // Add first two terminals to left column
        const terminal1 = this.createTerminalElement(activeTerminals[0]);
        const terminal2 = this.createTerminalElement(activeTerminals[1]);
        columnLeft.appendChild(terminal1);
        columnLeft.appendChild(terminal2);
        
        // Add horizontal resizer between left terminals
        const hResizerLeft = this.createResizer('horizontal', 'left-column');
        columnLeft.appendChild(hResizerLeft);
        
        // Add third terminal to right column
        const terminal3 = this.createTerminalElement(activeTerminals[2]);
        columnRight.appendChild(terminal3);
        
        // Append columns to container
        container.appendChild(columnLeft);
        container.appendChild(columnRight);
        
        // Add vertical resizer between columns
        const vResizer = this.createResizer('vertical', 'main-columns');
        container.appendChild(vResizer);
    }

    create3TerminalRight2Layout(container, activeTerminals) {
        // Reset CSS variables to ensure 50-50 split
        const mainContainer = document.getElementById('terminals-container');
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
        const terminal1 = this.createTerminalElement(activeTerminals[0]);
        columnLeft.appendChild(terminal1);
        
        // Add remaining two terminals to right column
        const terminal2 = this.createTerminalElement(activeTerminals[1]);
        const terminal3 = this.createTerminalElement(activeTerminals[2]);
        columnRight.appendChild(terminal2);
        columnRight.appendChild(terminal3);
        
        // Add horizontal resizer between right terminals
        const hResizerRight = this.createResizer('horizontal', 'right-column');
        columnRight.appendChild(hResizerRight);
        
        // Append columns to container
        container.appendChild(columnLeft);
        container.appendChild(columnRight);
        
        // Add vertical resizer between columns
        const vResizer = this.createResizer('vertical', 'main-columns');
        container.appendChild(vResizer);
    }

    createTerminalLayoutWithResizers(container, activeTerminals) {
        const terminalCount = activeTerminals.length;
        
        if (terminalCount === 3) {
            this.create3TerminalLayout(container, activeTerminals);
        } else if (terminalCount === 4) {
            // Create independent row structure for 4 terminals
            const row1 = document.createElement('div');
            row1.className = 'terminal-row-1';
            
            const row2 = document.createElement('div');
            row2.className = 'terminal-row-2';
            
            // Add first two terminals to row 1
            const terminal1 = this.createTerminalElement(activeTerminals[0]);
            const terminal2 = this.createTerminalElement(activeTerminals[1]);
            row1.appendChild(terminal1);
            row1.appendChild(terminal2);
            
            // Add last two terminals to row 2
            const terminal3 = this.createTerminalElement(activeTerminals[2]);
            const terminal4 = this.createTerminalElement(activeTerminals[3]);
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
            activeTerminals.forEach(terminalId => {
                const terminalElement = this.createTerminalElement(terminalId);
                container.appendChild(terminalElement);
            });
            
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

    showNotification(title, message, type = 'info') {
        // Simple notification system
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <strong>${title}</strong>
                <p>${message}</p>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

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
        console.log('🎨 Highlighting swap preview');
        
        // Add preview class to both terminals
        currentElement.classList.add('swap-preview-current');
        targetElement.classList.add('swap-preview-target');
        
        // Store reference for cleanup
        this.previewElements = { current: currentElement, target: targetElement };
    }

    // Clear the swap preview highlighting
    clearSwapPreview() {
        console.log('🎨 Clearing swap preview');
        
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

}

// Listen for dev mode status from main process
ipcRenderer.on('dev-mode-status', (event, isDevMode) => {
    if (isDevMode) {
        const devIndicator = document.getElementById('dev-indicator');
        if (devIndicator) {
            devIndicator.style.display = 'block';
        }
    }
});

// Initialize the terminal manager when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    window.terminalManager = new TerminalManager();
    
    // Initialize dynamic terminals
    await window.terminalManager.initializeDynamicTerminals();
    
    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
    
    // Start performance monitoring in dev mode
    const urlParams = new URLSearchParams(window.location.search);
    const isDevMode = urlParams.get('dev') || process.argv?.includes?.('--dev');
    
    if (isDevMode) {
        const PerformanceMonitor = loadPerformanceMonitor();
        if (PerformanceMonitor) {
            console.log('🚀 Starting Performance Monitor...');
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
});
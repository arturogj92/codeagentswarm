const { ipcRenderer } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const { WebLinksAddon } = require('xterm-addon-web-links');

class TerminalManager {
    constructor() {
        this.terminals = new Map();
        this.activeTerminal = null;
        this.fullscreenTerminal = null;
        this.lastSelectedDirectories = {}; // Initialize empty, will load async
        this.lastConfirmationMessages = new Map(); // Track last confirmation per terminal
        this.confirmationDebounce = new Map(); // Debounce confirmations
        this.confirmedCommands = new Map(); // Track which commands already notified
        this.lastMenuContent = new Map(); // Track last menu content per terminal
        this.notificationBlocked = new Map(); // Block notifications until user interaction
        this.waitingForUserInteraction = new Map(); // Track terminals waiting for interaction
        this.terminalFocused = new Map(); // Track which terminals are focused
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
    }

    setupEventListeners() {

        document.getElementById('clear-all-btn').addEventListener('click', () => {
            this.clearAllTerminals();
        });

        document.getElementById('settings-btn').addEventListener('click', () => {
            this.showSettings();
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
                    this.closeTerminal(quadrant);
                }
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.fullscreenTerminal !== null) {
                this.exitFullscreen();
            }
        });

        window.addEventListener('resize', () => {
            this.resizeAllTerminals();
        });
    }

    setupResizeHandlers() {
        const verticalResizer = document.getElementById('vertical-resizer');
        const horizontalResizer = document.getElementById('horizontal-resizer');
        const container = document.getElementById('terminals-container');
        
        let isResizing = false;
        
        // Vertical resizer (left/right)
        verticalResizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });
        
        // Horizontal resizer (top/bottom)
        horizontalResizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'row-resize';
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const containerRect = container.getBoundingClientRect();
            
            if (document.body.style.cursor === 'col-resize') {
                const leftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
                const rightWidth = 100 - leftWidth;
                
                if (leftWidth > 20 && rightWidth > 20) {
                    container.style.gridTemplateColumns = `${leftWidth}% 4px ${rightWidth}%`;
                }
            } else if (document.body.style.cursor === 'row-resize') {
                const topHeight = ((e.clientY - containerRect.top) / containerRect.height) * 100;
                const bottomHeight = 100 - topHeight;
                
                if (topHeight > 20 && bottomHeight > 20) {
                    container.style.gridTemplateRows = `${topHeight}% 4px ${bottomHeight}%`;
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
                document.body.style.cursor = 'default';
            }
        });
    }

    showDirectorySelector(quadrant) {
        const wrapper = document.querySelector(`[data-quadrant="${quadrant}"] .terminal-wrapper`);
        
        // Remove placeholder if it exists
        const placeholder = wrapper.querySelector('.terminal-placeholder');
        if (placeholder) {
            placeholder.remove();
        }
        
        // Create directory selector modal
        const selectorDiv = document.createElement('div');
        selectorDiv.className = 'directory-selector';
        selectorDiv.innerHTML = `
            <div class="directory-selector-content">
                <h3>Select Working Directory</h3>
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
                console.log(`Timeout reached for terminal ${quadrant}, showing terminal anyway`);
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
            rows: 30
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
                    setTimeout(() => fitAddon.fit(), 50);
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
            
            // UNBLOCK notifications ONLY if THIS terminal is focused AND pressed Enter
            if (this.waitingForUserInteraction.get(quadrant) && this.activeTerminal === quadrant) {
                console.log(`🔍 Terminal ${quadrant} key press: '${data.replace(/\r/g, 'ENTER').replace(/\n/g, 'NEWLINE')}'`);
                // ONLY Enter key (\r) should unblock, and only if it's exactly one Enter press
                if (data === '\r' || data === '\r\n') {
                    console.log(`✅ UNBLOCKING terminal ${quadrant} - focused terminal pressed Enter`);
                    this.unblockNotifications(quadrant);
                }
            } else if (this.waitingForUserInteraction.get(quadrant)) {
                console.log(`⚠️ Terminal ${quadrant} - Enter pressed but terminal not focused (active: ${this.activeTerminal})`);
            }
        });

        // Handle terminal output
        ipcRenderer.on(`terminal-output-${quadrant}`, (event, data) => {
            terminal.write(data);
            // Force scroll to bottom after writing data
            setTimeout(() => terminal.scrollToBottom(), 0);
            this.parseClaudeCodeOutput(data, quadrant);
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
        
        // Add multiple event listeners to ensure focus
        terminalDiv.addEventListener('click', () => {
            terminal.focus();
            this.setActiveTerminal(quadrant);
            
            // Focus will be handled by setActiveTerminal automatically
        });
        
        terminalDiv.addEventListener('mousedown', () => {
            terminal.focus();
        });
        
        // Focus and fit immediately when created
        setTimeout(() => {
            terminal.focus();
            fitAddon.fit();
        }, 100);
        
        // Additional fit attempts to ensure proper sizing
        setTimeout(() => fitAddon.fit(), 200);
        setTimeout(() => fitAddon.fit(), 500);

        this.showNotification(`Terminal ${quadrant + 1} started!`, 'success');
    }

    parseClaudeCodeOutput(data, quadrant) {
        const text = data.toString();
        
        // Check if Claude Code is ready
        if (!this.claudeCodeReady[quadrant]) {
            const loader = document.getElementById(`loader-${quadrant}`);
            const terminalDiv = document.getElementById(`terminal-${quadrant}`);
            
            // Update loader status
            if (loader) {
                const statusElement = loader.querySelector('.loader-status');
                // Check for any Claude Code indication to show terminal quickly
                if (text.includes('Welcome to Claude Code') || 
                    text.includes('Do you trust the files in this folder?') ||
                    text.includes('I\'ll help you with') ||
                    text.includes('▓') ||  // Claude Code's UI elements
                    text.includes('claude code') ||  // The actual command
                    text.includes('Claude Code')) {  // Claude Code mentions
                    
                    // Update status based on specific message
                    if (text.includes('Do you trust the files in this folder?')) {
                        statusElement.textContent = 'Waiting for trust confirmation...';
                        this.showNotification(`Please confirm trust for Terminal ${quadrant + 1}`, 'warning');
                    } else if (text.includes('Welcome to Claude Code')) {
                        statusElement.textContent = 'Claude Code starting...';
                    } else if (text.includes('I\'ll help you with')) {
                        statusElement.textContent = 'Claude Code ready!';
                        this.claudeCodeReady[quadrant] = true;
                    }
                    
                    // Show terminal immediately for any Claude Code activity
                    if (loader.style.display !== 'none') {
                        loader.style.display = 'none';
                        terminalDiv.style.display = 'block';
                        
                        const terminalInfo = this.terminals.get(quadrant);
                        if (terminalInfo && terminalInfo.fitAddon) {
                            // Multiple fit attempts to ensure proper sizing
                            setTimeout(() => terminalInfo.fitAddon.fit(), 0);
                            setTimeout(() => terminalInfo.fitAddon.fit(), 50);
                            setTimeout(() => terminalInfo.fitAddon.fit(), 200);
                        }
                    }
                } else if (text.includes('command not found')) {
                    statusElement.textContent = 'Error: Claude Code not found';
                    statusElement.style.color = '#ef4444';
                }
            }
        }
        
        // Parse Claude Code specific outputs for notifications
        if (text.includes('Task completed successfully')) {
            this.showNotification('Task completed successfully', 'success');
        } else if (text.includes('Waiting for confirmation') || 
                   text.includes('Continue? (y/n)') ||
                   text.includes('Do you want to') ||
                   text.includes('Would you like to') ||
                   text.includes('Proceed?') ||
                   text.includes('Allow access to') ||
                   text.includes('Grant permission') ||
                   text.includes('Enable MCP') ||
                   text.includes('Trust this') ||
                   text.includes('Confirm')) {
            this.handleConfirmationRequest(text, quadrant);
        } else if (text.includes('Starting task') || text.includes('Processing...')) {
            this.showNotification('Claude Code is processing', 'info');
        }

        // Check for specific Claude Code patterns
        const patterns = [
            {
                regex: /Generated (\d+) files?/i,
                type: 'success',
                message: (match) => `Generated ${match[1]} files`
            },
            {
                regex: /Found (\d+) issues?/i,
                type: 'warning',
                message: (match) => `Found ${match[1]} issues`
            },
            {
                regex: /Building project.../i,
                type: 'info',
                message: 'Building project...'
            }
        ];

        patterns.forEach(pattern => {
            const match = text.match(pattern.regex);
            if (match) {
                this.showNotification(pattern.message(match), pattern.type);
            }
        });
    }

    highlightTerminal(quadrant) {
        const terminalElement = document.querySelector(`#terminal-${quadrant}`);
        if (terminalElement) {
            terminalElement.classList.add('active');
            setTimeout(() => {
                terminalElement.classList.remove('active');
            }, 3000);
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
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

    showDesktopNotification(title, message) {
        // Send IPC message to main process to show native notification
        ipcRenderer.send('show-desktop-notification', title, message);
        
        // Also show in-app notification as fallback
        this.showNotification(message, 'warning');
    }

    handleConfirmationRequest(text, quadrant) {
        // RADICAL SOLUTION: If notifications are blocked for this terminal, skip entirely
        if (this.notificationBlocked.get(quadrant)) {
            console.log(`❌ BLOCKED: Notification skipped for terminal ${quadrant} - waiting for user interaction`);
            return;
        }
        
        // Skip if this is just cursor movement (single character updates)
        if (text.length < 10) {
            return;
        }
        
        // Detect if this is menu navigation (contains selection arrow and numbered options)
        const isMenuNavigation = text.includes('❯') && /\s*[0-9]+\./m.test(text);
        
        // Create a content signature to detect reprints of the same menu
        const contentSignature = text
            .replace(/❯/g, '') // Remove selection arrow
            .replace(/\s*[0-9]+\./g, '') // Remove option numbers
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
        
        // Check if this is just a reprint of the same menu content
        const lastContent = this.lastMenuContent.get(quadrant);
        if (lastContent === contentSignature) {
            return; // Same menu content, just different selection
        }
        
        // Update last menu content
        this.lastMenuContent.set(quadrant, contentSignature);
        
        // Extract command from the text (usually appears before "Do you want to proceed?")
        let command = '';
        const lines = text.split('\n');
        
        // Look for the command line (usually contains the actual command like "mkdir pruebas2")
        for (const line of lines) {
            const trimmedLine = line.trim();
            // Skip empty lines, UI elements, and option lines
            if (trimmedLine && 
                !trimmedLine.includes('│') && 
                !trimmedLine.includes('╭') && 
                !trimmedLine.includes('╰') && 
                !trimmedLine.includes('❯') &&
                !trimmedLine.match(/^[0-9]+\./) &&
                !trimmedLine.includes('Do you want to') &&
                !trimmedLine.includes('Bash command') &&
                trimmedLine.length > 3) {
                command = trimmedLine;
                break;
            }
        }
        
        // Find the confirmation question
        let confirmationQuestion = '';
        for (const line of lines) {
            if (line.includes('Do you want to') || line.includes('Proceed?') || 
                line.includes('Continue?') || line.includes('Would you like to') ||
                line.includes('Allow access to') || line.includes('Grant permission') ||
                line.includes('Enable MCP') || line.includes('Trust this') ||
                line.includes('Waiting for confirmation')) {
                confirmationQuestion = line.trim().replace(/[│]/g, '').trim();
                break;
            }
        }
        
        // If no clear confirmation question found, skip
        if (!confirmationQuestion) {
            return;
        }
        
        // Create a unique identifier for this specific command + question combination
        const commandKey = `${command}_${confirmationQuestion}`.replace(/\s+/g, '_');
        
        // If we already notified for this exact command, skip (unless it's been a while)
        const now = Date.now();
        const lastNotified = this.confirmedCommands.get(`${quadrant}_${commandKey}`);
        if (lastNotified && (now - lastNotified) < 30000) { // 30 second cooldown per command
            return;
        }
        
        // If this is menu navigation, increase debounce significantly
        const debounceTime = isMenuNavigation ? 2000 : 500;
        
        // Clear existing debounce timer
        if (this.confirmationDebounce.has(quadrant)) {
            clearTimeout(this.confirmationDebounce.get(quadrant));
        }
        
        // BLOCK IMMEDIATELY before any debounce
        this.notificationBlocked.set(quadrant, true);
        this.waitingForUserInteraction.set(quadrant, true);
        
        // Set new debounce timer
        const timeoutId = setTimeout(() => {
            // Double check this isn't menu navigation at execution time
            const terminalInfo = this.terminals.get(quadrant);
            if (terminalInfo && terminalInfo.terminal) {
                // Mark this command as notified
                this.confirmedCommands.set(`${quadrant}_${commandKey}`, now);
                
                this.showDesktopNotification('Confirmation Required', `Terminal ${quadrant + 1}: Claude Code needs confirmation`);
                this.highlightTerminalForConfirmation(quadrant);
                
                console.log(`🔒 BLOCKED notifications for terminal ${quadrant} until user interaction`);
                
                // Clean up old confirmed commands after 5 minutes
                setTimeout(() => {
                    const entries = Array.from(this.confirmedCommands.entries());
                    entries.forEach(([key, timestamp]) => {
                        if (Date.now() - timestamp > 300000) { // 5 minutes
                            this.confirmedCommands.delete(key);
                        }
                    });
                }, 300000);
            }
        }, debounceTime);
        
        this.confirmationDebounce.set(quadrant, timeoutId);
    }
    
    unblockNotifications(quadrant) {
        console.log(`🔓 Unblocking notifications for terminal ${quadrant} - user clicked terminal and pressed Enter`);
        this.notificationBlocked.set(quadrant, false);
        this.waitingForUserInteraction.set(quadrant, false);
        // Focus state is handled by activeTerminal
        
        // Remove highlight animation since user is responding
        const terminalElement = document.querySelector(`[data-quadrant="${quadrant}"]`);
        if (terminalElement) {
            terminalElement.classList.remove('confirmation-highlight');
        }
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
            
            // Remove highlight after 10 seconds
            setTimeout(() => {
                terminalElement.classList.remove('confirmation-highlight');
            }, 10000);
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
            titleElement.textContent = title;
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
            
            setTimeout(() => {
                this.resizeTerminal(quadrant);
            }, 300);
        }
    }

    exitFullscreen() {
        if (this.fullscreenTerminal !== null) {
            const quadrantElement = document.querySelector(`[data-quadrant="${this.fullscreenTerminal}"]`);
            quadrantElement.classList.remove('fullscreen');
            
            setTimeout(() => {
                this.resizeTerminal(this.fullscreenTerminal);
            }, 300);
            
            this.fullscreenTerminal = null;
        }
    }

    closeTerminal(quadrant) {
        const terminal = this.terminals.get(quadrant);
        if (terminal) {
            terminal.terminal.dispose();
            ipcRenderer.send('kill-terminal', quadrant);
            this.terminals.delete(quadrant);
            // Note: We keep the directory in memory so it's remembered next time
            
            const quadrantElement = document.querySelector(`[data-quadrant="${quadrant}"]`);
            const wrapper = quadrantElement.querySelector('.terminal-wrapper');
            wrapper.innerHTML = `
                <div class="terminal-placeholder" data-quadrant="${quadrant}">
                    <div class="terminal-placeholder-icon">⚡</div>
                    <div>Click to start Claude Code</div>
                </div>
            `;
            
            // Re-add event listener
            wrapper.querySelector('.terminal-placeholder').addEventListener('click', (e) => {
                const quadrant = parseInt(e.currentTarget.dataset.quadrant);
                this.showDirectorySelector(quadrant);
            });
            
            this.updateTerminalTitle(quadrant, `Terminal ${quadrant + 1}`);
        }
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

    clearAllTerminals() {
        this.terminals.forEach((terminal, quadrant) => {
            this.closeTerminal(quadrant);
        });
    }

    async checkClaudeCode() {
        const isAvailable = await ipcRenderer.invoke('check-claude-code');
        
        if (isAvailable) {
            this.showNotification('✅ Claude Code is installed and available', 'success');
        } else {
            this.showNotification('❌ Claude Code not found. Install from claude.ai/code', 'warning');
        }
    }

    showSettings() {
        this.showNotification('Settings panel coming soon...', 'info');
    }
}

// Initialize the terminal manager when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.terminalManager = new TerminalManager();
});
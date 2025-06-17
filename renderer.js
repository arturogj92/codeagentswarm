const { ipcRenderer } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const { WebLinksAddon } = require('xterm-addon-web-links');

class TerminalManager {
    constructor() {
        this.terminals = new Map();
        this.activeTerminal = null;
        this.fullscreenTerminal = null;
        this.selectedDirectories = new Map(); // Track selected directories for each quadrant
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupResizeHandlers();
    }

    setupEventListeners() {
        document.getElementById('check-claude-btn').addEventListener('click', () => {
            this.checkClaudeCode();
        });

        document.getElementById('new-terminal-btn').addEventListener('click', () => {
            this.createNewTerminal();
        });

        document.getElementById('clear-all-btn').addEventListener('click', () => {
            this.clearAllTerminals();
        });

        document.getElementById('settings-btn').addEventListener('click', () => {
            this.showSettings();
        });

        document.querySelectorAll('.terminal-placeholder').forEach(placeholder => {
            placeholder.addEventListener('click', (e) => {
                // Don't start terminal if clicking the select folder button
                if (e.target.classList.contains('select-folder-btn')) {
                    return;
                }
                const quadrant = parseInt(e.currentTarget.dataset.quadrant);
                this.startTerminal(quadrant);
            });
        });

        // Handle directory selection buttons
        document.querySelectorAll('.select-folder-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const quadrant = parseInt(e.target.dataset.quadrant);
                await this.selectDirectory(quadrant);
            });
        });

        document.querySelectorAll('.terminal-control-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = e.target.dataset.action;
                const quadrant = parseInt(e.target.closest('.terminal-quadrant').dataset.quadrant);
                
                if (action === 'folder') {
                    this.selectDirectory(quadrant);
                } else if (action === 'fullscreen') {
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

    async selectDirectory(quadrant) {
        const selectedDir = await ipcRenderer.invoke('select-directory');
        if (selectedDir) {
            this.selectedDirectories.set(quadrant, selectedDir);
            
            // Update the display
            const selectedFolderDisplay = document.querySelector(`.selected-folder[data-quadrant="${quadrant}"]`);
            if (selectedFolderDisplay) {
                const dirName = selectedDir.split('/').pop() || selectedDir;
                selectedFolderDisplay.textContent = `📁 ${dirName}`;
                selectedFolderDisplay.title = selectedDir; // Full path on hover
            }
            
            this.showNotification(`Directory selected: ${selectedDir}`, 'success');
        }
    }

    async startTerminal(quadrant) {
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
        }, 10000); // 10 seconds timeout

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

        // Create PTY terminal process with selected directory
        const selectedDir = this.selectedDirectories.get(quadrant);
        await ipcRenderer.invoke('create-terminal', quadrant, selectedDir);
        
        // Focus the terminal
        terminal.focus();
        
        // Handle terminal input with debug
        terminal.onData(data => {
            console.log(`Input captured for terminal ${quadrant}:`, data);
            ipcRenderer.send('terminal-input', quadrant, data);
        });

        // Handle terminal output
        ipcRenderer.on(`terminal-output-${quadrant}`, (event, data) => {
            terminal.write(data);
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
        this.updateTerminalTitle(quadrant, 'Claude Code');
        
        // Add multiple event listeners to ensure focus
        terminalDiv.addEventListener('click', () => {
            console.log(`Focusing terminal ${quadrant}`);
            terminal.focus();
            this.setActiveTerminal(quadrant);
        });
        
        terminalDiv.addEventListener('mousedown', () => {
            terminal.focus();
        });
        
        // Focus immediately when created
        setTimeout(() => {
            terminal.focus();
        }, 100);

        this.showNotification(`Terminal ${quadrant + 1} started!`, 'success');
    }

    parseClaudeCodeOutput(data, quadrant) {
        const text = data.toString();
        console.log(`Terminal ${quadrant} output:`, text);
        
        // Check if Claude Code is ready
        if (!this.claudeCodeReady[quadrant]) {
            const loader = document.getElementById(`loader-${quadrant}`);
            const terminalDiv = document.getElementById(`terminal-${quadrant}`);
            
            console.log(`Checking Claude Code readiness for terminal ${quadrant}`);
            
            // Update loader status
            if (loader) {
                const statusElement = loader.querySelector('.loader-status');
                if (text.includes('Welcome to Claude Code')) {
                    console.log(`Claude Code welcome message detected for terminal ${quadrant}`);
                    statusElement.textContent = 'Claude Code detected...';
                } else if (text.includes('Do you trust the files in this folder?')) {
                    console.log(`Claude Code trust prompt detected for terminal ${quadrant}`);
                    statusElement.textContent = 'Waiting for trust confirmation...';
                    
                    // Show terminal so user can respond to trust prompt
                    setTimeout(() => {
                        loader.style.display = 'none';
                        terminalDiv.style.display = 'block';
                        
                        const terminalInfo = this.terminals.get(quadrant);
                        if (terminalInfo && terminalInfo.fitAddon) {
                            terminalInfo.fitAddon.fit();
                        }
                        
                        this.showNotification(`Please confirm trust for Terminal ${quadrant + 1}`, 'warning');
                    }, 1000);
                } else if (text.includes('I\'ll help you with')) {
                    // Claude Code is ready!
                    console.log(`Claude Code ready detected for terminal ${quadrant}`);
                    this.claudeCodeReady[quadrant] = true;
                    
                    // Hide loader and show terminal
                    setTimeout(() => {
                        loader.style.display = 'none';
                        terminalDiv.style.display = 'block';
                        
                        // Resize terminal now that it's visible
                        const terminalInfo = this.terminals.get(quadrant);
                        if (terminalInfo && terminalInfo.fitAddon) {
                            terminalInfo.fitAddon.fit();
                        }
                        
                        this.showNotification(`Claude Code ready in Terminal ${quadrant + 1}!`, 'success');
                    }, 500);
                } else if (text.includes('command not found')) {
                    statusElement.textContent = 'Error: Claude Code not found';
                    statusElement.style.color = '#ef4444';
                }
            }
        }
        
        // Parse Claude Code specific outputs for notifications
        if (text.includes('Task completed successfully')) {
            this.showNotification('Task completed successfully', 'success');
        } else if (text.includes('Error:') || text.includes('ERROR:')) {
            this.showNotification('Error occurred in Claude Code', 'error');
        } else if (text.includes('Waiting for confirmation') || text.includes('Continue? (y/n)')) {
            this.showNotification('Claude Code needs confirmation', 'warning');
            this.highlightTerminal(quadrant);
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
                this.startTerminal(quadrant);
            });
            
            this.updateTerminalTitle(quadrant, `Terminal ${quadrant + 1}`);
        }
    }

    resizeTerminal(quadrant) {
        const terminal = this.terminals.get(quadrant);
        if (terminal) {
            terminal.fitAddon.fit();
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
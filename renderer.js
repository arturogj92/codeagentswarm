const { ipcRenderer } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const { WebLinksAddon } = require('xterm-addon-web-links');

class TerminalManager {
    constructor() {
        this.terminals = new Map();
        this.activeTerminal = null;
        this.fullscreenTerminal = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupResizeHandlers();
    }

    setupEventListeners() {
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
                const quadrant = parseInt(e.currentTarget.dataset.quadrant);
                this.startTerminal(quadrant);
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
        // Implementation for resize handles will be added later
        console.log('Resize handlers setup');
    }

    async startTerminal(quadrant) {
        const quadrantElement = document.querySelector(`[data-quadrant="${quadrant}"]`);
        const wrapper = quadrantElement.querySelector('.terminal-wrapper');
        const placeholder = wrapper.querySelector('.terminal-placeholder');
        
        if (placeholder) {
            placeholder.remove();
        }

        const terminalDiv = document.createElement('div');
        terminalDiv.className = 'terminal';
        terminalDiv.id = `terminal-${quadrant}`;
        wrapper.appendChild(terminalDiv);

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
            allowTransparency: true
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();
        
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(webLinksAddon);
        
        terminal.open(terminalDiv);
        fitAddon.fit();

        // Start terminal process
        await ipcRenderer.invoke('create-terminal', quadrant);
        
        terminal.onData(data => {
            ipcRenderer.send('terminal-input', quadrant, data);
        });

        ipcRenderer.on(`terminal-output-${quadrant}`, (event, data) => {
            terminal.write(data);
            this.parseClaudeCodeOutput(data, quadrant);
        });

        ipcRenderer.on(`terminal-exit-${quadrant}`, (event, code) => {
            terminal.write(`\r\n\x1b[31mTerminal exited with code: ${code}\x1b[0m\r\n`);
        });

        this.terminals.set(quadrant, {
            terminal,
            fitAddon,
            element: terminalDiv
        });

        this.setActiveTerminal(quadrant);
        this.updateTerminalTitle(quadrant, 'Claude Code');
    }

    parseClaudeCodeOutput(data, quadrant) {
        const text = data.toString();
        
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
                    <div>Click to start Claude Code terminal</div>
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

    showSettings() {
        this.showNotification('Settings panel coming soon...', 'info');
    }
}

// Initialize the terminal manager when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.terminalManager = new TerminalManager();
});
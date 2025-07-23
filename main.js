const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const { spawn } = require('child_process');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const os = require('os');
const DatabaseManager = require('./database');
const MCPTaskServer = require('./mcp-server');
const HooksManager = require('./hooks-manager');
const WebhookServer = require('./webhook-server');

// Logging setup
const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFile = path.join(logDir, `codeagentswarm-${new Date().toISOString().split('T')[0]}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// Store original console methods
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn
};

// Custom logger
const logger = {
  log: (...args) => {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] INFO: ${args.join(' ')}`;
    originalConsole.log(...args);
    logStream.write(message + '\n');
  },
  error: (...args) => {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] ERROR: ${args.join(' ')}`;
    originalConsole.error(...args);
    logStream.write(message + '\n');
  },
  warn: (...args) => {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] WARN: ${args.join(' ')}`;
    originalConsole.warn(...args);
    logStream.write(message + '\n');
  }
};

// Override console methods
console.log = logger.log;
console.error = logger.error;
console.warn = logger.warn;

// Log startup info
console.log('=== CodeAgentSwarm Starting ===');
console.log('Log file:', logFile);
console.log('App version:', app.getVersion());
console.log('Electron version:', process.versions.electron);
console.log('Node version:', process.versions.node);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);

// Show log location on macOS
if (process.platform === 'darwin') {
  console.log('Log directory:', logDir);
  console.log('To view logs, run: tail -f "' + logFile + '"');
  console.log('Or open in Finder: open "' + logDir + '"');
}

// Enable live reload for Electron in development
if (process.argv.includes('--dev')) {
    try {
        require('electron-reload')(__dirname, {
            electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
            hardResetMethod: 'exit'
        });
    } catch (err) {
        console.log('electron-reload not installed, run: npm install --save-dev electron-reload');
    }
    
    // Watch kanban files for changes
    const kanbanFiles = ['kanban.html', 'kanban.css', 'kanban.js'];
    kanbanFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
            if (curr.mtime !== prev.mtime && kanbanWindow && !kanbanWindow.isDestroyed()) {
                console.log(`Detected change in ${file}, reloading kanban window...`);
                kanbanWindow.webContents.reload();
            }
        });
    });
}

let mainWindow;
let kanbanWindow; // Global reference to kanban window
const terminals = new Map();
let db;
let mcpServer;
let hooksManager;
let webhookServer;
let terminalsWaitingForResponse = new Set();

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    titleBarStyle: 'default',  // Changed from 'hiddenInset'
    frame: true,               // Ensure frame is visible
    show: true,
    autoHideMenuBar: false,
    vibrancy: 'under-window',
    visualEffectState: 'active'
  });

  mainWindow.loadFile('index.html');
  
  // Send dev mode status to renderer after the page loads
  mainWindow.webContents.once('did-finish-load', () => {
    const isDevMode = process.argv.includes('--dev');
    mainWindow.webContents.send('dev-mode-status', isDevMode);
  });
  
  // Clear badge when window gets focus
  mainWindow.on('focus', () => {
    if (process.platform === 'darwin') {
      app.badgeCount = 0;
    }
    terminalsWaitingForResponse.clear();
    
    // Notify renderer to clear waiting states
    mainWindow.webContents.send('clear-waiting-states');
  });
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Simple shell simulation without external dependencies
class SimpleShell {
  constructor(quadrant, workingDir) {
    console.log('SimpleShell constructor called:', { quadrant, workingDir });
    this.quadrant = quadrant;
    this.cwd = workingDir;
    this.buffer = '';
    this.currentLine = '';
    this.history = [];
    this.historyIndex = -1;
    this.ready = true;
    
    // Set environment variables for this quadrant globally (1-based)
    process.env[`CODEAGENTSWARM_QUADRANT_${quadrant + 1}`] = 'true';
    process.env.CODEAGENTSWARM_CURRENT_QUADRANT = (quadrant + 1).toString();
    
    this.sendOutput(`\r\n🚀 Terminal ${quadrant + 1} ready! (Quadrant: ${quadrant})\r\n`);
    this.sendPrompt();
  }
  
  sendOutput(data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`terminal-output-${this.quadrant}`, data);
    }
  }
  
  sendPrompt() {
    const promptText = `\x1b[32m➜\x1b[0m  \x1b[36m${path.basename(this.cwd)}\x1b[0m $ `;
    this.sendOutput(promptText);
  }
  
  handleInput(data) {
    // If we have an active interactive process, send input directly to it
    if (this.activeInteractiveProcess) {
      // Write directly to the PTY process
      if (typeof this.activeInteractiveProcess.write === 'function') {
        this.activeInteractiveProcess.write(data);
      } else if (this.activeInteractiveProcess.stdin) {
        this.activeInteractiveProcess.stdin.write(data);
      }
      return;
    }
    
    // Otherwise, handle as normal shell input
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      const charCode = data.charCodeAt(i);
      
      if (charCode === 13) { // Enter
        this.sendOutput('\r\n');
        this.executeCommand(this.currentLine.trim());
        this.currentLine = '';
      } else if (charCode === 127 || charCode === 8) { // Backspace
        if (this.currentLine.length > 0) {
          this.currentLine = this.currentLine.slice(0, -1);
          this.sendOutput('\b \b'); // Move back, write space, move back again
        }
      } else if (charCode === 3) { // Ctrl+C
        this.sendOutput('^C\r\n');
        this.currentLine = '';
        this.sendPrompt();
      } else if (charCode >= 32 && charCode <= 126) { // Printable characters
        this.currentLine += char;
        this.sendOutput(char); // Echo the character
      }
    }
  }
  
  executeCommand(command, silent = false) {
    if (!command) {
      if (!silent) this.sendPrompt();
      return;
    }
    
    this.history.push(command);
    
    // Handle built-in commands
    if (command === 'clear') {
      this.sendOutput('\x1b[2J\x1b[H'); // Clear screen and move cursor to top
      if (!silent) this.sendPrompt();
      return;
    }
    
    if (command.startsWith('cd ')) {
      const newDir = command.substring(3).trim();
      try {
        const fullPath = path.resolve(this.cwd, newDir);
        if (require('fs').existsSync(fullPath)) {
          this.cwd = fullPath;
          this.sendOutput(`Changed directory to: ${this.cwd}\r\n`);
        } else {
          this.sendOutput(`cd: no such file or directory: ${newDir}\r\n`);
        }
      } catch (error) {
        this.sendOutput(`cd: ${error.message}\r\n`);
      }
      if (!silent) this.sendPrompt();
      return;
    }
    
    if (command === 'pwd') {
      this.sendOutput(`${this.cwd}\r\n`);
      if (!silent) this.sendPrompt();
      return;
    }
    
    if (command === 'path' || command === 'echo $PATH') {
      this.sendOutput(`${process.env.PATH}\r\n`);
      if (!silent) this.sendPrompt();
      return;
    }
    
    // Handle environment variable queries
    if (command.startsWith('echo $CODEAGENTSWARM')) {
      const varName = command.replace('echo $', '');
      if (varName === 'CODEAGENTSWARM_CURRENT_QUADRANT') {
        this.sendOutput(`${this.quadrant + 1}\r\n`);
      } else if (varName === `CODEAGENTSWARM_QUADRANT_${this.quadrant + 1}`) {
        this.sendOutput(`true\r\n`);
      } else {
        this.sendOutput(`\r\n`);
      }
      if (!silent) this.sendPrompt();
      return;
    }
    
    
    // Execute real commands
    this.executeRealCommand(command);
  }
  
  executeRealCommand(command) {
    const args = command.split(' ');
    const cmd = args[0];
    let cmdArgs = args.slice(1);
    // Command parsed for execution
    
    // Improve ls command formatting
    if (cmd === 'ls' && cmdArgs.length === 0) {
      cmdArgs = ['-1']; // Force single column output
    }
    
    // Use script command to create a real PTY for compatible commands
    const userShell = process.env.SHELL || '/bin/zsh';
    const fullCommand = `${cmd} ${cmdArgs.join(' ')}`;
    
    // For interactive commands like claude code, use script to create a PTY
    // Check if it's claude (including full paths)
    const isClaudeCommand = cmd === 'claude' || cmd.includes('claude') || cmd.includes('.nvm');
    const isInteractiveCommand = isClaudeCommand || cmd === 'vim' || cmd === 'nano';
    
    let childProcess;
    if (isInteractiveCommand) {
      // Create a real PTY using node-pty for interactive commands
      const env = { ...process.env };
      if (app.isPackaged) {
        // Add directories to PATH for packaged app
        const additionalPaths = [
          '/usr/local/bin',
          '/opt/homebrew/bin',
          '/usr/bin',
          path.join(os.homedir(), '.local/bin'),
          path.join(os.homedir(), '.nvm/versions/node/v18.20.4/bin'),
          path.join(os.homedir(), '.nvm/versions/node/v18.20.4/lib/node_modules/@anthropic-ai/claude-code/bin'),
          path.join(os.homedir(), '.nvm/versions/node/v18.20.4/lib/node_modules/@anthropic-ai/claude-code')
        ];

        const currentPath = env.PATH || '';
        env.PATH = [...additionalPaths, currentPath].join(':');
      }

      // Add quadrant identification to environment (1-based)
      env[`CODEAGENTSWARM_QUADRANT_${this.quadrant + 1}`] = 'true';
      env.CODEAGENTSWARM_CURRENT_QUADRANT = (this.quadrant + 1).toString();

      childProcess = pty.spawn(userShell, ['-l', '-c', fullCommand], {
        name: 'xterm-color',
        cwd: this.cwd,
        env: env,
        cols: 80,
        rows: 30
      });

      // Mark this as active interactive process
      this.activeInteractiveProcess = childProcess;
    } else {
      // Regular commands use the normal approach
      childProcess = spawn(userShell, ['-l', '-c', fullCommand], {
        cwd: this.cwd,
        env: {
          ...process.env,
          PATH: process.env.PATH,
          TERM: 'xterm-256color',
          SHELL: userShell,
          HOME: process.env.HOME,
          [`CODEAGENTSWARM_QUADRANT_${this.quadrant + 1}`]: 'true',
          CODEAGENTSWARM_CURRENT_QUADRANT: (this.quadrant + 1).toString(),
          USER: process.env.USER,
          FORCE_COLOR: '1',
          CLICOLOR: '1',
          CLICOLOR_FORCE: '1'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }
    
    if (childProcess.onData) {
      childProcess.onData((data) => {
        this.sendOutput(data);
      });
    } else {
      childProcess.stdout.on('data', (data) => {
        let output = data.toString();
        output = output.replace(/\n/g, '\r\n');
        this.sendOutput(output);
      });
      childProcess.stderr.on('data', (data) => {
        let output = data.toString();
        output = output.replace(/\n/g, '\r\n');
        this.sendOutput(output);
      });
    }

    const exitHandler = (code) => {
      if (this.activeInteractiveProcess === childProcess) {
        this.activeInteractiveProcess = null;
      }

      if (code !== 0 && code !== undefined) {
        this.sendOutput(`\r\nProcess exited with code: ${code}\r\n`);
      }

      if (!isInteractiveCommand || this.activeInteractiveProcess === null) {
        this.sendPrompt();
      }
    };

    if (childProcess.onExit) {
      childProcess.onExit(({ exitCode }) => exitHandler(exitCode));
    } else {
      childProcess.on('exit', exitHandler);
      childProcess.on('error', () => exitHandler(1));
    }
  }
  
  createClaudeCodeWindow(command) {
    // Create a controlled child window for Claude Code
    const { BrowserWindow } = require('electron');
    
    const claudeWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      title: `Claude Code - Terminal ${this.quadrant + 1}`,
      parent: require('electron').BrowserWindow.getFocusedWindow(),
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    
    // You could load a simple terminal interface here
    claudeWindow.loadURL('data:text/html,<h1>Claude Code Window - Terminal ' + (this.quadrant + 1) + '</h1><p>This would contain Claude Code interface</p>');
    
    // Track the window
    this.claudeWindow = claudeWindow;
  }
  
  kill() {
    if (this.activeInteractiveProcess) {
      try {
        // For node-pty processes
        if (typeof this.activeInteractiveProcess.kill === 'function') {
          this.activeInteractiveProcess.kill('SIGKILL');
        } 
        // For regular child processes
        else if (this.activeInteractiveProcess.pid) {
          // Kill the entire process tree
          if (process.platform === 'darwin' || process.platform === 'linux') {
            // Use pkill to kill the process and all its children
            try {
              require('child_process').execSync(`pkill -TERM -P ${this.activeInteractiveProcess.pid}`);
            } catch (e) {
              // Ignore errors
            }
          }
          process.kill(this.activeInteractiveProcess.pid, 'SIGKILL');
        }
      } catch (e) {
        console.error('Error killing process:', e);
      }
      this.activeInteractiveProcess = null;
    }
  }
}

// IPC handlers for simple shell management
ipcMain.handle('create-terminal', async (event, quadrant, customWorkingDir, sessionType = 'resume') => {
  console.log('=== CREATE-TERMINAL HANDLER CALLED ===');
  console.log('Parameters:', { quadrant, customWorkingDir, sessionType });
  
  try {
    const userHome = os.homedir();
    const workingDir = customWorkingDir || path.join(userHome, 'Desktop');
    console.log('Working directory:', workingDir);
    
    // Auto-configure CLAUDE.md for MCP Task Manager
    // We'll do this after claude creates its initial CLAUDE.md
    
    console.log(`Creating terminal ${quadrant}`);
    
    // Set environment variable to identify the quadrant (1-based)
    process.env[`CODEAGENTSWARM_QUADRANT_${quadrant + 1}`] = 'true';
    process.env.CODEAGENTSWARM_CURRENT_QUADRANT = (quadrant + 1).toString();
    
    // Fix PATH for packaged apps before creating shell
    if (app.isPackaged) {
      // Add common paths where claude might be installed
      const additionalPaths = [
        '/usr/local/bin',
        '/opt/homebrew/bin', 
        '/usr/bin',
        path.join(os.homedir(), '.local/bin'),
        path.join(os.homedir(), '.nvm/versions/node/v18.20.4/bin'), // ← LA UBICACIÓN CORRECTA!
        path.join(os.homedir(), '.nvm/versions/node/v18.20.4/lib/node_modules/@anthropic-ai/claude-code/bin'),
        path.join(os.homedir(), '.nvm/versions/node/v18.20.4/lib/node_modules/@anthropic-ai/claude-code')
      ];
      
      const currentPath = process.env.PATH || '';
      process.env.PATH = [...additionalPaths, currentPath].join(':');
      // Global PATH updated
    }
    
    const shell = new SimpleShell(quadrant, workingDir);
    terminals.set(quadrant, shell);
    console.log(`Terminal ${quadrant} created and added to terminals map`);
    
    // Auto-execute claude code after a delay to ensure terminal is ready
    setTimeout(() => {
      console.log(`Checking if terminal ${quadrant} exists for auto-execute...`);
      if (terminals.has(quadrant)) {
        // Execute command based on session type
        const command = sessionType === 'new' ? 'claude' : 'claude --resume';
        console.log(`Auto-executing command: ${command}`);
        shell.executeCommand(command, true);
        
        // Configure CLAUDE.md after claude has created it
        setTimeout(() => {
          console.log('Configuring CLAUDE.md for:', workingDir);
          ensureClaudeMdConfiguration(workingDir);
        }, 2000); // Wait 2 seconds for claude to create its initial CLAUDE.md
      }
    }, 1000); // Increased to 1 second to ensure terminal is ready
    
    console.log(`Terminal ${quadrant} created successfully`);
    return quadrant;
    
  } catch (error) {
    console.error(`Failed to create terminal ${quadrant}:`, error);
    console.error('Error stack:', error.stack);
    throw error;
  }
});

ipcMain.on('terminal-input', (event, quadrant, data) => {
  // Input received for terminal ${quadrant}
  const shell = terminals.get(quadrant);
  if (shell) {
    shell.handleInput(data);
  } else {
    console.error(`Shell ${quadrant} not found`);
  }
});

ipcMain.on('send-to-terminal', (event, terminalId, message) => {
  console.log(`Sending message to terminal ${terminalId}`);
  const shell = terminals.get(terminalId);
  if (shell) {
    // Send the message as if it was typed
    shell.handleInput(message);
  } else {
    console.error(`Terminal ${terminalId} not found`);
  }
});

ipcMain.handle('get-terminals-for-project', async (event, projectName) => {
  try {
    const activeTerminals = [];
    
    // Iterate through all active terminals
    for (const [terminalId, shell] of terminals) {
      if (shell && shell.cwd) {
        // Check if this terminal has a CLAUDE.md file
        const claudeMdPath = path.join(shell.cwd, 'CLAUDE.md');
        
        if (fs.existsSync(claudeMdPath)) {
          // Read CLAUDE.md to get project name
          const claudeMdContent = fs.readFileSync(claudeMdPath, 'utf8');
          const projectMatch = claudeMdContent.match(/\*\*Project Name\*\*:\s*(.+)/);
          
          if (projectMatch && projectMatch[1].trim() === projectName) {
            activeTerminals.push({
              id: terminalId,
              currentDir: shell.cwd,
              project: projectName
            });
          }
        }
      }
    }
    
    return activeTerminals;
  } catch (error) {
    console.error('Error getting terminals for project:', error);
    return [];
  }
});

ipcMain.on('terminal-resize', (event, quadrant, cols, rows) => {
  // Terminal ${quadrant} resized
  
  const shell = terminals.get(quadrant);
  if (shell && shell.activeInteractiveProcess) {
    try {
      if (typeof shell.activeInteractiveProcess.resize === 'function') {
        shell.activeInteractiveProcess.resize(cols, rows);
      } else if (shell.activeInteractiveProcess.pid) {
        process.kill(shell.activeInteractiveProcess.pid, 'SIGWINCH');
      }
    } catch (error) {
      console.error(`Error sending resize signal to terminal ${quadrant}:`, error);
    }
  }
});

ipcMain.on('kill-terminal', (event, quadrant, force = false) => {
  const shell = terminals.get(quadrant);
  if (shell) {
    console.log(`Killing terminal ${quadrant} and all child processes... ${force ? '(FORCE)' : ''}`);
    
    try {
      // Kill the shell process - check if method exists first
      if (shell.kill && typeof shell.kill === 'function') {
        console.log(`Calling shell.kill() for terminal ${quadrant}`);
        shell.kill();
      } else if (shell.activeInteractiveProcess && shell.activeInteractiveProcess.kill) {
        console.log(`Calling activeInteractiveProcess.kill() for terminal ${quadrant}`);
        shell.activeInteractiveProcess.kill('SIGTERM');
        // Try SIGKILL after a delay if SIGTERM doesn't work
        setTimeout(() => {
          if (shell.activeInteractiveProcess && !shell.activeInteractiveProcess.killed) {
            shell.activeInteractiveProcess.kill('SIGKILL');
          }
        }, 1000);
      } else {
        console.log(`No kill method available for terminal ${quadrant}, will rely on cleanup`);
      }
    } catch (error) {
      console.error(`Error killing terminal ${quadrant}:`, error.message);
      // Don't crash the app, continue with cleanup
    }
    
    terminals.delete(quadrant);
    
    // More aggressive cleanup for force kills
    const cleanupDelay = force ? 50 : 100;
    const maxRetries = force ? 3 : 1;
    
    let retryCount = 0;
    const cleanup = () => {
      retryCount++;
      console.log(`Cleanup attempt ${retryCount} for terminal ${quadrant}`);
      
      try {
        if (process.platform === 'darwin') {
          // Get the shell PID to be more specific
          let shellPid = null;
          if (shell && shell.activeInteractiveProcess && shell.activeInteractiveProcess.pid) {
            shellPid = shell.activeInteractiveProcess.pid;
          }
          
          if (shellPid) {
            // Kill specific shell and its children only
            console.log(`Killing shell ${shellPid} and its children...`);
            require('child_process').execSync(`pkill -P ${shellPid} 2>/dev/null || true`);
            require('child_process').execSync(`kill -9 ${shellPid} 2>/dev/null || true`);
          }
          
          // Only look for Claude processes that are NOT part of this main application
          // Exclude our main Electron process and focus on claude CLI processes
          try {
            const { execSync } = require('child_process');
            // Be very specific: only kill claude CLI processes, not our Electron app
            execSync(`ps aux | grep -E "\\bclaude\\b" | grep -v "electron" | grep -v "codeagentswarm" | grep -v grep | awk '{print $2}' | xargs kill -TERM 2>/dev/null || true`);
            
            // If force is enabled, try SIGKILL after a brief delay
            if (force) {
              setTimeout(() => {
                try {
                  execSync(`ps aux | grep -E "\\bclaude\\b" | grep -v "electron" | grep -v "codeagentswarm" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true`);
                } catch (e) {
                  // Ignore errors
                }
              }, 1000);
            }
          } catch (e) {
            console.warn(`Error during Claude cleanup:`, e.message);
          }
        } else if (process.platform === 'linux') {
          // Similar approach for Linux with more specificity
          let shellPid = null;
          if (shell && shell.activeInteractiveProcess && shell.activeInteractiveProcess.pid) {
            shellPid = shell.activeInteractiveProcess.pid;
          }
          
          if (shellPid) {
            require('child_process').execSync(`pkill -P ${shellPid} 2>/dev/null || true`);
            require('child_process').execSync(`kill -9 ${shellPid} 2>/dev/null || true`);
          }
          
          // Kill only standalone claude processes, not our app
          require('child_process').execSync(`ps aux | grep -E "\\bclaude\\b" | grep -v "electron" | grep -v "codeagentswarm" | grep -v grep | awk '{print $2}' | xargs kill -TERM 2>/dev/null || true`);
        }
      } catch (e) {
        console.warn(`Cleanup error for terminal ${quadrant}:`, e.message);
      }
      
      // Retry if this was a force kill and we haven't exceeded max retries
      if (force && retryCount < maxRetries) {
        setTimeout(cleanup, cleanupDelay);
      }
    };
    
    setTimeout(cleanup, cleanupDelay);
  }
});

// Handle adding new terminal
ipcMain.handle('add-terminal', async () => {
  try {
    // Find the next available terminal ID (max 6 terminals)
    const existingTerminals = Array.from(terminals.keys());
    const maxTerminals = 6;
    
    if (existingTerminals.length >= maxTerminals) {
      return { success: false, error: 'Maximum number of terminals (6) reached' };
    }
    
    // Find the first available ID (0-5)
    let newTerminalId = null;
    for (let i = 0; i < maxTerminals; i++) {
      if (!existingTerminals.includes(i)) {
        newTerminalId = i;
        break;
      }
    }
    
    if (newTerminalId === null) {
      return { success: false, error: 'No available terminal slots' };
    }

    // Create a placeholder terminal object to mark this slot as occupied
    // The actual terminal will be created when the user selects a directory
    terminals.set(newTerminalId, {
      id: newTerminalId,
      placeholder: true,
      created: new Date()
    });
    
    return { success: true, terminalId: newTerminalId };
  } catch (error) {
    console.error('Error adding terminal:', error);
    return { success: false, error: error.message };
  }
});

// Handle removing terminal
ipcMain.handle('remove-terminal', async (event, terminalId) => {
  try {
    const shell = terminals.get(terminalId);
    if (shell) {
      console.log(`Removing terminal ${terminalId}...`);
      
      // If it's a real shell (not just a placeholder), kill it
      if (shell.kill && typeof shell.kill === 'function') {
        shell.kill();
      }
      
      terminals.delete(terminalId);
      
      // Cleanup orphaned processes only if it was a real shell
      if (!shell.placeholder) {
        setTimeout(() => {
          if (process.platform === 'darwin') {
            try {
              require('child_process').execSync(`ps aux | grep -E "claude.*${terminalId}" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true`);
            } catch (e) {
              // Ignore errors
            }
          }
        }, 100);
      }
      
      return { success: true };
    } else {
      return { success: false, error: 'Terminal not found' };
    }
  } catch (error) {
    console.error('Error removing terminal:', error);
    return { success: false, error: error.message };
  }
});

// Get active terminals count
ipcMain.handle('get-active-terminals', async () => {
  try {
    const activeTerminals = Array.from(terminals.keys()).sort((a, b) => a - b);
    return { success: true, terminals: activeTerminals };
  } catch (error) {
    console.error('Error getting active terminals:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-claude-code', async () => {
  return new Promise((resolve) => {
    const checkProcess = spawn('which', ['claude-code'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    checkProcess.on('exit', (code) => {
      resolve(code === 0);
    });
    
    checkProcess.on('error', () => {
      resolve(false);
    });
  });
});

// Hooks IPC handlers
ipcMain.handle('hooks-check-status', async () => {
  try {
    if (!hooksManager) {
      return { installed: false, error: 'Hooks manager not initialized' };
    }
    return await hooksManager.checkHooksStatus();
  } catch (error) {
    return { installed: false, error: error.message };
  }
});

ipcMain.handle('hooks-install', async () => {
  try {
    if (!hooksManager) {
      return { success: false, error: 'Hooks manager not initialized' };
    }
    return await hooksManager.installHooks();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('hooks-remove', async () => {
  try {
    if (!hooksManager) {
      return { success: false, error: 'Hooks manager not initialized' };
    }
    return await hooksManager.removeHooks();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('webhook-status', async () => {
  try {
    if (!webhookServer) {
      return { running: false, error: 'Webhook server not initialized' };
    }
    return webhookServer.getStatus();
  } catch (error) {
    return { running: false, error: error.message };
  }
});

// Start MCP server as child process and register with Claude Code
let mcpServerProcess = null;
let mcpServerRestartCount = 0;
let mcpServerRestartTimer = null;
let mcpServerHealthCheckInterval = null;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_DELAY_BASE = 1000; // Base delay for exponential backoff

// Auto-configure MCP in Claude CLI
async function configureMCPInClaudeCLI() {
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // For packaged apps, we need to extract the MCP server to a writable location
    let serverPath;
    if (app.isPackaged) {
      // Use a directory without spaces in the user's home to avoid Claude parsing issues
      const homeDir = os.homedir();
      const mcpDir = path.join(homeDir, '.codeagentswarm-mcp');
      
      // Create MCP directory if it doesn't exist
      if (!fs.existsSync(mcpDir)) {
        fs.mkdirSync(mcpDir, { recursive: true });
      }
      
      // Files needed for MCP to work
      const filesToExtract = [
        'mcp-stdio-server.js',
        'database-mcp.js',
        'database-mcp-standalone.js',
        'database.js',
        'mcp-launcher.sh'
      ];
      
      try {
        // Extract all necessary files
        for (const file of filesToExtract) {
          const bundledPath = path.join(process.resourcesPath, 'app.asar', file);
          const extractedPath = path.join(mcpDir, file);
          
          const content = fs.readFileSync(bundledPath, 'utf8');
          fs.writeFileSync(extractedPath, content, 'utf8');
          console.log(`📦 Extracted ${file} to:`, extractedPath);
        }
        
        serverPath = path.join(mcpDir, 'mcp-stdio-server.js');
      } catch (error) {
        console.error('Failed to extract MCP files:', error);
        return;
      }
    } else {
      // Development mode - use direct path
      serverPath = path.join(__dirname, 'mcp-stdio-server.js');
    }
    
    console.log('🔧 Configuring MCP in Claude CLI...');
    console.log('   Server path:', serverPath);
    
    // Check if claude CLI is available
    let claudeCommand = 'claude';
    try {
      // In packaged apps, we need to find claude explicitly
      if (app.isPackaged) {
        const claudePath = findClaudeBinary();
        if (claudePath) {
          claudeCommand = claudePath;
          console.log('📍 Found Claude CLI at:', claudeCommand);
        } else {
          throw new Error('Claude not found');
        }
      } else {
        await execPromise('which claude');
      }
    } catch (error) {
      console.log('⚠️ Claude CLI not found. Skipping MCP configuration.');
      // Don't show notification here - let checkClaudeInstallation handle it
      return;
    }
    
    // Check if MCP is already configured with correct path
    try {
      // Check both user and local scopes
      const { stdout: userMcpConfig } = await execPromise(`"${claudeCommand}" mcp get codeagentswarm-tasks -s user 2>&1`);
      
      // Check if already configured in user scope with correct path
      if (userMcpConfig.includes(serverPath) && !userMcpConfig.includes('not found')) {
        console.log('✅ MCP already configured correctly in user scope');
        return;
      }
      
      // Remove any local scope configuration to avoid conflicts
      try {
        await execPromise(`"${claudeCommand}" mcp remove codeagentswarm-tasks -s local 2>&1`);
        console.log('🧹 Removed local scope MCP to avoid conflicts');
      } catch (e) {
        // Ignore if not found
      }
    } catch (error) {
      // MCP not configured yet
      console.log('📝 MCP not configured yet, proceeding with setup...');
    }
    
    // Configure MCP globally
    const mcpConfig = {
      command: "node",
      args: [serverPath]
    };
    
    // Configure MCP with user scope (globally available)
    console.log('🔧 Running MCP configuration command...');
    
    // For packaged apps, we need to spawn the process differently
    if (app.isPackaged) {
      // Use spawn to force the command execution
      await new Promise((resolve, reject) => {
        // Find node executable path for claude to use
        let nodeForClaude = 'node';
        const possibleNodePaths = [
          '/usr/local/bin/node',
          '/usr/bin/node',
          '/opt/homebrew/bin/node'
        ];
        
        // Check NVM
        const homeDir = os.homedir();
        const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
        if (fs.existsSync(nvmDir)) {
          try {
            const nodeVersions = fs.readdirSync(nvmDir).sort().reverse();
            for (const version of nodeVersions) {
              const nvmNodePath = path.join(nvmDir, version, 'bin', 'node');
              if (fs.existsSync(nvmNodePath)) {
                possibleNodePaths.unshift(nvmNodePath);
                break;
              }
            }
          } catch (e) {
            // Ignore
          }
        }
        
        // Find first existing node
        for (const nodePath of possibleNodePaths) {
          if (fs.existsSync(nodePath)) {
            nodeForClaude = nodePath;
            console.log('📍 Using node for MCP:', nodeForClaude);
            break;
          }
        }
        
        // Use launcher script to avoid issues with spaces in paths
        const launcherPath = path.join(path.dirname(serverPath), 'mcp-launcher.sh');
        
        // Make sure launcher is executable
        try {
          fs.chmodSync(launcherPath, '755');
        } catch (e) {
          console.log('Could not set launcher permissions:', e.message);
        }
        
        const args = ['mcp', 'add', '-s', 'user', 'codeagentswarm-tasks', launcherPath];
        console.log('🔧 Spawning:', claudeCommand, args.join(' '));
        
        const mcpAddProcess = spawn(claudeCommand, args, {
          stdio: 'pipe',
          shell: true, // Use shell to ensure PATH is available
          env: {
            ...process.env,
            PATH: `/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${process.env.PATH}`
          }
        });
        
        let output = '';
        let errorOutput = '';
        
        mcpAddProcess.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        mcpAddProcess.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
        
        mcpAddProcess.on('close', (code) => {
          if (code === 0) {
            console.log('✅ MCP configured successfully in Claude CLI');
            console.log('📝 Output:', output);
            resolve();
          } else {
            console.error('❌ Failed to configure MCP:', errorOutput || output);
            reject(new Error(`MCP configuration failed with code ${code}`));
          }
        });
        
        mcpAddProcess.on('error', (err) => {
          console.error('❌ Failed to spawn claude mcp add:', err);
          reject(err);
        });
      });
    } else {
      // Development mode - use exec
      const configCommand = `claude mcp add -s user codeagentswarm-tasks node "${serverPath}"`;
      await execPromise(configCommand);
      console.log('✅ MCP configured successfully in Claude CLI');
    }
    
    // Show success notification
    if (Notification.isSupported()) {
      new Notification({
        title: 'CodeAgentSwarm Ready',
        body: 'Task management tools are now available in Claude CLI',
        silent: true
      }).show();
    }
  } catch (error) {
    console.error('Failed to configure MCP in Claude CLI:', error);
  }
}

function startMCPServerAndRegister() {
  try {
    // Clear any existing restart timer
    if (mcpServerRestartTimer) {
      clearTimeout(mcpServerRestartTimer);
      mcpServerRestartTimer = null;
    }

    // Start MCP server as child process
    // For packaged apps, we need to extract files from app.asar to a writable location
    let serverPath, workingDir;
    
    if (app.isPackaged) {
      // Use a directory without spaces in the user's home to avoid Claude parsing issues
      const homeDir = os.homedir();
      const mcpDir = path.join(homeDir, '.codeagentswarm-mcp');
      
      // Create MCP directory if it doesn't exist
      if (!fs.existsSync(mcpDir)) {
        fs.mkdirSync(mcpDir, { recursive: true });
      }
      
      // Files needed for MCP to work
      const filesToExtract = [
        'mcp-stdio-server.js',
        'database-mcp.js',
        'database-mcp-standalone.js',
        'database.js',
        'mcp-launcher.sh'
      ];
      
      try {
        // Extract all necessary files from app.asar
        for (const file of filesToExtract) {
          const bundledPath = path.join(process.resourcesPath, 'app.asar', file);
          const extractedPath = path.join(mcpDir, file);
          
          // Check if file needs to be updated
          let needsUpdate = !fs.existsSync(extractedPath);
          
          if (!needsUpdate) {
            // Check if the bundled version is newer
            try {
              const bundledContent = fs.readFileSync(bundledPath, 'utf8');
              const extractedContent = fs.readFileSync(extractedPath, 'utf8');
              needsUpdate = bundledContent !== extractedContent;
            } catch (e) {
              needsUpdate = true;
            }
          }
          
          if (needsUpdate) {
            const content = fs.readFileSync(bundledPath, 'utf8');
            fs.writeFileSync(extractedPath, content, 'utf8');
            console.log(`📦 Extracted ${file} to:`, extractedPath);
          }
        }
        
        serverPath = path.join(mcpDir, 'mcp-stdio-server.js');
        workingDir = mcpDir;
      } catch (error) {
        console.error('Failed to extract MCP files:', error);
        throw error;
      }
    } else {
      // Development mode - use direct path
      serverPath = path.join(__dirname, 'mcp-stdio-server.js');
      workingDir = __dirname;
    }
    
    console.log('🔧 MCP Server Configuration:');
    console.log('  - Server path:', serverPath);
    console.log('  - Working directory:', workingDir);
    console.log('  - Is packaged:', app.isPackaged);
    console.log('  - Restart attempt:', mcpServerRestartCount);
    
    // Kill any existing process
    if (mcpServerProcess && !mcpServerProcess.killed) {
      console.log('⚠️ Killing existing MCP server process:', mcpServerProcess.pid);
      mcpServerProcess.kill();
    }
    
    // In packaged apps, we need to find node executable or use Electron's node
    let nodeExecutable = 'node';
    
    if (app.isPackaged) {
      // Try to find node in common locations
      const possibleNodePaths = [
        '/usr/local/bin/node',
        '/usr/bin/node',
        '/opt/homebrew/bin/node'
      ];
      
      // Also check NVM installations
      const homeDir = os.homedir();
      const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
      if (fs.existsSync(nvmDir)) {
        try {
          const nodeVersions = fs.readdirSync(nvmDir).sort().reverse();
          for (const version of nodeVersions) {
            const nvmNodePath = path.join(nvmDir, version, 'bin', 'node');
            if (fs.existsSync(nvmNodePath)) {
              possibleNodePaths.unshift(nvmNodePath); // Add to beginning
              break; // Use the first (latest) version found
            }
          }
        } catch (e) {
          console.log('Could not read NVM directory:', e.message);
        }
      }
      
      possibleNodePaths.push(process.execPath); // Use Electron's executable as fallback
      
      for (const nodePath of possibleNodePaths) {
        if (fs.existsSync(nodePath) && nodePath !== process.execPath) {
          nodeExecutable = nodePath;
          console.log('📍 Found node at:', nodeExecutable);
          break;
        }
      }
      
      // If no system node found, use Electron's node
      if (nodeExecutable === 'node') {
        nodeExecutable = process.execPath;
        console.log('📍 Using Electron executable:', nodeExecutable);
      }
    }
    
    const spawnArgs = nodeExecutable === process.execPath 
      ? [serverPath] // Electron can run JS files directly
      : [serverPath]; // Regular node
    
    mcpServerProcess = spawn(nodeExecutable, spawnArgs, {
      cwd: workingDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'production',
        ELECTRON_RUN_AS_NODE: nodeExecutable === process.execPath ? '1' : undefined
      }
    });

    console.log('🚀 Started MCP server as child process:', mcpServerProcess.pid);

    // Handle server output
    mcpServerProcess.stdout.on('data', (data) => {
      console.log('MCP Server:', data.toString());
    });

    mcpServerProcess.stderr.on('data', (data) => {
      const errorMsg = data.toString();
      console.error('MCP Server Error:', errorMsg);
      
      // Log detailed errors to help diagnose issues
      if (errorMsg.includes('EADDRINUSE')) {
        console.error('⚠️ MCP Server port already in use. Attempting to find free port...');
      } else if (errorMsg.includes('ENOENT')) {
        console.error('⚠️ MCP Server file not found. Check file paths.');
      }
    });

    mcpServerProcess.on('error', (error) => {
      console.error('❌ MCP Server Process Error:', error);
    });

    mcpServerProcess.on('close', (code, signal) => {
      console.log(`MCP server process exited with code: ${code}, signal: ${signal}`);
      mcpServerProcess = null;
      
      // Clear health check interval
      if (mcpServerHealthCheckInterval) {
        clearInterval(mcpServerHealthCheckInterval);
        mcpServerHealthCheckInterval = null;
      }
      
      // Attempt to restart if not shutting down
      if (!app.isQuitting && mcpServerRestartCount < MAX_RESTART_ATTEMPTS) {
        mcpServerRestartCount++;
        const delay = RESTART_DELAY_BASE * Math.pow(2, mcpServerRestartCount - 1);
        
        console.log(`⚠️ MCP Server crashed. Attempting restart ${mcpServerRestartCount}/${MAX_RESTART_ATTEMPTS} in ${delay}ms...`);
        
        mcpServerRestartTimer = setTimeout(() => {
          startMCPServerAndRegister();
        }, delay);
      } else if (mcpServerRestartCount >= MAX_RESTART_ATTEMPTS) {
        console.error('❌ MCP Server failed to start after maximum attempts. Please check logs.');
        
        // Show user notification
        if (Notification.isSupported()) {
          new Notification({
            title: 'MCP Server Error',
            body: 'The MCP server failed to start. Task management features may not work correctly.',
            urgency: 'critical'
          }).show();
        }
      }
    });

    // Reset restart count on successful start
    mcpServerProcess.on('spawn', () => {
      console.log('✅ MCP Server spawned successfully');
      mcpServerRestartCount = 0;
      
      // Start health check after server is stable
      setTimeout(() => {
        startMCPHealthCheck();
      }, 5000);
    });

    // Only check for Claude Code if explicitly requested or first run
    // Comment out automatic registration to avoid annoying users
    /*
    console.log('⏰ Setting timeout to call registerWithClaude...');
    setTimeout(() => {
      console.log('⏰ First timeout reached. Window visible?', mainWindow && mainWindow.isVisible());
      if (mainWindow && mainWindow.isVisible()) {
        registerWithClaude();
      } else {
        // Wait a bit more if window isn't ready
        console.log('⏰ Window not ready, waiting 2 more seconds...');
        setTimeout(() => {
          console.log('⏰ Second timeout reached, calling registerWithClaude anyway');
          registerWithClaude();
        }, 2000);
      }
    }, 1000);
    */

    return true;
  } catch (error) {
    console.error('❌ Failed to start MCP server:', error.message);
    console.error('Stack trace:', error.stack);
    return false;
  }
}

// Health check function
function startMCPHealthCheck() {
  // Clear any existing interval
  if (mcpServerHealthCheckInterval) {
    clearInterval(mcpServerHealthCheckInterval);
  }
  
  // Check every 30 seconds
  mcpServerHealthCheckInterval = setInterval(() => {
    if (!mcpServerProcess || mcpServerProcess.killed) {
      console.log('⚠️ MCP Server health check failed: process not running');
      clearInterval(mcpServerHealthCheckInterval);
      mcpServerHealthCheckInterval = null;
      
      // Attempt restart if not already restarting
      if (!mcpServerRestartTimer && mcpServerRestartCount < MAX_RESTART_ATTEMPTS) {
        startMCPServerAndRegister();
      }
    } else {
      // Process is running, could add more sophisticated health checks here
      console.log('✅ MCP Server health check passed');
    }
  }, 30000);
}

function updateClaudeConfigFile() {
  try {
    const configPath = path.join(os.homedir(), '.claude', 'claude_desktop_config.json');
    let config = {};
    
    // Read existing config if it exists
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
    }
    
    // Ensure mcpServers object exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    
    // Update codeagentswarm-tasks configuration
    const serverPath = app.isPackaged 
      ? path.join(app.getPath('userData'), 'mcp', 'mcp-stdio-server.js')
      : path.join(__dirname, 'mcp-stdio-server.js');
    
    config.mcpServers['codeagentswarm-tasks'] = {
      command: 'node',
      args: [serverPath],
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--unhandled-rejections=strict'
      }
    };
    
    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('✅ Updated Claude Code config file at:', configPath);
    
    return true;
  } catch (error) {
    console.error('❌ Failed to update Claude config file:', error);
    return false;
  }
}

// New function to just check Claude installation without auto-installing
function checkClaudeInstallation() {
  console.log('🔍 Checking for Claude Code installation...');
  
  // Use the existing findClaudeBinary function which is more robust
  const claudePath = findClaudeBinary();
  
  if (!claudePath) {
    // Claude Code is not installed - just show a notification
    console.log('⚠️ Claude Code not found in any location');
    
    // Only show notification once per session
    if (!global.claudeNotificationShown) {
      global.claudeNotificationShown = true;
      
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: 'Claude Code no detectado',
          body: 'Instala Claude Code para habilitar las funciones de gestión de tareas',
          silent: true
        });
        
        notification.show();
        
        notification.on('click', () => {
          // Open Claude Code installation page
          require('electron').shell.openExternal('https://claude.ai/code');
        });
      }
    }
  } else {
    console.log('✅ Claude Code is installed at:', claudePath);
    CLAUDE_BINARY_PATH = claudePath;
    
    // Configure MCP if needed
    configureMCPInClaudeCLI().catch(error => {
      console.error('MCP configuration error:', error);
    });
  }
}

function registerWithClaude() {
  console.log('🔍 registerWithClaude called - checking for Claude Code...');
  
  // First check if Claude Code is installed
  const checkClaude = spawn('which', ['claude'], {
    shell: true
  });
  
  checkClaude.on('close', async (code) => {
    console.log('🔍 which claude returned code:', code);
    
    if (code !== 0) {
      // Claude Code is not installed
      console.log('⚠️ Claude Code not found - starting automatic installation');
      
      // Create and show progress window immediately
      const progressWindow = new BrowserWindow({
        parent: mainWindow,
        modal: true,
        width: 450,
        height: 200,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        },
        frame: false,
        backgroundColor: '#1e1e1e',
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        center: true
      });
      
      progressWindow.loadURL(`data:text/html,
        <html>
          <head>
            <style>
              body {
                margin: 0;
                padding: 30px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                background: #1e1e1e;
                color: #ffffff;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                height: 100vh;
                box-sizing: border-box;
              }
              h2 { 
                margin: 0 0 20px 0; 
                font-weight: 500;
                color: #ffffff;
              }
              .spinner {
                border: 3px solid rgba(255, 255, 255, 0.1);
                border-top: 3px solid #0084ff;
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 20px auto;
              }
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
              .status {
                color: #999;
                font-size: 14px;
                margin-top: 10px;
                text-align: center;
              }
              .command {
                font-family: 'Consolas', 'Monaco', monospace;
                background: rgba(255, 255, 255, 0.1);
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 12px;
                color: #0084ff;
                margin-top: 10px;
              }
            </style>
          </head>
          <body>
            <h2>Instalando Claude Code</h2>
            <div class="spinner"></div>
            <div class="status">Ejecutando instalación con npm...</div>
            <div class="command">npm install -g @anthropic-ai/claude-code</div>
          </body>
        </html>
      `);
      
      // Wait a moment for the window to render
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Run npm install
      console.log('📦 Running npm install -g @anthropic-ai/claude-code...');
      const npmInstall = spawn('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
        shell: true,
        stdio: 'pipe'
      });
      
      let installOutput = '';
      let errorOutput = '';
      
      npmInstall.stdout.on('data', (data) => {
        installOutput += data.toString();
        console.log('npm stdout:', data.toString());
      });
      
      npmInstall.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.log('npm stderr:', data.toString());
      });
      
      npmInstall.on('close', (installCode) => {
        progressWindow.close();
        
        if (installCode === 0) {
          console.log('✅ Claude Code installed successfully');
          
          // Show success notification
          new Notification({
            title: 'Claude Code instalado',
            body: 'Claude Code se ha instalado correctamente. Configurando MCP...',
            icon: path.join(__dirname, 'icon.png')
          }).show();
          
          // Configure MCP after successful installation
          setTimeout(() => {
            console.log('🔧 Configuring MCP after installation...');
            configureMCPInClaudeCLI();
            // Also register with the newly installed Claude
            registerWithClaude();
          }, 1000);
          
        } else {
          console.error('❌ Failed to install Claude Code:', errorOutput);
          
          // Show error dialog with more options
          dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Error de instalación',
            message: 'No se pudo instalar Claude Code automáticamente',
            detail: `Esto puede deberse a permisos de npm o problemas de red.\n\nPuedes intentar:\n1. Ejecutar manualmente: npm install -g @anthropic-ai/claude-code\n2. Usar sudo si estás en macOS/Linux\n3. Descargar desde: https://claude.ai/code`,
            buttons: ['OK', 'Abrir página de descarga'],
            defaultId: 0
          }).then(result => {
            if (result.response === 1) {
              require('electron').shell.openExternal('https://claude.ai/code');
            }
          });
        }
      });
      
      return;
    }
    
    // Claude is installed, proceed with registration
    try {
      // First update the config file
      const configUpdated = updateClaudeConfigFile();
      if (!configUpdated) {
        console.error('Failed to update Claude config file, trying CLI method anyway...');
      }
      
      // Use claude mcp add to register our server
      const serverPath = app.isPackaged 
        ? path.join(process.resourcesPath, 'app.asar', 'mcp-stdio-server.js')
        : path.join(__dirname, 'mcp-stdio-server.js');
        
      const registerProcess = spawn('claude', [
        'mcp', 'add', 
        'codeagentswarm-tasks',  // Server name
        'node', serverPath       // Command and args
      ], {
        cwd: __dirname,
        stdio: 'pipe'
      });

    registerProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Successfully registered MCP server with Claude Code');
        console.log('💡 Use /mcp in Claude Code to see available tools');
        
      } else {
        console.error('❌ Failed to register MCP server with Claude Code (exit code:', code, ')');
        console.log('💡 You can manually register with: claude mcp add codeagentswarm-tasks node', serverPath);
      }
    });

      registerProcess.stderr.on('data', (data) => {
        console.error('Claude registration error:', data.toString());
      });

    } catch (error) {
      console.error('❌ Failed to register with Claude Code:', error.message);
      console.log('💡 Make sure Claude Code is installed and accessible via "claude" command');
    }
  });
}

// Handle directory selection
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select directory for Claude Code'
  });
  
  if (!result.canceled) {
    const selectedPath = result.filePaths[0];
    
    // Auto-configure CLAUDE.md for MCP Task Manager
    ensureClaudeMdConfiguration(selectedPath);
    
    return selectedPath;
  }
  return null;
});

// Database handlers
ipcMain.handle('db-save-directory', async (event, terminalId, directory) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    
    // Save terminal directory
    const result = db.saveTerminalDirectory(terminalId, directory);
    
    // Ensure CLAUDE.md is configured for this directory
    if (result.success && directory) {
      ensureClaudeMdConfiguration(directory);
    }
    
    // Check if a project exists for this directory
    if (result.success && directory) {
      const existingProject = db.getProjectByPath(directory);
      
      if (!existingProject) {
        // Create a new project based on the directory
        const path = require('path');
        const projectName = path.basename(directory);
        
        // Generate a nice display name from the directory name
        const displayName = projectName
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
        
        console.log(`Creating new project "${displayName}" for directory: ${directory}`);
        
        // Create the project with the directory as its path
        const projectResult = db.createProject(projectName, directory);
        
        if (projectResult.success) {
          // Update display name if different from project name
          if (displayName !== projectName) {
            db.updateProjectDisplayName(projectName, displayName);
          }
          console.log(`Successfully created project "${displayName}" for new terminal directory`);
        }
      }
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db-get-directory', async (event, terminalId) => {
  try {
    if (!db) return { success: true, directory: null };
    const directory = db.getTerminalDirectory(terminalId);
    return { success: true, directory };
  } catch (error) {
    return { success: true, directory: null };
  }
});

ipcMain.handle('db-get-all-directories', async () => {
  try {
    if (!db) return { success: true, directories: {} };
    const directories = db.getAllTerminalDirectories();
    return { success: true, directories };
  } catch (error) {
    return { success: true, directories: {} };
  }
});

// Task management handlers
ipcMain.handle('task-create', async (event, title, description, terminalId, project) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.createTask(title, description, terminalId, project);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('task-update-status', async (event, taskId, status) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateTaskStatus(taskId, status);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('task-get-all', async () => {
  try {
    if (!db) return { success: true, tasks: [] };
    const tasks = db.getAllTasks();
    return { success: true, tasks };
  } catch (error) {
    return { success: true, tasks: [] };
  }
});

ipcMain.handle('task-get-current', async (event, terminalId) => {
  try {
    if (!db) return { success: true, task: null };
    const task = db.getCurrentTask(terminalId);
    return { success: true, task };
  } catch (error) {
    return { success: true, task: null };
  }
});

ipcMain.handle('task-delete', async (event, taskId) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.deleteTask(taskId);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('task-update', async (event, taskId, title, description, project) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateTask(taskId, title, description);
    // Update project separately if needed
    if (result.success && project) {
      db.updateTaskProject(taskId, project);
    }
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('task-update-terminal', async (event, taskId, terminalId) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateTaskTerminal(taskId, terminalId);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('task-update-order', async (event, taskOrders) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = await db.updateTasksOrder(taskOrders);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('task-update-plan', async (event, taskId, plan) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateTaskPlan(taskId, plan);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('task-update-implementation', async (event, taskId, implementation) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateTaskImplementation(taskId, implementation);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Project management handlers
ipcMain.handle('project-get-all', async () => {
  try {
    if (!db) return { success: true, projects: [] };
    const projects = db.getProjects();
    return { success: true, projects };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-project-folder', async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Project Folder',
    buttonLabel: 'Select Folder'
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
});

ipcMain.handle('project-create', async (event, name, color, folderPath) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    
    // Create project in database with folder path
    const result = db.createProject(name, folderPath, color);
    
    if (result.success && folderPath) {
      // Create or update CLAUDE.md in the selected folder
      try {
        const claudeMdPath = path.join(folderPath, 'CLAUDE.md');
        const { getCodeAgentSwarmSection, SECTION_START, SECTION_END } = require('./claude-md-config');
        
        let content = '';
        let existingContent = '';
        
        // Read existing content if file exists
        if (fs.existsSync(claudeMdPath)) {
          existingContent = fs.readFileSync(claudeMdPath, 'utf8');
          
          // Check if CodeAgentSwarm section exists
          const startIndex = existingContent.indexOf(SECTION_START);
          const endIndex = existingContent.indexOf(SECTION_END);
          
          if (startIndex !== -1 && endIndex !== -1) {
            // Replace existing section
            content = existingContent.substring(0, startIndex) +
                     getCodeAgentSwarmSection(name) +
                     existingContent.substring(endIndex + SECTION_END.length);
          } else {
            // Append new section
            content = existingContent + (existingContent.endsWith('\n') ? '' : '\n') +
                     getCodeAgentSwarmSection(name);
          }
        } else {
          // Create new file with CodeAgentSwarm section
          content = getCodeAgentSwarmSection(name);
        }
        
        // Write the file
        fs.writeFileSync(claudeMdPath, content, 'utf8');
        console.log(`Updated CLAUDE.md in ${folderPath} with project name: ${name}`);
        
      } catch (error) {
        console.log(`Error updating CLAUDE.md: ${error.message}`);
        // Don't fail the project creation if CLAUDE.md update fails
      }
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Helper function to update project name in CLAUDE.md
function updateClaudeMdProjectName(filePath, newProjectName) {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`CLAUDE.md not found at: ${filePath}`);
      return false;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Update project name in the Project Configuration section
    // Look for pattern: **Project Name**: [old name]
    const projectNameRegex = /(\*\*Project Name\*\*:\s*)(.+?)(?=\n|$)/;
    
    if (projectNameRegex.test(content)) {
      const oldProjectName = content.match(projectNameRegex)[2];
      content = content.replace(projectNameRegex, `$1${newProjectName}`);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated project name from "${oldProjectName}" to "${newProjectName}" in ${filePath}`);
      return true;
    } else {
      console.log(`Project name pattern not found in ${filePath}`);
    }
    
    return false;
  } catch (error) {
    console.log(`Error updating CLAUDE.md: ${error.message}`);
    return false;
  }
}

ipcMain.handle('project-update-display-name', async (event, name, displayName) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    
    // Update project display name in database
    const result = db.updateProjectDisplayName(name, displayName);
    
    if (result.success) {
      // Get the project to find its path
      const project = db.getProjectByName(name);
      if (project && project.path) {
        const claudeMdPath = path.join(project.path, 'CLAUDE.md');
        console.log(`Attempting to update CLAUDE.md at: ${claudeMdPath}`);
        const updated = updateClaudeMdProjectName(claudeMdPath, displayName);
        if (updated) {
          console.log(`✅ Successfully updated CLAUDE.md in ${project.path} with new project name: ${displayName}`);
        } else {
          console.log(`❌ Failed to update CLAUDE.md in ${project.path} - file may not exist or project name not found`);
        }
      }
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-update-color', async (event, name, color) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateProjectColor(name, color);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-update-path', async (event, name, newPath) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateProjectPath(name, newPath);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-delete', async (event, name) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.deleteProject(name);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-mcp-port', async () => {
  try {
    if (!mcpServer) return { success: false, error: 'MCP server not started' };
    const port = mcpServer.getPort();
    return { success: true, port };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('dialog-open-directory', async (event) => {
  try {
    // Don't specify a parent window to avoid crashes
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Project Directory'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
  } catch (error) {
    console.error('Error in dialog-open-directory:', error);
    return { success: false, error: error.message };
  }
});

// Show confirmation dialog
ipcMain.handle('show-confirm-dialog', async (event, options) => {
  try {
    const result = await dialog.showMessageBox({
      type: 'question',
      buttons: options.buttons || ['OK', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: options.title || 'Confirm',
      message: options.message || 'Are you sure?'
    });
    return result.response;
  } catch (error) {
    console.error('Error in show-confirm-dialog:', error);
    return 1; // Return cancel index on error
  }
});

// Open Kanban window
ipcMain.on('open-kanban-window', (event, options = {}) => {
  // If kanban window already exists, just focus it
  if (kanbanWindow && !kanbanWindow.isDestroyed()) {
    kanbanWindow.focus();
    if (options.focusTaskId) {
      kanbanWindow.webContents.send('focus-task', options.focusTaskId);
    }
    return;
  }
  
  kanbanWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Task Manager - Kanban Board',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    // Remove parent relationship to prevent minimizing main window
    modal: false,
    show: false, // Start hidden to prevent white flash
    backgroundColor: '#1a1a1a', // Dark background to match theme
    autoHideMenuBar: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    // Add icon to make it look like a separate app
    icon: path.join(__dirname, 'assets', 'icon.png'),
    // Focus the window when it opens
    alwaysOnTop: false,
    focusable: true
  });

  kanbanWindow.loadFile('kanban.html');
  
  // Show and focus the window after loading
  kanbanWindow.webContents.once('did-finish-load', () => {
    kanbanWindow.show();
    kanbanWindow.focus();
    
    // Send focus task ID if provided
    if (options.focusTaskId) {
      kanbanWindow.webContents.send('focus-task', options.focusTaskId);
    }
  });
  
  // Clean up reference when window is closed
  kanbanWindow.on('closed', () => {
    kanbanWindow = null;
  });
  
});

// Handle task creation from renderer
ipcMain.on('create-task', async (event, taskData) => {
  try {
    const result = await db.createTask(
      taskData.title,
      taskData.description || '',
      taskData.terminal_id,
      taskData.project
    );
    
    // Notify the renderer of successful creation
    event.reply('task-created', {
      success: true,
      task: result
    });
    
    // Refresh task list in all terminals
    mainWindow.webContents.send('refresh-tasks');
    
    
  } catch (error) {
    console.error('Error creating task:', error);
    event.reply('task-created', {
      success: false,
      error: error.message
    });
  }
});

app.whenReady().then(async () => {
  // Initialize database
  try {
    db = new DatabaseManager();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    db = null;
  }
  
  // Start MCP Task Server
  try {
    mcpServer = new MCPTaskServer();
    const port = await mcpServer.start();
    console.log(`MCP Task Server running on port ${port}`);
    
    // Create MCP configuration file for Claude Code
    // Note: We don't use WebSocket MCP anymore, we use stdio MCP
    // createMCPConfig(port);
  } catch (error) {
    console.error('Failed to start MCP Task Server:', error);
    mcpServer = null;
  }
  
  // Find claude binary on startup
  CLAUDE_BINARY_PATH = findClaudeBinary();
  if (!CLAUDE_BINARY_PATH) {
    console.warn('Claude Code not found - users will need to install it');
  }
  
  createWindow();
  
  // Initialize hooks manager and webhook server
  try {
    hooksManager = new HooksManager();
    webhookServer = new WebhookServer(mainWindow);
    
    // Start webhook server
    const webhookResult = await webhookServer.start();
    if (webhookResult.success) {
      console.log(`Webhook server started on port ${webhookResult.port}`);
      
      // Install hooks automatically
      const hooksStatus = await hooksManager.checkHooksStatus();
      if (!hooksStatus.installed) {
        console.log('Installing CodeAgentSwarm hooks...');
        const installResult = await hooksManager.installHooks();
        if (installResult.success) {
          console.log('Hooks installed successfully');
        } else {
          console.error('Failed to install hooks:', installResult.error);
        }
      } else {
        console.log('Hooks already installed');
      }
    } else {
      console.error('Failed to start webhook server:', webhookResult.error);
    }
  } catch (error) {
    console.error('Failed to initialize hooks system:', error);
  }
  
  // Start MCP server and register with Claude Code
  try {
    startMCPServerAndRegister();
    
    // Check and install Claude Code if needed
    console.log('🔍 Checking Claude Code installation on startup...');
    checkClaudeInstallation();
    
    // Auto-configure MCP in Claude CLI (non-blocking)
    configureMCPInClaudeCLI().catch(error => {
      console.error('MCP auto-configuration error:', error);
    });
  } catch (error) {
    console.error('Failed to start MCP server and register:', error);
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Mark app as quitting to prevent restarts
  app.isQuitting = true;
  
  terminals.forEach((shell) => {
    shell.kill();
  });
  terminals.clear();
  
  // Clear health check interval
  if (mcpServerHealthCheckInterval) {
    clearInterval(mcpServerHealthCheckInterval);
    mcpServerHealthCheckInterval = null;
  }
  
  // Clear restart timer
  if (mcpServerRestartTimer) {
    clearTimeout(mcpServerRestartTimer);
    mcpServerRestartTimer = null;
  }
  
  // Stop MCP servers
  if (mcpServer) {
    mcpServer.stop();
  }
  
  // Stop MCP child process
  if (mcpServerProcess) {
    console.log('Stopping MCP server process...');
    mcpServerProcess.kill();
    mcpServerProcess = null;
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Function to find claude binary dynamically
function findClaudeBinary() {
  const { execSync } = require('child_process');
  
  // Try to find claude using which command
  try {
    const claudePath = execSync('which claude', { encoding: 'utf8', shell: true }).trim();
    if (claudePath && fs.existsSync(claudePath)) {
      console.log('Found claude via which:', claudePath);
      return claudePath;
    }
  } catch (e) {
    console.log('which claude failed, searching manually...');
  }
  
  // Try to find claude through npm global list
  try {
    const npmList = execSync('npm list -g @anthropic-ai/claude-code --depth=0', { encoding: 'utf8', shell: true });
    if (npmList.includes('@anthropic-ai/claude-code')) {
      // Get npm global bin directory
      const npmBin = execSync('npm bin -g', { encoding: 'utf8', shell: true }).trim();
      const npmClaudePath = path.join(npmBin, 'claude');
      if (fs.existsSync(npmClaudePath)) {
        console.log('Found claude via npm global:', npmClaudePath);
        return npmClaudePath;
      }
    }
  } catch (e) {
    console.log('npm list check failed, continuing with manual search...');
  }
  
  // Search common locations
  const possiblePaths = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/bin/claude',
    path.join(os.homedir(), '.local/bin/claude'),
    // Additional paths for different installation methods
    path.join(os.homedir(), 'bin/claude'),
    '/Applications/Claude.app/Contents/MacOS/claude',
    '/Applications/Claude Code.app/Contents/MacOS/claude',
    // Homebrew on Apple Silicon
    '/opt/homebrew/opt/claude/bin/claude',
    // Common npm global paths
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude',
    '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude'
  ];
  
  // Search all nvm node versions
  const nvmPath = path.join(os.homedir(), '.nvm/versions/node');
  if (fs.existsSync(nvmPath)) {
    try {
      const nodeVersions = fs.readdirSync(nvmPath);
      nodeVersions.forEach(version => {
        possiblePaths.push(path.join(nvmPath, version, 'bin/claude'));
      });
    } catch (e) {
      console.log('Error reading nvm versions:', e);
    }
  }
  
  // Check each path
  for (const claudePath of possiblePaths) {
    if (fs.existsSync(claudePath)) {
      console.log('Found claude at:', claudePath);
      return claudePath;
    }
  }
  
  console.error('Claude not found in any common location');
  return null;
}

// Find claude once on startup
let CLAUDE_BINARY_PATH = null;

// Function to create MCP configuration for Claude Code
function createMCPConfig(port) {
  try {
    const configDir = path.join(os.homedir(), '.claude');
    const configPath = path.join(configDir, 'claude_desktop_config.json');
    
    // Create .claude directory if it doesn't exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    // Read existing config or create new one
    let config = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (error) {
        console.warn('Failed to parse existing Claude config, creating new one');
        config = {};
      }
    }
    
    // Ensure mcpServers section exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    
    // Path to our MCP client script
    const mcpClientPath = path.join(__dirname, 'mcp-client.js');
    
    // Add our task server with better configuration
    config.mcpServers.codeagentswarm = {
      command: "node",
      args: [mcpClientPath, `--port=${port}`],
      env: {
        "NODE_OPTIONS": "--unhandled-rejections=strict"
      }
    };
    
    // Write config back
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`MCP configuration updated at ${configPath}`);
    console.log(`Task server available at ws://localhost:${port}`);
    
    // Also create a README file with usage instructions
    const readmePath = path.join(configDir, 'CODEAGENTSWARM_README.md');
    const readmeContent = `# CodeAgentSwarm Task Management

This MCP server provides task management capabilities for Claude Code.

## Available Methods

### \`tasks/create\`
Create a new task.
\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tasks/create",
  "params": {
    "title": "Task title",
    "description": "Task description (optional)",
    "terminal_id": 0
  }
}
\`\`\`

### \`tasks/update_status\`
Update task status.
\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tasks/update_status",
  "params": {
    "task_id": 1,
    "status": "in_progress"
  }
}
\`\`\`

### \`tasks/get_all\`
Get all tasks.
\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tasks/get_all",
  "params": {}
}
\`\`\`

### \`tasks/get_current\`
Get current task for a terminal.
\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tasks/get_current",
  "params": {
    "terminal_id": 0
  }
}
\`\`\`

## Status Values
- \`pending\`: Task is pending
- \`in_progress\`: Task is currently being worked on
- \`completed\`: Task is completed

## Server Details
- Port: ${port}
- WebSocket URL: ws://localhost:${port}
- Configuration: ${configPath}
`;
    
    fs.writeFileSync(readmePath, readmeContent);
    console.log(`Documentation created at ${readmePath}`);
    
  } catch (error) {
    console.error('Failed to create MCP config:', error);
  }
}

// Desktop notification handler
ipcMain.on('show-badge-notification', (event, message) => {
  // Send badge notification to main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('display-badge', message);
  }
});

ipcMain.on('show-desktop-notification', (event, title, message) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title,
      body: message,
      icon: path.join(__dirname, 'assets', 'icon.png'), // Optional: Add app icon
      sound: true,
      urgency: 'critical'
    });
    
    notification.show();
    
    // Optional: Handle notification click
    notification.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  } else {
    console.log('Desktop notifications not supported on this system');
  }
});

// Open system notification settings
ipcMain.on('open-system-notifications', (event) => {
  const { shell } = require('electron');
  
  if (process.platform === 'darwin') {
    // macOS: Open System Settings > Notifications
    shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
  } else if (process.platform === 'win32') {
    // Windows: Open Settings > System > Notifications
    shell.openExternal('ms-settings:notifications');
  } else {
    // Linux: Try to open system settings (varies by distribution)
    shell.openExternal('gnome-control-center notifications') ||
    shell.openExternal('unity-control-center notifications') ||
    shell.openExternal('systemsettings5 notifications');
  }
});

// Task notification file checker
ipcMain.handle('check-task-notifications', async () => {
  try {
    const notificationDir = path.join(os.homedir(), '.codeagentswarm');
    const notificationFile = path.join(notificationDir, 'task_notifications.json');
    
    // If file doesn't exist, no notifications
    if (!fs.existsSync(notificationFile)) {
      return { success: true, notifications: [] };
    }
    
    // Read and parse notifications
    const content = fs.readFileSync(notificationFile, 'utf8');
    let notifications = JSON.parse(content);
    
    // Filter unprocessed notifications
    const unprocessed = notifications.filter(n => !n.processed);
    
    if (unprocessed.length > 0) {
      // Mark all notifications as processed
      notifications = notifications.map(n => ({ ...n, processed: true }));
      
      // Write back to file
      fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
      
      return { success: true, notifications: unprocessed };
    }
    
    return { success: true, notifications: [] };
  } catch (error) {
    console.error('Error checking task notifications:', error);
    return { success: false, error: error.message };
  }
});

// Update app badge count handler
ipcMain.handle('update-badge-count', async (event, count) => {
  try {
    // Set badge count on macOS dock and Windows taskbar
    if (process.platform === 'darwin') {
      // macOS: set dock badge
      app.badgeCount = count;
    } else if (process.platform === 'win32' && mainWindow) {
      // Windows: use overlay icon or flash frame
      if (count > 0) {
        mainWindow.flashFrame(true);
        // You can also set an overlay icon here if you have badge images
      } else {
        mainWindow.flashFrame(false);
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error updating badge count:', error);
    return { success: false, error: error.message };
  }
});

// Get notification count from terminals waiting for response
ipcMain.handle('get-notification-count', async () => {
  try {
    return { success: true, count: terminalsWaitingForResponse.size };
  } catch (error) {
    console.error('Error getting notification count:', error);
    return { success: false, error: error.message };
  }
});

// Update terminals waiting for response
ipcMain.handle('update-terminals-waiting', async (event, waitingTerminals) => {
  try {
    terminalsWaitingForResponse = new Set(waitingTerminals);
    // Update badge count
    if (process.platform === 'darwin') {
      app.badgeCount = terminalsWaitingForResponse.size;
    }
    return { success: true };
  } catch (error) {
    console.error('Error updating terminals waiting:', error);
    return { success: false, error: error.message };
  }
});

// Git operations helpers
function getGitWorkingDirectory() {
  // Get current working directory from the first terminal or use process.cwd()
  let cwd = process.cwd();
  
  // Try to get working directory from the active terminal
  if (terminals.size > 0) {
    const firstTerminal = terminals.values().next().value;
    if (firstTerminal && firstTerminal.cwd) {
      cwd = firstTerminal.cwd;
    }
  }
  
  return cwd;
}

function getTerminalWorkingDirectory(terminalId) {
  // Get working directory from specific terminal
  if (terminals.has(terminalId)) {
    const terminal = terminals.get(terminalId);
    if (terminal && terminal.cwd) {
      return terminal.cwd;
    }
  }
  
  // Fallback to process.cwd()
  return process.cwd();
}

// Git status handler
ipcMain.handle('get-git-status', async () => {
  const { execSync } = require('child_process');
  try {
    const cwd = getGitWorkingDirectory();
    
    // Check if directory is a git repository
    const isGitRepo = execSync('git rev-parse --is-inside-work-tree', { 
      cwd, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim() === 'true';
    
    if (!isGitRepo) {
      return { success: false, error: 'Not a git repository' };
    }
    
    // Get git status with porcelain format for easy parsing
    const statusOutput = execSync('git status --porcelain', { 
      cwd, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    
    // Parse the status output
    const files = [];
    const lines = statusOutput.trim().split('\n').filter(line => line.length > 0);
    
    lines.forEach(line => {
      if (line.length < 3) return; // Skip invalid lines
      
      const status = line.substring(0, 2);
      const fileName = line.substring(2).trim();
      
      let statusText = '';
      // Check both index and working tree status (first and second character)
      const indexStatus = status[0];
      const workingStatus = status[1];
      
      // Priority: working tree changes, then index changes
      if (workingStatus === 'M' || indexStatus === 'M') {
        statusText = 'Modified';
      } else if (workingStatus === 'A' || indexStatus === 'A') {
        statusText = 'Added';
      } else if (workingStatus === 'D' || indexStatus === 'D') {
        statusText = 'Deleted';
      } else if (workingStatus === 'R' || indexStatus === 'R') {
        statusText = 'Renamed';
      } else if (workingStatus === 'C' || indexStatus === 'C') {
        statusText = 'Copied';
      } else if (workingStatus === 'T' || indexStatus === 'T') {
        statusText = 'Type Changed';
      } else if (status === '??') {
        statusText = 'Untracked';
      } else if (status === '!!') {
        statusText = 'Ignored';
      } else {
        statusText = 'Modified'; // Default to Modified for most cases
      }
      
      files.push({
        file: fileName,
        status: statusText,
        raw: status,
        staged: indexStatus !== ' ' && indexStatus !== '?'
      });
    });
    
    // Get current branch
    const branch = execSync('git branch --show-current', { 
      cwd, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    
    // Get recent commits
    const commits = execSync('git log --oneline -10', { 
      cwd, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim().split('\n').filter(line => line.length > 0).map(line => {
      const [hash, ...messageParts] = line.split(' ');
      return {
        hash: hash,
        message: messageParts.join(' ')
      };
    });
    
    // Check for unpushed commits
    let unpushedCount = 0;
    let hasUpstream = true;
    try {
      // First check if there's an upstream branch
      execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
        cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      
      // Count unpushed commits
      const unpushedOutput = execSync('git rev-list --count @{u}..HEAD', { 
        cwd, 
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      unpushedCount = parseInt(unpushedOutput) || 0;
    } catch (e) {
      // No upstream branch configured
      hasUpstream = false;
      // Count all commits if no upstream
      try {
        const allCommitsCount = execSync('git rev-list --count HEAD', {
          cwd,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
        unpushedCount = parseInt(allCommitsCount) || 0;
      } catch (e2) {
        // Ignore
      }
    }
    
    return { 
      success: true, 
      files, 
      branch,
      workingDirectory: cwd,
      commits,
      unpushedCount,
      hasUpstream
    };
    
  } catch (error) {
    console.error('Git status error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to get git status'
    };
  }
});

// Git commit handler
ipcMain.handle('git-commit', async (event, message, files) => {
  const { execSync } = require('child_process');
  try {
    const cwd = getGitWorkingDirectory();
    
    // Check if directory is a git repository
    const isGitRepo = execSync('git rev-parse --is-inside-work-tree', { 
      cwd, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim() === 'true';
    
    if (!isGitRepo) {
      return { success: false, error: 'Not a git repository' };
    }
    
    // Add specific files or all if none specified
    if (files && files.length > 0) {
      for (const file of files) {
        execSync(`git add "${file}"`, { cwd });
      }
    } else {
      execSync('git add .', { cwd });
    }
    
    // Commit with message
    execSync(`git commit -m "${message}"`, { cwd, encoding: 'utf8' });
    
    return { success: true, message: 'Commit successful' };
    
  } catch (error) {
    console.error('Git commit error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to commit changes'
    };
  }
});

// Git push handler
ipcMain.handle('git-push', async () => {
  const { execSync } = require('child_process');
  try {
    const cwd = getGitWorkingDirectory();
    
    // Push to remote
    const output = execSync('git push', { cwd, encoding: 'utf8' });
    
    return { success: true, message: 'Push successful', output };
    
  } catch (error) {
    console.error('Git push error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to push changes'
    };
  }
});

// Git pull handler
ipcMain.handle('git-pull', async () => {
  const { execSync } = require('child_process');
  try {
    const cwd = getGitWorkingDirectory();
    
    // Pull from remote
    const output = execSync('git pull', { cwd, encoding: 'utf8' });
    
    return { success: true, message: 'Pull successful', output };
    
  } catch (error) {
    console.error('Git pull error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to pull changes'
    };
  }
});

// Git reset handler
ipcMain.handle('git-reset', async (event, commitHash, hard = false) => {
  const { execSync } = require('child_process');
  try {
    const cwd = getGitWorkingDirectory();
    
    // Reset to specific commit
    const resetType = hard ? '--hard' : '--soft';
    const output = execSync(`git reset ${resetType} ${commitHash}`, { cwd, encoding: 'utf8' });
    
    return { success: true, message: `Reset to ${commitHash} successful`, output };
    
  } catch (error) {
    console.error('Git reset error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to reset'
    };
  }
});

// Git diff handler
ipcMain.handle('git-diff', async (event, fileName, workingDirectory) => {
  const { execSync } = require('child_process');
  try {
    // Use provided working directory or fallback to getGitWorkingDirectory
    const cwd = workingDirectory || getGitWorkingDirectory();
    
    // Get diff for specific file or all files
    const command = fileName ? `git diff "${fileName}"` : 'git diff';
    const output = execSync(command, { cwd, encoding: 'utf8' });
    
    return { success: true, diff: output };
    
  } catch (error) {
    console.error('Git diff error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to get diff'
    };
  }
});

// Git discard file changes handler
ipcMain.handle('git-discard-file', async (event, fileName, workingDirectory) => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  
  try {
    // Use provided working directory or fallback to getGitWorkingDirectory
    const cwd = workingDirectory || getGitWorkingDirectory();
    
    console.log(`[Git Discard] Processing file: ${fileName}`);
    
    // First check if the file is tracked by git
    let isTracked = true;
    try {
      execSync(`git ls-files --error-unmatch "${fileName}"`, { 
        cwd, 
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'] // Suppress stderr
      });
      console.log(`[Git Discard] File ${fileName} is tracked`);
    } catch (e) {
      // File is not tracked by git
      isTracked = false;
      console.log(`[Git Discard] File ${fileName} is untracked`);
    }
    
    let output = '';
    let message = '';
    
    if (isTracked) {
      // Discard changes to tracked file
      output = execSync(`git checkout HEAD -- "${fileName}"`, { cwd, encoding: 'utf8' });
      message = `Changes to ${fileName} discarded`;
    } else {
      // Remove untracked file
      const filePath = path.join(cwd, fileName);
      fs.unlinkSync(filePath);
      message = `Untracked file ${fileName} deleted`;
    }
    
    return { success: true, message, output };
    
  } catch (error) {
    console.error('Git discard file error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to discard file changes'
    };
  }
});

// Git discard all changes handler
ipcMain.handle('git-discard-all', async (event, includeUntracked = false) => {
  const { execSync } = require('child_process');
  try {
    const cwd = getGitWorkingDirectory();
    let output = '';
    
    // Discard all changes to tracked files
    output += execSync('git checkout HEAD -- .', { cwd, encoding: 'utf8' });
    
    // Remove untracked files if requested
    if (includeUntracked) {
      // -f: force, -d: remove directories too
      output += '\n' + execSync('git clean -fd', { cwd, encoding: 'utf8' });
    }
    
    return { success: true, message: 'All changes discarded', output };
    
  } catch (error) {
    console.error('Git discard all error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to discard all changes'
    };
  }
});

// Get all Git branches
ipcMain.handle('git-get-branches', async (event, terminalId = null) => {
  const { execSync } = require('child_process');
  try {
    const cwd = terminalId !== null ? getTerminalWorkingDirectory(terminalId) : getGitWorkingDirectory();
    
    // Check if directory is a git repository
    const isGitRepo = execSync('git rev-parse --is-inside-work-tree', { 
      cwd, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim() === 'true';
    
    if (!isGitRepo) {
      return { 
        success: false, 
        error: 'Not a git repository'
      };
    }
    
    // Get all branches sorted by most recent commit
    const localBranches = execSync('git for-each-ref --sort=-committerdate --format="%(refname:short)" refs/heads/', { cwd, encoding: 'utf8' })
      .split('\n')
      .filter(branch => branch.length > 0);
    
    // Get current branch
    const currentBranch = execSync('git branch --show-current', { 
      cwd, 
      encoding: 'utf8' 
    }).trim();
    
    return { 
      success: true, 
      branches: localBranches,
      currentBranch 
    };
    
  } catch (error) {
    console.error('Git get branches error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to get branches'
    };
  }
});

// Create new Git branch
ipcMain.handle('git-create-branch', async (event, branchName, switchToBranch = true, terminalId = null) => {
  const { execSync } = require('child_process');
  try {
    const cwd = terminalId !== null ? getTerminalWorkingDirectory(terminalId) : getGitWorkingDirectory();
    
    // Validate branch name
    if (!branchName || branchName.trim().length === 0) {
      throw new Error('Branch name cannot be empty');
    }
    
    const sanitizedName = branchName.trim().replace(/[^a-zA-Z0-9\-_\/]/g, '-');
    
    if (switchToBranch) {
      // Create and switch to new branch
      execSync(`git checkout -b "${sanitizedName}"`, { cwd });
    } else {
      // Just create branch without switching
      execSync(`git branch "${sanitizedName}"`, { cwd });
    }
    
    return { 
      success: true, 
      branchName: sanitizedName,
      switched: switchToBranch
    };
    
  } catch (error) {
    console.error('Git create branch error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to create branch'
    };
  }
});

// Switch to existing Git branch
ipcMain.handle('git-switch-branch', async (event, branchName, terminalId = null) => {
  const { execSync } = require('child_process');
  try {
    const cwd = terminalId !== null ? getTerminalWorkingDirectory(terminalId) : getGitWorkingDirectory();
    
    // Switch to branch
    execSync(`git checkout "${branchName}"`, { cwd });
    
    return { 
      success: true, 
      branchName 
    };
    
  } catch (error) {
    console.error('Git switch branch error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to switch branch'
    };
  }
});

// Scan for git projects with changes (only from active terminals)
ipcMain.handle('scan-git-projects', async () => {
  const { execSync } = require('child_process');
  const fs = require('fs').promises;
  const path = require('path');
  
  try {
    const projects = [];
    const terminalDirs = new Set();
    
    // Get current working directory from each active terminal
    const terminalMap = new Map();
    console.log('[Git Scan] Getting current directories from terminals:');
    console.log('[Git Scan] Active terminals:', terminals.size);
    
    for (const [terminalId, terminal] of terminals) {
      console.log(`[Git Scan] Checking terminal ${terminalId}:`, terminal ? 'exists' : 'null');
      if (terminal) {
        try {
          // First try to get current directory from terminal
          if (terminal.cwd) {
            console.log(`[Git Scan] Terminal ${terminalId} current directory:`, terminal.cwd);
            terminalDirs.add(terminal.cwd);
            terminalMap.set(terminal.cwd, terminalId);
          } else {
            // Fallback to saved directory from database
            const savedDir = db.getTerminalDirectory(terminalId);
            console.log(`[Git Scan] Terminal ${terminalId} saved directory:`, savedDir);
            if (savedDir) {
              console.log(`[Git Scan] Terminal ${terminalId}: ${savedDir}`);
              terminalDirs.add(savedDir);
              terminalMap.set(savedDir, terminalId);
            }
          }
        } catch (e) {
          console.error(`[Git Scan] Error getting directory for terminal ${terminalId}:`, e);
        }
      }
    }
    
    console.log('[Git Scan] Total directories found:', terminalDirs.size);
    
    // If no terminals active, return empty list
    if (terminalDirs.size === 0) {
      console.log('[Git Scan] No active terminals found');
      return { success: true, projects: [] };
    }
    
    // Check each terminal directory for git repos
    for (const terminalDir of terminalDirs) {
      try {
        // First check if the terminal directory itself is a git repo
        let isGitRepo = false;
        try {
          execSync('git rev-parse --is-inside-work-tree', {
            cwd: terminalDir,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          });
          isGitRepo = true;
        } catch (e) {
          // Not a git repo, continue
        }
        
        if (isGitRepo) {
          // Get status
          const statusOutput = execSync('git status --porcelain', {
            cwd: terminalDir,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          });
          
          // Get current branch
          const branch = execSync('git branch --show-current', {
            cwd: terminalDir,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          }).trim();
          
          // Count changes
          const changes = statusOutput.trim().split('\n').filter(line => line.length > 0);
          const changeCount = changes.length;
          
          if (changeCount > 0) {
            projects.push({
              path: terminalDir,
              name: path.basename(terminalDir),
              branch: branch || 'master',
              changeCount: changeCount,
              changes: changes.slice(0, 10), // First 10 changes
              fromTerminal: true,
              terminalId: terminalMap.get(terminalDir) || null
            });
          }
        }
        
        // Also check parent directories up to 3 levels
        let currentPath = terminalDir;
        for (let i = 0; i < 3; i++) {
          const parentPath = path.dirname(currentPath);
          if (parentPath === currentPath || parentPath === '/') break;
          
          try {
            execSync('git rev-parse --is-inside-work-tree', {
              cwd: parentPath,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'ignore']
            });
            
            // Parent is a git repo, check if it has changes
            const statusOutput = execSync('git status --porcelain', {
              cwd: parentPath,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'ignore']
            });
            
            const changes = statusOutput.trim().split('\n').filter(line => line.length > 0);
            if (changes.length > 0) {
              // Check if we already have this project
              const exists = projects.some(p => p.path === parentPath);
              if (!exists) {
                const branch = execSync('git branch --show-current', {
                  cwd: parentPath,
                  encoding: 'utf8',
                  stdio: ['pipe', 'pipe', 'ignore']
                }).trim();
                
                projects.push({
                  path: parentPath,
                  name: path.basename(parentPath),
                  branch: branch || 'master',
                  changeCount: changes.length,
                  changes: changes.slice(0, 10),
                  fromTerminal: true,
                  terminalId: terminalMap.get(terminalDir) || null
                });
              }
            }
          } catch (e) {
            // Not a git repo, continue
          }
          
          currentPath = parentPath;
        }
      } catch (e) {
        console.error('Error checking terminal directory:', e);
      }
    }
    
    // Sort by change count
    projects.sort((a, b) => b.changeCount - a.changeCount);
    
    console.log(`[Git Scan] Found ${projects.length} projects with changes:`, projects.map(p => p.name));
    
    return { success: true, projects };
  } catch (error) {
    console.error('Scan git projects error:', error);
    return { success: false, error: error.message };
  }
});

// Get git status for specific project
ipcMain.handle('get-project-git-status', async (event, projectPath) => {
  const { execSync } = require('child_process');
  try {
    // Check if directory is a git repository
    const isGitRepo = execSync('git rev-parse --is-inside-work-tree', { 
      cwd: projectPath, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim() === 'true';
    
    if (!isGitRepo) {
      return { success: false, error: 'Not a git repository' };
    }
    
    // Get git status with porcelain format for easy parsing
    const statusOutput = execSync('git status --porcelain', { 
      cwd: projectPath, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    
    // Parse the status output
    const files = [];
    const lines = statusOutput.trim().split('\n').filter(line => line.length > 0);
    
    lines.forEach(line => {
      if (line.length < 3) return;
      
      const status = line.substring(0, 2);
      const fileName = line.substring(2).trim();
      
      let statusText = '';
      const indexStatus = status[0];
      const workingStatus = status[1];
      
      if (workingStatus === 'M' || indexStatus === 'M') {
        statusText = 'Modified';
      } else if (workingStatus === 'A' || indexStatus === 'A') {
        statusText = 'Added';
      } else if (workingStatus === 'D' || indexStatus === 'D') {
        statusText = 'Deleted';
      } else if (workingStatus === 'R' || indexStatus === 'R') {
        statusText = 'Renamed';
      } else if (workingStatus === 'C' || indexStatus === 'C') {
        statusText = 'Copied';
      } else if (workingStatus === 'T' || indexStatus === 'T') {
        statusText = 'Type Changed';
      } else if (status === '??') {
        statusText = 'Untracked';
      } else if (status === '!!') {
        statusText = 'Ignored';
      } else {
        statusText = 'Modified';
      }
      
      files.push({
        file: fileName,
        status: statusText,
        raw: status,
        staged: indexStatus !== ' ' && indexStatus !== '?'
      });
    });
    
    // Get current branch
    const branch = execSync('git branch --show-current', { 
      cwd: projectPath, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    
    // Get recent commits
    const commits = execSync('git log --oneline -10', { 
      cwd: projectPath, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim().split('\n').filter(line => line.length > 0).map(line => {
      const [hash, ...messageParts] = line.split(' ');
      return {
        hash: hash,
        message: messageParts.join(' ')
      };
    });
    
    // Check for unpushed commits
    let unpushedCount = 0;
    let hasUpstream = true;
    try {
      // First check if there's an upstream branch
      execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      
      // Count unpushed commits
      const unpushedOutput = execSync('git rev-list --count @{u}..HEAD', { 
        cwd: projectPath, 
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      unpushedCount = parseInt(unpushedOutput) || 0;
    } catch (e) {
      // No upstream branch configured
      hasUpstream = false;
      // Count all commits if no upstream
      try {
        const allCommitsCount = execSync('git rev-list --count HEAD', {
          cwd: projectPath,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
        unpushedCount = parseInt(allCommitsCount) || 0;
      } catch (e2) {
        // Ignore
      }
    }
    
    return { 
      success: true, 
      files, 
      branch,
      workingDirectory: projectPath,
      projectName: path.basename(projectPath),
      commits,
      unpushedCount,
      hasUpstream
    };
    
  } catch (error) {
    console.error('Project git status error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to get git status'
    };
  }
});

// Git operations for specific project
ipcMain.handle('git-commit-project', async (event, projectPath, message, files) => {
  const { execSync } = require('child_process');
  try {
    // Add specific files or all if none specified
    if (files && files.length > 0) {
      for (const file of files) {
        execSync(`git add "${file}"`, { cwd: projectPath });
      }
    } else {
      execSync('git add .', { cwd: projectPath });
    }
    
    // Commit with message
    execSync(`git commit -m "${message}"`, { cwd: projectPath, encoding: 'utf8' });
    
    return { success: true, message: 'Commit successful' };
    
  } catch (error) {
    console.error('Git commit project error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to commit changes'
    };
  }
});

// Git push for specific project
ipcMain.handle('git-push-project', async (event, projectPath) => {
  const { execSync } = require('child_process');
  try {
    const output = execSync('git push', { cwd: projectPath, encoding: 'utf8' });
    return { success: true, output };
  } catch (error) {
    console.error('Git push project error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to push changes'
    };
  }
});

// Git pull for specific project  
ipcMain.handle('git-pull-project', async (event, projectPath) => {
  const { execSync } = require('child_process');
  try {
    const output = execSync('git pull', { cwd: projectPath, encoding: 'utf8' });
    return { success: true, output };
  } catch (error) {
    console.error('Git pull project error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to pull changes'
    };
  }
});

app.on('before-quit', (event) => {
  console.log('App is quitting, cleaning up processes...');
  
  // Prevent default quit to ensure cleanup
  event.preventDefault();
  
  // Kill all terminals and their child processes
  let cleanupCount = terminals.size;
  terminals.forEach((shell, quadrant) => {
    console.log(`Killing terminal ${quadrant}...`);
    shell.kill();
  });
  terminals.clear();
  
  // Close database
  if (db) {
    db.close();
  }
  
  // Stop MCP server
  if (mcpServer) {
    mcpServer.stop();
  }
  
  // Force kill any remaining Python processes after a short delay
  setTimeout(() => {
    if (process.platform === 'darwin') {
      try {
        // Kill any Python processes that might be hanging
        require('child_process').execSync('pkill -f "Python.app/Contents/MacOS/Python" || true');
        // Also kill any claude processes
        require('child_process').execSync('pkill -f "claude" || true');
      } catch (e) {
        // Ignore errors
      }
    }
    
    // Now actually quit
    app.exit(0);
  }, 500);
});

// Function to ensure CLAUDE.md is configured with MCP Task Manager
function ensureClaudeMdConfiguration(projectPath) {
  const fs = require('fs');
  const path = require('path');
  const { SECTION_START, SECTION_END, getCodeAgentSwarmSection } = require('./claude-md-config');
  
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  let projectName = path.basename(projectPath);
  
  // Try to get the actual project name from the database
  if (db) {
    const existingProject = db.getProjectByPath(projectPath);
    if (existingProject && existingProject.name) {
      projectName = existingProject.name;
    } else if (fs.existsSync(claudeMdPath)) {
      // If no project in DB, try to extract project name from existing CLAUDE.md
      const currentContent = fs.readFileSync(claudeMdPath, 'utf8');
      const projectNameMatch = currentContent.match(/\*\*Project Name\*\*:\s*(.+?)(?=\n|$)/);
      if (projectNameMatch && projectNameMatch[1]) {
        projectName = projectNameMatch[1].trim();
      }
    }
  }
  
  try {
    let fileContent = '';
    let existingUserContent = '';
    
    // Check if CLAUDE.md already exists
    if (fs.existsSync(claudeMdPath)) {
      // Read existing content
      const currentContent = fs.readFileSync(claudeMdPath, 'utf8');
      
      // Check if it has our section markers
      const startIndex = currentContent.indexOf(SECTION_START);
      const endIndex = currentContent.indexOf(SECTION_END);
      
      if (startIndex !== -1 && endIndex !== -1) {
        // Extract user content before and after our section
        const beforeSection = currentContent.substring(0, startIndex).trim();
        const afterSection = currentContent.substring(endIndex + SECTION_END.length).trim();
        
        // Combine user content
        existingUserContent = beforeSection;
        if (afterSection) {
          existingUserContent += (existingUserContent ? '\n\n' : '') + afterSection;
        }
      } else {
        // No markers found, keep all existing content
        existingUserContent = currentContent;
      }
    }
    
    // Build the new file content
    if (existingUserContent.trim()) {
      // Check if user content has a project title
      const titleMatch = existingUserContent.match(/^#\s+(.+?)(?:\s+Project Configuration)?\s*$/m);
      
      if (titleMatch) {
        // User has a title, place our section after it
        const titleLine = titleMatch[0];
        const titleIndex = existingUserContent.indexOf(titleLine);
        const afterTitle = titleIndex + titleLine.length;
        
        fileContent = existingUserContent.substring(0, afterTitle) + 
                     '\n\n' + getCodeAgentSwarmSection(projectName) + 
                     '\n\n' + existingUserContent.substring(afterTitle).trim();
      } else {
        // No title, add our section with a generic title
        fileContent = `# ${projectName} Project Configuration\n\n` +
                     getCodeAgentSwarmSection(projectName) + 
                     '\n\n---\n\n' + existingUserContent;
      }
    } else {
      // New file or empty file
      fileContent = `# ${projectName} Project Configuration\n\n` + getCodeAgentSwarmSection(projectName);
    }
    
    // Only write if content has changed
    if (fs.existsSync(claudeMdPath)) {
      const currentContent = fs.readFileSync(claudeMdPath, 'utf8');
      if (currentContent === fileContent) {
        console.log(`✅ CLAUDE.md already up-to-date for: ${projectName}`);
        return;
      }
    }
    
    // Write the updated content
    fs.writeFileSync(claudeMdPath, fileContent, 'utf8');
    console.log(`✅ Updated CLAUDE.md with CodeAgentSwarm configuration for: ${projectName}`);
    
  } catch (error) {
    console.error('❌ Failed to configure CLAUDE.md:', error);
  }
}

// IPC handlers for log management
ipcMain.handle('get-log-path', () => {
  return {
    logFile: logFile,
    logDir: logDir
  };
});

ipcMain.handle('open-log-directory', () => {
  const { shell } = require('electron');
  shell.openPath(logDir);
  return { success: true };
});

ipcMain.handle('show-log-notification', () => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: 'CodeAgentSwarm Logs',
      body: `Logs are saved in:\n${logDir}`,
      silent: false
    });
    
    notification.on('click', () => {
      const { shell } = require('electron');
      shell.openPath(logDir);
    });
    
    notification.show();
  }
  return { logDir, logFile };
});

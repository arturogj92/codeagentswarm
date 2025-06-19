const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const { spawn } = require('child_process');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const os = require('os');
const DatabaseManager = require('./database');
const MCPTaskServer = require('./mcp-server');

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
}

let mainWindow;
const terminals = new Map();
let db;
let mcpServer;

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
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Simple shell simulation without external dependencies
class SimpleShell {
  constructor(quadrant, workingDir) {
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
  try {
    const userHome = os.homedir();
    const workingDir = customWorkingDir || path.join(userHome, 'Desktop');
    
    // Creating terminal ${quadrant}
    
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
    
    // Auto-execute claude code after a delay to ensure terminal is ready
    setTimeout(() => {
      if (terminals.has(quadrant)) {
        // Execute command based on session type
        const command = sessionType === 'new' ? 'claude' : 'claude --resume';
        shell.executeCommand(command, true);
      }
    }, 1000); // Increased to 1 second to ensure terminal is ready
    
    // Terminal ${quadrant} created
    return quadrant;
    
  } catch (error) {
    console.error(`Failed to create terminal ${quadrant}:`, error);
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

ipcMain.on('kill-terminal', (event, quadrant) => {
  const shell = terminals.get(quadrant);
  if (shell) {
    console.log(`Killing terminal ${quadrant} and all child processes...`);
    shell.kill();
    terminals.delete(quadrant);
    
    // Additional cleanup for hanging processes
    setTimeout(() => {
      // Try to clean up any orphaned processes
      if (process.platform === 'darwin') {
        try {
          // Kill any Python processes started by this terminal
          require('child_process').execSync(`ps aux | grep -E "claude.*${quadrant}" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true`);
        } catch (e) {
          // Ignore errors
        }
      }
    }, 100);
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

// Start MCP server as child process and register with Claude Code
let mcpServerProcess = null;

function startMCPServerAndRegister() {
  try {
    // Start MCP server as child process
    const serverPath = path.join(__dirname, 'mcp-stdio-server.js');
    mcpServerProcess = spawn('node', [serverPath], {
      cwd: __dirname,
      stdio: 'pipe'
    });

    console.log('🚀 Started MCP server as child process:', mcpServerProcess.pid);

    // Handle server output
    mcpServerProcess.stdout.on('data', (data) => {
      console.log('MCP Server:', data.toString());
    });

    mcpServerProcess.stderr.on('data', (data) => {
      console.error('MCP Server Error:', data.toString());
    });

    mcpServerProcess.on('close', (code) => {
      console.log('MCP server process exited with code:', code);
    });

    // Wait a moment for server to start, then register with Claude Code
    setTimeout(() => {
      registerWithClaude();
    }, 1000);

    return true;
  } catch (error) {
    console.error('❌ Failed to start MCP server:', error.message);
    return false;
  }
}

function registerWithClaude() {
  try {
    // Use claude mcp add to register our server
    const serverPath = path.join(__dirname, 'mcp-stdio-server.js');
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
    const result = db.saveTerminalDirectory(terminalId, directory);
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
ipcMain.handle('task-create', async (event, title, description, terminalId) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.createTask(title, description, terminalId);
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

ipcMain.handle('task-update', async (event, taskId, title, description) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateTask(taskId, title, description);
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

ipcMain.handle('get-mcp-port', async () => {
  try {
    if (!mcpServer) return { success: false, error: 'MCP server not started' };
    const port = mcpServer.getPort();
    return { success: true, port };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Open Kanban window
ipcMain.on('open-kanban-window', (event, options = {}) => {
  const kanbanWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Task Manager - Kanban Board',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    // Remove parent relationship to prevent minimizing main window
    modal: false,
    show: true,
    autoHideMenuBar: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    // Add icon to make it look like a separate app
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  kanbanWindow.loadFile('kanban.html');
  
  // Send focus task ID if provided
  if (options.focusTaskId) {
    kanbanWindow.webContents.once('did-finish-load', () => {
      kanbanWindow.webContents.send('focus-task', options.focusTaskId);
    });
  }
  
  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    kanbanWindow.webContents.openDevTools();
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
    createMCPConfig(port);
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
  
  // Start MCP server and register with Claude Code
  try {
    startMCPServerAndRegister();
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
  terminals.forEach((shell) => {
    shell.kill();
  });
  terminals.clear();
  
  // Stop MCP servers
  if (mcpServer) {
    mcpServer.stop();
  }
  
  // Stop MCP child process
  if (mcpServerProcess) {
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
  
  // Search common locations
  const possiblePaths = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/bin/claude',
    path.join(os.homedir(), '.local/bin/claude')
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
    
    return { 
      success: true, 
      files, 
      branch,
      workingDirectory: cwd,
      commits
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
ipcMain.handle('git-diff', async (event, fileName) => {
  const { execSync } = require('child_process');
  try {
    const cwd = getGitWorkingDirectory();
    
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
    
    // Get all branches
    const localBranches = execSync('git branch', { cwd, encoding: 'utf8' })
      .split('\n')
      .map(branch => branch.replace('*', '').trim())
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
  
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  const projectName = path.basename(projectPath);
  
  const claudeMdContent = `# ${projectName} Project Configuration

This file is automatically managed by CodeAgentSwarm to ensure proper MCP (Model Context Protocol) integration.

## MCP Servers

### Task Manager

- **Command**: \`node mcp-stdio-server.js\`
- **Description**: Task management system for CodeAgentSwarm with project organization
- **Tools**: create_task, start_task, complete_task, list_tasks, create_project, get_project_tasks
- **Resources**: All tasks, pending tasks, in-progress tasks, completed tasks, projects
- **Projects**: Tasks are now organized by projects based on terminal working directory

_Note: This MCP configuration is automatically managed by CodeAgentSwarm. Do not remove this section as it's required for task management functionality._

## Gestión de Tareas - IMPORTANTE

### Uso obligatorio del sistema de tareas

**SIEMPRE** que comiences a trabajar en una nueva tarea, debes:

1. **Primero verificar** si ya existe una tarea similar creada usando \`list_tasks\` del MCP
2. Si no existe una tarea similar, **crear una nueva tarea** usando \`create_task\` del MCP **OBLIGATORIAMENTE especificando el terminal_id correcto**
3. **Iniciar la tarea** usando \`start_task\` antes de comenzar cualquier trabajo
4. **Completar la tarea** usando \`complete_task\` cuando termines
5. **Si detectas que la tarea actual se desvía del foco o cambia significativamente el objetivo, debes crear una nueva tarea y continuar el trabajo bajo esa nueva tarea.**

### IMPORTANTE: Terminal ID - Detección Automática
- **SIEMPRE** debes especificar el \`terminal_id\` al crear una tarea con \`create_task\`
- Cada terminal tiene un ID único (1, 2, 3, 4, etc.) basado en numeración 1-based
- **DETECCIÓN AUTOMÁTICA:** Para obtener el terminal actual, ejecuta: \`echo $CODEAGENTSWARM_CURRENT_QUADRANT\` usando la herramienta Bash
- **NUNCA preguntes al usuario** cuál es el terminal - siempre usa la detección automática
- Las tareas deben estar asociadas al terminal correcto para el seguimiento adecuado

### Flujo de trabajo

1. **Al recibir una solicitud del usuario:**

   - Revisar las tareas existentes con \`list_tasks\`
   - Si existe una tarea relacionada, usarla
   - Si no existe, crear una nueva tarea descriptiva

2. **Durante el trabajo:**

   - La tarea actual se mostrará en la barra del terminal
   - Mantener actualizado el estado de la tarea
   - Una sola tarea activa por terminal

3. **Al finalizar:**
   - **OBLIGATORIO:** Marcar la tarea como completada usando \`complete_task\` del MCP
   - Esto actualiza automáticamente la interfaz y el estado en la base de datos

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
`;

  try {
    // Check if CLAUDE.md already exists
    if (fs.existsSync(claudeMdPath)) {
      // Read existing content
      const existingContent = fs.readFileSync(claudeMdPath, 'utf8');
      
      // Only update if it doesn't contain MCP configuration
      if (!existingContent.includes('Task Manager') || !existingContent.includes('mcp-stdio-server.js')) {
        // Backup existing content if it has custom content
        if (existingContent.trim() && !existingContent.includes('CodeAgentSwarm')) {
          const backupContent = `${claudeMdContent}

## Previous Content (Backup)

${existingContent}`;
          fs.writeFileSync(claudeMdPath, backupContent, 'utf8');
        } else {
          fs.writeFileSync(claudeMdPath, claudeMdContent, 'utf8');
        }
        console.log(`Updated CLAUDE.md configuration for project: ${projectName}`);
      }
    } else {
      // Create new CLAUDE.md
      fs.writeFileSync(claudeMdPath, claudeMdContent, 'utf8');
      console.log(`Created CLAUDE.md configuration for project: ${projectName}`);
    }
  } catch (error) {
    console.error('Failed to configure CLAUDE.md:', error);
  }
}
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
    
    this.sendOutput(`\r\n🚀 Terminal ${quadrant + 1} ready!\r\n`);
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

// Auto-configure CLAUDE.md for MCP Task Manager
function ensureClaudeMdConfiguration(directoryPath) {
  try {
    const claudeMdPath = path.join(directoryPath, 'CLAUDE.md');
    const mcpConfig = `
## MCP Servers

### Task Manager
- **Command**: \`node mcp-stdio-server.js\`
- **Description**: Task management system for CodeAgentSwarm
- **Tools**: create_task, start_task, complete_task, list_tasks
- **Resources**: All tasks, pending tasks, in-progress tasks, completed tasks

*Note: This MCP configuration is automatically managed by CodeAgentSwarm. Do not remove this section as it's required for task management functionality.*
`;

    if (fs.existsSync(claudeMdPath)) {
      // File exists, check if it has MCP configuration
      const content = fs.readFileSync(claudeMdPath, 'utf8');
      
      if (!content.includes('### Task Manager') || !content.includes('mcp-stdio-server.js')) {
        // Missing MCP config, append it
        fs.appendFileSync(claudeMdPath, mcpConfig);
        console.log('✅ Added MCP Task Manager configuration to existing CLAUDE.md');
      } else {
        console.log('✅ CLAUDE.md already has MCP Task Manager configuration');
      }
    } else {
      // File doesn't exist, create it with MCP configuration
      const initialContent = `# CodeAgentSwarm Project Configuration

This file is automatically managed by CodeAgentSwarm to ensure proper MCP (Model Context Protocol) integration.
${mcpConfig}`;
      
      fs.writeFileSync(claudeMdPath, initialContent);
      console.log('✅ Created CLAUDE.md with MCP Task Manager configuration');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Failed to configure CLAUDE.md:', error.message);
    return false;
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
ipcMain.on('open-kanban-window', () => {
  const kanbanWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Task Manager - Kanban Board',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    parent: mainWindow,
    modal: false,
    show: true,
    autoHideMenuBar: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true
  });

  kanbanWindow.loadFile('kanban.html');
  
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
  
  // Stop MCP server
  if (mcpServer) {
    mcpServer.stop();
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
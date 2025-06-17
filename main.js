const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const DatabaseManager = require('./database');

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
      this.activeInteractiveProcess.stdin.write(data);
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
    console.log(`[SimpleShell ${this.quadrant}] executeCommand called: "${command}" (silent: ${silent})`);
    if (!command) {
      console.log(`[SimpleShell ${this.quadrant}] Empty command, showing prompt`);
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
    console.log(`[SimpleShell ${this.quadrant}] Parsed command: cmd="${cmd}", args=[${cmdArgs.join(', ')}]`);
    
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
      // Use Python PTY bridge for real TTY support
      // Handle different paths for development vs packaged app
    let bridgePath;
    if (app.isPackaged) {
      // In packaged app, look in extraResources
      bridgePath = path.join(process.resourcesPath, 'pty_bridge.py');
    } else {
      // In development, look in current directory
      bridgePath = path.join(__dirname, 'pty_bridge.py');
    }
    
    console.log('Using pty_bridge.py at:', bridgePath);
    
    // Verify the file exists
    if (!fs.existsSync(bridgePath)) {
      console.error('pty_bridge.py not found at:', bridgePath);
      throw new Error(`pty_bridge.py not found at ${bridgePath}`);
    }
      // Fix PATH for packaged apps - add common binary locations
      const env = { ...process.env };
      if (app.isPackaged) {
        // Add directories to PATH for packaged app
        const additionalPaths = [
          '/usr/local/bin',
          '/opt/homebrew/bin',
          '/usr/bin',
          path.join(os.homedir(), '.local/bin'),
          path.join(os.homedir(), '.nvm/versions/node/v18.20.4/bin'), // ← ESTE ES EL CORRECTO!
          path.join(os.homedir(), '.nvm/versions/node/v18.20.4/lib/node_modules/@anthropic-ai/claude-code/bin'),
          path.join(os.homedir(), '.nvm/versions/node/v18.20.4/lib/node_modules/@anthropic-ai/claude-code')
        ];
        
        const currentPath = env.PATH || '';
        env.PATH = [...additionalPaths, currentPath].join(':');
        console.log('PATH updated for packaged app');
      }
      
      childProcess = spawn('python3', [bridgePath, userShell, this.cwd, fullCommand], {
        cwd: this.cwd,
        env: env,
        stdio: ['pipe', 'pipe', 'pipe']
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
    
    childProcess.stdout.on('data', (data) => {
      // Process the output to handle line endings properly
      let output = data.toString();
      // Convert \n to \r\n for proper terminal display
      output = output.replace(/\n/g, '\r\n');
      this.sendOutput(output);
    });
    
    childProcess.stderr.on('data', (data) => {
      let output = data.toString();
      output = output.replace(/\n/g, '\r\n');
      this.sendOutput(output);
    });
    
    childProcess.on('exit', (code) => {
      // Clear interactive process reference
      if (this.activeInteractiveProcess === childProcess) {
        this.activeInteractiveProcess = null;
      }
      
      if (code !== 0) {
        this.sendOutput(`\r\nProcess exited with code: ${code}\r\n`);
      }
      
      // Don't send prompt for interactive commands that are still running
      if (!isInteractiveCommand || this.activeInteractiveProcess === null) {
        this.sendPrompt();
      }
    });
    
    childProcess.on('error', (error) => {
      this.sendOutput(`\r\nCommand not found: ${cmd}\r\n`);
      // Don't send prompt for interactive commands
      if (!isInteractiveCommand) {
        this.sendPrompt();
      }
    });
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
    // Clean up if needed
  }
}

// IPC handlers for simple shell management
ipcMain.handle('create-terminal', async (event, quadrant, customWorkingDir, sessionType = 'resume') => {
  try {
    const userHome = os.homedir();
    const workingDir = customWorkingDir || path.join(userHome, 'Desktop');
    
    console.log(`Creating simple shell terminal ${quadrant} in ${workingDir} with ${sessionType} session`);
    
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
      console.log('Global PATH updated for terminal creation');
    }
    
    const shell = new SimpleShell(quadrant, workingDir);
    terminals.set(quadrant, shell);
    
    // Auto-execute claude code after a delay to ensure terminal is ready
    console.log(`[create-terminal] Setting up auto-execute for terminal ${quadrant} with sessionType: ${sessionType}`);
    setTimeout(() => {
      console.log(`[create-terminal] Timer fired for terminal ${quadrant}`);
      if (terminals.has(quadrant)) {
        // Execute command based on session type
        // Use claude directly, the PATH should be configured correctly
        const command = sessionType === 'new' ? 'claude' : 'claude --resume';
        console.log(`[create-terminal] Executing: ${command} for terminal ${quadrant}`);
        shell.executeCommand(command, true);
      } else {
        console.log(`[create-terminal] Terminal ${quadrant} not found in terminals map!`);
      }
    }, 1000); // Increased to 1 second to ensure terminal is ready
    
    console.log(`Simple shell terminal ${quadrant} created successfully`);
    return quadrant;
    
  } catch (error) {
    console.error(`Failed to create terminal ${quadrant}:`, error);
    throw error;
  }
});

ipcMain.on('terminal-input', (event, quadrant, data) => {
  console.log(`Received input for terminal ${quadrant}:`, JSON.stringify(data));
  const shell = terminals.get(quadrant);
  if (shell) {
    shell.handleInput(data);
  } else {
    console.error(`Shell ${quadrant} not found`);
  }
});

ipcMain.on('terminal-resize', (event, quadrant, cols, rows) => {
  console.log(`Terminal ${quadrant} resized to ${cols}x${rows}`);
  
  const shell = terminals.get(quadrant);
  if (shell && shell.activeInteractiveProcess) {
    try {
      // Send SIGWINCH (window change) signal to notify about terminal resize
      if (shell.activeInteractiveProcess.pid) {
        process.kill(shell.activeInteractiveProcess.pid, 'SIGWINCH');
        console.log(`Sent SIGWINCH to terminal ${quadrant} (PID: ${shell.activeInteractiveProcess.pid})`);
      }
      
      // Don't send escape sequences to avoid text spam in Claude Code
      // SIGWINCH should be enough for proper applications
      
    } catch (error) {
      console.error(`Error sending resize signal to terminal ${quadrant}:`, error);
    }
  }
});

ipcMain.on('kill-terminal', (event, quadrant) => {
  const shell = terminals.get(quadrant);
  if (shell) {
    shell.kill();
    terminals.delete(quadrant);
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

// Handle directory selection
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select directory for Claude Code'
  });
  
  if (!result.canceled) {
    return result.filePaths[0];
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

app.whenReady().then(() => {
  // Initialize database
  try {
    db = new DatabaseManager();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    db = null;
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

app.on('before-quit', () => {
  // Close database
  if (db) {
    db.close();
  }
  
  // Kill all terminals
  terminals.forEach((shell) => {
    shell.kill();
  });
  terminals.clear();
});
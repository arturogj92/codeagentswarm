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

    const userShell = process.env.SHELL || '/bin/bash';
    let bridgePath;
    if (app.isPackaged) {
      bridgePath = path.join(process.resourcesPath, 'pty_bridge.py');
    } else {
      bridgePath = path.join(__dirname, 'pty_bridge.py');
    }

    if (!fs.existsSync(bridgePath)) {
      throw new Error(`pty_bridge.py not found at ${bridgePath}`);
    }

    const env = { ...process.env };
    if (app.isPackaged) {
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

    this.ptyProcess = spawn('python3', [bridgePath, userShell, this.cwd], {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.ptyProcess.stdout.on('data', data => {
      let output = data.toString().replace(/\n/g, '\r\n');
      this.sendOutput(output);
    });

    this.ptyProcess.stderr.on('data', data => {
      let output = data.toString().replace(/\n/g, '\r\n');
      this.sendOutput(output);
    });

    this.ptyProcess.on('exit', code => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`terminal-exit-${this.quadrant}`, code);
      }
    });
  }

  sendOutput(data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`terminal-output-${this.quadrant}`, data);
    }
  }

  handleInput(data) {
    if (this.ptyProcess) {
      this.ptyProcess.stdin.write(data);
    }
  }

  executeCommand(command, silent = false) {
    if (this.ptyProcess) {
      this.ptyProcess.stdin.write(command + '\n');
    }
  }

  resize(cols, rows) {
    if (this.ptyProcess) {
      const msg = `###RESIZE###${cols},${rows}\n`;
      this.ptyProcess.stdin.write(msg);
    }
  }

  kill() {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
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
  const shell = terminals.get(quadrant);
  if (shell) {
    try {
      shell.resize(cols, rows);
    } catch (error) {
      console.error(`Error resizing terminal ${quadrant}:`, error);
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

// Git status handler
ipcMain.handle('get-git-status', async () => {
  const { execSync } = require('child_process');
  try {
    // Get current working directory from the first terminal or use process.cwd()
    let cwd = process.cwd();
    
    // Try to get working directory from the active terminal
    if (terminals.size > 0) {
      const firstTerminal = terminals.values().next().value;
      if (firstTerminal && firstTerminal.cwd) {
        cwd = firstTerminal.cwd;
      }
    }
    
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
      const fileName = line.substring(3);
      
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
        raw: status
      });
    });
    
    // Get current branch
    const branch = execSync('git branch --show-current', { 
      cwd, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    
    return { 
      success: true, 
      files, 
      branch,
      workingDirectory: cwd
    };
    
  } catch (error) {
    console.error('Git status error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to get git status'
    };
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
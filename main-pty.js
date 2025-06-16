const { app, BrowserWindow, ipcMain } = require('electron');
const pty = require('node-pty-prebuilt-multiarch');
const path = require('path');
const os = require('os');

let mainWindow;
const terminals = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active'
  });

  mainWindow.loadFile('index.html');
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// IPC handlers for PTY terminal management
ipcMain.handle('create-terminal', async (event, quadrant) => {
  try {
    // Use Desktop directory - available on all Macs
    const userHome = os.homedir();
    const workingDir = path.join(userHome, 'Desktop');
    
    // Get the user's shell from environment or default to zsh
    const shell = process.env.SHELL || '/bin/zsh';
    
    console.log(`Creating PTY terminal ${quadrant} with shell: ${shell} in ${workingDir}`);
    
    // Create PTY process with proper configuration
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        PWD: workingDir,
        // Ensure we have the full PATH
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        // Clear any npm-related vars that might interfere
        npm_config_cache: undefined,
        npm_lifecycle_event: undefined,
        npm_lifecycle_script: undefined,
        npm_node_execpath: undefined,
        npm_execpath: undefined
      }
    });

    // Store the PTY process
    terminals.set(quadrant, ptyProcess);

    // Set up data handling
    ptyProcess.onData((data) => {
      mainWindow.webContents.send(`terminal-output-${quadrant}`, data);
    });

    // Handle process exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`Terminal ${quadrant} exited with code: ${exitCode}, signal: ${signal}`);
      terminals.delete(quadrant);
      mainWindow.webContents.send(`terminal-exit-${quadrant}`, exitCode);
    });

    // Auto-execute claude-code after shell is ready
    setTimeout(() => {
      ptyProcess.write('claude-code\r');
    }, 1000);

    console.log(`PTY Terminal ${quadrant} created successfully`);
    return quadrant;
    
  } catch (error) {
    console.error(`Failed to create terminal ${quadrant}:`, error);
    throw error;
  }
});

ipcMain.on('terminal-input', (event, quadrant, data) => {
  const ptyProcess = terminals.get(quadrant);
  if (ptyProcess) {
    ptyProcess.write(data);
  }
});

ipcMain.on('terminal-resize', (event, quadrant, cols, rows) => {
  const ptyProcess = terminals.get(quadrant);
  if (ptyProcess) {
    ptyProcess.resize(cols, rows);
  }
});

ipcMain.on('kill-terminal', (event, quadrant) => {
  const ptyProcess = terminals.get(quadrant);
  if (ptyProcess) {
    ptyProcess.kill();
    terminals.delete(quadrant);
  }
});

ipcMain.handle('check-claude-code', async () => {
  return true; // Assume it works with proper PATH
});

app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Clean up all terminals
  terminals.forEach((ptyProcess) => {
    ptyProcess.kill();
  });
  terminals.clear();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Clean up all terminals before quitting
  terminals.forEach((ptyProcess) => {
    ptyProcess.kill();
  });
  terminals.clear();
});
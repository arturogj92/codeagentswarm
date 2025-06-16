const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
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

// IPC handlers for improved terminal management
ipcMain.handle('create-terminal', async (event, quadrant) => {
  try {
    // Use Desktop directory - available on all Macs
    const userHome = os.homedir();
    const workingDir = path.join(userHome, 'Desktop');
    
    // Get the user's shell from environment or default to zsh
    const shell = process.env.SHELL || '/bin/zsh';
    
    console.log(`Creating terminal ${quadrant} with shell: ${shell} in ${workingDir}`);
    
    // Create shell process with interactive mode and proper environment
    const terminalProcess = spawn(shell, ['-i'], {
      cwd: workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        PWD: workingDir,
        // Make sure we keep the full PATH
        PATH: process.env.PATH,
        // Clear npm vars that might interfere
        npm_config_cache: undefined,
        npm_lifecycle_event: undefined,
        npm_lifecycle_script: undefined,
        npm_node_execpath: undefined,
        npm_execpath: undefined,
        // Ensure interactive mode
        PS1: '$ ',
        // Force UTF-8 encoding
        LC_ALL: 'en_US.UTF-8',
        LANG: 'en_US.UTF-8'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Store the process
    terminals.set(quadrant, {
      process: terminalProcess,
      buffer: '',
      cols: 100,
      rows: 30
    });

    // Handle stdout
    terminalProcess.stdout.on('data', (data) => {
      const output = data.toString();
      mainWindow.webContents.send(`terminal-output-${quadrant}`, output);
    });

    // Handle stderr
    terminalProcess.stderr.on('data', (data) => {
      const output = data.toString();
      mainWindow.webContents.send(`terminal-output-${quadrant}`, output);
    });

    // Handle process exit
    terminalProcess.on('exit', (code, signal) => {
      console.log(`Terminal ${quadrant} exited with code: ${code}, signal: ${signal}`);
      terminals.delete(quadrant);
      mainWindow.webContents.send(`terminal-exit-${quadrant}`, code);
    });

    // Handle process errors
    terminalProcess.on('error', (error) => {
      console.error(`Terminal ${quadrant} error:`, error);
      mainWindow.webContents.send(`terminal-output-${quadrant}`, `\r\nError: ${error.message}\r\n`);
    });

    // Give the shell time to initialize, then try claude-code
    setTimeout(() => {
      if (terminals.has(quadrant)) {
        terminalProcess.stdin.write('claude-code\n');
      }
    }, 1500);

    console.log(`Terminal ${quadrant} created successfully`);
    return quadrant;
    
  } catch (error) {
    console.error(`Failed to create terminal ${quadrant}:`, error);
    throw error;
  }
});

ipcMain.on('terminal-input', (event, quadrant, data) => {
  const terminal = terminals.get(quadrant);
  if (terminal && terminal.process && terminal.process.stdin.writable) {
    terminal.process.stdin.write(data);
  }
});

ipcMain.on('terminal-resize', (event, quadrant, cols, rows) => {
  const terminal = terminals.get(quadrant);
  if (terminal) {
    terminal.cols = cols;
    terminal.rows = rows;
    // We can't resize the actual process, but we track the size
  }
});

ipcMain.on('kill-terminal', (event, quadrant) => {
  const terminal = terminals.get(quadrant);
  if (terminal && terminal.process) {
    terminal.process.kill('SIGTERM');
    terminals.delete(quadrant);
  }
});

ipcMain.handle('check-claude-code', async () => {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh';
    const checkProcess = spawn(shell, ['-c', 'which claude-code'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    checkProcess.on('exit', (code) => {
      resolve(code === 0);
    });
    
    checkProcess.on('error', () => {
      resolve(false);
    });
  });
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
  terminals.forEach((terminal) => {
    if (terminal.process) {
      terminal.process.kill('SIGTERM');
    }
  });
  terminals.clear();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Clean up all terminals before quitting
  terminals.forEach((terminal) => {
    if (terminal.process) {
      terminal.process.kill('SIGTERM');
    }
  });
  terminals.clear();
});
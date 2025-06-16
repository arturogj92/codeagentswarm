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

// IPC handlers for completely detached terminal management
ipcMain.handle('create-terminal', async (event, quadrant) => {
  try {
    // Use Desktop directory - available on all Macs
    const userHome = os.homedir();
    const workingDir = path.join(userHome, 'Desktop');
    
    // Get the user's shell from environment or default to zsh
    const shell = process.env.SHELL || '/bin/zsh';
    
    console.log(`Creating detached terminal ${quadrant} with shell: ${shell} in ${workingDir}`);
    
    // Create shell process without detached to test if it works
    const terminalProcess = spawn(shell, ['-i'], {
      cwd: workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        PWD: workingDir,
        PATH: process.env.PATH,
        // Clear npm vars completely
        npm_config_cache: undefined,
        npm_lifecycle_event: undefined,
        npm_lifecycle_script: undefined,
        npm_node_execpath: undefined,
        npm_execpath: undefined,
        npm_package_name: undefined,
        npm_package_version: undefined,
        // Force clean environment
        PS1: '$ ',
        LC_ALL: 'en_US.UTF-8',
        LANG: 'en_US.UTF-8',
        // TTY settings
        COLUMNS: '100',
        LINES: '30'
      },
      stdio: ['pipe', 'pipe', 'pipe']
      // Removed detached temporarily to test
    });

    // Don't unref for now to test if it works

    // Store the process with buffer management
    terminals.set(quadrant, {
      process: terminalProcess,
      inputBuffer: '',
      outputBuffer: '',
      cols: 100,
      rows: 30,
      ready: false
    });

    // Handle stdout with buffering
    terminalProcess.stdout.on('data', (data) => {
      const terminal = terminals.get(quadrant);
      if (terminal) {
        const output = data.toString();
        terminal.outputBuffer += output;
        
        // Send output to frontend
        mainWindow.webContents.send(`terminal-output-${quadrant}`, output);
        
        // Check if shell is ready (prompt appears)
        if (!terminal.ready && (output.includes('$') || output.includes('%') || output.includes('>'))) {
          terminal.ready = true;
          // Auto-launch claude-code when shell is ready
          setTimeout(() => {
            if (terminals.has(quadrant) && terminal.process.stdin.writable) {
              terminal.process.stdin.write('claude-code\n');
            }
          }, 500);
        }
      }
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
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`terminal-output-${quadrant}`, `\r\nError: ${error.message}\r\n`);
      }
    });

    console.log(`Detached terminal ${quadrant} created successfully`);
    return quadrant;
    
  } catch (error) {
    console.error(`Failed to create terminal ${quadrant}:`, error);
    throw error;
  }
});

ipcMain.on('terminal-input', (event, quadrant, data) => {
  console.log(`Received input for terminal ${quadrant}:`, JSON.stringify(data));
  const terminal = terminals.get(quadrant);
  if (terminal && terminal.process && terminal.process.stdin.writable) {
    try {
      console.log(`Writing to terminal ${quadrant} stdin:`, JSON.stringify(data));
      terminal.process.stdin.write(data);
      terminal.inputBuffer += data;
      console.log(`Successfully wrote to terminal ${quadrant}`);
    } catch (error) {
      console.error(`Error writing to terminal ${quadrant}:`, error);
    }
  } else {
    console.error(`Terminal ${quadrant} not found or stdin not writable:`, {
      terminalExists: !!terminal,
      processExists: !!(terminal && terminal.process),
      stdinWritable: !!(terminal && terminal.process && terminal.process.stdin.writable)
    });
  }
});

ipcMain.on('terminal-resize', (event, quadrant, cols, rows) => {
  const terminal = terminals.get(quadrant);
  if (terminal) {
    terminal.cols = cols;
    terminal.rows = rows;
  }
});

ipcMain.on('kill-terminal', (event, quadrant) => {
  const terminal = terminals.get(quadrant);
  if (terminal && terminal.process) {
    try {
      // Force kill the detached process
      process.kill(terminal.process.pid, 'SIGKILL');
      terminals.delete(quadrant);
    } catch (error) {
      console.error(`Error killing terminal ${quadrant}:`, error);
      terminals.delete(quadrant);
    }
  }
});

ipcMain.handle('check-claude-code', async () => {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh';
    const checkProcess = spawn(shell, ['-c', 'which claude-code'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    
    checkProcess.unref();
    
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
  // Force cleanup all detached terminals
  terminals.forEach((terminal, quadrant) => {
    if (terminal.process && terminal.process.pid) {
      try {
        process.kill(terminal.process.pid, 'SIGKILL');
      } catch (error) {
        console.error(`Error cleaning up terminal ${quadrant}:`, error);
      }
    }
  });
  terminals.clear();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Force cleanup all detached terminals before quitting
  terminals.forEach((terminal, quadrant) => {
    if (terminal.process && terminal.process.pid) {
      try {
        process.kill(terminal.process.pid, 'SIGKILL');
      } catch (error) {
        console.error(`Error cleaning up terminal ${quadrant}:`, error);
      }
    }
  });
  terminals.clear();
});
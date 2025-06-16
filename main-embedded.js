const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

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

// Check if Claude Code is available
async function checkClaudeCode() {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh';
    const checkProcess = spawn(shell, ['-c', 'which claude-code'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });
    
    checkProcess.on('exit', (code) => {
      resolve(code === 0);
    });
    
    checkProcess.on('error', () => {
      resolve(false);
    });
  });
}

// IPC handlers for terminal management
ipcMain.handle('create-terminal', async (event, quadrant) => {
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh';
  
  
  // Use Desktop directory - available on all Macs
  const userHome = process.env.HOME || process.env.USERPROFILE || process.cwd();
  const workingDir = `${userHome}/Desktop`;
  
  const terminalProcess = spawn(shell, ['-l', '-i'], {
    cwd: workingDir,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      PWD: workingDir,
      PATH: process.env.PATH,
      // Remove potentially problematic env vars
      npm_config_cache: undefined,
      npm_lifecycle_event: undefined,
      npm_lifecycle_script: undefined
    },
    stdio: ['pipe', 'pipe', 'pipe']
    // Removed detached: true to see if that helps
  });

  terminals.set(quadrant, terminalProcess);

  // Debug terminal process
  console.log(`Terminal ${quadrant} created, stdin writable:`, terminalProcess.stdin.writable);
  
  terminalProcess.on('error', (error) => {
    console.log(`Terminal ${quadrant} error:`, error);
  });

  // Send a welcome message to test output
  setTimeout(() => {
    terminalProcess.stdin.write('echo "Terminal ready! Try typing commands..."\n');
  }, 500);

  // Let user manually type commands
  // setTimeout(() => {
  //   terminalProcess.stdin.write('claude-code\n');
  // }, 1000);

  terminalProcess.stdout.on('data', (data) => {
    mainWindow.webContents.send(`terminal-output-${quadrant}`, data.toString());
  });

  terminalProcess.stderr.on('data', (data) => {
    mainWindow.webContents.send(`terminal-output-${quadrant}`, data.toString());
  });

  terminalProcess.on('exit', (code) => {
    console.log(`Terminal ${quadrant} exited with code: ${code}`);
    terminals.delete(quadrant);
    mainWindow.webContents.send(`terminal-exit-${quadrant}`, code);
  });

  return quadrant;
});

ipcMain.on('terminal-input', (event, quadrant, data) => {
  console.log('Received input for terminal', quadrant, ':', data);
  const terminalProcess = terminals.get(quadrant);
  if (terminalProcess && terminalProcess.stdin.writable) {
    console.log('Writing to terminal process');
    terminalProcess.stdin.write(data);
  } else {
    console.log('Terminal process not found or stdin not writable for quadrant', quadrant);
  }
});

ipcMain.on('kill-terminal', (event, quadrant) => {
  const terminalProcess = terminals.get(quadrant);
  if (terminalProcess) {
    terminalProcess.kill('SIGTERM');
    terminals.delete(quadrant);
  }
});

ipcMain.handle('check-claude-code', async () => {
  return await checkClaudeCode();
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
  terminals.forEach((terminalProcess) => {
    terminalProcess.kill('SIGTERM');
  });
  terminals.clear();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Clean up all terminals before quitting
  terminals.forEach((terminalProcess) => {
    terminalProcess.kill('SIGTERM');
  });
  terminals.clear();
});
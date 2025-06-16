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

// IPC handlers for terminal management
ipcMain.handle('create-terminal', async (event, quadrant) => {
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  
  const terminalProcess = spawn(shell, [], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  terminals.set(quadrant, terminalProcess);

  // Start Claude Code automatically
  terminalProcess.stdin.write('claude-code\n');

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
  const terminalProcess = terminals.get(quadrant);
  if (terminalProcess && terminalProcess.stdin.writable) {
    terminalProcess.stdin.write(data);
  }
});

ipcMain.on('kill-terminal', (event, quadrant) => {
  const terminalProcess = terminals.get(quadrant);
  if (terminalProcess) {
    terminalProcess.kill('SIGTERM');
    terminals.delete(quadrant);
  }
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
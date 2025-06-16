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

// IPC handlers for native terminal management
ipcMain.handle('create-terminal', async (event, quadrant) => {
  // Use Desktop directory - available on all Macs
  const userHome = process.env.HOME || process.env.USERPROFILE || process.cwd();
  const workingDir = `${userHome}/Desktop`;
  
  // Open native macOS Terminal.app with specific working directory
  const terminalCommand = `
    tell application "Terminal"
      activate
      do script "cd '${workingDir}' && clear && echo '🚀 Terminal ${quadrant + 1} - Ready for Claude Code!' && echo 'Type: claude-code to start'"
    end tell
  `;
  
  try {
    // Execute AppleScript to open Terminal.app
    spawn('osascript', ['-e', terminalCommand], {
      detached: true,
      stdio: 'ignore'
    });
    
    // Track that this terminal is "created" (even though it's external)
    terminals.set(quadrant, { 
      type: 'native', 
      created: Date.now(),
      workingDir: workingDir
    });
    
    console.log(`Opened native terminal ${quadrant} in ${workingDir}`);
    return quadrant;
  } catch (error) {
    console.error(`Failed to open terminal ${quadrant}:`, error);
    throw error;
  }
});

// We don't need these for native terminals but keep for compatibility
ipcMain.on('terminal-input', (event, quadrant, data) => {
  // Native terminals handle their own input
  console.log(`Input for native terminal ${quadrant} (handled natively)`);
});

ipcMain.on('kill-terminal', (event, quadrant) => {
  // For native terminals, we just remove from our tracking
  if (terminals.has(quadrant)) {
    terminals.delete(quadrant);
    console.log(`Removed tracking for native terminal ${quadrant}`);
  }
});

ipcMain.handle('check-claude-code', async () => {
  return true; // Assume it works in native terminal
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
  // Clean up terminal tracking
  terminals.clear();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Clean up terminal tracking
  terminals.clear();
});
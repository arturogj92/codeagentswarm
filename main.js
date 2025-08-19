const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const { spawn } = require('child_process');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const os = require('os');
const DatabaseManager = require('./database');
const MCPTaskServer = require('./mcp-server');
const HooksManager = require('./hooks-manager');
const WebhookServer = require('./webhook-server');
const GitService = require('./git-service');
const UpdaterService = require('./services/updater-service');
const WizardWindow = require('./wizard-window');

// Initialize the centralized logger
const logger = require('./logger');

// Logging setup for file output (keep existing file logging)
const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFile = path.join(logDir, `codeagentswarm-${new Date().toISOString().split('T')[0]}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// Add file logging to the centralized logger
logger.subscribe((log) => {
  if (log.type !== 'clear') {
    const timestamp = new Date(log.timestamp).toISOString();
    const message = `[${timestamp}] ${log.level.toUpperCase()}: ${log.message}`;
    logStream.write(message + '\n');
  }
});

// Handle log messages from renderer process
ipcMain.on('log-message', (event, logData) => {
  logger.addLog(logData.level, [logData.message]);
  // Forward to all renderer windows
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('log-update', logData);
    }
  });
});

// Handle log messages from child processes
ipcMain.on('child-process-log', (event, logData) => {
  logger.addLog(logData.level, [`[${logData.source}] ${logData.message}`]);
  // Forward to all renderer windows
  const forwardData = {
    ...logData,
    message: `[${logData.source}] ${logData.message}`
  };
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('log-update', forwardData);
    }
  });
});

// Subscribe to logger updates and forward to renderer
logger.subscribe((log) => {
  if (log.type !== 'clear') {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('log-update', log);
      }
    });
  }
});

// Handle request for existing logs
ipcMain.on('request-existing-logs', (event) => {
  const logs = logger.getLogs();
  logs.forEach(log => {
    event.sender.send('log-update', log);
  });
});

// Handle clear logs request
ipcMain.on('clear-logs', (event) => {
  logger.clearLogs();
  // Send clear event to all windows
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('log-update', { type: 'clear' });
    }
  });
});

// Handle export logs request
ipcMain.on('export-logs', (event) => {
  const logsText = logger.exportLogs();
  event.sender.send('export-logs-response', logsText);
});

// Database-dependent handlers are registered in registerDatabaseHandlers() after db initialization

// Handle updater operations
ipcMain.handle('check-for-updates', async () => {
  logger.addLog('info', ['Manual update check requested via button']);
  try {
    if (global.updaterService) {
      logger.addLog('info', ['Updater service exists, calling checkForUpdatesAndNotify()']);
      await global.updaterService.checkForUpdatesAndNotify();
      logger.addLog('info', ['Update check completed']);
      return { success: true };
    } else {
      logger.addLog('error', ['Updater service not initialized']);
      return { success: false, error: 'Updater service not initialized' };
    }
  } catch (error) {
    logger.addLog('error', ['Update check error:', error.message]);
    return { success: false, error: error.message };
  }
});

// Start update download
ipcMain.handle('start-update-download', async () => {
  try {
    if (global.updaterService) {
      await global.updaterService.startDownload();
      return { success: true };
    } else {
      return { success: false, error: 'Updater service not initialized' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Cancel update download
ipcMain.handle('cancel-update-download', async () => {
  try {
    if (global.updaterService) {
      const cancelled = await global.updaterService.cancelDownload();
      return { success: cancelled };
    } else {
      return { success: false, error: 'Updater service not initialized' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Install update and restart
ipcMain.handle('install-update', async () => {
  try {
    if (global.updaterService) {
      logger.addLog('info', ['Install update requested by user']);
      
      // Mark app as quitting to prevent any restart attempts
      app.isQuitting = true;
      
      // Close all windows before installing
      BrowserWindow.getAllWindows().forEach(window => {
        window.removeAllListeners('close');
        window.close();
      });
      
      // Small delay to ensure windows are closed
      setTimeout(() => {
        global.updaterService.quitAndInstall();
      }, 500);
      
      return { success: true };
    } else {
      return { success: false, error: 'Updater service not initialized' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get current update info
ipcMain.handle('get-update-info', async () => {
  try {
    if (global.updaterService) {
      const info = global.updaterService.getCurrentUpdateInfo();
      return { success: true, info };
    } else {
      return { success: false, error: 'Updater service not initialized' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Get update status
ipcMain.handle('get-update-status', () => {
  if (global.updaterService) {
    return {
      isDownloading: global.updaterService.isDownloadInProgress(),
      currentVersion: global.updaterService.getCurrentVersion(),
      updateInfo: global.updaterService.getCurrentUpdateInfo()
    };
  }
  return {
    isDownloading: false,
    currentVersion: app.getVersion(),
    updateInfo: null
  };
});

// Fetch version history
ipcMain.handle('fetch-version-history', async () => {
  try {
    if (global.updaterService) {
      const history = await global.updaterService.fetchVersionHistory();
      return history;
    } else {
      throw new Error('Updater service not initialized');
    }
  } catch (error) {
    logger.addLog('error', ['Failed to fetch version history:', error.message]);
    throw error;
  }
});

// get-shell-preference handler is now in registerDatabaseHandlers()

// Handle MCP diagnostic request
ipcMain.on('run-mcp-diagnostic', async (event) => {
  const { exec } = require('child_process');
  const os = require('os');
  const fs = require('fs');
  
  console.log('=== MCP DIAGNOSTIC STARTED ===');
  
  // System information
  console.log('1. System Information:');
  console.log(`   OS Version: ${os.release()}`);
  console.log(`   Platform: ${process.platform}`);
  console.log(`   Architecture: ${process.arch}`);
  console.log(`   Node version: ${process.version}`);
  console.log('');
  
  // Check MCP server file
  console.log('2. MCP Server Files:');
  const mcpServerPath = path.join(__dirname, 'mcp-stdio-server.js');
  const dbModulePath = path.join(__dirname, 'database-mcp-standalone.js');
  
  if (fs.existsSync(mcpServerPath)) {
    const stats = fs.statSync(mcpServerPath);
    console.log(`   mcp-stdio-server.js: EXISTS (${stats.size} bytes)`);
  } else {
    console.log('   mcp-stdio-server.js: NOT FOUND');
  }
  
  if (fs.existsSync(dbModulePath)) {
    const stats = fs.statSync(dbModulePath);
    console.log(`   database-mcp-standalone.js: EXISTS (${stats.size} bytes)`);
  } else {
    console.log('   database-mcp-standalone.js: NOT FOUND');
  }
  console.log('');
  
  // Check Application Support directory
  console.log('3. Application Support Directory:');
  const appSupportPath = path.join(os.homedir(), 'Library', 'Application Support', 'codeagentswarm');
  const dbPath = path.join(appSupportPath, 'codeagentswarm.db');
  
  if (fs.existsSync(appSupportPath)) {
    console.log(`   Directory exists: ${appSupportPath}`);
    
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      console.log(`   Database exists: ${dbPath} (${stats.size} bytes)`);
      console.log(`   Database permissions: ${(stats.mode & parseInt('777', 8)).toString(8)}`);
    } else {
      console.log('   Database NOT FOUND - This might be the issue!');
    }
  } else {
    console.log('   Directory NOT FOUND - App needs to create it first!');
  }
  console.log('');
  
  // Test MCP server startup
  console.log('4. Testing MCP Server Startup:');
  const testCommand = `cd "${__dirname}" && CODEAGENTSWARM_DB_PATH="${dbPath}" node mcp-stdio-server.js`;
  
  exec(testCommand, { timeout: 5000 }, (error, stdout, stderr) => {
    if (error) {
      console.log('   MCP Server test failed:');
      console.log(`   Error: ${error.message}`);
      if (stderr) console.log(`   Stderr: ${stderr}`);
      if (stdout) console.log(`   Stdout: ${stdout}`);
    } else {
      console.log('   MCP Server started successfully (timeout after 5s is normal)');
      if (stdout) console.log(`   Output: ${stdout.substring(0, 200)}...`);
    }
    
    console.log('');
    console.log('5. Environment Variables:');
    console.log(`   PATH: ${process.env.PATH}`);
    console.log(`   HOME: ${process.env.HOME}`);
    console.log('');
    
    console.log('=== MCP DIAGNOSTIC COMPLETED ===');
    console.log('');
    console.log('Common issues to check:');
    console.log('- If database does not exist, run the app first to create it');
    console.log('- Check Node.js version compatibility');
    console.log('- Verify file permissions');
    console.log('- Check for error messages in the output above');
  });
});

// Log startup info
console.log('=== CodeAgentSwarm Starting ===');
console.log('Log file:', logFile);
console.log('App version:', app.getVersion());
console.log('Electron version:', process.versions.electron);
console.log('Node version:', process.versions.node);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);

// Show log location on macOS
if (process.platform === 'darwin') {
  console.log('Log directory:', logDir);
  console.log('To view logs, run: tail -f "' + logFile + '"');
  console.log('Or open in Finder: open "' + logDir + '"');
}

// Enable live reload for Electron in development
if (process.argv.includes('--dev')) {
    try {
        require('electron-reload')(__dirname, {
            electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
            hardResetMethod: 'exit',
            forceHardReset: true,
            ignored: [
                path.join(__dirname, 'database.db'),
                path.join(__dirname, 'logs/**/*'),
                path.join(__dirname, 'node_modules/**/*')
            ]
        });
    } catch (err) {
        console.log('electron-reload not installed, run: npm install --save-dev electron-reload');
    }
    
    // Watch kanban files for changes
    const kanbanFiles = ['kanban.html', 'kanban.css', 'kanban.js'];
    kanbanFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
            if (curr.mtime !== prev.mtime && kanbanWindow && !kanbanWindow.isDestroyed()) {
                console.log(`Detected change in ${file}, reloading kanban window...`);
                kanbanWindow.webContents.reload();
            }
        });
    });
}

let mainWindow;
let splashWindow; // Splash screen window
let kanbanWindow; // Global reference to kanban window
let isCreatingKanbanWindow = false; // Flag to prevent concurrent creation
const terminals = new Map();
let db;
let mcpServer;
let isHandlingQuit = false; // Flag to prevent multiple quit handlers
let hooksManager;
let webhookServer;
let gitService; // Global reference to git service
let terminalsWaitingForResponse = new Set();

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 500,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    movable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    show: true, // Show splash immediately
    center: true,
    backgroundColor: '#1a1a1a'
  });

  splashWindow.loadFile('splash.html');
  
  // Update splash status function
  global.updateSplashStatus = (message, progress) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      if (message) {
        splashWindow.webContents.send('splash-status', message);
      }
      if (progress !== undefined) {
        splashWindow.webContents.send('splash-progress', progress);
      }
    }
  };
  
  return splashWindow;
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

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
      enableRemoteModule: true,
      // Optimize rendering performance
      backgroundThrottling: false,
      webgl: true,
      offscreen: false
    },
    titleBarStyle: 'hiddenInset',
    frame: false,               // Hide OS title bar like wizard
    show: false,                // Don't show until ready
    autoHideMenuBar: false,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#1a1a1a'  // Prevent white flash
  });

  // Load the HTML file
  mainWindow.loadFile('index.html');
  
  // Show window only when completely ready with all resources loaded
  mainWindow.once('ready-to-show', () => {
    // Update splash to 90%
    global.updateSplashStatus && global.updateSplashStatus('Finalizing...', 90);
    
    // Add a small delay to ensure icons and all resources are fully rendered
    setTimeout(() => {
      // Update splash to 100%
      global.updateSplashStatus && global.updateSplashStatus('Ready!', 100);
      
      // Small delay for the 100% to be visible
      setTimeout(() => {
        closeSplashWindow();
        mainWindow.show();
        mainWindow.focus();
        // console.log(`[Startup] Window shown after ${Date.now() - startTime}ms`); // startTime not in scope here
      }, 300);
    }, 200); // 200ms delay to ensure everything is loaded
  });
  
  // Send dev mode status to renderer after the page loads
  mainWindow.webContents.once('did-finish-load', () => {
    let isDevMode = process.argv.includes('--dev') || process.env.ENABLE_DEBUG_LOGS === 'true';
    
    // Check for debug config file in packaged apps
    try {
      const debugConfigPath = path.join(__dirname, 'debug-config.json');
      if (fs.existsSync(debugConfigPath)) {
        const debugConfig = JSON.parse(fs.readFileSync(debugConfigPath, 'utf8'));
        if (debugConfig.debugMode) {
          isDevMode = true;
        }
      }
    } catch (e) {
      // Ignore errors reading debug config
    }
    
    mainWindow.webContents.send('dev-mode-status', isDevMode);
  });
  
  // Clear badge when window gets focus and register shortcuts
  mainWindow.on('focus', () => {
    if (process.platform === 'darwin') {
      app.badgeCount = 0;
    }
    // Re-register shortcuts when window gains focus
    registerLocalShortcuts();
    terminalsWaitingForResponse.clear();
    
    // Notify renderer to clear waiting states
    mainWindow.webContents.send('clear-waiting-states');
  });
  
  // Unregister shortcuts when window loses focus
  mainWindow.on('blur', () => {
    unregisterLocalShortcuts();
  });
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Local shortcuts management
let localShortcutsEnabled = false;
let shortcutHandler = null;

function registerLocalShortcuts() {
  if (!mainWindow || mainWindow.isDestroyed() || localShortcutsEnabled) return;
  
  // Define shortcuts
  const shortcuts = [
    {
      key: process.platform === 'darwin' ? 'Cmd+K' : 'Ctrl+K',
      action: () => openOrFocusKanbanWindow(),
      name: 'Task Manager'
    },
    {
      key: process.platform === 'darwin' ? 'Cmd+N' : 'Ctrl+N',
      action: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('add-terminal-shortcut');
        }
      },
      name: 'New Terminal'
    },
    {
      key: process.platform === 'darwin' ? 'Cmd+T' : 'Ctrl+T',
      action: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('create-task-shortcut');
        }
      },
      name: 'Create Task'
    },
    {
      key: process.platform === 'darwin' ? 'Cmd+G' : 'Ctrl+G',
      action: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('git-status-shortcut');
        }
      },
      name: 'Git Status'
    }
  ];
  
  // Create the handler function
  shortcutHandler = (event, input) => {
    if (input.type !== 'keyDown') return;
    
    // Check each shortcut
    for (const { key, action, name } of shortcuts) {
      if (matchesShortcut(input, key)) {
        event.preventDefault();
        action();
        break;
      }
    }
  };
  
  // Register the handler
  mainWindow.webContents.on('before-input-event', shortcutHandler);
  localShortcutsEnabled = true;
  console.log('Local shortcuts registered');
}

function unregisterLocalShortcuts() {
  if (!mainWindow || mainWindow.isDestroyed() || !localShortcutsEnabled) return;
  
  // Remove the event listener
  if (shortcutHandler) {
    mainWindow.webContents.removeListener('before-input-event', shortcutHandler);
    shortcutHandler = null;
  }
  
  localShortcutsEnabled = false;
  console.log('Local shortcuts unregistered');
}

function matchesShortcut(input, shortcutKey) {
  const parts = shortcutKey.toLowerCase().split('+');
  const modifiers = {
    cmd: input.meta,
    ctrl: input.control,
    alt: input.alt,
    shift: input.shift
  };
  
  // Check modifiers
  for (const part of parts.slice(0, -1)) {
    if (!modifiers[part]) return false;
  }
  
  // Check the actual key
  const key = parts[parts.length - 1];
  return input.key.toLowerCase() === key.toLowerCase();
}

// Simple shell simulation without external dependencies
class SimpleShell {
  constructor(quadrant, workingDir, sessionType = 'new') {
    console.log('SimpleShell constructor called:', { quadrant, workingDir, sessionType });
    this.quadrant = quadrant;
    this.cwd = workingDir;
    this.buffer = '';
    this.currentLine = '';
    this.cursorPosition = 0;
    this.history = [];
    this.historyIndex = 0;
    this.ready = true;
    this.isActive = true; // Add flag to track if terminal is active
    this.sessionType = sessionType;
    this.shellEnv = null; // Cache for shell environment
    this.shellConfigFile = null; // Cache for shell config file path
    this.codeAgentSwarmConfig = null; // Cache for CodeAgentSwarm config file path
    this.initializeShellConfig();
    
    // Set environment variables for this quadrant globally (1-based)
    process.env[`CODEAGENTSWARM_QUADRANT_${quadrant + 1}`] = 'true';
    process.env.CODEAGENTSWARM_CURRENT_QUADRANT = (quadrant + 1).toString();
    
    // Don't show any output initially - let Claude handle all output when it loads
    // Terminal remains blank until Claude is ready
  }

  initializeShellConfig() {
    // Detect and cache shell configuration file
    const userShell = db.getUserShell();
    
    if (userShell.includes('zsh')) {
      this.shellConfigFile = path.join(os.homedir(), '.zshrc');
    } else if (userShell.includes('bash')) {
      // Check for .bash_profile first, then .bashrc
      const bashProfile = path.join(os.homedir(), '.bash_profile');
      const bashrc = path.join(os.homedir(), '.bashrc');
      if (fs.existsSync(bashProfile)) {
        this.shellConfigFile = bashProfile;
      } else if (fs.existsSync(bashrc)) {
        this.shellConfigFile = bashrc;
      }
    }
    
    console.log(`Shell config file detected for terminal ${this.quadrant}: ${this.shellConfigFile}`);
    
    // Initialize CodeAgentSwarm's own shell configuration
    this.initializeCodeAgentSwarmConfig();
    
    // Cache important paths from shell environment
    this.cachedPaths = this.getShellPaths();
  }
  
  initializeCodeAgentSwarmConfig() {
    // Create our own config file to avoid modifying user's shell config
    const configDir = path.join(os.homedir(), '.codeagentswarm');
    const configFile = path.join(configDir, 'shell-config.sh');
    
    try {
      // Create directory if it doesn't exist
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
        console.log(`Created CodeAgentSwarm config directory: ${configDir}`);
      }
      
      // Create/update our shell configuration
      const configContent = `#!/bin/bash
# CodeAgentSwarm Shell Configuration
# This file is automatically sourced before command execution
# It optimizes the terminal behavior without modifying user's shell config

# Detect if we're in a CodeAgentSwarm terminal
if [[ -n "$CODEAGENTSWARM_CURRENT_QUADRANT" ]]; then
    # For zsh: Disable job notifications to prevent [1] 12345 messages
    if [[ -n "$ZSH_VERSION" ]]; then
        unsetopt NOTIFY 2>/dev/null || true
        unsetopt MONITOR 2>/dev/null || true
        # Also ensure aliases are enabled
        setopt ALIASES 2>/dev/null || true
    fi
    
    # For bash: Disable job control notifications
    if [[ -n "$BASH_VERSION" ]]; then
        set +m 2>/dev/null || true
        # Ensure aliases are expanded
        shopt -s expand_aliases 2>/dev/null || true
    fi
fi

# Load any user's custom CodeAgentSwarm settings if they exist
if [[ -f "$HOME/.codeagentswarm/user-config.sh" ]]; then
    source "$HOME/.codeagentswarm/user-config.sh"
fi
`;

      // Write the config file
      fs.writeFileSync(configFile, configContent, { mode: 0o755 });
      this.codeAgentSwarmConfig = configFile;
      console.log(`CodeAgentSwarm shell config initialized: ${configFile}`);
      
    } catch (error) {
      console.error('Failed to initialize CodeAgentSwarm config:', error);
      // Not critical - app will work without this
      this.codeAgentSwarmConfig = null;
    }
  }
  
  getShellPaths() {
    // Get PATH from a login shell to cache it
    try {
      const userShell = db.getUserShell();
      const result = require('child_process').execSync(
        `${userShell} -l -c 'echo $PATH'`,
        { encoding: 'utf8', timeout: 2000 }
      ).trim();
      
      console.log(`Cached PATH for terminal ${this.quadrant}`);
      return result;
    } catch (e) {
      console.log(`Failed to cache PATH for terminal ${this.quadrant}, using default`);
      return process.env.PATH;
    }
  }
  
  sendOutput(data) {
    // Don't send output if the shell has been killed
    if (!this.isActive) {
      return;
    }
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`terminal-output-${this.quadrant}`, data);
    }
  }
  
  sendPrompt() {
    // Guard against null cwd
    if (!this.cwd) {
      console.warn(`Terminal ${this.quadrant} has null cwd, skipping prompt`);
      return;
    }
    this.prompt = `\x1b[32m➜\x1b[0m  \x1b[36m${path.basename(this.cwd)}\x1b[0m $ `;
    this.sendOutput(this.prompt);
  }
  
  
  handleInput(data) {
    // Don't process input if the shell has been killed
    if (!this.isActive) {
      console.log(`Shell ${this.quadrant} is not active, ignoring input`);
      return;
    }
    
    // If we have an active interactive process, send input directly to it
    if (this.activeInteractiveProcess) {
      // Debug: Log when sending to interactive process
      console.log(`[DEBUG] Sending to interactive process: ${JSON.stringify(data)}`);
      // Write directly to the PTY process
      if (typeof this.activeInteractiveProcess.write === 'function') {
        this.activeInteractiveProcess.write(data);
      } else if (this.activeInteractiveProcess.stdin) {
        this.activeInteractiveProcess.stdin.write(data);
      }
      return;
    }
    
    // Check for ANSI escape sequences (arrow keys, etc.)
    if (data.startsWith('\x1b[') || data.startsWith('\x1b')) {
      this.handleEscapeSequence(data);
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
        this.cursorPosition = 0;
      } else if (charCode === 127 || charCode === 8) { // Backspace
        if (this.cursorPosition > 0) {
          // Remove character at cursor position
          this.currentLine = this.currentLine.slice(0, this.cursorPosition - 1) + 
                            this.currentLine.slice(this.cursorPosition);
          this.cursorPosition--;
          // Redraw the line
          this.redrawLine();
        }
      } else if (charCode === 3) { // Ctrl+C
        this.sendOutput('^C\r\n');
        this.currentLine = '';
        this.cursorPosition = 0;
        this.sendPrompt();
      } else if (charCode >= 32 && charCode <= 126) { // Printable characters
        // Insert character at cursor position
        this.currentLine = this.currentLine.slice(0, this.cursorPosition) + 
                          char + 
                          this.currentLine.slice(this.cursorPosition);
        this.cursorPosition++;
        // Redraw the line
        this.redrawLine();
      }
    }
  }
  
  handleEscapeSequence(data) {
    // Handle arrow keys and other escape sequences
    if (data === '\x1b[A' || data === '\x1bOA') { // Up arrow
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.currentLine = this.history[this.historyIndex] || '';
        this.cursorPosition = this.currentLine.length;
        this.redrawLine();
      }
    } else if (data === '\x1b[B' || data === '\x1bOB') { // Down arrow
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this.currentLine = this.history[this.historyIndex] || '';
        this.cursorPosition = this.currentLine.length;
        this.redrawLine();
      } else {
        this.historyIndex = this.history.length;
        this.currentLine = '';
        this.cursorPosition = 0;
        this.redrawLine();
      }
    } else if (data === '\x1b[C' || data === '\x1bOC') { // Right arrow
      if (this.cursorPosition < this.currentLine.length) {
        this.cursorPosition++;
        this.sendOutput('\x1b[C'); // Move cursor right
      }
    } else if (data === '\x1b[D' || data === '\x1bOD') { // Left arrow
      if (this.cursorPosition > 0) {
        this.cursorPosition--;
        this.sendOutput('\x1b[D'); // Move cursor left
      }
    } else if (data === '\x1b[H' || data === '\x1b[1~') { // Home
      this.cursorPosition = 0;
      this.redrawLine();
    } else if (data === '\x1b[F' || data === '\x1b[4~') { // End
      this.cursorPosition = this.currentLine.length;
      this.redrawLine();
    }
  }
  
  redrawLine() {
    // Clear current line and redraw
    this.sendOutput('\r\x1b[K'); // Move to start and clear line
    this.sendOutput(this.prompt);
    this.sendOutput(this.currentLine);
    // Position cursor correctly
    const moveBack = this.currentLine.length - this.cursorPosition;
    if (moveBack > 0) {
      this.sendOutput(`\x1b[${moveBack}D`); // Move cursor back
    }
  }
  
  executeCommand(command, silent = false) {
    if (!command) {
      if (!silent) this.sendPrompt();
      return;
    }
    
    this.history.push(command);
    this.historyIndex = this.history.length;
    
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
    const userShell = db.getUserShell();
    const fullCommand = `${cmd} ${cmdArgs.join(' ')}`;
    
    // For interactive commands like claude code, use script to create a PTY
    // Check if it's claude (including full paths)
    const isClaudeCommand = cmd === 'claude' || cmd.includes('claude') || cmd.includes('.nvm');
    // Also include shell functions like nvm, rbenv, pyenv that need shell context
    const isShellFunction = ['nvm', 'rbenv', 'pyenv', 'jenv', 'nodenv', 'volta'].includes(cmd);
    // IMPORTANT: Always use PTY for all commands to support aliases and shell features
    // This ensures .zshrc/.bashrc is loaded and aliases work
    const isInteractiveCommand = true; // Force PTY for all commands
    
    let childProcess;
    if (isInteractiveCommand) {
      // Create a real PTY using node-pty for interactive commands
      // Use a minimal env to let the shell load its own configuration
      const env = { 
        // Start with clean environment
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: userShell,
        TERM: 'xterm-256color',
        LANG: process.env.LANG || 'en_US.UTF-8',
        LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
        // Add quadrant identification (1-based)
        [`CODEAGENTSWARM_QUADRANT_${this.quadrant + 1}`]: 'true',
        CODEAGENTSWARM_CURRENT_QUADRANT: (this.quadrant + 1).toString()
      };

      // Use cached shell configuration file
      const shellConfigFile = this.shellConfigFile;

      // Wrap command to ensure shell configuration is loaded
      // IMPORTANT: Order matters! Load our config FIRST to set options, then user's config
      let wrappedCommand = fullCommand;
      
      // Build the command in the correct order:
      // 1. First load CodeAgentSwarm config to set shell options
      // 2. Then load user's shell config for aliases
      // 3. Finally execute the command
      const configCommands = [];
      
      if (this.codeAgentSwarmConfig && fs.existsSync(this.codeAgentSwarmConfig)) {
        configCommands.push(`source "${this.codeAgentSwarmConfig}" 2>/dev/null`);
      }
      
      if (shellConfigFile && fs.existsSync(shellConfigFile)) {
        configCommands.push(`source "${shellConfigFile}" 2>/dev/null`);
      }
      
      if (configCommands.length > 0) {
        wrappedCommand = `${configCommands.join('; ')}; ${fullCommand}`;
      }

      // Now we can ALWAYS use interactive mode for all commands
      // Our config will suppress job notifications
      const shellArgs = isClaudeCommand 
        ? ['-l', '-c', wrappedCommand]  // Claude: non-interactive (it handles its own terminal)
        : ['-lic', wrappedCommand];      // Everything else: interactive (aliases work!)
      
      console.log(`[DEBUG] Command: "${cmd}", Mode: ${isClaudeCommand ? 'non-interactive (Claude)' : 'interactive (with job suppression)'}`);
      console.log(`[DEBUG] CodeAgentSwarm config exists: ${this.codeAgentSwarmConfig && fs.existsSync(this.codeAgentSwarmConfig)}`);
      console.log(`[DEBUG] Final wrapped command:`, wrappedCommand.substring(0, 300));
      
      childProcess = pty.spawn(userShell, shellArgs, {
        name: 'xterm-256color',
        cwd: this.cwd,
        env: env,
        cols: 80,
        rows: 30
      });
      
      // Mark this as active interactive process
      this.activeInteractiveProcess = childProcess;
      
      // Only disable bracketed paste mode for non-Claude commands
      // Claude handles its own terminal modes
      console.log(`[DEBUG] Terminal ${this.quadrant}: isClaudeCommand=${isClaudeCommand}, command="${fullCommand}"`);
      // REMOVED: Don't send any terminal init sequences - they appear in output
      // The PTY will handle its own terminal modes
      // Don't modify cursor modes - let the shell handle them naturally
    } else {
      // NOTE: This block is currently unreachable because isInteractiveCommand is always true
      // Keeping it for potential future optimization if we want to selectively use PTY
      // Regular commands - optimize for speed
      // Only source config for commands that need it
      let wrappedCommand = fullCommand;
      
      // Only wrap with shell config for commands that might need special paths
      const needsShellConfig = ['npm', 'node', 'python', 'pip', 'ruby', 'gem', 'cargo', 'go'].some(
        tool => cmd.includes(tool)
      );
      
      if (needsShellConfig && this.shellConfigFile && fs.existsSync(this.shellConfigFile)) {
        wrappedCommand = `source "${this.shellConfigFile}" 2>/dev/null && ${fullCommand}`;
      }

      // Use simple execution for better performance with cached PATH
      childProcess = spawn(userShell, ['-c', wrappedCommand], {
        cwd: this.cwd,
        env: {
          ...process.env, // Use current process environment as base
          PATH: this.cachedPaths || process.env.PATH, // Use cached PATH
          [`CODEAGENTSWARM_QUADRANT_${this.quadrant + 1}`]: 'true',
          CODEAGENTSWARM_CURRENT_QUADRANT: (this.quadrant + 1).toString(),
          FORCE_COLOR: '1',
          CLICOLOR: '1',
          CLICOLOR_FORCE: '1'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }
    
    if (childProcess.onData) {
      childProcess.onData((data) => {
        // Filter out job notifications like [1] 12345
        let dataStr = data.toString();
        
        // Split by lines and filter each line
        const lines = dataStr.split(/\r?\n/);
        const filteredLines = lines.filter(line => {
          // Filter out job notifications: [1] 12345 or [1] + 12345 running...
          if (/^\[\d+\][\s+-]*\d+/.test(line)) {
            console.log(`[DEBUG] Filtered job notification: ${line}`);
            return false;
          }
          return true;
        });
        
        // Only send if there's content after filtering
        if (filteredLines.length > 0 && filteredLines.some(line => line.trim())) {
          const filteredData = filteredLines.join('\n');
          this.sendOutput(filteredData);
        }
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
        // Reset terminal state after interactive commands (especially Claude)
        console.log(`[DEBUG] Resetting terminal state after interactive command exit (Claude or other)`);
        
        // Claude Code leaves the terminal in a bad state, we need to restart the shell
        if (isClaudeCommand) {
          console.log(`[DEBUG] Claude Code exited - need to restart shell for proper terminal state`);
          
          // Kill the current shell and restart it
          this.restartShell();
        }
        
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
  
  killActiveProcess() {
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
  
  kill() {
    console.log(`SimpleShell ${this.quadrant} kill() called`);
    this.isActive = false;
    this.cwd = null; // Clear cwd when killed
    this.killActiveProcess();
    // Clean up environment variables
    delete process.env[`CODEAGENTSWARM_QUADRANT_${this.quadrant + 1}`];
  }
  
  restartShell() {
    console.log(`[DEBUG] Restarting shell for terminal ${this.quadrant} to fix terminal state`);
    
    // Save current directory
    const savedCwd = this.cwd;
    
    // Kill any active processes
    this.killActiveProcess();
    
    // Clear the terminal
    this.sendOutput('\x1b[2J\x1b[H'); // Clear screen and move cursor to top
    
    // Restore working directory
    this.cwd = savedCwd;
    
    // Send a fresh prompt
    this.sendPrompt();
    
    console.log(`[DEBUG] Shell restarted for terminal ${this.quadrant}`);
  }
}

// IPC handlers for simple shell management
ipcMain.handle('create-terminal', async (event, quadrant, customWorkingDir, sessionType = 'resume') => {
  console.log('=== CREATE-TERMINAL HANDLER CALLED ===');
  console.log('Parameters:', { quadrant, customWorkingDir, sessionType });
  
  try {
    const userHome = os.homedir();
    const workingDir = customWorkingDir || path.join(userHome, 'Desktop');
    console.log('Working directory:', workingDir);
    
    // Auto-configure CLAUDE.md for MCP Task Manager
    // We'll do this after claude creates its initial CLAUDE.md
    
    console.log(`Creating terminal ${quadrant}`);
    
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
        path.join(os.homedir(), '.volta/bin'), // Volta
        path.join(os.homedir(), 'bin') // Custom bin
      ];
      
      // Dynamically add all nvm node versions to PATH
      const nvmPath = path.join(os.homedir(), '.nvm/versions/node');
      if (fs.existsSync(nvmPath)) {
        try {
          const nodeVersions = fs.readdirSync(nvmPath);
          nodeVersions.forEach(version => {
            additionalPaths.push(path.join(nvmPath, version, 'bin'));
            additionalPaths.push(path.join(nvmPath, version, 'lib/node_modules/@anthropic-ai/claude-code/bin'));
          });
          console.log(`Added ${nodeVersions.length} nvm node versions to PATH`);
        } catch (e) {
          console.log('Error adding nvm paths:', e);
        }
      }
      
      // Add yarn and pnpm global bin paths
      try {
        const yarnBin = require('child_process').execSync('yarn global bin', { encoding: 'utf8' }).trim();
        if (yarnBin) additionalPaths.push(yarnBin);
      } catch (e) {}
      
      try {
        const pnpmBin = require('child_process').execSync('pnpm bin -g', { encoding: 'utf8' }).trim();
        if (pnpmBin) additionalPaths.push(pnpmBin);
      } catch (e) {}
      
      const currentPath = process.env.PATH || '';
      process.env.PATH = [...additionalPaths, currentPath].join(':');
      // Global PATH updated
    }
    
    const shell = new SimpleShell(quadrant, workingDir, sessionType);
    terminals.set(quadrant, shell);
    console.log(`Terminal ${quadrant} created and added to terminals map`);
    
    // Auto-execute claude code after a delay to ensure terminal is ready
    setTimeout(() => {
      console.log(`Checking if terminal ${quadrant} exists for auto-execute...`);
      if (terminals.has(quadrant)) {
        // Execute command based on session type
        const command = sessionType === 'new' ? 'claude' : 'claude --resume';
        console.log(`Auto-executing command: ${command}`);
        shell.executeCommand(command, true);
        
        // Configure CLAUDE.md after claude has created it
        setTimeout(() => {
          console.log('Configuring CLAUDE.md for:', workingDir);
          ensureClaudeMdConfiguration(workingDir);
        }, 2000); // Wait 2 seconds for claude to create its initial CLAUDE.md
      }
    }, 1000); // Increased to 1 second to ensure terminal is ready
    
    console.log(`Terminal ${quadrant} created successfully`);
    return quadrant;
    
  } catch (error) {
    console.error(`Failed to create terminal ${quadrant}:`, error);
    console.error('Error stack:', error.stack);
    throw error;
  }
});

ipcMain.on('terminal-input', (event, quadrant, data) => {
  // Input received for terminal ${quadrant}
  const shell = terminals.get(quadrant);
  if (shell && shell.isActive) {
    shell.handleInput(data);
  } else {
    console.log(`Shell ${quadrant} not found or not active, ignoring input`);
  }
});

ipcMain.on('send-to-terminal', (event, terminalId, message) => {
  console.log(`Sending message to terminal ${terminalId}`);
  const shell = terminals.get(terminalId);
  if (shell && shell.isActive) {
    // Send the message as if it was typed
    shell.handleInput(message);
  } else {
    console.error(`Terminal ${terminalId} not found or not active`);
  }
});

ipcMain.handle('get-terminals-for-project', async (event, projectName) => {
  try {
    const activeTerminals = [];
    
    // Iterate through all active terminals
    for (const [terminalId, shell] of terminals) {
      if (shell && shell.cwd) {
        // Check if this terminal has a CLAUDE.md file
        const claudeMdPath = path.join(shell.cwd, 'CLAUDE.md');
        
        if (fs.existsSync(claudeMdPath)) {
          // Read CLAUDE.md to get project name
          const claudeMdContent = fs.readFileSync(claudeMdPath, 'utf8');
          const projectMatch = claudeMdContent.match(/\*\*Project Name\*\*:\s*(.+)/);
          
          if (projectMatch && projectMatch[1].trim() === projectName) {
            activeTerminals.push({
              id: terminalId,
              currentDir: shell.cwd,
              project: projectName
            });
          }
        }
      }
    }
    
    return activeTerminals;
  } catch (error) {
    console.error('Error getting terminals for project:', error);
    return [];
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

ipcMain.on('kill-terminal', (event, quadrant, force = false) => {
  const shell = terminals.get(quadrant);
  if (shell) {
    console.log(`Closing terminal ${quadrant} (placeholder: ${shell.placeholder || false})...`);
    
    try {
      // Mark shell as inactive first to prevent any further operations
      if (shell.isActive !== undefined) {
        shell.isActive = false;
      }
      
      // Kill the shell process - check if method exists first
      if (shell.kill && typeof shell.kill === 'function') {
        console.log(`Calling shell.kill() for terminal ${quadrant}`);
        shell.kill();
      } else if (shell.activeInteractiveProcess && shell.activeInteractiveProcess.kill) {
        console.log(`Calling activeInteractiveProcess.kill() for terminal ${quadrant}`);
        shell.activeInteractiveProcess.kill('SIGTERM');
      } else {
        console.log(`No kill method available for terminal ${quadrant} (likely a placeholder)`);
      }
    } catch (error) {
      console.error(`Error killing terminal ${quadrant}:`, error.message);
      // Don't crash the app, continue with cleanup
    }
    
    // Remove from terminals map
    terminals.delete(quadrant);
    
    // Send success message to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`terminal-closed-${quadrant}`);
    }
    
    console.log(`Terminal ${quadrant} closed successfully`);
  }
});

// Handle adding new terminal
ipcMain.handle('add-terminal', async () => {
  try {
    // Find the next available terminal ID (max 6 terminals)
    const existingTerminals = Array.from(terminals.keys());
    const maxTerminals = 6;
    
    if (existingTerminals.length >= maxTerminals) {
      return { success: false, error: 'Maximum number of terminals (6) reached' };
    }
    
    // Find the first available ID (0-5)
    let newTerminalId = null;
    for (let i = 0; i < maxTerminals; i++) {
      if (!existingTerminals.includes(i)) {
        newTerminalId = i;
        break;
      }
    }
    
    if (newTerminalId === null) {
      return { success: false, error: 'No available terminal slots' };
    }

    // Create a placeholder terminal object to mark this slot as occupied
    // The actual terminal will be created when the user selects a directory
    terminals.set(newTerminalId, {
      id: newTerminalId,
      placeholder: true,
      created: new Date()
    });
    
    return { success: true, terminalId: newTerminalId };
  } catch (error) {
    console.error('Error adding terminal:', error);
    return { success: false, error: error.message };
  }
});

// Handle removing terminal
ipcMain.handle('remove-terminal', async (event, terminalId) => {
  try {
    const shell = terminals.get(terminalId);
    if (shell) {
      console.log(`Removing terminal ${terminalId}...`);
      
      // Mark shell as inactive first
      if (shell.isActive !== undefined) {
        shell.isActive = false;
      }
      
      // If it's a real shell (not just a placeholder), kill it
      if (shell.kill && typeof shell.kill === 'function') {
        shell.kill();
      } else if (shell.activeInteractiveProcess && shell.activeInteractiveProcess.kill) {
        shell.activeInteractiveProcess.kill('SIGTERM');
      }
      
      terminals.delete(terminalId);
      
      // Send terminal-closed event to renderer to update UI
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`terminal-closed-${terminalId}`);
      }
      
      console.log(`Terminal ${terminalId} removed successfully`);
      return { success: true };
    } else {
      return { success: false, error: 'Terminal not found' };
    }
  } catch (error) {
    console.error('Error removing terminal:', error.message || error);
    console.error('Stack trace:', error.stack);
    return { success: false, error: error.message || 'Unknown error occurred' };
  }
});

// Get active terminals count
ipcMain.handle('get-active-terminals', async () => {
  try {
    const activeTerminals = Array.from(terminals.keys()).sort((a, b) => a - b);
    return { success: true, terminals: activeTerminals };
  } catch (error) {
    console.error('Error getting active terminals:', error);
    return { success: false, error: error.message };
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

// Diagnostic command to help debug Claude detection issues
ipcMain.handle('diagnose-claude', async () => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    system: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      shell: process.env.SHELL,
      path: process.env.PATH
    },
    claudeDetection: {
      foundBinary: null,
      searchResults: [],
      errors: []
    }
  };
  
  // Run findClaudeBinary and capture results
  try {
    const originalLog = console.log;
    const originalError = console.error;
    const logs = [];
    
    // Capture console output
    console.log = (...args) => {
      logs.push({ type: 'log', message: args.join(' ') });
      originalLog(...args);
    };
    console.error = (...args) => {
      logs.push({ type: 'error', message: args.join(' ') });
      originalError(...args);
    };
    
    // Run detection
    const claudePath = findClaudeBinary();
    diagnostics.claudeDetection.foundBinary = claudePath;
    diagnostics.claudeDetection.searchResults = logs;
    
    // Restore console
    console.log = originalLog;
    console.error = originalError;
  } catch (error) {
    diagnostics.claudeDetection.errors.push(error.message);
  }
  
  // Check various package managers
  const { execSync } = require('child_process');
  const packageManagers = {
    npm: 'npm list -g @anthropic-ai/claude-code --depth=0',
    yarn: 'yarn global list @anthropic-ai/claude-code',
    pnpm: 'pnpm list -g @anthropic-ai/claude-code',
    homebrew: 'brew list claude-code'
  };
  
  diagnostics.packageManagers = {};
  
  for (const [pm, cmd] of Object.entries(packageManagers)) {
    try {
      const result = execSync(cmd, { encoding: 'utf8' });
      diagnostics.packageManagers[pm] = {
        installed: true,
        output: result.substring(0, 200) // First 200 chars
      };
    } catch (e) {
      diagnostics.packageManagers[pm] = {
        installed: false,
        error: e.message
      };
    }
  }
  
  // Check PATH directories
  const pathDirs = process.env.PATH.split(':');
  diagnostics.pathAnalysis = {
    totalDirs: pathDirs.length,
    claudeInPath: false,
    claudeLocations: []
  };
  
  for (const dir of pathDirs) {
    const claudePath = path.join(dir, 'claude');
    if (fs.existsSync(claudePath)) {
      diagnostics.pathAnalysis.claudeInPath = true;
      diagnostics.pathAnalysis.claudeLocations.push(claudePath);
    }
  }
  
  return diagnostics;
});

// Hooks IPC handlers
ipcMain.handle('hooks-check-status', async () => {
  try {
    if (!hooksManager) {
      return { installed: false, error: 'Hooks manager not initialized' };
    }
    return await hooksManager.checkHooksStatus();
  } catch (error) {
    return { installed: false, error: error.message };
  }
});

ipcMain.handle('hooks-install', async () => {
  try {
    if (!hooksManager) {
      return { success: false, error: 'Hooks manager not initialized' };
    }
    return await hooksManager.installHooks();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('hooks-remove', async () => {
  try {
    if (!hooksManager) {
      return { success: false, error: 'Hooks manager not initialized' };
    }
    return await hooksManager.removeHooks();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('webhook-status', async () => {
  try {
    if (!webhookServer) {
      return { running: false, error: 'Webhook server not initialized' };
    }
    return webhookServer.getStatus();
  } catch (error) {
    return { running: false, error: error.message };
  }
});

// Start MCP server as child process and register with Claude Code
let mcpServerProcess = null;
let mcpServerRestartCount = 0;
let mcpServerRestartTimer = null;
let mcpServerHealthCheckInterval = null;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_DELAY_BASE = 1000; // Base delay for exponential backoff

// Auto-configure MCP in Claude CLI
async function configureMCPInClaudeCLI() {
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // For packaged apps, we need to extract the MCP server to a writable location
    let serverPath;
    if (app.isPackaged) {
      // Use a directory without spaces in the user's home to avoid Claude parsing issues
      const homeDir = os.homedir();
      const mcpDir = path.join(homeDir, '.codeagentswarm-mcp');
      
      // Create MCP directory if it doesn't exist
      if (!fs.existsSync(mcpDir)) {
        fs.mkdirSync(mcpDir, { recursive: true });
      }
      
      // Files needed for MCP to work
      const filesToExtract = [
        'mcp-stdio-server.js',
        'database-mcp.js',
        'database-mcp-standalone.js',
        'database.js',
        'mcp-launcher.sh',
        'child-process-logger.js'
      ];
      
      try {
        // Extract all necessary files
        for (const file of filesToExtract) {
          const bundledPath = path.join(process.resourcesPath, 'app.asar', file);
          const extractedPath = path.join(mcpDir, file);
          
          const content = fs.readFileSync(bundledPath, 'utf8');
          fs.writeFileSync(extractedPath, content, 'utf8');
          console.log(`📦 Extracted ${file} to:`, extractedPath);
        }
        
        serverPath = path.join(mcpDir, 'mcp-stdio-server.js');
      } catch (error) {
        console.error('Failed to extract MCP files:', error);
        return;
      }
    } else {
      // Development mode - use direct path
      serverPath = path.join(__dirname, 'mcp-stdio-server.js');
    }
    
    console.log('🔧 Configuring MCP in Claude CLI...');
    console.log('   Server path:', serverPath);
    
    // Check if claude CLI is available
    let claudeCommand = 'claude';
    try {
      // In packaged apps, we need to find claude explicitly
      if (app.isPackaged) {
        const claudePath = findClaudeBinary();
        if (claudePath) {
          claudeCommand = claudePath;
          console.log('📍 Found Claude CLI at:', claudeCommand);
        } else {
          throw new Error('Claude not found');
        }
      } else {
        await execPromise('which claude');
      }
    } catch (error) {
      console.log('⚠️ Claude CLI not found. Skipping MCP configuration.');
      // Don't show notification here - let checkClaudeInstallation handle it
      return;
    }
    
    // Check if MCP is already configured with correct path
    try {
      // Check both user and local scopes
      const { stdout: userMcpConfig } = await execPromise(`"${claudeCommand}" mcp get codeagentswarm-tasks -s user 2>&1`);
      
      // Check if already configured in user scope with correct path
      if (userMcpConfig.includes(serverPath) && !userMcpConfig.includes('not found')) {
        console.log('✅ MCP already configured correctly in user scope');
        return;
      }
      
      // Remove any local scope configuration to avoid conflicts
      try {
        await execPromise(`"${claudeCommand}" mcp remove codeagentswarm-tasks -s local 2>&1`);
        console.log('🧹 Removed local scope MCP to avoid conflicts');
      } catch (e) {
        // Ignore if not found
      }
    } catch (error) {
      // MCP not configured yet
      console.log('📝 MCP not configured yet, proceeding with setup...');
    }
    
    // Configure MCP globally
    const mcpConfig = {
      command: "node",
      args: [serverPath]
    };
    
    // Configure MCP with user scope (globally available)
    console.log('🔧 Running MCP configuration command...');
    
    // For packaged apps, we need to spawn the process differently
    if (app.isPackaged) {
      // Use spawn to force the command execution
      await new Promise((resolve, reject) => {
        // Find node executable path for claude to use
        let nodeForClaude = 'node';
        const possibleNodePaths = [
          '/usr/local/bin/node',
          '/usr/bin/node',
          '/opt/homebrew/bin/node'
        ];
        
        // Check NVM
        const homeDir = os.homedir();
        const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
        if (fs.existsSync(nvmDir)) {
          try {
            const nodeVersions = fs.readdirSync(nvmDir).sort().reverse();
            for (const version of nodeVersions) {
              const nvmNodePath = path.join(nvmDir, version, 'bin', 'node');
              if (fs.existsSync(nvmNodePath)) {
                possibleNodePaths.unshift(nvmNodePath);
                break;
              }
            }
          } catch (e) {
            // Ignore
          }
        }
        
        // Find first existing node
        for (const nodePath of possibleNodePaths) {
          if (fs.existsSync(nodePath)) {
            nodeForClaude = nodePath;
            console.log('📍 Using node for MCP:', nodeForClaude);
            break;
          }
        }
        
        // Use launcher script to avoid issues with spaces in paths
        const launcherPath = path.join(path.dirname(serverPath), 'mcp-launcher.sh');
        
        // Make sure launcher is executable
        try {
          fs.chmodSync(launcherPath, '755');
        } catch (e) {
          console.log('Could not set launcher permissions:', e.message);
        }
        
        const args = ['mcp', 'add', '-s', 'user', 'codeagentswarm-tasks', launcherPath];
        console.log('🔧 Spawning:', claudeCommand, args.join(' '));
        
        const mcpAddProcess = spawn(claudeCommand, args, {
          stdio: 'pipe',
          shell: true, // Use shell to ensure PATH is available
          env: {
            ...process.env,
            PATH: `/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${process.env.PATH}`
          }
        });
        
        let output = '';
        let errorOutput = '';
        
        mcpAddProcess.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        mcpAddProcess.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
        
        mcpAddProcess.on('close', (code) => {
          if (code === 0) {
            console.log('✅ MCP configured successfully in Claude CLI');
            console.log('📝 Output:', output);
            resolve();
          } else {
            console.error('❌ Failed to configure MCP:', errorOutput || output);
            reject(new Error(`MCP configuration failed with code ${code}`));
          }
        });
        
        mcpAddProcess.on('error', (err) => {
          console.error('❌ Failed to spawn claude mcp add:', err);
          reject(err);
        });
      });
    } else {
      // Development mode - use exec
      const configCommand = `claude mcp add -s user codeagentswarm-tasks node "${serverPath}"`;
      await execPromise(configCommand);
      console.log('✅ MCP configured successfully in Claude CLI');
    }
    
    // Notification removed - it doesn't provide much value
  } catch (error) {
    console.error('Failed to configure MCP in Claude CLI:', error);
  }
}

function startMCPServerAndRegister() {
  try {
    // Clear any existing restart timer
    if (mcpServerRestartTimer) {
      clearTimeout(mcpServerRestartTimer);
      mcpServerRestartTimer = null;
    }

    // Start MCP server as child process
    // For packaged apps, we need to extract files from app.asar to a writable location
    let serverPath, workingDir;
    
    if (app.isPackaged) {
      // Use a directory without spaces in the user's home to avoid Claude parsing issues
      const homeDir = os.homedir();
      const mcpDir = path.join(homeDir, '.codeagentswarm-mcp');
      
      // Create MCP directory if it doesn't exist
      if (!fs.existsSync(mcpDir)) {
        fs.mkdirSync(mcpDir, { recursive: true });
      }
      
      // Files needed for MCP to work
      const filesToExtract = [
        'mcp-stdio-server.js',
        'database-mcp.js',
        'database-mcp-standalone.js',
        'database.js',
        'mcp-launcher.sh',
        'child-process-logger.js'
      ];
      
      try {
        // Extract all necessary files from app.asar
        for (const file of filesToExtract) {
          const bundledPath = path.join(process.resourcesPath, 'app.asar', file);
          const extractedPath = path.join(mcpDir, file);
          
          // Check if file needs to be updated
          let needsUpdate = !fs.existsSync(extractedPath);
          
          if (!needsUpdate) {
            // Check if the bundled version is newer
            try {
              const bundledContent = fs.readFileSync(bundledPath, 'utf8');
              const extractedContent = fs.readFileSync(extractedPath, 'utf8');
              needsUpdate = bundledContent !== extractedContent;
            } catch (e) {
              needsUpdate = true;
            }
          }
          
          if (needsUpdate) {
            const content = fs.readFileSync(bundledPath, 'utf8');
            fs.writeFileSync(extractedPath, content, 'utf8');
            console.log(`📦 Extracted ${file} to:`, extractedPath);
          }
        }
        
        serverPath = path.join(mcpDir, 'mcp-stdio-server.js');
        workingDir = mcpDir;
      } catch (error) {
        console.error('Failed to extract MCP files:', error);
        throw error;
      }
    } else {
      // Development mode - use direct path
      serverPath = path.join(__dirname, 'mcp-stdio-server.js');
      workingDir = __dirname;
    }
    
    console.log('🔧 MCP Server Configuration:');
    console.log('  - Server path:', serverPath);
    console.log('  - Working directory:', workingDir);
    console.log('  - Is packaged:', app.isPackaged);
    console.log('  - Restart attempt:', mcpServerRestartCount);
    
    // Kill any existing process
    if (mcpServerProcess && !mcpServerProcess.killed) {
      console.log('⚠️ Killing existing MCP server process:', mcpServerProcess.pid);
      mcpServerProcess.kill();
    }
    
    // In packaged apps, we need to find node executable or use Electron's node
    let nodeExecutable = 'node';
    
    if (app.isPackaged) {
      // Try to find node in common locations
      const possibleNodePaths = [
        '/usr/local/bin/node',
        '/usr/bin/node',
        '/opt/homebrew/bin/node'
      ];
      
      // Also check NVM installations
      const homeDir = os.homedir();
      const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
      if (fs.existsSync(nvmDir)) {
        try {
          const nodeVersions = fs.readdirSync(nvmDir).sort().reverse();
          for (const version of nodeVersions) {
            const nvmNodePath = path.join(nvmDir, version, 'bin', 'node');
            if (fs.existsSync(nvmNodePath)) {
              possibleNodePaths.unshift(nvmNodePath); // Add to beginning
              break; // Use the first (latest) version found
            }
          }
        } catch (e) {
          console.log('Could not read NVM directory:', e.message);
        }
      }
      
      possibleNodePaths.push(process.execPath); // Use Electron's executable as fallback
      
      for (const nodePath of possibleNodePaths) {
        if (fs.existsSync(nodePath) && nodePath !== process.execPath) {
          nodeExecutable = nodePath;
          console.log('📍 Found node at:', nodeExecutable);
          break;
        }
      }
      
      // If no system node found, use Electron's node
      if (nodeExecutable === 'node') {
        nodeExecutable = process.execPath;
        console.log('📍 Using Electron executable:', nodeExecutable);
      }
    }
    
    const spawnArgs = nodeExecutable === process.execPath 
      ? [serverPath] // Electron can run JS files directly
      : [serverPath]; // Regular node
    
    mcpServerProcess = spawn(nodeExecutable, spawnArgs, {
      cwd: workingDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'production',
        ELECTRON_RUN_AS_NODE: nodeExecutable === process.execPath ? '1' : undefined,
        ENABLE_DEBUG_LOGS: process.env.ENABLE_DEBUG_LOGS || 'false'
      }
    });

    console.log('🚀 Started MCP server as child process:', mcpServerProcess.pid);

    // Handle server output and forward logs to main logger
    mcpServerProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      console.log('MCP Server:', message);
    });

    mcpServerProcess.stderr.on('data', (data) => {
      const errorMsg = data.toString().trim();
      console.error('MCP Server Error:', errorMsg);
      
      // Log detailed errors to help diagnose issues
      if (errorMsg.includes('EADDRINUSE')) {
        console.error('⚠️ MCP Server port already in use. Attempting to find free port...');
      } else if (errorMsg.includes('ENOENT')) {
        console.error('⚠️ MCP Server file not found. Check file paths.');
      }
    });

    mcpServerProcess.on('error', (error) => {
      console.error('❌ MCP Server Process Error:', error);
    });

    mcpServerProcess.on('close', (code, signal) => {
      console.log(`MCP server process exited with code: ${code}, signal: ${signal}`);
      mcpServerProcess = null;
      
      // Clear health check interval
      if (mcpServerHealthCheckInterval) {
        clearInterval(mcpServerHealthCheckInterval);
        mcpServerHealthCheckInterval = null;
      }
      
      // Attempt to restart if not shutting down
      if (!app.isQuitting && mcpServerRestartCount < MAX_RESTART_ATTEMPTS) {
        mcpServerRestartCount++;
        const delay = RESTART_DELAY_BASE * Math.pow(2, mcpServerRestartCount - 1);
        
        console.log(`⚠️ MCP Server crashed. Attempting restart ${mcpServerRestartCount}/${MAX_RESTART_ATTEMPTS} in ${delay}ms...`);
        
        mcpServerRestartTimer = setTimeout(() => {
          startMCPServerAndRegister();
        }, delay);
      } else if (mcpServerRestartCount >= MAX_RESTART_ATTEMPTS) {
        console.error('❌ MCP Server failed to start after maximum attempts. Please check logs.');
        
        // Show user notification
        if (Notification.isSupported()) {
          new Notification({
            title: 'MCP Server Error',
            body: 'The MCP server failed to start. Task management features may not work correctly.',
            urgency: 'critical'
          }).show();
        }
      }
    });

    // Reset restart count on successful start
    mcpServerProcess.on('spawn', () => {
      console.log('✅ MCP Server spawned successfully');
      mcpServerRestartCount = 0;
      
      // Start health check after server is stable
      setTimeout(() => {
        startMCPHealthCheck();
      }, 5000);
    });

    // Only check for Claude Code if explicitly requested or first run
    // Comment out automatic registration to avoid annoying users
    /*
    console.log('⏰ Setting timeout to call registerWithClaude...');
    setTimeout(() => {
      console.log('⏰ First timeout reached. Window visible?', mainWindow && mainWindow.isVisible());
      if (mainWindow && mainWindow.isVisible()) {
        registerWithClaude();
      } else {
        // Wait a bit more if window isn't ready
        console.log('⏰ Window not ready, waiting 2 more seconds...');
        setTimeout(() => {
          console.log('⏰ Second timeout reached, calling registerWithClaude anyway');
          registerWithClaude();
        }, 2000);
      }
    }, 1000);
    */

    return true;
  } catch (error) {
    console.error('❌ Failed to start MCP server:', error.message);
    console.error('Stack trace:', error.stack);
    return false;
  }
}

// Health check function
function startMCPHealthCheck() {
  // Clear any existing interval
  if (mcpServerHealthCheckInterval) {
    clearInterval(mcpServerHealthCheckInterval);
  }
  
  // Check every 30 seconds
  mcpServerHealthCheckInterval = setInterval(() => {
    if (!mcpServerProcess || mcpServerProcess.killed) {
      console.log('⚠️ MCP Server health check failed: process not running');
      clearInterval(mcpServerHealthCheckInterval);
      mcpServerHealthCheckInterval = null;
      
      // Attempt restart if not already restarting
      if (!mcpServerRestartTimer && mcpServerRestartCount < MAX_RESTART_ATTEMPTS) {
        startMCPServerAndRegister();
      }
    } else {
      // Process is running, could add more sophisticated health checks here
      console.log('✅ MCP Server health check passed');
    }
  }, 30000);
}

function updateClaudeConfigFile() {
  try {
    const configPath = getClaudeConfigPath();
    let config = {};
    
    // Read existing config if it exists
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
    }
    
    // Ensure mcpServers object exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    
    // IMPORTANT: Don't modify disabled servers or other servers
    // Only update codeagentswarm-tasks configuration
    const serverPath = app.isPackaged 
      ? path.join(app.getPath('userData'), 'mcp', 'mcp-stdio-server.js')
      : path.join(__dirname, 'mcp-stdio-server.js');
    
    config.mcpServers['codeagentswarm-tasks'] = {
      command: 'node',
      args: [serverPath],
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--unhandled-rejections=strict'
      }
    };
    
    // Write updated config - this preserves all other servers including disabled ones
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('✅ Updated Claude Code config file at:', configPath);
    console.log('[MCP Debug] Preserved servers:', Object.keys(config.mcpServers));
    
    return true;
  } catch (error) {
    console.error('❌ Failed to update Claude config file:', error);
    return false;
  }
}

// ================== MCP Settings IPC Handlers ==================

// Helper function to get the correct Claude config path
function getClaudeConfigPath() {
  // Claude Code uses ~/.claude.json (NOT ~/.config/claude/claude_cli_config.json)
  const claudeJsonPath = path.join(os.homedir(), '.claude.json');
  
  // Check if Claude Code config exists
  if (fs.existsSync(claudeJsonPath)) {
    console.log('[MCP] Using Claude Code config path:', claudeJsonPath);
    return claudeJsonPath;
  }
  
  // Fallback to the old path if needed
  const claudeCodePath = path.join(os.homedir(), '.config', 'claude', 'claude_cli_config.json');
  if (fs.existsSync(claudeCodePath)) {
    console.log('[MCP] Using old Claude Code config path:', claudeCodePath);
    return claudeCodePath;
  }
  
  // Fallback paths for other Claude apps
  const libraryPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  const dotClaudePath = path.join(os.homedir(), '.claude', 'claude_desktop_config.json');
  
  // Check Library path (macOS Claude Desktop)
  if (process.platform === 'darwin' && fs.existsSync(libraryPath)) {
    console.log('[MCP] Using Claude Desktop config path:', libraryPath);
    return libraryPath;
  }
  
  // Final fallback
  console.log('[MCP] Using fallback config path:', dotClaudePath);
  return dotClaudePath;
}

// Load MCP configuration
ipcMain.on('mcp:load-config', (event) => {
  try {
    const configPath = getClaudeConfigPath();
    let config = {};
    
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
      console.log('[MCP Debug] Loaded config with servers:', Object.keys(config.mcpServers || {}));
    }
    
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    
    // Load disabled servers from backup to show them as disabled in UI
    const backupPath = path.join(path.dirname(configPath), '.mcp_disabled_servers.json');
    if (fs.existsSync(backupPath)) {
      try {
        const disabledServers = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        console.log('[MCP Debug] Found disabled servers:', Object.keys(disabledServers));
        
        // Add disabled servers with a special marker so UI knows they're disabled
        // We'll add them with _disabled_ prefix for UI compatibility
        for (const [name, serverConfig] of Object.entries(disabledServers)) {
          config.mcpServers[`_disabled_${name}`] = serverConfig;
        }
      } catch (e) {
        console.log('[MCP Debug] Could not read disabled servers backup:', e.message);
      }
    }
    
    event.reply('mcp:load-config-response', config);
  } catch (error) {
    console.error('Error loading MCP config:', error);
    event.reply('mcp:load-config-response', { error: error.message });
  }
});

// Add MCP servers
ipcMain.on('mcp:add-servers', (event, servers) => {
  try {
    const configPath = getClaudeConfigPath();
    let config = {};
    
    // Create backup
    if (fs.existsSync(configPath)) {
      const backupPath = configPath + '.backup';
      fs.copyFileSync(configPath, backupPath);
      
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
    }
    
    // Ensure mcpServers exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    
    // Add new servers
    Object.assign(config.mcpServers, servers);
    
    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    event.reply('mcp:add-servers-response', { success: true });
  } catch (error) {
    console.error('Error adding MCP servers:', error);
    event.reply('mcp:add-servers-response', { 
      success: false, 
      error: error.message 
    });
  }
});

// Update MCP server
ipcMain.on('mcp:update-server', (event, { name, config: serverConfig }) => {
  try {
    const configPath = getClaudeConfigPath();
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Configuration file not found');
    }
    
    // Create backup
    const backupPath = configPath + '.backup';
    fs.copyFileSync(configPath, backupPath);
    
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    if (!config.mcpServers || !config.mcpServers[name]) {
      throw new Error(`Server "${name}" not found`);
    }
    
    // Update server configuration
    config.mcpServers[name] = serverConfig;
    
    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    event.reply('mcp:update-server-response', { success: true });
  } catch (error) {
    console.error('Error updating MCP server:', error);
    event.reply('mcp:update-server-response', { 
      success: false, 
      error: error.message 
    });
  }
});

// Remove MCP server
ipcMain.on('mcp:remove-server', (event, name) => {
  try {
    const configPath = getClaudeConfigPath();
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Configuration file not found');
    }
    
    // Create backup
    const backupPath = configPath + '.backup';
    fs.copyFileSync(configPath, backupPath);
    
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    // Don't allow removing protected servers
    const protectedServers = ['codeagentswarm-tasks', 'codeagentswarm'];
    if (protectedServers.includes(name.toLowerCase())) {
      throw new Error(`Cannot remove protected server "${name}"`);
    }
    
    // Check if server exists in main config
    let serverFound = false;
    if (config.mcpServers && config.mcpServers[name]) {
      // Remove from main config
      delete config.mcpServers[name];
      serverFound = true;
    }
    
    // Check if server exists in disabled backup
    const disabledBackupPath = path.join(path.dirname(configPath), '.mcp_disabled_servers.json');
    if (fs.existsSync(disabledBackupPath)) {
      try {
        const disabledServers = JSON.parse(fs.readFileSync(disabledBackupPath, 'utf8'));
        if (disabledServers[name]) {
          // Remove from disabled backup
          delete disabledServers[name];
          serverFound = true;
          
          // Update or remove backup file
          if (Object.keys(disabledServers).length > 0) {
            fs.writeFileSync(disabledBackupPath, JSON.stringify(disabledServers, null, 2));
          } else {
            // Remove backup file if empty
            fs.unlinkSync(disabledBackupPath);
          }
        }
      } catch (e) {
        console.error('Error handling disabled servers backup:', e);
      }
    }
    
    // Also check for old _disabled_ format and remove it
    if (config.mcpServers && config.mcpServers[`_disabled_${name}`]) {
      delete config.mcpServers[`_disabled_${name}`];
      serverFound = true;
    }
    
    if (!serverFound) {
      throw new Error(`Server "${name}" not found`);
    }
    
    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    event.reply('mcp:remove-server-response', { success: true });
  } catch (error) {
    console.error('Error removing MCP server:', error);
    event.reply('mcp:remove-server-response', { 
      success: false, 
      error: error.message 
    });
  }
});

// Toggle MCP server enabled state
ipcMain.on('mcp:toggle-server', (event, { name, enabled }) => {
  try {
    const configPath = getClaudeConfigPath();
    
    console.log(`[MCP Debug] Toggle request: ${name} -> ${enabled ? 'ENABLE' : 'DISABLE'}`);
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Configuration file not found');
    }
    
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    console.log('[MCP Debug] Current servers before toggle:', Object.keys(config.mcpServers || {}));
    
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    
    // Get backup file path for disabled servers
    const backupPath = path.join(path.dirname(configPath), '.mcp_disabled_servers.json');
    let disabledServers = {};
    
    // Load existing disabled servers backup
    if (fs.existsSync(backupPath)) {
      try {
        disabledServers = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      } catch (e) {
        console.log('[MCP Debug] Could not read disabled servers backup, starting fresh');
        disabledServers = {};
      }
    }
    
    // NEW APPROACH: Delete servers completely when disabled, restore from backup when enabled
    if (!enabled) {
      // Disable: Remove server completely and save to backup
      if (config.mcpServers[name]) {
        console.log(`[MCP Debug] Disabling: removing ${name} from config and saving to backup`);
        
        // Save the server config to backup
        disabledServers[name] = config.mcpServers[name];
        
        // Remove from main config
        delete config.mcpServers[name];
        
        // Also check for _disabled_ prefixed version and remove it
        const disabledName = `_disabled_${name}`;
        if (config.mcpServers[disabledName]) {
          console.log(`[MCP Debug] Also removing old disabled version: ${disabledName}`);
          delete config.mcpServers[disabledName];
        }
        
        // Save backup file
        fs.writeFileSync(backupPath, JSON.stringify(disabledServers, null, 2));
      } else {
        // Check if it's already disabled (in backup)
        if (disabledServers[name]) {
          console.log(`[MCP Debug] Server "${name}" is already disabled`);
        } else {
          console.log(`[MCP Debug] Server "${name}" not found to disable`);
          throw new Error(`Server "${name}" not found`);
        }
      }
    } else {
      // Enable: Restore from backup
      if (disabledServers[name]) {
        console.log(`[MCP Debug] Enabling: restoring ${name} from backup`);
        
        // Restore the server config
        config.mcpServers[name] = disabledServers[name];
        
        // Remove from disabled backup
        delete disabledServers[name];
        
        // Update backup file
        if (Object.keys(disabledServers).length > 0) {
          fs.writeFileSync(backupPath, JSON.stringify(disabledServers, null, 2));
        } else {
          // Remove backup file if empty
          if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
          }
        }
      } else if (config.mcpServers[name]) {
        console.log(`[MCP Debug] Server "${name}" is already enabled`);
      } else {
        // Check for old _disabled_ version
        const disabledName = `_disabled_${name}`;
        if (config.mcpServers[disabledName]) {
          console.log(`[MCP Debug] Enabling from old format: ${disabledName} -> ${name}`);
          config.mcpServers[name] = config.mcpServers[disabledName];
          delete config.mcpServers[disabledName];
        } else {
          console.log(`[MCP Debug] Server "${name}" not found in disabled state`);
          throw new Error(`Server "${name}" not found in disabled state`);
        }
      }
    }
    
    console.log('[MCP Debug] Servers after toggle:', Object.keys(config.mcpServers));
    
    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('[MCP Debug] Config file updated successfully');
    
    event.reply('mcp:toggle-server-response', { success: true });
  } catch (error) {
    console.error('[MCP Debug] Error toggling MCP server:', error);
    event.reply('mcp:toggle-server-response', { 
      success: false, 
      error: error.message 
    });
  }
});

// Update CLAUDE.md with MCP instructions
ipcMain.on('mcp:update-claude-instructions', async (event, { serverId }) => {
  try {
    console.log(`[MCP] Updating global CLAUDE.md instructions for: ${serverId}`);
    
    // Import the instructions manager
    const MCPInstructionsManager = require('./mcp-instructions-manager');
    const manager = new MCPInstructionsManager();
    
    // Update the global CLAUDE.md
    const result = await manager.updateClaudeMd(true); // true = use global
    
    if (result) {
      console.log(`[MCP] Successfully updated global CLAUDE.md at ~/.claude/CLAUDE.md`);
      event.reply('mcp:update-claude-instructions-response', { 
        success: true,
        message: `Updated global CLAUDE.md with ${serverId} instructions`
      });
    } else {
      event.reply('mcp:update-claude-instructions-response', { 
        success: false,
        error: 'Failed to update global CLAUDE.md'
      });
    }
  } catch (error) {
    console.error('[MCP] Error updating CLAUDE.md instructions:', error);
    event.reply('mcp:update-claude-instructions-response', { 
      success: false, 
      error: error.message 
    });
  }
});

// ================== End MCP Settings IPC Handlers ==================

// New function to just check Claude installation without auto-installing
function checkClaudeInstallation() {
  console.log('🔍 Checking for Claude Code installation...');
  
  // Use the existing findClaudeBinary function which is more robust
  const claudePath = findClaudeBinary();
  
  if (!claudePath) {
    // Claude Code is not installed - just show a notification
    console.log('⚠️ Claude Code not found in any location');
    
    // Only show notification once per session
    if (!global.claudeNotificationShown) {
      global.claudeNotificationShown = true;
      
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: 'Claude Code no detectado',
          body: 'Instala Claude Code para habilitar las funciones de gestión de tareas',
          silent: true
        });
        
        notification.show();
        
        notification.on('click', () => {
          // Open Claude Code installation page
          require('electron').shell.openExternal('https://claude.ai/code');
        });
      }
    }
  } else {
    console.log('✅ Claude Code is installed at:', claudePath);
    CLAUDE_BINARY_PATH = claudePath;
    
    // Configure MCP if needed
    configureMCPInClaudeCLI().catch(error => {
      console.error('MCP configuration error:', error);
    });
  }
}

function registerWithClaude() {
  console.log('🔍 registerWithClaude called - checking for Claude Code...');
  
  // First check if Claude Code is installed
  const checkClaude = spawn('which', ['claude'], {
    shell: true
  });
  
  checkClaude.on('close', async (code) => {
    console.log('🔍 which claude returned code:', code);
    
    if (code !== 0) {
      // Claude Code is not installed
      console.log('⚠️ Claude Code not found - starting automatic installation');
      
      // Create and show progress window immediately
      const progressWindow = new BrowserWindow({
        parent: mainWindow,
        modal: true,
        width: 450,
        height: 200,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        },
        frame: false,
        backgroundColor: '#1e1e1e',
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        center: true
      });
      
      progressWindow.loadURL(`data:text/html,
        <html>
          <head>
            <style>
              body {
                margin: 0;
                padding: 30px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                background: #1e1e1e;
                color: #ffffff;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                height: 100vh;
                box-sizing: border-box;
              }
              h2 { 
                margin: 0 0 20px 0; 
                font-weight: 500;
                color: #ffffff;
              }
              .spinner {
                border: 3px solid rgba(255, 255, 255, 0.1);
                border-top: 3px solid #0084ff;
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 20px auto;
              }
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
              .status {
                color: #999;
                font-size: 14px;
                margin-top: 10px;
                text-align: center;
              }
              .command {
                font-family: 'Consolas', 'Monaco', monospace;
                background: rgba(255, 255, 255, 0.1);
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 12px;
                color: #0084ff;
                margin-top: 10px;
              }
            </style>
          </head>
          <body>
            <h2>Instalando Claude Code</h2>
            <div class="spinner"></div>
            <div class="status">Ejecutando instalación con npm...</div>
            <div class="command">npm install -g @anthropic-ai/claude-code</div>
          </body>
        </html>
      `);
      
      // Wait a moment for the window to render
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Run npm install
      console.log('📦 Running npm install -g @anthropic-ai/claude-code...');
      const npmInstall = spawn('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
        shell: true,
        stdio: 'pipe'
      });
      
      let installOutput = '';
      let errorOutput = '';
      
      npmInstall.stdout.on('data', (data) => {
        installOutput += data.toString();
        console.log('npm stdout:', data.toString());
      });
      
      npmInstall.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.log('npm stderr:', data.toString());
      });
      
      npmInstall.on('close', (installCode) => {
        progressWindow.close();
        
        if (installCode === 0) {
          console.log('✅ Claude Code installed successfully');
          
          // Show success notification
          new Notification({
            title: 'Claude Code instalado',
            body: 'Claude Code se ha instalado correctamente. Configurando MCP...',
            icon: path.join(__dirname, 'icon.png')
          }).show();
          
          // Configure MCP after successful installation
          setTimeout(() => {
            console.log('🔧 Configuring MCP after installation...');
            configureMCPInClaudeCLI();
            // Also register with the newly installed Claude
            registerWithClaude();
          }, 1000);
          
        } else {
          console.error('❌ Failed to install Claude Code:', errorOutput);
          
          // Show error dialog with more options
          dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Error de instalación',
            message: 'No se pudo instalar Claude Code automáticamente',
            detail: `Esto puede deberse a permisos de npm o problemas de red.\n\nPuedes intentar:\n1. Ejecutar manualmente: npm install -g @anthropic-ai/claude-code\n2. Usar sudo si estás en macOS/Linux\n3. Descargar desde: https://claude.ai/code`,
            buttons: ['OK', 'Abrir página de descarga'],
            defaultId: 0
          }).then(result => {
            if (result.response === 1) {
              require('electron').shell.openExternal('https://claude.ai/code');
            }
          });
        }
      });
      
      return;
    }
    
    // Claude is installed, proceed with registration
    try {
      // First update the config file
      const configUpdated = updateClaudeConfigFile();
      if (!configUpdated) {
        console.error('Failed to update Claude config file, trying CLI method anyway...');
      }
      
      // Use claude mcp add to register our server
      const serverPath = app.isPackaged 
        ? path.join(process.resourcesPath, 'app.asar', 'mcp-stdio-server.js')
        : path.join(__dirname, 'mcp-stdio-server.js');
        
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
  });
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

// Handle custom alerts with app icon
ipcMain.handle('show-alert', async (event, options) => {
  const { message, type = 'info' } = options;
  
  console.log('Showing alert:', message, 'Type:', type); // Debug log
  
  const dialogOptions = {
    type: type, // 'none', 'info', 'error', 'question', 'warning'
    buttons: ['OK'],
    defaultId: 0,
    title: 'CodeAgentSwarm',
    message: message,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    noLink: true
  };
  
  const result = await dialog.showMessageBox(mainWindow, dialogOptions);
  return result.response;
});

// Database handlers
ipcMain.handle('db-save-directory', async (event, terminalId, directory) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    
    // Save terminal directory
    const result = db.saveTerminalDirectory(terminalId, directory);
    
    // Ensure CLAUDE.md is configured for this directory
    if (result.success && directory) {
      ensureClaudeMdConfiguration(directory);
    }
    
    // Check if a project exists for this directory
    if (result.success && directory) {
      const existingProject = db.getProjectByPath(directory);
      
      if (!existingProject) {
        // Create a new project based on the directory
        const path = require('path');
        const projectName = path.basename(directory);
        
        // Generate a nice display name from the directory name
        const displayName = projectName
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
        
        console.log(`Creating new project "${displayName}" for directory: ${directory}`);
        
        // Create the project with the directory as its path
        const projectResult = db.createProject(projectName, directory);
        
        if (projectResult.success) {
          // Update display name if different from project name
          if (displayName !== projectName) {
            db.updateProjectDisplayName(projectName, displayName);
          }
          console.log(`Successfully created project "${displayName}" for new terminal directory`);
        }
      }
    }
    
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
ipcMain.handle('task-create', async (event, title, description, terminalId, project) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.createTask(title, description, terminalId, project);
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
    const tasks = await db.getAllTasks(); // Make sure to await the Promise
    return { success: true, tasks };
  } catch (error) {
    console.error('Error fetching tasks:', error);
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

ipcMain.handle('task-update', async (event, taskId, title, description, project) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateTask(taskId, title, description);
    // Update project separately if needed
    if (result.success && project) {
      db.updateTaskProject(taskId, project);
    }
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('task-update-terminal', async (event, taskId, terminalId) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateTaskTerminal(taskId, terminalId);
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

ipcMain.handle('task-update-plan', async (event, taskId, plan) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateTaskPlan(taskId, plan);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('task-update-implementation', async (event, taskId, implementation) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateTaskImplementation(taskId, implementation);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Project management handlers
ipcMain.handle('project-get-all', async () => {
  try {
    if (!db) return { success: true, projects: [] };
    const projects = db.getProjects();
    return { success: true, projects };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-project-folder', async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Project Folder',
    buttonLabel: 'Select Folder'
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
});

ipcMain.handle('project-create', async (event, name, color, folderPath) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    
    // Create project in database with folder path
    const result = db.createProject(name, folderPath, color);
    
    if (result.success && folderPath) {
      // Create or update CLAUDE.md in the selected folder
      try {
        const claudeMdPath = path.join(folderPath, 'CLAUDE.md');
        const { getCodeAgentSwarmSection, SECTION_START, SECTION_END } = require('./claude-md-config');
        
        let content = '';
        let existingContent = '';
        
        // Read existing content if file exists
        if (fs.existsSync(claudeMdPath)) {
          existingContent = fs.readFileSync(claudeMdPath, 'utf8');
          
          // Check if CodeAgentSwarm section exists
          const startIndex = existingContent.indexOf(SECTION_START);
          const endIndex = existingContent.indexOf(SECTION_END);
          
          if (startIndex !== -1 && endIndex !== -1) {
            // Replace existing section
            content = existingContent.substring(0, startIndex) +
                     getCodeAgentSwarmSection(name) +
                     existingContent.substring(endIndex + SECTION_END.length);
          } else {
            // Append new section
            content = existingContent + (existingContent.endsWith('\n') ? '' : '\n') +
                     getCodeAgentSwarmSection(name);
          }
        } else {
          // Create new file with CodeAgentSwarm section
          content = getCodeAgentSwarmSection(name);
        }
        
        // Write the file
        fs.writeFileSync(claudeMdPath, content, 'utf8');
        console.log(`Updated CLAUDE.md in ${folderPath} with project name: ${name}`);
        
      } catch (error) {
        console.log(`Error updating CLAUDE.md: ${error.message}`);
        // Don't fail the project creation if CLAUDE.md update fails
      }
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Helper function to update project name in CLAUDE.md
function updateClaudeMdProjectName(filePath, newProjectName) {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`CLAUDE.md not found at: ${filePath}`);
      return false;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Update project name in the Project Configuration section
    // Look for pattern: **Project Name**: [old name]
    const projectNameRegex = /(\*\*Project Name\*\*:\s*)(.+?)(?=\n|$)/;
    
    if (projectNameRegex.test(content)) {
      const oldProjectName = content.match(projectNameRegex)[2];
      content = content.replace(projectNameRegex, `$1${newProjectName}`);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated project name from "${oldProjectName}" to "${newProjectName}" in ${filePath}`);
      return true;
    } else {
      console.log(`Project name pattern not found in ${filePath}`);
    }
    
    return false;
  } catch (error) {
    console.log(`Error updating CLAUDE.md: ${error.message}`);
    return false;
  }
}

ipcMain.handle('project-update-display-name', async (event, name, displayName) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    
    // Update project display name in database
    const result = db.updateProjectDisplayName(name, displayName);
    
    if (result.success) {
      // Get the project to find its path
      const project = db.getProjectByName(name);
      if (project && project.path) {
        const claudeMdPath = path.join(project.path, 'CLAUDE.md');
        console.log(`Attempting to update CLAUDE.md at: ${claudeMdPath}`);
        const updated = updateClaudeMdProjectName(claudeMdPath, displayName);
        if (updated) {
          console.log(`✅ Successfully updated CLAUDE.md in ${project.path} with new project name: ${displayName}`);
        } else {
          console.log(`❌ Failed to update CLAUDE.md in ${project.path} - file may not exist or project name not found`);
        }
      }
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-update-color', async (event, name, color) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateProjectColor(name, color);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-update-path', async (event, name, newPath) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateProjectPath(name, newPath);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-delete', async (event, name) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.deleteProject(name);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-update-last-opened', async (event, projectPath) => {
  try {
    if (!db) return { success: false, error: 'Database not initialized' };
    const result = db.updateProjectLastOpened(projectPath);
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

ipcMain.handle('dialog-open-directory', async (event) => {
  try {
    // Don't specify a parent window to avoid crashes
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Project Directory'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
  } catch (error) {
    console.error('Error in dialog-open-directory:', error);
    return { success: false, error: error.message };
  }
});

// Show confirmation dialog
ipcMain.handle('show-confirm-dialog', async (event, options) => {
  try {
    const result = await dialog.showMessageBox({
      type: 'question',
      buttons: options.buttons || ['OK', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: options.title || 'Confirm',
      message: options.message || 'Are you sure?'
    });
    return result.response;
  } catch (error) {
    console.error('Error in show-confirm-dialog:', error);
    return 1; // Return cancel index on error
  }
});

// Cache for preloaded data
let preloadedTaskData = null;
let preloadedProjectData = null;

// Preload data for faster Task Manager opening
async function preloadTaskManagerData() {
  try {
    if (db) {
      // Preload tasks and projects in background
      // Note: These methods are synchronous in database.js
      const tasks = db.getAllTasks();
      const projects = db.getProjects();
      
      preloadedTaskData = tasks;
      preloadedProjectData = projects;
    }
  } catch (error) {
    console.error('Error preloading Task Manager data:', error);
  }
}

// Unified function to open or focus Kanban window
function openOrFocusKanbanWindow(options = {}) {
  // If kanban window already exists, reload and focus it
  if (kanbanWindow && !kanbanWindow.isDestroyed()) {
    // Reload the window content to refresh data
    kanbanWindow.webContents.reload();
    
    // Bring window to front
    kanbanWindow.show();
    kanbanWindow.focus();
    kanbanWindow.moveTop();
    
    // On macOS, we might need to use app.focus() to bring the window to front
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }
    
    // Send focus task ID after reload if provided
    if (options.focusTaskId) {
      kanbanWindow.webContents.once('did-finish-load', () => {
        kanbanWindow.webContents.send('focus-task', options.focusTaskId);
      });
    }
    return;
  }
  
  // Prevent concurrent window creation
  if (isCreatingKanbanWindow) {
    return;
  }
  
  isCreatingKanbanWindow = true;
  
  // Preload data before opening window
  preloadTaskManagerData();
  
  // Create new kanban window if it doesn't exist
  kanbanWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Task Manager - Kanban Board',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // Enable hardware acceleration for better performance
      webgl: true,
      offscreen: false
    },
    // Remove parent relationship to prevent minimizing main window
    modal: false,
    show: false, // Start hidden to prevent white flash
    backgroundColor: '#1a1a1a', // Dark background to match theme
    autoHideMenuBar: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    // Add icon to make it look like a separate app
    icon: path.join(__dirname, 'assets', 'icon.png'),
    // Focus the window when it opens
    alwaysOnTop: false,
    center: true,
    focusable: true
  });

  kanbanWindow.loadFile('kanban.html');
  
  // Send preloaded data immediately when DOM is ready
  kanbanWindow.webContents.once('dom-ready', () => {
    if (preloadedTaskData && preloadedProjectData) {
      kanbanWindow.webContents.send('preloaded-data', {
        tasks: preloadedTaskData,
        projects: preloadedProjectData
      });
    }
  });
  
  // Show and focus the window after loading
  kanbanWindow.webContents.once('did-finish-load', () => {
    kanbanWindow.show();
    kanbanWindow.focus();
    isCreatingKanbanWindow = false; // Reset flag after window is ready
    
    // Send focus task ID if provided
    if (options.focusTaskId) {
      kanbanWindow.webContents.send('focus-task', options.focusTaskId);
    }
  });
  
  // Clean up reference when window is closed
  kanbanWindow.on('closed', () => {
    kanbanWindow = null;
    isCreatingKanbanWindow = false; // Reset flag when window is closed
  });
}

// Open Kanban window
ipcMain.on('open-kanban-window', (event, options = {}) => {
  openOrFocusKanbanWindow(options);
});

// Handle task creation from renderer
ipcMain.on('create-task', async (event, taskData) => {
  try {
    const result = await db.createTask(
      taskData.title,
      taskData.description || '',
      taskData.terminal_id,
      taskData.project
    );
    
    // Notify the renderer of successful creation
    event.reply('task-created', {
      success: true,
      task: result
    });
    
    // Refresh task list in all terminals
    mainWindow.webContents.send('refresh-tasks');
    
    
  } catch (error) {
    console.error('Error creating task:', error);
    event.reply('task-created', {
      success: false,
      error: error.message
    });
  }
});

// Function to register IPC handlers that depend on database
function registerDatabaseHandlers() {
  // Handle shell preference update
  ipcMain.handle('update-shell-preference', async (event, shellConfig) => {
    try {
      const result = db.saveSetting('preferred_shell', shellConfig);
      return { success: result.success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Handle debug mode preference
  ipcMain.handle('get-debug-mode', async () => {
    try {
      const debugMode = db.getSetting('debug_mode');
      // getSetting returns the value directly, not an object with a value property
      const enabled = debugMode === true || debugMode === 'true';
      return { success: true, enabled: enabled };
    } catch (error) {
      return { success: false, enabled: false, error: error.message };
    }
  });
  
  // Handle Claude settings for global permissions
  ipcMain.handle('get-claude-settings', async () => {
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, 'utf8');
        return JSON.parse(content);
      }
      return null;
    } catch (error) {
      console.error('Error reading Claude settings:', error);
      return null;
    }
  });
  
  ipcMain.handle('save-claude-settings', async (event, settings) => {
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const dir = path.dirname(settingsPath);
      
      console.log('[IPC] Saving Claude settings:', JSON.stringify(settings.permissions, null, 2));
      
      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Read existing settings to preserve other fields
      let existingSettings = {};
      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, 'utf8');
        existingSettings = JSON.parse(content);
      }
      
      // Merge permissions while preserving other settings
      const mergedSettings = {
        ...existingSettings,
        permissions: settings.permissions
      };
      
      // Write settings with pretty formatting
      fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf8');
      
      console.log('[IPC] Settings saved successfully');
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error saving Claude settings:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-debug-mode', async (event, enabled) => {
    try {
      const result = db.saveSetting('debug_mode', enabled);
      return { success: result.success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // API key handlers removed - Claude Code doesn't need API keys

  // Handle get shell preference
  ipcMain.handle('get-shell-preference', async () => {
    try {
      const shellConfig = db.getSetting('preferred_shell');
      
      // Detect available shells from /etc/shells
      const availableShells = [];
      try {
        const shellsContent = fs.readFileSync('/etc/shells', 'utf8');
        const shells = shellsContent.split('\n')
          .filter(line => line && !line.startsWith('#'))
          .map(line => line.trim())
          .filter(shell => shell);
        
        // Check if each shell exists and is executable
        for (const shell of shells) {
          if (fs.existsSync(shell) && fs.statSync(shell).isFile()) {
            const name = path.basename(shell);
            availableShells.push({ path: shell, name: name });
          }
        }
      } catch (err) {
        // Fallback to common shells if /etc/shells is not available
        const commonShells = ['/bin/bash', '/bin/zsh', '/bin/sh'];
        for (const shell of commonShells) {
          if (fs.existsSync(shell)) {
            availableShells.push({ path: shell, name: path.basename(shell) });
          }
        }
      }
      
      return { 
        success: true, 
        config: shellConfig || { type: 'system' },
        currentShell: process.env.SHELL || '/bin/zsh',
        availableShells: availableShells
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

app.whenReady().then(async () => {
  // Initialize wizard window
  const wizardWindow = new WizardWindow();
  
  // Check if wizard should be shown
  if (wizardWindow.shouldShowWizard()) {
    // Show wizard on first run
    wizardWindow.create();
    
    // Wait for wizard completion before continuing
    app.once('wizard-completed', async () => {
      await initializeApp();
    });
  } else {
    // Normal app initialization
    await initializeApp();
  }
});

async function initializeApp() {
  // Start time measurement
  const startTime = Date.now();
  console.log('[Startup] Initializing app...');
  
  // Set PATH early (synchronous)
  if (!process.env.PATH.includes('/opt/homebrew/bin')) {
    process.env.PATH = `/opt/homebrew/bin:${process.env.PATH}`;
  }
  if (!process.env.PATH.includes('/usr/local/bin')) {
    process.env.PATH = `/usr/local/bin:${process.env.PATH}`;
  }
  
  // Create splash window FIRST for immediate feedback
  createSplashWindow();
  console.log(`[Startup] Splash window created in ${Date.now() - startTime}ms`);
  
  // Update splash status
  global.updateSplashStatus('Initializing...', 10);
  
  // Create main window (hidden)
  createWindow();
  console.log(`[Startup] Main window created in ${Date.now() - startTime}ms`);
  
  // Initialize critical services in parallel
  const criticalInit = Promise.all([
    // Initialize database
    (async () => {
      try {
        global.updateSplashStatus('Loading database...', 20);
        db = new DatabaseManager();
        registerDatabaseHandlers();
        console.log(`[Startup] Database initialized in ${Date.now() - startTime}ms`);
        global.updateSplashStatus('Database ready', 30);
      } catch (error) {
        console.error('Failed to initialize database:', error);
        db = null;
      }
    })(),
    
    // Initialize Git service
    (async () => {
      global.updateSplashStatus('Initializing Git service...', 40);
      gitService = new GitService();
      console.log(`[Startup] Git service initialized in ${Date.now() - startTime}ms`);
      global.updateSplashStatus('Git service ready', 50);
    })(),
    
    // Find Claude binary
    (async () => {
      global.updateSplashStatus('Checking Claude Code...', 60);
      CLAUDE_BINARY_PATH = findClaudeBinary();
      if (!CLAUDE_BINARY_PATH) {
        console.warn('Claude Code not found - users will need to install it');
      }
      console.log(`[Startup] Claude binary search completed in ${Date.now() - startTime}ms`);
      global.updateSplashStatus('Environment ready', 70);
    })()
  ]);
  
  // Wait for critical services
  await criticalInit;
  
  // Setup local shortcuts
  registerLocalShortcuts();
  
  // Defer non-critical initialization
  setTimeout(() => {
    // Preload Task Manager data
    preloadTaskManagerData();
    // Refresh preloaded data every 30 seconds
    setInterval(() => {
      preloadTaskManagerData();
    }, 30000);
  }, 2000);
  
  // Defer updater initialization to not block startup
  setTimeout(() => {
    try {
      // Pass logger to UpdaterService
      global.updaterService = new UpdaterService(logger);
      logger.addLog('info', ['Updater service initialized successfully']);
      
      // Test update server connection after 5 seconds
      setTimeout(async () => {
        try {
          logger.addLog('info', ['Testing update server connection...']);
          const testResult = await global.updaterService.testUpdateServerConnection();
          logger.addLog('info', ['Update server test result:', JSON.stringify(testResult)]);
        } catch (error) {
          logger.addLog('error', ['Update server connection test failed:', error.message]);
        }
      }, 5000);
      
      // Check for updates after 10 seconds
      setTimeout(() => {
        logger.addLog('info', ['Auto-update check triggered (10s delay)']);
        if (!process.env.DISABLE_UPDATES) {
          logger.addLog('info', ['Updates enabled, checking for updates...']);
          global.updaterService.checkForUpdatesAndNotify().catch(err => {
            logger.addLog('error', ['Auto-update check failed:', err.message]);
          });
        } else {
          logger.addLog('info', ['Updates disabled via DISABLE_UPDATES env var']);
        }
      }, 10000);
      
      // Check for updates every 4 hours
      setInterval(() => {
        logger.addLog('info', ['Periodic update check triggered (4h interval)']);
        if (!process.env.DISABLE_UPDATES) {
          global.updaterService.checkForUpdatesAndNotify().catch(err => {
            logger.addLog('error', ['Periodic update check failed:', err.message]);
          });
        }
      }, 4 * 60 * 60 * 1000);
      
    } catch (error) {
      logger.addLog('error', ['Failed to initialize updater service:', error.message, error.stack]);
    }
  }, 1000); // Defer by 1 second
  
  // Start non-critical services in background
  const backgroundInit = Promise.all([
    // Start MCP Task Server
    (async () => {
      try {
        mcpServer = new MCPTaskServer();
        const port = await mcpServer.start();
        console.log(`[Startup] MCP Task Server running on port ${port} - ${Date.now() - startTime}ms`);
      } catch (error) {
        console.error('Failed to start MCP Task Server:', error);
        mcpServer = null;
      }
    })()
  ]);
  
  // Don't wait for background services
  backgroundInit.catch(error => {
    console.error('Background service initialization failed:', error);
  });
  
  // Defer hooks initialization - move to background
  setTimeout(async () => {
    try {
      hooksManager = new HooksManager();
      webhookServer = new WebhookServer(mainWindow);
      
      // Start webhook server asynchronously without awaiting
      webhookServer.start().then(webhookResult => {
        if (webhookResult.success) {
          console.log(`[Background] Webhook server started on port ${webhookResult.port}`);
        } else {
          console.error('[Background] Failed to start webhook server:', webhookResult.error);
        }
      }).catch(error => {
        console.error('[Background] Webhook server error:', error);
      });
      
      // Install hooks automatically (also async)
      hooksManager.checkHooksStatus().then(async hooksStatus => {
        if (!hooksStatus.installed) {
          console.log('Installing CodeAgentSwarm hooks...');
          const installResult = await hooksManager.installHooks();
          if (installResult.success) {
            console.log('Hooks installed successfully');
          } else {
            console.error('Failed to install hooks:', installResult.error);
          }
        } else {
          console.log('Hooks already installed');
        }
      }).catch(error => {
        console.error('Failed to check hooks status:', error);
      });
    } catch (error) {
      console.error('Failed to initialize hooks system:', error);
    }
  }, 3000); // Defer by 3 seconds
  
  // Defer MCP server registration
  setTimeout(() => {
    try {
      startMCPServerAndRegister();
      console.log(`[Startup] MCP server registration initiated - ${Date.now() - startTime}ms`);
    } catch (error) {
      console.error('Failed to start MCP server:', error);
    }
  }, 2000);
  
  // Check and install Claude Code if needed (defer)
  setTimeout(async () => {
    try {
      console.log('🔍 Checking Claude Code installation on startup...');
      checkClaudeInstallation();
      // MCP configuration is already called inside checkClaudeInstallation, no need to duplicate
    } catch (error) {
      console.error('Failed to check Claude installation:', error);
    }
  }, 5000); // Defer by 5 seconds
  
  // Log final startup time
  console.log(`[Startup] ✅ App initialization completed in ${Date.now() - startTime}ms`);
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

app.on('window-all-closed', () => {
  // Mark app as quitting to prevent restarts
  app.isQuitting = true;
  
  terminals.forEach((shell) => {
    // Check if it's a real shell with kill method
    if (shell && typeof shell.kill === 'function') {
      shell.kill();
    }
  });
  terminals.clear();
  
  // Clear health check interval
  if (mcpServerHealthCheckInterval) {
    clearInterval(mcpServerHealthCheckInterval);
    mcpServerHealthCheckInterval = null;
  }
  
  // Clear restart timer
  if (mcpServerRestartTimer) {
    clearTimeout(mcpServerRestartTimer);
    mcpServerRestartTimer = null;
  }
  
  // Stop MCP servers
  if (mcpServer) {
    mcpServer.stop();
  }
  
  // Stop MCP child process
  if (mcpServerProcess) {
    console.log('Stopping MCP server process...');
    mcpServerProcess.kill();
    mcpServerProcess = null;
  }
  
  // Always quit the app when all windows are closed
  app.quit();
});

// Function to find claude binary dynamically
function findClaudeBinary() {
  const { execSync } = require('child_process');
  
  console.log('🔍 Starting comprehensive Claude binary search...');
  console.log('Current PATH:', process.env.PATH);
  console.log('Current shell:', process.env.SHELL || 'unknown');
  
  // Try to find claude using which command
  try {
    const claudePath = execSync('which claude', { encoding: 'utf8', shell: true }).trim();
    if (claudePath && fs.existsSync(claudePath)) {
      console.log('✅ Found claude via which:', claudePath);
      return claudePath;
    }
  } catch (e) {
    console.log('❌ which claude failed:', e.message);
  }
  
  // Try to find claude through npm global list
  try {
    const npmList = execSync('npm list -g @anthropic-ai/claude-code --depth=0', { encoding: 'utf8', shell: true });
    if (npmList.includes('@anthropic-ai/claude-code')) {
      // Get npm global bin directory
      const npmBin = execSync('npm bin -g', { encoding: 'utf8', shell: true }).trim();
      const npmClaudePath = path.join(npmBin, 'claude');
      if (fs.existsSync(npmClaudePath)) {
        console.log('✅ Found claude via npm global:', npmClaudePath);
        return npmClaudePath;
      }
    }
  } catch (e) {
    console.log('❌ npm list check failed:', e.message);
  }
  
  // Try yarn global
  try {
    const yarnGlobal = execSync('yarn global list --json', { encoding: 'utf8', shell: true });
    if (yarnGlobal.includes('@anthropic-ai/claude-code')) {
      const yarnBin = execSync('yarn global bin', { encoding: 'utf8', shell: true }).trim();
      const yarnClaudePath = path.join(yarnBin, 'claude');
      if (fs.existsSync(yarnClaudePath)) {
        console.log('✅ Found claude via yarn global:', yarnClaudePath);
        return yarnClaudePath;
      }
    }
  } catch (e) {
    console.log('❌ yarn global check failed:', e.message);
  }
  
  // Try pnpm global
  try {
    const pnpmList = execSync('pnpm list -g --json', { encoding: 'utf8', shell: true });
    if (pnpmList.includes('@anthropic-ai/claude-code')) {
      const pnpmBin = execSync('pnpm bin -g', { encoding: 'utf8', shell: true }).trim();
      const pnpmClaudePath = path.join(pnpmBin, 'claude');
      if (fs.existsSync(pnpmClaudePath)) {
        console.log('✅ Found claude via pnpm global:', pnpmClaudePath);
        return pnpmClaudePath;
      }
    }
  } catch (e) {
    console.log('❌ pnpm global check failed:', e.message);
  }
  
  // Check volta
  try {
    const voltaBin = path.join(os.homedir(), '.volta/bin/claude');
    if (fs.existsSync(voltaBin)) {
      console.log('✅ Found claude via volta:', voltaBin);
      return voltaBin;
    }
  } catch (e) {
    console.log('❌ volta check failed:', e.message);
  }
  
  // Search common macOS locations
  const possiblePaths = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',  // Apple Silicon Macs
    '/usr/bin/claude',
    path.join(os.homedir(), '.local/bin/claude'),
    // Additional paths for different installation methods
    path.join(os.homedir(), 'bin/claude'),
    '/Applications/Claude.app/Contents/MacOS/claude',
    '/Applications/Claude Code.app/Contents/MacOS/claude',
    // Homebrew on Apple Silicon
    '/opt/homebrew/opt/claude/bin/claude',
    // Common npm global paths
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude',
    '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude'
  ];
  
  // Search all nvm node versions dynamically
  const nvmPath = path.join(os.homedir(), '.nvm/versions/node');
  if (fs.existsSync(nvmPath)) {
    try {
      const nodeVersions = fs.readdirSync(nvmPath);
      console.log(`🔍 Found ${nodeVersions.length} nvm node versions`);
      nodeVersions.forEach(version => {
        possiblePaths.push(path.join(nvmPath, version, 'bin/claude'));
        // Also check in lib/node_modules for npm installed packages
        possiblePaths.push(path.join(nvmPath, version, 'lib/node_modules/@anthropic-ai/claude-code/bin/claude'));
      });
    } catch (e) {
      console.log('❌ Error reading nvm versions:', e.message);
    }
  }
  
  // Check n node version manager
  const nPath = path.join(os.homedir(), 'n/lib/node_modules/@anthropic-ai/claude-code/bin/claude');
  possiblePaths.push(nPath);
  
  // Check each path
  console.log(`🔍 Checking ${possiblePaths.length} possible paths...`);
  for (const claudePath of possiblePaths) {
    if (fs.existsSync(claudePath)) {
      console.log('✅ Found claude at:', claudePath);
      return claudePath;
    }
  }
  
  console.error('❌ Claude not found in any of the', possiblePaths.length, 'locations checked');
  console.log('📋 Paths checked:', possiblePaths);
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
ipcMain.on('show-badge-notification', (event, message) => {
  // Send badge notification to main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('display-badge', message);
  }
});

ipcMain.on('show-desktop-notification', (event, title, message) => {
  if (Notification.isSupported()) {
    // Use the app logo as notification icon
    const iconPath = path.join(__dirname, 'logo_prod_512.png');
    
    const notification = new Notification({
      title: title,
      body: message,
      icon: iconPath,
      sound: true,
      urgency: 'normal', // Changed from 'critical' to 'normal' for less intrusive notifications
      timeoutType: 'default' // Auto-dismiss after system default timeout
    });
    
    notification.show();
    
    // Send event to renderer to scroll terminal if message contains terminal number
    const terminalMatch = message.match(/Terminal (\d+)/);
    if (terminalMatch && mainWindow && !mainWindow.isDestroyed()) {
      const terminalNumber = parseInt(terminalMatch[1]);
      const quadrant = terminalNumber - 1; // Convert 1-based to 0-based
      mainWindow.webContents.send('scroll-terminal-to-bottom', quadrant);
    }
    
    // Optional: Handle notification click
    notification.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        
        // If in tabbed mode, switch to the corresponding tab
        const terminalNumber = parseInt(terminalMatch[1]);
        const quadrant = terminalNumber - 1; // Convert 1-based to 0-based
        mainWindow.webContents.send('focus-terminal-tab', quadrant);
      }
    });
  } else {
    console.log('Desktop notifications not supported on this system');
  }
});

// Open system notification settings
ipcMain.on('open-system-notifications', (event) => {
  const { shell } = require('electron');
  
  if (process.platform === 'darwin') {
    // macOS: Open System Settings > Notifications
    shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
  } else if (process.platform === 'win32') {
    // Windows: Open Settings > System > Notifications
    shell.openExternal('ms-settings:notifications');
  } else {
    // Linux: Try to open system settings (varies by distribution)
    shell.openExternal('gnome-control-center notifications') ||
    shell.openExternal('unity-control-center notifications') ||
    shell.openExternal('systemsettings5 notifications');
  }
});

// Store IDs of terminal title notifications that have been sent to renderer
// This gets cleared when renderer reloads to ensure notifications are re-sent
let sentTerminalTitleNotifications = new Set();

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
    
    // Debug: Log what we're reading
    // IMPORTANT: We process ALL terminal_title_update notifications, not just unprocessed ones
    // This ensures titles always update when MCP is called
    const terminalTitleNotifications = notifications.filter(n => n.type === 'terminal_title_update');
    if (terminalTitleNotifications.length > 0) {
      console.log(`[Main] Found ${terminalTitleNotifications.length} terminal title notifications (processing all)`);
    }
    
    // Create unique IDs for notifications
    notifications = notifications.map((n, index) => ({
      ...n,
      _id: `${n.type}_${n.timestamp}_${index}`
    }));
    
    // Filter unprocessed notifications
    let unprocessedToSend = [];
    
    // Group terminal title notifications by terminal_id and get the most recent one for each
    const latestTitlesByTerminal = {};
    notifications.forEach(n => {
      if (n.type === 'terminal_title_update') {
        const existing = latestTitlesByTerminal[n.terminal_id];
        if (!existing || new Date(n.timestamp) > new Date(existing.timestamp)) {
          latestTitlesByTerminal[n.terminal_id] = n;
        }
      }
    });
    
    notifications.forEach(n => {
      if (n.type === 'terminal_title_update') {
        // For terminal titles: ALWAYS send the latest one per terminal
        // This ensures MCP updates always work, regardless of processed state
        if (latestTitlesByTerminal[n.terminal_id] === n && !sentTerminalTitleNotifications.has(n._id)) {
          unprocessedToSend.push(n);
          sentTerminalTitleNotifications.add(n._id);
          console.log(`[Main] Sending latest terminal title notification: Terminal ${n.terminal_id} -> "${n.title}"`);
        }
      } else if (!n.processed) {
        // For other types, send if unprocessed
        unprocessedToSend.push(n);
      }
    });
    
    // Mark non-terminal_title_update notifications as processed
    if (unprocessedToSend.length > 0) {
      notifications = notifications.map(n => {
        // Remove the temporary _id before saving
        const { _id, ...notificationWithoutId } = n;
        
        if (n.type !== 'terminal_title_update' && !n.processed) {
          return { ...notificationWithoutId, processed: true };
        }
        return notificationWithoutId;
      });
      
      // Write back to file
      fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
    }
    
    return { success: true, notifications: unprocessedToSend };
  } catch (error) {
    console.error('Error checking task notifications:', error);
    return { success: false, error: error.message };
  }
});

// Clear the sent notifications tracking when renderer reloads
ipcMain.handle('renderer-ready', async () => {
  // Clear the Set so notifications are re-sent after reload
  const previousSize = sentTerminalTitleNotifications.size;
  sentTerminalTitleNotifications.clear();
  console.log(`[Main] Renderer ready - cleared ${previousSize} sent notifications from tracking`);
  return { success: true };
});

// Clear old terminal title notifications on app start
ipcMain.handle('clear-old-terminal-title-notifications', async () => {
  try {
    const notificationDir = path.join(os.homedir(), '.codeagentswarm');
    const notificationFile = path.join(notificationDir, 'task_notifications.json');
    
    if (!fs.existsSync(notificationFile)) {
      return { success: true };
    }
    
    // Read and parse notifications
    const content = fs.readFileSync(notificationFile, 'utf8');
    let notifications = JSON.parse(content);
    
    // Remove all terminal_title_update notifications
    const beforeCount = notifications.length;
    notifications = notifications.filter(n => n.type !== 'terminal_title_update');
    const removedCount = beforeCount - notifications.length;
    
    // Write back to file
    fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
    
    console.log(`[Main] Cleared ${removedCount} old terminal title notifications from file`);
    
    // Also clear the sent notifications tracking to ensure clean state
    sentTerminalTitleNotifications.clear();
    
    return { success: true, removed: removedCount };
  } catch (error) {
    console.error('Error clearing old terminal title notifications:', error);
    return { success: false, error: error.message };
  }
});

// Mark terminal title notifications as processed
ipcMain.handle('mark-terminal-titles-processed', async () => {
  try {
    const notificationDir = path.join(os.homedir(), '.codeagentswarm');
    const notificationFile = path.join(notificationDir, 'task_notifications.json');
    
    if (!fs.existsSync(notificationFile)) {
      return { success: true };
    }
    
    // Read and parse notifications
    const content = fs.readFileSync(notificationFile, 'utf8');
    let notifications = JSON.parse(content);
    
    // Mark all terminal_title_update notifications as processed
    notifications = notifications.map(n => {
      if (n.type === 'terminal_title_update') {
        return { ...n, processed: true };
      }
      return n;
    });
    
    // Write back to file
    fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
    
    // Clear the sent notifications set since they're now processed
    // But we don't need to clear it because processed notifications won't be sent again anyway
    
    return { success: true };
  } catch (error) {
    console.error('Error marking terminal titles as processed:', error);
    return { success: false, error: error.message };
  }
});

// Update app badge count handler
ipcMain.handle('update-badge-count', async (event, count) => {
  try {
    // Set badge count on macOS dock and Windows taskbar
    if (process.platform === 'darwin') {
      // macOS: set dock badge
      app.badgeCount = count;
    } else if (process.platform === 'win32' && mainWindow) {
      // Windows: use overlay icon or flash frame
      if (count > 0) {
        mainWindow.flashFrame(true);
        // You can also set an overlay icon here if you have badge images
      } else {
        mainWindow.flashFrame(false);
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error updating badge count:', error);
    return { success: false, error: error.message };
  }
});

// Get notification count from terminals waiting for response
ipcMain.handle('get-notification-count', async () => {
  try {
    return { success: true, count: terminalsWaitingForResponse.size };
  } catch (error) {
    console.error('Error getting notification count:', error);
    return { success: false, error: error.message };
  }
});

// Update terminals waiting for response
ipcMain.handle('update-terminals-waiting', async (event, waitingTerminals) => {
  try {
    terminalsWaitingForResponse = new Set(waitingTerminals);
    // Update badge count
    if (process.platform === 'darwin') {
      app.badgeCount = terminalsWaitingForResponse.size;
    }
    return { success: true };
  } catch (error) {
    console.error('Error updating terminals waiting:', error);
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
  try {
    const cwd = getGitWorkingDirectory();
    return await gitService.getStatus(cwd);
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
  try {
    const cwd = getGitWorkingDirectory();
    return await gitService.commit(cwd, message, files);
  } catch (error) {
    console.error('Git commit error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to commit changes' 
    };
  }
});

// Generate AI commit message handler
ipcMain.handle('generate-ai-commit-message', async (event, workingDirectory, style) => {
  try {
    const cwd = workingDirectory || getGitWorkingDirectory();
    return await gitService.generateCommitMessage(cwd, style);
  } catch (error) {
    console.error('Generate AI commit message error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to generate commit message' 
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
// Note: Using 'git diff HEAD' to show all changes (both staged and unstaged)
// - 'git diff' only shows unstaged changes
// - 'git diff --cached' only shows staged changes  
// - 'git diff HEAD' shows all changes compared to last commit
ipcMain.handle('git-diff', async (event, fileName, workingDirectory, options = {}) => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  
  try {
    // Use provided working directory or fallback to getGitWorkingDirectory
    const cwd = workingDirectory || getGitWorkingDirectory();
    
    // Check if file is untracked
    let isUntracked = false;
    let diffOutput = '';
    
    if (fileName) {
      try {
        // Check git status for this specific file
        const statusOutput = execSync(`git status --porcelain "${fileName}"`, { cwd, encoding: 'utf8' });
        isUntracked = statusOutput.trim().startsWith('??');
        
        if (isUntracked) {
          // For untracked files, create a diff that shows all lines as additions
          const filePath = path.join(cwd, fileName);
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            
            // Create a unified diff format for the new file
            diffOutput = `diff --git a/${fileName} b/${fileName}\n`;
            diffOutput += `new file mode 100644\n`;
            diffOutput += `index 0000000..0000000\n`;
            diffOutput += `--- /dev/null\n`;
            diffOutput += `+++ b/${fileName}\n`;
            diffOutput += `@@ -0,0 +1,${lines.length} @@\n`;
            diffOutput += lines.map(line => `+${line}`).join('\n');
          }
        } else {
          // For tracked files, get diff against HEAD to show all changes (staged and unstaged)
          diffOutput = execSync(`git diff HEAD "${fileName}"`, { cwd, encoding: 'utf8' });
        }
      } catch (e) {
        // Fallback to regular diff against HEAD
        diffOutput = execSync(`git diff HEAD "${fileName}"`, { cwd, encoding: 'utf8' });
      }
    } else {
      // Get diff for all files against HEAD
      diffOutput = execSync('git diff HEAD', { cwd, encoding: 'utf8' });
    }
    
    let result = { success: true, diff: diffOutput };
    
    // If requested, also get full file contents for expansion capability
    if (options.includeFileContents && fileName) {
      try {
        // Get the current (modified) content
        const filePath = path.join(cwd, fileName);
        const newContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        
        // Get the original (HEAD) content
        let oldContent = '';
        if (!isUntracked) {
          try {
            oldContent = execSync(`git show HEAD:"${fileName}"`, { cwd, encoding: 'utf8' });
          } catch (e) {
            // File might be new, so no HEAD version exists
            oldContent = '';
          }
        }
        // For untracked files, oldContent remains empty
        
        result.fileContents = {
          oldContent,
          newContent
        };
        
        console.log('File contents loaded:', {
          fileName,
          oldContentLength: oldContent.length,
          newContentLength: newContent.length
        });
      } catch (e) {
        console.warn('Could not get file contents for expansion:', e.message);
      }
    }
    
    return result;
    
  } catch (error) {
    console.error('Git diff error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to get diff'
    };
  }
});

// Git get file content handler (for diff expansion)
ipcMain.handle('git-get-file-content', async (event, fileName, workingDirectory, revision = 'HEAD') => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  
  try {
    const cwd = workingDirectory || getGitWorkingDirectory();
    
    if (revision === 'WORKING') {
      // Get current working directory version
      const filePath = path.join(cwd, fileName);
      const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
      return { success: true, content };
    } else {
      // Get specific revision (usually HEAD)
      const content = execSync(`git show ${revision}:"${fileName}"`, { cwd, encoding: 'utf8' });
      return { success: true, content };
    }
  } catch (error) {
    console.error('Git get file content error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to get file content'
    };
  }
});

// Git discard file changes handler
ipcMain.handle('git-discard-file', async (event, fileName, workingDirectory) => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  
  try {
    // Use provided working directory or fallback to getGitWorkingDirectory
    const cwd = workingDirectory || getGitWorkingDirectory();
    
    console.log(`[Git Discard] Processing file: ${fileName}`);
    
    // First check if the file is tracked by git
    let isTracked = true;
    try {
      execSync(`git ls-files --error-unmatch "${fileName}"`, { 
        cwd, 
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'] // Suppress stderr
      });
      console.log(`[Git Discard] File ${fileName} is tracked`);
    } catch (e) {
      // File is not tracked by git
      isTracked = false;
      console.log(`[Git Discard] File ${fileName} is untracked`);
    }
    
    let output = '';
    let message = '';
    
    if (isTracked) {
      // Discard changes to tracked file
      output = execSync(`git checkout HEAD -- "${fileName}"`, { cwd, encoding: 'utf8' });
      message = `Changes to ${fileName} discarded`;
    } else {
      // Remove untracked file
      const filePath = path.join(cwd, fileName);
      fs.unlinkSync(filePath);
      message = `New file ${fileName} deleted`;
    }
    
    return { success: true, message, output };
    
  } catch (error) {
    console.error('Git discard file error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to discard file changes'
    };
  }
});

// Git discard all changes handler
ipcMain.handle('git-discard-all', async (event, includeUntracked = false) => {
  const { execSync } = require('child_process');
  try {
    const cwd = getGitWorkingDirectory();
    let output = '';
    
    // Discard all changes to tracked files
    output += execSync('git checkout HEAD -- .', { cwd, encoding: 'utf8' });
    
    // Remove untracked files if requested
    if (includeUntracked) {
      // -f: force, -d: remove directories too
      output += '\n' + execSync('git clean -fd', { cwd, encoding: 'utf8' });
    }
    
    return { success: true, message: 'All changes discarded', output };
    
  } catch (error) {
    console.error('Git discard all error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to discard all changes'
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
    
    // Get all branches sorted by most recent commit
    const localBranches = execSync('git for-each-ref --sort=-committerdate --format="%(refname:short)" refs/heads/', { cwd, encoding: 'utf8' })
      .split('\n')
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

// Scan for git projects with changes (only from active terminals)
ipcMain.handle('scan-git-projects', async () => {
  const { execSync } = require('child_process');
  const fs = require('fs').promises;
  const path = require('path');
  
  console.log('\n=== GIT SCAN STARTED ===');
  console.log('Current terminals Map size:', terminals.size);
  console.log('Terminals Map contents:');
  for (const [id, term] of terminals) {
    console.log(`  Terminal ${id}:`, {
      exists: !!term,
      type: term?.constructor?.name,
      hasShell: !!term?.shell,
      hasCwd: !!term?.cwd,
      cwd: term?.cwd || 'no cwd',
      placeholder: term?.placeholder || false
    });
  }
  
  try {
    const projects = [];
    const terminalDirs = new Set();
    
    // Get current working directory from each active terminal
    const terminalMap = new Map();
    console.log('[Git Scan] Getting current directories from terminals:');
    console.log('[Git Scan] Active terminals:', terminals.size);
    console.log('[Git Scan] Terminal entries:', Array.from(terminals.entries()).map(([id, term]) => ({
      id,
      cwd: term?.cwd,
      exists: !!term
    })));
    
    // Clean up any null or placeholder terminals before scanning
    for (const [terminalId, terminal] of terminals) {
      if (!terminal || terminal.placeholder) {
        console.log(`[Git Scan] Removing ${!terminal ? 'null' : 'placeholder'} terminal ${terminalId} from map`);
        terminals.delete(terminalId);
      }
    }
    
    for (const [terminalId, terminal] of terminals) {
      console.log(`[Git Scan] Checking terminal ${terminalId}:`, terminal ? 'exists' : 'null');
      console.log(`[Git Scan] Terminal type:`, terminal?.constructor?.name || 'unknown');
      console.log(`[Git Scan] Terminal properties:`, terminal ? Object.keys(terminal) : 'none');
      
      if (terminal && !terminal.placeholder) {
        try {
          // Only consider active terminals with cwd
          if (terminal.isActive && terminal.cwd) {
            console.log(`[Git Scan] Terminal ${terminalId} is ACTIVE with directory:`, terminal.cwd);
            console.log(`[Git Scan] Adding directory to scan:`, terminal.cwd);
            terminalDirs.add(terminal.cwd);
            terminalMap.set(terminal.cwd, terminalId);
          } else if (!terminal.isActive) {
            console.log(`[Git Scan] Terminal ${terminalId} is INACTIVE - removing from map`);
            terminals.delete(terminalId);
          } else {
            console.log(`[Git Scan] Terminal ${terminalId} exists but has NO CWD - skipping`);
          }
        } catch (e) {
          console.error(`[Git Scan] Error getting directory for terminal ${terminalId}:`, e);
        }
      }
    }
    
    console.log('[Git Scan] Total directories found:', terminalDirs.size);
    
    // If no terminals active, return empty list
    if (terminalDirs.size === 0) {
      console.log('[Git Scan] No active terminals found');
      return { success: true, projects: [] };
    }
    
    // Check each terminal directory for git repos
    for (const terminalDir of terminalDirs) {
      try {
        // First check if the terminal directory itself is a git repo
        let isGitRepo = false;
        try {
          execSync('git rev-parse --is-inside-work-tree', {
            cwd: terminalDir,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          });
          isGitRepo = true;
        } catch (e) {
          // Not a git repo, continue
        }
        
        if (isGitRepo) {
          // Get status
          const statusOutput = execSync('git status --porcelain', {
            cwd: terminalDir,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          });
          
          // Get current branch
          const branch = execSync('git branch --show-current', {
            cwd: terminalDir,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          }).trim();
          
          // Count all changes (including directories)
          const changes = statusOutput.trim().split('\n').filter(line => {
            if (line.length === 0) return false;
            
            // Extract filename from status line
            const fileName = line.substring(3).trim();
            if (!fileName) return false;
            
            return true;
          });
          const changeCount = changes.length;
          
          // Always add git projects, even without changes
          projects.push({
            path: terminalDir,
            name: path.basename(terminalDir),
            branch: branch || 'master',
            changeCount: changeCount,
            changes: changes.slice(0, 10), // First 10 changes
            fromTerminal: true,
            terminalId: terminalMap.get(terminalDir) || null
          });
        }
        
        // Also check subdirectories (1 level deep)
        try {
          const subdirs = await fs.readdir(terminalDir, { withFileTypes: true });
          for (const dirent of subdirs) {
            if (dirent.isDirectory() && !dirent.name.startsWith('.')) {
              const subdirPath = path.join(terminalDir, dirent.name);
              
              try {
                // Check if subdirectory has a .git folder
                const gitPath = path.join(subdirPath, '.git');
                const hasGitFolder = await fs.access(gitPath).then(() => true).catch(() => false);
                
                if (!hasGitFolder) {
                  console.log(`[Git Scan] Skipping ${subdirPath} - no .git folder`);
                  continue;
                }
                
                execSync('git rev-parse --is-inside-work-tree', {
                  cwd: subdirPath,
                  encoding: 'utf8',
                  stdio: ['pipe', 'pipe', 'ignore']
                });
                
                console.log(`[Git Scan] Found git repo at ${subdirPath}`);
                // Subdirectory is a git repo, check status
                const statusOutput = execSync('git status --porcelain', {
                  cwd: subdirPath,
                  encoding: 'utf8',
                  stdio: ['pipe', 'pipe', 'ignore']
                });
                
                const branch = execSync('git branch --show-current', {
                  cwd: subdirPath,
                  encoding: 'utf8',
                  stdio: ['pipe', 'pipe', 'ignore']
                }).trim();
                
                const changes = statusOutput.trim().split('\n').filter(line => {
                  if (line.length === 0) return false;
                  
                  // Extract filename from status line
                  const fileName = line.substring(3).trim();
                  if (!fileName) return false;
                  
                  return true;
                });
                
                // Check if we already have this project
                const exists = projects.some(p => p.path === subdirPath);
                if (!exists) {
                  // Count unpushed commits
                  let unpushedCount = 0;
                  try {
                    const upstream = execSync('git rev-parse --abbrev-ref @{u}', {
                      cwd: subdirPath,
                      encoding: 'utf8',
                      stdio: ['pipe', 'pipe', 'ignore']
                    }).trim();
                    
                    if (upstream) {
                      unpushedCount = parseInt(
                        execSync(`git rev-list ${upstream}..HEAD --count`, {
                          cwd: subdirPath,
                          encoding: 'utf8'
                        }).trim()
                      ) || 0;
                    }
                  } catch (e) {
                    // No upstream branch
                  }
                  
                  projects.push({
                    path: subdirPath,
                    name: dirent.name,
                    branch: branch || 'master',
                    changeCount: changes.length,
                    changes: changes.slice(0, 10),
                    fromTerminal: true,
                    terminalId: terminalMap.get(terminalDir) || null,
                    isSubdir: true,
                    unpushedCount: unpushedCount
                  });
                }
              } catch (e) {
                // Not a git repo, continue
              }
            }
          }
        } catch (e) {
          console.error('Error reading subdirectories:', e);
        }
        
        // NOTE: Parent directory scanning removed - only showing projects with active terminals
      } catch (e) {
        console.error('Error checking terminal directory:', e);
      }
    }
    
    // Sort by change count
    projects.sort((a, b) => b.changeCount - a.changeCount);
    
    console.log(`[Git Scan] Found ${projects.length} projects with changes:`, projects.map(p => p.name));
    
    return { success: true, projects };
  } catch (error) {
    console.error('Scan git projects error:', error);
    return { success: false, error: error.message };
  }
});

// Get git status for specific project
ipcMain.handle('get-project-git-status', async (event, projectPath) => {
  const { execSync } = require('child_process');
  try {
    // Check if directory is a git repository
    const isGitRepo = execSync('git rev-parse --is-inside-work-tree', { 
      cwd: projectPath, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim() === 'true';
    
    if (!isGitRepo) {
      return { success: false, error: 'Not a git repository' };
    }
    
    // Get git status with porcelain format for easy parsing
    const statusOutput = execSync('git status --porcelain', { 
      cwd: projectPath, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    
    // Parse the status output
    const files = [];
    const lines = statusOutput.trim().split('\n').filter(line => line.length > 0);
    
    lines.forEach(line => {
      if (line.length < 3) return;
      
      const status = line.substring(0, 2);
      const fileName = line.substring(2).trim();
      
      let statusText = '';
      const indexStatus = status[0];
      const workingStatus = status[1];
      
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
        statusText = 'New';
      } else if (status === '!!') {
        statusText = 'Ignored';
      } else {
        statusText = 'Modified';
      }
      
      // Check if it's a directory and skip it
      const filePath = path.join(projectPath, fileName);
      try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          return; // Skip directories
        }
      } catch (e) {
        // If we can't stat the file, it might be deleted, so include it
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
      cwd: projectPath, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    
    // Get recent commits
    const commits = execSync('git log --oneline -10', { 
      cwd: projectPath, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim().split('\n').filter(line => line.length > 0).map(line => {
      const [hash, ...messageParts] = line.split(' ');
      return {
        hash: hash,
        message: messageParts.join(' ')
      };
    });
    
    // Check for unpushed commits
    let unpushedCount = 0;
    let hasUpstream = true;
    try {
      // First check if there's an upstream branch
      execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      
      // Count unpushed commits
      const unpushedOutput = execSync('git rev-list --count @{u}..HEAD', { 
        cwd: projectPath, 
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      unpushedCount = parseInt(unpushedOutput) || 0;
    } catch (e) {
      // No upstream branch configured
      hasUpstream = false;
      // Count all commits if no upstream
      try {
        const allCommitsCount = execSync('git rev-list --count HEAD', {
          cwd: projectPath,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
        unpushedCount = parseInt(allCommitsCount) || 0;
      } catch (e2) {
        // Ignore
      }
    }
    
    return { 
      success: true, 
      files, 
      branch,
      workingDirectory: projectPath,
      projectName: path.basename(projectPath),
      commits,
      unpushedCount,
      hasUpstream
    };
    
  } catch (error) {
    console.error('Project git status error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to get git status'
    };
  }
});

// Git operations for specific project
ipcMain.handle('git-commit-project', async (event, projectPath, message, files) => {
  const { execSync } = require('child_process');
  try {
    // Add specific files or all if none specified
    if (files && files.length > 0) {
      for (const file of files) {
        execSync(`git add "${file}"`, { cwd: projectPath });
      }
    } else {
      execSync('git add .', { cwd: projectPath });
    }
    
    // Commit with message
    execSync(`git commit -m "${message}"`, { cwd: projectPath, encoding: 'utf8' });
    
    return { success: true, message: 'Commit successful' };
    
  } catch (error) {
    console.error('Git commit project error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to commit changes'
    };
  }
});

// Git push for specific project
ipcMain.handle('git-push-project', async (event, projectPath) => {
  const { execSync } = require('child_process');
  try {
    const output = execSync('git push', { cwd: projectPath, encoding: 'utf8' });
    return { success: true, output };
  } catch (error) {
    console.error('Git push project error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to push changes'
    };
  }
});

// Git pull for specific project  
ipcMain.handle('git-pull-project', async (event, projectPath) => {
  const { execSync } = require('child_process');
  try {
    const output = execSync('git pull', { cwd: projectPath, encoding: 'utf8' });
    return { success: true, output };
  } catch (error) {
    console.error('Git pull project error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to pull changes'
    };
  }
});

app.on('before-quit', (event) => {
  console.log('App is quitting, cleaning up processes...');
  
  // Unregister all local shortcuts
  unregisterLocalShortcuts();
  
  // If we're already handling quit, don't do it again
  if (isHandlingQuit) {
    console.log('Already handling quit, skipping...');
    return;
  }
  
  // In dev mode with electron-reload, force immediate exit
  if (process.argv.includes('--dev')) {
    console.log('Dev mode detected, forcing immediate exit for reload...');
    process.exit(0);
  }
  
  // Mark that we're handling quit
  isHandlingQuit = true;
  
  // Prevent default quit to ensure cleanup
  event.preventDefault();
  
  // Kill all terminals and their child processes
  let cleanupCount = terminals.size;
  terminals.forEach((shell, quadrant) => {
    console.log(`Killing terminal ${quadrant}...`);
    // Check if it's a real shell with kill method
    if (shell && typeof shell.kill === 'function') {
      shell.kill();
    }
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
  
  // Clear all intervals and timers
  if (mcpServerHealthCheckInterval) {
    clearInterval(mcpServerHealthCheckInterval);
    mcpServerHealthCheckInterval = null;
  }
  
  if (mcpServerRestartTimer) {
    clearTimeout(mcpServerRestartTimer);
    mcpServerRestartTimer = null;
  }
  
  // Stop webhook server
  if (webhookServer) {
    webhookServer.stop();
  }
  
  // Stop MCP child process
  if (mcpServerProcess) {
    console.log('Stopping MCP server process...');
    mcpServerProcess.kill();
    mcpServerProcess = null;
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
    
    // Now actually quit - force quit on macOS to remove from dock
    if (process.platform === 'darwin') {
      // On macOS, we need to force quit to remove from dock
      app.quit();
      // If app.quit() doesn't work, force exit
      setTimeout(() => {
        process.exit(0);
      }, 100);
    } else {
      app.quit();
    }
  }, 500);
});

// Function to ensure CLAUDE.md is configured with MCP Task Manager
function ensureClaudeMdConfiguration(projectPath) {
  const fs = require('fs');
  const path = require('path');
  const { SECTION_START, SECTION_END, getCodeAgentSwarmSection } = require('./claude-md-config');
  
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  let projectName = path.basename(projectPath);
  
  // Try to get the actual project name from the database
  if (db) {
    const existingProject = db.getProjectByPath(projectPath);
    if (existingProject && existingProject.name) {
      projectName = existingProject.name;
    } else if (fs.existsSync(claudeMdPath)) {
      // If no project in DB, try to extract project name from existing CLAUDE.md
      const currentContent = fs.readFileSync(claudeMdPath, 'utf8');
      const projectNameMatch = currentContent.match(/\*\*Project Name\*\*:\s*(.+?)(?=\n|$)/);
      if (projectNameMatch && projectNameMatch[1]) {
        projectName = projectNameMatch[1].trim();
      }
    }
  }
  
  try {
    let fileContent = '';
    let existingUserContent = '';
    
    // Check if CLAUDE.md already exists
    if (fs.existsSync(claudeMdPath)) {
      // Read existing content
      const currentContent = fs.readFileSync(claudeMdPath, 'utf8');
      
      // Check if it has our section markers
      const startIndex = currentContent.indexOf(SECTION_START);
      const endIndex = currentContent.indexOf(SECTION_END);
      
      if (startIndex !== -1 && endIndex !== -1) {
        // Extract user content before and after our section
        const beforeSection = currentContent.substring(0, startIndex).trim();
        const afterSection = currentContent.substring(endIndex + SECTION_END.length).trim();
        
        // Combine user content
        existingUserContent = beforeSection;
        if (afterSection) {
          existingUserContent += (existingUserContent ? '\n\n' : '') + afterSection;
        }
      } else {
        // No markers found, keep all existing content
        existingUserContent = currentContent;
      }
    }
    
    // Build the new file content
    if (existingUserContent.trim()) {
      // Check if user content has a project title
      const titleMatch = existingUserContent.match(/^#\s+(.+?)(?:\s+Project Configuration)?\s*$/m);
      
      if (titleMatch) {
        // User has a title, place our section after it
        const titleLine = titleMatch[0];
        const titleIndex = existingUserContent.indexOf(titleLine);
        const afterTitle = titleIndex + titleLine.length;
        
        fileContent = existingUserContent.substring(0, afterTitle) + 
                     '\n\n' + getCodeAgentSwarmSection(projectName) + 
                     '\n\n' + existingUserContent.substring(afterTitle).trim();
      } else {
        // No title, add our section with a generic title
        fileContent = `# ${projectName} Project Configuration\n\n` +
                     getCodeAgentSwarmSection(projectName) + 
                     '\n\n---\n\n' + existingUserContent;
      }
    } else {
      // New file or empty file
      fileContent = `# ${projectName} Project Configuration\n\n` + getCodeAgentSwarmSection(projectName);
    }
    
    // Only write if content has changed
    if (fs.existsSync(claudeMdPath)) {
      const currentContent = fs.readFileSync(claudeMdPath, 'utf8');
      if (currentContent === fileContent) {
        console.log(`✅ CLAUDE.md already up-to-date for: ${projectName}`);
        return;
      }
    }
    
    // Write the updated content
    fs.writeFileSync(claudeMdPath, fileContent, 'utf8');
    console.log(`✅ Updated CLAUDE.md with CodeAgentSwarm configuration for: ${projectName}`);
    
  } catch (error) {
    console.error('❌ Failed to configure CLAUDE.md:', error);
  }
}

// IPC handlers for log management
ipcMain.handle('get-log-path', () => {
  return {
    logFile: logFile,
    logDir: logDir
  };
});

ipcMain.handle('open-log-directory', () => {
  const { shell } = require('electron');
  shell.openPath(logDir);
  return { success: true };
});

// IPC handler for MCP Permissions Window
ipcMain.handle('open-permissions-window', async () => {
  const permissionsWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    parent: mainWindow,
    modal: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    },
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    title: 'MCP Permissions Manager'
  });
  
  permissionsWindow.loadFile('mcp-permissions-manager.html');
  
  permissionsWindow.once('ready-to-show', () => {
    permissionsWindow.show();
  });
  
  permissionsWindow.on('closed', () => {
    // Refresh main window permissions if needed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('permissions-updated');
    }
  });
  
  return { success: true };
});

// Handle opening terminal in project path
ipcMain.handle('open-terminal-in-path', async (event, terminalId) => {
  try {
    const { shell, app } = require('electron');
    const { exec } = require('child_process');
    const path = require('path');
    
    // Get the working directory for this terminal
    let cwd = process.cwd();
    if (terminals.has(terminalId)) {
      const terminal = terminals.get(terminalId);
      if (terminal && terminal.cwd) {
        cwd = terminal.cwd;
      }
    }
    
    const platform = process.platform;
    
    if (platform === 'darwin') {
      // macOS - Open Terminal.app in the specific directory
      exec(`open -a Terminal "${cwd}"`, (error) => {
        if (error) {
          console.error('Error opening Terminal:', error);
          // Try with iTerm2 as fallback
          exec(`open -a iTerm "${cwd}"`, (error2) => {
            if (error2) {
              console.error('Error opening iTerm:', error2);
            }
          });
        }
      });
    } else if (platform === 'win32') {
      // Windows - Open Command Prompt or PowerShell
      exec(`start cmd /K "cd /d ${cwd}"`, (error) => {
        if (error) {
          console.error('Error opening Command Prompt:', error);
          // Try PowerShell as fallback
          exec(`start powershell -NoExit -Command "cd '${cwd}'"`, (error2) => {
            if (error2) {
              console.error('Error opening PowerShell:', error2);
            }
          });
        }
      });
    } else {
      // Linux - Try various terminal emulators
      const terminals = ['gnome-terminal', 'konsole', 'xterm', 'terminator', 'xfce4-terminal'];
      let opened = false;
      
      for (const term of terminals) {
        try {
          if (term === 'gnome-terminal') {
            exec(`${term} --working-directory="${cwd}"`, (error) => {
              if (!error) opened = true;
            });
          } else {
            exec(`${term} --workdir "${cwd}"`, (error) => {
              if (!error) opened = true;
            });
          }
          if (opened) break;
        } catch (e) {
          continue;
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error opening terminal:', error);
    return { success: false, error: error.message };
  }
});

// Handle opening folder in file explorer
ipcMain.handle('open-folder', async (event, terminalId) => {
  try {
    const { shell } = require('electron');
    
    // Get the working directory for this terminal
    let cwd = process.cwd();
    if (terminals.has(terminalId)) {
      const terminal = terminals.get(terminalId);
      if (terminal && terminal.cwd) {
        cwd = terminal.cwd;
      }
    }
    
    // Open the folder in the system's file explorer
    await shell.openPath(cwd);
    
    return { success: true };
  } catch (error) {
    console.error('Error opening folder:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// IDE Integration - Generic system for detecting and opening IDEs
// ============================================================================

// Configuration for supported IDEs - Easy to add more!
const IDE_CONFIGS = {
  intellij: {
    name: 'IntelliJ IDEA',
    icon: 'code-2', // Lucide icon name
    platforms: {
      darwin: { // macOS
        paths: [
          '~/Applications/IntelliJ IDEA Ultimate.app',
          '~/Applications/IntelliJ IDEA.app',
          '/Applications/IntelliJ IDEA.app',
          '/Applications/IntelliJ IDEA Ultimate.app',
          '/Applications/IntelliJ IDEA Community Edition.app',
          '~/Library/Application Support/JetBrains/Toolbox/apps/IDEA-U',
          '~/Library/Application Support/JetBrains/Toolbox/apps/IDEA-C'
        ],
        openCommand: (idePath, projectPath) => `open -na "${idePath}" --args "${projectPath}"`,
        searchCommand: 'mdfind -name "IntelliJ IDEA.app"'
      },
      win32: { // Windows
        paths: [
          'C:\\Program Files\\JetBrains\\IntelliJ IDEA',
          'C:\\Program Files\\JetBrains\\IntelliJ IDEA Community Edition',
          'C:\\Program Files (x86)\\JetBrains\\IntelliJ IDEA'
        ],
        openCommand: (idePath, projectPath) => `"${idePath}\\bin\\idea64.exe" "${projectPath}"`,
        searchCommand: null
      },
      linux: {
        paths: [
          '/usr/local/bin/idea',
          '/opt/idea/bin/idea.sh',
          '/snap/bin/intellij-idea-ultimate',
          '/snap/bin/intellij-idea-community'
        ],
        openCommand: (idePath, projectPath) => `"${idePath}" "${projectPath}"`,
        searchCommand: 'which idea'
      }
    }
  },
  vscode: {
    name: 'Visual Studio Code',
    icon: 'file-code',
    platforms: {
      darwin: {
        paths: [
          '/Applications/Visual Studio Code.app',
          '/usr/local/bin/code'
        ],
        openCommand: (idePath, projectPath) => `open -na "${idePath}" --args "${projectPath}"`,
        searchCommand: 'mdfind -name "Visual Studio Code.app"'
      },
      win32: {
        paths: [
          'C:\\Program Files\\Microsoft VS Code',
          'C:\\Program Files (x86)\\Microsoft VS Code',
          process.env.LOCALAPPDATA + '\\Programs\\Microsoft VS Code'
        ],
        openCommand: (idePath, projectPath) => `"${idePath}\\Code.exe" "${projectPath}"`,
        searchCommand: null
      },
      linux: {
        paths: [
          '/usr/bin/code',
          '/usr/local/bin/code',
          '/snap/bin/code'
        ],
        openCommand: (idePath, projectPath) => `"${idePath}" "${projectPath}"`,
        searchCommand: 'which code'
      }
    }
  },
  cursor: {
    name: 'Cursor',
    icon: 'edit-3',
    platforms: {
      darwin: {
        paths: [
          '/Applications/Cursor.app',
          '/usr/local/bin/cursor'
        ],
        openCommand: (idePath, projectPath) => `open -na "${idePath}" --args "${projectPath}"`,
        searchCommand: 'mdfind -name "Cursor.app"'
      },
      win32: {
        paths: [
          process.env.LOCALAPPDATA + '\\Programs\\cursor\\Cursor.exe'
        ],
        openCommand: (idePath, projectPath) => `"${idePath}" "${projectPath}"`,
        searchCommand: null
      },
      linux: {
        paths: [
          '/usr/bin/cursor',
          '/usr/local/bin/cursor'
        ],
        openCommand: (idePath, projectPath) => `"${idePath}" "${projectPath}"`,
        searchCommand: 'which cursor'
      }
    }
  }
  // Add more IDEs here in the future:
  // webstorm: { ... },
  // sublime: { ... },
  // atom: { ... },
};

// Generic function to detect if an IDE is installed
async function detectIDE(ideKey) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { exec } = require('child_process');
  const util = require('util');
  const execPromise = util.promisify(exec);
  
  const ideConfig = IDE_CONFIGS[ideKey];
  if (!ideConfig) return { installed: false };
  
  const platform = process.platform;
  const platformConfig = ideConfig.platforms[platform];
  if (!platformConfig) return { installed: false };
  
  // Check standard paths
  for (let idePath of platformConfig.paths) {
    // Expand home directory
    if (idePath.startsWith('~')) {
      idePath = path.join(os.homedir(), idePath.slice(1));
    }
    
    if (fs.existsSync(idePath)) {
      return { 
        installed: true, 
        path: idePath,
        name: ideConfig.name,
        icon: ideConfig.icon,
        key: ideKey
      };
    }
  }
  
  // Try search command if available
  if (platformConfig.searchCommand) {
    try {
      const { stdout } = await execPromise(platformConfig.searchCommand);
      if (stdout && stdout.trim()) {
        const foundPath = stdout.trim().split('\n')[0]; // Take first result
        return { 
          installed: true, 
          path: foundPath,
          name: ideConfig.name,
          icon: ideConfig.icon,
          key: ideKey
        };
      }
    } catch (e) {
      // Search command failed, IDE not found
    }
  }
  
  return { installed: false };
}

// Detect all installed IDEs
async function detectAllIDEs() {
  const detectedIDEs = [];
  
  for (const ideKey of Object.keys(IDE_CONFIGS)) {
    const result = await detectIDE(ideKey);
    if (result.installed) {
      detectedIDEs.push(result);
    }
  }
  
  return detectedIDEs;
}

// Handler to check which IDEs are installed
ipcMain.handle('check-installed-ides', async () => {
  try {
    const ides = await detectAllIDEs();
    return { success: true, ides };
  } catch (error) {
    console.error('Error detecting IDEs:', error);
    return { success: false, ides: [] };
  }
});

// Handler to open project in specific IDE
ipcMain.handle('open-in-ide', async (event, terminalId, ideKey) => {
  try {
    const { exec } = require('child_process');
    
    // Get the IDE configuration
    const ideResult = await detectIDE(ideKey);
    if (!ideResult.installed) {
      return { success: false, error: `${IDE_CONFIGS[ideKey]?.name || ideKey} not found` };
    }
    
    // Get the working directory for this terminal
    let cwd = process.cwd();
    if (terminals.has(terminalId)) {
      const terminal = terminals.get(terminalId);
      if (terminal && terminal.cwd) {
        cwd = terminal.cwd;
      }
    }
    
    // Get the open command for this platform
    const platform = process.platform;
    const openCommand = IDE_CONFIGS[ideKey].platforms[platform].openCommand;
    const command = openCommand(ideResult.path, cwd);
    
    console.log(`Opening ${ideResult.name} with command:`, command);
    
    // Execute the command and return a promise
    return new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error opening ${ideResult.name}:`, error);
          console.error('stderr:', stderr);
          resolve({ success: false, error: error.message });
        } else {
          console.log(`Successfully opened ${ideResult.name}`);
          if (stdout) console.log('stdout:', stdout);
          resolve({ success: true });
        }
      });
    });
  } catch (error) {
    console.error('Error opening IDE:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('show-log-notification', () => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: 'CodeAgentSwarm Logs',
      body: `Logs are saved in:\n${logDir}`,
      silent: false
    });
    
    notification.on('click', () => {
      const { shell } = require('electron');
      shell.openPath(logDir);
    });
    
    notification.show();
  }
  return { logDir, logFile };
});

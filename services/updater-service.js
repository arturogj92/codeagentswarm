const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { dialog } = require('electron');
const { net } = require('electron');

// Create a wrapper for logging that sends to both electron-log and our logger
const dualLog = {
  info: (...args) => {
    log.info(...args);
    // Force sync logging to main logger
    setImmediate(() => {
      try {
        const logger = require('../logger');
        logger.addLog('info', args);
      } catch (e) {
        console.log('[UpdaterService] Logger error:', e.message, args);
      }
    });
  },
  error: (...args) => {
    log.error(...args);
    setImmediate(() => {
      try {
        const logger = require('../logger');
        logger.addLog('error', args);
      } catch (e) {
        console.error('[UpdaterService] Logger error:', e.message, args);
      }
    });
  }
};

class UpdaterService {
  constructor(mainLogger) {
    // Store reference to main logger
    this.mainLogger = mainLogger;
    
    // Configure logs
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';
    
    // Enable debug mode to see all HTTP requests
    autoUpdater.logger.transports.console.level = 'silly';
    
    // Disable auto-download for more control
    autoUpdater.autoDownload = false;
    // Enable auto-install on app quit as a fallback
    autoUpdater.autoInstallOnAppQuit = true;
    
    // Track download state
    this.isDownloading = false;
    this.downloadCancellationToken = null;
    this.currentUpdateInfo = null;
    
    // Override dualLog to use the main logger
    if (mainLogger) {
      dualLog.info = (...args) => {
        log.info(...args);
        mainLogger.addLog('info', args);
      };
      dualLog.error = (...args) => {
        log.error(...args);
        mainLogger.addLog('error', args);
      };
    }
    
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      dualLog.info('Checking for updates...');
      this.sendToRenderer('checking-for-update');
    });
    
    autoUpdater.on('update-available', async (info) => {
      dualLog.info('=== UPDATE AVAILABLE EVENT ===');
      dualLog.info('Update version:', info.version);
      dualLog.info('Full update info:', JSON.stringify(info, null, 2));
      this.currentUpdateInfo = info;
      
      // Fetch changelog from backend
      try {
        const currentVersion = this.getCurrentVersion();
        const changelog = await this.fetchChangelog(currentVersion, info.version);
        
        this.sendToRenderer('update-available', {
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes,
          files: info.files,
          changelog: changelog
        });
      } catch (error) {
        dualLog.error('Failed to fetch changelog:', error);
        // Send update info without changelog
        this.sendToRenderer('update-available', {
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes,
          files: info.files
        });
      }
    });
    
    autoUpdater.on('update-not-available', (info) => {
      dualLog.info('No updates available');
      this.currentUpdateInfo = null;
      this.sendToRenderer('update-not-available', {
        version: info.version
      });
    });
    
    autoUpdater.on('error', (err) => {
      // Check if this is just a "no updates available" error
      if (err.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || 
          (err.message && err.message.includes('404'))) {
        dualLog.info('No updates available (404 from server)');
        this.sendToRenderer('update-not-available');
        return;
      }
      
      dualLog.error('Update error:', err);
      this.isDownloading = false;
      this.downloadCancellationToken = null;
      
      // Provide user-friendly error messages
      let errorMessage = err.message;
      if (err.message.includes('net::')) {
        errorMessage = 'Network error. Please check your internet connection.';
      } else if (err.message.includes('ENOSPC')) {
        errorMessage = 'Not enough disk space to download the update.';
      } else if (err.message.includes('EPERM') || err.message.includes('EACCES')) {
        errorMessage = 'Permission denied. Try running as administrator.';
      }
      
      this.sendToRenderer('update-error', {
        message: errorMessage,
        detail: err.message
      });
    });
    
    autoUpdater.on('download-progress', (progressObj) => {
      const logMessage = `Download: ${Math.round(progressObj.percent)}% - Speed: ${this.formatBytes(progressObj.bytesPerSecond)}/s`;
      dualLog.info(logMessage);
      
      // Enhanced progress info
      const progressInfo = {
        percent: progressObj.percent,
        bytesPerSecond: progressObj.bytesPerSecond,
        transferred: progressObj.transferred,
        total: progressObj.total,
        speedFormatted: this.formatBytes(progressObj.bytesPerSecond) + '/s',
        transferredFormatted: this.formatBytes(progressObj.transferred),
        totalFormatted: this.formatBytes(progressObj.total),
        eta: this.calculateETA(progressObj)
      };
      
      this.sendToRenderer('update-progress', progressInfo);
    });
    
    autoUpdater.on('update-downloaded', (info) => {
      dualLog.info('=== UPDATE DOWNLOADED EVENT ===');
      dualLog.info('Update downloaded:', info.version);
      dualLog.info('Update info stored in autoUpdater');
      
      // Store update info in autoUpdater for later verification
      autoUpdater.updateInfo = info;
      
      this.isDownloading = false;
      this.downloadCancellationToken = null;
      this.sendToRenderer('update-downloaded', {
        version: info.version,
        releaseNotes: info.releaseNotes
      });
    });
  }
  
  async checkForUpdates() {
    try {
      // Configure update server URL
      const serverUrl = process.env.UPDATE_SERVER_URL || 'https://codeagentswarm-backend-production.up.railway.app';
      const updateUrl = `${serverUrl}/update`;
      
      dualLog.info('=== UPDATE CHECK START ===');
      dualLog.info('Current app version:', autoUpdater.currentVersion.version);
      dualLog.info('Update server URL:', updateUrl);
      dualLog.info('Platform:', process.platform);
      dualLog.info('Architecture:', process.arch);
      
      // Build the full URL with platform and version
      const fullUpdateUrl = `${updateUrl}/${process.platform}/${autoUpdater.currentVersion.version}?arch=${process.arch}`;
      
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: fullUpdateUrl
      });
      
      dualLog.info('Full update URL:', fullUpdateUrl);
      
      dualLog.info('Calling checkForUpdates...');
      
      // First make a manual check to see what the server returns
      try {
        const testResult = await this.testUpdateServerConnection();
        dualLog.info('Manual server check result:', {
          statusCode: testResult.statusCode,
          body: testResult.body.substring(0, 200)
        });
        
        if (testResult.statusCode === 404) {
          dualLog.error('Server returned 404 - Update endpoint not found');
        }
      } catch (e) {
        dualLog.error('Manual server check failed:', e.message);
      }
      
      const result = await autoUpdater.checkForUpdates();
      
      dualLog.info('Update check result:', {
        updateAvailable: result?.updateInfo ? true : false,
        version: result?.updateInfo?.version,
        files: result?.updateInfo?.files?.length || 0
      });
      
      return result;
    } catch (error) {
      // The error handler will already process this, just return null
      return null;
    }
  }
  
  async checkForUpdatesAndNotify() {
    dualLog.info('checkForUpdatesAndNotify called');
    const result = await this.checkForUpdates();
    dualLog.info('checkForUpdates returned:', result);
    
    if (!result || !result.updateInfo) {
      // The event handler will have already sent the appropriate notification
      dualLog.info('No update info in result');
    }
    return result;
  }
  
  async startDownload() {
    if (this.isDownloading) {
      dualLog.info('Download already in progress');
      return;
    }
    
    try {
      this.isDownloading = true;
      this.downloadCancellationToken = autoUpdater.downloadUpdate();
      this.sendToRenderer('update-downloading');
      dualLog.info('Started downloading update');
    } catch (error) {
      this.isDownloading = false;
      dualLog.error('Failed to start download:', error);
      throw error;
    }
  }
  
  async cancelDownload() {
    if (!this.isDownloading || !this.downloadCancellationToken) {
      dualLog.info('No download in progress to cancel');
      return false;
    }
    
    try {
      this.downloadCancellationToken.cancel();
      this.isDownloading = false;
      this.downloadCancellationToken = null;
      this.sendToRenderer('update-cancelled');
      dualLog.info('Update download cancelled');
      return true;
    } catch (error) {
      dualLog.error('Failed to cancel download:', error);
      return false;
    }
  }
  
  sendToRenderer(channel, data) {
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, data);
      }
    });
  }
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  calculateETA(progressObj) {
    if (!progressObj.bytesPerSecond || progressObj.bytesPerSecond === 0) {
      return 'Calculating...';
    }
    
    const remaining = progressObj.total - progressObj.transferred;
    const secondsRemaining = remaining / progressObj.bytesPerSecond;
    
    if (secondsRemaining < 60) {
      return `${Math.round(secondsRemaining)}s`;
    } else if (secondsRemaining < 3600) {
      const minutes = Math.floor(secondsRemaining / 60);
      const seconds = Math.round(secondsRemaining % 60);
      return `${minutes}m ${seconds}s`;
    } else {
      const hours = Math.floor(secondsRemaining / 3600);
      const minutes = Math.floor((secondsRemaining % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }
  
  // Get current update info
  getCurrentUpdateInfo() {
    return this.currentUpdateInfo;
  }
  
  // Check if download is in progress
  isDownloadInProgress() {
    return this.isDownloading;
  }
  
  // Method to install and restart
  quitAndInstall(isSilent = false, isForceRunAfter = true) {
    dualLog.info('=== QUIT AND INSTALL CALLED ===');
    dualLog.info('Current update state:', {
      downloaded: autoUpdater.updateInfo ? true : false,
      version: autoUpdater.updateInfo?.version
    });
    
    // For macOS, use setImmediate to avoid race conditions
    if (process.platform === 'darwin') {
      setImmediate(() => {
        const { app } = require('electron');
        app.removeAllListeners("window-all-closed");
        autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
      });
    } else {
      // For Windows/Linux, add a small delay to ensure update is ready
      setTimeout(() => {
        autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
      }, 1000);
    }
  }
  
  // Get current version
  getCurrentVersion() {
    return autoUpdater.currentVersion.version;
  }
  
  // Test connection to update server
  async testUpdateServerConnection() {
    const serverUrl = process.env.UPDATE_SERVER_URL || 'https://codeagentswarm-backend-production.up.railway.app';
    const updateUrl = `${serverUrl}/update`;
    
    dualLog.info('=== TESTING UPDATE SERVER CONNECTION ===');
    dualLog.info('Testing URL:', updateUrl);
    
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url: updateUrl
      });
      
      request.on('response', (response) => {
        dualLog.info('Response status:', response.statusCode);
        dualLog.info('Response headers:', response.headers);
        
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        
        response.on('end', () => {
          dualLog.info('Response body:', data);
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: data
          });
        });
      });
      
      request.on('error', (error) => {
        dualLog.error('Connection error:', error);
        reject(error);
      });
      
      request.end();
    });
  }
  
  // Fetch changelog from backend
  async fetchChangelog(fromVersion, toVersion) {
    const serverUrl = process.env.UPDATE_SERVER_URL || 'https://codeagentswarm-backend-production.up.railway.app';
    const changelogUrl = `${serverUrl}/api/changelog/combined/${fromVersion}/${toVersion}`;
    
    dualLog.info('Fetching changelog from:', changelogUrl);
    
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url: changelogUrl
      });
      
      request.on('response', (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        
        response.on('end', () => {
          try {
            if (response.statusCode === 200) {
              const result = JSON.parse(data);
              resolve(result.changelog);
            } else {
              dualLog.error('Changelog fetch failed:', response.statusCode, data);
              resolve(null);
            }
          } catch (error) {
            dualLog.error('Failed to parse changelog response:', error);
            resolve(null);
          }
        });
      });
      
      request.on('error', (error) => {
        dualLog.error('Changelog fetch error:', error);
        resolve(null);
      });
      
      request.end();
    });
  }
  
  // Fetch version history (last N versions)
  async fetchVersionHistory(limit = 10) {
    const serverUrl = process.env.UPDATE_SERVER_URL || 'https://codeagentswarm-backend-production.up.railway.app';
    const historyUrl = `${serverUrl}/api/changelog?limit=${limit}`;
    
    dualLog.info('Fetching version history from:', historyUrl);
    
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url: historyUrl
      });
      
      request.on('response', (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        
        response.on('end', () => {
          try {
            if (response.statusCode === 200) {
              const result = JSON.parse(data);
              resolve(result);
            } else {
              dualLog.error('Version history fetch failed:', response.statusCode, data);
              reject(new Error(`Failed to fetch version history: ${response.statusCode}`));
            }
          } catch (error) {
            dualLog.error('Failed to parse version history response:', error);
            reject(error);
          }
        });
      });
      
      request.on('error', (error) => {
        dualLog.error('Version history fetch error:', error);
        reject(error);
      });
      
      request.end();
    });
  }
}

module.exports = UpdaterService;
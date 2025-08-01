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
    
    autoUpdater.on('update-available', (info) => {
      dualLog.info('=== UPDATE AVAILABLE EVENT ===');
      dualLog.info('Update version:', info.version);
      dualLog.info('Full update info:', JSON.stringify(info, null, 2));
      this.currentUpdateInfo = info;
      this.sendToRenderer('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
        files: info.files
      });
    });
    
    autoUpdater.on('update-not-available', (info) => {
      dualLog.info('No updates available');
      this.currentUpdateInfo = null;
      this.sendToRenderer('update-not-available', {
        version: info.version
      });
    });
    
    autoUpdater.on('error', (err) => {
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
      dualLog.info('Update downloaded:', info.version);
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
      dualLog.error('=== UPDATE CHECK ERROR ===');
      dualLog.error('Error details:', error);
      dualLog.error('Error message:', error.message);
      dualLog.error('Error stack:', error.stack);
      throw error;
    }
  }
  
  async checkForUpdatesAndNotify() {
    try {
      dualLog.info('checkForUpdatesAndNotify called');
      const result = await this.checkForUpdates();
      dualLog.info('checkForUpdates returned:', result);
      
      if (!result || !result.updateInfo) {
        dualLog.info('No update info in result, sending update-not-available');
        this.sendToRenderer('update-not-available');
      }
      return result;
    } catch (error) {
      dualLog.error('Error in checkForUpdatesAndNotify:', error.message);
      dualLog.error('Full error object:', JSON.stringify(error, null, 2));
      this.sendToRenderer('update-error', error.message);
    }
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
  quitAndInstall(isSilent = false, isForceRunAfter = false) {
    autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
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
}

module.exports = UpdaterService;
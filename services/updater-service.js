const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { dialog } = require('electron');

class UpdaterService {
  constructor() {
    // Configure logs
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';
    
    // Disable auto-download for more control
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      log.info('Checking for updates...');
      this.sendToRenderer('checking-for-update');
    });
    
    autoUpdater.on('update-available', (info) => {
      log.info('Update available:', info.version);
      this.notifyUpdateAvailable(info);
    });
    
    autoUpdater.on('update-not-available', () => {
      log.info('No updates available');
      this.sendToRenderer('update-not-available');
    });
    
    autoUpdater.on('error', (err) => {
      log.error('Update error:', err);
      this.sendToRenderer('update-error', err.message);
    });
    
    autoUpdater.on('download-progress', (progressObj) => {
      const logMessage = `Download: ${Math.round(progressObj.percent)}% - Speed: ${this.formatBytes(progressObj.bytesPerSecond)}/s`;
      log.info(logMessage);
      // Send progress to UI
      this.sendToRenderer('update-progress', progressObj);
    });
    
    autoUpdater.on('update-downloaded', (info) => {
      log.info('Update downloaded:', info.version);
      this.notifyUpdateReady(info);
    });
  }
  
  async checkForUpdates() {
    try {
      // Configure update server URL
      const serverUrl = process.env.UPDATE_SERVER_URL || 'https://codeagentswarm-backend.up.railway.app';
      
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: `${serverUrl}/update`
      });
      
      const result = await autoUpdater.checkForUpdates();
      return result;
    } catch (error) {
      log.error('Error checking for updates:', error);
      throw error;
    }
  }
  
  async checkForUpdatesAndNotify() {
    try {
      const result = await this.checkForUpdates();
      if (!result || !result.updateInfo) {
        this.sendToRenderer('update-not-available');
      }
      return result;
    } catch (error) {
      log.error('Error in checkForUpdatesAndNotify:', error);
      this.sendToRenderer('update-error', error.message);
    }
  }
  
  async notifyUpdateAvailable(info) {
    const response = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `New version ${info.version} is available`,
      detail: `Current version: ${autoUpdater.currentVersion.version}\n\nWould you like to download the update now?`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    
    if (response.response === 0) {
      autoUpdater.downloadUpdate();
      this.sendToRenderer('update-downloading');
    }
  }
  
  async notifyUpdateReady(info) {
    const response = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'Update has been downloaded',
      detail: `Version ${info.version} is ready to install.\n\nWould you like to restart now to apply the update?`,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    
    if (response.response === 0) {
      autoUpdater.quitAndInstall();
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
  
  // Method to force manual download
  async downloadUpdate() {
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      log.error('Error downloading update:', error);
      throw error;
    }
  }
  
  // Method to install and restart
  quitAndInstall() {
    autoUpdater.quitAndInstall();
  }
}

module.exports = UpdaterService;
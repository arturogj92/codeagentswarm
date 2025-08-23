const { BrowserWindow, ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');

// Simple settings storage without electron-store
class SimpleStore {
    constructor() {
        this.path = path.join(app.getPath('userData'), 'wizard-settings.json');
        this.data = this.load();
    }

    load() {
        try {
            return JSON.parse(fs.readFileSync(this.path, 'utf8'));
        } catch (error) {
            return {};
        }
    }

    save() {
        fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    }

    get(key, defaultValue) {
        return this.data[key] !== undefined ? this.data[key] : defaultValue;
    }

    set(key, value) {
        this.data[key] = value;
        this.save();
    }
}

const store = new SimpleStore();

class WizardWindow {
    constructor() {
        this.window = null;
    }

    shouldShowWizard() {
        // Check if wizard has been completed
        return !store.get('wizardCompleted', false);
    }

    create() {
        if (this.window && !this.window.isDestroyed()) {
            this.window.focus();
            return;
        }

        this.window = new BrowserWindow({
            width: 900,
            height: 700,
            minWidth: 800,
            minHeight: 600,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'wizard-preload.js')
            },
            frame: false, // Custom title bar for modern look
            backgroundColor: '#0d0d0d',
            titleBarStyle: 'hiddenInset',
            show: false
        });

        this.window.loadFile('wizard.html');

        this.window.once('ready-to-show', () => {
            this.window.show();
        });

        this.window.on('closed', () => {
            this.window = null;
        });

        // Handle wizard completion
        ipcMain.handle('save-wizard-settings', async (event, settings) => {
            // Save each setting
            if (settings.defaultDirectory) {
                // Prompt for directory selection
                const { dialog } = require('electron');
                const result = await dialog.showOpenDialog(this.window, {
                    properties: ['openDirectory'],
                    title: 'Select Default Working Directory'
                });
                
                if (!result.canceled && result.filePaths.length > 0) {
                    store.set('defaultWorkingDirectory', result.filePaths[0]);
                }
            }

            store.set('autoUpdates', settings.autoUpdates);
            store.set('analytics', settings.analytics);
            store.set('wizardCompleted', true);

            return { success: true };
        });

        ipcMain.handle('close-wizard', () => {
            if (this.window && !this.window.isDestroyed()) {
                this.window.close();
            }
            // Emit event to continue with main app
            require('electron').app.emit('wizard-completed');
        });
    }

    close() {
        if (this.window && !this.window.isDestroyed()) {
            this.window.close();
        }
    }
}

module.exports = WizardWindow;
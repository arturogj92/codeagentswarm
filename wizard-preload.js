const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    saveWizardSettings: (settings) => ipcRenderer.invoke('save-wizard-settings', settings),
    closeWizard: () => ipcRenderer.invoke('close-wizard')
});
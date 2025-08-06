// Componente LogViewer para mostrar logs en la UI
const logger = require('./logger');

class LogViewer {
  constructor() {
    this.container = null;
    this.logList = null;
    this.isVisible = false;
    this.unsubscribe = null;
    this.button = null;
     
    // Check if logger is enabled (already synced from database in renderer.js)
    if (logger.isEnabled()) {
      this.init();
    }
  }

  init() {
    this.createStyles();
    this.createElements();
    this.attachEventListeners();
    this.subscribeToLogs();
    this.listenToIPCLogs();
  }
  
  listenToIPCLogs() {
    // Listen for logs from main process
    if (typeof window !== 'undefined' && window.require) {
      const { ipcRenderer } = window.require('electron');
      
      // Store the handler so we can remove it later
      this.logUpdateHandler = (event, log) => {
        // Check if LogViewer is still initialized
        if (!this.logList) return;
        
        if (log.type === 'clear') {
          this.logList.innerHTML = '';
        } else {
          this.addLogEntry(log);
        }
      };
      
      ipcRenderer.on('log-update', this.logUpdateHandler);
    }
  }

  createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .log-viewer-button {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: #2196F3;
        color: white;
        border: none;
        cursor: pointer;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        transition: transform 0.2s;
      }

      .log-viewer-button:hover {
        transform: scale(1.1);
      }

      .log-viewer-container {
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 600px;
        height: 400px;
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        z-index: 9998;
        display: none;
        flex-direction: column;
        font-family: 'Consolas', 'Monaco', monospace;
      }

      .log-viewer-header {
        padding: 10px;
        background: #2d2d2d;
        border-bottom: 1px solid #444;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-radius: 8px 8px 0 0;
      }

      .log-viewer-title {
        color: #fff;
        font-weight: bold;
        font-size: 14px;
      }

      .log-viewer-controls {
        display: flex;
        gap: 10px;
      }

      .log-viewer-button-small {
        padding: 5px 10px;
        background: #444;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }

      .log-viewer-button-small:hover {
        background: #555;
      }

      .log-viewer-list {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
        background: #1e1e1e;
      }

      .log-entry {
        margin-bottom: 8px;
        font-size: 12px;
        line-height: 1.4;
        word-wrap: break-word;
      }

      .log-entry-timestamp {
        color: #666;
        margin-right: 8px;
      }

      .log-entry-level {
        font-weight: bold;
        margin-right: 8px;
        text-transform: uppercase;
      }

      .log-entry-level.log { color: #888; }
      .log-entry-level.info { color: #2196F3; }
      .log-entry-level.warn { color: #ff9800; }
      .log-entry-level.error { color: #f44336; }
      .log-entry-level.debug { color: #4caf50; }

      .log-entry-message {
        color: #ccc;
        white-space: pre-wrap;
      }
    `;
    document.head.appendChild(style);
  }

  createElements() {
    // Botón flotante
    this.button = document.createElement('button');
    this.button.className = 'log-viewer-button';
    this.button.innerHTML = '📋';
    this.button.title = 'Ver logs';

    // Container principal
    this.container = document.createElement('div');
    this.container.className = 'log-viewer-container';

    // Header
    const header = document.createElement('div');
    header.className = 'log-viewer-header';

    const title = document.createElement('div');
    title.className = 'log-viewer-title';
    title.textContent = 'Logs de la aplicación';

    const controls = document.createElement('div');
    controls.className = 'log-viewer-controls';

    const clearButton = document.createElement('button');
    clearButton.className = 'log-viewer-button-small';
    clearButton.textContent = 'Limpiar';
    clearButton.onclick = () => this.clearLogs();

    const exportButton = document.createElement('button');
    exportButton.className = 'log-viewer-button-small';
    exportButton.textContent = 'Exportar';
    exportButton.onclick = () => this.exportLogs();

    const diagButton = document.createElement('button');
    diagButton.className = 'log-viewer-button-small';
    diagButton.textContent = 'Diagnóstico MCP';
    diagButton.onclick = () => this.runMCPDiagnostic();
    diagButton.style.background = '#ff9800';

    const closeButton = document.createElement('button');
    closeButton.className = 'log-viewer-button-small';
    closeButton.textContent = 'Cerrar';
    closeButton.onclick = () => this.toggle();

    controls.appendChild(clearButton);
    controls.appendChild(exportButton);
    controls.appendChild(diagButton);
    controls.appendChild(closeButton);

    header.appendChild(title);
    header.appendChild(controls);

    // Lista de logs
    this.logList = document.createElement('div');
    this.logList.className = 'log-viewer-list';

    this.container.appendChild(header);
    this.container.appendChild(this.logList);

    document.body.appendChild(this.button);
    document.body.appendChild(this.container);

    // Cargar logs existentes
    this.loadExistingLogs();
  }

  attachEventListeners() {
    this.button.addEventListener('click', () => this.toggle());

    // Permitir arrastrar el contenedor
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    const header = this.container.querySelector('.log-viewer-header');

    header.addEventListener('mousedown', (e) => {
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;

      if (e.target === header || e.target.classList.contains('log-viewer-title')) {
        isDragging = true;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        xOffset = currentX;
        yOffset = currentY;

        this.container.style.transform = `translate(${currentX}px, ${currentY}px)`;
      }
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  subscribeToLogs() {
    // In renderer, we don't subscribe to local logger as logs come via IPC
    // Only subscribe if we're in main process (which shouldn't have LogViewer)
    if (typeof window === 'undefined') {
      this.unsubscribe = logger.subscribe((log) => {
        if (log.type === 'clear') {
          this.logList.innerHTML = '';
        } else {
          this.addLogEntry(log);
        }
      });
    }
  }

  loadExistingLogs() {
    // Don't load from local logger in renderer, wait for IPC
    // Request existing logs from main process
    if (typeof window !== 'undefined' && window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('request-existing-logs');
    }
  }

  addLogEntry(log) {
    // Protect against calls after destroy
    if (!this.logList) return;
    
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const timestamp = new Date(log.timestamp).toLocaleTimeString();
    
    entry.innerHTML = `
      <span class="log-entry-timestamp">${timestamp}</span>
      <span class="log-entry-level ${log.level}">${log.level}</span>
      <span class="log-entry-message">${this.escapeHtml(log.message)}</span>
    `;

    this.logList.appendChild(entry);
    this.logList.scrollTop = this.logList.scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  toggle() {
    this.isVisible = !this.isVisible;
    this.container.style.display = this.isVisible ? 'flex' : 'none';
  }

  clearLogs() {
    if (typeof window !== 'undefined' && window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('clear-logs');
    }
  }

  exportLogs() {
    if (typeof window !== 'undefined' && window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('export-logs');
      
      // Listen for the response
      ipcRenderer.once('export-logs-response', (event, logsText) => {
        const blob = new Blob([logsText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs_${new Date().toISOString().replace(/:/g, '-')}.txt`;
        a.click();
        
        URL.revokeObjectURL(url);
      });
    }
  }

  runMCPDiagnostic() {
    // Send request to main process to run MCP diagnostic
    if (typeof window !== 'undefined' && window.require) {
      const { ipcRenderer } = window.require('electron');
      
      // Add a log entry indicating diagnostic is starting
      this.addLogEntry({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: '=== INICIANDO DIAGNÓSTICO MCP ==='
      });
      
      // Request diagnostic from main process
      ipcRenderer.send('run-mcp-diagnostic');
    }
  }

  setDebugMode(enabled) {
    console.log('LogViewer.setDebugMode called with:', enabled, 'button exists:', !!this.button);
    
    if (enabled && !this.button) {
      // Initialize if not already initialized
      this.init();
    } else if (!enabled && this.button) {
      // Completely remove the button and container
      this.destroy();
    } else if (enabled && this.button) {
      // Show the button
      this.button.style.display = 'flex';
    } else if (!enabled && !this.button) {
      // Button doesn't exist but we're trying to hide - check if button exists in DOM
      const existingButton = document.querySelector('.log-viewer-button');
      if (existingButton) {
        console.log('Found orphan button in DOM, removing it');
        existingButton.remove();
      }
      const existingContainer = document.querySelector('.log-viewer-container');
      if (existingContainer) {
        console.log('Found orphan container in DOM, removing it');
        existingContainer.remove();
      }
    }
  }

  destroy() {
    // Remove IPC listener
    if (this.logUpdateHandler && typeof window !== 'undefined' && window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.removeListener('log-update', this.logUpdateHandler);
      this.logUpdateHandler = null;
    }
    
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.button) {
      this.button.remove();
      this.button = null;
    }
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.logList = null;
    this.isVisible = false;
  }
}

module.exports = LogViewer;
// Sistema centralizado de logging
class Logger {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000; // Límite de logs en memoria
    this.listeners = [];
    this.enabled = process.env.ENABLE_DEBUG_LOGS === 'true' || process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
    this.isMainProcess = !process.send; // Check if this is the main process
    
    // Only intercept console in main/renderer process, not in child processes
    if (this.isMainProcess) {
      this.interceptConsole();
    }
  }

  interceptConsole() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;
    const originalDebug = console.debug;

    console.log = (...args) => {
      this.addLog('log', args);
      originalLog.apply(console, args);
    };

    console.error = (...args) => {
      this.addLog('error', args);
      originalError.apply(console, args);
    };

    console.warn = (...args) => {
      this.addLog('warn', args);
      originalWarn.apply(console, args);
    };

    console.info = (...args) => {
      this.addLog('info', args);
      originalInfo.apply(console, args);
    };

    console.debug = (...args) => {
      this.addLog('debug', args);
      originalDebug.apply(console, args);
    };
  }

  addLog(level, args) {
    if (!this.enabled) return;

    const log = {
      timestamp: new Date().toISOString(),
      level,
      message: args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch (e) {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ')
    };

    // In renderer process, send to main process
    if (typeof window !== 'undefined' && window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('log-message', log);
    } else {
      // In main process, store locally
      this.logs.push(log);

      // Mantener el límite de logs
      if (this.logs.length > this.maxLogs) {
        this.logs.shift();
      }

      // Notificar a los listeners
      this.listeners.forEach(listener => listener(log));
    }
  }

  getLogs() {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
    this.listeners.forEach(listener => listener({ type: 'clear' }));
  }

  exportLogs() {
    const logsText = this.logs.map(log => 
      `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`
    ).join('\n');
    
    return logsText;
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  isEnabled() {
    return this.enabled;
  }
}

// Singleton instance
const logger = new Logger();

module.exports = logger;
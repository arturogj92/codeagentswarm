// Logger wrapper for child processes (MCP server, webhook server, etc.)
const EventEmitter = require('events');

class ChildProcessLogger extends EventEmitter {
  constructor(sourceName) {
    super();
    this.sourceName = sourceName;
    this.enabled = process.env.ENABLE_DEBUG_LOGS === 'true' || process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
    
    // Override console methods for this process
    this.interceptConsole();
  }

  interceptConsole() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;
    const originalDebug = console.debug;

    console.log = (...args) => {
      this.log('log', args);
      originalLog.apply(console, args);
    };

    console.error = (...args) => {
      this.log('error', args);
      originalError.apply(console, args);
    };

    console.warn = (...args) => {
      this.log('warn', args);
      originalWarn.apply(console, args);
    };

    console.info = (...args) => {
      this.log('info', args);
      originalInfo.apply(console, args);
    };

    console.debug = (...args) => {
      this.log('debug', args);
      originalDebug.apply(console, args);
    };
  }

  log(level, args) {
    if (!this.enabled) return;

    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    // Emit log event that parent process can listen to
    this.emit('log', {
      source: this.sourceName,
      level,
      message,
      timestamp: new Date().toISOString()
    });

    // If this is a spawned process with IPC, send to parent
    if (process.send) {
      process.send({
        type: 'log',
        data: {
          source: this.sourceName,
          level,
          message,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
}

module.exports = ChildProcessLogger;
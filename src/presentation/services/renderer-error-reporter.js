const { ipcRenderer } = require('electron');

class RendererErrorReporter {
  constructor() {
    this.breadcrumbs = [];
    this.userContext = null;
    this.globalTags = {};
    
    // Set up global error handlers
    this.setupErrorHandlers();
  }

  /**
   * Set up global error handlers for renderer process
   */
  setupErrorHandlers() {
    // Handle unhandled errors
    window.addEventListener('error', (event) => {
      this.captureException(event.error || new Error(event.message), {
        level: 'error',
        tags: { 
          type: 'window_error',
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        }
      });
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.captureException(event.reason, {
        level: 'error',
        tags: { type: 'unhandled_promise_rejection' }
      });
    });

    // Capture console errors
    const originalConsoleError = console.error;
    console.error = (...args) => {
      originalConsoleError.apply(console, args);
      
      // Don't report certain console errors
      const message = args.join(' ');
      if (message.includes('[Violation]') || 
          message.includes('DevTools') ||
          message.includes('Extension')) {
        return;
      }
      
      this.addBreadcrumb({
        message: `Console error: ${message}`,
        category: 'console',
        level: 'error'
      });
      
      // Report significant console errors
      if (message.includes('Error') || message.includes('Failed')) {
        this.captureMessage(message, 'error', {
          tags: { type: 'console_error' }
        });
      }
    };
  }

  /**
   * Send error to main process
   */
  async sendToMain(type, data) {
    return ipcRenderer.invoke('report-error', {
      type,
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Capture an exception
   */
  async captureException(error, options = {}) {
    const errorData = {
      error: this.serializeError(error),
      level: options.level || 'error',
      tags: { ...this.globalTags, ...(options.tags || {}) },
      context: {
        ...options.context,
        userAgent: navigator.userAgent,
        url: window.location.href,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      },
      user: options.user || this.userContext,
      breadcrumbs: [...this.breadcrumbs, ...(options.breadcrumbs || [])]
    };

    // Clear breadcrumbs after sending
    this.breadcrumbs = [];

    await this.sendToMain('exception', errorData);
  }

  /**
   * Capture a message
   */
  async captureMessage(message, level = 'info', options = {}) {
    const messageData = {
      message,
      level,
      tags: { ...this.globalTags, ...(options.tags || {}) },
      context: options.context || {},
      user: options.user || this.userContext,
      breadcrumbs: [...this.breadcrumbs, ...(options.breadcrumbs || [])]
    };

    await this.sendToMain('message', messageData);
  }

  /**
   * Serialize error for transmission
   */
  serializeError(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }
    
    if (typeof error === 'string') {
      return { message: error };
    }
    
    try {
      return { message: JSON.stringify(error) };
    } catch {
      return { message: String(error) };
    }
  }

  /**
   * Add a breadcrumb
   */
  addBreadcrumb(breadcrumb) {
    this.breadcrumbs.push({
      ...breadcrumb,
      timestamp: Date.now()
    });

    // Keep only last 30 breadcrumbs
    if (this.breadcrumbs.length > 30) {
      this.breadcrumbs.shift();
    }
  }

  /**
   * Set user context
   */
  setUser(user) {
    this.userContext = user;
  }

  /**
   * Set global tags
   */
  setTags(tags) {
    this.globalTags = { ...this.globalTags, ...tags };
  }

  /**
   * Clear context
   */
  clearContext() {
    this.breadcrumbs = [];
    this.userContext = null;
    this.globalTags = {};
  }
}

// Create and export singleton instance
const errorReporter = new RendererErrorReporter();

// Expose to window for debugging
if (process.env.NODE_ENV === 'development') {
  window.errorReporter = errorReporter;
}

module.exports = errorReporter;
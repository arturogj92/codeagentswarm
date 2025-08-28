const crypto = require('crypto');
const fetch = require('node-fetch');
const { app } = require('electron');

class ErrorReporter {
  constructor() {
    this.apiUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    this.appSecret = process.env.APP_SECRET || 'codeagentswarm-secret-2024';
    this.appVersion = app.getVersion();
    this.platform = process.platform;
    // Detect environment - check multiple indicators
    this.environment = this.detectEnvironment();
    this.errorQueue = [];
    this.isOnline = true;
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
    
    // Check online status
    this.checkOnlineStatus();
    
    // Process queue periodically
    setInterval(() => this.processQueue(), 30000); // Every 30 seconds
    
    // Log environment for debugging
    console.log(`[ErrorReporter] Initialized - Environment: ${this.environment}`);
  }

  /**
   * Detect current environment
   */
  detectEnvironment() {
    // Check multiple indicators for development mode
    if (process.env.NODE_ENV === 'development') return 'development';
    if (process.env.ENABLE_DEBUG_LOGS === 'true') return 'development';
    if (process.argv.includes('--dev')) return 'development';
    if (!app.isPackaged) return 'development';
    
    // Check for staging/test
    if (process.env.NODE_ENV === 'staging') return 'staging';
    if (process.env.NODE_ENV === 'test') return 'test';
    
    // Default to production
    return 'production';
  }

  /**
   * Generate signature for request authentication
   */
  generateSignature(timestamp, payload) {
    const data = `${timestamp}:${this.appVersion}:${JSON.stringify(payload)}`;
    return crypto
      .createHmac('sha256', this.appSecret)
      .update(data)
      .digest('hex');
  }

  /**
   * Check if we're online
   */
  async checkOnlineStatus() {
    try {
      const response = await fetch(`${this.apiUrl}/health`, {
        method: 'GET',
        timeout: 5000
      });
      this.isOnline = response.ok;
    } catch (error) {
      this.isOnline = false;
    }
  }

  /**
   * Report an error to the backend
   */
  async reportError(error, options = {}) {
    // Add environment-specific tags
    const environmentTags = {
      environment: this.environment,
      is_dev: this.environment === 'development',
      app_packaged: app.isPackaged,
      debug_mode: process.env.ENABLE_DEBUG_LOGS === 'true',
      ...options.tags
    };
    
    const errorData = {
      error: this.serializeError(error),
      level: options.level || 'error',
      tags: environmentTags,
      context: {
        environment: this.environment,
        version: this.appVersion,
        platform: this.platform,
        arch: process.arch,
        node_version: process.versions.node,
        electron_version: process.versions.electron,
        ...options.context
      },
      user: options.user || { id: this.getAnonymousUserId() },
      breadcrumbs: options.breadcrumbs || [],
      environment: this.environment
    };

    // Add to queue
    this.errorQueue.push({
      data: errorData,
      timestamp: Date.now(),
      retries: 0
    });

    // Try to send immediately if online
    if (this.isOnline) {
      await this.processQueue();
    }
  }

  /**
   * Serialize error object for transmission
   */
  serializeError(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      };
    }
    
    if (typeof error === 'string') {
      return {
        message: error
      };
    }
    
    return {
      message: JSON.stringify(error)
    };
  }

  /**
   * Get anonymous user ID (persistent per installation)
   */
  getAnonymousUserId() {
    const Store = require('electron-store');
    const store = new Store();
    
    let userId = store.get('anonymousUserId');
    if (!userId) {
      userId = crypto.randomBytes(16).toString('hex');
      store.set('anonymousUserId', userId);
    }
    
    return userId;
  }

  /**
   * Process the error queue
   */
  async processQueue() {
    if (this.errorQueue.length === 0) return;
    
    // Check online status first
    await this.checkOnlineStatus();
    if (!this.isOnline) return;
    
    // Process each item in queue
    const itemsToRetry = [];
    
    for (const item of this.errorQueue) {
      const success = await this.sendError(item.data);
      
      if (!success) {
        item.retries++;
        if (item.retries < this.maxRetries) {
          itemsToRetry.push(item);
        } else {
          console.error('[ErrorReporter] Failed to send error after max retries:', item.data.error);
        }
      }
    }
    
    this.errorQueue = itemsToRetry;
  }

  /**
   * Send error to backend
   */
  async sendError(errorData) {
    try {
      const timestamp = Date.now();
      const signature = this.generateSignature(timestamp, errorData);
      
      const response = await fetch(`${this.apiUrl}/api/errors/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Signature': signature,
          'X-Timestamp': timestamp.toString(),
          'X-App-Version': this.appVersion,
          'X-Platform': this.platform
        },
        body: JSON.stringify(errorData),
        timeout: 10000
      });
      
      if (response.ok) {
        console.log('[ErrorReporter] Error sent successfully');
        return true;
      }
      
      if (response.status === 429) {
        // Rate limited, wait longer
        await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute
      }
      
      return false;
    } catch (error) {
      console.error('[ErrorReporter] Failed to send error:', error);
      return false;
    }
  }

  /**
   * Report a message
   */
  async reportMessage(message, level = 'info', options = {}) {
    await this.reportError(message, { ...options, level });
  }

  /**
   * Add breadcrumb
   */
  addBreadcrumb(breadcrumb) {
    // Store breadcrumbs for next error
    if (!this.breadcrumbs) {
      this.breadcrumbs = [];
    }
    
    this.breadcrumbs.push({
      ...breadcrumb,
      timestamp: Date.now()
    });
    
    // Keep only last 50 breadcrumbs
    if (this.breadcrumbs.length > 50) {
      this.breadcrumbs.shift();
    }
  }

  /**
   * Get and clear breadcrumbs
   */
  getBreadcrumbs() {
    const crumbs = this.breadcrumbs || [];
    this.breadcrumbs = [];
    return crumbs;
  }

  /**
   * Set user context
   */
  setUser(user) {
    this.userContext = user;
  }

  /**
   * Set tags
   */
  setTags(tags) {
    this.globalTags = tags;
  }

  /**
   * Capture exception with context
   */
  async captureException(error, options = {}) {
    const enrichedOptions = {
      ...options,
      breadcrumbs: [...(options.breadcrumbs || []), ...this.getBreadcrumbs()],
      tags: { ...this.globalTags, ...(options.tags || {}) },
      user: options.user || this.userContext || { id: this.getAnonymousUserId() }
    };
    
    await this.reportError(error, enrichedOptions);
  }

  /**
   * Capture message with context
   */
  async captureMessage(message, level = 'info', options = {}) {
    await this.reportMessage(message, level, {
      ...options,
      breadcrumbs: [...(options.breadcrumbs || []), ...this.getBreadcrumbs()],
      tags: { ...this.globalTags, ...(options.tags || {}) },
      user: options.user || this.userContext || { id: this.getAnonymousUserId() }
    });
  }
}

// Singleton instance
let instance = null;

module.exports = {
  getInstance() {
    if (!instance) {
      instance = new ErrorReporter();
    }
    return instance;
  },
  ErrorReporter
};
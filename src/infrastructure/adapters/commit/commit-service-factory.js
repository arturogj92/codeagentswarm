const ClaudeCommitAdapter = require('./claude-commit-adapter');
const GenerateCommitUseCase = require('../../../core/application/use-cases/commit/generate-commit-use-case');

/**
 * Factory for creating commit service instances
 * Manages adapter selection and use case creation
 */
class CommitServiceFactory {
    constructor() {
        this.adapters = new Map();
        this.defaultAdapter = null;
        this.logger = console;
    }

    /**
     * Initializes the factory with Claude adapter only
     * @param {Object} config - Configuration options
     * @returns {Promise<void>}
     */
    async initialize(config = {}) {
        const { logger } = config;
        
        if (logger) {
            this.logger = logger;
        }

        // Initialize Claude adapter (the only option now)
        const claudeAdapter = new ClaudeCommitAdapter();
        this.logger.log('[CommitServiceFactory] Checking Claude CLI availability...');
        
        if (await claudeAdapter.isAvailable()) {
            this.adapters.set('claude', claudeAdapter);
            this.defaultAdapter = claudeAdapter;
            this.logger.log('[CommitServiceFactory] Claude adapter initialized successfully');
        } else {
            this.logger.warn('[CommitServiceFactory] Claude CLI not available');
            this.logger.warn('[CommitServiceFactory] Make sure Claude Code is installed and accessible');
            this.logger.warn('[CommitServiceFactory] Try running "claude --version" in terminal to verify');
            throw new Error('Claude CLI is not installed. Please install Claude Code to use commit generation.');
        }

        this.logger.log(`[CommitServiceFactory] Using: ${this.defaultAdapter.getName()}`);
    }

    /**
     * Creates a GenerateCommitUseCase with the specified or default adapter
     * @param {string} adapterName - Optional adapter name to use
     * @returns {GenerateCommitUseCase}
     */
    createUseCase(adapterName = null) {
        let adapter = this.defaultAdapter;
        
        if (adapterName && this.adapters.has(adapterName)) {
            adapter = this.adapters.get(adapterName);
        }
        
        if (!adapter) {
            throw new Error('No commit service adapter available');
        }

        return new GenerateCommitUseCase(adapter, this.logger);
    }

    /**
     * Gets the list of available adapters
     * @returns {Array<string>}
     */
    getAvailableAdapters() {
        return Array.from(this.adapters.keys());
    }

    /**
     * Gets the default adapter name
     * @returns {string|null}
     */
    getDefaultAdapterName() {
        return this.defaultAdapter ? this.defaultAdapter.getName().toLowerCase() : null;
    }

    /**
     * Checks if a specific adapter is available
     * @param {string} adapterName 
     * @returns {boolean}
     */
    hasAdapter(adapterName) {
        return this.adapters.has(adapterName);
    }

    /**
     * Reinitializes the factory (useful when settings change)
     * @param {Object} config 
     * @returns {Promise<void>}
     */
    async reinitialize(config = {}) {
        this.adapters.clear();
        this.defaultAdapter = null;
        await this.initialize(config);
    }
}

// Export singleton instance
module.exports = new CommitServiceFactory();
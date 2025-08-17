/**
 * MCPManager - Manages MCP server configurations
 * Handles CRUD operations for MCP servers with IPC communication
 */
class MCPManager {
    constructor(ipcRenderer = null, validator = null) {
        this.ipcRenderer = ipcRenderer || (typeof window !== 'undefined' ? window.electron?.ipcRenderer : null);
        this.validator = validator || new (require('./MCPValidator'))();
        this.servers = {};
        this.listeners = new Map();
        this.isInitialized = false;
    }

    /**
     * Initialize the manager and load existing servers
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        try {
            await this.loadServers();
            this.isInitialized = true;
            this.emit('initialized', { servers: this.servers });
        } catch (error) {
            console.error('Failed to initialize MCPManager:', error);
            this.emit('error', { error: error.message });
            throw error;
        }
    }

    /**
     * Load MCP servers from configuration file
     * @returns {Promise<object>} MCP servers configuration
     */
    async loadServers() {
        try {
            const config = await this.ipcCall('mcp:load-config');
            
            if (config && config.mcpServers) {
                // Filter out protected servers
                this.servers = this.filterProtectedServers(config.mcpServers);
                this.emit('servers-loaded', { servers: this.servers });
                return this.servers;
            }
            
            this.servers = {};
            return this.servers;
        } catch (error) {
            console.error('Error loading MCP servers:', error);
            this.emit('error', { error: error.message });
            throw error;
        }
    }

    /**
     * Add new MCP server(s) from JSON configuration
     * @param {string} jsonString - JSON configuration string
     * @returns {Promise<{success: boolean, servers?: object, error?: string}>}
     */
    async addServers(jsonString) {
        try {
            // Validate the configuration
            const validation = this.validator.validateNewMCPConfig(jsonString, this.servers);
            
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error
                };
            }

            // Add servers via IPC
            const result = await this.ipcCall('mcp:add-servers', validation.servers);
            
            if (result.success) {
                // Update local cache
                Object.assign(this.servers, validation.servers);
                this.emit('servers-added', { servers: validation.servers });
                
                return {
                    success: true,
                    servers: validation.servers
                };
            }
            
            return {
                success: false,
                error: result.error || 'Failed to add servers'
            };
        } catch (error) {
            console.error('Error adding MCP servers:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Update an existing MCP server
     * @param {string} name - Server name
     * @param {object} config - New configuration
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async updateServer(name, config) {
        try {
            // Check if server exists
            if (!this.servers[name]) {
                return {
                    success: false,
                    error: `Server "${name}" not found`
                };
            }

            // Validate the new configuration
            const validation = this.validator.validateServerConfig(name, config);
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error
                };
            }

            // Update via IPC
            const result = await this.ipcCall('mcp:update-server', { name, config });
            
            if (result.success) {
                // Update local cache
                this.servers[name] = config;
                this.emit('server-updated', { name, config });
                
                return { success: true };
            }
            
            return {
                success: false,
                error: result.error || 'Failed to update server'
            };
        } catch (error) {
            console.error('Error updating MCP server:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Remove an MCP server
     * @param {string} name - Server name to remove
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async removeServer(name) {
        try {
            // Note: Server might exist in disabled state (in backup file)
            // but not in this.servers. We'll let the backend handle the check.
            
            // Check if protected
            if (this.validator.isProtectedServer(name)) {
                return {
                    success: false,
                    error: `Cannot remove protected server "${name}"`
                };
            }

            // Remove via IPC - backend will check both enabled and disabled states
            const result = await this.ipcCall('mcp:remove-server', name);
            
            if (result.success) {
                // Update local cache if server was in our list
                if (this.servers[name]) {
                    delete this.servers[name];
                }
                this.emit('server-removed', { name });
                
                // Reload servers to ensure we have the latest state
                await this.loadServers();
                
                return { success: true };
            }
            
            return {
                success: false,
                error: result.error || 'Failed to remove server'
            };
        } catch (error) {
            console.error('Error removing MCP server:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Toggle server enabled/disabled state
     * @param {string} name - Server name
     * @param {boolean} enabled - New enabled state
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async toggleServer(name, enabled) {
        try {
            if (!this.servers[name]) {
                return {
                    success: false,
                    error: `Server "${name}" not found`
                };
            }

            const result = await this.ipcCall('mcp:toggle-server', { name, enabled });
            
            if (result.success) {
                // After successful toggle, reload servers to get the actual state
                // This is necessary because the main process renames servers with _disabled_ prefix
                console.log(`[MCPManager] Toggle successful, reloading servers to reflect actual state...`);
                await this.loadServers();
                
                this.emit('server-toggled', { name, enabled });
                
                return { success: true };
            }
            
            return {
                success: false,
                error: result.error || 'Failed to toggle server'
            };
        } catch (error) {
            console.error('Error toggling MCP server:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get a specific server configuration
     * @param {string} name - Server name
     * @returns {object|null} Server configuration or null if not found
     */
    getServer(name) {
        return this.servers[name] || null;
    }

    /**
     * Get all servers
     * @returns {object} All MCP servers
     */
    getAllServers() {
        return { ...this.servers };
    }

    /**
     * Get server names
     * @returns {string[]} Array of server names
     */
    getServerNames() {
        return Object.keys(this.servers);
    }

    /**
     * Check if a server exists
     * @param {string} name - Server name
     * @returns {boolean}
     */
    hasServer(name) {
        return name in this.servers;
    }

    /**
     * Filter and process servers from configuration
     * @param {object} servers - MCP servers configuration
     * @returns {object} Processed servers with metadata
     */
    filterProtectedServers(servers) {
        const filtered = {};
        const allServerNames = new Set();
        
        // First pass: collect all server names (including disabled ones)
        for (const name of Object.keys(servers)) {
            if (name.startsWith('_disabled_')) {
                allServerNames.add(name.replace('_disabled_', ''));
            } else {
                allServerNames.add(name);
            }
        }
        
        // Second pass: build list with correct enabled state and protection status
        for (const serverName of allServerNames) {
            const enabledKey = serverName;
            const disabledKey = `_disabled_${serverName}`;
            const isProtected = this.validator.isProtectedServer(serverName);
            
            // Skip protected servers (they should not be included in the filtered list)
            if (isProtected) {
                continue;
            }
            
            if (servers[disabledKey]) {
                // Server is disabled
                filtered[serverName] = {
                    ...servers[disabledKey],
                    metadata: { 
                        ...servers[disabledKey].metadata, 
                        enabled: false,
                        protected: false
                    }
                };
            } else if (servers[enabledKey]) {
                // Server is enabled
                filtered[serverName] = {
                    ...servers[enabledKey],
                    metadata: { 
                        ...servers[enabledKey].metadata, 
                        enabled: true,
                        protected: false
                    }
                };
            }
        }
        
        return filtered;
    }

    /**
     * Get sanitized server configuration for display
     * @param {string} name - Server name
     * @returns {object|null} Sanitized configuration
     */
    getSanitizedServer(name) {
        const server = this.getServer(name);
        if (!server) {
            return null;
        }

        const sanitized = { ...server };
        if (sanitized.env) {
            sanitized.env = this.validator.sanitizeEnvVars(sanitized.env);
        }
        
        return sanitized;
    }

    /**
     * Export current configuration as JSON
     * @returns {string} JSON string of current configuration
     */
    exportConfiguration() {
        return JSON.stringify({
            mcpServers: this.servers
        }, null, 2);
    }

    /**
     * Validate a JSON configuration string
     * @param {string} jsonString - JSON to validate
     * @returns {{valid: boolean, error?: string}}
     */
    validateConfiguration(jsonString) {
        return this.validator.validateNewMCPConfig(jsonString, this.servers);
    }

    /**
     * Make IPC call with error handling
     * @param {string} channel - IPC channel
     * @param {any} data - Data to send
     * @returns {Promise<any>}
     */
    async ipcCall(channel, data) {
        if (!this.ipcRenderer) {
            throw new Error('IPC renderer not available');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('IPC call timeout'));
            }, 10000);

            this.ipcRenderer.once(`${channel}-response`, (event, response) => {
                clearTimeout(timeout);
                resolve(response);
            });

            this.ipcRenderer.send(channel, data);
        });
    }

    /**
     * Event emitter functionality
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        if (!this.listeners.has(event)) {
            return;
        }
        
        const callbacks = this.listeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }

    emit(event, data) {
        if (!this.listeners.has(event)) {
            return;
        }
        
        this.listeners.get(event).forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in event listener for ${event}:`, error);
            }
        });
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.listeners.clear();
        this.servers = {};
        this.isInitialized = false;
    }
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MCPManager;
}
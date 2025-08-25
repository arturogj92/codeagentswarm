/**
 * MCPValidator - Validates MCP server configurations
 * Handles JSON validation, schema checking, and security validation
 */
class MCPValidator {
    constructor() {
        // Protected MCP servers that should never be modified
        this.protectedServers = ['codeagentswarm-tasks', 'codeagentswarm'];
        
        // Required fields for a valid MCP configuration
        this.requiredFields = {
            server: ['command'],
            env: [] // Environment variables are optional
        };
    }

    /**
     * Validates JSON string and returns parsed object
     * @param {string} jsonString - JSON configuration string
     * @returns {{valid: boolean, data?: object, error?: string}}
     */
    validateJSON(jsonString) {
        if (!jsonString || jsonString.trim() === '') {
            return {
                valid: false,
                error: 'Configuration cannot be empty'
            };
        }

        try {
            const data = JSON.parse(jsonString);
            return {
                valid: true,
                data
            };
        } catch (error) {
            return {
                valid: false,
                error: `Invalid JSON: ${error.message}`
            };
        }
    }

    /**
     * Validates MCP server configuration structure
     * @param {object} config - Parsed configuration object
     * @returns {{valid: boolean, servers?: object, error?: string, needsServerName?: boolean}}
     */
    validateMCPStructure(config) {
        // Check if config has direct server configuration (without mcpServers wrapper)
        if (config.command && typeof config.command === 'string') {
            // This is a direct server configuration, needs a server name
            const validation = this.validateServerConfig('temp-validation', config);
            if (!validation.valid) {
                return validation;
            }
            return {
                valid: true,
                servers: config,
                needsServerName: true
            };
        }

        // Check if config has mcpServers key
        if (!config.mcpServers) {
            return {
                valid: false,
                error: 'Configuration must have "mcpServers" key or be a direct server configuration with "command" field'
            };
        }

        // Check if mcpServers is an object
        if (typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
            return {
                valid: false,
                error: '"mcpServers" must be an object'
            };
        }

        // Check if there's at least one server
        const serverNames = Object.keys(config.mcpServers);
        if (serverNames.length === 0) {
            return {
                valid: false,
                error: 'At least one MCP server must be defined'
            };
        }

        // Validate each server configuration
        for (const serverName of serverNames) {
            const serverConfig = config.mcpServers[serverName];
            const validation = this.validateServerConfig(serverName, serverConfig);
            
            if (!validation.valid) {
                return validation;
            }
        }

        return {
            valid: true,
            servers: config.mcpServers
        };
    }

    /**
     * Validates individual server configuration
     * @param {string} name - Server name
     * @param {object} config - Server configuration
     * @returns {{valid: boolean, error?: string}}
     */
    validateServerConfig(name, config) {
        // Check server name
        if (!name || typeof name !== 'string') {
            return {
                valid: false,
                error: 'Server name must be a non-empty string'
            };
        }

        // Check for protected servers
        if (this.isProtectedServer(name)) {
            return {
                valid: false,
                error: `"${name}" is a protected server and cannot be modified`
            };
        }

        // Check if config is an object
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            return {
                valid: false,
                error: `Configuration for "${name}" must be an object`
            };
        }

        // Check required fields
        if (!config.command) {
            return {
                valid: false,
                error: `Server "${name}" must have a "command" field`
            };
        }

        // Validate command
        if (typeof config.command !== 'string' || config.command.trim() === '') {
            return {
                valid: false,
                error: `Server "${name}" command must be a non-empty string`
            };
        }

        // Validate args if present
        if (config.args) {
            if (!Array.isArray(config.args)) {
                return {
                    valid: false,
                    error: `Server "${name}" args must be an array`
                };
            }

            // Check each arg is a string
            for (let i = 0; i < config.args.length; i++) {
                if (typeof config.args[i] !== 'string') {
                    return {
                        valid: false,
                        error: `Server "${name}" args[${i}] must be a string`
                    };
                }
            }
        }

        // Validate env if present
        if (config.env) {
            if (typeof config.env !== 'object' || Array.isArray(config.env)) {
                return {
                    valid: false,
                    error: `Server "${name}" env must be an object`
                };
            }

            // Check each env var is a string
            for (const [key, value] of Object.entries(config.env)) {
                if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
                    return {
                        valid: false,
                        error: `Server "${name}" env.${key} must be a string, number, or boolean`
                    };
                }
            }
        }

        return { valid: true };
    }

    /**
     * Checks if a server name is protected
     * @param {string} name - Server name to check
     * @returns {boolean}
     */
    isProtectedServer(name) {
        return this.protectedServers.includes(name.toLowerCase());
    }

    /**
     * Validates server name for duplicates
     * @param {string} name - Server name to check
     * @param {object} existingServers - Current MCP servers configuration
     * @returns {{valid: boolean, error?: string}}
     */
    validateServerName(name, existingServers = {}) {
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return {
                valid: false,
                error: 'Server name cannot be empty'
            };
        }

        // Check for invalid characters
        if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
            return {
                valid: false,
                error: 'Server name can only contain letters, numbers, hyphens, and underscores'
            };
        }

        // Check if name already exists
        if (existingServers[name]) {
            return {
                valid: false,
                error: `Server "${name}" already exists`
            };
        }

        // Check if protected
        if (this.isProtectedServer(name)) {
            return {
                valid: false,
                error: `"${name}" is a reserved server name`
            };
        }

        return { valid: true };
    }

    /**
     * Sanitizes environment variables to hide sensitive data
     * @param {object} env - Environment variables object
     * @returns {object} Sanitized environment variables
     */
    sanitizeEnvVars(env) {
        if (!env || typeof env !== 'object') {
            return {};
        }

        const sanitized = {};
        const sensitiveKeys = ['key', 'token', 'secret', 'password', 'pwd', 'auth', 'credential'];
        
        for (const [key, value] of Object.entries(env)) {
            const lowerKey = key.toLowerCase();
            const isSensitive = sensitiveKeys.some(sensitive => 
                lowerKey.includes(sensitive)
            );
            
            if (isSensitive && value && typeof value === 'string' && value.length > 4) {
                // Show first 4 chars and mask the rest
                sanitized[key] = value.substring(0, 4) + '*'.repeat(Math.min(value.length - 4, 8));
            } else {
                sanitized[key] = value;
            }
        }
        
        return sanitized;
    }

    /**
     * Full validation pipeline for adding a new MCP server
     * @param {string} jsonString - JSON configuration string
     * @param {object} existingServers - Current MCP servers
     * @returns {{valid: boolean, servers?: object, error?: string, needsServerName?: boolean}}
     */
    validateNewMCPConfig(jsonString, existingServers = {}) {
        // Step 1: Validate JSON
        const jsonValidation = this.validateJSON(jsonString);
        if (!jsonValidation.valid) {
            return jsonValidation;
        }

        // Step 2: Validate MCP structure
        const structureValidation = this.validateMCPStructure(jsonValidation.data);
        if (!structureValidation.valid) {
            return structureValidation;
        }

        // If it's a direct server config, pass through the needsServerName flag
        if (structureValidation.needsServerName) {
            return {
                valid: true,
                servers: structureValidation.servers,
                needsServerName: true
            };
        }

        // Step 3: Check for duplicate names (only for wrapped format)
        const newServers = structureValidation.servers;
        for (const serverName of Object.keys(newServers)) {
            const nameValidation = this.validateServerName(serverName, existingServers);
            if (!nameValidation.valid) {
                return nameValidation;
            }
        }

        return {
            valid: true,
            servers: newServers
        };
    }
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MCPValidator;
}
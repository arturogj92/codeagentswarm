const MCPValidator = require('../../../modules/mcp/MCPValidator');

describe('MCPValidator', () => {
    let validator;

    beforeEach(() => {
        validator = new MCPValidator();
    });

    describe('validateJSON', () => {
        test('should validate valid JSON', () => {
            const json = '{"mcpServers": {"test": {"command": "node"}}}';
            const result = validator.validateJSON(json);
            
            expect(result.valid).toBe(true);
            expect(result.data).toEqual({
                mcpServers: {
                    test: { command: 'node' }
                }
            });
        });

        test('should reject invalid JSON', () => {
            const result = validator.validateJSON('{ invalid json }');
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid JSON');
        });

        test('should reject empty string', () => {
            const result = validator.validateJSON('');
            
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Configuration cannot be empty');
        });

        test('should reject null or undefined', () => {
            const resultNull = validator.validateJSON(null);
            const resultUndefined = validator.validateJSON(undefined);
            
            expect(resultNull.valid).toBe(false);
            expect(resultUndefined.valid).toBe(false);
        });
    });

    describe('validateMCPStructure', () => {
        test('should validate correct MCP structure', () => {
            const config = {
                mcpServers: {
                    test: {
                        command: 'npx',
                        args: ['-y', '@test/package']
                    }
                }
            };
            
            const result = validator.validateMCPStructure(config);
            
            expect(result.valid).toBe(true);
            expect(result.servers).toEqual(config.mcpServers);
        });

        test('should reject missing mcpServers key', () => {
            const result = validator.validateMCPStructure({});
            
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Configuration must have "mcpServers" key');
        });

        test('should reject mcpServers as array', () => {
            const result = validator.validateMCPStructure({
                mcpServers: []
            });
            
            expect(result.valid).toBe(false);
            expect(result.error).toBe('"mcpServers" must be an object');
        });

        test('should reject empty mcpServers', () => {
            const result = validator.validateMCPStructure({
                mcpServers: {}
            });
            
            expect(result.valid).toBe(false);
            expect(result.error).toBe('At least one MCP server must be defined');
        });
    });

    describe('validateServerConfig', () => {
        test('should validate valid server config', () => {
            const config = {
                command: 'node',
                args: ['server.js'],
                env: {
                    API_KEY: 'test-key'
                }
            };
            
            const result = validator.validateServerConfig('test-server', config);
            
            expect(result.valid).toBe(true);
        });

        test('should reject protected server names', () => {
            const config = { command: 'node' };
            const result = validator.validateServerConfig('codeagentswarm-tasks', config);
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('protected server');
        });

        test('should reject missing command', () => {
            const result = validator.validateServerConfig('test', {});
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('must have a "command" field');
        });

        test('should reject empty command', () => {
            const result = validator.validateServerConfig('test', {
                command: '   '
            });
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('command must be a non-empty string');
        });

        test('should reject non-array args', () => {
            const result = validator.validateServerConfig('test', {
                command: 'node',
                args: 'not-an-array'
            });
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('args must be an array');
        });

        test('should reject non-string args elements', () => {
            const result = validator.validateServerConfig('test', {
                command: 'node',
                args: ['valid', 123, 'string']
            });
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('args[1] must be a string');
        });

        test('should reject non-object env', () => {
            const result = validator.validateServerConfig('test', {
                command: 'node',
                env: []
            });
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('env must be an object');
        });

        test('should accept string, number, and boolean env values', () => {
            const result = validator.validateServerConfig('test', {
                command: 'node',
                env: {
                    STRING_VAR: 'value',
                    NUMBER_VAR: 123,
                    BOOL_VAR: true
                }
            });
            
            expect(result.valid).toBe(true);
        });

        test('should reject invalid env value types', () => {
            const result = validator.validateServerConfig('test', {
                command: 'node',
                env: {
                    INVALID: { nested: 'object' }
                }
            });
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('env.INVALID must be a string, number, or boolean');
        });
    });

    describe('isProtectedServer', () => {
        test('should identify protected servers', () => {
            expect(validator.isProtectedServer('codeagentswarm-tasks')).toBe(true);
            expect(validator.isProtectedServer('codeagentswarm')).toBe(true);
            expect(validator.isProtectedServer('CODEAGENTSWARM-TASKS')).toBe(true);
        });

        test('should not flag non-protected servers', () => {
            expect(validator.isProtectedServer('my-server')).toBe(false);
            expect(validator.isProtectedServer('test')).toBe(false);
        });
    });

    describe('validateServerName', () => {
        test('should validate valid server names', () => {
            const result = validator.validateServerName('my-server_123');
            
            expect(result.valid).toBe(true);
        });

        test('should reject empty names', () => {
            const result = validator.validateServerName('');
            
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Server name cannot be empty');
        });

        test('should reject names with invalid characters', () => {
            const result = validator.validateServerName('my server!');
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('can only contain letters, numbers, hyphens, and underscores');
        });

        test('should reject duplicate names', () => {
            const existing = { 'existing-server': {} };
            const result = validator.validateServerName('existing-server', existing);
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('already exists');
        });

        test('should reject protected names', () => {
            const result = validator.validateServerName('codeagentswarm');
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('reserved server name');
        });
    });

    describe('sanitizeEnvVars', () => {
        test('should sanitize sensitive keys', () => {
            const env = {
                API_KEY: 'supersecretkey123',
                TOKEN: 'bearer-token-xyz',
                NORMAL_VAR: 'visible',
                PASSWORD: 'mypassword'
            };
            
            const sanitized = validator.sanitizeEnvVars(env);
            
            expect(sanitized.API_KEY).toBe('supe********');
            expect(sanitized.TOKEN).toBe('bear********');
            expect(sanitized.NORMAL_VAR).toBe('visible');
            expect(sanitized.PASSWORD).toBe('mypa********');
        });

        test('should not sanitize short values', () => {
            const env = {
                KEY: '123',
                TOKEN: 'ab'
            };
            
            const sanitized = validator.sanitizeEnvVars(env);
            
            expect(sanitized.KEY).toBe('123');
            expect(sanitized.TOKEN).toBe('ab');
        });

        test('should handle non-string values', () => {
            const env = {
                NUMBER_KEY: 12345,
                BOOL_KEY: true,
                API_KEY: null
            };
            
            const sanitized = validator.sanitizeEnvVars(env);
            
            expect(sanitized.NUMBER_KEY).toBe(12345);
            expect(sanitized.BOOL_KEY).toBe(true);
            expect(sanitized.API_KEY).toBe(null);
        });

        test('should handle empty or invalid input', () => {
            expect(validator.sanitizeEnvVars(null)).toEqual({});
            expect(validator.sanitizeEnvVars(undefined)).toEqual({});
            expect(validator.sanitizeEnvVars('not-object')).toEqual({});
        });
    });

    describe('validateNewMCPConfig', () => {
        test('should validate complete new MCP configuration', () => {
            const json = JSON.stringify({
                mcpServers: {
                    'new-server': {
                        command: 'npx',
                        args: ['-y', '@package/name'],
                        env: {
                            API_KEY: 'test'
                        }
                    }
                }
            });
            
            const result = validator.validateNewMCPConfig(json, {});
            
            expect(result.valid).toBe(true);
            expect(result.servers).toHaveProperty('new-server');
        });

        test('should reject invalid JSON in pipeline', () => {
            const result = validator.validateNewMCPConfig('invalid', {});
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid JSON');
        });

        test('should reject invalid structure in pipeline', () => {
            const json = JSON.stringify({ wrong: 'structure' });
            const result = validator.validateNewMCPConfig(json, {});
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('must have "mcpServers" key');
        });

        test('should reject duplicate names in pipeline', () => {
            const json = JSON.stringify({
                mcpServers: {
                    'existing': {
                        command: 'node'
                    }
                }
            });
            
            const existing = { 'existing': {} };
            const result = validator.validateNewMCPConfig(json, existing);
            
            expect(result.valid).toBe(false);
            expect(result.error).toContain('already exists');
        });

        test('should handle multiple servers in one config', () => {
            const json = JSON.stringify({
                mcpServers: {
                    'server1': { command: 'node' },
                    'server2': { command: 'npx', args: ['-y', 'package'] }
                }
            });
            
            const result = validator.validateNewMCPConfig(json, {});
            
            expect(result.valid).toBe(true);
            expect(Object.keys(result.servers)).toHaveLength(2);
        });
    });
});
const MCPManager = require('../../../src/modules/mcp/MCPManager');
const MCPValidator = require('../../../src/modules/mcp/MCPValidator');

describe('MCPManager', () => {
    let manager;
    let mockIpcRenderer;
    let mockValidator;

    beforeEach(() => {
        // Mock IPC renderer
        mockIpcRenderer = {
            send: jest.fn(),
            once: jest.fn(),
            on: jest.fn(),
            off: jest.fn()
        };

        // Mock validator
        mockValidator = new MCPValidator();
        jest.spyOn(mockValidator, 'validateNewMCPConfig');
        jest.spyOn(mockValidator, 'validateServerConfig');
        jest.spyOn(mockValidator, 'isProtectedServer');
        jest.spyOn(mockValidator, 'sanitizeEnvVars');

        manager = new MCPManager(mockIpcRenderer, mockValidator);
    });

    afterEach(() => {
        manager.destroy();
        jest.clearAllMocks();
    });

    describe('initialize', () => {
        test('should initialize and load servers', async () => {
            const mockServers = {
                'test-server': { command: 'node' },
                'codeagentswarm-tasks': { command: 'protected' }
            };

            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                if (channel === 'mcp:load-config-response') {
                    callback(null, { mcpServers: mockServers });
                }
            });

            const initListener = jest.fn();
            manager.on('initialized', initListener);

            await manager.initialize();

            expect(manager.isInitialized).toBe(true);
            expect(manager.servers).toHaveProperty('test-server');
            expect(manager.servers).not.toHaveProperty('codeagentswarm-tasks');
            expect(initListener).toHaveBeenCalled();
        });

        test('should not initialize twice', async () => {
            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                callback(null, { mcpServers: {} });
            });

            await manager.initialize();
            const sendCallCount = mockIpcRenderer.send.mock.calls.length;
            
            await manager.initialize();
            
            expect(mockIpcRenderer.send.mock.calls.length).toBe(sendCallCount);
        });

        test('should handle initialization errors', async () => {
            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                throw new Error('IPC error');
            });

            const errorListener = jest.fn();
            manager.on('error', errorListener);

            await expect(manager.initialize()).rejects.toThrow('IPC error');
            expect(errorListener).toHaveBeenCalled();
        });
    });

    describe('loadServers', () => {
        test('should load and filter servers', async () => {
            const mockServers = {
                'server1': { command: 'node' },
                'server2': { command: 'npx' },
                'codeagentswarm': { command: 'protected' }
            };

            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                callback(null, { mcpServers: mockServers });
            });

            mockValidator.isProtectedServer.mockImplementation(name => 
                name === 'codeagentswarm'
            );

            const loadListener = jest.fn();
            manager.on('servers-loaded', loadListener);

            const servers = await manager.loadServers();

            expect(servers).toHaveProperty('server1');
            expect(servers).toHaveProperty('server2');
            expect(servers).not.toHaveProperty('codeagentswarm');
            expect(loadListener).toHaveBeenCalledWith({ servers });
        });

        test('should handle empty configuration', async () => {
            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                callback(null, {});
            });

            const servers = await manager.loadServers();
            
            expect(servers).toEqual({});
            expect(manager.servers).toEqual({});
        });
    });

    describe('addServers', () => {
        test('should add valid servers', async () => {
            const newServers = {
                'new-server': { command: 'node' }
            };
            const jsonString = JSON.stringify({ mcpServers: newServers });

            mockValidator.validateNewMCPConfig.mockReturnValue({
                valid: true,
                servers: newServers
            });

            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                callback(null, { success: true });
            });

            const addListener = jest.fn();
            manager.on('servers-added', addListener);

            const result = await manager.addServers(jsonString);

            expect(result.success).toBe(true);
            expect(result.servers).toEqual(newServers);
            expect(manager.servers).toHaveProperty('new-server');
            expect(addListener).toHaveBeenCalledWith({ servers: newServers });
        });

        test('should reject invalid configuration', async () => {
            mockValidator.validateNewMCPConfig.mockReturnValue({
                valid: false,
                error: 'Invalid config'
            });

            const result = await manager.addServers('invalid');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid config');
            expect(mockIpcRenderer.send).not.toHaveBeenCalled();
        });

        test('should handle IPC errors', async () => {
            mockValidator.validateNewMCPConfig.mockReturnValue({
                valid: true,
                servers: {}
            });

            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                callback(null, { success: false, error: 'IPC failed' });
            });

            const result = await manager.addServers('{}');

            expect(result.success).toBe(false);
            expect(result.error).toBe('IPC failed');
        });
    });

    describe('updateServer', () => {
        beforeEach(() => {
            manager.servers = {
                'existing': { command: 'old' }
            };
        });

        test('should update existing server', async () => {
            const newConfig = { command: 'new' };

            mockValidator.validateServerConfig.mockReturnValue({ valid: true });
            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                callback(null, { success: true });
            });

            const updateListener = jest.fn();
            manager.on('server-updated', updateListener);

            const result = await manager.updateServer('existing', newConfig);

            expect(result.success).toBe(true);
            expect(manager.servers.existing).toEqual(newConfig);
            expect(updateListener).toHaveBeenCalledWith({
                name: 'existing',
                config: newConfig
            });
        });

        test('should reject non-existent server', async () => {
            const result = await manager.updateServer('non-existent', {});

            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });

        test('should reject invalid configuration', async () => {
            mockValidator.validateServerConfig.mockReturnValue({
                valid: false,
                error: 'Invalid config'
            });

            const result = await manager.updateServer('existing', {});

            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid config');
        });
    });

    describe('removeServer', () => {
        beforeEach(() => {
            manager.servers = {
                'removable': { command: 'node' },
                'protected': { command: 'protected' }
            };
        });

        test('should remove existing server', async () => {
            mockValidator.isProtectedServer.mockReturnValue(false);
            let loadCallCount = 0;
            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                loadCallCount++;
                if (loadCallCount === 1) {
                    // First call is the remove request
                    callback(null, { success: true });
                } else {
                    // Second call is the loadServers after removal
                    callback(null, { mcpServers: {} });
                }
            });

            const removeListener = jest.fn();
            manager.on('server-removed', removeListener);

            const result = await manager.removeServer('removable');

            expect(result.success).toBe(true);
            expect(manager.servers).not.toHaveProperty('removable');
            expect(removeListener).toHaveBeenCalledWith({ name: 'removable' });
        });

        test('should remove disabled server not in local cache', async () => {
            // Server is disabled, so not in local cache
            delete manager.servers['removable'];
            
            mockValidator.isProtectedServer.mockReturnValue(false);
            let loadCallCount = 0;
            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                loadCallCount++;
                if (loadCallCount === 1) {
                    // First call is the remove request - backend handles it
                    callback(null, { success: true });
                } else {
                    // Second call is the loadServers after removal
                    callback(null, { mcpServers: {} });
                }
            });

            const removeListener = jest.fn();
            manager.on('server-removed', removeListener);

            const result = await manager.removeServer('removable');

            expect(result.success).toBe(true);
            expect(removeListener).toHaveBeenCalledWith({ name: 'removable' });
            expect(mockIpcRenderer.send).toHaveBeenCalledWith('mcp:remove-server', 'removable');
        });

        test('should handle backend rejection for non-existent server', async () => {
            // Server not in cache, backend will check
            delete manager.servers['non-existent'];
            
            mockValidator.isProtectedServer.mockReturnValue(false);
            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                callback(null, { success: false, error: 'Server "non-existent" not found' });
            });

            const result = await manager.removeServer('non-existent');

            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });

        test('should reject protected server', async () => {
            mockValidator.isProtectedServer.mockReturnValue(true);

            const result = await manager.removeServer('protected');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Cannot remove protected server');
        });

        test('should reload servers after successful removal', async () => {
            mockValidator.isProtectedServer.mockReturnValue(false);
            
            let callCount = 0;
            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                callCount++;
                if (callCount === 1) {
                    // Remove request
                    callback(null, { success: true });
                } else if (callCount === 2) {
                    // loadServers call after removal
                    callback(null, { 
                        mcpServers: {
                            'other-server': { command: 'npx' }
                        }
                    });
                }
            });

            await manager.removeServer('removable');

            // Check that loadServers was called (2 IPC calls total)
            expect(mockIpcRenderer.send).toHaveBeenCalledTimes(2);
            expect(mockIpcRenderer.send).toHaveBeenNthCalledWith(1, 'mcp:remove-server', 'removable');
            expect(mockIpcRenderer.send).toHaveBeenNthCalledWith(2, 'mcp:load-config', undefined);
        });
    });

    describe('toggleServer', () => {
        beforeEach(() => {
            manager.servers = {
                'toggleable': { command: 'node' }
            };
        });

        test('should toggle server state', async () => {
            let callCount = 0;
            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                callCount++;
                if (callCount === 1) {
                    // First call is the toggle request
                    callback(null, { success: true });
                } else {
                    // Second call is the loadServers after toggle
                    callback(null, { 
                        mcpServers: {
                            '_disabled_toggleable': { command: 'node' }
                        }
                    });
                }
            });

            const toggleListener = jest.fn();
            manager.on('server-toggled', toggleListener);

            const result = await manager.toggleServer('toggleable', false);

            expect(result.success).toBe(true);
            expect(manager.servers.toggleable).toBeDefined();
            expect(manager.servers.toggleable.metadata.enabled).toBe(false);
            expect(toggleListener).toHaveBeenCalledWith({
                name: 'toggleable',
                enabled: false
            });
        });

        test('should reject non-existent server', async () => {
            const result = await manager.toggleServer('non-existent', true);

            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });
    });

    describe('utility methods', () => {
        beforeEach(() => {
            manager.servers = {
                'server1': { command: 'node', env: { API_KEY: 'secret' } },
                'server2': { command: 'npx' }
            };
        });

        test('getServer should return server config', () => {
            expect(manager.getServer('server1')).toEqual(manager.servers.server1);
            expect(manager.getServer('non-existent')).toBeNull();
        });

        test('getAllServers should return all servers', () => {
            const servers = manager.getAllServers();
            expect(servers).toEqual(manager.servers);
            expect(servers).not.toBe(manager.servers); // Should be a copy
        });

        test('getServerNames should return server names', () => {
            expect(manager.getServerNames()).toEqual(['server1', 'server2']);
        });

        test('hasServer should check existence', () => {
            expect(manager.hasServer('server1')).toBe(true);
            expect(manager.hasServer('non-existent')).toBe(false);
        });

        test('getSanitizedServer should sanitize env vars', () => {
            mockValidator.sanitizeEnvVars.mockReturnValue({ API_KEY: 'sec***' });
            
            const sanitized = manager.getSanitizedServer('server1');
            
            expect(sanitized.env).toEqual({ API_KEY: 'sec***' });
            expect(mockValidator.sanitizeEnvVars).toHaveBeenCalledWith({ API_KEY: 'secret' });
        });

        test('exportConfiguration should return JSON', () => {
            const json = manager.exportConfiguration();
            const parsed = JSON.parse(json);
            
            expect(parsed.mcpServers).toEqual(manager.servers);
        });
    });

    describe('event emitter', () => {
        test('should handle event listeners', () => {
            const listener1 = jest.fn();
            const listener2 = jest.fn();

            manager.on('test-event', listener1);
            manager.on('test-event', listener2);

            manager.emit('test-event', { data: 'test' });

            expect(listener1).toHaveBeenCalledWith({ data: 'test' });
            expect(listener2).toHaveBeenCalledWith({ data: 'test' });
        });

        test('should remove event listeners', () => {
            const listener = jest.fn();

            manager.on('test-event', listener);
            manager.off('test-event', listener);

            manager.emit('test-event', {});

            expect(listener).not.toHaveBeenCalled();
        });

        test('should handle listener errors gracefully', () => {
            const errorListener = jest.fn(() => {
                throw new Error('Listener error');
            });
            const goodListener = jest.fn();

            manager.on('test-event', errorListener);
            manager.on('test-event', goodListener);

            expect(() => manager.emit('test-event', {})).not.toThrow();
            expect(goodListener).toHaveBeenCalled();
        });
    });

    describe('ipcCall', () => {
        test('should handle successful IPC calls', async () => {
            mockIpcRenderer.once.mockImplementation((channel, callback) => {
                setTimeout(() => callback(null, { result: 'success' }), 10);
            });

            const result = await manager.ipcCall('test-channel', { data: 'test' });
            
            expect(result).toEqual({ result: 'success' });
        });

        test('should handle IPC timeout', async () => {
            mockIpcRenderer.once.mockImplementation(() => {
                // Never call the callback
            });

            jest.useFakeTimers();
            const promise = manager.ipcCall('test-channel', {});
            jest.advanceTimersByTime(10001);
            
            await expect(promise).rejects.toThrow('IPC call timeout');
            jest.useRealTimers();
        });

        test('should throw when IPC renderer not available', async () => {
            manager.ipcRenderer = null;
            
            await expect(manager.ipcCall('test', {})).rejects.toThrow('IPC renderer not available');
        });
    });
});
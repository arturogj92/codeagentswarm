/**
 * Tests for hooks-manager.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock modules
jest.mock('fs');
jest.mock('os');

// Import after mocks
const HooksManager = require('../src/infrastructure/hooks/hooks-manager');

describe('HooksManager', () => {
    let hooksManager;
    let originalConsoleError;
    let originalConsoleLog;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Mock console methods
        originalConsoleError = console.error;
        originalConsoleLog = console.log;
        console.error = jest.fn();
        console.log = jest.fn();
        
        // Mock os.homedir
        os.homedir = jest.fn().mockReturnValue('/home/test');
        
        // Create new instance
        hooksManager = new HooksManager();
    });

    afterEach(() => {
        // Restore console methods
        console.error = originalConsoleError;
        console.log = originalConsoleLog;
    });

    describe('constructor', () => {
        test('should initialize with correct settings path', () => {
            expect(hooksManager.settingsPath).toBe('/home/test/.claude/settings.json');
        });

        test('should set webhook port', () => {
            expect(hooksManager.webhookPort).toBe(45782);
        });

        test('should define CodeAgentSwarm hooks', () => {
            expect(hooksManager.codeAgentSwarmHooks).toBeDefined();
            expect(hooksManager.codeAgentSwarmHooks.Notification).toBeDefined();
            expect(hooksManager.codeAgentSwarmHooks.Stop).toBeDefined();
        });

        test('should define CodeAgentSwarm MCP permissions', () => {
            expect(hooksManager.codeAgentSwarmMCPPermissions).toBeDefined();
            expect(Array.isArray(hooksManager.codeAgentSwarmMCPPermissions)).toBe(true);
            expect(hooksManager.codeAgentSwarmMCPPermissions).toContain('mcp__codeagentswarm-tasks__*');
            expect(hooksManager.codeAgentSwarmMCPPermissions).toContain('mcp__codeagentswarm-tasks__create_task');
        });
    });

    describe('buildHookCommand', () => {
        test('should build confirmation_needed command with tool', () => {
            const command = hooksManager.buildHookCommand('confirmation_needed', 'test_tool');
            
            expect(command).toContain('curl -X POST');
            expect(command).toContain(`http://localhost:${hooksManager.webhookPort}/webhook`);
            expect(command).toContain('confirmation_needed');
            expect(command).toContain('test_tool');
            expect(command).toContain('CODEAGENTSWARM_CURRENT_QUADRANT');
        });

        test('should build claude_finished command without tool', () => {
            const command = hooksManager.buildHookCommand('claude_finished');
            
            expect(command).toContain('curl -X POST');
            expect(command).toContain(`http://localhost:${hooksManager.webhookPort}/webhook`);
            expect(command).toContain('claude_finished');
            expect(command).toContain('CODEAGENTSWARM_CURRENT_QUADRANT');
            expect(command).not.toContain('tool');
        });

        test('should handle different event types', () => {
            const command = hooksManager.buildHookCommand('custom_event');
            
            expect(command).toContain('custom_event');
            expect(command).toContain('sh -c');
        });
    });

    describe('ensureSettingsDirectory', () => {
        test('should create directory if it does not exist', async () => {
            fs.existsSync = jest.fn().mockReturnValue(false);
            fs.mkdirSync = jest.fn();
            
            await hooksManager.ensureSettingsDirectory();
            
            expect(fs.mkdirSync).toHaveBeenCalledWith(
                path.dirname(hooksManager.settingsPath),
                { recursive: true }
            );
        });

        test('should not create directory if it exists', async () => {
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            
            await hooksManager.ensureSettingsDirectory();
            
            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });
    });

    describe('readSettings', () => {
        test('should return empty object if settings file does not exist', async () => {
            fs.existsSync = jest.fn().mockReturnValue(false);
            
            const settings = await hooksManager.readSettings();
            
            expect(settings).toEqual({});
        });

        test('should read and parse settings file', async () => {
            const mockSettings = {
                hooks: {
                    Stop: [],
                    Notification: []
                }
            };
            
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(mockSettings));
            
            const settings = await hooksManager.readSettings();
            
            expect(settings).toEqual(mockSettings);
            expect(fs.readFileSync).toHaveBeenCalledWith(hooksManager.settingsPath, 'utf8');
        });

        test('should handle JSON parse errors', async () => {
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue('invalid json');
            
            const settings = await hooksManager.readSettings();
            
            expect(settings).toEqual({});
            expect(console.error).toHaveBeenCalled();
        });

        test('should handle file read errors', async () => {
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockImplementation(() => {
                throw new Error('File read error');
            });
            
            const settings = await hooksManager.readSettings();
            
            expect(settings).toEqual({});
            expect(console.error).toHaveBeenCalledWith('Error reading settings:', expect.any(Error));
        });
    });

    describe('writeSettings', () => {
        test('should write settings to file', async () => {
            const mockSettings = {
                hooks: {
                    Stop: [],
                    Notification: []
                }
            };
            
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.writeFileSync = jest.fn();
            
            const result = await hooksManager.writeSettings(mockSettings);
            
            expect(result).toBe(true);
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                hooksManager.settingsPath,
                JSON.stringify(mockSettings, null, 2),
                'utf8'
            );
        });

        test('should handle write errors', async () => {
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.writeFileSync = jest.fn().mockImplementation(() => {
                throw new Error('Write error');
            });
            
            const result = await hooksManager.writeSettings({});
            
            expect(result).toBe(false);
            expect(console.error).toHaveBeenCalledWith('Error writing settings:', expect.any(Error));
        });

        test('should ensure directory exists before writing', async () => {
            fs.existsSync = jest.fn().mockReturnValue(false);
            fs.mkdirSync = jest.fn();
            fs.writeFileSync = jest.fn();
            
            await hooksManager.writeSettings({});
            
            expect(fs.mkdirSync).toHaveBeenCalled();
        });
    });

    describe('hook command structure', () => {
        test('should include silent and fail flags', () => {
            const command = hooksManager.buildHookCommand('test_event');
            
            expect(command).toContain('--silent');
            expect(command).toContain('--fail');
            expect(command).toContain('2>/dev/null');
            expect(command).toContain('|| true');
        });

        test('should use proper JSON escaping', () => {
            const command = hooksManager.buildHookCommand('test_event');
            
            expect(command).toContain('\\"type\\"');
            expect(command).toContain('\\"terminalId\\"');
        });

        test('should use echo for variable evaluation', () => {
            const command = hooksManager.buildHookCommand('test_event');
            
            expect(command).toContain('$(echo ${CODEAGENTSWARM_CURRENT_QUADRANT:-0})');
        });
    });

    describe('MCP permissions', () => {
        test('should include all necessary task permissions', () => {
            const permissions = hooksManager.codeAgentSwarmMCPPermissions;
            
            expect(permissions).toContain('mcp__codeagentswarm-tasks__create_task');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__start_task');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__complete_task');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__list_tasks');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__update_task_plan');
        });

        test('should include project management permissions', () => {
            const permissions = hooksManager.codeAgentSwarmMCPPermissions;
            
            expect(permissions).toContain('mcp__codeagentswarm-tasks__create_project');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__get_projects');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__get_project_tasks');
        });

        test('should include subtask permissions', () => {
            const permissions = hooksManager.codeAgentSwarmMCPPermissions;
            
            expect(permissions).toContain('mcp__codeagentswarm-tasks__create_subtask');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__get_subtasks');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__link_task_to_parent');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__unlink_task_from_parent');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__get_task_hierarchy');
        });

        test('should include wildcard permission', () => {
            const permissions = hooksManager.codeAgentSwarmMCPPermissions;
            
            expect(permissions[0]).toBe('mcp__codeagentswarm-tasks__*');
        });
    });

    describe('installHooks', () => {
        test('should install hooks successfully', async () => {
            const existingSettings = { other: 'data' };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(existingSettings));
            fs.writeFileSync = jest.fn();

            const result = await hooksManager.installHooks();

            expect(result).toEqual({ success: true });
            
            // Verify the hooks were merged correctly
            const writtenSettings = JSON.parse(
                fs.writeFileSync.mock.calls[0][1]
            );
            expect(writtenSettings).toHaveProperty('hooks');
            expect(writtenSettings.hooks).toHaveProperty('Notification');
            expect(writtenSettings.hooks).toHaveProperty('Stop');
            expect(writtenSettings).toHaveProperty('other', 'data');
        });

        test('should merge with existing hooks', async () => {
            const existingSettings = { 
                hooks: { 
                    ExistingHook: [{ test: 'data' }] 
                } 
            };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(existingSettings));
            fs.writeFileSync = jest.fn();

            await hooksManager.installHooks();

            const writtenSettings = JSON.parse(
                fs.writeFileSync.mock.calls[0][1]
            );
            expect(writtenSettings.hooks).toHaveProperty('ExistingHook');
            expect(writtenSettings.hooks).toHaveProperty('Notification');
            expect(writtenSettings.hooks).toHaveProperty('Stop');
        });

        test('should handle write failure', async () => {
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue('{}');
            fs.writeFileSync = jest.fn().mockImplementation(() => {
                throw new Error('Write failed');
            });

            const result = await hooksManager.installHooks();

            expect(result).toEqual({ 
                success: false, 
                error: 'Failed to write settings' 
            });
        });

        test('should handle read errors', async () => {
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockImplementation(() => {
                throw new Error('Read failed');
            });

            const result = await hooksManager.installHooks();

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('removeHooks', () => {
        test('should remove hooks successfully', async () => {
            const settings = {
                hooks: {
                    Notification: [{ test: 'data' }],
                    Stop: [{ test: 'data' }],
                    OtherHook: [{ test: 'data' }]
                }
            };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));
            fs.writeFileSync = jest.fn();

            const result = await hooksManager.removeHooks();

            expect(result).toEqual({ success: true });
            
            const writtenSettings = JSON.parse(
                fs.writeFileSync.mock.calls[0][1]
            );
            expect(writtenSettings.hooks).not.toHaveProperty('Notification');
            expect(writtenSettings.hooks).not.toHaveProperty('Stop');
            expect(writtenSettings.hooks).toHaveProperty('OtherHook');
        });

        test('should remove empty hooks object', async () => {
            const settings = {
                hooks: {
                    Notification: [{ test: 'data' }],
                    Stop: [{ test: 'data' }]
                },
                other: 'data'
            };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));
            fs.writeFileSync = jest.fn();

            await hooksManager.removeHooks();

            const writtenSettings = JSON.parse(
                fs.writeFileSync.mock.calls[0][1]
            );
            expect(writtenSettings).not.toHaveProperty('hooks');
            expect(writtenSettings).toHaveProperty('other', 'data');
        });

        test('should handle missing hooks gracefully', async () => {
            const settings = { other: 'data' };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));

            const result = await hooksManager.removeHooks();

            expect(result).toEqual({ success: true });
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });

        test('should handle write failure', async () => {
            const settings = { hooks: { Notification: [] } };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));
            fs.writeFileSync = jest.fn().mockImplementation(() => {
                throw new Error('Write failed');
            });

            const result = await hooksManager.removeHooks();

            expect(result).toEqual({ 
                success: false, 
                error: 'Failed to write settings' 
            });
        });
    });

    describe('checkHooksStatus', () => {
        test('should detect installed hooks correctly', async () => {
            const settings = {
                hooks: {
                    Notification: [{
                        hooks: [{
                            command: 'sh -c \'curl confirmation_needed\' command here'
                        }]
                    }],
                    Stop: [{
                        hooks: [{
                            command: 'sh -c \'curl claude_finished\' command here'
                        }]
                    }]
                }
            };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));

            const status = await hooksManager.checkHooksStatus();

            expect(status.installed).toBe(true);
            expect(status.notificationHook).toBe(true);
            expect(status.stopHook).toBe(true);
            expect(status.settingsPath).toBe(hooksManager.settingsPath);
            expect(status.hooks).toEqual(settings.hooks);
        });

        test('should detect missing notification hook', async () => {
            const settings = {
                hooks: {
                    Stop: [{
                        hooks: [{
                            command: 'sh -c \'curl claude_finished\' command here'
                        }]
                    }]
                }
            };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));

            const status = await hooksManager.checkHooksStatus();

            expect(status.installed).toBe(false);
            expect(status.notificationHook).toBe(false);
            expect(status.stopHook).toBe(true);
        });

        test('should detect missing stop hook', async () => {
            const settings = {
                hooks: {
                    Notification: [{
                        hooks: [{
                            command: 'sh -c \'curl confirmation_needed\' command here'
                        }]
                    }]
                }
            };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));

            const status = await hooksManager.checkHooksStatus();

            expect(status.installed).toBe(false);
            expect(status.notificationHook).toBe(true);
            expect(status.stopHook).toBe(false);
        });

        test('should handle missing hooks object', async () => {
            const settings = {};
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));

            const status = await hooksManager.checkHooksStatus();

            expect(status.installed).toBe(false);
            expect(status.notificationHook).toBe(false);
            expect(status.stopHook).toBe(false);
            expect(status.hooks).toEqual({});
        });

        test('should handle read errors', async () => {
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockImplementation(() => {
                throw new Error('Read error');
            });

            const status = await hooksManager.checkHooksStatus();

            // When readSettings throws, it returns {} so checkHooksStatus continues normally
            expect(status.installed).toBe(false);
            expect(status.notificationHook).toBe(false);
            expect(status.stopHook).toBe(false);
            expect(status.hooks).toEqual({});
        });
    });

    describe('configureMCPPermissions', () => {
        test('should add permissions to empty settings', async () => {
            const settings = {};
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));
            fs.writeFileSync = jest.fn();

            const result = await hooksManager.configureMCPPermissions();

            expect(result.success).toBe(true);
            expect(result.permissionsAdded).toBe(20);
            
            const writtenSettings = JSON.parse(
                fs.writeFileSync.mock.calls[0][1]
            );
            expect(writtenSettings.permissions.allow).toEqual(
                hooksManager.codeAgentSwarmMCPPermissions
            );
        });

        test('should merge with existing permissions', async () => {
            const settings = {
                permissions: {
                    allow: ['existing_permission'],
                    deny: [],
                    ask: []
                }
            };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));
            fs.writeFileSync = jest.fn();

            await hooksManager.configureMCPPermissions();

            const writtenSettings = JSON.parse(
                fs.writeFileSync.mock.calls[0][1]
            );
            expect(writtenSettings.permissions.allow).toContain('existing_permission');
            expect(writtenSettings.permissions.allow).toContain('mcp__codeagentswarm-tasks__*');
        });

        test('should avoid duplicate permissions', async () => {
            const settings = {
                permissions: {
                    allow: ['mcp__codeagentswarm-tasks__*', 'mcp__codeagentswarm-tasks__create_task'],
                    deny: [],
                    ask: []
                }
            };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));
            fs.writeFileSync = jest.fn();

            await hooksManager.configureMCPPermissions();

            const writtenSettings = JSON.parse(
                fs.writeFileSync.mock.calls[0][1]
            );
            const duplicates = writtenSettings.permissions.allow.filter(
                (item, index) => writtenSettings.permissions.allow.indexOf(item) !== index
            );
            expect(duplicates).toEqual([]);
        });

        test('should handle write failure', async () => {
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.readFileSync = jest.fn().mockReturnValue('{}');
            fs.writeFileSync = jest.fn().mockImplementation(() => {
                throw new Error('Write failed');
            });

            const result = await hooksManager.configureMCPPermissions();

            expect(result.success).toBe(false);
            expect(result.error).toBe('Failed to write settings');
        });
    });

    describe('checkMCPPermissionsStatus', () => {
        test('should detect all permissions installed', async () => {
            const settings = {
                permissions: {
                    allow: [...hooksManager.codeAgentSwarmMCPPermissions]
                }
            };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));

            const status = await hooksManager.checkMCPPermissionsStatus();

            expect(status.allInstalled).toBe(true);
            expect(status.installedCount).toBe(20);
            expect(status.totalRequired).toBe(20);
            expect(status.missingPermissions).toEqual([]);
        });

        test('should detect missing permissions', async () => {
            const settings = {
                permissions: {
                    allow: ['mcp__codeagentswarm-tasks__*']
                }
            };
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));

            const status = await hooksManager.checkMCPPermissionsStatus();

            expect(status.allInstalled).toBe(false);
            expect(status.installedCount).toBe(1);
            expect(status.totalRequired).toBe(20);
            expect(status.missingPermissions.length).toBe(19);
        });

        test('should handle missing permissions object', async () => {
            const settings = {};
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(settings));

            const status = await hooksManager.checkMCPPermissionsStatus();

            expect(status.allInstalled).toBe(false);
            expect(status.installedCount).toBe(0);
            expect(status.totalRequired).toBe(20);
            expect(status.missingPermissions.length).toBe(20);
        });

        test('should handle read errors', async () => {
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockImplementation(() => {
                throw new Error('Read error');
            });

            const status = await hooksManager.checkMCPPermissionsStatus();

            // When readSettings throws, it returns {} so checkMCPPermissionsStatus continues normally
            expect(status.allInstalled).toBe(false);
            expect(status.installedCount).toBe(0);
            expect(status.totalRequired).toBe(20);
            expect(status.missingPermissions.length).toBe(20);
        });
    });

    describe('ensureFullConfiguration', () => {
        test('should successfully configure both hooks and permissions', async () => {
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockReturnValue('{}');
            fs.writeFileSync = jest.fn();

            const result = await hooksManager.ensureFullConfiguration();

            expect(result.success).toBe(true);
            expect(result.hooks.success).toBe(true);
            expect(result.mcp.success).toBe(true);
        });

        test('should report partial success when hooks fail', async () => {
            // Setup so hooks fail on write
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            
            fs.readFileSync = jest.fn().mockReturnValue('{}');
            
            // First write for hooks will fail, second for MCP will succeed
            fs.writeFileSync = jest.fn()
                .mockImplementationOnce(() => {
                    throw new Error('Hooks write error');
                })
                .mockImplementationOnce(() => {}); // MCP write succeeds

            const result = await hooksManager.ensureFullConfiguration();

            expect(result.success).toBe(false);
            expect(result.hooks.success).toBe(false);
            expect(result.mcp.success).toBe(true);
            expect(console.error).toHaveBeenCalledWith('Failed to install hooks:', expect.any(String));
        });

        test('should report partial success when MCP fails', async () => {
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            
            // First call for hooks will succeed
            fs.readFileSync = jest.fn()
                .mockReturnValueOnce('{}')
                // Second read for MCP
                .mockReturnValueOnce('{}');
                
            fs.writeFileSync = jest.fn()
                .mockImplementationOnce(() => {}) // hooks write succeeds
                // Second write for MCP will fail
                .mockImplementationOnce(() => {
                    throw new Error('MCP write error');
                });

            const result = await hooksManager.ensureFullConfiguration();

            expect(result.success).toBe(false);
            expect(result.hooks.success).toBe(true);
            expect(result.mcp.success).toBe(false);
            expect(console.error).toHaveBeenCalledWith('Failed to configure MCP permissions:', expect.any(String));
        });

        test('should handle complete failure gracefully', async () => {
            // Both hooks and MCP will fail
            fs.existsSync = jest.fn().mockReturnValue(true);
            fs.mkdirSync = jest.fn();
            fs.readFileSync = jest.fn().mockReturnValue('{}');
            
            // Both writes will fail
            fs.writeFileSync = jest.fn()
                .mockImplementation(() => {
                    throw new Error('Write failure');
                });

            const result = await hooksManager.ensureFullConfiguration();

            expect(result.success).toBe(false);
            expect(result.hooks.success).toBe(false);
            expect(result.mcp.success).toBe(false);
            expect(console.error).toHaveBeenCalledWith('Failed to install hooks:', expect.any(String));
            expect(console.error).toHaveBeenCalledWith('Failed to configure MCP permissions:', expect.any(String));
        });
    });
});
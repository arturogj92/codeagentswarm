const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock modules before requiring
jest.mock('fs');
jest.mock('os');

describe('HooksManager - MCP Configuration', () => {
    let HooksManager;
    let hooksManager;
    let mockSettingsPath;
    let mockSettings;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Setup mock settings path
        mockSettingsPath = '/mock/home/.claude/settings.json';
        os.homedir.mockReturnValue('/mock/home');
        
        // Setup default mock settings
        mockSettings = {};
        
        // Mock fs methods
        fs.existsSync.mockImplementation((path) => {
            return path === mockSettingsPath || path === '/mock/home/.claude';
        });
        
        fs.readFileSync.mockImplementation(() => {
            return JSON.stringify(mockSettings);
        });
        
        fs.writeFileSync.mockImplementation((path, content) => {
            if (path === mockSettingsPath) {
                mockSettings = JSON.parse(content);
            }
        });
        
        fs.mkdirSync.mockImplementation(() => {});
        
        // Require HooksManager after mocks are set up
        jest.isolateModules(() => {
            HooksManager = require('../hooks-manager');
        });
        
        hooksManager = new HooksManager();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('configureMCPPermissions', () => {
        test('should add all MCP permissions to empty settings', async () => {
            mockSettings = {};
            
            const result = await hooksManager.configureMCPPermissions();
            
            expect(result.success).toBe(true);
            expect(result.permissionsAdded).toBe(20);
            
            // Verify writeFileSync was called with correct permissions
            expect(fs.writeFileSync).toHaveBeenCalled();
            const writtenSettings = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
            expect(writtenSettings.permissions).toBeDefined();
            expect(writtenSettings.permissions.allow).toContain('mcp__codeagentswarm-tasks__*');
            expect(writtenSettings.permissions.allow).toContain('mcp__codeagentswarm-tasks__create_task');
            expect(writtenSettings.permissions.allow).toContain('mcp__codeagentswarm-tasks__suggest_parent_tasks');
            expect(writtenSettings.permissions.allow).toHaveLength(20);
        });

        test('should not duplicate existing permissions', async () => {
            mockSettings = {
                permissions: {
                    allow: [
                        'mcp__codeagentswarm-tasks__create_task',
                        'mcp__codeagentswarm-tasks__start_task',
                        'other_permission'
                    ],
                    deny: [],
                    ask: []
                }
            };
            
            const result = await hooksManager.configureMCPPermissions();
            
            expect(result.success).toBe(true);
            
            const writtenSettings = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
            const allowList = writtenSettings.permissions.allow;
            
            // Check no duplicates
            const uniquePermissions = [...new Set(allowList)];
            expect(allowList.length).toBe(uniquePermissions.length);
            
            // Check all MCP permissions are included
            hooksManager.codeAgentSwarmMCPPermissions.forEach(permission => {
                expect(allowList).toContain(permission);
            });
            
            // Check other permissions are preserved
            expect(allowList).toContain('other_permission');
        });

        test('should preserve other settings when adding MCP permissions', async () => {
            mockSettings = {
                model: 'opus',
                statusLine: { type: 'command', command: 'echo test' },
                permissions: {
                    allow: ['Bash(ls:*)'],
                    deny: ['Bash(rm -rf:*)'],
                    ask: ['Bash(sudo:*)']
                },
                hooks: {
                    Notification: [{ matcher: '*', hooks: [] }]
                }
            };
            
            await hooksManager.configureMCPPermissions();
            
            const writtenSettings = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
            
            // Verify other settings are preserved
            expect(writtenSettings.model).toBe('opus');
            expect(writtenSettings.statusLine).toEqual({ type: 'command', command: 'echo test' });
            expect(writtenSettings.hooks).toEqual({ Notification: [{ matcher: '*', hooks: [] }] });
            expect(writtenSettings.permissions.allow).toContain('Bash(ls:*)');
            expect(writtenSettings.permissions.deny).toEqual(['Bash(rm -rf:*)']);
            expect(writtenSettings.permissions.ask).toEqual(['Bash(sudo:*)']);
        });

        test('should handle write errors gracefully', async () => {
            fs.writeFileSync.mockImplementation(() => {
                throw new Error('Permission denied');
            });
            
            const result = await hooksManager.configureMCPPermissions();
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Failed to write settings');
        });
    });

    describe('checkMCPPermissionsStatus', () => {
        test('should correctly identify when all permissions are installed', async () => {
            mockSettings = {
                permissions: {
                    allow: [...hooksManager.codeAgentSwarmMCPPermissions],
                    deny: [],
                    ask: []
                }
            };
            
            const status = await hooksManager.checkMCPPermissionsStatus();
            
            expect(status.allInstalled).toBe(true);
            expect(status.installedCount).toBe(20);
            expect(status.totalRequired).toBe(20);
            expect(status.missingPermissions).toEqual([]);
        });

        test('should identify missing permissions', async () => {
            mockSettings = {
                permissions: {
                    allow: [
                        'mcp__codeagentswarm-tasks__create_task',
                        'mcp__codeagentswarm-tasks__start_task'
                    ],
                    deny: [],
                    ask: []
                }
            };
            
            const status = await hooksManager.checkMCPPermissionsStatus();
            
            expect(status.allInstalled).toBe(false);
            expect(status.installedCount).toBe(2);
            expect(status.totalRequired).toBe(20);
            expect(status.missingPermissions).toHaveLength(18);
            expect(status.missingPermissions).toContain('mcp__codeagentswarm-tasks__complete_task');
            expect(status.missingPermissions).toContain('mcp__codeagentswarm-tasks__suggest_parent_tasks');
        });

        test('should handle missing permissions object gracefully', async () => {
            mockSettings = {
                model: 'opus'
            };
            
            const status = await hooksManager.checkMCPPermissionsStatus();
            
            expect(status.allInstalled).toBe(false);
            expect(status.installedCount).toBe(0);
            expect(status.totalRequired).toBe(20);
            expect(status.missingPermissions).toHaveLength(20);
        });

        test('should handle read errors gracefully', async () => {
            fs.existsSync.mockReturnValue(false);
            
            const status = await hooksManager.checkMCPPermissionsStatus();
            
            expect(status.allInstalled).toBe(false);
            expect(status.installedCount).toBe(0);
            expect(status.totalRequired).toBe(20);
            expect(status.missingPermissions).toHaveLength(20);
        });
    });

    describe('ensureFullConfiguration', () => {
        test('should configure both hooks and MCP permissions', async () => {
            mockSettings = {};
            
            const result = await hooksManager.ensureFullConfiguration();
            
            expect(result.success).toBe(true);
            expect(result.hooks).toBeDefined();
            expect(result.mcp).toBeDefined();
            expect(result.mcp.success).toBe(true);
            
            const writtenSettings = JSON.parse(fs.writeFileSync.mock.calls[fs.writeFileSync.mock.calls.length - 1][1]);
            
            // Verify hooks are configured
            expect(writtenSettings.hooks).toBeDefined();
            expect(writtenSettings.hooks.Notification).toBeDefined();
            expect(writtenSettings.hooks.Stop).toBeDefined();
            
            // Verify MCP permissions are configured
            expect(writtenSettings.permissions).toBeDefined();
            expect(writtenSettings.permissions.allow).toContain('mcp__codeagentswarm-tasks__*');
        });

        test('should report partial success when hooks fail', async () => {
            // Make hooks installation fail on first write
            let callCount = 0;
            fs.writeFileSync.mockImplementation((path, content) => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('Hooks write failed');
                }
                mockSettings = JSON.parse(content);
            });
            
            const result = await hooksManager.ensureFullConfiguration();
            
            expect(result.success).toBe(false);
            expect(result.hooks.success).toBe(false);
            expect(result.mcp.success).toBe(true);
        });
    });

    describe('MCP permissions list', () => {
        test('should include all required task management permissions', () => {
            const permissions = hooksManager.codeAgentSwarmMCPPermissions;
            
            // Essential permissions
            const essentials = [
                'mcp__codeagentswarm-tasks__*',
                'mcp__codeagentswarm-tasks__create_task',
                'mcp__codeagentswarm-tasks__start_task',
                'mcp__codeagentswarm-tasks__complete_task',
                'mcp__codeagentswarm-tasks__submit_for_testing',
                'mcp__codeagentswarm-tasks__list_tasks',
                'mcp__codeagentswarm-tasks__search_tasks',
                'mcp__codeagentswarm-tasks__update_task_plan',
                'mcp__codeagentswarm-tasks__update_task_implementation',
                'mcp__codeagentswarm-tasks__update_task_terminal',
                'mcp__codeagentswarm-tasks__update_terminal_title'
            ];
            
            essentials.forEach(permission => {
                expect(permissions).toContain(permission);
            });
        });

        test('should include project management permissions', () => {
            const permissions = hooksManager.codeAgentSwarmMCPPermissions;
            
            expect(permissions).toContain('mcp__codeagentswarm-tasks__create_project');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__get_projects');
            expect(permissions).toContain('mcp__codeagentswarm-tasks__get_project_tasks');
        });

        test('should include subtask management permissions', () => {
            const permissions = hooksManager.codeAgentSwarmMCPPermissions;
            
            const subtaskPermissions = [
                'mcp__codeagentswarm-tasks__create_subtask',
                'mcp__codeagentswarm-tasks__get_subtasks',
                'mcp__codeagentswarm-tasks__link_task_to_parent',
                'mcp__codeagentswarm-tasks__unlink_task_from_parent',
                'mcp__codeagentswarm-tasks__get_task_hierarchy',
                'mcp__codeagentswarm-tasks__suggest_parent_tasks'
            ];
            
            subtaskPermissions.forEach(permission => {
                expect(permissions).toContain(permission);
            });
        });

        test('should have exactly 20 permissions', () => {
            expect(hooksManager.codeAgentSwarmMCPPermissions).toHaveLength(20);
        });
    });

    describe('Settings directory creation', () => {
        test('should create settings directory if it does not exist', async () => {
            fs.existsSync.mockImplementation((path) => {
                return path === mockSettingsPath;
            });
            
            await hooksManager.configureMCPPermissions();
            
            expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/home/.claude', { recursive: true });
        });

        test('should not create directory if it already exists', async () => {
            fs.existsSync.mockReturnValue(true);
            
            await hooksManager.configureMCPPermissions();
            
            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });
    });
});
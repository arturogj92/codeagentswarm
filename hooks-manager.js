const fs = require('fs');
const path = require('path');
const os = require('os');

class HooksManager {
    constructor() {
        this.settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        this.webhookPort = 45782;
        
        // Define CodeAgentSwarm hooks with correct format
        this.codeAgentSwarmHooks = {
            "Notification": [{
                "matcher": "*",
                "hooks": [{
                    "type": "command",
                    "command": this.buildHookCommand('confirmation_needed', '{{tool}}')
                }]
            }],
            "Stop": [{
                "hooks": [{
                    "type": "command",
                    "command": this.buildHookCommand('claude_finished')
                }]
            }]
        };

        // Define CodeAgentSwarm MCP permissions
        this.codeAgentSwarmMCPPermissions = [
            "mcp__codeagentswarm-tasks__*",
            "mcp__codeagentswarm-tasks__create_task",
            "mcp__codeagentswarm-tasks__start_task",
            "mcp__codeagentswarm-tasks__complete_task",
            "mcp__codeagentswarm-tasks__submit_for_testing",
            "mcp__codeagentswarm-tasks__list_tasks",
            "mcp__codeagentswarm-tasks__search_tasks",
            "mcp__codeagentswarm-tasks__update_task_plan",
            "mcp__codeagentswarm-tasks__update_task_implementation",
            "mcp__codeagentswarm-tasks__update_task_terminal",
            "mcp__codeagentswarm-tasks__update_terminal_title",
            "mcp__codeagentswarm-tasks__create_project",
            "mcp__codeagentswarm-tasks__get_projects",
            "mcp__codeagentswarm-tasks__get_project_tasks",
            "mcp__codeagentswarm-tasks__create_subtask",
            "mcp__codeagentswarm-tasks__get_subtasks",
            "mcp__codeagentswarm-tasks__link_task_to_parent",
            "mcp__codeagentswarm-tasks__unlink_task_from_parent",
            "mcp__codeagentswarm-tasks__get_task_hierarchy",
            "mcp__codeagentswarm-tasks__suggest_parent_tasks"
        ];
    }

    buildHookCommand(eventType, tool = '') {
        // Use sh -c with explicit variable evaluation to ensure it works across all shells
        // The $(...) syntax forces the shell to evaluate the variable
        if (eventType === 'confirmation_needed') {
            return `sh -c 'curl -X POST http://localhost:${this.webhookPort}/webhook -H "Content-Type: application/json" -d "{\\"type\\":\\"${eventType}\\",\\"terminalId\\":\\"$(echo \${CODEAGENTSWARM_CURRENT_QUADRANT:-0})\\",\\"tool\\":\\"${tool}\\"}" --silent --fail 2>/dev/null || true'`;
        } else {
            return `sh -c 'curl -X POST http://localhost:${this.webhookPort}/webhook -H "Content-Type: application/json" -d "{\\"type\\":\\"${eventType}\\",\\"terminalId\\":\\"$(echo \${CODEAGENTSWARM_CURRENT_QUADRANT:-0})\\"}" --silent --fail 2>/dev/null || true'`;
        }
    }

    async ensureSettingsDirectory() {
        const settingsDir = path.dirname(this.settingsPath);
        if (!fs.existsSync(settingsDir)) {
            fs.mkdirSync(settingsDir, { recursive: true });
        }
    }

    async readSettings() {
        try {
            await this.ensureSettingsDirectory();
            
            if (!fs.existsSync(this.settingsPath)) {
                return {};
            }
            
            const content = fs.readFileSync(this.settingsPath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error('Error reading settings:', error);
            return {};
        }
    }

    async writeSettings(settings) {
        try {
            await this.ensureSettingsDirectory();
            fs.writeFileSync(
                this.settingsPath, 
                JSON.stringify(settings, null, 2), 
                'utf8'
            );
            return true;
        } catch (error) {
            console.error('Error writing settings:', error);
            return false;
        }
    }

    async installHooks() {
        try {
            const settings = await this.readSettings();
            
            // Merge hooks with existing settings
            const updatedSettings = {
                ...settings,
                hooks: {
                    ...(settings.hooks || {}),
                    ...this.codeAgentSwarmHooks
                }
            };
            
            const success = await this.writeSettings(updatedSettings);
            
            if (success) {
                return { success: true };
            } else {
                return { success: false, error: 'Failed to write settings' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async removeHooks() {
        try {
            const settings = await this.readSettings();
            
            if (!settings.hooks) {
                return { success: true };
            }
            
            // Remove CodeAgentSwarm hooks
            if (settings.hooks.Notification) {
                delete settings.hooks.Notification;
            }
            if (settings.hooks.Stop) {
                delete settings.hooks.Stop;
            }
            
            // Clean up empty hooks object
            if (Object.keys(settings.hooks).length === 0) {
                delete settings.hooks;
            }
            
            const success = await this.writeSettings(settings);
            
            if (success) {
                return { success: true };
            } else {
                return { success: false, error: 'Failed to write settings' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async checkHooksStatus() {
        try {
            const settings = await this.readSettings();
            
            // Check if our hooks are installed with the correct format
            const hasNotificationHook = settings.hooks?.Notification?.some(item => 
                item.hooks?.some(hook => 
                    hook.command?.includes('confirmation_needed')
                )
            );
            const hasStopHook = settings.hooks?.Stop?.some(item => 
                item.hooks?.some(hook => 
                    hook.command?.includes('claude_finished')
                )
            );
            
            return {
                installed: hasNotificationHook && hasStopHook,
                notificationHook: hasNotificationHook,
                stopHook: hasStopHook,
                settingsPath: this.settingsPath,
                hooks: settings.hooks || {}
            };
        } catch (error) {
            return {
                installed: false,
                error: error.message
            };
        }
    }

    async configureMCPPermissions() {
        try {
            const settings = await this.readSettings();
            
            // Initialize permissions if they don't exist
            if (!settings.permissions) {
                settings.permissions = {
                    allow: [],
                    deny: [],
                    ask: []
                };
            }
            
            // Get current allow list
            const currentAllow = settings.permissions.allow || [];
            
            // Create a Set to avoid duplicates
            const allowSet = new Set(currentAllow);
            
            // Add all CodeAgentSwarm MCP permissions
            this.codeAgentSwarmMCPPermissions.forEach(permission => {
                allowSet.add(permission);
            });
            
            // Update the allow list
            settings.permissions.allow = Array.from(allowSet);
            
            // Write back the updated settings
            const success = await this.writeSettings(settings);
            
            if (success) {
                console.log('MCP permissions configured successfully');
                return { success: true, permissionsAdded: this.codeAgentSwarmMCPPermissions.length };
            } else {
                return { success: false, error: 'Failed to write settings' };
            }
        } catch (error) {
            console.error('Error configuring MCP permissions:', error);
            return { success: false, error: error.message };
        }
    }

    async checkMCPPermissionsStatus() {
        try {
            const settings = await this.readSettings();
            const allowList = settings.permissions?.allow || [];
            
            // Check which permissions are installed
            const installedPermissions = this.codeAgentSwarmMCPPermissions.filter(permission => 
                allowList.includes(permission)
            );
            
            const allInstalled = installedPermissions.length === this.codeAgentSwarmMCPPermissions.length;
            
            return {
                allInstalled,
                installedCount: installedPermissions.length,
                totalRequired: this.codeAgentSwarmMCPPermissions.length,
                missingPermissions: this.codeAgentSwarmMCPPermissions.filter(permission => 
                    !allowList.includes(permission)
                )
            };
        } catch (error) {
            return {
                allInstalled: false,
                error: error.message
            };
        }
    }

    async ensureFullConfiguration() {
        try {
            // Install hooks
            const hooksResult = await this.installHooks();
            if (!hooksResult.success) {
                console.error('Failed to install hooks:', hooksResult.error);
            }
            
            // Configure MCP permissions
            const mcpResult = await this.configureMCPPermissions();
            if (!mcpResult.success) {
                console.error('Failed to configure MCP permissions:', mcpResult.error);
            }
            
            return {
                success: hooksResult.success && mcpResult.success,
                hooks: hooksResult,
                mcp: mcpResult
            };
        } catch (error) {
            console.error('Error ensuring full configuration:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = HooksManager;
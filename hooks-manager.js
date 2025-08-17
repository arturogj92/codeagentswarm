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
        
        // Define MCP permissions to auto-approve all CodeAgentSwarm task tools
        this.codeAgentSwarmPermissions = [
            "mcp__codeagentswarm-tasks__*",  // Auto-approve ALL tools from this MCP server
            "mcp__codeagentswarm-tasks__create_task",
            "mcp__codeagentswarm-tasks__start_task",
            "mcp__codeagentswarm-tasks__complete_task",
            "mcp__codeagentswarm-tasks__submit_for_testing",
            "mcp__codeagentswarm-tasks__list_tasks",
            "mcp__codeagentswarm-tasks__search_tasks",  // Explicitly allow search_tasks
            "mcp__codeagentswarm-tasks__update_task_plan",
            "mcp__codeagentswarm-tasks__update_task_implementation",
            "mcp__codeagentswarm-tasks__update_task_terminal",
            "mcp__codeagentswarm-tasks__update_terminal_title",
            "mcp__codeagentswarm-tasks__create_project",
            "mcp__codeagentswarm-tasks__get_projects",
            "mcp__codeagentswarm-tasks__get_project_tasks"
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
            
            // Get existing permissions or create empty structure
            const existingPermissions = settings.permissions || {};
            const existingAllowList = existingPermissions.allow || [];
            
            // Merge new permissions with existing ones (avoiding duplicates)
            const mergedPermissions = [...new Set([
                ...existingAllowList,
                ...this.codeAgentSwarmPermissions
            ])];
            
            // Merge hooks and permissions with existing settings
            const updatedSettings = {
                ...settings,
                hooks: {
                    ...(settings.hooks || {}),
                    ...this.codeAgentSwarmHooks
                },
                permissions: {
                    ...existingPermissions,
                    allow: mergedPermissions
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
            
            // Remove CodeAgentSwarm hooks
            if (settings.hooks) {
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
            }
            
            // Remove CodeAgentSwarm permissions from allow list
            if (settings.permissions && settings.permissions.allow) {
                settings.permissions.allow = settings.permissions.allow.filter(
                    permission => !this.codeAgentSwarmPermissions.includes(permission)
                );
                
                // Clean up empty permissions
                if (settings.permissions.allow.length === 0) {
                    delete settings.permissions.allow;
                }
                if (Object.keys(settings.permissions).length === 0) {
                    delete settings.permissions;
                }
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
            
            // Check if our permissions are installed
            const hasMCPPermissions = settings.permissions?.allow?.includes('mcp__codeagentswarm-tasks__*') ||
                (settings.permissions?.allow?.includes('mcp__codeagentswarm-tasks__create_task') &&
                 settings.permissions?.allow?.includes('mcp__codeagentswarm-tasks__start_task'));
            
            return {
                installed: hasNotificationHook && hasStopHook && hasMCPPermissions,
                notificationHook: hasNotificationHook,
                stopHook: hasStopHook,
                permissionsInstalled: hasMCPPermissions,
                settingsPath: this.settingsPath,
                hooks: settings.hooks || {},
                permissions: settings.permissions || {}
            };
        } catch (error) {
            return {
                installed: false,
                error: error.message
            };
        }
    }
}

module.exports = HooksManager;
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
}

module.exports = HooksManager;
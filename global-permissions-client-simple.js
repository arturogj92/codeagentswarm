// Global Permissions Manager - Simple Client Version
// This version uses IPC to communicate with main process for file operations

class GlobalPermissionsFileManager {
    constructor() {
        this.currentSettings = {};
        this.permissions = [];
        this.yoloMode = false;
        this.searchQuery = '';
        this.selectedCategory = 'all';
        this.changes = new Set();
        this.expandedGroups = new Set();
        
        // Tool categories for organization
        this.categories = {
            all: { name: 'All Tools', icon: 'list' },
            file: { name: 'File Operations', icon: 'file-text' },
            'command-git': { name: 'Git Commands', icon: 'git-branch' },
            'command-package': { name: 'Package Managers', icon: 'package' },
            'command-file': { name: 'File System Commands', icon: 'folder' },
            'command-system': { name: 'System Commands', icon: 'cpu' },
            'command-network': { name: 'Network Commands', icon: 'wifi' },
            'command-dev': { name: 'Development Tools', icon: 'code' },
            search: { name: 'Search & Navigation', icon: 'search' },
            web: { name: 'Web Operations', icon: 'globe' },
            task: { name: 'Task Management', icon: 'check-square' }
        };
        
        // All available Claude tools with metadata - Using official names from Anthropic docs
        this.allTools = [
            // File Operations - Official names
            { name: 'ReadFile', category: 'file', description: 'Read files from filesystem' },
            { name: 'WriteFile', category: 'file', description: 'Write files to filesystem' },
            { name: 'Edit', category: 'file', description: 'Edit existing files' },
            { name: 'DeleteFile', category: 'file', description: 'Remove files' },
            { name: 'MultiEdit', category: 'file', description: 'Multiple edits in one operation' },
            { name: 'NotebookEdit', category: 'file', description: 'Edit Jupyter notebooks' },
            
            // Command Execution - NOTE: Don't use general commands if you want specific patterns to work
            // Uncommenting these will override specific patterns below
            // { name: 'Bash', category: 'command', description: 'Execute ANY bash command' },
            // { name: 'NPM', category: 'command', description: 'ANY NPM command' },
            // { name: 'Git', category: 'command', description: 'ANY Git command' },
            // { name: 'Pip', category: 'command', description: 'ANY Python pip command' },
            // { name: 'Cargo', category: 'command', description: 'ANY Rust cargo command' },
            // { name: 'Curl', category: 'command', description: 'ANY Curl command' },
            
            // Git command patterns - Complete Git control
            { name: 'Bash(git add:*)', category: 'command-git', description: 'Git add files' },
            { name: 'Bash(git commit:*)', category: 'command-git', description: 'Git commit changes' },
            { name: 'Bash(git push:*)', category: 'command-git', description: 'Git push to remote' },
            { name: 'Bash(git pull:*)', category: 'command-git', description: 'Git pull from remote' },
            { name: 'Bash(git fetch:*)', category: 'command-git', description: 'Git fetch updates' },
            { name: 'Bash(git clone:*)', category: 'command-git', description: 'Git clone repository' },
            { name: 'Bash(git checkout:*)', category: 'command-git', description: 'Git checkout branch/file' },
            { name: 'Bash(git branch:*)', category: 'command-git', description: 'Git branch operations' },
            { name: 'Bash(git merge:*)', category: 'command-git', description: 'Git merge branches' },
            { name: 'Bash(git rebase:*)', category: 'command-git', description: 'Git rebase branches' },
            { name: 'Bash(git reset:*)', category: 'command-git', description: 'Git reset changes' },
            { name: 'Bash(git revert:*)', category: 'command-git', description: 'Git revert commits' },
            { name: 'Bash(git stash:*)', category: 'command-git', description: 'Git stash changes' },
            { name: 'Bash(git diff:*)', category: 'command-git', description: 'Git show differences' },
            { name: 'Bash(git log:*)', category: 'command-git', description: 'Git show history' },
            { name: 'Bash(git status:*)', category: 'command-git', description: 'Git show status' },
            { name: 'Bash(git tag:*)', category: 'command-git', description: 'Git tag versions' },
            { name: 'Bash(git remote:*)', category: 'command-git', description: 'Git remote operations' },
            { name: 'Bash(git cherry-pick:*)', category: 'command-git', description: 'Git cherry-pick commits' },
            { name: 'Bash(git config:*)', category: 'command-git', description: 'Git configuration' },
            
            // Package managers
            { name: 'Bash(npm install:*)', category: 'command-package', description: 'Install npm packages' },
            { name: 'Bash(npm run:*)', category: 'command-package', description: 'Run npm scripts' },
            { name: 'Bash(npm test:*)', category: 'command-package', description: 'Run npm tests' },
            { name: 'Bash(yarn:*)', category: 'command-package', description: 'Yarn commands' },
            { name: 'Bash(pnpm:*)', category: 'command-package', description: 'Pnpm commands' },
            { name: 'Bash(pip:*)', category: 'command-package', description: 'Python pip' },
            { name: 'Bash(brew:*)', category: 'command-package', description: 'Homebrew commands' },
            { name: 'Bash(apt:*)', category: 'command-package', description: 'APT package manager' },
            
            // File system commands
            { name: 'Bash(ls:*)', category: 'command-file', description: 'List files with ls' },
            { name: 'Bash(cd:*)', category: 'command-file', description: 'Change directory' },
            { name: 'Bash(mkdir:*)', category: 'command-file', description: 'Create directories' },
            { name: 'Bash(cp:*)', category: 'command-file', description: 'Copy files' },
            { name: 'Bash(mv:*)', category: 'command-file', description: 'Move/rename files' },
            { name: 'Bash(rm:*)', category: 'command-file', description: 'Remove files with rm' },
            { name: 'Bash(cat:*)', category: 'command-file', description: 'Display file contents' },
            { name: 'Bash(echo:*)', category: 'command-file', description: 'Echo text' },
            { name: 'Bash(grep:*)', category: 'command-file', description: 'Search with grep' },
            { name: 'Bash(find:*)', category: 'command-file', description: 'Find files' },
            { name: 'Bash(ack:*)', category: 'command-file', description: 'Search with ack (for programmers)' },
            { name: 'Bash(ag:*)', category: 'command-file', description: 'Silver Searcher (fast code search)' },
            { name: 'Bash(rg:*)', category: 'command-file', description: 'Ripgrep (fastest search)' },
            { name: 'Bash(fd:*)', category: 'command-file', description: 'Modern find alternative' },
            { name: 'Bash(locate:*)', category: 'command-file', description: 'Search file database' },
            { name: 'Bash(tar:*)', category: 'command-file', description: 'Archive files' },
            { name: 'Bash(zip:*)', category: 'command-file', description: 'Zip files' },
            { name: 'Bash(unzip:*)', category: 'command-file', description: 'Unzip files' },
            
            // System commands
            { name: 'Bash(sudo:*)', category: 'command-system', description: 'Run with sudo' },
            { name: 'Bash(chmod:*)', category: 'command-system', description: 'Change permissions' },
            { name: 'Bash(chown:*)', category: 'command-system', description: 'Change ownership' },
            { name: 'Bash(ps:*)', category: 'command-system', description: 'Process status' },
            { name: 'Bash(kill:*)', category: 'command-system', description: 'Kill processes' },
            
            // Network commands
            { name: 'Bash(curl:*)', category: 'command-network', description: 'Curl commands' },
            { name: 'Bash(wget:*)', category: 'command-network', description: 'Wget downloads' },
            { name: 'Bash(ssh:*)', category: 'command-network', description: 'SSH connections' },
            { name: 'Bash(scp:*)', category: 'command-network', description: 'Secure copy' },
            
            // Development tools
            { name: 'Bash(docker:*)', category: 'command-dev', description: 'Docker commands' },
            { name: 'Bash(python:*)', category: 'command-dev', description: 'Python commands' },
            { name: 'Bash(node:*)', category: 'command-dev', description: 'Node.js commands' },
            { name: 'Bash(make:*)', category: 'command-dev', description: 'Make build tool' },
            
            // Search Operations - Official names
            { name: 'Grep', category: 'search', description: 'Search file contents' },
            { name: 'Glob', category: 'search', description: 'Find files by pattern' },
            { name: 'LS', category: 'search', description: 'List directory contents' },
            
            // Web Operations - Use patterns for granular control
            { name: 'HTTP(GET:*)', category: 'web', description: 'HTTP GET requests' },
            { name: 'HTTP(POST:*)', category: 'web', description: 'HTTP POST requests' },
            { name: 'HTTP(PUT:*)', category: 'web', description: 'HTTP PUT requests' },
            { name: 'HTTP(DELETE:*)', category: 'web', description: 'HTTP DELETE requests' },
            { name: 'HTTP(PATCH:*)', category: 'web', description: 'HTTP PATCH requests' },
            { name: 'WebSearch', category: 'web', description: 'Search the web' },
            { name: 'WebFetch', category: 'web', description: 'Fetch web content' },
            
            // Task Management - These might be custom to Claude Code
            { name: 'TodoWrite', category: 'task', description: 'Manage todo lists' },
            { name: 'Task', category: 'task', description: 'Launch specialized agents' },
            { name: 'ExitPlanMode', category: 'task', description: 'Exit planning mode' },
            
            // General Commands - DISABLED to prevent conflicts with patterns
            // DO NOT USE THESE - They override ALL specific patterns above!
            // { name: 'Bash', category: 'general', description: '⚠️ ALL Bash commands (overrides patterns)' },
            // { name: 'NPM', category: 'general', description: '⚠️ ALL NPM commands' },
            // { name: 'Git', category: 'general', description: '⚠️ ALL Git commands' },
            // { name: 'Pip', category: 'general', description: '⚠️ ALL Python pip commands' },
            // { name: 'Cargo', category: 'general', description: '⚠️ ALL Rust cargo commands' },
            // { name: 'Curl', category: 'general', description: '⚠️ ALL Curl commands' }
        ];
        
        this.init();
    }
    
    async init() {
        await this.loadSettings();
        this.processPermissions();
        this.render();
        this.setupEventListeners();
    }
    
    async loadSettings() {
        try {
            // Use IPC to request settings from main process
            if (window.ipcRenderer) {
                const settings = await window.ipcRenderer.invoke('get-claude-settings');
                this.currentSettings = settings || {
                    permissions: { allow: [], deny: [], ask: [] }
                };
            } else {
                // Fallback - load from localStorage for testing
                const stored = localStorage.getItem('claudeSettings');
                if (stored) {
                    this.currentSettings = JSON.parse(stored);
                } else {
                    this.currentSettings = {
                        permissions: { allow: [], deny: [], ask: [] }
                    };
                }
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            this.currentSettings = {
                permissions: { allow: [], deny: [], ask: [] }
            };
        }
    }
    
    processPermissions() {
        const perms = this.currentSettings.permissions || {};
        
        // Filter out general commands that conflict with patterns
        const conflictingGeneralCommands = ['Bash', 'NPM', 'Git', 'Pip', 'Cargo', 'Curl', 'HTTP', 'WebFetch'];
        
        const allow = new Set((perms.allow || []).filter(p => !conflictingGeneralCommands.includes(p)));
        const deny = new Set((perms.deny || []).filter(p => !conflictingGeneralCommands.includes(p)));
        const ask = new Set((perms.ask || []).filter(p => !conflictingGeneralCommands.includes(p)));
        
        // Check for YOLO mode (if all tools are in allow or there's a wildcard)
        this.yoloMode = allow.has('*') || allow.has('**');
        
        // Process each tool to determine its permission state
        this.permissions = [];
        
        // Add all known tools (excluding MCP tools - they have their own manager)
        this.allTools.forEach(tool => {
            let permissionType = 'ask'; // default
            
            if (this.yoloMode || allow.has(tool.name) || allow.has(`${tool.name}:*`)) {
                permissionType = 'allow';
            } else if (deny.has(tool.name) || deny.has(`${tool.name}:*`)) {
                permissionType = 'deny';
            } else if (ask.has(tool.name)) {
                permissionType = 'ask';
            }
            
            // Check for wildcard patterns
            for (const pattern of allow) {
                if (this.matchesPattern(tool.name, pattern)) {
                    permissionType = 'allow';
                    break;
                }
            }
            for (const pattern of deny) {
                if (this.matchesPattern(tool.name, pattern)) {
                    permissionType = 'deny';
                    break;
                }
            }
            
            this.permissions.push({
                tool_name: tool.name,
                permission_type: permissionType,
                description: tool.description,
                category: tool.category
            });
        });
        
        // Don't add MCP tools here - they're managed in the MCP Permissions modal
    }
    
    matchesPattern(toolName, pattern) {
        if (!pattern) return false;
        // Convert wildcard pattern to regex
        const regexPattern = pattern
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(toolName);
    }
    
    setupEventListeners() {
        setTimeout(() => {
            console.log('[GlobalPermissions] Setting up event listeners');
            
            // YOLO mode toggle
            const yoloToggle = document.getElementById('yolo-mode-toggle');
            if (yoloToggle) {
                console.log('[GlobalPermissions] Found YOLO toggle');
                yoloToggle.addEventListener('change', (e) => {
                    this.handleYoloModeToggle(e.target.checked);
                });
            }
            
            // Search input
            const searchInput = document.getElementById('permissions-search');
            if (searchInput) {
                console.log('[GlobalPermissions] Found search input');
                searchInput.addEventListener('input', (e) => {
                    this.searchQuery = e.target.value.trim();
                    
                    // If search is cleared, re-render to show all permissions
                    if (!this.searchQuery) {
                        // Mark that we should restore focus after re-render
                        this.shouldRestoreFocus = true;
                        this.renderWithExpandedGroups();
                    } else {
                        this.filterAndUpdateGroups();
                    }
                });
            }
            
            // Category filter
            const categoryFilter = document.getElementById('category-filter');
            if (categoryFilter) {
                console.log('[GlobalPermissions] Found category filter');
                categoryFilter.addEventListener('change', (e) => {
                    this.selectedCategory = e.target.value;
                    this.render();
                });
            }
            
            // Bulk actions
            ['allow-all-btn', 'deny-all-btn', 'ask-all-btn'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    console.log(`[GlobalPermissions] Found button: ${id}`);
                    const action = id.split('-')[0];
                    btn.addEventListener('click', () => this.bulkUpdatePermissions(action));
                }
            });
            
            // Custom command button
            const addCustomBtn = document.getElementById('add-custom-command');
            if (addCustomBtn) {
                addCustomBtn.addEventListener('click', () => this.addCustomCommand());
            }
            
            const customInput = document.getElementById('custom-command-input');
            if (customInput) {
                customInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.addCustomCommand();
                    }
                });
            }
            
            
            const applyBtn = document.getElementById('apply-permissions-btn');
            if (applyBtn) {
                console.log('[GlobalPermissions] Found apply button, adding click listener');
                applyBtn.addEventListener('click', () => {
                    console.log('[GlobalPermissions] Apply button clicked!');
                    this.applyChanges();
                });
            } else {
                console.log('[GlobalPermissions] ERROR: Apply button not found!');
            }
        }, 100);
    }
    
    handleYoloModeToggle(enabled) {
        this.yoloMode = enabled;
        if (enabled) {
            // Add wildcard to allow all
            this.permissions.forEach(p => {
                p.permission_type = 'allow';
                this.changes.add(p.tool_name);
            });
        }
        // Auto-save YOLO mode change (silent mode to avoid re-render)
        this.applyChanges(true);
        this.showNotification(enabled ? 'YOLO Mode Enabled - All permissions granted!' : 'YOLO Mode Disabled');
        // Use renderWithExpandedGroups to preserve scroll position and expanded state
        this.renderWithExpandedGroups();
    }
    
    async updatePermission(toolName, permissionType) {
        const perm = this.permissions.find(p => p.tool_name === toolName);
        if (perm) {
            perm.permission_type = permissionType;
            this.changes.add(toolName);
            
            // If changing any permission when YOLO is on, turn off YOLO
            if (this.yoloMode && permissionType !== 'allow') {
                this.yoloMode = false;
            }
            
            // Auto-save changes immediately with preserved expanded state
            // Wait for the save to complete before re-rendering
            await this.applyChanges(true);
            this.renderWithExpandedGroups();
        }
    }
    
    bulkUpdatePermissions(permissionType) {
        const filtered = this.getFilteredPermissions();
        filtered.forEach(p => {
            p.permission_type = permissionType;
            this.changes.add(p.tool_name);
        });
        
        if (permissionType !== 'allow') {
            this.yoloMode = false;
        }
        
        this.showNotification(`Set ${filtered.length} permissions to ${permissionType}`);
        this.render();
    }
    
    
    async applyChanges(silent = false) {
        if (!silent) {
            console.log('[GlobalPermissions] applyChanges called');
            console.log('[GlobalPermissions] YOLO mode:', this.yoloMode);
            console.log('[GlobalPermissions] Number of permissions:', this.permissions.length);
            console.log('[GlobalPermissions] ipcRenderer available:', !!window.ipcRenderer);
        }
        
        // Get existing permissions to preserve MCP ones
        const existingPerms = this.currentSettings.permissions || {};
        const existingMcpAllow = (existingPerms.allow || []).filter(p => p && p.startsWith('mcp__'));
        const existingMcpDeny = (existingPerms.deny || []).filter(p => p && p.startsWith('mcp__'));
        const existingMcpAsk = (existingPerms.ask || []).filter(p => p && p.startsWith('mcp__'));
        
        // Build new permissions object (only for non-MCP tools)
        const newPermissions = {
            allow: [],
            deny: [],
            ask: []
        };
        
        // Add YOLO mode wildcard if enabled
        if (this.yoloMode) {
            newPermissions.allow.push('*');
        } else {
            // Group permissions by type (only non-MCP tools)
            // Filter out general commands that conflict with patterns
            const conflictingGeneralCommands = ['Bash', 'NPM', 'Git', 'Pip', 'Cargo', 'Curl', 'HTTP', 'WebFetch'];
            
            this.permissions.forEach(p => {
                // Skip conflicting general commands
                if (conflictingGeneralCommands.includes(p.tool_name)) {
                    return;
                }
                
                if (p.permission_type === 'allow') {
                    newPermissions.allow.push(p.tool_name);
                } else if (p.permission_type === 'deny') {
                    newPermissions.deny.push(p.tool_name);
                } else if (p.permission_type === 'ask') {
                    // Ask is usually implicit (not in list), but we can add it
                    newPermissions.ask.push(p.tool_name);
                }
            });
        }
        
        // Merge with existing MCP permissions
        newPermissions.allow = [...newPermissions.allow, ...existingMcpAllow];
        newPermissions.deny = [...newPermissions.deny, ...existingMcpDeny];
        newPermissions.ask = [...newPermissions.ask, ...existingMcpAsk];
        
        console.log('[GlobalPermissions] New permissions object:', JSON.stringify(newPermissions, null, 2));
        
        // Update settings
        this.currentSettings.permissions = newPermissions;
        
        console.log('[GlobalPermissions] Full settings to save:', JSON.stringify(this.currentSettings, null, 2));
        
        // Save using IPC or localStorage
        try {
            if (window.ipcRenderer) {
                console.log('[GlobalPermissions] Calling IPC save-claude-settings...');
                // Use IPC to save to file through main process
                const result = await window.ipcRenderer.invoke('save-claude-settings', this.currentSettings);
                if (!silent) {
                    console.log('[GlobalPermissions] IPC result:', result);
                }
                if (result.success) {
                    this.changes.clear();
                    if (!silent) {
                        this.showNotification('Permissions saved automatically');
                    }
                } else {
                    throw new Error(result.error || 'Failed to save');
                }
            } else {
                console.log('[GlobalPermissions] No IPC, using localStorage fallback');
                // Fallback - save to localStorage
                localStorage.setItem('claudeSettings', JSON.stringify(this.currentSettings));
                this.changes.clear();
                this.showNotification('Permissions saved (test mode - localStorage)');
            }
            
            // Only render if not in silent mode (silent mode is used for auto-saves)
            if (!silent) {
                this.render();
            }
        } catch (error) {
            console.error('[GlobalPermissions] Error saving settings:', error);
            this.showNotification('Error saving permissions: ' + error.message, 'error');
        }
    }
    
    getFilteredPermissions() {
        let filtered = this.permissions;
        
        if (this.selectedCategory !== 'all') {
            filtered = filtered.filter(p => p.category === this.selectedCategory);
        }
        
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(p => 
                p.tool_name.toLowerCase().includes(query) ||
                (p.description && p.description.toLowerCase().includes(query))
            );
        }
        
        return filtered;
    }
    
    render() {
        const container = document.getElementById('global-permissions-content');
        if (!container) return;
        
        // Group permissions by category
        const groupedPermissions = this.getGroupedPermissions();
        
        container.innerHTML = `
            <div class="permissions-info">
                <div style="padding: 14px; background: linear-gradient(135deg, rgba(100, 150, 255, 0.08) 0%, rgba(150, 100, 255, 0.08) 100%); border: 1px solid rgba(120, 140, 255, 0.2); border-radius: 10px; margin-bottom: 16px; position: relative; overflow: hidden;">
                    <div style="position: absolute; top: -20px; right: -20px; font-size: 80px; opacity: 0.05; transform: rotate(-15deg);">
                        🛡️
                    </div>
                    <div style="display: flex; align-items: flex-start; gap: 12px; position: relative;">
                        <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <i data-lucide="shield-check" style="width: 20px; height: 20px; color: white;"></i>
                        </div>
                        <div style="flex: 1;">
                            <h4 style="margin: 0 0 8px 0; color: #a8b2ff; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                                Global Permissions Manager
                            </h4>
                            <p style="margin: 0 0 6px 0; font-size: 12px; line-height: 1.5; color: #ccc;">
                                <strong style="color: #fff;">Take control of Claude's capabilities.</strong> Configure which tools Claude can use automatically and which require your approval.
                            </p>
                            <div style="display: flex; gap: 15px; margin-top: 10px; font-size: 11px; color: #999;">
                                <span style="display: flex; align-items: center; gap: 5px;">
                                    <i data-lucide="zap" style="width: 12px; height: 12px; color: #ffc300;"></i>
                                    <span>Fast workflow with auto-permissions</span>
                                </span>
                                <span style="display: flex; align-items: center; gap: 5px;">
                                    <i data-lucide="lock" style="width: 12px; height: 12px; color: #4caf50;"></i>
                                    <span>Stay secure with granular control</span>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="yolo-mode-section" style="margin-top: 15px; padding: 16px; background: ${this.yoloMode ? 'linear-gradient(135deg, rgba(255, 195, 0, 0.15) 0%, rgba(255, 100, 0, 0.15) 100%)' : 'linear-gradient(135deg, rgba(40, 40, 40, 0.5) 0%, rgba(30, 30, 30, 0.5) 100%)'}; border: 2px solid ${this.yoloMode ? 'rgba(255, 195, 0, 0.5)' : 'rgba(80, 80, 80, 0.3)'}; border-radius: 12px; box-shadow: ${this.yoloMode ? '0 0 20px rgba(255, 195, 0, 0.2)' : 'none'}; transition: all 0.3s ease;">
                    <div class="yolo-mode-toggle" style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <div style="font-size: 32px; line-height: 1; filter: ${this.yoloMode ? 'none' : 'grayscale(1) opacity(0.5)'}; transition: all 0.3s;">
                                🚀
                            </div>
                            <div class="yolo-mode-label">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span class="yolo-text" style="font-weight: bold; font-size: 16px; color: ${this.yoloMode ? '#ffc300' : '#666'}; text-transform: uppercase; letter-spacing: 1px; transition: all 0.3s;">
                                        YOLO MODE
                                    </span>
                                    ${this.yoloMode ? '<span style="background: #ffc300; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; animation: pulse 2s infinite;">ACTIVE</span>' : '<span style="font-size: 11px; color: #666; font-weight: normal; text-transform: none; letter-spacing: 0;">("You Only Live Once")</span>'}
                                </div>
                                <span class="yolo-description" style="display: block; font-size: 12px; color: ${this.yoloMode ? '#ffa500' : '#888'}; margin-top: 4px; transition: all 0.3s;">
                                    ${this.yoloMode ? '⚡ All tools are now in ALLOW mode - Claude executes everything instantly!' : '🔒 Activating this will automatically set ALL tools to ALLOW'}
                                </span>
                                <span style="display: block; font-size: 11px; color: ${this.yoloMode ? '#ff9966' : '#666'}; margin-top: 3px; font-style: italic;">
                                    ${this.yoloMode ? 'All permissions are granted! (Except items you put in DENY or ASK)' : 'Perfect for trusted environments - moves everything to Allow list automatically'}
                                </span>
                            </div>
                        </div>
                        <label class="toggle-switch-large" style="transform: scale(1.2);">
                            <input type="checkbox" id="yolo-mode-toggle" ${this.yoloMode ? 'checked' : ''}>
                            <span class="slider" style="background: ${this.yoloMode ? 'linear-gradient(90deg, #ffc300, #ff8c00)' : '#444'}; box-shadow: ${this.yoloMode ? '0 0 10px rgba(255, 195, 0, 0.5)' : 'none'};"></span>
                        </label>
                    </div>
                    ${this.yoloMode ? `
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255, 195, 0, 0.2);">
                            <div style="display: flex; align-items: center; gap: 8px; color: #ffa500; font-size: 11px;">
                                <i data-lucide="alert-triangle" style="width: 14px; height: 14px;"></i>
                                <span><strong>Warning:</strong> Claude can execute any command without asking for permission</span>
                            </div>
                            
                            <div style="margin-top: 12px; padding: 10px; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 140, 0, 0.2); border-radius: 6px;">
                                <div style="font-size: 11px; color: #ff8c00; font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                                    <span>🛡️</span>
                                    RECOMMENDED SAFETY BLOCKS (Even with YOLO)
                                </div>
                                <div style="font-size: 10px; color: #ffa500; line-height: 1.5;">
                                    <div style="margin-bottom: 6px;">
                                        <strong style="color: #ff6b6b;">Put these in DENY to prevent disasters:</strong>
                                        <div style="margin-left: 10px; margin-top: 4px;">
                                            • <code style="background: rgba(255, 0, 0, 0.15); padding: 1px 4px; border-radius: 2px;">Bash(rm -rf:*)</code> - Prevents accidental deletions<br/>
                                            • <code style="background: rgba(255, 0, 0, 0.15); padding: 1px 4px; border-radius: 2px;">Bash(git push --force:*)</code> - Protects git history<br/>
                                            • <code style="background: rgba(255, 0, 0, 0.15); padding: 1px 4px; border-radius: 2px;">Bash(sudo rm:*)</code> - Blocks system file deletion<br/>
                                            • <code style="background: rgba(255, 0, 0, 0.15); padding: 1px 4px; border-radius: 2px;">Bash(> /dev/sd:*)</code> - Prevents disk overwrites
                                        </div>
                                    </div>
                                    <div>
                                        <strong style="color: #ffc107;">Consider putting in ASK for review:</strong>
                                        <div style="margin-left: 10px; margin-top: 4px;">
                                            • <code style="background: rgba(255, 193, 7, 0.15); padding: 1px 4px; border-radius: 2px;">Bash(git push:*)</code> - Review before pushing<br/>
                                            • <code style="background: rgba(255, 193, 7, 0.15); padding: 1px 4px; border-radius: 2px;">Bash(git rebase:*)</code> - Complex history changes<br/>
                                            • <code style="background: rgba(255, 193, 7, 0.15); padding: 1px 4px; border-radius: 2px;">Bash(npm publish:*)</code> - Package publishing<br/>
                                            • <code style="background: rgba(255, 193, 7, 0.15); padding: 1px 4px; border-radius: 2px;">DeleteFile</code> - File deletion confirmation
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>
                
                <style>
                    @keyframes pulse {
                        0% { opacity: 1; }
                        50% { opacity: 0.7; }
                        100% { opacity: 1; }
                    }
                    
                    .group-toggle-btn {
                        position: relative;
                        overflow: hidden;
                    }
                    
                    .group-toggle-btn:hover {
                        transform: scale(1.05);
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                    }
                    
                    .group-toggle-btn:active {
                        transform: scale(0.98);
                    }
                    
                    .group-toggle-btn svg {
                        pointer-events: none;
                    }
                    
                    .group-toggle-btn.active {
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                    }
                    
                    .group-toggle-btn:not(.active):hover {
                        opacity: 0.8;
                    }
                </style>
            </div>
            
            <div style="margin-top: 25px; margin-bottom: 15px; padding: 0 12px; text-align: center;">
                <h3 style="margin: 0; color: #a8b2ff; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px; justify-content: center;">
                    <i data-lucide="sliders" style="width: 16px; height: 16px;"></i>
                    Configure Tool Permissions
                </h3>
                <p style="margin: 5px 0 0 0; font-size: 11px; color: #888;">
                    Fine-tune which tools Claude can use automatically in your workflow
                </p>
            </div>
            
            <div class="permission-legend-section" style="margin: 15px 12px; padding: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px;">
                <div class="permission-legend" style="display: flex; gap: 25px; font-size: 12px; margin-bottom: 8px; justify-content: center;">
                    <span class="legend-item" style="display: flex; align-items: center; gap: 6px;">
                        <span class="legend-dot allow" style="width: 10px; height: 10px; background: #4caf50; border-radius: 50%; display: inline-block;"></span>
                        <span><b style="color: #4caf50;">Allow</b> - Auto-run</span>
                    </span>
                    <span class="legend-item" style="display: flex; align-items: center; gap: 6px;">
                        <span class="legend-dot ask" style="width: 10px; height: 10px; background: #d4a644; border-radius: 50%; display: inline-block;"></span>
                        <span><b style="color: #d4a644;">Ask</b> - Confirm</span>
                    </span>
                    <span class="legend-item" style="display: flex; align-items: center; gap: 6px;">
                        <span class="legend-dot deny" style="width: 10px; height: 10px; background: #f44336; border-radius: 50%; display: inline-block;"></span>
                        <span><b style="color: #f44336;">Deny</b> - Block</span>
                    </span>
                </div>
                <div style="font-size: 11px; color: #888; line-height: 1.4; text-align: center;">
                    Set permissions for each tool. These apply when using <code style="background: #333; padding: 1px 4px; border-radius: 3px; font-size: 10px;">--auto-accept</code> mode.
                    In normal mode, Claude always asks for confirmation.
                </div>
            </div>
            
            <div class="permissions-search" style="margin-top: 15px; position: relative; padding: 0 12px;">
                <input type="text" 
                       id="permissions-search" 
                       placeholder="Search tools..." 
                       value="${this.searchQuery}"
                       style="width: 100%; padding: 8px 12px 8px 40px; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; color: #fff;">
                <i data-lucide="search" style="position: absolute; left: 22px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: #666; pointer-events: none;"></i>
            </div>
            
            
            <div id="global-permissions-list" class="mcp-permissions-list" style="margin-top: 15px;">
                ${groupedPermissions.map(([category, perms]) => this.renderPermissionGroup(category, perms)).join('')}
            </div>
            
            <div class="custom-command-section" style="margin: 25px 12px; padding: 16px; background: linear-gradient(135deg, rgba(75, 0, 130, 0.05) 0%, rgba(138, 43, 226, 0.05) 100%); border: 1px dashed rgba(138, 43, 226, 0.3); border-radius: 10px; position: relative;">
                <div style="position: absolute; top: -10px; left: 20px; background: #0d0d0d; padding: 0 10px;">
                    <span style="font-size: 10px; color: #8a2be2; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">
                        <i data-lucide="plus-circle" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 4px;"></i>
                        Extend Permissions
                    </span>
                </div>
                <div style="margin-top: 8px;">
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <div style="position: relative; flex: 1;">
                            <i data-lucide="terminal" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; color: #8a2be2; opacity: 0.6;"></i>
                            <input type="text" 
                                   id="custom-command-input" 
                                   placeholder="Add custom Bash pattern..." 
                                   style="width: 100%; padding: 8px 10px 8px 34px; background: rgba(26, 26, 26, 0.8); border: 1px solid rgba(138, 43, 226, 0.2); border-radius: 6px; color: #fff; font-size: 12px; transition: all 0.2s;">
                        </div>
                        <button id="add-custom-command" 
                                style="padding: 8px 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; box-shadow: 0 2px 5px rgba(102, 126, 234, 0.2);">
                            <i data-lucide="plus" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 4px;"></i>
                            Add
                        </button>
                    </div>
                    <div style="margin-top: 10px; padding: 8px; background: rgba(0, 0, 0, 0.2); border-radius: 4px; border-left: 2px solid #8a2be2;">
                        <div style="font-size: 10px; color: #8a2be2; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; font-weight: 600;">Examples:</div>
                        <div style="font-size: 11px; color: #aaa; line-height: 1.6;">
                            <code style="background: rgba(138, 43, 226, 0.1); padding: 2px 5px; border-radius: 3px; margin-right: 8px;">Bash(kubectl:*)</code> for Kubernetes<br>
                            <code style="background: rgba(138, 43, 226, 0.1); padding: 2px 5px; border-radius: 3px; margin-right: 8px;">Bash(aws:*)</code> for AWS CLI<br>
                            <code style="background: rgba(138, 43, 226, 0.1); padding: 2px 5px; border-radius: 3px; margin-right: 8px;">Bash(terraform:*)</code> for Terraform
                        </div>
                    </div>
                </div>
            </div>
            
            <div style="margin-top: 25px; margin-bottom: 10px; display: flex; justify-content: center; align-items: center;">
                <div style="font-size: 11px; color: #999; display: flex; align-items: center; gap: 6px;">
                    <i data-lucide="check-circle" style="width: 13px; height: 13px; color: #4caf50;"></i>
                    <span>Changes are saved automatically</span>
                </div>
            </div>
        `;
        
        this.setupDynamicListeners();
        this.setupEventListeners();
        this.setupGroupToggleListeners();
        
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }
    
    getGroupedPermissions() {
        const filtered = this.getFilteredPermissions();
        const grouped = {};
        
        filtered.forEach(perm => {
            const category = perm.category || 'other';
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push(perm);
        });
        
        // Define fixed category order - this ensures consistent ordering
        const categoryOrder = ['file', 'command-git', 'command-package', 'command-file', 'command-system', 'command-network', 'command-dev', 'search', 'web', 'task', 'other'];
        
        // Return as an array of [category, permissions] pairs to guarantee order
        const sortedPairs = [];
        
        // Add categories in the defined order
        categoryOrder.forEach(cat => {
            if (grouped[cat]) {
                sortedPairs.push([cat, grouped[cat]]);
            }
        });
        
        // Add any remaining categories not in our predefined order
        Object.keys(grouped).forEach(cat => {
            if (!categoryOrder.includes(cat)) {
                sortedPairs.push([cat, grouped[cat]]);
            }
        });
        
        return sortedPairs;
    }
    
    renderPermissionGroup(category, permissions) {
        const categoryInfo = this.categories[category] || { name: category, icon: 'tool' };
        const groupId = `group-${category}`;
        
        // Get icon HTML based on category
        const iconHtml = this.getCategoryIcon(category);
        
        // Check if all items in this group have the same permission
        const allAllow = permissions.every(p => p.permission_type === 'allow');
        const allDeny = permissions.every(p => p.permission_type === 'deny');
        const allAsk = permissions.every(p => p.permission_type === 'ask');
        
        // Don't show toggle controls when searching
        const showToggleControls = !this.searchQuery;
        
        return `
            <div class="permission-group" data-category="${category}">
                <div class="permission-group-header ${this.expandedGroups && this.expandedGroups.has(groupId) ? 'expanded' : ''}" data-group="${groupId}" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 10px; flex: 1; pointer-events: none;">
                        <div class="permission-group-title" style="display: flex; align-items: center; gap: 8px;">
                            ${iconHtml}
                            <span>${categoryInfo.name}</span>
                        </div>
                        <div class="permission-group-status" style="font-size: 12px; color: #888;">${permissions.length} tools</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        ${showToggleControls ? `
                            <div class="group-toggle-controls" style="display: flex; gap: 4px; margin-right: 8px; padding: 3px; background: rgba(0, 0, 0, 0.3); border-radius: 4px;">
                                <button class="group-toggle-btn ${allDeny ? 'active' : ''}" 
                                        data-category="${category}" 
                                        data-permission="deny"
                                        title="Deny all in group"
                                        style="display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0; background: ${allDeny ? '#f44336' : 'transparent'}; color: ${allDeny ? '#fff' : '#f44336'}; border: 1px solid ${allDeny ? '#f44336' : 'rgba(244, 67, 54, 0.3)'}; border-radius: 4px; cursor: pointer; transition: all 0.2s; line-height: 1;">
                                    <i data-lucide="x" style="width: 14px; height: 14px; display: block;"></i>
                                </button>
                                <button class="group-toggle-btn ${allAsk ? 'active' : ''}" 
                                        data-category="${category}" 
                                        data-permission="ask"
                                        title="Ask for all in group"
                                        style="display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0; background: ${allAsk ? '#d4a644' : 'transparent'}; color: ${allAsk ? '#fff' : '#d4a644'}; border: 1px solid ${allAsk ? '#d4a644' : 'rgba(212, 166, 68, 0.3)'}; border-radius: 4px; cursor: pointer; transition: all 0.2s; line-height: 1;">
                                    <i data-lucide="help-circle" style="width: 14px; height: 14px; display: block;"></i>
                                </button>
                                <button class="group-toggle-btn ${allAllow ? 'active' : ''}" 
                                        data-category="${category}" 
                                        data-permission="allow"
                                        title="Allow all in group"
                                        style="display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0; background: ${allAllow ? '#4caf50' : 'transparent'}; color: ${allAllow ? '#fff' : '#4caf50'}; border: 1px solid ${allAllow ? '#4caf50' : 'rgba(76, 175, 80, 0.3)'}; border-radius: 4px; cursor: pointer; transition: all 0.2s; line-height: 1;">
                                    <i data-lucide="check" style="width: 14px; height: 14px; display: block;"></i>
                                </button>
                            </div>
                        ` : ''}
                        <button class="collapse-all-btn" data-group="${groupId}" style="padding: 4px 10px; background: rgba(100, 100, 255, 0.1); border: 1px solid rgba(100, 100, 255, 0.3); border-radius: 4px; color: #8b8bff; font-size: 11px; cursor: pointer; transition: all 0.2s; pointer-events: none;">
                            <i data-lucide="${this.expandedGroups && this.expandedGroups.has(groupId) ? 'chevrons-up' : 'chevrons-down'}" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i>
                            ${this.expandedGroups && this.expandedGroups.has(groupId) ? 'Collapse' : 'Expand'}
                        </button>
                    </div>
                </div>
                <div class="permission-items" id="${groupId}" style="display: ${this.expandedGroups && this.expandedGroups.has(groupId) ? 'block' : 'none'};">
                    ${permissions.map(perm => this.renderGroupPermissionItem(perm)).join('')}
                </div>
            </div>
        `;
    }
    
    getCategoryIcon(category) {
        const icons = {
            file: '<i data-lucide="file-text"></i>',
            'command-git': '<i data-lucide="git-branch"></i>',
            'command-package': '<i data-lucide="package"></i>',
            'command-file': '<i data-lucide="folder"></i>',
            'command-system': '<i data-lucide="cpu"></i>',
            'command-network': '<i data-lucide="wifi"></i>',
            'command-dev': '<i data-lucide="code"></i>',
            search: '<i data-lucide="search"></i>',
            web: '<i data-lucide="globe"></i>',
            task: '<i data-lucide="check-square"></i>',
            general: '<i data-lucide="alert-triangle"></i>',
            other: '<i data-lucide="tool"></i>'
        };
        
        return icons[category] || icons.other;
    }
    
    renderGroupPermissionItem(perm) {
        const isChanged = this.changes.has(perm.tool_name);
        
        return `
            <div class="permission-item ${isChanged ? 'changed' : ''}">
                <span class="permission-tool-name">${perm.tool_name}</span>
                <div class="permission-controls">
                    <button class="permission-btn deny ${perm.permission_type === 'deny' ? 'active' : ''}" 
                            data-tool="${perm.tool_name}" 
                            data-permission="deny">
                        Deny
                    </button>
                    <button class="permission-btn ask ${perm.permission_type === 'ask' ? 'active' : ''}" 
                            data-tool="${perm.tool_name}" 
                            data-permission="ask">
                        Ask
                    </button>
                    <button class="permission-btn allow ${perm.permission_type === 'allow' ? 'active' : ''}" 
                            data-tool="${perm.tool_name}" 
                            data-permission="allow">
                        Allow
                    </button>
                </div>
            </div>
        `;
    }
    
    setupGroupToggleListeners() {
        // Prevent clicks in permission-items from bubbling up
        document.querySelectorAll('.permission-items').forEach(items => {
            items.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });
        
        // Handle clicks on the entire group header
        document.querySelectorAll('.permission-group-header').forEach(header => {
            header.addEventListener('click', (e) => {
                // Don't toggle if clicking on group toggle buttons
                if (e.target.closest('.group-toggle-controls') || e.target.classList.contains('group-toggle-btn')) {
                    return;
                }
                
                const groupId = header.dataset.group;
                const items = document.getElementById(groupId);
                const collapseBtn = header.querySelector('.collapse-all-btn');
                
                if (items) {
                    const isVisible = items.style.display !== 'none';
                    items.style.display = isVisible ? 'none' : 'block';
                    header.classList.toggle('expanded', !isVisible);
                    
                    // Update our tracking state
                    if (isVisible) {
                        this.expandedGroups.delete(groupId);
                    } else {
                        this.expandedGroups.add(groupId);
                    }
                    
                    // Update collapse button text and icon
                    if (collapseBtn) {
                        if (isVisible) {
                            // Group is now collapsed
                            collapseBtn.innerHTML = '<i data-lucide="chevrons-down" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i> Expand';
                        } else {
                            // Group is now expanded
                            collapseBtn.innerHTML = '<i data-lucide="chevrons-up" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i> Collapse';
                        }
                        if (window.lucide) {
                            window.lucide.createIcons();
                        }
                    }
                }
            });
        });
        
        // Add click handlers for group toggle buttons
        document.querySelectorAll('.group-toggle-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const category = btn.dataset.category;
                const permission = btn.dataset.permission;
                
                // Find all permissions in this category
                // getGroupedPermissions returns an array of [category, permissions] pairs
                const groupedPerms = this.getGroupedPermissions();
                let categoryPerms = [];
                
                // Find the permissions for this specific category
                for (const [cat, perms] of groupedPerms) {
                    if (cat === category) {
                        categoryPerms = perms;
                        break;
                    }
                }
                
                // Update all permissions in this category
                categoryPerms.forEach(perm => {
                    perm.permission_type = permission;
                    this.changes.add(perm.tool_name);
                    // Update button states for each tool in the group
                    this.updateButtonStates(perm.tool_name, permission);
                });
                
                // Update the group toggle button states
                document.querySelectorAll(`.group-toggle-btn[data-category="${category}"]`).forEach(groupBtn => {
                    if (groupBtn.dataset.permission === permission) {
                        groupBtn.classList.add('active');
                        // Update styles for active state
                        if (permission === 'allow') {
                            groupBtn.style.background = '#4caf50';
                            groupBtn.style.color = '#fff';
                        } else if (permission === 'ask') {
                            groupBtn.style.background = '#d4a644';
                            groupBtn.style.color = '#fff';
                        } else if (permission === 'deny') {
                            groupBtn.style.background = '#f44336';
                            groupBtn.style.color = '#fff';
                        }
                    } else {
                        groupBtn.classList.remove('active');
                        // Update styles for inactive state
                        groupBtn.style.background = 'transparent';
                        if (groupBtn.dataset.permission === 'allow') {
                            groupBtn.style.color = '#4caf50';
                        } else if (groupBtn.dataset.permission === 'ask') {
                            groupBtn.style.color = '#d4a644';
                        } else if (groupBtn.dataset.permission === 'deny') {
                            groupBtn.style.color = '#f44336';
                        }
                    }
                });
                
                // If changing any permission when YOLO is on to something other than allow, turn off YOLO
                let yoloWasTurnedOff = false;
                if (this.yoloMode && permission !== 'allow') {
                    this.yoloMode = false;
                    yoloWasTurnedOff = true;
                    // Update the toggle state locally without re-rendering
                    const yoloToggle = document.getElementById('yolo-mode-toggle');
                    if (yoloToggle) {
                        yoloToggle.checked = false;
                    }
                }
                
                // Apply changes silently
                await this.applyChanges(true);
                
                // If YOLO was turned off, we need to re-render to show real permission states
                if (yoloWasTurnedOff) {
                    this.renderWithExpandedGroups();
                }
            });
        });
        
        // Add click handlers for permission buttons in grouped layout
        document.querySelectorAll('.permission-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.stopImmediatePropagation(); // Stop all event propagation
                e.preventDefault();
                
                const toolName = btn.dataset.tool;
                const permission = btn.dataset.permission;
                
                // Update permission directly with preserved expanded state
                const perm = this.permissions.find(p => p.tool_name === toolName);
                if (perm) {
                    perm.permission_type = permission;
                    this.changes.add(toolName);
                    
                    // If changing any permission when YOLO is on, turn off YOLO
                    let yoloWasTurnedOff = false;
                    if (this.yoloMode && permission !== 'allow') {
                        this.yoloMode = false;
                        yoloWasTurnedOff = true;
                        
                        // Update the YOLO toggle UI locally without re-rendering
                        const yoloToggle = document.getElementById('yolo-mode-toggle');
                        if (yoloToggle) {
                            yoloToggle.checked = false;
                        }
                    }
                    
                    // If YOLO was NOT turned off, update button states locally
                    if (!yoloWasTurnedOff) {
                        // Update the button states WITHOUT re-rendering the entire component
                        this.updateButtonStates(toolName, permission);
                        
                        // Apply changes silently (no re-render because silent=true)
                        await this.applyChanges(true);
                    } else {
                        // YOLO was turned off - we need to re-render to show real permission states
                        // Apply changes first
                        await this.applyChanges(true);
                        
                        // Then re-render with preserved scroll and expanded groups
                        this.renderWithExpandedGroups();
                    }
                }
            });
        });
    }
    
    updateButtonStates(toolName, newPermission) {
        // Update the button states for a specific tool without re-rendering
        const buttons = document.querySelectorAll(`.permission-btn[data-tool="${toolName}"]`);
        buttons.forEach(btn => {
            const btnPermission = btn.dataset.permission;
            if (btnPermission === newPermission) {
                btn.classList.add('active');
                // Update button styles for active state
                if (btnPermission === 'allow') {
                    btn.style.background = '#4caf50';
                    btn.style.color = '#fff';
                    btn.style.border = '1px solid #4caf50';
                } else if (btnPermission === 'ask') {
                    btn.style.background = '#d4a644';
                    btn.style.color = '#fff';
                    btn.style.border = '1px solid #d4a644';
                } else if (btnPermission === 'deny') {
                    btn.style.background = '#f44336';
                    btn.style.color = '#fff';
                    btn.style.border = '1px solid #f44336';
                }
            } else {
                btn.classList.remove('active');
                // Update button styles for inactive state
                if (btnPermission === 'allow') {
                    btn.style.background = 'transparent';
                    btn.style.color = '#4caf50';
                    btn.style.border = '1px solid rgba(76, 175, 80, 0.3)';
                } else if (btnPermission === 'ask') {
                    btn.style.background = 'transparent';
                    btn.style.color = '#d4a644';
                    btn.style.border = '1px solid rgba(212, 166, 68, 0.3)';
                } else if (btnPermission === 'deny') {
                    btn.style.background = 'transparent';
                    btn.style.color = '#f44336';
                    btn.style.border = '1px solid rgba(244, 67, 54, 0.3)';
                }
            }
        });
    }
    
    saveExpandedGroups() {
        this.expandedGroups = new Set();
        document.querySelectorAll('.permission-items').forEach(items => {
            if (items.style.display !== 'none') {
                this.expandedGroups.add(items.id);
            }
        });
    }
    
    renderWithExpandedGroups() {
        // Save the current scroll position of the modal body BEFORE re-render
        const modalBody = document.querySelector('.modal-body');
        let savedScrollTop = 0;
        let visibleToolName = null;
        let relativeOffset = 0;
        
        if (modalBody) {
            savedScrollTop = modalBody.scrollTop;
            console.log('[GlobalPermissions] Current scroll position:', savedScrollTop);
            
            // Find which tool is currently visible at the clicked position or viewport center
            const activeElement = document.activeElement;
            
            if (activeElement && activeElement.classList.contains('permission-btn')) {
                // User clicked a permission button - track that specific item
                const permItem = activeElement.closest('.permission-item');
                if (permItem) {
                    const toolNameEl = permItem.querySelector('.permission-tool-name');
                    if (toolNameEl) {
                        visibleToolName = toolNameEl.textContent.trim();
                        // Calculate relative position within viewport
                        const modalRect = modalBody.getBoundingClientRect();
                        const itemRect = permItem.getBoundingClientRect();
                        relativeOffset = itemRect.top - modalRect.top;
                        console.log('[GlobalPermissions] Clicked tool:', visibleToolName, 'relative offset:', relativeOffset);
                    }
                }
            } else {
                // Find the element at the top of the viewport
                const items = document.querySelectorAll('.permission-item');
                const modalRect = modalBody.getBoundingClientRect();
                
                for (let item of items) {
                    const rect = item.getBoundingClientRect();
                    // Find first item that's visible at the top of viewport
                    if (rect.top >= modalRect.top && rect.top < modalRect.bottom) {
                        const toolNameEl = item.querySelector('.permission-tool-name');
                        if (toolNameEl) {
                            visibleToolName = toolNameEl.textContent.trim();
                            relativeOffset = rect.top - modalRect.top;
                            console.log('[GlobalPermissions] Top visible tool:', visibleToolName, 'relative offset:', relativeOffset);
                            break;
                        }
                    }
                }
            }
        }
        
        // Save current search value before re-rendering
        const searchInput = document.getElementById('permissions-search');
        const currentSearchValue = searchInput ? searchInput.value : '';
        
        // IMPORTANT: Update the search query BEFORE rendering so getFilteredPermissions works correctly
        this.searchQuery = currentSearchValue;
        
        // Save current expanded state before re-rendering
        // We need to check which groups are currently expanded in the DOM
        document.querySelectorAll('.permission-items').forEach(items => {
            // Check if the group is visible (not explicitly hidden)
            // Empty string or 'block' means visible, 'none' means hidden
            if (items.style.display !== 'none') {
                // Add to our tracking set
                this.expandedGroups.add(items.id);
            } else {
                // Remove from tracking set if it's collapsed
                this.expandedGroups.delete(items.id);
            }
        });
        
        this.render();
        
        // Restore search value after render
        const newSearchInput = document.getElementById('permissions-search');
        if (newSearchInput) {
            newSearchInput.value = currentSearchValue;
            // No need to call filterAndUpdateGroups since render already applied the filter
            
            // Restore focus if needed (e.g., when search was cleared)
            if (this.shouldRestoreFocus) {
                newSearchInput.focus();
                // Move cursor to end of input
                newSearchInput.setSelectionRange(newSearchInput.value.length, newSearchInput.value.length);
                this.shouldRestoreFocus = false;
            }
        }
        
        // Restore expanded groups (always restore, even with search)
        if (this.expandedGroups && this.expandedGroups.size > 0) {
            this.expandedGroups.forEach(groupId => {
                const items = document.getElementById(groupId);
                const header = document.querySelector(`[data-group="${groupId}"]`);
                if (items && header) {
                    items.style.display = 'block';
                    header.classList.add('expanded');
                    const collapseBtn = header.querySelector('.collapse-all-btn');
                    if (collapseBtn) {
                        collapseBtn.innerHTML = '<i data-lucide="chevrons-up" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i> Collapse';
                    }
                }
            });
            if (window.lucide) {
                window.lucide.createIcons();
            }
        }
        
        // If there's an active search, make sure to expand groups with results
        if (currentSearchValue) {
            // Call filterAndUpdateGroups to ensure proper visibility
            setTimeout(() => {
                this.filterAndUpdateGroups();
            }, 0);
        }
        
        // Restore scroll position after re-rendering
        // Simple approach: just restore the exact scroll position
        if (savedScrollTop > 0) {
            console.log('[GlobalPermissions] Will restore scroll position:', savedScrollTop);
            
            // Try multiple times to ensure it sticks
            const restoreScroll = () => {
                const newModalBody = document.querySelector('.modal-body');
                if (newModalBody) {
                    newModalBody.scrollTop = savedScrollTop;
                    console.log('[GlobalPermissions] Restored scroll to:', savedScrollTop);
                }
            };
            
            // Immediate restore
            restoreScroll();
            
            // After next frame
            requestAnimationFrame(() => {
                restoreScroll();
                
                // After a small delay for final layout
                setTimeout(restoreScroll, 50);
                setTimeout(restoreScroll, 100);
            });
        }
    }
    
    addCustomCommand() {
        const input = document.getElementById('custom-command-input');
        if (!input) return;
        
        const value = input.value.trim();
        if (!value) return;
        
        // Validate format
        if (!value.startsWith('Bash(') || !value.endsWith(')')) {
            this.showNotification('Invalid format. Use: Bash(command:*)', 'error');
            return;
        }
        
        // Determine the correct category based on the command
        let category = 'command-dev'; // Default to dev tools
        const commandPart = value.match(/Bash\(([^:]+)/);
        if (commandPart) {
            const cmd = commandPart[1].toLowerCase();
            if (cmd.startsWith('git')) category = 'command-git';
            else if (['npm', 'yarn', 'pnpm', 'pip', 'brew', 'apt'].includes(cmd)) category = 'command-package';
            else if (['ls', 'cd', 'mkdir', 'cp', 'mv', 'rm', 'cat', 'echo', 'grep', 'find'].includes(cmd)) category = 'command-file';
            else if (['sudo', 'chmod', 'chown', 'ps', 'kill'].includes(cmd)) category = 'command-system';
            else if (['curl', 'wget', 'ssh', 'scp'].includes(cmd)) category = 'command-network';
        }
        
        // Add to tools list
        const customTool = {
            name: value,
            category: category,
            description: 'Custom command pattern'
        };
        
        // Check if already exists
        if (this.allTools.some(t => t.name === value)) {
            this.showNotification('This pattern already exists', 'error');
            return;
        }
        
        this.allTools.push(customTool);
        
        // Add to permissions with default 'ask' state
        this.permissions.push({
            tool_name: value,
            permission_type: 'ask',
            description: customTool.description,
            category: 'command'
        });
        
        this.changes.add(value);
        
        // Auto-save the new custom command
        this.applyChanges(true);
        
        // Clear input and re-render
        input.value = '';
        this.showNotification(`Added custom pattern: ${value}`, 'success');
        this.render();
    }
    
    filterAndUpdateGroups() {
        // Filter permissions without re-rendering everything
        const query = this.searchQuery.toLowerCase();
        
        document.querySelectorAll('.permission-group').forEach(group => {
            const header = group.querySelector('.permission-group-header');
            const itemsContainer = group.querySelector('.permission-items');
            const items = group.querySelectorAll('.permission-item');
            const collapseBtn = group.querySelector('.collapse-all-btn');
            let visibleCount = 0;
            
            items.forEach(item => {
                const toolName = item.querySelector('.permission-tool-name').textContent.toLowerCase();
                const isVisible = !query || toolName.includes(query);
                item.style.display = isVisible ? 'flex' : 'none';
                if (isVisible) visibleCount++;
            });
            
            // Hide entire group if no items match
            group.style.display = visibleCount > 0 ? 'block' : 'none';
            
            // If there's a search query and this group has results, expand it
            if (query && visibleCount > 0 && itemsContainer) {
                itemsContainer.style.display = 'block';
                header.classList.add('expanded');
                // Update button to show collapse
                if (collapseBtn) {
                    collapseBtn.innerHTML = '<i data-lucide="chevrons-up" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i> Collapse';
                    if (window.lucide) {
                        window.lucide.createIcons();
                    }
                }
            } else if (!query && itemsContainer) {
                // When search is cleared, collapse all groups back
                itemsContainer.style.display = 'none';
                header.classList.remove('expanded');
                // Update button to show expand
                if (collapseBtn) {
                    collapseBtn.innerHTML = '<i data-lucide="chevrons-down" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i> Expand';
                    if (window.lucide) {
                        window.lucide.createIcons();
                    }
                }
            }
            
            // Update count in group header
            const statusEl = group.querySelector('.permission-group-status');
            if (statusEl) {
                if (query && visibleCount < items.length) {
                    statusEl.textContent = `${visibleCount} of ${items.length} tools`;
                } else {
                    statusEl.textContent = `${visibleCount} tools`;
                }
            }
        });
    }
    
    setupDynamicListeners() {
        // Dynamic listeners are now handled in setupGroupToggleListeners
    }
    
    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `permission-notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('show'), 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.GlobalPermissionsFileManager = GlobalPermissionsFileManager;
}
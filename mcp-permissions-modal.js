// MCP Permissions Modal Manager
class MCPPermissionsModal {
    constructor() {
        this.pendingChanges = {};
        this.modal = document.getElementById('permissions-modal');
    }
    
    async show() {
        if (!this.modal) return;
        
        // Load current permissions
        await this.loadPermissions();
        
        // Show modal
        this.modal.style.display = 'flex';
        document.body.classList.add('modal-open');
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Re-render lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
    
    async loadPermissions() {
        const permissionsList = document.getElementById('mcp-permissions-list');
        if (!permissionsList) return;
        
        try {
            // Get current settings
            const settings = await this.getClaudeSettings();
            const permissions = settings.permissions || { allow: [], deny: [] };
            
            // Get MCP servers
            const mcpServers = await this.detectMCPServers();
            
            // Build HTML for permissions
            let html = '';
            
            for (const [serverKey, server] of Object.entries(mcpServers)) {
                // Use logo image if available, otherwise use default icon
                const iconHtml = server.logo 
                    ? `<img src="${server.logo}" alt="${server.displayName}" style="width: 24px; height: 24px; object-fit: contain;">`
                    : '<i data-lucide="puzzle"></i>';
                
                html += `
                    <div class="permission-group" data-server="${serverKey}">
                        <div class="permission-group-header">
                            <div class="permission-group-title">
                                ${iconHtml}
                                <span>${server.displayName}</span>
                            </div>
                            <div class="permission-group-status">${server.tools.length} tools</div>
                        </div>
                        <div class="permission-items" style="display: none;">
                            ${this.renderTools(serverKey, server.tools, permissions)}
                        </div>
                    </div>
                `;
            }
            
            permissionsList.innerHTML = html;
            
            // Setup group expansion
            document.querySelectorAll('.permission-group-header').forEach(header => {
                header.addEventListener('click', () => {
                    const group = header.parentElement;
                    const items = group.querySelector('.permission-items');
                    group.classList.toggle('expanded');
                    items.style.display = group.classList.contains('expanded') ? 'block' : 'none';
                });
            });
            
            // Setup permission buttons
            document.querySelectorAll('.permission-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tool = btn.dataset.tool;
                    const permission = btn.dataset.permission;
                    this.setPermission(tool, permission, btn);
                });
            });
            
            // Re-render icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            
        } catch (error) {
            console.error('Error loading permissions:', error);
            permissionsList.innerHTML = '<p style="padding: 20px; color: #888;">Error loading permissions</p>';
        }
    }
    
    renderTools(serverKey, tools, currentPermissions) {
        return tools.map(tool => {
            const fullName = `mcp__${serverKey}__${tool}`;
            const permission = this.getToolPermission(fullName, currentPermissions);
            
            return `
                <div class="permission-item">
                    <span class="permission-tool-name">${tool}</span>
                    <div class="permission-controls">
                        <button class="permission-btn deny ${permission === 'deny' ? 'active' : ''}" 
                                data-tool="${fullName}" data-permission="deny">
                            Deny
                        </button>
                        <button class="permission-btn ask ${permission === 'ask' ? 'active' : ''}"
                                data-tool="${fullName}" data-permission="ask">
                            Ask
                        </button>
                        <button class="permission-btn allow ${permission === 'allow' ? 'active' : ''}"
                                data-tool="${fullName}" data-permission="allow">
                            Allow
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    getToolPermission(toolName, permissions) {
        const allow = permissions.allow || [];
        const deny = permissions.deny || [];
        
        // Check for wildcards
        const serverWildcard = toolName.replace(/[^_]+$/, '*');
        
        if (allow.includes(toolName) || allow.includes(serverWildcard)) {
            return 'allow';
        } else if (deny.includes(toolName) || deny.includes(serverWildcard)) {
            return 'deny';
        }
        return 'ask';
    }
    
    setPermission(toolName, permission, btnElement) {
        // Update UI
        const controls = btnElement.parentElement;
        controls.querySelectorAll('.permission-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        btnElement.classList.add('active');
        
        // Track changes
        this.pendingChanges[toolName] = permission;
    }
    
    async detectMCPServers() {
        // Return known MCPs with real logo paths - excluding CodeAgentSwarm
        const servers = {
            'supabase': {
                displayName: 'Supabase',
                logo: 'assets/mcp-icons/supabase.png',
                tools: [
                    'list_projects', 'get_project', 'create_project', 'execute_sql',
                    'apply_migration', 'get_logs', 'search_docs', 'list_tables',
                    'generate_typescript_types', 'list_edge_functions', 'deploy_edge_function'
                ]
            },
            'notion': {
                displayName: 'Notion',
                logo: 'assets/mcp-icons/notion.png',
                tools: [
                    'query-database', 'create-page', 'update-page', 'search',
                    'append-block-children', 'list-databases', 'get-page', 'get-block'
                ]
            },
            'context7': {
                displayName: 'Context7',
                logo: null, // No logo file found, will use default
                tools: ['resolve-library-id', 'get-library-docs']
            },
            'filesystem': {
                displayName: 'Filesystem',
                logo: 'assets/mcp-icons/filesystem.png',
                tools: [
                    'read_text_file', 'read_media_file', 'read_multiple_files',
                    'write_file', 'edit_file', 'create_directory', 'list_directory',
                    'search_files', 'get_file_info', 'list_allowed_directories'
                ]
            },
            'brave-search': {
                displayName: 'Brave Search',
                logo: 'assets/mcp-icons/brave-search.png',
                tools: ['brave_web_search', 'brave_local_search']
            },
            'postgres': {
                displayName: 'PostgreSQL',
                logo: 'assets/mcp-icons/postgres.png',
                tools: ['query']
            }
        };
        
        // Add any other detected MCPs that aren't in our known list
        // These would get the default puzzle icon
        
        return servers;
    }
    
    async getClaudeSettings() {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        
        try {
            if (fs.existsSync(settingsPath)) {
                const content = fs.readFileSync(settingsPath, 'utf8');
                return JSON.parse(content);
            }
        } catch (error) {
            console.error('Error reading settings:', error);
        }
        
        return {};
    }
    
    setupEventListeners() {
        // Close button
        const closeBtn = document.getElementById('close-permissions');
        if (closeBtn) {
            closeBtn.onclick = () => {
                this.modal.style.display = 'none';
                document.body.classList.remove('modal-open');
                this.pendingChanges = {};
            };
        }
        
        // Save button
        const saveBtn = document.getElementById('save-permissions');
        if (saveBtn) {
            saveBtn.onclick = async () => {
                await this.savePermissions();
            };
        }
        
        // Reset button
        const resetBtn = document.getElementById('reset-permissions');
        if (resetBtn) {
            resetBtn.onclick = async () => {
                await this.resetPermissions();
            };
        }
        
        // Search functionality
        const searchInput = document.getElementById('permissions-search');
        if (searchInput) {
            searchInput.oninput = (e) => {
                const searchTerm = e.target.value.toLowerCase();
                document.querySelectorAll('.permission-item').forEach(item => {
                    const toolName = item.querySelector('.permission-tool-name').textContent.toLowerCase();
                    item.style.display = toolName.includes(searchTerm) ? 'flex' : 'none';
                });
                
                // Show/hide groups based on visible items
                document.querySelectorAll('.permission-group').forEach(group => {
                    const hasVisibleItems = group.querySelectorAll('.permission-item[style*="flex"]').length > 0;
                    group.style.display = hasVisibleItems || !searchTerm ? 'block' : 'none';
                });
            };
        }
    }
    
    async savePermissions() {
        if (Object.keys(this.pendingChanges).length === 0) {
            this.showNotification('No changes to save', 'info');
            return;
        }
        
        try {
            const fs = require('fs');
            const path = require('path');
            const os = require('os');
            
            const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
            const settings = await this.getClaudeSettings();
            
            if (!settings.permissions) {
                settings.permissions = { allow: [], deny: [] };
            }
            
            console.log('Pending changes:', this.pendingChanges);
            console.log('Current allow before changes:', settings.permissions.allow);
            
            // Apply pending changes
            for (const [tool, permission] of Object.entries(this.pendingChanges)) {
                // Remove from both arrays first (including wildcards)
                settings.permissions.allow = settings.permissions.allow.filter(t => t !== tool);
                settings.permissions.deny = (settings.permissions.deny || []).filter(t => t !== tool);
                
                // Also remove server wildcards if we're setting individual tools
                // Extract server name from tool (e.g., mcp__brave-search__tool -> mcp__brave-search__*)
                const serverWildcard = tool.substring(0, tool.lastIndexOf('__')) + '__*';
                
                console.log(`Processing tool: ${tool}, permission: ${permission}, wildcard: ${serverWildcard}`);
                
                // If we're modifying an individual tool, remove the wildcard for that server
                if (tool !== serverWildcard) {
                    console.log(`Removing wildcard: ${serverWildcard}`);
                    settings.permissions.allow = settings.permissions.allow.filter(t => t !== serverWildcard);
                    settings.permissions.deny = (settings.permissions.deny || []).filter(t => t !== serverWildcard);
                }
                
                // Add to appropriate array
                if (permission === 'allow') {
                    settings.permissions.allow.push(tool);
                } else if (permission === 'deny') {
                    if (!settings.permissions.deny) settings.permissions.deny = [];
                    settings.permissions.deny.push(tool);
                }
                // 'ask' means remove from both arrays (default behavior)
            }
            
            console.log('Final allow list:', settings.permissions.allow);
            console.log('Final deny list:', settings.permissions.deny);
            
            // Save settings
            const settingsDir = path.dirname(settingsPath);
            if (!fs.existsSync(settingsDir)) {
                fs.mkdirSync(settingsDir, { recursive: true });
            }
            
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
            
            this.showNotification('✅ Permissions saved successfully', 'success');
            this.pendingChanges = {};
            
            // Close modal after save
            setTimeout(() => {
                this.modal.style.display = 'none';
                document.body.classList.remove('modal-open');
            }, 1000);
            
        } catch (error) {
            console.error('Error saving permissions:', error);
            this.showNotification('❌ Failed to save permissions', 'error');
        }
    }
    
    async resetPermissions() {
        // Reset to default (everything asks for permission)
        this.pendingChanges = {};
        
        // Get all tools
        const allTools = [];
        document.querySelectorAll('.permission-item').forEach(item => {
            const toolBtns = item.querySelectorAll('[data-tool]');
            if (toolBtns.length > 0) {
                const tool = toolBtns[0].dataset.tool;
                allTools.push(tool);
            }
        });
        
        // Mark all as "ask" in pending changes
        allTools.forEach(tool => {
            this.pendingChanges[tool] = 'ask';
        });
        
        // Reset UI
        document.querySelectorAll('.permission-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.classList.contains('ask')) {
                btn.classList.add('active');
            }
        });
        
        this.showNotification('⚠️ Permissions reset. Click "Save Changes" to apply.', 'warning');
    }
    
    showNotification(message, type = 'info') {
        // Try to use existing notification system if available
        if (window.terminalManager && window.terminalManager.showInlineNotification) {
            window.terminalManager.showInlineNotification(message, type);
        } else {
            // Fallback to console
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}

// Export for use in renderer.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MCPPermissionsModal;
}
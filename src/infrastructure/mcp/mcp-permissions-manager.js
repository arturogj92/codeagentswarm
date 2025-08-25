const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

class MCPPermissionsManager {
    constructor() {
        this.settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        this.claudeConfigPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        this.currentSettings = {};
        this.originalSettings = {};
        this.mcpServers = {};
        this.changes = new Set();
        
        // Built-in tools
        this.builtinTools = [
            { name: 'Read', icon: 'file-text', description: 'Read files from filesystem' },
            { name: 'Write', icon: 'file-plus', description: 'Write files to filesystem' },
            { name: 'Edit', icon: 'edit', description: 'Edit existing files' },
            { name: 'MultiEdit', icon: 'edit-3', description: 'Multiple edits in one operation' },
            { name: 'NotebookEdit', icon: 'book-open', description: 'Edit Jupyter notebooks' },
            { name: 'Bash', icon: 'terminal', description: 'Execute bash commands' },
            { name: 'WebSearch', icon: 'search', description: 'Search the web' },
            { name: 'WebFetch', icon: 'globe', description: 'Fetch content from URLs' },
            { name: 'TodoWrite', icon: 'check-square', description: 'Manage todo lists' },
            { name: 'Task', icon: 'zap', description: 'Launch specialized agents' },
            { name: 'ExitPlanMode', icon: 'log-out', description: 'Exit planning mode' },
            { name: 'Grep', icon: 'filter', description: 'Search file contents' },
            { name: 'Glob', icon: 'folder-search', description: 'Find files by pattern' },
            { name: 'LS', icon: 'list', description: 'List directory contents' },
            { name: 'Search', icon: 'search', description: 'Search files and directories' },
            { name: 'BashOutput', icon: 'output', description: 'Get background shell output' },
            { name: 'KillBash', icon: 'x-circle', description: 'Kill background shell' }
        ];
        
        this.init();
    }
    
    async init() {
        await this.loadSettings();
        await this.detectMCPServers();
        this.setupEventListeners();
        this.render();
    }
    
    async loadSettings() {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const content = fs.readFileSync(this.settingsPath, 'utf8');
                this.currentSettings = JSON.parse(content);
                this.originalSettings = JSON.parse(content);
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }
    
    async detectMCPServers() {
        try {
            const allMcpServers = {};
            
            // Read from desktop config file
            if (fs.existsSync(this.claudeConfigPath)) {
                const config = JSON.parse(fs.readFileSync(this.claudeConfigPath, 'utf8'));
                const servers = config.mcpServers || {};
                Object.assign(allMcpServers, servers);
            }
            
            // Also read from user config file (~/.claude.json)
            const userConfigPath = path.join(os.homedir(), '.claude.json');
            if (fs.existsSync(userConfigPath)) {
                const userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
                const userServers = userConfig.mcpServers || {};
                Object.assign(allMcpServers, userServers);
            }
            
            // Process all detected MCP servers from both config files
            for (const [serverName, serverConfig] of Object.entries(allMcpServers)) {
                // Skip CodeAgentSwarm Tasks - it should be hidden from users
                if (serverName === 'codeagentswarm-tasks') {
                    continue;
                }
                
                // Use the original server name as-is (don't normalize)
                const displayName = this.formatServerName(serverName);
                
                // Get tools for this server
                const tools = await this.getMCPTools(serverName) || this.getDefaultTools(serverName);
                
                // Get logo if available
                const logo = this.getMCPLogo(serverName);
                
                this.mcpServers[serverName] = {
                    name: serverName,
                    displayName: displayName,
                    command: serverConfig.command,
                    args: serverConfig.args || [],
                    tools: tools,
                    logo: logo
                };
            }
        } catch (error) {
            console.error('Error detecting MCP servers:', error);
        }
    }
    
    formatServerName(name) {
        return name.split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }
    
    async getMCPTools(serverName) {
        // In production, this would connect to the MCP server and list available tools
        // For now, return predefined tools based on server name
        const toolMappings = {
            'codeagentswarm-tasks': [
                'create_task', 'start_task', 'complete_task', 'submit_for_testing',
                'list_tasks', 'search_tasks', 'update_task_plan', 'update_task_implementation',
                'update_task_terminal', 'update_terminal_title', 'create_project',
                'get_projects', 'get_project_tasks', 'create_subtask', 'get_subtasks',
                'link_task_to_parent', 'unlink_task_from_parent', 'get_task_hierarchy',
                'suggest_parent_tasks'
            ],
            'supabase': [
                'list_projects', 'get_project', 'create_project', 'pause_project',
                'restore_project', 'list_tables', 'list_extensions', 'list_migrations',
                'apply_migration', 'execute_sql', 'get_logs', 'get_advisors',
                'generate_typescript_types', 'search_docs', 'list_edge_functions',
                'deploy_edge_function', 'create_branch', 'list_branches', 'merge_branch'
            ],
            'notion': [
                'list-databases', 'query-database', 'create-page', 'update-page',
                'get-page', 'get-block', 'get-block-children', 'append-block-children',
                'update-block', 'create-database', 'update-database', 'search'
            ],
            'context7': [
                'resolve-library-id', 'get-library-docs'
            ],
            'filesystem': [
                'read_text_file', 'read_media_file', 'read_multiple_files',
                'write_file', 'edit_file', 'create_directory', 'list_directory',
                'list_directory_with_sizes', 'directory_tree', 'move_file',
                'search_files', 'get_file_info', 'list_allowed_directories'
            ],
            'brave-search': [
                'brave_web_search', 'brave_local_search'
            ],
            'postgres': [
                'query'
            ]
        };
        
        // Use the server name directly (no normalization needed since we're using actual names from config)
        return toolMappings[serverName] || [];
    }
    
    getDefaultTools(serverName) {
        // Fallback tools if we can't detect them
        return ['*']; // Wildcard for all tools
    }
    
    getMCPLogo(serverName) {
        // Map of known MCP logos
        const logoMap = {
            'supabase': '../../../assets/mcp-icons/supabase.png',
            'notion': '../../../assets/mcp-icons/notion.png',
            'filesystem': '../../../assets/mcp-icons/filesystem.png',
            'brave-search': '../../../assets/mcp-icons/brave-search.png',
            'postgres': '../../../assets/mcp-icons/postgres.png',
            'context7': null, // No logo, will use default icon
            'codeagentswarm-tasks': null // No logo, will use default icon
        };
        
        return logoMap[serverName] || null;
    }
    
    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });
        
        // Preset buttons
        document.getElementById('preset-safe').addEventListener('click', () => this.applyPreset('safe'));
        document.getElementById('preset-normal').addEventListener('click', () => this.applyPreset('normal'));
        document.getElementById('preset-yolo').addEventListener('click', () => this.applyPreset('yolo'));
        
        // Import/Export
        document.getElementById('import-config').addEventListener('click', () => this.showImportDialog());
        document.getElementById('export-config').addEventListener('click', () => this.exportConfig());
        
        // Apply/Reset
        document.getElementById('apply-changes').addEventListener('click', () => this.applyChanges());
        document.getElementById('reset-changes').addEventListener('click', () => this.resetChanges());
        
        // Close button
        document.getElementById('close-permissions').addEventListener('click', () => {
            window.close();
        });
        
        // Search
        const searchInput = document.getElementById('search-permissions');
        const clearButton = document.getElementById('clear-search');
        
        searchInput.addEventListener('input', (e) => {
            this.filterContent(e.target.value);
            clearButton.style.display = e.target.value ? 'block' : 'none';
        });
        
        clearButton.addEventListener('click', () => {
            searchInput.value = '';
            this.filterContent('');
            clearButton.style.display = 'none';
        });
        
        // Import dialog
        document.getElementById('cancel-import').addEventListener('click', () => {
            document.getElementById('import-dialog').style.display = 'none';
        });
        
        document.getElementById('confirm-import').addEventListener('click', () => {
            this.importConfig();
        });
    }
    
    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `tab-${tabName}`);
        });
    }
    
    render() {
        this.renderMCPServers();
        this.renderBuiltinTools();
        this.renderBashPatterns();
        this.renderFileRestrictions();
        this.renderWebDomains();
        
        // Initialize Lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }
    
    renderMCPServers() {
        const container = document.getElementById('mcp-servers');
        container.innerHTML = '';
        
        for (const [serverKey, server] of Object.entries(this.mcpServers)) {
            const serverEl = document.createElement('div');
            serverEl.className = 'mcp-server';
            serverEl.dataset.server = serverKey;
            
            const permissions = this.getServerPermissions(serverKey);
            const status = this.getServerStatus(permissions);
            
            // Use logo if available, otherwise use default puzzle icon
            const iconHtml = server.logo 
                ? `<img src="${server.logo}" alt="${server.displayName}" style="width: 24px; height: 24px; object-fit: contain;">`
                : '<i data-lucide="puzzle"></i>';
            
            serverEl.innerHTML = `
                <div class="mcp-server-header">
                    <div class="mcp-server-info">
                        <div class="mcp-server-icon">
                            ${iconHtml}
                        </div>
                        <div>
                            <div class="mcp-server-name">${server.displayName}</div>
                            <div class="function-description">${server.tools.length} tools available</div>
                        </div>
                    </div>
                    <div class="mcp-server-controls">
                        <div class="mcp-server-status ${status.class}">
                            <i data-lucide="${status.icon}"></i>
                            <span>${status.text}</span>
                        </div>
                        <i data-lucide="chevron-down" class="expand-icon"></i>
                    </div>
                </div>
                <div class="mcp-functions">
                    ${this.renderMCPFunctions(serverKey, server.tools)}
                </div>
            `;
            
            // Toggle expansion
            serverEl.querySelector('.mcp-server-header').addEventListener('click', () => {
                serverEl.classList.toggle('expanded');
                if (window.lucide) window.lucide.createIcons();
            });
            
            container.appendChild(serverEl);
        }
        
        if (window.lucide) window.lucide.createIcons();
    }
    
    renderMCPFunctions(serverKey, tools) {
        return tools.map(tool => {
            const fullToolName = `mcp__${serverKey}__${tool}`;
            const permission = this.getToolPermission(fullToolName);
            
            return `
                <div class="function-item" data-tool="${fullToolName}">
                    <div>
                        <div class="function-name">${tool}</div>
                        ${this.getToolDescription(tool) ? 
                            `<div class="function-description">${this.getToolDescription(tool)}</div>` : ''}
                    </div>
                    <div class="permission-selector">
                        <button class="permission-btn allow ${permission === 'allow' ? 'active' : ''}" 
                                data-tool="${fullToolName}" data-permission="allow">
                            <i data-lucide="check"></i> Allow
                        </button>
                        <button class="permission-btn ask ${permission === 'ask' ? 'active' : ''}"
                                data-tool="${fullToolName}" data-permission="ask">
                            <i data-lucide="help-circle"></i> Ask
                        </button>
                        <button class="permission-btn deny ${permission === 'deny' ? 'active' : ''}"
                                data-tool="${fullToolName}" data-permission="deny">
                            <i data-lucide="x"></i> Deny
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    getToolDescription(tool) {
        const descriptions = {
            'create_task': 'Create a new task in the system',
            'start_task': 'Mark a task as in progress',
            'complete_task': 'Mark a task as completed',
            'list_projects': 'List all Supabase projects',
            'execute_sql': 'Execute SQL queries',
            'query-database': 'Query Notion database',
            'resolve-library-id': 'Resolve library name to ID',
            'read_text_file': 'Read text files from filesystem'
        };
        return descriptions[tool] || '';
    }
    
    getServerPermissions(serverKey) {
        const permissions = this.currentSettings.permissions || {};
        const allow = permissions.allow || [];
        const deny = permissions.deny || [];
        
        const serverTools = this.mcpServers[serverKey].tools.map(t => `mcp__${serverKey}__${t}`);
        const allowedTools = serverTools.filter(t => 
            allow.includes(t) || allow.includes(`mcp__${serverKey}__*`)
        );
        const deniedTools = serverTools.filter(t => 
            deny.includes(t) || deny.includes(`mcp__${serverKey}__*`)
        );
        
        return { allowed: allowedTools.length, denied: deniedTools.length, total: serverTools.length };
    }
    
    getServerStatus(permissions) {
        if (permissions.allowed === permissions.total) {
            return { class: 'all-allowed', icon: 'shield-check', text: 'All Allowed' };
        } else if (permissions.denied === permissions.total) {
            return { class: 'all-denied', icon: 'shield-x', text: 'All Denied' };
        } else {
            return { class: 'mixed', icon: 'shield', text: 'Mixed' };
        }
    }
    
    getToolPermission(toolName) {
        const permissions = this.currentSettings.permissions || {};
        const allow = permissions.allow || [];
        const deny = permissions.deny || [];
        
        if (allow.includes(toolName) || allow.includes(toolName.replace(/[^_]+$/, '*'))) {
            return 'allow';
        } else if (deny.includes(toolName) || deny.includes(toolName.replace(/[^_]+$/, '*'))) {
            return 'deny';
        }
        return 'ask';
    }
    
    renderBuiltinTools() {
        const container = document.getElementById('builtin-tools');
        container.innerHTML = '';
        
        this.builtinTools.forEach(tool => {
            const permission = this.getBuiltinToolPermission(tool.name);
            const toolEl = document.createElement('div');
            toolEl.className = 'tool-card';
            toolEl.dataset.tool = tool.name;
            
            toolEl.innerHTML = `
                <div class="tool-card-header">
                    <div class="tool-name">${tool.name}</div>
                    <div class="tool-icon">
                        <i data-lucide="${tool.icon}"></i>
                    </div>
                </div>
                <div class="function-description">${tool.description}</div>
                <div class="permission-selector" style="margin-top: 0.75rem;">
                    <button class="permission-btn allow ${permission === 'allow' ? 'active' : ''}"
                            data-tool="${tool.name}" data-permission="allow">
                        Allow
                    </button>
                    <button class="permission-btn ask ${permission === 'ask' ? 'active' : ''}"
                            data-tool="${tool.name}" data-permission="ask">
                        Ask
                    </button>
                    <button class="permission-btn deny ${permission === 'deny' ? 'active' : ''}"
                            data-tool="${tool.name}" data-permission="deny">
                        Deny
                    </button>
                </div>
            `;
            
            container.appendChild(toolEl);
        });
        
        // Add event listeners for permission buttons
        container.querySelectorAll('.permission-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                const permission = btn.dataset.permission;
                this.setBuiltinToolPermission(tool, permission);
            });
        });
        
        if (window.lucide) window.lucide.createIcons();
    }
    
    getBuiltinToolPermission(toolName) {
        const permissions = this.currentSettings.permissions || {};
        const allow = permissions.allow || [];
        const deny = permissions.deny || [];
        
        if (allow.includes(toolName)) return 'allow';
        if (deny.includes(toolName)) return 'deny';
        return 'ask';
    }
    
    setBuiltinToolPermission(toolName, permission) {
        if (!this.currentSettings.permissions) {
            this.currentSettings.permissions = { allow: [], deny: [] };
        }
        
        const allow = this.currentSettings.permissions.allow || [];
        const deny = this.currentSettings.permissions.deny || [];
        
        // Remove from both arrays
        const allowIndex = allow.indexOf(toolName);
        const denyIndex = deny.indexOf(toolName);
        
        if (allowIndex > -1) allow.splice(allowIndex, 1);
        if (denyIndex > -1) deny.splice(denyIndex, 1);
        
        // Add to appropriate array
        if (permission === 'allow') {
            allow.push(toolName);
        } else if (permission === 'deny') {
            deny.push(toolName);
        }
        
        this.currentSettings.permissions.allow = allow;
        this.currentSettings.permissions.deny = deny;
        
        this.markAsChanged();
        this.renderBuiltinTools();
    }
    
    renderBashPatterns() {
        const container = document.getElementById('bash-patterns');
        container.innerHTML = '';
        
        // Get bash patterns from permissions
        const permissions = this.currentSettings.permissions || {};
        const bashPatterns = this.extractBashPatterns(permissions);
        
        bashPatterns.forEach((pattern, index) => {
            const patternEl = document.createElement('div');
            patternEl.className = 'pattern-item';
            patternEl.innerHTML = `
                <span class="pattern-text">Bash(${pattern.pattern})</span>
                <span class="pattern-type ${pattern.type}">${pattern.type.toUpperCase()}</span>
                <button class="remove-btn" data-index="${index}">
                    <i data-lucide="x"></i>
                </button>
            `;
            container.appendChild(patternEl);
        });
        
        // Add pattern button
        document.getElementById('add-bash-pattern').onclick = () => {
            const input = document.getElementById('new-bash-pattern');
            const type = document.getElementById('bash-permission-type').value;
            
            if (input.value.trim()) {
                this.addBashPattern(input.value.trim(), type);
                input.value = '';
            }
        };
        
        // Remove pattern buttons
        container.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.removeBashPattern(parseInt(btn.dataset.index));
            });
        });
        
        if (window.lucide) window.lucide.createIcons();
    }
    
    extractBashPatterns(permissions) {
        const patterns = [];
        const processArray = (arr, type) => {
            arr.forEach(item => {
                if (item.startsWith('Bash(') && item.endsWith(')')) {
                    const pattern = item.slice(5, -1);
                    patterns.push({ pattern, type });
                }
            });
        };
        
        if (permissions.allow) processArray(permissions.allow, 'allow');
        if (permissions.deny) processArray(permissions.deny, 'deny');
        
        // For 'ask' patterns, we'd need a separate mechanism
        // as they're not explicitly stored in allow/deny
        
        return patterns;
    }
    
    addBashPattern(pattern, type) {
        if (!this.currentSettings.permissions) {
            this.currentSettings.permissions = { allow: [], deny: [] };
        }
        
        const fullPattern = `Bash(${pattern})`;
        
        if (type === 'allow') {
            if (!this.currentSettings.permissions.allow) {
                this.currentSettings.permissions.allow = [];
            }
            this.currentSettings.permissions.allow.push(fullPattern);
        } else if (type === 'deny') {
            if (!this.currentSettings.permissions.deny) {
                this.currentSettings.permissions.deny = [];
            }
            this.currentSettings.permissions.deny.push(fullPattern);
        }
        
        this.markAsChanged();
        this.renderBashPatterns();
    }
    
    removeBashPattern(index) {
        const patterns = this.extractBashPatterns(this.currentSettings.permissions);
        if (index >= 0 && index < patterns.length) {
            const pattern = patterns[index];
            const fullPattern = `Bash(${pattern.pattern})`;
            
            if (pattern.type === 'allow') {
                const idx = this.currentSettings.permissions.allow.indexOf(fullPattern);
                if (idx > -1) this.currentSettings.permissions.allow.splice(idx, 1);
            } else if (pattern.type === 'deny') {
                const idx = this.currentSettings.permissions.deny.indexOf(fullPattern);
                if (idx > -1) this.currentSettings.permissions.deny.splice(idx, 1);
            }
            
            this.markAsChanged();
            this.renderBashPatterns();
        }
    }
    
    renderFileRestrictions() {
        // Similar implementation for file path restrictions
        const container = document.getElementById('file-restrictions');
        container.innerHTML = '<div class="status-text">File restrictions coming soon...</div>';
    }
    
    renderWebDomains() {
        // Similar implementation for web domain restrictions
        const allowedContainer = document.getElementById('allowed-domains');
        const blockedContainer = document.getElementById('blocked-domains');
        
        allowedContainer.innerHTML = '<div class="status-text">Domain restrictions coming soon...</div>';
        blockedContainer.innerHTML = '<div class="status-text">Domain restrictions coming soon...</div>';
    }
    
    applyPreset(presetName) {
        const presets = {
            safe: {
                permissions: {
                    allow: [],
                    deny: []
                }
            },
            normal: {
                permissions: {
                    allow: [
                        'mcp__codeagentswarm-tasks__*',
                        'mcp__notion__search',
                        'mcp__notion__list-databases',
                        'mcp__context7__*',
                        'Read',
                        'Grep',
                        'Glob',
                        'LS',
                        'WebSearch',
                        'TodoWrite'
                    ],
                    deny: [
                        'Bash(rm -rf:*)',
                        'Bash(sudo:*)',
                        'Bash(chmod 777:*)'
                    ]
                }
            },
            yolo: {
                permissions: {
                    allow: [
                        'mcp__*',
                        'Read',
                        'Write',
                        'Edit',
                        'MultiEdit',
                        'NotebookEdit',
                        'Bash(*)',
                        'WebSearch',
                        'WebFetch',
                        'TodoWrite',
                        'Task',
                        'Grep',
                        'Glob',
                        'LS',
                        'BashOutput',
                        'KillBash'
                    ],
                    deny: []
                }
            }
        };
        
        if (presets[presetName]) {
            this.currentSettings = { ...this.currentSettings, ...presets[presetName] };
            this.markAsChanged();
            this.render();
            this.showStatus(`Applied ${presetName} preset`, 'success');
        }
    }
    
    filterContent(searchTerm) {
        const term = searchTerm.toLowerCase();
        
        // Filter MCP functions
        document.querySelectorAll('.function-item').forEach(item => {
            const tool = item.dataset.tool.toLowerCase();
            const description = item.querySelector('.function-description')?.textContent.toLowerCase() || '';
            const visible = tool.includes(term) || description.includes(term);
            item.style.display = visible ? 'flex' : 'none';
        });
        
        // Filter built-in tools
        document.querySelectorAll('.tool-card').forEach(card => {
            const name = card.querySelector('.tool-name').textContent.toLowerCase();
            const description = card.querySelector('.function-description').textContent.toLowerCase();
            const visible = name.includes(term) || description.includes(term);
            card.style.display = visible ? 'block' : 'none';
        });
        
        // Show/hide empty servers
        document.querySelectorAll('.mcp-server').forEach(server => {
            const hasVisibleFunctions = server.querySelectorAll('.function-item[style*="flex"]').length > 0;
            server.style.display = hasVisibleFunctions || !term ? 'block' : 'none';
        });
    }
    
    markAsChanged() {
        this.changes.add(Date.now());
        document.getElementById('apply-changes').disabled = false;
        document.getElementById('reset-changes').disabled = false;
    }
    
    async applyChanges() {
        try {
            // Ensure directory exists
            const settingsDir = path.dirname(this.settingsPath);
            if (!fs.existsSync(settingsDir)) {
                fs.mkdirSync(settingsDir, { recursive: true });
            }
            
            // Save settings
            fs.writeFileSync(
                this.settingsPath,
                JSON.stringify(this.currentSettings, null, 2),
                'utf8'
            );
            
            this.originalSettings = JSON.parse(JSON.stringify(this.currentSettings));
            this.changes.clear();
            
            this.showStatus('Settings saved successfully!', 'success');
            
            // Notify main process
            if (ipcRenderer) {
                ipcRenderer.send('permissions-updated', this.currentSettings);
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showStatus('Failed to save settings', 'error');
        }
    }
    
    resetChanges() {
        this.currentSettings = JSON.parse(JSON.stringify(this.originalSettings));
        this.changes.clear();
        this.render();
        this.showStatus('Changes reset', 'success');
    }
    
    showImportDialog() {
        document.getElementById('import-dialog').style.display = 'flex';
        document.getElementById('import-json').value = '';
    }
    
    importConfig() {
        try {
            const jsonText = document.getElementById('import-json').value;
            const config = JSON.parse(jsonText);
            
            if (config.permissions) {
                this.currentSettings.permissions = config.permissions;
                this.markAsChanged();
                this.render();
                this.showStatus('Configuration imported successfully', 'success');
            } else {
                this.showStatus('Invalid configuration format', 'error');
            }
            
            document.getElementById('import-dialog').style.display = 'none';
        } catch (error) {
            this.showStatus('Failed to parse configuration', 'error');
        }
    }
    
    exportConfig() {
        const config = {
            permissions: this.currentSettings.permissions || {},
            exportDate: new Date().toISOString(),
            version: '1.0.0'
        };
        
        const jsonStr = JSON.stringify(config, null, 2);
        
        // Create download
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mcp-permissions-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showStatus('Configuration exported', 'success');
    }
    
    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('status-text');
        statusEl.textContent = message;
        statusEl.className = `status-text ${type}`;
        
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'status-text';
        }, 3000);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new MCPPermissionsManager();
    });
} else {
    new MCPPermissionsManager();
}

module.exports = MCPPermissionsManager;
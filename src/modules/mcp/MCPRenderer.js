/**
 * MCPRenderer - Handles UI rendering for MCP server management
 * Responsible for DOM manipulation and user interactions
 */
class MCPRenderer {
    constructor(manager) {
        this.manager = manager;
        this.elements = {};
        this.isInitialized = false;
    }

    /**
     * Initialize the renderer and set up event listeners
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        this.cacheElements();
        this.attachEventListeners();
        this.attachManagerListeners();
        
        // Load and render servers
        await this.loadAndRenderServers();
        
        this.isInitialized = true;
    }

    /**
     * Cache DOM elements for performance
     */
    cacheElements() {
        this.elements = {
            // MCP tab elements
            serversList: document.getElementById('mcp-servers-list'),
            addBtn: document.getElementById('add-mcp-btn'),
            
            // Add modal elements
            addModal: document.getElementById('add-mcp-modal'),
            jsonInput: document.getElementById('mcp-json-input'),
            validationMessage: document.getElementById('json-validation-message'),
            preview: document.getElementById('mcp-preview'),
            previewContent: document.getElementById('mcp-preview-content'),
            saveBtn: document.getElementById('save-mcp-btn'),
            cancelAddBtn: document.getElementById('cancel-add-mcp'),
            closeAddBtn: document.getElementById('close-add-mcp'),
            
            // Edit modal elements
            editModal: document.getElementById('edit-mcp-modal'),
            editNameInput: document.getElementById('edit-mcp-name'),
            editJsonInput: document.getElementById('edit-mcp-json-input'),
            editValidationMessage: document.getElementById('edit-json-validation-message'),
            updateBtn: document.getElementById('update-mcp-btn'),
            cancelEditBtn: document.getElementById('cancel-edit-mcp'),
            closeEditBtn: document.getElementById('close-edit-mcp')
        };
    }

    /**
     * Attach event listeners to UI elements
     */
    attachEventListeners() {
        // Add button
        if (this.elements.addBtn) {
            this.elements.addBtn.addEventListener('click', () => this.showAddModal());
        }

        // Add modal events
        if (this.elements.jsonInput) {
            this.elements.jsonInput.addEventListener('input', (e) => this.validateInput(e.target.value));
        }

        if (this.elements.saveBtn) {
            this.elements.saveBtn.addEventListener('click', () => this.saveNewServers());
        }

        if (this.elements.cancelAddBtn) {
            this.elements.cancelAddBtn.addEventListener('click', () => this.hideAddModal());
        }

        if (this.elements.closeAddBtn) {
            this.elements.closeAddBtn.addEventListener('click', () => this.hideAddModal());
        }

        // Edit modal events
        if (this.elements.editJsonInput) {
            this.elements.editJsonInput.addEventListener('input', (e) => this.validateEditInput(e.target.value));
        }

        if (this.elements.updateBtn) {
            this.elements.updateBtn.addEventListener('click', () => this.updateServer());
        }

        if (this.elements.cancelEditBtn) {
            this.elements.cancelEditBtn.addEventListener('click', () => this.hideEditModal());
        }

        if (this.elements.closeEditBtn) {
            this.elements.closeEditBtn.addEventListener('click', () => this.hideEditModal());
        }

        // Add Escape key listener for modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Close add modal if it's active
                if (this.elements.addModal && this.elements.addModal.classList.contains('active')) {
                    this.hideAddModal();
                }
                // Close edit modal if it's active
                if (this.elements.editModal && this.elements.editModal.classList.contains('active')) {
                    this.hideEditModal();
                }
            }
        });
    }

    /**
     * Attach listeners to manager events
     */
    attachManagerListeners() {
        this.manager.on('servers-loaded', () => this.renderServersList());
        this.manager.on('servers-added', () => this.renderServersList());
        this.manager.on('server-updated', () => this.renderServersList());
        this.manager.on('server-removed', () => this.renderServersList());
        this.manager.on('server-toggled', () => this.renderServersList());
        this.manager.on('error', (data) => this.showError(data.error));
    }

    /**
     * Load servers and render the list
     */
    async loadAndRenderServers() {
        try {
            // Show loading state
            this.showLoading();
            
            // Initialize manager if needed
            if (!this.manager.isInitialized) {
                await this.manager.initialize();
            }
            
            // Render the servers
            this.renderServersList();
        } catch (error) {
            console.error('Failed to load MCP servers:', error);
            this.showError('Failed to load MCP servers: ' + error.message);
        }
    }

    /**
     * Show loading state
     */
    showLoading() {
        if (this.elements.serversList) {
            this.elements.serversList.innerHTML = `
                <div class="loading-mcp">
                    <i data-lucide="loader-2" class="spin"></i>
                    <span>Loading MCP servers...</span>
                </div>
            `;
        }
    }

    /**
     * Render the servers list
     */
    renderServersList() {
        if (!this.elements.serversList) {
            return;
        }

        const servers = this.manager.getAllServers();
        const serverNames = Object.keys(servers);

        if (serverNames.length === 0) {
            this.renderEmptyState();
            return;
        }

        const html = serverNames.map(name => this.renderServerCard(name, servers[name])).join('');
        this.elements.serversList.innerHTML = html;

        // Re-initialize Lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }

        // Attach card event listeners
        this.attachCardListeners();
    }

    /**
     * Render a single server card
     */
    renderServerCard(name, config) {
        const sanitized = this.manager.getSanitizedServer(name);
        const isEnabled = config.metadata?.enabled !== false;
        const isProtected = config.metadata?.protected === true;
        
        // Build actions HTML based on protection status
        let actionsHtml = '';
        if (isProtected) {
            // Protected servers show a lock icon and cannot be toggled/deleted
            actionsHtml = `
                <div class="mcp-protected-badge" title="This is a core system server and cannot be modified">
                    <i data-lucide="lock"></i>
                    <span>Protected</span>
                </div>
            `;
        } else {
            // Regular servers have all action buttons
            actionsHtml = `
                <button class="mcp-action-btn toggle-btn ${isEnabled ? 'enabled' : ''}" 
                        data-action="toggle" 
                        data-server="${name}"
                        title="${isEnabled ? 'Disable' : 'Enable'}">
                    <i data-lucide="${isEnabled ? 'toggle-right' : 'toggle-left'}"></i>
                </button>
                <button class="mcp-action-btn" 
                        data-action="edit" 
                        data-server="${name}"
                        title="Edit">
                    <i data-lucide="edit"></i>
                </button>
                <button class="mcp-action-btn delete-btn" 
                        data-action="delete" 
                        data-server="${name}"
                        title="Delete">
                    <i data-lucide="trash-2"></i>
                </button>
            `;
        }
        
        return `
            <div class="mcp-server-card ${isEnabled ? '' : 'disabled'} ${isProtected ? 'protected' : ''}" data-server="${name}">
                <div class="mcp-server-header">
                    <div class="mcp-server-info">
                        <div class="mcp-server-name">
                            <span class="mcp-status-indicator ${isEnabled ? 'enabled' : ''}"></span>
                            ${this.escapeHtml(name)}
                        </div>
                        <div class="mcp-server-command">
                            ${this.escapeHtml(config.command)} ${config.args ? config.args.map(arg => this.escapeHtml(arg)).join(' ') : ''}
                        </div>
                        ${this.renderEnvVars(sanitized?.env)}
                    </div>
                    <div class="mcp-server-actions">
                        ${actionsHtml}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render environment variables
     */
    renderEnvVars(env) {
        if (!env || Object.keys(env).length === 0) {
            return '';
        }

        const vars = Object.keys(env).map(key => 
            `<span class="mcp-env-item">${this.escapeHtml(key)}</span>`
        ).join('');

        return `
            <div class="mcp-env-vars">
                <div class="mcp-env-title">Environment Variables:</div>
                <div class="mcp-env-list">${vars}</div>
            </div>
        `;
    }

    /**
     * Render empty state
     */
    renderEmptyState() {
        this.elements.serversList.innerHTML = `
            <div class="mcp-empty-state">
                <i data-lucide="server-off"></i>
                <p>No MCP servers configured</p>
                <p>Click "Add MCP Server" to get started</p>
            </div>
        `;
        
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * Attach event listeners to server cards
     */
    attachCardListeners() {
        const buttons = this.elements.serversList.querySelectorAll('.mcp-action-btn');
        
        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = btn.dataset.action;
                const serverName = btn.dataset.server;
                
                switch (action) {
                    case 'toggle':
                        this.toggleServer(serverName);
                        break;
                    case 'edit':
                        this.showEditModal(serverName);
                        break;
                    case 'delete':
                        this.deleteServer(serverName);
                        break;
                }
            });
        });
    }

    /**
     * Show add modal
     */
    showAddModal() {
        if (this.elements.addModal) {
            this.elements.addModal.classList.add('active');
            this.elements.jsonInput.value = '';
            this.elements.jsonInput.focus();
            this.hideValidation();
            this.hidePreview();
            this.elements.saveBtn.disabled = true;
            
            // Initialize Lucide icons for the modal
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }
    }

    /**
     * Hide add modal
     */
    hideAddModal() {
        if (this.elements.addModal) {
            this.elements.addModal.classList.remove('active');
            // Clear any pending server config
            this.pendingServerConfig = null;
            // Clear the input
            if (this.elements.jsonInput) {
                this.elements.jsonInput.value = '';
            }
            // Hide preview and validation
            this.hidePreview();
            this.hideValidation();
        }
    }

    /**
     * Show edit modal
     */
    showEditModal(serverName) {
        const server = this.manager.getServer(serverName);
        if (!server) {
            return;
        }

        if (this.elements.editModal) {
            this.elements.editModal.classList.add('active');
            this.elements.editNameInput.value = serverName;
            
            const config = {
                command: server.command,
                args: server.args,
                env: server.env
            };
            
            this.elements.editJsonInput.value = JSON.stringify(config, null, 2);
            this.elements.editJsonInput.focus();
            
            // Initialize Lucide icons for the modal
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }
    }

    /**
     * Hide edit modal
     */
    hideEditModal() {
        if (this.elements.editModal) {
            this.elements.editModal.classList.remove('active');
        }
    }

    /**
     * Validate input and show preview
     */
    validateInput(jsonString) {
        const validation = this.manager.validateConfiguration(jsonString);
        
        if (validation.valid) {
            if (validation.needsServerName) {
                this.showValidation('Valid configuration - Enter a server name below', 'success');
                this.showServerNameInput(validation.servers);
                // Don't enable save button yet - wait for server name
            } else {
                this.showValidation('Valid configuration', 'success');
                this.showPreview(validation.servers);
                this.elements.saveBtn.disabled = false;
            }
        } else {
            this.showValidation(validation.error, 'error');
            this.hidePreview();
            this.hideServerNameInput();
            this.elements.saveBtn.disabled = true;
        }
    }

    /**
     * Validate edit input
     */
    validateEditInput(jsonString) {
        try {
            const config = JSON.parse(jsonString);
            const serverName = this.elements.editNameInput.value;
            const validation = this.manager.validator.validateServerConfig(serverName, config);
            
            if (validation.valid) {
                this.showEditValidation('Valid configuration', 'success');
                this.elements.updateBtn.disabled = false;
            } else {
                this.showEditValidation(validation.error, 'error');
                this.elements.updateBtn.disabled = true;
            }
        } catch (error) {
            this.showEditValidation('Invalid JSON: ' + error.message, 'error');
            this.elements.updateBtn.disabled = true;
        }
    }

    /**
     * Show validation message
     */
    showValidation(message, type) {
        if (this.elements.validationMessage) {
            this.elements.validationMessage.textContent = message;
            this.elements.validationMessage.className = `json-validation-message ${type}`;
        }
    }

    /**
     * Show edit validation message
     */
    showEditValidation(message, type) {
        if (this.elements.editValidationMessage) {
            this.elements.editValidationMessage.textContent = message;
            this.elements.editValidationMessage.className = `json-validation-message ${type}`;
        }
    }

    /**
     * Hide validation message
     */
    hideValidation() {
        if (this.elements.validationMessage) {
            this.elements.validationMessage.className = 'json-validation-message';
            this.elements.validationMessage.textContent = '';
        }
    }

    /**
     * Show preview
     */
    showPreview(servers) {
        if (!this.elements.preview || !this.elements.previewContent) {
            return;
        }

        // Handle both wrapped format and direct server config
        let html;
        if (servers.command) {
            // Direct server config
            html = `
                <div class="mcp-preview-item">
                    <span class="mcp-preview-label">Command:</span> ${this.escapeHtml(servers.command)}<br>
                    ${servers.args ? `<span class="mcp-preview-label">Args:</span> ${servers.args.map(a => this.escapeHtml(a)).join(', ')}<br>` : ''}
                    ${servers.env ? `<span class="mcp-preview-label">Env vars:</span> ${Object.keys(servers.env).join(', ')}` : ''}
                </div>
            `;
        } else {
            // Wrapped format with server names
            html = Object.entries(servers).map(([name, config]) => `
                <div class="mcp-preview-item">
                    <span class="mcp-preview-label">Server:</span> ${this.escapeHtml(name)}<br>
                    <span class="mcp-preview-label">Command:</span> ${this.escapeHtml(config.command)}<br>
                    ${config.args ? `<span class="mcp-preview-label">Args:</span> ${config.args.map(a => this.escapeHtml(a)).join(', ')}<br>` : ''}
                    ${config.env ? `<span class="mcp-preview-label">Env vars:</span> ${Object.keys(config.env).join(', ')}` : ''}
                </div>
            `).join('');
        }

        this.elements.previewContent.innerHTML = html;
        this.elements.preview.style.display = 'block';
    }

    /**
     * Show server name input for direct server config
     */
    showServerNameInput(serverConfig) {
        if (!this.elements.preview || !this.elements.previewContent) {
            return;
        }

        // Store the config for later use
        this.pendingServerConfig = serverConfig;

        const html = `
            <div class="mcp-preview-item">
                <div class="form-group">
                    <label for="server-name-input">Server Name:</label>
                    <input type="text" id="server-name-input" class="form-control" placeholder="e.g., supabase-mcp" />
                </div>
                <div class="mcp-config-preview">
                    <span class="mcp-preview-label">Command:</span> ${this.escapeHtml(serverConfig.command)}<br>
                    ${serverConfig.args ? `<span class="mcp-preview-label">Args:</span> ${serverConfig.args.map(a => this.escapeHtml(a)).join(', ')}<br>` : ''}
                    ${serverConfig.env ? `<span class="mcp-preview-label">Env vars:</span> ${Object.keys(serverConfig.env).join(', ')}` : ''}
                </div>
            </div>
        `;

        this.elements.previewContent.innerHTML = html;
        this.elements.preview.style.display = 'block';

        // Add event listener for server name input
        const serverNameInput = document.getElementById('server-name-input');
        if (serverNameInput) {
            serverNameInput.addEventListener('input', (e) => {
                const serverName = e.target.value.trim();
                if (serverName) {
                    // Validate the server name
                    const validation = this.manager.validator.validateServerName(serverName, this.manager.servers);
                    if (validation.valid) {
                        this.elements.saveBtn.disabled = false;
                        this.showValidation('Valid configuration - Ready to save', 'success');
                    } else {
                        this.elements.saveBtn.disabled = true;
                        this.showValidation(validation.error, 'error');
                    }
                } else {
                    this.elements.saveBtn.disabled = true;
                    this.showValidation('Please enter a server name', 'info');
                }
            });
        }
    }

    /**
     * Hide server name input
     */
    hideServerNameInput() {
        this.pendingServerConfig = null;
        this.hidePreview();
    }

    /**
     * Hide preview
     */
    hidePreview() {
        if (this.elements.preview) {
            this.elements.preview.style.display = 'none';
        }
    }

    /**
     * Save new servers
     */
    async saveNewServers() {
        try {
            let result;
            
            // Check if we have a pending server config (direct format)
            if (this.pendingServerConfig) {
                const serverNameInput = document.getElementById('server-name-input');
                if (serverNameInput) {
                    const serverName = serverNameInput.value.trim();
                    if (serverName) {
                        // Create wrapped format with the provided server name
                        const wrappedConfig = {
                            mcpServers: {
                                [serverName]: this.pendingServerConfig
                            }
                        };
                        result = await this.manager.addServers(JSON.stringify(wrappedConfig));
                    } else {
                        this.showError('Please enter a server name');
                        return;
                    }
                } else {
                    this.showError('Server name input not found');
                    return;
                }
            } else {
                // Use the original JSON string (already wrapped format)
                const jsonString = this.elements.jsonInput.value;
                result = await this.manager.addServers(jsonString);
            }
            
            if (result.success) {
                this.showSuccess('MCP servers added successfully');
                this.hideAddModal();
                this.pendingServerConfig = null; // Clear pending config
            } else {
                this.showError(result.error);
            }
        } catch (error) {
            this.showError('Failed to add servers: ' + error.message);
        }
    }

    /**
     * Update server configuration
     */
    async updateServer() {
        const serverName = this.elements.editNameInput.value;
        const jsonString = this.elements.editJsonInput.value;
        
        try {
            const config = JSON.parse(jsonString);
            const result = await this.manager.updateServer(serverName, config);
            
            if (result.success) {
                this.showSuccess('Server updated successfully');
                this.hideEditModal();
            } else {
                this.showError(result.error);
            }
        } catch (error) {
            this.showError('Failed to update server: ' + error.message);
        }
    }

    /**
     * Toggle server enabled state
     */
    async toggleServer(serverName) {
        const server = this.manager.getServer(serverName);
        const isEnabled = server?.metadata?.enabled !== false;
        
        console.log(`[MCP Renderer] Toggling ${serverName}: currently ${isEnabled ? 'enabled' : 'disabled'}, will ${isEnabled ? 'disable' : 'enable'}`);
        
        try {
            const result = await this.manager.toggleServer(serverName, !isEnabled);
            
            if (!result.success) {
                console.error(`[MCP Renderer] Toggle failed:`, result.error);
                this.showError(result.error);
            } else {
                console.log(`[MCP Renderer] Toggle successful for ${serverName}`);
                // Show success message with reminder to restart Claude Code
                this.showSuccess(`Server ${isEnabled ? 'disabled' : 'enabled'} successfully. Please restart Claude Code for changes to take effect.`);
            }
        } catch (error) {
            console.error(`[MCP Renderer] Toggle error:`, error);
            this.showError('Failed to toggle server: ' + error.message);
        }
    }

    /**
     * Delete server
     */
    async deleteServer(serverName) {
        if (!confirm(`Are you sure you want to delete "${serverName}"?`)) {
            return;
        }

        try {
            const result = await this.manager.removeServer(serverName);
            
            if (result.success) {
                this.showSuccess('Server removed successfully');
            } else {
                this.showError(result.error);
            }
        } catch (error) {
            this.showError('Failed to remove server: ' + error.message);
        }
    }

    /**
     * Show success message
     */
    showSuccess(message) {
        // You can implement a toast notification here
        console.log('Success:', message);
    }

    /**
     * Show error message
     */
    showError(message) {
        // You can implement a toast notification here
        console.error('Error:', message);
        alert('Error: ' + message);
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Clean up resources
     */
    destroy() {
        // Remove event listeners if needed
        this.elements = {};
        this.isInitialized = false;
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MCPRenderer;
}
/**
 * MCPMarketplace - MCP Server Marketplace Interface
 * Provides a catalog of preconfigured MCP servers for one-click installation
 */

class MCPMarketplace {
    constructor(manager) {
        this.manager = manager;
        this.marketplace = null;
        this.selectedCategory = 'all';
        this.searchQuery = '';
        this.installingServers = new Set();
        
        // Lazy loading configuration
        this.itemsPerPage = 3; // Reduce to 3 for better performance
        this.currentPage = 0;
        this.loadedServers = [];
        this.isLoading = false;
        this.observer = null;
        this.renderQueue = [];
        this.isRendering = false;
        
        // Load marketplace data
        this.loadMarketplaceData();
    }

    /**
     * Load marketplace data from JSON
     */
    async loadMarketplaceData() {
        try {
            const response = await fetch('./modules/mcp/marketplace.json');
            this.marketplace = await response.json();
            console.log('[MCPMarketplace] Loaded marketplace data:', this.marketplace);
        } catch (error) {
            console.error('[MCPMarketplace] Error loading marketplace data:', error);
            this.marketplace = { servers: [], categories: [] };
        }
    }

    /**
     * Render the marketplace UI
     */
    async render(container) {
        if (!this.marketplace) {
            await this.loadMarketplaceData();
        }

        // Reset lazy loading state
        this.currentPage = 0;
        this.loadedServers = [];
        this.isLoading = false;

        container.innerHTML = `
            <div class="mcp-marketplace">
                <div class="marketplace-header">
                    <h2>MCP Marketplace</h2>
                    <p>Discover and install MCP servers with one click</p>
                </div>
                
                <div class="marketplace-controls">
                    <div class="marketplace-search">
                        <i data-lucide="search"></i>
                        <input type="text" 
                               id="marketplace-search" 
                               placeholder="Search MCP servers..."
                               value="${this.searchQuery}">
                    </div>
                    
                    <div class="marketplace-categories">
                        <button class="category-btn ${this.selectedCategory === 'all' ? 'active' : ''}" 
                                data-category="all">
                            All
                        </button>
                        ${this.marketplace.categories.map(cat => `
                            <button class="category-btn ${this.selectedCategory === cat.id ? 'active' : ''}" 
                                    data-category="${cat.id}">
                                ${cat.icon} ${cat.name}
                            </button>
                        `).join('')}
                    </div>
                </div>
                
                <div class="marketplace-grid" id="marketplace-grid">
                    <!-- Items will be loaded progressively -->
                </div>
                
                <div class="marketplace-loader" id="marketplace-loader" style="display: none;">
                    <i data-lucide="loader-2" class="spinning"></i>
                    <span>Loading more servers...</span>
                </div>
                
                <div class="marketplace-sentinel" id="marketplace-sentinel"></div>
            </div>
        `;

        // Initialize Lucide icons for controls
        if (window.lucide) {
            window.lucide.createIcons();
        }

        // Setup lazy loading
        this.setupLazyLoading(container);
        
        // Load initial items
        await this.loadMoreItems();

        // Attach event listeners
        this.attachEventListeners(container);
    }

    /**
     * Render server cards
     */
    renderServerCards() {
        const filteredServers = this.filterServers();
        
        if (filteredServers.length === 0) {
            return `
                <div class="marketplace-empty">
                    <i data-lucide="package-x"></i>
                    <p>No MCP servers found</p>
                </div>
            `;
        }

        return filteredServers.map(server => this.renderServerCard(server)).join('');
    }

    /**
     * Render a single server card
     */
    renderServerCard(server) {
        const isInstalled = this.manager.hasServer(server.id);
        const isInstalling = this.installingServers.has(server.id);
        
        return `
            <div class="marketplace-card ${isInstalled ? 'installed' : ''}" data-server-id="${server.id}">
                <div class="card-header">
                    <div class="card-icon">
                        ${server.icon.endsWith('.png') 
                            ? `<img src="${server.icon}" alt="${server.name} icon" width="48" height="48" />` 
                            : server.icon}
                    </div>
                    <div class="card-info">
                        <h3>${server.name}</h3>
                        <span class="card-category">${server.category}</span>
                    </div>
                    ${this.renderPopularity(server.popularity)}
                </div>
                
                <div class="card-description">
                    ${server.description}
                </div>
                
                <div class="card-features">
                    ${server.features.slice(0, 3).map(feature => `
                        <span class="feature-tag">
                            <i data-lucide="check"></i> ${feature}
                        </span>
                    `).join('')}
                    ${server.features.length > 3 ? `
                        <span class="feature-more">+${server.features.length - 3} more</span>
                    ` : ''}
                </div>
                
                <div class="card-actions">
                    ${isInstalled ? `
                        <div class="installed-actions">
                            <button class="btn-installed" disabled>
                                <i data-lucide="check-circle"></i> Installed
                            </button>
                            <button class="btn-uninstall" data-action="uninstall" data-server="${server.id}">
                                <i data-lucide="trash-2"></i> Uninstall
                            </button>
                        </div>
                    ` : isInstalling ? `
                        <button class="btn-installing" disabled>
                            <i data-lucide="loader-2" class="spinning"></i> Installing...
                        </button>
                    ` : `
                        <button class="btn-install" data-action="install" data-server="${server.id}">
                            <i data-lucide="download"></i> Install
                        </button>
                    `}
                    
                    <div class="card-links">
                        ${server.setupGuide ? `
                            <a href="${server.setupGuide}" target="_blank" class="card-link">
                                <i data-lucide="github"></i> GitHub
                            </a>
                        ` : ''}
                        ${server.documentation ? `
                            <a href="${server.documentation}" target="_blank" class="card-link">
                                <i data-lucide="book-open"></i> Docs
                            </a>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render popularity stars
     */
    renderPopularity(rating) {
        const stars = [];
        for (let i = 1; i <= 5; i++) {
            stars.push(`
                <i data-lucide="${i <= rating ? 'star' : 'star'}" 
                   class="${i <= rating ? 'star-filled' : 'star-empty'}"></i>
            `);
        }
        return `<div class="card-popularity">${stars.join('')}</div>`;
    }

    /**
     * Filter servers based on search and category
     */
    filterServers() {
        if (!this.marketplace || !this.marketplace.servers) return [];
        
        let servers = this.marketplace.servers;
        
        // Filter by category
        if (this.selectedCategory !== 'all') {
            servers = servers.filter(s => 
                s.category.toLowerCase() === this.selectedCategory.toLowerCase()
            );
        }
        
        // Filter by search query
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            servers = servers.filter(s => 
                s.name.toLowerCase().includes(query) ||
                s.description.toLowerCase().includes(query) ||
                s.features.some(f => f.toLowerCase().includes(query))
            );
        }
        
        return servers;
    }

    /**
     * Attach event listeners
     */
    attachEventListeners(container) {
        // Search input with debounce
        const searchInput = container.querySelector('#marketplace-search');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.searchQuery = e.target.value;
                    this.updateGrid(container);
                }, 300); // Debounce for 300ms
            });
        }
        
        // Category buttons
        container.querySelectorAll('.category-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectedCategory = btn.dataset.category;
                container.querySelectorAll('.category-btn').forEach(b => 
                    b.classList.remove('active')
                );
                btn.classList.add('active');
                this.updateGrid(container);
            });
        });
    }

    /**
     * Setup lazy loading - SIMPLIFIED VERSION
     */
    setupLazyLoading(container) {
        // DISABLED Intersection Observer for performance testing
        // Just load all items at once
        const sentinel = container.querySelector('#marketplace-sentinel');
        if (sentinel) {
            sentinel.style.display = 'none';
        }
        
        // Load more items immediately without observer
        setTimeout(() => {
            this.loadAllRemainingItems();
        }, 100);
    }

    /**
     * Load all remaining items at once
     */
    async loadAllRemainingItems() {
        const filteredServers = this.filterServers();
        const grid = document.getElementById('marketplace-grid');
        if (!grid) return;
        
        // Load all remaining items
        const remainingServers = filteredServers.slice(this.loadedServers.length);
        
        if (remainingServers.length === 0) return;
        
        const newCardsHTML = remainingServers.map(server => this.renderServerCard(server)).join('');
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newCardsHTML;
        
        // Append all cards at once
        Array.from(tempDiv.children).forEach((card) => {
            grid.appendChild(card);
        });
        
        // Initialize icons in batch
        setTimeout(() => {
            if (window.lucide) {
                window.lucide.createIcons();
            }
            this.attachCardListeners(grid, remainingServers.map(s => s.id));
        }, 100);
        
        this.loadedServers.push(...remainingServers);
    }

    /**
     * Load more items progressively
     */
    async loadMoreItems() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        const loader = document.getElementById('marketplace-loader');
        if (loader) loader.style.display = 'flex';

        // Get filtered servers
        const filteredServers = this.filterServers();
        
        // Calculate pagination
        const startIndex = this.currentPage * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const serversToLoad = filteredServers.slice(startIndex, endIndex);
        
        if (serversToLoad.length === 0) {
            // No more items to load
            if (loader) loader.style.display = 'none';
            this.isLoading = false;
            return;
        }

        // Remove delay for better performance
        // await new Promise(resolve => setTimeout(resolve, 200));

        // Render new items
        const grid = document.getElementById('marketplace-grid');
        if (grid) {
            const newCardsHTML = serversToLoad.map(server => this.renderServerCard(server)).join('');
            
            // Create temporary container to hold new cards
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newCardsHTML;
            
            // Append cards without animation for better performance
            Array.from(tempDiv.children).forEach((card) => {
                grid.appendChild(card);
            });

            // Initialize icons and listeners after DOM updates
            requestAnimationFrame(() => {
                // Only initialize icons for the new cards
                serversToLoad.forEach(server => {
                    const card = grid.querySelector(`[data-server-id="${server.id}"]`);
                    if (card && window.lucide) {
                        // Only process icons within this specific card
                        const icons = card.querySelectorAll('[data-lucide]');
                        icons.forEach(icon => {
                            if (!icon.querySelector('svg')) {
                                window.lucide.createElement(icon);
                            }
                        });
                    }
                });
                
                // Attach event listeners for new cards
                this.attachCardListeners(grid, serversToLoad.map(s => s.id));
            });
        }

        // Update state
        this.loadedServers.push(...serversToLoad);
        this.currentPage++;
        
        if (loader) loader.style.display = 'none';
        this.isLoading = false;
    }

    /**
     * Attach event listeners to specific cards
     */
    attachCardListeners(grid, serverIds) {
        serverIds.forEach(serverId => {
            const card = grid.querySelector(`[data-server-id="${serverId}"]`);
            if (!card) return;
            
            card.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const action = btn.dataset.action;
                    const btnServerId = btn.dataset.server;
                    
                    if (action === 'install') {
                        await this.installServer(btnServerId, grid.closest('.mcp-marketplace'));
                    } else if (action === 'uninstall') {
                        await this.uninstallServer(btnServerId, grid.closest('.mcp-marketplace'));
                    }
                });
            });
        });
    }

    /**
     * Update the marketplace grid (for search/filter changes)
     */
    updateGrid(container) {
        // Reset and reload with new filters
        this.currentPage = 0;
        this.loadedServers = [];
        
        const grid = container.querySelector('#marketplace-grid');
        if (grid) {
            grid.innerHTML = '';
            // Load initial items
            this.loadMoreItems().then(() => {
                // Load all remaining items after initial load
                setTimeout(() => {
                    this.loadAllRemainingItems();
                }, 100);
            });
        }
    }

    /**
     * Install a server from marketplace
     */
    async installServer(serverId, container) {
        const server = this.marketplace.servers.find(s => s.id === serverId);
        if (!server) return;
        
        // Check if requires auth
        if (server.requiresAuth && server.authFields) {
            const authData = await this.showAuthModal(server);
            if (!authData) return; // User cancelled
            
            // Add auth data to config
            server.config.env = authData;
        }
        
        // Mark as installing
        this.installingServers.add(serverId);
        this.updateGrid(container);
        
        try {
            // Prepare the configuration
            let configToUse = { ...server.config };
            
            // Special handling for PostgreSQL and other servers that need URL in args
            if (serverId === 'postgres' && server.config.env && server.config.env.DATABASE_URL) {
                // Replace ${DATABASE_URL} placeholder in args with actual value
                configToUse.args = configToUse.args.map(arg => 
                    arg === '${DATABASE_URL}' ? server.config.env.DATABASE_URL : arg
                );
                // Remove DATABASE_URL from env since it's now in args
                delete configToUse.env.DATABASE_URL;
            }
            
            // Prepare the configuration with mcpServers wrapper
            const config = {
                mcpServers: {
                    [server.id]: {
                        ...configToUse,
                        env: configToUse.env || {}
                    }
                }
            };
            
            // Add server via manager
            const result = await this.manager.addServers(JSON.stringify(config));
            
            if (result.success) {
                this.showSuccess(`${server.name} installed successfully!`);
                
                // Reload servers to update UI
                await this.manager.loadServers();
                
                // Update CLAUDE.md with MCP instructions
                try {
                    await this.updateClaudeMdInstructions(serverId);
                    console.log(`[MCPMarketplace] Updated CLAUDE.md with ${server.name} instructions`);
                } catch (error) {
                    console.warn('[MCPMarketplace] Failed to update CLAUDE.md:', error);
                    // Don't fail the installation if CLAUDE.md update fails
                }
            } else {
                this.showError(`Failed to install ${server.name}: ${result.error}`);
            }
        } catch (error) {
            console.error('[MCPMarketplace] Installation error:', error);
            this.showError(`Failed to install ${server.name}: ${error.message}`);
        } finally {
            this.installingServers.delete(serverId);
            this.updateGrid(container);
        }
    }

    /**
     * Show authentication modal
     */
    async showAuthModal(server) {
        return new Promise((resolve) => {
            // Special handling for PostgreSQL - show separate fields
            let bodyContent = '';
            if (server.id === 'postgres') {
                bodyContent = `
                    <p>Configure your PostgreSQL connection details:</p>
                    
                    <div class="auth-field">
                        <label for="pg_host">Host</label>
                        <input type="text" 
                               id="pg_host"
                               placeholder="localhost"
                               value="localhost"
                               required>
                        <small class="auth-help">Database server hostname or IP</small>
                    </div>
                    
                    <div class="auth-field">
                        <label for="pg_port">Port</label>
                        <input type="number" 
                               id="pg_port"
                               placeholder="5432"
                               value="5432"
                               required>
                        <small class="auth-help">PostgreSQL port (default: 5432)</small>
                    </div>
                    
                    <div class="auth-field">
                        <label for="pg_database">Database Name</label>
                        <input type="text" 
                               id="pg_database"
                               placeholder="mydb"
                               required>
                        <small class="auth-help">Name of the database to connect to</small>
                    </div>
                    
                    <div class="auth-field">
                        <label for="pg_user">Username</label>
                        <input type="text" 
                               id="pg_user"
                               placeholder="postgres"
                               required>
                        <small class="auth-help">Database username</small>
                    </div>
                    
                    <div class="auth-field">
                        <label for="pg_password">Password</label>
                        <input type="password" 
                               id="pg_password"
                               placeholder="••••••••">
                        <small class="auth-help">Database password (leave empty if not required)</small>
                    </div>
                    
                    <div class="auth-field">
                        <label>Connection String Preview:</label>
                        <code id="pg_preview" style="background: #2a2a2a; color: #e0e0e0; padding: 10px; border: 1px solid #3a3a3a; border-radius: 6px; display: block; word-break: break-all; font-family: 'SF Mono', Monaco, monospace; font-size: 13px;">
                            postgresql://localhost:5432/mydb
                        </code>
                    </div>
                `;
            } else {
                // Default auth fields for other servers
                bodyContent = `
                    <p>This server requires authentication to work properly.</p>
                    
                    ${server.authFields.map(field => `
                        <div class="auth-field">
                            <label for="${field.key}">${field.label}</label>
                            ${field.type === 'textarea' ? `
                                <textarea id="${field.key}" 
                                          placeholder="${field.placeholder}"
                                          ${field.required ? 'required' : ''}></textarea>
                            ` : `
                                <input type="${field.type}" 
                                       id="${field.key}"
                                       placeholder="${field.placeholder}"
                                       ${field.required ? 'required' : ''}>
                            `}
                            ${field.helpText ? `
                                <small class="auth-help">${field.helpText}</small>
                            ` : ''}
                        </div>
                    `).join('')}
                `;
            }
            
            const modalHtml = `
                <div class="mcp-auth-modal" id="auth-modal">
                    <div class="auth-modal-content">
                        <div class="auth-modal-header">
                            <h3>${server.icon} Configure ${server.name}</h3>
                            <button class="auth-modal-close" id="auth-close">
                                <i data-lucide="x"></i>
                            </button>
                        </div>
                        
                        <div class="auth-modal-body">
                            ${bodyContent}
                        </div>
                        
                        <div class="auth-modal-footer">
                            <button class="btn-cancel" id="auth-cancel">Cancel</button>
                            <button class="btn-primary" id="auth-submit">Install</button>
                        </div>
                    </div>
                </div>
            `;
            
            // Add modal to body
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            const modal = document.getElementById('auth-modal');
            
            // Initialize Lucide icons
            if (window.lucide) {
                window.lucide.createIcons();
            }
            
            // Special handling for PostgreSQL
            if (server.id === 'postgres') {
                // Function to update the connection string preview
                const updatePreview = () => {
                    const host = document.getElementById('pg_host').value || 'localhost';
                    const port = document.getElementById('pg_port').value || '5432';
                    const database = document.getElementById('pg_database').value || 'mydb';
                    const user = document.getElementById('pg_user').value || 'postgres';
                    const password = document.getElementById('pg_password').value;
                    
                    let connectionString = `postgresql://`;
                    if (user) {
                        connectionString += user;
                        if (password) {
                            connectionString += `:${password}`;
                        }
                        connectionString += '@';
                    }
                    connectionString += `${host}:${port}/${database}`;
                    
                    document.getElementById('pg_preview').textContent = connectionString;
                };
                
                // Add event listeners to update preview
                ['pg_host', 'pg_port', 'pg_database', 'pg_user', 'pg_password'].forEach(id => {
                    const elem = document.getElementById(id);
                    if (elem) {
                        elem.addEventListener('input', updatePreview);
                    }
                });
                
                // Initial preview update
                updatePreview();
            }
            
            // Handle submit
            document.getElementById('auth-submit').addEventListener('click', () => {
                const authData = {};
                let valid = true;
                
                if (server.id === 'postgres') {
                    // Build connection string for PostgreSQL
                    const host = document.getElementById('pg_host').value || 'localhost';
                    const port = document.getElementById('pg_port').value || '5432';
                    const database = document.getElementById('pg_database').value;
                    const user = document.getElementById('pg_user').value;
                    const password = document.getElementById('pg_password').value;
                    
                    if (!database || !user) {
                        valid = false;
                        if (!database) document.getElementById('pg_database').classList.add('error');
                        if (!user) document.getElementById('pg_user').classList.add('error');
                    } else {
                        let connectionString = `postgresql://`;
                        if (user) {
                            connectionString += user;
                            if (password) {
                                connectionString += `:${password}`;
                            }
                            connectionString += '@';
                        }
                        connectionString += `${host}:${port}/${database}`;
                        
                        authData.DATABASE_URL = connectionString;
                    }
                } else {
                    // Default handling for other servers
                    server.authFields.forEach(field => {
                        const input = document.getElementById(field.key);
                        if (field.required && !input.value) {
                            valid = false;
                            input.classList.add('error');
                        } else {
                            authData[field.key] = input.value;
                        }
                    });
                }
                
                if (valid) {
                    modal.remove();
                    resolve(authData);
                }
            });
            
            // Handle cancel
            let closeModal = () => {
                modal.remove();
                resolve(null);
            };
            
            document.getElementById('auth-cancel').addEventListener('click', closeModal);
            document.getElementById('auth-close').addEventListener('click', closeModal);
            
            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal();
                }
            });
            
            // Close on Escape key press
            const handleEscapeKey = (e) => {
                if (e.key === 'Escape') {
                    closeModal();
                }
            };
            document.addEventListener('keydown', handleEscapeKey);
            
            // Clean up event listener when modal is closed
            const originalCloseModal = closeModal;
            closeModal = () => {
                document.removeEventListener('keydown', handleEscapeKey);
                originalCloseModal();
            };
        });
    }

    /**
     * Manage an installed server
     */
    manageServer(serverId) {
        // Switch to MCP Settings tab and highlight the server
        const event = new CustomEvent('mcp-manage-server', { 
            detail: { serverId } 
        });
        window.dispatchEvent(event);
    }

    /**
     * Uninstall a server from marketplace
     */
    async uninstallServer(serverId, container) {
        const server = this.marketplace.servers.find(s => s.id === serverId);
        if (!server) return;
        
        // Show confirmation dialog
        const confirmed = await this.showConfirmDialog(
            `Uninstall ${server.name}?`,
            `Are you sure you want to uninstall ${server.name}? This will remove the server configuration from your system.`,
            'Uninstall',
            'Cancel'
        );
        
        if (!confirmed) return;
        
        try {
            // Remove server via manager
            const result = await this.manager.removeServer(serverId);
            
            if (result.success) {
                this.showSuccess(`${server.name} uninstalled successfully!`);
                
                // Reload servers to update UI
                await this.manager.loadServers();
                
                // Update the grid to reflect the change
                this.updateGrid(container);
            } else {
                this.showError(`Failed to uninstall ${server.name}: ${result.error}`);
            }
        } catch (error) {
            console.error('[MCPMarketplace] Uninstall error:', error);
            this.showError(`Failed to uninstall ${server.name}: ${error.message}`);
        }
    }

    /**
     * Show confirmation dialog
     */
    async showConfirmDialog(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
        return new Promise((resolve) => {
            const modalHtml = `
                <div class="mcp-confirm-modal" id="confirm-modal">
                    <div class="confirm-modal-content">
                        <div class="confirm-modal-header">
                            <h3>${title}</h3>
                            <button class="confirm-modal-close" id="confirm-close">
                                <i data-lucide="x"></i>
                            </button>
                        </div>
                        
                        <div class="confirm-modal-body">
                            <p>${message}</p>
                        </div>
                        
                        <div class="confirm-modal-footer">
                            <button class="btn-cancel" id="confirm-cancel">${cancelText}</button>
                            <button class="btn-danger" id="confirm-confirm">${confirmText}</button>
                        </div>
                    </div>
                </div>
            `;
            
            // Add modal to body
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            const modal = document.getElementById('confirm-modal');
            
            // Initialize Lucide icons
            if (window.lucide) {
                window.lucide.createIcons();
            }
            
            // Handle confirm
            document.getElementById('confirm-confirm').addEventListener('click', () => {
                modal.remove();
                resolve(true);
            });
            
            // Handle cancel
            const closeModal = () => {
                modal.remove();
                resolve(false);
            };
            
            document.getElementById('confirm-cancel').addEventListener('click', closeModal);
            document.getElementById('confirm-close').addEventListener('click', closeModal);
            
            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal();
                }
            });
            
            // Close on Escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', handleEscape);
                    closeModal();
                }
            };
            document.addEventListener('keydown', handleEscape);
        });
    }

    /**
     * Show success message
     */
    showSuccess(message) {
        const toast = document.createElement('div');
        toast.className = 'mcp-toast success';
        toast.innerHTML = `
            <i data-lucide="check-circle"></i>
            <span>${message}</span>
        `;
        document.body.appendChild(toast);
        
        // Defer icon initialization
        requestAnimationFrame(() => {
            if (window.lucide) {
                window.lucide.createIcons();
            }
        });
        
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Show error message
     */
    showError(message) {
        const toast = document.createElement('div');
        toast.className = 'mcp-toast error';
        toast.innerHTML = `
            <i data-lucide="alert-circle"></i>
            <span>${message}</span>
        `;
        document.body.appendChild(toast);
        
        // Defer icon initialization
        requestAnimationFrame(() => {
            if (window.lucide) {
                window.lucide.createIcons();
            }
        });
        
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    /**
     * Update CLAUDE.md with MCP instructions after installation
     */
    async updateClaudeMdInstructions(serverId) {
        try {
            // Use IPC to trigger the update in the main process
            if (this.manager && this.manager.ipcCall) {
                const result = await this.manager.ipcCall('mcp:update-claude-instructions', { serverId });
                
                if (result && result.success) {
                    console.log(`[MCPMarketplace] Successfully updated CLAUDE.md instructions for ${serverId}`);
                    return true;
                } else {
                    console.warn('[MCPMarketplace] Failed to update CLAUDE.md:', result?.error);
                    return false;
                }
            } else {
                console.warn('[MCPMarketplace] No IPC call method available to update CLAUDE.md');
                return false;
            }
        } catch (error) {
            console.error('[MCPMarketplace] Error updating CLAUDE.md instructions:', error);
            return false;
        }
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MCPMarketplace;
}
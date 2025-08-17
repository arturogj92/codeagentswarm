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
                        <button class="btn-installed" disabled>
                            <i data-lucide="check-circle"></i> Installed
                        </button>
                        <button class="btn-manage" data-action="manage" data-server="${server.id}">
                            <i data-lucide="settings"></i> Manage
                        </button>
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
                s.category.toLowerCase() === this.selectedCategory
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
                    } else if (action === 'manage') {
                        this.manageServer(btnServerId);
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
            this.loadMoreItems();
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
            // Prepare the configuration with mcpServers wrapper
            const config = {
                mcpServers: {
                    [server.id]: {
                        ...server.config,
                        env: server.config.env || {}
                    }
                }
            };
            
            // Add server via manager
            const result = await this.manager.addServers(JSON.stringify(config));
            
            if (result.success) {
                this.showSuccess(`${server.name} installed successfully!`);
                
                // Reload servers to update UI
                await this.manager.loadServers();
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
            
            // Handle submit
            document.getElementById('auth-submit').addEventListener('click', () => {
                const authData = {};
                let valid = true;
                
                server.authFields.forEach(field => {
                    const input = document.getElementById(field.key);
                    if (field.required && !input.value) {
                        valid = false;
                        input.classList.add('error');
                    } else {
                        authData[field.key] = input.value;
                    }
                });
                
                if (valid) {
                    modal.remove();
                    resolve(authData);
                }
            });
            
            // Handle cancel
            const closeModal = () => {
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
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MCPMarketplace;
}
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
        
        // Listen to manager events to update marketplace UI
        this.attachManagerListeners();
    }

    /**
     * Attach listeners to manager events
     */
    attachManagerListeners() {
        if (!this.manager) return;
        
        // Listen for server removal events
        this.manager.on('server-removed', (data) => {
            console.log('[MCPMarketplace] Server removed event:', data);
            // Update the specific server card if it exists
            if (data && data.name) {
                this.updateServerCard(data.name);
            }
        });
        
        // Listen for server added events
        this.manager.on('servers-added', () => {
            console.log('[MCPMarketplace] Servers added event');
            // Refresh all visible server cards
            this.refreshVisibleCards();
        });
        
        // Listen for servers loaded events (when config is reloaded)
        this.manager.on('servers-loaded', () => {
            console.log('[MCPMarketplace] Servers loaded event');
            // Refresh all visible server cards
            this.refreshVisibleCards();
        });
    }
    
    /**
     * Refresh all visible server cards without re-rendering the entire grid
     */
    refreshVisibleCards() {
        // Update each loaded server card
        this.loadedServers.forEach(server => {
            this.updateServerCard(server.id);
        });
    }

    /**
     * Load marketplace data from JSON
     */
    async loadMarketplaceData() {
        try {
            // Use absolute path from the root of the app
            const response = await fetch('../../modules/mcp/marketplace.json');
            this.marketplace = await response.json();
            console.log('[MCPMarketplace] Loaded marketplace data:', this.marketplace);
        } catch (error) {
            console.error('[MCPMarketplace] Error loading marketplace data:', error);
            // Provide a default marketplace structure
            this.marketplace = { 
                servers: [], 
                categories: [
                    { id: 'all', name: 'All', icon: 'grid' }
                ] 
            };
        }
    }

    /**
     * Render the marketplace UI
     */
    async render(container) {
        if (!this.marketplace) {
            await this.loadMarketplaceData();
        }
        
        // Ensure manager has the latest server state
        if (this.manager) {
            await this.manager.loadServers();
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
        
        // Fix the icon path to use the correct path relative to the HTML page
        let iconPath = server.icon;
        if (iconPath && iconPath.startsWith('./assets/')) {
            // Convert ./assets/ to ../../../assets/ to match the correct path from src/presentation/pages/
            iconPath = '../../../assets/' + iconPath.substring('./assets/'.length);
        }
        
        return `
            <div class="marketplace-card ${isInstalled ? 'installed' : ''}" data-server-id="${server.id}">
                <div class="card-header">
                    <div class="card-icon">
                        ${iconPath && iconPath.endsWith('.png') 
                            ? `<img src="${iconPath}" alt="${server.name} icon" width="48" height="48" onerror="this.parentElement.innerHTML='<i data-lucide=\\'package\\'></i>'" />` 
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
        
        // Use event delegation for install/uninstall buttons
        // This will handle all buttons, even those added dynamically
        const marketplaceGrid = container.querySelector('#marketplace-grid');
        if (marketplaceGrid) {
            console.log('[MCPMarketplace] Setting up event delegation for marketplace grid');
            marketplaceGrid.addEventListener('click', async (e) => {
                console.log('[MCPMarketplace] Click event on marketplace grid, target:', e.target);
                console.log('[MCPMarketplace] Target element tagName:', e.target.tagName);
                console.log('[MCPMarketplace] Target element className:', e.target.className);
                
                // Find the button that was clicked (could be the icon inside the button)
                const btn = e.target.closest('[data-action]');
                if (!btn) {
                    console.log('[MCPMarketplace] No button with data-action found');
                    return;
                }
                
                e.preventDefault();
                e.stopPropagation();
                
                const action = btn.dataset.action;
                const serverId = btn.dataset.server;
                
                console.log(`[MCPMarketplace] Button clicked via delegation - Action: ${action}, Server: ${serverId}`);
                
                if (!serverId) {
                    console.error('[MCPMarketplace] No server ID found on button');
                    return;
                }
                
                console.log(`[MCPMarketplace] Processing ${action} action for server ${serverId}`);
                
                if (action === 'install') {
                    console.log(`[MCPMarketplace] Calling installServer for ${serverId}`);
                    await this.installServer(serverId, container);
                } else if (action === 'uninstall') {
                    console.log(`[MCPMarketplace] Calling uninstallServer for ${serverId}`);
                    await this.uninstallServer(serverId, container);
                }
            });
        } else {
            console.error('[MCPMarketplace] Marketplace grid not found for event delegation');
        }
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
     * Note: With event delegation in place, this method is now simplified
     * and only needs to handle icon initialization
     */
    attachCardListeners(grid, serverIds) {
        // No need to attach click listeners here anymore since we're using
        // event delegation in attachEventListeners() method
        // This method is kept for compatibility and future use if needed
        
        // Just log for debugging
        serverIds.forEach(serverId => {
            const card = grid.querySelector(`[data-server-id="${serverId}"]`);
            if (!card) {
                console.warn(`[MCPMarketplace] Card not found for server: ${serverId}`);
            }
        });
    }

    /**
     * Update a single server card - Only updates the button state, not the entire card
     */
    updateServerCard(serverId) {
        const card = document.querySelector(`[data-server-id="${serverId}"]`);
        if (!card) {
            console.warn(`[MCPMarketplace] Card not found for server: ${serverId}`);
            return;
        }
        
        const server = this.marketplace.servers.find(s => s.id === serverId);
        if (!server) {
            console.warn(`[MCPMarketplace] Server not found in marketplace: ${serverId}`);
            return;
        }
        
        const isInstalled = this.manager.hasServer(serverId);
        const isInstalling = this.installingServers.has(serverId);
        
        // Find the card-actions div
        const actionsDiv = card.querySelector('.card-actions');
        if (!actionsDiv) {
            console.warn(`[MCPMarketplace] Actions div not found in card for server: ${serverId}`);
            return;
        }
        
        // Save the card-links section if it exists
        const cardLinksHTML = actionsDiv.querySelector('.card-links')?.outerHTML || '';
        
        // Update only the buttons in the actions div
        // Use SVG directly for better reliability
        let newButtonsHTML = '';
        if (isInstalled) {
            newButtonsHTML = `
                <div class="installed-actions">
                    <button class="btn-installed" disabled>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-circle"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg> Installed
                    </button>
                    <button class="btn-uninstall" data-action="uninstall" data-server="${serverId}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg> Uninstall
                    </button>
                </div>
            `;
            card.classList.add('installed');
        } else if (isInstalling) {
            newButtonsHTML = `
                <button class="btn-installing" disabled>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-2 spinning"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Installing...
                </button>
            `;
            card.classList.remove('installed');
        } else {
            newButtonsHTML = `
                <button class="btn-install" data-action="install" data-server="${serverId}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg> Install
                </button>
            `;
            card.classList.remove('installed');
        }
        
        // Update the actions div content, preserving the card-links
        actionsDiv.innerHTML = newButtonsHTML + cardLinksHTML;
        
        // Since we're using inline SVGs, we don't need to initialize Lucide icons
        // The SVGs are already embedded in the HTML
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
        console.log(`[MCPMarketplace] Installing server: ${serverId}`);
        
        const server = this.marketplace.servers.find(s => s.id === serverId);
        if (!server) {
            console.error(`[MCPMarketplace] Server not found in marketplace: ${serverId}`);
            return;
        }
        
        console.log(`[MCPMarketplace] Found server configuration:`, server);
        console.log(`[MCPMarketplace] Server config:`, JSON.stringify(server.config, null, 2));
        console.log(`[MCPMarketplace] Server requiresAuth: ${server.requiresAuth}, authFields:`, server.authFields);
        
        // Check if requires auth
        if (server.requiresAuth && server.authFields) {
            console.log(`[MCPMarketplace] Server requires authentication - showing auth modal`);
            try {
                const authData = await this.showAuthModal(server);
                console.log(`[MCPMarketplace] Auth modal result:`, authData ? 'Got auth data' : 'User cancelled');
                if (!authData) {
                    console.log(`[MCPMarketplace] User cancelled authentication`);
                    return; // User cancelled
                }
                
                // Add auth data to config
                server.config.env = authData;
                console.log(`[MCPMarketplace] Auth data added to config`);
            } catch (error) {
                console.error(`[MCPMarketplace] Error showing auth modal:`, error);
                this.showError(`Failed to show authentication dialog: ${error.message}`);
                return;
            }
        } else {
            console.log(`[MCPMarketplace] Server does not require auth or has no auth fields`);
        }
        
        // Mark as installing
        this.installingServers.add(serverId);
        // Update only the specific card instead of the whole grid
        this.updateServerCard(serverId);
        
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
            
            // Special handling for Puppeteer - install locally due to npx/zod issues
            if (serverId === 'puppeteer') {
                console.log('[MCPMarketplace] Special handling for Puppeteer installation - installing locally');
                try {
                    const { exec } = require('child_process');
                    const util = require('util');
                    const execPromise = util.promisify(exec);
                    const fs = require('fs').promises;
                    const path = require('path');
                    const os = require('os');
                    
                    // Create a local directory for MCP servers
                    const mcpServersDir = path.join(os.homedir(), '.codeagentswarm', 'mcp-servers', 'puppeteer');
                    console.log('[MCPMarketplace] Creating directory:', mcpServersDir);
                    
                    // Create directory if it doesn't exist
                    await fs.mkdir(mcpServersDir, { recursive: true });
                    
                    // Create a package.json
                    const packageJson = {
                        name: 'puppeteer-mcp-server-local',
                        version: '1.0.0',
                        private: true,
                        type: 'module',
                        dependencies: {
                            '@modelcontextprotocol/server-puppeteer': 'latest'
                        }
                    };
                    
                    await fs.writeFile(
                        path.join(mcpServersDir, 'package.json'),
                        JSON.stringify(packageJson, null, 2)
                    );
                    
                    // Install dependencies
                    console.log('[MCPMarketplace] Installing Puppeteer MCP server locally...');
                    this.showInfo('Installing Puppeteer MCP server locally, this may take a moment...');
                    
                    const installResult = await execPromise('npm install --silent', {
                        cwd: mcpServersDir,
                        timeout: 90000 // 90 seconds timeout
                    });
                    
                    console.log('[MCPMarketplace] Installation completed');
                    
                    // The server-puppeteer dist/index.js is already an executable script
                    // We just need to point to it directly
                    const serverPath = path.join(mcpServersDir, 'node_modules', '@modelcontextprotocol', 'server-puppeteer', 'dist', 'index.js');
                    
                    // Update the config to use the local installation
                    configToUse.command = 'node';
                    configToUse.args = [serverPath];
                    
                    console.log('[MCPMarketplace] Puppeteer MCP server installed locally at:', mcpServersDir);
                } catch (installError) {
                    console.error('[MCPMarketplace] Failed to install Puppeteer locally:', installError);
                    this.showError(`Failed to install Puppeteer: ${installError.message}`);
                    this.installingServers.delete(serverId);
                    this.updateServerCard(serverId);
                    return;
                }
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
            
            console.log(`[MCPMarketplace] Final config to be added:`, JSON.stringify(config, null, 2));
            
            // Add server via manager
            const result = await this.manager.addServers(JSON.stringify(config));
            
            if (result.success) {
                console.log(`[MCPMarketplace] Server ${serverId} added successfully to config`);
                
                // Special handling for Playwright - ensure browsers are installed
                if (serverId === 'playwright') {
                    console.log('[MCPMarketplace] Installing Playwright browsers...');
                    try {
                        // Use electron's node to run the installation
                        const { exec } = require('child_process');
                        const util = require('util');
                        const execPromise = util.promisify(exec);
                        
                        // Install Chromium browser for Playwright
                        await execPromise('npx playwright install chromium', {
                            timeout: 120000 // 2 minutes timeout
                        });
                        console.log('[MCPMarketplace] Playwright browsers installed successfully');
                    } catch (browserError) {
                        console.warn('[MCPMarketplace] Failed to install Playwright browsers:', browserError);
                        // Show warning but don't fail the installation
                        this.showWarning(`${server.name} installed, but browsers may need manual installation: npx playwright install chromium`);
                    }
                }
                
                // Special handling for Puppeteer - ensure Chrome is available
                if (serverId === 'puppeteer') {
                    console.log('[MCPMarketplace] Puppeteer installed - Chrome will be downloaded on first use');
                    this.showSuccess(`${server.name} installed successfully!`);
                } else {
                    this.showSuccess(`${server.name} installed successfully!`);
                }
                
                // Reload servers to update UI
                await this.manager.loadServers();
                
                // Verify the server was actually added to the config
                const addedServer = this.manager.hasServer(serverId);
                if (addedServer) {
                    console.log(`[MCPMarketplace] Verified: Server ${serverId} is now in the configuration`);
                } else {
                    console.warn(`[MCPMarketplace] Warning: Server ${serverId} was not found in configuration after adding`);
                }
                
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
            // Update only the specific card instead of the whole grid
            // Add a small delay to ensure DOM is ready
            setTimeout(() => {
                this.updateServerCard(serverId);
            }, 100);
        }
    }

    /**
     * Show authentication modal
     */
    async showAuthModal(server) {
        console.log('[MCPMarketplace] showAuthModal called for server:', server.id);
        console.log('[MCPMarketplace] Server details:', {
            id: server.id,
            name: server.name,
            requiresAuth: server.requiresAuth,
            authFields: server.authFields
        });
        
        return new Promise((resolve) => {
            try {
                console.log('[MCPMarketplace] Creating auth modal promise...');
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
            
            // Fix the icon path for modal display
            let iconElement = '';
            if (server.icon) {
                let iconPath = server.icon;
                if (iconPath.startsWith('./assets/')) {
                    // Convert ./assets/ to ../../../assets/ to match the correct path
                    iconPath = '../../../assets/' + iconPath.substring('./assets/'.length);
                }
                
                if (iconPath.endsWith('.png') || iconPath.endsWith('.jpg') || iconPath.endsWith('.svg')) {
                    iconElement = `<img src="${iconPath}" alt="${server.name}" width="20" height="20" style="display: inline-block; vertical-align: middle;" onerror="this.style.display='none'" />`;
                } else {
                    iconElement = server.icon;
                }
            }
            
            const modalHtml = `
                <div class="mcp-marketplace-auth-modal" id="mcp-auth-modal">
                    <div class="auth-modal-content">
                        <div class="auth-modal-header">
                            <h3>${iconElement} Configure ${server.name}</h3>
                            <button class="auth-modal-close" id="mcp-auth-close">
                                <i data-lucide="x"></i>
                            </button>
                        </div>
                        
                        <div class="auth-modal-body">
                            ${bodyContent}
                        </div>
                        
                        <div class="auth-modal-footer">
                            <button class="btn-cancel" id="mcp-auth-cancel">Cancel</button>
                            <button class="btn-primary" id="mcp-auth-submit">Install</button>
                        </div>
                    </div>
                </div>
            `;
            
            console.log('[MCPMarketplace] Adding modal HTML to body');
            console.log('[MCPMarketplace] Current body element:', document.body);
            console.log('[MCPMarketplace] Modal HTML length:', modalHtml.length);
            
            // Add modal to body
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            // Try to find the modal element
            const modal = document.getElementById('mcp-auth-modal');
            
            if (!modal) {
                console.error('[MCPMarketplace] Failed to create modal element');
                console.error('[MCPMarketplace] Body innerHTML length:', document.body.innerHTML.length);
                console.error('[MCPMarketplace] Looking for mcp-marketplace-auth-modal in DOM...');
                const allModals = document.querySelectorAll('.mcp-marketplace-auth-modal');
                console.error('[MCPMarketplace] Found modals with class mcp-marketplace-auth-modal:', allModals.length);
                resolve(null);
                return;
            }
            
            console.log('[MCPMarketplace] Modal created successfully:', modal);
            console.log('[MCPMarketplace] Modal display style:', window.getComputedStyle(modal).display);
            console.log('[MCPMarketplace] Modal visibility:', window.getComputedStyle(modal).visibility);
            console.log('[MCPMarketplace] Modal z-index:', window.getComputedStyle(modal).zIndex);
            
            // Force the modal to be visible with inline styles
            console.log('[MCPMarketplace] Forcing modal display with inline styles...');
            modal.style.display = 'flex';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100%';
            modal.style.height = '100%';
            modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
            modal.style.zIndex = '200000';
            modal.style.justifyContent = 'center';
            modal.style.alignItems = 'center';
            modal.style.visibility = 'visible';
            modal.style.opacity = '1';
            
            // Ensure the modal has the correct class
            if (!modal.classList.contains('mcp-marketplace-auth-modal')) {
                modal.classList.add('mcp-marketplace-auth-modal');
            }
            
            console.log('[MCPMarketplace] After forcing styles:');
            console.log('[MCPMarketplace] - display:', modal.style.display);
            console.log('[MCPMarketplace] - visibility:', modal.style.visibility);
            console.log('[MCPMarketplace] - z-index:', modal.style.zIndex);
            console.log('[MCPMarketplace] - class:', modal.className);
            
            // Also ensure the content is visible
            const modalContent = modal.querySelector('.auth-modal-content');
            if (modalContent) {
                modalContent.style.backgroundColor = '#1e1e1e';
                modalContent.style.borderRadius = '8px';
                modalContent.style.padding = '20px';
                modalContent.style.maxWidth = '500px';
                modalContent.style.width = '90%';
                modalContent.style.maxHeight = '80vh';
                modalContent.style.overflow = 'auto';
                modalContent.style.position = 'relative';
                console.log('[MCPMarketplace] Modal content styles applied');
            }
            
            // Force a reflow to ensure styles are applied
            modal.offsetHeight;
            
            // Use setTimeout to ensure the modal is visible after any other scripts run
            setTimeout(() => {
                if (modal && modal.style.display !== 'flex') {
                    console.log('[MCPMarketplace] Modal was hidden, forcing display again...');
                    modal.style.display = 'flex';
                    modal.style.visibility = 'visible';
                    modal.style.opacity = '1';
                }
            }, 100);
            
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
            const submitButton = document.getElementById('mcp-auth-submit');
            if (!submitButton) {
                console.error('[MCPMarketplace] Submit button not found in modal');
                modal.remove();
                resolve(null);
                return;
            }
            
            submitButton.addEventListener('click', () => {
                console.log('[MCPMarketplace] Auth submit button clicked');
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
                    console.log('[MCPMarketplace] Processing auth fields for server:', server.id);
                    console.log('[MCPMarketplace] Auth fields:', server.authFields);
                    
                    server.authFields.forEach(field => {
                        console.log(`[MCPMarketplace] Processing field: ${field.key}`);
                        const input = document.getElementById(field.key);
                        
                        if (!input) {
                            console.error(`[MCPMarketplace] Input element not found for field: ${field.key}`);
                            valid = false;
                            return;
                        }
                        
                        console.log(`[MCPMarketplace] Field ${field.key} value:`, input.value ? 'Has value' : 'Empty');
                        
                        if (field.required && !input.value) {
                            console.log(`[MCPMarketplace] Field ${field.key} is required but empty`);
                            valid = false;
                            input.classList.add('error');
                        } else {
                            authData[field.key] = input.value;
                            console.log(`[MCPMarketplace] Field ${field.key} added to auth data`);
                        }
                    });
                }
                
                console.log(`[MCPMarketplace] Form validation result: ${valid ? 'Valid' : 'Invalid'}`);
                console.log('[MCPMarketplace] Auth data collected:', authData);
                
                if (valid) {
                    console.log('[MCPMarketplace] Validation passed, closing modal and resolving with auth data');
                    modal.remove();
                    resolve(authData);
                } else {
                    console.log('[MCPMarketplace] Validation failed, keeping modal open');
                }
            });
            
            // Handle cancel
            let closeModal = () => {
                console.log('[MCPMarketplace] Closing modal - user cancelled');
                modal.remove();
                resolve(null);
            };
            
            const cancelButton = document.getElementById('mcp-auth-cancel');
            const closeButton = document.getElementById('mcp-auth-close');
            
            if (cancelButton) {
                cancelButton.addEventListener('click', closeModal);
            } else {
                console.warn('[MCPMarketplace] Cancel button not found');
            }
            
            if (closeButton) {
                closeButton.addEventListener('click', closeModal);
            } else {
                console.warn('[MCPMarketplace] Close button not found');
            }
            
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
            
            } catch (error) {
                console.error('[MCPMarketplace] Error showing auth modal:', error);
                resolve(null);
            }
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
                
                // Update only the specific card instead of the whole grid
                this.updateServerCard(serverId);
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
                <div class="mcp-confirm-modal" id="mcp-confirm-modal">
                    <div class="confirm-modal-content">
                        <div class="confirm-modal-header">
                            <h3>${title}</h3>
                            <button class="confirm-modal-close" id="mcp-confirm-close">
                                <i data-lucide="x"></i>
                            </button>
                        </div>
                        
                        <div class="confirm-modal-body">
                            <p>${message}</p>
                        </div>
                        
                        <div class="confirm-modal-footer">
                            <button class="btn-cancel" id="mcp-confirm-cancel">${cancelText}</button>
                            <button class="btn-danger" id="mcp-confirm-confirm">${confirmText}</button>
                        </div>
                    </div>
                </div>
            `;
            
            // Add modal to body
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            const modal = document.getElementById('mcp-confirm-modal');
            
            // Initialize Lucide icons
            if (window.lucide) {
                window.lucide.createIcons();
            }
            
            // Handle confirm
            document.getElementById('mcp-confirm-confirm').addEventListener('click', () => {
                modal.remove();
                resolve(true);
            });
            
            // Handle cancel
            const closeModal = () => {
                modal.remove();
                resolve(false);
            };
            
            document.getElementById('mcp-confirm-cancel').addEventListener('click', closeModal);
            document.getElementById('mcp-confirm-close').addEventListener('click', closeModal);
            
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
     * Show warning message
     */
    showWarning(message) {
        const toast = document.createElement('div');
        toast.className = 'mcp-toast warning';
        toast.innerHTML = `
            <i data-lucide="alert-triangle"></i>
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
     * Show info message
     */
    showInfo(message) {
        const toast = document.createElement('div');
        toast.className = 'mcp-toast info';
        toast.innerHTML = `
            <i data-lucide="info"></i>
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
        }, 4000);
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
    
    /**
     * Clean up resources and listeners
     */
    destroy() {
        // Remove manager event listeners
        if (this.manager) {
            this.manager.off('server-removed', this.refreshVisibleCards);
            this.manager.off('servers-added', this.refreshVisibleCards);
            this.manager.off('servers-loaded', this.refreshVisibleCards);
        }
        
        // Clean up intersection observer if exists
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        
        // Clear state
        this.loadedServers = [];
        this.installingServers.clear();
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MCPMarketplace;
}
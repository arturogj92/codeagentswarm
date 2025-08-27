/**
 * Authentication Manager for Electron App
 * Handles OAuth login, user state, and UI updates
 */

class AuthManager {
    constructor() {
        this.user = null;
        this.authButton = document.getElementById('auth-btn');
        this.authModal = document.getElementById('auth-modal');
        this.authIcon = document.getElementById('auth-icon');
        this.userAvatar = document.getElementById('user-avatar');
        this.dropdownAvatar = document.getElementById('dropdown-user-avatar');
        this.userName = document.getElementById('user-name');
        this.userEmail = document.getElementById('user-email');
        this.userInfo = document.getElementById('auth-user-info');
        this.signedOutMenu = document.getElementById('auth-menu-signed-out');
        this.signedInMenu = document.getElementById('auth-menu-signed-in');
        this.closeModalBtn = document.getElementById('close-auth-modal');
        
        // Override lucide.createIcons to maintain our styles
        this.setupLucideOverride();
        
        this.init();
    }

    setupLucideOverride() {
        // Store original createIcons function
        if (window.lucide && window.lucide.createIcons) {
            const originalCreateIcons = window.lucide.createIcons.bind(window.lucide);
            
            // Override with our version that maintains auth icon state
            window.lucide.createIcons = (...args) => {
                // Call original function
                const result = originalCreateIcons(...args);
                
                // Reapply our auth icon visibility state after icons are created
                setTimeout(() => {
                    this.updateAuthIconVisibility();
                }, 0);
                
                return result;
            };
        }
    }
    
    updateAuthIconVisibility() {
        // Get fresh references to the icon elements (they might have been recreated by Lucide)
        const authIcon = document.querySelector('#auth-btn svg[data-lucide="user"], #auth-btn i[data-lucide="user"]');
        const userAvatar = document.getElementById('user-avatar');
        
        if (this.user) {
            // User is logged in - hide icon, show avatar
            if (authIcon) {
                authIcon.style.display = 'none';
            }
            if (userAvatar) {
                userAvatar.style.display = 'block';
            }
        } else {
            // User is not logged in - show icon, hide avatar
            if (authIcon) {
                authIcon.style.display = 'block';
            }
            if (userAvatar) {
                userAvatar.style.display = 'none';
            }
        }
    }

    async init() {
        // Check for existing auth data
        await this.checkAuthStatus();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Listen for auth events from main process
        if (window.ipcRenderer) {
            window.ipcRenderer.on('auth-success', (event, data) => {
                this.handleAuthSuccess(data);
            });
            
            window.ipcRenderer.on('auth-error', (event, data) => {
                this.handleAuthError(data);
            });
        }
        
        // Re-initialize when DOM might change (e.g., after Lucide icons are created)
        this.observeForDOMChanges();
    }
    
    observeForDOMChanges() {
        // Watch for changes that might affect the auth button
        const observer = new MutationObserver(() => {
            // Check if auth button still exists and has listener
            const currentAuthBtn = document.getElementById('auth-btn');
            if (currentAuthBtn && currentAuthBtn !== this.authButton) {

                this.authButton = currentAuthBtn;
                this.setupEventListeners();
            }
        });
        
        // Observe the header area for changes
        const header = document.querySelector('.header');
        if (header) {
            observer.observe(header, { 
                childList: true, 
                subtree: true,
                attributes: true,
                attributeFilter: ['id']
            });
        }
    }

    setupEventListeners() {
        // Remove any existing listeners first to prevent duplicates
        if (this.authButtonClickHandler) {
            this.authButton?.removeEventListener('click', this.authButtonClickHandler);
        }
        
        // Create the click handler
        this.authButtonClickHandler = (e) => {
            e.stopPropagation();
            e.preventDefault();

            this.openModal();
        };
        
        // Open modal on button click
        if (this.authButton) {
            this.authButton.addEventListener('click', this.authButtonClickHandler);

        } else {
            console.error('Auth button not found during setupEventListeners');
        }
        
        // Close modal on close button click
        this.closeModalBtn?.addEventListener('click', () => {
            this.closeModal();
        });
        
        // Close modal when clicking outside the modal content
        this.authModal?.addEventListener('click', (e) => {
            if (e.target === this.authModal) {
                this.closeModal();
            }
        });
        
        // Close modal on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.authModal?.classList.contains('show')) {
                this.closeModal();
            }
        });
        
        // Handle provider login buttons
        document.querySelectorAll('.auth-menu-item[data-provider]').forEach(button => {
            button.addEventListener('click', (e) => {
                const provider = e.currentTarget.dataset.provider;
                this.loginWithProvider(provider);
            });
        });
        
        // Handle logout
        document.getElementById('auth-logout')?.addEventListener('click', () => {
            this.logout();
        });
    }

    async checkAuthStatus() {
        try {

            // Check if we have saved auth data
            if (!window.ipcRenderer) {
                console.warn('ipcRenderer not available, skipping auth check');
                return;
            }
            const authData = await window.ipcRenderer.invoke('get-auth-data');

            if (authData && authData.user) {
                this.setUser(authData.user);
            } else {

                this.setUser(null);
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
        }
    }

    openModal() {
        if (this.authModal) {

            // Force display block first to ensure modal is visible
            this.authModal.style.display = 'flex';
            
            // Update modal header based on auth status
            const modalHeader = this.authModal.querySelector('.auth-modal-header h2');
            if (modalHeader) {
                modalHeader.textContent = this.user ? 'Account' : 'Login';
            }
            
            // Ensure correct menu is shown based on auth status
            if (this.user) {
                // User is logged in
                if (this.signedOutMenu) this.signedOutMenu.style.display = 'none';
                if (this.signedInMenu) this.signedInMenu.style.display = 'block';
                if (this.userInfo) this.userInfo.style.display = 'flex';
            } else {
                // User is not logged in
                if (this.signedOutMenu) this.signedOutMenu.style.display = 'block';
                if (this.signedInMenu) this.signedInMenu.style.display = 'none';
                if (this.userInfo) this.userInfo.style.display = 'none';
            }
            
            // Add show class after a brief delay to trigger animation
            requestAnimationFrame(() => {
                this.authModal.classList.add('show');
            });
            
            // Update Lucide icons in the modal
            if (window.lucide) {
                setTimeout(() => {
                    window.lucide.createIcons();
                }, 50);
            }
        } else {
            console.error('Auth modal element not found');
        }
    }

    closeModal() {
        if (this.authModal) {
            this.authModal.classList.remove('show');
            // Also remove inline display style after animation
            setTimeout(() => {
                this.authModal.style.display = '';
            }, 300); // Match animation duration
        }
    }

    async loginWithProvider(provider) {
        try {
            // Close modal
            this.closeModal();
            
            // Show loading state
            this.showLoadingState();
            
            // Open OAuth URL in default browser
            await window.ipcRenderer.invoke('open-auth-url', provider);
            
            // The auth callback will be handled by the main process
            // and will trigger the auth-success event
        } catch (error) {
            console.error('Login error:', error);
            this.hideLoadingState();
            this.showError('Failed to open login page');
        }
    }

    async handleAuthSuccess(data) {

        // Hide loading state
        this.hideLoadingState();
        
        // Auth data is already saved by the main process when it receives the callback
        // We just need to update the UI
        
        // Update UI with user info
        this.setUser(data.user);
        
        // Show success notification
        this.showNotification('Login Successful', `Welcome back, ${data.user.name || data.user.email}!`);
    }

    handleAuthError(data) {
        console.error('Authentication error:', data.error);
        
        // Hide loading state
        this.hideLoadingState();
        
        // Show error message
        this.showError(data.error || 'Authentication failed');
    }

    setUser(user) {
        this.user = user;

        if (user) {
            // Add visual feedback - green icon for logged in state
            this.authButton.classList.add('logged-in');
            
            // Set up avatar with proper error handling
            const avatarUrl = user.avatar_url || this.getDefaultAvatar(user.email);
            
            // Update icon visibility using our centralized function
            this.updateAuthIconVisibility();
            
            // Clear any existing handlers first
            this.userAvatar.onerror = null;
            this.userAvatar.onload = null;
            
            // Set up new handlers
            this.userAvatar.onerror = () => {
                // If avatar fails to load, use default avatar instead
                console.warn('Avatar failed to load, using default avatar');
                // Still keep avatar visible, just change source
                if (this.userAvatar.src !== this.getDefaultAvatar(user.email)) {
                    this.userAvatar.src = this.getDefaultAvatar(user.email);
                }
                // Ensure visibility is correct
                this.updateAuthIconVisibility();
            };
            
            this.userAvatar.onload = () => {
                // Avatar loaded successfully, ensure visibility is correct
                this.updateAuthIconVisibility();
            };
            
            // Set the avatar source (this triggers onload or onerror)
            this.userAvatar.src = avatarUrl;
            this.authButton.title = user.name || user.email;
            
            // Update dropdown avatar with same error handling
            if (this.dropdownAvatar) {
                // Ensure dropdown avatar is visible immediately
                this.dropdownAvatar.style.display = 'block';
                
                // Clear existing handlers
                this.dropdownAvatar.onerror = null;
                this.dropdownAvatar.onload = null;
                
                // Set up new handlers
                this.dropdownAvatar.onerror = () => {
                    // If avatar fails to load, use default avatar instead
                    if (this.dropdownAvatar.src !== this.getDefaultAvatar(user.email)) {
                        this.dropdownAvatar.src = this.getDefaultAvatar(user.email);
                    }
                    // Keep dropdown avatar visible
                    this.dropdownAvatar.style.display = 'block';
                };
                
                this.dropdownAvatar.onload = () => {
                    // Keep dropdown avatar visible
                    this.dropdownAvatar.style.display = 'block';
                };
                
                // Set the source
                this.dropdownAvatar.src = avatarUrl;
            }
            this.userName.textContent = user.name || 'User';
            this.userEmail.textContent = user.email;
            
            // Show/hide appropriate menu sections
            this.userInfo.style.display = 'flex';
            this.signedOutMenu.style.display = 'none';
            this.signedInMenu.style.display = 'block';
        } else {
            // Remove visual feedback - no green border for logged out state
            this.authButton.classList.remove('logged-in');
            
            // Reset to signed out state using centralized function
            this.updateAuthIconVisibility();
            this.authButton.title = 'Sign In';
            
            // Show/hide appropriate menu sections
            this.userInfo.style.display = 'none';
            this.signedOutMenu.style.display = 'block';
            this.signedInMenu.style.display = 'none';
        }
    }

    async logout() {
        try {
            // Close modal
            this.closeModal();
            
            // Clear auth data from main process (which will also clear from auth service)
            await window.ipcRenderer.invoke('clear-auth-data');
            
            // Reset UI
            this.setUser(null);
            
            // Show notification
            this.showNotification('Signed Out', 'You have been successfully signed out');
        } catch (error) {
            console.error('Logout error:', error);
            this.showError('Failed to sign out');
        }
    }

    getDefaultAvatar(email) {
        // Generate avatar URL from email using Gravatar or similar service
        const hash = this.hashEmail(email);
        return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=40`;
    }

    hashEmail(email) {
        // Simple hash function for demo (in production, use proper MD5)
        let hash = 0;
        for (let i = 0; i < email.length; i++) {
            const char = email.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }

    showLoadingState() {
        this.authButton.classList.add('loading');
        this.authButton.disabled = true;
    }

    hideLoadingState() {
        this.authButton.classList.remove('loading');
        this.authButton.disabled = false;
    }

    showNotification(title, message) {
        // Use system notification if available
        if (window.Notification && Notification.permission === 'granted') {
            new Notification(title, { body: message });
        } else {
            // Fallback to console log

        }
    }

    showError(message) {
        console.error('Auth Error:', message);
        // You could also show a toast notification here
    }
}

// Initialize when DOM is ready and ipcRenderer is available
function initAuthManager() {
    // Check if ipcRenderer is available, if not wait a bit
    if (!window.ipcRenderer) {

        setTimeout(initAuthManager, 100);
        return;
    }
    
    // Only create if not already created
    if (!window.authManager) {
        window.authManager = new AuthManager();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthManager);
} else {
    initAuthManager();
}

module.exports = AuthManager;
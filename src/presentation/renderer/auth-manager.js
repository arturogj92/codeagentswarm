/**
 * Authentication Manager for Electron App
 * Handles OAuth login, user state, and UI updates
 */

class AuthManager {
    constructor() {
        this.user = null;
        this.authButton = document.getElementById('auth-btn');
        this.authDropdown = document.getElementById('auth-dropdown');
        this.authIcon = document.getElementById('auth-icon');
        this.userAvatar = document.getElementById('user-avatar');
        this.dropdownAvatar = document.getElementById('dropdown-user-avatar');
        this.userName = document.getElementById('user-name');
        this.userEmail = document.getElementById('user-email');
        this.userInfo = document.getElementById('auth-user-info');
        this.signedOutMenu = document.getElementById('auth-menu-signed-out');
        this.signedInMenu = document.getElementById('auth-menu-signed-in');
        
        this.init();
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
    }

    setupEventListeners() {
        // Toggle dropdown on button click
        this.authButton?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.authDropdown?.contains(e.target) && e.target !== this.authButton) {
                this.closeDropdown();
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
            const authData = await window.ipcRenderer.invoke('get-auth-data');
            
            if (authData && authData.user) {
                this.setUser(authData.user);
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
        }
    }

    toggleDropdown() {
        if (this.authDropdown.style.display === 'none' || !this.authDropdown.style.display) {
            this.openDropdown();
        } else {
            this.closeDropdown();
        }
    }

    openDropdown() {
        // Position dropdown relative to button
        const buttonRect = this.authButton.getBoundingClientRect();
        this.authDropdown.style.right = `${window.innerWidth - buttonRect.right}px`;
        this.authDropdown.style.top = `${buttonRect.bottom + 5}px`;
        this.authDropdown.style.display = 'block';
    }

    closeDropdown() {
        this.authDropdown.style.display = 'none';
    }

    async loginWithProvider(provider) {
        try {
            // Close dropdown
            this.closeDropdown();
            
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
        console.log('Authentication successful:', data.user);
        
        // Hide loading state
        this.hideLoadingState();
        
        // Save auth data to secure storage
        const authService = require('../../infrastructure/services/auth-service');
        await authService.saveAuthData(data);
        
        // Update UI with user info
        this.setUser(data.user);
        
        // Close dropdown
        this.closeDropdown();
        
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
            // Set up avatar with proper error handling
            const avatarUrl = user.avatar_url || this.getDefaultAvatar(user.email);
            
            // Update button avatar
            this.userAvatar.onerror = () => {
                // If avatar fails to load, show icon instead
                console.warn('Avatar failed to load, showing icon');
                this.authIcon.style.display = 'block';
                this.userAvatar.style.display = 'none';
            };
            
            this.userAvatar.onload = () => {
                // Avatar loaded successfully, show it
                this.authIcon.style.display = 'none';
                this.userAvatar.style.display = 'block';
            };
            
            // Set the avatar source (this triggers onload or onerror)
            this.userAvatar.src = avatarUrl;
            this.authButton.title = user.name || user.email;
            
            // Update dropdown avatar with same error handling
            this.dropdownAvatar.onerror = () => {
                this.dropdownAvatar.style.display = 'none';
            };
            
            this.dropdownAvatar.onload = () => {
                this.dropdownAvatar.style.display = 'block';
            };
            
            this.dropdownAvatar.src = avatarUrl;
            this.userName.textContent = user.name || 'User';
            this.userEmail.textContent = user.email;
            
            // Show/hide appropriate menu sections
            this.userInfo.style.display = 'flex';
            this.signedOutMenu.style.display = 'none';
            this.signedInMenu.style.display = 'block';
        } else {
            // Reset to signed out state
            this.authIcon.style.display = 'block';
            this.userAvatar.style.display = 'none';
            this.authButton.title = 'Sign In';
            
            // Show/hide appropriate menu sections
            this.userInfo.style.display = 'none';
            this.signedOutMenu.style.display = 'block';
            this.signedInMenu.style.display = 'none';
        }
    }

    async logout() {
        try {
            // Close dropdown
            this.closeDropdown();
            
            // Clear auth data
            const authService = require('../../infrastructure/services/auth-service');
            await authService.logout();
            
            // Clear from main process
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
            console.log(`${title}: ${message}`);
        }
    }

    showError(message) {
        console.error('Auth Error:', message);
        // You could also show a toast notification here
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.authManager = new AuthManager();
    });
} else {
    window.authManager = new AuthManager();
}

module.exports = AuthManager;
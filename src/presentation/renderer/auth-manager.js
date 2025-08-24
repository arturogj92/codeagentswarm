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
        // Open modal on button click
        this.authButton?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openModal();
        });
        
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
            console.log('Checking auth status...');
            // Check if we have saved auth data
            const authData = await window.ipcRenderer.invoke('get-auth-data');
            console.log('Auth data received:', authData);
            
            if (authData && authData.user) {
                this.setUser(authData.user);
            } else {
                console.log('No auth data found, user is not logged in');
                this.setUser(null);
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
        }
    }

    openModal() {
        if (this.authModal) {
            console.log('Opening modal, user state:', this.user);
            
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
            
            this.authModal.classList.add('show');
            // Update Lucide icons in the modal
            if (window.lucide) {
                setTimeout(() => {
                    window.lucide.createIcons();
                }, 50);
            }
        }
    }

    closeModal() {
        if (this.authModal) {
            this.authModal.classList.remove('show');
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
        console.log('Authentication successful:', data.user);
        
        // Hide loading state
        this.hideLoadingState();
        
        // Save auth data to secure storage
        const authService = require('../../infrastructure/services/auth-service');
        await authService.saveAuthData(data);
        
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
        console.log('Setting user:', user);
        console.log('Avatar URL from user object:', user?.avatar_url);
        
        if (user) {
            // Add visual feedback - green icon for logged in state
            this.authButton.classList.add('logged-in');
            
            // Set up avatar with proper error handling
            const avatarUrl = user.avatar_url || this.getDefaultAvatar(user.email);
            console.log('Final avatar URL being used:', avatarUrl);
            
            // Update button avatar
            this.userAvatar.onerror = (e) => {
                // If avatar fails to load, show icon instead
                console.warn('Avatar failed to load:', avatarUrl);
                console.warn('Error event:', e);
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
            this.dropdownAvatar.onerror = (e) => {
                console.warn('Dropdown avatar failed to load:', avatarUrl);
                this.dropdownAvatar.style.display = 'none';
            };
            
            this.dropdownAvatar.onload = () => {
                console.log('Dropdown avatar loaded successfully');
                this.dropdownAvatar.style.display = 'block';
            };
            
            console.log('Setting dropdown avatar src to:', avatarUrl);
            this.dropdownAvatar.src = avatarUrl;
            this.userName.textContent = user.name || 'User';
            this.userEmail.textContent = user.email;
            
            // Show/hide appropriate menu sections
            this.userInfo.style.display = 'flex';
            this.signedOutMenu.style.display = 'none';
            this.signedInMenu.style.display = 'block';
        } else {
            // Remove visual feedback - no green border for logged out state
            this.authButton.classList.remove('logged-in');
            
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
            // Close modal
            this.closeModal();
            
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
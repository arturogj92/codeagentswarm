const { safeStorage } = require('electron');

// Try to load electron-store, fallback to null if it fails
let Store;
try {
    Store = require('electron-store');
} catch (err) {
    console.warn('electron-store not available, using fallback storage');
    Store = null;
}

class AuthService {
    constructor() {
        // Create store if available
        if (Store) {
            this.store = new Store({
                name: 'auth-secure',
                encryptionKey: 'codeagentswarm-auth-2024', // In production, use a more secure key
                clearInvalidConfig: true
            });
        } else {
            // Fallback to in-memory storage
            const storageData = {};
            this.store = {
                get: (key) => storageData[key],
                set: (key, value) => { storageData[key] = value; },
                delete: (key) => { delete storageData[key]; }
            };
        }
        
        this.user = null;
        this.token = null;
        this.refreshToken = null;
    }
    
    async ensureStore() {
        // Store is always available now (either real or fallback)
        return this.store;
    }

    /**
     * Initialize auth service and load saved credentials
     */
    async initialize() {
        try {
            // Load saved auth data if available
            const savedAuth = await this.loadAuthData();
            if (savedAuth && savedAuth.token) {
                this.user = savedAuth.user;
                this.token = savedAuth.token;
                this.refreshToken = savedAuth.refreshToken;
                
                // Validate token with backend
                const isValid = await this.validateToken();
                if (!isValid) {
                    // Try to refresh if invalid
                    await this.refreshAccessToken();
                }
                
                return true;
            }
            return false;
        } catch (error) {
            console.error('Auth initialization error:', error);
            return false;
        }
    }

    /**
     * Save auth data securely
     */
    async saveAuthData(data) {
        try {
            const store = await this.ensureStore();
            if (safeStorage.isEncryptionAvailable()) {
                // Use native encryption if available (macOS Keychain)
                const encryptedToken = safeStorage.encryptString(data.token);
                const encryptedRefresh = safeStorage.encryptString(data.refreshToken);
                
                store.set('auth', {
                    user: data.user,
                    token: encryptedToken.toString('base64'),
                    refreshToken: encryptedRefresh.toString('base64'),
                    savedAt: Date.now()
                });
            } else {
                // Fallback to store encryption
                store.set('auth', {
                    user: data.user,
                    token: data.token,
                    refreshToken: data.refreshToken,
                    savedAt: Date.now()
                });
            }
            
            this.user = data.user;
            this.token = data.token;
            this.refreshToken = data.refreshToken;
            
            return true;
        } catch (error) {
            console.error('Error saving auth data:', error);
            return false;
        }
    }

    /**
     * Load auth data from secure storage
     */
    async loadAuthData() {
        try {
            const store = await this.ensureStore();
            const saved = store.get('auth');
            
            if (!saved) return null;
            
            // Check if data is too old (30 days)
            const age = Date.now() - (saved.savedAt || 0);
            if (age > 30 * 24 * 60 * 60 * 1000) {
                await this.clearAuthData();
                return null;
            }
            
            if (safeStorage.isEncryptionAvailable() && saved.token.length > 100) {
                // Decrypt if it was encrypted
                const tokenBuffer = Buffer.from(saved.token, 'base64');
                const refreshBuffer = Buffer.from(saved.refreshToken, 'base64');
                
                return {
                    user: saved.user,
                    token: safeStorage.decryptString(tokenBuffer),
                    refreshToken: safeStorage.decryptString(refreshBuffer)
                };
            } else {
                // Return as is if not encrypted
                return saved;
            }
        } catch (error) {
            console.error('Error loading auth data:', error);
            return null;
        }
    }

    /**
     * Clear all auth data
     */
    async clearAuthData() {
        try {
            const store = await this.ensureStore();
            store.delete('auth');
            this.user = null;
            this.token = null;
            this.refreshToken = null;
            return true;
        } catch (error) {
            console.error('Error clearing auth data:', error);
            return false;
        }
    }

    /**
     * Validate current token with backend
     */
    async validateToken() {
        if (!this.token) return false;
        
        try {
            const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
            const response = await fetch(`${backendUrl}/api/auth/validate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                return data.valid;
            }
            
            return false;
        } catch (error) {
            console.error('Token validation error:', error);
            return false;
        }
    }

    /**
     * Refresh access token using refresh token
     */
    async refreshAccessToken() {
        if (!this.refreshToken) return false;
        
        try {
            const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
            const response = await fetch(`${backendUrl}/api/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    refreshToken: this.refreshToken
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                
                // Update stored tokens
                this.token = data.accessToken;
                await this.saveAuthData({
                    user: data.user || this.user,
                    token: data.accessToken,
                    refreshToken: this.refreshToken
                });
                
                return true;
            }
            
            // If refresh fails, clear auth
            this.clearAuthData();
            return false;
        } catch (error) {
            console.error('Token refresh error:', error);
            return false;
        }
    }

    /**
     * Logout user
     */
    async logout() {
        try {
            if (this.token) {
                const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
                await fetch(`${backendUrl}/api/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    }
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Always clear local auth data
            this.clearAuthData();
        }
    }

    /**
     * Get current user
     */
    getUser() {
        return this.user;
    }

    /**
     * Get current token
     */
    getToken() {
        return this.token;
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!this.token && !!this.user;
    }
}

// Export singleton instance
module.exports = new AuthService();
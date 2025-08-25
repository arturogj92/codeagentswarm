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
            console.log('Saving auth data, store available:', !!store);
            console.log('User data to save:', data.user);
            
            if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
                // Use native encryption if available (macOS Keychain)
                console.log('Using native encryption (safeStorage)');
                const encryptedToken = safeStorage.encryptString(data.token);
                const encryptedRefresh = safeStorage.encryptString(data.refreshToken);
                
                store.set('auth', {
                    user: data.user,
                    token: encryptedToken.toString('base64'),
                    refreshToken: encryptedRefresh.toString('base64'),
                    savedAt: Date.now()
                });
            } else {
                // Fallback to store encryption or localStorage
                console.log('Using fallback storage (electron-store or memory)');
                if (store && store.set) {
                    store.set('auth', {
                        user: data.user,
                        token: data.token,
                        refreshToken: data.refreshToken,
                        savedAt: Date.now()
                    });
                    console.log('Data saved to electron-store');
                } else {
                    // Ultimate fallback to localStorage
                    console.log('Using localStorage fallback (this wont persist in main process)');
                    localStorage.setItem('auth', JSON.stringify({
                        user: data.user,
                        token: data.token,
                        refreshToken: data.refreshToken,
                        savedAt: Date.now()
                    }));
                }
            }
            
            this.user = data.user;
            this.token = data.token;
            this.refreshToken = data.refreshToken;
            
            console.log('Auth data saved successfully');
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
            console.log('Loading auth data, store available:', !!store);
            let saved;
            
            if (store && store.get) {
                saved = store.get('auth');
                console.log('Loaded from electron-store:', !!saved);
            } else {
                // Fallback to localStorage
                const savedStr = localStorage.getItem('auth');
                saved = savedStr ? JSON.parse(savedStr) : null;
                console.log('Loaded from localStorage:', !!saved);
            }
            
            if (!saved) {
                console.log('No saved auth data found');
                return null;
            }
            
            // Check if data is too old (30 days)
            const age = Date.now() - (saved.savedAt || 0);
            if (age > 30 * 24 * 60 * 60 * 1000) {
                await this.clearAuthData();
                return null;
            }
            
            if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable() && saved.token && saved.token.length > 100) {
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
            if (store && store.delete) {
                store.delete('auth');
            } else {
                // Fallback to localStorage
                localStorage.removeItem('auth');
            }
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
            // For Supabase JWTs, we can do basic validation locally
            // Check if token is expired by decoding the JWT
            const tokenParts = this.token.split('.');
            if (tokenParts.length !== 3) {
                return false;
            }
            
            try {
                const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
                const now = Math.floor(Date.now() / 1000);
                
                // Check if token is expired
                if (payload.exp && payload.exp < now) {
                    console.log('Token is expired');
                    return false;
                }
                
                // Token appears valid
                return true;
            } catch (e) {
                console.error('Error parsing token:', e);
                return false;
            }
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
            // For Supabase auth, token refresh would typically be handled by the Supabase client
            // Since we're not using the Supabase client directly here, we'll skip refresh
            // The app should re-authenticate when the token expires
            
            console.log('Token refresh not implemented for Supabase auth');
            console.log('User will need to re-authenticate when token expires');
            
            // Clear auth data to force re-authentication
            await this.clearAuthData();
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
            // For Supabase auth, we don't need to call a logout endpoint
            // Just clear the local session data
            // The token will be invalidated on the Supabase side when it expires
            // If you need to revoke the token immediately, you would need to use Supabase client SDK
            
            // Log for debugging
            console.log('Logging out user, clearing local auth data');
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Always clear local auth data
            await this.clearAuthData();
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
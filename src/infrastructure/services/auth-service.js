// Removed safeStorage to avoid keychain prompts - using electron-store encryption instead

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
            console.log('[AuthService] Starting initialization...');
            
            // Load saved auth data if available
            const savedAuth = await this.loadAuthData();
            console.log('[AuthService] Saved auth data loaded:', !!savedAuth);
            
            if (savedAuth && savedAuth.token) {
                this.user = savedAuth.user;
                this.token = savedAuth.token;
                this.refreshToken = savedAuth.refreshToken;
                
                console.log('[AuthService] User loaded:', this.user?.email);
                
                // Validate token with backend
                const isValid = await this.validateToken();
                console.log('[AuthService] Token validation result:', isValid);
                
                if (!isValid) {
                    console.log('[AuthService] Token invalid, attempting refresh...');
                    // Try to refresh if invalid
                    const refreshed = await this.refreshAccessToken();
                    if (!refreshed) {
                        console.log('[AuthService] Token refresh failed, clearing auth data');
                        this.user = null;
                        this.token = null;
                        this.refreshToken = null;
                        return false;
                    }
                }
                
                console.log('[AuthService] Initialization successful, user authenticated');
                return true;
            }
            
            console.log('[AuthService] No valid saved auth data found');
            return false;
        } catch (error) {
            console.error('[AuthService] Initialization error:', error);
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
            
            // Always use electron-store to avoid keychain prompts
            // The store already has its own encryption with encryptionKey
            console.log('Using electron-store with built-in encryption');
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
            console.log('[AuthService.loadAuthData] Store available:', !!store);
            let saved;
            
            if (store && store.get) {
                saved = store.get('auth');
                console.log('[AuthService.loadAuthData] Data loaded from electron-store:', !!saved);
                if (saved) {
                    console.log('[AuthService.loadAuthData] Auth data found with user:', saved.user?.email);
                }
            } else {
                // Fallback to localStorage
                const savedStr = localStorage.getItem('auth');
                saved = savedStr ? JSON.parse(savedStr) : null;
                console.log('[AuthService.loadAuthData] Loaded from localStorage fallback:', !!saved);
            }
            
            if (!saved) {
                console.log('[AuthService.loadAuthData] No saved auth data found in storage');
                return null;
            }
            
            // Check if data is too old (30 days)
            const age = Date.now() - (saved.savedAt || 0);
            const daysOld = Math.floor(age / (24 * 60 * 60 * 1000));
            console.log(`[AuthService.loadAuthData] Auth data is ${daysOld} days old`);
            
            if (age > 30 * 24 * 60 * 60 * 1000) {
                console.log('[AuthService.loadAuthData] Auth data expired (>30 days), clearing...');
                await this.clearAuthData();
                return null;
            }
            
            // Always return data as-is since we're not using safeStorage anymore
            // electron-store handles encryption/decryption internally
            console.log('[AuthService.loadAuthData] Returning valid auth data');
            return saved;
        } catch (error) {
            console.error('[AuthService.loadAuthData] Error loading auth data:', error);
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
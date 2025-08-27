const UpdateNotificationManager = require('../src/shared/utils/update-notification-manager');

describe('UpdateNotificationManager', () => {
    let manager;
    let mockStorage;
    let mockDocument;
    
    beforeEach(() => {
        // Use fake timers for better control
        jest.useFakeTimers();
        
        // Mock localStorage
        mockStorage = {
            items: {},
            getItem: function(key) { return this.items[key] || null; },
            setItem: function(key, value) { this.items[key] = value; },
            removeItem: function(key) { delete this.items[key]; }
        };
        
        // Mock document elements
        mockDocument = {
            getElementById: jest.fn(),
            createElement: jest.fn(() => ({
                className: '',
                innerHTML: '',
                style: {},
                appendChild: jest.fn(),
                addEventListener: jest.fn(),
                classList: {
                    add: jest.fn(),
                    remove: jest.fn()
                }
            })),
            head: {
                appendChild: jest.fn()
            },
            body: {
                appendChild: jest.fn(),
                contains: jest.fn(() => false)
            },
            querySelector: jest.fn(),
            querySelectorAll: jest.fn(() => [])
        };
        
        // Set up globals
        global.document = mockDocument;
        global.localStorage = mockStorage;
        global.window = {
            ipcRenderer: {
                on: jest.fn()
            },
            getComputedStyle: jest.fn(() => ({ position: 'static' }))
        };
        
        // Create manager instance
        manager = new UpdateNotificationManager();
    });
    
    afterEach(() => {
        if (manager) {
            manager.destroy();
        }
        // Clean up fake timers
        jest.clearAllTimers();
        jest.useRealTimers();
    });
    
    test('should initialize with correct default values', () => {
        expect(manager.checkInterval).toBe(60 * 60 * 1000); // 1 hour
        expect(manager.dismissDuration).toBe(24 * 60 * 60 * 1000); // 24 hours
        expect(manager.initialDelayOnStartup).toBe(5000); // 5 seconds
        expect(manager.hasUpdate).toBe(false);
        expect(manager.updateInfo).toBe(null);
    });
    
    test('should handle update available event', () => {
        const updateInfo = {
            version: '1.2.3',
            releaseDate: '2024-01-01',
            releaseNotes: 'Bug fixes'
        };
        
        manager.handleUpdateAvailable(updateInfo);
        
        expect(manager.hasUpdate).toBe(true);
        expect(manager.updateInfo).toEqual(updateInfo);
        expect(mockStorage.getItem('updateAvailable')).toBe('true');
        expect(mockStorage.getItem('updateVersion')).toBe('1.2.3');
    });
    
    test('should handle update not available event', () => {
        // Set up initial state with update
        manager.hasUpdate = true;
        manager.updateInfo = { version: '1.0.0' };
        mockStorage.setItem('updateAvailable', 'true');
        mockStorage.setItem('updateVersion', '1.0.0');
        
        manager.handleUpdateNotAvailable();
        
        expect(manager.hasUpdate).toBe(false);
        expect(manager.updateInfo).toBe(null);
        expect(mockStorage.getItem('updateAvailable')).toBe(null);
        expect(mockStorage.getItem('updateVersion')).toBe(null);
    });
    
    test('should not show highlight if update is dismissed for version', () => {
        mockStorage.setItem('updateAvailable', 'true');
        mockStorage.setItem('updateVersion', '1.2.3');
        mockStorage.setItem(manager.STORAGE_KEYS.DISMISSED_VERSION, '1.2.3');
        
        manager.checkForHighlight();
        
        // Should not create highlight badge
        expect(manager.highlightBadge).toBe(null);
    });
    
    test('should not show highlight if "dont show today" is active', () => {
        const now = Date.now();
        mockStorage.setItem('updateAvailable', 'true');
        mockStorage.setItem('updateVersion', '1.2.3');
        mockStorage.setItem(manager.STORAGE_KEYS.DONT_SHOW_TODAY, now.toString());
        
        manager.checkForHighlight();
        
        // Should not create highlight badge
        expect(manager.highlightBadge).toBe(null);
    });
    
    test('should show highlight after "dont show today" expires', () => {
        const dayAgo = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
        mockStorage.setItem('updateAvailable', 'true');
        mockStorage.setItem('updateVersion', '1.2.3');
        mockStorage.setItem(manager.STORAGE_KEYS.DONT_SHOW_TODAY, dayAgo.toString());
        
        // Mock settings button
        const mockSettingsBtn = {
            style: {},
            appendChild: jest.fn(),
            addEventListener: jest.fn()
        };
        mockDocument.getElementById.mockReturnValue(mockSettingsBtn);
        
        manager.checkForHighlight();
        
        // Should clear the "dont show today" flag
        expect(mockStorage.getItem(manager.STORAGE_KEYS.DONT_SHOW_TODAY)).toBe(null);
    });
    
    test('should reset all dismissals', () => {
        // Set various dismissal states
        mockStorage.setItem(manager.STORAGE_KEYS.DISMISSED_VERSION, '1.0.0');
        mockStorage.setItem(manager.STORAGE_KEYS.DONT_SHOW_TODAY, '123456');
        mockStorage.setItem(manager.STORAGE_KEYS.LAST_CHECK, '789012');
        
        manager.resetDismissals();
        
        // All dismissal keys should be removed
        expect(mockStorage.getItem(manager.STORAGE_KEYS.DISMISSED_VERSION)).toBe(null);
        expect(mockStorage.getItem(manager.STORAGE_KEYS.DONT_SHOW_TODAY)).toBe(null);
        expect(mockStorage.getItem(manager.STORAGE_KEYS.LAST_CHECK)).toBe(null);
    });
    
    test('should check for updates on startup after delay', () => {
        // Mock update available in storage
        mockStorage.setItem('updateAvailable', 'true');
        mockStorage.setItem('updateVersion', '1.2.3');
        
        // Mock settings button
        const mockSettingsBtn = {
            style: {},
            appendChild: jest.fn(),
            addEventListener: jest.fn()
        };
        mockDocument.getElementById.mockReturnValue(mockSettingsBtn);
        
        // Spy on checkForHighlight method
        const checkSpy = jest.spyOn(manager, 'checkForHighlight');
        
        // Should not have been called immediately
        expect(checkSpy).not.toHaveBeenCalled();
        
        // Fast-forward time past the initial delay
        jest.advanceTimersByTime(manager.initialDelayOnStartup);
        
        // Now it should have been called
        expect(checkSpy).toHaveBeenCalled();
    });
    
    test('should clean up on destroy', () => {
        // Set up interval
        manager.intervalId = setInterval(() => {}, 1000);
        
        // Create a mock highlight badge
        manager.highlightBadge = {
            parentNode: {
                removeChild: jest.fn()
            },
            remove: jest.fn()
        };
        
        const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
        
        manager.destroy();
        
        expect(clearIntervalSpy).toHaveBeenCalled();
        expect(manager.intervalId).toBe(null);
        expect(manager.highlightBadge).toBe(null);
    });
});
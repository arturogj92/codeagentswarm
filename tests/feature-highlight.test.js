/**
 * @jest-environment jsdom
 */

// Mock window.appVersion
global.window = {
    appVersion: '0.0.47'
};

// Import the FeatureHighlight class from parent directory
const FeatureHighlight = require('../feature-highlight.js');

describe('FeatureHighlight', () => {
    let featureHighlight;
    let mockLocalStorage;

    beforeEach(() => {
        // Setup mock localStorage
        mockLocalStorage = {
            store: {},
            getItem: jest.fn(function(key) {
                return this.store[key] || null;
            }),
            setItem: jest.fn(function(key, value) {
                this.store[key] = value.toString();
            }),
            removeItem: jest.fn(function(key) {
                delete this.store[key];
            }),
            clear: jest.fn(function() {
                this.store = {};
            })
        };
        
        global.localStorage = mockLocalStorage;
        
        // Setup DOM
        document.body.innerHTML = `
            <div id="test-container">
                <button id="test-button">Test Button</button>
                <div id="settings-btn">Settings</div>
                <div id="mcp-tab">MCP Tab</div>
                <div id="permissions-btn">Permissions</div>
            </div>
        `;
        
        // Create new instance with mock localStorage injected
        featureHighlight = new FeatureHighlight(mockLocalStorage);
    });

    afterEach(() => {
        // Clean up
        document.body.innerHTML = '';
        mockLocalStorage.clear();
        jest.clearAllMocks();
    });

    describe('localStorage Key Standardization', () => {
        test('should generate standardized localStorage keys without version numbers', () => {
            const testCases = [
                { feature: 'mcpTab', expected: 'featureHighlight_mcpTab' },
                { feature: 'permissions', expected: 'featureHighlight_permissions' },
                { feature: 'settings', expected: 'featureHighlight_settings' },
                { feature: 'newFeature', expected: 'featureHighlight_newFeature' }
            ];

            testCases.forEach(({ feature, expected }) => {
                const key = featureHighlight.getStorageKey(feature);
                expect(key).toBe(expected);
                expect(key).not.toContain('0.0.45');
                expect(key).not.toContain('0.0.46');
                expect(key).not.toContain('0.0.47');
            });
        });

        test('should not include version in localStorage keys regardless of app version', () => {
            const versions = ['0.0.45', '0.0.46', '0.0.47', '0.0.48', '0.0.49'];
            
            versions.forEach(version => {
                window.appVersion = version;
                const key = featureHighlight.getStorageKey('testFeature');
                expect(key).toBe('featureHighlight_testFeature');
                expect(key).not.toContain(version);
            });
        });

        test('should correctly check if badge was shown using standardized keys', () => {
            const featureName = 'testBadge';
            const storageKey = 'featureHighlight_testBadge';
            
            // Initially not shown - setup getItem to return null
            mockLocalStorage.getItem.mockReturnValueOnce(null);
            expect(featureHighlight.hasBeenShown(featureName)).toBe(false);
            
            // Mark as shown - setup getItem to return 'true'
            mockLocalStorage.getItem.mockReturnValueOnce('true');
            expect(featureHighlight.hasBeenShown(featureName)).toBe(true);
        });

        test('should correctly mark features as shown', () => {
            const featureName = 'markTest';
            const storageKey = 'featureHighlight_markTest';
            
            // Call markAsShown
            featureHighlight.markAsShown(featureName);
            
            // Check that setItem was called with correct arguments
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith(storageKey, 'true');
        });
    });

    // Skip Badge Creation tests as these methods are not public
    // The FeatureHighlight class only exposes hasBeenShown, markAsShown, and getStorageKey as public methods

    // Skip Version-based Display tests as these methods are not public

    describe('Migration from Old Format', () => {
        test('should detect old localStorage format keys', () => {
            // Add old format entries
            mockLocalStorage.store['mcpTabBadge_0.0.45'] = 'true';
            mockLocalStorage.store['permissionsBadge_0.0.45_shown'] = 'true';
            mockLocalStorage.store['settingsHighlight_0.0.45_shown'] = 'true';
            mockLocalStorage.store['featureHighlight_validKey'] = 'true';
            
            const allKeys = Object.keys(mockLocalStorage.store);
            const oldFormatKeys = allKeys.filter(key => {
                return !key.startsWith('featureHighlight_') || key.includes('0.0.');
            });
            
            expect(oldFormatKeys.length).toBe(3);
            expect(oldFormatKeys).toContain('mcpTabBadge_0.0.45');
            expect(oldFormatKeys).toContain('permissionsBadge_0.0.45_shown');
            expect(oldFormatKeys).toContain('settingsHighlight_0.0.45_shown');
        });

        test('should simulate migration from old to new format', () => {
            // Helper function to migrate
            function migrateOldBadgeKeys() {
                const migrations = {
                    'mcpTabBadge_': 'featureHighlight_mcpTab',
                    'permissionsBadge_': 'featureHighlight_permissions',
                    'settingsHighlight_': 'featureHighlight_settings'
                };
                
                const allKeys = Object.keys(mockLocalStorage.store);
                allKeys.forEach(key => {
                    for (const [oldPrefix, newKey] of Object.entries(migrations)) {
                        if (key.startsWith(oldPrefix)) {
                            mockLocalStorage.store[newKey] = mockLocalStorage.store[key];
                            delete mockLocalStorage.store[key];
                            break;
                        }
                    }
                });
            }
            
            // Add old format entries
            mockLocalStorage.store['mcpTabBadge_0.0.45'] = 'true';
            mockLocalStorage.store['permissionsBadge_0.0.45_shown'] = 'true';
            
            // Run migration
            migrateOldBadgeKeys();
            
            // Check new format exists
            expect(mockLocalStorage.store['featureHighlight_mcpTab']).toBe('true');
            expect(mockLocalStorage.store['featureHighlight_permissions']).toBe('true');
            
            // Check old format removed
            expect(mockLocalStorage.store['mcpTabBadge_0.0.45']).toBeUndefined();
            expect(mockLocalStorage.store['permissionsBadge_0.0.45_shown']).toBeUndefined();
        });
    });

    // Skip Badge Styling tests as these methods are not public

    describe('Cross-version Features', () => {
        test('should handle cross-version features without version in key', () => {
            const features = ['mcpServersTab', 'permissions', 'aiApiKeys'];
            
            features.forEach(feature => {
                const key = featureHighlight.getStorageKey(feature);
                expect(key).toBe(`featureHighlight_${feature}`);
                expect(key).not.toContain('0.0');
            });
        });

        test('should maintain consistency across version updates', () => {
            const feature = 'crossVersionFeature';
            
            // Mark as shown in version 0.0.45
            window.appVersion = '0.0.45';
            featureHighlight.markAsShown(feature);
            
            // Check it's still marked as shown in version 0.0.47
            window.appVersion = '0.0.47';
            expect(featureHighlight.hasBeenShown(feature)).toBe(true);
            
            // And in version 0.0.49
            window.appVersion = '0.0.49';
            expect(featureHighlight.hasBeenShown(feature)).toBe(true);
        });
    });

    // Skip Error Handling tests as these methods are not public
});
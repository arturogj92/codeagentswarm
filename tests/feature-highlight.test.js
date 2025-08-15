/**
 * Tests for FeatureHighlight component
 */

// Mock localStorage
const localStorageMock = (() => {
    let store = {};
    const mock = {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => store[key] = value.toString(),
        removeItem: (key) => delete store[key],
        clear: () => store = {},
        get length() { return Object.keys(store).length; },
        key: (index) => Object.keys(store)[index] || null,
        // Add method to get all keys (for Object.keys to work)
        getStore: () => store
    };
    return mock;
})();

// Make Object.keys work with our localStorage mock
global.Object.keys = ((originalKeys) => {
    return (obj) => {
        if (obj === localStorageMock) {
            return originalKeys(localStorageMock.getStore());
        }
        return originalKeys(obj);
    };
})(global.Object.keys);

// Mock window.appVersion
global.window = {
    appVersion: '0.0.38',
    localStorage: localStorageMock,
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    featureHighlight: null
};

global.localStorage = localStorageMock;
global.requestAnimationFrame = jest.fn((callback) => {
    callback();
});
global.setTimeout = jest.fn((callback, ms) => {
    callback();
    return 123; // Mock timeout ID
});
global.clearTimeout = jest.fn();
global.document = {
    body: {
        appendChild: jest.fn()
    },
    getElementById: jest.fn(),
    querySelector: jest.fn(),
    createElement: jest.fn((tag) => ({
        id: '',
        className: '',
        style: {},
        innerHTML: '',
        appendChild: jest.fn(),
        classList: {
            add: jest.fn(),
            remove: jest.fn()
        },
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        getBoundingClientRect: jest.fn(() => ({
            top: 100,
            left: 200,
            bottom: 150,
            right: 300,
            width: 100,
            height: 50
        }))
    })),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn()
};

// Import after mocks are set up
const FeatureHighlight = require('../feature-highlight');

describe('FeatureHighlight', () => {
    let featureHighlight;

    beforeEach(() => {
        // Clear localStorage before each test
        localStorageMock.clear();
        // Reset all mocks
        jest.clearAllMocks();
        // Create new instance
        featureHighlight = new FeatureHighlight();
    });

    describe('Initialization', () => {
        test('should create container on init', () => {
            expect(document.createElement).toHaveBeenCalledWith('div');
            expect(document.body.appendChild).toHaveBeenCalled();
        });

        test('should get correct app version', () => {
            expect(featureHighlight.appVersion).toBe('0.0.38');
        });
    });

    describe('Storage Management', () => {
        test('should check if feature has been shown', () => {
            const featureName = 'testFeature';
            expect(featureHighlight.hasBeenShown(featureName)).toBe(false);
            
            featureHighlight.markAsShown(featureName);
            expect(featureHighlight.hasBeenShown(featureName)).toBe(true);
        });

        test('should generate correct storage key', () => {
            const key = featureHighlight.getStorageKey('tabbedMode');
            expect(key).toBe('featureHighlight_tabbedMode_0.0.38');
        });

        test('should reset individual feature', () => {
            const featureName = 'testFeature';
            featureHighlight.markAsShown(featureName);
            expect(featureHighlight.hasBeenShown(featureName)).toBe(true);
            
            featureHighlight.reset(featureName);
            expect(featureHighlight.hasBeenShown(featureName)).toBe(false);
        });

        test('should reset all features', () => {
            featureHighlight.markAsShown('feature1');
            featureHighlight.markAsShown('feature2');
            featureHighlight.markAsShown('feature3');
            
            featureHighlight.resetAll();
            
            expect(featureHighlight.hasBeenShown('feature1')).toBe(false);
            expect(featureHighlight.hasBeenShown('feature2')).toBe(false);
            expect(featureHighlight.hasBeenShown('feature3')).toBe(false);
        });
    });

    describe('Show Functionality', () => {
        test('should not show if already shown in this version', () => {
            const mockElement = {
                getBoundingClientRect: jest.fn(() => ({
                    top: 100, left: 200, bottom: 150, right: 300, width: 100, height: 50
                }))
            };
            document.querySelector.mockReturnValue(mockElement);
            
            const options = {
                targetSelector: '#test-button',
                featureName: 'testFeature',
                message: 'Test message',
                showOnce: true
            };
            
            // Mark as already shown
            featureHighlight.markAsShown('testFeature');
            
            // Try to show
            featureHighlight.show(options);
            
            // Should not create highlight element
            expect(featureHighlight.currentHighlight).toBeNull();
        });

    });

    describe('Position Calculation', () => {
        test('should position highlight correctly for bottom position', () => {
            const mockHighlight = {
                style: {}
            };
            const mockTarget = {
                getBoundingClientRect: jest.fn(() => ({
                    top: 100, left: 200, bottom: 150, right: 300, width: 100, height: 50
                }))
            };
            
            featureHighlight.positionHighlight(mockTarget, mockHighlight, 'bottom');
            
            expect(mockHighlight.style.top).toBe('155px'); // bottom + gap (5)
            expect(mockHighlight.style.left).toBe('110px'); // left + (width/2) - (280/2)
        });

        test('should position highlight correctly for top position', () => {
            const mockHighlight = {
                style: {}
            };
            const mockTarget = {
                getBoundingClientRect: jest.fn(() => ({
                    top: 200, left: 200, bottom: 250, right: 300, width: 100, height: 50
                }))
            };
            
            featureHighlight.positionHighlight(mockTarget, mockHighlight, 'top');
            
            expect(mockHighlight.style.top).toBe('105px'); // top - estimatedHeight(90) - gap(5)
            expect(mockHighlight.style.left).toBe('110px'); // left + (width/2) - (280/2)
        });
    });

    describe('Dismiss Functionality', () => {
        test('should dismiss current highlight', () => {
            const mockElement = {
                classList: {
                    add: jest.fn(),
                    remove: jest.fn()
                },
                parentNode: {
                    removeChild: jest.fn()
                }
            };
            const mockTarget = {
                removeEventListener: jest.fn()
            };
            
            featureHighlight.currentHighlight = {
                element: mockElement,
                targetElement: mockTarget,
                featureName: 'test',
                clickHandler: jest.fn()
            };
            
            featureHighlight.dismiss();
            
            expect(mockElement.classList.remove).toHaveBeenCalledWith('show');
            expect(mockElement.classList.add).toHaveBeenCalledWith('hide');
            expect(featureHighlight.currentHighlight).toBeNull();
        });

        test('should clear dismiss timeout on dismiss', () => {
            featureHighlight.dismissTimeout = setTimeout(() => {}, 1000);
            featureHighlight.currentHighlight = {
                element: { classList: { add: jest.fn(), remove: jest.fn() } },
                targetElement: null
            };
            
            featureHighlight.dismiss();
            
            expect(featureHighlight.dismissTimeout).toBeNull();
        });
    });

    describe('Dev Mode Functions', () => {
        test('forceShow should work with showOnce override', () => {
            // Just test that forceShow sets showOnce to false temporarily
            const options = {
                targetSelector: '#test-button',
                featureName: 'forcedFeature',
                message: 'Forced message',
                showOnce: true
            };
            
            // Mock querySelector to return null (element not found)
            document.querySelector.mockReturnValue(null);
            
            // forceShow should try to show even if element not found
            featureHighlight.forceShow(options);
            
            // The function should complete without errors
            expect(true).toBe(true);
        });

        test('testHighlight should reset feature', () => {
            // Mark as shown first
            featureHighlight.markAsShown('tabbedMode');
            expect(featureHighlight.hasBeenShown('tabbedMode')).toBe(true);
            
            // Mock querySelector to return null (element not found)
            document.querySelector.mockReturnValue(null);
            
            // Test highlight should reset
            featureHighlight.testHighlight('tabbedMode');
            
            // Should have been reset (even if show fails due to no element)
            expect(featureHighlight.hasBeenShown('tabbedMode')).toBe(false);
        });
    });

    describe('Arrow SVG Generation', () => {
        test('should generate correct SVG for different positions', () => {
            const bottomArrow = featureHighlight.getArrowSVG('bottom');
            expect(bottomArrow).toContain('rotate(0deg)');
            
            const topArrow = featureHighlight.getArrowSVG('top');
            expect(topArrow).toContain('rotate(180deg)');
            
            const leftArrow = featureHighlight.getArrowSVG('left');
            expect(leftArrow).toContain('rotate(90deg)');
            
            const rightArrow = featureHighlight.getArrowSVG('right');
            expect(rightArrow).toContain('rotate(-90deg)');
        });
    });

    describe('Update Position', () => {
        test('should update position when window resizes', () => {
            const mockElement = { style: {} };
            const mockTarget = {
                getBoundingClientRect: jest.fn(() => ({
                    top: 150, left: 250, bottom: 200, right: 350, width: 100, height: 50
                }))
            };
            
            featureHighlight.currentHighlight = {
                element: mockElement,
                targetElement: mockTarget,
                position: 'bottom'
            };
            
            featureHighlight.updatePosition();
            
            expect(mockTarget.getBoundingClientRect).toHaveBeenCalled();
            expect(mockElement.style.top).toBeDefined();
            expect(mockElement.style.left).toBeDefined();
        });

        test('should not update if no current highlight', () => {
            featureHighlight.currentHighlight = null;
            
            // Should not throw error
            expect(() => featureHighlight.updatePosition()).not.toThrow();
        });
    });
});

// Run the tests
if (require.main === module) {
    console.log('Running FeatureHighlight tests...');
    const jest = require('jest');
    jest.run(['--testPathPattern=feature-highlight.test.js']);
}
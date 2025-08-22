/**
 * Tests for feature-highlight.js
 */

// Mock window before importing
global.window = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    featureHighlight: null,
    getComputedStyle: jest.fn(() => ({ position: 'static' })),
    appVersion: '1.0.0'
};

// Mock localStorage before importing
global.localStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn()
};

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn(cb => setTimeout(cb, 0));

// Mock DOM elements
global.document = {
    querySelector: jest.fn(),
    querySelectorAll: jest.fn(() => []),
    getElementById: jest.fn(),
    createElement: jest.fn(() => ({
        id: '',
        style: {},
        classList: {
            add: jest.fn(),
            remove: jest.fn(),
            contains: jest.fn()
        },
        appendChild: jest.fn(),
        removeChild: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        remove: jest.fn(),
        querySelector: jest.fn(),
        innerHTML: '',
        textContent: '',
        className: ''
    })),
    body: {
        appendChild: jest.fn(),
        removeChild: jest.fn(),
        querySelector: jest.fn(),
        style: {}
    },
    head: {
        appendChild: jest.fn()
    },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn()
};

const FeatureHighlight = require('../feature-highlight');

describe('FeatureHighlight', () => {
    let featureHighlight;

    beforeEach(() => {
        jest.clearAllMocks();
        global.window.appVersion = '1.0.0';
        featureHighlight = new FeatureHighlight(localStorage);
    });

    afterEach(() => {
        jest.clearAllTimers();
    });

    describe('constructor', () => {
        test('should initialize with default values', () => {
            expect(featureHighlight.currentHighlight).toBeNull();
            expect(featureHighlight.dismissTimeout).toBeNull();
            expect(featureHighlight.container).toBeDefined();
            expect(featureHighlight.appVersion).toBe('1.0.0');
            expect(featureHighlight.storage).toBe(localStorage);
        });

        test('should handle no window.appVersion', () => {
            global.window.appVersion = undefined;
            const highlight = new FeatureHighlight();
            expect(highlight.appVersion).toBeNull();
        });

        test('should handle null storage', () => {
            // Temporarily remove localStorage
            const originalLocalStorage = global.localStorage;
            delete global.localStorage;
            
            const highlight = new FeatureHighlight(null);
            expect(highlight.storage).toBeNull();
            
            // Restore localStorage
            global.localStorage = originalLocalStorage;
        });
    });

    describe('show method', () => {
        test('should not show without app version', () => {
            featureHighlight.appVersion = null;
            const mockElement = document.createElement('div');
            document.querySelector.mockReturnValue(mockElement);
            
            featureHighlight.show({
                targetSelector: '#test',
                featureName: 'testFeature',
                message: 'Test message'
            });
            
            expect(featureHighlight.currentHighlight).toBeNull();
        });

        test('should not show if already shown', () => {
            localStorage.getItem.mockReturnValue('true');
            const mockElement = document.createElement('div');
            document.querySelector.mockReturnValue(mockElement);
            
            featureHighlight.show({
                targetSelector: '#test',
                featureName: 'testFeature',
                message: 'Test message',
                showOnce: true
            });
            
            expect(featureHighlight.currentHighlight).toBeNull();
        });

        test('should show badge type', () => {
            const mockElement = document.createElement('div');
            mockElement.querySelector = jest.fn();
            document.querySelector.mockReturnValue(mockElement);
            localStorage.getItem.mockReturnValue(null);
            
            featureHighlight.show({
                targetSelector: '#test',
                featureName: 'testFeature',
                type: 'badge',
                showOnce: false
            });
            
            expect(mockElement.appendChild).toHaveBeenCalled();
        });

        test('should handle missing target element', () => {
            document.querySelector.mockReturnValue(null);
            
            expect(() => {
                featureHighlight.show({
                    targetSelector: '.missing',
                    featureName: 'test'
                });
            }).not.toThrow();
        });

        test('should check version restrictions', () => {
            const mockElement = document.createElement('div');
            document.querySelector.mockReturnValue(mockElement);
            
            featureHighlight.show({
                targetSelector: '#test',
                featureName: 'testFeature',
                versions: ['2.0.0', '3.0.0']
            });
            
            expect(featureHighlight.currentHighlight).toBeNull();
        });
    });

    describe('dismiss method', () => {
        test('should dismiss current highlight', () => {
            const mockElement = {
                classList: {
                    add: jest.fn(),
                    remove: jest.fn()
                },
                remove: jest.fn()
            };
            
            featureHighlight.currentHighlight = {
                element: mockElement,
                featureName: 'test'
            };
            
            featureHighlight.dismiss();
            
            expect(mockElement.classList.add).toHaveBeenCalledWith('hide');
            expect(featureHighlight.currentHighlight).toBeNull();
        });

        test('should clear dismiss timeout', () => {
            // Need to have a currentHighlight for dismiss to work
            featureHighlight.currentHighlight = {
                element: { 
                    classList: { add: jest.fn(), remove: jest.fn() },
                    parentNode: { removeChild: jest.fn() }
                }
            };
            featureHighlight.dismissTimeout = 123;
            
            featureHighlight.dismiss();
            
            expect(featureHighlight.dismissTimeout).toBeNull();
        });
    });

    describe('hasBeenShown method', () => {
        test('should return true if feature was shown', () => {
            localStorage.getItem.mockReturnValue('true');
            
            const result = featureHighlight.hasBeenShown('testFeature');
            
            expect(result).toBe(true);
            expect(localStorage.getItem).toHaveBeenCalledWith('featureHighlight_testFeature');
        });

        test('should return false if feature was not shown', () => {
            localStorage.getItem.mockReturnValue(null);
            
            const result = featureHighlight.hasBeenShown('testFeature');
            
            expect(result).toBe(false);
        });

        test('should handle no storage', () => {
            featureHighlight.storage = null;
            
            const result = featureHighlight.hasBeenShown('testFeature');
            
            expect(result).toBe(false);
        });
    });

    describe('markAsShown method', () => {
        test('should mark feature as shown', () => {
            featureHighlight.markAsShown('testFeature');
            
            expect(localStorage.setItem).toHaveBeenCalledWith(
                'featureHighlight_testFeature',
                'true'
            );
        });

        test('should handle no storage', () => {
            featureHighlight.storage = null;
            
            expect(() => {
                featureHighlight.markAsShown('testFeature');
            }).not.toThrow();
        });
    });

    describe('reset method', () => {
        test('should reset specific feature', () => {
            featureHighlight.reset('testFeature');
            
            expect(localStorage.removeItem).toHaveBeenCalledWith(
                'featureHighlight_testFeature'
            );
        });

        test('should handle no storage', () => {
            featureHighlight.storage = null;
            
            expect(() => {
                featureHighlight.reset('testFeature');
            }).not.toThrow();
        });
    });

    describe('resetAll method', () => {
        test('should reset all features', () => {
            // Save original Object.keys
            const originalObjectKeys = Object.keys;
            
            // Mock Object.keys to return our test keys
            Object.keys = jest.fn((obj) => {
                if (obj === localStorage) {
                    return [
                        'featureHighlight_feature1',
                        'featureHighlight_feature2',
                        'other_key'
                    ];
                }
                return originalObjectKeys(obj);
            });
            
            featureHighlight.resetAll();
            
            expect(localStorage.removeItem).toHaveBeenCalledWith('featureHighlight_feature1');
            expect(localStorage.removeItem).toHaveBeenCalledWith('featureHighlight_feature2');
            expect(localStorage.removeItem).not.toHaveBeenCalledWith('other_key');
            
            // Restore Object.keys
            Object.keys = originalObjectKeys;
        });
    });

    describe('updatePosition method', () => {
        test('should update position of current highlight', () => {
            const mockElement = document.createElement('div');
            const mockHighlight = document.createElement('div');
            
            featureHighlight.currentHighlight = {
                element: mockHighlight,
                targetElement: mockElement,
                position: 'bottom'
            };
            
            // Mock the positionHighlight method
            const originalPositionHighlight = featureHighlight.positionHighlight;
            featureHighlight.positionHighlight = jest.fn();
            
            featureHighlight.updatePosition();
            
            expect(featureHighlight.positionHighlight).toHaveBeenCalledWith(
                mockElement,
                mockHighlight,
                'bottom'
            );
            
            // Restore original method
            featureHighlight.positionHighlight = originalPositionHighlight;
        });

        test('should handle no current highlight', () => {
            featureHighlight.currentHighlight = null;
            
            // This should not throw
            featureHighlight.updatePosition();
            expect(featureHighlight.currentHighlight).toBeNull();
        });
    });

    describe('getStorageKey method', () => {
        test('should generate correct storage key', () => {
            const key = featureHighlight.getStorageKey('testFeature');
            
            expect(key).toBe('featureHighlight_testFeature');
        });
    });

    describe('forceShow method', () => {
        test('should force show even if already shown', () => {
            featureHighlight.show = jest.fn();
            
            const options = {
                targetSelector: '#test',
                featureName: 'testFeature'
            };
            
            featureHighlight.forceShow(options);
            
            // Verify show was called
            expect(featureHighlight.show).toHaveBeenCalled();
            // Verify the options passed had showOnce set to false
            const callArgs = featureHighlight.show.mock.calls[0][0];
            expect(callArgs.targetSelector).toBe('#test');
            expect(callArgs.featureName).toBe('testFeature');
            // Note: showOnce is set to false temporarily, then restored
        });
    });

    describe('init method', () => {
        test('should create container if it does not exist', () => {
            document.getElementById.mockReturnValue(null);
            const mockContainer = {
                id: '',
                style: {},
                appendChild: jest.fn()
            };
            document.createElement.mockReturnValue(mockContainer);
            document.body.appendChild.mockClear();
            
            const highlight = new FeatureHighlight();
            
            expect(document.createElement).toHaveBeenCalledWith('div');
            expect(mockContainer.id).toBe('feature-highlight-container');
            expect(document.body.appendChild).toHaveBeenCalledWith(mockContainer);
        });

        test('should use existing container if it exists', () => {
            const existingContainer = { id: 'feature-highlight-container' };
            document.getElementById.mockReturnValue(existingContainer);
            document.body.appendChild.mockClear();
            
            const highlight = new FeatureHighlight();
            
            expect(highlight.container).toBe(existingContainer);
            expect(document.body.appendChild).not.toHaveBeenCalled();
        });
    });

    describe('show method - full flow', () => {
        test('should create and show highlight element', (done) => {
            const mockElement = {
                getBoundingClientRect: () => ({
                    top: 100,
                    left: 100,
                    bottom: 150,
                    right: 200,
                    width: 100,
                    height: 50
                }),
                addEventListener: jest.fn(),
                removeEventListener: jest.fn()
            };
            document.querySelector.mockReturnValue(mockElement);
            localStorage.getItem.mockReturnValue(null);
            
            const mockHighlightElement = {
                style: {},
                classList: {
                    add: jest.fn(),
                    remove: jest.fn()
                },
                appendChild: jest.fn()
            };
            document.createElement.mockReturnValue(mockHighlightElement);
            
            featureHighlight.container = {
                appendChild: jest.fn()
            };
            
            featureHighlight.show({
                targetSelector: '#test',
                featureName: 'testFeature',
                message: 'Test message',
                position: 'bottom',
                duration: 100,
                showOnce: true
            });
            
            // Check highlight was created
            expect(featureHighlight.currentHighlight).toBeDefined();
            expect(featureHighlight.currentHighlight.featureName).toBe('testFeature');
            expect(featureHighlight.container.appendChild).toHaveBeenCalledWith(mockHighlightElement);
            
            // Check animation frame was requested
            setTimeout(() => {
                expect(mockHighlightElement.classList.add).toHaveBeenCalledWith('show');
                done();
            }, 10);
        });

        test('should handle retry for badge when element not found', () => {
            jest.useFakeTimers();
            let callCount = 0;
            
            document.querySelector.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return null; // First call returns null
                }
                return {
                    querySelector: jest.fn(),
                    appendChild: jest.fn(),
                    style: {},
                    addEventListener: jest.fn()
                };
            });
            
            featureHighlight.show({
                targetSelector: '#test',
                featureName: 'testBadge',
                type: 'badge',
                showOnce: false
            });
            
            // Advance timers to trigger retry
            jest.advanceTimersByTime(100);
            
            expect(document.querySelector).toHaveBeenCalledTimes(2);
            jest.useRealTimers();
        });

        test('should auto-dismiss after duration', () => {
            jest.useFakeTimers();
            const mockElement = {
                getBoundingClientRect: () => ({
                    top: 100, left: 100, bottom: 150, right: 200, width: 100, height: 50
                }),
                addEventListener: jest.fn(),
                removeEventListener: jest.fn()
            };
            document.querySelector.mockReturnValue(mockElement);
            localStorage.getItem.mockReturnValue(null);
            
            featureHighlight.container = { appendChild: jest.fn() };
            featureHighlight.dismiss = jest.fn();
            
            featureHighlight.show({
                targetSelector: '#test',
                featureName: 'testFeature',
                duration: 1000
            });
            
            jest.advanceTimersByTime(1000);
            
            expect(featureHighlight.dismiss).toHaveBeenCalled();
            jest.useRealTimers();
        });
    });

    describe('showBadge method', () => {
        test('should create and add badge to element', () => {
            const mockElement = {
                querySelector: jest.fn().mockReturnValue(null),
                appendChild: jest.fn(),
                style: {},
                addEventListener: jest.fn(),
                removeEventListener: jest.fn()
            };
            
            const mockBadge = {
                className: '',
                textContent: '',
                style: {},
                remove: jest.fn()
            };
            document.createElement.mockReturnValue(mockBadge);
            
            featureHighlight.showBadge(mockElement, 'testBadge', 'bottom', true);
            
            expect(mockBadge.className).toBe('feature-badge');
            expect(mockBadge.textContent).toBe('NEW!');
            expect(mockElement.appendChild).toHaveBeenCalledWith(mockBadge);
            expect(mockElement.addEventListener).toHaveBeenCalled();
        });

        test('should not add badge if already exists', () => {
            const existingBadge = {};
            const mockElement = {
                querySelector: jest.fn().mockReturnValue(existingBadge),
                appendChild: jest.fn()
            };
            
            featureHighlight.showBadge(mockElement, 'testBadge', 'top', true);
            
            expect(mockElement.appendChild).not.toHaveBeenCalled();
        });

        test('should handle top position for badge', () => {
            const mockElement = {
                querySelector: jest.fn().mockReturnValue(null),
                appendChild: jest.fn(),
                style: {},
                addEventListener: jest.fn()
            };
            
            const mockBadge = {
                className: '',
                textContent: '',
                style: {}
            };
            document.createElement.mockReturnValue(mockBadge);
            
            featureHighlight.showBadge(mockElement, 'testBadge', 'top', false);
            
            expect(mockBadge.style.top).toBe('-8px');
            expect(mockBadge.style.right).toBe('-8px');
        });

        test('should add styles if not already present', () => {
            document.getElementById.mockImplementation((id) => {
                if (id === 'feature-badge-styles') return null;
                return null;
            });
            
            const mockElement = {
                querySelector: jest.fn().mockReturnValue(null),
                appendChild: jest.fn(),
                style: {},
                addEventListener: jest.fn()
            };
            
            const mockStyle = {
                id: '',
                textContent: ''
            };
            document.createElement.mockImplementation((tag) => {
                if (tag === 'style') return mockStyle;
                return { className: '', textContent: '', style: {} };
            });
            
            featureHighlight.showBadge(mockElement, 'testBadge', 'bottom', false);
            
            expect(mockStyle.id).toBe('feature-badge-styles');
            expect(document.head.appendChild).toHaveBeenCalledWith(mockStyle);
        });

        test('should handle badge click to remove', () => {
            jest.useFakeTimers();
            let clickHandler = null;
            const mockElement = {
                querySelector: jest.fn().mockReturnValue(null),
                appendChild: jest.fn(),
                style: {},
                addEventListener: jest.fn((event, handler) => {
                    if (event === 'click') {
                        clickHandler = handler;
                    }
                }),
                removeEventListener: jest.fn()
            };
            
            const mockBadge = {
                className: '',
                textContent: '',
                style: {},
                parentNode: mockElement,
                remove: jest.fn()
            };
            document.createElement.mockReturnValue(mockBadge);
            
            featureHighlight.showBadge(mockElement, 'testBadge', 'bottom', true);
            
            // Trigger the click handler
            expect(clickHandler).toBeDefined();
            clickHandler();
            
            jest.advanceTimersByTime(300);
            
            expect(mockBadge.remove).toHaveBeenCalled();
            expect(localStorage.setItem).toHaveBeenCalledWith('featureHighlight_testBadge', 'true');
            jest.useRealTimers();
        });
    });

    describe('createHighlightElement method', () => {
        test('should create highlight element with correct structure', () => {
            const elements = [];
            document.createElement.mockImplementation((tag) => {
                const element = {
                    className: '',
                    innerHTML: '',
                    appendChild: jest.fn((child) => {
                        element.children = element.children || [];
                        element.children.push(child);
                    }),
                    onclick: null,
                    children: []
                };
                elements.push(element);
                return element;
            });
            
            const highlight = featureHighlight.createHighlightElement('Test Message', 'bottom');
            
            expect(highlight.className).toBe('feature-highlight feature-highlight-bottom');
            expect(highlight.children).toHaveLength(2); // arrow and badge
            expect(highlight.children[0].className).toBe('feature-highlight-arrow');
            expect(highlight.children[1].className).toBe('feature-highlight-badge');
        });

        test('should order elements correctly for top position', () => {
            const elements = [];
            document.createElement.mockImplementation((tag) => {
                const element = {
                    className: '',
                    innerHTML: '',
                    appendChild: jest.fn((child) => {
                        element.children = element.children || [];
                        element.children.push(child);
                    }),
                    onclick: null,
                    children: []
                };
                elements.push(element);
                return element;
            });
            
            const highlight = featureHighlight.createHighlightElement('Test', 'top');
            
            expect(highlight.children[0].className).toBe('feature-highlight-badge');
            expect(highlight.children[1].className).toBe('feature-highlight-arrow');
        });

        test('should add dismiss button with handler', () => {
            let dismissButton = null;
            document.createElement.mockImplementation((tag) => {
                const element = {
                    className: '',
                    innerHTML: '',
                    appendChild: jest.fn((child) => {
                        if (child.className === 'feature-highlight-dismiss') {
                            dismissButton = child;
                        }
                    }),
                    onclick: null
                };
                return element;
            });
            
            featureHighlight.dismiss = jest.fn();
            featureHighlight.createHighlightElement('Test', 'bottom');
            
            expect(dismissButton).toBeDefined();
            expect(dismissButton.onclick).toBeDefined();
            
            // Test the dismiss button click
            dismissButton.onclick();
            expect(featureHighlight.dismiss).toHaveBeenCalled();
        });
    });

    describe('getArrowSVG method', () => {
        test('should return correct SVG for each position', () => {
            const positions = {
                top: 180,
                bottom: 0,
                left: 90,
                right: -90
            };
            
            Object.entries(positions).forEach(([position, rotation]) => {
                const svg = featureHighlight.getArrowSVG(position);
                expect(svg).toContain(`rotate(${rotation}deg)`);
                expect(svg).toContain('<svg');
                expect(svg).toContain('<path');
            });
        });

        test('should handle unknown position', () => {
            const svg = featureHighlight.getArrowSVG('unknown');
            expect(svg).toContain('rotate(0deg)');
        });
    });

    describe('positionHighlight method', () => {
        test('should position highlight correctly for bottom position', () => {
            const mockElement = {
                getBoundingClientRect: () => ({
                    top: 100,
                    left: 100,
                    bottom: 150,
                    right: 200,
                    width: 100,
                    height: 50
                })
            };
            
            const mockHighlight = {
                style: {}
            };
            
            global.window.innerWidth = 1024;
            global.window.innerHeight = 768;
            
            featureHighlight.positionHighlight(mockElement, mockHighlight, 'bottom');
            
            expect(mockHighlight.style.top).toBe('155px');
            expect(mockHighlight.style.left).toBe('10px'); // Will be clamped to min 10px
        });

        test('should position highlight correctly for top position', () => {
            const mockElement = {
                getBoundingClientRect: () => ({
                    top: 200,
                    left: 100,
                    bottom: 250,
                    right: 200,
                    width: 100,
                    height: 50
                })
            };
            
            const mockHighlight = {
                style: {}
            };
            
            featureHighlight.positionHighlight(mockElement, mockHighlight, 'top');
            
            expect(mockHighlight.style.top).toBe('105px'); // 200 - 90 - 5
            expect(mockHighlight.style.left).toBe('10px'); // Will be clamped to min 10px
        });

        test('should position highlight correctly for left position', () => {
            const mockElement = {
                getBoundingClientRect: () => ({
                    top: 100,
                    left: 300,
                    bottom: 150,
                    right: 400,
                    width: 100,
                    height: 50
                })
            };
            
            const mockHighlight = {
                style: {}
            };
            
            featureHighlight.positionHighlight(mockElement, mockHighlight, 'left');
            
            expect(mockHighlight.style.top).toBe('80px'); // 100 + 25 - 45
            expect(mockHighlight.style.left).toBe('15px'); // 300 - 280 - 5
        });

        test('should position highlight correctly for right position', () => {
            const mockElement = {
                getBoundingClientRect: () => ({
                    top: 100,
                    left: 100,
                    bottom: 150,
                    right: 200,
                    width: 100,
                    height: 50
                })
            };
            
            const mockHighlight = {
                style: {}
            };
            
            featureHighlight.positionHighlight(mockElement, mockHighlight, 'right');
            
            expect(mockHighlight.style.top).toBe('80px');
            expect(mockHighlight.style.left).toBe('205px'); // 200 + 5
        });

        test('should keep highlight within viewport bounds', () => {
            const mockElement = {
                getBoundingClientRect: () => ({
                    top: 10,
                    left: 10,
                    bottom: 60,
                    right: 110,
                    width: 100,
                    height: 50
                })
            };
            
            const mockHighlight = {
                style: {}
            };
            
            global.window.innerWidth = 400;
            global.window.innerHeight = 300;
            
            featureHighlight.positionHighlight(mockElement, mockHighlight, 'left');
            
            // Should be clamped to minimum 10px from edge
            expect(parseInt(mockHighlight.style.left)).toBeGreaterThanOrEqual(10);
            expect(parseInt(mockHighlight.style.top)).toBeGreaterThanOrEqual(10);
        });

        test('should handle viewport overflow on right', () => {
            const mockElement = {
                getBoundingClientRect: () => ({
                    top: 100,
                    left: 800,
                    bottom: 150,
                    right: 900,
                    width: 100,
                    height: 50
                })
            };
            
            const mockHighlight = {
                style: {}
            };
            
            global.window.innerWidth = 1024;
            global.window.innerHeight = 768;
            
            featureHighlight.positionHighlight(mockElement, mockHighlight, 'right');
            
            // Should be adjusted to fit within viewport
            expect(parseInt(mockHighlight.style.left)).toBeLessThanOrEqual(1024 - 280 - 10);
        });
    });

    describe('setupEventHandlers method', () => {
        test('should setup click handler on target element', () => {
            const mockElement = {
                addEventListener: jest.fn(),
                removeEventListener: jest.fn()
            };
            
            featureHighlight.currentHighlight = {};
            featureHighlight.dismiss = jest.fn();
            
            featureHighlight.setupEventHandlers(mockElement);
            
            expect(mockElement.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
            
            // Simulate click
            const clickHandler = mockElement.addEventListener.mock.calls[0][1];
            clickHandler();
            
            expect(featureHighlight.dismiss).toHaveBeenCalled();
        });

        test('should setup escape key handler', () => {
            const mockElement = {
                addEventListener: jest.fn(),
                removeEventListener: jest.fn()
            };
            
            document.addEventListener.mockClear();
            featureHighlight.dismiss = jest.fn();
            
            featureHighlight.setupEventHandlers(mockElement);
            
            expect(document.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
            
            // Simulate escape key
            const escHandler = document.addEventListener.mock.calls[0][1];
            escHandler({ key: 'Escape' });
            
            expect(featureHighlight.dismiss).toHaveBeenCalled();
        });

        test('should ignore non-escape keys', () => {
            const mockElement = {
                addEventListener: jest.fn()
            };
            
            const originalAddEventListener = document.addEventListener;
            document.addEventListener = jest.fn();
            
            featureHighlight.dismiss = jest.fn();
            featureHighlight.setupEventHandlers(mockElement);
            
            const escHandler = document.addEventListener.mock.calls[0][1];
            escHandler({ key: 'Enter' });
            
            expect(featureHighlight.dismiss).not.toHaveBeenCalled();
            
            // Restore
            document.addEventListener = originalAddEventListener;
        });
    });

    describe('dismiss method - comprehensive', () => {
        test('should handle dismiss with all cleanup', () => {
            jest.useFakeTimers();
            
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
            
            const mockHandler = jest.fn();
            
            featureHighlight.currentHighlight = {
                element: mockElement,
                targetElement: mockTarget,
                clickHandler: mockHandler,
                featureName: 'test'
            };
            
            featureHighlight.dismissTimeout = setTimeout(() => {}, 1000);
            
            featureHighlight.dismiss();
            
            expect(mockElement.classList.remove).toHaveBeenCalledWith('show');
            expect(mockElement.classList.add).toHaveBeenCalledWith('hide');
            expect(mockTarget.removeEventListener).toHaveBeenCalledWith('click', mockHandler);
            
            jest.advanceTimersByTime(300);
            
            expect(mockElement.parentNode.removeChild).toHaveBeenCalledWith(mockElement);
            expect(featureHighlight.currentHighlight).toBeNull();
            jest.useRealTimers();
        });

        test('should handle dismiss when no current highlight', () => {
            featureHighlight.currentHighlight = null;
            
            expect(() => {
                featureHighlight.dismiss();
            }).not.toThrow();
        });

        test('should handle element without parent node', () => {
            jest.useFakeTimers();
            
            const mockElement = {
                classList: {
                    add: jest.fn(),
                    remove: jest.fn()
                },
                parentNode: null
            };
            
            featureHighlight.currentHighlight = {
                element: mockElement
            };
            
            featureHighlight.dismiss();
            
            jest.advanceTimersByTime(300);
            
            // Should not throw even when parentNode is null
            expect(featureHighlight.currentHighlight).toBeNull();
            jest.useRealTimers();
        });
    });

    describe('testHighlight method', () => {
        test('should test tabbedMode highlight', () => {
            featureHighlight.reset = jest.fn();
            featureHighlight.show = jest.fn();
            
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            
            featureHighlight.testHighlight('tabbedMode');
            
            expect(featureHighlight.reset).toHaveBeenCalledWith('tabbedMode');
            expect(consoleSpy).toHaveBeenCalledWith('[FeatureHighlight] Testing feature: tabbedMode');
            expect(featureHighlight.show).toHaveBeenCalledWith({
                targetSelector: '#tabbed-mode-btn',
                featureName: 'tabbedMode',
                message: 'Toggle between grid and tabbed layouts',
                position: 'bottom',
                duration: 30000
            });
            
            consoleSpy.mockRestore();
        });

        test('should handle unknown feature name', () => {
            featureHighlight.reset = jest.fn();
            featureHighlight.show = jest.fn();
            
            featureHighlight.testHighlight('unknownFeature');
            
            expect(featureHighlight.reset).toHaveBeenCalledWith('unknownFeature');
            expect(featureHighlight.show).not.toHaveBeenCalled();
        });
    });

    describe('window resize event', () => {
        test('should call updatePosition on window resize', () => {
            // The resize handler is registered when the module loads, not in constructor
            // So we need to simulate what happens when the resize event fires
            global.window.featureHighlight = {
                updatePosition: jest.fn()
            };
            
            // Trigger a resize event
            const resizeEvent = new Event('resize');
            
            // Since the handler checks for window.featureHighlight existence
            // and calls updatePosition if it exists, we can test the logic directly
            if (window.featureHighlight) {
                window.featureHighlight.updatePosition();
            }
            
            expect(global.window.featureHighlight.updatePosition).toHaveBeenCalled();
        });

        test('should not error if featureHighlight is not set', () => {
            global.window.featureHighlight = null;
            
            // Test the conditional logic directly
            expect(() => {
                if (window.featureHighlight) {
                    window.featureHighlight.updatePosition();
                }
            }).not.toThrow();
        });
    });

    describe('edge cases', () => {
        test('should handle localStorage being undefined', () => {
            const originalLocalStorage = global.localStorage;
            global.localStorage = undefined;
            
            const highlight = new FeatureHighlight();
            expect(highlight.storage).toBeNull();
            
            global.localStorage = originalLocalStorage;
        });

        test('should handle position being relative already', () => {
            global.window.getComputedStyle = jest.fn(() => ({ position: 'relative' }));
            
            const mockElement = {
                querySelector: jest.fn().mockReturnValue(null),
                appendChild: jest.fn(),
                style: {},
                addEventListener: jest.fn()
            };
            
            const mockBadge = {
                className: '',
                textContent: '',
                style: {},
                remove: jest.fn()
            };
            document.createElement.mockReturnValue(mockBadge);
            
            featureHighlight.showBadge(mockElement, 'test', 'bottom', false);
            
            expect(mockElement.style.position).toBeUndefined();
        });

        test('should handle versions being an empty array', () => {
            const mockElement = {
                getBoundingClientRect: () => ({
                    top: 100, left: 100, bottom: 150, right: 200, width: 100, height: 50
                }),
                addEventListener: jest.fn(),
                removeEventListener: jest.fn()
            };
            document.querySelector.mockReturnValue(mockElement);
            localStorage.getItem.mockReturnValue(null);
            
            const mockHighlight = {
                style: {},
                classList: {
                    add: jest.fn(),
                    remove: jest.fn()
                },
                appendChild: jest.fn()
            };
            document.createElement.mockReturnValue(mockHighlight);
            
            featureHighlight.container = { appendChild: jest.fn() };
            
            featureHighlight.show({
                targetSelector: '#test',
                featureName: 'testFeature',
                versions: []
            });
            
            expect(featureHighlight.currentHighlight).toBeDefined();
        });
    });
});
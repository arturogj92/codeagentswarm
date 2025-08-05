/**
 * Setup DOM environment for testing
 */

// Add global window object
global.window = global;

// Mock electron
global.window.require = jest.fn((module) => {
    if (module === 'electron') {
        return {
            ipcRenderer: {
                invoke: jest.fn().mockResolvedValue({}),
                send: jest.fn(),
                on: jest.fn(),
                removeAllListeners: jest.fn()
            }
        };
    }
    return {};
});

// Mock lucide
global.lucide = {
    createIcons: jest.fn()
};

// Add other browser APIs if needed
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
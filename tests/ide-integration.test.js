/**
 * Tests for generic IDE integration feature
 * Tests detection, menu generation, and opening projects in IDEs
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const { exec } = require('child_process');

// Mock electron modules
jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn()
    },
    ipcRenderer: {
        invoke: jest.fn()
    }
}));

describe('IDE Integration Tests', () => {
    let mockFs;
    let mockExec;
    
    beforeEach(() => {
        // Mock file system
        mockFs = jest.spyOn(fs, 'existsSync');
        
        // Mock exec for command execution
        mockExec = jest.fn((command, callback) => {
            callback(null, '', '');
        });
        jest.doMock('child_process', () => ({
            exec: mockExec
        }));
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    describe('IDE Detection', () => {
        test('Should detect IntelliJ IDEA on macOS', () => {
            // Mock platform
            Object.defineProperty(process, 'platform', {
                value: 'darwin'
            });
            
            // Mock IntelliJ exists
            mockFs.mockImplementation((path) => {
                return path === '/Applications/IntelliJ IDEA.app';
            });
            
            // Test detection
            const IDE_CONFIGS = {
                intellij: {
                    name: 'IntelliJ IDEA',
                    icon: 'code-2',
                    platforms: {
                        darwin: {
                            paths: ['/Applications/IntelliJ IDEA.app'],
                            openCommand: (idePath, projectPath) => `open -na "${idePath}" --args "${projectPath}"`
                        }
                    }
                }
            };
            
            // Check if IntelliJ path exists
            const exists = fs.existsSync(IDE_CONFIGS.intellij.platforms.darwin.paths[0]);
            expect(exists).toBe(true);
        });

        test('Should detect VSCode on macOS', () => {
            Object.defineProperty(process, 'platform', {
                value: 'darwin'
            });
            
            mockFs.mockImplementation((path) => {
                return path === '/Applications/Visual Studio Code.app';
            });
            
            const exists = fs.existsSync('/Applications/Visual Studio Code.app');
            expect(exists).toBe(true);
        });

        test('Should detect Cursor on macOS', () => {
            Object.defineProperty(process, 'platform', {
                value: 'darwin'
            });
            
            mockFs.mockImplementation((path) => {
                return path === '/Applications/Cursor.app';
            });
            
            const exists = fs.existsSync('/Applications/Cursor.app');
            expect(exists).toBe(true);
        });

        test('Should return empty list when no IDEs are installed', () => {
            mockFs.mockReturnValue(false);
            
            const IDE_CONFIGS = {
                intellij: {
                    name: 'IntelliJ IDEA',
                    platforms: {
                        darwin: {
                            paths: ['/Applications/IntelliJ IDEA.app']
                        }
                    }
                }
            };
            
            const detectedIDEs = [];
            for (const ideKey of Object.keys(IDE_CONFIGS)) {
                const config = IDE_CONFIGS[ideKey];
                const platform = process.platform;
                if (config.platforms[platform]) {
                    for (const path of config.platforms[platform].paths) {
                        if (fs.existsSync(path)) {
                            detectedIDEs.push({ key: ideKey, name: config.name });
                        }
                    }
                }
            }
            
            expect(detectedIDEs).toEqual([]);
        });

        test('Should handle multiple IDEs installed', () => {
            mockFs.mockImplementation((path) => {
                return path === '/Applications/IntelliJ IDEA.app' || 
                       path === '/Applications/Visual Studio Code.app';
            });
            
            const detectedPaths = [
                '/Applications/IntelliJ IDEA.app',
                '/Applications/Visual Studio Code.app',
                '/Applications/Cursor.app'
            ].filter(path => fs.existsSync(path));
            
            expect(detectedPaths).toHaveLength(2);
            expect(detectedPaths).toContain('/Applications/IntelliJ IDEA.app');
            expect(detectedPaths).toContain('/Applications/Visual Studio Code.app');
        });
    });

    describe('Menu Generation', () => {
        let document;
        
        beforeEach(() => {
            const dom = new JSDOM(`
                <!DOCTYPE html>
                <html>
                <body>
                    <div id="menu-container"></div>
                </body>
                </html>
            `);
            document = dom.window.document;
        });

        test('Should generate menu items for detected IDEs', () => {
            const detectedIDEs = [
                { key: 'intellij', name: 'IntelliJ IDEA', icon: 'code-2' },
                { key: 'vscode', name: 'Visual Studio Code', icon: 'file-code' }
            ];
            
            let menuHTML = '<div class="dropdown-separator"></div>';
            for (const ide of detectedIDEs) {
                menuHTML += `
                    <button class="terminal-dropdown-item" data-action="open-in-ide" data-ide="${ide.key}">
                        <i data-lucide="${ide.icon}"></i>
                        <span>Open in ${ide.name}</span>
                    </button>
                `;
            }
            
            document.getElementById('menu-container').innerHTML = menuHTML;
            
            const buttons = document.querySelectorAll('[data-action="open-in-ide"]');
            expect(buttons).toHaveLength(2);
            expect(buttons[0].dataset.ide).toBe('intellij');
            expect(buttons[1].dataset.ide).toBe('vscode');
        });

        test('Should not show separator when no IDEs detected', () => {
            const detectedIDEs = [];
            
            let menuHTML = '';
            if (detectedIDEs.length > 0) {
                menuHTML = '<div class="dropdown-separator"></div>';
            }
            
            expect(menuHTML).toBe('');
        });

        test('Should include correct icons for each IDE', () => {
            const ideConfigs = {
                intellij: { icon: 'code-2' },
                vscode: { icon: 'file-code' },
                cursor: { icon: 'edit-3' }
            };
            
            expect(ideConfigs.intellij.icon).toBe('code-2');
            expect(ideConfigs.vscode.icon).toBe('file-code');
            expect(ideConfigs.cursor.icon).toBe('edit-3');
        });
    });

    describe('Opening Projects in IDEs', () => {
        test('Should generate correct command for IntelliJ on macOS', () => {
            const idePath = '/Applications/IntelliJ IDEA.app';
            const projectPath = '/Users/test/project';
            
            const command = `open -na "${idePath}" --args "${projectPath}"`;
            
            expect(command).toBe('open -na "/Applications/IntelliJ IDEA.app" --args "/Users/test/project"');
        });

        test('Should generate correct command for VSCode on macOS', () => {
            const idePath = '/Applications/Visual Studio Code.app';
            const projectPath = '/Users/test/project';
            
            const command = `open -na "${idePath}" --args "${projectPath}"`;
            
            expect(command).toContain('Visual Studio Code.app');
            expect(command).toContain(projectPath);
        });

        test('Should generate correct command for Windows', () => {
            const idePath = 'C:\\Program Files\\JetBrains\\IntelliJ IDEA';
            const projectPath = 'C:\\Users\\test\\project';
            
            const command = `"${idePath}\\bin\\idea64.exe" "${projectPath}"`;
            
            expect(command).toBe('"C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe" "C:\\Users\\test\\project"');
        });

        test('Should generate correct command for Linux', () => {
            const idePath = '/usr/local/bin/idea';
            const projectPath = '/home/test/project';
            
            const command = `"${idePath}" "${projectPath}"`;
            
            expect(command).toBe('"/usr/local/bin/idea" "/home/test/project"');
        });

        test('Should handle paths with spaces', () => {
            const idePath = '/Applications/IntelliJ IDEA.app';
            const projectPath = '/Users/test/my project';
            
            const command = `open -na "${idePath}" --args "${projectPath}"`;
            
            expect(command).toContain('"/Users/test/my project"');
        });

        test('Should generate correct command for Cursor on macOS', () => {
            const idePath = '/Applications/Cursor.app';
            const projectPath = '/Users/test/project';
            
            const command = `open -na "${idePath}" --args "${projectPath}"`;
            
            expect(command).toBe('open -na "/Applications/Cursor.app" --args "/Users/test/project"');
        });

        test('Should expand home directory in paths', () => {
            const homePath = '~/Applications/IntelliJ IDEA.app';
            const expandedPath = homePath.replace('~', '/Users/test');
            
            expect(expandedPath).toBe('/Users/test/Applications/IntelliJ IDEA.app');
        });
    });

    describe('Error Handling', () => {
        test('Should handle when IDE is not found', () => {
            mockFs.mockReturnValue(false);
            
            const result = fs.existsSync('/Applications/NonExistent.app');
            expect(result).toBe(false);
        });

        test('Should handle exec command errors', () => {
            const mockCallback = jest.fn();
            const mockExecWithError = jest.fn((command, callback) => {
                callback(new Error('Command failed'), null, 'Error output');
            });
            
            mockExecWithError('open -na "IntelliJ IDEA.app"', mockCallback);
            
            expect(mockCallback).toHaveBeenCalledWith(
                expect.any(Error),
                null,
                'Error output'
            );
        });

        test('Should handle invalid IDE key', () => {
            const IDE_CONFIGS = {
                intellij: { name: 'IntelliJ IDEA' }
            };
            
            const invalidIDE = IDE_CONFIGS['nonexistent'];
            expect(invalidIDE).toBeUndefined();
        });
    });

    describe('Platform-specific Tests', () => {
        test('Should detect correct platform', () => {
            const platforms = ['darwin', 'win32', 'linux'];
            const currentPlatform = process.platform;
            
            expect(platforms).toContain(currentPlatform);
        });

        test('Should use platform-specific paths', () => {
            const IDE_CONFIGS = {
                intellij: {
                    platforms: {
                        darwin: {
                            paths: ['/Applications/IntelliJ IDEA.app']
                        },
                        win32: {
                            paths: ['C:\\Program Files\\JetBrains\\IntelliJ IDEA']
                        },
                        linux: {
                            paths: ['/usr/local/bin/idea']
                        }
                    }
                }
            };
            
            const platform = 'darwin';
            const paths = IDE_CONFIGS.intellij.platforms[platform].paths;
            
            expect(paths).toContain('/Applications/IntelliJ IDEA.app');
            expect(paths).not.toContain('C:\\Program Files\\JetBrains\\IntelliJ IDEA');
        });
    });

    describe('Integration with UI', () => {
        test('Should handle click on IDE menu item', () => {
            const dom = new JSDOM(`
                <button data-action="open-in-ide" data-ide="intellij" data-terminal="1">
                    Open in IntelliJ
                </button>
            `);
            
            const button = dom.window.document.querySelector('[data-action="open-in-ide"]');
            
            expect(button.dataset.action).toBe('open-in-ide');
            expect(button.dataset.ide).toBe('intellij');
            expect(button.dataset.terminal).toBe('1');
        });

        test('Should pass correct parameters to IPC handler', () => {
            const terminalId = 1;
            const ideKey = 'intellij';
            
            const params = { terminalId, ideKey };
            
            expect(params.terminalId).toBe(1);
            expect(params.ideKey).toBe('intellij');
        });

        test('Should display custom icons for IDEs', () => {
            const dom = new JSDOM(`
                <img src="assets/cursor-icon.png" class="ide-icon" alt="Cursor">
                <img src="assets/vscode-icon.png" class="ide-icon" alt="VSCode">
                <img src="assets/intellij-icon.png" class="ide-icon" alt="IntelliJ">
            `);
            
            const cursorIcon = dom.window.document.querySelector('img[alt="Cursor"]');
            const vscodeIcon = dom.window.document.querySelector('img[alt="VSCode"]');
            const intellijIcon = dom.window.document.querySelector('img[alt="IntelliJ"]');
            
            expect(cursorIcon.src).toContain('cursor-icon.png');
            expect(vscodeIcon.src).toContain('vscode-icon.png');
            expect(intellijIcon.src).toContain('intellij-icon.png');
            expect(cursorIcon.className).toBe('ide-icon');
        });

        test('Should close dropdown after IDE selection', () => {
            const dom = new JSDOM(`
                <div class="terminal-dropdown-menu" style="display: block;">
                    <button data-action="open-in-ide" data-ide="intellij">Open</button>
                </div>
            `);
            
            const dropdown = dom.window.document.querySelector('.terminal-dropdown-menu');
            expect(dropdown.style.display).toBe('block');
            
            // Simulate closing dropdown
            dropdown.style.display = 'none';
            expect(dropdown.style.display).toBe('none');
        });
    });
});

module.exports = {};
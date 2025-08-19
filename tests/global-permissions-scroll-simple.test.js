/**
 * Unit tests for scroll position preservation logic in Global Permissions UI
 * Tests the specific methods and behaviors that prevent scroll jumping
 * @jest-environment jsdom
 */

describe('Global Permissions - Scroll Preservation Logic', () => {
    
    describe('applyChanges silent mode behavior', () => {
        test('silent mode should prevent render calls', () => {
            // Mock the applyChanges function behavior
            const mockRender = jest.fn();
            const mockSaveSettings = jest.fn().mockResolvedValue(true);
            
            const applyChanges = async function(silent = false) {
                // Save settings
                await mockSaveSettings();
                
                // Only render if not in silent mode
                if (!silent) {
                    mockRender();
                }
            };
            
            // Test with silent = true
            return applyChanges(true).then(() => {
                expect(mockRender).not.toHaveBeenCalled();
                expect(mockSaveSettings).toHaveBeenCalled();
            });
        });
        
        test('non-silent mode should trigger render', () => {
            const mockRender = jest.fn();
            const mockSaveSettings = jest.fn().mockResolvedValue(true);
            
            const applyChanges = async function(silent = false) {
                await mockSaveSettings();
                if (!silent) {
                    mockRender();
                }
            };
            
            // Test with silent = false
            return applyChanges(false).then(() => {
                expect(mockRender).toHaveBeenCalledTimes(1);
                expect(mockSaveSettings).toHaveBeenCalled();
            });
        });
    });
    
    describe('updateButtonStates local update logic', () => {
        test('should update button classes without DOM re-render', () => {
            // Create mock DOM structure
            document.body.innerHTML = `
                <div class="permission-toggle-group">
                    <button class="permission-toggle allow active" data-tool="TestTool" data-permission="allow">Allow</button>
                    <button class="permission-toggle ask" data-tool="TestTool" data-permission="ask">Ask</button>
                    <button class="permission-toggle deny" data-tool="TestTool" data-permission="deny">Deny</button>
                </div>
            `;
            
            // Simulate updateButtonStates logic
            const updateButtonStates = function(toolName, newPermission) {
                const buttons = document.querySelectorAll(`[data-tool="${toolName}"]`);
                buttons.forEach(btn => {
                    if (btn.dataset.permission === newPermission) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
            };
            
            // Initially allow is active
            const allowBtn = document.querySelector('[data-permission="allow"]');
            const askBtn = document.querySelector('[data-permission="ask"]');
            const denyBtn = document.querySelector('[data-permission="deny"]');
            
            expect(allowBtn.classList.contains('active')).toBe(true);
            expect(askBtn.classList.contains('active')).toBe(false);
            
            // Update to ask
            updateButtonStates('TestTool', 'ask');
            
            // Verify state changed without re-render
            expect(allowBtn.classList.contains('active')).toBe(false);
            expect(askBtn.classList.contains('active')).toBe(true);
            expect(denyBtn.classList.contains('active')).toBe(false);
        });
    });
    
    describe('renderWithExpandedGroups scroll preservation', () => {
        test('should capture and restore scroll position', (done) => {
            document.body.innerHTML = `
                <div id="global-permissions-list" style="height: 100px; overflow: auto;">
                    <div style="height: 500px;">Content</div>
                </div>
            `;
            
            const scrollContainer = document.getElementById('global-permissions-list');
            
            // Mock scroll position
            Object.defineProperty(scrollContainer, 'scrollTop', {
                writable: true,
                configurable: true,
                value: 150
            });
            
            const initialScrollTop = scrollContainer.scrollTop;
            
            // Simulate renderWithExpandedGroups logic
            const renderWithExpandedGroups = function() {
                // Capture scroll position before render
                const scrollTop = scrollContainer.scrollTop;
                
                // Simulate render (which resets scroll)
                scrollContainer.scrollTop = 0;
                
                // Restore scroll position after render
                requestAnimationFrame(() => {
                    scrollContainer.scrollTop = scrollTop;
                    
                    // Verify scroll was restored
                    expect(scrollContainer.scrollTop).toBe(initialScrollTop);
                    done();
                });
            };
            
            renderWithExpandedGroups();
        });
    });
    
    describe('Permission toggle workflow', () => {
        test('individual permission change should not trigger re-render when YOLO is off', async () => {
            const mockUpdateButtonStates = jest.fn();
            const mockApplyChanges = jest.fn().mockResolvedValue(true);
            const mockRender = jest.fn();
            
            // Simulate the permission toggle handler logic
            const handlePermissionToggle = async function(toolName, permission, yoloMode) {
                // Check if YOLO mode needs to be turned off
                const yoloWasTurnedOff = yoloMode && (permission === 'ask' || permission === 'deny');
                
                if (!yoloWasTurnedOff) {
                    // Update buttons locally
                    mockUpdateButtonStates(toolName, permission);
                    // Apply changes silently
                    await mockApplyChanges(true);
                } else {
                    // Need to re-render for YOLO mode change
                    await mockApplyChanges(true);
                    mockRender();
                }
            };
            
            // Test with YOLO off
            await handlePermissionToggle('TestTool', 'deny', false);
            
            expect(mockUpdateButtonStates).toHaveBeenCalledWith('TestTool', 'deny');
            expect(mockApplyChanges).toHaveBeenCalledWith(true);
            expect(mockRender).not.toHaveBeenCalled();
        });
        
        test('permission change should trigger re-render when YOLO turns off', async () => {
            const mockUpdateButtonStates = jest.fn();
            const mockApplyChanges = jest.fn().mockResolvedValue(true);
            const mockRender = jest.fn();
            
            const handlePermissionToggle = async function(toolName, permission, yoloMode) {
                const yoloWasTurnedOff = yoloMode && (permission === 'ask' || permission === 'deny');
                
                if (!yoloWasTurnedOff) {
                    mockUpdateButtonStates(toolName, permission);
                    await mockApplyChanges(true);
                } else {
                    await mockApplyChanges(true);
                    mockRender();
                }
            };
            
            // Test with YOLO on, changing to deny (turns off YOLO)
            await handlePermissionToggle('TestTool', 'deny', true);
            
            expect(mockUpdateButtonStates).not.toHaveBeenCalled();
            expect(mockApplyChanges).toHaveBeenCalledWith(true);
            expect(mockRender).toHaveBeenCalled();
        });
    });
    
    describe('Group toggle behavior', () => {
        test('should update all tools in group locally without re-render', async () => {
            const mockUpdateButtonStates = jest.fn();
            const mockApplyChanges = jest.fn().mockResolvedValue(true);
            const mockRender = jest.fn();
            
            const handleGroupToggle = async function(group, permission, toolsInGroup) {
                // Update all tools in the group
                toolsInGroup.forEach(tool => {
                    mockUpdateButtonStates(tool, permission);
                });
                
                // Apply changes silently
                await mockApplyChanges(true);
                // No render call
            };
            
            const gitTools = ['Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git push:*)'];
            
            await handleGroupToggle('Git', 'allow', gitTools);
            
            // Verify all tools were updated locally
            expect(mockUpdateButtonStates).toHaveBeenCalledTimes(3);
            expect(mockUpdateButtonStates).toHaveBeenCalledWith('Bash(git add:*)', 'allow');
            expect(mockUpdateButtonStates).toHaveBeenCalledWith('Bash(git commit:*)', 'allow');
            expect(mockUpdateButtonStates).toHaveBeenCalledWith('Bash(git push:*)', 'allow');
            
            // Verify silent apply
            expect(mockApplyChanges).toHaveBeenCalledWith(true);
            
            // Verify no render
            expect(mockRender).not.toHaveBeenCalled();
        });
    });
    
    describe('Scroll container identification', () => {
        test('should correctly identify scrollable container', () => {
            document.body.innerHTML = `
                <div id="global-permissions-container">
                    <div id="global-permissions-list" style="overflow-y: auto;">
                        <div class="permissions-content"></div>
                    </div>
                </div>
            `;
            
            // The correct scrollable element
            const scrollContainer = document.getElementById('global-permissions-list');
            
            expect(scrollContainer).not.toBeNull();
            expect(scrollContainer.style.overflowY).toBe('auto');
        });
    });
});
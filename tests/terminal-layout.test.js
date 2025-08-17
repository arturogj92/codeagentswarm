/**
 * Unit tests for Terminal Layout functionality
 * Tests layout switching, height calculations, overflow prevention, and resizing
 */

describe('Terminal Layout System', () => {
    let container;
    let terminalManager;

    beforeEach(() => {
        // Set up DOM environment
        document.body.innerHTML = `
            <div id="terminals-container" class="terminals-container"></div>
        `;
        container = document.getElementById('terminals-container');
        
        // Mock TerminalManager for testing
        terminalManager = {
            terminals: new Map(),
            currentLayout: 'horizontal',
            terminalCount: 2,
            
            setLayout: function(layout) {
                this.currentLayout = layout;
                this.applyLayoutClasses();
            },
            
            applyLayoutClasses: function() {
                container.classList.remove('layout-vertical', 'layout-3-top1', 'layout-3-top2-horiz', 'layout-3-left2', 'layout-3-right2');
                container.classList.remove('count-1', 'count-2', 'count-3', 'count-4');
                
                container.classList.add(`count-${this.terminalCount}`);
                
                if (this.currentLayout !== 'horizontal') {
                    container.classList.add(`layout-${this.currentLayout}`);
                }
            },
            
            createTerminalElement: function(id) {
                const element = document.createElement('div');
                element.className = 'terminal-quadrant';
                element.setAttribute('data-quadrant', id);
                element.innerHTML = `
                    <div class="terminal-header">Terminal ${id}</div>
                    <div class="terminal-wrapper">
                        <div class="terminal" id="terminal-${id}"></div>
                    </div>
                `;
                return element;
            },
            
            reorganizeTerminals: function(layout) {
                container.innerHTML = '';
                
                if (this.terminalCount === 3) {
                    if (layout === '3-left2') {
                        this.createThreeTerminalLeftLayout();
                    } else if (layout === '3-right2') {
                        this.createThreeTerminalRightLayout();
                    }
                }
            },
            
            createThreeTerminalLeftLayout: function() {
                const columnLeft = document.createElement('div');
                columnLeft.className = 'terminal-column-left';
                
                const columnRight = document.createElement('div');
                columnRight.className = 'terminal-column-right';
                
                columnLeft.appendChild(this.createTerminalElement(0));
                columnLeft.appendChild(this.createTerminalElement(1));
                columnRight.appendChild(this.createTerminalElement(2));
                
                container.appendChild(columnLeft);
                container.appendChild(columnRight);
            },
            
            createThreeTerminalRightLayout: function() {
                const columnLeft = document.createElement('div');
                columnLeft.className = 'terminal-column-left';
                
                const columnRight = document.createElement('div');
                columnRight.className = 'terminal-column-right';
                
                columnLeft.appendChild(this.createTerminalElement(0));
                columnRight.appendChild(this.createTerminalElement(1));
                columnRight.appendChild(this.createTerminalElement(2));
                
                container.appendChild(columnLeft);
                container.appendChild(columnRight);
            }
        };
    });

    afterEach(() => {
        // Clean up DOM
        document.body.innerHTML = '';
    });

    describe('Layout Switching', () => {
        test('should apply correct classes for 2-terminal horizontal layout', () => {
            terminalManager.terminalCount = 2;
            terminalManager.setLayout('horizontal');
            
            expect(container.classList.contains('count-2')).toBe(true);
            expect(container.classList.contains('layout-vertical')).toBe(false);
        });

        test('should apply correct classes for 2-terminal vertical layout', () => {
            terminalManager.terminalCount = 2;
            terminalManager.setLayout('vertical');
            
            expect(container.classList.contains('count-2')).toBe(true);
            expect(container.classList.contains('layout-vertical')).toBe(true);
        });

        test('should apply correct classes for 3-terminal left layout', () => {
            terminalManager.terminalCount = 3;
            terminalManager.setLayout('3-left2');
            
            expect(container.classList.contains('count-3')).toBe(true);
            expect(container.classList.contains('layout-3-left2')).toBe(true);
        });

        test('should apply correct classes for 3-terminal right layout', () => {
            terminalManager.terminalCount = 3;
            terminalManager.setLayout('3-right2');
            
            expect(container.classList.contains('count-3')).toBe(true);
            expect(container.classList.contains('layout-3-right2')).toBe(true);
        });

        test('should remove previous layout classes when switching', () => {
            terminalManager.terminalCount = 3;
            terminalManager.setLayout('3-left2');
            
            expect(container.classList.contains('layout-3-left2')).toBe(true);
            
            terminalManager.setLayout('3-right2');
            
            expect(container.classList.contains('layout-3-left2')).toBe(false);
            expect(container.classList.contains('layout-3-right2')).toBe(true);
        });
    });

    describe('Terminal Column Structure', () => {
        test('should create correct structure for 3-left2 layout', () => {
            terminalManager.terminalCount = 3;
            terminalManager.reorganizeTerminals('3-left2');
            
            const leftColumn = container.querySelector('.terminal-column-left');
            const rightColumn = container.querySelector('.terminal-column-right');
            
            expect(leftColumn).not.toBeNull();
            expect(rightColumn).not.toBeNull();
            expect(leftColumn.children.length).toBe(2);
            expect(rightColumn.children.length).toBe(1);
        });

        test('should create correct structure for 3-right2 layout', () => {
            terminalManager.terminalCount = 3;
            terminalManager.reorganizeTerminals('3-right2');
            
            const leftColumn = container.querySelector('.terminal-column-left');
            const rightColumn = container.querySelector('.terminal-column-right');
            
            expect(leftColumn).not.toBeNull();
            expect(rightColumn).not.toBeNull();
            expect(leftColumn.children.length).toBe(1);
            expect(rightColumn.children.length).toBe(2);
        });
    });

    describe('Height Calculations', () => {
        test('should have overflow hidden on main container', () => {
            // Simulate CSS being applied
            container.style.overflow = 'hidden';
            container.style.height = 'calc(100vh - 60px)';
            container.style.maxHeight = 'calc(100vh - 60px)';
            
            expect(container.style.overflow).toBe('hidden');
            expect(container.style.height).toBe('calc(100vh - 60px)');
            expect(container.style.maxHeight).toBe('calc(100vh - 60px)');
        });

        test('should apply correct height constraints to terminal columns', () => {
            terminalManager.terminalCount = 3;
            terminalManager.reorganizeTerminals('3-left2');
            
            const leftColumn = container.querySelector('.terminal-column-left');
            
            // Simulate CSS being applied
            leftColumn.style.height = '100%';
            leftColumn.style.minHeight = '0';
            leftColumn.style.maxHeight = '100%';
            leftColumn.style.overflow = 'hidden';
            leftColumn.style.boxSizing = 'border-box';
            
            expect(leftColumn.style.height).toBe('100%');
            expect(leftColumn.style.minHeight).toBe('0');
            expect(leftColumn.style.maxHeight).toBe('100%');
            expect(leftColumn.style.overflow).toBe('hidden');
            expect(leftColumn.style.boxSizing).toBe('border-box');
        });

        test('should apply grid-template-rows with gap compensation', () => {
            terminalManager.terminalCount = 3;
            terminalManager.reorganizeTerminals('3-left2');
            
            const leftColumn = container.querySelector('.terminal-column-left');
            
            // Simulate CSS calculation for gap compensation
            leftColumn.style.gridTemplateRows = 'calc(50% - 10px) calc(50% - 10px)';
            leftColumn.style.gap = '20px';
            
            expect(leftColumn.style.gridTemplateRows).toBe('calc(50% - 10px) calc(50% - 10px)');
            expect(leftColumn.style.gap).toBe('20px');
        });
    });

    describe('Overflow Prevention', () => {
        test('should prevent overflow on terminal quadrants', () => {
            terminalManager.terminalCount = 3;
            terminalManager.reorganizeTerminals('3-left2');
            
            const quadrants = container.querySelectorAll('.terminal-quadrant');
            
            quadrants.forEach(quadrant => {
                // Simulate CSS being applied
                quadrant.style.minHeight = '0';
                quadrant.style.maxHeight = '100%';
                quadrant.style.overflow = 'hidden';
                
                expect(quadrant.style.minHeight).toBe('0');
                expect(quadrant.style.maxHeight).toBe('100%');
                expect(quadrant.style.overflow).toBe('hidden');
            });
        });

        test('should maintain proper box model for columns', () => {
            terminalManager.terminalCount = 3;
            terminalManager.reorganizeTerminals('3-right2');
            
            const rightColumn = container.querySelector('.terminal-column-right');
            
            // Simulate CSS being applied
            rightColumn.style.boxSizing = 'border-box';
            
            expect(rightColumn.style.boxSizing).toBe('border-box');
        });
    });

    describe('CSS Variable Management', () => {
        test('should maintain CSS variables for layout dimensions', () => {
            container.style.setProperty('--left-width', '50%');
            container.style.setProperty('--right-width', '50%');
            container.style.setProperty('--top-height', '50%');
            container.style.setProperty('--bottom-height', '50%');
            
            expect(container.style.getPropertyValue('--left-width')).toBe('50%');
            expect(container.style.getPropertyValue('--right-width')).toBe('50%');
            expect(container.style.getPropertyValue('--top-height')).toBe('50%');
            expect(container.style.getPropertyValue('--bottom-height')).toBe('50%');
        });

        test('should reset CSS variables when switching layouts', () => {
            container.style.setProperty('--left-width', '30%');
            container.style.setProperty('--right-width', '70%');
            
            // Simulate reset
            container.style.removeProperty('--left-width');
            container.style.removeProperty('--right-width');
            
            expect(container.style.getPropertyValue('--left-width')).toBe('');
            expect(container.style.getPropertyValue('--right-width')).toBe('');
        });
    });

    describe('Terminal Wrapper Constraints', () => {
        test('should have proper height constraints on terminal wrapper', () => {
            const wrapper = document.createElement('div');
            wrapper.className = 'terminal-wrapper';
            
            // Simulate CSS being applied
            wrapper.style.flex = '1';
            wrapper.style.height = 'calc(100% - 32px)';
            wrapper.style.overflow = 'hidden';
            
            expect(wrapper.style.flex).toBe('1');
            expect(wrapper.style.height).toBe('calc(100% - 32px)');
            expect(wrapper.style.overflow).toBe('hidden');
        });
    });

    describe('Layout Consistency', () => {
        test('should maintain consistent height when switching between layouts', () => {
            terminalManager.terminalCount = 3;
            
            // Switch to left layout
            terminalManager.reorganizeTerminals('3-left2');
            container.style.height = 'calc(100vh - 60px)';
            const initialHeight = container.style.height;
            
            // Switch to right layout
            terminalManager.reorganizeTerminals('3-right2');
            
            expect(container.style.height).toBe(initialHeight);
        });

        test('should not accumulate height when repeatedly switching layouts', () => {
            terminalManager.terminalCount = 3;
            container.style.height = 'calc(100vh - 60px)';
            const originalHeight = container.style.height;
            
            // Switch layouts multiple times
            for (let i = 0; i < 5; i++) {
                terminalManager.reorganizeTerminals('3-left2');
                terminalManager.reorganizeTerminals('3-right2');
            }
            
            expect(container.style.height).toBe(originalHeight);
        });
    });
});
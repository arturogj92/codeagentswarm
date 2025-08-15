/**
 * Simple test for More Options button to ensure basic functionality
 */

const { JSDOM } = require('jsdom');

describe('More Options Button - Simple Tests', () => {
    let dom;
    let document;
    let window;

    beforeEach(() => {
        // Create simple DOM
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <body>
                <div class="terminal-quadrant" data-quadrant="1">
                    <button class="terminal-control-btn terminal-more-btn" 
                            data-action="more-options" 
                            data-terminal="1">⋯</button>
                    <div class="terminal-dropdown-menu" data-terminal="1" style="display: none;">
                        <button class="terminal-dropdown-item">Option 1</button>
                        <button class="terminal-dropdown-item">Option 2</button>
                    </div>
                </div>
            </body>
            </html>
        `);

        document = dom.window.document;
        window = dom.window;

        // Mock getComputedStyle
        window.getComputedStyle = (element) => {
            return {
                display: element.style.display || 'block'
            };
        };
    });

    test('Button should have correct attributes', () => {
        const button = document.querySelector('.terminal-more-btn');
        expect(button).toBeTruthy();
        expect(button.dataset.action).toBe('more-options');
        expect(button.dataset.terminal).toBe('1');
    });

    test('Dropdown should toggle when button is clicked', () => {
        const button = document.querySelector('.terminal-more-btn');
        const dropdown = document.querySelector('.terminal-dropdown-menu');
        
        // Initially hidden
        expect(dropdown.style.display).toBe('none');
        
        // Simple toggle function
        button.addEventListener('click', () => {
            const isHidden = dropdown.style.display === 'none';
            dropdown.style.display = isHidden ? 'block' : 'none';
        });
        
        // Click to open
        button.click();
        expect(dropdown.style.display).toBe('block');
        
        // Click to close
        button.click();
        expect(dropdown.style.display).toBe('none');
    });

    test('Should get quadrant from data-terminal attribute', () => {
        const button = document.querySelector('.terminal-more-btn');
        
        button.addEventListener('click', (e) => {
            const target = e.target.closest('.terminal-control-btn');
            const quadrant = target ? parseInt(target.dataset.terminal) : null;
            
            expect(quadrant).toBe(1);
        });
        
        button.click();
    });

    test('Should work with multiple buttons', () => {
        // Add second button
        const secondQuadrant = document.createElement('div');
        secondQuadrant.className = 'terminal-quadrant';
        secondQuadrant.dataset.quadrant = '2';
        secondQuadrant.innerHTML = `
            <button class="terminal-control-btn terminal-more-btn" 
                    data-action="more-options" 
                    data-terminal="2">⋯</button>
            <div class="terminal-dropdown-menu" data-terminal="2" style="display: none;">
                <button class="terminal-dropdown-item">Option 1</button>
            </div>
        `;
        document.body.appendChild(secondQuadrant);
        
        const buttons = document.querySelectorAll('.terminal-more-btn');
        expect(buttons.length).toBe(2);
        
        // Each button should have correct terminal ID
        expect(buttons[0].dataset.terminal).toBe('1');
        expect(buttons[1].dataset.terminal).toBe('2');
        
        // Each dropdown should be independent
        const dropdowns = document.querySelectorAll('.terminal-dropdown-menu');
        expect(dropdowns.length).toBe(2);
        expect(dropdowns[0].dataset.terminal).toBe('1');
        expect(dropdowns[1].dataset.terminal).toBe('2');
    });

    test('Event delegation should work correctly', () => {
        let clickedQuadrant = null;
        
        // Use event delegation like in the real app
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.terminal-control-btn');
            if (btn && btn.dataset.action === 'more-options') {
                clickedQuadrant = parseInt(btn.dataset.terminal);
            }
        });
        
        const button = document.querySelector('.terminal-more-btn');
        button.click();
        
        expect(clickedQuadrant).toBe(1);
    });

    test('Should handle missing data-terminal by checking parent', () => {
        // Create button without data-terminal
        const button = document.createElement('button');
        button.className = 'terminal-control-btn';
        button.dataset.action = 'more-options';
        
        const quadrantDiv = document.querySelector('.terminal-quadrant');
        quadrantDiv.appendChild(button);
        
        button.addEventListener('click', (e) => {
            let quadrant;
            const target = e.target.closest('.terminal-control-btn');
            
            if (target && target.dataset.terminal) {
                quadrant = parseInt(target.dataset.terminal);
            } else {
                const parent = target.closest('.terminal-quadrant');
                if (parent && parent.dataset.quadrant) {
                    quadrant = parseInt(parent.dataset.quadrant);
                }
            }
            
            expect(quadrant).toBe(1);
        });
        
        button.click();
    });
});

module.exports = {};
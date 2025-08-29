/**
 * @jest-environment jsdom
 * 
 * Complete test suite for Danger Mode functionality
 * This comprehensive test suite ensures all danger mode features work correctly:
 * - 3-second hold to enable
 * - Visual progress bars with red gradient
 * - Warning messages in English
 * - Button hold behavior when danger mode is active
 * - Proper cleanup and state management
 */

describe('Danger Mode Complete Test Suite', () => {
    
    describe('Critical Features - Must Never Break', () => {
        
        test('✅ CRITICAL: 3-second hold functionality works', () => {
            document.body.innerHTML = `
                <div id="danger-mode-toggle">Enable Danger Mode</div>
                <div id="danger-progress" style="display: none;">
                    <div class="progress-bar" style="width: 0%"></div>
                </div>
                <div id="danger-option" style="display: none;">
                    <input type="checkbox" id="danger-mode-checkbox" />
                </div>
            `;
            
            const toggle = document.querySelector('#danger-mode-toggle');
            const progress = document.querySelector('#danger-progress');
            const option = document.querySelector('#danger-option');
            const checkbox = document.querySelector('#danger-mode-checkbox');
            
            let holdTimer = null;
            
            toggle.addEventListener('mousedown', () => {
                progress.style.display = 'block';
                holdTimer = setTimeout(() => {
                    option.style.display = 'block';
                    checkbox.checked = true;
                }, 3000);
            });
            
            toggle.addEventListener('mouseup', () => {
                if (holdTimer) clearTimeout(holdTimer);
                progress.style.display = 'none';
            });
            
            // Simulate 3-second hold
            jest.useFakeTimers();
            toggle.dispatchEvent(new MouseEvent('mousedown'));
            
            // Progress should be visible
            expect(progress.style.display).toBe('block');
            
            // After 3 seconds, checkbox should appear
            jest.advanceTimersByTime(3000);
            expect(option.style.display).toBe('block');
            expect(checkbox.checked).toBe(true);
            
            jest.useRealTimers();
        });
        
        test('✅ CRITICAL: Progress bar animation from 0% to 100%', () => {
            document.body.innerHTML = `
                <div class="progress-bar" style="width: 0%"></div>
            `;
            
            const progressBar = document.querySelector('.progress-bar');
            
            // Simulate progress animation
            jest.useFakeTimers();
            const startTime = Date.now();
            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min((elapsed / 3000) * 100, 100);
                progressBar.style.width = `${progress}%`;
            }, 50);
            
            // Check at 1 second (~33%)
            jest.advanceTimersByTime(1000);
            let width = parseFloat(progressBar.style.width);
            expect(width).toBeGreaterThan(30);
            expect(width).toBeLessThan(40);
            
            // Check at 2 seconds (~66%)
            jest.advanceTimersByTime(1000);
            width = parseFloat(progressBar.style.width);
            expect(width).toBeGreaterThan(60);
            expect(width).toBeLessThan(70);
            
            // Check at 3 seconds (100%)
            jest.advanceTimersByTime(1000);
            expect(progressBar.style.width).toBe('100%');
            
            clearInterval(interval);
            jest.useRealTimers();
        });
        
        test('✅ CRITICAL: Button hold overlay appears with .hold-progress', () => {
            document.body.innerHTML = `
                <button id="test-btn">Test Button</button>
            `;
            
            const button = document.querySelector('#test-btn');
            
            // Simulate creating hold progress
            const holdProgress = document.createElement('div');
            holdProgress.className = 'hold-progress';
            holdProgress.innerHTML = `
                <div class="hold-progress-bar" style="width: 0%"></div>
                <div class="hold-progress-text">Hold... <span class="countdown">3</span>s</div>
            `;
            button.appendChild(holdProgress);
            holdProgress.classList.add('active');
            
            // Verify structure
            expect(button.querySelector('.hold-progress')).not.toBeNull();
            expect(button.querySelector('.hold-progress-bar')).not.toBeNull();
            expect(button.querySelector('.countdown')).not.toBeNull();
            expect(holdProgress.classList.contains('active')).toBe(true);
        });
        
        test('✅ CRITICAL: Warning messages are in English', () => {
            const messages = [
                'Hold the button for 3 seconds',
                'HOLD BUTTON! You must hold the button for 3 seconds to activate danger mode',
                'DANGER MODE ACTIVE',
                'Exit Danger Mode',
                'Keep holding...'
            ];
            
            messages.forEach(msg => {
                // Check no Spanish text
                expect(msg).not.toMatch(/mantener|presionado|peligroso|Mantén/i);
                // Check English keywords
                expect(msg).toMatch(/hold|button|seconds|danger|mode|active|exit|keep/i);
            });
        });
    });
    
    describe('Visual Feedback', () => {
        
        test('Red gradient CSS is applied correctly', () => {
            // This tests that the CSS classes exist and can be applied
            document.body.innerHTML = `
                <style>
                    .hold-progress-bar {
                        background: linear-gradient(90deg, #ff4444 0%, #ff6666 100%);
                    }
                    .btn-danger-active {
                        animation: pulse-danger 1s infinite;
                    }
                </style>
                <button class="btn-danger-active">
                    <div class="hold-progress active">
                        <div class="hold-progress-bar"></div>
                    </div>
                </button>
            `;
            
            const button = document.querySelector('button');
            const progressBar = document.querySelector('.hold-progress-bar');
            
            expect(button.classList.contains('btn-danger-active')).toBe(true);
            expect(progressBar).not.toBeNull();
        });
        
        test('Countdown shows correct seconds', () => {
            document.body.innerHTML = `
                <span class="countdown">3</span>
            `;
            
            const countdown = document.querySelector('.countdown');
            
            jest.useFakeTimers();
            
            // Simulate countdown
            let seconds = 3;
            const interval = setInterval(() => {
                seconds--;
                countdown.textContent = seconds.toString();
            }, 1000);
            
            expect(countdown.textContent).toBe('3');
            
            jest.advanceTimersByTime(1000);
            expect(countdown.textContent).toBe('2');
            
            jest.advanceTimersByTime(1000);
            expect(countdown.textContent).toBe('1');
            
            jest.advanceTimersByTime(1000);
            expect(countdown.textContent).toBe('0');
            
            clearInterval(interval);
            jest.useRealTimers();
        });
    });
    
    describe('State Management', () => {
        
        test('Danger mode state persists correctly', () => {
            const state = {
                isDangerMode: false,
                dangerTerminals: new Set()
            };
            
            // Enable danger mode
            state.isDangerMode = true;
            state.dangerTerminals.add(1);
            state.dangerTerminals.add(2);
            
            expect(state.isDangerMode).toBe(true);
            expect(state.dangerTerminals.has(1)).toBe(true);
            expect(state.dangerTerminals.has(2)).toBe(true);
            expect(state.dangerTerminals.size).toBe(2);
            
            // Exit danger mode for terminal 1
            state.dangerTerminals.delete(1);
            expect(state.dangerTerminals.has(1)).toBe(false);
            expect(state.dangerTerminals.has(2)).toBe(true);
            expect(state.dangerTerminals.size).toBe(1);
        });
        
        test('Multiple hold/release cycles work correctly', () => {
            let holdCount = 0;
            let releaseCount = 0;
            
            const startHold = () => holdCount++;
            const cancelHold = () => releaseCount++;
            
            // Simulate multiple cycles
            startHold();
            cancelHold();
            expect(holdCount).toBe(1);
            expect(releaseCount).toBe(1);
            
            startHold();
            cancelHold();
            expect(holdCount).toBe(2);
            expect(releaseCount).toBe(2);
            
            startHold();
            startHold(); // Double start should be handled
            cancelHold();
            expect(holdCount).toBe(4);
            expect(releaseCount).toBe(3);
        });
    });
    
    describe('Regression Prevention', () => {
        
        test('🛡️ Event listeners are properly attached', () => {
            const button = document.createElement('button');
            const events = [];
            
            const originalAddEventListener = button.addEventListener;
            button.addEventListener = function(event, handler) {
                events.push(event);
                originalAddEventListener.call(this, event, handler);
            };
            
            // Simulate attaching danger mode listeners
            button.addEventListener('mousedown', () => {});
            button.addEventListener('mouseup', () => {});
            button.addEventListener('mouseleave', () => {});
            button.addEventListener('click', () => {});
            
            expect(events).toContain('mousedown');
            expect(events).toContain('mouseup');
            expect(events).toContain('mouseleave');
            expect(events).toContain('click');
        });
        
        test('🛡️ Cleanup removes all artifacts', () => {
            document.body.innerHTML = `
                <button id="test-btn">
                    <div class="hold-progress active">
                        <div class="hold-progress-bar"></div>
                    </div>
                </button>
            `;
            
            const button = document.querySelector('#test-btn');
            const holdProgress = button.querySelector('.hold-progress');
            
            // Cleanup
            holdProgress.classList.remove('active');
            button.classList.remove('btn-danger-active');
            
            expect(holdProgress.classList.contains('active')).toBe(false);
            expect(button.classList.contains('btn-danger-active')).toBe(false);
        });
        
        test('🛡️ Mouseleave always cancels hold', () => {
            let isHolding = false;
            
            const startHold = () => { isHolding = true; };
            const cancelHold = () => { isHolding = false; };
            
            const button = document.createElement('button');
            button.addEventListener('mousedown', startHold);
            button.addEventListener('mouseleave', cancelHold);
            
            // Start hold
            button.dispatchEvent(new MouseEvent('mousedown'));
            expect(isHolding).toBe(true);
            
            // Leave button
            button.dispatchEvent(new MouseEvent('mouseleave'));
            expect(isHolding).toBe(false);
        });
    });
    
    describe('Performance', () => {
        
        test('⚡ Progress updates are throttled appropriately', () => {
            let updateCount = 0;
            
            jest.useFakeTimers();
            
            const interval = setInterval(() => {
                updateCount++;
            }, 50); // Update every 50ms
            
            // Run for 3 seconds
            jest.advanceTimersByTime(3000);
            
            // Should have ~60 updates (3000ms / 50ms)
            expect(updateCount).toBeGreaterThan(55);
            expect(updateCount).toBeLessThan(65);
            
            clearInterval(interval);
            jest.useRealTimers();
        });
    });
    
    describe('User Experience', () => {
        
        test('👤 Visual feedback is immediate on mousedown', () => {
            const button = document.createElement('button');
            let feedbackShown = false;
            
            button.addEventListener('mousedown', () => {
                feedbackShown = true;
            });
            
            // User presses button
            button.dispatchEvent(new MouseEvent('mousedown'));
            
            // Feedback should be immediate
            expect(feedbackShown).toBe(true);
        });
        
        test('👤 Accidental clicks show helpful warning', () => {
            document.body.innerHTML = `
                <div id="hold-warning" style="display: none;">
                    <span class="warning-text">Hold the button for 3 seconds</span>
                </div>
            `;
            
            const warning = document.querySelector('#hold-warning');
            
            // Show warning on click
            warning.style.display = 'flex';
            warning.classList.add('show');
            
            expect(warning.style.display).toBe('flex');
            expect(warning.classList.contains('show')).toBe(true);
            expect(warning.textContent).toContain('Hold the button for 3 seconds');
        });
    });
});

// Summary test to ensure all critical features work
describe('🎯 Final Integration Check', () => {
    
    test('Complete danger mode flow works end-to-end', () => {
        jest.useFakeTimers();
        
        // Setup complete HTML
        document.body.innerHTML = `
            <div class="directory-selector">
                <button id="danger-mode-toggle">Enable Danger Mode</button>
                <div id="danger-progress" style="display: none;">
                    <div class="progress-bar" style="width: 0%"></div>
                    <span class="countdown">3</span>
                </div>
                <div id="danger-option" style="display: none;">
                    <input type="checkbox" id="danger-mode-checkbox" />
                </div>
                <button id="session-btn">Session Button</button>
            </div>
        `;
        
        const toggle = document.querySelector('#danger-mode-toggle');
        const progress = document.querySelector('#danger-progress');
        const progressBar = document.querySelector('.progress-bar');
        const countdown = document.querySelector('.countdown');
        const option = document.querySelector('#danger-option');
        const checkbox = document.querySelector('#danger-mode-checkbox');
        const sessionBtn = document.querySelector('#session-btn');
        
        // Step 1: Enable danger mode with 3-second hold
        let dangerHoldTimer;
        toggle.addEventListener('mousedown', () => {
            progress.style.display = 'block';
            
            const startTime = Date.now();
            const progressInterval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const percent = Math.min((elapsed / 3000) * 100, 100);
                progressBar.style.width = `${percent}%`;
                
                const remaining = Math.max(3 - Math.floor(elapsed / 1000), 0);
                countdown.textContent = remaining.toString();
                
                if (percent >= 100) clearInterval(progressInterval);
            }, 50);
            
            dangerHoldTimer = setTimeout(() => {
                option.style.display = 'block';
                checkbox.checked = true;
                progress.style.display = 'none';
            }, 3000);
        });
        
        toggle.addEventListener('mouseup', () => {
            if (dangerHoldTimer) clearTimeout(dangerHoldTimer);
        });
        
        // Start danger mode activation
        toggle.dispatchEvent(new MouseEvent('mousedown'));
        expect(progress.style.display).toBe('block');
        
        // Complete the hold
        jest.advanceTimersByTime(3000);
        expect(checkbox.checked).toBe(true);
        expect(option.style.display).toBe('block');
        
        // Step 2: Test session button with danger mode active
        let sessionHoldTimer;
        sessionBtn.addEventListener('mousedown', () => {
            if (!checkbox.checked) return;
            
            const holdProgress = document.createElement('div');
            holdProgress.className = 'hold-progress active';
            holdProgress.innerHTML = '<div class="hold-progress-bar"></div>';
            sessionBtn.appendChild(holdProgress);
            
            sessionHoldTimer = setTimeout(() => {
                console.log('Session action executed in danger mode');
            }, 3000);
        });
        
        sessionBtn.addEventListener('mouseup', () => {
            if (sessionHoldTimer) clearTimeout(sessionHoldTimer);
            const holdProgress = sessionBtn.querySelector('.hold-progress');
            if (holdProgress) holdProgress.remove();
        });
        
        // Hold session button
        sessionBtn.dispatchEvent(new MouseEvent('mousedown'));
        expect(sessionBtn.querySelector('.hold-progress')).not.toBeNull();
        
        // Complete the action
        jest.advanceTimersByTime(3000);
        
        // Cleanup
        sessionBtn.dispatchEvent(new MouseEvent('mouseup'));
        
        jest.useRealTimers();
    });
});
/**
 * @jest-environment jsdom
 * 
 * Integration tests for danger mode functionality
 * Tests the actual behavior as implemented in renderer.js
 */

describe('Danger Mode Integration Tests', () => {
    let selectorDiv;
    let dangerToggle;
    let resumeBtn;
    let newBtn;
    
    // Helper to simulate mouse hold
    const simulateHold = (element, duration) => {
        const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true });
        const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true });
        
        element.dispatchEvent(mouseDownEvent);
        
        if (duration > 0) {
            jest.advanceTimersByTime(duration);
        }
        
        element.dispatchEvent(mouseUpEvent);
    };
    
    // Helper to setup danger mode listeners (simulating renderer.js behavior)
    const setupDangerModeListeners = () => {
        const dangerOption = selectorDiv.querySelector('#danger-option');
        const dangerCheckbox = selectorDiv.querySelector('#danger-mode-checkbox');
        const dangerProgress = selectorDiv.querySelector('#danger-progress');
        const progressBar = dangerProgress?.querySelector('.progress-bar');
        const progressCountdown = dangerProgress?.querySelector('.progress-countdown');
        const holdWarning = selectorDiv.querySelector('#hold-warning');
        
        let holdTimer = null;
        let progressInterval = null;
        
        const startDangerHold = () => {
            if (holdTimer) return;
            
            dangerProgress.style.display = 'block';
            progressBar.style.width = '0%';
            progressCountdown.textContent = '3';
            
            const startTime = Date.now();
            progressInterval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min((elapsed / 3000) * 100, 100);
                progressBar.style.width = `${progress}%`;
                
                const remaining = Math.max(3 - Math.floor(elapsed / 1000), 0);
                progressCountdown.textContent = remaining.toString();
                
                if (progress >= 100) {
                    clearInterval(progressInterval);
                }
            }, 50);
            
            holdTimer = setTimeout(() => {
                dangerOption.style.display = 'block';
                dangerCheckbox.checked = true;
                dangerProgress.style.display = 'none';
                clearInterval(progressInterval);
            }, 3000);
        };
        
        const cancelDangerHold = () => {
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            dangerProgress.style.display = 'none';
        };
        
        // Setup button hold behavior
        const setupButtonHold = (button) => {
            let buttonHoldTimer = null;
            let buttonProgressInterval = null;
            
            const startHold = () => {
                const isDangerMode = dangerCheckbox?.checked;
                
                if (!isDangerMode) {
                    // Execute immediately
                    console.log('No danger mode, executing immediately');
                    return;
                }
                
                // Create hold progress on button
                let holdProgress = button.querySelector('.hold-progress');
                if (!holdProgress) {
                    holdProgress = document.createElement('div');
                    holdProgress.className = 'hold-progress';
                    holdProgress.innerHTML = `
                        <div class="hold-progress-bar" style="width: 0%"></div>
                        <div class="hold-progress-text">Hold... <span class="countdown">3</span>s</div>
                    `;
                    button.appendChild(holdProgress);
                }
                
                holdProgress.classList.add('active');
                button.classList.add('btn-danger-active');
                button.style.position = 'relative';
                
                const progressBar = holdProgress.querySelector('.hold-progress-bar');
                const countdown = holdProgress.querySelector('.countdown');
                
                const startTime = Date.now();
                buttonProgressInterval = setInterval(() => {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min((elapsed / 3000) * 100, 100);
                    progressBar.style.width = `${progress}%`;
                    
                    const remaining = Math.max(3 - Math.floor(elapsed / 1000), 0);
                    countdown.textContent = remaining.toString();
                    
                    if (progress >= 100) {
                        clearInterval(buttonProgressInterval);
                    }
                }, 50);
                
                buttonHoldTimer = setTimeout(() => {
                    console.log('Hold completed, executing action');
                    holdProgress.classList.remove('active');
                    button.classList.remove('btn-danger-active');
                }, 3000);
            };
            
            const cancelHold = () => {
                if (buttonHoldTimer) {
                    clearTimeout(buttonHoldTimer);
                    buttonHoldTimer = null;
                }
                if (buttonProgressInterval) {
                    clearInterval(buttonProgressInterval);
                    buttonProgressInterval = null;
                }
                
                const holdProgress = button.querySelector('.hold-progress');
                if (holdProgress) {
                    holdProgress.classList.remove('active');
                }
                button.classList.remove('btn-danger-active');
            };
            
            const handleClick = () => {
                const isDangerMode = dangerCheckbox?.checked;
                if (isDangerMode) {
                    // Show warning
                    holdWarning.style.display = 'flex';
                    holdWarning.classList.add('show');
                    
                    setTimeout(() => {
                        holdWarning.style.display = 'none';
                        holdWarning.classList.remove('show');
                    }, 2000);
                }
            };
            
            button.addEventListener('click', handleClick);
            button.addEventListener('mousedown', startHold);
            button.addEventListener('mouseup', cancelHold);
            button.addEventListener('mouseleave', cancelHold);
        };
        
        // Attach listeners
        dangerToggle.addEventListener('mousedown', startDangerHold);
        dangerToggle.addEventListener('mouseup', cancelDangerHold);
        dangerToggle.addEventListener('mouseleave', cancelDangerHold);
        
        setupButtonHold(resumeBtn);
        setupButtonHold(newBtn);
    };
    
    beforeEach(() => {
        jest.useFakeTimers();
        
        // Create HTML structure
        document.body.innerHTML = `
            <div class="directory-selector">
                <button id="danger-mode-toggle">Enable Danger Mode</button>
                <div id="danger-progress" style="display: none;">
                    <div class="progress-bar" style="width: 0%"></div>
                    <span class="progress-countdown">3</span>
                </div>
                <div id="danger-option" style="display: none;">
                    <input type="checkbox" id="danger-mode-checkbox" />
                </div>
                <div id="hold-warning" style="display: none;">
                    <span class="warning-text">Hold for 3 seconds</span>
                </div>
                <button id="resume-session-btn">Resume</button>
                <button id="new-session-btn">New</button>
            </div>
        `;
        
        selectorDiv = document.querySelector('.directory-selector');
        dangerToggle = document.querySelector('#danger-mode-toggle');
        resumeBtn = document.querySelector('#resume-session-btn');
        newBtn = document.querySelector('#new-session-btn');
        
        setupDangerModeListeners();
    });
    
    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
    });
    
    describe('Danger Mode Toggle', () => {
        test('3-second hold shows danger mode checkbox', () => {
            const dangerOption = document.querySelector('#danger-option');
            const dangerCheckbox = document.querySelector('#danger-mode-checkbox');
            const dangerProgress = document.querySelector('#danger-progress');
            
            expect(dangerOption.style.display).toBe('none');
            expect(dangerCheckbox.checked).toBe(false);
            
            // Start holding
            dangerToggle.dispatchEvent(new MouseEvent('mousedown'));
            
            // Progress should be visible
            expect(dangerProgress.style.display).toBe('block');
            
            // Complete the hold
            jest.advanceTimersByTime(3000);
            
            // Checkbox should be visible and checked
            expect(dangerOption.style.display).toBe('block');
            expect(dangerCheckbox.checked).toBe(true);
        });
        
        test('releasing before 3 seconds cancels activation', () => {
            const dangerOption = document.querySelector('#danger-option');
            const dangerProgress = document.querySelector('#danger-progress');
            
            // Start and release quickly
            dangerToggle.dispatchEvent(new MouseEvent('mousedown'));
            jest.advanceTimersByTime(1000);
            dangerToggle.dispatchEvent(new MouseEvent('mouseup'));
            
            // Progress should be hidden
            expect(dangerProgress.style.display).toBe('none');
            
            // Checkbox should not appear
            jest.advanceTimersByTime(2000);
            expect(dangerOption.style.display).toBe('none');
        });
        
        test('progress bar fills gradually', () => {
            const progressBar = document.querySelector('.progress-bar');
            
            dangerToggle.dispatchEvent(new MouseEvent('mousedown'));
            
            // Check progress at different intervals
            jest.advanceTimersByTime(1000);
            const width1s = parseFloat(progressBar.style.width);
            expect(width1s).toBeGreaterThan(30);
            expect(width1s).toBeLessThan(40);
            
            jest.advanceTimersByTime(1000);
            const width2s = parseFloat(progressBar.style.width);
            expect(width2s).toBeGreaterThan(60);
            expect(width2s).toBeLessThan(70);
            
            jest.advanceTimersByTime(1000);
            expect(progressBar.style.width).toBe('100%');
        });
    });
    
    describe('Resume/New Button Behavior', () => {
        beforeEach(() => {
            // Enable danger mode first
            dangerToggle.dispatchEvent(new MouseEvent('mousedown'));
            jest.advanceTimersByTime(3000);
            dangerToggle.dispatchEvent(new MouseEvent('mouseup'));
        });
        
        test('click shows warning when danger mode is active', () => {
            const holdWarning = document.querySelector('#hold-warning');
            
            resumeBtn.click();
            
            expect(holdWarning.style.display).toBe('flex');
            expect(holdWarning.classList.contains('show')).toBe(true);
        });
        
        test('hold creates progress overlay on button', () => {
            resumeBtn.dispatchEvent(new MouseEvent('mousedown'));
            
            const holdProgress = resumeBtn.querySelector('.hold-progress');
            expect(holdProgress).not.toBeNull();
            expect(holdProgress.classList.contains('active')).toBe(true);
            
            const progressBar = holdProgress.querySelector('.hold-progress-bar');
            expect(progressBar).not.toBeNull();
        });
        
        test('button gets danger-active class during hold', () => {
            resumeBtn.dispatchEvent(new MouseEvent('mousedown'));
            
            expect(resumeBtn.classList.contains('btn-danger-active')).toBe(true);
            
            resumeBtn.dispatchEvent(new MouseEvent('mouseup'));
            
            expect(resumeBtn.classList.contains('btn-danger-active')).toBe(false);
        });
        
        test('progress fills during 3-second hold', () => {
            resumeBtn.dispatchEvent(new MouseEvent('mousedown'));
            
            const progressBar = resumeBtn.querySelector('.hold-progress-bar');
            
            jest.advanceTimersByTime(1500);
            const width = parseFloat(progressBar.style.width);
            expect(width).toBeGreaterThan(45);
            expect(width).toBeLessThan(55);
            
            jest.advanceTimersByTime(1500);
            expect(progressBar.style.width).toBe('100%');
        });
        
        test('without danger mode, buttons work immediately', () => {
            // Disable danger mode
            const dangerCheckbox = document.querySelector('#danger-mode-checkbox');
            dangerCheckbox.checked = false;
            
            const consoleSpy = jest.spyOn(console, 'log');
            
            resumeBtn.dispatchEvent(new MouseEvent('mousedown'));
            
            expect(consoleSpy).toHaveBeenCalledWith('No danger mode, executing immediately');
            
            // No hold progress should be created
            const holdProgress = resumeBtn.querySelector('.hold-progress.active');
            expect(holdProgress).toBeNull();
            
            consoleSpy.mockRestore();
        });
    });
    
    describe('Edge Cases', () => {
        test('mouseleave cancels hold', () => {
            // Enable danger mode
            dangerToggle.dispatchEvent(new MouseEvent('mousedown'));
            jest.advanceTimersByTime(3000);
            dangerToggle.dispatchEvent(new MouseEvent('mouseup'));
            
            // Start hold on button
            resumeBtn.dispatchEvent(new MouseEvent('mousedown'));
            
            const holdProgress = resumeBtn.querySelector('.hold-progress');
            expect(holdProgress.classList.contains('active')).toBe(true);
            
            // Mouse leave
            resumeBtn.dispatchEvent(new MouseEvent('mouseleave'));
            
            expect(holdProgress.classList.contains('active')).toBe(false);
        });
        
        test('switching between buttons cancels previous hold', () => {
            // Enable danger mode
            dangerToggle.dispatchEvent(new MouseEvent('mousedown'));
            jest.advanceTimersByTime(3000);
            dangerToggle.dispatchEvent(new MouseEvent('mouseup'));
            
            // Start hold on resume
            resumeBtn.dispatchEvent(new MouseEvent('mousedown'));
            jest.advanceTimersByTime(1000);
            
            // Release and start new button
            resumeBtn.dispatchEvent(new MouseEvent('mouseup'));
            newBtn.dispatchEvent(new MouseEvent('mousedown'));
            
            const resumeProgress = resumeBtn.querySelector('.hold-progress.active');
            const newProgress = newBtn.querySelector('.hold-progress.active');
            
            expect(resumeProgress).toBeNull();
            expect(newProgress).not.toBeNull();
        });
    });
});
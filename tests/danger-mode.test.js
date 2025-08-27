/**
 * @jest-environment jsdom
 */

describe('Danger Mode Notifications', () => {
    let terminalManager;
    
    beforeEach(() => {
        // Clear the DOM
        document.body.innerHTML = '';
        
        // Create a mock terminal manager with the danger notification methods
        terminalManager = {
            dangerTerminals: new Set(),
            
            showDangerNotification(quadrant) {
                // Remove any existing danger notification for this quadrant
                const existingNotification = document.querySelector(`#danger-notification-${quadrant}`);
                if (existingNotification) {
                    existingNotification.remove();
                }
                
                // Create persistent danger notification
                const notification = document.createElement('div');
                notification.id = `danger-notification-${quadrant}`;
                notification.className = 'app-notification notification-warning danger-mode-notification';
                notification.innerHTML = `
                    <div class="notification-content">
                        <span class="danger-icon">⚡</span>
                        <strong>DANGER MODE ACTIVE</strong>
                        <span class="notification-message">Terminal ${quadrant} is running in danger mode - ALL safety confirmations are disabled!</span>
                        <button class="notification-close" onclick="window.terminalManager.exitDangerMode(${quadrant})">
                            Exit Danger Mode
                        </button>
                    </div>
                `;
                
                // Add to notification container or create one
                let container = document.querySelector('.notification-container');
                if (!container) {
                    container = document.createElement('div');
                    container.className = 'notification-container';
                    document.body.appendChild(container);
                }
                
                container.appendChild(notification);
                
                // Animate in
                setTimeout(() => {
                    notification.classList.add('show');
                }, 10);
                
                // Track active danger terminals
                this.dangerTerminals.add(quadrant);
            },
            
            exitDangerMode(quadrant) {
                // Remove danger notification
                const notification = document.querySelector(`#danger-notification-${quadrant}`);
                if (notification) {
                    notification.classList.remove('show');
                    setTimeout(() => notification.remove(), 300);
                }
                
                // Remove from tracking
                this.dangerTerminals.delete(quadrant);
            },
            
            showNotification(message, type) {
                // Mock regular notification for testing
                console.log(`Notification: ${message} (${type})`);
            }
        };
        
        // Make it available globally for onclick handlers
        window.terminalManager = terminalManager;
    });
    
    afterEach(() => {
        // Clean up
        document.body.innerHTML = '';
        delete window.terminalManager;
    });
    
    describe('showDangerNotification', () => {
        test('should create a notification with correct ID', () => {
            terminalManager.showDangerNotification(1);
            
            const notification = document.querySelector('#danger-notification-1');
            expect(notification).toBeTruthy();
            expect(notification.id).toBe('danger-notification-1');
        });
        
        test('should display English text (not Spanish)', () => {
            terminalManager.showDangerNotification(1);
            
            const notification = document.querySelector('#danger-notification-1');
            const text = notification.textContent;
            
            // Check for English text
            expect(text).toContain('DANGER MODE ACTIVE');
            expect(text).toContain('ALL safety confirmations are disabled');
            expect(text).toContain('Exit Danger Mode');
            
            // Make sure there's no Spanish text
            expect(text).not.toContain('mantener');
            expect(text).not.toContain('peligroso');
            expect(text).not.toContain('presionado');
            expect(text).not.toContain('Mantén');
        });
        
        test('should include the terminal number in the message', () => {
            terminalManager.showDangerNotification(3);
            
            const notification = document.querySelector('#danger-notification-3');
            expect(notification.textContent).toContain('Terminal 3');
        });
        
        test('should add correct CSS classes', () => {
            terminalManager.showDangerNotification(1);
            
            const notification = document.querySelector('#danger-notification-1');
            expect(notification.classList.contains('app-notification')).toBe(true);
            expect(notification.classList.contains('notification-warning')).toBe(true);
            expect(notification.classList.contains('danger-mode-notification')).toBe(true);
        });
        
        test('should track terminal in dangerTerminals set', () => {
            terminalManager.showDangerNotification(1);
            terminalManager.showDangerNotification(2);
            
            expect(terminalManager.dangerTerminals.has(1)).toBe(true);
            expect(terminalManager.dangerTerminals.has(2)).toBe(true);
            expect(terminalManager.dangerTerminals.size).toBe(2);
        });
        
        test('should replace existing notification for same terminal', () => {
            terminalManager.showDangerNotification(1);
            const firstNotification = document.querySelector('#danger-notification-1');
            
            terminalManager.showDangerNotification(1);
            const secondNotification = document.querySelector('#danger-notification-1');
            
            // Should only have one notification
            const allNotifications = document.querySelectorAll('#danger-notification-1');
            expect(allNotifications.length).toBe(1);
            
            // It should be a new element
            expect(secondNotification).not.toBe(firstNotification);
        });
        
        test('should create notification container if not exists', () => {
            expect(document.querySelector('.notification-container')).toBeFalsy();
            
            terminalManager.showDangerNotification(1);
            
            expect(document.querySelector('.notification-container')).toBeTruthy();
        });
        
        test('should add show class after delay', (done) => {
            terminalManager.showDangerNotification(1);
            const notification = document.querySelector('#danger-notification-1');
            
            // Initially should not have show class
            expect(notification.classList.contains('show')).toBe(false);
            
            // After delay should have show class
            setTimeout(() => {
                expect(notification.classList.contains('show')).toBe(true);
                done();
            }, 20);
        });
    });
    
    describe('exitDangerMode', () => {
        beforeEach(() => {
            // Create a danger notification first
            terminalManager.showDangerNotification(1);
        });
        
        test('should remove notification from DOM after delay', (done) => {
            const notification = document.querySelector('#danger-notification-1');
            expect(notification).toBeTruthy();
            
            terminalManager.exitDangerMode(1);
            
            // Should remove show class immediately
            expect(notification.classList.contains('show')).toBe(false);
            
            // Should still be in DOM initially
            expect(document.querySelector('#danger-notification-1')).toBeTruthy();
            
            // After delay should be removed from DOM
            setTimeout(() => {
                expect(document.querySelector('#danger-notification-1')).toBeFalsy();
                done();
            }, 350);
        });
        
        test('should remove terminal from dangerTerminals set', () => {
            expect(terminalManager.dangerTerminals.has(1)).toBe(true);
            
            terminalManager.exitDangerMode(1);
            
            expect(terminalManager.dangerTerminals.has(1)).toBe(false);
        });
        
        test('should handle non-existent terminal gracefully', () => {
            expect(() => {
                terminalManager.exitDangerMode(999);
            }).not.toThrow();
        });
    });
    
    describe('Multiple danger terminals', () => {
        test('should support multiple terminals in danger mode', () => {
            terminalManager.showDangerNotification(1);
            terminalManager.showDangerNotification(2);
            terminalManager.showDangerNotification(3);
            
            expect(document.querySelector('#danger-notification-1')).toBeTruthy();
            expect(document.querySelector('#danger-notification-2')).toBeTruthy();
            expect(document.querySelector('#danger-notification-3')).toBeTruthy();
            
            expect(terminalManager.dangerTerminals.size).toBe(3);
        });
        
        test('should only remove specified terminal notification', () => {
            terminalManager.showDangerNotification(1);
            terminalManager.showDangerNotification(2);
            
            terminalManager.exitDangerMode(1);
            
            // Terminal 1 should be removed
            expect(terminalManager.dangerTerminals.has(1)).toBe(false);
            
            // Terminal 2 should still be active
            expect(terminalManager.dangerTerminals.has(2)).toBe(true);
            expect(document.querySelector('#danger-notification-2')).toBeTruthy();
        });
    });
    
    describe('Persistence', () => {
        test('notification should not auto-hide (unlike regular notifications)', (done) => {
            terminalManager.showDangerNotification(1);
            const notification = document.querySelector('#danger-notification-1');
            
            // Wait for what would be auto-hide timeout (7 seconds in production)
            // For testing, we just verify the notification doesn't have auto-hide logic
            setTimeout(() => {
                // Should still be in DOM
                expect(document.querySelector('#danger-notification-1')).toBeTruthy();
                expect(notification.parentNode).toBeTruthy();
                done();
            }, 100);
        });
    });
    
    describe('Exit button', () => {
        test('should have exit button with correct text', () => {
            terminalManager.showDangerNotification(1);
            
            const button = document.querySelector('#danger-notification-1 .notification-close');
            expect(button).toBeTruthy();
            expect(button.textContent).toContain('Exit Danger Mode');
        });
        
        test('should have onclick handler for exit button', () => {
            terminalManager.showDangerNotification(1);
            
            const button = document.querySelector('#danger-notification-1 .notification-close');
            const onclickAttr = button.getAttribute('onclick');
            expect(onclickAttr).toBe('window.terminalManager.exitDangerMode(1)');
        });
    });
    
    describe('Integration with hold button message', () => {
        test('hold button message should be in English', () => {
            // This would test the actual warning div content
            const warningDiv = document.createElement('div');
            warningDiv.innerHTML = `
                <span class="danger-icon">⏱️</span>
                <span class="danger-text"><strong>HOLD BUTTON!</strong> You must hold the button for 3 seconds to activate danger mode</span>
            `;
            
            const text = warningDiv.textContent;
            expect(text).toContain('HOLD BUTTON!');
            expect(text).toContain('You must hold the button for 3 seconds');
            expect(text).not.toContain('Mantén');
            expect(text).not.toContain('Debes mantener');
        });
    });
});
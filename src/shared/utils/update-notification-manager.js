/**
 * UpdateNotificationManager - Manages update notifications and settings button highlights
 * 
 * Notification timing:
 * 1. Shows on app startup (after 5 second delay for UI to load)
 * 2. Shows immediately when a new update is detected
 * 3. Re-shows every hour if not dismissed
 * 4. Respects user dismissal preferences:
 *    - "Don't show for 24 hours" checkbox
 *    - Permanent dismissal for specific versions
 */
class UpdateNotificationManager {
    constructor() {
        this.checkInterval = 60 * 60 * 1000; // 1 hour in milliseconds
        this.dismissDuration = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        this.initialDelayOnStartup = 5000; // 5 seconds delay on app startup
        this.intervalId = null;
        this.hasUpdate = false;
        this.updateInfo = null;
        this.highlightBadge = null;
        this.pulseInterval = null;
        
        // Storage keys
        this.STORAGE_KEYS = {
            DISMISSED_AT: 'updateNotification_dismissedAt',
            DISMISSED_VERSION: 'updateNotification_dismissedVersion',
            LAST_CHECK: 'updateNotification_lastCheck',
            DONT_SHOW_TODAY: 'updateNotification_dontShowToday'
        };
        
        this.init();
    }
    
    init() {
        // Listen for update events from main process using ipcRenderer
        if (typeof window !== 'undefined' && window.ipcRenderer) {
            window.ipcRenderer.on('update-available', (event, info) => {
                this.handleUpdateAvailable(info);
            });
            
            window.ipcRenderer.on('update-not-available', () => {
                this.handleUpdateNotAvailable();
            });
            
            // Also check for updates on init
            window.ipcRenderer.on('checking-for-update', () => {
            });
        }
        
        // Check on app startup after a small delay (to let the UI load)
        setTimeout(() => {
            this.checkForHighlight();
        }, this.initialDelayOnStartup);
        
        // Start periodic checking
        this.startPeriodicCheck();
    }
    
    handleUpdateAvailable(info) {
        this.hasUpdate = true;
        this.updateInfo = info;
        
        // Store update info
        localStorage.setItem('updateAvailable', 'true');
        localStorage.setItem('updateVersion', info.version);
        
        // Check immediately when update becomes available
        // This ensures the notification shows as soon as an update is detected
        this.checkForHighlight();
    }
    
    handleUpdateNotAvailable() {
        this.hasUpdate = false;
        this.updateInfo = null;
        
        // Clear update info
        localStorage.removeItem('updateAvailable');
        localStorage.removeItem('updateVersion');
        
        // Remove any existing highlight
        this.removeHighlight();
    }
    
    startPeriodicCheck() {
        // Clear any existing interval
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        
        // Set up periodic check (every hour)
        // This will re-show the notification if:
        // - An update is still available
        // - User hasn't permanently dismissed this version
        // - 24-hour "don't show today" period has expired
        this.intervalId = setInterval(() => {
            this.checkForHighlight();
        }, this.checkInterval);
    }
    
    checkForHighlight() {
        // Check if there's an update available
        const updateAvailable = localStorage.getItem('updateAvailable') === 'true';
        const updateVersion = localStorage.getItem('updateVersion');
        
        if (!updateAvailable || !updateVersion) {
            this.removeHighlight();
            return;
        }
        
        // Check if user dismissed this version permanently
        const dismissedVersion = localStorage.getItem(this.STORAGE_KEYS.DISMISSED_VERSION);
        if (dismissedVersion === updateVersion) {
            return;
        }
        
        // Check if user selected "don't show today"
        const dontShowToday = localStorage.getItem(this.STORAGE_KEYS.DONT_SHOW_TODAY);
        if (dontShowToday) {
            const dismissedTime = parseInt(dontShowToday, 10);
            const now = Date.now();
            const timeSinceDismissal = now - dismissedTime;
            
            if (timeSinceDismissal < this.dismissDuration) {
                const hoursRemaining = Math.ceil((this.dismissDuration - timeSinceDismissal) / (60 * 60 * 1000));
                return;
            } else {
                // Clear the "don't show today" flag
                localStorage.removeItem(this.STORAGE_KEYS.DONT_SHOW_TODAY);
            }
        }
        
        // Show the highlight
        this.showHighlight();
    }
    
    showHighlight() {
        const settingsBtn = document.getElementById('settings-btn');
        if (!settingsBtn) {
            console.warn('Settings button not found');
            return;
        }
        
        // Check if highlight already exists
        if (this.highlightBadge && document.body.contains(this.highlightBadge)) {
            return;
        }
        
        // Make settings button position relative if needed
        const computedStyle = window.getComputedStyle(settingsBtn);
        if (computedStyle.position === 'static') {
            settingsBtn.style.position = 'relative';
        }
        
        // Create highlight badge
        this.highlightBadge = document.createElement('span');
        this.highlightBadge.className = 'update-notification-badge';
        this.highlightBadge.innerHTML = `
            <span class="update-badge-dot"></span>
            <span class="update-badge-text">Update!</span>
        `;
        
        // Add styles if not already added
        this.addStyles();
        
        // Add badge to settings button
        settingsBtn.appendChild(this.highlightBadge);
        
        // Add click handler to settings button
        const clickHandler = (e) => {
            // Stop propagation to prevent immediate dismissal
            e.stopPropagation();
            
            // Show dismissal dialog
            this.showDismissalDialog();
        };
        
        settingsBtn.addEventListener('click', clickHandler, { once: true });
        
        // Start pulse animation
        this.startPulseAnimation();
        
    }
    
    removeHighlight() {
        if (this.highlightBadge && this.highlightBadge.parentNode) {
            this.highlightBadge.remove();
            this.highlightBadge = null;
        }
        
        if (this.pulseInterval) {
            clearInterval(this.pulseInterval);
            this.pulseInterval = null;
        }
    }
    
    startPulseAnimation() {
        // Add continuous pulse effect
        if (this.highlightBadge) {
            this.highlightBadge.classList.add('pulse');
        }
    }
    
    showDismissalDialog() {
        // Remove the highlight first
        this.removeHighlight();
        
        // Create dismissal dialog
        const dialog = document.createElement('div');
        dialog.className = 'update-dismissal-dialog';
        dialog.innerHTML = `
            <div class="update-dismissal-content">
                <div class="update-dismissal-header">
                    <h3>Update Available!</h3>
                    <button class="update-dismissal-close" id="update-dialog-close">×</button>
                </div>
                <div class="update-dismissal-body">
                    <p>A new version of CodeAgentSwarm is available. Would you like to check for updates now?</p>
                    <div class="update-dismissal-options">
                        <label class="update-dismissal-checkbox">
                            <input type="checkbox" id="dont-show-today">
                            <span>Don't remind me for 24 hours</span>
                        </label>
                    </div>
                </div>
                <div class="update-dismissal-footer">
                    <button class="btn btn-secondary" id="update-dialog-cancel">Later</button>
                    <button class="btn btn-primary" id="update-dialog-settings">Go to Settings</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // Add dialog styles if not already added
        this.addDialogStyles();
        
        // Show dialog with animation
        requestAnimationFrame(() => {
            dialog.classList.add('show');
        });
        
        // Handle dialog actions
        const closeBtn = document.getElementById('update-dialog-close');
        const cancelBtn = document.getElementById('update-dialog-cancel');
        const settingsBtn = document.getElementById('update-dialog-settings');
        const dontShowCheckbox = document.getElementById('dont-show-today');
        
        const closeDialog = () => {
            // Check if "don't show today" is checked
            if (dontShowCheckbox && dontShowCheckbox.checked) {
                localStorage.setItem(this.STORAGE_KEYS.DONT_SHOW_TODAY, Date.now().toString());
            }
            
            // Remove dialog with animation
            dialog.classList.remove('show');
            setTimeout(() => {
                if (dialog.parentNode) {
                    dialog.remove();
                }
            }, 300);
        };
        
        const goToSettings = () => {
            closeDialog();
            
            // Open settings modal
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal) {
                settingsModal.style.display = 'flex';
                
                // Switch to Updates tab
                const updateTab = document.querySelector('[data-tab="updates"]');
                const updatePanel = document.querySelector('[data-panel="updates"]');
                
                if (updateTab && updatePanel) {
                    // Remove active class from all tabs and panels
                    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
                    
                    // Activate updates tab
                    updateTab.classList.add('active');
                    updatePanel.classList.add('active');
                }
            }
        };
        
        closeBtn.addEventListener('click', closeDialog);
        cancelBtn.addEventListener('click', closeDialog);
        settingsBtn.addEventListener('click', goToSettings);
        
        // Close on escape key
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                closeDialog();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }
    
    addStyles() {
        if (document.getElementById('update-notification-styles')) {
            return;
        }
        
        const styles = document.createElement('style');
        styles.id = 'update-notification-styles';
        styles.textContent = `
            .update-notification-badge {
                position: absolute;
                top: -8px;
                right: -8px;
                display: flex;
                align-items: center;
                gap: 4px;
                background: linear-gradient(135deg, #ff6b6b 0%, #ff4444 100%);
                color: white;
                font-size: 10px;
                font-weight: bold;
                padding: 3px 8px;
                border-radius: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                box-shadow: 0 2px 8px rgba(255, 68, 68, 0.4);
                z-index: 9999;
                pointer-events: none;
            }
            
            .update-notification-badge.pulse {
                animation: update-badge-pulse 2s infinite;
            }
            
            .update-badge-dot {
                width: 6px;
                height: 6px;
                background: white;
                border-radius: 50%;
                animation: update-dot-blink 1.5s infinite;
            }
            
            .update-badge-text {
                line-height: 1;
            }
            
            @keyframes update-badge-pulse {
                0% {
                    transform: scale(1);
                    box-shadow: 0 2px 8px rgba(255, 68, 68, 0.4);
                }
                50% {
                    transform: scale(1.1);
                    box-shadow: 0 4px 12px rgba(255, 68, 68, 0.6);
                }
                100% {
                    transform: scale(1);
                    box-shadow: 0 2px 8px rgba(255, 68, 68, 0.4);
                }
            }
            
            @keyframes update-dot-blink {
                0%, 100% {
                    opacity: 1;
                }
                50% {
                    opacity: 0.3;
                }
            }
        `;
        document.head.appendChild(styles);
    }
    
    addDialogStyles() {
        if (document.getElementById('update-dialog-styles')) {
            return;
        }
        
        const styles = document.createElement('style');
        styles.id = 'update-dialog-styles';
        styles.textContent = `
            .update-dismissal-dialog {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            
            .update-dismissal-dialog.show {
                opacity: 1;
            }
            
            .update-dismissal-content {
                background: var(--bg-primary, #2a2a2a);
                border: 1px solid var(--border-color, #3a3a3a);
                border-radius: 12px;
                padding: 0;
                max-width: 450px;
                width: 90%;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                transform: scale(0.9);
                transition: transform 0.3s ease;
            }
            
            .update-dismissal-dialog.show .update-dismissal-content {
                transform: scale(1);
            }
            
            .update-dismissal-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 20px;
                border-bottom: 1px solid var(--border-color, #3a3a3a);
            }
            
            .update-dismissal-header h3 {
                margin: 0;
                color: var(--text-primary, #fff);
                font-size: 18px;
                font-weight: 600;
            }
            
            .update-dismissal-close {
                background: none;
                border: none;
                color: var(--text-secondary, #999);
                font-size: 24px;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: all 0.2s;
            }
            
            .update-dismissal-close:hover {
                background: var(--bg-hover, #3a3a3a);
                color: var(--text-primary, #fff);
            }
            
            .update-dismissal-body {
                padding: 20px;
            }
            
            .update-dismissal-body p {
                margin: 0 0 16px 0;
                color: var(--text-secondary, #ccc);
                line-height: 1.5;
            }
            
            .update-dismissal-options {
                margin-top: 16px;
            }
            
            .update-dismissal-checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                color: var(--text-secondary, #ccc);
                font-size: 14px;
            }
            
            .update-dismissal-checkbox input[type="checkbox"] {
                width: 16px;
                height: 16px;
                cursor: pointer;
            }
            
            .update-dismissal-footer {
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                padding: 20px;
                border-top: 1px solid var(--border-color, #3a3a3a);
            }
        `;
        document.head.appendChild(styles);
    }
    
    // Method to permanently dismiss updates for a specific version
    dismissVersion(version) {
        localStorage.setItem(this.STORAGE_KEYS.DISMISSED_VERSION, version);
        this.removeHighlight();
    }
    
    // Method to reset all dismissals (for testing)
    resetDismissals() {
        Object.values(this.STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
        });
    }
    
    // Clean up on destroy
    destroy() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        
        this.removeHighlight();
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UpdateNotificationManager;
}
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
        
        // Start pulse animation - DISABLED to remove vibration effect
        // this.startPulseAnimation();
        
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
                <div class="update-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2L2 7V12C2 16.5 4.23 20.68 7.62 21.47L12 22L16.38 21.47C19.77 20.68 22 16.5 22 12V7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M12 6V12M12 16H12.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>
                <h3>¡Nueva actualización disponible!</h3>
                <p>Una nueva versión de CodeAgentSwarm está lista para instalar.</p>
                <div class="update-dismissal-buttons">
                    <button class="update-btn update-btn-secondary" id="update-dialog-later">Recordar más tarde</button>
                    <button class="update-btn update-btn-primary" id="update-dialog-update">
                        <span>Ver actualización</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
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
        const laterBtn = document.getElementById('update-dialog-later');
        const updateBtn = document.getElementById('update-dialog-update');
        
        const closeDialog = () => {
            // Save dismissal time for 24 hours
            localStorage.setItem(this.STORAGE_KEYS.DONT_SHOW_TODAY, Date.now().toString());
            
            // Remove dialog with animation
            dialog.classList.remove('show');
            setTimeout(() => {
                if (dialog.parentNode) {
                    dialog.remove();
                }
            }, 300);
        };
        
        const goToUpdate = () => {
            // Remove dialog first
            dialog.classList.remove('show');
            setTimeout(() => {
                if (dialog.parentNode) {
                    dialog.remove();
                }
            }, 300);
            
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
        
        laterBtn.addEventListener('click', closeDialog);
        updateBtn.addEventListener('click', goToUpdate);
        
        // Close on escape key or click outside
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                closeDialog();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
        
        // Click outside to close
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                closeDialog();
            }
        });
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
                bottom: -8px;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                align-items: center;
                gap: 4px;
                background: linear-gradient(135deg, rgba(34, 197, 94, 0.95) 0%, rgba(16, 185, 129, 0.95) 100%);
                color: white;
                font-size: 10px;
                font-weight: bold;
                padding: 4px 10px;
                border-radius: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                box-shadow: 0 2px 8px rgba(34, 197, 94, 0.4), 0 0 12px rgba(16, 185, 129, 0.2);
                border: 1px solid rgba(134, 239, 172, 0.3);
                z-index: 9999;
                pointer-events: none;
            }
            
            .update-notification-badge.pulse {
                animation: update-badge-pulse 2s infinite;
            }
            
            .update-badge-text {
                line-height: 1;
            }
            
            @keyframes update-badge-pulse {
                0% {
                    transform: translateX(-50%) scale(1);
                    box-shadow: 0 2px 8px rgba(34, 197, 94, 0.4), 0 0 12px rgba(16, 185, 129, 0.2);
                }
                50% {
                    transform: translateX(-50%) scale(1.05);
                    box-shadow: 0 4px 12px rgba(34, 197, 94, 0.6), 0 0 20px rgba(16, 185, 129, 0.3);
                }
                100% {
                    transform: translateX(-50%) scale(1);
                    box-shadow: 0 2px 8px rgba(34, 197, 94, 0.4), 0 0 12px rgba(16, 185, 129, 0.2);
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
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(10px);
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
                background: linear-gradient(135deg, rgba(127, 90, 240, 0.1) 0%, rgba(118, 75, 162, 0.05) 100%);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(127, 90, 240, 0.2);
                border-radius: 20px;
                padding: 2.5rem;
                max-width: 420px;
                width: 90%;
                box-shadow: 
                    0 20px 60px rgba(0, 0, 0, 0.5),
                    0 0 100px rgba(127, 90, 240, 0.1),
                    inset 0 1px 0 rgba(255, 255, 255, 0.1);
                transform: translateY(20px) scale(0.95);
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                text-align: center;
            }
            
            .update-dismissal-dialog.show .update-dismissal-content {
                transform: translateY(0) scale(1);
            }
            
            .update-icon {
                display: flex;
                justify-content: center;
                margin-bottom: 1.5rem;
            }
            
            .update-icon svg {
                width: 56px;
                height: 56px;
                color: #7f5af0;
                filter: drop-shadow(0 0 20px rgba(127, 90, 240, 0.5));
                animation: update-icon-pulse 2s ease-in-out infinite;
            }
            
            @keyframes update-icon-pulse {
                0%, 100% {
                    transform: scale(1);
                }
                50% {
                    transform: scale(1.05);
                }
            }
            
            .update-dismissal-content h3 {
                margin: 0 0 1rem 0;
                color: #ffffff;
                font-size: 1.5rem;
                font-weight: 600;
                background: linear-gradient(135deg, #ffffff 0%, #e0d4ff 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }
            
            .update-dismissal-content p {
                margin: 0 0 2rem 0;
                color: rgba(255, 255, 255, 0.7);
                font-size: 0.95rem;
                line-height: 1.5;
            }
            
            .update-dismissal-buttons {
                display: flex;
                gap: 1rem;
                justify-content: center;
            }
            
            .update-btn {
                padding: 0.75rem 1.5rem;
                border-radius: 12px;
                border: none;
                font-size: 0.95rem;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                gap: 0.5rem;
                position: relative;
                overflow: hidden;
            }
            
            .update-btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, transparent 100%);
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            
            .update-btn:hover::before {
                opacity: 1;
            }
            
            .update-btn-secondary {
                background: rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.8);
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            
            .update-btn-secondary:hover {
                background: rgba(255, 255, 255, 0.15);
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
            }
            
            .update-btn-primary {
                background: linear-gradient(135deg, #7f5af0 0%, #6943d0 100%);
                color: white;
                box-shadow: 0 4px 15px rgba(127, 90, 240, 0.3);
            }
            
            .update-btn-primary:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(127, 90, 240, 0.4);
            }
            
            .update-btn-primary svg {
                width: 16px;
                height: 16px;
                transition: transform 0.2s ease;
            }
            
            .update-btn-primary:hover svg {
                transform: translateX(3px);
            }
            
            @media (max-width: 480px) {
                .update-dismissal-content {
                    padding: 2rem;
                }
                
                .update-dismissal-buttons {
                    flex-direction: column;
                    width: 100%;
                }
                
                .update-btn {
                    width: 100%;
                    justify-content: center;
                }
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
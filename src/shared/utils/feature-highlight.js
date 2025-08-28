/**
 * FeatureHighlight - Reusable component for highlighting new features
 * Shows a "New!" badge with arrow pointing to features, only once per release
 */
class FeatureHighlight {
    constructor(storage = null) {
        this.currentHighlight = null;
        this.dismissTimeout = null;
        this.container = null;
        this.appVersion = this.getAppVersion();
        // Allow dependency injection for testing
        this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        this.init();
    }

    init() {
        // Create container if it doesn't exist
        if (!document.getElementById('feature-highlight-container')) {
            this.container = document.createElement('div');
            this.container.id = 'feature-highlight-container';
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById('feature-highlight-container');
        }
    }

    getAppVersion() {
        // Get version from window.appVersion (set by renderer.js from ipcRenderer)
        if (typeof window !== 'undefined' && window.appVersion) {
            return window.appVersion;
        }
        
        // If version is not available, return null to prevent showing highlights
        console.warn('App version not available yet');
        return null;
    }

    /**
     * Show a feature highlight
     * @param {Object} options - Configuration options
     * @param {string} options.targetSelector - CSS selector for target element
     * @param {string} options.featureName - Unique feature identifier
     * @param {string} options.message - Description text
     * @param {string} options.position - Arrow position: 'top', 'bottom', 'left', 'right'
     * @param {number} options.duration - Auto-dismiss time in ms (default: 7000)
     * @param {boolean} options.showOnce - Only show once per release (default: true)
     * @param {string} options.type - 'badge' for simple badge, 'highlight' for full highlight (default: 'highlight')
     * @param {Array} options.versions - Array of versions to show the highlight/badge in
     */
    show(options) {
        const {
            targetSelector,
            featureName,
            message = 'New!',
            position = 'bottom',
            duration = 7000,
            showOnce = true,
            type = 'highlight',
            versions = []
        } = options;

        // Don't show if version is not available
        if (!this.appVersion) {
            console.warn('Cannot show feature highlight - app version not available');
            return;
        }

        // Check if we're in the right version range (if versions array is provided)
        if (versions.length > 0 && !versions.includes(this.appVersion)) {

            return;
        }

        // Check if feature has been shown for this version
        if (showOnce && this.hasBeenShown(featureName)) {

            return;
        }

        // Find target element
        const targetElement = document.querySelector(targetSelector);
        if (!targetElement) {
            console.warn(`Target element not found: ${targetSelector}`);
            // Try again in a moment if element not found yet (for badges)
            if (type === 'badge') {
                setTimeout(() => this.show(options), 100);
            }
            return;
        }

        // For badge type, create and attach directly to element
        if (type === 'badge') {
            this.showBadge(targetElement, featureName, position, showOnce);
            return;
        }

        // For highlight type, use existing highlight system
        // Dismiss any existing highlight
        this.dismiss();

        // Create highlight element
        const highlight = this.createHighlightElement(message, position);
        this.currentHighlight = {
            element: highlight,
            featureName,
            targetElement,
            position
        };

        // Position the highlight
        this.positionHighlight(targetElement, highlight, position);

        // Add to container
        this.container.appendChild(highlight);

        // Trigger animation
        requestAnimationFrame(() => {
            highlight.classList.add('show');
        });

        // Mark as shown
        if (showOnce) {
            this.markAsShown(featureName);
        }

        // Setup auto-dismiss
        if (duration > 0) {
            this.dismissTimeout = setTimeout(() => {
                this.dismiss();
            }, duration);
        }

        // Setup click handlers
        this.setupEventHandlers(targetElement);
    }

    showBadge(targetElement, featureName, position, showOnce) {
        // Check if badge already exists
        if (targetElement.querySelector('.feature-badge')) {
            return;
        }

        // Make target element position relative if not already
        const computedStyle = window.getComputedStyle(targetElement);
        if (computedStyle.position === 'static') {
            targetElement.style.position = 'relative';
        }

        // Create badge element
        const badge = document.createElement('span');
        badge.className = 'feature-badge';
        badge.textContent = 'NEW!';
        
        // Set position based on parameter
        if (position === 'bottom') {
            badge.style.bottom = '-12px';  // Increased from -8px to ensure visibility
            badge.style.left = '50%';
            badge.style.transform = 'translateX(-50%)';
            badge.style.zIndex = '10000';  // Ensure it's on top
        } else if (position === 'top') {
            badge.style.top = '-8px';
            badge.style.right = '-8px';
            badge.style.zIndex = '10000';  // Ensure it's on top
        }

        // Add styles if not already added
        if (!document.getElementById('feature-badge-styles')) {
            const styles = document.createElement('style');
            styles.id = 'feature-badge-styles';
            styles.textContent = `
                .feature-badge {
                    position: absolute;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    font-size: 9px;
                    font-weight: bold;
                    padding: 2px 6px;
                    border-radius: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    animation: feature-badge-pulse 2s infinite;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                    z-index: 9999;
                }
                
                @keyframes feature-badge-pulse {
                    0% {
                        transform: ${position === 'bottom' ? 'translateX(-50%) scale(1)' : 'scale(1)'};
                        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                    }
                    50% {
                        transform: ${position === 'bottom' ? 'translateX(-50%) scale(1.05)' : 'scale(1.05)'};
                        box-shadow: 0 3px 6px rgba(102, 126, 234, 0.4);
                    }
                    100% {
                        transform: ${position === 'bottom' ? 'translateX(-50%) scale(1)' : 'scale(1)'};
                        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                    }
                }
                
                @keyframes feature-badge-fadeout {
                    from {
                        opacity: 1;
                    }
                    to {
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(styles);
        }

        // Add badge to target element
        targetElement.appendChild(badge);

        // Setup click handler to remove badge
        const clickHandler = () => {
            badge.style.animation = 'feature-badge-fadeout 0.3s ease-out';
            setTimeout(() => {
                if (badge.parentNode) {
                    badge.remove();
                }
            }, 300);
            
            // Mark as shown
            if (showOnce) {
                this.markAsShown(featureName);
            }
            
            targetElement.removeEventListener('click', clickHandler);
        };
        
        targetElement.addEventListener('click', clickHandler, { once: true });

    }

    createHighlightElement(message, position) {
        const highlight = document.createElement('div');
        highlight.className = `feature-highlight feature-highlight-${position}`;
        
        // Create arrow
        const arrow = document.createElement('div');
        arrow.className = 'feature-highlight-arrow';
        arrow.innerHTML = this.getArrowSVG(position);
        
        // Create badge
        const badge = document.createElement('div');
        badge.className = 'feature-highlight-badge';
        badge.innerHTML = `
            <span class="feature-highlight-new">NEW!</span>
            <span class="feature-highlight-message">${message}</span>
        `;

        // Append based on position
        if (position === 'top' || position === 'left') {
            highlight.appendChild(badge);
            highlight.appendChild(arrow);
        } else {
            highlight.appendChild(arrow);
            highlight.appendChild(badge);
        }

        // Add dismiss button
        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'feature-highlight-dismiss';
        dismissBtn.innerHTML = '✕';
        dismissBtn.onclick = () => this.dismiss();
        badge.appendChild(dismissBtn);

        return highlight;
    }

    getArrowSVG(position) {
        const rotations = {
            top: 180,
            bottom: 0,
            left: 90,
            right: -90
        };
        const rotation = rotations[position] || 0;
        
        return `
            <svg width="30" height="30" viewBox="0 0 30 30" style="transform: rotate(${rotation}deg);">
                <path d="M15 8 L22 18 L17 16 L15 20 L13 16 L8 18 Z" 
                      fill="currentColor" 
                      stroke="none"
                      opacity="0.95"/>
            </svg>
        `;
    }

    positionHighlight(targetElement, highlight, position) {
        const rect = targetElement.getBoundingClientRect();
        
        // Estimated dimensions for the highlight badge
        const estimatedWidth = 280;
        const estimatedHeight = 90;
        const arrowSize = 30;
        const gap = 5; // Gap between arrow and badge
        
        let top, left;

        switch (position) {
            case 'top':
                // Center horizontally, position above with arrow pointing down
                top = rect.top - estimatedHeight - gap;
                left = rect.left + (rect.width / 2) - (estimatedWidth / 2);
                break;
            case 'bottom':
                // Center horizontally, position below with arrow pointing up
                // The arrow is on top of the badge, so account for that
                top = rect.bottom + gap;
                left = rect.left + (rect.width / 2) - (estimatedWidth / 2);
                break;
            case 'left':
                // Center vertically, position to the left with arrow pointing right
                top = rect.top + (rect.height / 2) - (estimatedHeight / 2);
                left = rect.left - estimatedWidth - gap;
                break;
            case 'right':
                // Center vertically, position to the right with arrow pointing left
                top = rect.top + (rect.height / 2) - (estimatedHeight / 2);
                left = rect.right + gap;
                break;
            default:
                top = rect.bottom + gap;
                left = rect.left + (rect.width / 2) - (estimatedWidth / 2);
        }

        // Ensure highlight stays within viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        if (left < 10) left = 10;
        if (left + estimatedWidth > viewportWidth - 10) {
            left = viewportWidth - estimatedWidth - 10;
        }
        if (top < 10) top = 10;
        if (top + estimatedHeight > viewportHeight - 10) {
            top = viewportHeight - estimatedHeight - 10;
        }

        highlight.style.top = `${top}px`;
        highlight.style.left = `${left}px`;
    }

    setupEventHandlers(targetElement) {
        // Dismiss on target click
        const clickHandler = () => {
            this.dismiss();
            targetElement.removeEventListener('click', clickHandler);
        };
        targetElement.addEventListener('click', clickHandler);

        // Store handler for cleanup
        if (this.currentHighlight) {
            this.currentHighlight.clickHandler = clickHandler;
        }

        // Dismiss on escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.dismiss();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    dismiss() {
        if (!this.currentHighlight) return;

        const { element, targetElement, clickHandler } = this.currentHighlight;
        
        // Remove event listeners
        if (targetElement && clickHandler) {
            targetElement.removeEventListener('click', clickHandler);
        }

        // Fade out animation
        element.classList.remove('show');
        element.classList.add('hide');

        // Remove element after animation
        setTimeout(() => {
            if (element && element.parentNode) {
                element.parentNode.removeChild(element);
            }
        }, 300);

        // Clear timeout
        if (this.dismissTimeout) {
            clearTimeout(this.dismissTimeout);
            this.dismissTimeout = null;
        }

        this.currentHighlight = null;
    }

    hasBeenShown(featureName) {
        // Always use simple key without version
        // Badges apply to multiple versions, so version in key doesn't make sense
        if (!this.storage) return false;
        const key = this.getStorageKey(featureName);
        return this.storage.getItem(key) === 'true';
    }

    markAsShown(featureName) {
        // Always use simple key without version
        if (!this.storage) return;
        const key = this.getStorageKey(featureName);
        this.storage.setItem(key, 'true');
    }

    getStorageKey(featureName) {
        // Standardized format: featureHighlight_[featureName]
        // No version number since badges apply to multiple versions
        return `featureHighlight_${featureName}`;
    }

    reset(featureName) {
        // Remove the standardized key
        const key = this.getStorageKey(featureName);
        if (this.storage) this.storage.removeItem(key);
    }

    resetAll() {
        // Remove all feature highlight keys for current version
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('featureHighlight_')) {
                if (this.storage) this.storage.removeItem(key);
            }
        });
    }

    // Update position if window resizes
    updatePosition() {
        if (!this.currentHighlight) return;
        
        const { targetElement, element, position } = this.currentHighlight;
        this.positionHighlight(targetElement, element, position);
    }

    // Force show for development/testing (ignores version check)
    forceShow(options) {
        const originalShowOnce = options.showOnce;
        options.showOnce = false;
        this.show(options);
        options.showOnce = originalShowOnce;
    }

    // Dev helper to test highlights
    testHighlight(featureName) {
        console.log(`[FeatureHighlight] Testing feature: ${featureName}`);
        // Reset the feature first
        this.reset(featureName);

        // Show the highlight based on feature name
        if (featureName === 'tabbedMode') {
            this.show({
                targetSelector: '#tabbed-mode-btn',
                featureName: 'tabbedMode',
                message: 'Toggle between grid and tabbed layouts',
                position: 'bottom',
                duration: 30000 // 30 seconds
            });
        }
    }
}

// Auto-update position on window resize
window.addEventListener('resize', () => {
    if (window.featureHighlight) {
        window.featureHighlight.updatePosition();
    }
});

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FeatureHighlight;
}
/**
 * FeatureHighlight - Reusable component for highlighting new features
 * Shows a "New!" badge with arrow pointing to features, only once per release
 */
class FeatureHighlight {
    constructor() {
        this.currentHighlight = null;
        this.dismissTimeout = null;
        this.container = null;
        this.appVersion = this.getAppVersion();
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
     */
    show(options) {
        const {
            targetSelector,
            featureName,
            message = 'New!',
            position = 'bottom',
            duration = 7000,
            showOnce = true
        } = options;

        // Don't show if version is not available
        if (!this.appVersion) {
            console.warn('Cannot show feature highlight - app version not available');
            return;
        }

        // Check if feature has been shown for this version
        if (showOnce && this.hasBeenShown(featureName)) {
            console.log(`Feature highlight '${featureName}' already shown for version ${this.appVersion}`);
            return;
        }

        // Find target element
        const targetElement = document.querySelector(targetSelector);
        if (!targetElement) {
            console.warn(`Target element not found: ${targetSelector}`);
            return;
        }

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
        // For cross-version features (like tabbedMode), check without version
        if (featureName === 'tabbedMode') {
            const crossVersionKey = `featureHighlight_${featureName}_shown`;
            return localStorage.getItem(crossVersionKey) === 'true';
        }
        // For version-specific features, use version in key
        const key = this.getStorageKey(featureName);
        return localStorage.getItem(key) === 'true';
    }

    markAsShown(featureName) {
        // For cross-version features (like tabbedMode), mark without version
        if (featureName === 'tabbedMode') {
            const crossVersionKey = `featureHighlight_${featureName}_shown`;
            localStorage.setItem(crossVersionKey, 'true');
            return;
        }
        // For version-specific features, use version in key
        const key = this.getStorageKey(featureName);
        localStorage.setItem(key, 'true');
    }

    getStorageKey(featureName) {
        return `featureHighlight_${featureName}_${this.appVersion}`;
    }

    reset(featureName) {
        // For cross-version features (like tabbedMode), reset the cross-version key
        if (featureName === 'tabbedMode') {
            const crossVersionKey = `featureHighlight_${featureName}_shown`;
            localStorage.removeItem(crossVersionKey);
            return;
        }
        // For version-specific features, use version in key
        const key = this.getStorageKey(featureName);
        localStorage.removeItem(key);
    }

    resetAll() {
        // Remove all feature highlight keys for current version
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('featureHighlight_')) {
                localStorage.removeItem(key);
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
        // Reset the feature first
        this.reset(featureName);
        console.log(`[FeatureHighlight] Testing feature: ${featureName}`);
        
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
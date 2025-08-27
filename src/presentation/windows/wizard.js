// Wizard Logic
let currentScreen = 1;
const totalScreens = 5;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    updateNavigation();
    updateProgress();
    
    // Preload videos for smooth playback
    preloadVideos();
    
    // Add keyboard navigation
    document.addEventListener('keydown', handleKeyPress);
    
    // Add fullscreen button listeners
    setupFullscreenButtons();
});

// Navigation functions
function nextScreen() {
    if (currentScreen < totalScreens) {
        // Hide current screen
        document.getElementById(`screen${currentScreen}`).classList.remove('active');
        
        // Mark current dot as completed
        document.querySelector(`.dot[data-screen="${currentScreen}"]`).classList.add('completed');
        
        currentScreen++;
        
        // Show next screen
        document.getElementById(`screen${currentScreen}`).classList.add('active');
        
        updateNavigation();
        updateProgress();
        
        // Check for fullscreen buttons on screen 2
        if (currentScreen === 2) {
            setTimeout(() => {
                const buttons = document.querySelectorAll('.fullscreen-btn');

            }, 100);
        }
        
        // Auto-play video if present
        const video = document.querySelector(`#screen${currentScreen} video`);
        if (video) {
            setTimeout(() => {
                video.play();
            }, 300);
        }
    }
}

function previousScreen() {
    if (currentScreen > 1) {
        document.getElementById(`screen${currentScreen}`).classList.remove('active');
        
        // Remove completed status from dots that come after the screen we're going to
        for (let i = currentScreen; i <= totalScreens; i++) {
            document.querySelector(`.dot[data-screen="${i}"]`).classList.remove('completed');
        }
        
        currentScreen--;
        document.getElementById(`screen${currentScreen}`).classList.add('active');
        
        updateNavigation();
        updateProgress();
    }
}

function updateNavigation() {
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    
    // Update button states
    prevButton.style.display = currentScreen === 1 ? 'none' : 'block';
    
    if (currentScreen === totalScreens) {
        nextButton.style.display = 'none';
    } else {
        nextButton.style.display = 'block';
        nextButton.textContent = currentScreen === totalScreens - 1 ? 'Get Started →' : 'Next →';
    }
    
    // Update dots
    document.querySelectorAll('.dot').forEach(dot => {
        const screen = parseInt(dot.dataset.screen);
        dot.classList.toggle('active', screen === currentScreen);
    });
}

function updateProgress() {
    const progressFill = document.getElementById('progressFill');
    const progress = (currentScreen / totalScreens) * 100;
    progressFill.style.width = `${progress}%`;
}

// Video handling
function playVideo(videoId) {
    const video = document.getElementById(videoId);
    const overlay = video.nextElementSibling;
    
    if (video.paused) {
        video.play();
        overlay.classList.add('playing');
    } else {
        video.pause();
        overlay.classList.remove('playing');
    }
}

function preloadVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        video.load();
    });
}

// Keyboard navigation
function handleKeyPress(e) {
    switch(e.key) {
        case 'ArrowRight':
            if (currentScreen < totalScreens) nextScreen();
            break;
        case 'ArrowLeft':
            if (currentScreen > 1) previousScreen();
            break;
        case 'Enter':
            if (currentScreen === totalScreens) finishWizard();
            else nextScreen();
            break;
        case 'Escape':
            if (confirm('Skip the setup wizard?')) {
                finishWizard();
            }
            break;
    }
}

// Dot navigation
document.querySelectorAll('.dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
        const targetScreen = parseInt(e.target.dataset.screen);
        if (targetScreen < currentScreen || e.target.classList.contains('completed')) {
            document.getElementById(`screen${currentScreen}`).classList.remove('active');
            
            // Update completed status for all dots
            document.querySelectorAll('.dot').forEach(d => {
                const screen = parseInt(d.dataset.screen);
                if (screen < targetScreen) {
                    d.classList.add('completed');
                } else if (screen >= targetScreen) {
                    d.classList.remove('completed');
                }
            });
            
            currentScreen = targetScreen;
            document.getElementById(`screen${currentScreen}`).classList.add('active');
            updateNavigation();
            updateProgress();
        }
    });
});

// Finish wizard
function finishWizard() {
    // Collect settings
    const settings = {
        defaultDirectory: document.getElementById('defaultDirectory').checked,
        autoUpdates: document.getElementById('autoUpdates').checked,
        analytics: document.getElementById('analytics').checked,
        wizardCompleted: true
    };
    
    // Save settings to electron store
    if (window.electronAPI) {
        window.electronAPI.saveWizardSettings(settings);
    }
    
    // Animate out
    const container = document.querySelector('.wizard-container');
    container.style.opacity = '0';
    container.style.transform = 'scale(0.95)';
    
    setTimeout(() => {
        // Close wizard window or redirect to main app
        if (window.electronAPI) {
            window.electronAPI.closeWizard();
        }
    }, 300);
}

// Demo animations for GIFs
function animateFeatures() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animated');
            }
        });
    }, { threshold: 0.1 });
    
    document.querySelectorAll('.feature-card, .feature-pill').forEach(el => {
        observer.observe(el);
    });
}

animateFeatures();

// Add smooth scrolling for long content
document.querySelectorAll('.wizard-screen').forEach(screen => {
    screen.addEventListener('wheel', (e) => {
        if (screen.scrollHeight > screen.clientHeight) {
            e.stopPropagation();
        }
    });
});

// Video error handling
document.querySelectorAll('video').forEach(video => {
    video.addEventListener('error', () => {
        // Fallback to GIF if video fails
        const img = video.querySelector('img');
        if (img) {
            video.style.display = 'none';
            img.style.display = 'block';
        }
    });
});

// Setup hover video playback for power cards
document.querySelectorAll('.power-card').forEach(card => {
    const video = card.querySelector('.hover-video');
    const progressBar = card.querySelector('.video-progress-fill');
    const controlsBar = card.querySelector('.video-controls-fill');
    
    if (video) {
        // Update progress bars
        let animationFrame;
        const updateProgress = () => {
            if (video.duration) {
                const progress = (video.currentTime / video.duration) * 100;
                if (progressBar) progressBar.style.width = `${progress}%`;
                if (controlsBar) controlsBar.style.width = `${progress}%`;
                
                // Continue updating while playing
                if (!video.paused) {
                    animationFrame = requestAnimationFrame(updateProgress);
                }
            }
        };
        
        video.addEventListener('play', () => {
            animationFrame = requestAnimationFrame(updateProgress);
        });
        
        video.addEventListener('pause', () => {
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
            }
        });
        
        card.addEventListener('mouseenter', () => {
            video.play().catch(err => {});
        });
        
        card.addEventListener('mouseleave', () => {
            video.pause();
            video.currentTime = 0; // Reset to beginning
            if (progressBar) progressBar.style.width = '0%';
            if (controlsBar) controlsBar.style.width = '0%';
        });
    }
});

// Setup fullscreen button listeners
function setupFullscreenButtons() {

    // Try a different approach - add the function to window object
    window.openFullscreenVideo = openFullscreenVideo;
    
    // Use event delegation on body with capturing
    document.body.addEventListener('click', (e) => {
        // Check if clicked element is fullscreen button or its child
        const button = e.target.closest('.fullscreen-btn');
        if (button) {

            e.preventDefault();
            e.stopPropagation();
            const videoSrc = button.getAttribute('data-video');

            if (videoSrc) {
                openFullscreenVideo(videoSrc);
            }
            return false;
        }
    }, true); // Use capture phase
    
    // Also try direct binding when buttons appear
    const observer = new MutationObserver((mutations) => {
        const buttons = document.querySelectorAll('.fullscreen-btn:not([data-listener])');
        buttons.forEach(btn => {
            btn.setAttribute('data-listener', 'true');
            btn.addEventListener('click', (e) => {

                e.preventDefault();
                e.stopPropagation();
                const videoSrc = btn.getAttribute('data-video');
                if (videoSrc) {
                    openFullscreenVideo(videoSrc);
                }
            });
        });
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
}

// Fullscreen video functionality
function openFullscreenVideo(videoSrc) {

    // Create fullscreen container
    const fullscreenContainer = document.createElement('div');
    fullscreenContainer.className = 'fullscreen-video-container';
    fullscreenContainer.innerHTML = `
        <video autoplay loop muted class="fullscreen-video">
            <source src="${videoSrc}" type="video/mp4">
        </video>
        <button class="close-fullscreen">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
    `;
    
    document.body.appendChild(fullscreenContainer);
    
    // Add click handler for close button
    const closeBtn = fullscreenContainer.querySelector('.close-fullscreen');
    closeBtn.addEventListener('click', () => {
        closeFullscreenVideo();
    });
    
    // Add click handler for container (click outside video to close)
    fullscreenContainer.addEventListener('click', (e) => {
        if (e.target === fullscreenContainer) {
            closeFullscreenVideo();
        }
    });
    
    // Fade in
    setTimeout(() => {
        fullscreenContainer.classList.add('active');
    }, 10);
    
    // Handle ESC key
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            closeFullscreenVideo();
        }
    };
    document.addEventListener('keydown', handleEsc);
    
    // Store handler for removal
    fullscreenContainer._escHandler = handleEsc;
}

function closeFullscreenVideo() {
    const container = document.querySelector('.fullscreen-video-container');
    if (container) {
        // Remove ESC handler
        if (container._escHandler) {
            document.removeEventListener('keydown', container._escHandler);
        }
        
        // Fade out
        container.classList.remove('active');
        
        // Remove after animation
        setTimeout(() => {
            container.remove();
        }, 300);
    }
}

// Create placeholder assets notice

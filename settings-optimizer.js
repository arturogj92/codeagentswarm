// Settings Modal Performance Optimizations

class SettingsOptimizer {
    constructor() {
        this.changelogCache = new Map();
        this.debounceTimers = new Map();
        this.versionHistoryPage = 0;
        this.versionHistoryPageSize = 10;
        this.isLoadingHistory = false;
    }

    // Debounce function for input changes
    debounce(func, wait, key) {
        return (...args) => {
            if (this.debounceTimers.has(key)) {
                clearTimeout(this.debounceTimers.get(key));
            }
            const timeout = setTimeout(() => {
                func.apply(this, args);
                this.debounceTimers.delete(key);
            }, wait);
            this.debounceTimers.set(key, timeout);
        };
    }

    // Optimized changelog formatter using template literals and caching
    formatChangelogOptimized(changelog) {
        // Check cache first
        if (this.changelogCache.has(changelog)) {
            return this.changelogCache.get(changelog);
        }

        // Clean up encoding issues in one pass
        const cleanupMap = {
            'â€™': "'",
            'â€œ': '"',
            'â€': '"',
            'â€"': '—',
            'â€"': '–',
            'â€¦': '...',
            'Â ': ' ',
            'ðŸ¤–': '🤖',
            'âœ¨': '✨',
            'ðŸ"§': '🔧',
            'ðŸš€': '🚀'
        };

        let cleanedChangelog = changelog;
        for (const [bad, good] of Object.entries(cleanupMap)) {
            cleanedChangelog = cleanedChangelog.split(bad).join(good);
        }

        // Process lines more efficiently
        const lines = cleanedChangelog.split('\n');
        const htmlParts = [];
        let currentSection = null;
        let listItems = [];

        const flushList = () => {
            if (listItems.length > 0) {
                htmlParts.push(`<ul>${listItems.join('')}</ul>`);
                listItems = [];
            }
        };

        for (const line of lines) {
            const trimmed = line.trim();
            
            if (!trimmed) {
                flushList();
                continue;
            }

            // Headers
            if (trimmed.startsWith('## ')) {
                flushList();
                currentSection = trimmed.substring(3);
                htmlParts.push(`<h3 class="changelog-section">${this.escapeHtml(currentSection)}</h3>`);
            }
            // List items
            else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                const content = trimmed.substring(2);
                const iconMatch = content.match(/^(\\[.*?\\]|🔧|⚡|🐛|✨|🚀|📦|🔄|⚠️|🎨)/);
                
                if (iconMatch) {
                    const icon = this.getIconForPrefix(iconMatch[0]);
                    const text = content.substring(iconMatch[0].length).trim();
                    listItems.push(`<li><span class="changelog-icon">${icon}</span><span>${this.formatInlineMarkdown(text)}</span></li>`);
                } else {
                    listItems.push(`<li>${this.formatInlineMarkdown(content)}</li>`);
                }
            }
            // Regular paragraphs
            else {
                flushList();
                htmlParts.push(`<p>${this.formatInlineMarkdown(trimmed)}</p>`);
            }
        }

        flushList();
        
        const result = htmlParts.join('');
        
        // Cache the result
        this.changelogCache.set(changelog, result);
        
        return result;
    }

    // Helper to escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Helper to format inline markdown
    formatInlineMarkdown(text) {
        return this.escapeHtml(text)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>');
    }

    // Helper to get icon for prefix
    getIconForPrefix(prefix) {
        const iconMap = {
            '[Added]': '✨',
            '[Fixed]': '🐛',
            '[Changed]': '🔄',
            '[Removed]': '🗑️',
            '[Security]': '🔒',
            '[Performance]': '⚡',
            '[Docs]': '📚',
            '🔧': '🔧',
            '⚡': '⚡',
            '🐛': '🐛',
            '✨': '✨',
            '🚀': '🚀',
            '📦': '📦',
            '🔄': '🔄',
            '⚠️': '⚠️',
            '🎨': '🎨'
        };
        return iconMap[prefix] || prefix;
    }

    // Optimized version history rendering with virtual scrolling
    async renderVersionHistoryOptimized(changelogs, container) {
        if (!container) return;

        // Create virtual scroll container
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'version-history-scroll';
        scrollContainer.style.height = '400px';
        scrollContainer.style.overflowY = 'auto';

        // Only render visible items
        const renderBatch = (startIndex, endIndex) => {
            const fragment = document.createDocumentFragment();
            
            for (let i = startIndex; i < endIndex && i < changelogs.length; i++) {
                const item = changelogs[i];
                const versionItem = this.createVersionHistoryItem(item, i);
                fragment.appendChild(versionItem);
            }
            
            return fragment;
        };

        // Initial render
        const initialBatch = renderBatch(0, this.versionHistoryPageSize);
        scrollContainer.appendChild(initialBatch);
        
        // Infinite scroll
        let currentEnd = this.versionHistoryPageSize;
        scrollContainer.addEventListener('scroll', () => {
            if (this.isLoadingHistory) return;
            
            const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
            if (scrollTop + clientHeight >= scrollHeight - 50 && currentEnd < changelogs.length) {
                this.isLoadingHistory = true;
                
                requestAnimationFrame(() => {
                    const nextBatch = renderBatch(currentEnd, currentEnd + this.versionHistoryPageSize);
                    scrollContainer.appendChild(nextBatch);
                    currentEnd += this.versionHistoryPageSize;
                    this.isLoadingHistory = false;
                    
                    // Re-initialize icons for new items only
                    if (window.lucide) {
                        window.lucide.createIcons();
                    }
                });
            }
        });

        container.innerHTML = '';
        container.appendChild(scrollContainer);
    }

    // Create version history item with event delegation
    createVersionHistoryItem(item, index) {
        const versionItem = document.createElement('div');
        versionItem.className = 'version-history-item';
        versionItem.dataset.index = index;
        
        const header = document.createElement('div');
        header.className = 'version-history-header';
        
        const info = document.createElement('div');
        info.className = 'version-history-info';
        
        const versionSpan = document.createElement('span');
        versionSpan.className = 'version-history-version';
        versionSpan.textContent = `Version ${item.version}`;
        
        const dateSpan = document.createElement('span');
        dateSpan.className = 'version-history-date';
        dateSpan.textContent = new Date(item.created_at).toLocaleDateString();
        
        info.appendChild(versionSpan);
        info.appendChild(dateSpan);
        
        const chevron = document.createElement('i');
        chevron.setAttribute('data-lucide', 'chevron-down');
        chevron.className = 'version-history-chevron';
        
        header.appendChild(info);
        header.appendChild(chevron);
        
        // Create content with lazy loading
        const content = document.createElement('div');
        content.className = 'version-history-content';
        content.dataset.loaded = 'false';
        
        // Use event delegation for click
        header.addEventListener('click', () => {
            const isExpanded = content.classList.contains('expanded');
            
            if (!isExpanded && content.dataset.loaded === 'false') {
                // Lazy load content
                const changelogDiv = document.createElement('div');
                changelogDiv.className = 'version-history-changelog';
                changelogDiv.innerHTML = this.formatChangelogOptimized(item.changelog);
                content.appendChild(changelogDiv);
                content.dataset.loaded = 'true';
            }
            
            content.classList.toggle('expanded');
            chevron.classList.toggle('expanded');
        });
        
        versionItem.appendChild(header);
        versionItem.appendChild(content);
        
        return versionItem;
    }

    // Optimized settings save with debouncing
    saveSettingDebounced(key, value) {
        const debouncedSave = this.debounce((k, v) => {
            // Your actual save logic here
            ipcRenderer.invoke('save-setting', k, v);
        }, 300, `setting-${key}`);
        
        debouncedSave(key, value);
    }

    // DOM update optimization using DocumentFragment
    updateDOMEfficiently(updates) {
        const fragment = document.createDocumentFragment();
        
        updates.forEach(update => {
            const element = document.createElement(update.tag);
            if (update.className) element.className = update.className;
            if (update.textContent) element.textContent = update.textContent;
            if (update.innerHTML) element.innerHTML = update.innerHTML;
            fragment.appendChild(element);
        });
        
        return fragment;
    }
}

// Export for use in renderer.js
module.exports = SettingsOptimizer;
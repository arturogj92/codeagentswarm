// Markdown Editor Functionality
class MarkdownEditor {
    constructor(textareaId, previewId, charCountId = null) {
        this.textarea = document.getElementById(textareaId);
        this.preview = document.getElementById(previewId);
        this.charCount = charCountId ? document.getElementById(charCountId) : null;
        this.container = this.textarea?.closest('.markdown-editor-container');
        this.isPreviewMode = false;
        
        if (this.textarea && this.container) {
            this.init();
        }
    }
    
    init() {
        // Get toolbar buttons
        this.toolbar = this.container.querySelector('.editor-toolbar');
        if (this.toolbar) {
            this.setupToolbar();
        }
        
        // Setup textarea events
        this.textarea.addEventListener('input', () => this.updateCharCount());
        this.textarea.addEventListener('keydown', (e) => this.handleKeyboard(e));
        
        // Initial char count
        this.updateCharCount();
    }
    
    setupToolbar() {
        const buttons = this.toolbar.querySelectorAll('.editor-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const action = btn.dataset.action;
                this.handleAction(action);
            });
        });
    }
    
    handleAction(action) {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const text = this.textarea.value;
        const selectedText = text.substring(start, end);
        
        let replacement = '';
        let cursorOffset = 0;
        
        switch(action) {
            case 'bold':
                replacement = selectedText ? `**${selectedText}**` : '**bold text**';
                cursorOffset = selectedText ? replacement.length : 2;
                break;
                
            case 'italic':
                replacement = selectedText ? `*${selectedText}*` : '*italic text*';
                cursorOffset = selectedText ? replacement.length : 1;
                break;
                
            case 'strikethrough':
                replacement = selectedText ? `~~${selectedText}~~` : '~~strikethrough~~';
                cursorOffset = selectedText ? replacement.length : 2;
                break;
                
            case 'h1':
                replacement = `# ${selectedText || 'Heading 1'}`;
                cursorOffset = 2;
                break;
                
            case 'h2':
                replacement = `## ${selectedText || 'Heading 2'}`;
                cursorOffset = 3;
                break;
                
            case 'h3':
                replacement = `### ${selectedText || 'Heading 3'}`;
                cursorOffset = 4;
                break;
                
            case 'ul':
                if (selectedText) {
                    const lines = selectedText.split('\n');
                    replacement = lines.map(line => `- ${line}`).join('\n');
                } else {
                    replacement = '- List item';
                }
                cursorOffset = 2;
                break;
                
            case 'ol':
                if (selectedText) {
                    const lines = selectedText.split('\n');
                    replacement = lines.map((line, i) => `${i + 1}. ${line}`).join('\n');
                } else {
                    replacement = '1. List item';
                }
                cursorOffset = 3;
                break;
                
            case 'checklist':
                if (selectedText) {
                    const lines = selectedText.split('\n');
                    replacement = lines.map(line => `- [ ] ${line}`).join('\n');
                } else {
                    replacement = '- [ ] Task';
                }
                cursorOffset = 6;
                break;
                
            case 'code':
                replacement = selectedText ? `\`${selectedText}\`` : '`code`';
                cursorOffset = selectedText ? replacement.length : 1;
                break;
                
            case 'codeblock':
                replacement = selectedText ? 
                    `\`\`\`\n${selectedText}\n\`\`\`` : 
                    '```\ncode block\n```';
                cursorOffset = 4;
                break;
                
            case 'quote':
                if (selectedText) {
                    const lines = selectedText.split('\n');
                    replacement = lines.map(line => `> ${line}`).join('\n');
                } else {
                    replacement = '> Quote';
                }
                cursorOffset = 2;
                break;
                
            case 'link':
                replacement = selectedText ? 
                    `[${selectedText}](url)` : 
                    '[link text](url)';
                cursorOffset = selectedText ? replacement.length - 4 : 1;
                break;
                
            case 'preview':
                this.togglePreview();
                return;
                
            default:
                return;
        }
        
        // Replace text
        this.textarea.value = text.substring(0, start) + replacement + text.substring(end);
        
        // Set cursor position
        this.textarea.selectionStart = start + cursorOffset;
        this.textarea.selectionEnd = start + cursorOffset;
        this.textarea.focus();
        
        // Update char count
        this.updateCharCount();
    }
    
    handleKeyboard(e) {
        // Keyboard shortcuts
        if (e.ctrlKey || e.metaKey) {
            switch(e.key) {
                case 'b':
                    e.preventDefault();
                    this.handleAction('bold');
                    break;
                case 'i':
                    e.preventDefault();
                    this.handleAction('italic');
                    break;
                case 'k':
                    e.preventDefault();
                    this.handleAction('link');
                    break;
            }
        }
        
        // Tab for indentation
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = this.textarea.selectionStart;
            const end = this.textarea.selectionEnd;
            const text = this.textarea.value;
            
            if (e.shiftKey) {
                // Remove indentation
                const beforeStart = text.lastIndexOf('\n', start - 1) + 1;
                const afterEnd = text.indexOf('\n', end);
                const endPos = afterEnd === -1 ? text.length : afterEnd;
                
                const lines = text.substring(beforeStart, endPos).split('\n');
                const unindented = lines.map(line => line.replace(/^  /, '')).join('\n');
                
                this.textarea.value = text.substring(0, beforeStart) + unindented + text.substring(endPos);
            } else {
                // Add indentation
                if (start === end) {
                    // No selection, just add spaces
                    this.textarea.value = text.substring(0, start) + '  ' + text.substring(end);
                    this.textarea.selectionStart = start + 2;
                    this.textarea.selectionEnd = start + 2;
                } else {
                    // Indent selected lines
                    const beforeStart = text.lastIndexOf('\n', start - 1) + 1;
                    const afterEnd = text.indexOf('\n', end);
                    const endPos = afterEnd === -1 ? text.length : afterEnd;
                    
                    const lines = text.substring(beforeStart, endPos).split('\n');
                    const indented = lines.map(line => '  ' + line).join('\n');
                    
                    this.textarea.value = text.substring(0, beforeStart) + indented + text.substring(endPos);
                }
            }
        }
    }
    
    togglePreview() {
        if (!this.preview) return;
        
        this.isPreviewMode = !this.isPreviewMode;
        
        const previewBtn = this.toolbar.querySelector('[data-action="preview"]');
        const modeIndicator = this.container.querySelector('.editor-mode-indicator');
        
        if (this.isPreviewMode) {
            // Show preview
            this.preview.innerHTML = this.parseMarkdown(this.textarea.value);
            this.preview.classList.add('active');
            this.textarea.classList.add('preview-mode');
            previewBtn?.classList.add('active');
            
            if (modeIndicator) {
                modeIndicator.innerHTML = '<i data-lucide="eye"></i> Preview mode';
                lucide.createIcons();
            }
        } else {
            // Show editor
            this.preview.classList.remove('active');
            this.textarea.classList.remove('preview-mode');
            previewBtn?.classList.remove('active');
            
            if (modeIndicator) {
                modeIndicator.innerHTML = '<i data-lucide="edit-3"></i> Edit mode';
                lucide.createIcons();
            }
        }
    }
    
    parseMarkdown(text) {
        if (!text) return '<p style="color: var(--task-text-muted);">No content yet...</p>';
        
        // Escape HTML
        let html = text.replace(/[<>&]/g, (c) => {
            return {'<': '&lt;', '>': '&gt;', '&': '&amp;'}[c];
        });
        
        // Headers
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
        
        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        
        // Italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        
        // Strikethrough
        html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
        
        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Code blocks
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        
        // Blockquotes
        html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
        
        // Lists
        html = html.replace(/^\* (.+)/gim, '<li>$1</li>');
        html = html.replace(/^- (.+)/gim, '<li>$1</li>');
        html = html.replace(/^\d+\. (.+)/gim, '<li>$1</li>');
        
        // Wrap consecutive list items
        html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
            return '<ul>' + match + '</ul>';
        });
        
        // Checklists
        html = html.replace(/- \[ \] (.+)/g, '<li style="list-style: none;"><input type="checkbox" disabled> $1</li>');
        html = html.replace(/- \[x\] (.+)/gi, '<li style="list-style: none;"><input type="checkbox" checked disabled> $1</li>');
        
        // Line breaks
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';
        
        // Clean up empty paragraphs
        html = html.replace(/<p><\/p>/g, '');
        html = html.replace(/<p>(<h[1-6]>)/g, '$1');
        html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
        html = html.replace(/<p>(<ul>)/g, '$1');
        html = html.replace(/(<\/ul>)<\/p>/g, '$1');
        html = html.replace(/<p>(<blockquote>)/g, '$1');
        html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
        html = html.replace(/<p>(<pre>)/g, '$1');
        html = html.replace(/(<\/pre>)<\/p>/g, '$1');
        
        return html;
    }
    
    updateCharCount() {
        if (this.charCount) {
            const count = this.textarea.value.length;
            this.charCount.textContent = `${count} character${count !== 1 ? 's' : ''}`;
        }
    }
}

// Initialize editors for task details modal
function initializeMarkdownEditors() {
    // Description editor
    new MarkdownEditor('details-description', 'description-preview', 'description-char-count');
    
    // Plan editor
    new MarkdownEditor('details-plan', 'plan-preview');
    
    // Implementation editor
    new MarkdownEditor('details-implementation', 'implementation-preview');
}

// Initialize editors for task creation modal
function initializeCreateMarkdownEditors() {
    // Description editor for creation
    new MarkdownEditor('task-description', 'create-description-preview');
    
    // Plan editor for creation
    new MarkdownEditor('task-plan', 'create-plan-preview');
    
    // Implementation editor for creation
    new MarkdownEditor('task-implementation', 'create-implementation-preview');
}

// Export for use in kanban.js
window.MarkdownEditor = MarkdownEditor;
window.initializeMarkdownEditors = initializeMarkdownEditors;
window.initializeCreateMarkdownEditors = initializeCreateMarkdownEditors;
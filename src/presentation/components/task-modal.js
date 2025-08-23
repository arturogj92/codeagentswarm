/**
 * Unified Task Modal Component
 * Creates a modern task creation modal with markdown editors and all features
 */

class TaskModal {
    constructor(options = {}) {
        this.onSave = options.onSave || (() => {});
        this.onCancel = options.onCancel || (() => {});
        this.terminals = options.terminals || [];
        this.activeTerminalId = options.activeTerminalId || null;
        this.projects = [];
        this.modal = null;
        this.markdownEditors = {};
    }

    async show() {
        try {
            console.log('TaskModal.show() called');
            
            // Load projects first
            await this.loadProjects();
            console.log('Projects loaded:', this.projects);
            
            // Create and show modal
            this.createModal();
            console.log('Modal created');
            
            this.attachEventListeners();
            console.log('Event listeners attached');
            
            this.initializeMarkdownEditors();
            console.log('Markdown editors initialized');
            
            // Initialize Lucide icons
            if (window.lucide) {
                window.lucide.createIcons();
            }
            
            // Focus on title input
            setTimeout(() => {
                const titleInput = document.getElementById('task-title');
                if (titleInput) titleInput.focus();
            }, 100);
            
            console.log('TaskModal shown successfully');
        } catch (error) {
            console.error('Error showing TaskModal:', error);
        }
    }

    async loadProjects() {
        try {
            // Get ipcRenderer from window if available
            const { ipcRenderer } = window.require ? window.require('electron') : {};
            
            // Try different methods to get projects
            if (ipcRenderer && ipcRenderer.invoke) {
                // Use ipcRenderer.invoke for async communication
                const result = await ipcRenderer.invoke('project-get-all');
                if (result && result.success && result.projects) {
                    this.projects = result.projects;
                }
            } else if (window.electronAPI && window.electronAPI.getProjects) {
                // Fallback to electronAPI
                await new Promise((resolve) => {
                    window.electronAPI.getProjects((projects) => {
                        this.projects = projects || [];
                        resolve();
                    });
                });
            }
        } catch (error) {
            console.error('Failed to load projects:', error);
            this.projects = [];
        }
    }

    createModal() {
        console.log('Creating modal...');
        
        // Remove any existing modal
        this.destroy();
        
        this.modal = document.createElement('div');
        this.modal.className = 'modal';
        
        try {
            const modalHTML = this.getModalHTML();
            console.log('Modal HTML generated, length:', modalHTML.length);
            this.modal.innerHTML = modalHTML;
        } catch (error) {
            console.error('Error generating modal HTML:', error);
            return;
        }
        
        console.log('Appending modal to body...');
        document.body.appendChild(this.modal);
        console.log('Modal appended, modal element:', this.modal);
        
        // Add show class for animation
        setTimeout(() => {
            console.log('Adding show class to modal');
            this.modal.classList.add('show');
            console.log('Modal classes:', this.modal.className);
        }, 10);
    }

    getModalHTML() {
        const terminalsHTML = this.getTerminalsHTML();
        const projectsHTML = this.getProjectsHTML();
        
        return `
            <div class="modal-content">
                <div class="modal-header task-header-redesigned">
                    <div class="task-header-wrapper">
                        <div class="task-header-top">
                            <div class="task-header-meta">
                                <div class="task-header-status">
                                    <div id="create-status-display" class="status-display-modern clickable status-pending" data-status="pending">
                                        <span id="create-status-text">PENDING</span>
                                        <i data-lucide="chevron-down" class="status-dropdown-icon"></i>
                                    </div>
                                    <div id="create-status-dropdown-menu" class="status-dropdown-menu" style="display: none;">
                                        <div class="status-option" data-value="pending">
                                            <span>Pending</span>
                                        </div>
                                        <div class="status-option" data-value="in_progress">
                                            <span>In Progress</span>
                                        </div>
                                        <div class="status-option" data-value="in_testing">
                                            <span>In Testing</span>
                                        </div>
                                        <div class="status-option" data-value="completed">
                                            <span>Completed</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="task-header-project">
                                    <i data-lucide="folder" class="header-icon"></i>
                                    <select id="task-project" class="header-select">
                                        ${projectsHTML}
                                    </select>
                                </div>
                                <div class="task-header-terminal">
                                    <i data-lucide="terminal" class="header-icon"></i>
                                    <select id="task-terminal" class="header-select">
                                        ${terminalsHTML}
                                    </select>
                                </div>
                            </div>
                            <button class="modal-close" id="modal-close-btn">
                                <i data-lucide="x"></i>
                            </button>
                        </div>
                        <div class="task-header-title">
                            <input type="text" id="task-title" class="editable-title-modern" placeholder="Enter task title..." required maxlength="5000">
                        </div>
                    </div>
                </div>
                <div class="modal-body">
                    <form id="task-form">
                        <!-- Parent Task (optional) -->
                        <div class="form-group">
                            <label for="task-parent-search"><i data-lucide="git-branch"></i> Parent Task (optional)</label>
                            <div class="parent-task-search-wrapper">
                                <input type="text" id="task-parent-search" class="form-control" placeholder="Search by task ID or title..." autocomplete="off">
                                <input type="hidden" id="task-parent" value="">
                                <div id="parent-task-dropdown" class="parent-task-dropdown" style="display: none;">
                                    <!-- Dropdown items will be populated dynamically -->
                                </div>
                            </div>
                            <small class="form-help">Make this task a subtask of another task</small>
                        </div>
                        
                        ${this.getMarkdownEditorHTML('description', 'Description', 'Add description... (supports Markdown)', 4, 50000)}
                        ${this.getMarkdownEditorHTML('plan', 'Plan', 'Enter your plan for this task... (supports Markdown)', 3, 100000)}
                        ${this.getMarkdownEditorHTML('implementation', 'Implementation', 'Files modified, summary and implementation details... (supports Markdown)', 3, 100000)}
                    </form>
                </div>
                <div class="modal-footer modal-actions">
                    <button type="button" class="btn-modern btn-secondary-modern" id="cancel-btn"><i data-lucide="x"></i> Cancel</button>
                    <button type="submit" class="btn-modern btn-primary-modern" id="save-task-btn"><i data-lucide="check"></i> Create Task</button>
                </div>
            </div>
        `;
    }

    getTerminalsHTML() {
        let html = '<option value="">Not assigned</option>';
        
        if (Array.isArray(this.terminals)) {
            // Array of terminal objects
            this.terminals.forEach((term, index) => {
                const num = index + 1;
                const isActive = this.activeTerminalId === index;
                html += `<option value="${num}" ${isActive ? 'selected' : ''}>Terminal ${num}${isActive ? ' (current)' : ''}</option>`;
            });
        } else if (this.terminals instanceof Map) {
            // Map of terminals
            this.terminals.forEach((term, quadrant) => {
                const num = quadrant + 1;
                const isActive = this.activeTerminalId === quadrant;
                html += `<option value="${num}" ${isActive ? 'selected' : ''}>Terminal ${num}${isActive ? ' (current)' : ''}</option>`;
            });
        } else {
            // Default terminals
            for (let i = 1; i <= 6; i++) {
                html += `<option value="${i}">Terminal ${i}</option>`;
            }
        }
        
        return html;
    }

    getProjectsHTML() {
        let html = '<option value="">No Project</option>';
        this.projects.forEach(project => {
            const color = project.color || '#888';
            html += `<option value="${project.name}" style="color: ${color};">${project.display_name || project.name}</option>`;
        });
        return html;
    }

    getMarkdownEditorHTML(field, label, placeholder, rows = 4, maxLength = 50000) {
        const iconMap = {
            'description': 'file-text',
            'plan': 'list',
            'implementation': 'code'
        };
        
        return `
            <div class="form-group task-${field}-section">
                <label><i data-lucide="${iconMap[field] || 'file-text'}"></i> ${label}</label>
                <div class="markdown-editor-container" data-field="${field}">
                    ${this.getEditorToolbarHTML()}
                    <textarea id="task-${field}" class="markdown-textarea" rows="${rows}" maxlength="${maxLength}" placeholder="${placeholder}"></textarea>
                    <div class="markdown-preview" id="create-${field}-preview"></div>
                    <div class="editor-status-bar">
                        <span class="char-count" id="create-${field}-char-count">0 characters</span>
                        <span class="editor-mode-indicator">
                            <i data-lucide="edit-3"></i> Edit mode
                        </span>
                    </div>
                </div>
            </div>
        `;
    }

    getEditorToolbarHTML() {
        return `
            <div class="editor-toolbar">
                <div class="editor-toolbar-group">
                    <button type="button" class="editor-btn" data-action="bold" data-tooltip="Bold (Ctrl+B)">
                        <i data-lucide="bold"></i>
                    </button>
                    <button type="button" class="editor-btn" data-action="italic" data-tooltip="Italic (Ctrl+I)">
                        <i data-lucide="italic"></i>
                    </button>
                    <button type="button" class="editor-btn" data-action="strikethrough" data-tooltip="Strikethrough">
                        <i data-lucide="strikethrough"></i>
                    </button>
                </div>
                <div class="editor-toolbar-group">
                    <button type="button" class="editor-btn" data-action="h1" data-tooltip="Heading 1">
                        <i data-lucide="heading-1"></i>
                    </button>
                    <button type="button" class="editor-btn" data-action="h2" data-tooltip="Heading 2">
                        <i data-lucide="heading-2"></i>
                    </button>
                    <button type="button" class="editor-btn" data-action="h3" data-tooltip="Heading 3">
                        <i data-lucide="heading-3"></i>
                    </button>
                </div>
                <div class="editor-toolbar-group">
                    <button type="button" class="editor-btn" data-action="ul" data-tooltip="Bullet List">
                        <i data-lucide="list"></i>
                    </button>
                    <button type="button" class="editor-btn" data-action="ol" data-tooltip="Numbered List">
                        <i data-lucide="list-ordered"></i>
                    </button>
                    <button type="button" class="editor-btn" data-action="checklist" data-tooltip="Checklist">
                        <i data-lucide="list-checks"></i>
                    </button>
                </div>
                <div class="editor-toolbar-group">
                    <button type="button" class="editor-btn" data-action="code" data-tooltip="Code">
                        <i data-lucide="code"></i>
                    </button>
                    <button type="button" class="editor-btn" data-action="codeblock" data-tooltip="Code Block">
                        <i data-lucide="code-2"></i>
                    </button>
                    <button type="button" class="editor-btn" data-action="quote" data-tooltip="Quote">
                        <i data-lucide="quote"></i>
                    </button>
                </div>
                <div class="editor-toolbar-group">
                    <button type="button" class="editor-btn" data-action="link" data-tooltip="Link">
                        <i data-lucide="link"></i>
                    </button>
                    <button type="button" class="editor-btn" data-action="preview" data-tooltip="Preview">
                        <i data-lucide="eye"></i>
                    </button>
                </div>
            </div>
        `;
    }

    attachEventListeners() {
        // Close button
        const closeBtn = document.getElementById('modal-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }
        
        // Cancel button
        const cancelBtn = document.getElementById('cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.close());
        }
        
        // Save button
        const saveBtn = document.getElementById('save-task-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }
        
        // Escape key
        this.escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        };
        document.addEventListener('keydown', this.escapeHandler);
        
        // Status dropdown
        this.initializeStatusDropdown();
        
        // Parent task search
        this.initializeParentTaskSearch();
    }

    initializeStatusDropdown() {
        const statusDisplay = document.getElementById('create-status-display');
        const statusMenu = document.getElementById('create-status-dropdown-menu');
        const statusText = document.getElementById('create-status-text');
        
        if (statusDisplay && statusMenu) {
            statusDisplay.addEventListener('click', () => {
                statusMenu.style.display = statusMenu.style.display === 'none' ? 'block' : 'none';
            });
            
            statusMenu.querySelectorAll('.status-option').forEach(option => {
                option.addEventListener('click', () => {
                    const value = option.dataset.value;
                    statusDisplay.dataset.status = value;
                    statusDisplay.className = `status-display-modern clickable status-${value}`;
                    statusText.textContent = value.toUpperCase().replace('_', ' ');
                    statusMenu.style.display = 'none';
                });
            });
            
            // Click outside to close
            document.addEventListener('click', (e) => {
                if (!statusDisplay.contains(e.target) && !statusMenu.contains(e.target)) {
                    statusMenu.style.display = 'none';
                }
            });
        }
    }

    initializeParentTaskSearch() {
        const searchInput = document.getElementById('task-parent-search');
        const dropdown = document.getElementById('parent-task-dropdown');
        const hiddenInput = document.getElementById('task-parent');
        
        if (!searchInput || !dropdown) return;
        
        let searchTimeout;
        
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            const query = searchInput.value.trim();
            
            if (query.length < 2) {
                dropdown.style.display = 'none';
                return;
            }
            
            searchTimeout = setTimeout(() => {
                this.searchParentTasks(query);
            }, 300);
        });
        
        searchInput.addEventListener('focus', () => {
            if (searchInput.value.trim().length >= 2) {
                this.searchParentTasks(searchInput.value.trim());
            }
        });
        
        // Click outside to close
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }

    async searchParentTasks(query) {
        const dropdown = document.getElementById('parent-task-dropdown');
        if (!dropdown) return;
        
        try {
            let tasks = [];
            
            // Get ipcRenderer from window
            const { ipcRenderer } = window.require ? window.require('electron') : {};
            
            // Search tasks via IPC
            if (ipcRenderer && ipcRenderer.invoke) {
                const result = await ipcRenderer.invoke('task-search', { query, limit: 10 });
                if (result && result.success && result.tasks) {
                    tasks = result.tasks;
                }
            } else if (window.electronAPI && window.electronAPI.searchTasks) {
                // Fallback to electronAPI
                await new Promise((resolve) => {
                    window.electronAPI.searchTasks(query, (foundTasks) => {
                        tasks = foundTasks || [];
                        resolve();
                    });
                });
            }
            
            this.displayParentTaskResults(dropdown, tasks);
        } catch (error) {
            console.error('Failed to search tasks:', error);
            dropdown.innerHTML = '<div class="parent-task-item no-results">Search failed</div>';
            dropdown.style.display = 'block';
        }
    }

    displayParentTaskResults(dropdown, tasks) {
        if (!tasks || tasks.length === 0) {
            dropdown.innerHTML = `
                <div class="parent-task-item no-parent" data-task-id="">
                    <strong>No parent (standalone task)</strong>
                </div>
                <div class="parent-task-item no-results">No tasks found</div>
            `;
        } else {
            // Always show "No parent" option first
            let html = `
                <div class="parent-task-item no-parent" data-task-id="">
                    <strong>No parent (standalone task)</strong>
                </div>
            `;
            
            // Add task results
            html += tasks.slice(0, 20).map(task => {
                // Status icon based on task status
                let statusIcon = '';
                switch(task.status) {
                    case 'completed':
                        statusIcon = '✅';
                        break;
                    case 'in_progress':
                        statusIcon = '🔄';
                        break;
                    case 'in_testing':
                        statusIcon = '🧪';
                        break;
                    case 'pending':
                    default:
                        statusIcon = '⏳';
                        break;
                }
                
                return `
                    <div class="parent-task-item" data-task-id="${task.id}">
                        <span class="task-id">#${task.id}</span>
                        <span class="task-title">${this.escapeHtml(task.title)}</span>
                        ${task.project ? `<span class="task-project">${this.escapeHtml(task.project)}</span>` : ''}
                    </div>
                `;
            }).join('');
            
            // Add "more results" indicator if needed
            if (tasks.length > 20) {
                html += `
                    <div class="parent-task-item" style="text-align: center; font-style: italic; opacity: 0.5;">
                        ...and ${tasks.length - 20} more results
                    </div>
                `;
            }
            
            dropdown.innerHTML = html;
            
            // Add click handlers
            dropdown.querySelectorAll('.parent-task-item').forEach(item => {
                if (!item.classList.contains('no-results') && !item.style.fontStyle) {
                    item.addEventListener('click', () => {
                        const taskId = item.dataset.taskId;
                        if (taskId === '') {
                            // Clear parent (no parent selected)
                            document.getElementById('task-parent').value = '';
                            document.getElementById('task-parent-search').value = '';
                        } else {
                            const taskTitle = item.querySelector('.task-title').textContent;
                            document.getElementById('task-parent').value = taskId;
                            document.getElementById('task-parent-search').value = `#${taskId} - ${taskTitle}`;
                        }
                        dropdown.style.display = 'none';
                    });
                }
            });
        }
        dropdown.style.display = 'block';
    }

    initializeMarkdownEditors() {
        const fields = ['description', 'plan', 'implementation'];
        
        fields.forEach(field => {
            const container = document.querySelector(`.markdown-editor-container[data-field="${field}"]`);
            if (!container) return;
            
            const textarea = container.querySelector('.markdown-textarea');
            const preview = container.querySelector('.markdown-preview');
            const charCount = container.querySelector('.char-count');
            const modeIndicator = container.querySelector('.editor-mode-indicator');
            
            if (!textarea) return;
            
            // Character counter
            textarea.addEventListener('input', () => {
                if (charCount) {
                    charCount.textContent = `${textarea.value.length} characters`;
                }
            });
            
            // Toolbar buttons
            container.querySelectorAll('.editor-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const action = btn.dataset.action;
                    
                    if (action === 'preview') {
                        this.togglePreview(field);
                    } else {
                        this.applyMarkdownFormat(textarea, action);
                    }
                });
            });
            
            // Keyboard shortcuts
            textarea.addEventListener('keydown', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    switch(e.key) {
                        case 'b':
                            e.preventDefault();
                            this.applyMarkdownFormat(textarea, 'bold');
                            break;
                        case 'i':
                            e.preventDefault();
                            this.applyMarkdownFormat(textarea, 'italic');
                            break;
                    }
                }
            });
        });
    }

    applyMarkdownFormat(textarea, action) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selectedText = text.substring(start, end);
        
        let replacement = '';
        let cursorOffset = 0;
        
        switch(action) {
            case 'bold':
                replacement = `**${selectedText || 'bold text'}**`;
                cursorOffset = selectedText ? 0 : 2;
                break;
            case 'italic':
                replacement = `*${selectedText || 'italic text'}*`;
                cursorOffset = selectedText ? 0 : 1;
                break;
            case 'strikethrough':
                replacement = `~~${selectedText || 'strikethrough text'}~~`;
                cursorOffset = selectedText ? 0 : 2;
                break;
            case 'h1':
                replacement = `# ${selectedText || 'Heading 1'}`;
                cursorOffset = selectedText ? 0 : 2;
                break;
            case 'h2':
                replacement = `## ${selectedText || 'Heading 2'}`;
                cursorOffset = selectedText ? 0 : 3;
                break;
            case 'h3':
                replacement = `### ${selectedText || 'Heading 3'}`;
                cursorOffset = selectedText ? 0 : 4;
                break;
            case 'ul':
                replacement = `- ${selectedText || 'List item'}`;
                cursorOffset = selectedText ? 0 : 2;
                break;
            case 'ol':
                replacement = `1. ${selectedText || 'List item'}`;
                cursorOffset = selectedText ? 0 : 3;
                break;
            case 'checklist':
                replacement = `- [ ] ${selectedText || 'Task item'}`;
                cursorOffset = selectedText ? 0 : 6;
                break;
            case 'code':
                replacement = `\`${selectedText || 'code'}\``;
                cursorOffset = selectedText ? 0 : 1;
                break;
            case 'codeblock':
                replacement = `\`\`\`\n${selectedText || 'code block'}\n\`\`\``;
                cursorOffset = selectedText ? 0 : 4;
                break;
            case 'quote':
                replacement = `> ${selectedText || 'Quote'}`;
                cursorOffset = selectedText ? 0 : 2;
                break;
            case 'link':
                replacement = `[${selectedText || 'link text'}](url)`;
                cursorOffset = selectedText ? replacement.length - 4 : 1;
                break;
        }
        
        textarea.value = text.substring(0, start) + replacement + text.substring(end);
        textarea.focus();
        
        // Set cursor position
        const newPosition = start + (selectedText ? replacement.length : cursorOffset);
        textarea.setSelectionRange(newPosition, newPosition);
        
        // Trigger input event for character counter
        textarea.dispatchEvent(new Event('input'));
    }

    togglePreview(field) {
        const container = document.querySelector(`.markdown-editor-container[data-field="${field}"]`);
        if (!container) return;
        
        const textarea = container.querySelector('.markdown-textarea');
        const preview = container.querySelector('.markdown-preview');
        const modeIndicator = container.querySelector('.editor-mode-indicator');
        
        if (!textarea || !preview) return;
        
        const isPreview = preview.classList.contains('active');
        
        if (isPreview) {
            // Switch to edit mode
            preview.classList.remove('active');
            textarea.style.display = 'block';
            if (modeIndicator) {
                modeIndicator.innerHTML = '<i data-lucide="edit-3"></i> Edit mode';
            }
        } else {
            // Switch to preview mode
            preview.innerHTML = this.renderMarkdown(textarea.value);
            preview.classList.add('active');
            textarea.style.display = 'none';
            if (modeIndicator) {
                modeIndicator.innerHTML = '<i data-lucide="eye"></i> Preview mode';
            }
        }
        
        // Re-initialize Lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    renderMarkdown(text) {
        if (!text) return '<p class="preview-empty">Nothing to preview</p>';
        
        // Simple markdown rendering (can be replaced with a proper markdown library)
        let html = text;
        
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
        
        // Code blocks
        html = html.replace(/```(.*?)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
        
        // Inline code
        html = html.replace(/`(.+?)`/g, '<code>$1</code>');
        
        // Links
        html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        // Lists
        html = html.replace(/^\- \[ \] (.+)$/gim, '<div class="checklist-item"><input type="checkbox" disabled> $1</div>');
        html = html.replace(/^\- \[x\] (.+)$/gim, '<div class="checklist-item"><input type="checkbox" checked disabled> $1</div>');
        html = html.replace(/^\- (.+)$/gim, '<li>$1</li>');
        html = html.replace(/^\d+\. (.+)$/gim, '<li>$1</li>');
        
        // Blockquotes
        html = html.replace(/^> (.+)$/gim, '<blockquote>$1</blockquote>');
        
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        
        // Wrap lists
        html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
        
        return html;
    }

    async save() {
        const title = document.getElementById('task-title').value.trim();
        const description = document.getElementById('task-description').value.trim();
        const plan = document.getElementById('task-plan').value.trim();
        const implementation = document.getElementById('task-implementation').value.trim();
        const project = document.getElementById('task-project').value;
        const terminalId = document.getElementById('task-terminal').value;
        const parentTaskId = document.getElementById('task-parent').value;
        const status = document.getElementById('create-status-display').dataset.status;
        
        if (!title) {
            this.showError('Please enter a task title');
            document.getElementById('task-title').focus();
            return;
        }
        
        const taskData = {
            title,
            description,
            plan,
            implementation,
            project,
            terminal_id: terminalId || null,
            parent_task_id: parentTaskId || null,
            status: status || 'pending'
        };
        
        // Call the save callback
        this.onSave(taskData);
        
        // Close the modal
        this.close();
    }

    showError(message) {
        // Try to show notification, or fallback to alert
        const { ipcRenderer } = window.require ? window.require('electron') : {};
        
        if (ipcRenderer) {
            ipcRenderer.send('show-notification', message, 'warning');
        } else if (window.electronAPI && window.electronAPI.showNotification) {
            window.electronAPI.showNotification(message, 'warning');
        } else {
            alert(message);
        }
    }

    close() {
        if (this.modal) {
            this.modal.classList.remove('show');
            setTimeout(() => {
                this.destroy();
                this.onCancel();
            }, 200);
        }
    }

    destroy() {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
            this.escapeHandler = null;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Make available globally immediately
if (typeof window !== 'undefined') {
    window.TaskModal = TaskModal;
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaskModal;
}
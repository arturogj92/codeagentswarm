const { ipcRenderer } = require('electron');

class KanbanManager {
    constructor() {
        this.tasks = [];
        this.projects = [];
        this.currentTask = null;
        this.editingTaskId = null;
        this.currentProjectFilter = 'all';
        this.isSelectingDirectory = false;
        this.sortDirections = {
            pending: 'desc',
            in_progress: 'desc',
            in_testing: 'desc',
            completed: 'desc'
        };
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.initializeLucideIcons();
        this.initializeColorGradients();
        await this.loadProjects();
        await this.loadTasks();
    }

    initializeLucideIcons() {
        // Initialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    initializeColorGradients() {
        // Apply gradients to all color options
        const colorOptions = document.querySelectorAll('.color-option');
        colorOptions.forEach(option => {
            const color = option.style.backgroundColor;
            if (color) {
                const gradient = this.getProjectGradient(color);
                option.style.background = gradient;
            }
        });
    }

    setupEventListeners() {
        // Header buttons
        document.getElementById('add-task-btn').addEventListener('click', () => {
            this.showCreateTaskModal();
        });

        document.getElementById('back-to-terminal-btn').addEventListener('click', () => {
            window.close();
        });

        // Modal controls
        document.getElementById('modal-close-btn').addEventListener('click', () => {
            this.hideTaskModal();
        });

        document.getElementById('cancel-btn').addEventListener('click', () => {
            this.hideTaskModal();
        });

        document.getElementById('save-task-btn').addEventListener('click', () => {
            this.saveTask();
        });

        // Task details modal
        document.getElementById('details-modal-close-btn').addEventListener('click', () => {
            this.hideTaskDetailsModal();
        });

        document.getElementById('close-details-btn').addEventListener('click', () => {
            this.hideTaskDetailsModal();
        });

        document.getElementById('edit-task-btn').addEventListener('click', () => {
            this.editCurrentTask();
        });

        document.getElementById('delete-task-btn').addEventListener('click', () => {
            this.deleteCurrentTask();
        });

        // Plan editing controls
        document.getElementById('edit-plan-btn').addEventListener('click', () => {
            this.showPlanEditMode();
        });

        document.getElementById('save-plan-btn').addEventListener('click', () => {
            this.savePlan();
        });

        document.getElementById('cancel-plan-btn').addEventListener('click', () => {
            this.hidePlanEditMode();
        });

        // Implementation editing controls
        document.getElementById('edit-implementation-btn').addEventListener('click', () => {
            this.showImplementationEditMode();
        });

        document.getElementById('save-implementation-btn').addEventListener('click', () => {
            this.saveImplementation();
        });

        document.getElementById('cancel-implementation-btn').addEventListener('click', () => {
            this.hideImplementationEditMode();
        });

        // Form submission
        document.getElementById('task-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveTask();
        });
        
        // Project filter
        document.getElementById('project-filter-select').addEventListener('change', (e) => {
            this.currentProjectFilter = e.target.value;
            this.renderTasks();
            this.updateEditProjectButtonVisibility();
        });
        
        // Create project button
        document.getElementById('create-project-btn').addEventListener('click', () => {
            this.showCreateProjectDialog();
        });
        
        // Edit current project button
        document.getElementById('edit-current-project-btn').addEventListener('click', () => {
            if (this.currentProjectFilter && this.currentProjectFilter !== 'all') {
                this.editProjectName(this.currentProjectFilter);
            }
        });
        

        // Project modal controls
        document.getElementById('project-modal-close-btn').addEventListener('click', () => {
            this.hideProjectModal();
        });

        document.getElementById('cancel-project-btn').addEventListener('click', () => {
            this.hideProjectModal();
        });

        document.getElementById('save-project-btn').addEventListener('click', () => {
            this.saveProject();
        });

        document.getElementById('project-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveProject();
        });
        
        // Browse button for new project path
        document.getElementById('select-new-project-path-btn').addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            try {
                const result = await ipcRenderer.invoke('dialog-open-directory');
                
                if (result && result.success && result.path) {
                    const pathInput = document.getElementById('project-path');
                    pathInput.value = result.path;
                    pathInput.setAttribute('value', result.path);
                }
            } catch (error) {
                console.error('Error opening directory dialog:', error);
            }
        });

        // Project edit modal controls
        document.getElementById('project-edit-modal-close-btn').addEventListener('click', () => {
            this.hideProjectEditModal();
        });

        document.getElementById('cancel-project-edit-btn').addEventListener('click', () => {
            this.hideProjectEditModal();
        });

        document.getElementById('save-project-edit-btn').addEventListener('click', () => {
            this.saveProjectEdit();
        });

        document.getElementById('project-edit-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveProjectEdit();
        });
        
        // Delete project button
        document.getElementById('delete-project-btn').addEventListener('click', () => {
            this.deleteProject();
        });
        
        // Browse button for project path
        document.getElementById('select-project-path-btn').addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Set flag to prevent modal from closing
            this.isSelectingDirectory = true;
            
            // Temporarily store the editingProjectName to prevent modal from closing
            const tempProjectName = this.editingProjectName;
            
            try {
                const result = await ipcRenderer.invoke('dialog-open-directory');
                
                // Restore the editing state
                this.editingProjectName = tempProjectName;
                
                // Re-show the modal if it was closed
                const modal = document.getElementById('project-edit-modal');
                if (!modal.classList.contains('show')) {
                    modal.classList.add('show');
                }
                
                if (result && result.success && result.path) {
                    const pathInput = document.getElementById('project-edit-path');
                    pathInput.value = result.path;
                    
                    // Force update the input value
                    pathInput.setAttribute('value', result.path);
                }
            } catch (error) {
                console.error('Error opening directory dialog:', error);
                // Restore the editing state even on error
                this.editingProjectName = tempProjectName;
                
                // Re-show modal
                const modal = document.getElementById('project-edit-modal');
                if (!modal.classList.contains('show')) {
                    modal.classList.add('show');
                }
            } finally {
                // Always reset the flag
                this.isSelectingDirectory = false;
            }
        });

        // Click outside modal to close
        document.getElementById('task-modal').addEventListener('click', (e) => {
            if (e.target.id === 'task-modal') {
                this.hideTaskModal();
            }
        });

        document.getElementById('task-details-modal').addEventListener('click', (e) => {
            if (e.target.id === 'task-details-modal') {
                this.hideTaskDetailsModal();
            }
        });

        document.getElementById('project-modal').addEventListener('click', (e) => {
            if (e.target.id === 'project-modal') {
                this.hideProjectModal();
            }
        });

        document.getElementById('project-edit-modal').addEventListener('click', (e) => {
            if (e.target.id === 'project-edit-modal' && !this.isSelectingDirectory) {
                this.hideProjectEditModal();
            }
        });

        // Drag and drop
        this.setupDragAndDrop();
        
        // Setup sorting buttons
        this.setupSortingButtons();
    }

    setupDragAndDrop() {
        const taskLists = document.querySelectorAll('.task-list');
        this.placeholder = null;
        this.draggingElement = null;
        this.originalNextSibling = null;
        this.originalParent = null;
        this.lastPlaceholderPosition = null;
        this.dragoverThrottle = null;
        this.autoScrollAnimationId = null;
        this.currentScrollTarget = null;
        
        taskLists.forEach(list => {
            list.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                
                // Auto-scroll functionality
                const listRect = list.getBoundingClientRect();
                const scrollThreshold = 60; // Pixels from edge to trigger scroll
                const maxScrollSpeed = 15; // Maximum pixels to scroll per frame
                
                // Check if mouse is near top or bottom of the list
                const mouseY = e.clientY;
                const distanceFromTop = mouseY - listRect.top;
                const distanceFromBottom = listRect.bottom - mouseY;
                
                // Calculate scroll speed based on distance from edge (closer = faster)
                let scrollDirection = 0;
                let scrollSpeed = 0;
                
                if (distanceFromTop < scrollThreshold && list.scrollTop > 0) {
                    // Scroll up - speed increases as we get closer to the edge
                    scrollDirection = -1;
                    scrollSpeed = maxScrollSpeed * (1 - distanceFromTop / scrollThreshold);
                } else if (distanceFromBottom < scrollThreshold && list.scrollTop < list.scrollHeight - list.clientHeight) {
                    // Scroll down - speed increases as we get closer to the edge
                    scrollDirection = 1;
                    scrollSpeed = maxScrollSpeed * (1 - distanceFromBottom / scrollThreshold);
                }
                
                // Update scroll target
                if (scrollDirection !== 0) {
                    this.currentScrollTarget = { list, direction: scrollDirection, speed: scrollSpeed };
                    this.startAutoScroll();
                } else if (this.currentScrollTarget && this.currentScrollTarget.list === list) {
                    this.stopAutoScroll();
                }
                
                // Throttle dragover events
                if (this.dragoverThrottle) return;
                
                this.dragoverThrottle = setTimeout(() => {
                    this.dragoverThrottle = null;
                }, 100); // 100ms throttle
                
                if (this.draggingElement && this.placeholder) {
                    // Only hide empty state if the list is truly empty (no task cards except placeholder)
                    const realTasks = list.querySelectorAll('.task-card:not(.placeholder):not(.dragging)');
                    if (realTasks.length === 0) {
                        const emptyState = list.querySelector('.empty-state');
                        if (emptyState) {
                            emptyState.style.display = 'none';
                        }
                    }
                    
                    // First time - insert placeholder at original position
                    if (!this.placeholder.parentNode) {
                        this.originalParent.insertBefore(this.placeholder, this.originalNextSibling);
                    }
                    
                    const afterElement = this.getDragAfterElement(list, e.clientY);
                    const newPosition = {
                        parent: list,
                        afterElement: afterElement,
                        nextSibling: afterElement || null
                    };
                    
                    // Only move if position actually changed
                    if (!this.isSamePosition(this.lastPlaceholderPosition, newPosition)) {
                        this.lastPlaceholderPosition = newPosition;
                        
                        // Ensure we insert in the correct position
                        if (afterElement == null) {
                            // Append at the end
                            if (list.lastElementChild !== this.placeholder) {
                                list.appendChild(this.placeholder);
                            }
                        } else {
                            // Insert before the afterElement
                            if (this.placeholder.nextSibling !== afterElement) {
                                list.insertBefore(this.placeholder, afterElement);
                            }
                        }
                    }
                }
            });

            list.addEventListener('dragleave', (e) => {
                // Only process if we're truly leaving the list
                if (e.relatedTarget && !list.contains(e.relatedTarget)) {
                    // Stop auto-scroll when leaving the column
                    if (this.currentScrollTarget && this.currentScrollTarget.list === list) {
                        this.stopAutoScroll();
                    }
                    
                    // Show empty state again if the list is truly empty
                    const realTasks = list.querySelectorAll('.task-card:not(.placeholder):not(.dragging)');
                    if (realTasks.length === 0) {
                        const emptyState = list.querySelector('.empty-state');
                        if (emptyState) {
                            emptyState.style.display = '';
                        }
                    }
                }
            });

            list.addEventListener('drop', async (e) => {
                e.preventDefault();
                
                if (this.placeholder && this.draggingElement) {
                    const taskId = parseInt(e.dataTransfer.getData('text/plain'));
                    const draggedTask = this.tasks.find(t => t.id === taskId);
                    
                    // Check if placeholder is in DOM
                    if (this.placeholder.parentNode) {
                        // Get the final position from placeholder
                        const targetParent = this.placeholder.parentNode;
                        const targetNextSibling = this.placeholder.nextSibling;
                        const newStatus = targetParent.id.replace('-tasks', '');
                        
                        // Store the original status to update empty states
                        const oldStatus = draggedTask ? draggedTask.status : null;
                        
                        // Remove placeholder first
                        this.placeholder.parentNode.removeChild(this.placeholder);
                        
                        // Now move the dragging element to where placeholder was
                        if (targetNextSibling) {
                            targetParent.insertBefore(this.draggingElement, targetNextSibling);
                        } else {
                            targetParent.appendChild(this.draggingElement);
                        }
                        
                        // Update database
                        if (draggedTask && draggedTask.status !== newStatus) {
                            // Status changed - update task status
                            await this.updateTaskStatus(taskId, newStatus);
                            
                            // Update empty states for both columns
                            this.updateColumnEmptyState(oldStatus);
                            this.updateColumnEmptyState(newStatus);
                        } else {
                            // Just reordered within the same column - update order
                            await this.updateTaskOrder(targetParent, newStatus);
                        }
                    }
                }
                
                // Clean up
                this.stopAutoScroll();
                this.placeholder = null;
                this.draggingElement = null;
                this.originalNextSibling = null;
                this.originalParent = null;
                this.lastPlaceholderPosition = null;
                this.dragoverThrottle = null;
            });
        });
    }

    startAutoScroll() {
        if (this.autoScrollAnimationId) return; // Already scrolling
        
        const animate = () => {
            if (this.currentScrollTarget) {
                const { list, direction, speed } = this.currentScrollTarget;
                
                // Calculate new scroll position
                const newScrollTop = list.scrollTop + (direction * speed);
                
                // Apply scroll with bounds checking
                if (direction < 0 && newScrollTop >= 0) {
                    list.scrollTop = newScrollTop;
                } else if (direction > 0 && newScrollTop <= list.scrollHeight - list.clientHeight) {
                    list.scrollTop = newScrollTop;
                }
                
                // Continue animation
                this.autoScrollAnimationId = requestAnimationFrame(animate);
            } else {
                this.stopAutoScroll();
            }
        };
        
        this.autoScrollAnimationId = requestAnimationFrame(animate);
    }

    stopAutoScroll() {
        if (this.autoScrollAnimationId) {
            cancelAnimationFrame(this.autoScrollAnimationId);
            this.autoScrollAnimationId = null;
        }
        this.currentScrollTarget = null;
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.task-card:not(.placeholder)')];
        
        // Filter out dragging element and find the element we should insert before
        const validElements = draggableElements.filter(child => child !== this.draggingElement);
        
        let closestElement = null;
        let closestOffset = Number.NEGATIVE_INFINITY;
        
        for (const child of validElements) {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            // If we're above the middle of this element
            if (offset < 0 && offset > closestOffset) {
                closestOffset = offset;
                closestElement = child;
            }
        }
        
        return closestElement;
    }

    isSamePosition(pos1, pos2) {
        if (!pos1 || !pos2) return false;
        return pos1.parent === pos2.parent && 
               pos1.afterElement === pos2.afterElement &&
               pos1.nextSibling === pos2.nextSibling;
    }

    updateColumnCounts() {
        const statuses = ['pending', 'in_progress', 'in_testing', 'completed'];
        
        statuses.forEach(status => {
            const count = this.tasks.filter(t => t.status === status).length;
            const countElement = document.getElementById(`${status}-count`);
            if (countElement) {
                countElement.textContent = count;
            }
        });
    }

    updateColumnEmptyState(status) {
        if (!status) return;
        
        const container = document.getElementById(`${status}-tasks`);
        if (!container) return;
        
        const tasksInStatus = container.querySelectorAll('.task-card:not(.placeholder)');
        
        if (tasksInStatus.length === 0) {
            // Show empty state
            container.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="inbox"></i>
                    <p>No tasks ${status.replace('_', ' ')}</p>
                </div>
            `;
            // Re-initialize icons for the empty state
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        } else {
            // Remove empty state if it exists
            const emptyState = container.querySelector('.empty-state');
            if (emptyState) {
                emptyState.remove();
            }
        }
    }


    async updateTaskOrder(list, status) {
        try {
            const taskCards = [...list.querySelectorAll('.task-card')];
            const taskOrders = taskCards.map((card, index) => ({
                taskId: parseInt(card.dataset.taskId),
                sortOrder: index
            }));
            
            // Update only tasks with the same status to avoid conflicts
            const tasksInStatus = this.tasks.filter(t => t.status === status);
            const filteredOrders = taskOrders.filter(order => 
                tasksInStatus.some(task => task.id === order.taskId)
            );
            
            if (filteredOrders.length > 0) {
                const result = await ipcRenderer.invoke('task-update-order', filteredOrders);
                if (!result.success) {
                    console.error('Failed to update task order:', result.error);
                    // Reload tasks to reset the UI
                    await this.loadTasks();
                } else {
                    // Update local sort orders without reloading
                    filteredOrders.forEach(order => {
                        const task = this.tasks.find(t => t.id === order.taskId);
                        if (task) {
                            task.sort_order = order.sortOrder;
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Error updating task order:', error);
            await this.loadTasks();
        }
    }

    async loadProjects() {
        try {
            const result = await ipcRenderer.invoke('project-get-all');
            if (result.success) {
                this.projects = result.projects;
                this.updateProjectSelects();
            } else {
                console.error('Failed to load projects:', result.error);
            }
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    }
    
    updateProjectSelects() {
        // Update filter select
        const filterSelect = document.getElementById('project-filter-select');
        filterSelect.innerHTML = '<option value="all">All Projects</option>';
        
        // Update task form select
        const taskSelect = document.getElementById('task-project');
        taskSelect.innerHTML = '<option value="">No Project</option>';
        
        this.projects.forEach(project => {
            // Use display_name if available, otherwise fall back to name
            const displayName = project.display_name || project.name;
            
            // Add to filter
            const filterOption = document.createElement('option');
            filterOption.value = project.name;
            filterOption.textContent = displayName;
            filterOption.style.color = project.color;
            filterSelect.appendChild(filterOption);
            
            // Add to task form
            const taskOption = document.createElement('option');
            taskOption.value = project.name;
            taskOption.textContent = displayName;
            taskOption.style.color = project.color;
            taskSelect.appendChild(taskOption);
        });
        
        
        // Set default project if none selected
        if (taskSelect.options.length > 1 && !taskSelect.value) {
            taskSelect.value = 'CodeAgentSwarm';
        }
        
        // Update edit button visibility
        this.updateEditProjectButtonVisibility();
    }
    
    updateEditProjectButtonVisibility() {
        const editBtn = document.getElementById('edit-current-project-btn');
        if (this.currentProjectFilter && this.currentProjectFilter !== 'all') {
            editBtn.style.display = 'inline-flex';
        } else {
            editBtn.style.display = 'none';
        }
    }

    async loadTasks() {
        try {
            const result = await ipcRenderer.invoke('task-get-all');
            if (result.success) {
                this.tasks = result.tasks;
                this.renderTasks();
                
                // Check if there's a pending task to focus
                if (pendingFocusTaskId) {
                    console.log('Processing pending focus task:', pendingFocusTaskId);
                    setTimeout(() => {
                        this.focusTask(pendingFocusTaskId);
                        pendingFocusTaskId = null;
                    }, 100); // Small delay to ensure DOM is ready
                }
            } else {
                console.error('Failed to load tasks:', result.error);
            }
        } catch (error) {
            console.error('Error loading tasks:', error);
        }
    }

    renderTasks() {
        // Clear existing tasks
        const taskLists = document.querySelectorAll('.task-list');
        taskLists.forEach(list => {
            list.innerHTML = '';
        });

        // Filter tasks by project if needed
        let filteredTasks = this.tasks;
        if (this.currentProjectFilter !== 'all') {
            filteredTasks = this.tasks.filter(task => task.project === this.currentProjectFilter);
        }

        // Group tasks by status
        const tasksByStatus = {
            pending: [],
            in_progress: [],
            in_testing: [],
            completed: []
        };

        filteredTasks.forEach(task => {
            if (tasksByStatus[task.status]) {
                tasksByStatus[task.status].push(task);
            }
        });

        // Render tasks in each column
        Object.keys(tasksByStatus).forEach(status => {
            let tasks = tasksByStatus[status];
            const container = document.getElementById(`${status}-tasks`);
            const count = document.getElementById(`${status}-count`);
            
            // Sort tasks by creation date according to the current sort direction
            tasks = this.sortTasksByCreatedDate(tasks, this.sortDirections[status]);
            
            count.textContent = tasks.length;

            if (tasks.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i data-lucide="inbox"></i>
                        <p>No tasks ${status.replace('_', ' ')}</p>
                    </div>
                `;
            } else {
                tasks.forEach(task => {
                    const taskElement = this.createTaskElement(task);
                    container.appendChild(taskElement);
                });
            }
        });

        // Re-initialize icons for new elements
        this.initializeLucideIcons();
        
        // Update sort button states
        Object.keys(this.sortDirections).forEach(status => {
            const button = document.querySelector(`.sort-button[data-status="${status}"]`);
            if (button) {
                button.classList.remove('sort-asc', 'sort-desc');
                button.classList.add(`sort-${this.sortDirections[status]}`);
                const direction = this.sortDirections[status] === 'asc' ? 'descending' : 'ascending';
                button.title = `Sort by creation date (${direction})`;
            }
        });
    }

    createTaskElement(task) {
        const taskCard = document.createElement('div');
        taskCard.className = 'task-card';
        taskCard.draggable = true;
        taskCard.dataset.taskId = task.id;

        // Create terminal selector
        const terminalSelector = `
            <select class="task-terminal-selector" data-task-id="${task.id}" onchange="kanban.updateTaskTerminal(${task.id}, this.value)">
                <option value="">No terminal</option>
                <option value="1" ${task.terminal_id == 1 ? 'selected' : ''}>Terminal 1</option>
                <option value="2" ${task.terminal_id == 2 ? 'selected' : ''}>Terminal 2</option>
                <option value="3" ${task.terminal_id == 3 ? 'selected' : ''}>Terminal 3</option>
                <option value="4" ${task.terminal_id == 4 ? 'selected' : ''}>Terminal 4</option>
            </select>
        `;

        const createdDate = new Date(task.created_at).toLocaleDateString();
        
        // Get project info
        let projectTag = '';
        if (task.project) {
            const project = this.projects.find(p => p.name === task.project) || 
                           { name: task.project, display_name: task.project, color: '#007ACC' };
            const displayName = project.display_name || project.name;
            const gradient = this.getProjectGradient(project.color);
            projectTag = `<span class="task-project-tag" style="background: ${gradient}">
                <span class="project-name">${this.escapeHtml(displayName)}</span>
            </span>`;
        }

        taskCard.innerHTML = `
            <div class="task-actions">
                <button class="task-action-btn" onclick="kanban.editTask(${task.id})" title="Edit Task">
                    <i data-lucide="edit-3"></i>
                </button>
                <button class="task-action-btn task-action-delete" onclick="kanban.quickDeleteTask(${task.id})" title="Delete Task">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
            ${projectTag}
            <div class="task-title">
                <span class="task-id">#${task.id}</span> 
                <span class="task-title-text" contenteditable="true" data-task-id="${task.id}" onblur="kanban.updateTaskTitle(${task.id}, this.textContent)" onkeydown="kanban.handleTitleKeydown(event, ${task.id})">${this.escapeHtml(task.title)}</span>
            </div>
            ${task.description ? `<div class="task-description">${this.escapeHtml(task.description)}</div>` : ''}
            <div class="task-meta">
                <span>${createdDate}</span>
                ${terminalSelector}
            </div>
        `;

        // Add drag event listeners
        taskCard.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', task.id);
            e.dataTransfer.effectAllowed = 'move';
            
            // Store references
            this.draggingElement = taskCard;
            this.originalNextSibling = taskCard.nextSibling;
            this.originalParent = taskCard.parentNode;
            
            // Create placeholder
            this.placeholder = document.createElement('div');
            this.placeholder.className = 'task-card placeholder';
            this.placeholder.style.height = taskCard.offsetHeight + 'px';
            this.placeholder.style.marginBottom = '0.75rem';
            this.placeholder.innerHTML = '';
            
            // Don't insert placeholder yet - wait for first dragover
            
            // Add dragging class immediately
            taskCard.classList.add('dragging');
        });

        taskCard.addEventListener('dragend', (e) => {
            taskCard.classList.remove('dragging');
            
            // Stop auto-scroll
            this.stopAutoScroll();
            
            // Clean up placeholder if still exists
            if (this.placeholder && this.placeholder.parentNode) {
                this.placeholder.parentNode.removeChild(this.placeholder);
            }
            
            // Show empty states again for all truly empty columns
            const allLists = document.querySelectorAll('.task-list');
            allLists.forEach(list => {
                const realTasks = list.querySelectorAll('.task-card:not(.placeholder):not(.dragging)');
                if (realTasks.length === 0) {
                    const emptyState = list.querySelector('.empty-state');
                    if (emptyState) {
                        emptyState.style.display = '';
                    }
                }
            });
            
            // Reset all references
            this.placeholder = null;
            this.draggingElement = null;
            this.originalNextSibling = null;
            this.originalParent = null;
            this.lastPlaceholderPosition = null;
            this.dragoverThrottle = null;
        });

        // Add click listener
        taskCard.addEventListener('click', (e) => {
            // Don't open details if clicking on editable elements
            if (e.target.closest('.task-actions') || 
                e.target.closest('.task-title-text') || 
                e.target.closest('.task-terminal-selector')) {
                return;
            }
            this.showTaskDetails(task.id);
        });

        return taskCard;
    }

    showCreateTaskModal() {
        this.editingTaskId = null;
        document.getElementById('modal-title').textContent = 'Create New Task';
        document.getElementById('task-title').value = '';
        document.getElementById('task-description').value = '';
        document.getElementById('task-plan').value = '';
        document.getElementById('task-implementation').value = '';
        
        // Use the currently selected project filter as default, or let user choose
        const projectSelect = document.getElementById('task-project');
        if (this.currentProjectFilter && this.currentProjectFilter !== 'all') {
            projectSelect.value = this.currentProjectFilter;
        } else {
            // If "All Projects" is selected, default to empty (no project)
            projectSelect.value = '';
        }
        
        document.getElementById('task-terminal').value = '';
        document.getElementById('save-task-btn').textContent = 'Save Task';
        document.getElementById('task-modal').classList.add('show');
        document.getElementById('task-title').focus();
    }

    showEditTaskModal(task) {
        this.editingTaskId = task.id;
        document.getElementById('modal-title').textContent = 'Edit Task';
        document.getElementById('task-title').value = task.title;
        document.getElementById('task-description').value = task.description || '';
        document.getElementById('task-plan').value = task.plan || '';
        document.getElementById('task-implementation').value = task.implementation || '';
        document.getElementById('task-project').value = task.project || '';
        document.getElementById('task-terminal').value = task.terminal_id || '';
        document.getElementById('save-task-btn').textContent = 'Update Task';
        document.getElementById('task-modal').classList.add('show');
        document.getElementById('task-title').focus();
    }

    hideTaskModal() {
        document.getElementById('task-modal').classList.remove('show');
        this.editingTaskId = null;
    }

    async saveTask() {
        const title = document.getElementById('task-title').value.trim();
        const description = document.getElementById('task-description').value.trim();
        const plan = document.getElementById('task-plan').value.trim();
        const implementation = document.getElementById('task-implementation').value.trim();
        const project = document.getElementById('task-project').value;
        const terminalIdValue = document.getElementById('task-terminal').value;
        let terminalId = null;
        if (terminalIdValue !== '') {
            terminalId = parseInt(terminalIdValue);
            // Validate terminal ID (must be between 1 and 4)
            if (isNaN(terminalId) || terminalId < 1 || terminalId > 4) {
                alert('Terminal ID must be between 1 and 4');
                return;
            }
        }

        if (!title) {
            alert('Task title is required');
            return;
        }

        try {
            let result;
            
            if (this.editingTaskId) {
                // Update existing task
                result = await ipcRenderer.invoke('task-update', this.editingTaskId, title, description, project);
                
                // Update plan separately
                if (result.success) {
                    const planResult = await ipcRenderer.invoke('task-update-plan', this.editingTaskId, plan);
                    if (!planResult.success) {
                        console.error('Failed to update plan:', planResult.error);
                    }
                }

                // Update implementation separately
                if (result.success) {
                    const implementationResult = await ipcRenderer.invoke('task-update-implementation', this.editingTaskId, implementation);
                    if (!implementationResult.success) {
                        console.error('Failed to update implementation:', implementationResult.error);
                    }
                }
                
                // If terminal ID was provided and the update was successful, update terminal separately
                if (result.success && terminalId !== undefined) {
                    const terminalResult = await ipcRenderer.invoke('task-update-terminal', this.editingTaskId, terminalId);
                    if (!terminalResult.success) {
                        console.error('Failed to update terminal ID:', terminalResult.error);
                    }
                }
            } else {
                // Create new task
                result = await ipcRenderer.invoke('task-create', title, description, terminalId, project);
                
                // Update plan for new task
                if (result.success && plan) {
                    const planResult = await ipcRenderer.invoke('task-update-plan', result.taskId, plan);
                    if (!planResult.success) {
                        console.error('Failed to update plan for new task:', planResult.error);
                    }
                }

                // Update implementation for new task
                if (result.success && implementation) {
                    const implementationResult = await ipcRenderer.invoke('task-update-implementation', result.taskId, implementation);
                    if (!implementationResult.success) {
                        console.error('Failed to update implementation for new task:', implementationResult.error);
                    }
                }
            }

            if (result.success) {
                this.hideTaskModal();
                await this.loadTasks();
                
                if (!this.editingTaskId) {
                    // Show notification for new task
                    this.showNotification('Task created successfully', 'success');
                }
            } else {
                alert(`Failed to save task: ${result.error}`);
            }
        } catch (error) {
            console.error('Error saving task:', error);
            alert('Error saving task');
        }
    }

    async showTaskDetails(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        this.currentTask = task;

        document.getElementById('details-title').textContent = task.title;
        document.getElementById('details-description').textContent = task.description || 'No description';
        document.getElementById('details-plan').textContent = task.plan || 'No plan set';
        document.getElementById('details-implementation').textContent = task.implementation || 'No implementation details';
        
        const statusText = task.status.replace('_', ' ').toUpperCase();
        const terminalText = task.terminal_id !== null && task.terminal_id > 0 ? `Terminal ${parseInt(task.terminal_id)}` : 'No specific terminal';
        const createdText = new Date(task.created_at).toLocaleString();
        
        document.getElementById('details-status').textContent = `Status: ${statusText}`;
        document.getElementById('details-terminal').textContent = terminalText;
        document.getElementById('details-created').textContent = `Created: ${createdText}`;

        // Reset plan and implementation editing modes
        this.hidePlanEditMode();
        this.hideImplementationEditMode();

        // Show/hide delete button based on status
        const deleteBtn = document.getElementById('delete-task-btn');
        deleteBtn.style.display = task.status === 'in_progress' ? 'none' : 'block';

        document.getElementById('task-details-modal').classList.add('show');
    }

    // Focus on a specific task (called from IPC)
    async focusTask(taskId) {
        console.log('focusTask called with taskId:', taskId);
        console.log('Current tasks:', this.tasks);
        
        // Find the task element in the DOM
        const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
        console.log('Found task element:', taskElement);
        
        if (taskElement) {
            // Scroll the task into view
            taskElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Add a highlight effect
            taskElement.classList.add('task-focused');
            
            // Remove the highlight after animation
            setTimeout(() => {
                taskElement.classList.remove('task-focused');
            }, 2000);
        }
        
        // Show task details modal
        await this.showTaskDetails(taskId);
    }

    hideTaskDetailsModal() {
        document.getElementById('task-details-modal').classList.remove('show');
        this.currentTask = null;
    }

    editCurrentTask() {
        if (this.currentTask) {
            const taskToEdit = this.currentTask; // Store reference before hiding modal
            this.hideTaskDetailsModal();
            this.showEditTaskModal(taskToEdit);
        }
    }

    async deleteCurrentTask() {
        if (!this.currentTask) return;

        if (this.currentTask.status === 'in_progress') {
            alert('Cannot delete task in progress');
            return;
        }

        const confirmed = confirm(`Are you sure you want to delete "${this.currentTask.title}"?`);
        if (!confirmed) return;

        try {
            const result = await ipcRenderer.invoke('task-delete', this.currentTask.id);
            if (result.success) {
                this.hideTaskDetailsModal();
                await this.loadTasks();
                this.showNotification('Task deleted successfully', 'success');
            } else {
                alert(`Failed to delete task: ${result.error}`);
            }
        } catch (error) {
            console.error('Error deleting task:', error);
            alert('Error deleting task');
        }
    }

    async updateTaskStatus(taskId, newStatus) {
        try {
            const result = await ipcRenderer.invoke('task-update-status', parseInt(taskId), newStatus);
            if (result.success) {
                // Update local data without reloading
                const task = this.tasks.find(t => t.id === parseInt(taskId));
                if (task) {
                    const oldStatus = task.status;
                    task.status = newStatus;
                    task.updated_at = new Date().toISOString();
                    
                    // Update counts
                    this.updateColumnCounts();
                    
                    // Notifications removed for cleaner UX
                }
            } else {
                alert(`Failed to update task status: ${result.error}`);
                await this.loadTasks(); // Reload to reset UI
            }
        } catch (error) {
            console.error('Error updating task status:', error);
            await this.loadTasks(); // Reload to reset UI
        }
    }

    async updateTaskTerminal(taskId, terminalId) {
        try {
            // Convert empty string to null for no terminal
            const terminalValue = terminalId === '' ? null : parseInt(terminalId);
            
            const result = await ipcRenderer.invoke('task-update-terminal', taskId, terminalValue);
            
            if (result.success) {
                // Update local task data
                const task = this.tasks.find(t => t.id === taskId);
                if (task) {
                    task.terminal_id = terminalValue;
                }
                
                this.showNotification(`Terminal updated successfully`, 'success');
            } else {
                // Revert the select to previous value
                await this.loadTasks();
                this.showNotification(`Failed to update terminal: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error updating task terminal:', error);
            await this.loadTasks();
            this.showNotification('Error updating terminal', 'error');
        }
    }

    async updateTaskTitle(taskId, newTitle) {
        const trimmedTitle = newTitle.trim();
        
        // Find the task to get original title
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        // If title hasn't changed, do nothing
        if (trimmedTitle === task.title) return;
        
        // If title is empty, revert to original
        if (!trimmedTitle) {
            const titleElement = document.querySelector(`[data-task-id="${taskId}"].task-title-text`);
            if (titleElement) {
                titleElement.textContent = task.title;
            }
            return;
        }
        
        try {
            const result = await ipcRenderer.invoke('task-update', taskId, {
                title: trimmedTitle
            });
            
            if (result.success) {
                // Update local task data
                task.title = trimmedTitle;
                this.showNotification('Title updated successfully', 'success');
            } else {
                // Revert to original title
                const titleElement = document.querySelector(`[data-task-id="${taskId}"].task-title-text`);
                if (titleElement) {
                    titleElement.textContent = task.title;
                }
                this.showNotification(`Failed to update title: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error updating task title:', error);
            // Revert to original title
            const titleElement = document.querySelector(`[data-task-id="${taskId}"].task-title-text`);
            if (titleElement) {
                titleElement.textContent = task.title;
            }
            this.showNotification('Error updating title', 'error');
        }
    }

    handleTitleKeydown(event, taskId) {
        // Handle Enter key
        if (event.key === 'Enter') {
            event.preventDefault();
            event.target.blur(); // This will trigger the onblur event
        }
        
        // Handle Escape key
        if (event.key === 'Escape') {
            event.preventDefault();
            const task = this.tasks.find(t => t.id === taskId);
            if (task) {
                event.target.textContent = task.title;
                event.target.blur();
            }
        }
    }


    async quickDeleteTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        // Quick confirmation
        if (!confirm(`Delete "${task.title}"?`)) return;

        try {
            const result = await ipcRenderer.invoke('task-delete', taskId);
            if (result.success) {
                await this.loadTasks();
                this.showNotification('Task deleted successfully', 'success');
            } else {
                this.showNotification(`Failed to delete task: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error deleting task:', error);
            this.showNotification('Error deleting task', 'error');
        }
    }

    editTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (task) {
            this.showEditTaskModal(task);
        }
    }

    showNotification(message, type = 'info') {
        // You can implement a toast notification system here
        // For now, we'll use a simple console log
        console.log(`${type.toUpperCase()}: ${message}`);
        
        // Show in-app notification
        if (type === 'error') {
            // Create a temporary error notification
            const notification = document.createElement('div');
            notification.className = 'notification notification-error';
            notification.textContent = message;
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #dc3545;
                color: white;
                padding: 12px 20px;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                z-index: 10000;
                animation: slideIn 0.3s ease;
            `;
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }, 3000);
        } else if (type === 'success') {
            ipcRenderer.send('show-desktop-notification', 'Task Update', message);
        }
    }
    
    showCreateProjectDialog() {
        // Reset form
        document.getElementById('project-name').value = '';
        document.getElementById('project-path').value = '';
        document.getElementById('color-1').checked = true;
        document.getElementById('project-modal').classList.add('show');
        document.getElementById('project-name').focus();
        // Apply gradients to color options
        setTimeout(() => this.initializeColorGradients(), 0);
    }

    hideProjectModal() {
        document.getElementById('project-modal').classList.remove('show');
    }

    async saveProject() {
        const projectName = document.getElementById('project-name').value.trim();
        const projectPath = document.getElementById('project-path').value.trim();
        const selectedColor = document.querySelector('input[name="project-color"]:checked')?.value;

        if (!projectName) {
            // Focus on empty field
            document.getElementById('project-name').focus();
            return;
        }
        
        if (!projectPath) {
            this.showNotification('Please select a project directory', 'error');
            return;
        }

        // Prevent double submission
        const saveButton = document.getElementById('save-project-btn');
        if (saveButton.disabled) {
            return;
        }
        saveButton.disabled = true;

        try {
            const result = await ipcRenderer.invoke('project-create', projectName, selectedColor, projectPath);
            if (result.success) {
                this.hideProjectModal();
                // Reload projects
                await this.loadProjects();
                // Select the new project in task form if modal is open
                const taskProjectSelect = document.getElementById('task-project');
                if (taskProjectSelect) {
                    taskProjectSelect.value = projectName;
                }
                const message = result.alreadyExists 
                    ? `Project "${projectName}" already existed, folder association updated`
                    : `Project "${projectName}" created successfully`;
                this.showNotification(message, 'success');
            } else {
                // Show error inline instead of alert
                this.showNotification(`Failed to create project: ${result.error}`, 'error');
                saveButton.disabled = false;
            }
        } catch (error) {
            console.error('Error creating project:', error);
            this.showNotification('Error creating project', 'error');
            saveButton.disabled = false;
        } finally {
            // Ensure button is re-enabled after operation completes
            const saveButton = document.getElementById('save-project-btn');
            if (saveButton) {
                saveButton.disabled = false;
            }
        }
    }
    
    editProjectName(projectName) {
        const project = this.projects.find(p => p.name === projectName);
        if (!project) return;
        
        this.editingProjectName = projectName;
        const currentDisplayName = project.display_name || project.name;
        document.getElementById('project-edit-name').value = currentDisplayName;
        
        // Set current project path
        document.getElementById('project-edit-path').value = project.path || '';
        
        // Set current color in radio buttons
        const colorRadios = document.querySelectorAll('input[name="project-edit-color"]');
        colorRadios.forEach(radio => {
            radio.checked = radio.value === project.color;
        });
        
        document.getElementById('project-edit-modal').classList.add('show');
        document.getElementById('project-edit-name').focus();
        // Apply gradients to color options
        setTimeout(() => this.initializeColorGradients(), 0);
    }

    hideProjectEditModal() {
        document.getElementById('project-edit-modal').classList.remove('show');
        this.editingProjectName = null;
    }

    async saveProjectEdit() {
        if (!this.editingProjectName) return;

        const newDisplayName = document.getElementById('project-edit-name').value.trim();
        if (!newDisplayName) {
            document.getElementById('project-edit-name').focus();
            return;
        }

        const newPath = document.getElementById('project-edit-path').value.trim();
        if (!newPath) {
            this.showNotification('Project path is required', 'error');
            return;
        }

        const selectedColor = document.querySelector('input[name="project-edit-color"]:checked')?.value;

        try {
            // Update display name
            const nameResult = await ipcRenderer.invoke('project-update-display-name', this.editingProjectName, newDisplayName);
            
            // Update path
            let pathResult = { success: true };
            const currentProject = this.projects.find(p => p.name === this.editingProjectName);
            if (currentProject && currentProject.path !== newPath) {
                pathResult = await ipcRenderer.invoke('project-update-path', this.editingProjectName, newPath);
            }
            
            // Update color if selected
            let colorResult = { success: true };
            if (selectedColor) {
                colorResult = await ipcRenderer.invoke('project-update-color', this.editingProjectName, selectedColor);
            }
            
            if (nameResult.success && pathResult.success && colorResult.success) {
                this.hideProjectEditModal();
                // Reload projects and tasks to update UI
                await this.loadProjects();
                await this.loadTasks();
                this.showNotification(`Project updated successfully`, 'success');
            } else {
                let error = '';
                if (!nameResult.success) error = nameResult.error;
                else if (!pathResult.success) error = pathResult.error;
                else if (!colorResult.success) error = colorResult.error;
                this.showNotification(`Failed to update project: ${error}`, 'error');
            }
        } catch (error) {
            console.error('Error updating project:', error);
            this.showNotification('Error updating project', 'error');
        }
    }
    
    async deleteProject() {
        if (!this.editingProjectName) return;
        
        const project = this.projects.find(p => p.name === this.editingProjectName);
        if (!project) return;
        
        const confirmed = confirm(`Are you sure you want to delete the project "${project.display_name || project.name}"?\n\nThis will NOT delete tasks associated with this project.`);
        if (!confirmed) return;
        
        try {
            const result = await ipcRenderer.invoke('project-delete', this.editingProjectName);
            if (result.success) {
                this.hideProjectEditModal();
                
                // Reset filter if we're viewing the deleted project
                if (this.currentProjectFilter === this.editingProjectName) {
                    this.currentProjectFilter = 'all';
                    document.getElementById('project-filter-select').value = 'all';
                }
                
                // Reload projects and tasks
                await this.loadProjects();
                await this.loadTasks();
                this.showNotification(`Project deleted successfully`, 'success');
            } else {
                this.showNotification(`Failed to delete project: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error deleting project:', error);
            this.showNotification('Error deleting project', 'error');
        }
    }

    getProjectGradient(color) {
        // Map solid colors to modern gradients
        const gradients = {
            '#007ACC': 'linear-gradient(135deg, #007ACC 0%, #0098FF 100%)', // Blue
            '#00C853': 'linear-gradient(135deg, #00C853 0%, #00E676 100%)', // Green
            '#FF6B6B': 'linear-gradient(135deg, #FF6B6B 0%, #FF8787 100%)', // Red
            '#FFA726': 'linear-gradient(135deg, #FFA726 0%, #FFB74D 100%)', // Orange
            '#AB47BC': 'linear-gradient(135deg, #AB47BC 0%, #BA68C8 100%)', // Purple
            '#26A69A': 'linear-gradient(135deg, #26A69A 0%, #4DB6AC 100%)', // Teal
            '#EC407A': 'linear-gradient(135deg, #EC407A 0%, #F06292 100%)', // Pink
            '#7E57C2': 'linear-gradient(135deg, #7E57C2 0%, #9575CD 100%)'  // Deep Purple
        };
        
        return gradients[color] || `linear-gradient(135deg, ${color} 0%, ${color} 100%)`;
    }

    setupSortingButtons() {
        const sortButtons = document.querySelectorAll('.sort-button');
        sortButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const status = button.dataset.status;
                this.toggleSort(status);
            });
        });
    }

    toggleSort(status) {
        // Toggle sort direction
        this.sortDirections[status] = this.sortDirections[status] === 'asc' ? 'desc' : 'asc';
        
        // Update button appearance
        const button = document.querySelector(`.sort-button[data-status="${status}"]`);
        if (button) {
            button.classList.remove('sort-asc', 'sort-desc');
            button.classList.add(`sort-${this.sortDirections[status]}`);
            
            // Update tooltip
            const direction = this.sortDirections[status] === 'asc' ? 'descending' : 'ascending';
            button.title = `Sort by creation date (${direction})`;
        }
        
        // Re-render tasks with new sorting
        this.renderTasks();
    }

    sortTasksByCreatedDate(tasks, direction) {
        return tasks.sort((a, b) => {
            const dateA = new Date(a.created_at);
            const dateB = new Date(b.created_at);
            
            if (direction === 'asc') {
                return dateA - dateB; // Oldest first
            } else {
                return dateB - dateA; // Newest first
            }
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showPlanEditMode() {
        if (!this.currentTask) return;
        
        document.getElementById('details-plan-content').style.display = 'none';
        document.getElementById('edit-plan-section').style.display = 'block';
        document.getElementById('edit-plan-textarea').value = this.currentTask.plan || '';
        document.getElementById('edit-plan-textarea').focus();
    }

    hidePlanEditMode() {
        document.getElementById('details-plan-content').style.display = 'block';
        document.getElementById('edit-plan-section').style.display = 'none';
    }

    async savePlan() {
        if (!this.currentTask) return;
        
        const plan = document.getElementById('edit-plan-textarea').value.trim();
        
        try {
            const result = await ipcRenderer.invoke('task-update-plan', this.currentTask.id, plan);
            if (result.success) {
                this.currentTask.plan = plan;
                document.getElementById('details-plan').textContent = plan || 'No plan set';
                this.hidePlanEditMode();
                await this.loadTasks(); // Refresh the task list
                this.showNotification('Plan updated successfully', 'success');
            } else {
                alert(`Failed to update plan: ${result.error}`);
            }
        } catch (error) {
            console.error('Error updating plan:', error);
            alert('Error updating plan');
        }
    }

    showImplementationEditMode() {
        if (!this.currentTask) return;
        
        document.getElementById('details-implementation-content').style.display = 'none';
        document.getElementById('edit-implementation-section').style.display = 'block';
        document.getElementById('edit-implementation-textarea').value = this.currentTask.implementation || '';
        document.getElementById('edit-implementation-textarea').focus();
    }

    hideImplementationEditMode() {
        document.getElementById('details-implementation-content').style.display = 'block';
        document.getElementById('edit-implementation-section').style.display = 'none';
    }

    async saveImplementation() {
        if (!this.currentTask) return;
        
        const implementation = document.getElementById('edit-implementation-textarea').value.trim();
        
        try {
            const result = await ipcRenderer.invoke('task-update-implementation', this.currentTask.id, implementation);
            if (result.success) {
                this.currentTask.implementation = implementation;
                document.getElementById('details-implementation').textContent = implementation || 'No implementation details';
                this.hideImplementationEditMode();
                await this.loadTasks(); // Refresh the task list
                this.showNotification('Implementation updated successfully', 'success');
            } else {
                alert(`Failed to update implementation: ${result.error}`);
            }
        } catch (error) {
            console.error('Error updating implementation:', error);
            alert('Error updating implementation');
        }
    }
}

// Initialize Kanban when page loads
let kanban;
document.addEventListener('DOMContentLoaded', () => {
    kanban = new KanbanManager();
});

// Handle window keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
            case 'n':
                e.preventDefault();
                if (kanban) kanban.showCreateTaskModal();
                break;
            case 'w':
                e.preventDefault();
                window.close();
                break;
        }
    }
    
    if (e.key === 'Escape') {
        const modals = document.querySelectorAll('.modal.show');
        if (modals.length > 0) {
            // If there are open modals, close them
            modals.forEach(modal => modal.classList.remove('show'));
        } else {
            // If no modals are open, close the task manager window
            window.close();
        }
    }
});

// Store task ID to focus on when kanban is ready
let pendingFocusTaskId = null;

// Handle focus-task IPC message from main window
ipcRenderer.on('focus-task', (event, taskId) => {
    console.log('Received focus-task event with taskId:', taskId);
    if (kanban && kanban.tasks.length > 0) {
        kanban.focusTask(taskId);
    } else {
        console.log('Kanban not ready yet, storing taskId for later');
        pendingFocusTaskId = taskId;
    }
});
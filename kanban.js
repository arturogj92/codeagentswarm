const { ipcRenderer } = require('electron');

class KanbanManager {
    constructor() {
        this.tasks = [];
        this.currentTask = null;
        this.editingTaskId = null;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.initializeLucideIcons();
        await this.loadTasks();
    }

    initializeLucideIcons() {
        // Initialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
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

        // Drag and drop
        this.setupDragAndDrop();
    }

    setupDragAndDrop() {
        const taskLists = document.querySelectorAll('.task-list');
        
        taskLists.forEach(list => {
            list.addEventListener('dragover', (e) => {
                e.preventDefault();
                list.classList.add('drag-over');
                
                // Handle reordering within the same column
                const draggingCard = document.querySelector('.dragging');
                if (draggingCard) {
                    const afterElement = this.getDragAfterElement(list, e.clientY);
                    if (afterElement == null) {
                        list.appendChild(draggingCard);
                    } else {
                        list.insertBefore(draggingCard, afterElement);
                    }
                    
                    // Auto-scroll when dragging near the edges
                    this.handleAutoScroll(list, e.clientY);
                }
            });

            list.addEventListener('dragleave', (e) => {
                if (!list.contains(e.relatedTarget)) {
                    list.classList.remove('drag-over');
                }
            });

            list.addEventListener('drop', async (e) => {
                e.preventDefault();
                list.classList.remove('drag-over');
                
                const taskId = e.dataTransfer.getData('text/plain');
                const newStatus = list.id.replace('-tasks', '');
                const draggedTask = this.tasks.find(t => t.id == taskId);
                
                // Check if the status changed or just reordered
                if (draggedTask && draggedTask.status !== newStatus) {
                    // Status changed - update task status
                    await this.updateTaskStatus(taskId, newStatus);
                } else {
                    // Just reordered within the same column - update order
                    await this.updateTaskOrder(list, newStatus);
                }
            });
        });
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.task-card:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    handleAutoScroll(list, clientY) {
        const scrollThreshold = 50; // pixels from edge to trigger scroll
        const scrollSpeed = 10; // pixels per scroll
        const listRect = list.getBoundingClientRect();
        
        // Check if we're near the top of the list
        if (clientY - listRect.top < scrollThreshold) {
            list.scrollTop = Math.max(0, list.scrollTop - scrollSpeed);
        }
        
        // Check if we're near the bottom of the list
        if (listRect.bottom - clientY < scrollThreshold) {
            list.scrollTop = Math.min(list.scrollHeight - list.clientHeight, list.scrollTop + scrollSpeed);
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
                }
            }
        } catch (error) {
            console.error('Error updating task order:', error);
            await this.loadTasks();
        }
    }

    async loadTasks() {
        try {
            const result = await ipcRenderer.invoke('task-get-all');
            if (result.success) {
                this.tasks = result.tasks;
                this.renderTasks();
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

        // Group tasks by status
        const tasksByStatus = {
            pending: [],
            in_progress: [],
            in_testing: [],
            completed: []
        };

        this.tasks.forEach(task => {
            if (tasksByStatus[task.status]) {
                tasksByStatus[task.status].push(task);
            }
        });

        // Render tasks in each column
        Object.keys(tasksByStatus).forEach(status => {
            let tasks = tasksByStatus[status];
            const container = document.getElementById(`${status}-tasks`);
            const count = document.getElementById(`${status}-count`);
            
            // Sort completed tasks by updated_at (most recent first)
            if (status === 'completed') {
                tasks = tasks.sort((a, b) => {
                    const dateA = new Date(a.updated_at);
                    const dateB = new Date(b.updated_at);
                    return dateB - dateA; // Descending order (most recent first)
                });
            }
            
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
    }

    createTaskElement(task) {
        const taskCard = document.createElement('div');
        taskCard.className = 'task-card';
        taskCard.draggable = true;
        taskCard.dataset.taskId = task.id;

        const terminalInfo = task.terminal_id !== null && task.terminal_id > 0 ? 
            `<span class="task-terminal">Terminal ${parseInt(task.terminal_id)}</span>` : '';

        const createdDate = new Date(task.created_at).toLocaleDateString();

        taskCard.innerHTML = `
            <div class="task-actions">
                <button class="task-action-btn" onclick="kanban.showTaskDetails(${task.id})" title="View Details">
                    <i data-lucide="eye"></i>
                </button>
            </div>
            <div class="task-title">${this.escapeHtml(task.title)}</div>
            ${task.description ? `<div class="task-description">${this.escapeHtml(task.description)}</div>` : ''}
            <div class="task-meta">
                <span>${createdDate}</span>
                ${terminalInfo}
            </div>
        `;

        // Add drag event listeners
        taskCard.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', task.id);
            taskCard.classList.add('dragging');
        });

        taskCard.addEventListener('dragend', () => {
            taskCard.classList.remove('dragging');
        });

        // Add click listener
        taskCard.addEventListener('click', (e) => {
            if (!e.target.closest('.task-actions')) {
                this.showTaskDetails(task.id);
            }
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
                result = await ipcRenderer.invoke('task-update', this.editingTaskId, title, description);
                
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
                result = await ipcRenderer.invoke('task-create', title, description, terminalId);
                
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
                await this.loadTasks();
                
                const task = this.tasks.find(t => t.id === parseInt(taskId));
                if (task) {
                    if (newStatus === 'in_testing') {
                        this.showNotification(`Task "${task.title}" ready for testing!`, 'success');
                    } else if (newStatus === 'completed') {
                        this.showNotification(`Task "${task.title}" completed!`, 'success');
                    }
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

    showNotification(message, type = 'info') {
        // You can implement a toast notification system here
        // For now, we'll use a simple console log
        console.log(`${type.toUpperCase()}: ${message}`);
        
        // Optionally show desktop notification
        if (type === 'success') {
            ipcRenderer.send('show-desktop-notification', 'Task Update', message);
        }
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

// Handle focus-task IPC message from main window
ipcRenderer.on('focus-task', (event, taskId) => {
    if (kanban) {
        kanban.focusTask(taskId);
    }
});
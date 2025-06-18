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
                
                await this.updateTaskStatus(taskId, newStatus);
            });
        });
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
            completed: []
        };

        this.tasks.forEach(task => {
            if (tasksByStatus[task.status]) {
                tasksByStatus[task.status].push(task);
            }
        });

        // Render tasks in each column
        Object.keys(tasksByStatus).forEach(status => {
            const tasks = tasksByStatus[status];
            const container = document.getElementById(`${status}-tasks`);
            const count = document.getElementById(`${status}-count`);
            
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

        const terminalInfo = task.terminal_id !== null ? 
            `<span class="task-terminal">Terminal ${parseInt(task.terminal_id) + 1}</span>` : '';

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
        const terminalId = document.getElementById('task-terminal').value || null;

        if (!title) {
            alert('Task title is required');
            return;
        }

        try {
            let result;
            
            if (this.editingTaskId) {
                // Update existing task
                result = await ipcRenderer.invoke('task-update', this.editingTaskId, title, description);
            } else {
                // Create new task
                result = await ipcRenderer.invoke('task-create', title, description, terminalId);
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
        
        const statusText = task.status.replace('_', ' ').toUpperCase();
        const terminalText = task.terminal_id !== null ? `Terminal ${parseInt(task.terminal_id) + 1}` : 'No specific terminal';
        const createdText = new Date(task.created_at).toLocaleString();
        
        document.getElementById('details-status').textContent = `Status: ${statusText}`;
        document.getElementById('details-terminal').textContent = terminalText;
        document.getElementById('details-created').textContent = `Created: ${createdText}`;

        // Show/hide delete button based on status
        const deleteBtn = document.getElementById('delete-task-btn');
        deleteBtn.style.display = task.status === 'in_progress' ? 'none' : 'block';

        document.getElementById('task-details-modal').classList.add('show');
    }

    hideTaskDetailsModal() {
        document.getElementById('task-details-modal').classList.remove('show');
        this.currentTask = null;
    }

    editCurrentTask() {
        if (this.currentTask) {
            this.hideTaskDetailsModal();
            this.showEditTaskModal(this.currentTask);
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
                    if (newStatus === 'completed') {
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
        modals.forEach(modal => modal.classList.remove('show'));
    }
});
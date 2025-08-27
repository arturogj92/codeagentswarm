const { ipcRenderer } = require('electron');
const path = require('path');
 
class KanbanManager {
    constructor() {
        this.tasks = [];
        this.projects = [];
        this.currentTask = null;
        this.currentProjectFilter = 'all';
        this.searchQuery = '';
        this.searchDebounceTimer = null;
        this.isSelectingDirectory = false;
        
        // Performance optimizations
        this.taskIndex = new Map(); // Quick task lookup by ID
        this.subtaskIndex = new Map(); // Parent ID -> subtask IDs mapping
        
        // Pagination configuration for each column
        this.paginationConfig = {
            pending: {
                initialLimit: 50,      // Show 50 tasks initially
                increment: 30,         // Load 30 more each time
                currentLimit: 50       // Track current limit
            },
            in_progress: {
                initialLimit: 50,      // Show 50 tasks initially
                increment: 30,         // Load 30 more each time
                currentLimit: 50       // Track current limit
            },
            in_testing: {
                initialLimit: 50,      // Show 50 tasks initially
                increment: 30,         // Load 30 more each time
                currentLimit: 50       // Track current limit
            },
            completed: {
                initialLimit: 30,      // Show 30 tasks initially (less because there are many)
                increment: 30,         // Load 30 more each time
                currentLimit: 30       // Track current limit
            }
        };
        
        // Store all tasks by status for pagination
        this.allTasksByStatus = {
            pending: [],
            in_progress: [],
            in_testing: [],
            completed: []
        };
        
        this.sortStates = {
            pending: 'default',
            in_progress: 'default',
            in_testing: 'default',
            completed: 'default'
        };
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.initializeLucideIcons();
        this.initializeColorGradients();
        
        // Check for preloaded data first
        const usePreloadedData = await this.checkForPreloadedData();
        
        if (!usePreloadedData) {
            // Load data normally if no preloaded data
            await this.loadProjects();
            await this.loadTasks(true); // Show skeletons on initial load
        }
    }
    
    checkForPreloadedData() {
        return new Promise((resolve) => {
            // Set a timeout to wait for preloaded data
            let dataReceived = false;
            
            const preloadHandler = (event, data) => {
                if (data && data.tasks && data.projects) {
                    dataReceived = true;
                    // Use preloaded data
                    this.tasks = data.tasks;
                    this.projects = data.projects;
                    
                    // CRITICAL: Build indexes for preloaded data (was missing!)
                    this.taskIndex.clear();
                    this.subtaskIndex.clear();
                    
                    for (const task of this.tasks) {
                        this.taskIndex.set(task.id, task);
                        
                        if (task.parent_task_id) {
                            if (!this.subtaskIndex.has(task.parent_task_id)) {
                                this.subtaskIndex.set(task.parent_task_id, []);
                            }
                            this.subtaskIndex.get(task.parent_task_id).push(task.id);
                        }
                    }
                    
                    // Update UI immediately
                    this.updateProjectSelects();
                    this.renderTasks();
                    
                    // Remove listener
                    ipcRenderer.removeListener('preloaded-data', preloadHandler);
                    resolve(true);
                }
            };
            
            // Listen for preloaded data
            ipcRenderer.once('preloaded-data', preloadHandler);
            
            // Wait max 100ms for preloaded data, then load normally
            setTimeout(() => {
                if (!dataReceived) {
                    ipcRenderer.removeListener('preloaded-data', preloadHandler);
                    resolve(false);
                }
            }, 100);
        });
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
        // Search functionality
        const searchInput = document.getElementById('search-input');
        const clearSearchBtn = document.getElementById('clear-search-btn');
        
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            
            // Show/hide clear button immediately
            if (query) {
                clearSearchBtn.style.display = 'flex';
            } else {
                clearSearchBtn.style.display = 'none';
                document.getElementById('search-results-count').style.display = 'none';
            }
            
            // Clear existing timer
            if (this.searchDebounceTimer) {
                clearTimeout(this.searchDebounceTimer);
            }
            
            // Set new timer for debounced search (300ms delay)
            this.searchDebounceTimer = setTimeout(() => {
                this.searchQuery = query;
                this.renderTasks();
                
                // Update results count after rendering
                const resultsCount = document.getElementById('search-results-count');
                if (this.searchQuery) {
                    const filteredCount = this.getFilteredTasksCount();
                    resultsCount.textContent = `${filteredCount}`;
                    resultsCount.style.display = 'inline-block';
                } else {
                    resultsCount.style.display = 'none';
                }
            }, 300);
        });
        
        clearSearchBtn.addEventListener('click', () => {
            // Clear any pending search
            if (this.searchDebounceTimer) {
                clearTimeout(this.searchDebounceTimer);
            }
            
            this.searchQuery = '';
            searchInput.value = '';
            clearSearchBtn.style.display = 'none';
            document.getElementById('search-results-count').style.display = 'none';
            
            // Reset pagination for all columns when clearing search
            Object.keys(this.paginationConfig).forEach(status => {
                this.paginationConfig[status].currentLimit = this.paginationConfig[status].initialLimit;
            });
            
            this.renderTasks();
        });
        
        // Add keyboard shortcut for search (Cmd/Ctrl + F)
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            }
        });
        
        // Header buttons
        document.getElementById('add-task-btn').addEventListener('click', () => {
            this.showCreateTaskModal();
        });

        document.getElementById('back-to-terminal-btn').addEventListener('click', () => {
            window.close();
        });

        // Modal controls are now handled by TaskModal component

        // Task details modal
        document.getElementById('details-modal-close-btn').addEventListener('click', () => {
            this.hideTaskDetailsModal();
        });

        document.getElementById('close-details-btn').addEventListener('click', () => {
            this.hideTaskDetailsModal();
        });

        // Create Subtask button
        document.getElementById('create-subtask-btn').addEventListener('click', () => {
            this.openSubtaskModal();
        });

        // Link Existing Task button
        document.getElementById('link-subtask-btn').addEventListener('click', () => {
            this.openLinkTaskModal();
        });
        
        // Unlink Parent button - using event delegation since button might not exist yet
        document.addEventListener('click', (e) => {
            if (e.target.id === 'unlink-parent-btn' || e.target.closest('#unlink-parent-btn')) {
                e.preventDefault();
                e.stopPropagation();
                this.unlinkParentTask();
            }
        });

        // Subtask modal handlers
        document.getElementById('close-subtask-modal').addEventListener('click', () => {
            this.closeSubtaskModal();
        });

        document.getElementById('cancel-subtask-btn').addEventListener('click', () => {
            this.closeSubtaskModal();
        });

        document.getElementById('create-subtask-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.createSubtask();
        });

        // Close subtask modal when clicking outside
        document.getElementById('subtask-modal').addEventListener('click', (e) => {
            if (e.target.id === 'subtask-modal') {
                this.closeSubtaskModal();
            }
        });

        // Link task modal handlers
        document.getElementById('close-link-task-modal').addEventListener('click', () => {
            this.closeLinkTaskModal();
        });

        document.getElementById('cancel-link-task-btn').addEventListener('click', () => {
            this.closeLinkTaskModal();
        });

        document.getElementById('confirm-link-task-btn').addEventListener('click', async () => {
            await this.linkSelectedTask();
        });

        // Close link task modal when clicking outside
        document.getElementById('link-task-modal').addEventListener('click', (e) => {
            if (e.target.id === 'link-task-modal') {
                this.closeLinkTaskModal();
            }
        });

        // Link task search functionality
        this.setupLinkTaskSearch();

        // Edit button removed - now using inline editing

        document.getElementById('delete-task-btn').addEventListener('click', () => {
            this.deleteCurrentTask();
        });

        // Plan editing controls - Check if elements exist before adding listeners
        const editPlanBtn = document.getElementById('edit-plan-btn');
        if (editPlanBtn) {
            editPlanBtn.addEventListener('click', () => {
                this.showPlanEditMode();
            });
        }

        const savePlanBtn = document.getElementById('save-plan-btn');
        if (savePlanBtn) {
            savePlanBtn.addEventListener('click', () => {
                this.savePlan();
            });
        }

        const cancelPlanBtn = document.getElementById('cancel-plan-btn');
        if (cancelPlanBtn) {
            cancelPlanBtn.addEventListener('click', () => {
                this.hidePlanEditMode();
            });
        }

        // Implementation editing controls - Check if elements exist before adding listeners
        const editImplBtn = document.getElementById('edit-implementation-btn');
        if (editImplBtn) {
            editImplBtn.addEventListener('click', () => {
                this.showImplementationEditMode();
            });
        }

        const saveImplBtn = document.getElementById('save-implementation-btn');
        if (saveImplBtn) {
            saveImplBtn.addEventListener('click', () => {
                this.saveImplementation();
            });
        }

        const cancelImplBtn = document.getElementById('cancel-implementation-btn');
        if (cancelImplBtn) {
            cancelImplBtn.addEventListener('click', () => {
                this.hideImplementationEditMode();
            });
        }

        // Status change controls
        document.getElementById('status-display').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleStatusDropdown();
        });

        // Handle status option clicks
        document.querySelectorAll('.status-option').forEach(option => {
            option.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newStatus = option.getAttribute('data-value');
                await this.changeTaskStatus(newStatus);
            });
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.task-status-header')) {
                this.hideStatusDropdown();
            }
        });

        // Form submission is now handled by TaskModal component
        
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

        // Click outside to close dropdowns
        document.addEventListener('click', (e) => {
            // Close terminal dropdowns
            if (!e.target.closest('.task-terminal-wrapper')) {
                document.querySelectorAll('.terminal-dropdown').forEach(dropdown => {
                    if (dropdown.style.display === 'block') {
                        dropdown.style.display = 'none';
                        
                        // Restore overflow for the card
                        const taskCard = dropdown.closest('.task-card');
                        const taskList = taskCard?.closest('.task-list');
                        const kanbanColumn = taskList?.closest('.kanban-column');
                        
                        if (taskCard) {
                            taskCard.style.overflow = '';
                            taskCard.style.zIndex = '';
                        }
                        if (taskList) taskList.style.overflow = '';
                        if (kanbanColumn) kanbanColumn.style.overflow = '';
                    }
                });
            }
            
            // Close send to terminal dropdowns
            if (!e.target.closest('.send-to-terminal-wrapper')) {
                document.querySelectorAll('.send-terminal-dropdown').forEach(dropdown => {
                    if (dropdown.style.display === 'block') {
                        dropdown.style.display = 'none';
                        
                        // Restore overflow for the card
                        const wrapper = dropdown.closest('.send-to-terminal-wrapper');
                        const taskCard = wrapper?.closest('.task-card');
                        const taskList = taskCard?.closest('.task-list');
                        const kanbanColumn = taskList?.closest('.kanban-column');
                        
                        const dropdownIcon = wrapper?.querySelector('.dropdown-icon');
                        if (dropdownIcon) dropdownIcon.style.transform = '';
                        
                        if (taskCard) {
                            taskCard.style.overflow = '';
                            taskCard.style.zIndex = '';
                        }
                        if (taskList) taskList.style.overflow = '';
                        if (kanbanColumn) kanbanColumn.style.overflow = '';
                    }
                });
            }
        });

        // Modal backdrop clicks are now handled by TaskModal component

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
        
        // Filter tasks by project if needed
        let filteredTasks = this.tasks;
        if (this.currentProjectFilter !== 'all') {
            filteredTasks = this.tasks.filter(task => task.project === this.currentProjectFilter);
        }
        
        // Apply search filter if present
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filteredTasks = filteredTasks.filter(task => {
                if (task.title && task.title.toLowerCase().includes(query)) return true;
                if (task.description && task.description.toLowerCase().includes(query)) return true;
                if (task.plan && task.plan.toLowerCase().includes(query)) return true;
                if (task.implementation && task.implementation.toLowerCase().includes(query)) return true;
                if (task.id && task.id.toString().includes(query)) return true;
                return false;
            });
        }
        
        statuses.forEach(status => {
            const count = filteredTasks.filter(t => t.status === status).length;
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
        
        // Update task form select (if it exists - now handled by TaskModal component)
        const taskSelect = document.getElementById('task-project');
        if (taskSelect) {
            taskSelect.innerHTML = '<option value="">No Project</option>';
        }
        
        this.projects.forEach(project => {
            // Use display_name if available, otherwise fall back to name
            const displayName = project.display_name || project.name;
            
            // Add to filter
            const filterOption = document.createElement('option');
            filterOption.value = project.name;
            filterOption.textContent = displayName;
            filterOption.style.color = project.color;
            filterSelect.appendChild(filterOption);
            
            // Add to task form (if it exists)
            if (taskSelect) {
                const taskOption = document.createElement('option');
                taskOption.value = project.name;
                taskOption.textContent = displayName;
                taskOption.style.color = project.color;
                taskSelect.appendChild(taskOption);
            }
        });
        
        
        // Set default project if none selected
        if (taskSelect && taskSelect.options.length > 1 && !taskSelect.value) {
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

    showSkeletons() {
        // Show skeleton loaders in all columns
        const skeletonContainers = document.querySelectorAll('.skeleton-container');
        skeletonContainers.forEach(skeleton => {
            skeleton.classList.add('show');
        });
    }

    async loadTasks(showLoading = false) {
        // Only show skeletons during initial load or when explicitly requested
        if (showLoading) {
            this.showSkeletons();
        }
        
        try {
            const result = await ipcRenderer.invoke('task-get-all');
            if (result.success) {
                this.tasks = result.tasks;
                
                // Debug: Check how many subtasks are in the loaded tasks
                const subtasksInTasks = this.tasks.filter(t => t.parent_task_id !== null);
                console.log('Total tasks loaded:', this.tasks.length);
                console.log('Subtasks in loaded tasks:', subtasksInTasks.length);
                
                // Build indexes for faster lookups
                this.taskIndex.clear();
                this.subtaskIndex.clear();
                
                for (const task of this.tasks) {
                    this.taskIndex.set(task.id, task);
                    
                    if (task.parent_task_id) {
                        if (!this.subtaskIndex.has(task.parent_task_id)) {
                            this.subtaskIndex.set(task.parent_task_id, []);
                        }
                        this.subtaskIndex.get(task.parent_task_id).push(task.id);
                    }
                }
                
                console.log('Subtask index built:', Array.from(this.subtaskIndex.entries()).map(([parent, children]) => 
                    `Parent ${parent}: ${children.length} children`
                ));
                
                this.renderTasks();
                
                // Check if there's a pending task to focus
                if (pendingFocusTaskId) {

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
        // Hide skeleton loaders and clear existing tasks
        const taskLists = document.querySelectorAll('.task-list');
        taskLists.forEach(list => {
            // Hide skeleton containers
            const skeletonContainers = list.querySelectorAll('.skeleton-container');
            skeletonContainers.forEach(skeleton => {
                skeleton.classList.remove('show');
            });
            
            // Remove task cards and empty states, preserve skeleton containers
            const taskCards = list.querySelectorAll('.task-card');
            taskCards.forEach(card => card.remove());
            const emptyStates = list.querySelectorAll('.empty-state');
            emptyStates.forEach(state => state.remove());
        });

        // Filter tasks by project if needed
        let filteredTasks = this.tasks;
        if (this.currentProjectFilter !== 'all') {
            filteredTasks = this.tasks.filter(task => task.project === this.currentProjectFilter);
        }
        
        // Filter by search query if present
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filteredTasks = filteredTasks.filter(task => {
                // Search in title
                if (task.title && task.title.toLowerCase().includes(query)) return true;
                // Search in description
                if (task.description && task.description.toLowerCase().includes(query)) return true;
                // Search in plan
                if (task.plan && task.plan.toLowerCase().includes(query)) return true;
                // Search in implementation
                if (task.implementation && task.implementation.toLowerCase().includes(query)) return true;
                // Search in task ID
                if (task.id && task.id.toString().includes(query)) return true;
                return false;
            });
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
        
        // Store all tasks by status for pagination
        Object.keys(tasksByStatus).forEach(status => {
            this.allTasksByStatus[status] = tasksByStatus[status];
        });

        // Render tasks in each column
        Object.keys(tasksByStatus).forEach(status => {
            let tasks = tasksByStatus[status];
            const container = document.getElementById(`${status}-tasks`);
            const count = document.getElementById(`${status}-count`);
            
            // Sort tasks by creation date according to the current sort direction
            tasks = this.sortTasksByCreatedDate(tasks, this.sortStates[status]);
            
            // Always show the real total count
            count.textContent = tasks.length;
            
            // Apply pagination only if not searching
            let tasksToDisplay = tasks;
            let showLoadMore = false;
            const config = this.paginationConfig[status];
            
            if (!this.searchQuery && tasks.length > config.currentLimit) {
                // Take only the first N tasks
                tasksToDisplay = tasks.slice(0, config.currentLimit);
                showLoadMore = true;
            }
            
            if (tasksToDisplay.length === 0) {
                let emptyMessage = 'No tasks ' + status.replace('_', ' ');
                if (this.searchQuery) {
                    emptyMessage = 'No matching tasks found';
                }
                container.innerHTML = `
                    <div class="empty-state">
                        <i data-lucide="inbox"></i>
                        <p>${emptyMessage}</p>
                    </div>
                `;
            } else {
                // Clear container first (removes any existing Load More buttons)
                container.innerHTML = '';
                
                // Add tasks
                tasksToDisplay.forEach(task => {
                    const taskElement = this.createTaskElement(task);
                    container.appendChild(taskElement);
                });
                
                // Add Load More button if needed
                if (showLoadMore) {
                    const remainingTasks = tasks.length - config.currentLimit;
                    const loadMoreBtn = document.createElement('div');
                    loadMoreBtn.className = 'load-more-container';
                    loadMoreBtn.innerHTML = `
                        <button class="load-more-btn" onclick="kanban.loadMoreTasks('${status}')">
                            <i data-lucide="chevron-down"></i>
                            Load ${Math.min(remainingTasks, config.increment)} more
                            <span class="remaining-count">(${remainingTasks} remaining)</span>
                        </button>
                    `;
                    container.appendChild(loadMoreBtn);
                }
            }
        });

        // Re-initialize icons for new elements
        this.initializeLucideIcons();
        
        // Update sort button states
        Object.keys(this.sortStates).forEach(status => {
            const button = document.querySelector(`.sort-button[data-status="${status}"]`);
            if (button) {
                button.classList.remove('sort-default', 'sort-asc', 'sort-desc');
                button.classList.add(`sort-${this.sortStates[status]}`);
                
                // Update icon
                const icon = button.querySelector('i');
                if (icon) {
                    switch(this.sortStates[status]) {
                        case 'default':
                            icon.setAttribute('data-lucide', 'arrow-up-down');
                            break;
                        case 'desc':
                            icon.setAttribute('data-lucide', 'arrow-down');
                            break;
                        case 'asc':
                            icon.setAttribute('data-lucide', 'arrow-up');
                            break;
                    }
                }
                
                // Update tooltip
                let tooltipText = '';
                switch(this.sortStates[status]) {
                    case 'default':
                        tooltipText = 'Sin ordenar (orden manual)';
                        break;
                    case 'desc':
                        tooltipText = 'Ordenado: Más recientes primero';
                        break;
                    case 'asc':
                        tooltipText = 'Ordenado: Más antiguos primero';
                        break;
                }
                button.title = tooltipText;
            }
        });
    }

    createTaskElement(task) {
        const taskCard = document.createElement('div');
        taskCard.className = 'task-card';
        taskCard.draggable = true;
        taskCard.dataset.taskId = task.id;

        // Add parent indicator to terminal wrapper if task has parent
        let parentIndicatorInActions = '';
        if (task.parent_task_id) {
            const parentTask = this.tasks.find(t => t.id === task.parent_task_id);
            if (parentTask) {
                parentIndicatorInActions = `
                    <span class="task-hierarchy-indicator parent-indicator clickable in-actions" 
                          onclick="kanban.showTaskDetails(${parentTask.id}); event.stopPropagation();" 
                          title="Subtask of: ${this.escapeHtml(this.capitalizeFirstLetter(parentTask.title))} (Click to view)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="6" x2="6" y1="3" y2="15"></line>
                            <circle cx="18" cy="6" r="3"></circle>
                            <circle cx="6" cy="18" r="3"></circle>
                            <path d="M18 9a9 9 0 0 1-9 9"></path>
                        </svg>
                        <span class="parent-ref">#${parentTask.id}</span>
                    </span>
                `;
            }
        }

        // Create terminal icon with dropdown and send button
        const terminalIcon = `
            <div class="task-terminal-wrapper">
                ${parentIndicatorInActions}
                <button class="task-action-btn task-action-delete" onclick="kanban.quickDeleteTask(${task.id})" title="Delete Task">
                    <i data-lucide="trash-2"></i>
                </button>
                <div class="send-to-terminal-icon" onclick="kanban.toggleSendToTerminalDropdown(event, ${task.id}); return false;" title="Send task to terminal">
                    <i data-lucide="send"></i>
                </div>
                <div class="task-terminal-badge ${task.terminal_id ? '' : 'unassigned'}" 
                     onclick="kanban.toggleTerminalDropdown(event, ${task.id}); return false;" 
                     title="${task.terminal_id ? `Terminal ${task.terminal_id}` : 'Assign to terminal'}">
                    ${task.terminal_id ? `<i data-lucide="terminal"></i><span class="terminal-number">${task.terminal_id}</span>` : '<i data-lucide="plus"></i>'}
                </div>
                <div class="terminal-dropdown" id="terminal-dropdown-${task.id}" style="display: none;">
                    <div class="terminal-option ${!task.terminal_id ? 'active' : ''}" onclick="kanban.selectTerminal(${task.id}, null); return false;">
                        <i data-lucide="x-circle"></i> None
                    </div>
                    <div class="terminal-option ${task.terminal_id == 1 ? 'active' : ''}" onclick="kanban.selectTerminal(${task.id}, 1); return false;">
                        <i data-lucide="terminal"></i> Terminal 1
                    </div>
                    <div class="terminal-option ${task.terminal_id == 2 ? 'active' : ''}" onclick="kanban.selectTerminal(${task.id}, 2); return false;">
                        <i data-lucide="terminal"></i> Terminal 2
                    </div>
                    <div class="terminal-option ${task.terminal_id == 3 ? 'active' : ''}" onclick="kanban.selectTerminal(${task.id}, 3); return false;">
                        <i data-lucide="terminal"></i> Terminal 3
                    </div>
                    <div class="terminal-option ${task.terminal_id == 4 ? 'active' : ''}" onclick="kanban.selectTerminal(${task.id}, 4); return false;">
                        <i data-lucide="terminal"></i> Terminal 4
                    </div>
                    <div class="terminal-option ${task.terminal_id == 5 ? 'active' : ''}" onclick="kanban.selectTerminal(${task.id}, 5); return false;">
                        <i data-lucide="terminal"></i> Terminal 5
                    </div>
                    <div class="terminal-option ${task.terminal_id == 6 ? 'active' : ''}" onclick="kanban.selectTerminal(${task.id}, 6); return false;">
                        <i data-lucide="terminal"></i> Terminal 6
                    </div>
                </div>
                <div class="send-terminal-dropdown" id="send-terminal-dropdown-${task.id}" style="display: none;">
                    <!-- Dropdown will be populated dynamically -->
                </div>
            </div>
        `;

        const createdDate = new Date(task.created_at).toLocaleDateString();
        
        // Get project info - always show a badge
        let projectTag = '';
        if (task.project) {
            const project = this.projects.find(p => p.name === task.project) || 
                           { name: task.project, display_name: task.project, color: '#007ACC' };
            const displayName = project.display_name || project.name;
            const gradient = this.getProjectGradient(project.color);
            projectTag = `<span class="task-project-tag" style="background: ${gradient}">
                <span class="project-name">${this.escapeHtml(displayName)}</span>
            </span>`;
        } else {
            // Show "no project" badge when task has no project
            const gradient = 'linear-gradient(135deg, #666666 0%, #4a4a4a 100%)';
            projectTag = `<span class="task-project-tag no-project" style="background: ${gradient}; opacity: 0.7;">
                <span class="project-name">no project</span>
            </span>`;
        }

        // Create parent/subtask indicators
        let hierarchyIndicators = '';
        
        // Only add subtask indicator to header (parent moved to actions)
        // Check if this task has subtasks - use the same index method as the modal for consistency
        const subtaskIds = this.subtaskIndex.get(task.id) || [];
        const subtaskCount = subtaskIds.filter(id => this.taskIndex.has(id)).length;
        
        if (subtaskCount > 0) {
            hierarchyIndicators += `
                <span class="task-hierarchy-indicator subtask-indicator" title="${subtaskCount} subtask${subtaskCount > 1 ? 's' : ''}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="18" cy="18" r="3"></circle>
                        <circle cx="6" cy="6" r="3"></circle>
                        <path d="M6 21V9a9 9 0 0 0 9 9"></path>
                    </svg>
                    <span class="subtask-count">${subtaskCount}</span>
                </span>
            `;
        }

        taskCard.innerHTML = `
            <div class="task-header">
                ${projectTag}
                ${hierarchyIndicators}
                <div class="task-header-right">
                    <span class="task-id">#${task.id}</span>
                </div>
            </div>
            <div class="task-title">
                <span class="task-title-text" data-task-id="${task.id}">${this.escapeHtml(this.capitalizeFirstLetter(task.title))}</span>
            </div>
            ${task.description ? `<div class="task-description">${this.escapeHtml(task.description)}</div>` : ''}
            <div class="task-meta">
                <span class="task-date">${createdDate}</span>
                ${terminalIcon}
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

        // Add optimized click listener with immediate feedback
        taskCard.addEventListener('click', (e) => {
            // Don't open details if clicking on editable elements
            if (e.target.closest('.task-actions') || 
                e.target.closest('.task-title-text') || 
                e.target.closest('.task-terminal-wrapper')) {
                return;
            }
            
            // Show modal IMMEDIATELY for instant feedback
            const modal = document.getElementById('task-details-modal');
            if (modal) {
                // Pre-populate title and ID for instant visual feedback
                const titleEl = document.getElementById('details-title');
                const idEl = document.getElementById('header-task-id');
                const statusEl = document.getElementById('details-status-text');
                
                if (titleEl) titleEl.value = task.title || '';
                if (idEl) idEl.textContent = `#${task.id}`;
                if (statusEl) statusEl.textContent = task.status.replace('_', ' ').toUpperCase();
                
                // Show modal instantly
                modal.classList.add('show');
                
                // Quick visual feedback on the card
                taskCard.style.transform = 'scale(0.98)';
                setTimeout(() => {
                    taskCard.style.transform = '';
                }, 100);
            }
            
            // Load full details asynchronously without blocking
            setTimeout(() => {
                this.showTaskDetails(task.id);
            }, 0);
        });

        return taskCard;
    }

    showCreateTaskModal() {
        // Use the TaskModal component
        if (typeof window.TaskModal !== 'undefined') {
            const modal = new window.TaskModal({
                projects: this.projects,
                onSave: async (taskData) => {
                    // Create the task using the new format
                    await this.createTaskFromModal(taskData);
                },
                onCancel: () => {

                }
            });
            modal.show();
        } else {
            console.error('TaskModal component not found');
            // Fallback: show error message
            this.showNotification('Error: Task creation modal not available', 'error');
        }
    }

    async createTaskFromModal(taskData) {
        try {
            // Validate terminal ID if provided
            if (taskData.terminal_id) {
                const terminalId = parseInt(taskData.terminal_id);
                if (isNaN(terminalId) || terminalId < 1 || terminalId > 6) {
                    await ipcRenderer.invoke('show-alert-dialog', {
                        type: 'warning',
                        title: 'Invalid Terminal ID',
                        message: 'Terminal ID must be between 1 and 6'
                    });
                    return;
                }
            }

            // Create the task
            const result = await ipcRenderer.invoke('task-create', {
                title: taskData.title,
                description: taskData.description || '',
                plan: taskData.plan || '',
                implementation: taskData.implementation || '',
                status: taskData.status || 'pending',
                project: taskData.project || null,
                parent_task_id: taskData.parent_task_id || null,
                terminal_id: taskData.terminal_id || null
            });

            if (result.success) {
                this.showNotification('Task created successfully', 'success');
                this.loadTasks(); // Reload tasks
            } else {
                throw new Error(result.error || 'Failed to create task');
            }
        } catch (error) {
            console.error('Error creating task:', error);
            await ipcRenderer.invoke('show-alert-dialog', {
                type: 'error',
                title: 'Error',
                message: `Failed to create task: ${error.message}`
            });
        }
    }

    initializeDetailsParentTaskSearch(currentTask) {
        const searchInput = document.getElementById('details-parent-search');
        const hiddenInput = document.getElementById('details-parent');
        const dropdown = document.getElementById('details-parent-dropdown');
        
        if (!searchInput || !hiddenInput || !dropdown) return;
        
        // Set current parent if exists
        if (currentTask.parent_task_id) {
            const parentTask = this.tasks.find(t => t.id === currentTask.parent_task_id);
            if (parentTask) {
                searchInput.value = `#${parentTask.id} - ${parentTask.title}`;
                hiddenInput.value = currentTask.parent_task_id;
            }
        } else {
            searchInput.value = '';
            hiddenInput.value = '';
        }
        
        // Remove any existing event listeners to prevent duplicates
        const newSearchInput = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(newSearchInput, searchInput);
        
        // Helper function to check if taskId is a descendant of current task
        const isDescendant = (taskId, ancestorId) => {
            if (!ancestorId) return false;
            const task = this.tasks.find(t => t.id === taskId);
            if (!task) return false;
            if (task.parent_task_id === ancestorId) return true;
            return isDescendant(task.parent_task_id, ancestorId);
        };
        
        // Function to filter and display tasks
        const filterTasks = (query) => {
            dropdown.innerHTML = '';
            
            // Add "No parent" option
            const noParentDiv = document.createElement('div');
            noParentDiv.className = 'parent-task-item no-parent';
            noParentDiv.setAttribute('data-task-id', '');
            noParentDiv.innerHTML = `<strong>No parent (standalone task)</strong>`;
            noParentDiv.addEventListener('click', () => {
                newSearchInput.value = '';
                hiddenInput.value = '';
                dropdown.style.display = 'none';
            });
            dropdown.appendChild(noParentDiv);
            
            // Filter tasks based on query
            const queryLower = query.toLowerCase();
            const filteredTasks = this.tasks.filter(task => {
                // Skip the current task itself and its descendants
                if (task.id === currentTask.id || isDescendant(task.id, currentTask.id)) {
                    return false;
                }
                
                // Match by ID or title
                const idMatch = task.id.toString().includes(queryLower);
                const titleMatch = task.title.toLowerCase().includes(queryLower);
                return idMatch || titleMatch;
            });
            
            // Limit to first 20 results
            filteredTasks.slice(0, 20).forEach(task => {
                const taskDiv = document.createElement('div');
                taskDiv.className = 'parent-task-item';
                taskDiv.setAttribute('data-task-id', task.id);
                
                const project = task.project ? this.projects.find(p => p.name === task.project) : null;
                const projectColor = project ? project.color : '#666';
                
                taskDiv.innerHTML = `
                    <span class="task-id">#${task.id}</span>
                    <span class="task-title">${this.escapeHtml(task.title)}</span>
                    ${task.project ? `<span class="task-project" style="background: ${projectColor}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.85em;">${this.escapeHtml(task.project)}</span>` : ''}
                `;
                
                taskDiv.addEventListener('click', () => {
                    newSearchInput.value = `#${task.id} - ${task.title}`;
                    hiddenInput.value = task.id;
                    dropdown.style.display = 'none';
                    
                    // Mark that we're manually saving to prevent auto-save
                    this.skipNextParentAutoSave = true;
                    
                    // Trigger save immediately when parent is selected
                    this.autoSaveParentTask(task.id);
                });
                
                dropdown.appendChild(taskDiv);
            });
            
            if (filteredTasks.length > 20) {
                const moreDiv = document.createElement('div');
                moreDiv.className = 'parent-task-item';
                moreDiv.style.textAlign = 'center';
                moreDiv.style.fontStyle = 'italic';
                moreDiv.style.opacity = '0.5';
                moreDiv.textContent = `...and ${filteredTasks.length - 20} more results`;
                dropdown.appendChild(moreDiv);
            }
            
            if (filteredTasks.length === 0 && query.length > 0) {
                const noResultsDiv = document.createElement('div');
                noResultsDiv.className = 'parent-task-item no-results';
                noResultsDiv.textContent = 'No tasks found';
                dropdown.appendChild(noResultsDiv);
            }
            
            dropdown.style.display = 'block';
        };
        
        // Event listeners
        let searchTimeout;
        newSearchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            const query = newSearchInput.value.trim();
            
            if (query.length < 2) {
                dropdown.style.display = 'none';
                return;
            }
            
            searchTimeout = setTimeout(() => {
                filterTasks(query);
            }, 300);
        });
        
        newSearchInput.addEventListener('focus', () => {
            const query = newSearchInput.value.trim();
            if (query.length >= 2) {
                filterTasks(query);
            }
        });
        
        // Click outside to close dropdown
        document.addEventListener('click', (e) => {
            if (!newSearchInput.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }

    async showTaskDetails(taskId) {
        // Use index for O(1) lookup instead of O(n) array search
        const task = this.taskIndex.get(taskId) || this.tasks.find(t => t.id === taskId);
        if (!task) return;

        this.currentTask = task;
        
        // Track if editors are already initialized for this modal
        if (!this.markdownEditorsInitialized) {
            this.markdownEditorsInitialized = false;
        }
        
        // Update only the most critical fields immediately
        const titleEl = document.getElementById('details-title');
        const descEl = document.getElementById('details-description');
        if (titleEl) titleEl.value = task.title;
        if (descEl) descEl.value = task.description || '';
        
        // Defer ALL other updates to avoid blocking
        setTimeout(() => {
            // Update remaining fields
            const planEl = document.getElementById('details-plan');
            const implEl = document.getElementById('details-implementation');
            if (planEl) planEl.value = task.plan || '';
            if (implEl) implEl.value = task.implementation || '';
            
            // Setup modal send icon
            this.setupModalSendIcon(taskId);
        }, 0);
        
        // Status with modern styling
        const statusText = task.status.replace('_', ' ').toUpperCase();
        const statusTextElement = document.getElementById('details-status-text');
        if (statusTextElement) {
            statusTextElement.textContent = statusText;
        }
        
        const statusDisplay = document.getElementById('status-display');
        if (statusDisplay) {
            statusDisplay.setAttribute('data-status', task.status);
            statusDisplay.className = `status-display-modern clickable status-${task.status}`;
            statusDisplay.classList.remove('dropdown-open');
        }
        
        const statusDropdown = document.getElementById('status-dropdown-menu');
        if (statusDropdown) {
            statusDropdown.style.display = 'none';
        }
        
        // Populate header meta information (will be set again below, removing duplicate)
        const headerTaskIdTop = document.getElementById('header-task-id');
        if (headerTaskIdTop) {
            headerTaskIdTop.textContent = `#${task.id}`;
        }
        
        // Parent task ID if exists
        const parentInfo = document.getElementById('header-parent-info');
        if (task.parent_task_id) {
            parentInfo.style.display = 'flex';
            document.getElementById('header-parent-id').textContent = `#${task.parent_task_id}`;
        } else {
            parentInfo.style.display = 'none';
        }
        
        // Project dropdown - ensure projects are loaded before setting value
        const headerProjectSelect = document.getElementById('header-project-select');
        if (headerProjectSelect) {
            // First populate the select with projects, then set the value
            this.populateProjectSelectHeader().then(() => {
                // After projects are loaded, set the correct value
                headerProjectSelect.value = task.project || '';
            });
            // Also set value immediately in case projects are already cached
            if (this.cachedProjects && this.cachedProjects.length > 0) {
                headerProjectSelect.value = task.project || '';
            }
        }
        
        // Terminal dropdown
        const headerTerminalSelect = document.getElementById('header-terminal-select');
        headerTerminalSelect.value = task.terminal_id ? task.terminal_id.toString() : '';
        
        // Created at for header
        const headerCreatedDate = new Date(task.created_at);
        const month = headerCreatedDate.toLocaleDateString('en-US', { month: 'short' });
        const day = headerCreatedDate.getDate();
        const time = headerCreatedDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        }).toLowerCase();
        document.getElementById('header-created-at').textContent = `${month} ${day}, ${time}`;
        
        // Parent task information
        const parentTaskInfo = document.getElementById('parent-task-info');
        const parentTaskLink = document.getElementById('parent-task-link');
        const unlinkParentBtn = document.getElementById('unlink-parent-btn');
        
        if (task.parent_task_id) {
            const parentTask = this.tasks.find(t => t.id === task.parent_task_id);
            if (parentTask) {
                parentTaskInfo.style.display = 'block';
                parentTaskLink.innerHTML = `
                    <a href="#" onclick="kanban.showTaskDetails(${parentTask.id}); return false;" class="parent-task-link">
                        <span class="task-id-badge">#${parentTask.id}</span>
                        <span class="parent-task-title">${this.escapeHtml(parentTask.title)}</span>
                        <i data-lucide="arrow-right"></i>
                    </a>
                `;
                // Show unlink button when there's a parent
                if (unlinkParentBtn) {
                    unlinkParentBtn.style.display = 'flex';
                }
            } else {
                parentTaskInfo.style.display = 'none';
            }
        } else {
            parentTaskInfo.style.display = 'none';
            // Hide unlink button when there's no parent
            if (unlinkParentBtn) {
                unlinkParentBtn.style.display = 'none';
            }
        }
        
        // Initialize parent task search for details modal
        this.initializeDetailsParentTaskSearch(task);
        
        // Subtasks information - defer rendering for better initial performance
        const subtasksSection = document.getElementById('subtasks-section');
        const subtasksList = document.getElementById('subtasks-list');
        
        if (subtasksSection) {
            // Always show the subtasks section for the Create Subtask button
            subtasksSection.style.display = 'block';
            
            // Store current task ID for subtask creation
            this.currentDetailTaskId = task.id;
            
            // Render subtasks asynchronously to not block initial modal display
            if (subtasksList) {
                // Show loading state immediately
                subtasksList.innerHTML = '<div class="no-subtasks" style="color: #888; text-align: center; padding: 2rem;">Loading...</div>';
                
                // Function to render subtasks
                const renderSubtasks = () => {
                    // Use index for O(1) lookup instead of O(n) filter
                    const subtaskIds = this.subtaskIndex.get(task.id) || [];
                    const subtasks = subtaskIds.map(id => this.taskIndex.get(id)).filter(Boolean);
                    
                    if (subtasks.length > 0) {
                        subtasksList.innerHTML = subtasks.map(subtask => {
                            // Remove project badge - not needed in subtasks
                            let projectBadge = '';
                            
                            return `
                            <div class="subtask-item">
                                <a href="#" onclick="kanban.showTaskDetails(${subtask.id}); return false;" class="subtask-link">
                                    <div class="subtask-header">
                                        <span class="task-id-badge">#${subtask.id}</span>
                                        <span class="subtask-status status-${subtask.status}">${subtask.status.replace('_', ' ')}</span>
                                        <button class="subtask-unlink-btn" onclick="event.stopPropagation(); event.preventDefault(); kanban.unlinkSubtask(${subtask.id}, ${task.id}); return false;" title="Unlink subtask">
                                            <svg class="no-lucide" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"></path>
                                                <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"></path>
                                                <line x1="8" x2="8" y1="2" y2="5"></line>
                                                <line x1="2" x2="5" y1="8" y2="8"></line>
                                                <line x1="16" x2="16" y1="19" y2="22"></line>
                                                <line x1="19" x2="22" y1="16" y2="16"></line>
                                            </svg>
                                        </button>
                                        <button class="subtask-delete-btn" onclick="event.stopPropagation(); event.preventDefault(); kanban.deleteSubtask(${subtask.id}, ${task.id}); return false;" title="Delete subtask">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <polyline points="3 6 5 6 21 6"></polyline>
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                                <line x1="14" y1="11" x2="14" y2="17"></line>
                                            </svg>
                                        </button>
                                    </div>
                                    <div class="subtask-title">${this.escapeHtml(this.capitalizeFirstLetter(subtask.title))}</div>
                                </a>
                            </div>
                            `;
                        }).join('');
                    } else {
                        subtasksList.innerHTML = '<div class="no-subtasks" style="color: #888; text-align: center; padding: 2rem; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 150px; font-style: italic; width: 100%; grid-column: 1 / -1;">No subtasks yet. Click "Create Subtask" to add one.</div>';
                    }
                };
                
                // Wait a bit for projects to load, then render
                setTimeout(() => {
                    renderSubtasks();
                }, 100);
                
                // Also render immediately in case projects are already loaded
                if (this.projects && this.projects.length > 0) {
                    requestAnimationFrame(() => {
                        renderSubtasks();
                    });
                }
            }
        }
        
        // Project and terminal information
        // Populate project dropdown asynchronously without blocking
        this.populateProjectSelect().then(() => {
            const projectSelect = document.getElementById('header-project-select');
            if (projectSelect) {
                projectSelect.value = task.project || '';
            }
        });
        
        // Terminal information - set the dropdown value
        const terminalSelect = document.getElementById('header-terminal-select');
        if (terminalSelect) {
            terminalSelect.value = task.terminal_id ? task.terminal_id.toString() : '';
        }
        
        const terminalText = task.terminal_id !== null && task.terminal_id > 0 
            ? `Terminal ${parseInt(task.terminal_id)}` 
            : 'Not assigned';
        
        // Timestamps
        const createdDate = new Date(task.created_at);
        const updatedDate = new Date(task.updated_at);
        
        // Created timestamp in header
        const headerCreatedAt = document.getElementById('header-created-at');
        if (headerCreatedAt) {
            headerCreatedAt.textContent = createdDate.toLocaleString();
        }
        
        // Legacy terminal and created fields (for backward compatibility)
        const detailsTerminal = document.getElementById('details-terminal');
        if (detailsTerminal) {
            detailsTerminal.textContent = terminalText;
        }
        
        const detailsCreated = document.getElementById('details-created');
        if (detailsCreated) {
            detailsCreated.textContent = `Created: ${createdDate.toLocaleString()}`;
        }

        // Reset plan and implementation editing modes
        this.hidePlanEditMode();
        this.hideImplementationEditMode();

        // Show/hide delete button based on status
        const deleteBtn = document.getElementById('delete-task-btn');
        deleteBtn.style.display = task.status === 'in_progress' ? 'none' : 'block';
        
        // Get modal element once
        const modalElement = document.getElementById('task-details-modal');
        
        // Show modal if not already shown (in case called directly, not from click)
        if (modalElement && !modalElement.classList.contains('show')) {
            modalElement.classList.add('show');
        }
        
        // Initialize Lucide icons ONLY when browser is idle to avoid blocking
        if (window.lucide && modalElement) {
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => {
                    window.lucide.createIcons({ 
                        el: modalElement,
                        icons: window.lucide.icons
                    });
                }, { timeout: 500 });
            } else {
                // Fallback with longer delay
                setTimeout(() => {
                    window.lucide.createIcons({ 
                        el: modalElement,
                        icons: window.lucide.icons
                    });
                }, 100);
            }
        }
        
        // Setup auto-save listeners after a delay to not block initial render
        requestIdleCallback(() => {
            this.setupAutoSaveListeners();
        }, { timeout: 100 });
        
        // Initialize markdown editors only once per modal lifetime
        if (typeof initializeMarkdownEditors === 'function' && !this.markdownEditorsInitialized) {
            this.markdownEditorsInitialized = true;
            // Use requestIdleCallback for non-critical initialization
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => initializeMarkdownEditors(), { timeout: 50 });
            } else {
                setTimeout(() => initializeMarkdownEditors(), 10);
            }
        }
    }

    // Focus on a specific task (called from IPC)
    async focusTask(taskId) {

        // Find the task element in the DOM
        const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);

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
        // Reset status dropdown
        this.hideStatusDropdown();
        // Clear parent value check interval if it exists
        if (this.parentValueCheckInterval) {
            clearInterval(this.parentValueCheckInterval);
            this.parentValueCheckInterval = null;
        }
        // Remove auto-save listeners
        this.removeAutoSaveListeners();
        // Reset markdown editors flag
        this.markdownEditorsInitialized = false;
    }

    openSubtaskModal() {
        const modal = document.getElementById('subtask-modal');
        if (!modal || !this.currentDetailTaskId) return;
        
        // Set parent task display
        const parentTask = this.tasks.find(t => t.id === this.currentDetailTaskId);
        if (parentTask) {
            document.getElementById('parent-task-display').textContent = 
                `#${parentTask.id} - ${parentTask.title}`;
        }
        
        // Clear form
        document.getElementById('subtask-title').value = '';
        document.getElementById('subtask-description').value = '';
        
        // Show modal
        modal.classList.add('show');
        
        // Focus on title input
        setTimeout(() => {
            document.getElementById('subtask-title').focus();
        }, 100);
    }

    closeSubtaskModal() {
        const modal = document.getElementById('subtask-modal');
        if (modal) {
            modal.classList.remove('show');
        }
    }

    async createSubtask() {
        const title = document.getElementById('subtask-title').value.trim();
        const description = document.getElementById('subtask-description').value.trim();
        
        if (!title) {
            this.showNotification('Please enter a subtask title', 'error');
            return;
        }
        
        if (!this.currentDetailTaskId) {
            this.showNotification('No parent task selected', 'error');
            return;
        }
        
        try {
            // Get parent task to inherit project
            const parentTask = this.tasks.find(t => t.id === this.currentDetailTaskId);
            
            console.log('Creating subtask with parent_task_id:', this.currentDetailTaskId);
            const result = await ipcRenderer.invoke('task-create-subtask', {
                title,
                description,
                parent_task_id: this.currentDetailTaskId,
                project: parentTask?.project || null
            });
            
            console.log('Subtask creation result:', result);
            
            if (result.success) {
                // Notification removed - no success message on subtask creation
                this.closeSubtaskModal();
                
                // Reload tasks and refresh the current task details
                await this.loadTasks();
                
                // Debug: Check if subtask is in the tasks array
                const newSubtask = this.tasks.find(t => t.id === result.taskId);
                console.log('New subtask found in tasks array:', newSubtask);
                console.log('Subtask parent_task_id:', newSubtask?.parent_task_id);
                console.log('Subtask index for parent:', this.subtaskIndex.get(this.currentDetailTaskId));
                
                // Refresh the task details view to show the new subtask
                if (this.currentDetailTaskId) {
                    await this.showTaskDetails(this.currentDetailTaskId);
                }
            } else {
                this.showNotification(result.error || 'Failed to create subtask', 'error');
            }
        } catch (error) {
            console.error('Error creating subtask:', error);
            this.showNotification('Failed to create subtask', 'error');
        }
    }

    renderProjectOptions(selectElement, projects) {
        selectElement.innerHTML = '<option value="">No project</option>';
        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.name;
            option.textContent = project.display_name || project.name;
            selectElement.appendChild(option);
        });
    }

    async populateProjectSelect() {
        const projectSelect = document.getElementById('header-project-select');
        if (!projectSelect) return;
        
        // Use cached projects if available and fresh (less than 5 seconds old)
        const now = Date.now();
        if (this.cachedProjects && this.cachedProjectsTimestamp && (now - this.cachedProjectsTimestamp < 5000)) {
            this.renderProjectOptions(projectSelect, this.cachedProjects);
            return;
        }
        
        const result = await ipcRenderer.invoke('project-get-all');
        
        // Cache the projects and render
        if (result.success && result.projects) {
            this.cachedProjects = result.projects;
            this.cachedProjectsTimestamp = now;
            this.renderProjectOptions(projectSelect, result.projects);
        } else {
            projectSelect.innerHTML = '<option value="">No project</option>';
        }
    }
    
    async populateProjectSelectHeader() {
        const projectSelect = document.getElementById('header-project-select');
        if (!projectSelect) return;
        
        // Always try to load projects first if not cached
        if (!this.cachedProjects || this.cachedProjects.length === 0) {
            const result = await ipcRenderer.invoke('project-get-all');
            if (result.success && result.projects) {
                this.cachedProjects = result.projects;
                this.cachedProjectsTimestamp = Date.now();
                this.projects = result.projects; // Also update the main projects array
            }
        }
        
        // Use cached projects if available and fresh (less than 5 seconds old)
        const now = Date.now();
        if (this.cachedProjects && this.cachedProjectsTimestamp && (now - this.cachedProjectsTimestamp < 5000)) {
            this.renderProjectOptions(projectSelect, this.cachedProjects);
            return;
        }
        
        // Reload projects if cache is stale
        const result = await ipcRenderer.invoke('project-get-all');
        
        // Cache the projects and render
        if (result.success && result.projects) {
            this.cachedProjects = result.projects;
            this.cachedProjectsTimestamp = now;
            this.projects = result.projects; // Also update the main projects array
            this.renderProjectOptions(projectSelect, result.projects);
        } else {
            projectSelect.innerHTML = '<option value="">No project</option>';
        }
    }

    setupAutoSaveListeners() {
        if (!this.currentTask) return;
        
        // Create debounced save function
        const debouncedSave = this.debounce(async (field, value) => {

            if (!this.currentTask) {

                return;
            }
            
            // Save task ID before async operations
            const taskId = this.currentTask.id;

            try {
                let result;

                // Handle different fields with their appropriate IPC calls
                if (field === 'title' || field === 'description') {
                    // For title and description, use task-update
                    const title = field === 'title' ? value : this.currentTask.title;
                    const description = field === 'description' ? value : (this.currentTask.description || '');
                    const project = this.currentTask.project;
                    result = await ipcRenderer.invoke('task-update', taskId, title, description, project);
                } else if (field === 'plan') {
                    // For plan, use task-update-plan
                    result = await ipcRenderer.invoke('task-update-plan', taskId, value);
                } else if (field === 'implementation') {
                    // For implementation, use task-update-implementation
                    result = await ipcRenderer.invoke('task-update-implementation', taskId, value);
                } else if (field === 'project') {
                    // For project, use task-update with current title and description
                    result = await ipcRenderer.invoke('task-update', taskId, this.currentTask.title, this.currentTask.description || '', value);
                } else if (field === 'terminal_id') {
                    // For terminal, use task-update-terminal
                    result = await ipcRenderer.invoke('task-update-terminal', taskId, value);
                } else if (field === 'parent_task_id') {
                    // For parent task, use task-link-to-parent or task-unlink-from-parent

                    if (value) {
                        result = await ipcRenderer.invoke('task-link-to-parent', {
                            taskId: taskId,
                            parentTaskId: value
                        });

                    } else {
                        // Only unlink if there was a parent before
                        if (this.currentTask.parent_task_id) {
                            result = await ipcRenderer.invoke('task-unlink-from-parent', taskId);

                        } else {
                            // No change needed, skip the update

                            return;
                        }
                    }
                } else {
                    // Unsupported field, skip
                    console.warn(`Auto-save not implemented for field: ${field}`);
                    return;
                }
                
                if (result && result.success) {
                    // Update local task data only if currentTask still exists
                    if (this.currentTask) {
                        this.currentTask[field] = value;
                    }
                    
                    // Update the task in the tasks array and render just that task card
                    const taskIndex = this.tasks.findIndex(t => t.id === (this.currentTask?.id || result.taskId));
                    if (taskIndex !== -1) {
                        this.tasks[taskIndex][field] = value;
                        
                        // Update only the specific task card instead of re-rendering everything
                        const taskCard = document.querySelector(`.task-card[data-task-id="${this.tasks[taskIndex].id}"]`);
                        if (taskCard) {
                            // Update the task card content directly without full re-render
                            this.updateTaskCard(taskCard, this.tasks[taskIndex]);
                        }
                    }

                } else if (result) {
                    console.error(`Failed to auto-save ${field}:`, result.error || 'Unknown error', 'Full result:', result);
                } else {
                    console.error(`Failed to auto-save ${field}: No result returned from IPC call`);
                }
            } catch (error) {
                console.error('Error auto-saving:', error);
            }
        }, 500);
        
        // Title field
        document.getElementById('details-title').addEventListener('input', (e) => {
            debouncedSave('title', e.target.value);
        });
        
        // Description field
        document.getElementById('details-description').addEventListener('input', (e) => {
            debouncedSave('description', e.target.value);
            // Update character count
            const charCount = document.getElementById('description-char-count');
            if (charCount) {
                charCount.textContent = `${e.target.value.length} characters`;
            }
        });
        
        // Plan field
        document.getElementById('details-plan').addEventListener('input', (e) => {
            debouncedSave('plan', e.target.value);
            // Update character count
            const charCount = document.getElementById('plan-char-count');
            if (charCount) {
                charCount.textContent = `${e.target.value.length} characters`;
            }
        });
        
        // Implementation field
        document.getElementById('details-implementation').addEventListener('input', (e) => {
            debouncedSave('implementation', e.target.value);
            // Update character count
            const charCount = document.getElementById('implementation-char-count');
            if (charCount) {
                charCount.textContent = `${e.target.value.length} characters`;
            }
        });
        
        // Header project select (only one project dropdown in the header)
        const headerProjectSelect = document.getElementById('header-project-select');
        if (headerProjectSelect) {
            headerProjectSelect.addEventListener('change', (e) => {
                debouncedSave('project', e.target.value);
            });
        }
        
        // Header terminal select (only one terminal dropdown in the header)
        const headerTerminalSelect = document.getElementById('header-terminal-select');
        if (headerTerminalSelect) {
            headerTerminalSelect.addEventListener('change', (e) => {
                debouncedSave('terminal_id', e.target.value ? parseInt(e.target.value) : null);
            });
        }
        
        // Parent task hidden field - monitor changes to save parent_task_id
        const detailsParentField = document.getElementById('details-parent');
        if (detailsParentField) {
            // Store the previous value to detect changes
            let previousValue = detailsParentField.value;
            
            // Check periodically for value changes (since MutationObserver doesn't detect value property changes)
            const checkValueInterval = setInterval(() => {
                if (detailsParentField.value !== previousValue) {
                    const oldValue = previousValue;
                    const newValue = detailsParentField.value;
                    previousValue = newValue;
                    
                    // Skip if we're manually saving via autoSaveParentTask
                    if (this.skipNextParentAutoSave) {

                        this.skipNextParentAutoSave = false;
                        return;
                    }

                    const parentTaskId = newValue;
                    debouncedSave('parent_task_id', parentTaskId ? parseInt(parentTaskId) : null);
                }
            }, 100);
            
            // Store interval ID to clear it when modal is closed
            this.parentValueCheckInterval = checkValueInterval;
            
            // Also handle direct changes
            detailsParentField.addEventListener('change', (e) => {
                debouncedSave('parent_task_id', e.target.value ? parseInt(e.target.value) : null);
            });
        }
    }

    removeAutoSaveListeners() {
        // Clone and replace elements to remove all listeners
        // Note: details-project and details-terminal-info have been removed from HTML
        ['details-title', 'details-description', 'details-plan', 'details-implementation', 
         'header-project-select', 'header-terminal-select', 'details-parent', 'details-parent-search'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                const newElement = element.cloneNode(true);
                element.parentNode.replaceChild(newElement, element);
            }
        });
    }

    updateTaskCard(taskCard, task) {
        // Update title
        const titleElement = taskCard.querySelector('.task-title-text');
        if (titleElement) {
            titleElement.textContent = this.capitalizeFirstLetter(task.title);
        }

        // Update description
        const descElement = taskCard.querySelector('.task-description');
        if (task.description) {
            if (descElement) {
                descElement.textContent = task.description;
            } else {
                // Add description element if it doesn't exist
                const titleDiv = taskCard.querySelector('.task-title');
                if (titleDiv) {
                    const newDesc = document.createElement('div');
                    newDesc.className = 'task-description';
                    newDesc.textContent = task.description;
                    titleDiv.insertAdjacentElement('afterend', newDesc);
                }
            }
        } else if (descElement) {
            // Remove description element if description is empty
            descElement.remove();
        }

        // Update project tag
        const projectTag = taskCard.querySelector('.task-project-tag');
        if (task.project) {
            const project = this.projects.find(p => p.name === task.project) || 
                           { name: task.project, display_name: task.project, color: '#007ACC' };
            const displayName = project.display_name || project.name;
            const gradient = this.getProjectGradient(project.color);
            
            if (projectTag) {
                projectTag.style.background = gradient;
                const projectNameElement = projectTag.querySelector('.project-name');
                if (projectNameElement) {
                    projectNameElement.textContent = displayName;
                }
            } else {
                // Add project tag if it doesn't exist
                const taskHeader = taskCard.querySelector('.task-header');
                if (taskHeader) {
                    const newTag = document.createElement('span');
                    newTag.className = 'task-project-tag';
                    newTag.style.background = gradient;
                    newTag.innerHTML = `<span class="project-name">${this.escapeHtml(displayName)}</span>`;
                    taskHeader.insertAdjacentElement('afterbegin', newTag);
                }
            }
        } else if (projectTag) {
            // Remove project tag if project is empty
            projectTag.remove();
        }

        // Update terminal badge (already handled by selectTerminal method)
        // No need to update here as it's updated separately
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async autoSaveParentTask(parentTaskId) {
        // Save parent task selection immediately (not debounced)
        if (!this.currentTask) {
            console.warn('autoSaveParentTask: No current task');
            return;
        }
        
        const taskId = this.currentTask.id;

        try {
            let result;
            if (parentTaskId) {

                result = await ipcRenderer.invoke('task-link-to-parent', {
                    taskId: taskId,
                    parentTaskId: parentTaskId
                });
            } else {
                // Only unlink if there was a parent before
                if (this.currentTask.parent_task_id) {

                    result = await ipcRenderer.invoke('task-unlink-from-parent', taskId);
                } else {
                    // No change needed

                    return;
                }
            }
            
            if (result && result.success) {
                // Update local task data
                this.currentTask.parent_task_id = parentTaskId || null;
                
                // Update the task in the tasks array
                const taskIndex = this.tasks.findIndex(t => t.id === taskId);
                if (taskIndex !== -1) {
                    this.tasks[taskIndex].parent_task_id = parentTaskId || null;
                    
                    // Update the task card if visible
                    const taskCard = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
                    if (taskCard) {
                        this.updateTaskCard(taskCard, this.tasks[taskIndex]);
                    }
                }
                
                // Update parent info display
                const parentInfo = document.getElementById('task-parent-info');
                if (parentInfo) {
                    if (parentTaskId) {
                        const parent = this.tasks.find(t => t.id === parentTaskId);
                        if (parent) {
                            parentInfo.innerHTML = `
                                <div class="parent-task-link" data-parent-id="${parent.id}">
                                    <i data-lucide="git-branch"></i>
                                    <span class="parent-task-title">Parent: #${parent.id} - ${this.escapeHtml(parent.title)}</span>
                                </div>
                            `;
                            parentInfo.style.display = 'block';
                            
                            // Re-init icons for the new content
                            if (window.lucide) {
                                window.lucide.createIcons();
                            }
                        }
                    } else {
                        parentInfo.style.display = 'none';
                        parentInfo.innerHTML = '';
                    }
                }

                // Refresh the kanban board to reflect changes
                await this.loadTasks();
            } else {
                console.error('Failed to save parent task:', result?.error || 'Unknown error', 'Full result:', result);
                
                // Revert the hidden input value
                const detailsParentField = document.getElementById('details-parent');
                if (detailsParentField) {
                    detailsParentField.value = this.currentTask.parent_task_id || '';
                }
            }
        } catch (error) {
            console.error('Error saving parent task:', error);
            
            // Revert the hidden input value
            const detailsParentField = document.getElementById('details-parent');
            if (detailsParentField) {
                detailsParentField.value = this.currentTask.parent_task_id || '';
            }
        }
    }

    async deleteSubtask(subtaskId, parentTaskId) {
        const subtask = this.tasks.find(t => t.id === subtaskId);
        if (!subtask) return;

        if (subtask.status === 'in_progress') {
            await ipcRenderer.invoke('show-alert-dialog', {
                type: 'warning',
                title: 'Cannot Delete Task',
                message: 'Cannot delete task in progress'
            });
            return;
        }

        const confirmed = await ipcRenderer.invoke('show-confirm-dialog', {
            title: 'Delete Subtask',
            message: `Are you sure you want to delete subtask "${this.capitalizeFirstLetter(subtask.title)}"?`
        });
        if (!confirmed) return;

        try {
            const result = await ipcRenderer.invoke('task-delete', subtaskId);
            if (result.success) {
                // Remove from local tasks array
                const index = this.tasks.findIndex(t => t.id === subtaskId);
                if (index !== -1) {
                    this.tasks.splice(index, 1);
                }
                
                // Update indexes - CRITICAL for proper subtask display
                // Remove from taskIndex
                this.taskIndex.delete(subtaskId);
                
                // Remove from subtaskIndex
                if (this.subtaskIndex.has(parentTaskId)) {
                    const subtaskIds = this.subtaskIndex.get(parentTaskId);
                    const filteredIds = subtaskIds.filter(id => id !== subtaskId);
                    if (filteredIds.length > 0) {
                        this.subtaskIndex.set(parentTaskId, filteredIds);
                    } else {
                        this.subtaskIndex.delete(parentTaskId);
                    }
                }
                
                // Update the subtasks list in the modal if it's open
                if (this.currentTask && this.currentTask.id === parentTaskId) {
                    // Re-filter subtasks and update the UI
                    const subtasks = this.tasks.filter(t => t.parent_task_id === parentTaskId);
                    const subtasksList = document.getElementById('subtasks-list');
                    
                    if (subtasksList) {
                        if (subtasks.length > 0) {
                            subtasksList.innerHTML = subtasks.map(subtask => {
                                // Remove project badge - not needed in subtasks
                                let projectBadge = '';
                                
                                return `
                                <div class="subtask-item">
                                    <a href="#" onclick="kanban.showTaskDetails(${subtask.id}); return false;" class="subtask-link">
                                        <div class="subtask-header">
                                            <span class="task-id-badge">#${subtask.id}</span>
                                                <span class="subtask-status status-${subtask.status}">${subtask.status.replace('_', ' ')}</span>
                                            <button class="subtask-delete-btn" onclick="event.stopPropagation(); event.preventDefault(); kanban.deleteSubtask(${subtask.id}, ${parentTaskId}); return false;" title="Delete subtask">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <polyline points="3 6 5 6 21 6"></polyline>
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                    <line x1="10" y1="11" x2="10" y2="17"></line>
                                                    <line x1="14" y1="11" x2="14" y2="17"></line>
                                                </svg>
                                            </button>
                                        </div>
                                        <div class="subtask-title">${this.escapeHtml(this.capitalizeFirstLetter(subtask.title))}</div>
                                    </a>
                                </div>
                                `;
                            }).join('');
                        } else {
                            subtasksList.innerHTML = '<div class="no-subtasks" style="color: #888; text-align: center; padding: 2rem; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 150px; font-style: italic; width: 100%; grid-column: 1 / -1;">No subtasks yet. Click "Create Subtask" to add one.</div>';
                        }
                    }
                }
                
                // Refresh the kanban board
                this.renderTasks();
            } else {
                await ipcRenderer.invoke('show-alert-dialog', {
                    type: 'error',
                    title: 'Delete Failed',
                    message: 'Failed to delete subtask: ' + (result.error || 'Unknown error')
                });
            }
        } catch (error) {
            console.error('Error deleting subtask:', error);
            await ipcRenderer.invoke('show-alert-dialog', {
                type: 'error',
                title: 'Delete Error',
                message: 'Failed to delete subtask'
            });
        }
    }

    async unlinkSubtask(subtaskId, parentTaskId) {
        const subtask = this.tasks.find(t => t.id === subtaskId);
        if (!subtask) return;
        
        const confirmed = await ipcRenderer.invoke('show-confirm-dialog', {
            title: 'Unlink Subtask',
            message: `Are you sure you want to unlink subtask "${this.capitalizeFirstLetter(subtask.title)}"?`
        });
        if (!confirmed) return;
        
        try {
            const result = await ipcRenderer.invoke('task-unlink-from-parent', subtaskId);
            
            if (result.success) {
                // Update local task data
                const taskIndex = this.tasks.findIndex(t => t.id === subtaskId);
                if (taskIndex !== -1) {
                    this.tasks[taskIndex].parent_task_id = null;
                }
                
                // Refresh the kanban board
                await this.loadTasks();
                
                // Refresh task details if still open
                if (this.currentTask && this.currentTask.id === parentTaskId) {
                    const subtasksList = document.getElementById('subtasks-list');
                    const subtasks = this.tasks.filter(t => t.parent_task_id === parentTaskId);
                    
                    if (subtasks.length > 0) {
                        subtasksList.innerHTML = subtasks.map(subtask => {
                            // Remove project badge - not needed in subtasks
                            let projectBadge = '';
                            
                            return `
                            <div class="subtask-item">
                                <a href="#" onclick="kanban.showTaskDetails(${subtask.id}); return false;" class="subtask-link">
                                    <div class="subtask-header">
                                        <span class="task-id-badge">#${subtask.id}</span>
                                        <span class="subtask-status status-${subtask.status}">${subtask.status.replace('_', ' ')}</span>
                                        <button class="subtask-unlink-btn" onclick="event.stopPropagation(); event.preventDefault(); kanban.unlinkSubtask(${subtask.id}, ${parentTaskId}); return false;" title="Unlink subtask">
                                            <svg class="no-lucide" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"></path>
                                                <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"></path>
                                                <line x1="8" x2="8" y1="2" y2="5"></line>
                                                <line x1="2" x2="5" y1="8" y2="8"></line>
                                                <line x1="16" x2="16" y1="19" y2="22"></line>
                                                <line x1="19" x2="22" y1="16" y2="16"></line>
                                            </svg>
                                        </button>
                                        <button class="subtask-delete-btn" onclick="event.stopPropagation(); event.preventDefault(); kanban.deleteSubtask(${subtask.id}, ${parentTaskId}); return false;" title="Delete subtask">
                                            <svg class="no-lucide" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <polyline points="3 6 5 6 21 6"></polyline>
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                                <line x1="14" y1="11" x2="14" y2="17"></line>
                                            </svg>
                                        </button>
                                    </div>
                                    <div class="subtask-title">${this.escapeHtml(this.capitalizeFirstLetter(subtask.title))}</div>
                                </a>
                            </div>
                            `;
                        }).join('');
                        subtasksList.style.display = 'block';
                    } else {
                        subtasksList.innerHTML = '<div class="empty-subtasks">No subtasks</div>';
                        subtasksList.style.display = 'none';
                    }
                }
                
                this.showNotification('Subtask unlinked successfully', 'success');
            } else {
                await ipcRenderer.invoke('show-alert-dialog', {
                    type: 'error',
                    title: 'Unlink Failed',
                    message: 'Failed to unlink subtask: ' + (result.error || 'Unknown error')
                });
            }
        } catch (error) {
            console.error('Error unlinking subtask:', error);
            await ipcRenderer.invoke('show-alert-dialog', {
                type: 'error',
                title: 'Unlink Error',
                message: 'Failed to unlink subtask'
            });
        }
    }

    async unlinkParentTask() {
        if (!this.currentTask || !this.currentTask.parent_task_id) {
            return;
        }
        
        // Show custom confirmation modal using existing modal styles
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 450px;">
                <div class="modal-header" style="border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                    <h2 style="font-size: 1.25rem; display: flex; align-items: center; gap: 0.75rem;">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2">
                            <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"></path>
                            <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"></path>
                            <line x1="8" x2="8" y1="2" y2="5"></line>
                            <line x1="2" x2="5" y1="8" y2="8"></line>
                            <line x1="16" x2="16" y1="19" y2="22"></line>
                            <line x1="19" x2="22" y1="16" y2="16"></line>
                        </svg>
                        Unlink from Parent Task
                    </h2>
                </div>
                <div class="modal-body" style="padding: 1.5rem;">
                    <p style="color: rgba(255, 255, 255, 0.8); margin: 0; text-align: center;">
                        Are you sure you want to unlink this task from its parent?<br>
                        <span style="color: rgba(255, 255, 255, 0.6); font-size: 0.9rem;">
                            The task will become a standalone task.
                        </span>
                    </p>
                </div>
                <div class="modal-footer" style="padding: 1rem 1.5rem; gap: 0.75rem; display: flex; justify-content: flex-end;">
                    <button class="btn-modern btn-secondary-modern" id="unlink-cancel-btn">Cancel</button>
                    <button class="btn-modern" id="unlink-confirm-btn" style="background: #fbbf24; color: #1a1a1a;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 0.5rem;">
                            <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"></path>
                            <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"></path>
                            <line x1="8" x2="8" y1="2" y2="5"></line>
                            <line x1="2" x2="5" y1="8" y2="8"></line>
                            <line x1="16" x2="16" y1="19" y2="22"></line>
                            <line x1="19" x2="22" y1="16" y2="16"></line>
                        </svg>
                        Unlink Task
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        return new Promise(async (resolve) => {
            const handleConfirm = async () => {
                modal.remove();
                
                try {
                    // Use the correct IPC handler for unlinking
                    const result = await ipcRenderer.invoke('task-unlink-from-parent', this.currentTask.id);
                    
                    if (result.success) {
                        // Update local task data
                        this.currentTask.parent_task_id = null;
                        
                        // Update the hidden parent field
                        document.getElementById('details-parent').value = '';
                        
                        // Hide the parent task info section
                        const parentTaskInfo = document.getElementById('parent-task-info');
                        if (parentTaskInfo) {
                            parentTaskInfo.style.display = 'none';
                        }
                        
                        // Hide the unlink button
                        const unlinkBtn = document.getElementById('unlink-parent-btn');
                        if (unlinkBtn) {
                            unlinkBtn.style.display = 'none';
                        }
                        
                        // Reload tasks to update the view
                        await this.loadTasks();
                        
                        this.showNotification('Task unlinked from parent successfully', 'success');
                    } else {
                        this.showNotification('Failed to unlink: ' + (result.error || 'Unknown error'), 'error');
                    }
                } catch (error) {
                    console.error('Error unlinking from parent:', error);
                    this.showNotification('Failed to unlink from parent', 'error');
                }
                resolve();
            };
            
            const handleCancel = () => {
                modal.remove();
                resolve();
            };
            
            // Add event listeners
            modal.querySelector('#unlink-confirm-btn').addEventListener('click', handleConfirm);
            modal.querySelector('#unlink-cancel-btn').addEventListener('click', handleCancel);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    handleCancel();
                }
            });
        });
    }

    async deleteCurrentTask() {
        if (!this.currentTask) return;

        if (this.currentTask.status === 'in_progress') {
            await ipcRenderer.invoke('show-alert-dialog', {
                type: 'warning',
                title: 'Cannot Delete Task',
                message: 'Cannot delete task in progress'
            });
            return;
        }

        const confirmed = await ipcRenderer.invoke('show-confirm-dialog', {
            title: 'Delete Task',
            message: `Are you sure you want to delete "${this.currentTask.title}"?`
        });
        if (!confirmed) return;

        try {
            const result = await ipcRenderer.invoke('task-delete', this.currentTask.id);
            if (result.success) {
                this.hideTaskDetailsModal();
                await this.loadTasks();
                // Notification removed - no success message on delete
            } else {
                await ipcRenderer.invoke('show-alert-dialog', {
                    type: 'error',
                    title: 'Delete Failed',
                    message: `Failed to delete task: ${result.error}`
                });
            }
        } catch (error) {
            console.error('Error deleting task:', error);
            await ipcRenderer.invoke('show-alert-dialog', {
                type: 'error',
                title: 'Delete Error',
                message: 'Error deleting task'
            });
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
                    
                    // Show desktop notification for important status changes
                    if (oldStatus !== newStatus) {
                        let notificationMessage = '';
                        let notificationType = 'info';
                        
                        // Create meaningful notification messages
                        if (newStatus === 'in_progress' && oldStatus === 'pending') {
                            notificationMessage = `Task "${this.capitalizeFirstLetter(task.title)}" started`;
                            notificationType = 'info';
                        } else if (newStatus === 'in_testing') {
                            notificationMessage = `Task "${this.capitalizeFirstLetter(task.title)}" is ready for testing`;
                            notificationType = 'warning';
                        } else if (newStatus === 'completed') {
                            notificationMessage = `Task "${this.capitalizeFirstLetter(task.title)}" completed! 🎉`;
                            notificationType = 'success';
                        } else if (newStatus === 'pending' && oldStatus !== 'pending') {
                            notificationMessage = `Task "${this.capitalizeFirstLetter(task.title)}" moved back to pending`;
                            notificationType = 'warning';
                        }
                        
                        // Only show notification for meaningful status changes
                        // Eliminado - no mostrar notificaciones al mover tareas
                    }
                }
            } else {
                await ipcRenderer.invoke('show-alert-dialog', {
                    type: 'error',
                    title: 'Update Failed',
                    message: `Failed to update task status: ${result.error}`
                });
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
                
                // Notification removed as requested - terminal update still works
                // this.showNotification(`Terminal updated successfully`, 'success');
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

    toggleTerminalDropdown(event, taskId) {
        event.stopPropagation();
        event.preventDefault();
        
        // Save scroll position of the column
        const taskCard = event.target.closest('.task-card');
        const taskList = taskCard?.closest('.task-list');
        const savedScrollTop = taskList ? taskList.scrollTop : 0;
        
        // Close all other dropdowns first
        document.querySelectorAll('.terminal-dropdown').forEach(dropdown => {
            if (dropdown.id !== `terminal-dropdown-${taskId}`) {
                dropdown.style.display = 'none';
            }
        });
        
        // Toggle current dropdown
        const dropdown = document.getElementById(`terminal-dropdown-${taskId}`);
        
        if (dropdown) {
            if (dropdown.style.display === 'none' || dropdown.style.display === '') {
                dropdown.style.display = 'block';
                
                // Make the task card high z-index to ensure dropdown is visible
                if (taskCard) {
                    taskCard.style.zIndex = '1000';
                    taskCard.style.position = 'relative';
                }
                
                // Restore scroll position if it changed
                if (taskList && taskList.scrollTop !== savedScrollTop) {
                    taskList.scrollTop = savedScrollTop;
                }
            } else {
                dropdown.style.display = 'none';
                
                // Reset z-index
                if (taskCard) {
                    taskCard.style.zIndex = '';
                    taskCard.style.position = '';
                }
            }
        }
        
        // Close dropdown when clicking outside
        const closeDropdown = (e) => {
            if (!e.target.closest('.task-terminal-wrapper')) {
                if (dropdown) {
                    dropdown.style.display = 'none';
                    
                    // Reset z-index
                    const taskCard = dropdown.closest('.task-card');
                    if (taskCard) {
                        taskCard.style.zIndex = '';
                        taskCard.style.position = '';
                    }
                }
                document.removeEventListener('click', closeDropdown);
            }
        };
        
        if (dropdown && dropdown.style.display === 'block') {
            setTimeout(() => {
                document.addEventListener('click', closeDropdown);
            }, 0);
        }
    }
    
    async selectTerminal(taskId, terminalId) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        
        // Hide dropdown and reset z-index
        const dropdown = document.getElementById(`terminal-dropdown-${taskId}`);
        if (dropdown) {
            dropdown.style.display = 'none';
            
            const taskCard = dropdown.closest('.task-card');
            if (taskCard) {
                taskCard.style.zIndex = '';
                taskCard.style.position = '';
            }
        }
        
        // Update terminal
        await this.updateTaskTerminal(taskId, terminalId === null ? '' : terminalId.toString());
        
        // Update the badge display without reloading everything
        const badge = document.querySelector(`.task-card[data-task-id="${taskId}"] .task-terminal-badge`);
        if (badge) {
            if (terminalId === null) {
                badge.classList.add('unassigned');
                badge.innerHTML = '<i data-lucide="plus"></i>';
                // Re-initialize Lucide icons for this badge
                if (window.lucide && badge) {
                    window.lucide.createIcons({ el: badge });
                }
                badge.title = 'Assign to terminal';
            } else {
                badge.classList.remove('unassigned');
                badge.innerHTML = `<i data-lucide="terminal"></i><span class="terminal-number">${terminalId}</span>`;
                // Re-initialize Lucide icons for this badge
                if (window.lucide && badge) {
                    window.lucide.createIcons({ el: badge });
                }
                badge.title = `Terminal ${terminalId}`;
            }
            // Re-initialize Lucide icons for the updated badge
            if (window.lucide) {
                window.lucide.createIcons();
            }
        }
        
        // Update the dropdown options to show the new active state
        const options = document.querySelectorAll(`#terminal-dropdown-${taskId} .terminal-option`);
        options.forEach((option, index) => {
            if (index === 0 && terminalId === null) {
                option.classList.add('active');
            } else if (index > 0 && index === terminalId) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });
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
                titleElement.textContent = this.capitalizeFirstLetter(task.title);
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
                    titleElement.textContent = this.capitalizeFirstLetter(task.title);
                }
                this.showNotification(`Failed to update title: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error updating task title:', error);
            // Revert to original title
            const titleElement = document.querySelector(`[data-task-id="${taskId}"].task-title-text`);
            if (titleElement) {
                titleElement.textContent = this.capitalizeFirstLetter(task.title);
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
                event.target.textContent = this.capitalizeFirstLetter(task.title);
                event.target.blur();
            }
        }
    }

    async quickDeleteTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        // Quick confirmation
        if (!confirm(`Delete "${this.capitalizeFirstLetter(task.title)}"?`)) return;

        try {
            const result = await ipcRenderer.invoke('task-delete', taskId);
            if (result.success) {
                await this.loadTasks();
                // Notification removed - no success message on delete
            } else {
                this.showNotification(`Failed to delete task: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error deleting task:', error);
            this.showNotification('Error deleting task', 'error');
        }
    }

    openLinkTaskModal() {
        const modal = document.getElementById('link-task-modal');
        if (!modal || !this.currentTask) return;
        
        // Get the current task to display parent info
        const parentTask = this.tasks.find(t => t.id === this.currentTask.id);
        if (!parentTask) {
            this.showNotification('Parent task not found', 'error');
            return;
        }
        
        // Clear previous search
        document.getElementById('link-task-search').value = '';
        document.getElementById('selected-link-task').value = '';
        document.getElementById('link-task-dropdown').style.display = 'none';
        document.getElementById('selected-task-preview').style.display = 'none';
        document.getElementById('confirm-link-task-btn').disabled = true;
        
        // Show modal
        modal.classList.add('show');
        
        // Focus on search input
        setTimeout(() => {
            document.getElementById('link-task-search').focus();
        }, 100);
    }

    closeLinkTaskModal() {
        const modal = document.getElementById('link-task-modal');
        if (modal) {
            modal.classList.remove('show');
        }
    }

    setupLinkTaskSearch() {
        const searchInput = document.getElementById('link-task-search');
        const dropdown = document.getElementById('link-task-dropdown');
        let searchTimeout;
        
        if (!searchInput || !dropdown) return;
        
        // Search on input
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            
            // Clear timeout if exists
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            
            // Hide dropdown if query is too short
            if (query.length < 2) {
                dropdown.style.display = 'none';
                document.getElementById('selected-task-preview').style.display = 'none';
                document.getElementById('selected-link-task').value = '';
                document.getElementById('confirm-link-task-btn').disabled = true;
                return;
            }
            
            // Set timeout for search
            searchTimeout = setTimeout(() => {
                this.searchTasksToLink(query);
            }, 300);
        });
        
        // Handle focus
        searchInput.addEventListener('focus', () => {
            if (searchInput.value.trim().length >= 2) {
                this.searchTasksToLink(searchInput.value.trim());
            }
        });
        
        // Handle click outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }

    async searchTasksToLink(query) {
        const dropdown = document.getElementById('link-task-dropdown');
        if (!dropdown) return;
        
        // Show loading
        dropdown.innerHTML = '<div class="dropdown-loading">Searching...</div>';
        dropdown.style.display = 'block';
        
        try {
            // Search for tasks without parent (standalone tasks)
            const result = await ipcRenderer.invoke('task-search', { query, limit: 20 });
            
            if (result.success && result.tasks) {
                // Filter only tasks without parent
                const availableTasks = result.tasks.filter(task => 
                    !task.parent_task_id && 
                    task.id !== this.currentTask.id // Exclude current parent task
                );
                
                this.displayLinkTaskResults(dropdown, availableTasks);
            } else {
                dropdown.innerHTML = '<div class="link-task-item no-results">Search failed</div>';
            }
        } catch (error) {
            console.error('Failed to search tasks:', error);
            dropdown.innerHTML = '<div class="link-task-item no-results">Search failed</div>';
        }
    }

    displayLinkTaskResults(dropdown, tasks) {
        if (!tasks || tasks.length === 0) {
            dropdown.innerHTML = '<div class="link-task-item no-results">No standalone tasks found matching your search</div>';
            return;
        }
        
        // Build HTML for task results
        let html = tasks.map(task => {
            return `
                <div class="link-task-item" data-task-id="${task.id}" data-task-title="${this.escapeHtml(task.title)}" data-task-description="${this.escapeHtml(task.description || '')}" data-task-status="${task.status}">
                    <span class="task-id">#${task.id}</span>
                    <span class="task-title">${this.escapeHtml(task.title)}</span>
                    <span class="task-status status-${task.status}">${task.status.replace('_', ' ')}</span>
                    ${task.project ? `<span class="task-project">${this.escapeHtml(task.project)}</span>` : ''}
                </div>
            `;
        }).join('');
        
        dropdown.innerHTML = html;
        
        // Add click handlers
        dropdown.querySelectorAll('.link-task-item').forEach(item => {
            if (!item.classList.contains('no-results')) {
                item.addEventListener('click', () => {
                    this.selectTaskToLink(item);
                });
            }
        });
    }

    selectTaskToLink(item) {
        const taskId = item.dataset.taskId;
        const taskTitle = item.dataset.taskTitle;
        const taskDescription = item.dataset.taskDescription;
        const taskStatus = item.dataset.taskStatus;
        
        // Update hidden input
        document.getElementById('selected-link-task').value = taskId;
        
        // Update search input
        document.getElementById('link-task-search').value = `#${taskId} - ${taskTitle}`;
        
        // Show preview
        const preview = document.getElementById('selected-task-preview');
        if (preview) {
            preview.innerHTML = `
                <h4>Selected Task</h4>
                <div class="preview-content">
                    <div>
                        <span class="preview-id">#${taskId}</span>
                        <span class="preview-title">${taskTitle}</span>
                    </div>
                    ${taskDescription ? `<div class="preview-description">${taskDescription}</div>` : ''}
                    <div class="preview-status status-${taskStatus}">${taskStatus.replace('_', ' ')}</div>
                </div>
            `;
            preview.style.display = 'block';
        }
        
        // Enable confirm button
        document.getElementById('confirm-link-task-btn').disabled = false;
        
        // Hide dropdown
        document.getElementById('link-task-dropdown').style.display = 'none';
        
        // Mark selected item
        document.querySelectorAll('.link-task-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
    }

    async linkSelectedTask() {
        const taskId = document.getElementById('selected-link-task').value;
        const parentTaskId = this.currentTask.id;
        
        if (!taskId || !parentTaskId) {
            this.showNotification('Please select a task to link', 'error');
            return;
        }
        
        try {
            const result = await ipcRenderer.invoke('task-link-to-parent', {
                taskId: parseInt(taskId),
                parentTaskId: parentTaskId
            });
            
            if (result.success) {
                this.closeLinkTaskModal();
                
                // Reload tasks and refresh the current task details
                await this.loadTasks();
                
                // Refresh task details
                if (this.currentTask) {
                    await this.showTaskDetails(parentTaskId);
                }
                
                this.showNotification('Task linked successfully', 'success');
            } else {
                this.showNotification('Failed to link task: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            console.error('Failed to link task:', error);
            this.showNotification('Failed to link task', 'error');
        }
    }

    showNotification(message, type = 'info') {
        // Console log for debugging

        // Determine notification title based on type
        let notificationTitle = 'CodeAgentSwarm';
        switch(type) {
            case 'success':
                notificationTitle = '✅ Success';
                break;
            case 'error':
                notificationTitle = '❌ Error';
                break;
            case 'warning':
                notificationTitle = '⚠️ Warning';
                break;
            case 'info':
                notificationTitle = 'ℹ️ Info';
                break;
        }
        
        // Send desktop notification for all types
        ipcRenderer.send('show-desktop-notification', notificationTitle, message);
        
        // Also show in-app notification for errors
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
        
        const confirmed = await ipcRenderer.invoke('show-confirm-dialog', {
            title: 'Delete Project',
            message: `Are you sure you want to delete the project "${project.display_name || project.name}"?`,
            detail: 'This will NOT delete tasks associated with this project.'
        });
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
        // Cycle through states: default -> desc -> asc -> default
        const states = ['default', 'desc', 'asc'];
        const currentIndex = states.indexOf(this.sortStates[status]);
        const nextIndex = (currentIndex + 1) % states.length;
        this.sortStates[status] = states[nextIndex];
        
        // Update button appearance
        const button = document.querySelector(`.sort-button[data-status="${status}"]`);
        if (button) {
            button.classList.remove('sort-default', 'sort-asc', 'sort-desc');
            button.classList.add(`sort-${this.sortStates[status]}`);
            
            // Update icon based on state
            const icon = button.querySelector('i');
            if (icon) {
                switch(this.sortStates[status]) {
                    case 'default':
                        icon.setAttribute('data-lucide', 'arrow-up-down');
                        break;
                    case 'desc':
                        icon.setAttribute('data-lucide', 'arrow-down');
                        break;
                    case 'asc':
                        icon.setAttribute('data-lucide', 'arrow-up');
                        break;
                }
                // Re-initialize the icon
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            }
            
            // Update tooltip with current state
            let tooltipText = '';
            switch(this.sortStates[status]) {
                case 'default':
                    tooltipText = 'Sin ordenar (orden manual)';
                    break;
                case 'desc':
                    tooltipText = 'Ordenado: Más recientes primero';
                    break;
                case 'asc':
                    tooltipText = 'Ordenado: Más antiguos primero';
                    break;
            }
            button.title = tooltipText;
        }
        
        // Re-render tasks with new sorting
        this.renderTasks();
    }

    sortTasksByCreatedDate(tasks, sortState) {
        if (sortState === 'default') {
            // For default state, sort by sort_order (manual order)
            return tasks.sort((a, b) => {
                return (a.sort_order || 0) - (b.sort_order || 0);
            });
        }
        
        return tasks.sort((a, b) => {
            const dateA = new Date(a.created_at);
            const dateB = new Date(b.created_at);
            
            if (sortState === 'asc') {
                return dateA - dateB; // Oldest first
            } else {
                return dateB - dateA; // Newest first
            }
        });
    }
    
    loadMoreTasks(status) {
        const container = document.getElementById(`${status}-tasks`);
        const config = this.paginationConfig[status];
        
        // Get sorted tasks for this status
        let tasks = this.allTasksByStatus[status];
        tasks = this.sortTasksByCreatedDate(tasks, this.sortStates[status]);
        
        // Calculate how many tasks to load
        const currentlyShowing = config.currentLimit;
        const totalTasks = tasks.length;
        const tasksToLoad = Math.min(config.increment, totalTasks - currentlyShowing);
        
        // Get the new tasks to add
        const newTasks = tasks.slice(currentlyShowing, currentlyShowing + tasksToLoad);
        
        // Remove the existing Load More button
        const existingLoadMore = container.querySelector('.load-more-container');
        if (existingLoadMore) {
            existingLoadMore.remove();
        }
        
        // Add the new tasks
        newTasks.forEach(task => {
            const taskElement = this.createTaskElement(task);
            container.appendChild(taskElement);
        });
        
        // Update the limit
        config.currentLimit += tasksToLoad;
        
        // Add new Load More button if there are still more tasks
        if (config.currentLimit < totalTasks) {
            const remainingTasks = totalTasks - config.currentLimit;
            const loadMoreBtn = document.createElement('div');
            loadMoreBtn.className = 'load-more-container';
            loadMoreBtn.innerHTML = `
                <button class="load-more-btn" onclick="kanban.loadMoreTasks('${status}')">
                    <i data-lucide="chevron-down"></i>
                    Load ${Math.min(remainingTasks, config.increment)} more
                    <span class="remaining-count">(${remainingTasks} remaining)</span>
                </button>
            `;
            container.appendChild(loadMoreBtn);
        }
        
        // Re-initialize Lucide icons for the new tasks and button
        this.initializeLucideIcons();
    }
    
    // Keep old method for backward compatibility
    loadMoreCompletedTasks() {
        this.loadMoreTasks('completed');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    capitalizeFirstLetter(text) {
        if (!text) return text;
        return text.charAt(0).toUpperCase() + text.slice(1);
    }
    
    getFilteredTasksCount() {
        // Filter tasks by project if needed
        let filteredTasks = this.tasks;
        if (this.currentProjectFilter !== 'all') {
            filteredTasks = this.tasks.filter(task => task.project === this.currentProjectFilter);
        }
        
        // Filter by search query
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filteredTasks = filteredTasks.filter(task => {
                if (task.title && task.title.toLowerCase().includes(query)) return true;
                if (task.description && task.description.toLowerCase().includes(query)) return true;
                if (task.plan && task.plan.toLowerCase().includes(query)) return true;
                if (task.implementation && task.implementation.toLowerCase().includes(query)) return true;
                if (task.id && task.id.toString().includes(query)) return true;
                return false;
            });
        }
        
        return filteredTasks.length;
    }

    showPlanEditMode() {
        if (!this.currentTask) return;
        
        const planContent = document.getElementById('details-plan-content');
        const editSection = document.getElementById('edit-plan-section');
        const textarea = document.getElementById('edit-plan-textarea');
        
        if (planContent) planContent.style.display = 'none';
        if (editSection) editSection.style.display = 'block';
        if (textarea) {
            textarea.value = this.currentTask.plan || '';
            textarea.focus();
        }
    }

    hidePlanEditMode() {
        const planContent = document.getElementById('details-plan-content');
        const editSection = document.getElementById('edit-plan-section');
        if (planContent) planContent.style.display = 'block';
        if (editSection) editSection.style.display = 'none';
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
                await ipcRenderer.invoke('show-alert-dialog', {
                    type: 'error',
                    title: 'Update Failed',
                    message: `Failed to update plan: ${result.error}`
                });
            }
        } catch (error) {
            console.error('Error updating plan:', error);
            await ipcRenderer.invoke('show-alert-dialog', {
                type: 'error',
                title: 'Update Error',
                message: 'Error updating plan'
            });
        }
    }

    showImplementationEditMode() {
        if (!this.currentTask) return;
        
        const implContent = document.getElementById('details-implementation-content');
        const editSection = document.getElementById('edit-implementation-section');
        const textarea = document.getElementById('edit-implementation-textarea');
        
        if (implContent) implContent.style.display = 'none';
        if (editSection) editSection.style.display = 'block';
        if (textarea) {
            textarea.value = this.currentTask.implementation || '';
            textarea.focus();
        }
    }

    hideImplementationEditMode() {
        const implContent = document.getElementById('details-implementation-content');
        const editSection = document.getElementById('edit-implementation-section');
        if (implContent) implContent.style.display = 'block';
        if (editSection) editSection.style.display = 'none';
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
                await ipcRenderer.invoke('show-alert-dialog', {
                    type: 'error',
                    title: 'Update Failed',
                    message: `Failed to update implementation: ${result.error}`
                });
            }
        } catch (error) {
            console.error('Error updating implementation:', error);
            await ipcRenderer.invoke('show-alert-dialog', {
                type: 'error',
                title: 'Update Error',
                message: 'Error updating implementation'
            });
        }
    }

    toggleStatusDropdown() {
        if (!this.currentTask) return;
        
        const dropdown = document.getElementById('status-dropdown-menu');
        const statusDisplay = document.getElementById('status-display');
        
        if (dropdown.style.display === 'none') {
            dropdown.style.display = 'block';
            statusDisplay.classList.add('dropdown-open');
            
            // Highlight current status
            document.querySelectorAll('.status-option').forEach(option => {
                if (option.getAttribute('data-value') === this.currentTask.status) {
                    option.classList.add('active');
                } else {
                    option.classList.remove('active');
                }
            });
        } else {
            this.hideStatusDropdown();
        }
    }

    hideStatusDropdown() {
        document.getElementById('status-dropdown-menu').style.display = 'none';
        document.getElementById('status-display').classList.remove('dropdown-open');
    }

    async changeTaskStatus(newStatus) {
        if (!this.currentTask) return;
        
        try {
            const result = await ipcRenderer.invoke('task-update-status', this.currentTask.id, newStatus);
            if (result.success) {
                const oldStatus = this.currentTask.status;
                this.currentTask.status = newStatus;
                
                // Update the status text display
                const statusText = newStatus.replace('_', ' ').toUpperCase();
                document.getElementById('details-status-text').textContent = statusText;
                document.getElementById('status-display').setAttribute('data-status', newStatus);
                
                // Hide the dropdown
                this.hideStatusDropdown();
                
                // Update delete button visibility
                const deleteBtn = document.getElementById('delete-task-btn');
                deleteBtn.style.display = newStatus === 'in_progress' ? 'none' : 'block';
                
                // Reload tasks to update the board
                await this.loadTasks();
                
                // Notification removed - no popup when changing status from modal
                // this.showNotification(`Status updated to ${statusText}`, 'success');
            } else {
                // Close dropdown on error
                this.hideStatusDropdown();
                this.showNotification(`Failed to update status: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error updating task status:', error);
            this.hideStatusDropdown();
            this.showNotification('Error updating status', 'error');
        }
    }

    async toggleSendToTerminalDropdown(event, taskId) {
        event.stopPropagation();
        event.preventDefault();
        
        const dropdown = document.getElementById(`send-terminal-dropdown-${taskId}`);
        const button = event.currentTarget || event.target;
        const taskCard = button?.closest('.task-card');
        
        // Close all other dropdowns
        document.querySelectorAll('.send-terminal-dropdown').forEach(d => {
            if (d !== dropdown && d.style.display === 'block') {
                this.closeDropdownPortal(d);
            }
        });
        
        if (dropdown.style.display === 'none') {
            // Get task
            const task = this.tasks.find(t => t.id === taskId);
            if (!task) return;
            
            // Show dropdown immediately with loading state
            dropdown.innerHTML = `
                <div class="send-terminal-option loading">
                    <i data-lucide="loader-2" class="spinner"></i>
                    Loading terminals...
                </div>
            `;
            dropdown.style.display = 'block';
            
            // Open dropdown as portal
            this.openDropdownPortal(dropdown, button);
            
            // Find the wrapper element (parent of the dropdown)
            const wrapper = dropdown.parentElement;
            
            // Rotate dropdown icon
            const dropdownIcon = wrapper?.querySelector('.dropdown-icon');
            if (dropdownIcon) {
                dropdownIcon.style.transform = 'rotate(180deg)';
            }
            
            // Re-initialize icons for the loading state
            this.initializeLucideIcons();
            
            // Request available terminals from main process asynchronously
            ipcRenderer.invoke('get-terminals-for-project', task.project).then(terminals => {
                // Build dropdown content
                let dropdownHTML = '';
                
                if (terminals && terminals.length > 0) {
                    dropdownHTML = terminals.map(terminal => `
                        <div class="send-terminal-option" onclick="kanban.sendTaskToSpecificTerminal(${taskId}, ${terminal.id})">
                            <i data-lucide="terminal"></i>
                            Terminal ${terminal.id + 1} (${terminal.project})
                            <span class="terminal-status">${terminal.currentDir ? path.basename(terminal.currentDir) : ''}</span>
                        </div>
                    `).join('');
                    
                    // Add "Open New Terminal" option only if:
                    // 1. We have less than 6 terminals AND
                    // 2. The task has a project assigned
                    if (terminals.length < 6 && task.project && task.project !== 'Unknown') {
                        dropdownHTML += `
                            <div class="send-terminal-option new-terminal" onclick="kanban.sendTaskToNewTerminal(${taskId})">
                                <i data-lucide="plus-circle"></i>
                                Open New Terminal
                                <span class="terminal-status">Create & send</span>
                            </div>
                        `;
                    }
                } else {
                    // No terminals open
                    // Only show "Open New Terminal" if task has a project
                    if (task.project && task.project !== 'Unknown') {
                        dropdownHTML = `
                            <div class="send-terminal-option new-terminal" onclick="kanban.sendTaskToNewTerminal(${taskId})">
                                <i data-lucide="plus-circle"></i>
                                Open New Terminal
                                <span class="terminal-status">No terminals active</span>
                            </div>
                        `;
                    } else {
                        // No project assigned, show informative message
                        dropdownHTML = `
                            <div class="send-terminal-option no-terminals">
                                <i data-lucide="alert-circle"></i>
                                No terminals available
                                <span class="terminal-status">Task needs project</span>
                            </div>
                        `;
                    }
                }
                
                // Always add copy option
                dropdownHTML += `
                    <div class="send-terminal-option copy-option" onclick="kanban.copyTaskSummary(${taskId})">
                        <i data-lucide="clipboard-copy"></i>
                        Copy Task Summary
                    </div>
                `;
                
                // Update dropdown content if it's still open
                if (dropdown.style.display === 'block') {
                    dropdown.innerHTML = dropdownHTML;
                    // Re-initialize icons for the new content
                    this.initializeLucideIcons();
                }
            }).catch(error => {
                console.error('Error loading terminals:', error);
                if (dropdown.style.display === 'block') {
                    dropdown.innerHTML = `
                        <div class="send-terminal-option error">
                            <i data-lucide="alert-triangle"></i>
                            Error loading terminals
                        </div>
                        <div class="send-terminal-option copy-option" onclick="kanban.copyTaskSummary(${taskId})">
                            <i data-lucide="clipboard-copy"></i>
                            Copy Task Summary
                        </div>
                    `;
                    this.initializeLucideIcons();
                }
            });
            
            // Add click handler to close dropdown when clicking outside
            setTimeout(() => {
                const closeHandler = (e) => {
                    if (!dropdown.contains(e.target) && !button.contains(e.target)) {
                        this.closeDropdownPortal(dropdown);
                        if (dropdownIcon) dropdownIcon.style.transform = '';
                        document.removeEventListener('click', closeHandler);
                    }
                };
                document.addEventListener('click', closeHandler);
            }, 0);
        } else {
            this.closeDropdownPortal(dropdown);
            const wrapper = dropdown.parentElement;
            const dropdownIcon = wrapper?.querySelector('.dropdown-icon');
            if (dropdownIcon) dropdownIcon.style.transform = '';
        }
    }

    async sendTaskToSpecificTerminal(taskId, terminalId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) {
            console.error('Task not found');
            return;
        }

        // Build the message to send to terminal
        let message = `\n# Work on task #${task.id}: ${this.capitalizeFirstLetter(task.title)}\n\n`;
        
        if (task.description) {
            message += `## Description:\n${task.description}\n\n`;
        }
        
        if (task.implementation) {
            message += `## Previous Implementation:\n${task.implementation}\n\n`;
        }
        
        if (task.plan) {
            message += `## Plan:\n${task.plan}\n\n`;
        }
        
        message += `## Command:\nWork on this task\n`;

        // Send the message to the terminal via IPC
        ipcRenderer.send('send-to-terminal', terminalId, message);
        
        // Hide dropdown
        const dropdown = document.getElementById(`send-terminal-dropdown-${taskId}`);
        if (dropdown) {
            this.closeDropdownPortal(dropdown);
        }
        
        // Send command to start the task
        const startCommand = `mcp__codeagentswarm-tasks__start_task --task_id ${taskId}\n`;
        ipcRenderer.send('send-to-terminal', terminalId, startCommand);
        
        // Send notification to main window
        ipcRenderer.send('show-badge-notification', 'Task sent to terminal');
        
        // Close Task Manager window immediately
        window.close();
    }

    async sendTaskToNewTerminal(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) {
            console.error('Task not found');
            return;
        }

        // Hide dropdown while processing
        const dropdown = document.getElementById(`send-terminal-dropdown-${taskId}`);
        if (dropdown) {
            dropdown.style.display = 'none';
            // Reset z-index for task card
            const taskCard = dropdown.closest('.task-card');
            if (taskCard) {
                taskCard.style.zIndex = '';
                taskCard.style.position = '';
            }
        }

        try {
            // Request main window to open a new terminal with the task
            const result = await ipcRenderer.invoke('open-terminal-with-task', {
                taskId: task.id,
                title: task.title,
                description: task.description,
                implementation: task.implementation,
                plan: task.plan,
                project: task.project
            });

            if (result.success) {
                // Send notification
                ipcRenderer.send('show-badge-notification', 'New terminal opened with task');
                
                // Close Task Manager window
                window.close();
            } else {
                // Show error
                const errorMsg = result.error || 'Failed to open new terminal';
                ipcRenderer.send('show-badge-notification', errorMsg);
                
                // If it's because max terminals reached, show in UI
                if (result.error && result.error.includes('Maximum')) {
                    await ipcRenderer.invoke('show-alert-dialog', {
                        type: 'warning',
                        title: 'Terminal Limit',
                        message: 'Maximum number of terminals (6) reached. Please close a terminal first.'
                    });
                }
            }
        } catch (error) {
            console.error('Error opening new terminal:', error);
            ipcRenderer.send('show-badge-notification', 'Error opening terminal');
        }
    }

    setupModalSendIcon(taskId) {
        const modalSendIcon = document.getElementById('modal-send-icon');
        if (!modalSendIcon) return;
        
        // Remove old event listeners by cloning the element
        const newModalSendIcon = modalSendIcon.cloneNode(true);
        modalSendIcon.parentNode.replaceChild(newModalSendIcon, modalSendIcon);
        
        // Store taskId in data attribute for later use
        newModalSendIcon.dataset.taskId = taskId;
        
        // Add click event listener
        newModalSendIcon.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            await this.toggleModalSendDropdown(e, taskId);
        });
        
        // Re-initialize the lucide icon
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
    
    async toggleModalSendDropdown(event, taskId) {
        event.stopPropagation();
        event.preventDefault();
        
        const dropdown = document.getElementById('modal-send-dropdown');
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        if (dropdown.style.display === 'none') {
            // Request available terminals from main process
            const terminals = await ipcRenderer.invoke('get-terminals-for-project', task.project);
            
            // Build dropdown content with data attributes instead of onclick
            let dropdownHTML = '';
            
            if (terminals && terminals.length > 0) {
                dropdownHTML = terminals.map(terminal => `
                    <div class="send-terminal-option modal-terminal-option" data-task-id="${taskId}" data-terminal-id="${terminal.id}" data-action="send">
                        <i data-lucide="terminal"></i>
                        Terminal ${terminal.id + 1} (${terminal.project})
                        <span class="terminal-status">${terminal.currentDir ? path.basename(terminal.currentDir) : ''}</span>
                    </div>
                `).join('');
                
                // Add "Open New Terminal" option only if:
                // 1. We have less than 6 terminals AND
                // 2. The task has a project assigned
                if (terminals.length < 6 && task.project && task.project !== 'Unknown') {
                    dropdownHTML += `
                        <div class="send-terminal-option new-terminal modal-new-terminal" data-task-id="${taskId}" data-action="new-terminal">
                            <i data-lucide="plus-circle"></i>
                            Open New Terminal
                            <span class="terminal-status">Create & send</span>
                        </div>
                    `;
                }
            } else {
                // No terminals open
                // Only show "Open New Terminal" if task has a project
                if (task.project && task.project !== 'Unknown') {
                    dropdownHTML = `
                        <div class="send-terminal-option new-terminal modal-new-terminal" data-task-id="${taskId}" data-action="new-terminal">
                            <i data-lucide="plus-circle"></i>
                            Open New Terminal
                            <span class="terminal-status">No terminals active</span>
                        </div>
                    `;
                } else {
                    dropdownHTML = `
                        <div class="send-terminal-option no-terminals">
                            <i data-lucide="alert-circle"></i>
                            No active terminals available
                        </div>
                    `;
                }
            }
            
            // Always add copy option
            dropdownHTML += `
                <div class="send-terminal-option copy-option modal-copy-option" data-task-id="${taskId}" data-action="copy">
                    <i data-lucide="clipboard-copy"></i>
                    Copy Task Summary
                </div>
            `;
            
            dropdown.innerHTML = dropdownHTML;
            dropdown.style.display = 'block';
            
            // Re-initialize icons
            this.initializeLucideIcons();
            
            // Add click handlers to all options using event delegation
            const options = dropdown.querySelectorAll('.modal-terminal-option, .modal-copy-option, .modal-new-terminal');
            options.forEach(option => {
                option.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    
                    const action = option.dataset.action;
                    const taskId = parseInt(option.dataset.taskId);
                    
                    if (action === 'send') {
                        const terminalId = parseInt(option.dataset.terminalId);
                        await this.sendTaskToSpecificTerminal(taskId, terminalId);
                    } else if (action === 'copy') {
                        await this.copyTaskSummary(taskId);
                    } else if (action === 'new-terminal') {
                        await this.sendTaskToNewTerminal(taskId);
                    }
                    
                    // Close dropdown after action
                    dropdown.style.display = 'none';
                });
            });
            
            // Add click handler to close dropdown when clicking outside
            setTimeout(() => {
                const closeHandler = (e) => {
                    if (!e.target.closest('.task-header-send-wrapper')) {
                        dropdown.style.display = 'none';
                        document.removeEventListener('click', closeHandler);
                    }
                };
                document.addEventListener('click', closeHandler);
            }, 0);
        } else {
            dropdown.style.display = 'none';
        }
    }

    openDropdownPortal(dropdown, triggerButton) {
        // Store reference to original parent
        dropdown._originalParent = dropdown.parentElement;
        dropdown._originalNextSibling = dropdown.nextSibling;
        
        // Move dropdown to body
        document.body.appendChild(dropdown);
        
        // Add portal class
        dropdown.classList.add('dropdown-portal');
        
        // Calculate position
        this.updateDropdownPortalPosition(dropdown, triggerButton);
        
        // Store reference to trigger button for position updates
        dropdown._triggerButton = triggerButton;
        
        // Add scroll and resize listeners
        dropdown._scrollHandler = () => this.updateDropdownPortalPosition(dropdown, triggerButton);
        dropdown._resizeHandler = () => this.updateDropdownPortalPosition(dropdown, triggerButton);
        
        window.addEventListener('scroll', dropdown._scrollHandler, true);
        window.addEventListener('resize', dropdown._resizeHandler);
    }
    
    updateDropdownPortalPosition(dropdown, triggerButton) {
        const buttonRect = triggerButton.getBoundingClientRect();
        const dropdownHeight = 200; // Approximate height
        const dropdownWidth = 250; // Approximate width
        
        // Calculate position
        let top = buttonRect.bottom + 4;
        let left = buttonRect.left;
        
        // Check if dropdown would go off-screen bottom
        if (top + dropdownHeight > window.innerHeight - 20) {
            // Position above the button
            top = buttonRect.top - dropdownHeight - 4;
        }
        
        // Check if dropdown would go off-screen right
        if (left + dropdownWidth > window.innerWidth - 20) {
            // Align to right edge of button
            left = buttonRect.right - dropdownWidth;
        }
        
        // Ensure it doesn't go off-screen left
        if (left < 20) {
            left = 20;
        }
        
        // Apply position
        dropdown.style.position = 'fixed';
        dropdown.style.top = `${top}px`;
        dropdown.style.left = `${left}px`;
        dropdown.style.right = 'auto';
        dropdown.style.bottom = 'auto';
    }
    
    closeDropdownPortal(dropdown) {
        if (!dropdown) return;
        
        // Remove portal class
        dropdown.classList.remove('dropdown-portal');
        
        // Reset position styles
        dropdown.style.position = '';
        dropdown.style.top = '';
        dropdown.style.left = '';
        dropdown.style.right = '';
        dropdown.style.bottom = '';
        
        // Remove event listeners
        if (dropdown._scrollHandler) {
            window.removeEventListener('scroll', dropdown._scrollHandler, true);
            delete dropdown._scrollHandler;
        }
        if (dropdown._resizeHandler) {
            window.removeEventListener('resize', dropdown._resizeHandler);
            delete dropdown._resizeHandler;
        }
        
        // Return dropdown to original position
        if (dropdown._originalParent) {
            if (dropdown._originalNextSibling) {
                dropdown._originalParent.insertBefore(dropdown, dropdown._originalNextSibling);
            } else {
                dropdown._originalParent.appendChild(dropdown);
            }
        }
        
        // Hide dropdown
        dropdown.style.display = 'none';
        
        // Clean up references
        delete dropdown._originalParent;
        delete dropdown._originalNextSibling;
        delete dropdown._triggerButton;
    }

    async copyTaskSummary(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        // Build task summary
        let summary = `Task #${task.id}: ${this.capitalizeFirstLetter(task.title)}\n\n`;
        
        if (task.description) {
            summary += `Description:\n${task.description}\n\n`;
        }
        
        if (task.plan) {
            summary += `Plan:\n${task.plan}\n\n`;
        }
        
        if (task.implementation) {
            summary += `Previous Implementation:\n${task.implementation}\n\n`;
        }
        
        summary += `Project: ${task.project || 'None'}\n`;
        summary += `Status: ${task.status}\n`;
        summary += `Terminal: ${task.terminal_id || 'Unassigned'}\n`;

        // Copy to clipboard
        try {
            await navigator.clipboard.writeText(summary);
            // Send notification to main window
            ipcRenderer.send('show-badge-notification', `Task #${task.id} copied to clipboard`);
            // Close Task Manager window immediately
            window.close();
        } catch (err) {
            console.error('Failed to copy to clipboard:', err);
            // Still close even if copy failed
            window.close();
        }
        
        // Hide dropdown
        const dropdown = document.getElementById(`send-terminal-dropdown-${taskId}`);
        if (dropdown) {
            this.closeDropdownPortal(dropdown);
        }
    }
}

// Initialize Kanban when page loads
let kanban;
document.addEventListener('DOMContentLoaded', () => {
    kanban = new KanbanManager();
    // Make kanban accessible globally for inline onclick handlers
    window.kanban = kanban;
});

// Handle window keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
            case 't':
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

    if (kanban && kanban.tasks.length > 0) {
        kanban.focusTask(taskId);
    } else {

        pendingFocusTaskId = taskId;
    }
});
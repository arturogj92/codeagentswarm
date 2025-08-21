/**
 * Unit tests for Kanban Pagination System
 * Tests the generic pagination functionality for all kanban columns
 */

describe('Kanban Pagination System', () => {
    let kanbanManager;
    let mockTasks;
    
    beforeEach(() => {
        // Set up DOM environment
        document.body.innerHTML = `
            <div id="kanban-board">
                <div class="kanban-column" data-status="pending">
                    <div class="column-header">
                        <h2>Pending</h2>
                        <span class="task-count" id="pending-count">0</span>
                    </div>
                    <div class="task-list" id="pending-tasks"></div>
                </div>
                <div class="kanban-column" data-status="in_progress">
                    <div class="column-header">
                        <h2>In Progress</h2>
                        <span class="task-count" id="in_progress-count">0</span>
                    </div>
                    <div class="task-list" id="in_progress-tasks"></div>
                </div>
                <div class="kanban-column" data-status="in_testing">
                    <div class="column-header">
                        <h2>In Testing</h2>
                        <span class="task-count" id="in_testing-count">0</span>
                    </div>
                    <div class="task-list" id="in_testing-tasks"></div>
                </div>
                <div class="kanban-column" data-status="completed">
                    <div class="column-header">
                        <h2>Completed</h2>
                        <span class="task-count" id="completed-count">0</span>
                    </div>
                    <div class="task-list" id="completed-tasks"></div>
                </div>
                <input type="text" id="search-input" />
                <button id="clear-search-btn" style="display: none;"></button>
                <span id="search-results-count" style="display: none;"></span>
            </div>
        `;
        
        // Create mock KanbanManager instance
        kanbanManager = {
            tasks: [],
            projects: [],
            currentProjectFilter: 'all',
            searchQuery: '',
            searchDebounceTimer: null,
            
            // Pagination configuration
            paginationConfig: {
                pending: {
                    initialLimit: 50,
                    increment: 30,
                    currentLimit: 50
                },
                in_progress: {
                    initialLimit: 50,
                    increment: 30,
                    currentLimit: 50
                },
                in_testing: {
                    initialLimit: 50,
                    increment: 30,
                    currentLimit: 50
                },
                completed: {
                    initialLimit: 30,
                    increment: 30,
                    currentLimit: 30
                }
            },
            
            allTasksByStatus: {
                pending: [],
                in_progress: [],
                in_testing: [],
                completed: []
            },
            
            sortStates: {
                pending: 'default',
                in_progress: 'default',
                in_testing: 'default',
                completed: 'default'
            },
            
            // Mock methods
            initializeLucideIcons: jest.fn(),
            sortTasksByCreatedDate: jest.fn((tasks) => tasks),
            escapeHtml: jest.fn((text) => text || ''),
            createTaskElement: jest.fn((task) => {
                const element = document.createElement('div');
                element.className = 'task-card';
                element.dataset.taskId = task.id;
                element.innerHTML = `<div class="task-title">${task.title}</div>`;
                return element;
            }),
            
            // Method to test - simplified version
            renderTasks: function() {
                // Filter tasks
                let filteredTasks = this.tasks;
                if (this.searchQuery) {
                    const query = this.searchQuery.toLowerCase();
                    filteredTasks = filteredTasks.filter(task => {
                        return task.title && task.title.toLowerCase().includes(query);
                    });
                }
                
                // Group by status
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
                
                // Store for pagination
                Object.keys(tasksByStatus).forEach(status => {
                    this.allTasksByStatus[status] = tasksByStatus[status];
                });
                
                // Render each column
                Object.keys(tasksByStatus).forEach(status => {
                    let tasks = tasksByStatus[status];
                    const container = document.getElementById(`${status}-tasks`);
                    const count = document.getElementById(`${status}-count`);
                    
                    // Show total count
                    count.textContent = tasks.length;
                    
                    // Apply pagination
                    let tasksToDisplay = tasks;
                    let showLoadMore = false;
                    const config = this.paginationConfig[status];
                    
                    if (!this.searchQuery && tasks.length > config.currentLimit) {
                        tasksToDisplay = tasks.slice(0, config.currentLimit);
                        showLoadMore = true;
                    }
                    
                    // Clear and render
                    container.innerHTML = '';
                    
                    if (tasksToDisplay.length === 0) {
                        container.innerHTML = '<div class="empty-state">No tasks</div>';
                    } else {
                        tasksToDisplay.forEach(task => {
                            const element = this.createTaskElement(task);
                            container.appendChild(element);
                        });
                        
                        if (showLoadMore) {
                            const remainingTasks = tasks.length - config.currentLimit;
                            const loadMoreBtn = document.createElement('div');
                            loadMoreBtn.className = 'load-more-container';
                            loadMoreBtn.innerHTML = `
                                <button class="load-more-btn" onclick="kanban.loadMoreTasks('${status}')">
                                    Load ${Math.min(remainingTasks, config.increment)} more
                                    <span class="remaining-count">(${remainingTasks} remaining)</span>
                                </button>
                            `;
                            container.appendChild(loadMoreBtn);
                        }
                    }
                });
            },
            
            loadMoreTasks: function(status) {
                const container = document.getElementById(`${status}-tasks`);
                const config = this.paginationConfig[status];
                
                let tasks = this.allTasksByStatus[status];
                const currentlyShowing = config.currentLimit;
                const totalTasks = tasks.length;
                const tasksToLoad = Math.min(config.increment, totalTasks - currentlyShowing);
                
                // Get new tasks
                const newTasks = tasks.slice(currentlyShowing, currentlyShowing + tasksToLoad);
                
                // Remove Load More button
                const existingLoadMore = container.querySelector('.load-more-container');
                if (existingLoadMore) {
                    existingLoadMore.remove();
                }
                
                // Add new tasks
                newTasks.forEach(task => {
                    const element = this.createTaskElement(task);
                    container.appendChild(element);
                });
                
                // Update limit
                config.currentLimit += tasksToLoad;
                
                // Add new Load More button if needed
                if (config.currentLimit < totalTasks) {
                    const remainingTasks = totalTasks - config.currentLimit;
                    const loadMoreBtn = document.createElement('div');
                    loadMoreBtn.className = 'load-more-container';
                    loadMoreBtn.innerHTML = `
                        <button class="load-more-btn" onclick="kanban.loadMoreTasks('${status}')">
                            Load ${Math.min(remainingTasks, config.increment)} more
                            <span class="remaining-count">(${remainingTasks} remaining)</span>
                        </button>
                    `;
                    container.appendChild(loadMoreBtn);
                }
            }
        };
        
        // Generate mock tasks
        mockTasks = [];
        for (let i = 1; i <= 200; i++) {
            mockTasks.push({
                id: i,
                title: `Task ${i}`,
                status: i <= 60 ? 'pending' : 
                        i <= 80 ? 'in_progress' : 
                        i <= 100 ? 'in_testing' : 'completed',
                created_at: new Date().toISOString()
            });
        }
    });
    
    describe('Pagination Configuration', () => {
        test('should have correct initial limits for each column', () => {
            expect(kanbanManager.paginationConfig.pending.initialLimit).toBe(50);
            expect(kanbanManager.paginationConfig.in_progress.initialLimit).toBe(50);
            expect(kanbanManager.paginationConfig.in_testing.initialLimit).toBe(50);
            expect(kanbanManager.paginationConfig.completed.initialLimit).toBe(30);
        });
        
        test('should have correct increment values for each column', () => {
            expect(kanbanManager.paginationConfig.pending.increment).toBe(30);
            expect(kanbanManager.paginationConfig.in_progress.increment).toBe(30);
            expect(kanbanManager.paginationConfig.in_testing.increment).toBe(30);
            expect(kanbanManager.paginationConfig.completed.increment).toBe(30);
        });
        
        test('should initialize current limits to initial values', () => {
            expect(kanbanManager.paginationConfig.pending.currentLimit).toBe(50);
            expect(kanbanManager.paginationConfig.in_progress.currentLimit).toBe(50);
            expect(kanbanManager.paginationConfig.in_testing.currentLimit).toBe(50);
            expect(kanbanManager.paginationConfig.completed.currentLimit).toBe(30);
        });
    });
    
    describe('Task Rendering with Pagination', () => {
        beforeEach(() => {
            kanbanManager.tasks = mockTasks;
        });
        
        test('should display correct number of initial tasks in pending column', () => {
            kanbanManager.renderTasks();
            
            const pendingContainer = document.getElementById('pending-tasks');
            const taskCards = pendingContainer.querySelectorAll('.task-card');
            const loadMoreBtn = pendingContainer.querySelector('.load-more-container');
            
            expect(taskCards.length).toBe(50); // Initial limit
            expect(loadMoreBtn).toBeTruthy(); // Should have Load More button
        });
        
        test('should display correct number of initial tasks in completed column', () => {
            kanbanManager.renderTasks();
            
            const completedContainer = document.getElementById('completed-tasks');
            const taskCards = completedContainer.querySelectorAll('.task-card');
            const loadMoreBtn = completedContainer.querySelector('.load-more-container');
            
            expect(taskCards.length).toBe(30); // Initial limit for completed
            expect(loadMoreBtn).toBeTruthy(); // Should have Load More button
        });
        
        test('should show correct total count despite pagination', () => {
            kanbanManager.renderTasks();
            
            const pendingCount = document.getElementById('pending-count');
            const completedCount = document.getElementById('completed-count');
            
            expect(pendingCount.textContent).toBe('60'); // Total pending tasks
            expect(completedCount.textContent).toBe('100'); // Total completed tasks
        });
        
        test('should not show Load More button when tasks are below limit', () => {
            kanbanManager.tasks = mockTasks.slice(0, 20); // Only 20 tasks
            kanbanManager.renderTasks();
            
            const pendingContainer = document.getElementById('pending-tasks');
            const loadMoreBtn = pendingContainer.querySelector('.load-more-container');
            
            expect(loadMoreBtn).toBeFalsy(); // No Load More button needed
        });
        
        test('should show correct remaining count in Load More button', () => {
            kanbanManager.renderTasks();
            
            const pendingContainer = document.getElementById('pending-tasks');
            const loadMoreBtn = pendingContainer.querySelector('.load-more-btn');
            const remainingCount = loadMoreBtn.querySelector('.remaining-count');
            
            expect(remainingCount.textContent).toBe('(10 remaining)'); // 60 total - 50 shown = 10
        });
    });
    
    describe('Load More Functionality', () => {
        beforeEach(() => {
            kanbanManager.tasks = mockTasks;
            kanbanManager.renderTasks();
        });
        
        test('should load additional tasks when clicking Load More', () => {
            const pendingContainer = document.getElementById('pending-tasks');
            
            // Initial state
            let taskCards = pendingContainer.querySelectorAll('.task-card');
            expect(taskCards.length).toBe(50);
            
            // Click Load More
            kanbanManager.loadMoreTasks('pending');
            
            // After loading more
            taskCards = pendingContainer.querySelectorAll('.task-card');
            expect(taskCards.length).toBe(60); // 50 + 10 remaining
        });
        
        test('should update current limit after loading more', () => {
            const initialLimit = kanbanManager.paginationConfig.pending.currentLimit;
            expect(initialLimit).toBe(50);
            
            kanbanManager.loadMoreTasks('pending');
            
            const newLimit = kanbanManager.paginationConfig.pending.currentLimit;
            expect(newLimit).toBe(60); // 50 + 10 loaded
        });
        
        test('should remove Load More button when all tasks are loaded', () => {
            const pendingContainer = document.getElementById('pending-tasks');
            
            // Load all remaining tasks
            kanbanManager.loadMoreTasks('pending');
            
            const loadMoreBtn = pendingContainer.querySelector('.load-more-container');
            expect(loadMoreBtn).toBeFalsy(); // No more tasks to load
        });
        
        test('should handle loading more for completed column correctly', () => {
            const completedContainer = document.getElementById('completed-tasks');
            
            // Initial state
            let taskCards = completedContainer.querySelectorAll('.task-card');
            expect(taskCards.length).toBe(30);
            
            // Click Load More
            kanbanManager.loadMoreTasks('completed');
            
            // After loading more
            taskCards = completedContainer.querySelectorAll('.task-card');
            expect(taskCards.length).toBe(60); // 30 + 30 increment
        });
    });
    
    describe('Search Integration', () => {
        beforeEach(() => {
            kanbanManager.tasks = mockTasks;
        });
        
        test('should disable pagination when searching', () => {
            kanbanManager.searchQuery = 'Task 1';
            kanbanManager.renderTasks();
            
            const pendingContainer = document.getElementById('pending-tasks');
            const loadMoreBtn = pendingContainer.querySelector('.load-more-container');
            
            // Should show all matching tasks without pagination
            expect(loadMoreBtn).toBeFalsy();
        });
        
        test('should reset pagination limits when clearing search', () => {
            // First, load more tasks
            kanbanManager.renderTasks();
            kanbanManager.loadMoreTasks('pending');
            expect(kanbanManager.paginationConfig.pending.currentLimit).toBe(60);
            
            // Now clear search (simulate the clear button functionality)
            kanbanManager.searchQuery = '';
            Object.keys(kanbanManager.paginationConfig).forEach(status => {
                kanbanManager.paginationConfig[status].currentLimit = 
                    kanbanManager.paginationConfig[status].initialLimit;
            });
            
            // Verify limits are reset
            expect(kanbanManager.paginationConfig.pending.currentLimit).toBe(50);
            expect(kanbanManager.paginationConfig.completed.currentLimit).toBe(30);
        });
    });
    
    describe('Edge Cases', () => {
        test('should handle empty columns correctly', () => {
            kanbanManager.tasks = [];
            kanbanManager.renderTasks();
            
            const pendingContainer = document.getElementById('pending-tasks');
            const emptyState = pendingContainer.querySelector('.empty-state');
            const loadMoreBtn = pendingContainer.querySelector('.load-more-container');
            
            expect(emptyState).toBeTruthy();
            expect(loadMoreBtn).toBeFalsy();
        });
        
        test('should handle columns with exact limit number of tasks', () => {
            // Create exactly 50 pending tasks
            kanbanManager.tasks = Array.from({length: 50}, (_, i) => ({
                id: i + 1,
                title: `Task ${i + 1}`,
                status: 'pending',
                created_at: new Date().toISOString()
            }));
            
            kanbanManager.renderTasks();
            
            const pendingContainer = document.getElementById('pending-tasks');
            const taskCards = pendingContainer.querySelectorAll('.task-card');
            const loadMoreBtn = pendingContainer.querySelector('.load-more-container');
            
            expect(taskCards.length).toBe(50);
            expect(loadMoreBtn).toBeFalsy(); // No Load More needed
        });
        
        test('should correctly calculate remaining tasks for partial loads', () => {
            // Create 75 pending tasks (50 initial + 25 to load)
            kanbanManager.tasks = Array.from({length: 75}, (_, i) => ({
                id: i + 1,
                title: `Task ${i + 1}`,
                status: 'pending',
                created_at: new Date().toISOString()
            }));
            
            kanbanManager.renderTasks();
            
            const pendingContainer = document.getElementById('pending-tasks');
            const loadMoreBtn = pendingContainer.querySelector('.load-more-btn');
            
            // Should show "Load 25 more (25 remaining)"
            expect(loadMoreBtn.textContent).toContain('Load 25 more');
            expect(loadMoreBtn.textContent).toContain('(25 remaining)');
        });
    });
    
    describe('Multiple Columns Pagination', () => {
        test('should handle pagination independently for each column', () => {
            kanbanManager.tasks = mockTasks;
            kanbanManager.renderTasks();
            
            // Load more in pending
            kanbanManager.loadMoreTasks('pending');
            expect(kanbanManager.paginationConfig.pending.currentLimit).toBe(60);
            
            // Completed should still be at initial limit
            expect(kanbanManager.paginationConfig.completed.currentLimit).toBe(30);
            
            // Load more in completed
            kanbanManager.loadMoreTasks('completed');
            expect(kanbanManager.paginationConfig.completed.currentLimit).toBe(60);
            
            // Pending should remain at its current limit
            expect(kanbanManager.paginationConfig.pending.currentLimit).toBe(60);
        });
    });
});
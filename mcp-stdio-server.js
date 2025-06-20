#!/usr/bin/env node

/**
 * CodeAgentSwarm Task Management MCP Server (stdio version)
 * Compatible with Claude Code's new MCP system
 */

const readline = require('readline');
const path = require('path');
const fs = require('fs');

// Import our MCP-compatible database manager
const DatabaseManagerMCP = require('./database-mcp');

class MCPStdioServer {
    constructor() {
        this.db = null;
        this.requestId = 0;
        
        // Setup readline interface for JSON-RPC communication
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });
        
        this.rl.on('line', async (line) => {
            await this.handleMessage(line);
        });
        
        // Initialize database
        this.initDatabase();
        
        // Handle process termination
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
    }

    initDatabase() {
        try {
            // Force MCP to use the same database path as Electron app
            const os = require('os');
            const electronDbPath = path.join(os.homedir(), 'Library', 'Application Support', 'codeagentswarm', 'codeagentswarm.db');
            process.env.CODEAGENTSWARM_DB_PATH = electronDbPath;
            
            this.db = new DatabaseManagerMCP();
            this.logError('Database initialized successfully using Electron database:', electronDbPath);
        } catch (error) {
            this.logError('Failed to initialize database:', error.message);
            process.exit(1);
        }
    }

    logError(message, ...args) {
        // Log to stderr so it doesn't interfere with JSON-RPC communication
        console.error('[MCP Server]', message, ...args);
    }

    async handleMessage(line) {
        try {
            const message = JSON.parse(line);
            const response = await this.processRequest(message);
            
            if (response) {
                console.log(JSON.stringify(response));
            }
        } catch (error) {
            this.logError('Error handling message:', error);
            
            const errorResponse = {
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32700,
                    message: 'Parse error'
                }
            };
            
            console.log(JSON.stringify(errorResponse));
        }
    }

    async processRequest(message) {
        const { jsonrpc, id, method, params } = message;
        
        try {
            let result = null;
            
            switch (method) {
                case 'initialize':
                    result = this.handleInitialize(params);
                    break;
                    
                case 'tasks/create':
                    result = await this.createTask(params);
                    break;
                    
                case 'tasks/update_status':
                    result = await this.updateTaskStatus(params);
                    break;
                    
                case 'tasks/get_all':
                    result = await this.getAllTasks(params);
                    break;
                    
                case 'tasks/get_current':
                    result = await this.getCurrentTask(params);
                    break;
                    
                case 'tasks/delete':
                    result = await this.deleteTask(params);
                    break;
                    
                case 'tasks/update':
                    result = await this.updateTask(params);
                    break;
                    
                case 'tasks/update_order':
                    result = await this.updateTasksOrder(params);
                    break;
                    
                case 'tasks/update_plan':
                    result = await this.updateTaskPlan(params);
                    break;
                    
                case 'tasks/update_implementation':
                    result = await this.updateTaskImplementation(params);
                    break;
                    
                case 'tools/list':
                    result = this.listTools();
                    break;
                    
                case 'tools/call':
                    result = await this.callTool(params);
                    break;
                    
                case 'resources/list':
                    result = this.listResources();
                    break;
                    
                case 'resources/read':
                    result = await this.readResource(params);
                    break;
                    
                case 'prompts/list':
                    result = this.listPrompts();
                    break;
                    
                case 'prompts/get':
                    result = await this.getPrompt(params);
                    break;
                    
                default:
                    throw new Error(`Unknown method: ${method}`);
            }
            
            return {
                jsonrpc: '2.0',
                id,
                result
            };
            
        } catch (error) {
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32000,
                    message: error.message
                }
            };
        }
    }

    handleInitialize(params) {
        return {
            protocolVersion: '2024-11-05',
            capabilities: {
                tools: {},
                resources: {},
                prompts: {}
            },
            serverInfo: {
                name: 'CodeAgentSwarm Task Manager',
                version: '1.0.0'
            }
        };
    }

    // Task management methods
    async createTask(params) {
        const { title, description, terminal_id } = params;
        
        if (!title) {
            throw new Error('Title is required');
        }
        
        const result = await this.db.createTask(title, description, terminal_id);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        return {
            id: result.taskId,
            title,
            description,
            terminal_id,
            status: 'pending'
        };
    }

    async updateTaskStatus(params) {
        const { task_id, status } = params;
        
        if (!task_id || !status) {
            throw new Error('task_id and status are required');
        }
        
        if (!['pending', 'in_progress', 'in_testing', 'completed'].includes(status)) {
            throw new Error('Invalid status. Must be pending, in_progress, in_testing, or completed');
        }
        
        const result = this.db.updateTaskStatus(task_id, status);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        // Notify the Electron app when a task is completed or moved to testing
        if (status === 'completed' || status === 'in_testing') {
            this.notifyTaskCompletion(task_id);
        }
        
        return {
            task_id,
            status,
            updated: true
        };
    }

    async getAllTasks(params) {
        const tasks = this.db.getAllTasks();
        return { tasks };
    }

    async getCurrentTask(params) {
        const { terminal_id } = params;
        
        if (terminal_id === undefined) {
            throw new Error('terminal_id is required');
        }
        
        const task = this.db.getCurrentTask(terminal_id);
        return { task };
    }

    async deleteTask(params) {
        const { task_id } = params;
        
        if (!task_id) {
            throw new Error('task_id is required');
        }
        
        const result = this.db.deleteTask(task_id);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        return {
            task_id,
            deleted: true
        };
    }

    async updateTask(params) {
        const { task_id, title, description } = params;
        
        if (!task_id) {
            throw new Error('task_id is required');
        }
        
        const result = this.db.updateTask(task_id, title, description);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        return {
            task_id,
            title,
            description,
            updated: true
        };
    }

    async updateTasksOrder(params) {
        const { taskOrders } = params;
        
        if (!taskOrders || !Array.isArray(taskOrders)) {
            throw new Error('taskOrders array is required');
        }
        
        const result = await this.db.updateTasksOrder(taskOrders);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        return {
            updated: true,
            taskCount: taskOrders.length
        };
    }

    async updateTaskPlan(params) {
        const { task_id, plan } = params;
        
        if (!task_id) {
            throw new Error('task_id is required');
        }
        
        const result = this.db.updateTaskPlan(task_id, plan);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        return {
            task_id,
            plan,
            updated: true
        };
    }

    async updateTaskImplementation(params) {
        const { task_id, implementation } = params;
        
        if (!task_id) {
            throw new Error('task_id is required');
        }
        
        const result = this.db.updateTaskImplementation(task_id, implementation);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        return {
            task_id,
            implementation,
            updated: true
        };
    }

    // MCP Tools
    listTools() {
        return {
            tools: [
                {
                    name: 'create_task',
                    description: 'Create a new task',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: 'Task title' },
                            description: { type: 'string', description: 'Task description' },
                            terminal_id: { type: 'number', description: 'Terminal ID (0-3)' }
                        },
                        required: ['title']
                    }
                },
                {
                    name: 'start_task',
                    description: 'Start working on a task (mark as in_progress)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task_id: { type: 'number', description: 'Task ID' }
                        },
                        required: ['task_id']
                    }
                },
                {
                    name: 'complete_task',
                    description: 'Mark a task as completed',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task_id: { type: 'number', description: 'Task ID' }
                        },
                        required: ['task_id']
                    }
                },
                {
                    name: 'submit_for_testing',
                    description: 'Submit a task for testing (mark as in_testing)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task_id: { type: 'number', description: 'Task ID' }
                        },
                        required: ['task_id']
                    }
                },
                {
                    name: 'list_tasks',
                    description: 'List all tasks',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            status: { type: 'string', enum: ['pending', 'in_progress', 'in_testing', 'completed'], description: 'Filter by status' }
                        }
                    }
                },
                {
                    name: 'update_task_plan',
                    description: 'Update the plan for a task',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task_id: { type: 'number', description: 'Task ID' },
                            plan: { type: 'string', description: 'Task plan' }
                        },
                        required: ['task_id', 'plan']
                    }
                },
                {
                    name: 'update_task_implementation',
                    description: 'Update the implementation details for a task',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task_id: { type: 'number', description: 'Task ID' },
                            implementation: { type: 'string', description: 'Implementation details including modified files and summary' }
                        },
                        required: ['task_id', 'implementation']
                    }
                }
            ]
        };
    }

    async callTool(params) {
        const { name, arguments: args } = params;
        
        let result;
        switch (name) {
            case 'create_task':
                result = await this.createTask(args);
                break;
                
            case 'start_task':
                result = await this.updateTaskStatus({ task_id: args.task_id, status: 'in_progress' });
                break;
                
            case 'complete_task':
                result = await this.updateTaskStatus({ task_id: args.task_id, status: 'completed' });
                break;
                
            case 'submit_for_testing':
                result = await this.updateTaskStatus({ task_id: args.task_id, status: 'in_testing' });
                break;
                
            case 'list_tasks':
                if (args.status) {
                    const tasks = await this.db.getTasksByStatus(args.status);
                    result = { tasks };
                } else {
                    const tasks = await this.db.getAllTasks();
                    result = { tasks };
                }
                break;
                
            case 'update_task_plan':
                result = await this.updateTaskPlan({ task_id: args.task_id, plan: args.plan });
                break;
                
            case 'update_task_implementation':
                result = await this.updateTaskImplementation({ task_id: args.task_id, implementation: args.implementation });
                break;
                
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
        
        // Return in MCP tool call result format
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }
            ]
        };
    }

    // MCP Resources
    listResources() {
        return {
            resources: [
                {
                    uri: 'task://all',
                    name: 'All Tasks',
                    description: 'List of all tasks in the system',
                    mimeType: 'application/json'
                },
                {
                    uri: 'task://pending',
                    name: 'Pending Tasks',
                    description: 'List of pending tasks',
                    mimeType: 'application/json'
                },
                {
                    uri: 'task://in_progress',
                    name: 'In Progress Tasks',
                    description: 'List of tasks currently in progress',
                    mimeType: 'application/json'
                },
                {
                    uri: 'task://in_testing',
                    name: 'In Testing Tasks',
                    description: 'List of tasks in testing',
                    mimeType: 'application/json'
                },
                {
                    uri: 'task://completed',
                    name: 'Completed Tasks',
                    description: 'List of completed tasks',
                    mimeType: 'application/json'
                }
            ]
        };
    }

    async readResource(params) {
        const { uri } = params;
        
        if (uri.startsWith('task://')) {
            const status = uri.replace('task://', '');
            
            let tasks;
            if (status === 'all') {
                tasks = this.db.getAllTasks();
            } else {
                tasks = this.db.getTasksByStatus(status);
            }
            
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(tasks, null, 2)
                    }
                ]
            };
        }
        
        throw new Error(`Unknown resource: ${uri}`);
    }

    // MCP Prompts
    listPrompts() {
        return {
            prompts: [
                {
                    name: 'start_coding_session',
                    description: 'Start a new coding session with a task',
                    arguments: [
                        {
                            name: 'task_title',
                            description: 'Title of the task',
                            required: true
                        },
                        {
                            name: 'task_description',
                            description: 'Description of the task',
                            required: false
                        }
                    ]
                },
                {
                    name: 'task_summary',
                    description: 'Get a summary of current tasks',
                    arguments: []
                }
            ]
        };
    }

    async getPrompt(params) {
        const { name, arguments: args } = params;
        
        switch (name) {
            case 'start_coding_session':
                const { task_title, task_description } = args;
                return {
                    description: 'Starting a new coding session',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `I'm starting work on a new task: "${task_title}"${task_description ? `\n\nDescription: ${task_description}` : ''}\n\nPlease help me break this down and get started. Create the task in the system and mark it as in progress.`
                            }
                        }
                    ]
                };
                
            case 'task_summary':
                const allTasks = this.db.getAllTasks();
                const pending = allTasks.filter(t => t.status === 'pending').length;
                const inProgress = allTasks.filter(t => t.status === 'in_progress').length;
                const inTesting = allTasks.filter(t => t.status === 'in_testing').length;
                const completed = allTasks.filter(t => t.status === 'completed').length;
                
                return {
                    description: 'Current task summary',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Here's my current task summary:\n\n📋 Pending: ${pending}\n🚀 In Progress: ${inProgress}\n🧪 In Testing: ${inTesting}\n✅ Completed: ${completed}\n\nPlease show me what I should work on next.`
                            }
                        }
                    ]
                };
                
            default:
                throw new Error(`Unknown prompt: ${name}`);
        }
    }

    // Notify the Electron app when a task is completed
    notifyTaskCompletion(taskId) {
        try {
            // Get the task details to include in the notification
            const task = this.db.getTaskById(taskId);
            if (!task) return;
            
            // Create a notification file that the Electron app can monitor
            const os = require('os');
            const fs = require('fs');
            const notificationDir = path.join(os.homedir(), '.codeagentswarm');
            const notificationFile = path.join(notificationDir, 'task_notifications.json');
            
            // Ensure the directory exists
            if (!fs.existsSync(notificationDir)) {
                fs.mkdirSync(notificationDir, { recursive: true });
            }
            
            // Read existing notifications or create new array
            let notifications = [];
            if (fs.existsSync(notificationFile)) {
                try {
                    const content = fs.readFileSync(notificationFile, 'utf8');
                    notifications = JSON.parse(content);
                } catch (e) {
                    // If file is corrupted, start fresh
                    notifications = [];
                }
            }
            
            // Add new notification
            notifications.push({
                type: 'task_completed',
                taskId: taskId,
                taskTitle: task.title,
                timestamp: new Date().toISOString(),
                processed: false
            });
            
            // Keep only last 50 notifications to prevent file from growing too large
            if (notifications.length > 50) {
                notifications = notifications.slice(-50);
            }
            
            // Write notifications back to file
            fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
            
            this.logError(`Task completion notification written for task: ${task.title}`);
        } catch (error) {
            this.logError('Failed to notify task completion:', error.message);
        }
    }

    shutdown() {
        this.logError('Shutting down MCP server...');
        if (this.db) {
            this.db.close();
        }
        process.exit(0);
    }
}

// Start the server
new MCPStdioServer();
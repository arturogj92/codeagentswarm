#!/usr/bin/env node

/**
 * CodeAgentSwarm Task Management MCP Server (stdio version)
 * Compatible with Claude Code's new MCP system
 */

const readline = require('readline');
const path = require('path');
const fs = require('fs');
  
// Initialize child process logger
const ChildProcessLogger = require('./child-process-logger');
const childLogger = new ChildProcessLogger('MCP-Server');

// Import our MCP-compatible database manager
// Always use standalone version to avoid native module compatibility issues
let DatabaseManagerMCP;
console.log('[MCP Server] Using standalone database module');
DatabaseManagerMCP = require('./database-mcp-standalone');

class MCPStdioServer {
    constructor() {
        this.db = null;
        this.requestId = 0;
        this.startTime = Date.now();
        this.requestCount = 0;
        this.lastError = null;
        
        this.logError('🚀 Starting MCP STDIO Server at', new Date().toISOString());
        
        // Setup error handlers BEFORE anything else
        process.on('uncaughtException', (error) => {
            this.logError('❌ Uncaught Exception:', error.message);
            this.logError('Stack:', error.stack);
            this.lastError = error;
            // Try to stay alive
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            this.logError('❌ Unhandled Rejection at:', promise);
            this.logError('Reason:', reason);
            this.lastError = reason;
        });
        
        // Setup readline interface for JSON-RPC communication
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });
        
        this.rl.on('line', async (line) => {
            await this.handleMessage(line);
        });
        
        this.rl.on('error', (error) => {
            this.logError('❌ Readline error:', error.message);
            this.lastError = error;
        });
        
        this.rl.on('close', () => {
            this.logError('⚠️ Readline interface closed');
            this.shutdown();
        });
        
        // Initialize database
        this.initDatabase();
        
        // Handle process termination
        process.on('SIGINT', () => {
            this.logError('⚠️ Received SIGINT signal');
            this.shutdown();
        });
        
        process.on('SIGTERM', () => {
            this.logError('⚠️ Received SIGTERM signal');
            this.shutdown();
        });
        
        // Log status periodically
        this.statusInterval = setInterval(() => {
            const uptime = Math.floor((Date.now() - this.startTime) / 1000);
            this.logError(`📊 MCP Server Status: Uptime ${uptime}s, Requests: ${this.requestCount}, Last error: ${this.lastError ? this.lastError.message : 'none'}`);
        }, 60000); // Every minute
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
    
    generateShortTitle(fullTitle) {
        // Generate a 3-word title from a longer task title
        if (!fullTitle) return '';
        
        // If already 3 words or less, return as is
        const words = fullTitle.split(' ').filter(w => w.length > 0);
        if (words.length <= 3) {
            return fullTitle;
        }
        
        // Common words to filter out
        const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'been'];
        
        // Filter out stop words and keep important words
        const importantWords = words.filter(word => {
            const lowerWord = word.toLowerCase();
            return !stopWords.includes(lowerWord) && lowerWord.length > 2;
        });
        
        // If we have 3 or more important words, take the first 3
        if (importantWords.length >= 3) {
            return importantWords.slice(0, 3).join(' ');
        }
        
        // Otherwise, take the first word and up to 2 important words
        const result = [];
        if (words.length > 0) {
            result.push(words[0]); // Always include first word (usually a verb)
        }
        
        // Add remaining important words
        for (const word of importantWords.slice(0, 2)) {
            if (!result.includes(word)) {
                result.push(word);
            }
        }
        
        // If still not enough, add original words
        for (const word of words) {
            if (result.length >= 3) break;
            if (!result.includes(word)) {
                result.push(word);
            }
        }
        
        return result.slice(0, 3).join(' ');
    }

    async handleMessage(line) {
        try {
            this.requestCount++;
            
            // Log incoming message for debugging (truncate if too long)
            const truncatedLine = line.length > 200 ? line.substring(0, 200) + '...' : line;
            this.logError('📥 Received message:', truncatedLine);
            
            const message = JSON.parse(line);
            const response = await this.processRequest(message);
            
            if (response) {
                console.log(JSON.stringify(response));
                this.logError('📤 Sent response for method:', message.method || 'unknown');
            }
        } catch (error) {
            this.logError('❌ Error handling message:', error.message);
            this.logError('Stack:', error.stack);
            this.lastError = error;
            
            const errorResponse = {
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32700,
                    message: 'Parse error: ' + error.message
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
                    
                case 'get_working_directory':
                    result = await this.getWorkingDirectory(params);
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
        const { title, description, terminal_id, project } = params;
        
        if (!title) {
            throw new Error('Title is required');
        }
        
        const result = await this.db.createTask(title, description, terminal_id, project);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        return {
            id: result.taskId,
            title,
            description,
            terminal_id,
            project: project || null,
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

    async updateTaskTerminal(params) {
        const { task_id, terminal_id } = params;
        
        if (!task_id) {
            throw new Error('task_id is required');
        }
        
        if (terminal_id === undefined || terminal_id === null) {
            throw new Error('terminal_id is required (use empty string to unassign)');
        }
        
        const result = this.db.updateTaskTerminal(task_id, terminal_id);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        return {
            task_id,
            terminal_id,
            updated: true
        };
    }
    
    async updateTerminalTitle(params) {
        const { title } = params;
        
        if (!title) {
            throw new Error('title is required');
        }
        
        // Limit to 3 words
        const words = title.split(' ').slice(0, 3);
        const shortTitle = words.join(' ');
        
        // Get current terminal from environment
        const terminalId = process.env.CODEAGENTSWARM_CURRENT_QUADRANT;
        if (!terminalId) {
            throw new Error('Cannot detect current terminal. CODEAGENTSWARM_CURRENT_QUADRANT not set');
        }
        
        try {
            // Get current task for this terminal if any
            let taskId = null;
            try {
                const currentTask = this.db.getCurrentTask(parseInt(terminalId));
                if (currentTask) {
                    taskId = currentTask.id;
                }
            } catch (e) {
                // No current task, that's ok
            }
            
            // Write notification for title update
            const os = require('os');
            const fs = require('fs');
            const notificationDir = path.join(os.homedir(), '.codeagentswarm');
            const notificationFile = path.join(notificationDir, 'task_notifications.json');
            
            // Ensure directory exists
            if (!fs.existsSync(notificationDir)) {
                fs.mkdirSync(notificationDir, { recursive: true });
            }
            
            // Read existing notifications
            let notifications = [];
            if (fs.existsSync(notificationFile)) {
                try {
                    const content = fs.readFileSync(notificationFile, 'utf8');
                    notifications = JSON.parse(content);
                } catch (e) {
                    // Invalid JSON, start fresh
                    notifications = [];
                }
            }
            
            // Add terminal title update notification
            const newNotification = {
                type: 'terminal_title_update',
                terminal_id: parseInt(terminalId),
                title: shortTitle,
                task_id: taskId,
                timestamp: new Date().toISOString(),
                processed: false
            };
            
            notifications.push(newNotification);
            
            this.logError(`📝 Terminal title notification created:`, JSON.stringify(newNotification, null, 2));
            
            // Keep only last 50 notifications
            if (notifications.length > 50) {
                notifications = notifications.slice(-50);
            }
            
            // Write back to file
            fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
            
            this.logError(`✅ Terminal title updated: "${shortTitle}" for terminal ${terminalId}`);
            this.logError(`📁 Notification written to: ${notificationFile}`);
            
            return {
                terminal_id: parseInt(terminalId),
                title: shortTitle,
                task_id: taskId,
                updated: true
            };
        } catch (error) {
            throw new Error(`Failed to update terminal title: ${error.message}`);
        }
    }

    // Project management methods
    async createProject(params) {
        const { name, color } = params;
        
        if (!name) {
            throw new Error('Project name is required');
        }
        
        const result = await this.db.createProject(name, color);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        return {
            id: result.projectId,
            name: result.name,
            color: result.color,
            created: true
        };
    }
    
    async getProjects() {
        const projects = await this.db.getProjects();
        return { projects };
    }
    
    async getProjectTasks(params) {
        const { project_name } = params;
        
        if (!project_name) {
            throw new Error('project_name is required');
        }
        
        const tasks = await this.db.getTasksByProject(project_name);
        return { tasks };
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
                            terminal_id: { type: 'number', description: 'Terminal ID (0-3)' },
                            project: { type: 'string', description: 'Project name (optional, defaults to CodeAgentSwarm)' }
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
                    description: 'Move task to testing (first call) or to completed (second call after manual approval and 30-second minimum testing period)',
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
                    name: 'search_tasks',
                    description: 'Search for tasks by keywords in title, description, plan, or implementation',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Search query to find in task fields' },
                            status: { type: 'string', enum: ['pending', 'in_progress', 'in_testing', 'completed'], description: 'Optional: filter by status' },
                            recent_only: { type: 'boolean', description: 'Optional: only search tasks updated in last 48 hours (default: true)' },
                            limit: { type: 'number', description: 'Optional: maximum number of results (default: 20)' }
                        },
                        required: ['query']
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
                },
                {
                    name: 'update_task_terminal',
                    description: 'Update the terminal ID associated with a task',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task_id: { type: 'number', description: 'Task ID' },
                            terminal_id: { type: 'string', description: 'Terminal ID (1, 2, 3, 4, etc.) or empty string to unassign' }
                        },
                        required: ['task_id', 'terminal_id']
                    }
                },
                {
                    name: 'update_terminal_title',
                    description: 'Update the terminal title (max 3 words) to show what the terminal is working on',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: 'Terminal title (max 3 words, e.g., "Fix Auth Bug")' }
                        },
                        required: ['title']
                    }
                },
                {
                    name: 'create_project',
                    description: 'Create a new project',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Project name' },
                            color: { type: 'string', description: 'Project color in hex format (optional)' }
                        },
                        required: ['name']
                    }
                },
                {
                    name: 'get_projects',
                    description: 'Get all projects',
                    inputSchema: {
                        type: 'object',
                        properties: {}
                    }
                },
                {
                    name: 'get_project_tasks',
                    description: 'Get all tasks for a specific project',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            project_name: { type: 'string', description: 'Project name' }
                        },
                        required: ['project_name']
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
                // Auto-detect terminal_id from environment variable if not provided
                if (!args.terminal_id) {
                    const envTerminalId = process.env.CODEAGENTSWARM_CURRENT_QUADRANT;
                    if (envTerminalId) {
                        args.terminal_id = parseInt(envTerminalId);
                        this.logError(`Auto-detected terminal_id from environment: ${args.terminal_id}`);
                    } else {
                        this.logError('Warning: No terminal_id provided and CODEAGENTSWARM_CURRENT_QUADRANT not set');
                    }
                }
                
                // Auto-detect project if not provided
                if (!args.project) {
                    try {
                        let projectName = null;
                        
                        // If terminal_id is provided, try to get project from terminal's working directory
                        if (args.terminal_id) {
                            const workingDir = await this.getTerminalWorkingDirectory(args.terminal_id);
                            if (workingDir) {
                                // First, try to get project name from CLAUDE.md
                                projectName = await this.getProjectFromClaudeMd(workingDir);
                                
                                // If not found in CLAUDE.md, use directory name as fallback
                                if (!projectName) {
                                    projectName = path.basename(workingDir);
                                    this.logError(`No project found in CLAUDE.md, using directory name: ${projectName}`);
                                }
                            }
                        }
                        
                        // If still no project name, try current working directory
                        if (!projectName) {
                            const cwd = process.cwd();
                            // Try CLAUDE.md in current directory first
                            projectName = await this.getProjectFromClaudeMd(cwd);
                            
                            // If not found, use current directory name
                            if (!projectName) {
                                projectName = path.basename(cwd);
                                this.logError(`No terminal or project specified, using current directory name: ${projectName}`);
                            }
                        }
                        
                        // Check if project exists, create if not
                        if (projectName) {
                            const existingProject = await this.db.getProjectByName(projectName);
                            if (!existingProject) {
                                await this.db.createProject(projectName);
                                this.logError(`Created new project: ${projectName}`);
                            }
                            
                            args.project = projectName;
                        }
                    } catch (error) {
                        this.logError('Failed to auto-detect project:', error.message);
                        // Will fall back to 'General' in createTask
                    }
                }
                result = await this.createTask(args);
                break;
                
            case 'start_task':
                // Auto-assign terminal to task when starting if environment variable is set
                const currentTerminalId = process.env.CODEAGENTSWARM_CURRENT_QUADRANT;
                if (currentTerminalId) {
                    // First update the terminal assignment
                    await this.updateTaskTerminal({ 
                        task_id: args.task_id, 
                        terminal_id: parseInt(currentTerminalId).toString() 
                    });
                    this.logError(`Auto-assigned task ${args.task_id} to terminal ${currentTerminalId}`);
                    
                    // Generate and update terminal title based on task
                    try {
                        const task = await this.db.getTaskById(args.task_id);
                        if (task && task.title) {
                            const shortTitle = this.generateShortTitle(task.title);
                            if (shortTitle) {
                                await this.updateTerminalTitle({ title: shortTitle });
                                this.logError(`Auto-generated terminal title: "${shortTitle}" for task ${args.task_id}`);
                            }
                        }
                    } catch (e) {
                        // Don't fail the task start if title update fails
                        this.logError('Failed to auto-generate terminal title:', e.message);
                    }
                }
                
                result = await this.updateTaskStatus({ task_id: args.task_id, status: 'in_progress' });
                break;
                
            case 'complete_task':
                // First check if task is already in_testing
                const task = await this.db.getTaskById(args.task_id);
                if (!task) {
                    throw new Error('Task not found');
                }
                
                if (task.status === 'in_testing') {
                    // If already in testing, check if implementation is documented
                    if (!task.implementation || task.implementation.trim() === '') {
                        throw new Error('Task must have implementation documented before completing. Use update_task_implementation first.');
                    }
                    
                    // Check if enough time has passed since entering testing phase
                    const testingStartTime = new Date(task.updated_at).getTime();
                    const currentTime = new Date().getTime();
                    const minimumTestingTime = 30000; // 30 seconds minimum in testing phase
                    
                    if (currentTime - testingStartTime < minimumTestingTime) {
                        const remainingTime = Math.ceil((minimumTestingTime - (currentTime - testingStartTime)) / 1000);
                        throw new Error(`Task must remain in testing phase for at least 30 seconds before completion. Please wait ${remainingTime} more seconds for manual review.`);
                    }
                    
                    // Move to completed
                    result = await this.updateTaskStatus({ task_id: args.task_id, status: 'completed' });
                } else if (task.status === 'in_progress') {
                    // Only allow transition from in_progress to in_testing
                    result = await this.updateTaskStatus({ task_id: args.task_id, status: 'in_testing' });
                    result.message = 'Task moved to testing phase. Manual review required before completion. Minimum testing time: 30 seconds.';
                } else {
                    throw new Error(`Cannot complete task with status '${task.status}'. Task must be 'in_progress' or 'in_testing'.`);
                }
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
                
            case 'search_tasks':
                const searchOptions = {
                    status: args.status,
                    recentOnly: args.recent_only !== false, // Default to true
                    limit: args.limit || 20
                };
                const searchResults = await this.db.searchTasks(args.query, searchOptions);
                result = { 
                    tasks: searchResults,
                    query: args.query,
                    count: searchResults.length
                };
                break;
                
            case 'update_task_plan':
                result = await this.updateTaskPlan({ task_id: args.task_id, plan: args.plan });
                break;
                
            case 'update_task_implementation':
                result = await this.updateTaskImplementation({ task_id: args.task_id, implementation: args.implementation });
                break;
                
            case 'update_task_terminal':
                result = await this.updateTaskTerminal({ task_id: args.task_id, terminal_id: args.terminal_id });
                break;
                
            case 'update_terminal_title':
                result = await this.updateTerminalTitle({ title: args.title });
                break;
                
            case 'create_project':
                result = await this.createProject(args);
                break;
                
            case 'get_projects':
                result = await this.getProjects();
                break;
                
            case 'get_project_tasks':
                result = await this.getProjectTasks(args);
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

    // Get terminal working directory from the database
    async getTerminalWorkingDirectory(terminalId) {
        return new Promise((resolve) => {
            this.db.db.get(
                "SELECT directory FROM terminal_directories WHERE terminal_id = ?",
                [terminalId],
                (err, row) => {
                    if (err) {
                        this.logError('Error getting terminal directory:', err.message);
                        resolve(null);
                    } else if (row && row.directory) {
                        resolve(row.directory);
                    } else {
                        resolve(null);
                    }
                }
            );
        });
    }

    // Get project name from CLAUDE.md file in the given directory
    async getProjectFromClaudeMd(directory) {
        try {
            const claudeMdPath = path.join(directory, 'CLAUDE.md');
            
            // Check if CLAUDE.md exists
            if (!fs.existsSync(claudeMdPath)) {
                return null;
            }
            
            // Read the file
            const content = fs.readFileSync(claudeMdPath, 'utf8');
            
            // Look for project name in the Project Configuration section
            const projectMatch = content.match(/## Project Configuration[\s\S]*?\*\*Project Name\*\*:\s*(.+?)(?:\n|$)/);
            
            if (projectMatch && projectMatch[1]) {
                const projectName = projectMatch[1].trim();
                this.logError(`Found project name in CLAUDE.md: ${projectName}`);
                return projectName;
            }
            
            return null;
        } catch (error) {
            this.logError('Error reading project from CLAUDE.md:', error.message);
            return null;
        }
    }

    shutdown() {
        this.logError('🛑 Shutting down MCP server...');
        this.logError(`Final stats: Uptime ${Math.floor((Date.now() - this.startTime) / 1000)}s, Total requests: ${this.requestCount}`);
        
        // Clear status interval
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
        }
        
        // Close readline interface
        if (this.rl) {
            this.rl.close();
        }
        
        // Close database
        if (this.db) {
            try {
                this.db.close();
                this.logError('✅ Database closed successfully');
            } catch (error) {
                this.logError('❌ Error closing database:', error.message);
            }
        }
        
        this.logError('👋 MCP server shutdown complete');
        process.exit(0);
    }
}

// Start the server
new MCPStdioServer();
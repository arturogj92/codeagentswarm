const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const DatabaseManager = require('../database/database');

class MCPTaskServer {
    constructor(port = 0) {
        this.port = port;
        this.server = null;
        this.wsServer = null;
        this.clients = new Set();
        this.db = new DatabaseManager();
        this.actualPort = null;
    }

    start() {
        return new Promise((resolve, reject) => {
            // Create HTTP server
            this.server = createServer();
            
            // Create WebSocket server
            this.wsServer = new WebSocketServer({ server: this.server });
            
            this.wsServer.on('connection', (ws) => {
                console.log('MCP client connected');
                this.clients.add(ws);
                
                ws.on('message', async (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        const response = await this.handleMessage(message);
                        ws.send(JSON.stringify(response));
                    } catch (error) {
                        console.error('Error handling MCP message:', error);
                        ws.send(JSON.stringify({
                            jsonrpc: '2.0',
                            id: null,
                            error: {
                                code: -32000,
                                message: error.message
                            }
                        }));
                    }
                });
                
                ws.on('close', () => {
                    console.log('MCP client disconnected');
                    this.clients.delete(ws);
                });
                
                ws.on('error', (error) => {
                    console.error('WebSocket error:', error);
                    this.clients.delete(ws);
                });
            });
            
            this.server.listen(this.port, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                this.actualPort = this.server.address().port;
                console.log(`MCP Task Server started on port ${this.actualPort}`);
                resolve(this.actualPort);
            });
        });
    }

    async handleMessage(message) {
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
            capabilities: {
                tasks: {
                    create: true,
                    update_status: true,
                    get_all: true,
                    get_current: true,
                    delete: true,
                    update: true
                }
            },
            serverInfo: {
                name: 'CodeAgentSwarm Task Manager',
                version: '1.0.0'
            }
        };
    }

    async createTask(params) {
        const { title, description, terminal_id } = params;
        
        if (!title) {
            throw new Error('Title is required');
        }
        
        const result = this.db.createTask(title, description, terminal_id);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        // Broadcast task creation to all clients (for UI updates)
        this.broadcastTaskUpdate('task_created', {
            id: result.taskId,
            title,
            description,
            terminal_id,
            status: 'pending'
        });
        
        return {
            task_id: result.taskId,
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
        
        if (!['pending', 'in_progress', 'completed'].includes(status)) {
            throw new Error('Invalid status. Must be pending, in_progress, or completed');
        }
        
        const result = this.db.updateTaskStatus(task_id, status);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        // Broadcast task update to all clients
        this.broadcastTaskUpdate('task_status_updated', {
            task_id,
            status
        });
        
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
        
        // Broadcast task deletion to all clients
        this.broadcastTaskUpdate('task_deleted', { task_id });
        
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
        
        // Broadcast task update to all clients
        this.broadcastTaskUpdate('task_updated', {
            task_id,
            title,
            description
        });
        
        return {
            task_id,
            title,
            description,
            updated: true
        };
    }

    broadcastTaskUpdate(event, data) {
        const message = JSON.stringify({
            jsonrpc: '2.0',
            method: 'notification',
            params: {
                event,
                data
            }
        });
        
        this.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
                client.send(message);
            }
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.wsServer) {
                this.wsServer.close();
            }
            
            if (this.server) {
                this.server.close(() => {
                    console.log('MCP Task Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
            
            if (this.db) {
                this.db.close();
            }
        });
    }

    getPort() {
        return this.actualPort;
    }
}

module.exports = MCPTaskServer;
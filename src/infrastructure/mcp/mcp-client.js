#!/usr/bin/env node

// MCP Client script for CodeAgentSwarm Task Management
// This script connects Claude Code to our task management server

const WebSocket = require('ws');
const readline = require('readline');

// Parse command line arguments
const args = process.argv.slice(2);
const portArg = args.find(arg => arg.startsWith('--port='));
const port = portArg ? portArg.split('=')[1] : '3000';

let ws;
let connected = false;

// Set up readline interface for JSON-RPC communication
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

function connect() {
    const wsUrl = `ws://localhost:${port}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
        connected = true;
        console.error(`Connected to CodeAgentSwarm Task Server on port ${port}`);
        
        // Send initialization message
        const initMessage = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                clientInfo: {
                    name: 'Claude Code',
                    version: '1.0.0'
                }
            }
        };
        
        ws.send(JSON.stringify(initMessage));
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            // Forward response to stdout for Claude Code

        } catch (error) {
            console.error('Error parsing message from server:', error);
        }
    });

    ws.on('close', () => {
        connected = false;
        console.error('Disconnected from CodeAgentSwarm Task Server');
        
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
            if (!connected) {
                console.error('Attempting to reconnect...');
                connect();
            }
        }, 5000);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.error('CodeAgentSwarm Task Server is not running');
            console.error('Please start the CodeAgentSwarm application first');
            process.exit(1);
        }
    });
}

// Handle input from Claude Code
rl.on('line', (line) => {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
        console.error('Not connected to task server');
        return;
    }
    
    try {
        // Parse the JSON-RPC message from Claude Code
        const message = JSON.parse(line);
        
        // Forward to WebSocket server
        ws.send(line);
        
    } catch (error) {
        console.error('Error parsing input from Claude Code:', error);
        
        // Send error response
        const errorResponse = {
            jsonrpc: '2.0',
            id: null,
            error: {
                code: -32700,
                message: 'Parse error'
            }
        };

    }
});

// Handle process termination
process.on('SIGINT', () => {
    console.error('Shutting down MCP client...');
    if (ws) {
        ws.close();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.error('Shutting down MCP client...');
    if (ws) {
        ws.close();
    }
    process.exit(0);
});

// Start connection
connect();
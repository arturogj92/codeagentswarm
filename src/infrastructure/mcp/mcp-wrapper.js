#!/usr/bin/env node

// MCP Wrapper - Ensures compatibility with Claude Desktop
const { spawn } = require('child_process');
const path = require('path');

console.error('[MCP-WRAPPER] Starting CodeAgentSwarm MCP Server...');

const serverPath = path.join(__dirname, 'mcp-stdio-server.js');

// Spawn the actual server
const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
});

// Pass through stdin
process.stdin.pipe(server.stdin);

// Pass through stdout
server.stdout.pipe(process.stdout);

// Pass through stderr
server.stderr.on('data', (data) => {
    process.stderr.write(data);
});

// Handle server exit
server.on('close', (code) => {
    console.error(`[MCP-WRAPPER] Server exited with code ${code}`);
    process.exit(code);
});

// Handle wrapper exit
process.on('SIGINT', () => {
    server.kill('SIGINT');
});

process.on('SIGTERM', () => {
    server.kill('SIGTERM');
});

console.error('[MCP-WRAPPER] Wrapper initialized successfully');
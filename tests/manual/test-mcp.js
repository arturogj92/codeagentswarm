#!/usr/bin/env node

// Test script to verify MCP server
const spawn = require('child_process').spawn;

console.log('Testing MCP server...');

const mcp = spawn('/Users/vzgb9jp/.nvm/versions/node/v18.20.4/bin/node', [
  '/Users/vzgb9jp/Library/Application Support/codeagentswarm/mcp/mcp-stdio-server.js'
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Send initialize request
const initRequest = {
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {}
  },
  id: 1
};

mcp.stdin.write(JSON.stringify(initRequest) + '\n');

mcp.stdout.on('data', (data) => {
  console.log('STDOUT:', data.toString());
});

mcp.stderr.on('data', (data) => {
  console.error('STDERR:', data.toString());
});

mcp.on('close', (code) => {
  console.log('Process exited with code:', code);
});

// Give it 2 seconds then close
setTimeout(() => {
  mcp.stdin.end();
  process.exit(0);
}, 2000);
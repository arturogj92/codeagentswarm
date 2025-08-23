#!/bin/bash

# CodeAgentSwarm MCP Uninstallation Script
# This script removes the CodeAgentSwarm task management server from Claude Code

set -e

echo "🗑️  Uninstalling CodeAgentSwarm MCP Server..."

# Check if Claude Code is installed
if ! command -v claude &> /dev/null; then
    echo "❌ Error: Claude Code is not installed or not in PATH"
    exit 1
fi

# Remove the MCP server
echo "📝 Removing CodeAgentSwarm MCP server from Claude Code..."
claude mcp remove codeagentswarm

if [ $? -eq 0 ]; then
    echo "✅ CodeAgentSwarm MCP server uninstalled successfully!"
    echo ""
    echo "🔧 To verify removal:"
    echo "  claude mcp list"
else
    echo "❌ Failed to uninstall CodeAgentSwarm MCP server (it may not have been installed)"
fi
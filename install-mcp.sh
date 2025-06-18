#!/bin/bash

# CodeAgentSwarm MCP Installation Script
# This script registers the CodeAgentSwarm task management server with Claude Code

set -e

echo "🚀 Installing CodeAgentSwarm MCP Server..."

# Get the absolute path to the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_SERVER_PATH="$SCRIPT_DIR/mcp-stdio-server.js"

# Check if the MCP server file exists
if [ ! -f "$MCP_SERVER_PATH" ]; then
    echo "❌ Error: MCP server file not found at $MCP_SERVER_PATH"
    exit 1
fi

# Make sure the server is executable
chmod +x "$MCP_SERVER_PATH"

# Check if Claude Code is installed
if ! command -v claude &> /dev/null; then
    echo "❌ Error: Claude Code is not installed or not in PATH"
    echo "Please install Claude Code first: https://claude.ai/code"
    exit 1
fi

# Check if node is available
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed or not in PATH"
    echo "Please install Node.js first: https://nodejs.org/"
    exit 1
fi

# Remove existing server if it exists
echo "🧹 Removing existing CodeAgentSwarm MCP server (if any)..."
claude mcp remove codeagentswarm 2>/dev/null || true

# Add the new MCP server
echo "📝 Registering CodeAgentSwarm MCP server with Claude Code..."
claude mcp add codeagentswarm node "$MCP_SERVER_PATH"

if [ $? -eq 0 ]; then
    echo "✅ CodeAgentSwarm MCP server installed successfully!"
    echo ""
    echo "🎉 Installation complete!"
    echo ""
    echo "📋 Available tools:"
    echo "  • create_task - Create a new task"
    echo "  • start_task - Start working on a task"
    echo "  • complete_task - Mark a task as completed"
    echo "  • list_tasks - List all tasks"
    echo ""
    echo "📋 Available prompts:"
    echo "  • /mcp__codeagentswarm__start_coding_session - Start a new coding session"
    echo "  • /mcp__codeagentswarm__task_summary - Get task summary"
    echo ""
    echo "📋 Available resources:"
    echo "  • @codeagentswarm:task://all - All tasks"
    echo "  • @codeagentswarm:task://pending - Pending tasks"
    echo "  • @codeagentswarm:task://in_progress - In progress tasks"
    echo "  • @codeagentswarm:task://completed - Completed tasks"
    echo ""
    echo "🔧 To verify installation:"
    echo "  claude mcp list"
    echo ""
    echo "🚀 To use in Claude Code:"
    echo "  1. Open Claude Code"
    echo "  2. Try: 'create_task(\"My first task\", \"Task description\")'"
    echo "  3. Or use: /mcp__codeagentswarm__start_coding_session"
    echo ""
    echo "📝 Note: Make sure CodeAgentSwarm app is running for task persistence!"
else
    echo "❌ Failed to install CodeAgentSwarm MCP server"
    exit 1
fi
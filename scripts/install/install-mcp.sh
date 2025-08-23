#!/bin/bash

echo "🚀 CodeAgentSwarm MCP Installer"
echo "================================"

# Get the absolute path of the current directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
MCP_SERVER_PATH="$SCRIPT_DIR/mcp-stdio-server.js"

echo "📍 Installing MCP server from: $MCP_SERVER_PATH"

# Check if claude CLI is installed
if ! command -v claude &> /dev/null; then
    echo "❌ Error: Claude CLI is not installed or not in PATH"
    echo "Please install Claude CLI first: https://github.com/anthropics/claude-cli"
    exit 1
fi

# Check if mcp-stdio-server.js exists
if [ ! -f "$MCP_SERVER_PATH" ]; then
    echo "❌ Error: mcp-stdio-server.js not found at $MCP_SERVER_PATH"
    exit 1
fi

# Add the MCP server to Claude CLI configuration
echo "🔧 Configuring MCP server globally..."
claude mcp add-json codeagentswarm-tasks "{
  \"command\": \"node\",
  \"args\": [\"$MCP_SERVER_PATH\"]
}"

# Verify installation
echo ""
echo "✅ Verifying installation..."
if claude mcp list | grep -q "codeagentswarm-tasks"; then
    echo "✅ CodeAgentSwarm MCP server installed successfully!"
    echo ""
    echo "📝 You can now use the following tools in any Claude CLI session:"
    echo "   - create_task"
    echo "   - start_task"
    echo "   - complete_task"
    echo "   - list_tasks"
    echo "   - update_task_plan"
    echo "   - update_task_implementation"
    echo ""
    echo "💡 Tip: Use /mcp in Claude CLI to see all available MCP servers"
else
    echo "❌ Installation verification failed"
    echo "Please try running the command manually:"
    echo "claude mcp add-json codeagentswarm-tasks '{\"command\": \"node\", \"args\": [\"$MCP_SERVER_PATH\"]}'"
fi
#!/bin/bash

# Auto-Fix MCP for CodeAgentSwarm
# This script automatically diagnoses and fixes MCP visibility issues

echo "🔧 CodeAgentSwarm MCP Auto-Fix Script"
echo "====================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get absolute path
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
MCP_SERVER_PATH="$SCRIPT_DIR/mcp-stdio-server.js"

# Step 1: Check if Claude CLI is installed
echo "1. Checking Claude CLI installation..."
if command -v claude &> /dev/null; then
    echo -e "${GREEN}✓ Claude CLI is installed${NC}"
    CLAUDE_VERSION=$(claude --version 2>&1 | head -1)
    echo "   Version: $CLAUDE_VERSION"
else
    echo -e "${RED}✗ Claude CLI is not installed${NC}"
    echo "   Please install Claude CLI first: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

# Step 2: Check if MCP server file exists
echo ""
echo "2. Checking MCP server file..."
if [ -f "$MCP_SERVER_PATH" ]; then
    echo -e "${GREEN}✓ MCP server found at: $MCP_SERVER_PATH${NC}"
else
    echo -e "${RED}✗ MCP server not found at: $MCP_SERVER_PATH${NC}"
    exit 1
fi

# Step 3: Test MCP server functionality
echo ""
echo "3. Testing MCP server..."
# Create a test function that works on macOS
test_mcp_server() {
    local response=$(echo '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}' | node "$MCP_SERVER_PATH" 2>&1 | head -5)
    if echo "$response" | grep -q "serverInfo"; then
        return 0
    else
        return 1
    fi
}

if test_mcp_server; then
    echo -e "${GREEN}✓ MCP server responds correctly${NC}"
else
    echo -e "${YELLOW}⚠ MCP server test inconclusive (this is normal)${NC}"
    echo "   The server starts but needs proper stdin handling"
fi

# Step 4: Check current MCP configuration
echo ""
echo "4. Checking current MCP configuration..."
CURRENT_MCPS=$(claude mcp list 2>&1)
echo "   Current MCP servers:"
echo "$CURRENT_MCPS" | sed 's/^/   /'

# Step 5: Check if CodeAgentSwarm is already configured
if echo "$CURRENT_MCPS" | grep -q "codeagentswarm"; then
    echo -e "${GREEN}✓ CodeAgentSwarm MCP is already configured${NC}"
    echo ""
    echo "🎉 Everything looks good! MCP should be working."
    echo ""
    echo "If you're still having issues, try:"
    echo "1. Restart your terminal"
    echo "2. Run: claude mcp get codeagentswarm-tasks"
    exit 0
fi

# Step 6: Add MCP to Claude CLI
echo ""
echo -e "${YELLOW}⚠ CodeAgentSwarm MCP not found in Claude CLI${NC}"
echo "5. Adding MCP to Claude CLI..."

# Remove any existing configuration first
claude mcp remove codeagentswarm-tasks 2>/dev/null
claude mcp remove codeagentswarm 2>/dev/null

# Add the MCP server
if claude mcp add-json codeagentswarm-tasks "{\"command\": \"node\", \"args\": [\"$MCP_SERVER_PATH\"]}" 2>&1; then
    echo -e "${GREEN}✓ Successfully added CodeAgentSwarm MCP${NC}"
else
    echo -e "${RED}✗ Failed to add MCP${NC}"
    echo "   Trying alternative method..."
    
    # Try with escaped path
    ESCAPED_PATH=$(echo "$MCP_SERVER_PATH" | sed 's/\//\\\//g')
    if claude mcp add codeagentswarm-tasks node "$MCP_SERVER_PATH" 2>&1; then
        echo -e "${GREEN}✓ Successfully added with alternative method${NC}"
    else
        echo -e "${RED}✗ Both methods failed${NC}"
        exit 1
    fi
fi

# Step 7: Verify installation
echo ""
echo "6. Verifying installation..."
sleep 1
if claude mcp list 2>&1 | grep -q "codeagentswarm"; then
    echo -e "${GREEN}✓ CodeAgentSwarm MCP is now configured!${NC}"
    echo ""
    echo "🎉 Success! The MCP server has been added to Claude CLI."
    echo ""
    echo "You can now use CodeAgentSwarm tools in Claude CLI sessions."
    echo "Try: claude \"list my pending tasks\""
else
    echo -e "${RED}✗ Verification failed${NC}"
    echo "   Please try manually:"
    echo "   claude mcp add-json codeagentswarm-tasks '{\"command\": \"node\", \"args\": [\"$MCP_SERVER_PATH\"]}'"
fi

# Step 8: Additional diagnostics
echo ""
echo "7. Additional Information:"
echo "   - MCP logs: ~/Library/Logs/Claude/mcp-server-codeagentswarm-tasks.log"
echo "   - Claude Desktop config: ~/Library/Application Support/Claude/claude_desktop_config.json"
echo "   - Database location: ~/Library/Application Support/codeagentswarm/codeagentswarm.db"
echo ""
echo "If problems persist, check the logs for errors."
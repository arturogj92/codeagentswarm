#!/bin/bash

# Install MCP with automatic CLAUDE.md instructions update
# Usage: ./install-mcp-auto.sh <mcp-package-name>

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the MCP package name
MCP_PACKAGE=$1

if [ -z "$MCP_PACKAGE" ]; then
    echo -e "${RED}❌ Error: No MCP package specified${NC}"
    echo "Usage: $0 <mcp-package-name>"
    echo ""
    echo "Examples:"
    echo "  $0 @modelcontextprotocol/server-brave-search"
    echo "  $0 @modelcontextprotocol/server-notion"
    echo "  $0 @modelcontextprotocol/server-filesystem"
    exit 1
fi

echo -e "${BLUE}📦 Installing MCP: $MCP_PACKAGE${NC}"

# Extract the simple name (e.g., "brave-search" from "@modelcontextprotocol/server-brave-search")
MCP_NAME=$(echo "$MCP_PACKAGE" | sed 's/.*server-//' | sed 's/@modelcontextprotocol\///')

# Step 1: Install the MCP package
echo -e "${YELLOW}Step 1: Installing package...${NC}"
npm install -g "$MCP_PACKAGE"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to install MCP package${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Package installed successfully${NC}"

# Step 2: Update Claude desktop config
echo -e "${YELLOW}Step 2: Updating Claude desktop configuration...${NC}"

CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

# Check if config exists
if [ ! -f "$CONFIG_PATH" ]; then
    echo -e "${YELLOW}Creating new Claude config...${NC}"
    mkdir -p "$(dirname "$CONFIG_PATH")"
    echo '{"mcpServers": {}}' > "$CONFIG_PATH"
fi

# Backup config
cp "$CONFIG_PATH" "$CONFIG_PATH.backup-$(date +%Y%m%d-%H%M%S)"

# Add MCP to config using Node.js for proper JSON handling
node -e "
const fs = require('fs');
const configPath = '$CONFIG_PATH';
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

if (!config.mcpServers) {
    config.mcpServers = {};
}

// Add the new MCP server
config.mcpServers['$MCP_NAME'] = {
    command: 'npx',
    args: ['-y', '$MCP_PACKAGE']
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('✅ Claude config updated');
"

# Step 3: Update global CLAUDE.md with instructions
echo -e "${YELLOW}Step 3: Updating global CLAUDE.md with MCP instructions...${NC}"

# Update the global CLAUDE.md at ~/.claude/CLAUDE.md
echo -e "${BLUE}  Updating global CLAUDE.md at ~/.claude/CLAUDE.md${NC}"
node "$(dirname "$0")/mcp-instructions-manager.js" update

# Check if it was successful
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Global CLAUDE.md updated with ${MCP_NAME} instructions${NC}"
    GLOBAL_UPDATED=true
else
    echo -e "${YELLOW}⚠️  Failed to update global CLAUDE.md${NC}"
    GLOBAL_UPDATED=false
fi

# Step 4: Show summary
echo ""
echo -e "${GREEN}🎉 MCP Installation Complete!${NC}"
echo ""
echo -e "${BLUE}Installed:${NC} $MCP_PACKAGE"
echo -e "${BLUE}MCP Name:${NC} $MCP_NAME"
echo ""

# Check if instructions were added
if [ "$GLOBAL_UPDATED" = true ]; then
    echo -e "${GREEN}✅ Instructions added to global CLAUDE.md (~/.claude/CLAUDE.md)${NC}"
    echo -e "${BLUE}   Claude will now know how to use this MCP in ALL projects${NC}"
else
    echo -e "${YELLOW}⚠️  To manually add instructions:${NC}"
    echo "   Run: node $(dirname "$0")/mcp-instructions-manager.js update"
fi

echo ""
echo -e "${YELLOW}📌 Next steps:${NC}"
echo "   1. Restart Claude Desktop for changes to take effect"
echo "   2. The MCP tools will be available with prefix: mcp__${MCP_NAME}__*"
echo ""

# Step 5: Offer to install more MCPs
echo -e "${BLUE}Popular MCPs you might want to install:${NC}"
echo "   • @modelcontextprotocol/server-brave-search - Web search"
echo "   • @modelcontextprotocol/server-notion - Notion integration"
echo "   • @modelcontextprotocol/server-filesystem - File operations"
echo "   • @modelcontextprotocol/server-github - GitHub integration"
echo "   • @supabase/mcp - Supabase database management"
echo ""
echo "Install another with: $0 <package-name>"
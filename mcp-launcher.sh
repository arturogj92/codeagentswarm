#!/bin/bash
# MCP Launcher for CodeAgentSwarm
# This script avoids issues with spaces in paths

# Find node in common locations
NODE_BIN=""
for node_path in \
  "$HOME/.nvm/versions/node/v18.20.4/bin/node" \
  "/usr/local/bin/node" \
  "/usr/bin/node" \
  "/opt/homebrew/bin/node" \
  "$HOME/.nvm/versions/node/*/bin/node"
do
  if [ -x "$node_path" ]; then
    NODE_BIN="$node_path"
    break
  fi
done

if [ -z "$NODE_BIN" ]; then
  echo "Error: Node.js not found" >&2
  exit 1
fi

# Execute the MCP server from the new location
exec "$NODE_BIN" "$HOME/.codeagentswarm-mcp/mcp-stdio-server.js"
# CodeAgentSwarm - Claude Code Terminal Manager

A modern Electron desktop application for managing multiple Claude Code terminals in a beautiful quadrant-based interface.

## Features

- **4 Terminal Quadrants**: Organize multiple Claude Code sessions in resizable quadrants
- **Claude Code Focus**: Automatically launches Claude Code in each terminal
- **Smart Notifications**: Parse Claude Code output for completion, errors, and confirmation requests
- **Fullscreen Mode**: Expand any terminal to fullscreen with Escape to exit
- **Modern UI**: Gradient backgrounds, shadcn-inspired components, and smooth animations
- **Terminal Management**: Create, close, and manage multiple terminals easily

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Run the application:
```bash
npm start
```

3. Build for production:
```bash
npm run build
```

### Automatic MCP Configuration

CodeAgentSwarm automatically configures the MCP (Model Context Protocol) server when you launch the app for the first time. This means:

- ✅ No manual configuration needed
- ✅ Task management tools available in Claude CLI from any directory
- ✅ Works immediately after launching the app
- ✅ Automatic updates when the app is updated

If you need to manually configure the MCP for any reason, you can run:
```bash
./install-mcp.sh
```

## How to Use

1. **Start a Terminal**: Click on any quadrant placeholder to start a Claude Code terminal
2. **Fullscreen**: Click the fullscreen button (⛶) to expand a terminal
3. **Close Terminal**: Click the close button (×) to terminate a terminal
4. **Notifications**: Watch for automatic notifications when Claude Code completes tasks or needs input
5. **Multiple Sessions**: Run up to 4 concurrent Claude Code sessions

## Requirements

- macOS (optimized for macOS with native vibrancy effects)
- Claude Code CLI installed and available in PATH
- Node.js 16 or higher

## Architecture

- **Frontend**: HTML/CSS/JavaScript with xterm.js for terminal rendering
- **Backend**: Electron main process with node-pty for terminal management
- **IPC**: Communication between renderer and main process for terminal control
- **Design**: Modern gradients, blur effects, and responsive quadrant system

Built for efficient Claude Code workflow management with beautiful, functional design.

## Database Access

To query the tasks database directly:

```bash
sqlite3 "/Users/vzgb9jp/Library/Application Support/codeagentswarm/codeagentswarm.db" "SELECT * FROM tasks;"
```

### Common Database Queries

```bash
# List all tasks with their terminal assignments
sqlite3 "/Users/vzgb9jp/Library/Application Support/codeagentswarm/codeagentswarm.db" "SELECT id, title, terminal_id, status FROM tasks;"

# Check specific task by title
sqlite3 "/Users/vzgb9jp/Library/Application Support/codeagentswarm/codeagentswarm.db" "SELECT id, title, terminal_id FROM tasks WHERE title = 'task_name';"

# View database schema
sqlite3 "/Users/vzgb9jp/Library/Application Support/codeagentswarm/codeagentswarm.db" ".schema"
```

### Note

This version uses **node-pty** for more stable terminal sessions. Run `npm install` after updating to ensure all dependencies are installed.

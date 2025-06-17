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

2. Run the development version:
```bash
npm start
```

3. Build for production:
```bash
npm run build
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

### Note

This version uses **node-pty** for more stable terminal sessions. Run `npm install` after updating to ensure all dependencies are installed.

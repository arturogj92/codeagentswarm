# Commit Generation System

## Overview

This project has two separate systems for generating text:

### 1. Commit Message Generation (Local App)
- **Technology**: Claude CLI (`claude -p` command)
- **Used by**: The Electron app when users generate commit messages
- **Location**: `infrastructure/commit/` (hexagonal architecture)
- **Cost**: FREE (Claude CLI is local, no API keys needed)
- **Requirements**: Claude Code must be installed

### 2. Changelog Generation (CI/CD)
- **Primary**: DeepSeek API 
- **Fallback**: Simple text-based generator
- **Used by**: GitHub Actions when creating releases
- **Location**: `scripts/changelog-generator.js`
- **Cost**: DeepSeek API usage (very cheap, ~$0.001 per changelog)

## Configuration

### For Local Development (Commit Messages)
No configuration needed! Claude CLI works out of the box if you have Claude Code installed.

### For CI/CD (Changelogs)
Two options:

#### Option A: Quality Changelogs (Recommended)
Add `DEEPSEEK_API_KEY` to GitHub repository secrets:
1. Go to Settings → Secrets and variables → Actions
2. Add secret: `DEEPSEEK_API_KEY`
3. Get key from: https://platform.deepseek.com/

#### Option B: Basic Changelogs (Free)
Don't add the secret. The system will automatically use the simple generator that categorizes commits by type (feat, fix, etc).

## Architecture

```
codeagentswarm-app/
├── domain/commit/           # Domain entities
├── application/commit/      # Use cases
├── infrastructure/commit/   # Adapters
│   ├── claude-commit-adapter.js    # Claude CLI integration
│   └── commit-service-factory.js   # Service initialization
└── scripts/
    └── changelog-generator.js      # CI/CD changelog generation (uses DeepSeek)
```

## Why This Design?

1. **User Experience**: Users get free commit generation via Claude CLI
2. **CI/CD Flexibility**: Can use DeepSeek for better changelogs or free simple generation
3. **No Lock-in**: Either service can be swapped out easily
4. **Cost Effective**: Local generation is free, changelogs cost ~$0.001 each
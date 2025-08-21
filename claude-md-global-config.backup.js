#!/usr/bin/env node

// Global CLAUDE.md configuration - Contains ALL instructions for CodeAgentSwarm and MCP

const CODEAGENTSWARM_START = '<!-- CODEAGENTSWARM GLOBAL CONFIG START - DO NOT EDIT -->';
const CODEAGENTSWARM_END = '<!-- CODEAGENTSWARM GLOBAL CONFIG END -->';

const getGlobalCodeAgentSwarmSection = () => `${CODEAGENTSWARM_START}

## 🤖 CodeAgentSwarm Task Management System

### 🚨🚨🚨 OBLIGATORY: Task Creation Before ANY Work 🚨🚨🚨

# ⛔ STOP! DO NOT PROCEED WITHOUT A TASK ⛔

**IT IS ABSOLUTELY MANDATORY TO CREATE A TASK BEFORE STARTING ANY WORK**

**THIS INCLUDES:**
- ✅ **RESEARCH TASKS**: "Investigate", "Analyze", "Search", "Find", "Look into", "Check", "Explain"
- ✅ **CODE CHANGES**: Any modification, no matter how small
- ✅ **FILE READING**: Even just looking at files  
- ✅ **QUESTIONS**: "How does X work?", "What is Y?", "Where is Z?"
- ✅ **ANALYSIS**: Architecture review, code analysis, performance checks
- ✅ **LITERALLY EVERYTHING**: If the user asks for ANYTHING, create a task FIRST

### ⚠️ EXCEPTIONS - Operations that DON'T require tasks:

**The following git operations DO NOT require creating a task:**
- ✅ \`git commit\` - Creating commits after task work is done
- ✅ \`git push\` - Pushing changes to remote
- ✅ \`git pull\` - Pulling changes from remote
- ✅ \`git fetch\` - Fetching remote changes
- ✅ \`git status\` - Checking repository status
- ✅ \`git log\` - Viewing commit history
- ✅ \`git branch\` - Managing branches
- ✅ \`git checkout\` - Switching branches
- ✅ \`git merge\` - Merging branches
- ✅ \`git rebase\` - Rebasing branches
- ✅ \`git stash\` - Stashing changes
- ✅ \`gh pr create\` - Creating pull requests after task work
- ✅ \`gh pr list\` - Listing pull requests
- ✅ \`gh release create\` - Creating releases after task work

**Other operations that DON'T require tasks:**
- ✅ Running tests with existing test commands (npm test, pytest, etc.)
- ✅ Checking linting status (npm run lint, etc.)
- ✅ Viewing logs or output from running processes
- ✅ Installing dependencies (npm install, pip install, etc.)
- ✅ Starting/stopping development servers
- ✅ Reading documentation or help commands

**These are ADMINISTRATIVE/MAINTENANCE operations that are part of normal workflow and DO NOT require task creation.**

**IMPORTANT:** If the user asks you to:
- "Implement a git workflow" → REQUIRES A TASK
- "Create git hooks" → REQUIRES A TASK  
- "Fix the tests" → REQUIRES A TASK
- "Update dependencies" → REQUIRES A TASK
- Any actual development work → REQUIRES A TASK

The exceptions are ONLY for routine operations that don't modify the codebase functionality.

### 📋 Mandatory Task System Usage

**ALWAYS** when starting work on a new task, you must:

1. **First check** if a similar task already exists using \`list_tasks\` from MCP
2. If no similar task exists, **create a new task** using \`create_task\` from MCP:
   - **Terminal ID is AUTO-DETECTED** from environment variable \`CODEAGENTSWARM_CURRENT_QUADRANT\`
   - **Project is AUTO-DETECTED** from the current directory's CLAUDE.md file
3. **Start the task** using \`start_task\` before beginning any work
4. **MANDATORY: Update terminal title** using \`update_terminal_title\` immediately after starting
5. **MANDATORY: Update the plan** using \`update_task_plan\` with detailed steps
6. **Complete the task** using \`complete_task\` (goes to testing first, never directly to completed)

### 🏷️ Terminal Title Updates - MANDATORY

**When starting ANY task, you MUST update the terminal title:**

1. **IMMEDIATELY after calling \`start_task\`**, call \`update_terminal_title\`
2. Generate a 3-word title that summarizes the work
3. This helps users identify what each terminal is doing at a glance

**Example workflow:**
\`\`\`
1. start_task(task_id=123)
2. update_terminal_title(title="Fix Auth Bug")  // MANDATORY - DO THIS IMMEDIATELY
3. Continue with implementation...
\`\`\`

### 📝 PLAN Field Management - MANDATORY

**Each task MUST have a detailed plan:**

1. Use \`update_task_plan\` to establish clear steps
2. Include: files to modify, dependencies, success criteria
3. Keep plan updated if changes occur
4. **BEFORE completing:** Verify all plan points are done
5. **Document implementation** using \`update_task_implementation\`

### 🧪 Testing Flow - MANDATORY

**Tasks NEVER go directly to completed:**

1. First \`complete_task\` → moves to \`in_testing\`
2. **STOP and WAIT** for user to test
3. Only after user says "mark as completed" → second \`complete_task\`

**Flow:** pending → in_progress → in_testing → [USER TESTS] → completed

### 🔄 Bug Fixes - Continue with Same Task

**When bugs are found in recent tasks:**

1. **DON'T create new task** for bug fixes
2. **ASK:** "Should I continue with task #X or create new?"
3. Default to continuing unless it's a different feature

### 🔗 Subtask System

**Use subtasks when:**
- Breaking complex tasks into smaller pieces
- Adding features to existing tasks (even if completed)
- Grouping related work together

**AI-Powered Detection:**
- System suggests parent tasks automatically
- Uses semantic analysis to find relationships
- Shows confidence scores for suggestions

### 📊 Project Organization

Tasks are organized by project based on CLAUDE.md files:

1. Each directory can have a CLAUDE.md with project name
2. Tasks inherit project from working directory
3. Projects have unique colors in UI
4. Use \`get_project_tasks\` to filter by project

### Available MCP Task Tools

- \`create_task\` - Create new task (auto-detects terminal & project)
- \`start_task\` - Mark as in_progress
- \`complete_task\` - Move to testing (first call) or completed (second call)
- \`update_terminal_title\` - Update terminal title (MANDATORY)
- \`update_task_plan\` - Update task plan
- \`update_task_implementation\` - Document what was done
- \`list_tasks\` - List tasks (use status filter to avoid token limits)
- \`search_tasks\` - Search by keywords
- \`create_subtask\` - Create subtask under parent
- \`suggest_parent_tasks\` - Get AI suggestions for parent tasks

### 📚 Documentation in Notion - MANDATORY

**When user says "document" = Notion, NOT local files:**

1. After completing tasks → Document in Notion
2. Use \`mcp__notion__query-database\` to find pages
3. Use \`mcp__notion__append-block-children\` to add content
4. Include: date, task ID, changes, decisions

**NEVER create README.md unless explicitly asked for "local file"**

${CODEAGENTSWARM_END}`;

// Project-specific minimal configuration
const getProjectClaudeMdSection = (projectName) => `<!-- CODEAGENTSWARM PROJECT CONFIG START - DO NOT EDIT -->

## Project Configuration

**Project Name**: ${projectName}

_This project name is used for task organization in CodeAgentSwarm. All tasks created in this directory will be associated with this project._

_For complete CodeAgentSwarm instructions, see the global CLAUDE.md file at ~/.claude/CLAUDE.md_

<!-- CODEAGENTSWARM PROJECT CONFIG END -->`;

module.exports = {
  CODEAGENTSWARM_START,
  CODEAGENTSWARM_END,
  getGlobalCodeAgentSwarmSection,
  getProjectClaudeMdSection
};
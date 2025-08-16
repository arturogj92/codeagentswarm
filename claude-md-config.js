// CodeAgentSwarm CLAUDE.md configuration content
const SECTION_START = '<!-- CODEAGENTSWARM CONFIG START - DO NOT EDIT THIS SECTION -->';
const SECTION_END = '<!-- CODEAGENTSWARM CONFIG END -->';

const getCodeAgentSwarmSection = (projectName = null) => `${SECTION_START}

${projectName ? `## Project Configuration

**Project Name**: ${projectName}

_This project name is used for task organization in CodeAgentSwarm. All tasks created in this directory will be associated with this project._

` : ''}## MCP Servers

### Task Manager

- **Command**: \`node mcp-stdio-server.js\`
- **Description**: Task management system for CodeAgentSwarm with project organization
- **Tools**: create_task, start_task, complete_task, submit_for_testing, list_tasks, update_task_plan, update_task_implementation, update_task_terminal, update_terminal_title, create_project, get_projects, get_project_tasks
- **Resources**: All tasks, pending tasks, in-progress tasks, completed tasks, projects
- **Projects**: Tasks are now organized by projects. Each task belongs to a project, and projects are detected automatically based on the terminal working directory

_Note: This MCP configuration is automatically managed by CodeAgentSwarm. Do not remove this section as it's required for task management functionality._

## Task Management - IMPORTANT

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

**NO EXCEPTIONS. NO EXCUSES. NO "QUICK FIXES" WITHOUT A TASK.**

Before doing ANY work, including research, investigation, or code changes, you MUST create and start a task. This is NOT optional - it is a MANDATORY requirement for ALL work.

**VIOLATIONS WILL BE TRACKED AND REPORTED**

### Mandatory Task System Usage

**ALWAYS** when starting work on a new task, you must:

1. **First check** if a similar task already exists using \`list_tasks\` from MCP
2. If no similar task exists, **create a new task** using \`create_task\` from MCP:
   - **Terminal ID is AUTO-DETECTED** from environment variable \`CODEAGENTSWARM_CURRENT_QUADRANT\`
   - If terminal_id is not provided, the MCP server will automatically use the current terminal
   - **MANDATORY: Read the project name from the CLAUDE.md file** in the current directory
   - Look for the "Project Name:" field in the "Project Configuration" section
   - If no project name is found in CLAUDE.md, use the directory name as fallback
3. **Start the task** using \`start_task\` before beginning any work
   - **Terminal is AUTO-ASSIGNED** when starting a task if environment variable is set
4. **MANDATORY: Update the plan** using \`update_task_plan\` when starting a task with a detailed step plan
5. **CRITICAL: Tasks ALWAYS go to testing first** - Use \`complete_task\` when finished (automatically goes to "in_testing" state, NEVER directly to "completed") or use \`submit_for_testing\` for direct testing submission
6. **If you detect the current task deviates from focus or significantly changes objective, create a new task and continue work under that new task.**

### IMPORTANT: Terminal ID - Automatic Detection
- **Terminal ID is NOW AUTO-DETECTED** by the MCP server from \`CODEAGENTSWARM_CURRENT_QUADRANT\` environment variable
- Each terminal has a unique ID (1, 2, 3, 4, etc.) based on 1-based numbering
- **No need to manually specify terminal_id** when creating tasks - it's automatic!
- **When starting a task:** Terminal is automatically assigned to the current terminal
- **NEVER ask the user** which terminal - it's handled automatically
- Tasks are automatically associated with the correct terminal for proper tracking

### 🏷️ MANDATORY: Terminal Title Updates

**🚨 OBLIGATORIO: When starting ANY task, you MUST update the terminal title:**

1. **IMMEDIATELY after calling \`start_task\`**, you MUST call \`update_terminal_title\`
2. Generate a 3-word title that summarizes what you're working on
3. The title should be clear and descriptive (max 3 words)
4. **This is NOT optional - it's MANDATORY for ALL tasks**

**Correct workflow example:**
\`\`\`
1. start_task(task_id=123)
2. update_terminal_title(title="Fix Auth Bug")  // MANDATORY - DO THIS IMMEDIATELY
3. Continue with implementation...
\`\`\`

**Why this is mandatory:**
- The terminal title helps users identify at a glance what each terminal is doing
- The task ID appears as a small badge next to the title for easy reference
- Without this, users cannot quickly see what's being worked on

**Examples of good terminal titles:**
- "Fix Auth Bug"
- "Add User API" 
- "Update Database Schema"
- "Implement Search Feature"
- "Refactor Login Flow"

### MANDATORY: PLAN Field Management

**Each task MUST have a detailed plan** that is updated when the agent takes it:

1. **When starting an existing task:**
   - Use \`update_task_plan\` to establish a clear and detailed plan
   - The plan must include specific steps you will follow
   - Suggested format: numbered list of concrete actions

2. **Plan content:**
   - Step-by-step implementation breakdown
   - Files to be modified or created
   - Dependencies or prerequisites
   - Success/completion criteria

3. **Example of well-structured plan:**
   \`\`\`
   1. Review current code structure in src/components/
   2. Create new UserProfile.jsx component
   3. Implement state logic using React hooks
   4. Add CSS styles in UserProfile.module.css
   5. Integrate component in main page
   6. Write unit tests for component
   7. Verify functionality works correctly
   \`\`\`

4. **Plan updates:**
   - If plan changes during execution, update it using \`update_task_plan\`
   - Keep plan updated so other agents can continue if needed

5. **CRITICAL: Verification before completion:**
   - **BEFORE** using \`complete_task\`, MANDATORY review each point of the plan
   - Verify each step has been completed successfully
   - **MANDATORY: Document implementation** using \`update_task_implementation\` with:
     - List of modified/created files
     - Summary of changes made
     - Description of implemented flow
   - If points are missing:
     - Option A: Continue working until completing entire plan
     - Option B: Update plan removing completed points and create new task for pending
     - Option C: Update plan explicitly marking what was completed and what wasn't
   - **NEVER complete a task without verifying plan compliance AND documenting implementation**

### Workflow

1. **When receiving a user request:**
   - Review existing tasks with \`list_tasks\`
   - **CHECK FIRST:** Is this a bug fix or modification of a recently completed task?
     - If YES → Ask if should continue with the existing task
     - If NO → Check if a related task exists
   - If related task exists, use it
   - If not, create a new descriptive task

2. **During work:**
   - Current task will show in terminal bar
   - **Update plan** using \`update_task_plan\` when starting with detailed plan
   - Keep task status updated
   - If plan changes significantly, update it again
   - Only one active task per terminal

3. **When finishing technical work:**
   - **MANDATORY: Verify plan compliance** - Before completing, review all plan points have been fulfilled
   - **MANDATORY: Document implementation** using \`update_task_implementation\`:
     - List of modified files: \`database.js, mcp-stdio-server.js, CLAUDE.md\`
     - Summary: clear description of changes made
     - Flow: explanation of implemented functionality
   - If plan wasn't fully completed, update plan with what's missing or create new task for pending
   - **🚨 MANDATORY TESTING FLOW - NO EXCEPTIONS:**
     - Call \`complete_task\` ONCE: moves task to \`in_testing\` state
     - **STOP HERE:** Do NOT call \`complete_task\` again automatically
     - Inform user: "Task is now in testing, please review the changes"
     - **WAIT** for user to explicitly request completion
     - ONLY when user says "mark as completed", call \`complete_task\` second time
     - **CRITICAL: Agents must NEVER automatically complete tasks from testing**
   - This automatically updates interface and database state
   - Plan and implementation remain documented for future reference

### 🚨 MANDATORY Testing Flow - TASKS NEVER GO DIRECTLY TO COMPLETED 🚨

**CRITICAL: All tasks MUST go through testing phase before completion. Tasks can NEVER go directly from "in_progress" to "completed" status:**

1. **🚨 Mandatory transition to testing (NO EXCEPTIONS):**
   - When finishing task implementation, use \`complete_task\` ONCE
   - This ALWAYS and AUTOMATICALLY moves task to \`in_testing\` state
   - **PROHIBITED:** Going directly from \`in_progress\` to \`completed\`
   - **STOP HERE:** After calling \`complete_task\` once, DO NOT call it again

2. **⛔ AGENTS MUST STOP after moving to testing:**
   - **NEVER** automatically call \`complete_task\` a second time
   - **WAIT** for the user to manually test and verify
   - **ONLY** when user EXPLICITLY says "mark as completed" or "complete the task", then call \`complete_task\` again
   - The user will test for at least 30 seconds before allowing completion

3. **Requirements for user to complete from testing:**
   - Task must have \`implementation\` field documented
   - User must manually review and approve the changes
   - Minimum 30 seconds must pass in testing phase
   - User must EXPLICITLY request completion

4. **If needing to send directly to testing:**
   - Use \`submit_for_testing\` to move directly to \`in_testing\`
   - Useful when another agent or person will perform tests

5. **Complete flow:**
   \`\`\`
   pending → in_progress → in_testing → [STOP & WAIT FOR USER] → completed
                     ↑                                              ↓
                     └── (agent calls once)      (user explicitly requests)
   \`\`\`

6. **Example correct behavior:**
   \`\`\`
   Agent: "I've completed the implementation and documented it. Moving task to testing..."
   [Calls complete_task ONCE - task goes to in_testing]
   Agent: "Task #123 is now in testing. Please review the changes and let me know if everything works correctly."
   [AGENT STOPS HERE - Does NOT call complete_task again]
   
   [User tests the feature...]
   
   User: "Everything looks good, please mark it as completed"
   Agent: "Great! I'll mark the task as completed now."
   [NOW agent calls complete_task second time - task goes to completed]
   \`\`\`

### 🔄 BUG FIXES AND MODIFICATIONS - CONTINUE WITH SAME TASK

**CRITICAL: When bugs are found or modifications are requested AFTER a task is in testing or completed:**

1. **🚨 DO NOT CREATE A NEW TASK for bug fixes or minor modifications:**
   - If the user reports a bug or requests changes related to the current/recent task
   - **ASK THE USER:** "Should I continue with the current task [ID: X] or create a new one?"
   - Default to continuing with the same task unless:
     - The change is a completely different feature
     - The user explicitly asks for a new task
     - More than 24 hours have passed since the task was completed

2. **How to handle bug fixes in existing tasks:**
   - If task is \`in_testing\`: Move back to \`in_progress\` using \`start_task\`
   - If task is \`completed\` and user reports bug immediately: 
     - Ask: "I found task [ID: X - Title] that was just completed. Should I reopen it for these fixes?"
     - If yes: Move back to \`in_progress\` and update plan with bug fixes
   - Update the plan to include the bug fix steps using \`update_task_plan\`
   - Continue working on the same task ID

3. **When to create a new task:**
   - The modification is a NEW feature (not a fix)
   - The original task has been completed for more than 24 hours
   - The user explicitly requests a new task
   - The scope significantly changes (e.g., from "fix button color" to "redesign entire UI")

4. **Example dialogue for bug fixes:**
   \`\`\`
   User: "The feature we just implemented has a bug when clicking the button"
   Agent: "I see you found a bug in the task we just completed (Task #123: Add button feature). 
           Should I reopen this task to fix the bug, or would you prefer a new task?"
   User: "Continue with the same task"
   Agent: [Moves task back to in_progress and fixes the bug]
   \`\`\`

### Handling Multiple Pending Tasks

**IMPORTANT:** When user asks to work on a pending task and multiple pending tasks exist for current terminal:

1. **List available tasks:** Show user relevant pending tasks with ID and title
2. **Ask which to start:** Request user specify which task they want you to begin
3. **Don't assume:** NEVER automatically choose a task without user confirmation
4. **Response example:**
   \`\`\`
   Found several pending tasks for this terminal:
   - ID 70: Fix all this
   - ID 58: Make terminal document the task
   - ID 41: Corrected dummy test task
   
   Which of these tasks would you like me to start?
   \`\`\`

### Available MCP Task Tools

The following MCP tools are available for task management:

- **\`create_task\`**: Create new task (terminal_id and project are auto-detected)
- **\`start_task\`**: Mark task as "in_progress"
- **\`complete_task\`**: First call: ALWAYS moves to "in_testing" (NEVER directly to "completed"). Second call (only after manual approval and testing): moves to "completed"
- **\`submit_for_testing\`**: Mark task as "in_testing"
- **\`list_tasks\`**: List all tasks (optional: filter by status)
- **\`update_task_plan\`**: Update specific task plan
- **\`update_task_implementation\`**: Update task implementation
- **\`update_task_terminal\`**: Update terminal_id associated with task
- **\`update_terminal_title\`**: Update terminal title (MANDATORY after start_task)
- **\`create_project\`**: Create a new project with name and optional color
- **\`get_projects\`**: Get list of all projects
- **\`get_project_tasks\`**: Get all tasks for a specific project

**\`update_task_plan\` parameters:**
- \`task_id\` (number, required): Task ID
- \`plan\` (string, required): Detailed plan text

**\`update_task_implementation\` parameters:**
- \`task_id\` (number, required): Task ID
- \`implementation\` (string, required): Implementation details including modified files and summary

**\`update_task_terminal\` parameters:**
- \`task_id\` (number, required): Task ID
- \`terminal_id\` (string, required): Terminal ID (1, 2, 3, 4, etc.) or empty string to unassign

**\`update_terminal_title\` parameters:**
- \`title\` (string, required): Terminal title (max 3 words recommended)

**Usage example:**
\`\`\`
# Task management
create_task(title="Implement new feature", description="Add user authentication")
# Note: terminal_id and project are auto-detected from environment and working directory

start_task(task_id=123)
update_terminal_title(title="Implement Auth Feature")  # MANDATORY after start_task

update_task_plan(task_id=123, plan="1. Review existing code\\n2. Implement new functionality\\n3. Write tests")

update_task_implementation(task_id=123, implementation="Modified files: database.js, mcp-server.js\\nSummary: Added implementation field to tasks table\\nFlow: New field allows documenting changes made during implementation")

update_task_terminal(task_id=123, terminal_id="2")  # Assign to terminal 2
update_task_terminal(task_id=123, terminal_id="")   # Unassign from any terminal

# Project management
create_project(name="MyNewProject", color="#FF6B6B")  # Create project with custom color
create_project(name="AnotherProject")  # Color will be auto-assigned

get_projects()  # Returns all projects with their colors

get_project_tasks(project_name="CodeAgentSwarm")  # Get all tasks for a project
\`\`\`

## Project Organization

Tasks are automatically organized by project based on the CLAUDE.md configuration:

1. **Project Detection**: When creating a task, **ALWAYS** first check the CLAUDE.md file for the project name
2. **Detection Steps**:
   - Read the CLAUDE.md file in the current working directory
   - Look for "**Project Name**: " followed by the project name in the Project Configuration section
   - Use this name when calling \`create_task\`
   - If no CLAUDE.md or project name found, use the directory name as fallback
3. **Visual Identification**: Each project has a unique color for easy identification in the UI
4. **Project Filtering**: Use \`get_project_tasks\` to see tasks for a specific project

### How to detect the project name (for agents):
\`\`\`bash
# 1. First, check if CLAUDE.md exists
if [ -f "CLAUDE.md" ]; then
    # 2. Extract project name from CLAUDE.md
    project_name=$(grep -A1 "## Project Configuration" CLAUDE.md | grep "Project Name:" | sed 's/.*Project Name**: //' | sed 's/^ *//')
fi
# 3. Use the project name when creating tasks
\`\`\`

## IMPORTANT: MCP Token Limits

### Known issue with list_tasks
When there are many tasks in the database (30+), the \`list_tasks\` MCP command can exceed allowed token limit (25000 tokens).

### Recommended solution:
1. **ALWAYS use status filters** when listing tasks:
   - \`mcp__codeagentswarm-tasks__list_tasks\` with parameter \`status: "pending"\`
   - \`mcp__codeagentswarm-tasks__list_tasks\` with parameter \`status: "in_progress"\`
   - This significantly reduces number of returned tasks

2. **DO NOT attempt to list all tasks without filter** when many tasks exist in database

3. **For future pagination implementation:**
   - Pagination should be implemented in GUI (kanban.js)
   - MCP should maintain simple and efficient methods
   - Consider default limits in getAllTasks()

### Technical notes:
- MCP server has multiple routes (\`tasks/get_all\` and \`tools/call\`) that must stay synchronized
- MCP server changes require server restart to apply
- Claude Code can cache MCP connections

## IMPORTANT: Documentation in Notion - MANDATORY

### Documentation Updates in Notion

**WHEN THE USER ASKS TO DOCUMENT something, it ALWAYS means documenting in Notion, NOT creating markdown files or README files locally:**

1. **Default behavior:** The word "document" or "documentation" from the user = Update Notion documentation
2. **Project in Notion:** CodeAgentSwarm has its own documentation database in Notion
3. **NEVER create local documentation files** unless explicitly requested with phrases like:
   - "create a README.md file"
   - "create a markdown file"
   - "create a local documentation file"
4. **Process when user asks to "document":**
   - Use Notion MCP tools to update the appropriate pages
   - DO NOT create any local files

### When to update Notion documentation:

- **New features implemented**
- **Architecture changes**
- **Database or schema modifications**
- **New SQL commands or scripts**
- **API or endpoint changes**
- **Technology stack updates**
- **Important bug fixes**
- **New MCP integrations**
- **Configuration changes**

### Available Notion MCP tools:

- **\`mcp__notion__query-database\`**: Query the documentation database
- **\`mcp__notion__get-page\`**: Get content from a specific page
- **\`mcp__notion__update-page\`**: Update page properties
- **\`mcp__notion__append-block-children\`**: Add content to existing pages
- **\`mcp__notion__create-page\`**: Create new pages (use only if necessary)

**This documentation is CRITICAL to maintain the knowledge base updated and facilitate other developers' work.**

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.

## 🚨 CRITICAL ENFORCEMENT CHECKLIST - FINAL VERIFICATION 🚨

### ⚠️ BEFORE YOU DO ANYTHING - VERIFY: ⚠️

**DID YOU CREATE A TASK?**
- If NO → STOP IMMEDIATELY and create one
- If YES → Continue

**IS THE TASK STARTED?**
- If NO → STOP and start it with \`start_task\`
- If YES → Continue

**DID YOU UPDATE THE TERMINAL TITLE?**
- If NO → STOP and update it with \`update_terminal_title\`
- If YES → Continue

### 🔴 REMEMBER: NO TASK = NO WORK 🔴

**Every single request from the user requires a task. EVERY. SINGLE. ONE.**

**INCLUDING RESEARCH AND INVESTIGATION TASKS:**
- "Investigate how X works" → NEEDS A TASK
- "Search for Y in the codebase" → NEEDS A TASK
- "Analyze this feature" → NEEDS A TASK
- "Find all occurrences of Z" → NEEDS A TASK
- "Explain how this works" → NEEDS A TASK
- "Look into this issue" → NEEDS A TASK
- "Research best practices for..." → NEEDS A TASK
- "Check what's in this file" → NEEDS A TASK (even if just reading!)
- "Tell me about..." → NEEDS A TASK

**AND ALSO CODE CHANGES:**
- "Just add a console.log" → NEEDS A TASK
- "Fix this typo" → NEEDS A TASK  
- "Quick test" → NEEDS A TASK
- "Small change" → NEEDS A TASK

**🚨 ABSOLUTELY NO EXCEPTIONS - EVEN FOR:**
- Reading files → NEEDS A TASK
- Searching code → NEEDS A TASK  
- Analyzing architecture → NEEDS A TASK
- Answering questions about code → NEEDS A TASK
- ANY request that involves looking at project files → NEEDS A TASK

### ❌ FINAL WARNING - THIS MEANS YOU ❌

**🚨 COMMON MISTAKES THAT STILL REQUIRE TASKS:**
- "Just tell me what's in this file" → CREATE A TASK
- "Search for function X" → CREATE A TASK
- "How does this feature work?" → CREATE A TASK
- "Investigate this bug" → CREATE A TASK
- "Analyze the architecture" → CREATE A TASK
- "What does this code do?" → CREATE A TASK
- "Find all uses of..." → CREATE A TASK

**Failure to create tasks is the #1 complaint from users.**
**Don't be the agent that ignores this requirement.**

**CREATE. THE. TASK. ALWAYS.**
**FOR. EVERY. SINGLE. REQUEST.**
**NO. MATTER. HOW. SIMPLE.**
**RESEARCH. NEEDS. TASKS. TOO.**

${SECTION_END}`;

module.exports = {
  SECTION_START,
  SECTION_END,
  getCodeAgentSwarmSection
};
// CodeAgentSwarm CLAUDE.md configuration content
const SECTION_START = '<!-- CODEAGENTSWARM CONFIG START - DO NOT EDIT THIS SECTION -->';
const SECTION_END = '<!-- CODEAGENTSWARM CONFIG END -->';

const getCodeAgentSwarmSection = () => `${SECTION_START}

## 🚨 CRITICAL - MANDATORY COMPLETION MARKER 🚨

**YOU MUST ALWAYS** write this EXACT line when you finish ANY response or work:

\`\`\`
=== CLAUDE FINISHED ===
\`\`\`

**NO EXCEPTIONS** - Write this marker:
- After EVERY response to the user
- After completing ANY task
- After answering ANY question
- After ANY work you do
- BEFORE any final explanation

**FAILURE TO WRITE THIS MARKER BREAKS THE APPLICATION**

## MCP Servers

### Task Manager

- **Command**: \`node mcp-stdio-server.js\`
- **Description**: Task management system for CodeAgentSwarm with project organization
- **Tools**: create_task, start_task, complete_task, submit_for_testing, list_tasks, update_task_plan, update_task_implementation, update_task_terminal, create_project, get_project_tasks
- **Resources**: All tasks, pending tasks, in-progress tasks, completed tasks, projects
- **Projects**: Tasks are now organized by projects based on terminal working directory

_Note: This MCP configuration is automatically managed by CodeAgentSwarm. Do not remove this section as it's required for task management functionality._

## Task Management - IMPORTANT

### Mandatory Task System Usage

**ALWAYS** when starting work on a new task, you must:

1. **First check** if a similar task already exists using \`list_tasks\` from MCP
2. If no similar task exists, **create a new task** using \`create_task\` from MCP **MANDATORY specifying the correct terminal_id**
3. **Start the task** using \`start_task\` before beginning any work
4. **MANDATORY: Update the plan** using \`update_task_plan\` when starting a task with a detailed step plan
5. **Complete the task** using \`complete_task\` when finished (goes to "completed") or \`submit_for_testing\` if testing needed
6. **If you detect the current task deviates from focus or significantly changes objective, create a new task and continue work under that new task.**

### IMPORTANT: Terminal ID - Automatic Detection
- **ALWAYS** specify the \`terminal_id\` when creating a task with \`create_task\`
- Each terminal has a unique ID (1, 2, 3, 4, etc.) based on 1-based numbering
- **AUTOMATIC DETECTION:** To get the current terminal, execute: \`echo $CODEAGENTSWARM_CURRENT_QUADRANT\` using the Bash tool
- **NEVER ask the user** which terminal - always use automatic detection
- Tasks must be associated with the correct terminal for proper tracking

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
   - **NEW MANDATORY TESTING FLOW:**
     - First \`complete_task\` call: moves task to \`in_testing\` state
     - User must manually review and approve
     - Second \`complete_task\` call: moves to \`completed\` (requires \`implementation\` documented)
   - **NEVER can go directly from \`in_progress\` to \`completed\`**
   - This automatically updates interface and database state
   - Plan and implementation remain documented for future reference

### Mandatory Testing Flow

**IMPORTANT: All tasks MUST go through testing phase before completion:**

1. **Mandatory transition to testing:**
   - When finishing task implementation, use \`complete_task\`
   - This automatically moves task to \`in_testing\` state
   - CANNOT go directly from \`in_progress\` to \`completed\`

2. **Requirements to complete from testing:**
   - Task must have \`implementation\` field documented
   - User must manually review and approve
   - Only then use \`complete_task\` again to mark as \`completed\`

3. **If needing to send directly to testing:**
   - Use \`submit_for_testing\` to move directly to \`in_testing\`
   - Useful when another agent or person will perform tests

4. **Complete flow:**
   \`\`\`
   pending → in_progress → in_testing → completed
                     ↑                    ↓
                     └── (requires documentation and manual approval)
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

- **\`create_task\`**: Create new task (requires terminal_id)
- **\`start_task\`**: Mark task as "in_progress"
- **\`complete_task\`**: First call: moves to "in_testing". Second call (after manual approval): moves to "completed"
- **\`submit_for_testing\`**: Mark task as "in_testing"
- **\`list_tasks\`**: List all tasks (optional: filter by status)
- **\`update_task_plan\`**: Update specific task plan
- **\`update_task_implementation\`**: Update task implementation
- **\`update_task_terminal\`**: Update terminal_id associated with task

**\`update_task_plan\` parameters:**
- \`task_id\` (number, required): Task ID
- \`plan\` (string, required): Detailed plan text

**\`update_task_implementation\` parameters:**
- \`task_id\` (number, required): Task ID
- \`implementation\` (string, required): Implementation details including modified files and summary

**\`update_task_terminal\` parameters:**
- \`task_id\` (number, required): Task ID
- \`terminal_id\` (string, required): Terminal ID (1, 2, 3, 4, etc.) or empty string to unassign

**Usage example:**
\`\`\`
update_task_plan(task_id=123, plan="1. Review existing code\\n2. Implement new functionality\\n3. Write tests")

update_task_implementation(task_id=123, implementation="Modified files: database.js, mcp-server.js\\nSummary: Added implementation field to tasks table\\nFlow: New field allows documenting changes made during implementation")

update_task_terminal(task_id=123, terminal_id="2")  # Assign to terminal 2
update_task_terminal(task_id=123, terminal_id="")   # Unassign from any terminal
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

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.

${SECTION_END}`;

module.exports = {
  SECTION_START,
  SECTION_END,
  getCodeAgentSwarmSection
};
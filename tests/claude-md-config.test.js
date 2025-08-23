const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

describe('CLAUDE.md Configuration Tests', () => {
  let tempDir;
  let originalHome;
  let globalClaudeMdPath;
  let projectClaudeMdPath;
  
  beforeAll(() => {
    // Create temporary directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
    
    // Store original HOME
    originalHome = process.env.HOME;
    
    // Set HOME to temp directory for tests
    process.env.HOME = tempDir;
    
    // Create .claude directory in temp
    const claudeDir = path.join(tempDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    
    // Set paths
    globalClaudeMdPath = path.join(claudeDir, 'CLAUDE.md');
    projectClaudeMdPath = path.join(__dirname, '..', 'CLAUDE.md');
    
    // Generate test files
    generateTestFiles();
  });

  afterAll(() => {
    // Restore original HOME
    process.env.HOME = originalHome;
    
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function generateTestFiles() {
    // Generate global CLAUDE.md for testing
    const { getGlobalCodeAgentSwarmSection } = require('../claude-md-global-config');
    const MCPInstructionsManager = require('../src/infrastructure/mcp/mcp-instructions-manager');
    
    // Create global content
    let globalContent = '# Claude Global Configuration\n\n';
    globalContent += 'This file contains global instructions for all Claude agents across all projects.\n\n';
    globalContent += getGlobalCodeAgentSwarmSection();
    globalContent += '\n\n';
    
    // Add mock MCP instructions
    globalContent += `<!-- MCP INSTRUCTIONS START - AUTO-GENERATED -->
## MCP Usage Instructions

### 🗄️ Supabase MCP
**When to use:**
- Managing Supabase databases and projects

### 📝 Notion MCP  
**When to use:**
- After completing tasks → Document in Notion

<!-- MCP INSTRUCTIONS END -->`;
    
    // Write global file
    fs.writeFileSync(globalClaudeMdPath, globalContent);
    
    // Generate project CLAUDE.md for testing (if it doesn't exist)
    if (!fs.existsSync(projectClaudeMdPath)) {
      const { getProjectClaudeMdSection } = require('../claude-md-global-config');
      let projectContent = '# CodeAgentSwarm Project Configuration\n\n';
      projectContent += getProjectClaudeMdSection('CodeAgentSwarm');
      projectContent += '\n\n# Project-specific notes\n';
      fs.writeFileSync(projectClaudeMdPath, projectContent);
    }
  }

  describe('Global CLAUDE.md Generation', () => {
    test('should generate global file with CodeAgentSwarm section', () => {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      expect(content).toContain('<!-- CODEAGENTSWARM GLOBAL CONFIG START');
      expect(content).toContain('<!-- CODEAGENTSWARM GLOBAL CONFIG END');
    });

    test('should include all git exceptions', () => {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      const gitCommands = [
        'git commit',
        'git push',
        'git pull',
        'git fetch',
        'git status',
        'git log',
        'git branch',
        'git checkout',
        'git merge',
        'git rebase',
        'git stash'
      ];

      gitCommands.forEach(cmd => {
        expect(content).toContain(`\`${cmd}\``);
      });
    });

    test('should include GitHub CLI exceptions', () => {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      expect(content).toContain('gh pr create');
      expect(content).toContain('gh pr list');
      expect(content).toContain('gh release create');
    });

    test('should include other operation exceptions', () => {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      const otherExceptions = [
        'Running tests with existing test commands',
        'Checking linting status',
        'Viewing logs or output',
        'Installing dependencies',
        'Starting/stopping development servers',
        'Reading documentation'
      ];

      otherExceptions.forEach(exception => {
        expect(content).toContain(exception);
      });
    });

    test('should clarify what DOES require tasks', () => {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      const clarifications = [
        'Implement a git workflow',
        'Create git hooks',
        'Fix the tests',
        'Update dependencies',
        'REQUIRES A TASK'
      ];

      clarifications.forEach(text => {
        expect(content).toContain(text);
      });
    });

    test('should state exceptions are only for routine operations', () => {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      expect(content).toContain('routine operations that don\'t modify the codebase functionality');
    });

    test('should have MCP instructions section', () => {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      expect(content).toContain('<!-- MCP INSTRUCTIONS START');
      expect(content).toContain('<!-- MCP INSTRUCTIONS END');
    });

    test('should have sections in correct order', () => {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      const codeagentStart = content.indexOf('<!-- CODEAGENTSWARM GLOBAL CONFIG START');
      const mcpStart = content.indexOf('<!-- MCP INSTRUCTIONS START');
      
      expect(codeagentStart).toBeGreaterThanOrEqual(0);
      expect(mcpStart).toBeGreaterThanOrEqual(0);
      expect(codeagentStart).toBeLessThan(mcpStart);
    });
  });

  describe('Project CLAUDE.md Structure', () => {
    test('should have minimal project config', () => {
      const content = fs.readFileSync(projectClaudeMdPath, 'utf8');
      expect(content).toContain('<!-- CODEAGENTSWARM PROJECT CONFIG START');
      expect(content).toContain('<!-- CODEAGENTSWARM PROJECT CONFIG END');
    });

    test('should NOT have full task instructions', () => {
      const content = fs.readFileSync(projectClaudeMdPath, 'utf8');
      // The project file should not have the full obligatory section
      expect(content).not.toContain('OBLIGATORY: Task Creation Before ANY Work');
    });

    test('should reference global CLAUDE.md', () => {
      const content = fs.readFileSync(projectClaudeMdPath, 'utf8');
      expect(content).toContain('~/.claude/CLAUDE.md');
    });

    test('should have project name', () => {
      const content = fs.readFileSync(projectClaudeMdPath, 'utf8');
      expect(content).toContain('**Project Name**: CodeAgentSwarm');
    });
  });

  describe('Configuration Module Tests', () => {
    test('getGlobalCodeAgentSwarmSection should return valid content', () => {
      const { getGlobalCodeAgentSwarmSection } = require('../claude-md-global-config');
      const section = getGlobalCodeAgentSwarmSection();
      
      expect(section).toContain('OBLIGATORY: Task Creation Before ANY Work');
      expect(section).toContain('EXCEPTIONS - Operations that DON\'T require tasks');
      expect(section).toContain('git commit');
      expect(section).toContain('REQUIRES A TASK');
    });

    test('getProjectClaudeMdSection should return minimal content', () => {
      const { getProjectClaudeMdSection } = require('../claude-md-global-config');
      const section = getProjectClaudeMdSection('TestProject');
      
      expect(section).toContain('**Project Name**: TestProject');
      expect(section).toContain('~/.claude/CLAUDE.md');
      expect(section).not.toContain('OBLIGATORY');
    });
  });

  describe('Configuration Files', () => {
    test('claude-md-global-config.js should exist', () => {
      const configPath = path.join(__dirname, '..', 'claude-md-global-config.js');
      expect(fs.existsSync(configPath)).toBe(true);
    });

    test('main.js should have global config function', () => {
      const mainJsPath = path.join(__dirname, '..', 'main.js');
      const mainContent = fs.readFileSync(mainJsPath, 'utf8');
      
      expect(mainContent).toContain('ensureGlobalClaudeMdConfiguration');
      expect(mainContent).toContain('ensureGlobalClaudeMdConfiguration()');
    });

    test('regenerate-claude-md.js should exist', () => {
      const scriptPath = path.join(__dirname, '..', 'scripts', 'regenerate-claude-md.js');
      expect(fs.existsSync(scriptPath)).toBe(true);
    });
  });

  describe('Exception Content Validation', () => {
    test('should have proper formatting for git exceptions', () => {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      expect(content).toContain('### ⚠️ EXCEPTIONS - Operations that DON\'T require tasks:');
      expect(content).toContain('**The following git operations DO NOT require creating a task:**');
    });

    test('should have proper formatting for other exceptions', () => {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      expect(content).toContain('**Other operations that DON\'T require tasks:**');
      expect(content).toContain('**These are ADMINISTRATIVE/MAINTENANCE operations');
    });

    test('should clearly state the important note', () => {
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      expect(content).toContain('**IMPORTANT:** If the user asks you to:');
      expect(content).toContain('The exceptions are ONLY for routine operations');
    });
  });

  describe('Regeneration Script Integration', () => {
    test('should handle missing global file gracefully', () => {
      // Delete the global file
      if (fs.existsSync(globalClaudeMdPath)) {
        fs.unlinkSync(globalClaudeMdPath);
      }
      
      // Run regeneration script with temp HOME
      expect(() => {
        execSync('node scripts/regenerate-claude-md.js', {
          cwd: path.join(__dirname, '..'),
          env: { ...process.env, HOME: tempDir },
          stdio: 'pipe'
        });
      }).not.toThrow();
      
      // Check file was created
      expect(fs.existsSync(globalClaudeMdPath)).toBe(true);
      
      // Check content is correct
      const content = fs.readFileSync(globalClaudeMdPath, 'utf8');
      expect(content).toContain('<!-- CODEAGENTSWARM GLOBAL CONFIG START');
      expect(content).toContain('git commit');
    });
  });
});
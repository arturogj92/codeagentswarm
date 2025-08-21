#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { 
  getGlobalCodeAgentSwarmSection, 
  getProjectClaudeMdSection,
  CODEAGENTSWARM_START,
  CODEAGENTSWARM_END
} = require('./claude-md-global-config');
const MCPInstructionsManager = require('./mcp-instructions-manager');

// Define the paths to update with project-specific configs
const projectPaths = [
    { path: './CLAUDE.md', projectName: 'CodeAgentSwarm' },
    { path: '../CLAUDE.md', projectName: 'Art0xDev' },
    { path: '../codeagentswarm/CLAUDE.md', projectName: 'CodeAgentSwarm' },
    { path: '../codeagentswarm-backend/CLAUDE.md', projectName: 'CodeAgentSwarm-Backend' },
    { path: '../codeagentswarm-landing/CLAUDE.md', projectName: 'CodeAgentSwarm-Landing' }
];

function updateProjectClaudeMd(filePath, projectName) {
    try {
        const fullPath = path.resolve(filePath);
        
        // Check if file exists
        if (!fs.existsSync(fullPath)) {
            console.log(`⚠️  File not found: ${fullPath}, creating new...`);
            // Create new file with project config
            const content = `# ${projectName} Project Configuration

${getProjectClaudeMdSection(projectName)}

# Project-specific instructions can be added below this line
`;
            fs.writeFileSync(fullPath, content, 'utf8');
            console.log(`✅ Created ${filePath} with project name: ${projectName}`);
            return true;
        }
        
        // Read current content
        let content = fs.readFileSync(fullPath, 'utf8');
        
        // Check for old CodeAgentSwarm section markers
        const oldStartMarker = '<!-- CODEAGENTSWARM CONFIG START';
        const oldEndMarker = '<!-- CODEAGENTSWARM CONFIG END';
        const newStartMarker = '<!-- CODEAGENTSWARM PROJECT CONFIG START';
        const newEndMarker = '<!-- CODEAGENTSWARM PROJECT CONFIG END';
        
        // Remove old full config if exists
        if (content.includes(oldStartMarker) && content.includes(oldEndMarker)) {
            const startIdx = content.indexOf(oldStartMarker);
            const endIdx = content.indexOf(oldEndMarker) + oldEndMarker.length + 4; // +4 for -->
            content = content.substring(0, startIdx) + content.substring(endIdx);
            content = content.trim() + '\n\n';
        }
        
        // Update or add new minimal project config
        const newSection = getProjectClaudeMdSection(projectName);
        
        if (content.includes(newStartMarker) && content.includes(newEndMarker)) {
            // Replace existing project config
            const startIdx = content.indexOf(newStartMarker);
            const endIdx = content.indexOf(newEndMarker) + newEndMarker.length + 4;
            content = content.substring(0, startIdx) + newSection + content.substring(endIdx);
        } else {
            // Add new project config at the beginning (after title if exists)
            const lines = content.split('\n');
            let insertIndex = 0;
            
            // Find where to insert (after main title if exists)
            for (let i = 0; i < Math.min(lines.length, 5); i++) {
                if (lines[i].startsWith('# ')) {
                    insertIndex = i + 1;
                    // Skip empty lines after title
                    while (insertIndex < lines.length && lines[insertIndex].trim() === '') {
                        insertIndex++;
                    }
                    break;
                }
            }
            
            lines.splice(insertIndex, 0, '', newSection, '');
            content = lines.join('\n');
        }
        
        // Write back to file
        fs.writeFileSync(fullPath, content, 'utf8');
        
        console.log(`✅ Updated ${filePath} with minimal project config: ${projectName}`);
        return true;
    } catch (error) {
        console.error(`❌ Error updating ${filePath}:`, error.message);
        return false;
    }
}

function updateGlobalClaudeMd() {
    try {
        const globalPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
        
        // Ensure directory exists
        const claudeDir = path.join(os.homedir(), '.claude');
        if (!fs.existsSync(claudeDir)) {
            fs.mkdirSync(claudeDir, { recursive: true });
        }
        
        let content = '';
        if (fs.existsSync(globalPath)) {
            content = fs.readFileSync(globalPath, 'utf8');
        } else {
            // Create new global file
            content = `# Claude Global Configuration

This file contains global instructions for all Claude agents across all projects.

`;
        }
        
        // Update CodeAgentSwarm section
        const codeagentSection = getGlobalCodeAgentSwarmSection();
        
        // Remove old section if exists
        if (content.includes(CODEAGENTSWARM_START) && content.includes(CODEAGENTSWARM_END)) {
            const startIdx = content.indexOf(CODEAGENTSWARM_START);
            const endIdx = content.indexOf(CODEAGENTSWARM_END) + CODEAGENTSWARM_END.length;
            content = content.substring(0, startIdx) + codeagentSection + content.substring(endIdx);
        } else {
            // Add new section before MCP instructions if they exist
            const mcpStart = '<!-- MCP INSTRUCTIONS START';
            if (content.includes(mcpStart)) {
                const mcpIdx = content.indexOf(mcpStart);
                content = content.substring(0, mcpIdx) + codeagentSection + '\n\n' + content.substring(mcpIdx);
            } else {
                // Add at the end
                content = content.trim() + '\n\n' + codeagentSection + '\n';
            }
        }
        
        fs.writeFileSync(globalPath, content, 'utf8');
        console.log(`✅ Updated global CLAUDE.md with complete CodeAgentSwarm instructions`);
        return true;
    } catch (error) {
        console.error(`❌ Error updating global CLAUDE.md:`, error.message);
        return false;
    }
}

// Main execution
async function main() {
    console.log('🔄 Regenerating CLAUDE.md files with new structure...\n');

    let updated = 0;
    let failed = 0;

    // Step 1: Update global CLAUDE.md with ALL CodeAgentSwarm instructions
    console.log('📦 Updating global CLAUDE.md with complete instructions...');
    if (updateGlobalClaudeMd()) {
        console.log('   ✅ Global CLAUDE.md updated at ~/.claude/CLAUDE.md');
        updated++;
    } else {
        console.log('   ❌ Failed to update global CLAUDE.md');
        failed++;
    }

    // Step 2: Update MCP instructions in global CLAUDE.md
    console.log('\n📦 Updating MCP instructions in global CLAUDE.md...');
    const mcpManager = new MCPInstructionsManager();
    const mcpUpdated = await mcpManager.updateClaudeMd(true);
    if (mcpUpdated) {
        console.log('   ✅ MCP instructions updated in global CLAUDE.md');
    } else {
        console.log('   ℹ️  No MCP changes needed in global CLAUDE.md');
    }

    // Step 3: Update project files with minimal configuration
    console.log('\n📁 Updating project CLAUDE.md files with minimal config...');
    for (const { path: filePath, projectName } of projectPaths) {
        if (updateProjectClaudeMd(filePath, projectName)) {
            updated++;
        } else {
            failed++;
        }
    }

    console.log('\n📊 Summary:');
    console.log(`   ✅ Updated: ${updated} files`);
    console.log(`   ⚠️  Failed: ${failed} files`);

    if (updated > 0) {
        console.log('\n🎉 Configuration restructured successfully:');
        console.log('   • Global (~/.claude/CLAUDE.md): Complete CodeAgentSwarm + MCP instructions');
        console.log('   • Project files: Minimal configuration (project name only)');
        console.log('   • Git operations now properly excluded from task requirements!');
        console.log('\n✨ Agents will now:');
        console.log('   • NOT create tasks for routine git operations');
        console.log('   • Still create tasks for actual development work');
        console.log('   • Follow all instructions from the global configuration');
    }
}

// Run the main function
main().catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
});
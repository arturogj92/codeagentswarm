#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { getCodeAgentSwarmSection, SECTION_START, SECTION_END } = require('./claude-md-config');

// Define the paths to update
const claudeMdPaths = [
    './CLAUDE.md',
    '../CLAUDE.md',
    '../codeagentswarm/CLAUDE.md'
];

// Project names for each path
const projectNames = {
    './CLAUDE.md': 'codeagentswarm-app',
    '../CLAUDE.md': 'Art0xDev',
    '../codeagentswarm/CLAUDE.md': 'CodeAgentSwarm'
};

function updateClaudeMd(filePath, projectName) {
    try {
        const fullPath = path.resolve(filePath);
        
        // Check if file exists
        if (!fs.existsSync(fullPath)) {
            console.log(`⚠️  File not found: ${fullPath}`);
            return false;
        }
        
        // Read current content
        let content = fs.readFileSync(fullPath, 'utf8');
        
        // Check if the file already has the CodeAgentSwarm section
        const startIndex = content.indexOf(SECTION_START);
        const endIndex = content.indexOf(SECTION_END);
        
        if (startIndex === -1 || endIndex === -1) {
            console.log(`⚠️  No CodeAgentSwarm section found in ${filePath}`);
            return false;
        }
        
        // Get the new section content
        const newSection = getCodeAgentSwarmSection(projectName);
        
        // Replace the old section with the new one
        const beforeSection = content.substring(0, startIndex);
        const afterSection = content.substring(endIndex + SECTION_END.length);
        
        const newContent = beforeSection + newSection + afterSection;
        
        // Write back to file
        fs.writeFileSync(fullPath, newContent, 'utf8');
        
        console.log(`✅ Updated ${filePath} with project name: ${projectName}`);
        return true;
    } catch (error) {
        console.error(`❌ Error updating ${filePath}:`, error.message);
        return false;
    }
}

// Main execution
console.log('🔄 Regenerating CLAUDE.md files with updated instructions...\n');

let updated = 0;
let failed = 0;

for (const filePath of claudeMdPaths) {
    const projectName = projectNames[filePath];
    if (updateClaudeMd(filePath, projectName)) {
        updated++;
    } else {
        failed++;
    }
}

console.log('\n📊 Summary:');
console.log(`   ✅ Updated: ${updated} files`);
console.log(`   ⚠️  Failed: ${failed} files`);

if (updated > 0) {
    console.log('\n🎉 CLAUDE.md files have been updated with the new terminal title instructions!');
    console.log('   Agents will now be required to call update_terminal_title after starting tasks.');
}
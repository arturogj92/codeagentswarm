#!/usr/bin/env node

const HooksManager = require('../../src/infrastructure/hooks/hooks-manager');

async function installHooksManually() {
    console.log('Installing CodeAgentSwarm hooks manually...\n');
    
    try {
        const hooksManager = new HooksManager();
        
        // Check current status
        console.log('Checking current hooks status...');
        const statusBefore = await hooksManager.checkHooksStatus();
        console.log('Before installation:', statusBefore);
        
        if (statusBefore.installed) {
            console.log('\n✅ Hooks are already installed!');
            return;
        }
        
        // Install hooks
        console.log('\nInstalling hooks...');
        const result = await hooksManager.installHooks();
        
        if (result.success) {
            console.log('\n✅ Hooks installed successfully!');
            
            // Verify installation
            const statusAfter = await hooksManager.checkHooksStatus();
            console.log('\nAfter installation:', statusAfter);
            
            console.log('\n📝 Settings file updated at:', hooksManager.settingsPath);
            console.log('\n🎉 Hooks are now ready to use!');
            console.log('   - Notification hook will trigger on tool confirmations');
            console.log('   - Stop hook will trigger when Claude finishes');
            console.log('\n⚠️  Make sure CodeAgentSwarm is running for webhook to work!');
        } else {
            console.error('\n❌ Failed to install hooks:', result.error);
        }
    } catch (error) {
        console.error('\n❌ Error:', error.message);
    }
}

// Run the installation
installHooksManually();
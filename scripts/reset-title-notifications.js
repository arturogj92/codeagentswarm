#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

// Path to notifications file
const notificationFile = path.join(os.homedir(), '.codeagentswarm', 'task_notifications.json');

console.log('Reading notifications from:', notificationFile);

if (!fs.existsSync(notificationFile)) {
    console.log('No notifications file found');
    process.exit(0);
}

try {
    // Read notifications
    const content = fs.readFileSync(notificationFile, 'utf8');
    let notifications = JSON.parse(content);
    
    console.log(`Found ${notifications.length} total notifications`);
    
    // Find recent terminal_title_update notifications
    const recentTitleUpdates = notifications.filter(n => 
        n.type === 'terminal_title_update' && 
        n.processed === true
    ).slice(-2); // Get last 2
    
    if (recentTitleUpdates.length === 0) {
        console.log('No recent terminal title updates found');
        process.exit(0);
    }
    
    console.log(`\nResetting ${recentTitleUpdates.length} terminal title notifications:`);
    recentTitleUpdates.forEach(n => {
        console.log(`  - Terminal ${n.terminal_id}: "${n.title}"`);
    });
    
    // Mark them as unprocessed
    notifications = notifications.map(n => {
        const shouldReset = recentTitleUpdates.some(r => 
            r.terminal_id === n.terminal_id && 
            r.title === n.title && 
            r.timestamp === n.timestamp
        );
        
        if (shouldReset) {
            return { ...n, processed: false };
        }
        return n;
    });
    
    // Write back
    fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
    console.log('\n✅ Notifications reset successfully');
    console.log('The terminal titles should update within 2 seconds');
    
} catch (error) {
    console.error('Error processing notifications:', error);
    process.exit(1);
}
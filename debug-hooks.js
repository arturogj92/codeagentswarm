#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('=== Hook Debugging Tool ===\n');

// Check settings.json
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
console.log('1. Checking Claude settings.json...');
console.log(`   Path: ${settingsPath}`);

try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    console.log('\n2. Hooks configuration:');
    
    if (settings.hooks?.Stop) {
        console.log('\n   Stop hooks:');
        settings.hooks.Stop.forEach((item, index) => {
            console.log(`   [${index}] ${JSON.stringify(item, null, 2)}`);
        });
    }
    
    if (settings.hooks?.Notification) {
        console.log('\n   Notification hooks:');
        settings.hooks.Notification.forEach((item, index) => {
            console.log(`   [${index}] ${JSON.stringify(item, null, 2)}`);
        });
    }
} catch (error) {
    console.error('   Error reading settings:', error.message);
}

// Test webhook endpoint
console.log('\n3. Testing webhook server...');
const http = require('http');

function testWebhook(eventType, terminalId) {
    return new Promise((resolve) => {
        const data = JSON.stringify({
            type: eventType,
            terminalId: terminalId.toString()
        });
        
        const options = {
            hostname: 'localhost',
            port: 45782,
            path: '/webhook',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };
        
        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(responseData);
                    console.log(`   ${eventType} (Terminal ${terminalId}): ${response.duplicate ? 'DUPLICATE' : 'SUCCESS'}`);
                } catch (e) {
                    console.log(`   ${eventType} (Terminal ${terminalId}): Response: ${responseData}`);
                }
                resolve();
            });
        });
        
        req.on('error', (error) => {
            console.log(`   ${eventType} (Terminal ${terminalId}): ERROR - ${error.message}`);
            resolve();
        });
        
        req.write(data);
        req.end();
    });
}

// Run tests
(async function() {
    // Test single event
    console.log('\n4. Testing single event...');
    await testWebhook('claude_finished', 1);
    
    // Test multiple events quickly
    console.log('\n5. Testing rapid fire events (should show duplicates)...');
    await testWebhook('claude_finished', 1);
    await testWebhook('claude_finished', 1);
    await testWebhook('claude_finished', 1);
    
    // Test after delay
    console.log('\n6. Testing after 3 second delay...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await testWebhook('claude_finished', 1);
    
    console.log('\n7. Environment check:');
    console.log(`   CODEAGENTSWARM_CURRENT_QUADRANT = ${process.env.CODEAGENTSWARM_CURRENT_QUADRANT || 'not set'}`);
    
    console.log('\n=== Debug complete ===');
})();
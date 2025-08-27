#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

// Check settings.json
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    if (settings.hooks?.Stop) {

        settings.hooks.Stop.forEach((item, index) => {

        });
    }
    
    if (settings.hooks?.Notification) {

        settings.hooks.Notification.forEach((item, index) => {

        });
    }
} catch (error) {
    console.error('   Error reading settings:', error.message);
}

// Test webhook endpoint

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

                } catch (e) {

                }
                resolve();
            });
        });
        
        req.on('error', (error) => {

            resolve();
        });
        
        req.write(data);
        req.end();
    });
}

// Run tests
(async function() {
    // Test single event

    await testWebhook('claude_finished', 1);
    
    // Test multiple events quickly

    await testWebhook('claude_finished', 1);
    await testWebhook('claude_finished', 1);
    await testWebhook('claude_finished', 1);
    
    // Test after delay

    await new Promise(resolve => setTimeout(resolve, 3000));
    await testWebhook('claude_finished', 1);

})();
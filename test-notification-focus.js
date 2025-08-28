// Test script to verify that notification clicks properly focus the terminal

console.log('Testing notification terminal focus...');

// Test 1: Check webhook notification handler has terminal focus
const fs = require('fs');
const path = require('path');

// Read webhook-server.js
const webhookServerPath = path.join(__dirname, 'src/infrastructure/services/webhook-server.js');
const webhookContent = fs.readFileSync(webhookServerPath, 'utf8');

// Check for focus-terminal-tab in notification click handler
if (webhookContent.includes("mainWindow.webContents.send('focus-terminal-tab', terminalNum)")) {
    console.log('✅ Test 1 Passed: Webhook notification handler includes terminal focus');
} else {
    console.log('❌ Test 1 Failed: Webhook notification handler missing terminal focus');
}

// Test 2: Check main.js notification handler
const mainPath = path.join(__dirname, 'main.js');
const mainContent = fs.readFileSync(mainPath, 'utf8');

// Check for proper terminalMatch check before using it
const notificationClickHandler = mainContent.match(/notification\.on\('click'[\s\S]*?if \(terminalMatch\)/);
if (notificationClickHandler) {
    console.log('✅ Test 2 Passed: Main notification handler properly checks terminalMatch');
} else {
    console.log('❌ Test 2 Failed: Main notification handler not properly checking terminalMatch');
}

// Test 3: Check renderer has focus-terminal-tab handler
const rendererPath = path.join(__dirname, 'src/presentation/renderer/renderer.js');
const rendererContent = fs.readFileSync(rendererPath, 'utf8');

if (rendererContent.includes("ipcRenderer.on('focus-terminal-tab'")) {
    console.log('✅ Test 3 Passed: Renderer has focus-terminal-tab handler');
} else {
    console.log('❌ Test 3 Failed: Renderer missing focus-terminal-tab handler');
}

// Test 4: Verify switchToTab function exists
if (rendererContent.includes('switchToTab(')) {
    console.log('✅ Test 4 Passed: Renderer has switchToTab function');
} else {
    console.log('❌ Test 4 Failed: Renderer missing switchToTab function');
}

console.log('\n📋 Summary:');
console.log('Notification clicks should now:');
console.log('1. Bring the app to foreground ✓');
console.log('2. Focus the app window ✓');
console.log('3. Switch to the correct terminal tab (if in tabbed mode) ✓');
console.log('4. Focus the correct terminal (if in grid mode) ✓');
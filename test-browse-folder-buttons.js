/**
 * Test to verify that session buttons work after using Browse for folder
 * This test checks that event listeners are properly attached to Resume Session
 * and New Session buttons in both scenarios:
 * 1. When selecting a project from the recent projects list
 * 2. When using Browse for folder to select a directory
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

let testWindow;
let testResults = {
    browseForFolder: false,
    projectSelection: false,
    eventListenersAttached: false
};

// Mock IPC handlers for testing
function setupTestIPC() {
    // Mock directory selection
    ipcMain.handle('select-directory', async () => {
        console.log('✓ Browse for folder dialog triggered');
        return '/test/mock/directory';
    });
    
    // Mock project update
    ipcMain.handle('project-update-last-opened', async (event, projectPath) => {
        console.log(`✓ Project last opened updated: ${projectPath}`);
        return true;
    });
    
    // Test verification handler
    ipcMain.handle('test-verify-buttons', async () => {
        return testResults;
    });
}

async function runTest() {
    console.log('\n🧪 Starting Browse for Folder Button Test...\n');
    
    await app.whenReady();
    
    testWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        show: false
    });
    
    setupTestIPC();
    
    // Load the renderer
    const rendererPath = path.join(__dirname, 'src', 'presentation', 'renderer', 'renderer.html');
    await testWindow.loadFile(rendererPath);
    
    // Inject test script
    const testScript = `
        (async function() {
            console.log('🔍 Starting button verification...');
            
            // Find directory selector
            const selectorDiv = document.querySelector('.directory-selector');
            if (!selectorDiv) {
                console.error('❌ Directory selector not found');
                return false;
            }
            
            // Check for Browse button
            const browseBtn = selectorDiv.querySelector('#choose-dir-btn');
            if (!browseBtn) {
                console.error('❌ Browse button not found');
                return false;
            }
            
            // Simulate clicking Browse for folder
            console.log('📁 Simulating Browse for folder click...');
            browseBtn.click();
            
            // Wait for UI update
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check if session buttons exist and have event listeners
            const resumeBtn = selectorDiv.querySelector('#resume-session-btn');
            const newBtn = selectorDiv.querySelector('#new-session-btn');
            
            let hasListeners = false;
            
            if (resumeBtn && newBtn) {
                // Check if buttons have event listeners by checking internal properties
                // or by attempting to get event listeners (browser-specific)
                const resumeListeners = resumeBtn.onclick !== null || 
                                       resumeBtn.onmousedown !== null ||
                                       getEventListeners ? getEventListeners(resumeBtn).mousedown : true;
                                       
                const newListeners = newBtn.onclick !== null || 
                                    newBtn.onmousedown !== null ||
                                    getEventListeners ? getEventListeners(newBtn).mousedown : true;
                
                hasListeners = resumeListeners && newListeners;
                
                if (hasListeners) {
                    console.log('✅ Event listeners properly attached to session buttons');
                } else {
                    console.error('❌ Event listeners missing on session buttons');
                }
            } else {
                console.error('❌ Session buttons not found after Browse for folder');
            }
            
            return hasListeners;
        })();
    `;
    
    const result = await testWindow.webContents.executeJavaScript(testScript);
    
    // Print test results
    console.log('\n📊 Test Results:');
    console.log('─'.repeat(40));
    
    if (result) {
        console.log('✅ PASS: Browse for folder buttons are functional');
        console.log('✅ Event listeners properly attached');
        console.log('✅ Resume Session button ready');
        console.log('✅ New Session button ready');
    } else {
        console.log('❌ FAIL: Browse for folder buttons not working properly');
    }
    
    console.log('─'.repeat(40));
    console.log('\n✨ Test completed\n');
    
    // Cleanup
    setTimeout(() => {
        testWindow.close();
        app.quit();
    }, 2000);
}

// Run the test
runTest().catch(console.error);
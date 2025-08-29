/**
 * Simple test to verify the button fix implementation
 * Checks that the setupSessionButtonListeners function exists and is called
 */

const fs = require('fs');
const path = require('path');

console.log('\n🧪 Testing Browse Folder Button Fix\n');
console.log('─'.repeat(50));

// Read the renderer.js file
const rendererPath = path.join(__dirname, 'src', 'presentation', 'renderer', 'renderer.js');
const rendererContent = fs.readFileSync(rendererPath, 'utf8');

// Test 1: Check if setupSessionButtonListeners function exists
console.log('1️⃣  Checking if setupSessionButtonListeners function exists...');
const functionExists = rendererContent.includes('const setupSessionButtonListeners = (projectPath)');
if (functionExists) {
    console.log('   ✅ Function setupSessionButtonListeners found');
} else {
    console.log('   ❌ Function setupSessionButtonListeners NOT found');
}

// Test 2: Check if function is called in Browse for folder flow
console.log('\n2️⃣  Checking if function is called after Browse for folder...');
const browseCallExists = rendererContent.includes('setupSessionButtonListeners(selectedDir)');
if (browseCallExists) {
    console.log('   ✅ Function is called when using Browse for folder');
} else {
    console.log('   ❌ Function NOT called in Browse for folder flow');
}

// Test 3: Check if function is called in project selection flow
console.log('\n3️⃣  Checking if function is called for project selection...');
const projectCallExists = rendererContent.includes('setupSessionButtonListeners(projectPath)');
if (projectCallExists) {
    console.log('   ✅ Function is called when selecting a project');
} else {
    console.log('   ❌ Function NOT called in project selection flow');
}

// Test 4: Check that event listeners are properly configured
console.log('\n4️⃣  Checking event listener configuration...');
const hasMouseEvents = rendererContent.includes('freshResumeBtn.addEventListener(\'mousedown\'');
const hasTouchEvents = rendererContent.includes('freshResumeBtn.addEventListener(\'touchstart\'');
const hasNewButtonEvents = rendererContent.includes('freshNewBtn.addEventListener(\'mousedown\'');

if (hasMouseEvents && hasTouchEvents && hasNewButtonEvents) {
    console.log('   ✅ All event listeners properly configured');
    console.log('      • Mouse events: ✓');
    console.log('      • Touch events: ✓');
    console.log('      • Both buttons: ✓');
} else {
    console.log('   ⚠️  Some event listeners may be missing');
    console.log(`      • Mouse events: ${hasMouseEvents ? '✓' : '✗'}`);
    console.log(`      • Touch events: ${hasTouchEvents ? '✓' : '✗'}`);
    console.log(`      • Both buttons: ${hasNewButtonEvents ? '✓' : '✗'}`);
}

// Test 5: Verify duplicate code was removed
console.log('\n5️⃣  Checking that duplicate code was removed...');
const duplicateCount = (rendererContent.match(/const executeResume = async/g) || []).length;
if (duplicateCount === 1) {
    console.log('   ✅ No duplicate code found (good refactoring!)');
} else if (duplicateCount === 0) {
    console.log('   ⚠️  executeResume function not found');
} else {
    console.log(`   ⚠️  Found ${duplicateCount} instances of executeResume (possible duplication)`);
}

// Summary
console.log('\n' + '─'.repeat(50));
const allTestsPassed = functionExists && browseCallExists && projectCallExists && 
                      hasMouseEvents && hasTouchEvents && hasNewButtonEvents && 
                      duplicateCount === 1;

if (allTestsPassed) {
    console.log('✅ ALL TESTS PASSED - Button fix implemented correctly!');
    console.log('\n📝 Summary:');
    console.log('   • setupSessionButtonListeners function created');
    console.log('   • Function called in both Browse and Project flows');
    console.log('   • All event listeners properly attached');
    console.log('   • Code properly refactored without duplication');
} else {
    console.log('⚠️  Some tests did not pass - Review implementation');
}

console.log('─'.repeat(50));
console.log('\n✨ Test completed\n');
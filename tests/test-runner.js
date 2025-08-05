/**
 * Simple test runner for DiffParser tests
 */

const fs = require('fs');
const path = require('path');

// Test runner state
let currentDescribe = '';
let currentTest = '';
let passedTests = 0;
let failedTests = 0;
const errors = [];

// Test runner functions
global.describe = (name, fn) => {
    currentDescribe = name;
    console.log(`\n${name}`);
    fn();
};

global.test = global.it = (name, fn) => {
    currentTest = name;
    try {
        // Execute beforeEach if defined
        if (global.beforeEachFn) {
            global.beforeEachFn();
        }
        
        fn();
        console.log(`  ✓ ${name}`);
        passedTests++;
        
        // Execute afterEach if defined
        if (global.afterEachFn) {
            global.afterEachFn();
        }
    } catch (error) {
        console.log(`  ✗ ${name}`);
        console.error(`    ${error.message}`);
        failedTests++;
        errors.push({ describe: currentDescribe, test: currentTest, error });
    }
};

global.beforeEach = (fn) => {
    // Store for later execution
    global.beforeEachFn = fn;
};

global.afterEach = (fn) => {
    // Store for later execution
    global.afterEachFn = fn;
};

// Assertion library
global.expect = (actual) => ({
    toBe: (expected) => {
        if (actual !== expected) {
            throw new Error(`Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
        }
    },
    toEqual: (expected) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
        }
    },
    toHaveLength: (expected) => {
        if (!actual || actual.length === undefined) {
            throw new Error(`Expected value to have length property`);
        }
        if (actual.length !== expected) {
            throw new Error(`Expected length ${actual.length} to be ${expected}`);
        }
    },
    toBeLessThan: (expected) => {
        if (actual >= expected) {
            throw new Error(`Expected ${actual} to be less than ${expected}`);
        }
    },
    toBeGreaterThan: (expected) => {
        if (actual <= expected) {
            throw new Error(`Expected ${actual} to be greater than ${expected}`);
        }
    },
    toBeTruthy: () => {
        if (!actual) {
            throw new Error(`Expected ${actual} to be truthy`);
        }
    },
    toBeFalsy: () => {
        if (actual) {
            throw new Error(`Expected ${actual} to be falsy`);
        }
    }
});

// Run the test file
const testFile = process.argv[2] || './diff-parser.test.js';
console.log(`Running tests from ${testFile}...\n`);

try {
    require(path.resolve(testFile));
    
    console.log('\n' + '='.repeat(50));
    console.log(`Tests: ${passedTests} passed, ${failedTests} failed, ${passedTests + failedTests} total`);
    
    if (failedTests > 0) {
        console.log('\nFailed tests:');
        errors.forEach(({ describe, test, error }) => {
            console.log(`\n  ${describe} > ${test}`);
            console.log(`    ${error.stack}`);
        });
        process.exit(1);
    } else {
        console.log('\nAll tests passed! 🎉');
        process.exit(0);
    }
} catch (error) {
    console.error('\nError running tests:');
    console.error(error);
    process.exit(1);
}
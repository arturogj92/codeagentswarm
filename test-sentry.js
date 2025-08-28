#!/usr/bin/env node

// Script to test Sentry error reporting
const Sentry = require('@sentry/electron/main');

// Initialize Sentry with test configuration
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  environment: 'test',
  debug: true, // Enable debug mode to see what's happening
  beforeSend(event, hint) {
    console.log('Sending event to Sentry:', event.event_id);
    console.log('Event type:', event.exception ? 'Exception' : event.message ? 'Message' : 'Unknown');
    return event;
  },
});

console.log('Testing Sentry integration...\n');

// Test 1: Capture a message
console.log('1. Testing message capture...');
Sentry.captureMessage('Test message from CodeAgentSwarm', 'info');

// Test 2: Capture an exception
console.log('2. Testing exception capture...');
try {
  throw new Error('Test error from CodeAgentSwarm');
} catch (error) {
  Sentry.captureException(error);
}

// Test 3: Capture with context
console.log('3. Testing exception with context...');
Sentry.withScope((scope) => {
  scope.setTag('test', true);
  scope.setLevel('error');
  scope.setContext('test_info', {
    script: 'test-sentry.js',
    purpose: 'Testing Sentry integration',
  });
  
  const testError = new Error('Contextualized test error');
  Sentry.captureException(testError);
});

// Test 4: Capture with user info
console.log('4. Testing with user context...');
Sentry.setUser({
  id: 'test-user-123',
  email: 'test@codeagentswarm.com',
  username: 'testuser',
});
Sentry.captureMessage('Test with user info', 'warning');

// Test 5: Test breadcrumbs
console.log('5. Testing breadcrumbs...');
Sentry.addBreadcrumb({
  message: 'User clicked on test button',
  category: 'ui',
  level: 'info',
});
Sentry.addBreadcrumb({
  message: 'Database query executed',
  category: 'database',
  level: 'debug',
  data: {
    query: 'SELECT * FROM tasks',
    duration: '25ms',
  },
});
Sentry.captureMessage('Event with breadcrumbs', 'info');

// Give Sentry time to send events before exiting
console.log('\nWaiting for events to be sent...');
setTimeout(() => {
  console.log('Test completed! Check your Sentry dashboard for the events.');
  console.log('\nIf no events appear:');
  console.log('1. Make sure SENTRY_DSN environment variable is set');
  console.log('2. Check that the DSN is correct and the project exists');
  console.log('3. Verify your network connection');
  process.exit(0);
}, 3000);
# Logging Guide for CodeAgentSwarm

## Default Behavior
By default, the console only shows **error messages** to keep it clean and focused on real problems.

## Temporary Debug Logs
When you need to add temporary debug logs, you have two options:

### Option 1: Use Debug Prefixes (Recommended for quick debugging)
```javascript
// These will ALWAYS show in the console:
console.log('[DEBUG] User clicked button:', buttonId);
console.log('[TEMP] Task data:', taskData);
```

Any console.log that starts with `[DEBUG]` or `[TEMP]` will be displayed even when other logs are suppressed.

### Option 2: Enable All Logs (For comprehensive debugging)
Run the app with the environment variable:
```bash
SHOW_ALL_LOGS=true npm start
```

This will show ALL console.log, console.info, console.warn, and console.debug messages.

## Best Practices

1. **Use [DEBUG] prefix for temporary debugging:**
   ```javascript
   console.log('[DEBUG] Terminal state:', this.terminals);
   ```

2. **Use [TEMP] prefix for logs you'll remove soon:**
   ```javascript
   console.log('[TEMP] Testing new feature:', data);
   ```

3. **Always use console.error for actual errors:**
   ```javascript
   console.error('Failed to connect to database:', error);
   ```

4. **Remove [TEMP] logs before committing:**
   - Search for `[TEMP]` in your code before making commits
   - These are meant to be temporary!

## Log Viewer
Remember that ALL logs (including suppressed ones) are still captured and available in the Log Viewer (accessible from the app's UI), so you don't lose any information even when console output is suppressed.
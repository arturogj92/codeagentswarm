const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const CommitRepository = require('../../domain/commit/commit-repository');
const CommitMessage = require('../../domain/commit/commit-message');

// Create promisified version carefully
const execAsync = (command, options) => {
    return new Promise((resolve, reject) => {
        exec(command, options, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
};

// Use spawn for better control over the claude command
const spawnAsync = (command, args, options) => {
    return new Promise((resolve, reject) => {
        console.log(`[spawnAsync] Running: ${command} ${args.join(' ')}`);
        const child = spawn(command, args, options);
        
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let timeoutId = null;
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
            console.log(`[spawnAsync] stdout chunk:`, data.toString());
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
            console.log(`[spawnAsync] stderr chunk:`, data.toString());
        });
        
        child.on('error', (error) => {
            console.error(`[spawnAsync] Process error:`, error);
            if (timeoutId) clearTimeout(timeoutId);
            reject(error);
        });
        
        child.on('close', (code) => {
            if (timeoutId) clearTimeout(timeoutId);
            console.log(`[spawnAsync] Process closed with code: ${code}`);
            
            if (timedOut) {
                const error = new Error(`Command timed out after ${options.timeout}ms`);
                error.code = 'TIMEOUT';
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            } else if (code !== 0) {
                const error = new Error(`Command failed with code ${code}`);
                error.code = code;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
        
        // Set timeout if provided - but don't kill immediately, let it try
        if (options.timeout) {
            timeoutId = setTimeout(() => {
                timedOut = true;
                console.log(`[spawnAsync] Timeout reached, killing process`);
                child.kill('SIGTERM');
            }, options.timeout);
        }
    });
};

/**
 * Claude implementation of CommitRepository
 * Uses local Claude CLI with -p flag for commit message generation
 */
class ClaudeCommitAdapter extends CommitRepository {
    constructor() {
        super();
        this.maxRetries = 1; // Reduce retries to save time
        this.timeout = 60000; // 60 seconds - generous timeout
        this.claudePath = 'claude'; // Default path, will be updated when checking availability
    }

    /**
     * Generates a commit message using Claude CLI
     * @param {Object} params
     * @returns {Promise<CommitMessage>}
     */
    async generateCommitMessage({ diff, modifiedFiles, style, workingDirectory }) {
        // Try with full prompt first
        let prompt = this.buildPrompt(diff, modifiedFiles, style);
        
        try {
            const message = await this.callClaude(prompt, workingDirectory);
            return CommitMessage.fromString(message);
        } catch (error) {
            console.error('[ClaudeCommitAdapter] First attempt failed:', error.message);
            
            // Try with a simplified prompt as fallback
            console.log('[ClaudeCommitAdapter] Trying with simplified prompt...');
            try {
                const simplifiedPrompt = this.buildSimplifiedPrompt(modifiedFiles);
                const message = await this.callClaudeSimple(simplifiedPrompt, workingDirectory);
                return CommitMessage.fromString(message);
            } catch (fallbackError) {
                console.error('[ClaudeCommitAdapter] Fallback also failed:', fallbackError.message);
                
                // Last resort: Generate a basic message locally
                console.log('[ClaudeCommitAdapter] Using local fallback message generation...');
                const localMessage = this.generateLocalFallback(modifiedFiles);
                return CommitMessage.fromString(localMessage);
            }
        }
    }

    /**
     * Generate a basic commit message locally without Claude
     * @private
     */
    generateLocalFallback(modifiedFiles) {
        if (!modifiedFiles || modifiedFiles.length === 0) {
            return 'chore: update files';
        }

        const actions = modifiedFiles.map(f => f.status);
        const fileNames = modifiedFiles.slice(0, 3).map(f => {
            const parts = f.path.split('/');
            return parts[parts.length - 1];
        });
        
        let type = 'chore';
        let action = 'update';
        
        if (actions.every(a => a === 'added')) {
            type = 'feat';
            action = 'add';
        } else if (actions.every(a => a === 'deleted')) {
            type = 'chore';
            action = 'remove';
        } else if (actions.some(a => a === 'modified')) {
            // Try to guess type from file extensions
            if (fileNames.some(f => f.includes('.test.') || f.includes('.spec.'))) {
                type = 'test';
            } else if (fileNames.some(f => f.includes('.md') || f.includes('.txt'))) {
                type = 'docs';
            } else if (fileNames.some(f => f.includes('.css') || f.includes('.scss'))) {
                type = 'style';
            } else {
                type = 'refactor';
            }
            action = 'update';
        }
        
        const fileStr = fileNames.length === 1 
            ? fileNames[0] 
            : `${fileNames.length} files`;
            
        return `${type}: ${action} ${fileStr}`;
    }

    /**
     * Builds a simplified prompt for fallback
     * @private
     */
    buildSimplifiedPrompt(modifiedFiles) {
        const fileList = modifiedFiles.slice(0, 5).map(f => `${f.path}`).join(', ');
        const mainAction = this.inferAction(modifiedFiles);
        
        return `Write a git commit message for: ${mainAction} ${fileList}. Format: type(scope): description. Reply with ONLY the commit message, no explanation.`;
    }

    /**
     * Infers the main action from modified files
     * @private
     */
    inferAction(modifiedFiles) {
        const actions = modifiedFiles.map(f => f.status);
        if (actions.every(a => a === 'added')) return 'adding';
        if (actions.every(a => a === 'deleted')) return 'removing';
        if (actions.every(a => a === 'modified')) return 'updating';
        return 'changing';
    }

    /**
     * Builds the prompt for Claude
     * @private
     */
    buildPrompt(diff, modifiedFiles, style) {
        // Limit file list to avoid huge prompts
        const maxFiles = 10;
        const fileList = modifiedFiles
            .slice(0, maxFiles)
            .map(f => `- ${f.path} (${f.status})`)
            .join('\n');
        const hasMoreFiles = modifiedFiles.length > maxFiles ? `\n... and ${modifiedFiles.length - maxFiles} more files` : '';
        
        // Reduce diff size to avoid timeouts
        const maxDiffSize = style === 'concise' ? 1500 : 2500;
        const truncatedDiff = diff.substring(0, maxDiffSize);
        const diffTruncated = diff.length > maxDiffSize;
        
        // Create a single-line prompt to avoid shell escaping issues
        const filesStr = fileList.replace(/\n/g, ', ');
        
        // Extract actual changes from diff more literally
        const addedLines = [];
        const removedLines = [];
        const diffLines = truncatedDiff.split('\n');
        
        for (const line of diffLines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
                addedLines.push(line.substring(1).trim());
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                removedLines.push(line.substring(1).trim());
            }
        }
        
        // Build a more literal description of changes
        let changeDescription = '';
        if (addedLines.length > 0 && removedLines.length === 0) {
            changeDescription = `Added: ${addedLines.slice(0, 3).join(', ')}`;
        } else if (removedLines.length > 0 && addedLines.length === 0) {
            changeDescription = `Removed: ${removedLines.slice(0, 3).join(', ')}`;
        } else if (addedLines.length > 0 && removedLines.length > 0) {
            changeDescription = `Modified: added ${addedLines.length} lines, removed ${removedLines.length} lines`;
        } else {
            // Fallback to diff preview
            changeDescription = truncatedDiff
                .split('\n')
                .slice(0, 5)
                .join(' | ')
                .substring(0, 300);
        }
        
        const basePrompt = `Generate a git commit message. Files: ${filesStr}${hasMoreFiles}. Changes: ${changeDescription}. Rules: 1) Use conventional commit format (feat/fix/docs/style/refactor/test/chore). 2) Be literal about what changed. 3) Don't interpret intent. 4) Focus on WHAT changed, not WHY.`;

        if (style === 'concise') {
            return `${basePrompt} Output: Single line only, max 72 chars. Example: feat(auth): add login validation`;
        } else {
            return `${basePrompt} Format: Title line, blank line, then bullet points describing changes.`;
        }
    }

    /**
     * Simplified Claude call with shorter timeout for fallback
     * @private
     */
    async callClaudeSimple(prompt, workingDirectory) {
        const claudeCmd = this.claudePath || 'claude';
        
        try {
            console.log('[ClaudeCommitAdapter] Executing simplified prompt with stdin...');
            
            // Use stdin for prompt
            const { stdout, stderr } = await this.spawnWithStdin(claudeCmd, ['-p'], prompt, {
                cwd: workingDirectory,
                timeout: 30000, // 30 seconds for simple prompt (half of main timeout)
                env: { 
                    ...process.env, 
                    CLAUDE_NO_COLOR: '1',
                    CLAUDE_DISABLE_TELEMETRY: '1'
                }
            });
            
            if (stderr && !stderr.includes('Warning')) {
                console.warn('[ClaudeCommitAdapter] Claude stderr:', stderr);
            }
            
            const cleanOutput = this.cleanOutput(stdout);
            
            if (!cleanOutput) {
                throw new Error('Empty response from Claude');
            }
            
            return cleanOutput;
        } catch (error) {
            throw new Error(`Simplified prompt failed: ${error.message}`);
        }
    }

    /**
     * Calls Claude CLI with the prompt
     * @private
     */
    async callClaude(prompt, workingDirectory) {
        // Use spawn instead of exec for better control
        const claudeCmd = this.claudePath || 'claude';
        
        console.log('[ClaudeCommitAdapter] Using spawn method with claude CLI via stdin');
        console.log('[ClaudeCommitAdapter] Prompt length:', prompt.length);
        
        let lastError;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`[ClaudeCommitAdapter] Attempt ${attempt}/${this.maxRetries} - Generating commit message...`);
                console.log(`[ClaudeCommitAdapter] Working directory: ${workingDirectory}`);
                console.log(`[ClaudeCommitAdapter] Timeout: ${this.timeout}ms`);
                
                const startTime = Date.now();
                
                // Use spawn with stdin for prompt
                const { stdout, stderr } = await this.spawnWithStdin(claudeCmd, ['-p'], prompt, {
                    cwd: workingDirectory,
                    timeout: this.timeout,
                    env: { 
                        ...process.env, 
                        CLAUDE_NO_COLOR: '1',
                        CLAUDE_DISABLE_TELEMETRY: '1'
                    }
                });
                
                const duration = Date.now() - startTime;
                console.log(`[ClaudeCommitAdapter] Command completed in ${duration}ms`);
                
                if (stderr && !stderr.includes('Warning')) {
                    console.warn('[ClaudeCommitAdapter] Claude stderr:', stderr);
                }
                
                const cleanOutput = this.cleanOutput(stdout);
                
                if (!cleanOutput) {
                    throw new Error('Empty response from Claude');
                }
                
                // Validate the output looks like a commit message
                if (!this.isValidCommitMessage(cleanOutput)) {
                    throw new Error('Invalid commit message format');
                }
                
                return cleanOutput;
            } catch (error) {
                lastError = error;
                console.error(`[ClaudeCommitAdapter] Attempt ${attempt} failed:`, error.message);
                console.error(`[ClaudeCommitAdapter] Error code:`, error.code);
                console.error(`[ClaudeCommitAdapter] Error stderr:`, error.stderr);
                console.error(`[ClaudeCommitAdapter] Error stdout:`, error.stdout);
                console.error(`[ClaudeCommitAdapter] Full error:`, error);
                
                // Check for specific error types
                if (error.killed && error.signal === 'SIGTERM') {
                    console.error('[ClaudeCommitAdapter] Process was killed due to timeout');
                    lastError = new Error(`Claude CLI timed out after ${this.timeout}ms. Try simplifying the diff or increasing timeout.`);
                } else if (error.code === 'ENOENT') {
                    console.error('[ClaudeCommitAdapter] Claude CLI not found in PATH');
                    lastError = new Error('Claude CLI not found. Please ensure Claude Code is installed and accessible.');
                }
                
                if (attempt < this.maxRetries) {
                    const backoffDelay = 1000 * attempt;
                    console.log(`[ClaudeCommitAdapter] Waiting ${backoffDelay}ms before retry...`);
                    await this.delay(backoffDelay); // Exponential backoff
                }
            }
        }
        
        // Provide more context in the error
        const errorMessage = lastError?.message || 'Failed to generate commit message after retries';
        throw new Error(`Commit generation failed: ${errorMessage}`);
    }

    /**
     * Cleans the output from Claude
     * @private
     */
    cleanOutput(output) {
        if (!output) return '';
        
        // Remove ANSI escape codes
        let clean = output.replace(/\x1b\[[0-9;]*m/g, '');
        
        // Remove markdown code block markers if present
        clean = clean.replace(/^```[a-z]*\n/gm, '');
        clean = clean.replace(/\n```$/gm, '');
        clean = clean.replace(/^```$/gm, '');
        
        // Remove any lines that look like system output or explanations
        const lines = clean.split('\n');
        const filtered = [];
        let foundCommitMessage = false;
        
        for (const line of lines) {
            // Skip system output patterns and explanations
            if (line.startsWith('[') || 
                line.toLowerCase().includes('based on') ||
                line.toLowerCase().includes('here\'s') ||
                line.toLowerCase().includes('commit message:') ||
                line.toLowerCase().includes('the commit') ||
                line.includes('AI') ||
                line.includes('assistant')) {
                continue;
            }
            
            // If we find what looks like a commit message, start capturing
            if (!foundCommitMessage && line.match(/^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)/)) {
                foundCommitMessage = true;
            }
            
            // Keep the line - including empty lines for formatting
            filtered.push(line);
        }
        
        // Join and clean up excessive whitespace
        let result = filtered.join('\n').trim();
        
        // If the result is multi-line but looks like a full explanation, try to extract just the commit
        if (result.includes('\n\n') && result.length > 500) {
            // Look for a line that starts with conventional commit keywords
            const match = result.match(/(^|\n)(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert).*$/m);
            if (match) {
                // Extract from that line onwards
                const startIndex = match.index + (match[1] ? 1 : 0);
                result = result.substring(startIndex).trim();
            }
        }
        
        // Normalize multiple newlines to double newline
        result = result.replace(/\n\n+/g, '\n\n');
        
        return result;
    }

    /**
     * Validates if the output looks like a valid commit message
     * @private
     */
    isValidCommitMessage(message) {
        if (!message) return false;
        
        const lines = message.split('\n');
        const firstLine = lines[0].trim();
        
        // Basic validation: must have at least 3 characters
        if (firstLine.length < 3) return false;
        
        // Check if first line follows conventional commit pattern
        const conventionalPattern = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?:\s*.+/;
        
        // Also accept messages that start with a capital letter or lowercase letter
        const genericPattern = /^[a-zA-Z].+/;
        
        return conventionalPattern.test(firstLine) || genericPattern.test(firstLine);
    }

    /**
     * Delay helper for retries
     * @private
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Spawn with stdin input
     * @private
     */
    spawnWithStdin(command, args, input, options) {
        return new Promise((resolve, reject) => {
            console.log(`[spawnWithStdin] Running: ${command} ${args.join(' ')} with stdin input`);
            const child = spawn(command, args, options);
            
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let timeoutId = null;
            
            // Send the input to stdin
            child.stdin.write(input);
            child.stdin.end();
            
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            child.on('error', (error) => {
                console.error(`[spawnWithStdin] Process error:`, error);
                if (timeoutId) clearTimeout(timeoutId);
                reject(error);
            });
            
            child.on('close', (code) => {
                if (timeoutId) clearTimeout(timeoutId);
                console.log(`[spawnWithStdin] Process closed with code: ${code}`);
                
                if (timedOut) {
                    const error = new Error(`Command timed out after ${options.timeout}ms`);
                    error.code = 'TIMEOUT';
                    error.stdout = stdout;
                    error.stderr = stderr;
                    reject(error);
                } else if (code !== 0) {
                    const error = new Error(`Command failed with code ${code}`);
                    error.code = code;
                    error.stdout = stdout;
                    error.stderr = stderr;
                    reject(error);
                } else {
                    resolve({ stdout, stderr });
                }
            });
            
            // Set timeout if provided
            if (options.timeout) {
                timeoutId = setTimeout(() => {
                    timedOut = true;
                    console.log(`[spawnWithStdin] Timeout reached, killing process`);
                    child.kill('SIGTERM');
                }, options.timeout);
            }
        });
    }

    /**
     * Checks if Claude CLI is available
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        // Common paths where claude might be installed
        const possiblePaths = [
            'claude',
            '/opt/homebrew/bin/claude',
            '/usr/local/bin/claude',
            '/usr/bin/claude',
            `${process.env.HOME}/.local/bin/claude`,
            `${process.env.HOME}/bin/claude`
        ];
        
        for (const claudePath of possiblePaths) {
            try {
                // Try to run claude with --version to ensure it's actually working
                const { stdout } = await execAsync(`${claudePath} --version`, {
                    timeout: 5000,
                    env: { ...process.env, CLAUDE_DISABLE_TELEMETRY: '1' }
                });
                
                if (stdout && (stdout.includes('Claude') || stdout.includes('claude'))) {
                    console.log(`[ClaudeCommitAdapter] Claude CLI is available at: ${claudePath}`);
                    console.log(`[ClaudeCommitAdapter] Version: ${stdout.trim()}`);
                    // Store the working path for later use
                    this.claudePath = claudePath;
                    return true;
                }
            } catch (error) {
                // This path didn't work, try next
                continue;
            }
        }
        
        // Last resort: try to find it with which/where
        try {
            const { stdout } = await execAsync('which claude || where claude || command -v claude', {
                timeout: 5000,
                shell: true
            });
            if (stdout && stdout.trim()) {
                const claudePath = stdout.trim().split('\n')[0]; // Take first result
                console.log('[ClaudeCommitAdapter] Claude CLI found via which at:', claudePath);
                this.claudePath = claudePath;
                
                // Verify it works
                try {
                    const { stdout: versionOut } = await execAsync(`${claudePath} --version`, {
                        timeout: 5000,
                        env: { ...process.env, CLAUDE_DISABLE_TELEMETRY: '1' }
                    });
                    console.log(`[ClaudeCommitAdapter] Version: ${versionOut.trim()}`);
                    return true;
                } catch (e) {
                    console.warn('[ClaudeCommitAdapter] Found claude but cannot execute it:', e.message);
                }
            }
        } catch (fallbackError) {
            // Command not found
        }
        
        console.warn('[ClaudeCommitAdapter] Claude CLI not available - tried all known paths');
        console.warn('[ClaudeCommitAdapter] PATH environment:', process.env.PATH);
        return false;
    }

    /**
     * Gets the name of the service
     * @returns {string}
     */
    getName() {
        return 'Claude';
    }
}

module.exports = ClaudeCommitAdapter;
const { exec } = require('child_process');
const { promisify } = require('util');
const fetch = require('node-fetch');
const os = require('os');
const execAsync = promisify(exec);

// Only load dotenv in development
try {
    require('dotenv').config();
} catch (e) {
    // dotenv is not available in production build, which is fine
    console.log('[DeepSeek] Running without dotenv - using environment variables directly');
}

class DeepSeekCommitService {
    constructor() {
        this.apiKey = process.env.DEEPSEEK_API_KEY;
        this.apiUrl = 'https://api.deepseek.com/v1/chat/completions';
        this.model = 'deepseek-coder'; // Using the cheaper coder model
        
        // Initialize database connection for settings
        try {
            const DatabaseManager = require('./database');
            this.db = new DatabaseManager();
            
            // If API key not in environment, try to load from database
            if (!this.apiKey) {
                const savedKey = this.db.getSetting('deepseek_api_key');
                if (savedKey) {
                    // getSetting returns parsed JSON, so if it's an object, get the value
                    this.apiKey = typeof savedKey === 'object' ? savedKey.value : savedKey;
                    process.env.DEEPSEEK_API_KEY = this.apiKey;
                }
            }
            
            // Load commit preferences
            const styleSetting = this.db.getSetting('commit_message_style');
            const languageSetting = this.db.getSetting('commit_message_language');
            
            // Handle both string and object returns from getSetting
            this.commitStyle = styleSetting || 'detailed';
            this.commitLanguage = languageSetting || 'auto';
        } catch (err) {
            // Database might not be available in some contexts
            console.log('[DeepSeek] Could not load settings from database:', err.message);
            this.commitStyle = 'detailed';
            this.commitLanguage = 'auto';
        }
        
        if (!this.apiKey) {
            console.warn('[DeepSeek] API key not found. AI commit generation will be disabled.');
            // Don't throw an error - just disable the service
            this.enabled = false;
        } else {
            this.enabled = true;
            // Log API key info for debugging (only first/last 4 chars)
            const keyPreview = this.apiKey.substring(0, 4) + '...' + this.apiKey.substring(this.apiKey.length - 4);
            console.log(`[DeepSeek] API key loaded: ${keyPreview} (length: ${this.apiKey.length})`);
        }
    }
    
    // Get the system language
    getSystemLanguage() {
        if (this.commitLanguage !== 'auto') {
            return this.commitLanguage;
        }
        
        const locale = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || 'en_US';
        const lang = locale.split('_')[0].toLowerCase();
        
        // Map common language codes
        const languageMap = {
            'es': 'Spanish',
            'en': 'English',
            'fr': 'French',
            'de': 'German',
            'it': 'Italian',
            'pt': 'Portuguese',
            'ru': 'Russian',
            'ja': 'Japanese',
            'zh': 'Chinese',
            'ko': 'Korean'
        };
        
        return languageMap[lang] || 'English';
    }

    async getGitDiff(workingDirectory) {
        try {
            // Get staged changes first
            const { stdout: stagedDiff } = await execAsync('git diff --staged', {
                cwd: workingDirectory
            });
            
            // If no staged changes, get all changes
            if (!stagedDiff.trim()) {
                const { stdout: allDiff } = await execAsync('git diff', {
                    cwd: workingDirectory
                });
                return allDiff;
            }
            
            return stagedDiff;
        } catch (error) {
            console.error('Error getting git diff:', error);
            throw new Error('Failed to get git diff');
        }
    }
    
    // Extract file names and their changes from the diff
    extractFileChanges(diff) {
        const fileChanges = [];
        const lines = diff.split('\n');
        let currentFile = null;
        let currentChanges = [];
        
        for (const line of lines) {
            // Detect file headers
            if (line.startsWith('diff --git')) {
                // Save previous file changes
                if (currentFile && currentChanges.length > 0) {
                    fileChanges.push({
                        file: currentFile,
                        changes: currentChanges.join('\n')
                    });
                }
                
                // Extract new file name
                const match = line.match(/b\/(.+)$/);
                currentFile = match ? match[1] : null;
                currentChanges = [];
            } else if (line.startsWith('+++') || line.startsWith('---')) {
                // Skip file markers
                continue;
            } else if (line.startsWith('+') || line.startsWith('-')) {
                // Collect actual changes
                if (currentFile && !line.startsWith('+++') && !line.startsWith('---')) {
                    currentChanges.push(line);
                }
            }
        }
        
        // Don't forget the last file
        if (currentFile && currentChanges.length > 0) {
            fileChanges.push({
                file: currentFile,
                changes: currentChanges.join('\n')
            });
        }
        
        return fileChanges;
    }
    
    // Get list of modified files with their status
    async getModifiedFiles(workingDirectory) {
        try {
            // Get staged files
            const { stdout: stagedFiles } = await execAsync('git diff --staged --name-status', {
                cwd: workingDirectory
            });
            
            // If no staged files, get all modified files
            if (!stagedFiles.trim()) {
                const { stdout: allFiles } = await execAsync('git diff --name-status', {
                    cwd: workingDirectory
                });
                return this.parseFileStatus(allFiles);
            }
            
            return this.parseFileStatus(stagedFiles);
        } catch (error) {
            console.error('Error getting modified files:', error);
            return [];
        }
    }
    
    // Parse file status output
    parseFileStatus(statusOutput) {
        const files = [];
        const lines = statusOutput.trim().split('\n').filter(line => line);
        
        for (const line of lines) {
            const [status, ...pathParts] = line.split('\t');
            const path = pathParts.join('\t');
            
            if (path) {
                files.push({
                    path,
                    status: this.getStatusDescription(status)
                });
            }
        }
        
        return files;
    }
    
    // Get human-readable status description
    getStatusDescription(status) {
        const statusMap = {
            'M': 'modified',
            'A': 'added',
            'D': 'deleted',
            'R': 'renamed',
            'C': 'copied',
            'U': 'updated'
        };
        
        return statusMap[status] || status;
    }
    
    // Build the prompt based on style and language
    buildPrompt(diff, modifiedFiles, fileChanges, style, language) {
        const fileList = modifiedFiles.map(f => `- ${f.path} (${f.status})`).join('\n');
        
        if (style === 'concise') {
            return `Generate a concise git commit message in ${language} following conventional commit format.

Modified files:
${fileList}

Git diff:
\`\`\`diff
${diff}
\`\`\`

Requirements:
- Use conventional commit format (feat:, fix:, docs:, style:, refactor:, test:, chore:)
- Maximum 72 characters
- Be specific and clear
- Write in ${language}

Generate only the commit message title, nothing else.`;
        } else {
            // Detailed style
            return `Generate a detailed git commit message in ${language} following this format:

1. A concise title using conventional commit format (feat:, fix:, docs:, style:, refactor:, test:, chore:)
2. A blank line
3. Bullet points explaining the specific changes made (use "- " for each point)
4. A blank line  
5. A brief explanation of why these changes were made (optional, only if important)

Modified files:
${fileList}

Git diff:
\`\`\`diff
${diff}
\`\`\`

Requirements:
- Title: max 72 characters, conventional commit format
- Bullet points: Be specific about what changed in each file
- Mention the file names in the bullet points when describing changes
- Explain the purpose/reason for the changes if it adds value
- Write everything in ${language}
- Focus on WHAT changed and WHY, not HOW

Example format:
refactor: improve terminal UI management and remove button ripple effect

- Updated interface update logic in renderer.js to optimize terminal removal
- Removed ripple effect in buttons in styles.css that caused display issues
- Fixed management button updates to work correctly

This update improves usability and clarity in terminal management.

Generate the complete commit message following this format:`;
        }
    }

    async generateCommitMessage(workingDirectory, style = null) {
        if (!this.enabled) {
            throw new Error('DeepSeek service is disabled - API key not configured');
        }
        
        try {
            const diff = await this.getGitDiff(workingDirectory);
            
            if (!diff.trim()) {
                throw new Error('No changes to analyze');
            }
            
            // Get the list of modified files
            const modifiedFiles = await this.getModifiedFiles(workingDirectory);
            const fileChanges = this.extractFileChanges(diff);
            
            // Use provided style or default from settings
            const commitStyle = style || this.commitStyle;
            const language = this.getSystemLanguage();

            // Limit diff size to avoid token limits
            const truncatedDiff = diff.length > 6000 ? diff.substring(0, 6000) + '\n... [truncated]' : diff;
            
            // Build the prompt based on style
            const prompt = this.buildPrompt(truncatedDiff, modifiedFiles, fileChanges, commitStyle, language);

            console.log(`[DeepSeek] Generating ${commitStyle} commit message in ${language}...`);
            
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: `You are a helpful assistant that generates clear and informative git commit messages based on code changes. You always follow conventional commit format and write in the requested language.`
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: commitStyle === 'concise' ? 100 : 500
                })
            });

            console.log('[DeepSeek] Response status:', response.status);

            if (!response.ok) {
                const error = await response.text();
                console.error('[DeepSeek] API Error:', error);
                throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
            }

            const data = await response.json();
            
            if (data && data.choices && data.choices[0]) {
                return {
                    success: true,
                    message: data.choices[0].message.content.trim()
                };
            }

            throw new Error('Invalid response from DeepSeek API');
        } catch (error) {
            console.error('Error generating commit message:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Update commit preferences
    updatePreferences(style, language) {
        if (this.db) {
            try {
                if (style) {
                    this.db.setSetting('commit_message_style', style);
                    this.commitStyle = style;
                }
                if (language) {
                    this.db.setSetting('commit_message_language', language);
                    this.commitLanguage = language;
                }
                return true;
            } catch (error) {
                console.error('Error updating preferences:', error);
                return false;
            }
        }
        return false;
    }
    
    // Get current preferences
    getPreferences() {
        return {
            style: this.commitStyle,
            language: this.commitLanguage
        };
    }
}

module.exports = DeepSeekCommitService;
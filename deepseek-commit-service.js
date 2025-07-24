const { exec } = require('child_process');
const { promisify } = require('util');
const fetch = require('node-fetch');
const execAsync = promisify(exec);

class DeepSeekCommitService {
    constructor() {
        // DEVELOPMENT ONLY - This should be moved to a server
        this.apiKey = 'sk-d68f24728fa0495d8b1d2100a484e274';
        this.apiUrl = 'https://api.deepseek.com/v1/chat/completions';
        this.model = 'deepseek-coder'; // Using the cheaper coder model
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

    async generateCommitMessage(workingDirectory) {
        try {
            const diff = await this.getGitDiff(workingDirectory);
            
            if (!diff.trim()) {
                throw new Error('No changes to analyze');
            }

            // Limit diff size to avoid token limits
            const truncatedDiff = diff.length > 8000 ? diff.substring(0, 8000) + '\n... [truncated]' : diff;

            const prompt = `Based on the following git diff, generate a concise and descriptive commit message following conventional commit format (feat:, fix:, docs:, style:, refactor:, test:, chore:).

The commit message should:
- Start with a type (feat, fix, docs, style, refactor, test, chore)
- Be in present tense
- Be concise but descriptive (max 72 characters for first line)
- Focus on what changed and why, not how

Git diff:
\`\`\`diff
${truncatedDiff}
\`\`\`

Generate only the commit message, nothing else.`;

            console.log('[DeepSeek] Sending request to API...');
            
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
                            content: 'You are a helpful assistant that generates clear and concise git commit messages based on code changes.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 200
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
}

module.exports = DeepSeekCommitService;
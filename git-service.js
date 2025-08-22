const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const commitServiceFactory = require('./infrastructure/commit/commit-service-factory');

class GitService {
    constructor() {
        this.initializeCommitService();
    }
    
    // Initialize commit service with factory
    async initializeCommitService() {
        try {
            await commitServiceFactory.initialize({
                logger: console
            });
            
            console.log('[GitService] Commit service initialized with Claude CLI');
        } catch (error) {
            console.warn('[GitService] Commit service initialization failed:', error.message);
            console.warn('[GitService] Please install Claude Code to use commit generation');
        }
    }
    
    // Method to reinitialize commit service (for when settings are updated)
    async reinitializeCommitService() {
        try {
            await this.initializeCommitService();
            console.log('[GitService] Commit service reinitialized');
            return true;
        } catch (error) {
            console.error('[GitService] Failed to reinitialize commit service:', error);
            return false;
        }
    }

    // Check if directory is a git repository
    isGitRepository(cwd) {
        try {
            const result = execSync('git rev-parse --is-inside-work-tree', { 
                cwd, 
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            }).trim();
            return result === 'true';
        } catch (error) {
            return false;
        }
    }

    // Get git status
    async getStatus(cwd) {
        try {
            if (!this.isGitRepository(cwd)) {
                return { success: false, error: 'Not a git repository' };
            }

            // Get current branch
            const branch = execSync('git branch --show-current', { cwd, encoding: 'utf8' }).trim();
            
            // Get git status with porcelain format
            const statusOutput = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
            const lines = statusOutput.split('\n').filter(line => line.trim());
            
            const files = lines.map(line => {
                const status = line.substring(0, 2);
                const file = line.substring(3);
                
                let statusText = 'unknown';
                let staged = false;
                let isDirectory = false;
                
                // Check if it's a directory
                try {
                    const filePath = path.join(cwd, file);
                    const stats = fs.statSync(filePath);
                    isDirectory = stats.isDirectory();
                } catch (e) {
                    // If we can't stat, assume it's a file
                }
                
                if (status[0] === 'M' || status[0] === 'A' || status[0] === 'D' || status[0] === 'R') {
                    staged = true;
                    statusText = status[0] === 'M' ? 'modified' : 
                                status[0] === 'A' ? 'added' : 
                                status[0] === 'D' ? 'deleted' : 'renamed';
                } else if (status[1] === 'M') {
                    statusText = 'modified';
                } else if (status === '??') {
                    statusText = 'untracked';
                }
                
                return { file, status: statusText, staged, isDirectory };
            });

            // Get commits
            const commitsOutput = execSync('git log --oneline -20', { cwd, encoding: 'utf8' });
            const commits = commitsOutput.split('\n').filter(line => line.trim()).map(line => {
                const [hash, ...messageParts] = line.split(' ');
                return { hash, message: messageParts.join(' ') };
            });

            // Check for unpushed commits
            let unpushedCount = 0;
            try {
                const upstream = execSync('git rev-parse --abbrev-ref @{u}', { 
                    cwd, 
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore']
                }).trim();
                
                if (upstream) {
                    unpushedCount = parseInt(
                        execSync(`git rev-list ${upstream}..HEAD --count`, { 
                            cwd, 
                            encoding: 'utf8' 
                        }).trim()
                    ) || 0;
                }
            } catch (e) {
                // No upstream branch
            }

            return {
                success: true,
                branch,
                files,
                commits,
                unpushedCount,
                workingDirectory: cwd,
                projectName: path.basename(cwd)
            };
        } catch (error) {
            console.error('Git status error:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to get git status' 
            };
        }
    }

    // Generate commit message with AI
    async generateCommitMessage(cwd, style = 'detailed') {
        try {
            if (!this.isGitRepository(cwd)) {
                return { success: false, error: 'Not a git repository' };
            }

            // Ensure commit service is initialized
            if (!commitServiceFactory.getDefaultAdapterName()) {
                return { 
                    success: false, 
                    error: 'Commit service not initialized. Please install Claude Code to use AI-powered commit messages.' 
                };
            }

            // Get the commit service
            const commitService = commitServiceFactory.createCommitService();
            
            // Get the diff
            const diffResult = await this.getDiff(cwd, true); // Get staged diff
            if (!diffResult.success || !diffResult.diff) {
                // If no staged diff, get unstaged diff
                const unstagedDiff = await this.getDiff(cwd, false);
                if (!unstagedDiff.success || !unstagedDiff.diff) {
                    return { 
                        success: false, 
                        error: 'No changes to generate commit message for' 
                    };
                }
            }
            
            // Generate commit message
            const commitMessage = await commitService.generateCommitMessage();
            const formattedMessage = commitMessage.format();
            
            return { 
                success: true, 
                message: formattedMessage 
            };
        } catch (error) {
            console.error('Generate commit message error:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to generate commit message' 
            };
        }
    }

    // Commit changes
    async commit(cwd, message, files) {
        try {
            if (!this.isGitRepository(cwd)) {
                return { success: false, error: 'Not a git repository' };
            }

            // Add specific files or all if none specified
            if (files && files.length > 0) {
                for (const file of files) {
                    execSync(`git add "${file}"`, { cwd });
                }
            } else {
                execSync('git add .', { cwd });
            }
            
            // Commit with message
            execSync(`git commit -m "${message}"`, { cwd, encoding: 'utf8' });
            
            return { success: true, message: 'Commit successful' };
        } catch (error) {
            console.error('Git commit error:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to commit changes' 
            };
        }
    }

    // Commit changes
    async commit(cwd, message) {
        try {
            if (!this.isGitRepository(cwd)) {
                return { success: false, error: 'Not a git repository' };
            }
            
            const output = execSync(`git commit -m "${message}"`, { cwd, encoding: 'utf8' });
            return { success: true, message: output };
        } catch (error) {
            console.error('Git commit error:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to commit changes' 
            };
        }
    }

    // Push changes
    async push(cwd) {
        try {
            if (!this.isGitRepository(cwd)) {
                return { success: false, error: 'Not a git repository' };
            }
            
            const output = execSync('git push', { cwd, encoding: 'utf8' });
            return { success: true, message: output };
        } catch (error) {
            console.error('Git push error:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to push changes' 
            };
        }
    }

    // Pull changes
    async pull(cwd) {
        try {
            if (!this.isGitRepository(cwd)) {
                return { success: false, error: 'Not a git repository' };
            }
            
            const output = execSync('git pull', { cwd, encoding: 'utf8' });
            return { success: true, message: output };
        } catch (error) {
            console.error('Git pull error:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to pull changes' 
            };
        }
    }

    // Get diff
    async getDiff(cwd, staged = false, fileName = null) {
        try {
            if (!this.isGitRepository(cwd)) {
                return { success: false, error: 'Not a git repository' };
            }
            
            let command;
            if (fileName) {
                command = staged ? `git diff --cached "${fileName}"` : `git diff "${fileName}"`;
            } else {
                command = staged ? 'git diff --cached' : 'git diff';
            }
            
            const output = execSync(command, { cwd, encoding: 'utf8' });
            return { success: true, diff: output };
        } catch (error) {
            console.error('Git diff error:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to get diff' 
            };
        }
    }

    // Discard file changes
    async discardFile(cwd, fileName) {
        try {
            // Check if file is tracked
            let isTracked = true;
            try {
                execSync(`git ls-files --error-unmatch "${fileName}"`, { 
                    cwd, 
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore']
                });
            } catch (e) {
                isTracked = false;
            }
            
            if (isTracked) {
                // Discard changes to tracked file
                execSync(`git checkout HEAD -- "${fileName}"`, { cwd });
                
                // Also remove from staging area if staged
                try {
                    execSync(`git reset HEAD "${fileName}"`, { 
                        cwd, 
                        stdio: ['pipe', 'pipe', 'ignore'] 
                    });
                } catch (e) {
                    // File might not be staged
                }
            } else {
                // Remove untracked file
                const filePath = path.join(cwd, fileName);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
            
            return { success: true, message: `Changes to ${fileName} discarded` };
        } catch (error) {
            console.error('Git discard file error:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to discard file changes' 
            };
        }
    }

    // Get branches
    async getBranches(cwd) {
        try {
            if (!this.isGitRepository(cwd)) {
                return { success: false, error: 'Not a git repository' };
            }

            // Get current branch
            const currentBranch = execSync('git branch --show-current', { 
                cwd, 
                encoding: 'utf8' 
            }).trim();
            
            // Get all branches
            const branchesOutput = execSync('git branch -a', { 
                cwd, 
                encoding: 'utf8' 
            });
            
            const localBranches = [];
            const remoteBranches = [];
            
            branchesOutput
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.includes('HEAD'))
                .forEach(line => {
                    const name = line.replace(/^\*?\s+/, '').trim();
                    
                    if (name.startsWith('remotes/')) {
                        remoteBranches.push(name.replace('remotes/', ''));
                    } else {
                        localBranches.push(name);
                    }
                });
            
            return { 
                success: true, 
                current: currentBranch,
                local: localBranches,
                remote: remoteBranches
            };
        } catch (error) {
            console.error('Git get branches error:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to get branches' 
            };
        }
    }

    // Switch branch
    async switchBranch(cwd, branchName) {
        try {
            execSync(`git checkout "${branchName}"`, { cwd });
            return { success: true, branchName };
        } catch (error) {
            console.error('Git switch branch error:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to switch branch' 
            };
        }
    }

    // Scan projects from multiple directories
    async scanProjects(directories) {
        const projects = [];
        
        for (const dir of directories) {
            if (this.isGitRepository(dir)) {
                try {
                    const status = await this.getStatus(dir);
                    if (status.success && status.files.length > 0) {
                        projects.push({
                            path: dir,
                            name: path.basename(dir),
                            branch: status.branch,
                            changeCount: status.files.length,
                            unpushedCount: status.unpushedCount
                        });
                    }
                } catch (error) {
                    console.error(`Error scanning ${dir}:`, error);
                }
            }
        }
        
        return { success: true, projects };
    }
}

module.exports = GitService;
const { execSync } = require('child_process');
const CommitMessage = require('../../domain/entities/commit/commit-message');

/**
 * Use case for generating commit messages
 * Orchestrates the commit generation process using injected repository
 */
class GenerateCommitUseCase {
    /**
     * @param {CommitRepository} commitRepository - The repository implementation to use
     * @param {Object} logger - Optional logger
     */
    constructor(commitRepository, logger = console) {
        if (!commitRepository) {
            throw new Error('CommitRepository is required');
        }
        this.repository = commitRepository;
        this.logger = logger;
    }

    /**
     * Executes the use case to generate a commit message
     * @param {Object} params
     * @param {string} params.workingDirectory - The git repository path
     * @param {string} params.style - 'concise' or 'detailed'
     * @returns {Promise<Object>} Result with success status and message or error
     */
    async execute({ workingDirectory, style = 'detailed' }) {
        try {
            // Validate it's a git repository
            if (!this.isGitRepository(workingDirectory)) {
                return {
                    success: false,
                    error: 'Not a git repository'
                };
            }

            // Get git diff
            const diff = this.getGitDiff(workingDirectory);
            
            if (!diff.trim()) {
                return {
                    success: false,
                    error: 'No changes to commit'
                };
            }

            // Get modified files
            const modifiedFiles = this.getModifiedFiles(workingDirectory);
            
            if (modifiedFiles.length === 0) {
                return {
                    success: false,
                    error: 'No modified files found'
                };
            }

            // Check if repository is available
            const isAvailable = await this.repository.isAvailable();
            if (!isAvailable) {
                return {
                    success: false,
                    error: `${this.repository.getName()} service is not available`
                };
            }

            // Generate commit message
            this.logger.log(`[GenerateCommitUseCase] Generating ${style} commit message using ${this.repository.getName()}...`);
            
            const commitMessage = await this.repository.generateCommitMessage({
                diff,
                modifiedFiles,
                style,
                workingDirectory
            });

            // Validate the generated message
            this.validateCommitMessage(commitMessage);

            return {
                success: true,
                message: commitMessage.toString(),
                metadata: {
                    type: commitMessage.getType(),
                    scope: commitMessage.getScope(),
                    filesChanged: modifiedFiles.length,
                    service: this.repository.getName()
                }
            };
        } catch (error) {
            this.logger.error('[GenerateCommitUseCase] Error:', error);
            return {
                success: false,
                error: error.message || 'Failed to generate commit message'
            };
        }
    }

    /**
     * Checks if directory is a git repository
     * @private
     */
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

    /**
     * Gets the git diff
     * @private
     */
    getGitDiff(workingDirectory) {
        try {
            // Get staged changes first
            let diff = execSync('git diff --staged', {
                cwd: workingDirectory,
                encoding: 'utf8',
                maxBuffer: 1024 * 1024 * 10 // 10MB
            });
            
            // If no staged changes, get all changes
            if (!diff.trim()) {
                diff = execSync('git diff', {
                    cwd: workingDirectory,
                    encoding: 'utf8',
                    maxBuffer: 1024 * 1024 * 10 // 10MB
                });
            }
            
            return diff;
        } catch (error) {
            throw new Error(`Failed to get git diff: ${error.message}`);
        }
    }

    /**
     * Gets list of modified files with their status
     * @private
     */
    getModifiedFiles(workingDirectory) {
        try {
            // Get staged files
            let statusOutput = execSync('git diff --staged --name-status', {
                cwd: workingDirectory,
                encoding: 'utf8'
            });
            
            // If no staged files, get all modified files
            if (!statusOutput.trim()) {
                statusOutput = execSync('git diff --name-status', {
                    cwd: workingDirectory,
                    encoding: 'utf8'
                });
            }
            
            return this.parseFileStatus(statusOutput);
        } catch (error) {
            this.logger.error('Error getting modified files:', error);
            return [];
        }
    }

    /**
     * Parses file status output
     * @private
     */
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

    /**
     * Gets human-readable status description
     * @private
     */
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

    /**
     * Validates the generated commit message
     * @private
     */
    validateCommitMessage(commitMessage) {
        if (!commitMessage || !commitMessage.title) {
            throw new Error('Invalid commit message generated');
        }
        
        // Additional validation is done in the CommitMessage entity
        // This is just a sanity check
    }
}

module.exports = GenerateCommitUseCase;
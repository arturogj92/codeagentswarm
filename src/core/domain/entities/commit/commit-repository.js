/**
 * Repository interface for commit message generation
 * This is a port in hexagonal architecture - implementations will be in infrastructure layer
 */
class CommitRepository {
    /**
     * Generates a commit message based on git diff
     * @param {Object} params
     * @param {string} params.diff - The git diff content
     * @param {Array} params.modifiedFiles - List of modified files with status
     * @param {string} params.style - 'concise' or 'detailed'
     * @param {string} params.workingDirectory - The working directory path
     * @returns {Promise<CommitMessage>} The generated commit message
     */
    async generateCommitMessage({ diff, modifiedFiles, style, workingDirectory }) {
        throw new Error('generateCommitMessage must be implemented by concrete repository');
    }

    /**
     * Checks if the service is available
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        throw new Error('isAvailable must be implemented by concrete repository');
    }

    /**
     * Gets the name of the service
     * @returns {string}
     */
    getName() {
        throw new Error('getName must be implemented by concrete repository');
    }
}

module.exports = CommitRepository;
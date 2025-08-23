/**
 * Domain entity for commit messages
 * Represents a git commit message with its structure and validation rules
 */
class CommitMessage {
    constructor({ title, body = '', footer = '' }) {
        this.validateTitle(title);
        this.title = title;
        this.body = body;
        this.footer = footer;
    }

    /**
     * Validates the commit title according to conventional commit format
     * @param {string} title 
     */
    validateTitle(title) {
        if (!title || typeof title !== 'string') {
            throw new Error('Commit title is required and must be a string');
        }

        if (title.length > 72) {
            throw new Error('Commit title must not exceed 72 characters');
        }

        // Check for conventional commit format
        const conventionalCommitPattern = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?: .+/;
        if (!conventionalCommitPattern.test(title)) {
            throw new Error('Commit title must follow conventional commit format');
        }
    }

    /**
     * Returns the formatted commit message
     * @returns {string}
     */
    toString() {
        let message = this.title;
        
        if (this.body) {
            message += '\n\n' + this.body;
        }
        
        if (this.footer) {
            message += '\n\n' + this.footer;
        }
        
        return message;
    }

    /**
     * Creates a CommitMessage from a raw string
     * @param {string} rawMessage 
     * @returns {CommitMessage}
     */
    static fromString(rawMessage) {
        const lines = rawMessage.split('\n');
        const title = lines[0] || '';
        
        let body = '';
        let footer = '';
        let inFooter = false;
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            
            // Detect footer patterns (Breaking changes, fixes, etc)
            if (line.match(/^(BREAKING CHANGE:|Fixes #|Closes #|Refs #)/)) {
                inFooter = true;
            }
            
            if (inFooter) {
                footer += (footer ? '\n' : '') + line;
            } else if (line.trim() !== '' || body !== '') {
                body += (body ? '\n' : '') + line;
            }
        }
        
        // Clean up body and footer
        body = body.trim();
        footer = footer.trim();
        
        return new CommitMessage({ title, body, footer });
    }

    /**
     * Gets the commit type from the title
     * @returns {string}
     */
    getType() {
        const match = this.title.match(/^(\w+)(\(.+\))?:/);
        return match ? match[1] : 'unknown';
    }

    /**
     * Gets the commit scope from the title if present
     * @returns {string|null}
     */
    getScope() {
        const match = this.title.match(/^\w+\((.+)\):/);
        return match ? match[1] : null;
    }

    /**
     * Gets the commit description from the title
     * @returns {string}
     */
    getDescription() {
        return this.title.replace(/^[\w]+(\(.+\))?:\s*/, '');
    }
}

module.exports = CommitMessage;
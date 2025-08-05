/**
 * Diff Parser - Converts unified diff format to side-by-side view structure
 * This module handles parsing of git diff output and creates structured data
 * suitable for rendering in a split view interface.
 */

class DiffParser {
    constructor() {
        this.CHUNK_CONTEXT_LINES = 3; // Default context lines around changes
        this.MIN_CHUNK_DISTANCE = 8; // Minimum lines between chunks to keep them separate
    }

    /**
     * Parse unified diff into structured format for side-by-side view
     * @param {string} unifiedDiff - Git diff output in unified format
     * @param {string} fileName - Name of the file being diffed
     * @param {Object} fileContents - Object with oldContent and newContent of the full file
     * @returns {Object} Structured diff data
     */
    parseDiff(unifiedDiff, fileName, fileContents = null) {
        if (!unifiedDiff || unifiedDiff.trim() === '') {
            return {
                fileName,
                chunks: [],
                hasChanges: false,
                oldFile: { lines: [] },
                newFile: { lines: [] },
                fileContents: fileContents
            };
        }

        const lines = unifiedDiff.split('\n');
        const chunks = [];
        let currentChunk = null;
        let oldLineNum = 0;
        let newLineNum = 0;
        let inHeader = true;

        // Store full file contents if provided
        const fullOldLines = fileContents?.oldContent ? fileContents.oldContent.split('\n') : null;
        const fullNewLines = fileContents?.newContent ? fileContents.newContent.split('\n') : null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip diff header lines
            if (line.startsWith('diff --git') || line.startsWith('index ') || 
                line.startsWith('---') || line.startsWith('+++')) {
                continue;
            }

            // Parse chunk header
            if (line.startsWith('@@')) {
                inHeader = false;
                const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
                if (match) {
                    oldLineNum = parseInt(match[1]);
                    newLineNum = parseInt(match[3]);

                    // Create new chunk with full range information
                    currentChunk = {
                        oldStart: oldLineNum,
                        newStart: newLineNum,
                        oldStartOriginal: oldLineNum, // Keep original start for expansion
                        newStartOriginal: newLineNum,
                        lines: [],
                        expandableTop: oldLineNum > 1 || newLineNum > 1,
                        expandableBottom: true, // Will be updated later
                        hiddenTopLines: Math.max(oldLineNum - 1, newLineNum - 1),
                        hiddenBottomLines: 0 // Will be calculated later
                    };
                    chunks.push(currentChunk);
                }
                continue;
            }

            if (!inHeader && currentChunk) {
                const lineType = this.getLineType(line);
                const content = line.substring(1); // Remove the +/- prefix

                if (lineType === 'added') {
                    currentChunk.lines.push({
                        type: 'added',
                        oldLine: null,
                        newLine: newLineNum++,
                        content: content
                    });
                } else if (lineType === 'removed') {
                    currentChunk.lines.push({
                        type: 'removed',
                        oldLine: oldLineNum++,
                        newLine: null,
                        content: content
                    });
                } else if (lineType === 'unchanged') {
                    currentChunk.lines.push({
                        type: 'unchanged',
                        oldLine: oldLineNum++,
                        newLine: newLineNum++,
                        content: content
                    });
                }
            }
        }

        // Calculate hidden bottom lines for each chunk
        if (fullOldLines && fullNewLines) {
            chunks.forEach((chunk, index) => {
                const lastLine = chunk.lines[chunk.lines.length - 1];
                const lastOldLine = lastLine.oldLine || chunk.oldStart + chunk.lines.filter(l => l.type !== 'added').length - 1;
                const lastNewLine = lastLine.newLine || chunk.newStart + chunk.lines.filter(l => l.type !== 'removed').length - 1;
                
                chunk.hiddenBottomLines = Math.max(
                    fullOldLines.length - lastOldLine,
                    fullNewLines.length - lastNewLine
                );
                chunk.expandableBottom = chunk.hiddenBottomLines > 0;
            });
        }

        // Process chunks to create optimized view
        const optimizedChunks = this.optimizeChunks(chunks);
        
        return {
            fileName,
            chunks: optimizedChunks,
            hasChanges: optimizedChunks.length > 0,
            stats: this.calculateStats(optimizedChunks),
            fileContents: fileContents,
            canExpand: !!(fullOldLines && fullNewLines)
        };
    }

    /**
     * Determine the type of diff line
     * @param {string} line - Line from diff output
     * @returns {string} Line type: 'added', 'removed', 'unchanged', or 'meta'
     */
    getLineType(line) {
        if (!line || line.length === 0) return 'unchanged';
        
        const firstChar = line[0];
        switch (firstChar) {
            case '+': return 'added';
            case '-': return 'removed';
            case ' ': return 'unchanged';
            case '@': return 'meta';
            default: return 'unchanged';
        }
    }

    /**
     * Optimize chunks by trimming excessive context and marking expandable areas
     * @param {Array} chunks - Raw chunks from parsing
     * @returns {Array} Optimized chunks
     */
    optimizeChunks(chunks) {
        return chunks.map((chunk, index) => {
            const optimized = { ...chunk };
            const lines = [...chunk.lines];
            
            // Find first and last change indices
            let firstChangeIndex = lines.findIndex(l => l.type !== 'unchanged');
            let lastChangeIndex = lines.length - 1 - [...lines].reverse().findIndex(l => l.type !== 'unchanged');

            if (firstChangeIndex === -1) {
                // No changes in this chunk
                return optimized;
            }

            // Trim context lines
            const startContext = Math.max(0, firstChangeIndex - this.CHUNK_CONTEXT_LINES);
            const endContext = Math.min(lines.length, lastChangeIndex + this.CHUNK_CONTEXT_LINES + 1);

            // Keep track of trimmed lines
            optimized.trimmedTop = startContext;
            optimized.trimmedBottom = lines.length - endContext;
            
            // Slice to keep only relevant context
            optimized.lines = lines.slice(startContext, endContext);
            
            // Update display start positions
            if (startContext > 0) {
                const removedUnchanged = lines.slice(0, startContext).filter(l => l.type === 'unchanged').length;
                const removedOld = lines.slice(0, startContext).filter(l => l.type !== 'added').length;
                const removedNew = lines.slice(0, startContext).filter(l => l.type !== 'removed').length;
                
                optimized.displayOldStart = chunk.oldStart + removedOld;
                optimized.displayNewStart = chunk.newStart + removedNew;
            } else {
                optimized.displayOldStart = chunk.oldStart;
                optimized.displayNewStart = chunk.newStart;
            }

            return optimized;
        });
    }

    /**
     * Calculate statistics for the diff
     * @param {Array} chunks - Processed chunks
     * @returns {Object} Statistics object
     */
    calculateStats(chunks) {
        let added = 0;
        let removed = 0;
        let modified = 0;

        chunks.forEach(chunk => {
            chunk.lines.forEach(line => {
                if (line.type === 'added') added++;
                else if (line.type === 'removed') removed++;
            });
        });

        // Rough estimate of modified lines (paired add/remove)
        modified = Math.min(added, removed);

        return {
            added: added - modified,
            removed: removed - modified,
            modified,
            total: added + removed
        };
    }

    /**
     * Create side-by-side view data from chunks
     * @param {Array} chunks - Optimized chunks
     * @returns {Object} Side-by-side view data
     */
    createSideBySideView(chunks) {
        const leftLines = [];
        const rightLines = [];

        chunks.forEach((chunk, chunkIndex) => {
            // Add expansion placeholder at the top if expandable
            if (chunk.expandableTop && (chunk.trimmedTop > 0 || chunk.hiddenTopLines > 0)) {
                const hiddenCount = chunk.trimmedTop + chunk.hiddenTopLines;
                leftLines.push({
                    type: 'expand',
                    direction: 'top',
                    chunkIndex,
                    hiddenCount,
                    content: `↑ Show more lines`
                });
                rightLines.push({
                    type: 'expand',
                    direction: 'top',
                    chunkIndex,
                    hiddenCount,
                    content: `↑ Show more lines`
                });
            }

            // Add chunk lines
            chunk.lines.forEach(line => {
                if (line.type === 'unchanged') {
                    leftLines.push({
                        number: line.oldLine,
                        content: line.content,
                        type: 'unchanged'
                    });
                    rightLines.push({
                        number: line.newLine,
                        content: line.content,
                        type: 'unchanged'
                    });
                } else if (line.type === 'removed') {
                    leftLines.push({
                        number: line.oldLine,
                        content: line.content,
                        type: 'removed'
                    });
                    rightLines.push({
                        number: null,
                        content: '',
                        type: 'empty'
                    });
                } else if (line.type === 'added') {
                    leftLines.push({
                        number: null,
                        content: '',
                        type: 'empty'
                    });
                    rightLines.push({
                        number: line.newLine,
                        content: line.content,
                        type: 'added'
                    });
                }
            });

            // Add expansion placeholder at the bottom if expandable
            if (chunk.expandableBottom && (chunk.trimmedBottom > 0 || chunk.hiddenBottomLines > 0)) {
                const hiddenCount = chunk.trimmedBottom + chunk.hiddenBottomLines;
                leftLines.push({
                    type: 'expand',
                    direction: 'bottom',
                    chunkIndex,
                    hiddenCount,
                    content: `↓ Show more lines`
                });
                rightLines.push({
                    type: 'expand',
                    direction: 'bottom',
                    chunkIndex,
                    hiddenCount,
                    content: `↓ Show more lines`
                });
            }

            // Add chunk separator if not last chunk
            if (chunkIndex < chunks.length - 1) {
                leftLines.push({ type: 'separator' });
                rightLines.push({ type: 'separator' });
            }
        });

        return { leftLines, rightLines };
    }

    /**
     * Expand context for a specific chunk
     * @param {Object} parsedDiff - Current parsed diff
     * @param {number} chunkIndex - Index of chunk to expand
     * @param {string} direction - 'top' or 'bottom'
     * @param {number} linesToExpand - Number of lines to expand
     * @returns {Object} Updated parsed diff with expanded chunk
     */
    expandChunkContext(parsedDiff, chunkIndex, direction, linesToExpand = 10) {
        if (!parsedDiff.fileContents) {
            // Silent return - this is expected when file contents aren't loaded
            return parsedDiff;
        }

        const chunk = parsedDiff.chunks[chunkIndex];
        if (!chunk) return parsedDiff;

        const fullOldLines = parsedDiff.fileContents.oldContent.split('\n');
        const fullNewLines = parsedDiff.fileContents.newContent.split('\n');

        if (direction === 'top') {
            // Calculate how many lines we can expand
            const currentOldStart = chunk.displayOldStart || chunk.oldStart;
            const currentNewStart = chunk.displayNewStart || chunk.newStart;
            const availableOld = currentOldStart - 1;
            const availableNew = currentNewStart - 1;
            const toExpand = Math.min(linesToExpand, availableOld, availableNew);

            if (toExpand > 0) {
                // Get the lines to prepend
                const newLines = [];
                for (let i = toExpand; i > 0; i--) {
                    newLines.push({
                        type: 'unchanged',
                        oldLine: currentOldStart - i,
                        newLine: currentNewStart - i,
                        content: fullOldLines[currentOldStart - i - 1] // -1 for 0-based index
                    });
                }

                // Update chunk
                chunk.lines = [...newLines, ...chunk.lines];
                chunk.displayOldStart = currentOldStart - toExpand;
                chunk.displayNewStart = currentNewStart - toExpand;
                chunk.hiddenTopLines = Math.max(0, chunk.hiddenTopLines - toExpand);
                chunk.expandableTop = chunk.hiddenTopLines > 0;
            }
        } else if (direction === 'bottom') {
            // Calculate how many lines we can expand
            const lastLine = chunk.lines[chunk.lines.length - 1];
            const currentOldEnd = Math.max(...chunk.lines.filter(l => l.oldLine).map(l => l.oldLine));
            const currentNewEnd = Math.max(...chunk.lines.filter(l => l.newLine).map(l => l.newLine));
            const availableOld = fullOldLines.length - currentOldEnd;
            const availableNew = fullNewLines.length - currentNewEnd;
            const toExpand = Math.min(linesToExpand, availableOld, availableNew);

            if (toExpand > 0) {
                // Get the lines to append
                const newLines = [];
                for (let i = 1; i <= toExpand; i++) {
                    newLines.push({
                        type: 'unchanged',
                        oldLine: currentOldEnd + i,
                        newLine: currentNewEnd + i,
                        content: fullOldLines[currentOldEnd + i - 1] // -1 for 0-based index
                    });
                }

                // Update chunk
                chunk.lines = [...chunk.lines, ...newLines];
                chunk.hiddenBottomLines = Math.max(0, chunk.hiddenBottomLines - toExpand);
                chunk.expandableBottom = chunk.hiddenBottomLines > 0;
            }
        }

        return { ...parsedDiff };
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DiffParser;
}
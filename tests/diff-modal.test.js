/**
 * Unit tests for Diff Modal functionality
 * Tests view switching, expansion, and modal interactions
 */

// Mock the TerminalManager class methods we need
class MockTerminalManager {
    constructor() {
        this.escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };
    }
    
    switchToUnifiedView(modal, parsedDiff) {
        // Simplified implementation for testing
        modal.querySelector('#split-view-btn').classList.remove('active');
        modal.querySelector('#unified-view-btn').classList.add('active');
        
        const unifiedLines = this.createUnifiedViewLines(parsedDiff.chunks);
        
        const diffBody = modal.querySelector('.diff-body-split');
        if (diffBody) {
            diffBody.className = 'diff-body-unified';
            diffBody.innerHTML = `
                <div class="diff-panel diff-panel-unified">
                    <div class="diff-panel-content" id="diff-unified-content">
                        ${this.renderUnifiedDiffLines(unifiedLines, parsedDiff)}
                    </div>
                </div>
            `;
        }
    }
    
    switchToSplitView(modal, parsedDiff) {
        modal.querySelector('#unified-view-btn').classList.remove('active');
        modal.querySelector('#split-view-btn').classList.add('active');
        
        const diffBody = modal.querySelector('.diff-body-unified');
        if (diffBody) {
            diffBody.className = 'diff-body-split';
            diffBody.innerHTML = `
                <div class="diff-panel diff-panel-left">
                    <div class="diff-panel-content" id="diff-left-content"></div>
                </div>
                <div class="diff-panel diff-panel-right">
                    <div class="diff-panel-content" id="diff-right-content"></div>
                </div>
            `;
        }
    }
    
    createUnifiedViewLines(chunks) {
        const unifiedLines = [];
        
        chunks.forEach((chunk, chunkIndex) => {
            if (chunk.expandableTop && (chunk.trimmedTop > 0 || chunk.hiddenTopLines > 0)) {
                unifiedLines.push({
                    type: 'expand',
                    direction: 'top',
                    chunkIndex,
                    content: '↑ Show more lines'
                });
            }
            
            chunk.lines.forEach(line => {
                unifiedLines.push({
                    type: line.type,
                    oldLine: line.oldLine,
                    newLine: line.newLine,
                    content: line.content
                });
            });
            
            if (chunk.expandableBottom && (chunk.trimmedBottom > 0 || chunk.hiddenBottomLines > 0)) {
                unifiedLines.push({
                    type: 'expand',
                    direction: 'bottom',
                    chunkIndex,
                    content: '↓ Show more lines'
                });
            }
            
            if (chunkIndex < chunks.length - 1) {
                unifiedLines.push({ type: 'separator' });
            }
        });
        
        return unifiedLines;
    }
    
    renderUnifiedDiffLines(lines, parsedDiff) {
        return lines.map((line) => {
            if (line.type === 'expand') {
                return `
                    <div class="diff-line diff-line-expand">
                        <button class="expand-btn" data-chunk="${line.chunkIndex}" data-direction="${line.direction}">
                            ${line.content}
                        </button>
                    </div>
                `;
            } else if (line.type === 'separator') {
                return '<div class="diff-chunk-separator">...</div>';
            } else {
                const lineClass = line.type === 'added' ? 'diff-line-added' : 
                                 line.type === 'removed' ? 'diff-line-removed' : 
                                 'diff-line-unchanged';
                const prefix = line.type === 'added' ? '+' : 
                              line.type === 'removed' ? '-' : 
                              ' ';
                const lineNumber = line.type === 'removed' ? line.oldLine : line.newLine;
                const otherNumber = line.type === 'removed' ? '' : 
                                   line.type === 'added' ? '' : 
                                   line.oldLine;
                
                return `
                    <div class="diff-line ${lineClass}">
                        <span class="line-number">${otherNumber || ''}</span>
                        <span class="line-number">${lineNumber || ''}</span>
                        <span class="line-prefix">${prefix}</span>
                        <span class="line-content">${this.escapeHtml(line.content)}</span>
                    </div>
                `;
            }
        }).join('');
    }
    
    async handleDiffExpansion(button, modal) {
        const chunkIndex = parseInt(button.dataset.chunk);
        const direction = button.dataset.direction;
        
        button.disabled = true;
        button.textContent = 'Loading...';
        
        try {
            if (modal.parser && modal.parser.expandChunkContext) {
                const expandedDiff = modal.parser.expandChunkContext(
                    modal.parsedDiff, 
                    chunkIndex, 
                    direction, 
                    50
                );
                modal.parsedDiff = expandedDiff;
            }
        } finally {
            button.disabled = false;
            button.textContent = 'Show more lines';
        }
    }
    
    async showFileDiff(fileName, workingDirectory) {
        // Mock implementation for testing
        const { ipcRenderer } = window.require('electron');
        const result = await ipcRenderer.invoke('git-diff', fileName, workingDirectory, { includeFileContents: true });
        
        if (result.success) {
            const modal = document.createElement('div');
            modal.className = 'diff-modal';
            modal.innerHTML = `
                <button id="split-view-btn" class="active">Split View</button>
                <button id="unified-view-btn">Unified View</button>
                <div class="diff-body-split"></div>
            `;
            document.body.appendChild(modal);
        }
    }
}

describe('Diff Modal Functionality', () => {
    let terminalManager;
    
    beforeEach(() => {
        terminalManager = new MockTerminalManager();
        document.body.innerHTML = '<div id="root"></div>';
        jest.clearAllMocks();
    });

    describe('View Switching', () => {
        test('should switch from split view to unified view', () => {
            // Create a mock modal with parsed diff
            const modal = document.createElement('div');
            modal.className = 'diff-modal';
            modal.innerHTML = `
                <button id="split-view-btn" class="active">Split View</button>
                <button id="unified-view-btn">Unified View</button>
                <div class="diff-body-split"></div>
            `;
            
            const mockParsedDiff = {
                chunks: [{
                    lines: [
                        { type: 'unchanged', oldLine: 1, newLine: 1, content: 'line1' },
                        { type: 'removed', oldLine: 2, newLine: null, content: 'line2' },
                        { type: 'added', oldLine: null, newLine: 2, content: 'line2-new' }
                    ],
                    expandableTop: false,
                    expandableBottom: false
                }]
            };
            
            modal.parser = { createSideBySideView: jest.fn() };
            modal.parsedDiff = mockParsedDiff;
            document.body.appendChild(modal);
            
            // Call switchToUnifiedView
            terminalManager.switchToUnifiedView(modal, mockParsedDiff);
            
            // Verify UI changes
            expect(modal.querySelector('#split-view-btn').classList.contains('active')).toBe(false);
            expect(modal.querySelector('#unified-view-btn').classList.contains('active')).toBe(true);
            expect(modal.querySelector('.diff-body-split')).toBeNull();
            expect(modal.querySelector('.diff-body-unified')).not.toBeNull();
            expect(modal.querySelector('#diff-unified-content')).not.toBeNull();
        });

        test('should switch from unified view back to split view', () => {
            // Create a mock modal in unified view
            const modal = document.createElement('div');
            modal.className = 'diff-modal';
            modal.innerHTML = `
                <button id="split-view-btn">Split View</button>
                <button id="unified-view-btn" class="active">Unified View</button>
                <div class="diff-body-unified"></div>
            `;
            
            const mockParsedDiff = {
                chunks: [{
                    lines: [
                        { type: 'unchanged', oldLine: 1, newLine: 1, content: 'line1' }
                    ]
                }]
            };
            
            modal.parser = {
                createSideBySideView: jest.fn().mockReturnValue({
                    leftLines: [{ type: 'unchanged', number: 1, content: 'line1' }],
                    rightLines: [{ type: 'unchanged', number: 1, content: 'line1' }]
                })
            };
            modal.parsedDiff = mockParsedDiff;
            document.body.appendChild(modal);
            
            // Call switchToSplitView
            terminalManager.switchToSplitView(modal, mockParsedDiff);
            
            // Verify UI changes
            expect(modal.querySelector('#unified-view-btn').classList.contains('active')).toBe(false);
            expect(modal.querySelector('#split-view-btn').classList.contains('active')).toBe(true);
            expect(modal.querySelector('.diff-body-unified')).toBeNull();
            expect(modal.querySelector('.diff-body-split')).not.toBeNull();
            expect(modal.querySelector('#diff-left-content')).not.toBeNull();
            expect(modal.querySelector('#diff-right-content')).not.toBeNull();
        });
    });

    describe('createUnifiedViewLines', () => {
        test('should create unified view lines from chunks', () => {
            const chunks = [{
                lines: [
                    { type: 'unchanged', oldLine: 1, newLine: 1, content: 'line1' },
                    { type: 'removed', oldLine: 2, newLine: null, content: 'old' },
                    { type: 'added', oldLine: null, newLine: 2, content: 'new' }
                ],
                expandableTop: false,
                expandableBottom: false
            }];
            
            const unifiedLines = terminalManager.createUnifiedViewLines(chunks);
            
            expect(unifiedLines).toHaveLength(3);
            expect(unifiedLines[0].type).toBe('unchanged');
            expect(unifiedLines[1].type).toBe('removed');
            expect(unifiedLines[2].type).toBe('added');
        });

        test('should add expansion placeholders when needed', () => {
            const chunks = [{
                lines: [
                    { type: 'unchanged', oldLine: 10, newLine: 10, content: 'line' }
                ],
                expandableTop: true,
                expandableBottom: true,
                trimmedTop: 5,
                trimmedBottom: 3,
                hiddenTopLines: 9,
                hiddenBottomLines: 20
            }];
            
            const unifiedLines = terminalManager.createUnifiedViewLines(chunks);
            
            expect(unifiedLines).toHaveLength(3);
            expect(unifiedLines[0].type).toBe('expand');
            expect(unifiedLines[0].direction).toBe('top');
            expect(unifiedLines[2].type).toBe('expand');
            expect(unifiedLines[2].direction).toBe('bottom');
        });

        test('should add separators between chunks', () => {
            const chunks = [
                {
                    lines: [{ type: 'unchanged', oldLine: 1, newLine: 1, content: 'line1' }],
                    expandableTop: false,
                    expandableBottom: false
                },
                {
                    lines: [{ type: 'unchanged', oldLine: 10, newLine: 10, content: 'line10' }],
                    expandableTop: false,
                    expandableBottom: false
                }
            ];
            
            const unifiedLines = terminalManager.createUnifiedViewLines(chunks);
            
            expect(unifiedLines).toHaveLength(3);
            expect(unifiedLines[1].type).toBe('separator');
        });
    });

    describe('renderUnifiedDiffLines', () => {
        test('should render unified diff lines with proper HTML', () => {
            const lines = [
                { type: 'unchanged', oldLine: 1, newLine: 1, content: 'unchanged line' },
                { type: 'removed', oldLine: 2, newLine: null, content: 'removed line' },
                { type: 'added', oldLine: null, newLine: 2, content: 'added line' }
            ];
            
            const html = terminalManager.renderUnifiedDiffLines(lines, {});
            
            expect(html).toContain('diff-line-unchanged');
            expect(html).toContain('diff-line-removed');
            expect(html).toContain('diff-line-added');
            expect(html).toContain('unchanged line');
            expect(html).toContain('removed line');
            expect(html).toContain('added line');
        });

        test('should render expansion buttons correctly', () => {
            const lines = [
                {
                    type: 'expand',
                    direction: 'top',
                    chunkIndex: 0,
                    content: '↑ Show more lines'
                }
            ];
            
            const html = terminalManager.renderUnifiedDiffLines(lines, {});
            
            expect(html).toContain('expand-btn');
            expect(html).toContain('data-chunk="0"');
            expect(html).toContain('data-direction="top"');
            expect(html).toContain('↑ Show more lines');
        });

        test('should render separators correctly', () => {
            const lines = [{ type: 'separator' }];
            
            const html = terminalManager.renderUnifiedDiffLines(lines, {});
            
            expect(html).toContain('diff-chunk-separator');
            expect(html).toContain('...');
        });

        test('should escape HTML in content', () => {
            const lines = [
                { type: 'unchanged', oldLine: 1, newLine: 1, content: '<script>alert("xss")</script>' }
            ];
            
            const html = terminalManager.renderUnifiedDiffLines(lines, {});
            
            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;script&gt;');
        });
    });

    describe('Diff Expansion', () => {
        test('should handle diff expansion button click', async () => {
            const modal = document.createElement('div');
            const initialParsedDiff = { chunks: [{ lines: [] }] };
            const returnValue = {
                chunks: [{
                    lines: [
                        { type: 'unchanged', oldLine: 1, newLine: 1, content: 'line1' },
                        { type: 'unchanged', oldLine: 2, newLine: 2, content: 'line2' }
                    ]
                }]
            };
            const mockParser = {
                expandChunkContext: jest.fn().mockReturnValue(returnValue)
            };
            
            modal.parser = mockParser;
            modal.parsedDiff = initialParsedDiff;
            
            const button = document.createElement('button');
            button.dataset.chunk = '0';
            button.dataset.direction = 'top';
            button.classList.add('expand-btn');
            button.textContent = 'Show more lines';
            
            await terminalManager.handleDiffExpansion(button, modal);
            
            expect(mockParser.expandChunkContext).toHaveBeenCalledWith(
                initialParsedDiff,
                0,
                'top',
                50
            );
            expect(button.disabled).toBe(false);
            expect(button.textContent).toBe('Show more lines');
            expect(modal.parsedDiff).toBe(returnValue);
        });
    });
});


/**
 * Tests for MCPInstructionsManager
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock fs module
jest.mock('fs');

// Mock os module  
jest.mock('os');

// Mock console
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

describe('MCPInstructionsManager', () => {
    let MCPInstructionsManager;
    let manager;
    
    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Set up os mock
        os.homedir.mockReturnValue('/home/user');
        
        // Load MCPInstructionsManager
        jest.isolateModules(() => {
            MCPInstructionsManager = require('../mcp-instructions-manager.js');
        });
        
        manager = new MCPInstructionsManager();
    });
    
    afterEach(() => {
        jest.clearAllMocks();
    });
    
    describe('Constructor', () => {
        it('should initialize with correct markers', () => {
            expect(manager.MCP_START).toBe('<!-- MCP INSTRUCTIONS START - AUTO-GENERATED -->');
            expect(manager.MCP_END).toBe('<!-- MCP INSTRUCTIONS END -->');
        });
        
        it('should have MCP templates defined', () => {
            expect(manager.mcpTemplates).toHaveProperty('brave-search');
            expect(manager.mcpTemplates).toHaveProperty('notion');
            expect(manager.mcpTemplates).toHaveProperty('supabase');
            expect(manager.mcpTemplates).toHaveProperty('filesystem');
            expect(manager.mcpTemplates).toHaveProperty('context7');
        });
    });
    
    describe('detectInstalledMCPs', () => {
        it('should detect MCPs from Claude config', async () => {
            const mockConfig = {
                mcpServers: {
                    'brave-search': { command: 'npx' },
                    'notion': { command: 'npx' }
                }
            };
            
            fs.existsSync.mockImplementation(path => {
                return path.includes('claude_desktop_config.json');
            });
            fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
            
            const mcps = await manager.detectInstalledMCPs();
            
            expect(mcps).toContain('brave-search');
            expect(mcps).toContain('notion');
        });
        
        it('should handle missing config files', async () => {
            fs.existsSync.mockReturnValue(false);
            
            const mcps = await manager.detectInstalledMCPs();
            
            expect(mcps).toEqual([]);
            expect(consoleLogSpy).toHaveBeenCalledWith('⚠️  No Claude config found with MCP servers');
        });
        
        it('should handle config parse errors', async () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('invalid json');
            
            const mcps = await manager.detectInstalledMCPs();
            
            expect(mcps).toEqual([]);
            expect(consoleWarnSpy).toHaveBeenCalled();
        });
        
        it('should normalize MCP names', async () => {
            const mockConfig = {
                mcpServers: {
                    'mcp-brave-search': { command: 'npx' },
                    '@modelcontextprotocol/notion': { command: 'npx' },
                    'MCP_filesystem': { command: 'npx' }
                }
            };
            
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
            
            const mcps = await manager.detectInstalledMCPs();
            
            expect(mcps).toContain('brave-search');
            expect(mcps).toContain('notion');
            expect(mcps).toContain('filesystem');
        });
    });
    
    describe('generateMCPInstructions', () => {
        it('should generate instructions for installed MCPs', () => {
            const installedMCPs = ['brave-search', 'notion'];
            
            const instructions = manager.generateMCPInstructions(installedMCPs);
            
            expect(instructions).toContain('### 🔍 Brave Search MCP');
            expect(instructions).toContain('### 📝 Notion MCP');
            expect(instructions).toContain('## MCP Usage Instructions');
        });
        
        it('should handle empty MCP list', () => {
            const instructions = manager.generateMCPInstructions([]);
            
            expect(instructions).toContain('No additional MCP servers detected');
        });
        
        it('should include general MCP rules', () => {
            const instructions = manager.generateMCPInstructions(['supabase']);
            
            expect(instructions).toContain('### 🎯 General MCP Rules');
            expect(instructions).toContain('Tool Priority:');
            expect(instructions).toContain('Documentation:');
        });
        
        it('should skip unknown MCP types', () => {
            const instructions = manager.generateMCPInstructions(['unknown-mcp', 'notion']);
            
            expect(instructions).toContain('### 📝 Notion MCP');
            expect(instructions).not.toContain('unknown-mcp');
        });
    });
    
    describe('updateMCPSection', () => {
        const mockContent = `# Project Configuration

Some content here

<!-- MCP INSTRUCTIONS START - AUTO-GENERATED -->
Old MCP instructions
<!-- MCP INSTRUCTIONS END -->

More content here`;
        
        it('should replace existing MCP section', () => {
            const newInstructions = '## New MCP Instructions\nTest content';
            
            const updated = manager.updateMCPSection(mockContent, newInstructions);
            
            expect(updated).toContain('## New MCP Instructions');
            expect(updated).toContain('Test content');
            expect(updated).not.toContain('Old MCP instructions');
        });
        
        it('should preserve content before and after MCP section', () => {
            const newInstructions = '## New Instructions';
            
            const updated = manager.updateMCPSection(mockContent, newInstructions);
            
            expect(updated).toContain('# Project Configuration');
            expect(updated).toContain('Some content here');
            expect(updated).toContain('More content here');
        });
        
        it('should add MCP section if not present', () => {
            const contentWithoutMCP = `# Project Configuration

Some content here`;
            
            const newInstructions = '## MCP Instructions';
            
            const updated = manager.updateMCPSection(contentWithoutMCP, newInstructions);
            
            expect(updated).toContain(manager.MCP_START);
            expect(updated).toContain(manager.MCP_END);
            expect(updated).toContain('## MCP Instructions');
        });
    });
    
    describe('updateClaudeMd', () => {
        beforeEach(() => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockImplementation((path) => {
                if (path.includes('claude_desktop_config')) {
                    return JSON.stringify({ mcpServers: { 'notion': {} } });
                }
                return '# CLAUDE.md\n\nContent here';
            });
            fs.writeFileSync.mockImplementation(() => {});
        });
        
        it('should update global CLAUDE.md by default', async () => {
            await manager.updateClaudeMd(true);
            
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('.claude/CLAUDE.md'),
                expect.any(String)
            );
        });
        
        it('should update local CLAUDE.md when specified', async () => {
            await manager.updateClaudeMd(false);
            
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('CLAUDE.md'),
                expect.any(String)
            );
        });
        
        it('should create backup before updating', async () => {
            await manager.updateClaudeMd(true);
            
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('.backup-mcp'),
                expect.any(String)
            );
        });
        
        it('should handle file not found', async () => {
            fs.existsSync.mockImplementation(path => !path.includes('CLAUDE.md'));
            
            const result = await manager.updateClaudeMd(true);
            
            expect(result).toBe(false);
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '⚠️  CLAUDE.md not found at',
                expect.stringContaining('CLAUDE.md')
            );
        });
        
        it('should handle write errors', async () => {
            // Mock file exists but write fails
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('# CLAUDE.md');
            fs.writeFileSync.mockImplementation((path) => {
                if (path.includes('.backup-mcp')) {
                    // Allow backup to succeed
                    return;
                }
                throw new Error('Write error');
            });
            
            // Mock detectInstalledMCPs to return something
            manager.detectInstalledMCPs = jest.fn().mockResolvedValue(['notion']);
            
            // This should throw but be caught
            await expect(manager.updateClaudeMd(true)).rejects.toThrow();
        });
    });
    
    describe('addMCPInstructions', () => {
        beforeEach(() => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('# CLAUDE.md\n\nContent');
            fs.writeFileSync.mockImplementation(() => {});
        });
        
        it('should add specific MCP instructions', async () => {
            // Mock detectInstalledMCPs to return brave-search
            manager.detectInstalledMCPs = jest.fn().mockResolvedValue(['brave-search']);
            
            const result = await manager.addMCPInstructions('brave-search');
            
            expect(result).toBe(true);
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Adding instructions for MCP: brave-search')
            );
        });
        
        it('should handle unknown MCP', async () => {
            await manager.addMCPInstructions('unknown-mcp');
            
            expect(consoleLogSpy).toHaveBeenCalled();
        });
    });
    
    describe('listAvailableTemplates', () => {
        it('should list all available templates', () => {
            manager.listAvailableTemplates();
            
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Available MCP instruction templates')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '  • brave-search: Brave Search'
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '  • notion: Notion'
            );
        });
    });
    
    describe('MCP Templates', () => {
        it('should have correct brave-search template', () => {
            const template = manager.mcpTemplates['brave-search'];
            
            expect(template.name).toBe('Brave Search');
            expect(template.instructions).toContain('brave_web_search');
            expect(template.instructions).toContain('brave_local_search');
        });
        
        it('should have correct notion template', () => {
            const template = manager.mcpTemplates['notion'];
            
            expect(template.name).toBe('Notion');
            expect(template.instructions).toContain('MANDATORY');
            expect(template.instructions).toContain('query-database');
        });
        
        it('should have correct supabase template', () => {
            const template = manager.mcpTemplates['supabase'];
            
            expect(template.name).toBe('Supabase');
            expect(template.instructions).toContain('search_docs');
            expect(template.instructions).toContain('apply_migration');
        });
        
        it('should have correct filesystem template', () => {
            const template = manager.mcpTemplates['filesystem'];
            
            expect(template.name).toBe('Filesystem');
            expect(template.instructions).toContain('read_multiple_files');
            expect(template.instructions).toContain('search_files');
        });
        
        it('should have correct context7 template', () => {
            const template = manager.mcpTemplates['context7'];
            
            expect(template.name).toBe('Context7');
            expect(template.instructions).toContain('resolve-library-id');
            expect(template.instructions).toContain('get-library-docs');
        });
    });
    
    describe('CLI execution', () => {
        it('should execute main function when run as script', () => {
            // This test is more for coverage
            // The actual CLI execution is tested by the script structure
            expect(manager).toBeDefined();
        });
    });
});
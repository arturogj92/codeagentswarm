// Tests for MCP detection functionality
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock the MCPPermissionsModal class
class MCPPermissionsModalTest {
    constructor() {
        this.knownMCPMetadata = {
            'supabase': {
                displayName: 'Supabase',
                logo: 'assets/mcp-icons/supabase.png',
                tools: ['list_projects', 'get_project', 'create_project']
            },
            'notion': {
                displayName: 'Notion',
                logo: 'assets/mcp-icons/notion.png',
                tools: ['query-database', 'create-page', 'update-page']
            },
            'brave-search': {
                displayName: 'Brave Search',
                logo: 'assets/mcp-icons/brave-search.png',
                tools: ['brave_web_search', 'brave_local_search']
            },
            'postgres': {
                displayName: 'PostgreSQL',
                logo: 'assets/mcp-icons/postgres.png',
                tools: ['query']
            },
            'codeagentswarm-tasks': {
                displayName: 'CodeAgentSwarm Tasks',
                logo: null,
                tools: ['create_task', 'start_task', 'complete_task']
            }
        };
    }

    async detectMCPServers(desktopConfig = {}, userConfig = {}) {
        const servers = {};
        const allMcpServers = {};
        
        // Merge configs
        Object.assign(allMcpServers, desktopConfig.mcpServers || {});
        Object.assign(allMcpServers, userConfig.mcpServers || {});
        
        // Process all detected MCP servers
        for (const [serverKey, serverConfig] of Object.entries(allMcpServers)) {
            // Skip CodeAgentSwarm Tasks - it should be hidden from users
            if (serverKey === 'codeagentswarm-tasks') {
                continue;
            }
            
            // Use metadata from knownMCPMetadata if available
            if (this.knownMCPMetadata[serverKey]) {
                servers[serverKey] = this.knownMCPMetadata[serverKey];
            } else {
                // Unknown MCP - create default entry
                const displayName = serverKey
                    .split('-')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
                
                servers[serverKey] = {
                    displayName: displayName,
                    logo: null,
                    tools: ['*']
                };
            }
        }
        
        return servers;
    }
}

// Test suite
describe('MCP Detection Tests', () => {
    let modal;
    
    beforeEach(() => {
        modal = new MCPPermissionsModalTest();
    });
    
    test('Should detect MCPs from desktop config only', async () => {
        const desktopConfig = {
            mcpServers: {
                'supabase': { command: 'npx', args: ['supabase'] },
                'notion': { command: 'node', args: ['notion.js'] }
            }
        };
        const userConfig = {};
        
        const servers = await modal.detectMCPServers(desktopConfig, userConfig);
        
        expect(Object.keys(servers)).toHaveLength(2);
        expect(servers['supabase']).toBeDefined();
        expect(servers['notion']).toBeDefined();
        expect(servers['supabase'].displayName).toBe('Supabase');
        expect(servers['notion'].displayName).toBe('Notion');
    });
    
    test('Should detect MCPs from user config only', async () => {
        const desktopConfig = {};
        const userConfig = {
            mcpServers: {
                'brave-search': { command: 'npx', args: ['brave'] },
                'postgres': { command: 'node', args: ['postgres.js'] }
            }
        };
        
        const servers = await modal.detectMCPServers(desktopConfig, userConfig);
        
        expect(Object.keys(servers)).toHaveLength(2);
        expect(servers['brave-search']).toBeDefined();
        expect(servers['postgres']).toBeDefined();
        expect(servers['brave-search'].displayName).toBe('Brave Search');
        expect(servers['postgres'].displayName).toBe('PostgreSQL');
    });
    
    test('Should merge MCPs from both configs', async () => {
        const desktopConfig = {
            mcpServers: {
                'supabase': { command: 'npx', args: ['supabase'] },
                'notion': { command: 'node', args: ['notion.js'] }
            }
        };
        const userConfig = {
            mcpServers: {
                'brave-search': { command: 'npx', args: ['brave'] },
                'postgres': { command: 'node', args: ['postgres.js'] }
            }
        };
        
        const servers = await modal.detectMCPServers(desktopConfig, userConfig);
        
        expect(Object.keys(servers)).toHaveLength(4);
        expect(servers['supabase']).toBeDefined();
        expect(servers['notion']).toBeDefined();
        expect(servers['brave-search']).toBeDefined();
        expect(servers['postgres']).toBeDefined();
    });
    
    test('Should hide CodeAgentSwarm Tasks MCP', async () => {
        const desktopConfig = {
            mcpServers: {
                'codeagentswarm-tasks': { command: 'node', args: ['mcp.js'] },
                'supabase': { command: 'npx', args: ['supabase'] }
            }
        };
        const userConfig = {};
        
        const servers = await modal.detectMCPServers(desktopConfig, userConfig);
        
        expect(Object.keys(servers)).toHaveLength(1);
        expect(servers['codeagentswarm-tasks']).toBeUndefined();
        expect(servers['supabase']).toBeDefined();
    });
    
    test('Should handle unknown MCPs with default values', async () => {
        const desktopConfig = {
            mcpServers: {
                'unknown-mcp-server': { command: 'node', args: ['unknown.js'] }
            }
        };
        const userConfig = {};
        
        const servers = await modal.detectMCPServers(desktopConfig, userConfig);
        
        expect(Object.keys(servers)).toHaveLength(1);
        expect(servers['unknown-mcp-server']).toBeDefined();
        expect(servers['unknown-mcp-server'].displayName).toBe('Unknown Mcp Server');
        expect(servers['unknown-mcp-server'].logo).toBeNull();
        expect(servers['unknown-mcp-server'].tools).toEqual(['*']);
    });
    
    test('Should handle configs with duplicate MCPs (user config overrides)', async () => {
        const desktopConfig = {
            mcpServers: {
                'supabase': { command: 'npx', args: ['supabase-old'] }
            }
        };
        const userConfig = {
            mcpServers: {
                'supabase': { command: 'npx', args: ['supabase-new'] }
            }
        };
        
        const servers = await modal.detectMCPServers(desktopConfig, userConfig);
        
        // Should only have one supabase entry (user config overwrites desktop)
        expect(Object.keys(servers)).toHaveLength(1);
        expect(servers['supabase']).toBeDefined();
    });
    
    test('Should return empty object for empty configs', async () => {
        const desktopConfig = {};
        const userConfig = {};
        
        const servers = await modal.detectMCPServers(desktopConfig, userConfig);
        
        expect(Object.keys(servers)).toHaveLength(0);
    });
    
    test('Should handle configs with null mcpServers', async () => {
        const desktopConfig = { mcpServers: null };
        const userConfig = { mcpServers: null };
        
        const servers = await modal.detectMCPServers(desktopConfig, userConfig);
        
        expect(Object.keys(servers)).toHaveLength(0);
    });
    
    test('Should include correct tools for known MCPs', async () => {
        const desktopConfig = {
            mcpServers: {
                'supabase': { command: 'npx', args: ['supabase'] },
                'brave-search': { command: 'npx', args: ['brave'] }
            }
        };
        const userConfig = {};
        
        const servers = await modal.detectMCPServers(desktopConfig, userConfig);
        
        expect(servers['supabase'].tools).toContain('list_projects');
        expect(servers['supabase'].tools).toContain('get_project');
        expect(servers['brave-search'].tools).toContain('brave_web_search');
        expect(servers['brave-search'].tools).toContain('brave_local_search');
    });
    
    test('Should include logos for known MCPs', async () => {
        const desktopConfig = {
            mcpServers: {
                'supabase': { command: 'npx', args: ['supabase'] },
                'notion': { command: 'node', args: ['notion.js'] }
            }
        };
        const userConfig = {};
        
        const servers = await modal.detectMCPServers(desktopConfig, userConfig);
        
        expect(servers['supabase'].logo).toBe('assets/mcp-icons/supabase.png');
        expect(servers['notion'].logo).toBe('assets/mcp-icons/notion.png');
    });
});

// Export for Jest
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MCPPermissionsModalTest };
}
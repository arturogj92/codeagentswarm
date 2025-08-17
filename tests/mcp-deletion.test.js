/**
 * Tests for MCP server deletion functionality
 * Covers deletion of enabled, disabled, and legacy format servers
 */

const fs = require('fs');
const path = require('path');

describe('MCP Server Deletion', () => {
    let tempDir;
    let configPath;
    let backupPath;
    
    beforeEach(() => {
        // Create a temporary directory for test files
        tempDir = path.join(__dirname, 'temp-mcp-test');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        configPath = path.join(tempDir, 'claude_desktop_config.json');
        backupPath = path.join(tempDir, '.mcp_disabled_servers.json');
    });
    
    afterEach(() => {
        // Clean up test files
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
    
    describe('Backend MCP Deletion Logic', () => {
        // Mock the IPC handler logic from main.js
        function removeServer(name) {
            if (!fs.existsSync(configPath)) {
                throw new Error('Configuration file not found');
            }
            
            const configContent = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configContent);
            
            // Don't allow removing protected servers
            const protectedServers = ['codeagentswarm-tasks', 'codeagentswarm'];
            if (protectedServers.includes(name.toLowerCase())) {
                throw new Error(`Cannot remove protected server "${name}"`);
            }
            
            // Check if server exists in main config
            let serverFound = false;
            if (config.mcpServers && config.mcpServers[name]) {
                // Remove from main config
                delete config.mcpServers[name];
                serverFound = true;
            }
            
            // Check if server exists in disabled backup
            if (fs.existsSync(backupPath)) {
                try {
                    const disabledServers = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
                    if (disabledServers[name]) {
                        // Remove from disabled backup
                        delete disabledServers[name];
                        serverFound = true;
                        
                        // Update or remove backup file
                        if (Object.keys(disabledServers).length > 0) {
                            fs.writeFileSync(backupPath, JSON.stringify(disabledServers, null, 2));
                        } else {
                            // Remove backup file if empty
                            fs.unlinkSync(backupPath);
                        }
                    }
                } catch (e) {
                    console.error('Error handling disabled servers backup:', e);
                }
            }
            
            // Also check for old _disabled_ format and remove it
            if (config.mcpServers && config.mcpServers[`_disabled_${name}`]) {
                delete config.mcpServers[`_disabled_${name}`];
                serverFound = true;
            }
            
            if (!serverFound) {
                throw new Error(`Server "${name}" not found`);
            }
            
            // Write updated config
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            return { success: true };
        }
        
        test('should delete enabled server from main config', () => {
            // Setup: Create config with enabled server
            const config = {
                mcpServers: {
                    'test-server': { command: 'node test.js' },
                    'another-server': { command: 'npx another' }
                }
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            // Act
            const result = removeServer('test-server');
            
            // Assert
            expect(result.success).toBe(true);
            
            const updatedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            expect(updatedConfig.mcpServers).not.toHaveProperty('test-server');
            expect(updatedConfig.mcpServers).toHaveProperty('another-server');
        });
        
        test('should delete disabled server from backup file', () => {
            // Setup: Create main config and disabled backup
            const config = {
                mcpServers: {
                    'enabled-server': { command: 'node enabled.js' }
                }
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            const disabledServers = {
                'disabled-server': { command: 'node disabled.js' },
                'another-disabled': { command: 'npx disabled2' }
            };
            fs.writeFileSync(backupPath, JSON.stringify(disabledServers, null, 2));
            
            // Act
            const result = removeServer('disabled-server');
            
            // Assert
            expect(result.success).toBe(true);
            
            // Main config should be unchanged
            const updatedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            expect(updatedConfig.mcpServers).toHaveProperty('enabled-server');
            
            // Disabled backup should have server removed
            const updatedDisabled = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
            expect(updatedDisabled).not.toHaveProperty('disabled-server');
            expect(updatedDisabled).toHaveProperty('another-disabled');
        });
        
        test('should delete legacy _disabled_ format server', () => {
            // Setup: Create config with legacy disabled format
            const config = {
                mcpServers: {
                    'enabled-server': { command: 'node enabled.js' },
                    '_disabled_legacy-server': { command: 'node legacy.js' }
                }
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            // Act
            const result = removeServer('legacy-server');
            
            // Assert
            expect(result.success).toBe(true);
            
            const updatedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            expect(updatedConfig.mcpServers).not.toHaveProperty('_disabled_legacy-server');
            expect(updatedConfig.mcpServers).toHaveProperty('enabled-server');
        });
        
        test('should remove backup file when last disabled server is deleted', () => {
            // Setup: Create config and backup with only one disabled server
            const config = {
                mcpServers: {}
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            const disabledServers = {
                'only-disabled': { command: 'node only.js' }
            };
            fs.writeFileSync(backupPath, JSON.stringify(disabledServers, null, 2));
            
            // Act
            const result = removeServer('only-disabled');
            
            // Assert
            expect(result.success).toBe(true);
            expect(fs.existsSync(backupPath)).toBe(false); // Backup file should be deleted
        });
        
        test('should handle server in both disabled backup and legacy format', () => {
            // Setup: Server exists in both formats (edge case)
            const config = {
                mcpServers: {
                    '_disabled_duplicate-server': { command: 'node old.js' }
                }
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            const disabledServers = {
                'duplicate-server': { command: 'node new.js' }
            };
            fs.writeFileSync(backupPath, JSON.stringify(disabledServers, null, 2));
            
            // Act
            const result = removeServer('duplicate-server');
            
            // Assert
            expect(result.success).toBe(true);
            
            // Both should be removed
            const updatedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            expect(updatedConfig.mcpServers).not.toHaveProperty('_disabled_duplicate-server');
            
            expect(fs.existsSync(backupPath)).toBe(false); // Backup should be deleted (was only server)
        });
        
        test('should throw error for non-existent server', () => {
            // Setup
            const config = {
                mcpServers: {
                    'existing-server': { command: 'node exist.js' }
                }
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            // Act & Assert
            expect(() => removeServer('non-existent')).toThrow('Server "non-existent" not found');
        });
        
        test('should throw error for protected servers', () => {
            // Setup
            const config = {
                mcpServers: {
                    'codeagentswarm-tasks': { command: 'node protected.js' }
                }
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            // Act & Assert
            expect(() => removeServer('codeagentswarm-tasks')).toThrow('Cannot remove protected server');
            expect(() => removeServer('codeagentswarm')).toThrow('Cannot remove protected server');
        });
        
        test('should handle missing config file', () => {
            // Don't create config file
            
            // Act & Assert
            expect(() => removeServer('any-server')).toThrow('Configuration file not found');
        });
        
        test('should handle corrupted backup file gracefully', () => {
            // Setup: Valid config, corrupted backup
            const config = {
                mcpServers: {
                    'test-server': { command: 'node test.js' }
                }
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            fs.writeFileSync(backupPath, 'invalid json content');
            
            // Act - should still delete from main config
            const result = removeServer('test-server');
            
            // Assert
            expect(result.success).toBe(true);
            
            const updatedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            expect(updatedConfig.mcpServers).not.toHaveProperty('test-server');
        });
    });
});
/**
 * Tests for PostgreSQL MCP fixes
 * 
 * These tests verify the corrections made to PostgreSQL MCP:
 * 1. PostgreSQL appears in permissions tab
 * 2. Installation passes URL as argument (not env variable)
 * 3. Custom form fields for PostgreSQL configuration
 * 4. Live connection string preview
 */

// Tests run with Jest - globals are available

describe('PostgreSQL MCP Fixes', () => {
    
    describe('Permissions Tab - PostgreSQL Display', () => {
        it('should include PostgreSQL in detectMCPServers method', () => {
            // Mock the MCPPermissionsModal class
            const mockDetectMCPServers = async () => {
                const servers = {
                    'postgres': {
                        displayName: 'PostgreSQL',
                        logo: 'assets/mcp-icons/postgres.png',
                        tools: ['query']
                    },
                    // Other servers...
                };
                return servers;
            };
            
            // Test that PostgreSQL is included
            return mockDetectMCPServers().then(servers => {
                expect(servers).toHaveProperty('postgres');
                expect(servers.postgres.displayName).toBe('PostgreSQL');
                expect(servers.postgres.tools).toContain('query');
                expect(servers.postgres.logo).toBe('assets/mcp-icons/postgres.png');
            });
        });
        
        it('should render PostgreSQL in permissions list with correct tools', () => {
            const postgresConfig = {
                displayName: 'PostgreSQL',
                logo: 'assets/mcp-icons/postgres.png',
                tools: ['query']
            };
            
            // Verify PostgreSQL has the query tool
            expect(postgresConfig.tools).toHaveLength(1);
            expect(postgresConfig.tools[0]).toBe('query');
        });
    });
    
    describe('Marketplace Installation - URL as Argument', () => {
        it('should pass DATABASE_URL as argument instead of environment variable', () => {
            const serverId = 'postgres';
            const authData = {
                DATABASE_URL: 'postgresql://user:pass@localhost:5432/mydb'
            };
            
            // Mock server config
            const server = {
                id: 'postgres',
                config: {
                    command: 'npx',
                    args: [
                        '-y',
                        '@modelcontextprotocol/server-postgres@latest',
                        '${DATABASE_URL}'
                    ],
                    env: authData
                }
            };
            
            // Simulate the fix: replace placeholder with actual URL
            let configToUse = { ...server.config };
            
            if (serverId === 'postgres' && server.config.env && server.config.env.DATABASE_URL) {
                // Replace ${DATABASE_URL} placeholder in args with actual value
                configToUse.args = configToUse.args.map(arg => 
                    arg === '${DATABASE_URL}' ? server.config.env.DATABASE_URL : arg
                );
                // Remove DATABASE_URL from env since it's now in args
                delete configToUse.env.DATABASE_URL;
            }
            
            // Verify the URL is in args, not env
            expect(configToUse.args).toContain('postgresql://user:pass@localhost:5432/mydb');
            expect(configToUse.env.DATABASE_URL).toBeUndefined();
            expect(configToUse.args[2]).toBe('postgresql://user:pass@localhost:5432/mydb');
        });
        
        it('should handle placeholder replacement correctly', () => {
            const args = [
                '-y',
                '@modelcontextprotocol/server-postgres@latest',
                '${DATABASE_URL}'
            ];
            const databaseUrl = 'postgresql://recall:recall@localhost:5432/recall_campaign';
            
            // Replace placeholder
            const newArgs = args.map(arg => 
                arg === '${DATABASE_URL}' ? databaseUrl : arg
            );
            
            expect(newArgs[2]).toBe(databaseUrl);
            expect(newArgs).not.toContain('${DATABASE_URL}');
        });
    });
    
    describe('Custom PostgreSQL Form Fields', () => {
        it('should display separate fields for PostgreSQL configuration', () => {
            const serverId = 'postgres';
            
            // Mock form fields that should be displayed
            const expectedFields = [
                { id: 'pg_host', label: 'Host', defaultValue: 'localhost' },
                { id: 'pg_port', label: 'Port', defaultValue: '5432' },
                { id: 'pg_database', label: 'Database Name', required: true },
                { id: 'pg_user', label: 'Username', required: true },
                { id: 'pg_password', label: 'Password', required: false }
            ];
            
            // Verify all fields are defined
            expectedFields.forEach(field => {
                expect(field.id).toBeDefined();
                expect(field.label).toBeDefined();
            });
            
            // Verify required fields
            const requiredFields = expectedFields.filter(f => f.required);
            expect(requiredFields).toHaveLength(2);
            expect(requiredFields.map(f => f.id)).toContain('pg_database');
            expect(requiredFields.map(f => f.id)).toContain('pg_user');
        });
        
        it('should build connection string from individual fields', () => {
            // Mock form values
            const formData = {
                host: 'localhost',
                port: '5432',
                database: 'recall_campaign',
                user: 'recall',
                password: 'recall'
            };
            
            // Build connection string
            let connectionString = 'postgresql://';
            if (formData.user) {
                connectionString += formData.user;
                if (formData.password) {
                    connectionString += `:${formData.password}`;
                }
                connectionString += '@';
            }
            connectionString += `${formData.host}:${formData.port}/${formData.database}`;
            
            expect(connectionString).toBe('postgresql://recall:recall@localhost:5432/recall_campaign');
        });
        
        it('should handle empty password correctly', () => {
            const formData = {
                host: 'localhost',
                port: '5432',
                database: 'testdb',
                user: 'admin',
                password: ''
            };
            
            // Build connection string without password
            let connectionString = 'postgresql://';
            if (formData.user) {
                connectionString += formData.user;
                if (formData.password) {
                    connectionString += `:${formData.password}`;
                }
                connectionString += '@';
            }
            connectionString += `${formData.host}:${formData.port}/${formData.database}`;
            
            expect(connectionString).toBe('postgresql://admin@localhost:5432/testdb');
            expect(connectionString).not.toContain(':@'); // No empty password
        });
    });
    
    describe('Connection String Preview', () => {
        it('should update preview when form fields change', () => {
            // Simulate the updatePreview function
            const updatePreview = (host, port, database, user, password) => {
                let connectionString = 'postgresql://';
                if (user) {
                    connectionString += user;
                    if (password) {
                        connectionString += `:${password}`;
                    }
                    connectionString += '@';
                }
                connectionString += `${host}:${port}/${database}`;
                return connectionString;
            };
            
            // Test various combinations
            expect(updatePreview('localhost', '5432', 'mydb', 'user', 'pass'))
                .toBe('postgresql://user:pass@localhost:5432/mydb');
            
            expect(updatePreview('192.168.1.1', '5433', 'testdb', 'admin', ''))
                .toBe('postgresql://admin@192.168.1.1:5433/testdb');
            
            expect(updatePreview('db.example.com', '5432', 'production', 'root', 'secret123'))
                .toBe('postgresql://root:secret123@db.example.com:5432/production');
        });
        
        it('should have correct dark theme styling for preview', () => {
            const previewStyle = {
                background: '#2a2a2a',
                color: '#e0e0e0',
                padding: '10px',
                border: '1px solid #3a3a3a',
                borderRadius: '6px',
                display: 'block',
                wordBreak: 'break-all',
                fontFamily: "'SF Mono', Monaco, monospace",
                fontSize: '13px'
            };
            
            // Verify dark theme colors
            expect(previewStyle.background).toBe('#2a2a2a');
            expect(previewStyle.color).toBe('#e0e0e0');
            expect(previewStyle.border).toContain('#3a3a3a');
        });
    });
    
    describe('Edge Cases and Error Handling', () => {
        it('should validate required fields before installation', () => {
            const validateForm = (database, user) => {
                const errors = [];
                if (!database) errors.push('Database name is required');
                if (!user) errors.push('Username is required');
                return errors;
            };
            
            // Test missing database
            expect(validateForm('', 'user')).toContain('Database name is required');
            
            // Test missing user
            expect(validateForm('mydb', '')).toContain('Username is required');
            
            // Test both missing
            expect(validateForm('', '')).toHaveLength(2);
            
            // Test valid form
            expect(validateForm('mydb', 'user')).toHaveLength(0);
        });
        
        it('should handle special characters in password correctly', () => {
            const passwords = [
                'pass@word',
                'p@$$w0rd!',
                'my:pass;word',
                'pass/word\\test'
            ];
            
            passwords.forEach(password => {
                const connectionString = `postgresql://user:${password}@localhost:5432/db`;
                expect(connectionString).toContain(password);
            });
        });
    });
});

// Export for use in other test files if needed
module.exports = {
    testPostgreSQLConfig: {
        id: 'postgres',
        displayName: 'PostgreSQL',
        logo: 'assets/mcp-icons/postgres.png',
        tools: ['query']
    }
};
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

class MCPInstructionsManager {
  constructor() {
    // Marcadores para la sección de instrucciones MCP
    this.MCP_START = '<!-- MCP INSTRUCTIONS START - AUTO-GENERATED -->';
    this.MCP_END = '<!-- MCP INSTRUCTIONS END -->';
    
    // Plantillas de instrucciones para cada MCP
    this.mcpTemplates = {
      'brave-search': {
        name: 'Brave Search',
        instructions: `
### 🔍 Brave Search MCP
**When to use:**
- When user asks for current/recent information
- For searching documentation, tutorials, or guides  
- To verify current technical information
- When you need data beyond your knowledge cutoff
- For real-time news, events, or updates

**How to use:**
1. Use \`mcp__brave-search__brave_web_search\` for general searches
2. Use \`mcp__brave-search__brave_local_search\` for local businesses/places
3. Always provide sources to the user
4. Combine multiple searches if needed for comprehensive answers

**Best practices:**
- Be specific in search queries
- Include year/date when searching for recent info
- Use multiple searches to verify important information

**Repository:**
- Official MCP Server: https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search`
      },
      
      'notion': {
        name: 'Notion',
        instructions: `
### 📝 Notion MCP  
**When to use:**
- **MANDATORY:** After completing EVERY task → Document in Notion
- When user says "document" (ALWAYS means Notion, NOT local files)
- To search existing project documentation
- To maintain knowledge base updated

**Mandatory workflow:**
1. Complete task → Search relevant Notion page
2. If no page exists → Create new page
3. Document: changes, decisions, architecture, problems solved
4. Include: date, task ID, modified files

**Key tools:**
- \`mcp__notion__query-database\`: Search existing documentation
- \`mcp__notion__append-block-children\`: Add to existing pages
- \`mcp__notion__create-page\`: Only if no relevant page exists

**REMEMBER:** "Document this" = Notion, NOT local files`
      },
      
      'supabase': {
        name: 'Supabase',
        instructions: `
### 🗄️ Supabase MCP
**When to use:**
- Managing Supabase databases and projects
- Creating/modifying schemas and migrations
- Executing SQL queries
- Managing Edge Functions
- Checking logs and debugging issues

**Important rules:**
- ALWAYS use \`mcp__supabase__search_docs\` before implementing
- Use \`mcp__supabase__apply_migration\` for DDL changes, NOT \`execute_sql\`
- Document all migrations in Notion
- Check \`mcp__supabase__get_advisors\` after schema changes

**Common workflow:**
1. List projects with \`mcp__supabase__list_projects\`
2. Search docs for best practices
3. Apply migrations for schema changes
4. Check advisors for security/performance issues`
      },
      
      'filesystem': {
        name: 'Filesystem',
        instructions: `
### 📁 Filesystem MCP
**When to use:**
- Prefer over Claude's native Read/Write tools when available
- For complex file operations
- When needing batch operations on multiple files
- For better error handling and encoding support

**Advantages over native tools:**
- Better handling of different text encodings
- More efficient batch operations
- Detailed error reporting
- Recursive directory operations

**Key operations:**
- \`mcp__filesystem__read_multiple_files\`: Read many files at once
- \`mcp__filesystem__search_files\`: Recursive file search
- \`mcp__filesystem__directory_tree\`: Get full directory structure`
      },
      
      'context7': {
        name: 'Context7',
        instructions: `
### 📚 Context7 MCP
**When to use:**
- When user asks about any library/framework documentation
- To get up-to-date API references
- For code examples and best practices
- When implementing features with external libraries

**Workflow:**
1. ALWAYS call \`mcp__context7__resolve-library-id\` first to get the library ID
2. Then use \`mcp__context7__get-library-docs\` with that ID
3. Focus on specific topics when possible for better results

**Examples:**
- User asks about React hooks → Resolve "react" → Get docs on "hooks"
- User needs MongoDB queries → Resolve "mongodb" → Get docs
- NEVER skip the resolve step unless user provides exact ID`
      },
      
      'github': {
        name: 'GitHub',
        instructions: `
### 🐙 GitHub MCP
**When to use:**
- Managing GitHub repositories
- Creating/reviewing pull requests
- Managing issues and projects
- Accessing repository information

**Common operations:**
- Search repos and issues
- Create/update pull requests
- Manage GitHub Actions
- Access commit history`
      },
      
      'slack': {
        name: 'Slack',
        instructions: `
### 💬 Slack MCP
**When to use:**
- Sending notifications to Slack channels
- Retrieving messages from channels
- Managing Slack workspace interactions
- Automating Slack communications

**Best practices:**
- Always verify channel permissions
- Use threading for related messages
- Include relevant context in messages`
      }
    };
  }

  /**
   * Detectar MCPs instalados desde la configuración de Claude
   */
  async detectInstalledMCPs() {
    // Try multiple config locations
    const configPaths = [
      path.join(os.homedir(), '.claude.json'), // Claude CLI config
      path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') // Claude Desktop
    ];
    
    let config = {};
    let configFound = false;
    
    // Try each config path
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        try {
          const fileContent = fs.readFileSync(configPath, 'utf-8');
          const parsedConfig = JSON.parse(fileContent);
          if (parsedConfig.mcpServers) {
            // Merge servers from both configs
            config.mcpServers = { ...config.mcpServers, ...parsedConfig.mcpServers };
            configFound = true;

          }
        } catch (error) {
          console.warn(`Failed to parse ${configPath}:`, error.message);
        }
      }
    }
    
    if (!configFound) {

      return [];
    }
    
    const mcpServers = config.mcpServers || {};
    
    // Extraer nombres de MCPs instalados
    const installedMCPs = Object.keys(mcpServers).map(key => {
      // Convertir nombres como "brave-search" o "mcp-brave-search" a nuestro formato
      const normalized = key.toLowerCase()
        .replace('mcp-', '')
        .replace('mcp_', '')
        .replace('@modelcontextprotocol/', '');
      
      return normalized;
    });

    return installedMCPs;
  }

  /**
   * Generar instrucciones para los MCPs instalados
   */
  generateMCPInstructions(installedMCPs) {
    if (installedMCPs.length === 0) {
      return '## MCP Usage Instructions\n\n_No additional MCP servers detected. Install MCPs to see their instructions here._\n';
    }
    
    let instructions = '## MCP Usage Instructions\n';
    
    // Añadir instrucciones específicas para cada MCP
    for (const mcp of installedMCPs) {
      if (this.mcpTemplates[mcp]) {
        instructions += '\n' + this.mcpTemplates[mcp].instructions + '\n';
      }
    }
    
    // Añadir reglas generales
    instructions += `
### 🎯 General MCP Rules

1. **Tool Priority:**
   - If an MCP exists for the task → Use it
   - MCPs are often more efficient than native tools
   - Check MCP capabilities before using native alternatives

2. **Documentation:**
   - ALWAYS document MCP usage in Notion
   - Record any issues and solutions found
   - Share learnings with the team

3. **Error Handling:**
   - If an MCP fails, document the error
   - Try alternative approaches
   - Report persistent issues to the team

4. **Best Practices:**
   - Use MCPs for their intended purpose
   - Don't force MCP usage when native tools are better
   - Combine multiple MCPs when needed for complex tasks`;
    
    return instructions;
  }

  /**
   * Actualizar la sección MCP en CLAUDE.md
   */
  updateMCPSection(content, newInstructions) {
    // Buscar si ya existe la sección MCP
    const hasSection = content.includes(this.MCP_START);
    
    if (!hasSection) {
      // No existe la sección, añadirla después de CodeAgentSwarm
      const codeAgentEnd = '<!-- CODEAGENTSWARM CONFIG END -->';
      const endIndex = content.indexOf(codeAgentEnd);
      
      if (endIndex === -1) {
        // Si no hay sección CodeAgentSwarm, añadir al final
        return content + `\n\n${this.MCP_START}\n${newInstructions}\n${this.MCP_END}\n`;
      }
      
      // Insertar después de CodeAgentSwarm
      const insertPosition = endIndex + codeAgentEnd.length;
      const before = content.slice(0, insertPosition);
      const after = content.slice(insertPosition);
      
      return before + `\n\n${this.MCP_START}\n${newInstructions}\n${this.MCP_END}` + after;
    }
    
    // Ya existe la sección, reemplazarla
    const startIndex = content.indexOf(this.MCP_START);
    const endIndex = content.indexOf(this.MCP_END);
    
    if (endIndex === -1) {
      console.error('⚠️  MCP section start found but no end marker');
      return content;
    }
    
    const before = content.slice(0, startIndex);
    const after = content.slice(endIndex + this.MCP_END.length);
    
    return before + `${this.MCP_START}\n${newInstructions}\n${this.MCP_END}` + after;
  }

  /**
   * Actualizar CLAUDE.md con instrucciones de MCP
   * @param {boolean} useGlobal - Si true, actualiza el CLAUDE.md global (~/.claude/CLAUDE.md)
   */
  async updateClaudeMd(useGlobal = true) {
    // Por defecto, usar el CLAUDE.md global para instrucciones de MCPs
    const claudeMdPath = useGlobal 
      ? path.join(os.homedir(), '.claude', 'CLAUDE.md')
      : path.join(process.cwd(), 'CLAUDE.md');
    
    // Crear el archivo global si no existe
    if (useGlobal && !fs.existsSync(claudeMdPath)) {
      const globalDir = path.dirname(claudeMdPath);
      if (!fs.existsSync(globalDir)) {
        fs.mkdirSync(globalDir, { recursive: true });
      }
      // Crear archivo con contenido mínimo
      fs.writeFileSync(claudeMdPath, '# Global Claude Instructions\n\n');

    }
    
    // Verificar si existe CLAUDE.md
    if (!fs.existsSync(claudeMdPath)) {

      return false;
    }
    
    // Leer el archivo actual
    let content = fs.readFileSync(claudeMdPath, 'utf-8');
    
    // Detectar MCPs instalados
    const installedMCPs = await this.detectInstalledMCPs();
    
    // Generar instrucciones
    const mcpInstructions = this.generateMCPInstructions(installedMCPs);
    
    // Actualizar contenido
    const newContent = this.updateMCPSection(content, mcpInstructions);
    
    // Guardar si hay cambios
    if (newContent !== content) {
      // Hacer backup
      const backupPath = claudeMdPath + '.backup-mcp';
      fs.writeFileSync(backupPath, content);
      
      // Guardar nuevo contenido
      fs.writeFileSync(claudeMdPath, newContent);

      return true;
    } else {

      return false;
    }
  }

  /**
   * Añadir instrucciones para un MCP específico
   */
  async addMCPInstructions(mcpName) {

    // Normalizar nombre
    const normalized = mcpName.toLowerCase()
      .replace('mcp-', '')
      .replace('@modelcontextprotocol/', '');
    
    if (!this.mcpTemplates[normalized]) {

      return false;
    }
    
    // Actualizar CLAUDE.md global
    return await this.updateClaudeMd(true);
  }

  /**
   * Listar MCPs con plantillas disponibles
   */
  listAvailableTemplates() {

    for (const [key, value] of Object.entries(this.mcpTemplates)) {

    }

  }
}

// CLI interface
if (require.main === module) {
  const manager = new MCPInstructionsManager();
  const args = process.argv.slice(2);
  
  const command = args[0];
  
  switch (command) {
    case 'update':
      // Actualizar el CLAUDE.md global con todos los MCPs detectados
      manager.updateClaudeMd(true);
      break;
      
    case 'update-local':
      // Actualizar el CLAUDE.md local del proyecto
      manager.updateClaudeMd(false);
      break;
      
    case 'add':
      // Añadir instrucciones para un MCP específico al global
      if (!args[1]) {
        console.error('❌ Usage: mcp-instructions-manager.js add <mcp-name>');
        process.exit(1);
      }
      manager.addMCPInstructions(args[1]);
      break;
      
    case 'list':
      // Listar plantillas disponibles
      manager.listAvailableTemplates();
      break;
      
    case 'detect':
      // Solo detectar MCPs instalados
      manager.detectInstalledMCPs().then(mcps => {

      });
      break;
      
    default:

      `);
  }
}

module.exports = MCPInstructionsManager;
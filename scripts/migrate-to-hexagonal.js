#!/usr/bin/env node

/**
 * Script de migración para refactorizar la arquitectura
 * Ejecutar con: node scripts/migrate-to-hexagonal.js
 */

const fs = require('fs');
const path = require('path');

class ArchitectureMigrator {
  constructor() {
    this.rootPath = path.join(__dirname, '..');
    this.srcPath = path.join(this.rootPath, 'src');
    this.testsPath = path.join(this.rootPath, 'tests');
  }

  // Mapeo de archivos antiguos a nueva ubicación
  getFileMappings() {
    return {
      // Database and repositories
      'database.js': 'src/infrastructure/repositories/DatabaseConnection.js',
      'database-mcp.js': 'src/infrastructure/adapters/mcp/DatabaseMCPAdapter.js',
      
      // Services
      'git-service.js': 'src/infrastructure/services/GitService.js',
      'logger.js': 'src/infrastructure/services/Logger.js',
      'webhook-server.js': 'src/infrastructure/services/WebhookServer.js',
      
      // MCP modules
      'modules/mcp/MCPManager.js': 'src/core/application/services/MCPManager.js',
      'modules/mcp/MCPValidator.js': 'src/core/domain/services/MCPValidator.js',
      
      // Presentation layer
      'main.js': 'src/presentation/electron/main.js',
      'wizard-window.js': 'src/presentation/electron/windows/WizardWindow.js',
      
      // Tests - Unit tests
      'tests/database.test.js': 'tests/unit/infrastructure/DatabaseConnection.test.js',
      'tests/git-service.test.js': 'tests/unit/infrastructure/GitService.test.js',
      'tests/logger.test.js': 'tests/unit/infrastructure/Logger.test.js',
      
      // Tests - Integration
      'tests/kanban.test.js': 'tests/integration/kanban.test.js',
      'tests/renderer-integration.test.js': 'tests/integration/renderer.test.js',
      
      // Tests - Module tests
      'tests/modules/mcp/MCPManager.test.js': 'tests/unit/core/application/MCPManager.test.js',
      'tests/modules/mcp/MCPValidator.test.js': 'tests/unit/core/domain/MCPValidator.test.js'
    };
  }

  // Crear estructura de carpetas si no existe
  ensureDirectoryExists(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ Created directory: ${dir}`);
    }
  }

  // Copiar archivo con actualización de imports
  copyFileWithUpdatedImports(source, destination) {
    if (!fs.existsSync(source)) {
      console.log(`⚠️  Source file not found: ${source}`);
      return false;
    }

    this.ensureDirectoryExists(destination);

    let content = fs.readFileSync(source, 'utf8');
    
    // Actualizar rutas de require/import
    content = this.updateImportPaths(content, source, destination);

    fs.writeFileSync(destination, content);
    console.log(`📁 Migrated: ${source} → ${destination}`);
    return true;
  }

  // Actualizar rutas de importación
  updateImportPaths(content, sourcePath, destPath) {
    const sourceDepth = sourcePath.split(path.sep).length;
    const destDepth = destPath.split(path.sep).length;
    
    // Mapeo de imports antiguos a nuevos
    const importMappings = {
      './database': '@/infrastructure/repositories/DatabaseConnection',
      '../database': '@/infrastructure/repositories/DatabaseConnection',
      './git-service': '@/infrastructure/services/GitService',
      './logger': '@/infrastructure/services/Logger',
      './modules/mcp/MCPManager': '@/core/application/services/MCPManager'
    };

    // Reemplazar imports
    Object.entries(importMappings).forEach(([oldImport, newImport]) => {
      const regex = new RegExp(`require\\(['"]${oldImport}['"]\\)`, 'g');
      content = content.replace(regex, `require('${newImport}')`);
    });

    return content;
  }

  // Ejecutar migración
  async migrate() {
    console.log('🚀 Starting architecture migration to Hexagonal...\n');

    const mappings = this.getFileMappings();
    let success = 0;
    let failed = 0;

    for (const [source, dest] of Object.entries(mappings)) {
      const sourcePath = path.join(this.rootPath, source);
      const destPath = path.join(this.rootPath, dest);

      if (this.copyFileWithUpdatedImports(sourcePath, destPath)) {
        success++;
      } else {
        failed++;
      }
    }

    console.log(`\n✅ Migration completed!`);
    console.log(`   - Files migrated: ${success}`);
    console.log(`   - Files not found: ${failed}`);
    
    this.generateIndexFiles();
    this.updatePackageJson();
  }

  // Generar archivos index.js para cada módulo
  generateIndexFiles() {
    const modules = [
      'src/core/domain/entities',
      'src/core/application/use-cases',
      'src/core/application/ports',
      'src/infrastructure/repositories',
      'src/infrastructure/adapters',
      'src/infrastructure/services'
    ];

    modules.forEach(module => {
      const modulePath = path.join(this.rootPath, module);
      const indexPath = path.join(modulePath, 'index.js');
      
      if (!fs.existsSync(indexPath) && fs.existsSync(modulePath)) {
        const files = fs.readdirSync(modulePath)
          .filter(file => file.endsWith('.js') && file !== 'index.js');
        
        const exports = files.map(file => {
          const name = path.basename(file, '.js');
          return `  ${name}: require('./${name}')`;
        }).join(',\n');

        const content = `module.exports = {\n${exports}\n};\n`;
        fs.writeFileSync(indexPath, content);
        console.log(`📝 Generated index.js for ${module}`);
      }
    });
  }

  // Actualizar package.json con alias de paths
  updatePackageJson() {
    const packageJsonPath = path.join(this.rootPath, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    // Agregar configuración de jest para alias
    if (!packageJson.jest) {
      packageJson.jest = {};
    }

    packageJson.jest.moduleNameMapper = {
      '^@/(.*)$': '<rootDir>/src/$1',
      '^@core/(.*)$': '<rootDir>/src/core/$1',
      '^@infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1',
      '^@presentation/(.*)$': '<rootDir>/src/presentation/$1'
    };

    // Agregar scripts útiles
    packageJson.scripts = {
      ...packageJson.scripts,
      'test:unit': 'jest tests/unit',
      'test:integration': 'jest tests/integration',
      'test:e2e': 'jest tests/e2e',
      'test:coverage': 'jest --coverage',
      'architecture:check': 'node scripts/check-architecture.js'
    };

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log('📦 Updated package.json with path aliases and scripts');
  }
}

// Ejecutar migración
const migrator = new ArchitectureMigrator();
migrator.migrate().catch(console.error);
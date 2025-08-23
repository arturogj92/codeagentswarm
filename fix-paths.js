#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Path mappings for the new architecture
const pathMappings = [
  // Domain paths - these files moved to src/core/domain/entities/commit/
  {
    from: /require\(['"]\.\.\/\.\.\/domain\/commit\/commit-message['"]\)/g,
    to: "require('../../domain/entities/commit/commit-message')"
  },
  {
    from: /require\(['"]\.\.\/\.\.\/domain\/commit\/commit-repository['"]\)/g,
    to: "require('../../domain/entities/commit/commit-repository')"
  },
  {
    from: /require\(['"]\.\.\/\.\.\/\.\.\/domain\/commit\/commit-message['"]\)/g,
    to: "require('../../../domain/entities/commit/commit-message')"
  },
  {
    from: /require\(['"]\.\.\/\.\.\/\.\.\/domain\/commit\/commit-repository['"]\)/g,
    to: "require('../../../domain/entities/commit/commit-repository')"
  },
  {
    from: /require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/domain\/commit\/commit-message['"]\)/g,
    to: "require('../../../../domain/entities/commit/commit-message')"
  },
  {
    from: /require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/domain\/commit\/commit-repository['"]\)/g,
    to: "require('../../../../domain/entities/commit/commit-repository')"
  },
  {
    from: /require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/domain\/commit\/commit-message['"]\)/g,
    to: "require('../../../../../domain/entities/commit/commit-message')"
  },
  {
    from: /require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/domain\/commit\/commit-repository['"]\)/g,
    to: "require('../../../../../domain/entities/commit/commit-repository')"
  },
  // Application paths
  {
    from: /require\(['"]\.\.\/\.\.\/application\/commit\/generate-commit-use-case['"]\)/g,
    to: "require('../../../core/application/use-cases/commit/generate-commit-use-case')"
  },
  // Old .proxies paths
  {
    from: /require\(['"]\.\/.proxies\/([^'"]+)['"]\)/g,
    to: (match, file) => {
      const mappings = {
        'hooks-manager': './src/infrastructure/hooks/hooks-manager',
        'webhook-server': './src/infrastructure/services/webhook-server',
        'wizard-window': './src/presentation/windows/wizard-window',
        'mcp-instructions-manager': './src/infrastructure/mcp/mcp-instructions-manager',
        'log-viewer': './src/presentation/components/log-viewer',
        'feature-highlight': './src/shared/utils/feature-highlight',
        'markdown-editor': './src/presentation/components/markdown-editor',
        'global-permissions-client-simple': './src/presentation/components/global-permissions-client-simple'
      };
      return `require('${mappings[file] || './.proxies/' + file}')`;
    }
  }
];

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  
  pathMappings.forEach(mapping => {
    const originalContent = content;
    if (typeof mapping.to === 'function') {
      content = content.replace(mapping.from, mapping.to);
    } else {
      content = content.replace(mapping.from, mapping.to);
    }
    if (content !== originalContent) {
      modified = true;
      console.log(`Fixed paths in: ${filePath}`);
    }
  });
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
  
  return modified;
}

function main() {
  console.log('Fixing broken import paths...\n');
  
  // Find all JavaScript files
  const files = glob.sync('**/*.js', {
    cwd: __dirname,
    ignore: ['node_modules/**', 'coverage/**', 'dist/**', 'fix-paths.js'],
    absolute: true
  });
  
  let fixedCount = 0;
  files.forEach(file => {
    if (fixFile(file)) {
      fixedCount++;
    }
  });
  
  console.log(`\n✅ Fixed ${fixedCount} files`);
  
  // Also check for specific problem files
  const problemFiles = [
    'src/infrastructure/adapters/commit/claude-commit-adapter.js',
    'src/infrastructure/adapters/commit/commit-service-factory.js',
    'src/core/application/use-cases/commit/generate-commit-use-case.js',
    'src/infrastructure/services/git-service.js',
    'main.js'
  ];
  
  console.log('\n📋 Checking critical files:');
  problemFiles.forEach(file => {
    const fullPath = path.join(__dirname, file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const hasProxies = content.includes('.proxies');
      const hasBrokenDomain = content.includes('domain/commit/') && !content.includes('domain/entities/commit/');
      
      if (hasProxies || hasBrokenDomain) {
        console.log(`❌ ${file} - Still has issues`);
      } else {
        console.log(`✅ ${file} - OK`);
      }
    } else {
      console.log(`⚠️ ${file} - Not found`);
    }
  });
}

main();
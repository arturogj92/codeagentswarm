const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { createClient } = require('@supabase/supabase-js');

class ChangelogGenerator {
  constructor(supabaseUrl, supabaseKey, deepseekApiKey, githubToken) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.deepseekApiKey = deepseekApiKey;
    this.githubToken = githubToken;
  }

  /**
   * Generate changelog between two versions
   * @param {string} currentVersion - Current version (e.g., "0.0.16")
   * @param {string} previousVersion - Previous version (e.g., "0.0.15")
   * @param {string} owner - GitHub repository owner
   * @param {string} repo - GitHub repository name
   * @returns {Promise<{changelog: string, commitCount: number}>}
   */
  async generateChangelog(currentVersion, previousVersion, owner, repo) {
    try {
      console.log(`Generating changelog from v${previousVersion} to v${currentVersion}...`);

      // Get commits between versions
      const commits = await this.getCommitsBetweenVersions(
        previousVersion, 
        currentVersion, 
        owner, 
        repo
      );

      if (!commits || commits.length === 0) {
        console.log('No commits found between versions, generating default changelog');
        const defaultChangelog = `## Version ${currentVersion} - ${new Date().toISOString().split('T')[0]}

### 🔧 Improvements
- General improvements and optimizations
- Bug fixes and performance enhancements

*Note: Detailed changelog will be available in future releases.*`;
        
        // Save to database even if no commits
        await this.saveChangelog(currentVersion, previousVersion, defaultChangelog, 0);
        
        return {
          changelog: defaultChangelog,
          commitCount: 0
        };
      }

      console.log(`Found ${commits.length} commits`);

      // Generate changelog using DeepSeek
      const changelog = await this.generateChangelogWithAI(
        currentVersion,
        previousVersion,
        commits
      );

      // Save to database
      await this.saveChangelog(currentVersion, previousVersion, changelog, commits.length);

      return {
        changelog,
        commitCount: commits.length
      };
    } catch (error) {
      console.error('Error generating changelog:', error);
      throw error;
    }
  }

  /**
   * Get commits between two version tags from GitHub
   */
  async getCommitsBetweenVersions(fromVersion, toVersion, owner, repo) {
    try {
      console.log(`\n=== FETCHING COMMITS ===`);
      console.log(`From version: v${fromVersion}`);
      console.log(`To version: v${toVersion}`);
      console.log(`Repository: ${owner}/${repo}`);
      
      // If comparing against 0.0.0, get all commits up to the current version
      if (fromVersion === '0.0.0') {
        console.log('First release detected, fetching all commits...');
        const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=v${toVersion}&per_page=100`;
        const response = await fetch(url, {
          headers: {
            'Authorization': `token ${this.githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });

        if (!response.ok) {
          throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const commits = await response.json();
        return commits.map(c => ({
          commit: c.commit,
          sha: c.sha,
          author: c.author,
          committer: c.committer
        }));
      }
      
      // Normal comparison between two tags
      console.log(`Fetching commits using GitHub compare API...`);
      const url = `https://api.github.com/repos/${owner}/${repo}/compare/v${fromVersion}...v${toVersion}`;
      console.log(`API URL: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${this.githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        // If comparison fails, it's likely because toVersion tag doesn't exist yet
        if (response.status === 404) {
          console.log('Tag comparison failed - likely generating changelog for unreleased version');
          console.log(`Getting all commits after v${fromVersion}...`);
          
          try {
            // Get the SHA of the previous version tag
            const prevTagUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs/tags/v${fromVersion}`;
            const prevTagResponse = await fetch(prevTagUrl, {
              headers: {
                'Authorization': `token ${this.githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
              }
            });
            
            if (!prevTagResponse.ok) {
              console.log(`Previous tag v${fromVersion} not found`);
              return [];
            }
            
            const prevTagData = await prevTagResponse.json();
            let tagCommitSha;
            
            // Check if it's an annotated tag or a lightweight tag
            if (prevTagData.object.type === 'tag') {
              // Annotated tag - need to fetch the actual commit
              const tagObjectUrl = `https://api.github.com/repos/${owner}/${repo}/git/tags/${prevTagData.object.sha}`;
              const tagObjectResponse = await fetch(tagObjectUrl, {
                headers: {
                  'Authorization': `token ${this.githubToken}`,
                  'Accept': 'application/vnd.github.v3+json'
                }
              });
              
              if (!tagObjectResponse.ok) {
                console.log('Could not get tag object info');
                return [];
              }
              
              const tagObject = await tagObjectResponse.json();
              tagCommitSha = tagObject.object.sha;
            } else {
              // Lightweight tag - SHA points directly to commit
              tagCommitSha = prevTagData.object.sha;
            }
            
            // Get all commits on the default branch
            const allCommitsUrl = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100`;
            const allCommitsResponse = await fetch(allCommitsUrl, {
              headers: {
                'Authorization': `token ${this.githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
              }
            });
            
            if (!allCommitsResponse.ok) {
              console.log('Could not fetch recent commits');
              return [];
            }
            
            const allCommits = await allCommitsResponse.json();
            
            // Filter commits that come AFTER the previous tag
            const newCommits = [];
            for (const commit of allCommits) {
              // Stop when we reach the previous tag's commit
              if (commit.sha === tagCommitSha) {
                break;
              }
              newCommits.push({
                commit: commit.commit,
                sha: commit.sha,
                author: commit.author,
                committer: commit.committer
              });
            }
            
            console.log(`Found ${newCommits.length} commits since v${fromVersion}`);
            return newCommits;
            
          } catch (error) {
            console.error('Error getting commits after tag:', error.message);
            return [];
          }
        }
        
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const commits = data.commits || [];
      
      console.log(`Found ${commits.length} commits between versions`);
      if (commits.length > 0) {
        console.log('First few commits:');
        commits.slice(0, 3).forEach(c => {
          console.log(`  - ${c.sha.substring(0, 7)}: ${c.commit.message.split('\n')[0]}`);
        });
      }
      
      return commits;
    } catch (error) {
      console.error('Error fetching commits:', error);
      // Return empty array instead of throwing to allow changelog generation to continue
      return [];
    }
  }

  /**
   * Generate changelog using DeepSeek AI (optional for CI/CD)
   * Note: This is used in GitHub Actions, not in the app
   * If DEEPSEEK_API_KEY is not set in GitHub secrets, falls back to simple generation
   */
  async generateChangelogWithAI(currentVersion, previousVersion, commits) {
    // Filter commits to only include user-relevant changes
    const filteredCommits = this.filterUserRelevantCommits(commits);
    
    // If no DeepSeek API key, use simple changelog
    if (!this.deepseekApiKey) {
      console.log('No DeepSeek API key provided, using simple changelog generation');
      console.log('To get better changelogs, add DEEPSEEK_API_KEY to GitHub secrets');
      return this.generateSimpleChangelog(currentVersion, filteredCommits);
    }

    // Prepare commit information for AI (only user-relevant commits)
    const commitInfo = filteredCommits.map(commit => ({
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date
    }));

    const prompt = `You are a technical writer creating a changelog for end users of a software application. 
Generate a professional changelog for version ${currentVersion} based on the following commits since version ${previousVersion}.

IMPORTANT RULES:
1. Group changes by category: ✨ New Features, 🐛 Bug Fixes, 🔧 Improvements, 🎨 UI/UX Updates
2. Write in simple, non-technical language that any user can understand
3. Focus ONLY on changes that directly affect the user experience
4. Explain the benefit or impact of each change from the user's perspective
5. DO NOT include technical details like:
   - Code refactoring or restructuring
   - Test additions or modifications
   - Build system changes
   - Development tool updates
   - Internal architecture changes
6. Use bullet points for each change
7. Be concise and clear
8. Format in Markdown
9. Start with "## Version ${currentVersion} - ${new Date().toISOString().split('T')[0]}"
10. If there are no significant user-facing changes, write a brief summary like "Performance improvements and bug fixes"

Commits:
${JSON.stringify(commitInfo, null, 2)}

Generate the changelog:`;

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.deepseekApiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'You are a user experience writer creating changelogs for end users who are not technical. Focus on benefits and user impact, not technical details.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error calling DeepSeek API:', error);
      // Fallback to simple changelog if AI fails
      return this.generateSimpleChangelog(currentVersion, filteredCommits);
    }
  }

  /**
   * Filter commits to only include user-relevant changes
   */
  filterUserRelevantCommits(commits) {
    // Keywords that indicate technical/internal changes to exclude
    const excludePatterns = [
      /^(test|tests):/i,
      /^(chore|build|ci|perf|refactor|style|docs\(internal\)):/i,
      /^(merge|merged)/i,
      /\b(refactor|restructure|reorganize|cleanup|lint|format)\b/i,
      /\b(test|tests|testing|spec|specs)\b/i,
      /\b(dependency|dependencies|deps|devDependencies)\b/i,
      /\b(webpack|babel|eslint|prettier|tsconfig|gitignore)\b/i,
      /\b(ci\/cd|github.actions|workflow|pipeline)\b/i,
      /\b(readme|documentation)\s+(update|fix|improve)/i,
      /^bump/i,
      /^update.*version/i,
      /\b(console\.log|debug|logging)\b/i
    ];
    
    // Keywords that indicate user-facing changes to include
    const includePatterns = [
      /^(feat|feature|add|new):/i,
      /^fix:/i,
      /^(ui|ux):/i,
      /\b(user|users|customer|customers)\b/i,
      /\b(interface|screen|display|view|page|modal|dialog|menu)\b/i,
      /\b(button|form|input|field|dropdown|checkbox|radio)\b/i,
      /\b(performance|speed|faster|slower|optimize)\b.*\b(app|application|loading)\b/i,
      /\b(crash|crashes|freeze|freezes|hang|hangs)\b/i,
      /\b(error|errors|bug|bugs|issue|issues|problem|problems)\b.*\b(fix|fixed|resolve|resolved)\b/i
    ];
    
    return commits.filter(commit => {
      const message = commit.commit.message.toLowerCase();
      
      // First check if it should be excluded
      for (const pattern of excludePatterns) {
        if (pattern.test(message)) {
          // Check if it also matches an include pattern (include patterns override exclude)
          let shouldInclude = false;
          for (const includePattern of includePatterns) {
            if (includePattern.test(message)) {
              shouldInclude = true;
              break;
            }
          }
          if (!shouldInclude) {
            return false;
          }
        }
      }
      
      return true;
    });
  }
  
  /**
   * Generate a simple changelog without AI
   */
  generateSimpleChangelog(version, commits) {
    const date = new Date().toISOString().split('T')[0];
    let changelog = `## Version ${version} - ${date}\n\n`;
    
    if (commits.length === 0) {
      changelog += '### 🔧 Improvements\n';
      changelog += '- Performance improvements and minor bug fixes\n';
      changelog += '- General stability enhancements\n';
      return changelog;
    }

    const features = [];
    const fixes = [];
    const improvements = [];
    const uiChanges = [];

    commits.forEach(commit => {
      const message = commit.commit.message;
      const lowerMessage = message.toLowerCase();
      
      // Categorize commits and clean up messages for user readability
      if (lowerMessage.includes('feat:') || lowerMessage.includes('feature:') || lowerMessage.includes('add:') || lowerMessage.includes('new:')) {
        const cleanMessage = this.cleanCommitMessage(message);
        if (cleanMessage) features.push(cleanMessage);
      } else if (lowerMessage.includes('fix:') || lowerMessage.includes('bug:')) {
        const cleanMessage = this.cleanCommitMessage(message);
        if (cleanMessage) fixes.push(cleanMessage);
      } else if (lowerMessage.includes('ui:') || lowerMessage.includes('ux:') || lowerMessage.includes('design:')) {
        const cleanMessage = this.cleanCommitMessage(message);
        if (cleanMessage) uiChanges.push(cleanMessage);
      } else {
        const cleanMessage = this.cleanCommitMessage(message);
        if (cleanMessage) improvements.push(cleanMessage);
      }
    });

    if (features.length > 0) {
      changelog += '### ✨ New Features\n';
      features.forEach(feat => changelog += `- ${feat}\n`);
      changelog += '\n';
    }

    if (fixes.length > 0) {
      changelog += '### 🐛 Bug Fixes\n';
      fixes.forEach(fix => changelog += `- ${fix}\n`);
      changelog += '\n';
    }
    
    if (uiChanges.length > 0) {
      changelog += '### 🎨 UI/UX Improvements\n';
      uiChanges.forEach(change => changelog += `- ${change}\n`);
      changelog += '\n';
    }

    if (improvements.length > 0) {
      changelog += '### 🔧 Improvements\n';
      improvements.forEach(change => changelog += `- ${change}\n`);
    }
    
    // If no categorized changes, add a generic message
    if (features.length === 0 && fixes.length === 0 && uiChanges.length === 0 && improvements.length === 0) {
      changelog += '### 🔧 Improvements\n';
      changelog += '- Performance improvements and minor enhancements\n';
    }

    return changelog;
  }
  
  /**
   * Clean up commit messages for user readability
   */
  cleanCommitMessage(message) {
    // Remove conventional commit prefixes
    let cleaned = message
      .replace(/^(feat|feature|fix|chore|docs|style|refactor|perf|test|build|ci|revert|merge)(\([^)]+\))?:\s*/i, '')
      .replace(/^(add|update|remove|delete|modify|change|ui|ux|design):\s*/i, '');
    
    // Take only the first line
    cleaned = cleaned.split('\n')[0];
    
    // Capitalize first letter
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    
    // Remove technical jargon and make more user-friendly
    const replacements = [
      [/\bAPI\b/gi, 'connection'],
      [/\bendpoint\b/gi, 'feature'],
      [/\bUI\b/g, 'interface'],
      [/\bUX\b/g, 'user experience'],
      [/\brefactor\b/gi, 'improve'],
      [/\boptimize performance of\b/gi, 'speed up'],
      [/\boptimize\b/gi, 'improve'],
      [/\bdebug\b/gi, 'fix issue with'],
      [/\bimpl\b/gi, 'add'],
      [/\bconfig\b/gi, 'settings'],
      [/\brepo\b/gi, 'project'],
      [/\bdeps\b/gi, 'components']
    ];
    
    for (const [pattern, replacement] of replacements) {
      cleaned = cleaned.replace(pattern, replacement);
    }
    
    // Remove trailing periods and ensure proper ending
    cleaned = cleaned.replace(/\.+$/, '');
    
    // Filter out messages that are still too technical
    const technicalIndicators = [
      /\b(npm|yarn|pnpm|webpack|babel|eslint|typescript|jest|mocha)\b/i,
      /\b(function|method|class|variable|const|let|var)\b/i,
      /\b(import|export|require|module)\b/i,
      /\b\w+\.(js|ts|jsx|tsx|css|scss|json|yml|yaml)\b/i
    ];
    
    for (const indicator of technicalIndicators) {
      if (indicator.test(cleaned)) {
        return null; // Filter out this message
      }
    }
    
    return cleaned;
  }

  /**
   * Save changelog to Supabase
   */
  async saveChangelog(version, previousVersion, changelog, commitCount) {
    const { data, error } = await this.supabase
      .from('changelogs')
      .upsert({
        version,
        previous_version: previousVersion,
        changelog,
        commit_count: commitCount
      }, {
        onConflict: 'version'
      });

    if (error) {
      console.error('Error saving changelog to database:', error);
      throw error;
    }

    console.log('Changelog saved to database');
    return data;
  }

  /**
   * Get changelog for a specific version
   */
  async getChangelog(version) {
    const { data, error } = await this.supabase
      .from('changelogs')
      .select('*')
      .eq('version', version)
      .single();

    if (error) {
      console.error('Error fetching changelog:', error);
      return null;
    }

    return data;
  }

  /**
   * Get all changelogs between two versions (inclusive)
   */
  async getChangelogsBetweenVersions(fromVersion, toVersion) {
    // Convert version strings to comparable numbers
    const versionToNumber = (v) => {
      const parts = v.split('.').map(n => parseInt(n));
      return parts[0] * 10000 + parts[1] * 100 + parts[2];
    };

    const fromNum = versionToNumber(fromVersion);
    const toNum = versionToNumber(toVersion);

    const { data, error } = await this.supabase
      .from('changelogs')
      .select('*')
      .order('version', { ascending: true });

    if (error) {
      console.error('Error fetching changelogs:', error);
      return [];
    }

    // Filter versions in range
    return data.filter(changelog => {
      const vNum = versionToNumber(changelog.version);
      return vNum > fromNum && vNum <= toNum;
    });
  }
}

// Export for use in GitHub Actions
if (require.main === module) {
  const [,, currentVersion, previousVersion, owner, repo] = process.argv;

  if (!currentVersion || !previousVersion || !owner || !repo) {
    console.error('Usage: node changelog-generator.js <currentVersion> <previousVersion> <owner> <repo>');
    process.exit(1);
  }

  const generator = new ChangelogGenerator(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    process.env.DEEPSEEK_API_KEY,
    process.env.GITHUB_TOKEN
  );

  generator.generateChangelog(currentVersion, previousVersion, owner, repo)
    .then(result => {
      console.log('Changelog generated successfully');
      console.log(result.changelog);
      process.exit(0);
    })
    .catch(error => {
      console.error('Failed to generate changelog:', error);
      process.exit(1);
    });
}

module.exports = ChangelogGenerator;
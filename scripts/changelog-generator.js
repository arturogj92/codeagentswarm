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
      console.log(`Fetching commits between v${fromVersion} and v${toVersion}`);
      
      // If comparing against 0.0.0, get all commits up to the current version
      if (fromVersion === '0.0.0') {
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
      const url = `https://api.github.com/repos/${owner}/${repo}/compare/v${fromVersion}...v${toVersion}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${this.githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        // If comparison fails, try to get recent commits instead
        if (response.status === 404) {
          console.log('Comparison failed, getting recent commits instead');
          const fallbackUrl = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=20`;
          const fallbackResponse = await fetch(fallbackUrl, {
            headers: {
              'Authorization': `token ${this.githubToken}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          });
          
          if (fallbackResponse.ok) {
            const commits = await fallbackResponse.json();
            return commits.map(c => ({
              commit: c.commit,
              sha: c.sha,
              author: c.author,
              committer: c.committer
            }));
          }
        }
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.commits || [];
    } catch (error) {
      console.error('Error fetching commits:', error);
      // Return empty array instead of throwing to allow changelog generation to continue
      return [];
    }
  }

  /**
   * Generate changelog using DeepSeek AI
   */
  async generateChangelogWithAI(currentVersion, previousVersion, commits) {
    // Prepare commit information for AI
    const commitInfo = commits.map(commit => ({
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date
    }));

    const prompt = `You are a technical writer creating a changelog for a software release. 
Generate a professional changelog for version ${currentVersion} based on the following commits since version ${previousVersion}.

IMPORTANT RULES:
1. Group changes by category: ✨ New Features, 🐛 Bug Fixes, 🔧 Improvements, 📚 Documentation, 🔨 Technical Changes
2. Write in user-friendly language, explain the benefit of each change
3. Ignore commits that are just version bumps or merge commits
4. Use bullet points for each change
5. Be concise but informative
6. Format in Markdown
7. Start with "## Version ${currentVersion} - ${new Date().toISOString().split('T')[0]}"
8. If a commit message starts with feat:, fix:, docs:, etc., use that to categorize
9. Focus on changes that affect users, not internal refactoring unless significant

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
              content: 'You are a technical writer specializing in creating clear, informative software changelogs.'
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
      return this.generateSimpleChangelog(currentVersion, commits);
    }
  }

  /**
   * Generate a simple changelog without AI
   */
  generateSimpleChangelog(version, commits) {
    const date = new Date().toISOString().split('T')[0];
    let changelog = `## Version ${version} - ${date}\n\n`;

    const features = [];
    const fixes = [];
    const other = [];

    commits.forEach(commit => {
      const message = commit.commit.message;
      if (message.toLowerCase().includes('feat:') || message.toLowerCase().includes('feature')) {
        features.push(message);
      } else if (message.toLowerCase().includes('fix:') || message.toLowerCase().includes('bug')) {
        fixes.push(message);
      } else {
        other.push(message);
      }
    });

    if (features.length > 0) {
      changelog += '### ✨ New Features\n';
      features.forEach(feat => changelog += `- ${feat.split('\n')[0]}\n`);
      changelog += '\n';
    }

    if (fixes.length > 0) {
      changelog += '### 🐛 Bug Fixes\n';
      fixes.forEach(fix => changelog += `- ${fix.split('\n')[0]}\n`);
      changelog += '\n';
    }

    if (other.length > 0) {
      changelog += '### 🔧 Other Changes\n';
      other.forEach(change => changelog += `- ${change.split('\n')[0]}\n`);
    }

    return changelog;
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
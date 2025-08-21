module.exports = {
  projects: [
    {
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/**/*.test.js'],
      testPathIgnorePatterns: [
        'modal\\.test\\.js$',
        'layout\\.test\\.js$',
        'pagination\\.test\\.js$'
      ],
      roots: ['<rootDir>/tests']
    },
    {
      displayName: 'jsdom',
      testEnvironment: 'jsdom',
      testMatch: [
        '<rootDir>/tests/**/*modal.test.js',
        '<rootDir>/tests/**/*layout.test.js',
        '<rootDir>/tests/**/*pagination.test.js'
      ],
      roots: ['<rootDir>/tests'],
      setupFilesAfterEnv: ['<rootDir>/tests/setup-dom.js']
    }
  ],
  collectCoverageFrom: [
    '*.js',
    '!main.js', // Exclude main process file
    '!preload.js', // Exclude preload script
    '!coverage/**',
    '!tests/**',
    '!node_modules/**'
  ],
  coverageDirectory: 'coverage',
  verbose: true
};
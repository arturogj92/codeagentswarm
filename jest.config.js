module.exports = {
  projects: [
    {
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/**/*(?<!modal)(?<!layout).test.js'],
      roots: ['<rootDir>/tests']
    },
    {
      displayName: 'jsdom',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/tests/**/*@(modal|layout).test.js'],
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
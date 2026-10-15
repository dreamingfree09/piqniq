/**
 * jest.config.js
 *
 * Jest configuration for the Piqniq server.
 *
 * Notes:
 * - Uses Node test environment
 * - Collects coverage for core server folders
 * - Excludes generated files and node_modules
 */
module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['node_modules', '[.]tmp_'],
  coveragePathIgnorePatterns: ['node_modules', '[.]tmp_'],
  setupFiles: ['<rootDir>/test-support/databaseBoundary.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'routes/**/*.js',
    'utils/**/*.js',
    'middleware/**/*.js',
    'config/**/*.js',
    '!config/swagger.js',
    '!**/node_modules/**'
  ],
  testMatch: [
    '**/__tests__/**/*.js',
    '**/*.test.js'
  ],
  verbose: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  testTimeout: 10000
};

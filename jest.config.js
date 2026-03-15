module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', 'ocr-peripheral\\.test\\.js'],
  collectCoverageFrom: [
    'renderer/*.js',
    'shared/*.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  setupFiles: ['<rootDir>/tests/setup.js']
};

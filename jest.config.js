// Tests are compiled by tsc into dist-test/ (esbuild/swc transformers don't emit
// decorator metadata, which Nest DI needs) and run as plain JS.
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/dist-test/test/**/*.test.js'],
  // Explicit so the output (PASS/✓) is identical in any environment: without it
  // Jest 30 may enable the compact agent reporter on its own.
  reporters: ['default'],
  verbose: true,
  maxWorkers: 1, // each worker multiplies containers
  testTimeout: 120000,
};

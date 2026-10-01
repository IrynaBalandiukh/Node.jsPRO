// Тести компілюються tsc у dist-test/ (esbuild/swc-трансформери не емітять
// decorator-метадані, потрібні Nest DI) і запускаються як звичайний JS.
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/dist-test/test/**/*.test.js'],
  // Явно, щоб вивід (PASS/✓) був однаковий у будь-якому середовищі: без цього
  // Jest 30 може сам увімкнути компактний репортер agent.
  reporters: ['default'],
  verbose: true,
  maxWorkers: 1, // кожен воркер множить контейнери
  testTimeout: 120000,
};

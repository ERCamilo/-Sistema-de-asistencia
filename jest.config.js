/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'jsdom',
    setupFiles: ['./jest.setup.js'],
    transform: {
        '^.+\\.js$': 'babel-jest'
    },
    moduleNameMapper: {
        // Mock Firebase SDK initialization (prevents network/config errors in tests)
        // Patterns match both absolute imports (from test files) and relative ones
        // (./IndexedDBService.js inside PersistenceService.js).
        '(^|/)data/firebase\\.js$': '<rootDir>/__mocks__/firebase-data.js',
        '(^|/)FirebaseService\\.js$': '<rootDir>/__mocks__/FirebaseService.js',
        '(^|/)IndexedDBService\\.js$': '<rootDir>/__mocks__/IndexedDBService.js',
        '(^|/)DataService\\.js$': '<rootDir>/__mocks__/DataService.js'
    },
    testMatch: ['**/js/tests/**/*.test.js'],
    testTimeout: 10000,
    verbose: true
};

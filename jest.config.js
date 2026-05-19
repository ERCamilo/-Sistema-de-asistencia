/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'jsdom',
    setupFiles: ['./jest.setup.js'],
    transform: {
        '^.+\\.js$': 'babel-jest'
    },
    moduleNameMapper: {
        // Mock Firebase SDK initialization (evita errores de red/config en tests)
        '^.*/data/firebase\\.js$': '<rootDir>/__mocks__/firebase-data.js',
        // Mock servicios que dependen de Firebase / IndexedDB
        '^.*/services/FirebaseService\\.js$': '<rootDir>/__mocks__/FirebaseService.js',
        '^.*/services/IndexedDBService\\.js$': '<rootDir>/__mocks__/IndexedDBService.js',
        '^.*/services/DataService\\.js$': '<rootDir>/__mocks__/DataService.js'
    },
    testMatch: ['**/js/tests/**/*.test.js'],
    testTimeout: 10000,
    verbose: true
};

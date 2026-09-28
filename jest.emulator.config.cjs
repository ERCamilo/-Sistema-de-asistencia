/**
 * Pruebas de firestore.rules + repositorios reales contra el emulador local de
 * Firestore. No forman parte de `npm test` (ver testPathIgnorePatterns en
 * jest.config.js) porque necesitan Java, el emulador y el SDK web de Firebase,
 * que no son dependencias del repositorio.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8848 \
 *   SA_EMULATOR_NODE_MODULES=/ruta/con/firebase/node_modules \
 *   node node_modules/jest/bin/jest.js -c jest.emulator.config.cjs --runInBand
 *
 * Sin FIRESTORE_EMULATOR_HOST las pruebas se omiten.
 */
const path = require('path');

const extraModules = process.env.SA_EMULATOR_NODE_MODULES
    ? [path.resolve(process.env.SA_EMULATOR_NODE_MODULES)]
    : [];

module.exports = {
    rootDir: __dirname,
    testEnvironment: 'node',
    transform: { '^.+\\.js$': 'babel-jest' },
    moduleNameMapper: {
        '(^|/)data/firebase\\.js$': '<rootDir>/js/tests/emulator/firebase-emulator-shim.js'
    },
    modulePaths: extraModules,
    modulePathIgnorePatterns: ['<rootDir>/\\.claude/'],
    testMatch: ['**/js/tests/emulator/**/*.emulator.test.js'],
    testTimeout: 60000,
    verbose: true
};

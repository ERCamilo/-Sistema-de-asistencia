// Independent, strict policy audit. It intentionally exposes unfinished safeguards.
const base = require('./jest.config.js');
module.exports = {
    ...base,
    testMatch: ['<rootDir>/audit-tests/deletion-safety/**/*.audit.test.js'],
    collectCoverage: false,
    verbose: true
};

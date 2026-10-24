const path=require('node:path');
module.exports={
 rootDir:path.resolve(__dirname,'../..'),testEnvironment:'jsdom',setupFiles:['<rootDir>/qa/multiobra360/fixtures/jest.setup.cjs'],
 transform:{'^.+\\.[cm]?js$':'babel-jest'},
 moduleNameMapper:{
  '^actual/(.*)$':'<rootDir>/js/modules/$1',
  '(^|/)data/firebase\\.js$':'<rootDir>/qa/multiobra360/fixtures/firebase-data.cjs',
  '(^|/)FirebaseService\\.js$':'<rootDir>/qa/multiobra360/fixtures/FirebaseService.cjs',
  '(^|/)IndexedDBService\\.js$':'<rootDir>/qa/multiobra360/fixtures/IndexedDBService.cjs',
  '(^|/)DataService\\.js$':'<rootDir>/qa/multiobra360/fixtures/DataService.cjs'
 },
 testMatch:['**/qa/multiobra360/tests/**/*.test.js'],testPathIgnorePatterns:['/node_modules/','\\.emulator\\.test\\.js$'],
 testTimeout:10000,verbose:true
};

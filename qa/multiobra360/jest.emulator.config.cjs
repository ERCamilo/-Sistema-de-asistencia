const path=require('node:path');
module.exports={rootDir:path.resolve(__dirname,'../..'),testEnvironment:'node',transform:{'^.+\\.[cm]?js$':'babel-jest'},
 moduleNameMapper:{'(^|/)data/firebase\\.js$':'<rootDir>/qa/multiobra360/tests/emulator/firebase-emulator-shim.cjs'},
 modulePaths:process.env.SA_EMULATOR_NODE_MODULES?[path.resolve(process.env.SA_EMULATOR_NODE_MODULES)]:[],
 testMatch:['**/qa/multiobra360/tests/emulator/**/*.emulator.test.js'],testTimeout:60000,verbose:true};

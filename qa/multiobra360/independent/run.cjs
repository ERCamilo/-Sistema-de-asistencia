#!/usr/bin/env node
'use strict';
/**
 * Run only the independent closure challenges (#296-#302).
 * No production credentials, data, or deployed services.
 * The emulator binds to 127.0.0.1 on a dynamically selected port.
 */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const mode = process.argv[2] || '--all';
if (!['--all', '--local', '--emulator'].includes(mode)) {
    console.error('Usage: node qa/multiobra360/independent/run.cjs [--all|--local|--emulator]');
    process.exit(2);
}
const jestBin = path.join(ROOT, 'node_modules/jest/bin/jest.js');
const local = 'qa/multiobra360/tests/independent/ClosureAdversarial20261107.test.js';
const emulatorTest = 'qa/multiobra360/tests/emulator/ClosureAdversarial20261107.emulator.test.js';
let emulator = null;

function exec(args, env = process.env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', code => resolve(code ?? 2));
    });
}
async function allocatePort() {
    const socket = net.createServer();
    await new Promise((resolve, reject) => socket.listen(0, '127.0.0.1', resolve).once('error', reject));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    return port;
}
async function waitForEmulator(port, timeoutMs = 30000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (emulator.exitCode !== null) throw new Error('Firestore emulator exited unexpectedly');
        const connected = await new Promise(resolve => {
            const socket = net.connect({ host: '127.0.0.1', port });
            socket.once('connect', () => { socket.destroy(); resolve(true); });
            socket.once('error', () => { socket.destroy(); resolve(false); });
        });
        if (connected) return;
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Firestore emulator startup timeout');
}
async function stopEmulator() {
    if (!emulator || emulator.exitCode !== null) return;
    const child = emulator;
    child.kill('SIGTERM');
    await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 4000))
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
}
async function main() {
    if (!fs.existsSync(jestBin)) throw new Error('Install npm dependencies first');
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    console.log('Independent closure challenge: application SHA=' + sha);
    if (mode === '--all' || mode === '--local') {
        const rc = await exec([jestBin, '-c', 'qa/multiobra360/jest.config.cjs',
            '--runInBand', '--runTestsByPath', local]);
        if (rc) throw new Error('Local independent closure tests failed: exit=' + rc);
    }
    if (mode === '--all' || mode === '--emulator') {
        const java = process.env.MULTIOBRA_JAVA;
        const jar = process.env.FIRESTORE_EMULATOR_JAR;
        const modules = process.env.SA_EMULATOR_NODE_MODULES;
        if (!java || !jar || !modules || ![java, jar, path.join(modules, 'firebase')].every(fs.existsSync)) {
            throw new Error('Set MULTIOBRA_JAVA (Java 21), FIRESTORE_EMULATOR_JAR and SA_EMULATOR_NODE_MODULES');
        }
        const port = await allocatePort();
        emulator = spawn(java, ['-jar', jar, '--host', '127.0.0.1',
            '--port', String(port), '--project_id', 'demo-sa-multiobra-closure-20261107'
        ], { stdio: ['ignore', 'ignore', 'inherit'] });
        await waitForEmulator(port);
        const env = { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:' + port };
        const rc = await exec([jestBin, '-c', 'qa/multiobra360/jest.emulator.config.cjs',
            '--runInBand', '--runTestsByPath', emulatorTest], env);
        if (rc) throw new Error('Firestore independent closure tests failed: exit=' + rc);
    }
    console.log('PASS independent closure challenge: ' + (mode === '--all' ? '15 tests' : mode));
}
main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
}).finally(async () => {
    await stopEmulator();
});

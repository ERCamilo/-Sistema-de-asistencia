import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const { reportJestResults } = require('../../scripts/report-jest-results.cjs');
const root = path.resolve(__dirname, '../..');

test('expone el nombre y causa de la prueba fallida mediante anotaciones, sin inyectar comandos', () => {
    const write = jest.fn();
    const count = reportJestResults({ numPassedTests: 5, numFailedTests: 1, testResults: [{
        name: path.join(root, 'js/tests/Example.test.js'), status: 'failed', assertionResults: [{
            status: 'failed', fullName: 'P2P espera autenticación', failureMessages: ['\u001b[31mExpected: 1\nReceived: 0\u001b[0m\n::warning::fake%']
        }]
    }] }, { root, write });
    expect(count).toBe(1);
    expect(write.mock.calls[0][0]).toContain('::error file=js/tests/Example.test.js::P2P espera autenticación%0A');
    expect(write.mock.calls[0][0]).toContain('Expected: 1%0AReceived: 0%0A::warning::fake%25');
    expect(write.mock.calls[0][0].split('\n')).toHaveLength(2);
    expect(write.mock.calls[0][0]).not.toContain('\u001b');
});

test('informa fallos de carga de suite y limita la salida; ignora suites aprobadas', () => {
    const write = jest.fn();
    const suites = Array.from({ length: 25 }, () => ({ name: path.join(root, 'js/tests/bad,file.test.js'), status: 'failed', message: 'Module failed' }));
    reportJestResults({ testResults: [...suites, { status: 'passed', message: 'ignored' }] }, { root, write });
    expect(write.mock.calls.filter(([message]) => message.startsWith('::error'))).toHaveLength(20);
    expect(write.mock.calls[0][0]).toContain('bad%2Cfile.test.js');
});

test('CLI conserva el resultado original y escribe un resumen legible sin publicar el JSON en dist', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-report-'));
    try {
        const json = path.join(temp, 'results.json'), summary = path.join(temp, 'summary.md');
        fs.writeFileSync(json, JSON.stringify({ numFailedTests: 1, testResults: [{ status: 'failed', name: path.join(root, 'js/tests/failure.test.js'), message: '<error>' }] }));
        const output = execFileSync(process.execPath, ['scripts/report-jest-results.cjs', json], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });
        expect(output).toContain('::error'); expect(fs.readFileSync(summary, 'utf8')).toContain('&lt;error&gt;');
        const workflow = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8');
        expect(workflow).toContain('npm test -- --json --outputFile="$RUNNER_TEMP/jest-results.json"');
        expect(workflow).not.toMatch(/npm test[^\n]*(\|\| true|continue-on-error)/);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

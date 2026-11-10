#!/usr/bin/env node
// Strict independent audit: a detected policy violation yields exit 1.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.DELETION_AUDIT_OUTPUT || '/tmp/sa-deletion-safety-audit');
fs.mkdirSync(output, { recursive: true });
const resultFile = path.join(output, 'jest-results.json');
// Do not reuse a successful report if Jest fails before producing its output.
fs.rmSync(resultFile, { force: true });
const result = spawnSync(process.execPath, [
    require.resolve('jest/bin/jest'), '--config', 'jest.deletion-safety.config.cjs',
    '--runInBand', '--silent', '--json', '--outputFile', resultFile
], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
fs.writeFileSync(path.join(output, 'execution.log'), (result.stdout || '') + (result.stderr || ''));
if (!fs.existsSync(resultFile)) {
    process.stderr.write(`Audit infrastructure failed: ${result.error?.message || result.stderr || 'No Jest report'}\n`);
    process.exit(2);
}
const data = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
const infrastructureFailed = data.numRuntimeErrorTestSuites > 0 || data.numTotalTests === 0;
const checks = data.testResults.flatMap(suite => suite.assertionResults.map(test => ({
    name: test.fullName, status: test.status,
    file: path.relative(root, suite.name),
    failures: test.failureMessages.map(message => message.replace(/\u001b\[[0-9;]*m/g, ''))
})));
const runtimeFiles = [
    'js/app.js', 'js/modules/services/EmployeesIncomingMerge.js', 'js/modules/services/CatalogIncomingMerge.js',
    'js/modules/services/EmployeeMerge.js', 'js/modules/services/NestedTombstones.js',
    'js/modules/features/attendance/AttendanceMerge.js', 'js/modules/features/pettycash/PettyCashStore.js',
    'js/modules/features/attendance/AttendanceRecordWriter.js', 'js/modules/services/IndexedDBService.js',
    'js/modules/services/PersistenceService.js', 'js/modules/services/IncomingChangeDetector.js',
    'js/modules/services/SyncPauseService.js',
    'js/modules/services/EmployeeRepository.js', 'js/modules/services/PositionRepository.js',
    'js/modules/services/LeaderRepository.js', 'js/modules/services/PettyCashRepository.js'
];
const report = {
    generatedAt: new Date().toISOString(), sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceHashes: Object.fromEntries(runtimeFiles.map(file => [file,
        crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
    testHashes: Object.fromEntries(fs.readdirSync(path.join(root, 'audit-tests/deletion-safety'))
        .filter(file => file.endsWith('.audit.test.js')).sort().map(name => {
            const file = `audit-tests/deletion-safety/${name}`;
            return [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')];
        })),
    seed: '0x5a202611', total: data.numTotalTests, passed: data.numPassedTests,
    failed: data.numFailedTests, pending: data.numPendingTests,
    infrastructureErrors: data.numRuntimeErrorTestSuites,
    verdict: infrastructureFailed ? 'AUDIT_INFRASTRUCTURE_ERROR' : data.success ? 'POLICY_CASES_PASS' : 'POLICY_GAPS_DETECTED', checks
};
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const markdown = [
    '# Auditoría de conservación y borrado explícito', '',
    `Código auditado: \`${report.sourceHead}\`. Semilla: \`${report.seed}\`.`, '',
    `**${report.total} pruebas: ${report.passed} aprobadas, ${report.failed} fallidas, ${report.pending} pendientes.**`, '',
    infrastructureFailed ? '**La ejecución no certifica casos: hay errores de infraestructura.**'
        : 'Las fallas son incumplimientos de la política solicitada; no se convierten en éxitos ni se ocultan con continue-on-error.',
    'Se ejecutan código real de merges, repositorios, callbacks extraídos de app.js e IndexedDB sobre fake-indexeddb.',
    'Firebase está simulado. Esta ejecución no certifica reglas del servidor, concurrencia real entre dispositivos ni recuperación de datos de producción.', '',
    '| Resultado | Caso |', '| --- | --- |',
    ...checks.map(test => `| ${test.status === 'passed' ? 'PASS' : test.status.toUpperCase()} | ${test.name.replace(/\|/g, '\\|')} |`), '',
    'Los hashes de los archivos auditados y los fallos completos están en report.json y execution.log.', ''
].join('\n');
fs.writeFileSync(path.join(output, 'report.md'), markdown);
process.stdout.write(`${report.verdict}: ${report.passed}/${report.total} PASS; ${report.failed} FAIL; ${report.pending} pendientes.\n${path.join(output, 'report.md')}\n`);
process.exitCode = infrastructureFailed ? 2 : result.status || (data.success ? 0 : 1);

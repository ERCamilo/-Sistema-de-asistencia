#!/usr/bin/env node
// GitHub annotations remain readable through the API when log downloads fail.
const fs = require('node:fs');
const path = require('node:path');

const escapeCommand = value => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = value => escapeCommand(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
const plain = value => String(value || '').replace(/\u001b\[[0-9;]*m/g, '');

function reportJestResults(results, { root = process.cwd(), write = text => process.stdout.write(text), summaryFile } = {}) {
    const failures = [];
    for (const suite of results.testResults || []) {
        if (suite.status !== 'failed') continue;
        const relative = path.relative(root, suite.name || '');
        const file = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.replace(/\\/g, '/') : '';
        const assertions = (suite.assertionResults || []).filter(assertion => assertion.status === 'failed');
        if (assertions.length) {
            for (const assertion of assertions) {
                failures.push({ file, message: plain(`${assertion.fullName || assertion.title}\n${(assertion.failureMessages || []).join('\n')}`) });
            }
        } else {
            failures.push({ file, message: plain(suite.message || `La suite ${file || 'de Jest'} no pudo ejecutarse.`) });
        }
    }
    for (const failure of failures.slice(0, 20)) {
        write(`::error${failure.file ? ` file=${escapeProperty(failure.file)}` : ''}::${escapeCommand(failure.message.slice(0, 8000))}\n`);
    }
    const counts = `${results.numPassedTests || 0} aprobadas, ${results.numFailedTests || 0} fallidas, ${results.numPendingTests || 0} omitidas.`;
    write(`Jest: ${counts}\n`);
    if (summaryFile) {
        const details = failures.slice(0, 20).map(failure => `<details><summary>${html(failure.file || 'Suite de Jest')}</summary><pre>${html(failure.message.slice(0, 8000))}</pre></details>`).join('\n');
        fs.appendFileSync(summaryFile, `\n### Resultados de Jest\n\n${counts}\n\n${details}\n`);
    }
    return failures.length;
}

function html(value) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

if (require.main === module) {
    const file = process.argv[2];
    if (!file || !fs.existsSync(file)) {
        // A failed install/checkout can prevent Jest from producing a report.
        console.log('Jest no generó un informe JSON; consulta el paso que falló.');
    } else {
        reportJestResults(JSON.parse(fs.readFileSync(file, 'utf8')), { summaryFile: process.env.GITHUB_STEP_SUMMARY });
    }
}
module.exports = { reportJestResults };

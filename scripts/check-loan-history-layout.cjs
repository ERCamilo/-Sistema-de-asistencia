#!/usr/bin/env node
// Real loan history renderer and CSS; synthetic loans, no user/account data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const names = fs.readFileSync(path.join(ROOT, 'js/modules/data/firebase.js'), 'utf8')
    .match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g, '').split(',').map(name => name.trim()).filter(Boolean);
const firebaseStub = names.map(name => name === 'auth' ? 'export const auth = {currentUser:null};' : `export const ${name} = () => {};`).join('\n');
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Historial de préstamos</title>
<link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/payroll-redesign.css"><link rel="stylesheet" href="/css/loan-account.css">
<style>body{margin:0;padding:12px}main{max-width:960px;margin:auto}.is-portfolio{padding:0}</style></head>
<body><main class="is-portfolio"><h1>Historial de préstamos</h1><div id="history"></div></main><script type="module">
import {stateManager} from '/js/modules/core/AppState.js';
import {renderLoanHistoryPanel,registerLoanHistoryGlobals} from '/js/modules/features/loans/LoanHistoryPanel.js';
stateManager.setState({settings:{payPeriod:{periodStart:'2024-01-01',periodLength:21,payDay:'2024-01-23'}}},{silent:true});
const employees=[{id:'e1',name:'Ana',loans:[{id:'l1',principal:250000.25,interestRate:20,startDate:'2024-01-05',createdAt:100,status:'active',refinancings:[{id:'r1',date:'2025-01-05',interestAmount:20000.15,basis:'balance',createdAt:200}],payments:[{id:'p1',date:'2026-01-10',amount:70000.5,recordedAt:300}]},{id:'l2',principal:10000.75,interestRate:0,startDate:'2026-02-05',createdAt:400,status:'active',refinancings:[],payments:[]}]}];
window.variant='portfolio';window.scope='general';
window.render=()=>{document.getElementById('history').innerHTML=renderLoanHistoryPanel({scope:window.scope,employees,variant:window.variant,defaults:{open:true,range:'Todo',view:'period'}});};
registerLoanHistoryGlobals();
document.addEventListener('click',event=>{const el=event.target.closest('[data-app-fn]');if(el&&!el.disabled)window[el.dataset.appFn]?.(el.dataset.arg,el.dataset.arg2);});
window.render();window.ready=true;
</script></body></html>`;
const oldCss = process.env.LOAN_HISTORY_OLD_CSS;
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://fixture').pathname;
    if (pathname === '/loan-history-fixture') { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
    if (pathname === '/js/modules/data/firebase.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(firebaseStub); return; }
    if (oldCss && pathname === '/css/loan-account.css') { res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync(oldCss)); return; }
    const file = path.resolve(ROOT, '.' + pathname);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, body) => {
        if (error) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream'); res.end(body);
    });
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        const { default: puppeteer } = await import('puppeteer-core');
        browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/loan-history-fixture`);
        await page.waitForFunction(() => window.ready);
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        for (const width of [320, 390, 700, 820, 1440]) {
            await page.setViewport({ width, height: 844 });
            for (const view of ['month', 'period']) {
                await page.click(`[data-app-fn="setLoanHistoryView"][data-arg2="${view}"]`);
                const box = await page.$eval('.lf-bridge__chart', el => {
                    const rect = el.getBoundingClientRect(); const svg = el.querySelector('svg').getBoundingClientRect();
                    return { x: rect.x, right: rect.right, width: rect.width, height: rect.height, svgWidth: svg.width, scrollWidth: el.scrollWidth };
                });
                assert.ok(box.width > 0 && box.height > 150, `chart visible at ${width}, ${view}: ${JSON.stringify(box)}`);
                assert.ok(box.x >= 0 && box.right <= width + 1, `chart region fits at ${width}`);
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no page overflow at ${width}`);
                if (width <= 700) {
                    assert.ok(box.scrollWidth > box.width, 'the chart scrolls instead of shrinking its labels');
                    const panned = await page.$eval('.lf-bridge__chart', el => { el.scrollLeft = 0; const start = el.scrollLeft; el.scrollLeft = -el.scrollWidth; return el.scrollLeft !== start; });
                    assert.ok(panned, 'touch-scrolling region can reach both ends');
                }
                if (view === 'period') {
                    await page.select('.loan-history__nav select', 'history-total');
                    assert.match(await page.$eval('.lf-bridge', el => el.textContent), /Acumulado total/);
                    assert.match(await page.$eval('.lf-bridge', el => el.textContent), /\$260,000.70/);
                    assert.equal(await page.$eval('.loan-history__nav select', el => el.value), 'history-total');
                    const chartBounds = await page.$eval('.lf-bridge__chart', el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right }; });
                    assert.ok(chartBounds.x >= 0 && chartBounds.right <= width + 1, 'total chart fits');
                    const exact = await page.$$('details');
                    await exact[0].$eval('summary', el => el.click());
                    assert.match(await page.$eval('.lf-panel', el => el.textContent), /\$260,001.00/);
                    const violations = await page.evaluate(async () => (await axe.run('#history', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));
                    assert.deepEqual(violations, [], `accessibility at ${width}`);
                    await page.click('[data-app-fn="setLoanHistoryRange"][data-arg2="3M"]');
                    assert.notEqual(await page.$eval('.loan-history__nav select', el => el.value), 'history-total');
                }
            }
        }
        // Employee account reuses the panel without the portfolio styling.
        await page.setViewport({ width: 320, height: 844 });
        await page.evaluate(() => { window.variant = null; window.scope = 'employee-e1'; window.render(); });
        assert.ok(await page.$eval('.lf-bridge__chart', el => el.getBoundingClientRect().height > 150));
        await page.select('.loan-history__nav select', 'history-total');
        assert.match(await page.$eval('.lf-bridge', el => el.textContent), /\$260,000.70/);
        await page.evaluate(() => document.documentElement.style.fontSize = '200%');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no overflow with larger text');
        assert.deepEqual(errors, []);
        console.log('PASS loan history: visible month/period charts, horizontal pan, full-history total, exact values, range reset, employee panel, 5 widths, larger text and WCAG A/AA');
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

#!/usr/bin/env node
// Historical print action and paginated PDF, using fictional frozen records only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const output = process.env.PAYROLL_HISTORY_ARTIFACT_DIR || '/tmp/sa-payroll-history-print';
const styles = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^\"]+)"/g)]
    .map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('');
const names = fs.readFileSync(path.join(ROOT, 'js/modules/data/firebase.js'), 'utf8').match(/export\s*\{([\s\S]*?)\}/)[1]
    .replace(/\/\/[^\n]*/g, '').split(',').map(name => name.trim()).filter(Boolean);
const firebase = names.map(name => name === 'auth' ? 'export const auth={currentUser:null};' : `export const ${name}=()=>{};`).join('\n');
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Historial de prueba</title>${styles}</head><body><main id="screen"></main><script type="module">
import {state,stateManager} from '/js/modules/core/AppState.js';
import * as UI from '/js/modules/features/payroll/PayrollUI.js';
import store from '/js/modules/features/payroll/PayrollClosureStore.js';
import {setProjectsEnabled} from '/js/modules/config/FeatureFlags.js';
const record={id:'cierre-impresion-prueba',status:'closed',periodStart:'2026-11-01',periodEnd:'2026-11-15',closedAt:1794787200000,closedBy:'Operador de prueba',
 rows:Array.from({length:80},(_,i)=>({employeeId:'e'+i,employeeNumber:String(i+1).padStart(3,'0'),employeeName:'Empleado Ejemplo '+(i+1),employeePosition:'Puesto histórico',leaderRefs:[{id:i%2?'B':'A',name:i%2?'Marcos':'Luis'}],gross:1000,bonuses:0,deductions:0,loans:100,net:900})),
 totals:{gross:80000,bonuses:0,deductions:0,loans:8000,net:72000},employeeCount:80,paymentRefs:[]};
window.record=record;window.recordBefore=JSON.stringify(record);window.recordWrites=0;
store.listAll=async()=>[];store.listPage=async()=>({items:[record],nextCursor:null});store.getById=async()=>record;store.getSyncStates=async()=>({[record.id]:'synced'});
store.saveWithEmployees=async()=>{recordWrites++;throw Error('No se permite escribir en esta prueba');};
stateManager.setState({payrollViewMode:'history',employees:[],exportConfig:{...state.exportConfig}},{silent:true});setProjectsEnabled(false);
window.PayrollUI=UI;window.paint=()=>document.getElementById('screen').innerHTML=UI.PayrollTab();
window.notifications=[];window.showNotification=(message,type)=>notifications.push({message,type});
UI.init({state,services:{payroll:{}},render:paint});await UI.loadPayrollHistory({force:true});await UI.openPayrollHistoryDetail(record.id);paint();
const nativeOpen=window.open.bind(window);window.open=(...args)=>{const child=nativeOpen(...args);if(child)child.print=()=>{child.printCalls=(child.printCalls||0)+1;};return child;};
window.ready=true;
</script></body></html>`;
const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://fixture').pathname;
    if (name === '/fixture') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); return; }
    if (name === '/js/modules/data/firebase.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(firebase); return; }
    const file = path.resolve(ROOT, '.' + name);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, body) => {
        if (error) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream'); res.end(body);
    });
});
(async () => {
    fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { default: puppeteer } = await import('puppeteer-core');
    const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        for (const width of [390, 1280]) {
            const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setViewport({ width, height: 844 }); await page.setRequestInterception(true);
            const origin = `http://127.0.0.1:${server.address().port}`;
            page.on('request', req => req.url().startsWith(origin) || req.url() === 'about:blank' ? req.continue() : req.abort());
            await page.goto(origin + '/fixture'); await page.waitForFunction(() => window.ready);
            const button = '[data-payroll-action="print-payroll-history-detail"]';
            assert.equal(await page.$eval(button, node => {
                const b = node.getBoundingClientRect(); return b.height >= 44 && b.left >= 0 && b.right <= innerWidth;
            }), true);
            await page.screenshot({ path: path.join(output, `history-${width}.png`) });
            await page.select('[data-payroll-history-detail-filter="leaderId"]', 'A');
            await page.click('[data-payroll-history-detail-filter="includeLoans"]');
            assert.equal(await page.$eval('tbody .is-net', node => node.textContent), '$1,000.00', 'the screen remains a simulation');
            const popupReady = new Promise(resolve => page.once('popup', resolve));
            await page.click(button); const report = await popupReady;
            await report.waitForFunction(() => window.printCalls === 1);
            assert.equal(await report.evaluate(() => window.opener), null);
            assert.equal(await report.$$eval('tbody tr', rows => rows.length), 40);
            assert.equal(await report.$eval('tbody .is-net', node => node.textContent), '$900.00', 'print uses the recorded net');
            assert.equal(await report.$eval('.payroll-history-detail__totals .is-net strong', node => node.textContent), '$36,000.00');
            assert.equal(await report.$('[data-payroll-action], select, fieldset'), null);
            await report.setViewport({ width: 1122, height: 794 }); await report.emulateMediaType('print');
            assert.equal(await report.$eval('.print-controls', node => getComputedStyle(node).display), 'none');
            assert.equal(await report.$eval('table', node => node.scrollWidth <= document.body.clientWidth), true);
            const pdf = Buffer.from(await report.pdf({ preferCSSPageSize: true }));
            assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
            assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 2, 'long history must paginate');
            fs.writeFileSync(path.join(output, `history-${width}.pdf`), pdf);
            await report.screenshot({ path: path.join(output, `print-${width}.png`) }); await report.close();
            assert.equal(await page.evaluate(() => JSON.stringify(record) === recordBefore && recordWrites === 0), true);
            assert.equal(await page.$eval('tbody .is-net', node => node.textContent), '$1,000.00', 'printing leaves screen filters intact');
            assert.deepEqual(errors, []); await context.close();
            console.log(`PASS ${width}px: delegated print, frozen values, leader filter, simulation separation, multipage PDF, no record writes`);
        }
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });

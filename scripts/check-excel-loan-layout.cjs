#!/usr/bin/env node
// Real ExcelJS round-trip and shipped export modal; fictional data, Firebase disabled.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const output = process.env.EXCEL_LOAN_ARTIFACT_DIR || '/tmp/sa-excel-loan-layout';
const bundle = process.env.EXCELJS_BUNDLE || path.join(output, 'exceljs-4.3.0.min.js');
const styles = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^\"]+)"/g)]
    .map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('');
const names = fs.readFileSync(path.join(ROOT, 'js/modules/data/firebase.js'), 'utf8')
    .match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g, '').split(',').map(name => name.trim()).filter(Boolean);
const firebase = names.map(name => name === 'auth' ? 'export const auth={currentUser:null};' : `export const ${name}=()=>{};`).join('\n');
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exportar posiciones de préstamo</title>${styles}
<style>body{margin:0;background:#0b1320;color:#e5ebf2}</style><script src="/exceljs.js"></script></head><body><main id="screen"></main><script type="module">
import {state,stateManager} from '/js/modules/core/AppState.js';
import * as UI from '/js/modules/features/analytics/AnalyticsUI.js';
import {setProjectsEnabled} from '/js/modules/config/FeatureFlags.js';
import {replaceEntityScope} from '/js/modules/features/projects/EntityProjectScope.js';
setProjectsEnabled(false);replaceEntityScope({enabled:false});
window.AnalyticsUI=UI;window.notifications=[];window.showNotification=(message,type)=>notifications.push({message,type});
UI.init({state,render:()=>{},services:{ensureAttendanceRange:async()=>{}},saveToLocalStorage:()=>{}});
const date='2026-11-15';
stateManager.setState({employeeReportStartDate:date,employeeReportEndDate:date,showExportExcelModal:true,
 settings:{...state.settings,companyName:'Ejemplo',regularHoursPerDay:8,overtimeFactor:1.5,restDayFactor:1.5,holidayFactor:2,holidays:[]},
 excelExportOptions:{loanPositionLayout:'separate',padNumericalGaps:false},
 leaders:[{id:'L1',name:'Luis'},{id:'L2',name:'Marcos'}],
 positions:[{id:'p1',name:'Albañil',leaderId:'L1',hourlyRate:100,active:true,workingDays:[1,2,3,4,5,6]},
 {id:'p2',name:'Electricista',leaderId:'L2',hourlyRate:200,active:true,workingDays:[1,2,3,4,5,6]}],
 employees:[{id:'e',number:'113',name:'Juan',active:true,positions:['p1','p2'],positionAssignments:{p2:{isLoanPosition:true,workLeaderId:'L2',payerLeaderId:'L1'}}}],
 attendance:{['e-'+date]:{employeeId:'e',date,present:true,hoursWorked:8,selectedPosition:'p1',positionHours:[{positionId:'p1',hours:4},{positionId:'p2',hours:4}]}},
 exportConfig:{deductions:[],bonuses:[],payrollLeaderAdjustments:{}}},{silent:true});
document.getElementById('screen').innerHTML=UI.ExcelExportOptionsModal();
URL.createObjectURL=blob=>{window.exportedBlob=blob;return 'blob:fixture';};HTMLAnchorElement.prototype.click=function(){};
const plainNote=note=>typeof note==='string'?note:(note?.texts||[]).map(run=>run.text).join('');
window.checkExport=async(mode,disabled=false)=>{
 UI.setLoanPositionLayout(mode);stateManager.batchSetState(raw=>{raw.exportConfig.payrollLeaderAdjustments=disabled?{[JSON.stringify(['local','legacy',date,date,'L2'])]:false}:{};});
 await UI.exportEmployeeReportExcel();if(!window.exportedBlob)throw new Error(JSON.stringify(notifications));
 const buffer=await exportedBlob.arrayBuffer(),book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
 const rows=name=>{const result=[];book.getWorksheet(name).eachRow(row=>{if(row.getCell(2).value==='Juan')result.push({row:row.number,position:row.getCell(3).value,day:row.getCell(4).value,total:row.getCell(5).value,formula:row.getCell(6).value,
 gross:row.getCell(7).value,net:row.getCell(8).value,adjustment:row.getCell(9).value,note:plainNote(row.getCell(4).note),fill:row.getCell(4).fill});});return result;};
 const charges=[];book.getWorksheet('Líder - Marcos').eachRow(row=>{if(row.getCell(2).value==='Personal pagado por otros líderes')charges.push({adjustment:row.getCell(9).value,balance:row.getCell(10).value});});
 let binary='';for(const byte of new Uint8Array(buffer))binary+=String.fromCharCode(byte);
 return {payer:rows('Líder - Luis'),team:rows('Líder - Marcos'),charges,base64:btoa(binary)};
};window.ready=true;
</script></body></html>`;
const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://fixture').pathname;
    if (name === '/fixture') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); return; }
    if (name === '/js/modules/data/firebase.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(firebase); return; }
    const file = name === '/exceljs.js' ? bundle : path.resolve(ROOT, '.' + name);
    if (name !== '/exceljs.js' && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, body) => {
        if (error) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream'); res.end(body);
    });
});
(async () => {
    fs.mkdirSync(output, { recursive: true });
    if (!fs.existsSync(bundle)) {
        const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js', { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`ExcelJS: HTTP ${response.status}`);
        fs.writeFileSync(bundle, Buffer.from(await response.arrayBuffer()));
    }
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        const { default: puppeteer } = await import('puppeteer-core');
        browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const origin = `http://127.0.0.1:${server.address().port}`;
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith(origin) ? request.continue() : request.abort());
        for (const width of [320, 390, 1280]) {
            await page.setViewport({ width, height: 844 });
            await page.goto(origin + '/fixture'); await page.waitForFunction(() => window.ready);
            const geometry = await page.evaluate(() => {
                const choice = document.querySelector('[data-excel-loan-layout="inline"]');
                const modal = choice.closest('.modal-backdrop').firstElementChild;
                const box = modal.getBoundingClientRect();
                return { left: box.left, right: box.right, bottom: box.bottom, width: innerWidth,
                    first: modal.querySelector('fieldset').querySelector('legend').textContent,
                    overflow: modal.scrollWidth > modal.clientWidth + 1 };
            });
            assert.equal(geometry.first, 'Posiciones de préstamo');
            assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.bottom <= 844, JSON.stringify(geometry));
            assert.equal(geometry.overflow, false);
            await page.click('[data-excel-loan-layout="inline"]');
            assert.equal(await page.$eval('[data-excel-loan-layout="inline"]', el => el.getAttribute('aria-pressed')), 'true');
            assert.equal(await page.evaluate(() => document.activeElement.dataset.excelLoanLayout), 'inline');
            await page.screenshot({ path: path.join(output, `modal-${width}.png`) });
        }
        for (const mode of ['inline', 'separate']) for (const disabled of [false, true]) {
            const result = await page.evaluate((mode, disabled) => window.checkExport(mode, disabled), mode, disabled);
            fs.writeFileSync(path.join(output, `${mode}${disabled ? '-disabled' : ''}.xlsx`), Buffer.from(result.base64, 'base64'));
            assert.equal(result.payer.length, mode === 'inline' ? 1 : 2);
            assert.equal(result.payer.reduce((sum, row) => sum + row.day, 0), 1.5);
            assert.equal(result.payer.reduce((sum, row) => sum + row.gross, 0), 1800);
            assert.equal(result.payer.reduce((sum, row) => sum + (row.net || 0), 0), 1800);
            const debit = result.team[0];
            assert.equal(debit.day, disabled ? 0 : -0.75);
            assert.equal(debit.gross, null); assert.equal(debit.net, null);
            assert.equal(debit.formula.formula, `SUM(D${debit.row}:D${debit.row})`);
            assert.equal(debit.formula.result ?? 0, disabled ? 0 : -0.75);
            assert.deepEqual(result.charges, [{ adjustment: disabled ? 0 : -1200, balance: disabled ? 0 : -1200 }]);
            assert.equal(debit.fill.fgColor.argb, 'FFFFE69A');
            const note = result.payer.map(row => row.note).join('\n');
            assert.ok(note.includes(disabled ? 'Descuento a Marcos desactivado' : 'Se le descuenta a Marcos'));
            assert.ok(!note.includes('Paga:'));
            for (const row of result.payer) assert.equal(row.formula.formula, `SUM(D${row.row}:D${row.row})`);
            if (mode === 'inline') {
                assert.equal(result.payer[0].position, 'Albañil');
                assert.equal(result.payer[0].fill.fgColor.argb, 'FFFFE69A');
                assert.ok(note.includes('Electricista: 4 h') && note.includes('Albañil: 4 h'));
            }
        }
        assert.deepEqual(errors, []);
        console.log(`PASS: modal at 320/390/1280 px; four real ExcelJS files round-tripped. Artifacts: ${output}`);
    } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

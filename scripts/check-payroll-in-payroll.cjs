#!/usr/bin/env node
// Shipped payroll UI and postMessage sender with fictional data and no external requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const output = process.env.PAYROLL_FILTER_ARTIFACT_DIR || '/tmp/sa-payroll-in-payroll';
const styles = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^\"]+)"/g)].map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('');
const names = fs.readFileSync(path.join(ROOT, 'js/modules/data/firebase.js'), 'utf8').match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g, '').split(',').map(name => name.trim()).filter(Boolean);
const firebase = names.map(name => name === 'auth' ? 'export const auth={currentUser:null};' : `export const ${name}=()=>{};`).join('\n');
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nómina por pagador</title>${styles}<style>body{margin:0}main{max-width:1100px;margin:auto}</style></head><body><main id="screen"></main><iframe hidden title="Destino simulado de SplitX"></iframe><script type="module">
import {state,stateManager} from '/js/modules/core/AppState.js';
import * as UI from '/js/modules/features/payroll/PayrollUI.js';
import {ProjectPayrollUIRuntime} from '/js/modules/features/payroll/ProjectPayrollUIRuntime.js';
import {capturePayrollProjectContext} from '/js/modules/features/payroll/PayrollProjectContext.js';
import {setProjectsEnabled} from '/js/modules/config/FeatureFlags.js';
import {replaceEntityScope} from '/js/modules/features/projects/EntityProjectScope.js';
const config={projectId:'P',updatedAt:1,schemaVersion:1,regularHoursPerDay:8,overtimeFactor:1.5,holidayFactor:2,holidays:[],payPeriod:{periodStart:'2026-11-01',periodLength:15,payDay:'2026-11-16'},payrollDefaults:{version:2,bonuses:[],deductions:[]}};
stateManager.setState({settings:{...state.settings,...config},employees:[
 {id:'juan',number:'113',name:'Juan Ejemplo',projectId:'P',active:false,positions:['p1','p2'],positionAssignments:{p2:{isLoanPosition:true,workLeaderId:'L2',payerLeaderId:'L1'}},loans:[]},
 {id:'rosa',number:'114',name:'Rosa Ejemplo',projectId:'P',active:true,positions:['p3'],loans:[]},
 {id:'pedro',number:'115',name:'Pedro Ejemplo',projectId:'P',active:true,positions:['p1'],loans:[]}],
 positions:[{id:'p1',name:'Albañil',projectId:'P',leaderId:'L1',hourlyRate:100,workingDays:[0,1,2,3,4,5,6]},
 {id:'p2',name:'Electricista',projectId:'P',leaderId:'L2',hourlyRate:150,workingDays:[0,1,2,3,4,5,6]},
 {id:'p3',name:'Ayudante',projectId:'P',leaderId:'L2',hourlyRate:50,workingDays:[0,1,2,3,4,5,6]}],
 leaders:[{id:'L1',name:'Luis',active:true,projectId:'P'},{id:'L2',name:'Marcos',active:true,projectId:'P'}],
 attendance:{'juan-2026-11-09':{employeeId:'juan',projectId:'P',date:'2026-11-09',present:true,hoursWorked:8,overtimeHours:2,selectedPosition:'p1',positionHours:[{positionId:'p1',hours:4},{positionId:'p2',hours:4,overtimeHours:2}]},
 'rosa-2026-11-09':{employeeId:'rosa',projectId:'P',date:'2026-11-09',present:true,hoursWorked:8,selectedPosition:'p3'},
 'pedro-2026-11-09':{employeeId:'pedro',projectId:'P',date:'2026-11-09',present:true,hoursWorked:8,selectedPosition:'p1'}},
 exportConfig:{leaderFilter:'all',bonuses:[],deductions:[],rememberedGlobalsHydrated:true},payrollViewMode:'generator'},{silent:true});
setProjectsEnabled(true);replaceEntityScope({enabled:true,projectId:'P',defaultProjectId:'P'});
const runtime=new ProjectPayrollUIRuntime({state,configStore:{getConfig:async()=>config},projectContext:{subscribe:()=>()=>{}},captureContext:s=>capturePayrollProjectContext(s)});
window.PayrollUI=UI;window.paint=()=>document.getElementById('screen').innerHTML=UI.PayrollTab();window.auditState=state;
window.notifications=[];window.showNotification=(message,type)=>notifications.push({message,type});
UI.init({state,services:{payroll:{},payrollRuntime:runtime},render:paint});
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=JSON.parse(text);}}});
window.getExport=async()=>{UI.copyExportJSON();await Promise.resolve();return window.copied;};
window.getMessageExport=()=>{const target=document.querySelector('iframe').contentWindow,messages=[];target.postMessage=payload=>messages.push(payload);window.open=()=>target;
 UI.sendToSplitX();window.dispatchEvent(new MessageEvent('message',{origin:'https://splitx.erlin.do',source:target,data:{type:'SPLITX_READY'}}));
 const payload=messages.find(message=>message.type==='SPLITX_IMPORT_PAYROLL');
 if(payload)window.dispatchEvent(new MessageEvent('message',{origin:'https://splitx.erlin.do',source:target,data:{type:'SPLITX_IMPORT_SUCCESS',transferId:payload.transferId,count:payload.employees.length}}));return payload;};
window.changePeriod=async date=>{await UI.refreshScopedPayrollPreview({periodStart:date,periodEnd:date});UI.setPayrollGuideStep('review');paint();};
await changePeriod('2026-11-09');UI.setLeaderFilter('L1');paint();window.ready=true;
</script></body></html>`;
const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://fixture').pathname;
    if (name === '/fixture') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); return; }
    if (name === '/js/modules/data/firebase.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(firebase); return; }
    const file = path.resolve(ROOT, '.' + name);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, body) => { if (error) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream'); res.end(body); });
});
(async () => {
    fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        const { default: puppeteer } = await import('puppeteer-core');
        browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        for (const width of [320, 390, 1280]) {
            const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setViewport({ width, height: 1000 }); await page.setRequestInterception(true);
            const origin = `http://127.0.0.1:${server.address().port}`;
            page.on('request', request => request.url().startsWith(origin) || request.url() === 'about:blank' ? request.continue() : request.abort());
            await page.goto(origin + '/fixture'); await page.waitForFunction(() => window.ready);
            assert.equal(await page.$eval('[data-value="payroll"]', el => el.getAttribute('aria-pressed')), 'true');
            let exported = await page.evaluate(() => getExport());
            assert.deepEqual(exported.map(row => row.sourceEmployeeId), ['juan', 'pedro']);
            assert.equal(exported[0].monto, 1450); assert.equal(exported[0].workDays.worked, 1);
            assert.equal(exported[0].workDays.overtime, 0.25);
            assert.equal(await page.evaluate(() => auditState.employees.find(employee => employee.id === 'juan').active), false);
            assert.equal(await page.$eval('[data-payroll-total-days]', el => el.textContent), '2');
            const detail = '.payroll-review-table__row:has([data-id="juan"]) .payroll-breakdown-details';
            await page.$eval(detail, el => { el.open = true; });
            assert.match(await page.$eval(detail, el => el.textContent), /Tarifa: \$800\.00\/día/);
            assert.match(await page.$eval(detail, el => el.textContent), /Ordinarios: 0\.5 días/);
            assert.match(await page.$eval(detail, el => el.textContent), /Extra \(x1\.5\): 0\.25 días equiv\./);
            await page.$eval(detail, el => { el.open = false; });
            const before = await page.evaluate(() => JSON.stringify({ attendance: auditState.attendance, employees: auditState.employees }));
            await page.click('[data-payroll-action="toggle-payroll-review-employee"][data-id="juan"]');
            assert.equal(await page.$eval('[data-id="juan"][type="checkbox"]', el => el.checked), false);
            assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'juan');
            assert.equal(await page.$eval('[data-payroll-total-days]', el => el.textContent), '1');
            exported = await page.evaluate(() => getExport());
            assert.deepEqual(exported.map(row => row.sourceEmployeeId), ['pedro']); assert.equal(exported[0].monto, 800);
            assert.equal(exported[0].exportContext.payrollFilter.excludedEmployeeCount, 1);
            const message = await page.evaluate(() => getMessageExport()); assert.deepEqual(message.employees, exported);
            if (width === 390) {
                await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
                const violations = await page.evaluate(async () => (await axe.run('.payroll-review-card', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations
                    .map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) })));
                assert.deepEqual(violations, []);
            }
            fs.writeFileSync(path.join(output, 'splitx-filtered.json'), JSON.stringify(message, null, 2));
            if (process.env.SPLITX_REPO_ROOT) {
                const { createSplitXBridge } = require(path.join(process.env.SPLITX_REPO_ROOT, 'js/SplitXBridge.js'));
                const { createImporter } = require(path.join(process.env.SPLITX_REPO_ROOT, 'js/SplitXImport.js'));
                const sheetFields = require(path.join(process.env.SPLITX_REPO_ROOT, 'js/SplitXSheetFields.js'));
                const { normalizeImportedEmployee } = createImporter({ sheetFields, parseNumber: Number });
                const state = { employees: [] }, replies = [];
                const bridge = createSplitXBridge({ getState: () => state, setState: next => Object.assign(state, next), normalizeEmployee: normalizeImportedEmployee, windowRef: null });
                await bridge.handleMessage({ origin: 'https://asistencia.erlin.do', source: { postMessage: reply => replies.push(reply) }, data: message });
                assert.deepEqual(state.employees.map(employee => employee.sourceEmployeeId), exported.map(employee => employee.sourceEmployeeId));
                assert.deepEqual(state.employees.map(employee => employee.amount), exported.map(employee => employee.monto));
                assert.equal(replies.at(-1).type, 'SPLITX_IMPORT_SUCCESS');
            }
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            await page.screenshot({ path: path.join(output, `payroll-${width}.png`), fullPage: true });
            await page.select('#payroll-scoped-leader-filter', 'L2');
            exported = await page.evaluate(() => getExport()); assert.deepEqual(exported.map(row => row.sourceEmployeeId), ['rosa']);
            assert.match(await page.$eval('.payroll-leader-adjustment', el => el.textContent), /Juan Ejemplo/);
            assert.match(await page.$eval('.payroll-leader-adjustment__balance', el => el.textContent), /−\$650/);
            await page.select('#payroll-scoped-leader-filter', 'L1');
            assert.equal(await page.$eval('[data-id="juan"][type="checkbox"]', el => el.checked), false);
            await page.evaluate(() => changePeriod('2026-11-10'));
            assert.equal(await page.$('.payroll-review-exclusions-reset'), null);
            await page.evaluate(() => changePeriod('2026-11-09'));
            assert.equal(await page.$eval('[data-id="juan"][type="checkbox"]', el => el.checked), false);
            await page.click('[data-payroll-action="reset-payroll-review-exclusions"]');
            assert.equal(await page.$eval('[data-id="juan"][type="checkbox"]', el => el.checked), true);
            assert.equal(await page.evaluate(() => JSON.stringify({ attendance: auditState.attendance, employees: auditState.employees })), before);
            assert.deepEqual(errors, []); await context.close();
            console.log(`PASS ${width}px: payer filter, fractions, extra hours, exclusions/restore, period/leader isolation and SplitX payload parity`);
        }
    } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

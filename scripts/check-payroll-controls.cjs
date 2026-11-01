#!/usr/bin/env node
// Real payroll UI + modal + CSS. Synthetic employees only; all external requests blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const styles = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^\"]+)"/g)]
    .map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('');
const names = fs.readFileSync(path.join(ROOT, 'js/modules/data/firebase.js'), 'utf8')
    .match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g, '').split(',').map(name => name.trim()).filter(Boolean);
const stub = names.map(name => name === 'auth' ? 'export const auth={currentUser:null};' : `export const ${name}=()=>{};`).join('\n');
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Controles de Nómina</title>${styles}
<style>body{margin:0}main{max-width:1100px;margin:auto}</style></head><body><main id="screen"></main><script type="module">
import {state,stateManager} from '/js/modules/core/AppState.js';
import * as UI from '/js/modules/features/payroll/PayrollUI.js';
import {ProjectPayrollUIRuntime} from '/js/modules/features/payroll/ProjectPayrollUIRuntime.js';
import {capturePayrollProjectContext} from '/js/modules/features/payroll/PayrollProjectContext.js';
import {setProjectsEnabled} from '/js/modules/config/FeatureFlags.js';
import {replaceEntityScope} from '/js/modules/features/projects/EntityProjectScope.js';
const employees=Array.from({length:82},(_,i)=>({id:'e'+i,number:String(i+1).padStart(3,'0'),name:'Persona de prueba '+i+(i===0?' con nombre largo para comprobar el ajuste móvil':''),active:i<80,projectId:'P',positions:['p'],bonuses:[],deductions:[],loans:[]}));
const loan={id:'loan',principal:5000,interestRate:10,startDate:'2026-03-01',status:'active',payments:[],refinancings:[]};
employees[0].loans=[loan];employees[81].loans=[{...loan,id:'other-loan'}];
const attendance=Object.fromEntries(employees.filter(e=>e.active).map(e=>[e.id+'-2026-03-05',{employeeId:e.id,projectId:'P',date:'2026-03-05',present:true,hoursWorked:8,overtimeHours:0,selectedPosition:'p'}]));
const config={projectId:'P',updatedAt:1,schemaVersion:1,regularHoursPerDay:8,overtimeFactor:1.5,holidayFactor:2,holidays:[],payPeriod:{periodStart:'2026-03-01',periodLength:15,payDay:'2026-03-15'},payrollDefaults:{version:2,bonuses:[],deductions:[]}};
stateManager.setState({employees,attendance,positions:[{id:'p',projectId:'P',name:'Puesto de prueba con nombre largo',hourlyRate:100,workingDays:[0,1,2,3,4,5,6]}],leaders:[],settings:{...state.settings,...config},exportConfig:{leaderFilter:'all',bonuses:[],deductions:[],rememberedGlobalsHydrated:true},payrollViewMode:'generator'},{silent:true});
setProjectsEnabled(true);replaceEntityScope({enabled:true,projectId:'P',defaultProjectId:'P'});
window.captures=0;const runtime=new ProjectPayrollUIRuntime({state,configStore:{getConfig:async()=>config},projectContext:{subscribe:()=>()=>{}},captureContext:s=>{window.captures++;return capturePayrollProjectContext(s);}});
window.PayrollUI=UI;window.paint=()=>{document.getElementById('screen').innerHTML=UI.PayrollTab();};
UI.init({state,services:{payroll:{},payrollRuntime:runtime},render:window.paint});
window.step=id=>{UI.setPayrollGuideStep(id);window.paint();};window.auditState=state;window.auditRuntime=runtime;window.showNotification=()=>{};
await UI.refreshScopedPayrollPreview({periodStart:'2026-03-01',periodEnd:'2026-03-15'});window.step('deductions');window.ready=true;
</script></body></html>`;
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://fixture').pathname;
    if (pathname === '/fixture') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); return; }
    if (pathname === '/js/modules/data/firebase.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(stub); return; }
    const file = path.resolve(ROOT, '.' + pathname);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, body) => {
        if (error) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
        res.end(body);
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
        await page.setRequestInterception(true);
        page.on('request', request => new URL(request.url()).hostname === '127.0.0.1' ? request.continue() : request.abort());
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewport({ width, height: 844, isMobile: width < 620, hasTouch: width < 620 });
            await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
            await page.waitForFunction(() => window.ready);
            const visibleForm = '.payroll-guide-panel:not([hidden]) .payroll-adjustment-form';
            for (const step of ['deductions', 'bonuses']) {
                await page.evaluate(id => window.step(id), step);
                await page.click(visibleForm + ' label:has(> input[name="scope"][value="employee"])');
                await page.click(visibleForm + ' [data-payroll-action="open-adjustment-employee-picker"]');
                await page.waitForSelector('.payroll-adjustment-picker-modal');
                await page.waitForFunction(() => getComputedStyle(document.querySelector('.payroll-adjustment-picker-modal')).opacity === '1');
                const checkGeometry = async () => page.evaluate(() => {
                    const modal = document.querySelector('.payroll-adjustment-picker-modal');
                    const list = modal.querySelector('[data-adjustment-picker-list]');
                    const box = el => el.getBoundingClientRect();
                    const footer = box(modal.querySelector('.modal-footer'));
                    const listBox = box(list);
                    const rows = [...list.querySelectorAll('[data-adjustment-picker-employee]')];
                    return {
                        footerFits: footer.bottom <= innerHeight + 1 && footer.top >= 0,
                        listFits: listBox.bottom <= footer.top + 1 && listBox.height > 30,
                        rowsFit: rows.every(row => {
                            const bounds = box(row);
                            return [...row.children].every(child => { const c = box(child); return c.top >= bounds.top - 1 && c.bottom <= bounds.bottom + 1 && c.right <= bounds.right + 1; });
                        }),
                        rows: rows.length,
                        noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
                        searchFocused: document.activeElement === modal.querySelector('input[type="search"]')
                    };
                });
                const geometry = await checkGeometry();
                assert.ok(geometry.footerFits && geometry.listFits && geometry.rowsFit && geometry.noOverflow, `${width}/${step}: ${JSON.stringify(geometry)}`);
                assert.equal(geometry.rows, 82);
                if (width === 390 && step === 'deductions') {
                    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
                    const violations = await page.evaluate(async () => (await axe.run('.payroll-adjustment-picker-modal', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, reason: n.failureSummary })) })));
                    assert.deepEqual(violations, []);
                }
                if (width < 620) assert.equal(geometry.searchFocused, false, 'opening on touch must not summon the keyboard');
                await page.evaluate(() => { window.firstPickerRow = document.querySelector('[data-adjustment-picker-employee="e0"]'); });
                await page.click('[data-adjustment-picker-employee="e0"]');
                assert.equal(await page.evaluate(() => window.firstPickerRow === document.querySelector('[data-adjustment-picker-employee="e0"]')), true);
                await page.$eval('[data-adjustment-picker-list]', list => { list.scrollTop = list.scrollHeight; });
                assert.equal(await page.$eval('[data-adjustment-picker-list]', list => list.lastElementChild.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 1), true);
                assert.ok(await page.$('[data-adjustment-picker-employee="e81"] .payroll-status--warning svg'));
                if (width === 390) {
                    await page.setViewport({ width, height: 480, isMobile: true, hasTouch: true });
                    assert.equal((await checkGeometry()).footerFits, true, 'short viewport retains the footer');
                    await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
                }
                if (process.env.PAYROLL_REVIEW_ARTIFACT_DIR && step === 'deductions') {
                    fs.mkdirSync(process.env.PAYROLL_REVIEW_ARTIFACT_DIR, { recursive: true });
                    await page.screenshot({ path: path.join(process.env.PAYROLL_REVIEW_ARTIFACT_DIR, `picker-${width}.png`) });
                }
                await page.click('[data-modal-overlay] [data-button-index="1"]');
                await page.waitForFunction(() => !document.querySelector('[data-modal-overlay]'));
            }
            await page.evaluate(() => window.step('review'));
            const employeeFilter = '[data-payroll-action="toggle-payroll-review-employee-filter"]';
            await page.$eval(employeeFilter, el => el.scrollIntoView({ block: 'center' }));
            await page.click(employeeFilter);
            await page.waitForSelector('.payroll-adjustment-picker-modal');
            await page.click('[data-modal-overlay] [data-button-index="0"]');
            await page.waitForFunction(() => !document.querySelector('[data-modal-overlay]'));
            assert.equal(await page.$eval(employeeFilter, el => el.checked), false, 'cancel keeps the full payroll view');
            await page.click(employeeFilter);
            await page.waitForSelector('.payroll-adjustment-picker-modal');
            await page.click('[data-adjustment-picker-employee="e0"]');
            await page.click('[data-adjustment-picker-employee="e1"]');
            await page.click('[data-modal-overlay] [data-button-index="1"]');
            await page.waitForFunction(() => !document.querySelector('[data-modal-overlay]'));
            assert.equal((await page.$$('.payroll-review-table__row')).length, 2, 'only the chosen staff appear');
            assert.equal(await page.$eval('[data-payroll-action="open-payroll-closure"]', el => el.disabled), true);
            await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
            assert.deepEqual(await page.evaluate(async () => (await axe.run('.payroll-review-employees', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => v.id)), []);
            assert.ok(await page.$eval('.payroll-review-employees', el => {
                const box = el.getBoundingClientRect();
                return box.left >= 0 && box.right <= innerWidth && el.scrollWidth <= el.clientWidth;
            }), `employee control fits at ${width}`);
            if (process.env.PAYROLL_REVIEW_ARTIFACT_DIR) {
                await page.$eval('.payroll-review-employees', el => el.scrollIntoView({ block: 'center' }));
                await page.screenshot({ path: path.join(process.env.PAYROLL_REVIEW_ARTIFACT_DIR, `selected-employees-${width}.png`) });
            }
            await page.$eval(employeeFilter, el => el.scrollIntoView({ block: 'center' }));
            await page.click(employeeFilter);
            assert.equal((await page.$$('.payroll-review-table__row')).length, 80, 'clearing the checkbox restores all paid staff');
            await page.evaluate(() => window.step('loans'));
            const group = 'details[data-employee-id="e0"]';
            await page.$eval(group, el => { el.open = true; });
            await page.$eval(group + ' [data-mode="all"]', el => el.scrollIntoView({block:'center'}));
            await page.click(group + ' [data-mode="all"]');
            assert.equal(await page.$eval(group + ' [data-payroll-loan-custom-amount]', el => Number(el.value)), 5500, `all-mode amount at ${width}: ${await page.evaluate(()=>JSON.stringify(window.auditState.exportConfig.payrollLoanSelection))}`);
            assert.equal(await page.$eval(group + ' input[type="number"]', el => Number(el.value)), 687.5);
            assert.equal(await page.$eval(group + ' input[type="range"]', el => Number(el.value)), 100);
            assert.ok(await page.$(group + ' .payroll-status--error svg'));
            assert.equal(await page.$eval(group, el => getComputedStyle(el).outlineStyle), 'none');
            await page.click(group + ' [data-mode="interest"]');
            assert.equal(await page.$eval(group + ' input[type="number"]', el => Number(el.value)), 62.5);
            const money = group + ' [data-payroll-loan-custom-amount]';
            await page.$eval(money, el => { el.value = '200,50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
            assert.equal(await page.$eval(group + ' input[type="number"]', el => Number(el.value)), 25.0625);
            await page.$eval(money, el => el.dispatchEvent(new Event('change', { bubbles: true })));
            const preview = await page.$eval(group + ' input[type="range"]', el => {
                window.captures = 0;
                for (let value = 30; value <= 50; value++) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
                return { captures: window.captures, money: el.closest('.payroll-loan-mode').querySelector('[data-payroll-loan-custom-amount]').value };
            });
            assert.deepEqual(preview, { captures: 0, money: '400.00' });
            await page.$eval(group + ' input[type="range"]', el => el.dispatchEvent(new Event('change', { bubbles: true })));
            assert.equal(await page.evaluate(() => window.auditState.exportConfig.payrollLoanSelection.find(item => item.employeeId === 'e0').amount), 400);
            await page.click(group + ' [data-kind="percentage"]');
            assert.equal(await page.$eval(group + ' input[type="number"]', el => Number(el.value)), 30);
            if (width === 390) {
                const slider = await page.$(group + ' input[type="range"]');
                await slider.evaluate(el => el.scrollIntoView({ block: 'center' }));
                const bounds = await slider.boundingBox();
                const y = bounds.y + bounds.height / 2;
                await page.mouse.move(bounds.x + 8 + (bounds.width - 16) * 0.3, y);
                await page.mouse.down();
                await page.mouse.move(bounds.x + 8 + (bounds.width - 16) * 0.6, y, { steps: 8 });
                await page.mouse.up();
                const amount = await page.evaluate(() => window.auditState.exportConfig.payrollLoanSelection.find(item => item.employeeId === 'e0').amount);
                assert.ok(amount > 240 && amount < 800, 'native drag commits an intermediate amount without an Apply button');
                assert.equal(await page.$eval(money, el => Number(el.value)), amount);
            }
            await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
            const violations = await page.evaluate(async () => (await axe.run('.payroll-loan-amount-controls', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => v.id));
            assert.deepEqual(violations, []);
            assert.ok(await page.$eval('.payroll-loan-percentage', el => el.getBoundingClientRect().height <= 50), 'percentage control stays compact');
            const bulk = '[data-payroll-action="set-payroll-loans-salary-bulk"]';
            for (const [kind, expected, zero] of [['available', 800, 1], ['recommended', 240, 0]]) {
                await page.$eval(`${bulk}[data-kind="${kind}"]`, el => el.scrollIntoView({ block: 'center' }));
                await page.click(`${bulk}[data-kind="${kind}"]`);
                assert.equal(await page.evaluate(() => window.auditState.exportConfig.payrollLoanSelection.find(item => item.employeeId === 'e0').amount), expected);
                const summary = await page.$eval('.payroll-loans-warning-summary', el => ({ text: el.textContent, icons: el.querySelectorAll('svg').length }));
                assert.ok(summary.text.includes(`${zero} en cero tras cobro`));
                assert.ok(summary.text.includes('2 con deuda pendiente'));
                assert.ok(summary.icons >= 3, 'all summary warnings include an SVG, including zero salary');
            }
            const layout = await page.$$eval('.payroll-loans-toolbar button', buttons => ({
                fit: buttons.every(button => {
                    const box = button.getBoundingClientRect();
                    return box.left >= 0 && box.right <= innerWidth && box.height >= 44 && button.scrollWidth <= button.clientWidth;
                }),
                noOverflow: document.documentElement.scrollWidth <= innerWidth + 1
            }));
            assert.ok(layout.fit && layout.noOverflow, `bulk buttons fit at ${width}: ${JSON.stringify(layout)}`);
            const summaryViolations = await page.evaluate(async () => (await axe.run('.payroll-loans-metrics, .payroll-loans-toolbar', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.failureSummary) })));
            assert.deepEqual(summaryViolations, []);
            if (process.env.PAYROLL_REVIEW_ARTIFACT_DIR) {
                await page.$eval('.payroll-loans-desktop', el => el.scrollIntoView({ block: 'start' }));
                await page.screenshot({ path: path.join(process.env.PAYROLL_REVIEW_ARTIFACT_DIR, `bulk-${width}.png`) });
            }
            if (process.env.PAYROLL_REVIEW_ARTIFACT_DIR) await page.screenshot({ path: path.join(process.env.PAYROLL_REVIEW_ARTIFACT_DIR, `loans-${width}.png`), fullPage: true });
        }
        assert.deepEqual(errors, []);
        console.log('PASS payroll: mobile rows/footer/short viewport, selected-employee report and closure guard, SVG statuses, synchronized amount/percentage, bulk maximum/30% and warning counts, no capture during drag, four widths and WCAG A/AA');
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

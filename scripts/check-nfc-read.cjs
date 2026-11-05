#!/usr/bin/env node
// Real shipped modal and CSS, simulated NFC events. Physical cards need Android.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const output = process.env.NFC_TEST_ARTIFACT_DIR || '/tmp/sa-nfc-test';
const names = fs.readFileSync(path.join(ROOT, 'js/modules/data/firebase.js'), 'utf8').match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g, '').split(',').map(n => n.trim()).filter(Boolean);
const firebaseStub = names.map(name => name === 'auth' ? 'export const auth={currentUser:null};' : `export const ${name}=()=>{};`).join('\n');
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba NFC</title><link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/settings.css"><link rel="stylesheet" href="/css/personnel.css"><link rel="stylesheet" href="/css/nfc-test.css"></head><body style="background:#0b1320;color:#f4f6fa;font-family:system-ui"><main id="entry"></main><div id="editor"></div><script type="module">
import {NfcReadTest,SettingsNfcReadTestCard} from '/js/modules/ui/settings/NfcReadTest.js';
import {NfcIntegration} from '/js/modules/features/nfc/NfcIntegration.js';
import {NfcSettingsFields} from '/js/modules/features/nfc/NfcViews.js';
import {DOMDiff} from '/js/modules/utils/DOMDiff.js';
import {EmployeeModal} from '/js/modules/ui/modals/EmployeeModal.js';
import * as EmployeesUI from '/js/modules/features/employees/EmployeesUI.js';
import {state,stateManager} from '/js/modules/core/AppState.js';
stateManager.batchSetState(raw=>{raw.employees=[{id:'e1',key:'e1',number:'001',name:'Juan Pérez',active:true,positions:['job'],hireDate:'2026-01-01'}];raw.positions=[{id:'job',name:'Puesto',hourlyRate:100,active:true}];raw.leaders=[];raw.attendance={};Object.assign(raw.settings,{regularHoursPerDay:8,overtimeFactor:1,holidayFactor:2,holidays:[],payPeriod:{},projectsEnabled:false});});
localStorage.removeItem('sa-nfc-preferences:v1:local-device');
const draw=()=>DOMDiff.apply(document.querySelector('#entry'),SettingsNfcReadTestCard(NfcSettingsFields()));

window.fixtureEnv={isSecureContext:window.isSecureContext,NDEFReader:class{constructor(){window.lastReader=this}async scan({signal}){this.signal=signal}},navigator:{clipboard:{writeText:async text=>{window.copied=text}}}};
window.nfcTest=new NfcReadTest({env:fixtureEnv}).mount();
window.nfcIntegration=new NfcIntegration({getScope:()=>({enabled:false}),getEmployees:()=>state.employees,getCompanyName:()=> 'Empresa ficticia',render:draw,notify:message=>{window.notice=message}}, {reader:nfcTest}).mount();
draw();
EmployeesUI.init({state,render:()=>{},saveToLocalStorage:()=>{},services:{}});
EmployeeModal.open('e1',{inlineHost:document.querySelector('#editor')});
document.querySelector('[data-settings-action=test-nfc-read]').addEventListener('click',()=>nfcTest.open());
window.emitCard=serial=>lastReader.onreading({serialNumber:serial,message:{records:[{recordType:'text',data:'not exported'}]}});
window.ready=true;
</script></body></html>`;
(async () => {
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://fixture').pathname;
        if(pathname==='/js/modules/data/firebase.js'){res.setHeader('Content-Type','text/javascript');res.end(firebaseStub);return;}
        if (pathname === '/nfc-fixture') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); return; }
        const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname));
        if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
        fs.readFile(file, (error, data) => {
            if (error) { res.writeHead(404).end(); return; }
            res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream'); res.end(data);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        const { default: puppeteer } = await import('puppeteer-core');
        browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage(); const errors = []; const outgoing = []; const calls = []; const registry = new Map(); let failRegister = false;
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (new URL(request.url()).hostname === '127.0.0.1' || /^(data|blob):/.test(request.url())) request.continue();
            else if (new URL(request.url()).hostname === 'n8n.erlin.do') {
                const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
                if(request.method()==='OPTIONS'){request.respond({status:204,headers});return;}
                const data=JSON.parse(request.postData());calls.push({url:request.url(),data});
                assert.equal(request.headers().authorization,undefined);assert.equal(data.context.ownerUid,undefined);
                const key=data.cardUid;
                const saved=registry.get(key);
                let result={ok:true,schemaVersion:1,requestId:data.requestId,cardUid:data.cardUid,employeeId:saved?.employeeId || null,status:saved?(saved.employeeId===data.employee.id?'mismo_empleado':'otro_empleado'):'disponible'};
                if(data.action==='asociar'){
                    const row=saved || {employeeId:data.employee.id,registeredAt:'2026-10-27T18:00:00Z'};
                    registry.set(key,row);result={...result,...row,status:saved?'mismo_empleado':'registrada'};
                    if(failRegister){failRegister=false;request.respond({status:500,headers,body:'{}'});return;}
                }
                request.respond({status:200,headers,body:JSON.stringify(result)});
            } else { outgoing.push(request.url()); request.abort(); }
        });
        fs.mkdirSync(output, { recursive: true });
        for (const width of [320, 390, 768, 1440]) {
            calls.length=0;registry.clear();
            await page.setViewport({ width, height: 740 });
            await page.goto(`http://127.0.0.1:${server.address().port}/nfc-fixture`); await page.waitForFunction('window.ready');
            assert.equal(await page.evaluate(()=>typeof nfcIntegration.adapter.getUser),'undefined');
            const consistentNfcIcon = await page.evaluate(() => {
                const icon = document.querySelector('[data-settings-action="test-nfc-read"] [data-icon="nfc"]');
                return !!icon && icon.getAttribute('aria-hidden') === 'true' && icon.querySelectorAll('path').length === 4;
            });
            assert.ok(consistentNfcIcon, 'Settings must show the standard decorative NFC icon');
            await page.click('[data-settings-action=test-nfc-read]');
            assert.ok(await page.$('dialog.nfc-test-dialog header [data-icon="nfc"]'), 'Reader header shares the NFC icon');
            await page.click('[data-nfc-test=start]');
            assert.equal(await page.evaluate(() => nfcTest.reading), true);
            await page.evaluate(() => emitCard('04:00:ab:cd:ef:12:34'));
            assert.equal(await page.$eval('[data-nfc-test=uid]', node => node.textContent), '0400ABCDEF1234');
            assert.equal(await page.evaluate(() => lastReader.signal.aborted), true);
            const layout = await page.evaluate(() => {
                const box = nfcTest.dialog.getBoundingClientRect();
                const buttons = [...nfcTest.dialog.querySelectorAll('button:not([hidden])')].map(button => {
                    const rect = button.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
                });
                return { left: box.left, right: box.right, bottom: box.bottom, top: box.top, overflow: nfcTest.dialog.scrollWidth > nfcTest.dialog.clientWidth, buttons };
            });
            assert.ok(layout.left >= 0 && layout.right <= width && layout.top >= 0 && layout.bottom <= 740, JSON.stringify(layout));
            assert.equal(layout.overflow, false);
            for (const button of layout.buttons) assert.ok(button.width >= 44 && button.height >= 44 && button.right <= width && button.bottom <= 740, JSON.stringify(button));
            await page.click('[data-nfc-test=copy]'); await page.waitForFunction('window.copied');
            assert.equal(JSON.parse(await page.evaluate(() => copied)).uid, '0400ABCDEF1234');
            await page.screenshot({ path: path.join(output, `nfc-read-${width}.png`) });
            await page.click('[data-nfc-test=start]'); await page.click('[data-nfc-test=stop]');
            assert.equal(await page.evaluate(() => lastReader.signal.aborted), true);
            await page.click('[data-nfc-test=start]'); await page.click('[data-nfc-test=close]');
            assert.equal(await page.evaluate(() => lastReader.signal.aborted && !nfcTest.dialog.open), true);
            await page.evaluate(() => { window.savedReaderClass=fixtureEnv.NDEFReader; delete fixtureEnv.NDEFReader; nfcTest.open(); });
            assert.equal(await page.$eval('[data-nfc-test=start]', button => button.disabled), true);
            await page.screenshot({ path: path.join(output, `nfc-unsupported-${width}.png`) });
            await page.evaluate(() => {nfcTest.close();fixtureEnv.NDEFReader=savedReaderClass;});
            assert.equal(await page.$('[data-nfc-employee]'),null);
            await page.click('.nfc-settings-fields .stg-switch-row');
            await page.waitForSelector('[data-nfc-employee]');
            assert.ok(await page.$('[data-nfc-employee] [data-icon="nfc"]'), 'Employee action shares the NFC icon');
            await page.$eval('#empName',input=>{input.value='Borrador sin guardar';input.dispatchEvent(new Event('input',{bubbles:true}));});
            await page.click('[data-nfc-employee]');
            await page.click('[data-nfc-test=start]');await page.evaluate(()=>emitCard('04:00:ab:cd:ef:12:34'));
            await page.waitForFunction('!nfcIntegration.busy && nfcIntegration.result?.status === "disponible"');
            assert.equal(calls.length,1);assert.equal(calls[0].data.employee.name,'Juan Pérez');
            const enrollment=await page.evaluate(()=>{const d=nfcTest.dialog;const r=d.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,overflow:d.scrollWidth>d.clientWidth,buttons:[...d.querySelectorAll('button:not([hidden])')].map(b=>{const x=b.getBoundingClientRect();return {width:x.width,height:x.height,bottom:x.bottom}})}});
            assert.ok(enrollment.left>=0 && enrollment.right<=width && enrollment.bottom<=740 && !enrollment.overflow,JSON.stringify(enrollment));
            for(const b of enrollment.buttons)assert.ok(b.width>=44 && b.height>=44 && b.bottom<=740,JSON.stringify(b));
            await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
            const accessibility=await page.evaluate(async()=>{
                const report=await axe.run(nfcTest.dialog,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
                return report.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));
            });
            assert.deepEqual(accessibility,[],'NFC dialog accessibility');
            await page.screenshot({path:path.join(output,`nfc-enrollment-${width}.png`)});
            failRegister=true;await page.click('[data-nfc-test=register]');
            await page.waitForFunction('!nfcIntegration.busy && !!nfcIntegration.pending');
            assert.ok(await page.$eval('[data-nfc-test=enrollment]',n=>n.textContent.includes('Puede haberse guardado')));
            await page.click('[data-nfc-test=retry]');
            await page.waitForFunction('!nfcIntegration.busy && nfcIntegration.result?.status === "mismo_empleado"');
            assert.equal(calls.length,3);assert.deepEqual(calls[1].data,calls[2].data);assert.equal(registry.size,1);
            // Issue #328: each feedback state is rendered by the actual NFC modal and a mocked correlated webhook.
            // A previously associated UID must be recognized through a fresh lookup, not a repeated save.
            await page.screenshot({path:path.join(output,`nfc-same-after-retry-${width}.png`)});
            await page.click('[data-nfc-test=close]');
            assert.equal(await page.$eval('#empName',n=>n.value),'Borrador sin guardar');

            const startEnrollment = async (uid, expected) => {
                await page.click('[data-nfc-employee]');
                await page.click('[data-nfc-test=start]');
                await page.evaluate(value => emitCard(value), uid);
                await page.waitForFunction(status => !nfcIntegration.busy && nfcIntegration.result?.status === status, {}, expected);
            };
            const checkFeedback = async (tone, title, canSave) => {
                const feedback = await page.evaluate(() => {
                    const el=nfcTest.dialog.querySelector('.nfc-feedback');
                    if (!el) return null;
                    const b=el.getBoundingClientRect(), d=nfcTest.dialog.getBoundingClientRect();
                    const svg=el.querySelector('svg');
                    const styles=getComputedStyle(el);
                    return {className:el.className, text:el.textContent, title:el.querySelector('strong')?.textContent,
                        live:el.getAttribute('aria-live'), atomic:el.getAttribute('aria-atomic'),
                        svgHidden:svg?.getAttribute('aria-hidden'), svgPath:svg?.children.length,
                        x:b.x, right:b.right, dialogRight:d.right, overflow:el.scrollWidth>el.clientWidth,
                        background:styles.backgroundColor, border:styles.borderTopColor};
                });
                assert.ok(feedback, 'Visible feedback required');
                assert.ok(feedback.className.includes('nfc-feedback--'+tone), JSON.stringify(feedback));
                assert.equal(feedback.title,title);
                assert.equal(feedback.live,'polite');
                assert.equal(feedback.atomic,'true');
                assert.equal(feedback.svgHidden,'true');
                assert.ok(feedback.svgPath>0);
                assert.ok(feedback.x>=0 && feedback.right<=width && feedback.right<=feedback.dialogRight+1 && !feedback.overflow,JSON.stringify(feedback));
                assert.equal(await page.$eval('[data-nfc-test=register]',b=>!b.hidden && !b.disabled),canSave);
                const axeReport=await page.evaluate(async()=> (await axe.run(nfcTest.dialog,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
                assert.deepEqual(axeReport,[],title+' accessibility');
                return feedback;
            };

            // Successful association is only possible after a valid server registration response.
            await startEnrollment('04:00:ab:cd:ef:23:45','disponible');
            assert.equal(await page.$eval('.nfc-feedback--available strong',n=>n.textContent),'Tarjeta disponible');
            await page.click('[data-nfc-test=register]');
            await page.waitForFunction('!nfcIntegration.busy && nfcIntegration.result?.status === "registrada"');
            const success = await checkFeedback('success','Tarjeta asociada correctamente',false);
            assert.ok(success.text.includes('Juan Pérez') && success.text.includes('001'));
            await page.screenshot({path:path.join(output,`nfc-confirmed-${width}.png`)});
            await page.click('[data-nfc-test=close]');

            // Existing association, same employee: informative state, never submit again.
            const callsBeforeSame=calls.length;
            await startEnrollment('04:00:ab:cd:ef:23:45','mismo_empleado');
            const same = await checkFeedback('notice','Esta tarjeta ya está asociada a este empleado',false);
            assert.ok(same.text.includes('No es necesario volver a guardarla'));
            assert.equal(calls.length,callsBeforeSame+1);
            await page.screenshot({path:path.join(output,`nfc-same-owner-${width}.png`)});
            await page.click('[data-nfc-test=close]');

            // Occupied by another employee: do not expose that employee's identity or allow a save.
            registry.set('0400ABCDEF3456',{employeeId:'e2',registeredAt:'2026-10-27T18:00:00Z'});
            const callsBeforeConflict=calls.length;
            await startEnrollment('04:00:ab:cd:ef:34:56','otro_empleado');
            const conflict=await checkFeedback('warning','Esta tarjeta ya está asociada a otro empleado',false);
            assert.ok(conflict.text.includes('No se puede guardar esta asociación'));
            assert.ok(!conflict.text.includes('e2') && !conflict.text.includes('Dos'));
            assert.equal(calls.length,callsBeforeConflict+1);
            await page.screenshot({path:path.join(output,`nfc-other-owner-${width}.png`)});
            await page.click('[data-nfc-test=close]');
            assert.equal(await page.$eval('#empName',n=>n.value),'Borrador sin guardar');
            await page.select('[data-nfc-setting=mode]','production');
            assert.ok(await page.$eval('.nfc-endpoint',n=>n.textContent.includes('/webhook/')));
            await page.select('[data-nfc-setting=mode]','custom');
            await page.type('[data-nfc-setting=customUrl]','https://custom.example.test/nfc');
            await page.click('[data-nfc-setting-action=save-url]');
            assert.ok(await page.$eval('.nfc-endpoint',n=>n.textContent.includes('https://custom.example.test/nfc')));
            assert.equal(calls.length,7);
            await page.screenshot({path:path.join(output,`nfc-settings-${width}.png`)});
            await page.click('.nfc-settings-fields .stg-switch-row');
            assert.equal(await page.$('[data-nfc-employee]'),null);
            assert.equal(await page.$eval('#empName',n=>n.value),'Borrador sin guardar');

        }
        assert.deepEqual(errors, []); assert.deepEqual(outgoing, []);
        console.log('✓ NFC: 320/390/768/1440px, real employee editor, all four visual feedback states, aria and axe, no redundant/occupied saves, lookup/register/retry with stable ID and preserved draft. NFC and webhook responses simulated; no external requests.');
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

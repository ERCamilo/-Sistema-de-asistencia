#!/usr/bin/env node
/**
 * Real Chromium layout checks for the shipped Settings components and CSS.
 * Uses synthetic data and local modules; no account or external API is used.
 * CHROMIUM_PATH=/usr/bin/chromium npm run test:settings-layout
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const styles = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)]
    .map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('');
const names = fs.readFileSync(path.join(ROOT, 'js/modules/data/firebase.js'), 'utf8')
    .match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g, '').split(',').map(name => name.trim()).filter(Boolean);
const firebaseStub = names.map(name => name === 'auth' ? 'export const auth = {currentUser:null};' : `export const ${name} = () => {};`).join('\n');
const appSource = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const saveStart = appSource.indexOf('window.saveSettings = function');
const saveEnd = appSource.indexOf('\n};', saveStart) + 3;
const saveHandler = appSource.slice(saveStart, saveEnd).replace('window.saveSettings = ', '').replace(/;\s*$/, '');
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head>
<body class="has-sidebar"><main class="main-content"><div class="container"><div id="screen"></div></div></main><nav class="bottom-nav" aria-label="Navegación de prueba">Navegación inferior</nav>
<script type="module">
import {SettingsTab,initSettingsUI,reconcileSettingsDraftBeforeSave} from '/js/modules/ui/SettingsUI.js';
import {state,stateManager} from '/js/modules/core/AppState.js';
import {DOMDiff} from '/js/modules/utils/DOMDiff.js';
import {clearSettingsFormErrors,refreshSettingsFormErrors,showSettingsFieldError,showSettingsFormError} from '/js/modules/ui/settings/SettingsFormFeedback.js';
import {refreshSettingsDraftBar,discardSettingsDraft,captureSettingsDraft,restoreSettingsDraft,guardSettingsDraftBeforeSave} from '/js/modules/ui/settings/SettingsDraftBar.js';
import {HolidayService} from '/js/modules/features/attendance/HolidayService.js';
import {StorageCard,SyncCard,attachSettingsDiagnostics,refreshDeviceSettingsDiagnostics,getSettingsSyncStatus} from '/js/modules/ui/settings/SettingsDiagnostics.js';
import {SyncStatus} from '/js/modules/services/SyncStatus.js';
stateManager.batchSetState(raw=>{raw.activeTab='settings';Object.assign(raw.settings,{companyName:'Empresa de prueba',regularHoursPerDay:8,overtimeFactor:1.5,holidayFactor:2,restDayFactor:1.5,defaultDeductionPercentage:0,holidays:[],payPeriod:{payDay:'2026-10-14'},holidays:['2026-10-13']});raw.snapshots=[{id:'manual',type:'manual',createdAt:Date.now(),employeeCount:1,attendanceCount:2,userNote:'Copia de prueba'},{id:'protected',type:'pre-restore',createdAt:Date.now(),employeeCount:1,attendanceCount:2}];raw.settingsCalendarMonth=new Date(2026,9,1);});
const context={state,icons:{get:()=>'',getAvailableSets:()=>['unicode']},holidayService:new HolidayService(state)};
// Synthetic device-local records. Genuine browser IndexedDB and Blob measurements.
const seed=async(name,rows)=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>Object.keys(rows).forEach(store=>request.result.createObjectStore(store,{autoIncrement:true}));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(rows),'readwrite');for(const [store,records] of Object.entries(rows)) records.forEach(record=>tx.objectStore(store).add(record));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
};
await seed('attendance-app-db',{employeePhotos:[{optimizedBlob:new Blob([new Uint8Array(6*1024*1024)]),thumbnailBlob:new Blob([new Uint8Array(1024)])}],mainSyncOutbox:[{status:'pending'}],pettyCashOutbox:[{status:'pending'}],pettyCashMirrorOutbox:[{status:'dead'}]});
await seed('sa-voice-mvp-v1',{recordings:[{uid:'test-a',audio:new Blob([new Uint8Array(1024*1024)])}]});
localStorage.setItem('sa.devMode.v1','1');
initSettingsUI(context);
window.fixtureSyncStatus=SyncStatus;
window.fixtureSetUser=async(user)=>{context.currentUser=user;await refreshDeviceSettingsDiagnostics();};
window.fixtureRefresh=refreshDeviceSettingsDiagnostics;
window.enableExperiments=()=>stateManager.batchSetState(raw=>{raw.settings.newReceiptCamera=true;raw.settings.newBottomNav=true;raw.settings.voiceMvpEnabled=true;raw.settings.weatherEnabled=true;});
window.draw=tab=>{clearSettingsFormErrors();discardSettingsDraft({});state.settingsActiveTab=tab;document.getElementById('screen').innerHTML=SettingsTab();refreshSettingsDraftBar();};
window.changeSettingsTab=tab=>window.draw(tab);
window.fixtureRender=()=>{const draft=captureSettingsDraft();DOMDiff.patchSelf(document.getElementById('settings-screen'),SettingsTab());restoreSettingsDraft(draft);refreshSettingsFormErrors();refreshSettingsDraftBar();};
window.saveCalls=0;
const deps={state,document,isProjectsEnabled:()=>false,payrollUIRuntime:{},showNotification:()=>{},saveApplicationData:()=>window.saveCalls++,render:window.fixtureRender,stateManager,updateWeatherApiKeyProvider:()=>{},guardSettingsDraftBeforeSave,reconcileSettingsDraftBeforeSave,clearSettingsFormErrors,showSettingsFieldError,showSettingsFormError,logError:()=>{}};
window.saveSettings=new Function(...Object.keys(deps),'return ('+${JSON.stringify(saveHandler)}+');')(...Object.values(deps));
window.draw('general');await refreshDeviceSettingsDiagnostics();window.ready=true;
</script></body></html>`;

(async () => {
    const server=http.createServer((req,res)=>{
        const pathname=new URL(req.url,'http://fixture').pathname;
        if(pathname==='/settings-fixture') {res.setHeader('Content-Type','text/html');res.end(fixture);return;}
        if(pathname==='/js/modules/data/firebase.js'){res.setHeader('Content-Type','text/javascript');res.end(firebaseStub);return;}
        const file=path.resolve(ROOT,'.'+decodeURIComponent(pathname));
        if(!file.startsWith(ROOT+path.sep)) {res.writeHead(403).end();return;}
        fs.readFile(file,(error,body)=>{
            if(error){res.writeHead(404).end();return;}
            res.setHeader('Content-Type', {'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'}[path.extname(file)]||'application/octet-stream');res.end(body);
        });
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    let browser;
    try {
        const {default:puppeteer}=await import('puppeteer-core');
        browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
        const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request',request=>new URL(request.url()).hostname==='127.0.0.1'?request.continue():request.abort());
        await page.goto(`http://127.0.0.1:${server.address().port}/settings-fixture`);
        await page.waitForFunction(()=>window.ready);
        await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
        await page.evaluate(async()=>{window.draw('data');await window.fixtureRefresh();});
        assert.equal(await page.$eval('#settings-device-status',el=>el.open),false);
        await page.click('#settings-device-status > summary');
        assert.equal(await page.$eval('#settings-device-status',el=>el.open),true);
        const summary=await page.$eval('[data-settings-storage-summary]',el=>el.textContent);
        assert.ok(!summary.includes('Fotos de empleados')&&!summary.includes('LocalStorage:'));
        await page.waitForSelector('[data-settings-storage-section]');
        const deviceStats=await page.$eval('[data-settings-storage-section] [data-settings-storage-card]',el=>el.textContent);
        assert.ok(deviceStats.includes('6.00 MB (1)'),`Fotos reales: ${deviceStats}`);
        assert.ok(deviceStats.includes('1.00 MB (1)'),`Audios reales: ${deviceStats}`);
        assert.ok(!deviceStats.includes('5MB'),`Sin cuota inventada: ${deviceStats}`);
        assert.equal(await page.$eval('[data-settings-sync-card] .stg-value',el=>el.textContent),'Sin sesión');
        await page.evaluate(()=>window.fixtureSetUser({uid:'test-a',email:'ana@example.invalid'}));
        assert.equal(await page.$eval('[data-settings-sync-card] .stg-value',el=>el.textContent),'Error de sincronización');
        assert.ok((await page.$eval('[data-settings-sync-card]',el=>el.textContent)).includes('2 pendientes · 1 con error'));
        await page.setOfflineMode(true);
        await page.waitForFunction(()=>document.querySelector('[data-settings-sync-card] .stg-value').textContent==='Sin conexión');
        await page.setOfflineMode(false);
        await page.waitForFunction(()=>document.querySelector('[data-settings-sync-card] .stg-value').textContent==='Error de sincronización');
        assert.equal(await page.evaluate(()=>window.fixtureSyncStatus.getLastSyncedAt()),null);
        console.log('PASS almacenamiento real de fotos/audios, colas y cambios de red sin falsos éxitos');
        for(const width of [1440,820,390,320]) {
            await page.setViewport({width,height:844});
            for(const tab of ['general','calendar','data','tests']) {
                await page.evaluate(tab=>window.draw(tab),tab);
                if(tab==='data') {
                    const status=await page.$eval('#settings-device-status',el=>({open:el.open,height:el.getBoundingClientRect().height,afterTabs:Boolean(document.querySelector('.nav-tabs').compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)}));
                    assert.ok(!status.open&&status.height<=120&&status.afterTabs,`Estado compacto: ${JSON.stringify(status)}`);
                    await page.click('#settings-device-status > summary');
                    await page.evaluate(()=>window.fixtureRender());
                    assert.equal(await page.$eval('#settings-device-status',el=>el.open),true);
                    await page.click('#settings-device-status > summary');
                } else {
                    assert.equal(await page.$('#settings-device-status'),null,`${tab}: sin dashboard`);
                }
                const layout=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,unlabelled:[...document.querySelectorAll('#screen input,#screen select')].filter(el=>getComputedStyle(el).display!=='none'&&!el.labels.length&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')).map(el=>el.id)}));
                assert.ok(layout.scroll<=layout.width,`${tab} desborda a ${width}px: ${JSON.stringify(layout)}`);
                assert.deepEqual(layout.unlabelled,[],`${tab}: etiquetas accesibles`);
                assert.equal(await page.$$eval('#screen input,#screen button,#screen select',els=>els.filter(el=>!el.closest('#settings-screen')).length),0,`${tab}: controles dentro del panel`);
                assert.equal(await page.$$eval('#settings-screen [data-settings-action="save-settings"]',els=>els.length),0);
                assert.ok(await page.$$eval('#settings-screen [hidden]',els=>els.every(el=>el.getBoundingClientRect().height===0)));
                if(tab==='tests') assert.ok(await page.$('[data-developer-mode]'),'Tests visible en modo desarrollador');
                if(tab==='general') assert.ok(await page.$('button[data-settings-voice][data-settings-action="open-voice-settings"]'),'Acceso a Voz en General');
                if(tab==='calendar') {
                    const inputWidth=await page.$eval('#settingsPeriodStart',el=>el.getBoundingClientRect().width);
                    assert.ok(inputWidth>=180,`Inicio del período demasiado estrecho a ${width}px: ${inputWidth}`);
                }
                if(tab==='general') {
                    await page.$eval('#companyName',el=>{el.value='Borrador';el.dispatchEvent(new Event('input',{bubbles:true}));});
                    const bar=await page.evaluate(()=>{
                        const bar=document.getElementById('settings-draft-bar');const rect=bar.getBoundingClientRect();const nav=document.querySelector('.bottom-nav');
                        return {left:rect.left,right:rect.right,bottom:rect.bottom,viewport:innerWidth,navVisible:getComputedStyle(nav).display!=='none',navTop:nav.getBoundingClientRect().top,buttons:[...bar.querySelectorAll('button')].map(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}))};
                    });
                    assert.ok(bar.left>=0&&bar.right<=bar.viewport,`Barra fuera de pantalla: ${JSON.stringify(bar)}`);
                    assert.ok(bar.buttons.every(b=>b.left>=bar.left&&b.right<=bar.right),`Botones fuera de la barra: ${JSON.stringify(bar)}`);
                    if(width<1024&&bar.navVisible) assert.ok(bar.bottom<=bar.navTop,`Barra cubre navegación: ${JSON.stringify(bar)}`);
                }
                if(width===320&&process.env.SETTINGS_SCREENSHOT_DIR){fs.mkdirSync(process.env.SETTINGS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SETTINGS_SCREENSHOT_DIR,`settings-${tab}.png`),fullPage:true});}
                console.log(`PASS Ajustes ${tab}: ${width}px, etiquetas, sin desbordamiento${tab==='general'?', barra y navegación':''}`);
            }
        }
        await page.evaluate(()=>window.enableExperiments());
        for(const textScale of [100,200]) {
            await page.setViewport({width:320,height:844});
            await page.evaluate(scale=>document.documentElement.style.fontSize=scale===200?'200%':'',textScale);
            for(const tab of ['general','calendar','data','tests']) {
                await page.evaluate(tab=>{window.draw(tab);document.querySelectorAll('.settings-tool-group').forEach(el=>el.open=true);},tab);
                const report=await page.evaluate(async()=>{
                    const originalWidth=innerWidth, originalScroll=document.documentElement.scrollWidth;
                    const result=await axe.run('#settings-screen',{runOnly:{type:'rule',values:['color-contrast']}});
                    return {width:originalWidth,scroll:originalScroll,violations:result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))})),incomplete:result.incomplete.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))};
                });
                assert.ok(report.scroll<=report.width,`${tab} texto ${textScale}%: ${JSON.stringify(report)}`);
                assert.deepEqual(report.violations,[],`${tab} contraste: ${JSON.stringify(report)}`);
                const visible=await page.$$eval('#settings-screen button,#settings-screen summary',els=>els.filter(el=>el.getBoundingClientRect().height>0).map(el=>({text:el.textContent.trim().slice(0,60),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
                assert.ok(visible.every(el=>el.width>=44&&el.height>=44),`${tab}: acciones táctiles pequeñas ${JSON.stringify(visible.filter(el=>el.width<44||el.height<44))}`);
                if(tab==='general') {
                    const maintenance=await page.$$eval('.settings-inline-action button',els=>els.map(el=>({text:el.textContent.trim(),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
                    assert.ok(maintenance.every(el=>el.height<=el.width),`Mantenimiento comprimido: ${JSON.stringify(maintenance)}`);
                }
                assert.ok((await page.$$eval('#settings-screen .nav-tab .tab-text',els=>els.map(el=>getComputedStyle(el).display))).every(display=>display!=='none'));
                console.log(`PASS Ajustes ${tab}: texto ${textScale}%, herramientas abiertas, sin desbordamiento, contraste y acciones táctiles`);
                if(process.env.SETTINGS_SCREENSHOT_DIR&&tab==='tests'){await page.screenshot({path:path.join(process.env.SETTINGS_SCREENSHOT_DIR,`settings-tests-expanded-${textScale}.png`),fullPage:true});}
                if(report.incomplete.length)console.log(`REVIEW ${tab}: ${JSON.stringify(report.incomplete)}`);
            }
        }
        for (const textScale of [100,200]) {
            await page.evaluate(scale=>{localStorage.removeItem('sa.devMode.v1');document.documentElement.style.fontSize=scale===200?'200%':'';},textScale);
            for (const tab of ['general','calendar','data']) {
                await page.evaluate(tab=>window.draw(tab),tab);
                const normal=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,tabs:[...document.querySelectorAll('.nav-tabs [data-settings-action="change-settings-tab"]')].map(el=>el.dataset.value),hiddenNames:[...document.querySelectorAll('.tab-text')].some(el=>getComputedStyle(el).display==='none')}));
                assert.deepEqual(normal.tabs,['data','general','calendar']);
                assert.ok(normal.scroll<=normal.width&&!normal.hiddenNames,`${tab}: modo normal ${textScale}% ${JSON.stringify(normal)}`);
            }
            console.log(`PASS modo normal: tres pestañas, nombres visibles y reflujo con texto ${textScale}%`);
        }
        await page.evaluate(()=>document.documentElement.style.fontSize='');
        await page.evaluate(()=>window.draw('calendar'));
        await page.$eval('#overtimeFactor',el=>{el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));});
        await page.click('#settings-draft-bar [data-settings-action="save-settings"]');
        assert.equal(await page.evaluate(()=>window.saveCalls),0);
        assert.equal(await page.$eval('#overtimeFactor',el=>el.getAttribute('aria-invalid')),'true');
        assert.match(await page.$eval('#settings-error-overtimeFactor',el=>el.textContent),/entre 1 y 5/);
        await page.evaluate(()=>window.fixtureRender());
        assert.equal(await page.$eval('#overtimeFactor',el=>el.value),'');
        assert.ok(await page.$('#settings-error-overtimeFactor'));
        await page.$eval('#overtimeFactor',el=>{el.value='2';el.dispatchEvent(new Event('input',{bubbles:true}));});
        assert.equal(await page.$('#settings-error-overtimeFactor'),null);
        await page.click('#settings-draft-bar [data-settings-action="save-settings"]');
        assert.equal(await page.evaluate(()=>window.saveCalls),1);
        const dirtyFields=await page.evaluate(()=>[...document.querySelectorAll('#settings-screen input,#settings-screen select')].filter(el=>['companyName','weatherApiKey','weatherLocationInput','scrollbarMode','showAttendanceCardDeficit','attendanceDeficitUnit','regularHoursPerDay','overtimeFactor','holidayFactor','restDayFactor','defaultDeductionPercentage'].includes(el.id)).map(el=>({id:el.id,value:el.value,defaultValue:el.defaultValue,checked:el.checked,defaultChecked:el.defaultChecked,options:el.options?[...el.options].map(o=>({value:o.value,defaultSelected:o.defaultSelected})):null})));
        assert.equal(await page.$eval('#settings-draft-bar',el=>el.hidden),true,JSON.stringify(dirtyFields));
        console.log('PASS handler real: error inline, borrador preservado, corrección y guardado contextual único');
        assert.deepEqual(errors,[]);console.log('PASS sin errores JavaScript ni llamadas a cuentas reales');
    } finally {if(browser) await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

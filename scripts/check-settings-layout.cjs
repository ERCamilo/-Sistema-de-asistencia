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
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head>
<body class="has-sidebar"><main class="main-content"><div class="container"><div id="settings-screen" style="max-width:900px;margin:auto"><div class="stg-status-bar" id="diagnostics"></div><div id="screen"></div></div></div></main><nav class="bottom-nav" aria-label="Navegación de prueba">Navegación inferior</nav>
<script type="module">
import {SettingsGeneralTab} from '/js/modules/ui/settings/SettingsGeneralTab.js';
import {SettingsTabCalendar} from '/js/modules/ui/settings/SettingsCalendarTab.js';
import {refreshSettingsDraftBar,discardSettingsDraft} from '/js/modules/ui/settings/SettingsDraftBar.js';
import {HolidayService} from '/js/modules/features/attendance/HolidayService.js';
import {StorageCard,SyncCard,attachSettingsDiagnostics,refreshDeviceSettingsDiagnostics,getSettingsSyncStatus} from '/js/modules/ui/settings/SettingsDiagnostics.js';
import {SyncStatus} from '/js/modules/services/SyncStatus.js';
const state={settings:{companyName:'Empresa de prueba',regularHoursPerDay:8,overtimeFactor:1.5,holidayFactor:2,restDayFactor:1.5,defaultDeductionPercentage:0,holidays:[],payPeriod:{}},settingsCalendarMonth:new Date(2026,9,1)};
const context={state,icons:{get:()=>'',getAvailableSets:()=>['unicode']},holidayService:new HolidayService(state)};
// Synthetic device-local records. Genuine browser IndexedDB and Blob measurements.
const seed=async(name,rows)=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>Object.keys(rows).forEach(store=>request.result.createObjectStore(store,{autoIncrement:true}));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(rows),'readwrite');for(const [store,records] of Object.entries(rows)) records.forEach(record=>tx.objectStore(store).add(record));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
};
await seed('attendance-app-db',{employeePhotos:[{optimizedBlob:new Blob([new Uint8Array(6*1024*1024)]),thumbnailBlob:new Blob([new Uint8Array(1024)])}],mainSyncOutbox:[{status:'pending'}],pettyCashOutbox:[{status:'pending'}],pettyCashMirrorOutbox:[{status:'dead'}]});
await seed('sa-voice-mvp-v1',{recordings:[{uid:'test-a',audio:new Blob([new Uint8Array(1024*1024)])}]});
document.getElementById('diagnostics').innerHTML=StorageCard()+SyncCard();
attachSettingsDiagnostics(context);await refreshDeviceSettingsDiagnostics();
window.fixtureSyncStatus=SyncStatus;
window.fixtureSetUser=async(user)=>{context.currentUser=user;await refreshDeviceSettingsDiagnostics();};
window.fixtureRefresh=refreshDeviceSettingsDiagnostics;
window.draw=tab=>{discardSettingsDraft({});document.getElementById('screen').innerHTML=tab==='calendar'?SettingsTabCalendar(context):SettingsGeneralTab(context);};
document.addEventListener('input',()=>refreshSettingsDraftBar(document));window.draw('general');window.ready=true;
</script></body></html>`;

(async () => {
    const server=http.createServer((req,res)=>{
        const pathname=new URL(req.url,'http://fixture').pathname;
        if(pathname==='/settings-fixture') {res.setHeader('Content-Type','text/html');res.end(fixture);return;}
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
        const deviceStats=await page.$eval('[data-settings-storage-card]',el=>el.textContent);
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
            for(const tab of ['general','calendar']) {
                await page.evaluate(tab=>window.draw(tab),tab);
                const layout=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,unlabelled:[...document.querySelectorAll('#screen input,#screen select')].filter(el=>!el.labels.length&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')).map(el=>el.id)}));
                assert.ok(layout.scroll<=layout.width,`${tab} desborda a ${width}px: ${JSON.stringify(layout)}`);
                assert.deepEqual(layout.unlabelled,[],`${tab}: etiquetas accesibles`);
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
                console.log(`PASS Ajustes ${tab}: ${width}px, etiquetas, sin desbordamiento${tab==='general'?', barra y navegación':''}`);
            }
        }
        assert.deepEqual(errors,[]);console.log('PASS sin errores JavaScript ni llamadas a cuentas reales');
    } finally {if(browser) await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

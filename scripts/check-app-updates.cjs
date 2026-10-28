#!/usr/bin/env node
// Actual Modal + AppHistory + service worker, with synthetic local persistence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'js/modules/config/AppVersion.js'), 'utf8');
const current = /const APP_VERSION = '([^']+)'/.exec(source)[1];
const next = current.replace(/\d+$/, n => String(Number(n) + 1));
const entry = {version:next,date:'2026-10-20',title:'Actualización de prueba',items:['Texto <img src=x onerror=alert(1)> seguro.']};
const originalManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-release.json')));
const styles = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map(m => `<link rel="stylesheet" href="/${m[1]}">`).join('');
const fixture = `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actualizaciones de prueba</title>${styles}</head><body><main><h1>Prueba de novedades</h1><span id="visible-version"></span><button id="news">Novedades</button><button id="check">Buscar actualizaciones</button><button id="repair">Reparar interfaz</button><p id="app-update-status" role="status"></p></main><script type="module">
import {startAppUpdates,openWhatsNew,checkAppUpdates,openInterfaceRepair} from '/js/modules/ui/AppUpdates.js';
import {APP_VERSION} from '/js/modules/config/AppVersion.js';
import {APP_CONFIG} from '/js/modules/config/Config.js';
document.getElementById('visible-version').textContent='v'+APP_CONFIG.VERSION;
import {createAppHistory} from '/js/modules/core/AppHistory.js';
window.loadedVersion=APP_VERSION;window.marker='loaded';window.bootNonce=crypto.randomUUID();
window.historyManager=createAppHistory({getView:()=>({tab:'settings',sub:'data'}),applyView:()=>true}).start();
document.getElementById('news').onclick=openWhatsNew;document.getElementById('check').onclick=checkAppUpdates;document.getElementById('repair').onclick=openInterfaceRepair;
window.releaseManager=startAppUpdates();await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});window.ready=true;
</script></body></html>`;
let published = false, invalid = false, slowAssets = false, unavailable = false, staleNavigation = false, stallWorker = false, browser;
const sockets=new Set();
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://test'), rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
  if(stallWorker&&rel==='sw.js')return;
  if(unavailable&&rel==='css/styles.css'&&url.searchParams.has('__v')){res.writeHead(503).end();return;}
  if(staleNavigation&&rel==='index.html'&&!url.search){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Stale application</title>');return;}
  let content;
  if(rel==='index.html') content=fixture;
  else if(rel==='js/modules/services/PersistenceService.js') content=`export async function saveApplicationData(options){window.saveOptions=options;if(window.saveMode==='fail')throw Error('disk failed');if(window.saveMode==='pending'){window.saving=true;await new Promise(resolve=>window.finishSave=resolve);}return {localOk:true};}`;
  else if(rel==='js/modules/ui/settings/SettingsDraftBar.js') content='export const isSettingsDraftDirty=()=>window.dirty===true;';
  else if(rel==='app-release.json') content=JSON.stringify(invalid?{}:{version:published?next:current,changelog:published?[entry,...originalManifest.changelog]:originalManifest.changelog});
  else { const file=path.resolve(ROOT,rel);if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}try{content=fs.readFileSync(file);}catch{res.writeHead(404).end();return;} }
  if(rel==='sw.js')content=content.toString().replace(/const CACHE_VERSION = '[^']*'/,`const CACHE_VERSION = 'update-test-${published?2:1}'`);
  if(published&&rel==='js/modules/config/AppVersion.js')content=content.toString().replace(`const APP_VERSION = '${current}'`,`const APP_VERSION = '${next}'`).replace('const CHANGELOG = [','const CHANGELOG = ['+JSON.stringify(entry)+',');
  res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'}[path.extname(rel)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');if(slowAssets&&rel==='js/modules/config/AppVersion.js'&&!url.search) setTimeout(()=>res.end(content),5000);else res.end(content);
});
server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const {default:puppeteer}=await import('puppeteer-core');browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:390,height:844});await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>window.ready&&!!navigator.serviceWorker.controller);
    assert.equal(await page.$('.release-modal'),null,'first install stays silent');
    await page.click('#news');await page.waitForSelector('#whats-new-modal');
    await page.waitForFunction(()=>history.state.saNav.depth===1);
    await page.goBack();await page.waitForSelector('#whats-new-modal',{hidden:true});
    assert.equal(await page.evaluate(()=>history.state.saNav.view.tab),'settings');
    published=true;await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});await page.waitForSelector('#update-modal');
    assert.ok((await page.$eval('#update-modal',el=>el.textContent)).includes(next));
    assert.equal(await page.$('#update-modal img'),null);
    assert.equal(await page.evaluate(()=>window.loadedVersion),current);
    assert.equal(await page.$eval('#visible-version',el=>el.textContent),'v'+current);
    await page.click('#update-modal .btn-secondary');await page.waitForSelector('#update-modal',{hidden:true});
    await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
    await page.click('#check');await page.waitForSelector('#update-modal');
    await page.evaluate(()=>window.saveMode='fail');await page.click('#update-modal .btn-primary');
    await page.waitForFunction(()=>document.querySelector('#update-modal [data-release-status]').textContent.includes('No se pudo actualizar'));
    assert.equal(await page.evaluate(()=>window.loadedVersion),current);
    unavailable=true;await page.evaluate(()=>window.saveMode='ok');await page.click('#update-modal .btn-primary');
    await page.waitForFunction(()=>document.querySelector('#update-modal [data-release-status]').textContent.includes('Revisa tu conexión'));
    assert.equal(await page.evaluate(()=>window.loadedVersion),current,'download failure keeps the page');unavailable=false;
    await page.evaluate(()=>window.saveMode='pending');await page.click('#update-modal .btn-primary');
    await page.waitForFunction(()=>window.releaseManager.getState().phase==='ready');
    await page.click('#update-modal .btn-primary');await page.waitForFunction(()=>window.saving);
    assert.equal(await page.evaluate(()=>window.loadedVersion),current);
    assert.deepEqual(await page.evaluate(()=>window.saveOptions),{immediate:true,announce:false,requireLocalSuccess:true,localOnly:true});
    // A deployed worker may already be active while its shell still contains
    // old bytes. Updating an unchanged registration and reloading is insufficient.
    await page.evaluate(async oldSource=>{
      const names=await caches.keys();const name=names.find(name=>name.startsWith('asistencia-vupdate-test-2'));
      const cache=await caches.open(name);
      await cache.put('/js/modules/config/AppVersion.js',new Response(oldSource,{headers:{'Content-Type':'text/javascript'}}));
      await cache.put('/js/stale-shell-entry.js',new Response('obsolete'));
      const media=await caches.open('user-media-test');await media.put('/saved-photo',new Response('preserved'));
      localStorage.setItem('update-data-sentinel','preserved');
    },source);
    slowAssets=true;staleNavigation=true;
    await page.evaluate(()=>window.finishSave());
    await page.waitForFunction(v=>window.loadedVersion===v,{},next).catch(async error=>{console.error('Update state',await page.evaluate(async()=>({version:window.loadedVersion,status:document.querySelector('[data-release-status]')?.textContent,caches:await caches.keys(),worker:navigator.serviceWorker.controller?.scriptURL})));throw error;});assert.equal(await page.$eval('#visible-version',el=>el.textContent),'v'+next);await page.waitForSelector('#whats-new-modal');
    assert.equal(await page.evaluate(()=>localStorage.getItem('update-data-sentinel')),'preserved');
    assert.equal(await page.evaluate(async()=>!!(await (await caches.open('user-media-test')).match('/saved-photo'))),true);
    await page.waitForFunction(async()=>!(await caches.match('/js/stale-shell-entry.js')));
    assert.equal(await page.evaluate(async()=>!!(await caches.match('/js/stale-shell-entry.js'))),false);
    slowAssets=false;staleNavigation=false;
    await page.click('#whats-new-modal .btn-primary');await page.waitForSelector('#whats-new-modal',{hidden:true});
    assert.equal(await page.evaluate(()=>localStorage.getItem('sa:lastSeenVersion')),next);

    // Same-version repair replaces a damaged UI snapshot without unregistering
    // the worker, clearing application data, or dropping media from legacy caches.
    const registrationsBefore=await page.evaluate(async()=>(await navigator.serviceWorker.getRegistrations()).length);
    await page.evaluate(async()=>{
      const state=await caches.open('asistencia-shell-state-v1');
      const response=await state.match(new URL('./__sa_shell_state__',document.baseURI));
      const pointer=await response.json();const shell=await caches.open(pointer.cacheName);
      await shell.put('/css/styles.css',new Response('/* corrupted-ui-sentinel */',{headers:{'Content-Type':'text/css'}}));
      const legacy=await caches.open('asistencia-vLEGACY-MEDIA');
      await legacy.put('/photos/profile.jpg',new Response('profile-preserved'));
      await legacy.put('/receipts/local.jpg',new Response('receipt-preserved'));
      const request=indexedDB.open('update-preservation',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('records',{keyPath:'id'});
      const db=await new Promise((r,j)=>{request.onsuccess=()=>r(request.result);request.onerror=()=>j(request.error);});
      await new Promise((r,j)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put({id:'sentinel',value:'preserved'});tx.oncomplete=r;tx.onerror=()=>j(tx.error);});db.close();
    });
    await page.click('#repair');await page.waitForSelector('#interface-repair-modal');
    await page.evaluate(()=>window.saveMode='fail');await page.click('#interface-repair-modal .btn-primary');
    await page.waitForFunction(()=>document.querySelector('#interface-repair-modal [data-release-status]').textContent.includes('No se pudo'));
    assert.equal(await page.evaluate(()=>window.loadedVersion),next);
    await page.evaluate(()=>window.saveMode='ok');await page.click('#interface-repair-modal .btn-primary');
    await page.waitForFunction(()=>!document.querySelector('#interface-repair-modal')&&window.ready);
    await page.waitForFunction(async()=>{
      const response=await(await caches.open('asistencia-shell-state-v1')).match(new URL('./__sa_shell_state__',document.baseURI));
      const pointer=await response.json();const css=await(await caches.open(pointer.cacheName)).match('/css/styles.css');
      return !(await css.text()).includes('corrupted-ui-sentinel');
    });
    assert.equal(await page.evaluate(async()=>(await navigator.serviceWorker.getRegistrations()).length),registrationsBefore);
    assert.equal(await page.evaluate(()=>localStorage.getItem('update-data-sentinel')),'preserved');
    assert.equal(await page.evaluate(async()=>await(await caches.match('/photos/profile.jpg')).text()),'profile-preserved');
    assert.equal(await page.evaluate(async()=>await(await caches.match('/receipts/local.jpg')).text()),'receipt-preserved');
    assert.equal(await page.evaluate(async()=>{
      const request=indexedDB.open('update-preservation',1);
      const db=await new Promise(r=>request.onsuccess=()=>r(request.result));
      const value=await new Promise(r=>{const read=db.transaction('records').objectStore('records').get('sentinel');read.onsuccess=()=>r(read.result?.value);});db.close();return value;
    }),'preserved');

    await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
    for(const width of [320,390,820,1440]){
      await page.setViewport({width,height:844});await page.click('#news');await page.waitForSelector('#whats-new-modal');
      const box=await page.$eval('#whats-new-modal .modal-container',el=>{const r=el.getBoundingClientRect();return {x:r.x,width:r.width,height:r.height};});
      assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.height<=844,JSON.stringify({width,...box}));
      const violations=await page.evaluate(async()=> (await axe.run('#whats-new-modal',{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
      assert.deepEqual(violations,[]);
      await page.click('#whats-new-modal .btn-primary');await page.waitForSelector('#whats-new-modal',{hidden:true});
    }
    await page.setOfflineMode(true);await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(v=>window.loadedVersion===v,{},next);assert.equal(await page.evaluate(()=>localStorage.getItem('update-data-sentinel')),'preserved');await page.click('#check');
    // Checking is asynchronous: wait for its offline result before asserting it.
    await page.waitForFunction(()=>/Sin conexión|No se pudo consultar/.test(document.getElementById('app-update-status').textContent));
    assert.match(await page.$eval('#app-update-status',el=>el.textContent),/Sin conexión|No se pudo consultar/);await page.setOfflineMode(false);
    invalid=true;await page.click('#check');await page.waitForFunction(()=>document.getElementById('app-update-status').textContent.includes('No se pudo consultar'));

    // Fresh browser context: a request of sw.js that never returns must become
    // a retryable preparation error, without saving or reloading automatically.
    const timeoutContext=await browser.createBrowserContext(),timeoutPage=await timeoutContext.newPage(),timeoutErrors=[];
    timeoutPage.on('pageerror',error=>timeoutErrors.push(error.message));
    published=false;invalid=false;slowAssets=false;unavailable=false;staleNavigation=false;stallWorker=false;
    await timeoutPage.evaluateOnNewDocument(()=>{
      const native=setTimeout.bind(window);
      window.setTimeout=(fn,ms,...args)=>native(fn,window.scaleDeadlines&&ms>=5000&&ms<=180000?ms/100:ms,...args);
    });
    await timeoutPage.goto('http://127.0.0.1:'+server.address().port+'/');
    await timeoutPage.waitForFunction(()=>window.ready&&!!navigator.serviceWorker.controller);
    await timeoutPage.evaluate(()=>{window.scaleDeadlines=true;localStorage.setItem('timeout-sentinel','preserved');});
    published=true;stallWorker=true;
    await timeoutPage.click('#check');await timeoutPage.waitForSelector('#update-modal');
    await timeoutPage.waitForFunction(()=>window.releaseManager.getState().phase==='error');
    assert.equal(await timeoutPage.$eval('#update-modal .btn-primary',el=>el.disabled),false);
    assert.equal(await timeoutPage.$eval('#update-modal [data-release-reload]',el=>el.hidden),false);
    assert.equal(await timeoutPage.evaluate(()=>localStorage.getItem('update-save-confirmed')),null);
    assert.equal(await timeoutPage.evaluate(()=>window.saveOptions),undefined);
    assert.equal(await timeoutPage.evaluate(()=>window.loadedVersion),current);
    await timeoutPage.evaluate(()=>window.saveMode='fail');await timeoutPage.click('#update-modal [data-release-reload]');
    await timeoutPage.waitForFunction(()=>document.querySelector('[data-release-status]').textContent.includes('No se pudo'));
    assert.equal(await timeoutPage.evaluate(()=>window.loadedVersion),current);
    const oldNonce=await timeoutPage.evaluate(()=>window.bootNonce);
    await timeoutPage.evaluate(()=>window.saveMode='ok');await timeoutPage.click('#update-modal [data-release-reload]');
    await timeoutPage.waitForFunction(n=>window.bootNonce&&window.bootNonce!==n,{},oldNonce);
    // With sw.js unavailable, recargar is a safe restart of the working version,
    // not a promise to install files that the browser has not prepared.
    assert.equal(await timeoutPage.evaluate(()=>window.loadedVersion),current);
    assert.equal(await timeoutPage.evaluate(()=>localStorage.getItem('timeout-sentinel')),'preserved');
    assert.deepEqual(timeoutErrors,[]);await timeoutContext.close();stallWorker=false;

    assert.deepEqual(errors,[]);console.log('PASS real SW: staged background preparation, confirmed activation, repair/media/IDB preservation, hanging sw.js timeout and safe fallback; first install, two builds, defer/manual update, save failure/pending barrier, notes, Back, safe text, offline/malformed catalog, 4 widths and WCAG A/AA');
  }finally{await browser?.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});

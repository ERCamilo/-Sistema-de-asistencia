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
const fixture = `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actualizaciones de prueba</title>${styles}</head><body><main><h1>Prueba de novedades</h1><button id="news">Novedades</button><button id="check">Buscar actualizaciones</button><p id="app-update-status" role="status"></p></main><script type="module">
import {startAppUpdates,openWhatsNew,checkAppUpdates} from '/js/modules/ui/AppUpdates.js';
import {APP_VERSION} from '/js/modules/config/AppVersion.js';
import {createAppHistory} from '/js/modules/core/AppHistory.js';
window.loadedVersion=APP_VERSION;window.marker='loaded';
window.historyManager=createAppHistory({getView:()=>({tab:'settings',sub:'data'}),applyView:()=>true}).start();
document.getElementById('news').onclick=openWhatsNew;document.getElementById('check').onclick=checkAppUpdates;
startAppUpdates();await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});window.ready=true;
</script></body></html>`;
let published = false, invalid = false, browser;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://test'), rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
  let content;
  if(rel==='index.html') content=fixture;
  else if(rel==='js/modules/services/PersistenceService.js') content=`export async function saveApplicationData(options){window.saveOptions=options;if(window.saveMode==='fail')throw Error('disk failed');if(window.saveMode==='pending'){window.saving=true;await new Promise(resolve=>window.finishSave=resolve);}return {localOk:true};}`;
  else if(rel==='js/modules/ui/settings/SettingsDraftBar.js') content='export const isSettingsDraftDirty=()=>window.dirty===true;';
  else if(rel==='app-release.json') content=JSON.stringify(invalid?{}:{version:published?next:current,changelog:published?[entry,...originalManifest.changelog]:originalManifest.changelog});
  else { const file=path.resolve(ROOT,rel);if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}try{content=fs.readFileSync(file);}catch{res.writeHead(404).end();return;} }
  if(rel==='sw.js')content=content.toString().replace(/const CACHE_VERSION = '[^']*'/,`const CACHE_VERSION = 'update-test-${published?2:1}'`);
  if(published&&rel==='js/modules/config/AppVersion.js')content=content.toString().replace(`const APP_VERSION = '${current}'`,`const APP_VERSION = '${next}'`).replace('const CHANGELOG = [','const CHANGELOG = ['+JSON.stringify(entry)+',');
  res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'}[path.extname(rel)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(content);
});
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
    published=true;await page.click('#check');await page.waitForSelector('#update-modal');
    assert.ok((await page.$eval('#update-modal',el=>el.textContent)).includes(next));
    assert.equal(await page.$('#update-modal img'),null);
    assert.equal(await page.evaluate(()=>window.loadedVersion),current);
    await page.click('#update-modal .btn-secondary');await page.waitForSelector('#update-modal',{hidden:true});
    await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
    await page.click('#check');await page.waitForSelector('#update-modal');
    await page.evaluate(()=>window.saveMode='fail');await page.click('#update-modal .btn-primary');
    await page.waitForFunction(()=>document.querySelector('#update-modal [data-release-status]').textContent.includes('No se pudo actualizar'));
    assert.equal(await page.evaluate(()=>window.loadedVersion),current);
    await page.evaluate(()=>window.saveMode='pending');await page.click('#update-modal .btn-primary');await page.waitForFunction(()=>window.saving);
    assert.equal(await page.evaluate(()=>window.loadedVersion),current);
    assert.deepEqual(await page.evaluate(()=>window.saveOptions),{immediate:true,announce:false,requireLocalSuccess:true,localOnly:true});
    await page.evaluate(()=>window.finishSave());
    await page.waitForFunction(v=>window.loadedVersion===v,{},next);await page.waitForSelector('#whats-new-modal');
    await page.click('#whats-new-modal .btn-primary');await page.waitForSelector('#whats-new-modal',{hidden:true});
    assert.equal(await page.evaluate(()=>localStorage.getItem('sa:lastSeenVersion')),next);
    await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
    for(const width of [320,390,820,1440]){
      await page.setViewport({width,height:844});await page.click('#news');await page.waitForSelector('#whats-new-modal');
      const box=await page.$eval('#whats-new-modal .modal-container',el=>{const r=el.getBoundingClientRect();return {x:r.x,width:r.width,height:r.height};});
      assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.height<=844,JSON.stringify({width,...box}));
      const violations=await page.evaluate(async()=> (await axe.run('#whats-new-modal',{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
      assert.deepEqual(violations,[]);
      await page.click('#whats-new-modal .btn-primary');await page.waitForSelector('#whats-new-modal',{hidden:true});
    }
    await page.setOfflineMode(true);await page.click('#check');assert.match(await page.$eval('#app-update-status',el=>el.textContent),/Sin conexión/);await page.setOfflineMode(false);
    invalid=true;await page.click('#check');await page.waitForFunction(()=>document.getElementById('app-update-status').textContent.includes('No se pudo consultar'));
    assert.deepEqual(errors,[]);console.log('PASS real SW: first install, two builds, defer/manual update, save failure/pending barrier, notes, Back, safe text, offline/malformed catalog, 4 widths and WCAG A/AA');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});

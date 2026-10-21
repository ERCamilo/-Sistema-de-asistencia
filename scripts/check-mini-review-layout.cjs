#!/usr/bin/env node
// Real shipped modal/CSS, synthetic attendance, no external services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const styles = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map(m => `<link rel="stylesheet" href="/${m[1]}">`).join('');
const names = fs.readFileSync(path.join(ROOT, 'js/modules/data/firebase.js'), 'utf8').match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g, '').split(',').map(n => n.trim()).filter(Boolean);
const stub = names.map(n => n === 'auth' ? 'export const auth={currentUser:null};' : `export const ${n}=()=>{};`).join('\n');
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<title>Revisión de Mini</title></head><body><main><h1>Prueba de revisión</h1></main><script type="module">
import {MiniAttendanceImportModal} from '/js/modules/ui/modals/MiniAttendanceImportModal.js';
import {createMultiDayAttendanceResolver} from '/js/modules/features/attendance/MultiDayAttendanceResolver.js';
const date='2026-10-21', project='layout-project';
const employees=Array.from({length:20},(_,i)=>({id:'emp-'+i,number:String(i+1),name:'Empleado de prueba '+(i+1),positions:['pos'],active:true,projectId:project}));
const positions=[{id:'pos',name:'Albañil'}];
window.showNotification=()=>{};
window.rosterRequests=0;window.openP2PRosterTransfer=async()=>{window.rosterRequests++;};
window.draw=(view='consolidation',profile=true)=>{
 window.modal?.close();
 const modal=new MiniAttendanceImportModal({employees,positions,attendance:{},saProjectId:project,importMode:view==='paste'?'paste':'connected',connectedReviewMode:'compare',proposedDate:date,confirmImportDates:()=>true,applyPlan:async plan=>({appliedCount:plan.writes.length,keptCount:0,writtenKeys:plan.writes.map(w=>w.key)})});
 window.modal=modal;
 if(view==='paste') {modal.source='001. Empleado de prueba 1 *8h*';modal.analyze();modal.confirmDate();modal.startReview();}
 else {
  const items=Array.from({length:5},(_,i)=>({id:'unresolved-'+i,saProjectId:project,workDate:date,saEmployeeId:null,status:'identity_conflict',normalHours:8,overtimeHours:0,displayName:i===0?'Nombre de empleado largo para revisar':'Empleado nuevo '+i,displayNumber:String(401+i),sources:[{miniLocalId:'mini-'+i,sourceId:'source',deviceId:'Mini Norte',rawDeviceId:'mini-norte',sourcePeerId:'mini-norte',sourcePeerName:'Mini Norte',number:String(401+i),name:'Empleado nuevo '+i,normalHours:8,overtimeHours:0,status:'present',workDate:date,...(profile?{positionName:'Albañil',dailySalary:1200}:{})}]}));
  const consolidation={saProjectId:project,workDates:[date],devices:['Mini Norte'],contributingSubmissions:[],items,summary:{totalItems:5,resolvedCount:0,unresolvedIdentityCount:5,hoursConflictCount:0}};
  modal.consolidatedResult=consolidation;
  modal.multiDayResolver=createMultiDayAttendanceResolver({consolidation,employees,positions,attendance:{},saProjectId:project,stage:'mini'});
  modal.connectedView='consolidation';
 }
 modal.open();
};
window.draw();window.ready=true;
</script></body></html>`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://fixture').pathname;
  if(pathname==='/fixture'){res.setHeader('Content-Type','text/html');return res.end(fixture);}
  if(pathname==='/js/modules/data/firebase.js'){res.setHeader('Content-Type','text/javascript');return res.end(stub);}
  const file=path.resolve(ROOT,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(ROOT+path.sep)) return res.writeHead(403).end();
  fs.readFile(file,(error,data)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'}[path.extname(file)]||'application/octet-stream');res.end(data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  const {default:puppeteer}=await import('puppeteer-core');
  browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);page.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');await page.waitForFunction(()=>window.ready);
  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  for(const width of [1440,1024,820,640,390,320]) {
   await page.setViewport({width,height:900});
   for(const profile of [true,false]) {
    await page.evaluate(profile=>window.draw('consolidation',profile),profile);
    await page.waitForFunction(()=>document.querySelectorAll('.mini-attendance-review-overlay').length===1);
    await page.waitForSelector('[data-mini-unresolved-identity]');
    // Also reproduce a 640px desktop modal, where viewport media queries cannot help.
    if(width===1440) await page.$eval('[data-modal-container]',el=>{
     el.style.setProperty('max-width','640px','important');
     el.style.setProperty('width','640px','important');
    });
    await new Promise(resolve=>setTimeout(resolve,350));
    const layout=await page.evaluate(()=>{
     const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
     return [...document.querySelectorAll('[data-mini-unresolved-identity]')].map(row=>({row:rect(row),picker:rect(row.querySelector('.mini-employee-combobox-trigger')),controls:[...row.querySelectorAll('button')].filter(el=>el.getBoundingClientRect().height&&el.closest('.mini-employee-combobox-panel')===null).map(el=>({text:el.textContent,rect:rect(el)}))}));
    });
    for(const row of layout) {
     assert.ok(row.picker.width>=Math.min(200,row.row.width-1),`Selector comprimido a ${width}: ${JSON.stringify(row)}`);
     for(const control of row.controls) {
      const r=control.rect;
      assert.ok(r.x>=row.row.x-1&&r.right<=row.row.right+1,`Fuera de tarjeta a ${width}: ${JSON.stringify(control)}`);
      assert.ok(r.height>=44,`Acción pequeña: ${JSON.stringify(control)}`);
      assert.ok(r.width>=44,`Acción estrecha: ${JSON.stringify(control)}`);
     }
     for(let i=0;i<row.controls.length;i++)for(let j=i+1;j<row.controls.length;j++) {
      const a=row.controls[i].rect,b=row.controls[j].rect;
      assert.ok(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,`Controles solapados a ${width}: ${JSON.stringify(row.controls)}`);
     }
    }
    const first='[data-mini-unresolved-identity="unresolved-0"]';
    assert.equal(await page.$$eval(first+' [data-mini-action="create-from-attendance"]',els=>els.length),profile?1:0);
    await page.click(first+' [data-mini-employee-trigger]');
    await page.type(first+' .mini-employee-search','Empleado de prueba 2');
    const picker=await page.$eval(first+' .mini-employee-combobox-panel',el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));
    assert.ok(picker.width>=Math.min(200,layout[0].row.width-1)&&picker.scroll<=picker.client+1,`Panel: ${JSON.stringify(picker)}`);
    const option=await page.$(first+' [data-mini-employee-option="emp-1"]');await option.click();
    assert.equal(await page.$eval(first+' [data-mini-action="resolve-identity"]',el=>el.disabled),false);
    const selected=await page.$eval(first+' [data-mini-employee-trigger]',el=>el.textContent);
    assert.ok(selected.includes('Empleado de prueba 2'));
    const bottomRegister=await page.$('[data-mini-unresolved-identity="unresolved-4"] [data-mini-action="register-mini-employee"]');
    await bottomRegister.evaluate(el=>el.scrollIntoView({block:'center'}));
    const before=await page.evaluate(()=>window.rosterRequests);await bottomRegister.click();
    assert.equal(await page.evaluate(()=>window.rosterRequests),before+1,'El pie no tapa la última acción');
    await page.$eval(first,el=>el.scrollIntoView({block:'start'}));
    if(process.env.MINI_REVIEW_SCREENSHOT_DIR&&profile){fs.mkdirSync(process.env.MINI_REVIEW_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.MINI_REVIEW_SCREENSHOT_DIR,'mini-review-'+width+'.png'),fullPage:true});}
    console.log('PASS '+width+'px, perfil '+profile+': selector, botones, panel y selección sin solapamiento');
   }
  }
  for(const width of [1440,390,320]) {
   await page.setViewport({width,height:900});await page.evaluate(()=>window.draw('paste'));
   await page.waitForFunction(()=>document.querySelectorAll('.mini-attendance-review-overlay').length===1);
   await page.waitForSelector('.mini-import-connected-view-sa-comparison');
   await page.click('[data-mini-action="review-text-detail"]');
   await page.waitForSelector('.mini-import-individual-review');
   assert.equal(await page.$('.mini-import-connected-view-sa-comparison'),null);
   await page.$eval('[data-mini-position-normal]',el=>{el.value='9';el.dispatchEvent(new Event('input',{bubbles:true}));});
   assert.equal(await page.$eval('[data-mini-action="confirm-unit"]',el=>el.disabled),false);
   await page.click('[data-mini-action="confirm-unit"]');
   await page.waitForSelector('[data-mini-adjusted-allocation]');
   assert.ok((await page.$eval('[data-mini-adjusted-allocation]',el=>el.textContent)).includes('9h'));
   await page.click('[data-mini-action="review-text-detail"]');
   await page.waitForSelector('.mini-import-individual-review');
   await page.click('[data-mini-action="back-review"]');
   await page.waitForSelector('.mini-import-connected-view-sa-comparison');
   const size=await page.$eval('[data-modal-container]',el=>({width:el.clientWidth,scroll:el.scrollWidth}));
   assert.ok(size.scroll<=size.width+1,`Texto desborda a ${width}: ${JSON.stringify(size)}`);
   const accessibility=await page.evaluate(async()=>{
    const result=await axe.run('.mini-attendance-review-overlay',{runOnly:{type:'rule',values:['label','button-name','aria-allowed-attr','aria-required-attr','aria-valid-attr-value']}});
    return result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));
   });
   assert.deepEqual(accessibility,[],'Etiquetas y atributos accesibles');
   console.log('PASS '+width+'px: texto → comparación compartida → revisión individual → comparación');
  }
  assert.deepEqual(errors,[],'Errores de ejecución');
 } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

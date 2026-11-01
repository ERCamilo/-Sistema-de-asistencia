#!/usr/bin/env node
/* Scoped E2E: production components -> services -> native IDB -> real Firestore emulator.
 * It deliberately does not claim coverage of external OAuth, index.html boot or photos.
 */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'../..');
const PROJECT=process.env.MULTIOBRA_AUDIT_PROJECT||'demo-sa-multiobra-360';
const HOST=process.env.FIRESTORE_EMULATOR_HOST||'';
if(!/^127\.0\.0\.1:\d+$/.test(HOST)||!PROJECT.startsWith('demo-sa-multiobra-'))throw Error('A dedicated demo project and loopback Firestore emulator are required');
const PORT=Number(HOST.split(':')[1]),SDK=process.env.SA_EMULATOR_NODE_MODULES;
const RESULTS=process.env.MULTIOBRA_RESULTS||path.join(__dirname,'results/latest');
fs.mkdirSync(RESULTS,{recursive:true});
let browser,server,origin,serial=0;
const records=[],blocked=[],startupErrors=[];
let interrupted=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{interrupted=true;browser?.close().catch(()=>{});});
const fixture=options=>`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Multiobra acceptance harness</title><link rel="stylesheet" href="/css/styles.css"><style>body{padding:12px}button{min-height:44px}main{max-width:1100px;margin:auto}#metrics{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><main><h1>Multiobra — entorno de pruebas</h1><p>Controles de producción; cuenta externa sintética; datos y nube locales.</p><button id="sync">Consultar y publicar catálogo</button><span id="sync-status"></span><button id="setup">Configuración de proyectos</button><span id="switch-status"></span><section id="attendance"></section><section id="projects"></section><ul id="staff"></ul><pre id="metrics"></pre></main><script type="application/json" id="audit-options">${JSON.stringify(options)}</script><script type="module" src="/qa/multiobra360/entry.browser.mjs"></script></body></html>`;
async function rest(method,url,body){
 const r=await fetch('http://'+HOST+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(!r.ok)throw Error('Emulator '+r.status+': '+await r.text());
}
async function clear(){await rest('DELETE','/emulator/v1/projects/'+PROJECT+'/databases/(default)/documents');}
async function pageFor({width=1280,uid='audit-owner',caseId}={}){
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
 await page.setViewport({width,height:900});page.setDefaultTimeout(7000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.setRequestInterception(true);
 page.on('request',request=>{
  const u=new URL(request.url());
  if(['data:','blob:'].includes(u.protocol)||u.hostname==='127.0.0.1'||u.hostname==='localhost')request.continue();
  else{blocked.push(u.origin);request.abort();}
 });
 await page.exposeFunction('auditHostClick',selector=>page.click(selector));
 await page.exposeFunction('auditHostKey',key=>page.keyboard.press(key));
 await page.exposeFunction('auditHostFill',async(selector,value)=>page.$eval(selector,(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value));
 await page.goto(origin+'/?uid='+encodeURIComponent(uid)+'&case='+encodeURIComponent(caseId||'case-'+ ++serial));
 await page.waitForFunction(()=>window.auditReady||window.auditSetupError);
 const setup=await page.evaluate(()=>window.auditSetupError);
 if(setup)throw Error('HARNESS_SETUP: '+setup);
 return{page,context,errors};
}
async function preserveFailure(page,name){const file=name.replace(/[^\w.-]/g,'-');await page.screenshot({path:path.join(RESULTS,file+'.png'),fullPage:true}).catch(()=>{});}
async function timed(promise,ms=14000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HARNESS_TIMEOUT: case deadline exceeded')),ms);})]);}finally{clearTimeout(timer);}}
async function single(meta,width){
 let d;const start=Date.now();
 try{
  await clear();d=await pageFor({width,caseId:meta.id+'-'+width});
  let result=await timed(d.page.evaluate(id=>window.runAuditCase(id),meta.id));
  if(result.reload){await d.page.reload();await d.page.waitForFunction(()=>window.auditReady||window.auditSetupError);result=await timed(d.page.evaluate(id=>window.runAuditCase(id),meta.id));}
  if(d.errors.length&&result.ok){result.ok=false;result.kind='infrastructure';result.error=d.errors.join('\n');}
  if(!result.ok)await preserveFailure(d.page,meta.id+'-'+width);
  const rec={...meta,width,durationMs:Date.now()-start,...result};records.push(rec);console.log((rec.ok?'PASS':'FAIL')+' '+meta.id+' '+width+' '+(rec.error||''));
  // Persistence assertion runs on the real non-seed editing control.
  if(result.ok&&meta.id==='r7-control'){
   await d.page.reload();await d.page.waitForFunction(()=>window.auditReady||window.auditSetupError);
   const hours=await d.page.evaluate(()=>window.__audit.active.getActiveDayHours({})['2026-10-24']);
   assert.equal(hours,8.5,'reloaded browser must recover confirmed hours from native IndexedDB');
  }
 }catch(error){const previous=records.find(r=>r.id===meta.id&&r.width===width);if(previous){previous.ok=false;previous.kind='infrastructure';previous.error=error.message;}else records.push({...meta,width,ok:false,kind:'infrastructure',error:error.message,durationMs:Date.now()-start});console.log('ERROR '+meta.id+' '+error.message);}
 finally{await d?.context.close();}
}
async function dual(kind,width){
 let a,b;const id='r7-two-devices-'+kind,start=Date.now();
 try{
  await clear();a=await pageFor({width,caseId:id+'-a'});b=await pageFor({width,caseId:id+'-b'});
  const initialA=await a.page.evaluate(()=>window.__audit.immutableSnapshot()),initialB=await b.page.evaluate(()=>window.__audit.immutableSnapshot());
  await a.page.evaluate(async kind=>{
   const x=window.__audit;await x.remoteSet('A',{...x.project('A'),payrollConfig:x.cfg('A',8,5)});
   await x.idb.update('projects',{...x.project('A',kind==='name'?10:1),...(kind==='name'?{name:'Device A old'}:{})});
   await x.setConfig('A',9,10);x.catalog.stopProjectCatalogLiveSync();
   let release,arrive;window.auditReached=false;
   window.auditRelease=new Promise(r=>release=r);window.releaseAudit=release;
   window.auditPending=x.sync({writeDoc:async(ref,data,opts)=>{
    if((kind==='name'&&data.name)||(kind==='config'&&data.payrollConfig)){
     window.auditReached=true;await window.auditRelease;
    }
    return x.fb.setDoc(ref,data,opts);
   }}).then(result=>{window.auditCompleted=true;return result;});
  },kind);
  await a.page.waitForFunction(()=>window.auditReached||window.auditCompleted);
  if(kind==='config'){
   await b.page.evaluate(async()=>{await window.__audit.setConfig('A',9.5,5);});
   await b.page.click('[data-att-action="change-base-hours"][data-value="0.5"]');
   await b.page.waitForFunction(async()=>((await window.__audit.idb.get('projectPayrollConfigs','A'))?.dayHours?.['2026-10-24']===10));
  }else{
   await b.page.click('#setup');await b.page.waitForSelector('[data-project-name]');
   await b.page.$eval('[data-project-name]',el=>{el.value='Device B newest';el.dispatchEvent(new Event('input',{bubbles:true}));});
   await b.page.click('[data-project-rename]');
   await b.page.waitForFunction(async()=>((await window.__audit.idb.get('projects','A'))?.name==='Device B newest'));
  }
  await b.page.evaluate(async()=>window.__audit.sync());
  const committed=await b.page.evaluate(async()=>window.__audit.remoteGet('A'));
  assert.equal(kind==='config'?committed.payrollConfig.dayHours['2026-10-24']:committed.name,kind==='config'?10:'Device B newest','device B must confirm its newer write before releasing A');
  await a.page.evaluate(()=>window.releaseAudit());await timed(a.page.evaluate(()=>window.auditPending));
  const final=await b.page.evaluate(async()=>window.__audit.remoteGet('A'));
  const ok=kind==='config'?final.payrollConfig.dayHours['2026-10-24']===10:final.name==='Device B newest';
  // A new follower must see B's confirmed result, not A's stale publication.
  let follower;
  try{follower=await pageFor({width,caseId:id+'-follower'});await follower.page.evaluate(async()=>window.__audit.sync());const durable=await follower.page.evaluate(async()=>({project:await window.__audit.idb.get('projects','A'),config:await window.__audit.idb.get('projectPayrollConfigs','A')}));records.push({id,point:'R7',title:'two isolated browser devices and fresh follower: '+kind,width,ok:ok&&(kind==='config'?durable.config.dayHours['2026-10-24']===10:durable.project.name==='Device B newest'),kind:'assertion',committed,final,follower:durable,durationMs:Date.now()-start});}
  finally{await follower?.context.close();}
  const invariantOk=JSON.stringify(await a.page.evaluate(()=>window.__audit.immutableSnapshot()))===JSON.stringify(initialA)&&JSON.stringify(await b.page.evaluate(()=>window.__audit.immutableSnapshot()))===JSON.stringify(initialB);records.at(-1).invariantOk=invariantOk;records.at(-1).ok=records.at(-1).ok&&invariantOk;
  if(!records.at(-1).ok)await preserveFailure(b.page,id+'-'+width);
  console.log((records.at(-1).ok?'PASS':'FAIL')+' '+id+' '+width);
 }catch(error){records.push({id,point:'R7',width,ok:false,kind:'infrastructure',error:error.message,durationMs:Date.now()-start});console.log('ERROR '+id+' '+error.message);}
 finally{await a?.page.evaluate(()=>window.releaseAudit?.()).catch(()=>{});await a?.context.close();await b?.context.close();}
}
(async()=>{
 const esbuild=require('esbuild');
 const bundle=await esbuild.build({entryPoints:[path.join(__dirname,'firebase.browser.mjs')],bundle:true,write:false,format:'esm',platform:'browser',nodePaths:SDK?[SDK]:[]});
 await rest('PUT','/emulator/v1/projects/'+PROJECT+':securityRules',{rules:{files:[{name:'firestore.rules',content:fs.readFileSync(path.join(ROOT,'firestore.rules'),'utf8')}]}});
 server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(fixture({projectId:PROJECT,firestorePort:PORT,uid:url.searchParams.get('uid')||'audit-owner',caseId:url.searchParams.get('case')||'startup'}));return;}
  if(url.pathname==='/js/modules/data/firebase.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);return;}
  const file=path.resolve(ROOT,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,content)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'application/octet-stream');res.end(content);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const {default:puppeteer}=await import('puppeteer-core');
 browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/snap/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const probe=await pageFor({caseId:'list-cases'});const selectedPoint=process.env.MULTIOBRA_POINT||'all';const cases=(await probe.page.evaluate(()=>window.auditCases)).filter(c=>selectedPoint==='all'?c.point!=='REVIEW':c.point===selectedPoint);await probe.context.close();
 const widths=(process.env.MULTIOBRA_WIDTHS||'390,1280').split(',').map(Number);
 for(const width of widths){for(const meta of cases){if(interrupted)throw Error('Audit interrupted');await single(meta,width);}for(const kind of (selectedPoint==='all'||selectedPoint==='R7'?['config','name']:[])){if(interrupted)throw Error('Audit interrupted');await dual(kind,width);}}
})().catch(error=>{startupErrors.push(error.stack);console.error(error);}).finally(async()=>{
 await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());
 const summary={total:records.length,passed:records.filter(r=>r.ok).length,failed:records.filter(r=>!r.ok&&r.kind==='assertion').length,infrastructure:records.filter(r=>!r.ok&&r.kind!=='assertion').length+startupErrors.length};
 fs.writeFileSync(path.join(RESULTS,'browser.json'),JSON.stringify({schemaVersion:1,project:PROJECT,scope:'production-component E2E; external auth synthetic; not full app boot',summary,records,startupErrors,blockedOrigins:[...new Set(blocked)]},null,2));
 console.log('BROWSER_SUMMARY '+JSON.stringify(summary));process.exitCode=summary.infrastructure?2:summary.failed?1:0;
});

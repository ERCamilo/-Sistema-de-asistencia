const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
(async () => {
 const root = path.resolve(__dirname, '..');
 const {default: puppeteer} = await import('puppeteer-core');
 const server = http.createServer((req,res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/$/,'/index.html'));
  if (!file.startsWith(root + path.sep)) {res.writeHead(403).end();return;}
  const mime = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'};
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'text/plain');res.end(data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin = process.env.RECOVERY_TEST_ORIGIN || 'http://127.0.0.1:' + server.address().port;
 let browser;
 try {
  browser = await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH || '/snap/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

  for (const scenario of [{route:'file',width:1280},{route:'full',width:390}]) {
   const context=await browser.createBrowserContext(), page=await context.newPage(), errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.setRequestInterception(true);
   page.on('request',req=>{
    const host=new URL(req.url()).hostname;
    if(host.endsWith('googleapis.com')||host.endsWith('firebaseio.com')||host.endsWith('cloudfunctions.net')||host.includes('n8n')) req.abort(); else req.continue();
   });
   await page.setViewport({width:scenario.width,height:900});
   await page.goto(origin+'/design.md');
   const expected=await page.evaluate(async()=>{
    localStorage.setItem('onboardingCompleted','true');
    localStorage.setItem('asistencia_feature_projects','true');
    localStorage.setItem('asistencia_default_project_id','PRJ-backup');
    localStorage.setItem('asistencia_active_project_id','PRJ-backup');
    const {default:db}=await import('/js/modules/services/IndexedDBService.js');await db.init();
    const {buildPayrollClosure,buildPayrollClosureSnapshot}=await import('/js/modules/features/payroll/PayrollClosure.js');
    const build=(pid,start)=>{
     const o={...(pid?{projectId:pid}:{}),periodStart:start,periodEnd:'2026-09-15',closedAt:100,
      rows:[{_employeeId:'emp-backup',_number:'1',_employeeName:'Ana',_brutoOriginal:1000,_loans:100,monto:900}]};
     return buildPayrollClosure({...o,fingerprint:JSON.stringify(buildPayrollClosureSnapshot(o))});
    };
    const legacy={...build(null,'2026-09-03'),schemaVersion:1,status:'voided',
     migrationSource:'legacy-payroll-loan-batch',loanSettlementBatchId:'legacy-batch',
     voidedAt:120,voidedBy:'original-actor',voidReason:'Cierre anulado'};
    const closures=[build('PRJ-backup','2026-09-01'),build(null,'2026-09-02'),legacy];
    await db.update('projects',{id:'PRJ-backup',name:'Obra Backup',status:'active',schemaVersion:1,createdAt:1,updatedAt:1});
    await db.update('settings',{key:'app',companyName:'Prueba Backup',regularHoursPerDay:8,schemaVersion:3,legacyNavigation:false});
    await db.update('positions',{id:'pos-backup',projectId:'PRJ-backup',name:'Ayudante',active:true,hourlyRate:100});
    await db.update('employees',{id:'emp-backup',number:'1',name:'Ana',projectId:'PRJ-backup',active:true,positions:['pos-backup'],
     loans:[{id:'loan',amount:1000,balance:900,payments:[{id:'payment',amount:100,source:'payroll',payrollProjectId:'PRJ-backup',payrollClosureId:closures[0].id}]}]});
    for(const closure of closures) await db.update('payrollClosures',closure);
    return closures;
   });
   await page.goto(origin,{waitUntil:'networkidle2',timeout:60000});
   await page.waitForFunction(()=>typeof window.exportData==='function');
   const exported=await page.evaluate(async()=>{
    await window.exportData();
    const {state}=await import('/js/modules/core/AppState.js');
    return JSON.parse(await state.exportMenuData.blob.text());
   });
   assert.deepEqual(exported.data.payrollClosures,expected.sort((a,b)=>a.id.localeCompare(b.id)));
   const quick=await page.evaluate(async()=>{
    const original=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let captured;
    URL.createObjectURL=blob=>{captured=blob;return original.call(URL,blob);};
    HTMLAnchorElement.prototype.click=()=>{};
    try {await window.downloadBackupNow();return JSON.parse(await captured.text());}
    finally {URL.createObjectURL=original;HTMLAnchorElement.prototype.click=click;}
   });
   assert.deepEqual(quick.data.payrollClosures,exported.data.payrollClosures);
   await page.evaluate(async()=>{
    window.closeExportMenu?.();
    const {default:db}=await import('/js/modules/services/IndexedDBService.js');
    await db.clear('payrollClosures');
   });
   if(scenario.route==='file') {
    await page.evaluate(payload=>window.loadBackupFromFile(new File([JSON.stringify(payload)],'backup.json',{type:'application/json'})),exported);
    await page.waitForSelector('#btn-restore-local',{visible:true});
    assert.ok((await page.$eval('[data-backup-closures]',e=>e.textContent)).includes('3 cierres'));
    await Promise.all([page.waitForNavigation({waitUntil:'networkidle2',timeout:20000}),page.click('#btn-restore-local')]);
   } else {
    await page.evaluate(async()=>{
     const ctl=await import('/js/modules/features/export/ExportController.js');ctl.openImportFullModal();
    });
    await page.waitForSelector('.import-full-dialog',{visible:true});
    await page.evaluate(async payload=>{
     const ctl=await import('/js/modules/features/export/ExportController.js');
     ctl.setImportFullText(JSON.stringify(payload));ctl.confirmImportFull();
    },exported);
    assert.ok((await page.$eval('[data-backup-closures]',e=>e.textContent)).includes('3 cierres'));
    await Promise.all([page.waitForNavigation({waitUntil:'networkidle2',timeout:20000}),
     page.click('[data-app-fn="applyConfirmedFullImport"]')]).catch(async e=>{console.log('FULL_STATE',await page.evaluate(()=>document.querySelector('.import-full-dialog')?.textContent));throw e;});
   }
   const restored=await page.evaluate(async()=>{
    const {default:db}=await import('/js/modules/services/IndexedDBService.js');await db.init();
    return {closures:await db.getAll('payrollClosures'),employees:await db.getAll('employees')};
   });
   assert.deepEqual(restored.closures,exported.data.payrollClosures);
   // M2: restaurar sin sesión deja la marca y no encola Caja Chica para ninguna cuenta.
   const detached=await page.evaluate(async()=>{
    const {default:db}=await import('/js/modules/services/IndexedDBService.js');
    return {marker:JSON.parse(localStorage.getItem('asistencia_detached_restore_v1')||'null'),outbox:(await db.getAll('pettyCashOutbox')).length};
   });
   assert.ok(detached.marker&&detached.marker.previousUid===null,'falta la marca de restauración sin sesión');
   assert.equal(detached.outbox,0);
   assert.deepEqual(restored.employees[0].loans,exported.data.employees[0].loans);
   if(scenario.route==='file') {
    await page.evaluate(async closure=>{
     const {default:db}=await import('/js/modules/services/IndexedDBService.js');
     const {stateManager}=await import('/js/modules/core/AppState.js');
     await db.update('payrollClosures',{...closure,fingerprint:'existing-conflict'});
     const employee={...stateManager.getState().employees[0],name:'Conservar'};
     await db.update('employees',employee);stateManager.setState({employees:[employee]},{silent:true});
     const save=db.saveState.bind(db);
     db.saveState=async(...args)=>{try{return await save(...args);}catch(e){window.__restoreFailed=true;throw e;}};
     window.__restoreSuccess=false;
    },exported.data.payrollClosures[0]);
    await page.evaluate(payload=>window.loadBackupFromFile(new File([JSON.stringify(payload)],'backup.json',{type:'application/json'}),
     {onSuccess:()=>{window.__restoreSuccess=true;}}),exported);
    await page.waitForSelector('#btn-restore-local',{visible:true});await page.click('#btn-restore-local');
    await page.waitForFunction(()=>window.__restoreFailed===true);
    const failure=await page.evaluate(async()=>{
     const {default:db}=await import('/js/modules/services/IndexedDBService.js');
     const {state}=await import('/js/modules/core/AppState.js');
     return {durable:(await db.getAll('employees'))[0].name,memory:state.employees[0].name,success:window.__restoreSuccess};
    });
    assert.deepEqual(failure,{durable:'Conservar',memory:'Conservar',success:false});
   }
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({status:'PASS',route:scenario.route,width:scenario.width,closures:restored.closures.length,preservedPayments:true,reload:true,noRealAccount:true,detachedMarker:true}));
   await context.close();
  }
 } finally {if(browser) await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

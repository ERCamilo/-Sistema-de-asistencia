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
 const origin = 'http://127.0.0.1:' + server.address().port;
 let browser;
 try {
  browser = await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH || '/snap/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for (const scenario of [{width:1280,height:900,action:'map'},{width:390,height:844,action:'create'}]) {
   const context = await browser.createBrowserContext();
   const page = await context.newPage(), errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.setRequestInterception(true);
   page.on('request',req=>{
    const host=new URL(req.url()).hostname;
    if (host.endsWith('googleapis.com') || host.endsWith('firebaseio.com') || host.endsWith('cloudfunctions.net')) req.abort();
    else req.continue();
   });
   await page.setViewport({width:scenario.width,height:scenario.height});
   await page.goto(origin+'/design.md');
   await page.evaluate(async()=>{
    localStorage.setItem('onboardingCompleted','true');
    localStorage.setItem('asistencia_feature_projects','true');
    localStorage.setItem('asistencia_default_project_id','PRJ-recovery-test');
    localStorage.setItem('asistencia_active_project_id','PRJ-recovery-test');
    const {default:db}=await import('/js/modules/services/IndexedDBService.js');await db.init();
    const {buildPayrollClosure,buildPayrollClosureSnapshot}=await import('/js/modules/features/payroll/PayrollClosure.js');
    const options={projectId:'missing',periodStart:'2026-09-01',periodEnd:'2026-09-15',closedAt:100,
     rows:[{_employeeId:'emp-recovery',_number:'1',_employeeName:'Ana',_brutoOriginal:1000,_loans:100,_deductions:50,monto:850}]};
    const closure=buildPayrollClosure({...options,fingerprint:JSON.stringify(buildPayrollClosureSnapshot(options))});
    await db.update('projects',{id:'PRJ-recovery-test',name:'Obra de prueba',status:'active',schemaVersion:1,createdAt:1,updatedAt:1});
    await db.update('settings',{key:'app',companyName:'Laboratorio sin cuenta',regularHoursPerDay:8,schemaVersion:3,legacyNavigation:false});
    await db.update('positions',{id:'pos-recovery',name:'Ayudante',active:true,hourlyRate:100});
    await db.update('employees',{id:'emp-recovery',number:'1',name:'Ana',active:true,positions:['pos-recovery'],positionSalaries:{'pos-recovery':180},
     loans:[{id:'loan',amount:1000,balance:900,payments:[{id:'payment',amount:100,date:'2026-09-15',source:'payroll',payrollProjectId:'missing',payrollClosureId:closure.id}]}],
     deductions:[{id:'plan',employeeId:'emp-recovery',projectId:'missing',recordType:'payroll-adjustment-installment-plan',version:1,kind:'deductions',name:'Deducción',type:'fixed',
      status:'active',totalAmount:100,balance:50,appliedAmount:50,appliedInstallments:1,installmentCount:2,
      installments:[{id:'i1',amount:50,appliedAmount:50,status:'applied',payrollClosureId:closure.id},{id:'i2',amount:50,appliedAmount:0,status:'pending'}],
      history:[{id:'h1',source:'payroll',amount:50,payrollClosureId:closure.id}]}]});
    await db.update('attendance',{key:'emp-recovery-2026-09-01',employeeId:'emp-recovery',date:'2026-09-01',present:true,hoursWorked:8,overtimeHours:2});
    await db.update('payrollClosures',closure);
   });
   const read=()=>page.evaluate(async()=>{
    const {default:db}=await import('/js/modules/services/IndexedDBService.js');
    return {employees:await db.getAll('employees'),attendance:await db.getAll('attendance'),closures:await db.getAll('payrollClosures'),projects:await db.getAll('projects')};
   });
   await page.goto(origin,{waitUntil:'networkidle2',timeout:60000});
   await page.waitForFunction(()=>typeof window.openProjectReconciliation==='function');
   const before=await read();
   await page.evaluate(()=>window.openProjectReconciliation());
   await page.waitForSelector('[data-r07-step="0"]:not([hidden])',{visible:true});
   await page.click('[name="r07-recon-action"][value="'+scenario.action+'"]');
   if(scenario.action==='map') await page.select('[data-r07-control="target-project"]','PRJ-recovery-test');
   else await page.type('[data-r07-control="create-name"]','Obra recuperada');
   await page.click('[data-r07-action="quick-assign"]');
   assert.equal(await page.$eval('[data-r07-step]:not([hidden])',el=>el.dataset.r07Step),'4');
   assert.equal(await page.$eval('[data-r07-action="apply"]',el=>el.disabled),false);
   assert.deepEqual(await read(),before,'preview must not write');
   await page.click('[data-r07-action="wizard-back"]');
   assert.deepEqual(await read(),before,'back must not write');
   while(await page.$eval('[data-r07-step]:not([hidden])',el=>el.dataset.r07Step)!=='4') await page.click('[data-r07-action="wizard-next"]');
   const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,footer:document.querySelector('.r07-recon-footer').getBoundingClientRect().bottom,height:innerHeight}));
   assert.equal(layout.overflow,false);assert.ok(layout.footer<=layout.height+1,JSON.stringify(layout));
   await page.click('[data-r07-action="apply"]');
   await page.waitForFunction(async()=>{const {default:db}=await import('/js/modules/services/IndexedDBService.js');return (await db.getAll('payrollClosures')).length===2;},{timeout:15000});
   const after=await read(), employee=after.employees[0], recovered=after.closures.find(c=>c.recovery);
   assert.ok(employee.projectId);
   assert.equal(recovered.projectId,employee.projectId);
   assert.deepEqual(after.closures.find(c=>c.id===before.closures[0].id),before.closures[0]);
   assert.deepEqual(recovered.rows,before.closures[0].rows);
   assert.deepEqual(recovered.totals,before.closures[0].totals);
   assert.equal(employee.loans[0].amount,1000);assert.equal(employee.loans[0].balance,900);
   assert.equal(employee.loans[0].payments.length,1);
   assert.equal(employee.loans[0].payments[0].payrollClosureId,recovered.id);
   assert.equal(employee.loans[0].payments[0].amount,100);
   assert.equal(employee.deductions[0].appliedAmount,50);assert.equal(employee.deductions[0].balance,50);
   assert.equal(employee.deductions[0].history[0].payrollClosureId,recovered.id);
   assert.equal(employee.deductions[0].installments[0].status,'applied');
   assert.equal(employee.deductions[0].installments[1].status,'pending');
   assert.deepEqual(employee.positionSalaries,before.employees[0].positionSalaries);
   assert.equal(after.attendance[0].hoursWorked,8);assert.equal(after.attendance[0].overtimeHours,2);
   await page.reload({waitUntil:'networkidle2'});
   assert.deepEqual(await read(),after,'reload must retain recovered data');
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({status:'PASS',action:scenario.action,width:scenario.width,closureCount:after.closures.length,preservedMoney:true,reload:true,noRealAccount:true}));
   await context.close();
  }
 } finally {if(browser) await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

#!/usr/bin/env node
// Shipped employee editor and payroll UI; fictional data and no external requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const output = process.env.EMPLOYEE_LEADER_ARTIFACT_DIR || '/tmp/sa-employee-position-leaders';
const styles = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^\"]+)"/g)].map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('');
const names = fs.readFileSync(path.join(ROOT, 'js/modules/data/firebase.js'), 'utf8').match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g,'').split(',').map(name => name.trim()).filter(Boolean);
const firebase = names.map(name => name === 'auth' ? 'export const auth={currentUser:null};' : `export const ${name}=()=>{};`).join('\n');
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Posiciones y pagadores</title>${styles}<style>body{margin:0;background:#0b1320;color:#e5ebf2}main{max-width:1000px;margin:auto}#editor{max-width:620px;margin:auto}#screen:empty{display:none}</style></head><body><main><div id="editor"></div><div id="screen"></div></main><script type="module">
import {state,stateManager} from '/js/modules/core/AppState.js';
import {EmployeeModal} from '/js/modules/ui/modals/EmployeeModal.js';
import * as EmployeesUI from '/js/modules/features/employees/EmployeesUI.js';
import * as UI from '/js/modules/features/payroll/PayrollUI.js';
import {ProjectPayrollUIRuntime} from '/js/modules/features/payroll/ProjectPayrollUIRuntime.js';
import {capturePayrollProjectContext} from '/js/modules/features/payroll/PayrollProjectContext.js';
import {captureAttendancePositionAssignments} from '/js/modules/features/employees/EmployeePositionAssignments.js';
import {setProjectsEnabled} from '/js/modules/config/FeatureFlags.js';
import {setActivePayrollConfig} from '/js/modules/features/payroll/ActivePayrollSettings.js';
import * as configStore from '/js/modules/features/payroll/ProjectPayrollConfigStore.js';
import {replaceEntityScope} from '/js/modules/features/projects/EntityProjectScope.js';
const employees=[{id:'juan',key:'juan',projectId:'P',number:'113',name:'Juan Pérez',active:true,hireDate:'2026-01-01',positions:['p1','p2'],loans:[],bonuses:[],deductions:[]},{id:'rosa',projectId:'P',number:'024',name:'Rosa Díaz',active:true,positions:['p3'],loans:[],bonuses:[],deductions:[]}];
const positions=[{id:'p1',projectId:'P',name:'Albañil',leaderId:'L1',hourlyRate:112.5,active:true,workingDays:[0,1,2,3,4,5,6]},{id:'p2',projectId:'P',name:'Electricista',leaderId:'L2',hourlyRate:112.5,active:true,workingDays:[0,1,2,3,4,5,6]},{id:'p3',projectId:'P',name:'Ayudante',leaderId:'L2',hourlyRate:62.5,active:true,workingDays:[0,1,2,3,4,5,6]}];
const config={projectId:'P',updatedAt:1,schemaVersion:1,regularHoursPerDay:8,overtimeFactor:1.35,holidayFactor:2,restDayFactor:1.5,holidays:[],payPeriod:{periodStart:'2026-11-01',periodLength:15,payDay:'2026-11-16'},payrollDefaults:{version:2,bonuses:[],deductions:[]}};
setProjectsEnabled(false);replaceEntityScope({enabled:false});
stateManager.setState({employees,positions,leaders:[{id:'L1',projectId:'P',name:'Luis',active:true},{id:'L2',projectId:'P',name:'Marcos',active:true}],attendance:{},settings:{...state.settings,...config},exportConfig:{leaderFilter:'all',deductions:[],bonuses:[],rememberedGlobalsHydrated:true},payrollViewMode:'generator'},{silent:true});
window.alerts=[];window.showAlert=message=>alerts.push(message);window.showNotification=()=>{};window.alert=message=>alerts.push(message);window.currentUser={uid:'fixture'};
EmployeesUI.init({state,render:()=>{},saveToLocalStorage:()=>{window.saved=true},services:{}});
EmployeeModal.open('juan',{inlineHost:document.getElementById('editor')});window.auditState=state;
window.showPayroll=async()=>{
 document.getElementById('editor').hidden=true;setProjectsEnabled(true);replaceEntityScope({enabled:true,projectId:'P',defaultProjectId:'P'});
 stateManager.batchSetState(raw=>{for(const [employeeId,position] of [['juan','p2'],['rosa','p3']]){const record={employeeId,projectId:'P',date:'2026-11-09',present:true,selectedPosition:position,hoursWorked:8,overtimeHours:0};raw.attendance[employeeId+'-2026-11-09']=captureAttendancePositionAssignments(record,state);}});
 const runtime=new ProjectPayrollUIRuntime({state,configStore:{getConfig:async()=>config},projectContext:{subscribe:()=>()=>{}},captureContext:s=>capturePayrollProjectContext(s)});
 window.PayrollUI=UI;window.paint=()=>document.getElementById('screen').innerHTML=UI.PayrollTab();UI.init({state,services:{payroll:{},payrollRuntime:runtime},render:paint,saveToLocalStorage:()=>{}});
 await UI.refreshScopedPayrollPreview({periodStart:'2026-11-09',periodEnd:'2026-11-09'});UI.setPayrollGuideStep('review');UI.setLeaderFilter('L2');paint();
};
window.showMetricsEditor=async()=>{
 document.getElementById('screen').hidden=true;document.getElementById('editor').hidden=false;
 await configStore.putConfig(config);setActivePayrollConfig(config,{render:false});
 stateManager.batchSetState(raw=>{raw.attendance={};});
 EmployeesUI.init({state,render:()=>{},saveToLocalStorage:()=>{},services:{ensureAttendanceRange:(start,end)=>new Promise(resolve=>{
  window.metricsPeriod={start,end};window.completeMetrics=()=>{stateManager.batchSetState(raw=>{const record={employeeId:'juan',projectId:'P',date:'2026-11-09',present:true,selectedPosition:'p2',hoursWorked:8,overtimeHours:0};raw.attendance={'juan-2026-11-09':captureAttendancePositionAssignments(record,state)};});resolve();};
 })}});
 EmployeeModal.open('juan',{inlineHost:document.getElementById('editor')});
};window.ready=true;
</script></body></html>`;
const server = http.createServer((req,res) => {
 const name=new URL(req.url,'http://fixture').pathname;
 if(name==='/fixture'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
 if(name==='/js/modules/data/firebase.js'){res.setHeader('Content-Type','text/javascript');res.end(firebase);return;}
 const file=path.resolve(ROOT,'.'+name);if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,body)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream');res.end(body);});
});
(async()=>{
 fs.mkdirSync(output,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const {default:puppeteer}=await import('puppeteer-core');const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try {
 const origin='http://127.0.0.1:'+server.address().port;
 for(const width of [320,390,1280]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewport({width,height:1000});await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)||r.url().startsWith('data:')||r.url().startsWith('blob:')?r.continue():r.abort());
  await page.goto(origin+'/fixture');await page.waitForFunction(()=>window.ready);
  const primary='[data-position-assignment="p1"]',secondary='[data-position-assignment="p2"]';
  assert.equal(await page.$eval(primary+' [data-position-work-leader]',e=>e.value),'L1');
  await page.select(primary+' [data-position-work-leader]','L2');assert.equal(await page.$eval(secondary+' [data-position-payer]',e=>e.value),'L2');
  await page.click(secondary+' [data-position-loan-switch]');await page.select(secondary+' [data-position-payer]','L1');
  await page.select(primary+' [data-position-work-leader]','L1');assert.equal(await page.$eval(secondary+' [data-position-payer]',e=>e.value),'L1');
  await page.click(secondary+' [data-position-leader-help]');await page.waitForSelector('[data-modal-overlay] .employee-position-role-help');
  await page.screenshot({path:path.join(output,'ayuda-'+width+'.png')});await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.employee-position-role-help'));
  assert.equal(await page.$eval(secondary+' [data-position-work-leader]',e=>e.value),'L2');
  await page.click(secondary+' [data-position-loan-switch]');assert.equal(await page.$eval(secondary+' [data-position-work-leader]',e=>e.closest('[inert]')),null);
  await page.click(secondary+' [data-position-loan-switch]');await page.screenshot({path:path.join(output,'editor-'+width+'.png')});
  await page.click('#editor [data-button-index="1"]');await page.waitForFunction(()=>window.saved||alerts.length);
  assert.deepEqual(await page.evaluate(()=>alerts),[]);assert.equal(await page.evaluate(()=>auditState.employees[0].positionAssignments.p2.isLoanPosition),true);
  await page.evaluate(()=>window.showPayroll());await page.waitForSelector('.payroll-leader-adjustment');
  assert.equal(await page.$$eval('.payroll-leader-adjustment',nodes=>nodes.length),1);
  assert.match(await page.$eval('.payroll-leader-adjustment__balance',e=>e.textContent),/−\$400/);
  await page.$eval('.payroll-leader-adjustment summary',e=>e.scrollIntoView({block:'center'}));
  await page.click('.payroll-leader-adjustment summary');await page.click('[data-payroll-leader-adjustment]');
  assert.match(await page.$eval('.payroll-leader-adjustment__balance',e=>e.textContent),/\$500/);
  assert.equal(await page.$eval('.payroll-leader-adjustment details',e=>e.open),true);
  await page.click('[data-payroll-leader-adjustment]');await page.screenshot({path:path.join(output,'nomina-'+width+'.png')});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  await page.addScriptTag({path:path.join(ROOT,'node_modules/axe-core/axe.min.js')});
  const violations=await page.evaluate(async()=>(await axe.run('.payroll-leader-adjustment',{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
  assert.deepEqual(violations,[]);
  await page.evaluate(()=>window.showMetricsEditor());await page.waitForFunction(()=>typeof window.completeMetrics==='function');
  assert.deepEqual(await page.evaluate(()=>window.metricsPeriod),{start:'2026-11-01',end:'2026-11-15'});
  assert.equal(await page.$eval(secondary+' [data-position-days]',e=>e.textContent),'—');
  await page.$eval(secondary+' .custom-salary-input',e=>{window.metricsInput=e;e.value='123';e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();});
  await page.evaluate(()=>window.completeMetrics());await page.waitForFunction(()=>document.querySelector('[data-employee-position-editor]').getAttribute('aria-busy')==='false');
  assert.equal(await page.$eval(secondary+' [data-position-days]',e=>e.textContent),'1');
  assert.equal(await page.$eval(secondary+' [data-position-total-hours]',e=>e.textContent),'8h');
  assert.equal(await page.$eval(secondary+' .custom-salary-input',e=>e===window.metricsInput&&e.value==='123'),true);
  await page.$eval(secondary,e=>e.scrollIntoView({block:'center'}));
  await page.screenshot({path:path.join(output,'metricas-'+width+'.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS '+width+'px: defaults/override/payer, real editor save, help, leader salary −400/500, independent detail/checkbox, scoped metrics hydration preserving edits and WCAG A/AA');
  await context.close();
 }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

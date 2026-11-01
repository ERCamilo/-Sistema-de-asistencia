#!/usr/bin/env node
// Synthetic 30-employee project; real LoansLedger and payroll rules, no accounts.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const names=fs.readFileSync(path.join(ROOT,'js/modules/data/firebase.js'),'utf8').match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g,'').split(',').map(n=>n.trim()).filter(Boolean);
const stub=names.map(n=>n==='auth'?'export const auth={currentUser:null};':`export const ${n}=()=>{};`).join('\n');
const fixture=`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="screen"></div><script type="module">
import {state,stateManager} from '/js/modules/core/AppState.js';
import {LoansLedger} from '/js/modules/features/loans/LoansLedger.js';
import {buildPortfolioModel} from '/js/modules/features/loans/LoanPortfolioView.js';
import {renderLoanHistoryPanel,resetLoanHistoryPanels,toggleLoanHistory,setLoanHistoryView} from '/js/modules/features/loans/LoanHistoryPanel.js';
import {setProjectsEnabled} from '/js/modules/config/FeatureFlags.js';
import {replaceEntityScope} from '/js/modules/features/projects/EntityProjectScope.js';
import {setActivePayrollConfig} from '/js/modules/features/payroll/ActivePayrollSettings.js';
import {getDateKey} from '/js/modules/utils/DateUtils.js';
window.render=()=>{};
window.seed=({count=30,days=120,projects=true}={})=>{
 const today=getDateKey(new Date()), employees=[], attendance={};
 const settings={regularHoursPerDay:8,overtimeFactor:1.5,holidayFactor:2,restDayFactor:1,holidays:[],payPeriod:{periodStart:'2026-01-01',periodLength:21,payDay:'2026-01-23'}};
 for(let i=0;i<count;i++){
  const emp={id:'e'+i,name:'Empleado '+i,number:String(i+1),active:true,positions:['p'],projectId:'A',loans:[],bonuses:[],deductions:[]};
  for(let j=0;j<3;j++)emp.loans.push({id:emp.id+'l'+j,number:j+1,principal:3000+j*100,interestRate:20,startDate:'2024-0'+(j+1)+'-05',createdAt:100+j,status:'active',dueDate:'2026-10-01',refinancings:[],payments:Array.from({length:12},(_,k)=>({id:'p'+k,date:'2025-'+String(k+1).padStart(2,'0')+'-10',amount:50,recordedAt:1000+k,source:'cash'}))});
  employees.push(emp);
  for(let n=0;n<days;n++){const date=new Date();date.setDate(date.getDate()-n);const key=getDateKey(date);attendance[emp.id+'-'+key]={employeeId:emp.id,date:key,present:true,hoursWorked:8,overtimeHours:0,selectedPosition:'p',projectId:'A'};}
 }
 setProjectsEnabled(projects);replaceEntityScope({enabled:projects,projectId:'A',defaultProjectId:'A'});
 stateManager.setState({employees,attendance,positions:[{id:'p',name:'Albañil',hourlyRate:100,workingDays:[0,1,2,3,4,5,6],projectId:'A'}],settings,loansLedger:null},{silent:true});
 setActivePayrollConfig({...settings,projectId:'A'},{render:false});resetLoanHistoryPanels();
 return {employees:count,loans:count*3,payments:count*36,attendance:Object.keys(attendance).length};
};
window.bench=()=>{
 const employees=stateManager.getState().employees;
 const measure=fn=>{const start=performance.now();const result=fn();return {ms:Math.round(performance.now()-start),result};};
 const cold=measure(()=>LoansLedger());const warm=measure(()=>LoansLedger());
 const model=measure(()=>buildPortfolioModel(employees));
 resetLoanHistoryPanels();const closed=measure(()=>renderLoanHistoryPanel({scope:'bench',employees,variant:'portfolio'}));
 toggleLoanHistory('bench');setLoanHistoryView('bench','period');const open=measure(()=>renderLoanHistoryPanel({scope:'bench',employees,variant:'portfolio'}));
 const reopen=measure(()=>renderLoanHistoryPanel({scope:'bench',employees,variant:'portfolio'}));
 return {coldMs:cold.ms,warmMs:warm.ms,modelMs:model.ms,closedHistoryMs:closed.ms,openHistoryMs:open.ms,repeatedHistoryMs:reopen.ms,htmlBytes:cold.result.length,salary:model.result.risk[0]?.salary?.value,balance:model.result.summary.porCobrar.total};
};window.ready=true;
</script></body></html>`;
(async()=>{
 const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://fixture').pathname;
 if(pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}
 if(pathname==='/js/modules/data/firebase.js'){res.setHeader('Content-Type','text/javascript');return res.end(stub);}
 const file=path.resolve(ROOT,'.'+decodeURIComponent(pathname));if(!file.startsWith(ROOT+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,body)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',path.extname(file)==='.js'?'text/javascript':'text/plain');res.end(body);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 const {default:puppeteer}=await import(ROOT+'/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js');browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:240000});
 const page=await browser.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');await page.waitForFunction(()=>window.ready);
 const client=await page.createCDPSession();await client.send('Emulation.setCPUThrottlingRate',{rate:4});
 const seed=await page.evaluate(()=>window.seed());
 const result=await page.evaluate(()=>window.bench());
 assert.equal(result.balance,280800);assert.equal(result.salary,16800);
 assert.ok(result.coldMs<8000, 'Loans first render copied too much data: '+JSON.stringify({seed,...result}));
 assert.ok(result.warmMs<1000, 'Unchanged render is too slow: '+JSON.stringify(result));
 assert.deepEqual(errors,[]);
 console.log('PASS loans, CPU 4x:',JSON.stringify({seed,...result}));

 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

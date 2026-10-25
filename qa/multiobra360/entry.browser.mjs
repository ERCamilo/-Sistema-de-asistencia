
import idb from '/js/modules/services/IndexedDBService.js';
import * as fb from '/js/modules/data/firebase.js';
import * as catalog from '/js/modules/features/projects/ProjectCatalogSync.js';
import * as ctx from '/js/modules/features/projects/ProjectContext.js';
import * as scope from '/js/modules/features/projects/EntityProjectScope.js';
import * as flags from '/js/modules/config/FeatureFlags.js';
import * as configs from '/js/modules/features/payroll/ProjectPayrollConfigStore.js';
import * as active from '/js/modules/features/payroll/ActivePayrollSettings.js';
import * as guard from '/js/modules/services/DetachedRestoreGuard.js';
import { askDetachedRestoreChoice } from '/js/modules/ui/DetachedRestoreChoiceModal.js';
import { state, stateManager } from '/js/modules/core/AppState.js';
import { DateControlsCompact, attachAttendanceDelegation } from '/js/modules/ui/AttendanceUI.js';
import '/js/modules/ui/AttendanceHandlers.js';
import { mountProjectList } from '/js/modules/features/projects/ProjectListUI.js';
import { projectSetupService } from '/js/modules/features/projects/ProjectSetupService.js';
import { openProjectSetupModal } from '/js/modules/features/projects/ProjectsUI.js';
import { createDefaultConfig } from '/js/modules/features/payroll/ProjectPayrollConfig.js';
import { buildPayrollClosure,buildPayrollClosureSnapshot,promoteLegacyPayrollClosure } from '/js/modules/features/payroll/PayrollClosure.js';

const DATE='2026-10-24';
const options=JSON.parse(document.querySelector('#audit-options').textContent);
const clone=x=>JSON.parse(JSON.stringify(x));
const project=(id,updatedAt=1)=>({id,name:'Synthetic '+id,status:'active',createdAt:1,updatedAt,schemaVersion:1});
const cfg=(id,hours=8,updatedAt=1)=>({...createDefaultConfig(id),regularHoursPerDay:hours,dayHours:{[DATE]:hours},updatedAt});
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function check(condition,message,actual){if(!condition){const e=new Error(message+'; actual='+JSON.stringify(actual));e.name='AcceptanceFailure';throw e;}}
async function until(fn,message){const end=performance.now()+6000;while(performance.now()<end){const result=await fn();if(result)return result;await new Promise(requestAnimationFrame);}throw new Error('HARNESS_TIMEOUT: '+message);}
const click=selector=>window.auditHostClick(selector);
const fill=(selector,value)=>window.auditHostFill(selector,value);
const docRef=id=>fb.doc(fb.db,'users',fb.auth.currentUser?.uid||options.uid,'projectsV1',id);
const remoteSet=(id,data)=>fb.setDoc(docRef(id),data,{merge:true});
const remoteGet=async id=>(await fb.getDoc(docRef(id))).data();
const remoteList=async()=>{const s=await fb.getDocs(fb.collection(fb.db,'users',fb.auth.currentUser?.uid||options.uid,'projectsV1'));return s.docs.map(d=>d.data());};
const sync=opts=>catalog.syncProjectCatalog({uid:fb.auth.currentUser?.uid,idb,...opts});
let handle;
function render(){
 const settings=active.getActivePayrollSettings(state);
 document.querySelector('#metrics').textContent=JSON.stringify({scope:scope.peekEntityScope(),settings,hours:active.getActiveDayHours(state)});
 document.querySelector('#attendance').innerHTML=DateControlsCompact();
 const employees=scope.getScopedEmployees(state);
 document.querySelector('#staff').replaceChildren(...employees.map(e=>{const el=document.createElement('li');el.textContent=e.name;el.dataset.employee=e.id;return el;}));
}
function dayText(){const button=document.querySelector('[data-att-action="change-base-hours"]');return button?.parentElement.textContent.replace(/\s/g,'');}
async function mount(){
 handle?.destroy?.();
 handle=mountProjectList(document.querySelector('#projects'),{
  projects:await ctx.projectContext.store.listAll(),activeProjectId:scope.peekEntityScope().projectId,defaultProjectId:'A',allowSwitch:true,
  onSwitchProject:async(id,button)=>{
   button.disabled=true;
   try{await projectSetupService.switchActiveProject(id);await active.refreshActivePayrollSettings();render();document.querySelector('#switch-status').textContent=id;}
   catch(error){window.auditUIError=error.message;}
   finally{button.disabled=false;}
  }
 });
}
async function setConfig(id,hours,time=1,seeded=false){const c={...cfg(id,hours,time),...(seeded?{seeded:true}:{})};await idb.update('projectPayrollConfigs',c);if(id===scope.peekEntityScope().projectId)active.setActivePayrollConfig(c);render();return c;}
async function immutableSnapshot(){
 const out={};for(const store of ['employees','positions','leaders','attendance','payrollClosures'])out[store]=await idb.getAll(store);return clone(out);
}
async function setup(){
 flags.setProjectsEnabled(true);
 idb.dbName='sa-multiobra360-browser-'+options.caseId;
 await idb.init();
 if(!sessionStorage.getItem('seeded')){
  for(const id of ['A','B','C']){await idb.update('projects',project(id));await idb.update('projectPayrollConfigs',cfg(id,id==='B'?6:8));}
  await idb.update('employees',{id:'EMP-A',number:'1',name:'Synthetic employee A',projectId:'A',positionId:'POS-A',active:true,loans:[{id:'LOAN-A',principal:2500,payments:[{id:'PAY-A',amount:100,date:DATE}]}]});
  await idb.update('employees',{id:'EMP-B',number:'2',name:'Synthetic employee B',projectId:'B',positionId:'POS-B',active:true,loans:[]});
  for(const id of ['A','B'])await idb.update('positions',{id:'POS-'+id,name:'Synthetic position '+id,projectId:id,salary:1000});
  await idb.update('attendance',{key:'EMP-A-'+DATE,employeeId:'EMP-A',date:DATE,projectId:'A',present:true,hours:8});
  const closureOptions={periodStart:'2026-10-01',periodEnd:'2026-10-15',closedAt:1,rows:[{_employeeId:'EMP-A',_number:'1',_employeeName:'Synthetic employee A',_brutoOriginal:1000,_loans:100,_payments:0,_extraHours:0,_positionName:'Synthetic position A',_days:1,_hours:8,monto:900}]};
  const legacy=buildPayrollClosure({...closureOptions,fingerprint:JSON.stringify(buildPayrollClosureSnapshot(closureOptions))});
  await idb.update('payrollClosures',promoteLegacyPayrollClosure(legacy,'A'));
  localStorage.setItem(ctx.ACTIVE_PROJECT_LS_KEY,'A');localStorage.setItem(scope.DEFAULT_PROJECT_LS_KEY,'A');sessionStorage.setItem('seeded','1');
 }
 scope.replaceEntityScope({enabled:true,projectId:localStorage.getItem(ctx.ACTIVE_PROJECT_LS_KEY)||'A',defaultProjectId:'A'});
 stateManager.setState({
  employees:await idb.getAll('employees'),positions:await idb.getAll('positions'),leaders:[],attendance:{},
  selectedDate:new Date('2026-10-24T12:00:00'),viewMode:'day',activeTab:'attendance',isScrolled:true,
  settings:{...state.settings,regularHoursPerDay:8,payPeriod:{periodStart:'2026-10-01',periodLength:15},holidays:[]},dayHoursConfig:{[DATE]:8}
 },{silent:true});
 window.render=render;window.showNotification=()=>{};
 attachAttendanceDelegation();await active.refreshActivePayrollSettings();await mount();render();
 document.querySelector('#sync').onclick=async()=>{try{await sync();render();document.querySelector('#sync-status').textContent='done';}catch(e){window.auditUIError=e.message;}};
 document.querySelector('#setup').onclick=openProjectSetupModal;
 window.__audit={idb,fb,catalog,ctx,scope,active,guard,configs,sync,remoteGet,remoteSet,remoteList,project,cfg,setConfig,render,mount,immutableSnapshot,dayText};
 window.auditReady=true;
}
const cases={};
function scenario(id,point,title,fn){cases[id]={id,point,title,fn};}
scenario('r1-control','R1','same-account download reaches durable local catalog',async()=>{
 await remoteSet('REMOTE',project('REMOTE'));await click('#sync');await until(()=>document.querySelector('#sync-status').textContent==='done','sync');
 check((await idb.get('projects','REMOTE'))?.id==='REMOTE','R1 same-account project must be downloaded');
});
for(const transition of ['logout','account-change'])scenario('r1-'+transition,'R1','late response after '+transition,async()=>{
 await remoteSet('FOREIGN',project('FOREIGN'));const reached=defer(),release=defer();
 const pending=sync({readDocs:async ref=>{const snapshot=await fb.getDocs(ref);reached.resolve();await release.promise;return snapshot;}});
 await reached.promise;catalog.stopProjectCatalogLiveSync();fb.useAuditUser(transition==='logout'?null:'audit-next-owner');
 release.resolve();await pending;
 check(!(await idb.get('projects','FOREIGN')),'R1 previous-session response must not enter the current dataset');
});
scenario('r2-config','R2','real attendance edit wins over a delayed remote config',async()=>{
 await remoteSet('A',{...project('A'),payrollConfig:cfg('A',9,50)});
 const get=idb.get.bind(idb),reached=defer(),release=defer();let first=true;
 idb.get=async(store,id)=>{const value=await get(store,id);if(store==='projectPayrollConfigs'&&id==='A'&&first){first=false;reached.resolve();await release.promise;}return value;};
 const pending=sync();
 try{
  await Promise.race([reached.promise,pending]);await click('[data-att-action="change-base-hours"][data-value="0.5"]');
  await until(async()=>((await get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===8.5),'durable UI hours edit');
 }finally{release.resolve();}
 await pending;idb.get=get;render();
 check((await get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===8.5,'R2 stale remote must not overwrite the confirmed UI edit',await get('projectPayrollConfigs','A'));
});
scenario('r2-identity','R2','actual project rename is protected by the catalog transaction',async()=>{
 await remoteSet('A',{...project('A',50),name:'Remote old',payrollConfig:cfg('A',8)});
 const getAll=idb.getAll.bind(idb),reached=defer(),release=defer();let first=true;
 idb.getAll=async store=>{const result=await getAll(store);if(store==='projects'&&first){first=false;reached.resolve();await release.promise;}return result;};
 const pending=sync();
 try{
  await Promise.race([reached.promise,pending]);await click('#setup');await until(()=>document.querySelector('[data-project-name]'),'project settings dialog');
  await fill('[data-project-name]','Synthetic newest local');await click('[data-project-rename]');
  await until(async()=>(await idb.get('projects','A'))?.name==='Synthetic newest local','durable rename');
 }finally{release.resolve();}
 await pending;idb.getAll=getAll;
 check((await idb.get('projects','A'))?.name==='Synthetic newest local','R2 newer local project name must survive');
});
function gateChoice(upload){guard.markDetachedRestore({previousUid:options.uid});return guard.runDetachedRestoreLoginGate({
 user:fb.auth.currentUser,ask:()=>askDetachedRestoreChoice({email:'audit@invalid',marker:guard.getDetachedRestore()}),
 upload:upload||(async()=>{await sync();return{ok:true};}),useCloud:async()=>({ok:true}),logout:async()=>{}
});}
scenario('r3-pending','R3','real restore choice dialog blocks unrelated catalog publication',async()=>{
 const pending=gateChoice();
 try{
  await until(()=>document.querySelector('#detached-restore-choice'),'restore choice');
  check(document.querySelector('#detached-restore-choice [data-confirm]').disabled,'R3 continue is disabled without a selection');
  await sync();
  check((await remoteList()).length===0,'R3 restored projects must not be uploaded while the user is choosing',await remoteList());
 }finally{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pending;}
});
for(const choice of ['upload','logout','cloud'])scenario('r3-'+choice,'R3','real restore dialog choice '+choice,async()=>{
 const pending=gateChoice();await until(()=>document.querySelector('#detached-restore-choice'),'restore choice');
 await click('[data-choice="'+choice+'"]');await click('#detached-restore-choice [data-confirm]');const result=await pending;
 check(!document.querySelector('#detached-restore-choice'),'R3 dialog closes after explicit choice');
 if(choice==='upload'){check(result.proceed,'R3 authorized upload proceeds',result);check((await remoteList()).some(p=>p.id==='A'),'R3 authorized catalog uploaded');check(!guard.getDetachedRestore(),'R3 successful upload clears marker');}
 else{check(!result.proceed,'R3 no normal startup for logout/cloud',result);check((await remoteList()).length===0,'R3 non-upload choices must not publish');}
});
scenario('r4-event','R4','remote B configuration cannot replace visible A hours',async()=>{
 await setConfig('A',9,100);await remoteSet('A',{...project('A'),payrollConfig:cfg('A',9,100)});await remoteSet('B',{...project('B'),payrollConfig:cfg('B',6,200)});
 await sync();render();
 check(active.getActivePayrollSettings(state).regularHoursPerDay===9,'R4 A keeps its payroll settings',active.getActivePayrollSettings(state).regularHoursPerDay);
 check(dayText()?.includes('9'),'R4 actual attendance control keeps 9 hours',dayText());
});
scenario('r4-save','R4','late A save cannot replace newly selected B visible hours',async()=>{
 const update=idb.update.bind(idb),reached=defer(),release=defer();let pending;
 idb.update=async(store,record)=>{if(store==='projectPayrollConfigs'&&record.projectId==='A'){reached.resolve();await release.promise;}return update(store,record);};
 try{
  await click('[data-att-action="change-base-hours"][data-value="0.5"]');await reached.promise;
  await click('[data-project-switch="B"]');await until(()=>document.querySelector('#switch-status').textContent==='B','B selection');
 }finally{release.resolve();}
 await until(async()=>(await idb.get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===8.5,'A save completion');
 await new Promise(requestAnimationFrame);idb.update=update;render();
 check(active.getActivePayrollSettings(state).regularHoursPerDay===6,'R4 B retains its configuration after A completion',active.getActivePayrollSettings(state).regularHoursPerDay);
 check(dayText()?.includes('6'),'R4 actual B control keeps 6 hours',dayText());
});
for(const [id,start,delta,end] of [['r5-edit',8,.5,8.5],['r5-zero',.5,-.5,0],['r5-max',23.5,.5,24]])scenario(id,'R5','explicit seeded hours survive cloud sync ('+end+'h)',async()=>{
 const seeded=await setConfig('A',8,1,true);seeded.dayHours[DATE]=start;await idb.update('projectPayrollConfigs',seeded);active.setActivePayrollConfig(seeded);render();await remoteSet('A',{...project('A'),payrollConfig:{...cfg('A',8,50),dayHours:{[DATE]:start}}});
 await click('[data-att-action="change-base-hours"][data-value="'+delta+'"]');
 await until(async()=>(await idb.get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===end,'seeded hours save');
 const edited=await idb.get('projectPayrollConfigs','A');await sync();render();
 check((await idb.get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===end,'R5 explicit edit must not be discarded as an untouched seed',{edited,final:await idb.get('projectPayrollConfigs','A')});
});
scenario('r5-nonseed-control','R5','non-seed UI edit persists and publishes',async()=>{
 await setConfig('A',8,1,false);await remoteSet('A',{...project('A'),payrollConfig:cfg('A',8,1)});
 await click('[data-att-action="change-base-hours"][data-value="0.5"]');
 await until(async()=>(await idb.get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===8.5,'non-seed save');
 await sync();check((await remoteGet('A'))?.payrollConfig?.dayHours?.[DATE]===8.5,'R5 edited hours reach Firestore');
});
scenario('r6-scope','R6','old scope resolver cannot undo a completed actual project switch',async()=>{
 await setConfig('A',9);const defaults=ctx.projectContext.defaults,ensure=defaults.ensureDefaultProject.bind(defaults),reached=defer(),release=defer();let first=true;
 defaults.ensureDefaultProject=async()=>{if(first){first=false;reached.resolve();await release.promise;}return ensure();};
 const pending=ctx.getEntityScope();
 try{await reached.promise;await click('[data-project-switch="B"]');await until(()=>document.querySelector('#switch-status').textContent==='B','B switch completes');}
 finally{release.resolve();}
 await pending;defaults.ensureDefaultProject=ensure;render();
 check(localStorage.getItem(ctx.ACTIVE_PROJECT_LS_KEY)==='B','R6 preference is B');
 check(scope.peekEntityScope().projectId==='B','R6 filters must agree with the selected B',scope.peekEntityScope());
 check(document.querySelector('[data-employee="EMP-B"]')&&!document.querySelector('[data-employee="EMP-A"]'),'R6 actual roster keeps only B employees');
});
scenario('r6-queue-control','R6','two actual selector clicks preserve the latest request',async()=>{
 await click('[data-project-switch="B"]');await click('[data-project-switch="C"]');
 await until(()=>document.querySelector('#switch-status').textContent==='C','C switch');
 check(scope.peekEntityScope().projectId==='C','R6 latest queued UI request is C',scope.peekEntityScope());
 check(localStorage.getItem(ctx.ACTIVE_PROJECT_LS_KEY)==='C','R6 preference and scope agree');
});
scenario('r7-control','R7','real attendance edit publishes and survives browser reload',async()=>{
 await remoteSet('A',{...project('A'),payrollConfig:cfg('A',8)});
 await click('[data-att-action="change-base-hours"][data-value="0.5"]');
 await until(async()=>(await idb.get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===8.5,'local UI edit');
 await sync();check((await remoteGet('A'))?.payrollConfig?.dayHours?.[DATE]===8.5,'R7 confirmed cloud edit is current');
});
// Dual-device R7 cases are orchestrated by browser.cjs with separate contexts.

scenario('r1-new-session-read','R1','new account performs its own SDK read while previous account is pending',async()=>{
 await remoteSet('OLD-ACCOUNT',project('OLD-ACCOUNT'));
 const reached=defer(),release=defer();
 const old=sync({readDocs:async ref=>{const s=await fb.getDocs(ref);reached.resolve();await release.promise;return s;}});
 await reached.promise;catalog.stopProjectCatalogLiveSync();fb.useAuditUser('audit-owner-next');
 await remoteSet('NEW-ACCOUNT',project('NEW-ACCOUNT'));
 let reads=0;const next=sync({readDocs:async ref=>{reads++;return fb.getDocs(ref);}});
 release.resolve();await Promise.all([old,next]);
 check(reads===1,'R1 new account must execute its own SDK read',reads);
 check((await idb.get('projects','NEW-ACCOUNT'))?.id==='NEW-ACCOUNT','R1 new-account response reaches its own local dataset');
});
scenario('r3-escape-control','R3','Escape in the real restore dialog keeps the pending decision without uploading',async()=>{
 const pending=gateChoice();await until(()=>document.querySelector('#detached-restore-choice'),'restore dialog');
 await window.auditHostKey('Escape');const result=await pending;
 check(!result.proceed,'R3 Escape prevents normal startup',result);
 check(guard.getDetachedRestore(),'R3 Escape preserves the durable pending marker');
 check((await remoteList()).length===0,'R3 Escape must not upload');
});
scenario('r3-failed-upload-control','R3','failed upload in the real restore dialog retains the pending decision',async()=>{
 const pending=gateChoice(async()=>{throw Error('synthetic upload failure');});
 await until(()=>document.querySelector('#detached-restore-choice'),'restore dialog');await click('[data-choice="upload"]');await click('#detached-restore-choice [data-confirm]');
 const result=await pending;
 check(result.ok===false&&!result.proceed,'R3 failed upload cannot complete the decision',result);
 check(guard.getDetachedRestore(),'R3 failed upload preserves the durable marker');
 check((await remoteList()).length===0,'R3 failure has not published data');
});
scenario('r5-reload','R5','seeded UI edit survives reload and a subsequent older cloud response',async()=>{
 if(!sessionStorage.getItem('r5-reload-phase')){
  await setConfig('A',8,1,true);await remoteSet('A',{...project('A'),payrollConfig:cfg('A',8,50)});
  await click('[data-att-action="change-base-hours"][data-value="0.5"]');
  await until(async()=>(await idb.get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===8.5,'seeded edit before reload');
  sessionStorage.setItem('r5-reload-phase','saved');return{reload:true};
 }
 check((await idb.get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===8.5,'R5 native IDB must retain the edit over reload');
 check(dayText()?.includes('8.5'),'R5 actual control restores the edited hours after reload',dayText());
 await sync();render();
 check((await idb.get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===8.5,'R5 reloaded explicit edit must survive older cloud data',await idb.get('projectPayrollConfigs','A'));
});


for(const [id,hours,delta] of [['r5-lower-limit-control',0,-.5],['r5-upper-limit-control',24,.5]])scenario(id,'R5','actual hours stepper clamps at '+hours,async()=>{
 const base=await setConfig('A',8,1,false);base.dayHours[DATE]=hours;await idb.update('projectPayrollConfigs',base);active.setActivePayrollConfig(base);render();
 await click('[data-att-action="change-base-hours"][data-value="'+delta+'"]');
 await until(async()=>(await idb.get('projectPayrollConfigs','A'))?.updatedAt>1,'boundary stepper save');
 check((await idb.get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===hours,'R5 native stepper must remain within 0..24h',await idb.get('projectPayrollConfigs','A'));
});


for(const transition of ['account-switch','detached-restore'])scenario('review-post-read-'+transition,'REVIEW','guard changes after Firestore read and before native IDB commit',async()=>{
 await remoteSet('FOREIGN',project('FOREIGN'));
 const original=idb.getAll.bind(idb),reached=defer(),release=defer();let first=true;
 idb.getAll=async name=>{const rows=await original(name);if(name==='projects'&&first){first=false;reached.resolve();await release.promise;}return rows;};
 const pending=sync();
 try{
  await reached.promise;
  if(transition==='account-switch'){catalog.stopProjectCatalogLiveSync();fb.useAuditUser('review-next-owner');}
  else guard.markDetachedRestore({previousUid:fb.auth.currentUser.uid});
 }finally{release.resolve();}
 await pending;idb.getAll=original;
 const value=await idb.get('projects','FOREIGN');
 check(!value,'review: stale catalog must not enter local dataset after guard transition',value);
});
scenario('review-refresh-same-project','REVIEW','late native IDB read cannot undo a real newer attendance click',async()=>{
 const reached=defer(),release=defer();
 const pending=active.refreshActivePayrollSettings({store:{getConfig:async id=>{const old=await idb.get('projectPayrollConfigs',id);reached.resolve();await release.promise;return old;}}});
 try{
  await reached.promise;
  await click('[data-att-action="change-base-hours"][data-value="0.5"]');
  await until(async()=>(await idb.get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===8.5,'actual new attendance click saved');
 }finally{release.resolve();}
 await pending;render();
 check((await idb.get('projectPayrollConfigs','A'))?.dayHours?.[DATE]===8.5,'review: committed edit survives');
 check(active.getActiveDayHours(state)[DATE]===8.5,'review: visible day hours match committed edit',{visible:active.getActiveDayHours(state)[DATE],text:dayText()});
});
scenario('review-control-current-refresh','REVIEW','current same-project native IDB refresh works',async()=>{
 await setConfig('A',9,100);await active.refreshActivePayrollSettings();render();
 check(active.getActiveDayHours(state)[DATE]===9,'review control: current config displays 9');
});

window.auditCases=Object.values(cases).map(({fn,...meta})=>meta);
window.runAuditCase=async id=>{
 const invariantBefore=await immutableSnapshot();
 try{
  const step=await cases[id].fn();
  check(JSON.stringify(await immutableSnapshot())===JSON.stringify(invariantBefore),'INVARIANT: employees/loans/positions/attendance/closures changed unexpectedly');
  return{ok:true,invariantOk:true,...step};
 }catch(error){const invariantOk=JSON.stringify(await immutableSnapshot())===JSON.stringify(invariantBefore);return{ok:false,kind:error.name==='AcceptanceFailure'?'assertion':'infrastructure',error:error.message,stack:error.stack,invariantOk};}
 finally{catalog.stopProjectCatalogLiveSync();}
};
setup().catch(error=>{window.auditSetupError=error.stack;});

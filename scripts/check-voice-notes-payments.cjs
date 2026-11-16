#!/usr/bin/env node
// Real UI, original save operations and IndexedDB; fictitious data, no cloud calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..');
const styles=[...fs.readFileSync(path.join(ROOT,'index.html'),'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map(m=>`<link rel="stylesheet" href="/${m[1]}">`).join('');
const names=fs.readFileSync(path.join(ROOT,'js/modules/data/firebase.js'),'utf8').match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g,'').split(',').map(n=>n.trim()).filter(Boolean);
const firebaseStub=names.map(n=>n==='auth'?'export const auth={currentUser:null};':`export const ${n}=()=>{};`).join('\n');
const fixture=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notas y abonos por voz</title>${styles}<style>body{margin:0;padding:12px}main{max-width:900px;margin:auto}</style></head><body><main id="root"></main><script type="module">
import {state,stateManager} from '/js/modules/core/AppState.js';
import {setRootComponent,render} from '/js/modules/core/RenderManager.js';
import {VoiceMvpUI} from '/js/modules/features/voice/VoiceUI.js';
import {VoiceStore} from '/js/modules/features/voice/VoiceStore.js';
import {readVoiceResponse} from '/js/modules/features/voice/VoiceCore.js';
import {createLoan} from '/js/modules/features/loans/LoansService.js';
import {LoanAccountDetail} from '/js/modules/features/loans/LoanAccountView.js';
import {openVoiceAccountPaymentDraft,laUseClassicView,laSetTab,registerLoanAccountGlobals} from '/js/modules/features/loans/LoanAccountController.js';
import {openVoiceNoteDraft,registerLegacyGlobals} from '/js/modules/features/notes/NotesController.js';
import {NoteEditorModal} from '/js/modules/features/notes/NoteEditorModal.js';
stateManager.batchSetState(()=>{
 state.settings={regularHoursPerDay:8,overtimeFactor:1.5,holidays:[],legacyNavigation:true,voiceMvpEnabled:true,payPeriod:{periodStart:'2026-08-21',periodLength:21,payDay:'2026-09-12'}};
 state.employees=[{id:'a',name:'Carlos Méndez',number:'00125',positions:[],loans:[]},{id:'b',name:'Carla Medina',number:'00126',positions:[],loans:[]}];state.attendance={};state.loansLedger={selectedEmployeeId:'a',account:{tab:'loans',modal:null}};
});
createLoan(state.employees[0],{principal:1000,interestRate:20,interestIncluded:false,installmentMode:'lump',startDate:'2026-10-01',dueDate:'2026-12-01'});
window.state=state;window.saveCount=0;
window.showNotification=(message)=>{window.lastNotice=message;};window.showAlert=window.showNotification;
registerLegacyGlobals();registerLoanAccountGlobals();
setRootComponent(()=>'<main><h1>Prueba de voz</h1><button id="note" onclick="startAction(&quot;crear_nota&quot;)">Nota por voz</button> <button id="payment" onclick="startAction(&quot;registrar_abono&quot;)">Abono por voz</button>'+ (state.showNoteModal?NoteEditorModal():LoanAccountDetail(state.employees[0]))+'</main>');
document.addEventListener('click',event=>{const button=event.target.closest('[data-app-fn]');if(button&&!button.disabled)window[button.dataset.appFn]?.(button.dataset.arg,button.dataset.arg2);});
const store=new VoiceStore({name:'voice-note-payment-fixture'});
window.ui=new VoiceMvpUI({getUser:()=>({uid:'fixture'}),getScope:()=>({enabled:false}),getEmployees:()=>state.employees,getSettings:()=>state.settings,isEnabled:()=>true,
 notify:window.showNotification,onNoteDraft:(id,ctx)=>openVoiceNoteDraft(id,ctx),onPaymentDraft:(id,ctx)=>{state.loansLedger.selectedEmployeeId=id;laUseClassicView(false);laSetTab('loans');openVoiceAccountPaymentDraft(id,ctx);}
},{store}).mount();
window.startAction=async intent=>{
 const r={uid:'fixture',projectKey:'legacy',requestId:crypto.randomUUID(),createdAt:Date.now(),audio:new Blob(['audio'],{type:'audio/webm'}),durationMs:2000};
 ui.record=r;
 ui.applyResult(readVoiceResponse({ok:true,schemaVersion:1,requestId:r.requestId,result:{intent,transcript:intent==='crear_nota'?'Anota que Carlos no vino':'Carlos abonó quinientos pesos',employee:{spokenName:'Carlos Méndez',spokenNumber:'00125'},loan:null,pettyCash:null,needsReview:true,issues:[],note:intent==='crear_nota'?{text:'no vino',date:null}:null,payment:intent==='registrar_abono'?{amount:500,date:null,note:'anticipo',channel:null,spokenLoanNumber:null,payrollDate:null}:null}},r.requestId));
 await store.put(r);await ui.refreshMatches();await ui.routeResult();render();
};
render();window.ready=true;
</script></body></html>`;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://fixture').pathname;
 if(pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
 if(pathname==='/js/modules/data/firebase.js'){res.setHeader('Content-Type','text/javascript');res.end(firebaseStub);return;}
 if(pathname==='/js/modules/services/PersistenceService.js' && !req.url.includes('?original')){res.setHeader('Content-Type','text/javascript');res.end('export * from \'./PersistenceService.js?original\'; export function saveApplicationData(){window.saveCount++;}');return;}
 const file=path.resolve(ROOT,'.'+pathname);if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,body)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream');res.end(body);});
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  const {default:puppeteer}=await import('puppeteer-core');browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
  const origin='http://127.0.0.1:'+server.address().port;
  for(const width of [320,390,1440]){
   const page=await browser.newPage(),errors=[],businessRequests=[];await page.setViewport({width,height:844});
   page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',req=>{if(req.url().startsWith(origin)||req.url().startsWith('blob:')||req.url().startsWith('data:'))req.continue();else{if(/n8n|firestore|identitytoolkit/i.test(req.url()))businessRequests.push(req.url());req.abort();}});
   await page.goto(origin+'/fixture');await page.waitForFunction(()=>window.ready).catch(e=>{throw Error(e.message+' — '+JSON.stringify(errors));});
   await page.click('#note');await page.waitForSelector('#note-modal-text');assert.equal(await page.$eval('#note-modal-text',el=>el.value),'no vino');assert.equal(await page.evaluate(()=>saveCount),0);
   const shot=async name=>{if(process.env.VOICE_ACTION_SHOTS){fs.mkdirSync(process.env.VOICE_ACTION_SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.VOICE_ACTION_SHOTS,width+'-'+name+'.png')});}};
   await shot('nota');await page.click('[data-app-fn=saveNoteModal]');await page.waitForFunction(()=>saveCount===1&&!state.showNoteModal);
   assert.equal(await page.evaluate(()=>Object.values(state.attendance)[0].present),false);
   await page.click('#payment');await page.waitForSelector('#la-channel');assert.equal(await page.$eval('#la-channel',el=>el.value),'');assert.equal(await page.$eval('[data-app-fn=laSave]',el=>el.disabled),true);
   await page.select('#la-channel','cash');await page.waitForFunction(()=>!document.querySelector('[data-app-fn=laSave]').disabled);await shot('abono');
   const bounds=await page.$eval('.la-md',el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};});assert.ok(bounds.left>=0&&bounds.right<=bounds.width+1,JSON.stringify(bounds));
   await page.click('[data-app-fn=laVoiceChangeEmployee]');await page.waitForSelector('[data-voice-view=employees]');assert.equal(await page.evaluate(()=>saveCount),1);
   await page.click('[data-voice-action=select][data-id=a]');await page.waitForSelector('#la-channel');assert.equal(await page.$eval('#la-channel',el=>el.value),'cash');
   await page.click('[data-app-fn=laSave]');await page.waitForFunction(()=>saveCount===2);assert.equal(await page.evaluate(()=>state.employees[0].loans[0].payments[0].amount),500);
   assert.deepEqual(errors,[]);assert.deepEqual(businessRequests,[]);console.log('Voz notas/abonos '+width+'px: original forms, review, change employee, one save, no cloud calls');await page.close();
  }
 }finally{if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

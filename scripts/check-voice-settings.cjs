#!/usr/bin/env node
// Shipped settings/voice modules, real IndexedDB and native audio; fictitious
// records and a local preference adapter. No cloud or business writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname,'..');
const styles = [...fs.readFileSync(path.join(ROOT,'index.html'),'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map(match=>`<link rel="stylesheet" href="/${match[1]}">`).join('');
const names = fs.readFileSync(path.join(ROOT,'js/modules/data/firebase.js'),'utf8').match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g,'').split(',').map(name=>name.trim()).filter(Boolean);
const firebaseStub = names.map(name=>name==='auth'?'export const auth={currentUser:null};':`export const ${name}=()=>{throw Error('Cloud disabled in voice settings fixture');};`).join('\n');
const fixture=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ajustes de Voz</title>${styles}</head><body><main id="screen" style="max-width:900px;margin:auto;padding:16px"></main><script type="module">
import {SettingsTab,initSettingsUI,commitAutoSaveOption,commitAutoSaveSwitch} from '/js/modules/ui/SettingsUI.js';
import {state,stateManager} from '/js/modules/core/AppState.js';
import {captureSettingsDraft,restoreSettingsDraft,guardSettingsDraftOnLeave} from '/js/modules/ui/settings/SettingsDraftBar.js';
import {DOMDiff} from '/js/modules/utils/DOMDiff.js';
import {createAppHistory} from '/js/modules/core/AppHistory.js';
import {VoiceSettingsUI} from '/js/modules/features/voice/VoiceSettingsUI.js';
import {VoiceNameEnrollmentUI} from '/js/modules/features/voice/VoiceNameEnrollmentUI.js';
import {VoiceStore} from '/js/modules/features/voice/VoiceStore.js';
let currentUser={uid:'voice-demo'},scope={enabled:true,projectId:'work-a'};const subscribers=new Set();
const preferenceDb=await new Promise((resolve,reject)=>{const req=indexedDB.open('voice-preferences-fixture',1);req.onupgradeneeded=()=>req.result.createObjectStore('prefs');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const saved=await new Promise(resolve=>{const req=preferenceDb.transaction('prefs').objectStore('prefs').get('settings');req.onsuccess=()=>resolve(req.result);});
const employees=[{id:'carlos',name:'Carlos Méndez',number:'00125',projectId:'work-a',positions:['mason'],active:true,loans:[{id:'loan-a',principal:500,voiceRequestId:'audio-a'}]},{id:'carla',name:'Carla Medina',number:'00126',projectId:'work-a',positions:['electric'],active:false,loans:[]}];
stateManager.batchSetState(raw=>{raw.activeTab='settings';raw.settingsActiveTab='general';Object.assign(raw.settings,{companyName:'Empresa ficticia',regularHoursPerDay:8,overtimeFactor:1.5,holidayFactor:2,restDayFactor:1.5,holidays:[],voiceMvpEnabled:true,voiceKeepLoanAudio:true,voiceAudioRetentionDays:5,...saved});raw.employees=employees;raw.positions=[{id:'mason',name:'Albañil',icon:'bricks',color:'#f6c84a'},{id:'electric',name:'Electricista',icon:'electrical',color:'#568cf6'}];raw.attendance={};});
const context={state,icons:{get:()=>'',getAvailableSets:()=>['default']},holidayService:{renderSettingsCalendar:()=>''},get currentUser(){return currentUser;},calculateStorageStats:()=>({percentage:0,usedMB:0,available:'5MB'})};
initSettingsUI(context);
window.draw=()=>{const draft=captureSettingsDraft(document);DOMDiff.apply(document.getElementById('screen'),SettingsTab());restoreSettingsDraft(draft,document);};draw();
let saveFlight=Promise.resolve();
const deps={state,batchSetState:callback=>stateManager.batchSetState(callback),save:()=>{const snapshot=JSON.parse(JSON.stringify(state.settings));saveFlight=saveFlight.then(()=>new Promise((resolve,reject)=>{const tx=preferenceDb.transaction('prefs','readwrite');tx.objectStore('prefs').put(snapshot,'settings');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}));draw();subscribers.forEach(callback=>callback());}};
const store=new VoiceStore({name:'voice-settings-native-fixture'});window.voiceStore=store;
function wave(){const size=16000,buffer=new ArrayBuffer(44+size*2),dv=new DataView(buffer);const str=(offset,value)=>[...value].forEach((c,i)=>dv.setUint8(offset+i,c.charCodeAt(0)));str(0,'RIFF');dv.setUint32(4,36+size*2,true);str(8,'WAVE');str(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,8000,true);dv.setUint32(28,16000,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);str(36,'data');dv.setUint32(40,size*2,true);for(let i=0;i<size;i++)dv.setInt16(44+i*2,Math.sin(i/8000*440*Math.PI*2)*1000,true);return new Blob([buffer],{type:'audio/wav'});}
if(!localStorage.getItem('voice-fixture-seeded')){
 await store.saveAlias('voice-demo','work-a','carlos','carlo');await store.saveAlias('voice-demo','work-a','carlos','carlito');await store.saveAlias('voice-demo','work-a','carla','carl');
 await store.put({uid:'voice-demo',projectKey:'work-a',requestId:'audio-a',createdAt:Date.now(),registeredAt:Date.now(),completedLoanId:'loan-a',selectedEmployeeId:'carlos',audio:wave(),durationMs:2000,transcript:'Carlos, un préstamo de quinientos pesos'});
 await store.put({uid:'voice-demo',projectKey:'work-a',requestId:'draft-a',createdAt:Date.now(),audio:wave(),durationMs:2000,transcript:'Instrucción sin confirmar',draft:{principal:900}});
 await store.put({uid:'voice-demo',projectKey:'work-b',requestId:'other-work',createdAt:Date.now(),audio:wave()});
 await store.put({uid:'other-account',projectKey:'work-a',requestId:'other-user',createdAt:Date.now(),audio:wave()});
 localStorage.setItem('voice-fixture-seeded','1');
}
window.beforeEmployees=JSON.stringify(employees);
let navigationView={tab:'settings',sub:'general'};const fixtureHistory=createAppHistory({getView:()=>navigationView,applyView:target=>{navigationView=target;return true;}}).start();
const subscribe=callback=>{subscribers.add(callback);return ()=>subscribers.delete(callback);};
const adapter={getUser:()=>currentUser,getScope:()=>scope,getProjectName:()=> 'Obra ficticia',getSettings:()=>state.settings,getEmployees:()=>employees.filter(e=>e.projectId===scope.projectId),getPositions:()=>state.positions,isEnabled:()=>state.settings.voiceMvpEnabled===true,isDeveloper:()=>true,subscribeSession:subscribe,subscribeScope:subscribe,subscribeEnabled:subscribe,
 setPreference:(key,value)=>{const result=typeof value==='boolean'?commitAutoSaveSwitch({id:key,checked:value,deps}):commitAutoSaveOption({name:key,value,deps});if(!result.committed)throw Error('Invalid setting');},setAudioRetention:days=>{if(days)commitAutoSaveOption({name:'voiceAudioRetentionDays',value:String(days),deps});commitAutoSaveSwitch({id:'voiceKeepLoanAudio',checked:days>0,deps});},getEndpoint:()=> 'https://n8n.invalid/blocked',notify:message=>{window.fixtureNotification=message;}};
const enrollment=new VoiceNameEnrollmentUI(adapter,{store}).mount();
window.hub=new VoiceSettingsUI({...adapter,onTeachName:id=>enrollment.open(id),onOpenLoan:id=>guardSettingsDraftOnLeave({showConfirm:options=>hub.confirm(options.title,options.message,async generation=>{hub.guard(generation);options.onConfirm();},options.confirmText),onProceed:()=>{const snapshot={recordId:hub.recordId,recordFilter:hub.recordFilter},uid=currentUser.uid,project=scope.projectId;const point=fixtureHistory.beginReturn({view:{tab:'export',sub:'ledger'},isValid:()=>currentUser.uid===uid&&scope.projectId===project,restore:()=>hub.resumeNavigation(snapshot)});hub.close();window.openedLoan=id;navigationView={tab:'export',sub:'ledger'};point.commit();}})},{store}).mount();
enrollment.dialog.addEventListener('close',()=>{if(hub.dialog.open)hub.run(()=>hub.refresh());});
window.openVoiceSettings=()=>hub.run(()=>hub.open());window.preferenceSaved=()=>saveFlight;
window.changeFixtureUser=uid=>{currentUser={uid};subscribers.forEach(callback=>callback());};
window.ready=true;
</script></body></html>`;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://fixture').pathname;
 if(pathname==='/voice-settings-fixture'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
 if(pathname==='/js/modules/data/firebase.js'){res.setHeader('Content-Type','text/javascript');res.end(firebaseStub);return;}
 const file=path.resolve(ROOT,'.'+pathname);if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,body)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream');res.end(body);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  const {default:puppeteer}=await import('puppeteer-core');browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const origin='http://127.0.0.1:'+server.address().port;
  for(const width of [1440,390,320]){
   const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],external=[];
   page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width,height:844});await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
   await page.setRequestInterception(true);page.on('request',request=>{if(request.url().startsWith(origin)||request.url().startsWith('blob:')||request.url().startsWith('data:'))request.continue();else{external.push(request.url());request.abort();}});
   await page.goto(origin+'/voice-settings-fixture');await page.waitForFunction(()=>window.ready);
   await page.click('[data-settings-action=open-voice-settings]');await page.waitForFunction(()=>hub.records?.length===2&&hub.aliases?.length===2);
   const click=async(action,value)=>{await page.click('[data-vs-action="'+action+'"]'+(value===undefined?'':'[data-value="'+value+'"]'));await page.waitForFunction(()=>!hub.busy);};
   const axe=async()=>{if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});const violations=await page.evaluate(async()=> (await axe.run('.voice-settings-dialog',{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const header=await page.evaluate(()=>{const title=document.getElementById('vs-title'),close=document.querySelector('[data-vs-action=close]');return {fits:title.scrollWidth<=title.clientWidth,clear:title.getBoundingClientRect().right<=close.getBoundingClientRect().left};});
    assert.ok(header.fits&&header.clear,'El título debe caber sin cubrir el cierre: '+JSON.stringify(header));};
   const shot=async name=>{if(process.env.VOICE_SETTINGS_SHOTS){fs.mkdirSync(process.env.VOICE_SETTINGS_SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.VOICE_SETTINGS_SHOTS,width+'-'+name+'.png')});}};
   await axe();await shot('menu');await click('config');await axe();await click('precision','medium');await click('ambiguous','ask');
   assert.equal(await page.evaluate(()=>hub.adapter.getSettings().voiceMatchPrecision),'medium');await shot('configuracion');
   await page.evaluate(()=>hub.close());await page.evaluate(()=>preferenceSaved());await page.reload();await page.waitForFunction(()=>window.ready);
   await page.click('[data-settings-action=open-voice-settings]');await page.waitForFunction(()=>hub.records?.length===2);await click('config');assert.equal(await page.$eval('[data-vs-action=precision][aria-pressed=true]',el=>el.dataset.value),'medium');
   await click('back');await click('aliases');await page.waitForFunction(()=>hub.view==='aliases'&&hub.aliases);assert.equal(await page.evaluate(()=>document.activeElement.id),'vs-title');await axe();await shot('pronunciaciones');
   await click('person','carlos');await axe();await shot('empleado');await click('edit-alias','carlo');await page.$eval('[data-vs-alias-input]',el=>{el.value='carl';el.dispatchEvent(new Event('input',{bubbles:true}));});await axe();assert.match(await page.$eval('[data-vs-alias-warning]',el=>el.textContent),/Carla/);await shot('editar');
   await click('save-alias');assert.deepEqual(await page.evaluate(()=>hub.aliasesFor('carlos')),['carl','carlito']);
   await click('teach');await page.waitForSelector('.voice-name-dialog[open]');await page.$eval('[data-name-variant]',el=>{el.value='carlosito';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.click('[data-name-action=save]');await page.waitForFunction(()=>document.querySelector('.voice-name-dialog').textContent.includes('Variante confirmada'));await page.click('.voice-name-dialog [data-name-action=close]');await page.waitForFunction(()=>hub.aliasesFor('carlos').includes('carlosito'));
   await click('remove-alias','carlito');await axe();await click('back');assert.equal(await page.evaluate(()=>hub.aliasesFor('carlos').includes('carlito')),true);
   await click('remove-alias','carlito');await click('confirm');assert.equal(await page.evaluate(()=>hub.aliasesFor('carlos').includes('carlito')),false);
   await click('back');await click('back');await click('recordings');await axe();await shot('grabaciones');await click('audio','audio-a');await axe();await shot('audio');
   await click('play');await page.waitForFunction(()=>!document.querySelector('[data-vs-audio]').paused);await click('play');
   // The native voice dialog must host the existing draft-leave confirmation.
   await page.$eval('#companyName',el=>{el.value='Empresa pendiente';el.dispatchEvent(new Event('input',{bubbles:true}));});await click('open-loan');await page.waitForFunction(()=>hub.view==='confirm');await click('back');assert.equal(await page.$eval('#companyName',el=>el.value),'Empresa pendiente');
   await click('open-loan');await click('confirm');await page.waitForFunction(()=>window.openedLoan==='carlos');assert.equal(await page.evaluate(()=>hub.dialog.open),false);
   await page.evaluate(()=>history.back());await page.waitForFunction(()=>hub.dialog.open&&hub.view==='audio');await axe();
   await click('open-loan');await page.waitForFunction(()=>!hub.dialog.open);await page.evaluate(()=>history.back());await page.waitForFunction(()=>hub.dialog.open&&hub.view==='audio');
   await click('remove-audio');await axe();await click('confirm');
   assert.equal(await page.evaluate(async()=>!!(await voiceStore.get('voice-demo','audio-a')).audio),false);assert.equal(await page.evaluate(async()=> (await voiceStore.get('voice-demo','audio-a')).completedLoanId),'loan-a');
   assert.equal(await page.evaluate(async()=>!!(await voiceStore.get('voice-demo','other-work')).audio),true);assert.equal(await page.evaluate(async()=>!!(await voiceStore.get('other-account','other-user')).audio),true);
   await click('retention');await axe();await shot('conservacion');await click('retention-days','1');await axe();await click('back');assert.equal(await page.evaluate(()=>hub.policy().days),5);
   await click('back');await click('back');await click('aliases');await click('person','carlos');await click('edit-alias','carl');await page.evaluate(()=>changeFixtureUser('another'));assert.equal(await page.evaluate(()=>hub.dialog.open),false);assert.equal(await page.evaluate(()=>hub.dialog.textContent.includes('Carlos Méndez')),false);
   assert.equal(await page.evaluate(()=>JSON.stringify(hub.adapter.getEmployees())===beforeEmployees),true);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();
   console.log('PASS Voz: '+width+' px, preferencias, alias, audio real, conservación, aislamiento, borrador pendiente y WCAG A/AA');
  }
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

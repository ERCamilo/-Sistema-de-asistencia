#!/usr/bin/env node
// Real MediaRecorder/Web Audio/IndexedDB/History and local position resolution; synthetic signals and business
// adapters only. No microphone permission, account, n8n or cloud writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname,'..');
const styles = [...fs.readFileSync(path.join(ROOT,'index.html'),'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map(m=>`<link rel="stylesheet" href="/${m[1]}">`).join('');
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba de Voz</title>${styles}</head><body><main><h1>Voz de prueba</h1><button id="capture">Grabar señal</button></main><script type="module">
import {VoiceMvpUI} from '/js/modules/features/voice/VoiceUI.js';
import {VoicePettyCashUI} from '/js/modules/features/voice/VoicePettyCashUI.js';
import {VoiceRecorder} from '/js/modules/features/voice/VoiceRecorder.js';
import {VoiceStore} from '/js/modules/features/voice/VoiceStore.js';
import {VoiceSettingsUI} from '/js/modules/features/voice/VoiceSettingsUI.js';
import {createAppHistory} from '/js/modules/core/AppHistory.js';
let view={tab:'attendance',sub:null},uid='fixture',epoch=0;const subscriptions=new Set();
window.volume=.004;window.nextIntent='crear_prestamo';window.requests=[];window.loanSaves=0;window.cashSaves=0;
const positions=[{id:'brick',name:'Albañil',icon:'bricks',color:'#f6c84a'},{id:'electric',name:'Electricista',icon:'electrical',color:'#568cf6'}];
const employees=[{id:'carlos',number:'00125',name:'Carlos Méndez',active:true,positions:['brick'],loans:[]},{id:'juan-a',number:'00126',name:'Juan Méndez',active:true,positions:['brick'],loans:[]},{id:'juan-b',number:'00127',name:'Juan Pérez',active:false,positions:['brick','electric'],loans:[]}];
const store=new VoiceStore({name:'voice-quality-browser-fixture'});
const historyManager=createAppHistory({getView:()=>view,applyView:next=>{view=next;return true;}}).start();
const subscribe=fn=>{subscriptions.add(fn);return()=>subscriptions.delete(fn);};
const beginReturn=(kind,summary)=>{const captured=epoch;return historyManager.beginReturn({view:kind==='cash'?{tab:'pettycash'}:{tab:'export',sub:'ledger'},isValid:()=>captured===epoch,restore:()=>voice.openReturnMenu({...summary,kind})});};
window.fetch=async(_url,{body})=>{
 const request=JSON.parse(body);requests.push(request);
 const cash=nextIntent==='registrar_gasto_caja_chica';
 return {ok:true,status:200,json:async()=>({ok:true,schemaVersion:1,requestId:request.requestId,result:{transcript:cash?'Transporte quinientos pesos':'Carlos quinientos pesos',intent:nextIntent,employee:{spokenName:cash?null:'Carlos Méndez',spokenNumber:null},loan:cash?null:{principal:500,interestRate:20,interestIncluded:false,installmentMode:'lump',installmentCount:1,installmentFrequencyWeeks:null,startDate:null,concept:null},...(cash?{pettyCash:{amount:500,concept:'Transporte',date:null,note:null,paidTo:null,spokenCategory:'Transporte'}}:{}),needsReview:false,issues:[]}})};
};
const signal=async()=>{
 const context=new AudioContext();await context.resume();window.signalContext=context;
 const source=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();
 gain.gain.value=window.volume;source.connect(gain);gain.connect(destination);source.start();
 return destination.stream;
};
let cash;
const adapter={getUser:()=>({uid,getIdToken:async()=> 'fictitious'}),getScope:()=>({enabled:false}),getEmployees:()=>employees,getPositions:()=>positions,getSettings:()=>({voiceReviewBeforeSend:false,voiceKeepLoanAudio:true}),isEnabled:()=>true,getEndpoint:()=> 'https://n8n.invalid/voice',notify:message=>{window.notice=message;},subscribeSession:subscribe,subscribeScope:subscribe,
 getLoanDefaults:()=>({periods:[{id:'future',payDate:'2030-12-31'}]}),validateLoan:()=>({valid:true,errors:[]}),previewLoan:(_e,draft)=>({total:draft.principal*1.2,current:0,projected:draft.principal*1.2}),beginReturn,
 onLoan:async()=>{loanSaves++;await new Promise(r=>setTimeout(r,80));view={tab:'export',sub:'ledger'};return{id:'loan-'+loanSaves,createdAt:Date.now()};},onLoans:()=>{view={tab:'export',sub:'ledger'};},onPettyCash:(record,bridge)=>cash.open(record,bridge)};
window.voice=new VoiceMvpUI(adapter,{store,mediaDevices:{getUserMedia:signal},recorderFactory:options=>new VoiceRecorder({...options,mediaDevices:{getUserMedia:signal}})}).mount();
cash=new VoicePettyCashUI({...adapter,getContext:()=>({projects:[{id:'work',name:'Obra'}],periods:[{id:'period',projectId:'work',label:'Actual'}],selectedPeriodId:'period',categories:['Transporte']}),save:async()=>{cashSaves++;return{id:'cash-'+cashSaves};},onSaved:()=>{view={tab:'pettycash',sub:null};}}).mount();
window.hub=new VoiceSettingsUI({...adapter,
 onResumePending:()=>voice.resumePending(),onProcessRecording:async id=>voice.process({record:await store.get(uid,id),background:true}),
 onReviewRecording:id=>{hub.close();return voice.openSaved(id);}}, {store}).mount();
window.queueScenario=async()=>{
 voice.close();voice.record=null;window.nextIntent='crear_prestamo';
 Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
 for(const id of ['pending-a','pending-b']){
  const record={uid,projectKey:'legacy',requestId:id,createdAt:Date.now(),audio:window.fixtureAudio,mimeType:window.fixtureAudio.type,fileName:'voice.webm',durationMs:1500,context:{localDate:'2026-10-27',timeZone:'America/Santo_Domingo'},dirty:true,draft:{principal:688,concept:'Nota conservada'}};
  await store.put(record);await voice.process({record,background:true});
 }
 await hub.open('recordings');await hub.action('record-filter','pending');
};
document.getElementById('capture').onclick=()=>voice.startHold({toggle:true});
window.changeUser=value=>{uid=value||'other';epoch++;subscriptions.forEach(fn=>fn());};
window.positionScenario=async(name,text,number=null)=>{
 voice.close();voice.record={uid,projectKey:'legacy',requestId:crypto.randomUUID(),createdAt:Date.now(),context:{timeZone:'America/Santo_Domingo'}};
 voice.applyResult({transcript:text,intent:'crear_prestamo',employee:{spokenName:name,spokenNumber:number},loan:{principal:7000,interestRate:25,interestIncluded:false,installmentMode:'lump',installmentCount:1,installmentFrequencyWeeks:null,startDate:null,concept:'Nota de prueba'},issues:[],needsReview:false});
 await voice.refreshMatches();await voice.routeResult();voice.render();if(!voice.dialog.open)voice.dialog.showModal();
};
window.back=()=>history.back();window.ready=true;
</script></body></html>`;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://fixture').pathname;
 if(pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
 const file=path.resolve(ROOT,'.'+pathname);if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(err,body)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream');res.end(body);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
  const {default:puppeteer}=await import('puppeteer-core');browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
  for(const width of [390,320,1280]){
   const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],external=[];
   page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width,height:844});await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
   const origin='http://127.0.0.1:'+server.address().port;
   await page.setRequestInterception(true);page.on('request',request=>{if(request.url().startsWith(origin)||/^(blob:|data:)/.test(request.url()))request.continue();else{external.push(request.url());request.abort();}});
   await page.goto(origin+'/fixture');await page.waitForFunction(()=>window.ready);
   const capture=async(volume,selector='#capture')=>{
    await page.evaluate(value=>{window.volume=value;},volume);await page.click(selector);
    await page.waitForFunction(()=>voice.recorder?.recorder?.state==='recording');
    await page.waitForFunction(()=>voice.recorder.rmsSamples.length>=15);
    await page.evaluate(()=>voice.recorder.stop());await page.waitForFunction(()=>!!voice.record?.audio&&!voice.busy);
    await page.evaluate(()=>{window.fixtureAudio=voice.record.audio;return signalContext.close();});
   };
   const axe=async selector=>{
    if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
    const result=await page.evaluate(async selector=>(await axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),selector);
    assert.deepEqual(result,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   };
   await capture(.004);assert.equal(await page.evaluate(()=>voice.record.audioQuality.status),'low');
   assert.equal(await page.evaluate(()=>requests.length),0);await axe('.voice-dialog[open]');
   const requestId=await page.evaluate(()=>voice.record.requestId);
   if(process.env.VOICE_QUALITY_SHOTS){fs.mkdirSync(process.env.VOICE_QUALITY_SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.VOICE_QUALITY_SHOTS,width+'-audio-bajo.png')});}
   await page.click('[data-voice-action=record]');await page.waitForSelector('[data-voice-action=confirm-cancel]');await page.click('[data-voice-action=confirm-cancel]');
   assert.equal(await page.evaluate(()=>voice.record.requestId),requestId);
   await page.click('[data-voice-action=process]');await page.waitForSelector('.voice-dialog[data-voice-view=loan]');
   assert.equal(await page.evaluate(()=>requests[0].requestId),requestId);
   assert.deepEqual(await page.evaluate(()=>Object.keys(requests[0]).sort()),['context','fileBase64','fileName','idToken','mimeType','requestId','schemaVersion'].sort());
   await page.click('[data-voice-action=loan]');await page.waitForFunction(()=>loanSaves===1&&!voice.dialog.open&&!voice.busy);
   await page.evaluate(()=>back());await page.waitForSelector('.voice-dialog[open][data-voice-view=done]');
   assert.match(await page.$eval('.voice-return-summary',el=>el.textContent),/Préstamo registrado/);assert.equal(await page.$('[data-voice-action=loan]'),null);assert.equal(await page.evaluate(()=>requests.length),1);await axe('.voice-dialog[open]');
   if(process.env.VOICE_QUALITY_SHOTS)await page.screenshot({path:path.join(process.env.VOICE_QUALITY_SHOTS,width+'-volver-prestamo.png')});
   await capture(0,'[data-voice-action=record]');assert.equal(await page.evaluate(()=>voice.record.audioQuality.status),'silent');assert.equal(await page.evaluate(()=>requests.length),1);
   assert.equal(await page.evaluate(()=>voice.returnSummary),null);
   await page.click('.voice-header [data-voice-action=close]');await page.waitForFunction(()=>!voice.dialog.open);
   await page.evaluate(()=>{nextIntent='registrar_gasto_caja_chica';});await capture(.2);
   await page.waitForSelector('.voice-cash-dialog[open]');assert.equal(await page.evaluate(()=>voice.record.audioQuality.status),'normal');
   await page.click('[data-cash-action=save]');await page.waitForFunction(()=>cashSaves===1&&!document.querySelector('.voice-cash-dialog').open);
   await page.evaluate(()=>back());await page.waitForSelector('.voice-dialog[open][data-voice-view=done]');
   assert.match(await page.$eval('.voice-return-summary',el=>el.textContent),/Gasto registrado/);assert.equal(await page.evaluate(()=>cashSaves),1);assert.equal(await page.evaluate(()=>requests.length),2);await axe('.voice-dialog[open]');
   await page.evaluate(()=>changeUser());await page.waitForFunction(()=>!voice.dialog.open);
   // Position hints stay local and keep identity scores/business edits intact.
   await page.evaluate(()=>positionScenario('Juan','Préstamo a Juan el electricista'));
   assert.equal(await page.evaluate(()=>voice.view),'employees');
   assert.deepEqual(await page.$$eval('[data-voice-action=select]',els=>els.map(el=>el.dataset.id)),['juan-b','juan-a']);
   assert.equal(await page.evaluate(()=>voice.record.selectedEmployeeId),null);await axe('.voice-dialog[open]');
   if(process.env.VOICE_QUALITY_SHOTS)await page.screenshot({path:path.join(process.env.VOICE_QUALITY_SHOTS,width+'-posicion.png')});
   await page.locator('[data-voice-action=select][data-id=juan-b]').click();await page.waitForFunction(()=>voice.view==='loan');
   await page.$eval('[data-voice-field=principal]',el=>{el.value='7300';el.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>voice.record.draft.principal===7300);
   const draft=await page.evaluate(()=>JSON.stringify(voice.record.draft));
   await page.locator('[data-voice-action=choose]').click();await axe('.voice-dialog[open]');
   await page.locator('[data-voice-action=select][data-id=juan-a]').click();await page.waitForFunction(()=>voice.view==='loan');
   assert.equal(await page.evaluate(()=>JSON.stringify(voice.record.draft)),draft);
   await page.evaluate(()=>positionScenario('Juan','Juan el electricista número 00126','00126'));
   assert.equal(await page.$eval('[data-voice-action=select]',el=>el.dataset.id),'juan-a');assert.equal(await page.evaluate(()=>voice.record.selectedEmployeeId),null);await axe('.voice-dialog[open]');
   await page.evaluate(()=>positionScenario('Carlos Méndez','Carlos Méndez el electricista'));
   assert.equal(await page.evaluate(()=>voice.view),'employees');assert.match(await page.$eval('.voice-position-warning',el=>el.textContent),/su posición no/);
   await page.locator('[data-voice-action=position-hint]').click();await page.waitForFunction(()=>voice.record.ignoreVoicePosition===true);assert.equal(await page.evaluate(()=>voice.matches[0].employee.id),'carlos');
   await page.evaluate(()=>positionScenario('electricista','Préstamo al electricista'));
   assert.equal(await page.evaluate(()=>voice.view),'employees');assert.match(await page.$eval('.voice-position-warning',el=>el.textContent),/Solo hay una pista/);
   await page.locator('[data-voice-action=select][data-id=juan-b]').click();await page.waitForFunction(()=>voice.view==='loan');assert.equal(await page.evaluate(()=>!!voice.aliasSelection),false);
   assert.equal(await page.evaluate(()=>loanSaves),1);assert.equal(await page.evaluate(()=>cashSaves),1);assert.equal(await page.evaluate(()=>requests.length),2);
   await page.evaluate(()=>changeUser('third'));await page.waitForFunction(()=>!voice.dialog.open);
   await page.evaluate(()=>queueScenario());
   assert.equal(await page.$$eval('.vs-record-row',rows=>rows.length),2);assert.equal(await page.$eval('[data-vs-action=resume-pending]',el=>el.disabled),true);
   assert.equal(await page.evaluate(()=>requests.length),2);await axe('.voice-settings-dialog[open]');
   const pendingDir=process.env.SA_VOICE_SCREENSHOT_DIR;if(pendingDir){fs.mkdirSync(pendingDir,{recursive:true});await page.screenshot({path:path.join(pendingDir,width+'-pendientes.png')});}
   await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'));});
   await page.waitForFunction(async()=>!voice.queueFlight&&(await voice.store.get('third','pending-a'))?.processingState==='ready'&&(await voice.store.get('third','pending-b'))?.processingState==='ready');
   assert.equal(await page.evaluate(()=>requests.length),4);assert.deepEqual(await page.evaluate(()=>requests.slice(2).map(r=>r.requestId).sort()),['pending-a','pending-b']);
   assert.equal(await page.evaluate(()=>loanSaves),1);assert.equal(await page.evaluate(()=>cashSaves),1);
   await page.evaluate(()=>hub.action('record-filter','available'));await axe('.voice-settings-dialog[open]');
   await page.locator('[data-vs-action=review-record][data-value=pending-a]').click();await page.waitForSelector('.voice-dialog[open]');
   assert.equal(await page.evaluate(()=>voice.record.draft.principal),688);assert.equal(await page.evaluate(()=>voice.record.draft.concept),'Nota conservada');
   assert.equal(await page.evaluate(()=>voice.record.pendingResult.loan.principal),500);await axe('.voice-dialog[open]');
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   console.log('PASS Voz '+width+' px: audio real, préstamo/gasto una vez, Atrás, pistas locales de posición, homónimos, conflictos, edición conservada, cola offline/online sin registros, aislamiento y WCAG A/AA');
   await context.close();
  }
 } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

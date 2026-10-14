#!/usr/bin/env node
// Cross-client browser check. MINI_REPO_ROOT must point at the matching Mini checkout.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const SA=path.resolve(__dirname,'..'),MINI=process.env.MINI_REPO_ROOT;
if(!MINI)throw new Error('Define MINI_REPO_ROOT con el checkout de Mini que incluye este contrato.');
assert.equal(fs.readFileSync(path.join(SA,'js/p2p/MiniEmployeeProposal.js'),'utf8'),fs.readFileSync(path.join(MINI,'employee-proposal.js'),'utf8'),'Los contratos de ambos clientes deben coincidir');
const saIndex=fs.readFileSync(path.join(SA,'index.html'),'utf8'),miniIndex=fs.readFileSync(path.join(MINI,'index.html'),'utf8');
const styles=[...saIndex.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map(m=>`<link rel="stylesheet" href="/sa/${m[1]}">`).join('');
const firebaseNames=fs.readFileSync(path.join(SA,'js/modules/data/firebase.js'),'utf8').match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g,'').split(',').map(n=>n.trim()).filter(Boolean);
const firebase=firebaseNames.map(n=>n==='auth'?'export const auth={currentUser:null};':`export const ${n}=()=>{};`).join('\n');
const saFixture=`<!doctype html><html lang="es"><head><title>Revisión de personal SA</title><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>body{margin:0;padding:12px;background:var(--bg);color:var(--text)}#review{max-width:900px}</style></head><body><main class="sa-p2p-shell"><div class="sa-p2p-body" id="review"></div></main><script src="/sa/js/p2p/P2PCore.js"></script><script type="module">
import {state,stateManager} from '/sa/js/modules/core/AppState.js';
import {IndexedDBService} from '/sa/js/modules/services/IndexedDBService.js';
import {MiniEmployeeIntakeStore} from '/sa/js/modules/features/p2p/MiniEmployeeIntakeStore.js';
import {attachEmployeeIntakeChannel,requestMiniEmployees} from '/sa/js/modules/features/p2p/MiniEmployeeIntakeBridge.js';
import {renderEmployeeIntakeReview} from '/sa/js/modules/features/p2p/MiniEmployeeIntakeUI.js';
const scope={enabled:true,projectId:'P-FIXTURE',defaultProjectId:'P-FIXTURE'};
stateManager.setState({employees:[],positions:[],settings:{...state.settings,regularHoursPerDay:8}});
const db=new IndexedDBService('employee-intake-fixture',22);await db.init();
const store=new MiniEmployeeIntakeStore({dbService:db,readScope:()=>scope,onCommitted:async()=>{}});
window.install=channel=>{SaMiniP2P.markChannelAuthenticated(channel);window.channel=channel;attachEmployeeIntakeChannel(channel,{peerId:'mini-fixture',peerApp:'mini',displayName:'Mini de prueba'},{store,core:SaMiniP2P,resolveScope:async()=>scope,resolveProjectName:async()=> 'Obra de prueba'});};
window.receive=async()=>{window.entry=await requestMiniEmployees('mini-fixture',{scope,timeoutMs:10000});await renderEmployeeIntakeReview(document.getElementById('review'),entry,{store,projectName:'Obra de prueba',resolveScope:async()=>scope});};
window.reviewLatest=async()=>{window.entry=(await store.list()).at(-1);await renderEmployeeIntakeReview(document.getElementById('review'),entry,{store,projectName:'Obra de prueba',resolveScope:async()=>scope});};
window.records=async()=>({employees:await db.getAll('employees'),positions:await db.getAll('positions'),entries:await store.list(),attendance:await db.getAll('attendance')});window.ready=true;
</script></body></html>`;
const miniStyle=miniIndex.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
const miniScripts=['employee-number-rules','employee-repository','attendance-repository','employee-proposal','p2p-core','employee-proposal-sender'].map(n=>`<script src="/mini/${n}.js"></script>`).join('');
const miniFixture=`<!doctype html><html lang="es"><head><title>Envío de personal Mini</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${miniStyle}</style><link rel="stylesheet" href="/mini/p2p-transfer.css"></head><body><p id="status"></p>${miniScripts}<script>
window.showToast=message=>document.getElementById('status').textContent=message;
localStorage.removeItem('users');localStorage.removeItem('miniEmployeeProposal:sa-fixture');
window.employeeRepository=EmployeeRepository.createEmployeeRepository({storage:localStorage});
employeeRepository.save({id:'',number:'001',name:'Ana Demo',position:'Ayudante',sueldo:'1500'},'local-1');
window.attendanceRepository=AttendanceRepository.createAttendanceRepository({storage:localStorage});attendanceRepository.setRecord('local-1','2026-10-14','present',8);
window.dropResults=true;
window.install=channel=>{SaMiniP2P.markChannelAuthenticated(channel);window.channel=channel;channel.addEventListener('message',event=>{if(!dropResults||typeof event.data!=='string')return;try{if(JSON.parse(event.data).schema==='mini-roster-result/v1')event.stopImmediatePropagation();}catch(_){}});MiniEmployeeSender.attach(channel,{peerId:'sa-fixture',peerApp:'sa',displayName:'Obra de prueba'});MiniEmployeeSender.configure({getChannel:()=>channel,ensureChannel:async()=>{}});};
window.offer=()=>MiniEmployeeSender.openOffer({peerId:'sa-fixture',peerApp:'sa',displayName:'Obra de prueba'});
window.records=()=>({employees:employeeRepository.getAll(),attendance:attendanceRepository.getByDate('2026-10-14')});window.ready=true;
</script></body></html>`;
(async()=>{
const server=http.createServer((req,res)=>{
const pathname=new URL(req.url,'http://fixture').pathname;
if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<iframe id="sa" src="/sa-fixture" style="width:390px;height:844px;border:0"></iframe><iframe id="mini" src="/mini-fixture" style="width:390px;height:844px;border:0"></iframe>');return;}
if(pathname==='/sa-fixture'||pathname==='/mini-fixture'){res.setHeader('Content-Type','text/html');res.end(pathname==='/sa-fixture'?saFixture:miniFixture);return;}
if(pathname==='/sa/js/modules/data/firebase.js'){res.setHeader('Content-Type','text/javascript');res.end(firebase);return;}
const root=pathname.startsWith('/sa/')?SA:pathname.startsWith('/mini/')?MINI:null;
if(!root){res.writeHead(404).end();return;}const file=path.resolve(root,'.'+decodeURIComponent(pathname.replace(/^\/(sa|mini)/,'')));
if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
fs.readFile(file,(error,body)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream');res.end(body);});
});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 const {default:puppeteer}=await import('puppeteer-core');browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--allow-loopback-in-peer-connection','--disable-features=WebRtcHideLocalIpsWithMdns','--force-webrtc-ip-handling-policy=default']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Browser:',error.message);});
 await page.setViewport({width:820,height:900});await page.setRequestInterception(true);page.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const sa=page.frames().find(f=>f.url().endsWith('/sa-fixture')),mini=page.frames().find(f=>f.url().endsWith('/mini-fixture'));
 await Promise.all([sa.waitForFunction(()=>window.ready),mini.waitForFunction(()=>window.ready)]);console.log('PASS clientes inicializados');
 if(process.env.INTAKE_SIMULATED_CHANNELS==='1') {
   await page.evaluate(()=>{
     const a=document.getElementById('sa').contentWindow,b=document.getElementById('mini').contentWindow;
     class LocalChannel {constructor(owner){this.owner=owner;this.readyState='open';this.bufferedAmount=0;this.listeners=new Map();}addEventListener(t,f){if(!this.listeners.has(t))this.listeners.set(t,new Set());this.listeners.get(t).add(f);}removeEventListener(t,f){this.listeners.get(t)?.delete(f);}send(data){const peer=this.peer,value=typeof data==='string'?data:new peer.owner.Uint8Array(new Uint8Array(data)).buffer;queueMicrotask(()=>{const event={data:value,stopped:false,stopImmediatePropagation(){this.stopped=true;}};for(const f of [...(peer.listeners.get('message')||[])]){f(event);if(event.stopped)break;}});}close(){this.readyState='closed';this.listeners.get('close')?.forEach(f=>f({}));}}
     const left=new LocalChannel(a),right=new LocalChannel(b);left.peer=right;right.peer=left;a.install(left);b.install(right);
   });console.log('PASS canales locales simulados abiertos');
 } else {
 let rtcTimer;
 await Promise.race([page.evaluate(async()=>{
   const a=document.getElementById('sa').contentWindow,b=document.getElementById('mini').contentWindow;
   const p1=new a.RTCPeerConnection({iceServers:[]}),p2=new b.RTCPeerConnection({iceServers:[]});
   window.rtcStates=()=>({left:p1.connectionState,right:p2.connectionState,iceLeft:p1.iceConnectionState,iceRight:p2.iceConnectionState,gatherLeft:p1.iceGatheringState,gatherRight:p2.iceGatheringState,candidatesLeft:(p1.localDescription?.sdp.match(/a=candidate/g)||[]).length,candidatesRight:(p2.localDescription?.sdp.match(/a=candidate/g)||[]).length,local:local?.readyState,remote:remote?.readyState,stage:window.rtcStage});
   const q1=[],q2=[];p1.onicecandidate=e=>{if(e.candidate){if(p2.remoteDescription)p2.addIceCandidate(e.candidate);else q2.push(e.candidate);}};p2.onicecandidate=e=>{if(e.candidate){if(p1.remoteDescription)p1.addIceCandidate(e.candidate);else q1.push(e.candidate);}};
   let remote;const received=new Promise(r=>p2.ondatachannel=e=>{remote=e.channel;r();});const local=p1.createDataChannel('employee-intake');
   window.rtcStage='create-offer';const offer=await p1.createOffer();window.rtcStage='local-offer';await p1.setLocalDescription(offer);window.rtcStage='remote-offer';await p2.setRemoteDescription(offer);for(const c of q2)await p2.addIceCandidate(c);
   window.rtcStage='create-answer';const answer=await p2.createAnswer();window.rtcStage='local-answer';await p2.setLocalDescription(answer);window.rtcStage='remote-answer';await p1.setRemoteDescription(answer);for(const c of q1)await p1.addIceCandidate(c);window.rtcStage='waiting-channel';await received;
   await Promise.all([local,remote].map(c=>c.readyState==='open'?Promise.resolve():new Promise(r=>c.addEventListener('open',r,{once:true}))));local.binaryType='arraybuffer';remote.binaryType='arraybuffer';a.install(local);b.install(remote);
 }),new Promise((_,reject)=>rtcTimer=setTimeout(async()=>{const diagnostic=await page.evaluate(()=>window.rtcStates?.());reject(new Error('WebRTC local no conectó: '+JSON.stringify(diagnostic)));},15000))]).finally(()=>clearTimeout(rtcTimer));console.log('PASS canales WebRTC abiertos');
 }
 await new Promise(r=>setTimeout(r,100));await sa.evaluate(()=>{window.receiving=window.receive();});
 await mini.waitForSelector('[data-employee-send-confirm]');console.log('PASS confirmación visible en Mini');assert.equal((await sa.evaluate(()=>window.records())).employees.length,0);
 for(const frame of [mini,sa])await frame.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
 const checkLayout=async(frame,selector)=>{
   const layout=await frame.evaluate(selector=>{
     const root=document.querySelector(selector),controls=[...root.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary')];
     return {overflow:document.documentElement.scrollWidth>innerWidth,small:controls.filter(el=>{const target=el.type==='checkbox'?el.closest('label'):el,r=target.getBoundingClientRect();return r.width<44||r.height<44;}).map(el=>el.outerHTML.slice(0,160)),outside:controls.filter(el=>{const r=el.getBoundingClientRect();return r.right>innerWidth+.5||r.left<0;}).map(el=>el.outerHTML.slice(0,160))};
   },selector);
   assert.deepEqual(layout,{overflow:false,small:[],outside:[]});
   const violations=await frame.evaluate(async selector=>(await axe.run(document.querySelector(selector),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),selector);
   assert.deepEqual(violations,[]);
 };
 for(const width of [320,390,480]){
   await page.$eval('#mini',(el,width)=>el.style.width=width+'px',width);
   for(const theme of ['dark','light','contrast','ocean','sol']){await mini.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);await checkLayout(mini,'.employee-send-dialog');}
 }
 await page.$eval('#mini',el=>el.style.width='390px');await mini.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
 await mini.click('[data-employee-send-confirm]');await sa.waitForSelector('[data-intake-accept]');console.log('PASS revisión visible en SA');
 assert.equal((await sa.evaluate(()=>window.records())).employees.length,0);
 await sa.$eval('[data-intake-row]',el=>el.open=true);
 for(const width of [320,390,480]){await page.$eval('#sa',(el,width)=>el.style.width=width+'px',width);await checkLayout(sa,'.sa-mini-intake');}
 await page.$eval('#sa',el=>el.style.width='390px');console.log('PASS revisión móvil: sin desbordes, objetivos táctiles y axe; Mini en sus cinco temas');
 for(const [field,value]of [['number','701'],['phone','8095550100']])await sa.$eval(`[data-intake-field="${field}"]`,(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},value);
 await sa.click('[data-intake-accept]');await sa.waitForFunction(()=>document.querySelector('[data-intake-message]').textContent.includes('aceptados'));
 let record=await sa.evaluate(()=>window.records());assert.equal(record.employees.length,1);assert.equal(record.positions.length,1);assert.equal(record.attendance.length,0);assert.equal(record.employees[0].positionSalaries[record.positions[0].id],187.5);
 assert.equal((await mini.evaluate(()=>window.records())).employees[0].saEmployeeId,undefined);
 await mini.evaluate(()=>window.dropResults=false);await sa.evaluate(()=>{window.receiving=window.receive();});
 await mini.waitForSelector('[data-employee-send-confirm]');await mini.click('[data-employee-send-confirm]');
 await mini.waitForFunction(()=>window.employeeRepository.getAll()[0].saEmployeeId);
 record=await sa.evaluate(()=>window.records());const client=await mini.evaluate(()=>window.records());
 assert.equal(record.employees.length,1);assert.equal(record.positions.length,1);assert.equal(client.employees[0].id,'local-1');assert.equal(client.employees[0].number,'701');assert.equal(client.employees[0].phone,'8095550100');assert.equal(client.employees[0].sueldo,'1500');assert.equal(client.attendance['local-1'].hours,8);
 await mini.evaluate(()=>window.offer());await mini.waitForSelector('[data-employee-send-confirm]');
 assert.match(await mini.$eval('.employee-send-dialog',el=>el.textContent),/Obra de prueba/);
 await mini.click('[data-employee-send-index]');await mini.click('[data-employee-send-confirm]');
 await sa.waitForFunction(async()=> (await window.records()).entries.length===2);await sa.evaluate(()=>window.reviewLatest());
 assert.equal(await sa.$eval('[data-intake-action]',el=>el.value),'link');await sa.click('[data-intake-accept]');
 await sa.waitForFunction(()=>document.querySelector('[data-intake-message]').textContent.includes('aceptados'));
 assert.equal((await sa.evaluate(()=>window.records())).employees.length,1);console.log('PASS envío iniciado desde Mini: obra confirmada y vínculo reutilizado');
 assert.deepEqual(errors,[]);console.log('PASS flujo Mini → SA: consentimiento, alta editada, salario diario, persistencia y reenvío tras respuesta perdida; ID e historial Mini conservados, sin crear asistencia SA.');
 if(process.env.INTAKE_SCREENSHOT)await page.screenshot({path:process.env.INTAKE_SCREENSHOT,fullPage:true});
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});

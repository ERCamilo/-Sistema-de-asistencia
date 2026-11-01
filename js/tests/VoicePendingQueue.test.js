import { indexedDB } from 'fake-indexeddb';
import { Blob as NativeBlob } from 'node:buffer';
import { webcrypto, randomUUID } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { VoiceStore } from '../modules/features/voice/VoiceStore.js';
import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
import { pauseVoiceProcessing } from '../modules/features/voice/VoiceProcessing.js';
import { voiceRequestSignature, voiceProcessingStatus, voiceKeepPending } from '../modules/features/voice/VoicePending.js';
import { VOICE_DAY } from '../modules/features/voice/VoiceRetention.js';

globalThis.TextEncoder = TextEncoder;
Object.defineProperty(crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
crypto.randomUUID = randomUUID;
globalThis.structuredClone = function clone(value) {
    if (value instanceof NativeBlob) return value.slice(0, value.size, value.type);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)]));
    return value;
};
const result = () => ({ transcript:'Carlos mil pesos',intent:'crear_prestamo',employee:{spokenName:'Carlos',spokenNumber:null},
    extracted:{amount:1000,spokenName:'Carlos',spokenNumber:null,concept:null,date:null,note:null,paidTo:null,spokenCategory:null},loan:null,needsReview:false,issues:[] });
const response = id => ({ok:true,status:200,json:async()=>({ok:true,schemaVersion:1,requestId:id,result:result()})});
const sample = (id='r', extra={}) => ({uid:'u',projectKey:'p',requestId:id,createdAt:Date.now(),audio:new NativeBlob(['sound']),
    fileBase64:'c291bmQ=',mimeType:'audio/webm;codecs=opus',fileName:'voice.webm',context:{localDate:'2026-10-27',timeZone:'America/Santo_Domingo'},...extra});
const stores=[];
async function fixture({name='voice-pending-'+Math.random(), records=[sample()]}={}) {
    let uid='u', projectId='p', enabled=true;
    const store=new VoiceStore({indexedDB,name}); stores.push(store);
    for (const record of records) await store.put(record);
    const adapter={getUser:()=>({uid,getIdToken:jest.fn(async()=> 'token')}),getScope:()=>({enabled:true,projectId}),isEnabled:()=>enabled,
        getSettings:()=>({voiceMvpEnabled:true}),getEmployees:()=>[],getEndpoint:()=> 'https://voice.example/webhook',onLoan:jest.fn(),onPettyCash:jest.fn(),onAttendance:jest.fn()};
    const ui=new VoiceMvpUI(adapter,{store});ui.render=jest.fn();ui.dialog={open:false};ui.refreshMatches=jest.fn();ui.routeResult=jest.fn();
    ui.record=records[0] ? await store.get('u',records[0].requestId) : null;
    return {ui,store,adapter,setUid:value=>{uid=value;},setProject:value=>{projectId=value;},disable:()=>{enabled=false;}};
}
const originalFetch=global.fetch;
beforeEach(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});});
afterEach(()=>{for(const store of stores.splice(0))store.close();global.fetch=originalFetch;jest.restoreAllMocks();});

test('offline request survives reload and resumes exactly its original ID, context and endpoint', async()=>{
    const first=await fixture();Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
    global.fetch=jest.fn();await first.ui.process();expect(global.fetch).not.toHaveBeenCalled();
    const queued=await first.store.get('u','r');expect(queued).toMatchObject({processingState:'queued',autoResume:true});
    expect(queued.audio.size).toBe(5);first.store.close();
    const second=await fixture({name:first.store.name,records:[]});Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
    global.fetch=jest.fn(async(url,{body})=>{const request=JSON.parse(body);expect(url).toBe(queued.requestEndpoint);expect(request.context).toEqual(queued.context);return response(request.requestId);});
    await second.ui.resumePending({automatic:true});expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await second.store.get('u','r')).toMatchObject({requestId:'r',processingState:'ready',result:result()});
    expect(second.ui.routeResult).not.toHaveBeenCalled();expect(second.adapter.onLoan).not.toHaveBeenCalled();expect(second.adapter.onPettyCash).not.toHaveBeenCalled();
});

test('two tabs claim one durable lease; a stale editor cannot erase it and edits survive the response', async()=>{
    const one=await fixture({records:[sample('r',{dirty:true,draft:{principal:777,concept:'nota manual'},selectedEmployeeId:'employee'})]});
    const two=await fixture({name:one.store.name,records:[]});two.ui.record=await two.store.get('u','r');
    let finish,started;const ready=new Promise(r=>{started=r;});global.fetch=jest.fn(()=>{started();return new Promise(r=>{finish=r;});});
    const pending=one.ui.process();await ready;
    const lease=(await one.store.get('u','r')).processingLease;
    const edited={...two.ui.record,draft:{principal:888,concept:'editada durante envío'},dirty:true};await two.store.put(edited);
    expect((await two.store.get('u','r')).processingLease).toEqual(lease);
    await two.ui.process();expect(global.fetch).toHaveBeenCalledTimes(1);
    finish(response('r'));await pending;
    const saved=await one.store.get('u','r');expect(saved.draft).toEqual(edited.draft);expect(saved.selectedEmployeeId).toBe('employee');
    expect(saved.pendingResult).toEqual(result());expect(saved.processingLease).toBeUndefined();
});

test('batch is sequential, scoped, excludes completed/name samples, and background results never navigate',async()=>{
    const {ui,adapter,store}=await fixture({records:[sample('a'),sample('b'),sample('elsewhere',{projectKey:'other'}),sample('other-user',{uid:'other'}),
        sample('paid',{completedLoanId:'loan'}),sample('cash',{completedCashId:'movement'}),sample('sample',{purpose:'name-example'})]});
    let active=0,peak=0;const ids=[];
    global.fetch=jest.fn(async(_,{body})=>{active++;peak=Math.max(peak,active);const id=JSON.parse(body).requestId;ids.push(id);await Promise.resolve();active--;return response(id);});
    await ui.resumePending();expect(ids.sort()).toEqual(['a','b']);expect(peak).toBe(1);expect(ui.routeResult).not.toHaveBeenCalled();
    expect(adapter.onLoan).not.toHaveBeenCalled();expect(adapter.onAttendance).not.toHaveBeenCalled();expect((await store.get('other','other-user')).result).toBeUndefined();
});

test.each(['account','project','ABA','disabled'])('scope interruption %s pauses, keeps audio and ignores a late result',async kind=>{
    const {ui,store,setUid,setProject,disable}=await fixture();let finish,started;const ready=new Promise(r=>{started=r;});
    global.fetch=jest.fn(()=>{started();return new Promise(r=>{finish=r;});});const pending=ui.process();await ready;
    if(kind==='account')setUid('other');if(kind==='project')setProject('other');if(kind==='disabled')disable();
    if(kind==='ABA'){setUid('other');pauseVoiceProcessing(ui);setUid('u');}
    finish(response('r'));await pending;
    const saved=await store.get('u','r');expect(saved.audio).toBeDefined();expect(saved.processingState).toBe('paused');expect(saved.result).toBeUndefined();
    expect(ui.routeResult).not.toHaveBeenCalled();
});

test.each(['delete','expiry'])('a late response cannot recreate audio after %s',async kind=>{
    const {ui,store}=await fixture();let finish,started;const ready=new Promise(r=>{started=r;});
    global.fetch=jest.fn(()=>{started();return new Promise(r=>{finish=r;});});const pending=ui.process();await ready;
    if(kind==='delete')await store.remove('u','r');else await store.maintain('u',{keep:true,days:5},Date.now()+VOICE_DAY+1);
    finish(response('r'));await pending;if(kind==='delete')expect(await store.get('u','r')).toBeUndefined();else expect(await store.get('u','r')).toMatchObject({processingState:'expired',audioDiscardReason:'expired'});expect((await store.get('u','r'))?.audio).toBeUndefined();expect(ui.routeResult).not.toHaveBeenCalled();
});

test('401 renewal keeps request ID; 403 and 429 keep audio/edits and do not retry in a loop',async()=>{
    const {ui,store,adapter}=await fixture({records:[sample('r',{dirty:true,draft:{principal:555}})]});
    const token=jest.fn(async force=>force?'renewed':'expired');adapter.getUser=()=>({uid:'u',getIdToken:token});
    const ids=[];global.fetch=jest.fn(async(_,{body})=>{const req=JSON.parse(body);ids.push(req.requestId);return ids.length===1?{ok:false,status:401}:response(req.requestId);});
    await ui.process();expect(ids).toEqual(['r','r']);expect(token.mock.calls).toEqual([[false],[true]]);
    global.fetch=jest.fn(async()=>({ok:false,status:429,headers:{get:()=> '60'},json:async()=>({error:{code:'RATE_LIMITED',message:'Espera 60 segundos'}})}));
    await ui.process();let saved=await store.get('u','r');expect(saved.retryAt).toBeGreaterThan(Date.now());expect(saved.draft.principal).toBe(555);
    await expect(ui.process()).rejects.toThrow('Espera');expect(global.fetch).toHaveBeenCalledTimes(1);clearTimeout(ui.retryTimer);
    await store.updateRecording('u','p','r',row=>({...row,retryAt:null}));ui.record=await store.get('u','r');
    global.fetch=jest.fn(async()=>({ok:false,status:403,json:async()=>({error:{code:'FORBIDDEN',message:'No autorizado'}})}));
    await ui.process();saved=await store.get('u','r');expect(saved.error.message).toContain('HTTP 403');expect(saved.autoResume).toBe(false);
    await ui.resumePending({automatic:true});expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('network failure retains exact error, closing/new instance can retry with the same ID',async()=>{
    const {ui,store}=await fixture();global.fetch=jest.fn(async()=>{throw TypeError('network');});await ui.process();
    const saved=await store.get('u','r');expect(saved).toMatchObject({autoResume:true,processingState:'queued',error:{code:'NETWORK_ERROR'}});
    const next=await fixture({name:store.name,records:[]});global.fetch=jest.fn(async(_,{body})=>response(JSON.parse(body).requestId));
    await next.ui.resumePending({automatic:true});expect(global.fetch).toHaveBeenCalledTimes(1);expect((await store.get('u','r')).processingState).toBe('ready');
});

test.each(['audio','context','mime','fileBase64'])('changed %s requires a new ID; unchanged context key order does not change signature',async changed=>{
    const {ui,store}=await fixture();global.fetch=jest.fn(async()=>response('r'));await ui.process();
    const saved=await store.get('u','r');expect(await voiceRequestSignature({...saved,context:{timeZone:saved.context.timeZone,localDate:saved.context.localDate}})).toBe(saved.requestSignature);
    ui.record={...saved};
    if(changed==='audio')ui.record.audio=new NativeBlob(['other']);
    if(changed==='context')ui.record.context={...saved.context,localDate:'2026-10-28'};
    if(changed==='mime')ui.record.mimeType='audio/mp4';
    if(changed==='fileBase64')ui.record.fileBase64='b3RoZXI=';
    await store.put(ui.record);await ui.process();
    expect(global.fetch).toHaveBeenCalledTimes(1);expect(ui.message).toContain('otro requestId');
    const copy={...ui.record,requestId:'new-id',requestSignature:null,processingState:null,error:null,processingLease:null};await store.put(copy);ui.record=copy;
    global.fetch=jest.fn(async()=>response('new-id'));await ui.process();expect((await store.get('u','new-id')).result).toEqual(result());
});

test('interrupted leases can be retried only after expiry',async()=>{
    const {ui,store}=await fixture({records:[sample('r',{processingState:'processing',processingLease:{owner:'old-tab',until:Date.now()+50000}})]});
    global.fetch=jest.fn(async()=>response('r'));await ui.resumePending();expect(global.fetch).not.toHaveBeenCalled();
    await store.updateRecording('u','p','r',row=>({...row,processingLease:{owner:'old-tab',until:Date.now()-1}}));
    expect(voiceProcessingStatus(await store.get('u','r'))).toBe('Envío interrumpido');await ui.resumePending();expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('account switch while renewing a token stops POST before it is sent',async()=>{
    const {ui,store,adapter,setUid}=await fixture();let release,started;const ready=new Promise(r=>{started=r;});
    adapter.getUser=()=>({uid:'u',getIdToken:()=>{started();return new Promise(r=>{release=r;});}});
    global.fetch=jest.fn();const pending=ui.process();await ready;setUid('other');pauseVoiceProcessing(ui);release('old-token');await pending;
    expect(global.fetch).not.toHaveBeenCalled();expect((await store.get('u','r')).processingState).toBe('paused');
});

test('a stalled token cannot send after another tab acquires the expired lease',async()=>{
    const {ui,store,adapter}=await fixture();let release,started;const ready=new Promise(r=>{started=r;});
    adapter.getUser=()=>({uid:'u',getIdToken:()=>{started();return new Promise(r=>{release=r;});}});
    global.fetch=jest.fn();const pending=ui.process();await ready;
    await store.updateRecording('u','p','r',row=>({...row,processingLease:{owner:'new-tab',until:Date.now()+120000}}));
    release('late-token');await pending;expect(global.fetch).not.toHaveBeenCalled();
    expect((await store.get('u','r')).processingLease.owner).toBe('new-tab');
});

test('stale editor after a response preserves the new result as an explicit replacement',async()=>{
    const {ui,store}=await fixture();const stale=await store.get('u','r');
    global.fetch=jest.fn(async()=>response('r'));await ui.process();
    await store.put({...stale,dirty:true,draft:{principal:432,concept:'No sobrescribir'}});
    const saved=await store.get('u','r');expect(saved.draft.principal).toBe(432);expect(saved.pendingResult).toEqual(result());
});

test('background completion leaves an unrelated business confirmation busy',async()=>{
    const {ui}=await fixture();let finish,started;const ready=new Promise(r=>{started=r;});
    global.fetch=jest.fn(()=>{started();return new Promise(r=>{finish=r;});});
    const pending=ui.process({background:true});await ready;ui.busy=true;finish(response('r'));await pending;expect(ui.busy).toBe(true);
});

test('pausing during audio verification retains the requested recording before any POST or lease',async()=>{
    const {ui,store}=await fixture();let started,release;const ready=new Promise(resolve=>{started=resolve;});
    const digest=crypto.subtle.digest.bind(crypto.subtle);
    jest.spyOn(crypto.subtle,'digest').mockImplementationOnce((...args)=>new Promise(resolve=>{started();release=()=>digest(...args).then(resolve);}));
    global.fetch=jest.fn();const pending=ui.process();await ready;
    expect(voiceKeepPending(ui.record)).toBe(true);pauseVoiceProcessing(ui);await release();await pending;
    const saved=await store.get('u','r');expect(saved.audio).toBeDefined();expect(saved.processingState).toBe('paused');expect(global.fetch).not.toHaveBeenCalled();
});

test('local budget is enforced atomically and freeing an audio permits saving a pending recording',async()=>{
    const {store}=await fixture({records:[]});const audio=new NativeBlob([new Uint8Array(10*1024*1024)]);
    for(let i=0;i<5;i++)await store.put(sample(String(i),{audio}));
    await expect(store.put(sample('six',{audio}))).rejects.toThrow('50 MiB');
    expect(await store.list('u','p')).toHaveLength(5);
    const edited=await store.get('u','0');await store.put({...edited,dirty:true,draft:{principal:123}});
    await store.remove('u','1');await store.put(sample('six',{audio}));expect(await store.get('u','six')).toBeDefined();
});

test('expired pending audio leaves a short-lived notice without transcript or draft',async()=>{
    const {store}=await fixture({records:[sample('r',{processingState:'queued',draft:{principal:555},transcript:'privado'})]});
    const now=Date.now()+VOICE_DAY+1;await store.maintain('u',{keep:true,days:5},now);
    const saved=await store.get('u','r');expect(saved).toMatchObject({processingState:'expired',audioDiscardReason:'expired'});
    expect(saved.audio).toBeUndefined();expect(saved.transcript).toBeUndefined();expect(saved.draft).toBeUndefined();
    await store.maintain('u',{keep:true,days:5},now+7*VOICE_DAY);expect(await store.get('u','r')).toBeUndefined();
});

import { VoiceNameEnrollmentUI, VoiceNameEntry } from '../modules/features/voice/VoiceNameEnrollmentUI.js';
import { VoiceStore } from '../modules/features/voice/VoiceStore.js';
import { indexedDB } from 'fake-indexeddb';
if (!globalThis.structuredClone) globalThis.structuredClone=function clone(value){if(value instanceof Blob)return value.slice(0,value.size,value.type);if(Array.isArray(value))return value.map(clone);if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)]));return value;};
let next=0, nextRecording=0;
function fixture() {
 let uid='user-1',enabled=true,scope={enabled:true,projectId:'project-1'},options;
 const store=new VoiceStore({indexedDB,name:`name-example-${++next}`});
 const adapter={getUser:()=>({uid,getIdToken:jest.fn(async()=> 'mock-token')}),getScope:()=>scope,isEnabled:()=>enabled,getEmployees:()=>[{id:'cliff',name:'Cliff',number:'1'},{id:'cleeft',name:'Cleeft',number:'2'}],getEndpoint:()=> 'https://n8n.example/voice',onLoan:jest.fn(),onAttendance:jest.fn()};
 const recorder={start:jest.fn().mockResolvedValue(),stop:jest.fn(),cancel:jest.fn()};
 const ui=new VoiceNameEnrollmentUI(adapter,{store,recorderFactory:o=>{options=o;return recorder;}}).mount();
 const capture=async()=>{await ui.action('record');await options.onComplete({audio:new Blob(['sample'],{type:'audio/webm'}),mimeType:'audio/webm',durationMs:1000});};
 return {ui,store,adapter,recorder,capture,setUser:v=>{uid=v;},disable:()=>{enabled=false;}};
}
const originalFetch=global.fetch;
beforeEach(()=>{
 Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:()=>`example-recording-${++nextRecording}`});
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
 jest.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 URL.createObjectURL=jest.fn(()=> 'blob:name');URL.revokeObjectURL=jest.fn();
});
afterEach(()=>{global.fetch=originalFetch;jest.restoreAllMocks();document.body.innerHTML='';});
function reply(id,name='Clif'){return {ok:true,schemaVersion:1,requestId:id,result:{transcript:name,intent:'buscar_empleado',employee:{spokenName:name,spokenNumber:null},loan:null,needsReview:false,issues:[]}};}
test('entry is gated by Tests and new employees must be saved first',()=>{
 expect(VoiceNameEntry({id:'cliff'},false)).toBe('');
 document.body.innerHTML=VoiceNameEntry(null,true);expect(document.querySelector('button').disabled).toBe(true);
 document.body.innerHTML=VoiceNameEntry({id:'cliff'},true);expect(document.querySelector('button').disabled).toBe(false);
});
test('recording transcribes without employee data, requires confirmation, deduplicates and deletes the audio',async()=>{
 const {ui,store,adapter,capture}=fixture();
 try {
  await ui.open('cleeft');await capture();const requestId=ui.record.requestId;
  global.fetch=jest.fn(async(_url,{body})=>{const request=JSON.parse(body);expect(Object.keys(request).sort()).toEqual(['schemaVersion','requestId','fileBase64','mimeType','fileName','idToken','context'].sort());return {ok:true,status:200,json:async()=>reply(request.requestId)};});
  await ui.action('process');expect(ui.variant).toBe('Clif');expect(await store.aliases('user-1','project-1')).toEqual([]);
  await ui.action('save');expect((await store.aliases('user-1','project-1'))[0].aliases).toEqual(['clif']);expect(await store.get('user-1',requestId)).toBeUndefined();
  ui.variant='CLIF';await ui.action('save');expect(ui.variants).toEqual(['clif']);
  ui.variant='Cliff';ui.updateVariantState();expect(ui.dialog.querySelector('[data-name-collision]').textContent).toContain('Cliff');
  await ui.action('save');expect(ui.variants).toEqual(['clif','cliff']);
  await ui.action('remove','clif');expect(ui.variants).toEqual(['cliff']);
  expect(await store.aliases('other','project-1')).toEqual([]);expect(await store.aliases('user-1','other-project')).toEqual([]);
  expect(adapter.onLoan).not.toHaveBeenCalled();expect(adapter.onAttendance).not.toHaveBeenCalled();
 } finally {ui.destroy();store.close();}
});
test('manual variant survives reprocessing and an HTTP error retains audio for the same request',async()=>{
 const {ui,store,capture}=fixture();
 try {
  await ui.open('cleeft');await capture();const id=ui.record.requestId;
  const input=ui.dialog.querySelector('[data-name-variant]');input.value='Clift';input.dispatchEvent(new Event('input',{bubbles:true}));
  global.fetch=jest.fn().mockResolvedValue({ok:true,status:200,json:async()=>reply(id,'Cleft')});await ui.action('process');
  expect(ui.variant).toBe('Clift');expect(ui.pendingVariant).toBe('Cleft');await ui.action('use-variant');expect(ui.variant).toBe('Cleft');
  global.fetch=jest.fn().mockRejectedValue(Error('network'));
  await expect(ui.action('process')).rejects.toThrow();expect(ui.record.requestId).toBe(id);expect((await store.get('user-1',id)).audio).toBeDefined();
  expect(ui.variant).toBe('Cleft');
 } finally {ui.destroy();await Promise.resolve();store.close();}
});
test('closing aborts the request and late responses cannot teach a name or expose data in another session',async()=>{
 const {ui,store,capture,setUser}=fixture();let resolve;
 try {
  await ui.open('cleeft');await capture();const id=ui.record.requestId;
  let started;const ready=new Promise(done=>{started=done;});
  global.fetch=jest.fn(()=>new Promise(done=>{resolve=done;started();}));
  const pending=ui.action('process');await ready;
  ui.close();setUser('other');
  resolve({ok:true,status:200,json:async()=>reply(id)});await expect(pending).rejects.toThrow();
  expect(await store.aliases('user-1','project-1')).toEqual([]);expect(await store.get('user-1',id)).toBeUndefined();
  expect(ui.dialog.textContent).toBe('');
 } finally {ui.destroy();store.close();}
});
test('disabled voice and account changes prevent saving even a manual variant',async()=>{
 const {ui,store,disable,setUser}=fixture();
 try {
  await ui.open('cleeft');ui.variant='clift';setUser('other');await expect(ui.action('save')).rejects.toThrow('Cambió');
  disable();await expect(ui.open('cleeft')).rejects.toThrow('Activa Voz');expect(await store.aliases('user-1','project-1')).toEqual([]);
 } finally {ui.destroy();store.close();}
});

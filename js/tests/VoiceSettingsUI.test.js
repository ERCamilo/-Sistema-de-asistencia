import { indexedDB } from 'fake-indexeddb';
import { VoiceStore } from '../modules/features/voice/VoiceStore.js';
import { VoiceSettingsUI } from '../modules/features/voice/VoiceSettingsUI.js';
import { commitAutoSaveOption, commitAutoSaveSwitch } from '../modules/ui/SettingsUI.js';
import { VOICE_DAY } from '../modules/features/voice/VoiceRetention.js';

if (!globalThis.structuredClone) globalThis.structuredClone = function clone(value) {
    if (value instanceof Blob) return value.slice(0,value.size,value.type);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]));
    return value;
};
let ui,store;
beforeEach(()=>{
    HTMLDialogElement.prototype.showModal=jest.fn(function(){this.setAttribute('open','');});
    HTMLDialogElement.prototype.close=jest.fn(function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));});
    jest.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
    URL.createObjectURL=jest.fn(()=> 'blob:voice-test');URL.revokeObjectURL=jest.fn();
});
afterEach(()=>{ui?.destroy();store?.close();ui=store=null;jest.restoreAllMocks();document.body.innerHTML='';});
async function fixture({anonymous=false}={}) {
    let user=anonymous?null:{uid:'u'},scope={enabled:true,projectId:'p'};
    const settings={voiceMvpEnabled:true,voiceKeepLoanAudio:true,voiceAudioRetentionDays:5};
    const employees=[{id:'e',name:'Carlos Méndez',number:'00125',active:true,loans:[{id:'L',principal:500,voiceRequestId:'loan'}]},{id:'other',name:'Carla Medina',number:'00126',active:false,loans:[]}];
    const listeners={},persist=jest.fn(),state={settings};
    const deps={state,batchSetState:callback=>callback(),save:persist};
    store=new VoiceStore({indexedDB,name:'voice-settings-ui-'+Math.random()});
    await store.saveAlias('u','p','e','carlo');await store.saveAlias('u','p','e','carlito');await store.saveAlias('u','p','other','carl');
    await store.put({uid:'u',projectKey:'p',requestId:'loan',createdAt:Date.now()-4*VOICE_DAY,registeredAt:Date.now()-4*VOICE_DAY,completedLoanId:'L',selectedEmployeeId:'e',audio:new Blob(['audio']),transcript:'Un préstamo',durationMs:12000});
    await store.put({uid:'u',projectKey:'p',requestId:'draft',createdAt:Date.now(),audio:new Blob(['draft']),draft:{principal:900}});
    await store.put({uid:'u',projectKey:'elsewhere',requestId:'other-work',createdAt:Date.now(),audio:new Blob(['other'])});
    const adapter={getUser:()=>user,getScope:()=>scope,getSettings:()=>settings,getEmployees:()=>employees,getPositions:()=>[],isEnabled:()=>settings.voiceMvpEnabled,isDeveloper:()=>true,getProjectName:()=> 'Obra de prueba',
        subscribeSession:callback=>{listeners.session=callback;return ()=>{};},subscribeScope:callback=>{listeners.scope=callback;return ()=>{};},subscribeEnabled:callback=>{listeners.settings=callback;return ()=>{};},
        setPreference:(key,value)=>(typeof value==='boolean'?commitAutoSaveSwitch({id:key,checked:value,deps}):commitAutoSaveOption({name:key,value,deps})),
        setAudioRetention:days=>{if(days)commitAutoSaveOption({name:'voiceAudioRetentionDays',value:String(days),deps});commitAutoSaveSwitch({id:'voiceKeepLoanAudio',checked:days>0,deps});},onTeachName:jest.fn(),onOpenLoan:jest.fn(),onLoan:jest.fn()};
    ui=new VoiceSettingsUI(adapter,{store}).mount();await ui.open();
    return {adapter,settings,employees,persist,listeners,setUser:value=>{user=value;listeners.session();},setScope:value=>{scope=value;listeners.scope();}};
}
test('pending filter exposes scoped retry/review and escapes exact server errors',async()=>{
    const {adapter}=await fixture();adapter.onProcessRecording=jest.fn();adapter.onReviewRecording=jest.fn();adapter.onResumePending=jest.fn();
    await store.updateRecording('u','p','draft',row=>({...row,processingState:'error',error:{code:'HTTP_502',message:'HTTP 502 · <script>bad</script>',retryable:true}}));
    await ui.action('recordings');await ui.action('record-filter','pending');
    expect(ui.dialog.querySelectorAll('.vs-record-row')).toHaveLength(1);expect(ui.dialog.querySelector('script')).toBeNull();
    expect(ui.dialog.textContent).toContain('HTTP 502 · <script>bad</script>');
    await ui.action('process-record','draft');expect(adapter.onProcessRecording).toHaveBeenCalledWith('draft');
    await ui.action('review-record','draft');expect(adapter.onReviewRecording).toHaveBeenCalledWith('draft');
    await expect(ui.action('process-record','loan')).rejects.toThrow('no está pendiente');expect(adapter.onLoan).not.toHaveBeenCalled();
});
test('pending UI respects Retry-After and already active workers',async()=>{
    const {adapter}=await fixture();adapter.onProcessRecording=jest.fn();adapter.isProcessing=()=>false;
    await store.updateRecording('u','p','draft',row=>({...row,processingState:'error',retryAt:Date.now()+60000,error:{message:'Espera'}}));
    await ui.action('recordings');expect(ui.dialog.querySelector('[data-vs-action=process-record]').disabled).toBe(true);
    await store.updateRecording('u','p','draft',row=>({...row,retryAt:null}));adapter.isProcessing=()=>true;await ui.refresh();
    expect(ui.dialog.querySelector('[data-vs-action=process-record]').disabled).toBe(true);
});
test('returning from a loan restores its audio or explains expiry without changing the loan',async()=>{
    const {employees,adapter}=await fixture();const before=JSON.stringify(employees);
    await ui.action('recordings');await ui.action('audio','loan');ui.close();
    await ui.resumeNavigation({recordId:'loan',recordFilter:'soon'});expect(ui.view).toBe('audio');expect(ui.dialog.querySelector('audio')).not.toBeNull();expect(ui.dialog.dataset.historyReturn).toBe('on');
    ui.close();await store.discardRecordingAudio('u','p',['loan']);
    await ui.resumeNavigation({recordId:'loan'});expect(ui.view).toBe('recordings');expect(ui.dialog.textContent).toContain('ya no está disponible');
    expect(JSON.stringify(employees)).toBe(before);expect(adapter.onLoan).not.toHaveBeenCalled();
});
test('the existing autosave operations persist modal preferences and configuration works without a session',async()=>{
    const {settings,persist}=await fixture({anonymous:true});
    expect(ui.dialog.textContent).toContain('Inicia sesión');await ui.action('config');
    await ui.action('setting','voiceMvpEnabled');await ui.action('precision','medium');await ui.action('ambiguous','ask');
    expect(settings).toMatchObject({voiceMvpEnabled:false,voiceMatchPrecision:'medium',voiceAmbiguousAction:'ask',_isDirty:true});
    expect(persist).toHaveBeenCalledTimes(3);
});
test('editing an alias keeps other associations and errors preserve the input',async()=>{
    const {adapter}=await fixture();await ui.action('aliases');await ui.action('person','e');await ui.action('edit-alias','carlo');
    ui.aliasText='carl';ui.render();expect(ui.dialog.querySelector('[data-vs-alias-warning]').textContent).toContain('Carla Medina');
    const fail=jest.spyOn(store,'editAlias').mockRejectedValueOnce(Error('Sin espacio'));
    await ui.run(()=>ui.action('save-alias'));expect(ui.dialog.textContent).toContain('Sin espacio');expect(ui.dialog.querySelector('[data-vs-alias-input]').value).toBe('carl');
    fail.mockRestore();await ui.action('save-alias');
    expect((await store.aliases('u','p')).find(row=>row.employeeId==='e').aliases).toEqual(['carl','carlito']);
    expect((await store.aliases('u','p')).find(row=>row.employeeId==='other').aliases).toEqual(['carl']);
    expect(adapter.onLoan).not.toHaveBeenCalled();
});
test('recording deletion preserves the loan, aliases, other works and durable completed marker',async()=>{
    const {employees,adapter}=await fixture();const before=JSON.stringify(employees);
    await ui.action('recordings');await ui.action('audio','loan');await ui.action('remove-audio');
    await ui.action('back');expect((await store.get('u','loan')).audio).toBeDefined();
    await ui.action('remove-audio');await ui.action('confirm');
    expect((await store.get('u','loan')).audio).toBeUndefined();expect((await store.get('u','loan')).completedLoanId).toBe('L');
    expect((await store.get('u','other-work')).audio).toBeDefined();expect((await store.aliases('u','p'))[0].aliases.length).toBeGreaterThan(0);
    expect(JSON.stringify(employees)).toBe(before);expect(adapter.onLoan).not.toHaveBeenCalled();
});
test('removing a draft requires confirmation and only removes its own audio and draft',async()=>{
    await fixture();await ui.action('recordings');await ui.action('audio','draft');await ui.action('remove-audio');
    expect(ui.dialog.textContent).toContain('borradores');await ui.action('confirm');
    expect(await store.get('u','draft')).toBeUndefined();expect((await store.get('u','loan')).audio).toBeDefined();
});
test('retention reduction is explicit and increasing it cannot recover deleted recordings',async()=>{
    const {settings,employees}=await fixture();const original=JSON.stringify(employees);
    await ui.action('retention');await ui.action('retention-days','1');expect(ui.view).toBe('confirm');
    await ui.action('back');expect(settings.voiceAudioRetentionDays).toBe(5);
    await ui.action('retention-days','1');await ui.action('confirm');
    expect(settings.voiceAudioRetentionDays).toBe('1');expect((await store.get('u','loan')).audio).toBeUndefined();
    await ui.action('retention-days','5');expect((await store.get('u','loan')).audio).toBeUndefined();expect(JSON.stringify(employees)).toBe(original);
});
test('changing session invalidates a pending decision and clears all displayed names',async()=>{
    const {setUser}=await fixture();await ui.action('aliases');await ui.action('person','e');await ui.action('remove-alias','carlo');
    setUser({uid:'different'});expect(ui.dialog.open).toBe(false);expect(ui.dialog.textContent).not.toContain('Carlos');
    await ui.action('confirm');expect((await store.aliases('u','p')).find(row=>row.employeeId==='e').aliases).toContain('carlo');
});
test('a late read cannot refill a dialog after a project change',async()=>{
    const {setScope}=await fixture();let finish;
    jest.spyOn(store,'aliases').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const read=ui.refresh();await new Promise(resolve=>setTimeout(resolve,0));setScope({enabled:true,projectId:'new'});
    finish?.([{uid:'u',projectKey:'p',employeeId:'e',aliases:['private-old']}]);await read;
    expect(ui.dialog.open).toBe(false);expect(ui.aliases).toBeNull();expect(ui.dialog.textContent).not.toContain('private-old');
});
test('failed queries stay unverified and retry does not invent zero counts',async()=>{
    await fixture();jest.spyOn(store,'list').mockRejectedValueOnce(Error('IDB bloqueada'));
    await ui.refresh();expect(ui.records).toBeNull();expect(ui.dialog.textContent).toContain('No se pudo consultar');
    await ui.action('retry');expect(ui.records).toHaveLength(2);expect(ui.dialog.textContent).toContain('2 audios');
});
test('search and alias text keep their focus and cursor on data refresh',async()=>{
    await fixture();await ui.action('aliases');let input=ui.dialog.querySelector('[data-vs-search]');input.value='Carlos';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(1,3);
    await ui.refresh();input=ui.dialog.querySelector('[data-vs-search]');expect(document.activeElement).toBe(input);expect(input.selectionStart).toBe(1);expect(input.selectionEnd).toBe(3);
    await ui.action('person','e');await ui.action('edit-alias','carlo');input=ui.dialog.querySelector('[data-vs-alias-input]');input.value='editando';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(2,5);
    await ui.refresh();input=ui.dialog.querySelector('[data-vs-alias-input]');expect(input.value).toBe('editando');expect(document.activeElement).toBe(input);expect(input.selectionStart).toBe(2);
});
test('an audio expiring while its player is open stops playback and revokes its URL',async()=>{
    await fixture();await ui.action('recordings');await ui.action('audio','loan');expect(ui.audioURL).toBeTruthy();
    const now=Date.now();jest.spyOn(Date,'now').mockReturnValue(now+2*VOICE_DAY);await ui.refresh();
    expect(ui.view).toBe('recordings');expect(ui.audioURL).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalled();
});

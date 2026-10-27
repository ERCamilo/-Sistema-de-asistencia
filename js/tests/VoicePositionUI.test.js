import { indexedDB } from 'fake-indexeddb';
import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
import { VoiceStore } from '../modules/features/voice/VoiceStore.js';

if (!globalThis.structuredClone) globalThis.structuredClone=value=>JSON.parse(JSON.stringify(value));
const positions=[{id:'brick',name:'Albañil'},{id:'electric',name:'Electricista'}];
const people=[{id:'a',name:'Juan Méndez',number:'00125',positions:['brick']},{id:'b',name:'Juan Pérez',number:'00126',positions:['brick','electric']}];
let ui,store;
function fixture(name='Juan',transcript='Juan el electricista') {
    let uid='u',scope={enabled:true,projectId:'p'};
    store=new VoiceStore({indexedDB,name:'voice-position-ui-'+Math.random()});
    const adapter={getUser:()=>({uid}),getScope:()=>scope,getEmployees:()=>people,getPositions:()=>positions,getSettings:()=>({voiceMatchPrecision:'high'}),getLoanDefaults:()=>({}),validateLoan:()=>({valid:true}),onLoan:jest.fn()};
    ui=new VoiceMvpUI(adapter,{store});ui.dialog=document.createElement('dialog');document.body.append(ui.dialog);
    ui.record={uid,projectKey:'p',requestId:'r',createdAt:Date.now(),mention:{spokenName:name},transcript,result:{intent:'crear_prestamo',issues:[],needsReview:false},draft:{principal:7000,interestRate:25,installmentMode:'lump',installmentCount:1,startDate:'2026-10-27',dueDate:'2030-12-31',concept:'Nota manual'},employeeDefaultsApplied:true};
    ui.view='employees';
    return {adapter,setUser:value=>{uid=value;},setScope:value=>{scope=value;}};
}
afterEach(()=>{store?.close();ui?.dialog?.remove();jest.restoreAllMocks();});
test('homonyms are ordered by the secondary position; selecting/changing employee retains all loan edits and never saves business data',async()=>{
    const {adapter}=fixture();const draft={...ui.record.draft};
    await ui.refreshMatches();await ui.routeResult();ui.render();
    expect(ui.view).toBe('employees');expect(ui.record.selectedEmployeeId).toBeUndefined();
    expect([...ui.dialog.querySelectorAll('[data-voice-action=select]')].map(button=>button.dataset.id)).toEqual(['b','a']);
    expect(ui.dialog.querySelector('.voice-position-match').textContent).toBe('Electricista');
    await ui.action('select','b');expect(ui.view).toBe('loan');expect(ui.record.employeeSelection).toBe('manual');
    await ui.action('choose');await ui.action('select','a');expect(ui.record.draft).toEqual(draft);expect(adapter.onLoan).not.toHaveBeenCalled();
});
test('occupation-only instructions need manual selection and do not propose remembering the job as a nickname',async()=>{
    fixture('electricista','Préstamo al electricista');await ui.refreshMatches();await ui.routeResult();
    expect(ui.record.selectedEmployeeId).toBeUndefined();expect(ui.view).toBe('employees');
    await ui.action('select','b');expect(ui.view).toBe('loan');expect(ui.aliasSelection).toBeUndefined();expect(await store.aliases('u','p')).toEqual([]);
});
test('explicit nickname learning uses the cleaned name, never the position, and only after its existing confirmation',async()=>{
    fixture('Yuan el electricista','Préstamo a Yuan el electricista');await ui.refreshMatches();await ui.routeResult();ui.render();
    await ui.action('select','b');expect(ui.view).toBe('remember');expect(ui.aliasSelection.spokenName).toBe('yuan');
    expect(await store.aliases('u','p')).toEqual([]);await ui.action('alias-save');
    expect((await store.aliases('u','p'))[0]).toMatchObject({employeeId:'b',aliases:['yuan']});expect(ui.record.mention.spokenName).toBe('Yuan el electricista');
});
test('ignoring/restoring the clue changes ordering but preserves every draft field',async()=>{
    fixture();await ui.refreshMatches();const draft={...ui.record.draft};
    await ui.action('position-hint');expect(ui.matches.map(match=>match.employee.id)).toEqual(['a','b']);expect(ui.employeeResolution.ignored).toBe(true);
    await ui.action('position-hint');expect(ui.matches.map(match=>match.employee.id)).toEqual(['b','a']);expect(ui.record.draft).toEqual(draft);
});
test.each(['account','scope','record'])('a late local alias read cannot apply a position resolution after changing %s',async what=>{
    const {setUser,setScope}=fixture();let finish;
    jest.spyOn(store,'aliases').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=ui.refreshMatches();
    if(what==='account')setUser('other');else if(what==='scope')setScope({enabled:true,projectId:'other'});else ui.record={...ui.record,requestId:'new',mention:{spokenName:'other'}};
    finish([]);
    if(what==='record')await pending;else await expect(pending).rejects.toThrow('Cambió');
    expect(ui.employeeResolution).toBeUndefined();
});
test('an edited transcript invalidates an automatic selection while retaining its editable loan',async()=>{
    fixture('Juan Méndez','Juan Méndez albañil');await ui.refreshMatches();await ui.routeResult();const draft={...ui.record.draft};
    expect(ui.record.employeeSelection).toBe('automatic');
    const input=document.createElement('textarea');input.dataset.voiceTranscript='';input.value='Juan Méndez el electricista';await ui.change(input);
    expect(ui.record.selectedEmployeeId).toBeNull();expect(ui.view).toBe('employees');expect(ui.employeeResolution.automatic).toBeNull();expect(ui.record.draft).toEqual(draft);
});
test('an older draft with an unconfirmed selection must resolve a newly detected role conflict once',async()=>{
    fixture('Juan Méndez','Juan Méndez el electricista');ui.record.selectedEmployeeId='a';const draft={...ui.record.draft};
    await ui.refreshMatches();expect(ui.record.selectedEmployeeId).toBeNull();expect(ui.view).toBe('employees');expect(ui.record.draft).toEqual(draft);
    await ui.action('select','a');await ui.refreshMatches();expect(ui.record.selectedEmployeeId).toBe('a');expect(ui.record.employeeSelection).toBe('manual');
});
test('a name search with homonyms waits for a choice and uses the existing attendance navigation',async()=>{
    const {adapter}=fixture();adapter.onAttendance=jest.fn();ui.close=jest.fn();ui.record.result.intent='buscar_empleado';ui.record.draft=null;
    await ui.refreshMatches();await ui.routeResult();expect(adapter.onAttendance).not.toHaveBeenCalled();expect(ui.view).toBe('employees');
    await ui.action('select','b');expect(adapter.onAttendance).toHaveBeenCalledWith('b');expect(adapter.onLoan).not.toHaveBeenCalled();
});

import { indexedDB } from 'fake-indexeddb';
import { VoiceStore } from '../modules/features/voice/VoiceStore.js';

if (!globalThis.structuredClone) globalThis.structuredClone = function clone(value) {
    if (value instanceof Blob) return value.slice(0,value.size,value.type);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]));
    return value;
};
let store;
beforeEach(()=>{store=new VoiceStore({indexedDB,name:'voice-settings-store-'+Math.random()});});
afterEach(()=>store.close());
const recording=(requestId,overrides={})=>({uid:'u',projectKey:'p',requestId,createdAt:Date.now(),audio:new Blob(['voice']),...overrides});

test('an alias replacement is atomic, deduplicates and preserves all other associations',async()=>{
    await store.saveAlias('u','p','e','carlo');await store.saveAlias('u','p','e','carlito');await store.saveAlias('u','p','other','carlo');
    await store.editAlias('u','p','e','carlo','Carlosito');
    expect((await store.aliases('u','p')).find(row=>row.employeeId==='e').aliases).toEqual(['carlosito','carlito']);
    expect((await store.aliases('u','p')).find(row=>row.employeeId==='other').aliases).toEqual(['carlo']);
    await expect(store.editAlias('u','p','e','carlosito','carlito')).rejects.toThrow('ya está');
    await expect(store.editAlias('u','p','e','already-edited','nuevo')).rejects.toThrow('otra ventana');
    expect((await store.aliases('u','p')).find(row=>row.employeeId==='e').aliases).toEqual(['carlosito','carlito']);
});
test('a transaction rereads concurrent additions instead of replacing their array',async()=>{
    await store.saveAlias('u','p','e','carlo');
    await Promise.all([store.editAlias('u','p','e','carlo','carlosito'),store.editAlias('u','p','e',null,'carlito')]);
    expect((await store.aliases('u','p'))[0].aliases).toEqual(['carlosito','carlito']);
});
test('a changed session aborts alias edit and removal before the transaction writes',async()=>{
    await store.saveAlias('u','p','e','carlo');
    for(const remove of [false,true]) {
        let calls=0;const guard=()=>{if(++calls>1)throw Error('Cambió la cuenta');};
        await expect(remove?store.removeAlias('u','p','e','carlo',{guard}):store.editAlias('u','p','e','carlo','nuevo',{guard})).rejects.toThrow('Cambió');
    }
    expect((await store.aliases('u','p'))[0].aliases).toEqual(['carlo']);
});
test('adding at the limit never silently evicts an existing nickname',async()=>{
    for(let n=0;n<50;n++)await store.saveAlias('u','p','e','alias '+n);
    await expect(store.editAlias('u','p','e',null,'otra')).rejects.toThrow('50');
    await expect(store.saveAlias('u','p','e','otra')).rejects.toThrow('50');
    expect((await store.aliases('u','p'))[0].aliases).toHaveLength(50);
});
test('expiry maintenance aborts if its account guard changes during the read',async()=>{
    await store.put(recording('expired',{createdAt:1}));let calls=0;
    await expect(store.maintain('u',{keep:true,days:5},Date.now(),{guard:()=>{if(++calls>1)throw Error('Otra cuenta');}})).rejects.toThrow('Otra cuenta');
    expect((await store.get('u','expired')).audio).toBeDefined();
});
test('audio deletion preserves completed markers and ignores other people, works and accounts',async()=>{
    await store.put(recording('loan',{completedLoanId:'L',selectedEmployeeId:'e',registeredAt:Date.now(),draft:{principal:500}}));
    await store.put(recording('draft',{draft:{principal:900}}));await store.put(recording('other-project',{projectKey:'other'}));await store.put(recording('other-account',{uid:'other'}));await store.put(recording('newer'));
    await store.saveAlias('u','p','e','carlo');
    const announce=jest.fn();window.addEventListener('sa:voice-audio-discarded',announce);
    try {await store.discardRecordingAudio('u','p',['loan','draft'],{now:123});}finally{window.removeEventListener('sa:voice-audio-discarded',announce);}
    expect(await store.get('u','loan')).toMatchObject({completedLoanId:'L',selectedEmployeeId:'e',audioDiscardedAt:123,audioDiscardReason:'manual'});
    expect((await store.get('u','loan')).audio).toBeUndefined();expect(await store.get('u','draft')).toBeUndefined();
    for(const id of ['other-project','newer'])expect((await store.get('u',id)).audio).toBeInstanceOf(Blob);
    expect((await store.get('other','other-account')).audio).toBeInstanceOf(Blob);
    expect((await store.aliases('u','p'))[0].aliases).toEqual(['carlo']);
    expect(announce).toHaveBeenCalledTimes(1);
});
test('stale targets and changed sessions roll back the whole reviewed batch',async()=>{
    await store.put(recording('one'));await store.put(recording('two'));
    await expect(store.discardRecordingAudio('u','p',['one','missing'])).rejects.toThrow('lista');
    expect((await store.get('u','one')).audio).toBeInstanceOf(Blob);
    let calls=0;
    await expect(store.discardRecordingAudio('u','p',['one','two'],{guard:()=>{if(++calls>2)throw Error('Otra sesión');}})).rejects.toThrow('Otra sesión');
    expect((await store.get('u','one')).audio).toBeInstanceOf(Blob);expect((await store.get('u','two')).audio).toBeInstanceOf(Blob);
});
test('an old window cannot resurrect a deleted loan audio or remove its completed marker',async()=>{
    const row=recording('loan',{completedLoanId:'L',selectedEmployeeId:'e'});await store.put(row);
    await store.discardRecordingAudio('u','p',['loan']);
    await expect(store.put(row)).rejects.toThrow('eliminado');
    await expect(store.put({...row,completedLoanId:undefined})).rejects.toThrow('registró');
    expect((await store.get('u','loan')).completedLoanId).toBe('L');expect((await store.get('u','loan')).audio).toBeUndefined();
});

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import { state } from '../modules/core/AppState.js';
import { confirmImportFull,setImportFullText } from '../modules/features/export/ExportController.js';
if(!globalThis.structuredClone)globalThis.structuredClone=x=>JSON.parse(JSON.stringify(x));
const payload=()=>({data:{employees:[{id:'new-e',number:'2',name:'New',positions:['new-p']}],positions:[{id:'new-p',name:'New Position'}],leaders:[{id:'new-l',number:'2',name:'New Leader'}],attendance:{},settings:{companyName:'Imported'}}});
let db,original;
beforeEach(async()=>{
 jest.useFakeTimers();localStorage.clear();original={employees:state.employees,positions:state.positions,leaders:state.leaders,attendance:state.attendance,settings:state.settings};
 db=new IndexedDBService('supervisor-'+Math.random());await db.init();
 await db.update('employees',{id:'old-e',number:'1',name:'Original'});await db.update('leaders',{id:'old-l',number:'1'});await db.update('settings',{key:'app',companyName:'Original'});
 Object.assign(state,{employees:[{id:'old-e',number:'1'}],positions:[],leaders:[{id:'old-l',number:'1'}],attendance:{},settings:{companyName:'Original'},isDataLoaded:true,useIndexedDB:true});
 mockedIDB.saveState.mockImplementation((s,o)=>db.saveState(s,o));
});
afterEach(()=>{jest.restoreAllMocks();mockedIDB.saveState.mockReset();db.db.close();Object.assign(state,original);delete window.showConfirm;jest.clearAllTimers();jest.useRealTimers();});
const snapshot=async()=>({employees:await db.getAll('employees'),leaders:await db.getAll('leaders'),settings:await db.getAll('settings')});
async function apply(data){let callback;window.showConfirm=opts=>callback=opts.onConfirm;setImportFullText(JSON.stringify(data));confirmImportFull();expect(callback).toBeInstanceOf(Function);await callback();}

const cashStores=['pettyCashProjects','pettyCashPeriods','pettyCashMovements'];
const cashPayload=()=>({...payload(),data:{...payload().data,pettyCash:{projects:[{id:'cash-new',name:'Imported cash'}],periods:[{id:'period-new',projectId:'cash-new'}],movements:[{id:'move-new',projectId:'cash-new',periodId:'period-new',amount:50}]}}});
async function wireCash(){
 for(const method of ['getAll','clear','batchUpdate'])mockedIDB[method].mockImplementation((...args)=>db[method](...args));
 await db.update('pettyCashProjects',{id:'cash-old',name:'Original cash'});
 await db.update('pettyCashPeriods',{id:'period-old',projectId:'cash-old'});
 await db.update('pettyCashMovements',{id:'move-old',projectId:'cash-old',periodId:'period-old',amount:25});
}
async function completeSnapshot(){return {...await snapshot(),cash:await Promise.all(cashStores.map(s=>db.getAll(s)))};}
function failPut(storeName){
 const probe=db.db.transaction([storeName],'readwrite');const proto=Object.getPrototypeOf(probe.objectStore(storeName));const put=proto.put;probe.abort();
 jest.spyOn(proto,'put').mockImplementation(function(value,...args){if(this.name===storeName)throw new DOMException('Supervisor injected storage failure','QuotaExceededError');return put.call(this,value,...args);});
}
afterEach(()=>{for(const method of ['getAll','clear','batchUpdate'])mockedIDB[method].mockReset();});
test('FULL with petty cash preserves ALL durable collections when the later settings write fails',async()=>{
 await wireCash();const before=await completeSnapshot();failPut('settings');await apply(cashPayload());const after=await completeSnapshot();
 console.log('SUP_FULL_CASH_SETTINGS',JSON.stringify({before,after}));expect(after).toEqual(before);
});
test('FULL with petty cash preserves ALL durable collections when a cash write fails',async()=>{
 await wireCash();const before=await completeSnapshot();failPut('pettyCashPeriods');await apply(cashPayload());const after=await completeSnapshot();
 console.log('SUP_FULL_CASH_PERIODS',JSON.stringify({before,after}));expect(after).toEqual(before);
});
test('FULL with petty cash succeeds when storage does not fail',async()=>{
 await wireCash();await apply(cashPayload());const after=await completeSnapshot();
 expect(after.employees.map(e=>e.id)).toEqual(['new-e']);expect(after.settings[0].companyName).toBe('Imported');expect(after.cash.map(list=>list.map(x=>x.id))).toEqual([['cash-new'],['period-new'],['move-new']]);
});

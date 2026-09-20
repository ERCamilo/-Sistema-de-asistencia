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
test('failed FULL durable write preserves the previous persisted dataset',async()=>{
 const before=await snapshot();const probe=db.db.transaction(['settings'],'readwrite');const proto=Object.getPrototypeOf(probe.objectStore('settings'));const put=proto.put;probe.abort();
 jest.spyOn(proto,'put').mockImplementation(function(value,...args){if(this.name==='settings'&&value.companyName==='Imported')throw new DOMException('Injected storage failure','QuotaExceededError');return put.call(this,value,...args);});
 await apply(payload());const after=await snapshot();console.log('SUPERVISOR_STORAGE_EVIDENCE',JSON.stringify({before,after}));expect(after).toEqual(before);
});
test('failed FULL does not leave imported state as the current application data',async()=>{
 const before=JSON.parse(JSON.stringify({employees:state.employees,settings:state.settings}));mockedIDB.saveState.mockRejectedValue(new DOMException('Injected storage failure','QuotaExceededError'));
 await apply(payload());expect({employees:state.employees,settings:state.settings}).toEqual(before);
});
test('successful FULL replaces the previous dataset and persists the imported configuration',async()=>{
 await apply(payload());const after=await snapshot();expect(after.employees.map(e=>e.id)).toEqual(['new-e']);expect(after.leaders.map(e=>e.id)).toEqual(['new-l']);expect(after.settings[0].companyName).toBe('Imported');
});

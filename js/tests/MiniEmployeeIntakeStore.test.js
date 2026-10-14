import { serialize, deserialize } from 'node:v8';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { MiniEmployeeIntakeStore } from '../modules/features/p2p/MiniEmployeeIntakeStore.js';
import { intakeReviewVersion } from '../modules/features/p2p/MiniEmployeeIntake.js';
const payload={schema:'mini-roster-proposal/v1',proposalId:'proposal-1',requestId:'request-1',saProjectId:'P-1',generatedAt:'2026-10-14T12:00:00.000Z',salaryPeriod:'daily',currency:'DOP',employees:[{miniLocalId:'mini-1',number:'1',name:'Ana',position:'Ayudante',dailySalary:1500,phone:'',email:''}]};
let db, model, store, owner, scope;
beforeEach(async()=>{
 global.structuredClone=value=>deserialize(serialize(value));
 global.indexedDB=new IDBFactory();db=new IndexedDBService('intake-test',22);await db.init();
 owner='owner-A';scope={enabled:true,projectId:'P-1',defaultProjectId:'P-1'};model={employees:[],positions:[]};let seq=0;
 store=new MiniEmployeeIntakeStore({dbService:db,readState:()=>model,readOwner:()=>owner,readScope:()=>scope,createId:k=>`${k}-${++seq}`,publish:plan=>{model.employees.push(...plan.employees);model.positions.push(...plan.positions);},onCommitted:async()=>{}});
});
afterEach(()=>db?.db?.close());
test('recibir no crea personal; aceptar persiste y el reenvío no repite altas',async()=>{
 const entry=await store.stage(payload,{peerId:'peer-1',peerName:'Mini',scope});
 expect(await db.getAll('employees')).toEqual([]);
 const version=intakeReviewVersion(model,scope,8);
 const result=await store.accept(entry.id,[{miniLocalId:'mini-1',action:'create'}],{scope,hoursPerDay:8,version});
 expect((await db.getAll('employees'))).toHaveLength(1);expect((await db.getAll('positions'))).toHaveLength(1);
 const replay=await store.stage({...payload,requestId:'request-2'},{peerId:'peer-1',scope});expect(replay.status).toBe('resolved');
 expect((await store.accept(entry.id,[],{scope,hoursPerDay:8,version:intakeReviewVersion(model,scope,8)})).result).toEqual(result.result);
 expect(model.employees).toHaveLength(1);
});
test('fallar el ledger aborta también empleados y puestos',async()=>{
 const entry=await store.stage(payload,{peerId:'peer-1',scope});
 const put=jest.spyOn(Object.getPrototypeOf(db.db.transaction('settings').objectStore('settings')),'put');
 const realPut=put.getMockImplementation();
 put.mockImplementation(function(value){if(this.name==='settings')throw new Error('Disco lleno');return realPut.call(this,value);});
 try{await expect(store.accept(entry.id,[{miniLocalId:'mini-1',action:'create'}],{scope,hoursPerDay:8,version:intakeReviewVersion(model,scope,8)})).rejects.toThrow(/Disco/);}finally{put.mockRestore();}
 expect(await db.getAll('employees')).toEqual([]);expect(await db.getAll('positions')).toEqual([]);expect((await store.list())[0].status).toBe('pending');expect(model.employees).toEqual([]);
});
test('aceptación parcial conserva vínculos y permite revisar el resto con datos actuales',async()=>{
 const two={...payload,employees:[...payload.employees,{...payload.employees[0],miniLocalId:'mini-2',number:'2',name:'Beto'}]};
 const entry=await store.stage(two,{peerId:'peer-1',scope});
 const first=await store.accept(entry.id,[{miniLocalId:'mini-1',action:'create'},{miniLocalId:'mini-2',action:'pending'}],{scope,hoursPerDay:8,version:intakeReviewVersion(model,scope,8)});
 const second=await store.accept(entry.id,[{miniLocalId:'mini-1',action:'link',employeeId:first.result.mappings[0].saEmployeeId},{miniLocalId:'mini-2',action:'create'}],{scope,hoursPerDay:8,version:intakeReviewVersion(model,scope,8)});
 expect(second.result.mappings).toHaveLength(2);expect((await db.getAll('employees'))).toHaveLength(2);expect((await db.getAll('positions'))).toHaveLength(1);
 expect((await store.list())[0].status).toBe('resolved');
});
test('descartar impide aceptar y cambiar jornada invalida la revisión',async()=>{
 const entry=await store.stage(payload,{peerId:'peer-1',scope}),version=intakeReviewVersion(model,scope,8);
 store.readHours=()=>7;
 await expect(store.accept(entry.id,[{miniLocalId:'mini-1',action:'create'}],{scope,hoursPerDay:8,version})).rejects.toThrow(/jornada/);
 store.readHours=()=>8;await store.discard(entry.id,scope);
 await expect(store.accept(entry.id,[{miniLocalId:'mini-1',action:'create'}],{scope,hoursPerDay:8,version})).rejects.toThrow(/descart/);
 expect(await db.getAll('employees')).toEqual([]);
});
test('ID repetido con otro contenido o cambio de dueño/obra se rechaza',async()=>{
 const entry=await store.stage(payload,{peerId:'peer-1',scope});
 await expect(store.stage({...payload,employees:[{...payload.employees[0],name:'Otro'}]},{peerId:'peer-1',scope})).rejects.toThrow(/contenido/);
 owner='owner-B';expect(await store.list()).toEqual([]);
 await expect(store.accept(entry.id,[],{scope,hoursPerDay:8,version:''})).rejects.toThrow();
 owner='owner-A';scope={...scope,projectId:'P-2'};
 await expect(store.accept(entry.id,[],{scope,hoursPerDay:8,version:''})).rejects.toThrow(/obra/);
 expect(await db.getAll('employees')).toEqual([]);
});
test('una ficha ocupada en otra pestaña bloquea el alta sin dejar un puesto parcial',async()=>{
 const entry=await store.stage(payload,{peerId:'peer-1',scope});const version=intakeReviewVersion(model,scope,8);
 await db.update('employees',{id:'concurrent',number:'1',name:'Beto',projectId:'P-1',updatedAt:Date.now()});
 await expect(store.accept(entry.id,[{miniLocalId:'mini-1',action:'create'}],{scope,hoursPerDay:8,version})).rejects.toThrow(/cambi|ficha/);
 expect(await db.getAll('positions')).toEqual([]);expect((await db.getAll('employees'))).toHaveLength(1);
});

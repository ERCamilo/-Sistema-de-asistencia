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
test('una propuesta local (nacida de la asistencia) conserva su marca y se reutiliza al repetirla',async()=>{
 const entry=await store.stage(payload,{peerId:'attendance:phone-1',peerName:'Mini de Juan',scope,local:true});
 expect(entry.local).toBe(true);
 const again=await store.stage(payload,{peerId:'attendance:phone-1',peerName:'Mini de Juan',scope,local:true});
 expect(again.id).toBe(entry.id);expect((await store.list()).filter(e=>e.id===entry.id)).toHaveLength(1);
 expect((await store.stage({...payload,proposalId:'proposal-2'},{peerId:'peer-1',scope})).local).toBeUndefined();
});

describe('una sola actividad por integración de personal', () => {
 let activities, activityStore;
 beforeEach(() => {
  activities = new Map();
  activityStore = {
   recordActivity: jest.fn(entry => { activities.set(entry.id, { ...activities.get(entry.id), ...entry }); return activities.get(entry.id); }),
   updateActivity: jest.fn((id, patch) => { activities.set(id, { ...activities.get(id), ...patch }); return activities.get(id); })
  };
  store.activityStore = activityStore;
 });
 const three = { ...payload, employees: [1, 2, 3].map(n => ({ ...payload.employees[0], miniLocalId: `mini-${n}`, number: String(n), name: `Emp ${n}` })) };

 test('recibir N empleados registra una actividad con el conteo; reenviar no la duplica', async () => {
  await store.stage(three, { peerId: 'peer-1', peerName: 'Mini A', scope });
  await store.stage({ ...three, requestId: 'request-2' }, { peerId: 'peer-1', peerName: 'Mini A', scope });
  expect(activities.size).toBe(1);
  const [activity] = [...activities.values()];
  expect(activity).toMatchObject({ kind: 'roster', status: 'pending', peerName: 'Mini A', saProjectId: 'P-1' });
  expect(activity.summary).toContain('3 empleados');
 });

 test('aceptar actualiza esa misma actividad con cuántos se integraron', async () => {
  const entry = await store.stage(three, { peerId: 'peer-1', scope });
  const decisions = [{ miniLocalId: 'mini-1', action: 'create' }, { miniLocalId: 'mini-2', action: 'create' }, { miniLocalId: 'mini-3', action: 'pending' }];
  await store.accept(entry.id, decisions, { scope, hoursPerDay: 8, version: intakeReviewVersion(model, scope, 8) });
  expect(activities.size).toBe(1);
  const [activity] = [...activities.values()];
  expect(activity.status).toBe('partial');expect(activity.summary).toContain('2 de 3');
  await store.accept(entry.id, [{ miniLocalId: 'mini-1', action: 'link', employeeId: model.employees[0].id }, { miniLocalId: 'mini-2', action: 'link', employeeId: model.employees[1].id }, { miniLocalId: 'mini-3', action: 'create' }], { scope, hoursPerDay: 8, version: intakeReviewVersion(model, scope, 8) });
  expect([...activities.values()][0]).toMatchObject({ status: 'success' });expect([...activities.values()][0].summary).toContain('3 de 3');
 });

 test('un fallo del registro de actividad no impide guardar el personal', async () => {
  activityStore.recordActivity.mockImplementation(() => { throw new Error('storage full'); });
  const entry = await store.stage(three, { peerId: 'peer-1', scope });
  expect((await store.list())).toHaveLength(1);expect(entry.status).toBe('pending');
 });

 test('una propuesta local nueva reemplaza a la pendiente anterior del mismo origen y reutiliza la actividad', async () => {
  await store.stage(three, { peerId: 'attendance:texto', scope, local: true });
  const two = { ...three, proposalId: 'proposal-2', employees: three.employees.slice(0, 2) };
  await store.stage(two, { peerId: 'attendance:texto', scope, local: true });
  const items = await store.list();
  expect(items).toHaveLength(1);expect(items[0].payload.proposalId).toBe('proposal-2');
  expect(activities.size).toBe(1);expect([...activities.values()][0].summary).toContain('2 empleados');
 });

 test('el reemplazo no toca propuestas de un Mini conectado ni de otro origen', async () => {
  await store.stage(three, { peerId: 'peer-1', scope });
  await store.stage({ ...three, proposalId: 'proposal-t' }, { peerId: 'attendance:texto', scope, local: true });
  await store.stage({ ...three, proposalId: 'proposal-t2' }, { peerId: 'attendance:texto', scope, local: true });
  expect((await store.list()).map(e => e.peerId).sort()).toEqual(['attendance:texto', 'peer-1']);
  expect(activities.size).toBe(2);
 });
});

describe('un empleado resuelto en un origen se resuelve en los demás donde se repite', () => {
 const rowOf = (id, number, name) => ({ ...payload.employees[0], miniLocalId: id, number, name });
 const proposal = (proposalId, rows) => ({ ...payload, proposalId, requestId: `req-${proposalId}`, employees: rows });
 const accept = (entry, decisions) => store.accept(entry.id, decisions, { scope, hoursPerDay: 8, version: intakeReviewVersion(model, scope, 8) });

 test('crear en un Mini marca resuelto al mismo empleado (ficha y nombre) en otro Mini y en el texto', async () => {
  const a = await store.stage(proposal('pa', [rowOf('a1', '1', 'Ana Pérez'), rowOf('a2', '2', 'Beto')]), { peerId: 'peer-A', scope });
  const b = await store.stage(proposal('pb', [rowOf('b1', '1', 'ana perez'), rowOf('b3', '3', 'Carla')]), { peerId: 'peer-B', scope });
  const t = await store.stage(proposal('pt', [rowOf('t1', '1', 'Pérez Ana')]), { peerId: 'attendance:texto', scope, local: true });
  const outcome = await accept(a, [{ miniLocalId: 'a1', action: 'create' }, { miniLocalId: 'a2', action: 'pending' }]);
  const created = outcome.result.mappings[0].saEmployeeId;
  const items = await store.list();
  const byId = Object.fromEntries(items.map(e => [e.id, e]));
  expect(byId[b.id].mappings.map(m => [m.miniLocalId, m.saEmployeeId])).toEqual([['b1', created]]);
  expect(byId[b.id].status).toBe('pending');
  expect(byId[b.id].result.mappings).toHaveLength(1);
  expect(byId[t.id].status).toBe('resolved');
  expect(outcome.autoResolved.map(x => x.entry.id).sort()).toEqual([b.id, t.id].sort());
  expect(await store.linksFor('peer-B', 'P-1')).toHaveProperty('b1');
 });

 test('no cruza personas con la misma ficha pero otro nombre', async () => {
  const a = await store.stage(proposal('pa', [rowOf('a1', '1', 'Ana')]), { peerId: 'peer-A', scope });
  const b = await store.stage(proposal('pb', [rowOf('b1', '1', 'Otra Persona')]), { peerId: 'peer-B', scope });
  const outcome = await accept(a, [{ miniLocalId: 'a1', action: 'create' }]);
  expect(outcome.autoResolved).toEqual([]);
  expect((await store.list()).find(e => e.id === b.id).mappings).toEqual([]);
 });

 test('al vincular a un empleado con otra ficha también se resuelve la misma fila de otro Mini', async () => {
  model.employees.push({ id: 'e-40', number: '40', name: 'Ana M', projectId: 'P-1' });
  const a = await store.stage(proposal('pa', [rowOf('a1', '4', 'Ana M')]), { peerId: 'peer-A', scope });
  const b = await store.stage(proposal('pb', [rowOf('b1', '4', 'Ana M')]), { peerId: 'peer-B', scope });
  await accept(a, [{ miniLocalId: 'a1', action: 'link', employeeId: 'e-40' }]);
  const stored = (await store.list()).find(e => e.id === b.id);
  expect(stored.mappings[0]).toMatchObject({ miniLocalId: 'b1', saEmployeeId: 'e-40' });
  expect(stored.status).toBe('resolved');
 });

 test('un fallo al validar el resultado de otro origen no impide aceptar el actual', async () => {
  const a = await store.stage(proposal('pa', [rowOf('a1', '1', 'Ana')]), { peerId: 'peer-A', scope });
  await store.stage(proposal('pb', [rowOf('b1', '1', 'Ana'), rowOf('b2', '1', 'Ana')]), { peerId: 'peer-B', scope });
  const outcome = await accept(a, [{ miniLocalId: 'a1', action: 'create' }]);
  expect(outcome.result.mappings).toHaveLength(1);
 });
});

describe('vínculo recordado cuyo empleado ya no existe', () => {
 const accept = (entry, decisions) => store.accept(entry.id, decisions, { scope, hoursPerDay: 8, version: intakeReviewVersion(model, scope, 8) });

 test('permite volver a crear a la persona si su empleado de SA fue borrado', async () => {
  const first = await store.stage(payload, { peerId: 'peer-1', scope });
  const created = (await accept(first, [{ miniLocalId: 'mini-1', action: 'create' }])).result.mappings[0].saEmployeeId;
  model.employees = model.employees.map(e => e.id === created ? { ...e, deletedAt: Date.now(), updatedAt: Date.now() + 1000 } : e);
  const again = await store.stage({ ...payload, proposalId: 'proposal-2', requestId: 'request-2' }, { peerId: 'peer-1', scope });
  const outcome = await accept(again, [{ miniLocalId: 'mini-1', action: 'create' }]);
  expect(outcome.result.mappings[0].saEmployeeId).not.toBe(created);
  expect(await store.linksFor('peer-1', 'P-1')).toMatchObject({ 'mini-1': { saEmployeeId: outcome.result.mappings[0].saEmployeeId } });
 });

 test('un vínculo vigente sigue impidiendo crear un duplicado', async () => {
  const first = await store.stage(payload, { peerId: 'peer-1', scope });
  await accept(first, [{ miniLocalId: 'mini-1', action: 'create' }]);
  const again = await store.stage({ ...payload, proposalId: 'proposal-2', requestId: 'request-2' }, { peerId: 'peer-1', scope });
  await expect(accept(again, [{ miniLocalId: 'mini-1', action: 'create' }])).rejects.toThrow(/ya está vinculado/);
 });
});

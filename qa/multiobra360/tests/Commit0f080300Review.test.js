import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { auth } from '../../../js/modules/data/firebase.js';
import { setProjectsEnabled } from '../../../js/modules/config/FeatureFlags.js';
import { syncProjectCatalog, stopProjectCatalogLiveSync } from '../../../js/modules/features/projects/ProjectCatalogSync.js';
import { replaceEntityScope, resetEntityScope } from '../../../js/modules/features/projects/EntityProjectScope.js';
import { createDefaultConfig } from '../../../js/modules/features/payroll/ProjectPayrollConfig.js';
import * as repository from '../../../js/modules/features/payroll/ProjectPayrollConfigStore.js';
import * as active from '../../../js/modules/features/payroll/ActivePayrollSettings.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
const DATE='2026-10-26',NEXT='2026-10-27';
const project=id=>({id,name:'Synthetic '+id,status:'active',schemaVersion:1,createdAt:1,updatedAt:1});
const config=(hours=8)=>({...createDefaultConfig('O'),regularHoursPerDay:8,updatedAt:1,dayHours:{[DATE]:hours,[NEXT]:8}});
const snapshot=rows=>({forEach:fn=>rows.forEach(row=>fn({id:row.id,data:()=>row}))});
let db,releases,flights;
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);const d={promise,resolve};releases.push(d);return d;};
beforeEach(async()=>{
 localStorage.clear();setProjectsEnabled(true);auth.currentUser={uid:'ACCOUNT-A'};
 resetEntityScope();active.resetActivePayrollSettingsForTests();
 releases=[];flights=[];db=new IndexedDBService('review-0f080300-'+Math.random());await db.init();
});
afterEach(async()=>{
 releases.forEach(d=>d.resolve());await Promise.allSettled(flights);stopProjectCatalogLiveSync();
 db.db.close();localStorage.clear();auth.currentUser=null;resetEntityScope();active.resetActivePayrollSettingsForTests();
});
async function seed(){
 await db.update('projects',project('O'));await db.update('projectPayrollConfigs',config());
 replaceEntityScope({enabled:true,projectId:'O',defaultProjectId:'O'});active.setActivePayrollConfig(config(),{render:false});
}
const store=()=>({getConfig:id=>repository.getConfig(id,{idb:db}),putConfig:value=>repository.putConfig(value,{idb:db})});

test('0F-C1: overlapping edits to two dates of one project preserve BOTH confirmed changes',async()=>{
 await seed();const first=gate(),second=gate(),ready1=gate(),ready2=gate();let count=0;
 const delayed={...store(),putConfig:async value=>{
  const slot=++count;[ready1,ready2][slot-1].resolve();await [first,second][slot-1].promise;
  return repository.putConfig(value,{idb:db});
 }};
 const a=active.updateActiveDayHours({[DATE]:10},{store:delayed});flights.push(a);await ready1.promise;
 const b=active.updateActiveDayHours({[NEXT]:6},{store:delayed});flights.push(b);await ready2.promise;
 first.resolve();await a;second.resolve();await b;
 expect((await db.get('projectPayrollConfigs','O')).dayHours).toMatchObject({[DATE]:10,[NEXT]:6});
 expect(active.getActiveDayHours({})).toMatchObject({[DATE]:10,[NEXT]:6});
});

test('0F-C2: completion event of an old save cannot roll back a newer durable config',async()=>{
 await seed();const reached=gate(),release=gate();
 const delayed={...store(),putConfig:async value=>{
  const saved=await repository.putConfig(value,{idb:db});reached.resolve();await release.promise;return saved;
 }};
 const pending=active.updateActiveDayHours({[DATE]:9},{store:delayed});flights.push(pending);await reached.promise;
 const latest={...config(10),updatedAt:Date.now()+1000};
 await db.update('projectPayrollConfigs',latest);active.setActivePayrollConfig(latest,{render:false});
 release.resolve();await pending;
 expect((await db.get('projectPayrollConfigs','O')).dayHours[DATE]).toBe(10);
 expect(active.getActiveDayHours({})[DATE]).toBe(10);
});

test('0F-C3: a queued seed cannot create a foreign config AFTER account change and local dataset replacement',async()=>{
 const reached=gate(),release=gate(),atomic=db.atomicMutate.bind(db);let first=true;
 db.atomicMutate=async(name,id,mutator)=>{
  if(name==='projectPayrollConfigs'&&id==='NEW'&&first){first=false;reached.resolve();await release.promise;}
  return atomic(name,id,mutator);
 };
 const pending=syncProjectCatalog({uid:'ACCOUNT-A',idb:db,readDocs:async()=>snapshot([project('NEW')]),writeDoc:async()=>{}});
 flights.push(pending);await Promise.race([reached.promise,pending]);
 stopProjectCatalogLiveSync();auth.currentUser={uid:'ACCOUNT-B'};
 await db.delete('projects','NEW');await db.update('projects',project('B-OWN'));
 release.resolve();await pending;
 expect(await db.get('projects','B-OWN')).toBeTruthy();
 expect(await db.get('projectPayrollConfigs','NEW')).toBeFalsy();
});

test('0F CONTROL: sequential edits preserve changes to two dates',async()=>{
 await seed();await active.updateActiveDayHours({[DATE]:10},{store:store()});
 await active.updateActiveDayHours({[NEXT]:6},{store:store()});
 expect((await db.get('projectPayrollConfigs','O')).dayHours).toMatchObject({[DATE]:10,[NEXT]:6});
});
test('0F CONTROL: a current remote config becomes the visible active config',async()=>{
 await seed();const latest={...config(10),updatedAt:Date.now()+1000};
 await db.update('projectPayrollConfigs',latest);active.setActivePayrollConfig(latest,{render:false});
 expect(active.getActiveDayHours({})[DATE]).toBe(10);
});

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { auth } from '../../../js/modules/data/firebase.js';
import { setProjectsEnabled } from '../../../js/modules/config/FeatureFlags.js';
import { syncProjectCatalog, stopProjectCatalogLiveSync } from '../../../js/modules/features/projects/ProjectCatalogSync.js';
import { markDetachedRestore } from '../../../js/modules/services/DetachedRestoreGuard.js';
import { replaceEntityScope, resetEntityScope } from '../../../js/modules/features/projects/EntityProjectScope.js';
import { ProjectContextService, ACTIVE_PROJECT_LS_KEY } from '../../../js/modules/features/projects/ProjectContext.js';
import { createDefaultConfig } from '../../../js/modules/features/payroll/ProjectPayrollConfig.js';
import * as store from '../../../js/modules/features/payroll/ProjectPayrollConfigStore.js';
import * as active from '../../../js/modules/features/payroll/ActivePayrollSettings.js';

if (!globalThis.structuredClone) globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
const project = id => ({id,name:'Synthetic '+id,status:'active',schemaVersion:1,createdAt:1,updatedAt:1});
const cfg = (id,hours=8,updatedAt=1) => ({...createDefaultConfig(id),regularHoursPerDay:hours,updatedAt,dayHours:{'2026-10-24':hours}});
const snapshot = rows => ({forEach:fn=>rows.forEach(row=>fn({id:row.id,data:()=>row}))});
const deferred = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let db, flights, releases;
const gate=()=>{const d=deferred();releases.push(d);return d;};
const launch=options=>{const p=syncProjectCatalog({uid:'A-ACCOUNT',idb:db,writeDoc:async()=>{},...options});flights.push(p);return p;};
beforeEach(async()=>{
 localStorage.clear();setProjectsEnabled(true);auth.currentUser={uid:'A-ACCOUNT'};
 resetEntityScope();active.resetActivePayrollSettingsForTests();
 flights=[];releases=[];db=new IndexedDBService('independent-boundaries-'+Math.random());await db.init();
});
afterEach(async()=>{
 releases.forEach(d=>d.resolve());await Promise.allSettled(flights);
 stopProjectCatalogLiveSync();db.db.close();localStorage.clear();auth.currentUser=null;
 resetEntityScope();active.resetActivePayrollSettingsForTests();jest.restoreAllMocks();
});

test.each(['account-switch','detached-restore','flag-off'])('a guard changing AFTER the cloud read but BEFORE the local commit aborts: %s',async transition=>{
 const reached=gate(),release=gate(),getAll=db.getAll.bind(db);let first=true;
 db.getAll=async name=>{const rows=await getAll(name);if(name==='projects'&&first){first=false;reached.resolve();await release.promise;}return rows;};
 const writes=jest.fn(async()=>{});
 const p=launch({readDocs:async()=>snapshot([project('A-FOREIGN')]),writeDoc:writes});
 await reached.promise;
 if(transition==='account-switch'){stopProjectCatalogLiveSync();auth.currentUser={uid:'B-ACCOUNT'};await db.update('projects',project('B-OWN'));}
 if(transition==='detached-restore')markDetachedRestore({previousUid:'A-ACCOUNT'});
 if(transition==='flag-off')setProjectsEnabled(false);
 release.resolve();await p;
 expect(await db.get('projects','A-FOREIGN')).toBeFalsy();
 expect(writes).not.toHaveBeenCalled();
 if(transition==='account-switch')expect(await db.get('projects','B-OWN')).toBeTruthy();
});

test('a delayed refresh for the SAME project cannot replace a more recent committed edit in the visible cache',async()=>{
 replaceEntityScope({enabled:true,projectId:'O',defaultProjectId:'O'});
 const old=cfg('O',8,1),latest=cfg('O',10,100);
 await db.update('projectPayrollConfigs',old);active.setActivePayrollConfig(old,{render:false});
 const reached=gate(),release=gate();
 const p=active.refreshActivePayrollSettings({render:false,store:{getConfig:async id=>{const value=await db.get('projectPayrollConfigs',id);reached.resolve();await release.promise;return value;}}});flights.push(p);
 await reached.promise;await db.update('projectPayrollConfigs',latest);active.setActivePayrollConfig(latest,{render:false});
 release.resolve();await p;
 expect((await db.get('projectPayrollConfigs','O')).regularHoursPerDay).toBe(10);
 expect(active.getActivePayrollSettings({settings:{regularHoursPerDay:8}}).regularHoursPerDay).toBe(10);
 expect(active.getActiveDayHours({})).toEqual(latest.dayHours);
});

test('a failed day-hours write must not leave unsaved hours as the authoritative visible value',async()=>{
 replaceEntityScope({enabled:true,projectId:'O',defaultProjectId:'O'});
 const old=cfg('O');await db.update('projectPayrollConfigs',old);active.setActivePayrollConfig(old,{render:false});
 await expect(active.updateActiveDayHours({'2026-10-24':10},{store:{getConfig:async()=>old,putConfig:async()=>{throw Error('synthetic IDB disk failure');}}})).rejects.toThrow('synthetic IDB disk failure');
 expect((await db.get('projectPayrollConfigs','O')).dayHours['2026-10-24']).toBe(8);
 expect(active.getActiveDayHours({})['2026-10-24']).toBe(8);
});

test('disabling projects during selection validation must not activate the pending project',async()=>{
 localStorage.setItem(ACTIVE_PROJECT_LS_KEY,'OLD');
 replaceEntityScope({enabled:true,projectId:'OLD',defaultProjectId:'OLD'});
 const reached=gate(),release=gate();
 const context=new ProjectContextService({store:{get:async()=>{reached.resolve();await release.promise;return project('NEW');}}});
 const observer=jest.fn();context.subscribe(observer);const p=context.setActiveProjectId('NEW');flights.push(p);
 await reached.promise;setProjectsEnabled(false);release.resolve();await p;
 expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('OLD');
 expect(observer).not.toHaveBeenCalled();
});

test('seeding a newly received project must not overwrite an explicit edit made after the missing-config read',async()=>{
 const reached=gate(),release=gate(),get=db.get.bind(db);let first=true;
 db.get=async(name,id)=>{const value=await get(name,id);if(name==='projectPayrollConfigs'&&id==='NEW'&&first){first=false;reached.resolve();await release.promise;}return value;};
 const p=launch({readDocs:async()=>snapshot([project('NEW')])});
 await reached.promise;
 await store.putConfig({...cfg('NEW',10),dayHours:{'2026-10-24':10}},{idb:db});
 release.resolve();await p;
 expect((await get('projectPayrollConfigs','NEW')).dayHours?.['2026-10-24']).toBe(10);
 expect((await get('projectPayrollConfigs','NEW')).seeded).not.toBe(true);
});

test('an explicit uid cannot start a cloud synchronization after the user has logged out',async()=>{
 auth.currentUser=null;
 const readDocs=jest.fn(async()=>snapshot([project('LOGGED-OUT')]));
 await launch({readDocs});
 expect(readDocs).not.toHaveBeenCalled();
 expect(await db.get('projects','LOGGED-OUT')).toBeFalsy();
});

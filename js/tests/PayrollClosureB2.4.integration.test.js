/**
 * B2.4 integration — closure B2.0→B2.3
 * Matrix: native schema3 vs promoted-legacy joint, same date/period A/B,
 * getById / getByPeriod / getActiveByPeriod, pagination/cursor isolation,
 * sync-state, stale async, v19→v20 upgrade, stamper interrupt/resume,
 * deferred→resolved, idempotent rerun, Projects OFF legacy, OFF→new legacy→ON.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { PayrollClosureStamper, STAMPER_STATE_KEY } from 'actual/features/payroll/PayrollClosureStamper.js';
import { PayrollClosureStore } from 'actual/features/payroll/PayrollClosureStore.js';
import { buildPayrollClosure, promoteLegacyPayrollClosure, PAYROLL_CLOSURE_SCHEMA_VERSION } from 'actual/features/payroll/PayrollClosure.js';
import { voidPayrollClosure } from 'actual/features/payroll/PayrollClosure.js';
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { DEFAULT_PROJECT_LS_KEY, replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';

if (typeof globalThis.structuredClone !== 'function') globalThis.structuredClone = v => JSON.parse(JSON.stringify(v));

const A = 'PRJ-A-B24', B = 'PRJ-B-B24', DEF = 'PRJ-DEF-B24';
function row(id, num) { return { id: 1, _employeeId: id, _employeeName: 'Ada', _number: num, _brutoOriginal: 1000, _bonuses: 0, _deductions: 0, _loans: 0, monto: 1000 }; }
function fp(projectId, rs) { return JSON.stringify({ projectId, periodStart: '2026-08-01', periodEnd: '2026-08-15', rows: rs.map(r => ({ employeeId: r._employeeId, employeeNumber: r._number, employeeName: r._employeeName, employeePosition: '', leaderRefs: [], gross: 1000, bonuses: 0, deductions: 0, loans: 0, net: 1000, bonusDetails: [], deductionDetails: [], loanDetails: [] })).sort((x,y)=>x.employeeNumber.localeCompare(y.employeeNumber)) }); }
function nativeClosure(pid, overrides={}) { const rs = overrides.rows||[row(`emp-${pid}`, '1')]; const f = fp(pid, rs); return buildPayrollClosure({ projectId: pid, periodStart:'2026-08-01', periodEnd:'2026-08-15', rows:rs, fingerprint:f, closedAt: overrides.closedAt||100, ...overrides }); }
function legacyClosure(seed, closedAt=100){ return buildPayrollClosure({ periodStart:'2026-08-01', periodEnd:'2026-08-15', rows:[row(`emp-leg-${seed}`, String(seed))], fingerprint:`fp-b24-${seed}`, closedAt }); }

class MemDB {
  constructor(){ this.records=new Map(); this.outbox=[]; this.delay=0; }
  async get(_,id){ if(this.delay) await new Promise(r=>setTimeout(r,this.delay)); const v=this.records.get(String(id)); return v?JSON.parse(JSON.stringify(v)):undefined; }
  async query(_,idx,val){ if(this.delay) await new Promise(r=>setTimeout(r,this.delay)); return [...this.records.values()].filter(x=>x[idx]===val).map(v=>JSON.parse(JSON.stringify(v))); }
  async getPageByIndex(_, idx, opts={}){ if(this.delay) await new Promise(r=>setTimeout(r,this.delay)); let vals=[...this.records.values()]; if(idx==='projectClosedAtId'){ const pid=opts.lowerBound?.[0]; vals=vals.filter(v=>v.projectId===pid); vals.sort((l,r)=>r.closedAt-l.closedAt||r.id.localeCompare(l.id)); if(opts.upperOpen&&opts.upperBound) vals=vals.filter(v=>v.closedAt<opts.upperBound[1]||(v.closedAt===opts.upperBound[1]&&v.id<opts.upperBound[2])); } else if(idx==='projectStatusClosedAtId'){ const [pid,st]=opts.lowerBound||[]; vals=vals.filter(v=>v.projectId===pid&&v.status===st); vals.sort((l,r)=>r.closedAt-l.closedAt||r.id.localeCompare(l.id)); if(opts.upperOpen&&opts.upperBound) vals=vals.filter(v=>v.closedAt<opts.upperBound[2]||(v.closedAt===opts.upperBound[2]&&v.id<opts.upperBound[3])); } else if(idx==='closedAtId'){ vals.sort((l,r)=>r.closedAt-l.closedAt||r.id.localeCompare(l.id)); if(opts.upperOpen&&opts.upperBound) vals=vals.filter(v=>v.closedAt<opts.upperBound[0]||(v.closedAt===opts.upperBound[0]&&v.id<opts.upperBound[1])); } else if(idx==='statusClosedAtId' && opts.prefix!==undefined){ vals=vals.filter(v=>v.status===opts.prefix); vals.sort((l,r)=>r.closedAt-l.closedAt||r.id.localeCompare(l.id)); }
    return vals.slice(0,opts.limit).map(v=>JSON.parse(JSON.stringify(v)));
  }
  async getAll(n){ if(this.delay) await new Promise(r=>setTimeout(r,this.delay)); if(n==='mainSyncOutbox') return this.outbox.map(v=>JSON.parse(JSON.stringify(v))); return [...this.records.values()].map(v=>JSON.parse(JSON.stringify(v))); }
  async atomicMutate(_,id,mut){ const ex=await this.get(_,id); const r=mut(ex); if(r.write) this.records.set(String(r.value.id), JSON.parse(JSON.stringify({...r.value, periodKey:`${r.value.periodStart}:${r.value.periodEnd}`}))); return JSON.parse(JSON.stringify(r.value)); }
}

describe('B2.4 integration',()=>{
  beforeEach(()=>{ localStorage.clear(); resetEntityScope(); setProjectsEnabled(true); localStorage.setItem(DEFAULT_PROJECT_LS_KEY, DEF); });
  afterEach(()=>{ localStorage.clear(); resetEntityScope(); setProjectsEnabled(false); });

  test('joint native schema3 + promoted-legacy same period/date isolated via getById/Period',async()=>{
    const db=new MemDB(); const store=new PayrollClosureStore({db});
    replaceEntityScope({enabled:true, projectId:A, defaultProjectId:DEF});
    const nativeA=nativeClosure(A,{closedAt:100, rows:[row('emp-joint-a','7')]});
    db.records.set(nativeA.id,{...nativeA, periodKey:'2026-08-01:2026-08-15'});
    const leg=legacyClosure(900,101); const promoted=promoteLegacyPayrollClosure(leg,A);
    db.records.set(promoted.id,{...promoted, periodKey:'2026-08-01:2026-08-15'});
    replaceEntityScope({enabled:true, projectId:B, defaultProjectId:DEF});
    const nativeB=nativeClosure(B,{closedAt:102, rows:[row('emp-joint-b','7')]});
    db.records.set(nativeB.id,{...nativeB, periodKey:'2026-08-01:2026-08-15'});
    replaceEntityScope({enabled:true, projectId:A, defaultProjectId:DEF});
    const perA=await store.getByPeriod('2026-08-01','2026-08-15'); expect(perA.map(x=>x.id).sort()).toEqual([nativeA.id, promoted.id].sort());
    expect(perA.every(x=>x.projectId===A)).toBe(true);
    await expect(store.getById(nativeB.id)).resolves.toBeNull();
    replaceEntityScope({enabled:true, projectId:B, defaultProjectId:DEF});
    await expect(store.getById(nativeB.id)).resolves.toMatchObject({projectId:B});
    await expect(store.getById(nativeA.id)).resolves.toBeNull();
  });

  test('getActiveByPeriod filters voided, pagination cursor isolation',async()=>{
    const db=new MemDB(); const store=new PayrollClosureStore({db});
    replaceEntityScope({enabled:true, projectId:A, defaultProjectId:DEF});
    const c1=nativeClosure(A,{closedAt:300, rows:[row('ea1','1')]}); const c2=nativeClosure(A,{closedAt:200, rows:[row('ea2','2')]});
    const c3=nativeClosure(A,{closedAt:100, rows:[row('ea3','3')]});
    for(const c of [c1,c2,c3]) db.records.set(c.id,{...c, periodKey:'2026-08-01:2026-08-15'});
    const voided=voidPayrollClosure(c3,{voidedAt:400}); db.records.set(voided.id,{...voided, periodKey:'2026-08-01:2026-08-15'});
    const active=await store.getActiveByPeriod('2026-08-01','2026-08-15'); expect(active.map(x=>x.id).sort()).toEqual([c1.id,c2.id].sort());
    const p1=await store.listPage({limit:1,status:'closed'}); expect(p1.items[0].id).toBe(c1.id); expect(p1.nextCursor).toBeTruthy();
    const p2=await store.listPage({limit:1,status:'closed',cursor:p1.nextCursor}); expect(p2.items[0].id).toBe(c2.id); expect(p2.nextCursor).toBeNull();
    // B cursor not leaking
    replaceEntityScope({enabled:true, projectId:B, defaultProjectId:DEF});
    const cb1=nativeClosure(B,{closedAt:300, rows:[row('eb1','1')]}); db.records.set(cb1.id,{...cb1, periodKey:'2026-08-01:2026-08-15'});
    const pb=await store.listPage({limit:10,status:'closed'}); expect(pb.items.map(x=>x.id)).toEqual([cb1.id]);
  });

  test('sync-state isolation + stale async rejection',async()=>{
    const db=new MemDB(); const store=new PayrollClosureStore({db});
    replaceEntityScope({enabled:true, projectId:A, defaultProjectId:DEF});
    const ca=nativeClosure(A,{closedAt:100, rows:[row('sa','1')]});
    replaceEntityScope({enabled:true, projectId:B, defaultProjectId:DEF});
    const cb=nativeClosure(B,{closedAt:100, rows:[row('sb','1')]});
    db.records.set(ca.id,{...ca, periodKey:'2026-08-01:2026-08-15'}); db.records.set(cb.id,{...cb, periodKey:'2026-08-01:2026-08-15'});
    db.outbox=[{closureId:ca.id,kind:'payrollClosureBundle',status:'pending'},{closureId:cb.id,kind:'payrollClosureBundle',status:'pending'}];
    replaceEntityScope({enabled:true, projectId:A, defaultProjectId:DEF});
    const sA=await store.getSyncStates([ca.id,cb.id]); expect(sA[ca.id]).toBe('pending'); expect(sA[cb.id]).toBe('synced');
    db.delay=40; const pending=store.getById(ca.id); replaceEntityScope({enabled:true, projectId:B, defaultProjectId:DEF});
    await expect(pending).rejects.toMatchObject({code:'PAYROLL_CLOSURE_STALE_READ'});
  });

  test('v19→v20 upgrade preserves data and creates scoped indexes',async()=>{
    const dbName=`b24-upgrade-${Date.now()}-${Math.random()}`;
    // create v19 with only old indexes
    await new Promise((res,rej)=>{ const req=indexedDB.open(dbName,19); req.onupgradeneeded=e=>{ const db=e.target.result; if(!db.objectStoreNames.contains('payrollClosures')){ const s=db.createObjectStore('payrollClosures',{keyPath:'id'}); s.createIndex('periodKey','periodKey',{}); s.createIndex('closedAtId',['closedAt','id'],{}); s.createIndex('statusClosedAtId',['status','closedAt','id'],{}); } if(!db.objectStoreNames.contains('settings')) db.createObjectStore('settings',{keyPath:'key'}); }; req.onsuccess=()=>{ req.result.close(); res(); }; req.onerror=()=>rej(req.error); });
    const svc19=new IndexedDBService(dbName,19); await svc19.init(); const leg=legacyClosure(800,50); await svc19.update('payrollClosures',{...leg, periodKey:`${leg.periodStart}:${leg.periodEnd}`}); svc19.db.close();
    const svc20=new IndexedDBService(dbName,20); await svc20.init(); expect(svc20.db.version).toBe(20);
    const store=svc20.db.transaction('payrollClosures','readonly').objectStore('payrollClosures');
    expect(store.indexNames.contains('projectId')).toBe(true); expect(store.indexNames.contains('projectClosedAtId')).toBe(true); expect(store.indexNames.contains('projectStatusClosedAtId')).toBe(true);
    const got=await svc20.get('payrollClosures',leg.id); expect(got.id).toBe(leg.id); svc20.db.close();
  });

  test('stamper interrupt/resume + deferred→resolved + idempotent rerun + Projects OFF legacy',async()=>{
    setProjectsEnabled(true); localStorage.setItem(DEFAULT_PROJECT_LS_KEY,A);
    const dbName=`b24-stamper-${Date.now()}-${Math.random()}`; const svc=new IndexedDBService(dbName); await svc.init();
    for(let i=1;i<=4;i++){ const c=legacyClosure(700+i); await svc.update('payrollClosures',{...c, periodKey:`${c.periodStart}:${c.periodEnd}`}); }
    const stamper=new PayrollClosureStamper({db:svc});
    const first=await stamper.run({chunkSize:2, onChunk:({processed})=>{ if(processed>=2) return false; }});
    expect(first.completed).toBe(false); expect(first.processed).toBe(2); svc.db.close();
    const svc2=new IndexedDBService(dbName); await svc2.init(); const stamper2=new PayrollClosureStamper({db:svc2});
    const second=await stamper2.run({chunkSize:2}); expect(second.completed).toBe(true); expect(second.processed).toBe(4);
    // idempotent rerun
    const third=await stamper2.run({chunkSize:10}); expect(third.completed).toBe(true);
    // deferred→resolved
    const svc3=new IndexedDBService(`b24-defer-${Date.now()}-${Math.random()}`); await svc3.init();
    const legD=legacyClosure(750); await svc3.update('payrollClosures',{...legD, periodKey:`${legD.periodStart}:${legD.periodEnd}`});
    const stamperDef=new PayrollClosureStamper({db:svc3, resolveOwner:()=>null}); const d1=await stamperDef.run({chunkSize:10}); expect(d1.deferred).toBe(1); expect(d1.completed).toBe(false);
    const stamperRes=new PayrollClosureStamper({db:svc3, resolveOwner:()=>'PRJ-RESOLVE'}); const d2=await stamperRes.run({chunkSize:10}); expect(d2.completed).toBe(true); expect((await svc3.get('payrollClosures',legD.id)).projectId).toBe('PRJ-RESOLVE');
    // OFF legacy not touched
    setProjectsEnabled(false); const svcOff=new IndexedDBService(`b24-off-${Date.now()}-${Math.random()}`); await svcOff.init(); const legOff=legacyClosure(760); await svcOff.update('payrollClosures',{...legOff, periodKey:`${legOff.periodStart}:${legOff.periodEnd}`}); const stOff=new PayrollClosureStamper({db:svcOff}); const rOff=await stOff.run({chunkSize:10}); expect(rOff.aborted).toBe('off'); expect((await svcOff.get('payrollClosures',legOff.id)).schemaVersion).toBe(2);
    svc2.db.close(); svc3.db.close(); svcOff.db.close(); setProjectsEnabled(true);
  });

  test('OFF→new legacy→ON reentry after completed promotes new record without breaking cursor',async()=>{
    localStorage.setItem(DEFAULT_PROJECT_LS_KEY,A); setProjectsEnabled(true);
    const dbName=`b24-reentry-${Date.now()}-${Math.random()}`; const svc=new IndexedDBService(dbName); await svc.init();
    const c1=legacyClosure(600,10), c2=legacyClosure(601,11);
    for(const c of [c1,c2]) await svc.update('payrollClosures',{...c, periodKey:`${c.periodStart}:${c.periodEnd}`});
    const stamper=new PayrollClosureStamper({db:svc}); const r1=await stamper.run({chunkSize:10}); expect(r1.completed).toBe(true); expect(r1.promoted).toBe(2);
    // switch OFF and insert new legacy
    setProjectsEnabled(false); const legNew=legacyClosure(602,12); await svc.update('payrollClosures',{...legNew, periodKey:`${legNew.periodStart}:${legNew.periodEnd}`}); expect((await svc.get('payrollClosures',legNew.id)).schemaVersion).toBe(2);
    // switch ON and re-run
    setProjectsEnabled(true); localStorage.setItem(DEFAULT_PROJECT_LS_KEY,A);
    const stamper2=new PayrollClosureStamper({db:svc}); const r2=await stamper2.run({chunkSize:10}); expect((await svc.get('payrollClosures',legNew.id)).schemaVersion).toBe(PAYROLL_CLOSURE_SCHEMA_VERSION); expect((await svc.get('payrollClosures',legNew.id)).projectId).toBe(A);
    // already treated records remain promoted, cursor resumability intact (no duplicate promotion)
    expect((await svc.get('payrollClosures',c1.id)).projectId).toBe(A); expect((await svc.get('payrollClosures',c2.id)).projectId).toBe(A);
    const r3=await stamper2.run({chunkSize:10}); expect(r3.completed).toBe(true);
    svc.db.close();
  });
});

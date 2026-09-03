import { createAuthStartupGuard, runAuthStartupAfterDrain } from '../modules/services/AuthStartupGuard.js';
import { startPayrollLiveSyncAfterOutboxDrain } from '../modules/features/payroll/PayrollClosureLiveSyncStartup.js';
function makeSession(g,u){return g.begin(u===null?null:{uid:u});}
function effects(){return{liveSync:jest.fn(),migration:jest.fn(),listeners:jest.fn(),write:jest.fn(),warn:jest.fn()};}
function expectStopped(fx){for(const p of['liveSync','migration','listeners','write'])expect(fx[p]).not.toHaveBeenCalled();}
function expectStarted(fx){for(const p of['liveSync','migration','listeners','write'])expect(fx[p]).toHaveBeenCalledTimes(1);}
function runStartup(s,d,fx){return runAuthStartupAfterDrain({isCurrent:s.isCurrent,startAfterDrain:()=>startPayrollLiveSyncAfterOutboxDrain({drainOutbox:d,attemptLiveSync:fx.liveSync,warn:fx.warn,isCurrent:s.isCurrent}),continueStartup:({isCurrent})=>{if(!isCurrent())return;fx.migration();fx.listeners();fx.write();}});}
describe('MC-U3-E-002 auth startup generation guard',()=>{
test('does not start LiveSync while the current session drain is pending',async()=>{const g=createAuthStartupGuard({getCurrentUid:()=>'A'}),fx=effects();let r;const p=runStartup(makeSession(g,'A'),()=>new Promise(v=>{r=v}),fx);expect(fx.liveSync).not.toHaveBeenCalled();r(true);await expect(p).resolves.toBe(true);expectStarted(fx);});
test('stale A returns after drain and cannot start LiveSync, migrate, subscribe, or write',async()=>{let u='A';const g=createAuthStartupGuard({getCurrentUid:()=>u}),fx=effects();let r;const p=runStartup(makeSession(g,'A'),()=>new Promise(v=>{r=v}),fx);u='B';r(true);await expect(p).resolves.toBe(false);expectStopped(fx);});
test('the current B callback completes all startup phases normally',async()=>{const g=createAuthStartupGuard({getCurrentUid:()=>'B'}),fx=effects();await expect(runStartup(makeSession(g,'B'),()=>Promise.resolve(true),fx)).resolves.toBe(true);expectStarted(fx);});
test('A1 stays invalid through ABA while A2 can proceed',async()=>{let u='A';const g=createAuthStartupGuard({getCurrentUid:()=>u}),fxA1=effects();let r;const sA1=makeSession(g,'A'),pA1=runStartup(sA1,()=>new Promise(v=>{r=v}),fxA1);u='B';const sB=makeSession(g,'B');u='A';const sA2=makeSession(g,'A');expect(sA1.generation).toBeLessThan(sB.generation);expect(sB.generation).toBeLessThan(sA2.generation);r(true);await expect(pA1).resolves.toBe(false);expectStopped(fxA1);const fxA2=effects();await expect(runStartup(sA2,()=>Promise.resolve(true),fxA2)).resolves.toBe(true);expectStarted(fxA2);});
test('logout during drain invalidates the prior callback',async()=>{let u='A';const g=createAuthStartupGuard({getCurrentUid:()=>u}),fx=effects();let r;const p=runStartup(makeSession(g,'A'),()=>new Promise(v=>{r=v}),fx);u=null;makeSession(g,null);r(true);await expect(p).resolves.toBe(false);expectStopped(fx);});
test('a session with no auth change proceeds normally',async()=>{const g=createAuthStartupGuard({getCurrentUid:()=>'A'}),fx=effects();await expect(runStartup(makeSession(g,'A'),()=>Promise.resolve(true),fx)).resolves.toBe(true);expectStarted(fx);});
test('current partial drain warns and still attempts LiveSync',async()=>{const g=createAuthStartupGuard({getCurrentUid:()=>'A'}),fx=effects();await expect(runStartup(makeSession(g,'A'),()=>Promise.resolve(false),fx)).resolves.toBe(true);expect(fx.warn).toHaveBeenCalledWith(expect.stringContaining('drenado parcial'));expect(fx.liveSync).toHaveBeenCalledTimes(1);});
test('current drain rejection is recovered, warned, and has no unhandled rejection',async()=>{const g=createAuthStartupGuard({getCurrentUid:()=>'A'}),fx=effects(),e=new Error('recoverable drain failure');await expect(runStartup(makeSession(g,'A'),()=>Promise.reject(e),fx)).resolves.toBe(true);expect(fx.warn).toHaveBeenCalledWith(expect.stringContaining('Error drenando outbox al iniciar sesión:'),e);expect(fx.liveSync).toHaveBeenCalledTimes(1);expect(fx.migration).toHaveBeenCalledTimes(1);});
test('stale drain rejection stops before warning or any continuation',async()=>{let u='A';const g=createAuthStartupGuard({getCurrentUid:()=>u}),fx=effects(),p=runStartup(makeSession(g,'A'),()=>Promise.reject(new Error('stale failure')),fx);u='B';makeSession(g,'B');await expect(p).resolves.toBe(false);expect(fx.warn).not.toHaveBeenCalled();expectStopped(fx);});
});
describe('MC-U3-E-002 applyRemoteData ownership-safe cleanup',()=>{
function mockFlags(){globalThis._isApplyingRemoteData=false;globalThis._pendingRemoteSave=false;}
function setFlags(v){globalThis._isApplyingRemoteData=v;globalThis._pendingRemoteSave=v;}
async function simulateApply({guard,session,loadFn}){
    setFlags(true);const owner=session.generation;let t=null;
    try{await loadFn();if(!session.isCurrent()){if(owner===guard.getGeneration()){setFlags(false);if(t)clearTimeout(t);}return 'stale';}
        t=setTimeout(()=>{if(owner!==guard.getGeneration())return;setFlags(false);},500);return 'ok';
    }catch(e){if(t)clearTimeout(t);if(owner===guard.getGeneration())setFlags(false);return 'error';}
}
test('A pending and stale with no reclaim clears flags',async()=>{
    let u='A';const g=createAuthStartupGuard({getCurrentUid:()=>u});mockFlags();
    const sA=makeSession(g,'A');let res;const p=simulateApply({guard:g,session:sA,loadFn:()=>new Promise(r=>{res=r})});
    u='B';res();const r=await p;expect(r).toBe('stale');expect(globalThis._isApplyingRemoteData).toBe(false);expect(globalThis._pendingRemoteSave).toBe(false);
});
test('A pending B reclaims does not clear B flags',async()=>{
    let u='A';const g=createAuthStartupGuard({getCurrentUid:()=>u});mockFlags();
    const sA=makeSession(g,'A');let resA;const pA=simulateApply({guard:g,session:sA,loadFn:()=>new Promise(r=>{resA=r})});
    u='B';const sB=makeSession(g,'B');setFlags(true);resA();await pA;
    expect(globalThis._isApplyingRemoteData).toBe(true);expect(globalThis._pendingRemoteSave).toBe(true);
});
test('A1->B->A2 stale A1 does not clear A2 even though UID returns',async()=>{
    let u='A';const g=createAuthStartupGuard({getCurrentUid:()=>u});mockFlags();
    const sA1=makeSession(g,'A');let rA1;const pA1=simulateApply({guard:g,session:sA1,loadFn:()=>new Promise(r=>{rA1=r})});
    u='B';const sB=makeSession(g,'B');u='A';const sA2=makeSession(g,'A');setFlags(true);
    rA1();await pA1;expect(globalThis._isApplyingRemoteData).toBe(true);expect(sA1.generation).toBeLessThan(sA2.generation);
});
test('happy path no auth change timer retains semantics',async()=>{
    jest.useFakeTimers();let u='A';const g=createAuthStartupGuard({getCurrentUid:()=>u});mockFlags();
    const sA=makeSession(g,'A');const p=simulateApply({guard:g,session:sA,loadFn:()=>Promise.resolve()});
    await p;expect(globalThis._isApplyingRemoteData).toBe(true);
    jest.advanceTimersByTime(600);expect(globalThis._isApplyingRemoteData).toBe(false);jest.useRealTimers();
});
test('error path load rejects cleans without double cleanup',async()=>{
    let u='A';const g=createAuthStartupGuard({getCurrentUid:()=>u});mockFlags();
    const sA=makeSession(g,'A');const r=await simulateApply({guard:g,session:sA,loadFn:()=>Promise.reject(new Error('x'))});
    expect(r).toBe('error');expect(globalThis._isApplyingRemoteData).toBe(false);
    let u2='A';const g2=createAuthStartupGuard({getCurrentUid:()=>u2});mockFlags();
    const sA2=makeSession(g2,'A');let rej;const pA2=simulateApply({guard:g2,session:sA2,loadFn:()=>new Promise((_,rj)=>{rej=rj})});
    const sB2=makeSession(g2,'B');setFlags(true);u2='B';rej(new Error('x'));await pA2;expect(globalThis._isApplyingRemoteData).toBe(true);
});
});

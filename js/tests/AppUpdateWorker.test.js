import { createAppUpdateWorker } from '../modules/services/AppUpdateWorker.js';
class Port {
    postMessage(data) { queueMicrotask(() => { if (!this.peer.closed) this.peer.onmessage?.({ data }); }); }
    close() { this.closed = true; }
}
class Channel {
    constructor() { this.port1 = new Port(); this.port2 = new Port(); this.port1.peer = this.port2; this.port2.peer = this.port1; }
}
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function fixture({ blocked = null } = {}) {
    const waiting = new EventTarget(); waiting.state = 'installed'; waiting.messages = [];
    waiting.postMessage = jest.fn((data, ports) => {
        waiting.messages.push(data);
        if (blocked === 'message') return;
        if (data.type === 'PREPARE_APP_UPDATE') ports[0].postMessage({ ok: true, version: data.version, cacheName: 'asistencia-vNEW-prepared' });
        if (data.type === 'ACTIVATE_APP_UPDATE') { waiting.state = 'activated'; waiting.dispatchEvent(new Event('statechange')); ports[0].postMessage({ ok: true }); }
    });
    const active = new EventTarget(); active.state = 'activated';
    active.postMessage = jest.fn((data, ports) => ports[0].postMessage({ version: 'OLD', cacheName: 'asistencia-vOLD' }));
    const pending = deferred();
    const registration = { active, waiting, update: jest.fn(() => blocked === 'update' ? pending.promise : Promise.resolve()) };
    const serviceWorker = { getRegistration: jest.fn(() => blocked === 'registration' ? pending.promise : Promise.resolve(registration)) };
    const coordinator = createAppUpdateWorker({ serviceWorker, Channel, timeoutMs: 1000, activationTimeoutMs: 500, makeToken: () => 'test-token' });
    return { coordinator, registration, serviceWorker, waiting, active, pending };
}
afterEach(() => jest.useRealTimers());
test.each(['registration', 'update', 'message'])('a pending %s has one bounded deadline and can retry', async blocked => {
    jest.useFakeTimers(); const f = fixture({ blocked });
    const result = f.coordinator.prepare('2.0.0').catch(error => error);
    await jest.advanceTimersByTimeAsync(1001);
    expect((await result).code).toBe('timeout');
    expect(f.waiting.messages.some(data => data?.type === 'ACTIVATE_APP_UPDATE')).toBe(false);
    // A late registration/update result does not activate anything.
    f.pending.resolve(f.registration); await Promise.resolve(); await Promise.resolve();
    expect(f.waiting.messages.some(data => data?.type === 'ACTIVATE_APP_UPDATE')).toBe(false);
});
test('preparation is shared and never activates; explicit activation uses the prepared snapshot', async () => {
    const f = fixture();
    const [a,b] = await Promise.all([f.coordinator.prepare('2.0.0'), f.coordinator.prepare('2.0.0')]);
    expect(a).toBe(b); expect(f.registration.update).toHaveBeenCalledTimes(1);
    expect(f.waiting.messages.map(x=>x.type)).toEqual(['PREPARE_APP_UPDATE']);
    expect(a.previousCacheName).toBe('asistencia-vOLD');
    await f.coordinator.activate(a);
    expect(f.waiting.messages.at(-1)).toMatchObject({ type:'ACTIVATE_APP_UPDATE', cacheName:a.cacheName, version:'2.0.0' });
});
test('forced repair prepares another snapshot even when a version is already ready', async () => {
    const f=fixture();await f.coordinator.prepare('2.0.0');await f.coordinator.prepare('2.0.0',{force:true});
    expect(f.waiting.messages.filter(x=>x.type==='PREPARE_APP_UPDATE')).toHaveLength(2);
    expect(f.waiting.messages.at(-1).force).toBe(true);
});
test('cancelling a preparation closes its request and does not activate a late reply', async () => {
    const f=fixture({blocked:'message'}),controller=new AbortController();
    const result=f.coordinator.prepare('2.0.0',{signal:controller.signal}).catch(e=>e);
    for(let i=0;i<12;i++)await Promise.resolve();
    controller.abort();expect((await result).code).toBe('cancelled');
    expect(f.waiting.messages.some(x=>x.type==='ACTIVATE_APP_UPDATE')).toBe(false);
});
test('a worker response for a different version is rejected', async () => {
    const f=fixture();
    f.waiting.postMessage=(_data,ports)=>ports[0].postMessage({ok:true,version:'1.0.0',cacheName:'wrong'});
    await expect(f.coordinator.prepare('2.0.0')).rejects.toThrow('versión esperada');
});

test.each(['reply', 'state'])('activation has a bounded deadline when the %s never arrives', async blocked => {
    const f=fixture();
    const handle=await f.coordinator.prepare('2.0.0');
    jest.useFakeTimers();
    const original=f.waiting.postMessage;
    f.waiting.postMessage=(data,ports)=>{
        if(data.type!=='ACTIVATE_APP_UPDATE') return original(data,ports);
        if(blocked==='state') ports[0].postMessage({ok:true});
    };
    const result=f.coordinator.activate(handle).catch(error=>error);
    await jest.advanceTimersByTimeAsync(501);
    expect((await result).code).toBe('timeout');
    jest.useRealTimers();
    await f.coordinator.prepare('2.0.0');
    expect(f.registration.update).toHaveBeenCalledTimes(2);
});

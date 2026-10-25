
/**
 * Acceptance audit against real Firestore SDK + repository rules + IDB.
 * Synthetic demo project, loopback emulator only. Normal failing tests:
 * remove neither assertions nor concurrency barriers when fixing the service.
 */
const fs = require('fs');
const path = require('path');
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const suite = HOST ? describe : describe.skip;
const PROJECT = 'demo-sa-multiobra-audit';
const UID = 'audit-owner';
let sdk, apps;
if (HOST) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(HOST)) throw new Error('Audit requires a loopback Firestore emulator');
    sdk = require('firebase/firestore');
    apps = require('firebase/app');
    globalThis.__SA_FIRESTORE_SDK__ = sdk;
    sdk.setLogLevel('silent');
}
if (!globalThis.localStorage) {
    const values = new Map();
    globalThis.localStorage = {
        getItem: k => values.get(k) ?? null,
        setItem: (k, v) => values.set(k, String(v)),
        removeItem: k => values.delete(k),
        clear: () => values.clear()
    };
}
// Notifications are a browser presentation dependency; storage stays real.
jest.mock('../../../../js/modules/components/Notification.js', () => ({ Notification: { show: jest.fn() } }));
jest.mock('../../../../js/modules/ui/IconSystem.js', () => ({ __esModule: true, default: { get: () => '' } }));
jest.mock('../../../../js/modules/core/AppState.js', () => ({ state: { employees: [], positions: [], leaders: [], attendance: {} } }));
require('fake-indexeddb/auto');
const { IndexedDBService } = require('../../../../js/modules/services/IndexedDBService.js');
const { createDefaultConfig } = require('../../../../js/modules/features/payroll/ProjectPayrollConfig.js');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const obra = (name = 'Initial', updatedAt = 1) => ({ id: 'O', name, status: 'active', schemaVersion: 1, createdAt: 1, updatedAt });
const cfg = (hours, updatedAt) => ({ ...createDefaultConfig('O'), regularHoursPerDay: hours, updatedAt, seeded: false });
const docPath = ['users', UID, 'projectsV1', 'O'];
let serial = 0;

suite('Independent multiobra transaction boundary review', () => {
    let devices;
    async function request(method, route, body) {
        const response = await fetch('http://' + HOST + route, {
            method, headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!response.ok) throw new Error('Emulator request failed: ' + response.status + ' ' + await response.text());
    }
    async function device(uid = UID) {
        const app = apps.initializeApp({ projectId: PROJECT, apiKey: 'synthetic-key' }, 'multiobra-audit-' + ++serial);
        const firestore = sdk.getFirestore(app);
        const [host, port] = HOST.split(':');
        sdk.connectFirestoreEmulator(firestore, host, Number(port), { mockUserToken: { sub: uid, user_id: uid } });
        let modules;
        jest.isolateModules(() => {
            modules = {
                fb: require('../../../../js/modules/data/firebase.js'),
                flags: require('../../../../js/modules/config/FeatureFlags.js'),
                catalog: require('../../../../js/modules/features/projects/ProjectCatalogSync.js')
            };
        });
        modules.fb.__useDevice({ firestore, uid });
        modules.flags.setProjectsEnabled(true);
        const idb = new IndexedDBService('audit-emulator-idb-' + serial);
        await idb.init();
        const created = { app, firestore, idb, uid, ...modules };
        devices.push(created);
        return created;
    }
    beforeAll(async () => {
        await request('PUT', '/emulator/v1/projects/' + PROJECT + ':securityRules', {
            rules: { files: [{ name: 'firestore.rules', content: fs.readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8') }] }
        });
    });
    beforeEach(async () => {
        devices = [];
        localStorage.clear();
        await request('DELETE', '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents');
    });
    afterEach(async () => {
        for (const d of devices) {
            d.catalog.stopProjectCatalogLiveSync();
            d.idb.db.close();
            await sdk.terminate(d.firestore);
            await apps.deleteApp(d.app);
        }
        localStorage.clear();
    });


    test.each(['config','name'])('real transaction must retry against a concurrent %s commit',async kind=>{
        const a=await device(),b=await device();
        const refA=sdk.doc(a.firestore,...docPath),refB=sdk.doc(b.firestore,...docPath);
        await sdk.setDoc(refA,{...obra(),payrollConfig:cfg(8,5)});
        await a.idb.update('projects',obra(kind==='name'?'Device A old':'Initial',kind==='name'?10:1));
        await a.idb.update('projectPayrollConfigs',cfg(kind==='config'?9:8,kind==='config'?10:5));
        const reached=deferred(),release=deferred();let attempts=0,first=true;
        a.fb.__hooks.afterTransactionGet=async()=>{
            attempts++;
            if(first){first=false;reached.resolve();await release.promise;}
        };
        const pending=a.catalog.syncProjectCatalog({uid:UID,idb:a.idb});
        try{
            await reached.promise;
            await sdk.setDoc(refB,kind==='config'?{payrollConfig:cfg(10,20)}:obra('Device B newest',20),{merge:true});
        }finally{release.resolve();}
        await pending;
        expect(attempts).toBeGreaterThanOrEqual(2);
        const final=(await sdk.getDoc(refB)).data();
        if(kind==='config')expect(final.payrollConfig).toMatchObject({regularHoursPerDay:10,updatedAt:20});
        else expect(final).toMatchObject({name:'Device B newest',updatedAt:20});
    });

    test('confirmed deletion must keep the existing deletion-wins contract even against a larger active timestamp',async()=>{
        const a=await device();
        await sdk.setDoc(sdk.doc(a.firestore,...docPath),{...obra('Still active on old device',100),payrollConfig:cfg(8,5)});
        await a.idb.update('projects',{...obra('Deleted locally',10),deletedAt:10});
        await a.catalog.syncProjectCatalog({uid:UID,idb:a.idb});
        expect(await a.idb.get('projects','O')).toMatchObject({deletedAt:10});
        expect((await sdk.getDoc(sdk.doc(a.firestore,...docPath))).data()).toMatchObject({deletedAt:10});
    });
});

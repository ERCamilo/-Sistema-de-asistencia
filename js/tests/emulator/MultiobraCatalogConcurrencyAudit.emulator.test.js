
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
jest.mock('../../modules/components/Notification.js', () => ({ Notification: { show: jest.fn() } }));
require('fake-indexeddb/auto');
const { IndexedDBService } = require('../../modules/services/IndexedDBService.js');
const { createDefaultConfig } = require('../../modules/features/payroll/ProjectPayrollConfig.js');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const obra = (name = 'Initial', updatedAt = 1) => ({ id: 'O', name, status: 'active', schemaVersion: 1, createdAt: 1, updatedAt });
const cfg = (hours, updatedAt) => ({ ...createDefaultConfig('O'), regularHoursPerDay: hours, updatedAt, seeded: false });
const docPath = ['users', UID, 'projectsV1', 'O'];
let serial = 0;

suite('Multiobra audit: two SDK clients and actual Firestore rules', () => {
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
                fb: require('../../modules/data/firebase.js'),
                flags: require('../../modules/config/FeatureFlags.js'),
                catalog: require('../../modules/features/projects/ProjectCatalogSync.js')
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
            rules: { files: [{ name: 'firestore.rules', content: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8') }] }
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

    test('CONTROL: a newer local payroll config is published with the real SDK', async () => {
        const a = await device();
        await sdk.setDoc(sdk.doc(a.firestore, ...docPath), { ...obra(), payrollConfig: cfg(8, 5) });
        await a.idb.update('projects', obra());
        await a.idb.update('projectPayrollConfigs', cfg(9, 10));
        const result = await a.catalog.syncProjectCatalog({ uid: UID, idb: a.idb });
        expect(result.configsPublished).toBe(1);
        expect((await sdk.getDoc(sdk.doc(a.firestore, ...docPath))).data().payrollConfig).toMatchObject({ regularHoursPerDay: 9, updatedAt: 10 });
    });

    test('CONTROL: another account cannot update the owner catalog', async () => {
        const other = await device('other-account');
        await expect(sdk.setDoc(sdk.doc(other.firestore, ...docPath), obra())).rejects.toMatchObject({ code: 'permission-denied' });
    });

    test('R7: a delayed payroll publication must not replace a newer write from another device', async () => {
        const a = await device(), b = await device();
        const refA = sdk.doc(a.firestore, ...docPath), refB = sdk.doc(b.firestore, ...docPath);
        await sdk.setDoc(refA, { ...obra(), payrollConfig: cfg(8, 5) });
        await a.idb.update('projects', obra());
        await a.idb.update('projectPayrollConfigs', cfg(9, 10));
        const reached = deferred(), release = deferred();
        const pending = a.catalog.syncProjectCatalog({
            uid: UID, idb: a.idb,
            writeDoc: async (ref, data, opts) => {
                if (data.payrollConfig) { reached.resolve(); await release.promise; }
                return sdk.setDoc(ref, data, opts);
            }
        });
        try {
            await Promise.race([reached.promise, pending]);
            await sdk.setDoc(refB, { payrollConfig: cfg(10, 20) }, { merge: true });
            expect((await sdk.getDoc(refB)).data().payrollConfig.updatedAt).toBe(20);
        } finally { release.resolve(); }
        await pending;
        expect((await sdk.getDoc(refB)).data().payrollConfig).toMatchObject({ regularHoursPerDay: 10, updatedAt: 20 });
    });

    test('R7: a delayed project rename must not replace a newer name from another device', async () => {
        const a = await device(), b = await device();
        const refA = sdk.doc(a.firestore, ...docPath), refB = sdk.doc(b.firestore, ...docPath);
        await sdk.setDoc(refA, { ...obra(), payrollConfig: cfg(8, 5) });
        await a.idb.update('projects', obra('Device A old', 10));
        await a.idb.update('projectPayrollConfigs', cfg(8, 5));
        const reached = deferred(), release = deferred();
        const pending = a.catalog.syncProjectCatalog({
            uid: UID, idb: a.idb,
            writeDoc: async (ref, data, opts) => {
                if (data.name) { reached.resolve(); await release.promise; }
                return sdk.setDoc(ref, data, opts);
            }
        });
        try {
            await Promise.race([reached.promise, pending]);
            await sdk.setDoc(refB, obra('Device B newest', 20), { merge: true });
            expect((await sdk.getDoc(refB)).data().updatedAt).toBe(20);
        } finally { release.resolve(); }
        await pending;
        expect((await sdk.getDoc(refB)).data()).toMatchObject({ name: 'Device B newest', updatedAt: 20 });
    });
});

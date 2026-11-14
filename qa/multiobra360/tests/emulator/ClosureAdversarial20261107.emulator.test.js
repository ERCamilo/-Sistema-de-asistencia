/**
 * Independent SDK/Firestore challenge for #302, using real transactions,
 * actual repository rules, separate clients and forced read/write interleaving.
 * Nothing connects to production. Requires loopback FIRESTORE_EMULATOR_HOST.
 */
const fs = require('fs');
const path = require('path');
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
if (HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST)) {
    throw Error('Independent closure tests require a loopback Firestore emulator');
}
const suite = HOST ? describe : describe.skip;
let sdk, apps;
if (HOST) {
    sdk = require('firebase/firestore');
    apps = require('firebase/app');
    sdk.setLogLevel('silent');
    globalThis.__SA_FIRESTORE_SDK__ = sdk;
}
if (!globalThis.localStorage) {
    const values = new Map();
    globalThis.localStorage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
        clear: () => values.clear()
    };
}
jest.mock('../../../../js/modules/components/Notification.js', () => ({ Notification: { show: jest.fn() } }));
jest.mock('../../../../js/modules/ui/IconSystem.js', () => ({ __esModule: true, default: { get: () => '' } }));
jest.mock('../../../../js/modules/core/AppState.js', () => ({
    state: { employees: [], positions: [], leaders: [], attendance: {} }
}));
require('fake-indexeddb/auto');
const { IndexedDBService } = require('../../../../js/modules/services/IndexedDBService.js');
const { createDefaultConfig } = require('../../../../js/modules/features/payroll/ProjectPayrollConfig.js');
const PROJECT = 'demo-sa-multiobra-closure-20261107';
const UID = 'closure-owner';
const pathToDoc = ['users', UID, 'projectsV1', 'O'];
let serial = 0;
const project = (name, updatedAt, extra = {}) =>
    ({ id: 'O', name, status: 'active', schemaVersion: 1, createdAt: 1, updatedAt, ...extra });
const config = (hours, updatedAt, extra = {}) =>
    ({ ...createDefaultConfig('O'), regularHoursPerDay: hours, updatedAt, seeded: false, ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
async function http(method, route, body) {
    const response = await fetch('http://' + HOST + route, {
        method, headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw Error('Emulator HTTP ' + response.status + ': ' + await response.text());
}

suite('Independent closure challenge: R7 real Firestore transaction races', () => {
    let devices;
    async function device(uid = UID) {
        const app = apps.initializeApp({ projectId: PROJECT, apiKey: 'synthetic' },
            'closure-sdk-' + (++serial));
        const firestore = sdk.getFirestore(app);
        const [host, port] = HOST.split(':');
        sdk.connectFirestoreEmulator(firestore, host, Number(port),
            { mockUserToken: { sub: uid, user_id: uid } });
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
        const idb = new IndexedDBService('closure-idb-' + serial);
        await idb.init();
        const result = { app, firestore, idb, uid, ...modules };
        devices.push(result);
        return result;
    }
    const ref = d => sdk.doc(d.firestore, ...pathToDoc);

    beforeAll(async () => {
        await http('PUT', '/emulator/v1/projects/' + PROJECT + ':securityRules', {
            rules: { files: [{
                name: 'firestore.rules',
                content: fs.readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8')
            }] }
        });
    });
    beforeEach(async () => {
        devices = [];
        localStorage.clear();
        await http('DELETE', '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents');
    });
    afterEach(async () => {
        for (const d of devices) {
            d.fb.__hooks.afterTransactionGet = null;
            d.catalog.stopProjectCatalogLiveSync();
            d.idb.db?.close();
            await sdk.terminate(d.firestore);
            await apps.deleteApp(d.app);
        }
        localStorage.clear();
    });

    test('R7: transaction reading old payroll must retry/skip after device B commits a newer config', async () => {
        const a = await device(), b = await device(), c = await device();
        await sdk.setDoc(ref(a), { ...project('Original', 5), payrollConfig: config(8, 5) });
        await a.idb.update('projects', project('Original', 5));
        await a.idb.update('projectPayrollConfigs', config(9, 10));
        const reached = deferred(), release = deferred();
        let intercepted = 0;
        a.fb.__hooks.afterTransactionGet = async ({ path: docPath, attempt }) => {
            if (docPath.endsWith('/O') && attempt === 1) {
                intercepted++;
                reached.resolve();
                await release.promise;
            }
        };
        const pending = a.catalog.syncProjectCatalog({ uid: UID, idb: a.idb });
        try {
            await reached.promise;
            // This runs while A's REAL Firestore transaction is suspended AFTER its read.
            await sdk.setDoc(ref(b), { payrollConfig: config(10, 20,
                { holidays: ['2026-11-07'] }) }, { merge: true });
        } finally {
            release.resolve();
        }
        await pending;
        const remotelySaved = (await sdk.getDoc(ref(b))).data();
        expect(intercepted).toBe(1);
        expect(remotelySaved.payrollConfig).toMatchObject({
            regularHoursPerDay: 10, updatedAt: 20, holidays: ['2026-11-07']
        });
        await c.catalog.syncProjectCatalog({ uid: UID, idb: c.idb });
        expect(await c.idb.get('projectPayrollConfigs', 'O')).toMatchObject({
            regularHoursPerDay: 10, updatedAt: 20
        });
    });

    test('R7: transaction reading old name must not replace a later rename committed by device B', async () => {
        const a = await device(), b = await device(), c = await device();
        await sdk.setDoc(ref(a), { ...project('Original', 5), payrollConfig: config(8, 5) });
        await a.idb.update('projects', project('A older', 10));
        await a.idb.update('projectPayrollConfigs', config(8, 5));
        const reached = deferred(), release = deferred();
        let intercepted = 0;
        a.fb.__hooks.afterTransactionGet = async ({ path: docPath, attempt }) => {
            if (docPath.endsWith('/O') && attempt === 1) {
                intercepted++;
                reached.resolve();
                await release.promise;
            }
        };
        const pending = a.catalog.syncProjectCatalog({ uid: UID, idb: a.idb });
        try {
            await reached.promise;
            await sdk.setDoc(ref(b), project('B latest', 20), { merge: true });
        } finally {
            release.resolve();
        }
        await pending;
        expect(intercepted).toBe(1);
        expect((await sdk.getDoc(ref(b))).data()).toMatchObject({
            name: 'B latest', updatedAt: 20
        });
        await c.catalog.syncProjectCatalog({ uid: UID, idb: c.idb });
        expect(await c.idb.get('projects', 'O')).toMatchObject({
            name: 'B latest', updatedAt: 20
        });
    });

    test('R7: a remote tombstone cannot be resurrected by a stale active copy with a future clock', async () => {
        const a = await device(), b = await device();
        const tombstone = project('Deleted', 30, { deletedAt: 25 });
        await sdk.setDoc(ref(b), { ...tombstone, payrollConfig: config(8, 10) });
        await a.idb.update('projects', project('Outdated active copy', 999999));
        await a.idb.update('projectPayrollConfigs', config(9, 999999));
        await a.catalog.syncProjectCatalog({ uid: UID, idb: a.idb });
        const remote = (await sdk.getDoc(ref(b))).data();
        expect(remote.deletedAt).toBe(25);
        const local = await a.idb.get('projects', 'O');
        expect(local.deletedAt).not.toBeNull();
        expect(local.deletedAt).not.toBeUndefined();
    });
});

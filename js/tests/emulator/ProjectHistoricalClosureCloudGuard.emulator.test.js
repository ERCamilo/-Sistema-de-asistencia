/**
 * SDK real, Firestore rules reales, proyectos ficticios: valida que un cliente
 * sin la obra local no copie el cierre cuando la obra existe en la nube.
 */
const fs = require('fs'), path = require('path');
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const suite = HOST ? describe : describe.skip;
const PROJECT = 'demo-sa-historical-cloud-guard';
const UID = 'historical-owner';
let sdk, apps;
if (HOST) {
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(HOST)) throw new Error('Solo emulador local');
    sdk = require('firebase/firestore');
    apps = require('firebase/app');
    globalThis.__SA_FIRESTORE_SDK__ = sdk;
    sdk.setLogLevel('silent');
}
if (!globalThis.localStorage) {
    const map = new Map();
    globalThis.localStorage = {
        getItem: key => map.get(key) ?? null,
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: key => map.delete(key),
        clear: () => map.clear()
    };
}
jest.mock('../../modules/components/Notification.js', () => ({ Notification: { show: jest.fn() } }));
jest.mock('../../modules/ui/IconSystem.js', () => ({ __esModule: true, default: { get: () => '' } }));
jest.mock('../../modules/core/AppState.js', () => ({ state: { employees: [], positions: [], leaders: [], attendance: {} } }));
jest.mock('../../modules/services/PersistenceService.js', () => ({
    isFullImportIsolationInProgress: () => false,
    isProjectRepairIsolationInProgress: () => false
}));
jest.mock('../../modules/services/DetachedRestoreGuard.js', () => ({
    isDetachedRestoreSyncBlocked: () => false
}));
require('fake-indexeddb/auto');
const { IndexedDBService } = require('../../modules/services/IndexedDBService.js');
const { buildPayrollClosure, buildPayrollClosureSnapshot } = require('../../modules/features/payroll/PayrollClosure.js');
let sequence = 0;

suite('Historical closure recovery verifies server identity using Firestore rules', () => {
    let app, firestore, dbLocal, recovery, sourceId;
    const ref = (collection, id) => sdk.doc(firestore, 'users', UID, collection, id);
    async function request(method, route, body) {
        const response = await fetch('http://' + HOST + route, {
            method, headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!response.ok) throw new Error('Emulador: ' + response.status + ' ' + await response.text());
    }
    beforeAll(async () => {
        await request('PUT', '/emulator/v1/projects/' + PROJECT + ':securityRules', {
            rules: { files: [{
                name: 'firestore.rules',
                content: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8')
            }] }
        });
    });
    beforeEach(async () => {
        await request('DELETE', '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents');
        app = apps.initializeApp({ projectId: PROJECT, apiKey: 'demo-synthetic-key' }, 'historical-' + ++sequence);
        firestore = sdk.getFirestore(app);
        const [host, port] = HOST.split(':');
        sdk.connectFirestoreEmulator(firestore, host, Number(port), {
            mockUserToken: { sub: UID, user_id: UID }
        });
        let fb;
        jest.isolateModules(() => {
            fb = require('../../modules/data/firebase.js');
            recovery = require('../../modules/features/projects/ProjectHistoricalClosureRecovery.js');
        });
        fb.__useDevice({ firestore, uid: UID });
        dbLocal = new IndexedDBService('historical-cloud-guard-' + sequence);
        await dbLocal.init();
        await dbLocal.update('projects', { id: 'target', name: 'Nueva obra', status: 'active', createdAt: 1, updatedAt: 1 });
        const payload = {
            projectId: 'original', periodStart: '2026-10-01', periodEnd: '2026-10-15',
            closedAt: 400,
            rows: [{ _employeeId: 'deleted-employee', _number: '34',
                _employeeName: 'Empleado de prueba', _employeePosition: 'Albañil',
                _brutoOriginal: 1000, _loans: 100, _deductions: 50, monto: 850 }]
        };
        const source = buildPayrollClosure({
            ...payload, fingerprint: JSON.stringify(buildPayrollClosureSnapshot(payload))
        });
        await dbLocal.update('payrollClosures', source);
        sourceId = source.id;
    });
    afterEach(async () => {
        dbLocal?.db?.close();
        if (firestore) await sdk.terminate(firestore);
        if (app) await apps.deleteApp(app);
    });
    const options = () => ({
        sourceId, targetProjectId: 'target', idb: dbLocal,
        getUid: () => UID
    });
    async function unchanged() {
        expect(await dbLocal.getAll('payrollClosures')).toHaveLength(1);
        expect(await dbLocal.getAll('mainSyncOutbox')).toHaveLength(0);
    }

    test('cloud project exists while local catalog lacks it: cannot recover or enqueue', async () => {
        await sdk.setDoc(ref('projectsV1', 'original'), {
            id: 'original', name: 'Histórica', status: 'active', createdAt: 1, updatedAt: 1
        });
        await expect(recovery.saveHistoricalClosureRecovery(options()))
            .rejects.toThrow(/existe en Firebase/);
        await unchanged();
    });
    test('cloud alias exists and project document is missing: cannot recover', async () => {
        await sdk.setDoc(ref('projectAliasesV1', 'original'), {
            legacyId: 'original', canonicalId: 'another-project'
        });
        await expect(recovery.saveHistoricalClosureRecovery(options()))
            .rejects.toThrow(/vinculación registrada/);
        await unchanged();
    });
    test('canonical project registry still owns source ID: cannot recover', async () => {
        await sdk.setDoc(ref('projectRegistryV1', 'default'), { canonicalProjectId: 'original' });
        await expect(recovery.saveHistoricalClosureRecovery(options()))
            .rejects.toThrow(/vinculación registrada/);
        await unchanged();
    });
    test('Firestore rules deny a read of another account: never treat denial as absence', async () => {
        await expect(recovery.verifyHistoricalClosureSourceInCloud({
            uid: 'another-user', sourceProjectId: 'original'
        })).rejects.toThrow(/No se pudo verificar la obra original con Firebase/);
        await unchanged();
    });
    test('server confirms no matching project, alias or canonical registration: saves exactly one copy', async () => {
        await sdk.setDoc(ref('projectsV1', 'unrelated'), {
            id: 'unrelated', name: 'Otra', status: 'active'
        });
        const one = await recovery.saveHistoricalClosureRecovery(options());
        expect(one.created).toBe(true);
        const retry = await recovery.saveHistoricalClosureRecovery(options());
        expect(retry.created).toBe(false);
        expect(await dbLocal.getAll('payrollClosures')).toHaveLength(2);
        expect(await dbLocal.getAll('mainSyncOutbox')).toHaveLength(1);
    });
    test('disabled Firestore network does not use SDK cache to authorize recovery', async () => {
        // Populate cache with an unrelated document; getDocFromServer must not
        // downgrade to it when network is unavailable.
        await sdk.setDoc(ref('projectsV1', 'unrelated'), {
            id: 'unrelated', name: 'Otra', status: 'active'
        });
        await sdk.getDoc(ref('projectsV1', 'unrelated'));
        await sdk.disableNetwork(firestore);
        await expect(recovery.saveHistoricalClosureRecovery(options()))
            .rejects.toThrow(/No se pudo verificar la obra original con Firebase/);
        await unchanged();
    });
});

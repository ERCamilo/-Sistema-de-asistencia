/**
 * Server-only project configuration provenance against real Firestore rules.
 * Synthetic owner and project, no production account or financial data.
 */
const fs = require('fs'), path = require('path');
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const suite = HOST ? describe : describe.skip;
const PROJECT = 'demo-sa-payroll-config-origin';
const UID = 'origin-owner';
let sdk, apps;
if (HOST) {
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(HOST)) throw new Error('Solo emulador local');
    sdk = require('firebase/firestore');
    apps = require('firebase/app');
    globalThis.__SA_FIRESTORE_SDK__ = sdk;
    sdk.setLogLevel('silent');
}
if (!globalThis.localStorage) {
    const memory = new Map();
    globalThis.localStorage = {
        getItem: key => memory.get(key) ?? null,
        setItem: (key, value) => memory.set(key, String(value)),
        removeItem: key => memory.delete(key),
        clear: () => memory.clear()
    };
}
let index = 0;

suite('config orphan source lookups are server-only and obey account rules', () => {
    let app, firestore, module;
    async function request(method, route, body) {
        const response = await fetch('http://' + HOST + route, {
            method, headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!response.ok) throw new Error('Firestore emulator: ' + response.status + ' ' + await response.text());
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
        app = apps.initializeApp({ projectId: PROJECT, apiKey: 'demo-origin-key' }, 'origin-' + ++index);
        firestore = sdk.getFirestore(app);
        const [host, port] = HOST.split(':');
        sdk.connectFirestoreEmulator(firestore, host, Number(port), {
            mockUserToken: { sub: UID, user_id: UID }
        });
        let firebase;
        jest.isolateModules(() => {
            firebase = require('../../modules/data/firebase.js');
            module = require('../../modules/features/projects/ProjectPayrollConfigOrigin.js');
        });
        firebase.__useDevice({ firestore, uid: UID });
    });
    afterEach(async () => {
        if (firestore) await sdk.terminate(firestore);
        if (app) await apps.deleteApp(app);
    });
    const ref = (collection, id) => sdk.doc(firestore, 'users', UID, collection, id);
    const inspect = projectId => module.inspectPayrollConfigOrigin({ projectId, localProjects: [] });
    const code = key => module.PAYROLL_CONFIG_ORIGIN_STATUS[key];

    test('obra ausente del catálogo local pero existente en Firestore = remote-project', async () => {
        await sdk.setDoc(ref('projectsV1', 'old'), {
            id: 'old', name: 'Obra de prueba', status: 'closed',
            payrollConfig: { regularHoursPerDay: 10 }
        });
        expect(await inspect('old')).toMatchObject({
            status: code('REMOTE_PROJECT'), remotePayrollConfig: true, readOnly: true
        });
    });

    test('alias remoto entre identidades de obra = remote-alias', async () => {
        await sdk.setDoc(ref('projectAliasesV1', 'old'), { legacyId: 'old', canonicalId: 'new' });
        await sdk.setDoc(ref('projectsV1', 'new'), { id: 'new', status: 'active' });
        expect(await inspect('old')).toMatchObject({
            status: code('REMOTE_ALIAS'), canonicalProjectId: 'new'
        });
    });

    test('no hay proyecto, alias ni referencia canónica = not-found-remotely', async () => {
        expect((await inspect('old')).status).toBe(code('NOT_FOUND'));
    });

    test('lápida remota no se confunde con referencia ausente', async () => {
        await sdk.setDoc(ref('projectsV1', 'old'), {
            id: 'old', status: 'archived', deletedAt: 123
        });
        expect((await inspect('old')).status).toBe(code('REMOTE_TOMBSTONE'));
    });

    test('registro canónico debe conservarse como referencia propia', async () => {
        await sdk.setDoc(ref('projectRegistryV1', 'default'), { canonicalProjectId: 'old' });
        expect((await inspect('old')).status).toBe(code('CANONICAL_REFERENCE'));
    });

    test('permiso de otra cuenta denegado = unverified, jamás not-found', async () => {
        const value = await module.inspectPayrollConfigOrigin({
            projectId: 'old', getUid: () => 'another-user'
        });
        expect(value.status).toBe(code('UNVERIFIED'));
    });

    test('sin red no usa caché para aprobar referencia ausente', async () => {
        await sdk.setDoc(ref('projectsV1', 'other'), { id: 'other', status: 'active' });
        await sdk.getDoc(ref('projectsV1', 'other'));
        await sdk.disableNetwork(firestore);
        expect((await inspect('old')).status).toBe(code('UNVERIFIED'));
    });
});

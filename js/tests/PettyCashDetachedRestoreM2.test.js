/**
 * M2 — «Desconectar y restaurar» (o restaurar sin sesión) → iniciar sesión en la
 * misma cuenta. Antes, el primer snapshot de Caja Chica borraba de este
 * dispositivo lo restaurado que la nube no tenía. Ahora nada sube ni se
 * descarga hasta que el usuario elige (DetachedRestoreGuard).
 *
 * Arnés copiado de PettyCashRestoreCloudCycle.test.js:
 *
 * Cada dispositivo carga su propia copia de PettyCashStore + PettyCashRepository
 * reales, con su IndexedDB real (fake-indexeddb). La nube es un Firestore en
 * memoria compartido que implementa lo que usa el repositorio real: transacción
 * get/set(merge), deleteDoc, getDocs, onSnapshot con eco inmediato y `where`.
 * El espejo de Supabase se sustituye por un fetch que registra las peticiones.
 */
import 'fake-indexeddb/auto';
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

jest.mock('../modules/data/firebase.js', () => {
    const cloud = globalThis.__pcFakeCloud || (globalThis.__pcFakeCloud = {
        docs: new Map(), listeners: new Set(), auth: { currentUser: null }
    });
    const clone = value => JSON.parse(JSON.stringify(value));
    const inCollection = (ref, path) => path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes('/');
    const matches = (ref, data) => (ref.constraints || []).every(({ field, op, value }) =>
        op === 'in' ? value.includes(data?.[field]) : data?.[field] === value);
    const list = ref => [...cloud.docs.entries()]
        .filter(([path, data]) => inCollection(ref, path) && matches(ref, data))
        .map(([, data]) => clone(data));
    const snapshotOf = ref => {
        const items = list(ref);
        return { docs: items.map(data => ({ data: () => data })), forEach: cb => items.forEach(data => cb({ data: () => data })) };
    };
    const notify = () => cloud.listeners.forEach(({ ref, cb }) => cb(snapshotOf(ref)));
    const write = (ref, data, opts) => {
        const base = opts?.merge ? cloud.docs.get(ref.path) || {} : {};
        cloud.docs.set(ref.path, { ...base, ...clone(data) });
    };
    return {
        auth: cloud.auth,
        db: {},
        collection: (_db, ...segments) => ({ path: segments.join('/') }),
        doc: (_db, ...segments) => ({ path: segments.join('/') }),
        query: (ref, ...constraints) => ({ ...ref, constraints }),
        where: (field, op, value) => ({ field, op, value }),
        getDocs: async ref => snapshotOf(ref),
        onSnapshot: (ref, cb) => {
            const listener = { ref, cb };
            cloud.listeners.add(listener);
            cb(snapshotOf(ref));
            return () => cloud.listeners.delete(listener);
        },
        setDoc: async (ref, data, opts) => { write(ref, data, opts); notify(); },
        deleteDoc: async ref => { cloud.docs.delete(ref.path); notify(); },
        runTransaction: async (_db, operation) => {
            const writes = [];
            const result = await operation({
                get: async ref => {
                    const data = cloud.docs.get(ref.path);
                    return { exists: () => data !== undefined, data: () => (data ? clone(data) : null) };
                },
                set: (ref, data, opts) => writes.push([ref, data, opts])
            });
            writes.forEach(([ref, data, opts]) => write(ref, data, opts));
            if (writes.length) notify();
            return result;
        }
    };
});

const UID = 'user-1';
globalThis.__pcFakeCloud = globalThis.__pcFakeCloud || { docs: new Map(), listeners: new Set(), auth: { currentUser: null } };
const cloud = () => globalThis.__pcFakeCloud;
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const cloudItems = collection => [...cloud().docs.entries()]
    .filter(([path]) => path.startsWith(`users/${UID}/${collection}/`))
    .map(([, data]) => data);

const PROJECT = { id: 'pc-proj', name: 'Obra caja', updatedAt: 1000 };
const PERIOD = { id: 'pc-per', projectId: 'pc-proj', status: 'abierta', updatedAt: 1000 };
const movement = (id, updatedAt, amount) => ({
    id, projectId: 'pc-proj', periodId: 'pc-per', type: 'gasto', amount,
    recordNumber: Number(id.replace(/\D/g, '')) || 1, createdAt: 900, updatedAt
});

let mirrorCalls;

function loadDevice(name) {
    let device;
    jest.isolateModules(() => {
        const { IndexedDBService } = require('actual/services/IndexedDBService.js');
        const mock = require('../modules/services/IndexedDBService.js').default;
        const db = new IndexedDBService(`pc-detached-${name}-${Math.random()}`);
        for (const method of ['getAll', 'get', 'update', 'delete', 'clear', 'batchUpdate',
            'reconcilePettyCashSnapshot', 'acquireLease', 'renewLease', 'releaseLease']) {
            mock[method] = (...args) => db[method](...args);
        }
        const { APP_CONFIG } = require('../modules/config/Config.js');
        APP_CONFIG.PETTY_CASH_MIRROR_URL = 'https://mirror.invalid/petty-cash-movement';
        const { PettyCashStore } = require('../modules/features/pettycash/PettyCashStore.js');
        const { PettyCashRepository } = require('../modules/services/PettyCashRepository.js');
        device = { name, db, store: PettyCashStore, repo: PettyCashRepository, unsubscribe: [] };
    });
    return device;
}

// Igual que PettyCashUI: cada snapshot pasa por applyRemote (movimientos con alcance de período).
function listen(device) {
    device.unsubscribe.push(
        device.repo.projects.subscribe(list => device.store.applyRemote('projects', list)),
        device.repo.periods.subscribe(list => device.store.applyRemote('periods', list)),
        device.repo.movements.subscribeForPeriods(['pc-per'], list =>
            device.store.applyRemote('movements', list, { periodIds: ['pc-per'] }))
    );
}

async function local(device, collection) {
    const store = { projects: 'pettyCashProjects', periods: 'pettyCashPeriods', movements: 'pettyCashMovements' }[collection];
    return (await device.db.getAll(store)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// Ruta FILE (app.js applyBackupData): aplicar en local y encolar según la opción.
async function restoreFile(device, backup, mode) {
    await device.store.applyRemote('projects', backup.projects);
    await device.store.applyRemote('periods', backup.periods);
    await device.store.applyRemote('movements', backup.movements);
    if (mode !== 'none') await device.store.enqueueRestored(backup, { mode });
}

// Ruta FULL (ExportController): reemplazo atómico de stores y luego cola en fusión.
async function restoreFull(device, backup) {
    await device.db.saveState({ employees: [], positions: [], leaders: [], attendance: {}, settings: null },
        { clearFirst: true, pettyCash: backup, entityScope: { enabled: false } });
    await device.store.enqueueRestored(backup, { mode: 'merge' });
}


const {
    DETACHED_RESTORE_CHOICE: CHOICE,
    getDetachedRestore,
    markDetachedRestore,
    clearDetachedRestore,
    isDetachedRestoreSyncBlocked,
    runDetachedRestoreLoginGate
} = require('../modules/services/DetachedRestoreGuard.js');

const USER = { uid: UID, email: 'dueno@example.invalid', getIdToken: async () => 'token' };
const pick = list => list.map(item => [item.id, item.amount]).sort();

describe('M2: restauración desconectada y nuevo inicio de sesión (Caja Chica, 2 dispositivos)', () => {
    let deviceA, deviceB;

    beforeEach(() => {
        cloud().docs.clear();
        cloud().listeners.clear();
        cloud().auth.currentUser = USER;
        localStorage.clear();
        mirrorCalls = [];
        global.fetch = jest.fn(async (_url, init) => {
            mirrorCalls.push(JSON.parse(init.body));
            return { ok: true, status: 200, json: async () => ({ ok: true }) };
        });
        deviceA = loadDevice('A');
        deviceB = loadDevice('B');
    });

    afterEach(async () => {
        await settle();
        [deviceA, deviceB].forEach(device => {
            device.unsubscribe.forEach(fn => fn());
            device.db.db?.close();
        });
        localStorage.clear();
        delete global.fetch;
    });

    async function seedCloud(movements) {
        await deviceB.repo.projects.saveOne(PROJECT);
        await deviceB.repo.periods.saveOne(PERIOD);
        for (const item of movements) await deviceB.repo.movements.saveOne(item);
    }

    // app.js onDisconnectRestore: cerrar sesión, restaurar sin cola y marcar.
    async function disconnectAndRestore(device, backup) {
        cloud().auth.currentUser = null;
        await restoreFile(device, backup, 'none');
        expect(markDetachedRestore({ previousUid: UID, hasPettyCash: true })).toBe(true);
    }

    // app.js onAuthStateChanged: la puerta corre antes de startPettyCashSync.
    async function login(device, choice, overrides = {}) {
        cloud().auth.currentUser = USER;
        // El evento 'online' puede disparar flush() mientras el diálogo está abierto.
        await device.store.flush();
        await device.store.flushMirror();
        await settle();
        const calls = { logout: 0, useCloud: 0 };
        const gate = await runDetachedRestoreLoginGate({
            user: USER,
            ask: async ({ marker }) => {
                expect(marker).toMatchObject({ previousUid: UID, hasPettyCash: true });
                return choice;
            },
            upload: overrides.upload || (async () => {
                // uploadDetachedRestoreToAccount: Caja Chica en modo 'replace'.
                await device.store.enqueueRestored(await device.store.loadLocal(), { mode: 'replace', now: 7000, awaitFlush: true });
                return { ok: true };
            }),
            useCloud: async () => { calls.useCloud++; return { ok: true }; },
            logout: async () => { calls.logout++; cloud().auth.currentUser = null; }
        });
        if (gate.proceed) listen(device);      // startPettyCashSync
        await settle();
        return { gate, calls };
    }

    const backup = () => ({
        projects: [PROJECT], periods: [PERIOD],
        // m1 no está en la nube; m2 del respaldo es más viejo que la nube.
        movements: [movement('m1', 2000, 100), movement('m2', 3000, 999)]
    });

    test('control: sin la puerta, el primer snapshot borra lo restaurado (defecto M2)', async () => {
        await seedCloud([movement('m2', 5000, 250)]);
        cloud().auth.currentUser = null;
        await restoreFile(deviceA, backup(), 'none');
        cloud().auth.currentUser = USER;
        listen(deviceA);
        await settle();
        expect((await local(deviceA, 'movements')).map(item => item.id)).toEqual(['m2']);
    });

    test('mientras no hay decisión nada sube, ni siquiera con sesión y evento online', async () => {
        await seedCloud([movement('m2', 5000, 250)]);
        await disconnectAndRestore(deviceA, backup());
        // Una entrada pendiente anterior (misma cuenta) tampoco sale.
        await deviceA.db.update('pettyCashOutbox', { op: 'save', col: 'movements', id: 'm9', data: movement('m9', 6000, 9), ts: 1, status: 'pending' });
        cloud().auth.currentUser = USER;
        await deviceA.store.flush();
        await deviceA.store.flushMirror();
        await settle();
        expect(pick(cloudItems('pettyCash'))).toEqual([['m2', 250]]);
        expect(mirrorCalls).toEqual([]);
        expect(getDetachedRestore()).toMatchObject({ previousUid: UID });
    });

    test('«Subir lo restaurado»: lo restaurado gana en la nube, lo de la nube se conserva y el otro dispositivo lo recibe', async () => {
        await seedCloud([movement('m2', 5000, 250), movement('m3', 4000, 30)]);
        listen(deviceB);
        await disconnectAndRestore(deviceA, backup());

        const { gate, calls } = await login(deviceA, CHOICE.UPLOAD);

        expect(gate).toMatchObject({ proceed: true, choice: CHOICE.UPLOAD, ok: true });
        expect(calls.logout).toBe(0);
        expect(getDetachedRestore()).toBeNull();
        const expected = [['m1', 100], ['m2', 999], ['m3', 30]];
        expect(pick(cloudItems('pettyCash'))).toEqual(expected);
        expect(pick(await local(deviceA, 'movements'))).toEqual(expected);
        expect(pick(await local(deviceB, 'movements'))).toEqual(expected);
        expect(await deviceA.db.getAll('pettyCashOutbox')).toEqual([]);
        // Ids e importes conservados; solo cambia la marca de tiempo del modo 'replace'.
        const m1 = cloudItems('pettyCash').find(item => item.id === 'm1');
        expect(m1).toMatchObject({ ...movement('m1', 7000, 100) });
        // Reinicio de A: la marca ya no existe y el arranque es el normal.
        const again = await login(deviceA, null);
        expect(again.gate).toEqual({ proceed: true, choice: null });
        expect(pick(await local(deviceA, 'movements'))).toEqual(expected);
    });

    test('«Usar los datos de la nube»: no sube nada del respaldo y el descarte es explícito', async () => {
        await seedCloud([movement('m2', 5000, 250)]);
        await disconnectAndRestore(deviceA, backup());

        const { gate, calls } = await login(deviceA, CHOICE.CLOUD);

        expect(gate).toMatchObject({ proceed: false, choice: CHOICE.CLOUD, ok: true });
        expect(calls.useCloud).toBe(1);   // app.js: replaceLocalWithCloud() + recarga
        expect(getDetachedRestore()).toBeNull();
        expect(pick(cloudItems('pettyCash'))).toEqual([['m2', 250]]);
        // Tras la recarga, el arranque normal adopta la nube.
        listen(deviceA);
        await settle();
        expect(pick(await local(deviceA, 'movements'))).toEqual([['m2', 250]]);
    });

    test.each([CHOICE.LOGOUT, null])('«Cerrar sesión» o cerrar el diálogo (%s): todo sigue solo en este dispositivo', async choice => {
        await seedCloud([movement('m2', 5000, 250)]);
        await disconnectAndRestore(deviceA, backup());

        const { gate, calls } = await login(deviceA, choice);

        expect(gate).toMatchObject({ proceed: false, choice: CHOICE.LOGOUT });
        expect(calls.logout).toBe(1);
        expect(getDetachedRestore()).toMatchObject({ previousUid: UID });
        expect(pick(await local(deviceA, 'movements'))).toEqual([['m1', 100], ['m2', 999]]);
        expect(pick(cloudItems('pettyCash'))).toEqual([['m2', 250]]);
        // Siguiente inicio de sesión: vuelve a preguntar y ahora sube.
        const next = await login(deviceA, CHOICE.UPLOAD);
        expect(next.gate.proceed).toBe(true);
        expect(pick(cloudItems('pettyCash'))).toEqual([['m1', 100], ['m2', 999]]);
    });

    test('si la pestaña se interrumpe durante la subida, la marca durable aún exige elección', async () => {
        await disconnectAndRestore(deviceA, backup());
        let releaseUpload;
        let started;
        const entered = new Promise(resolve => { started = resolve; });
        const paused = new Promise(resolve => { releaseUpload = resolve; });
        const pending = runDetachedRestoreLoginGate({
            user: USER,
            ask: async () => CHOICE.UPLOAD,
            upload: async () => {
                expect(getDetachedRestore()).not.toBeNull();
                expect(isDetachedRestoreSyncBlocked()).toBe(false);
                started();
                await paused;
                return { ok: true };
            },
            useCloud: async () => ({ ok: true }),
            logout: async () => {}
        });
        await entered;
        // Otra pestaña podría leer la marca: no desaparece a mitad de la operación.
        expect(getDetachedRestore()).toMatchObject({ previousUid: UID });
        releaseUpload();
        await expect(pending).resolves.toMatchObject({ proceed: true, ok: true });
        expect(getDetachedRestore()).toBeNull();
    });

    test('si la subida falla, la marca se repone, se cierra sesión y nada se descarga', async () => {
        await seedCloud([movement('m2', 5000, 250)]);
        await disconnectAndRestore(deviceA, backup());
        const before = getDetachedRestore();

        const { gate, calls } = await login(deviceA, CHOICE.UPLOAD, {
            upload: async () => { throw new Error('IndexedDB lleno'); }
        });

        expect(gate).toMatchObject({ proceed: false, ok: false });
        expect(calls.logout).toBe(1);
        expect(getDetachedRestore()).toEqual(before);
        expect(pick(await local(deviceA, 'movements'))).toEqual([['m1', 100], ['m2', 999]]);
        expect(pick(cloudItems('pettyCash'))).toEqual([['m2', 250]]);
    });

    test('si la sesión cambia mientras el diálogo está abierto, no se ejecuta nada', async () => {
        await disconnectAndRestore(deviceA, backup());
        const upload = jest.fn(async () => ({ ok: true }));
        const logout = jest.fn(async () => {});
        const gate = await runDetachedRestoreLoginGate({
            user: USER, ask: async () => CHOICE.UPLOAD, upload, useCloud: jest.fn(), logout, isCurrent: () => false
        });
        expect(gate.proceed).toBe(false);
        expect(upload).not.toHaveBeenCalled();
        expect(logout).not.toHaveBeenCalled();
        expect(getDetachedRestore()).not.toBeNull();
    });

    test('una marca ilegible cuenta como marca (se pregunta de más, nunca de menos)', () => {
        localStorage.setItem('asistencia_detached_restore_v1', '{roto');
        expect(getDetachedRestore()).toMatchObject({ unreadable: true, hasPettyCash: true });
        clearDetachedRestore();
        expect(getDetachedRestore()).toBeNull();
    });
});

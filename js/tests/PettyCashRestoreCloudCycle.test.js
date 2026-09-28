/**
 * Caja Chica: restauración FILE/FULL → cola → subida → snapshot → otro dispositivo.
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
        const db = new IndexedDBService(`pc-restore-${name}-${Math.random()}`);
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

describe('Caja Chica: restauración y sincronización multi-dispositivo', () => {
    let deviceA, deviceB;

    beforeEach(() => {
        cloud().docs.clear();
        cloud().listeners.clear();
        cloud().auth.currentUser = { uid: UID, getIdToken: async () => 'token' };
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
        delete global.fetch;
    });

    async function seedCloud(movements) {
        await deviceB.repo.projects.saveOne(PROJECT);
        await deviceB.repo.periods.saveOne(PERIOD);
        for (const item of movements) await deviceB.repo.movements.saveOne(item);
    }

    test('FILE fusión: lo que falta sube, la nube conserva lo más reciente y el otro dispositivo lo recibe', async () => {
        await seedCloud([movement('m2', 5000, 250), movement('m3', 1000, 30)]);
        listen(deviceA);
        listen(deviceB);
        await settle();
        const backup = {
            projects: [PROJECT], periods: [PERIOD],
            // m1 no está en la nube; m2 del respaldo es más viejo; m3 del respaldo es más nuevo.
            movements: [movement('m1', 2000, 100), movement('m2', 3000, 999), movement('m3', 4000, 35)]
        };

        await restoreFile(deviceA, backup, 'merge');
        await settle();

        const expected = [['m1', 100], ['m2', 250], ['m3', 35]];
        const pick = list => list.map(item => [item.id, item.amount]).sort();
        expect(pick(cloudItems('pettyCash'))).toEqual(expected);
        expect(pick(await local(deviceA, 'movements'))).toEqual(expected);
        expect(pick(await local(deviceB, 'movements'))).toEqual(expected);
        expect(await deviceA.db.getAll('pettyCashOutbox')).toEqual([]);
        // El espejo solo recibe lo que Firestore aceptó (m2 del respaldo nunca se refleja).
        expect(mirrorCalls.map(call => [call.transactionId, call.movement.amount]).sort())
            .toEqual([['m1', 100], ['m3', 35]]);

        // Reinicio: un dispositivo nuevo que arranca desde la nube ve lo mismo.
        const deviceC = loadDevice('C');
        listen(deviceC);
        await settle();
        expect(pick(await local(deviceC, 'movements'))).toEqual(expected);
        deviceC.unsubscribe.forEach(fn => fn());
        deviceC.db.db.close();
    });

    test('sin la cola, el primer snapshot borraba lo restaurado (comportamiento anterior)', async () => {
        await seedCloud([movement('m2', 5000, 250)]);
        const backup = { projects: [PROJECT], periods: [PERIOD], movements: [movement('m1', 2000, 100)] };
        await restoreFile(deviceA, backup, 'none');
        listen(deviceA);
        await settle();
        expect((await local(deviceA, 'movements')).map(item => item.id)).toEqual(['m2']);
        expect(cloudItems('pettyCash').map(item => item.id)).toEqual(['m2']);
    });

    test('restauración sin conexión: queda en cola, el eco no la borra y sube al iniciar sesión', async () => {
        await seedCloud([movement('m2', 5000, 250)]);
        cloud().auth.currentUser = null;
        const backup = { projects: [PROJECT], periods: [PERIOD], movements: [movement('m1', 2000, 100)] };
        await restoreFile(deviceA, backup, 'merge');
        await settle();
        expect(cloudItems('pettyCash').map(item => item.id)).toEqual(['m2']);

        cloud().auth.currentUser = { uid: UID, getIdToken: async () => 'token' };
        listen(deviceA); // el snapshot llega antes del flush: la entrada en cola protege m1
        await settle();
        expect((await local(deviceA, 'movements')).map(item => item.id)).toEqual(['m1', 'm2']);
        await deviceA.store.flush();
        await settle();
        expect(cloudItems('pettyCash').map(item => item.id).sort()).toEqual(['m1', 'm2']);
        expect(await deviceA.db.getAll('pettyCashOutbox')).toEqual([]);
    });

    test('FULL: reemplazo local + cola en fusión; reintentar la importación es idempotente', async () => {
        await seedCloud([movement('m2', 5000, 250)]);
        listen(deviceB);
        const backup = { projects: [PROJECT], periods: [PERIOD], movements: [movement('m1', 2000, 100), movement('m2', 1000, 1)] };
        await restoreFull(deviceA, backup);
        listen(deviceA);
        await settle();
        await restoreFull(deviceA, backup);
        await settle();

        expect(cloudItems('pettyCash').map(item => [item.id, item.amount]).sort()).toEqual([['m1', 100], ['m2', 250]]);
        expect(cloudItems('projects')).toHaveLength(1);
        expect(cloudItems('cashPeriods')).toHaveLength(1);
        expect((await local(deviceB, 'movements')).map(item => item.id)).toEqual(['m1', 'm2']);
        expect((await local(deviceA, 'movements')).map(item => [item.id, item.amount])).toEqual([['m1', 100], ['m2', 250]]);
        expect((await deviceA.db.getAll('pettyCashOutbox')).filter(entry => entry.status === 'dead')).toEqual([]);
    });

    test('Reemplazar nube: gana el respaldo en todos los dispositivos y no se borra nada de la nube', async () => {
        await seedCloud([movement('m2', 5000, 250), movement('m9', 5000, 90)]);
        listen(deviceA);
        listen(deviceB);
        await settle();
        const backup = { projects: [PROJECT], periods: [PERIOD], movements: [movement('m2', 3000, 111)] };
        await restoreFile(deviceA, backup, 'replace');
        await settle();

        const byId = Object.fromEntries(cloudItems('pettyCash').map(item => [item.id, item.amount]));
        expect(byId).toEqual({ m2: 111, m9: 90 });
        expect(Object.fromEntries((await local(deviceB, 'movements')).map(item => [item.id, item.amount])))
            .toEqual({ m2: 111, m9: 90 });
        expect(cloudItems('projects')).toHaveLength(1);
    });

    test('un cambio local pendiente no se pisa con la restauración', async () => {
        await seedCloud([]);
        cloud().auth.currentUser = null;
        await deviceA.store.save('movements', movement('m1', 7000, 700));
        const backup = { projects: [PROJECT], periods: [PERIOD], movements: [movement('m1', 2000, 100)] };
        await restoreFile(deviceA, backup, 'merge');
        cloud().auth.currentUser = { uid: UID, getIdToken: async () => 'token' };
        await deviceA.store.flush();
        await settle();
        expect(cloudItems('pettyCash').map(item => [item.id, item.amount])).toEqual([['m1', 700]]);
        expect((await local(deviceA, 'movements')).map(item => [item.id, item.amount])).toEqual([['m1', 700]]);
    });

    test('un borrado posterior en otro dispositivo no resucita lo restaurado', async () => {
        await seedCloud([]);
        listen(deviceA);
        listen(deviceB);
        await settle();
        await restoreFile(deviceA, { projects: [PROJECT], periods: [PERIOD], movements: [movement('m1', 2000, 100)] }, 'merge');
        await settle();
        expect((await local(deviceB, 'movements')).map(item => item.id)).toEqual(['m1']);

        await deviceB.store.remove('movements', 'm1');
        await settle();
        expect(cloudItems('pettyCash')).toEqual([]);
        expect(await local(deviceA, 'movements')).toEqual([]);
        expect(await local(deviceB, 'movements')).toEqual([]);
    });
});

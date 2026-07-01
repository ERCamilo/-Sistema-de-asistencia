/**
 * 🧪 MainSyncStoreTests
 *
 * Bandeja de pendientes para la nube (asistencia/empleados/puestos/líderes/
 * settings). Copia el patrón ya probado de PettyCashStore.js (outbox durable
 * en IndexedDB, coalescing, dead-lettering) para que asistencia/empleados/
 * préstamos tengan la misma garantía que caja chica: cerrar la pestaña antes
 * de terminar de subir a la nube ya no pierde esa subida — se reintenta sola
 * al reconectar o volver a entrar (ver MainSyncStore.flush, U4-U6).
 *
 * Esta suite cubre SOLO enqueue* + coalescing (U3). flush()/dead-lettering
 * llegan en suites separadas (U4/U5) sobre el mismo archivo.
 *
 * Behavioral: MainSyncStore es real; indexedDBService es el mock global de
 * Jest (configurable por test), igual que PettyCashOutboxResilienceTests.
 */

import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import indexedDBService from '../modules/services/IndexedDBService.js'; // → mock global

function outboxEntry(key, overrides = {}) {
    return { key, status: 'pending', ts: 1000 + key, ...overrides };
}

function resetMocks() {
    indexedDBService.getAll.mockReset().mockResolvedValue([]);
    indexedDBService.update.mockReset().mockResolvedValue(1);
    indexedDBService.delete.mockReset().mockResolvedValue(undefined);
}

function updatesToOutbox() {
    return indexedDBService.update.mock.calls.filter(c => c[0] === 'mainSyncOutbox');
}

/** Guards "todo permitido" por defecto — cada test override sólo lo que necesita. */
function makeGuards(overrides = {}) {
    return {
        hasSession: () => true,
        isApplyingRemote: () => false,
        isPaused: () => false,
        cloudWatermark: () => 0,
        saveMirror: jest.fn().mockResolvedValue(undefined),
        saveDaily: jest.fn().mockResolvedValue(undefined),
        deleteEntity: jest.fn().mockResolvedValue(undefined),
        onCloudResult: jest.fn(),
        ...overrides
    };
}

testRunner.addSuite("MainSyncStore — enqueue y coalescing", {

    async "enqueueMirror con cola vacía crea una entrada mirror pending"() {
        resetMocks();
        const snapshot = { employees: [], settings: { schemaVersion: 3 } };
        await MainSyncStore.enqueueMirror(snapshot);

        const updates = updatesToOutbox();
        testRunner.assertEquals(updates.length, 1, 'debe crear exactamente una entrada');
        testRunner.assertEquals(updates[0][1].kind, 'mirror');
        testRunner.assertEquals(updates[0][1].status, 'pending');
        testRunner.assertEquals(updates[0][1].snapshot, snapshot, 'debe guardar el snapshot recibido tal cual (inmutable, capturado por el caller)');
    },

    async "enqueueMirror coalesce: borra el mirror pending anterior y deja uno solo"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(3, { kind: 'mirror', snapshot: { old: true } })
        ]);
        await MainSyncStore.enqueueMirror({ employees: [], settings: {} });

        testRunner.assert(
            indexedDBService.delete.mock.calls.some(c => c[0] === 'mainSyncOutbox' && c[1] === 3),
            'debe borrar la entrada mirror pending anterior (key 3)'
        );
        const updates = updatesToOutbox();
        const mirrorUpdates = updates.filter(c => c[1].kind === 'mirror');
        testRunner.assertEquals(mirrorUpdates.length, 1, 'solo debe quedar UNA entrada mirror pendiente (última gana)');
    },

    async "enqueueMirror NO borra entradas daily/delete (coalesce sólo entre mirrors)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(7, { kind: 'daily', dateKey: '2026-07-01' })
        ]);
        await MainSyncStore.enqueueMirror({ employees: [], settings: {} });
        testRunner.assert(
            !indexedDBService.delete.mock.calls.some(c => c[1] === 7),
            'una entrada daily pendiente no debe tocarse al encolar un mirror'
        );
    },

    async "enqueueDaily crea entrada por dateKey"() {
        resetMocks();
        const records = { 'e1-2026-07-01': { employeeId: 'e1', date: '2026-07-01' } };
        await MainSyncStore.enqueueDaily('2026-07-01', records);

        const updates = updatesToOutbox();
        testRunner.assertEquals(updates.length, 1);
        testRunner.assertEquals(updates[0][1].kind, 'daily');
        testRunner.assertEquals(updates[0][1].dateKey, '2026-07-01');
        testRunner.assertEquals(updates[0][1].records, records);
    },

    async "enqueueDaily coalesce por dateKey (mismo día reemplaza, otro día no se toca)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(5, { kind: 'daily', dateKey: '2026-07-01' }),
            outboxEntry(6, { kind: 'daily', dateKey: '2026-06-30' })
        ]);
        await MainSyncStore.enqueueDaily('2026-07-01', { 'e1-2026-07-01': {} });

        testRunner.assert(
            indexedDBService.delete.mock.calls.some(c => c[1] === 5),
            'la entrada daily del MISMO día (key 5) debe borrarse'
        );
        testRunner.assert(
            !indexedDBService.delete.mock.calls.some(c => c[1] === 6),
            'la entrada daily de OTRO día (key 6) NO debe tocarse'
        );
    },

    async "enqueueDelete crea una entrada de borrado"() {
        resetMocks();
        await MainSyncStore.enqueueDelete('employee', 'e1', 2);

        const updates = updatesToOutbox();
        testRunner.assertEquals(updates.length, 1);
        testRunner.assertEquals(updates[0][1].kind, 'delete');
        testRunner.assertEquals(updates[0][1].entity, 'employee');
        testRunner.assertEquals(updates[0][1].id, 'e1');
        testRunner.assertEquals(updates[0][1].schemaVersion, 2);
    },

    async "enqueueDelete dedup: mismo entity+id pendiente no duplica"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(9, { kind: 'delete', entity: 'employee', id: 'e1' })
        ]);
        await MainSyncStore.enqueueDelete('employee', 'e1', 2);

        testRunner.assertEquals(updatesToOutbox().length, 0,
            'un delete pendiente para el mismo empleado no debe generar una segunda entrada');
    },

    async "enqueueDelete NO dedupea entre entidades distintas con el mismo id"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(9, { kind: 'delete', entity: 'position', id: 'x1' })
        ]);
        await MainSyncStore.enqueueDelete('employee', 'x1', 2);

        testRunner.assertEquals(updatesToOutbox().length, 1,
            'un id igual mismo en OTRA entidad (position vs employee) no debe considerarse duplicado');
    }

});

testRunner.addSuite("MainSyncStore — flush: guards re-evaluados al vaciar (landmine #2)", {

    async "sin sesión no toca la nube y deja la entrada pending"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([outboxEntry(1, { kind: 'mirror', snapshot: {} })]);
        const guards = makeGuards({ hasSession: () => false });

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 0, 'sin sesión no debe intentar subir nada');
        testRunner.assertEquals(indexedDBService.delete.mock.calls.length, 0, 'la entrada no debe drenarse');
    },

    async "_isApplyingRemoteData=true difiere el flush completo"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([outboxEntry(1, { kind: 'mirror', snapshot: {} })]);
        const guards = makeGuards({ isApplyingRemote: () => true });

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 0,
            'mientras se están aplicando datos remotos, no debe subir nada (evita loop de sync)');
    },

    async "sincronización pausada difiere el flush completo"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([outboxEntry(1, { kind: 'mirror', snapshot: {} })]);
        const guards = makeGuards({ isPaused: () => true });

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 0, 'pausado no debe subir nada');
    },

    async "watermark saliente: nube más nueva que el snapshot difiere el mirror SIN incrementar attempts"() {
        resetMocks();
        const snapshot = { settings: { localUpdatedAt: 1000 } };
        indexedDBService.getAll.mockResolvedValue([outboxEntry(1, { kind: 'mirror', snapshot })]);
        // Nube 11s más nueva que el snapshot (> OUTGOING_CONFLICT_GRACE_MS=10s) → diferir.
        const guards = makeGuards({ cloudWatermark: () => 1000 + 11000 });

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 0,
            'un snapshot más viejo que la nube (fuera de la gracia) no debe subirse — pisaría algo más nuevo');
        testRunner.assertEquals(indexedDBService.delete.mock.calls.length, 0, 'la entrada sigue pendiente');
        const updates = updatesToOutbox();
        testRunner.assertEquals(updates.length, 0,
            'diferir por watermark NO es un fallo — no debe incrementar attempts ni tocar la entrada');
    },

    async "watermark dentro de la gracia SÍ sube el mirror"() {
        resetMocks();
        const snapshot = { settings: { localUpdatedAt: 1000 } };
        indexedDBService.getAll.mockResolvedValue([outboxEntry(1, { kind: 'mirror', snapshot })]);
        // Nube sólo 5s más "nueva" (< gracia de 10s) → se considera al día, sube igual.
        const guards = makeGuards({ cloudWatermark: () => 1000 + 5000 });

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 1, 'debe subir el mirror');
        testRunner.assert(
            indexedDBService.delete.mock.calls.some(c => c[0] === 'mainSyncOutbox' && c[1] === 1),
            'debe drenar la entrada tras subirla con éxito'
        );
    },

    async "la asistencia diaria NO se gatea por el watermark (merge granular, no wholesale)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([outboxEntry(1, { kind: 'daily', dateKey: '2026-07-01', records: {} })]);
        const guards = makeGuards({ cloudWatermark: () => 999999999 }); // nube "mucho más nueva"

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveDaily.mock.calls.length, 1,
            'la asistencia diaria se sube siempre (merge por día, no hay wholesale overwrite que proteger)');
    }

});

testRunner.addSuite("MainSyncStore — flush: dispatch por kind", {

    async "mirror drena vía saveMirror y borra la entrada, reporta éxito"() {
        resetMocks();
        const snapshot = { settings: { localUpdatedAt: 1000 } };
        indexedDBService.getAll.mockResolvedValue([outboxEntry(1, { kind: 'mirror', snapshot })]);
        const guards = makeGuards();

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveMirror.mock.calls[0][0], snapshot, 'debe pasar el snapshot capturado');
        testRunner.assertEquals(guards.onCloudResult.mock.calls[0][0], true, 'debe reportar éxito');
    },

    async "daily drena vía saveDaily(dateKey, records)"() {
        resetMocks();
        const records = { 'e1-2026-07-01': {} };
        indexedDBService.getAll.mockResolvedValue([outboxEntry(1, { kind: 'daily', dateKey: '2026-07-01', records })]);
        const guards = makeGuards();

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveDaily.mock.calls[0][0], '2026-07-01');
        testRunner.assertEquals(guards.saveDaily.mock.calls[0][1], records);
    },

    async "delete de empleado con schemaVersion>=2 llama deleteEntity('employee', id)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'delete', entity: 'employee', id: 'e1', schemaVersion: 2 })
        ]);
        const guards = makeGuards();

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.deleteEntity.mock.calls[0][0], 'employee');
        testRunner.assertEquals(guards.deleteEntity.mock.calls[0][1], 'e1');
        testRunner.assert(indexedDBService.delete.mock.calls.some(c => c[1] === 1), 'debe drenarse tras el borrado');
    },

    async "delete de empleado con schemaVersion<2 queda pending (path muerto, no drena ni falla)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'delete', entity: 'employee', id: 'e1', schemaVersion: 1 })
        ]);
        const guards = makeGuards();

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.deleteEntity.mock.calls.length, 0,
            'cuenta legacy: el doc per-empleado no existe, no debe intentar borrarlo');
        testRunner.assertEquals(indexedDBService.delete.mock.calls.length, 0, 'la entrada NO debe drenarse (queda esperando la migración)');
        testRunner.assertEquals(updatesToOutbox().length, 0, 'no es un fallo — no debe incrementar attempts');
    },

    async "delete de position con schemaVersion<3 queda pending; con >=3 drena"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'delete', entity: 'position', id: 'p1', schemaVersion: 2 })
        ]);
        let guards = makeGuards();
        await MainSyncStore.flush(guards);
        testRunner.assertEquals(guards.deleteEntity.mock.calls.length, 0, 'positions requieren schemaVersion>=3');

        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'delete', entity: 'position', id: 'p1', schemaVersion: 3 })
        ]);
        guards = makeGuards();
        await MainSyncStore.flush(guards);
        testRunner.assertEquals(guards.deleteEntity.mock.calls.length, 1, 'con schemaVersion>=3 sí debe drenar');
    }

});

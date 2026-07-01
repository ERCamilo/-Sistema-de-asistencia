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

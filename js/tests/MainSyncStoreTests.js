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

import { MainSyncStore, MAX_FLUSH_ATTEMPTS, initMainSyncLifecycle } from '../modules/services/MainSyncStore.js';
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

testRunner.addSuite("MainSyncStore — dead-lettering (espeja PettyCash M2)", {

    async "fallo transitorio incrementa attempts, status pending, y corta el ciclo"() {
        resetMocks();
        const snap1 = { settings: {} }, snap2 = { settings: {} };
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'mirror', snapshot: snap1 }),
            outboxEntry(2, { kind: 'mirror', snapshot: snap2 })
        ]);
        const guards = makeGuards();
        guards.saveMirror.mockRejectedValueOnce({ code: 'unavailable' }).mockResolvedValue(undefined);

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 1, 'sólo la primera entrada debe intentarse este ciclo');
        const updates = updatesToOutbox();
        const reSaved = updates.find(c => c[1].key === 1);
        testRunner.assert(!!reSaved, 'la entrada fallida debe re-guardarse con su nuevo estado');
        testRunner.assertEquals(reSaved[1].attempts, 1);
        testRunner.assertEquals(reSaved[1].status, 'pending');
        testRunner.assertEquals(guards.onCloudResult.mock.calls[0][0], false, 'debe reportar el fallo');
    },

    async "fallo permanente marca dead de inmediato y la cola CONTINÚA"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'mirror', snapshot: { settings: {} } }),
            outboxEntry(2, { kind: 'mirror', snapshot: { settings: {} } })
        ]);
        const guards = makeGuards();
        guards.saveMirror.mockRejectedValueOnce({ code: 'permission-denied' }).mockResolvedValue(undefined);

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 2,
            'un fallo PERMANENTE no debe cortar el ciclo — la entrada sana siguiente debe intentarse');
        const updates = updatesToOutbox();
        const dead = updates.find(c => c[1].key === 1);
        testRunner.assertEquals(dead[1].status, 'dead', 'permission-denied nunca se resuelve reintentando');
        testRunner.assert(indexedDBService.delete.mock.calls.some(c => c[1] === 2),
            'la entrada sana (key 2) debe drenarse aunque la anterior esté muerta');
    },

    async "tras MAX_FLUSH_ATTEMPTS un fallo transitorio pasa a dead y la cola continúa"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'mirror', snapshot: { settings: {} }, attempts: MAX_FLUSH_ATTEMPTS - 1 }),
            outboxEntry(2, { kind: 'mirror', snapshot: { settings: {} } })
        ]);
        const guards = makeGuards();
        guards.saveMirror.mockRejectedValueOnce({ code: 'unavailable' }).mockResolvedValue(undefined);

        await MainSyncStore.flush(guards);

        const updates = updatesToOutbox();
        const dead = updates.find(c => c[1].key === 1);
        testRunner.assertEquals(dead[1].status, 'dead', `tras ${MAX_FLUSH_ATTEMPTS} intentos debe dead-letterear aunque sea transitorio`);
        testRunner.assert(indexedDBService.delete.mock.calls.some(c => c[1] === 2), 'la siguiente entrada debe drenarse igual');
    },

    async "las entradas dead no se reintentan"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'mirror', snapshot: {}, status: 'dead' })
        ]);
        const guards = makeGuards();

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 0, 'dead no debe tocar la nube');
    }

});

testRunner.addSuite("MainSyncStore — pendingCount/deadCount/requeueDeadEntries", {

    async "pendingCount cuenta solo pending"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { status: 'pending' }), outboxEntry(2, { status: 'dead' }), outboxEntry(3, { status: 'pending' })
        ]);
        testRunner.assertEquals(await MainSyncStore.pendingCount(), 2);
    },

    async "deadCount cuenta solo dead"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { status: 'dead' }), outboxEntry(2, { status: 'pending' }), outboxEntry(3, { status: 'dead' })
        ]);
        testRunner.assertEquals(await MainSyncStore.deadCount(), 2);
    },

    async "requeueDeadEntries pone dead→pending, attempts:0, y reporta cuántas revivió"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { status: 'dead', attempts: 7, lastError: 'x' })
        ]);

        const n = await MainSyncStore.requeueDeadEntries();

        testRunner.assertEquals(n, 1);
        const updates = updatesToOutbox();
        testRunner.assertEquals(updates.length, 1);
        testRunner.assertEquals(updates[0][1].status, 'pending');
        testRunner.assertEquals(updates[0][1].attempts, 0);
    },

    async "requeueDeadEntries NO dispara flush por sí mismo (el caller decide, porque flush necesita guards)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([outboxEntry(1, { status: 'dead' })]);
        // Sin guards inyectados acá — si requeueDeadEntries intentara auto-flushear
        // necesitando guards, esto explotaría o requeriría un guards por defecto.
        // No debe pasar: sólo debe re-encolar y devolver el conteo.
        const n = await MainSyncStore.requeueDeadEntries();
        testRunner.assertEquals(n, 1);
    },

    // Judgment Day Fase 1 R1: U2d (compactación de tombstones) necesita saber
    // qué fechas de asistencia todavía no confirmaron su subida diaria en la
    // nube, para NO borrar el tombstone local de esa fecha (destruiría la
    // única evidencia del borrado antes de que se propagara).
    async "getUnconfirmedDailyDateKeys devuelve las fechas 'daily' pending o dead, ignorando otros kinds y confirmadas"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'daily', dateKey: '2026-04-01', status: 'pending' }),
            outboxEntry(2, { kind: 'daily', dateKey: '2026-04-02', status: 'dead' }),
            outboxEntry(3, { kind: 'mirror', dateKey: '2026-04-01', status: 'pending' }), // otro kind: ignorar
            outboxEntry(4, { kind: 'delete', entity: 'employee', id: 'e1', status: 'pending' }) // otro kind: ignorar
        ]);

        const dateKeys = await MainSyncStore.getUnconfirmedDailyDateKeys();

        testRunner.assert(dateKeys instanceof Set, 'debe devolver un Set');
        testRunner.assertEquals(dateKeys.size, 2, 'sólo las 2 entradas daily (pending+dead) deben contarse');
        testRunner.assert(dateKeys.has('2026-04-01'), 'debe incluir la fecha daily pending');
        testRunner.assert(dateKeys.has('2026-04-02'), 'debe incluir la fecha daily dead');
    },

    async "getUnconfirmedDailyDateKeys devuelve un Set vacío si no hay entradas 'daily' sin confirmar"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([]);
        const dateKeys = await MainSyncStore.getUnconfirmedDailyDateKeys();
        testRunner.assertEquals(dateKeys.size, 0);
    }

});

testRunner.addSuite("MainSyncStore — lifecycle: drenado al volver la conexión", {

    async "initMainSyncLifecycle cablea 'online' y dispara flush(guardsFactory())"() {
        resetMocks();
        const guardsObj = makeGuards();
        const guardsFactory = jest.fn(() => guardsObj);
        const flushSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        try {
            initMainSyncLifecycle(guardsFactory);
            window.dispatchEvent(new Event('online'));
            await Promise.resolve(); // dejar correr el handler async

            testRunner.assert(guardsFactory.mock.calls.length >= 1, 'debe pedir guards frescos al reconectar');
            testRunner.assert(
                flushSpy.mock.calls.some(c => c[0] === guardsObj),
                "'online' debe disparar MainSyncStore.flush con los guards de la factory"
            );
        } finally {
            flushSpy.mockRestore();
        }
    },

    async "initMainSyncLifecycle es idempotente: llamarlo dos veces no duplica el listener"() {
        resetMocks();
        const guardsFactory = jest.fn(() => makeGuards());
        const flushSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        try {
            initMainSyncLifecycle(guardsFactory);
            initMainSyncLifecycle(guardsFactory); // segunda vez — no debe agregar otro listener
            flushSpy.mockClear();

            window.dispatchEvent(new Event('online'));
            await Promise.resolve();

            testRunner.assertEquals(flushSpy.mock.calls.length, 1,
                'con el listener duplicado, un solo evento online dispararía flush dos veces — debe ser 1');
        } finally {
            flushSpy.mockRestore();
        }
    }

});

testRunner.addSuite("MainSyncStore — flush: guard de re-entrancy (Judgment Day #1, CRÍTICO)", {
    // MainSyncStore.flush() se dispara desde AL MENOS 3 sitios independientes
    // que pueden coincidir en el tiempo (guardado normal, 'online', login/retry
    // manual). Sin un guard, dos flush() concurrentes leen el mismo pending,
    // suben la MISMA entrada dos veces, y ante un fallo compartido cada uno
    // hace `put()` (last-write-wins) sobre `attempts` con su propia copia
    // stale — uno de los dos incrementos se pierde, debilitando el
    // dead-lettering. Mismo patrón que PettyCashStore.flush() ya resuelve con
    // su `_flushing` de módulo.

    async "un segundo flush() mientras el primero está en vuelo NO reprocesa la cola"() {
        resetMocks();
        let resolveSave;
        const gate = new Promise(r => { resolveSave = r; });
        indexedDBService.getAll.mockResolvedValue([outboxEntry(1, { kind: 'mirror', snapshot: { settings: {} } })]);
        const guards = makeGuards({ saveMirror: jest.fn(() => gate) }); // se queda "colgado" hasta que resolvemos

        const firstFlush = MainSyncStore.flush(guards);
        await Promise.resolve(); // dejar que el primer flush entre a cloudCall() y quede esperando `gate`

        const secondFlush = MainSyncStore.flush(guards); // dispara mientras el primero sigue en vuelo

        // Resolver ANTES de esperar: sin el guard, la segunda llamada engancha
        // la MISMA promesa `gate` (mismo mock) — awaitear en el orden opuesto
        // dead-lockearía hasta el timeout de Jest.
        resolveSave();
        await Promise.all([firstFlush, secondFlush]);

        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 1,
            'mientras el primer flush sigue en vuelo, el segundo NO debe volver a llamar a saveMirror (evita duplicar la subida)');
    },

    async "tras terminar el primer flush, uno nuevo SÍ puede correr (el guard no queda trabado)"() {
        resetMocks();
        // El mock no simula un store real (NEW-3): encadenamos Once para que la
        // 2ª llamada a getAll() refleje que la entrada YA se drenó (delete real
        // no persiste en este mock). Lo que se prueba acá es SOLO que _flushing
        // no queda trabado en true — no la persistencia real (ya cubierta arriba).
        indexedDBService.getAll
            .mockResolvedValueOnce([outboxEntry(1, { kind: 'mirror', snapshot: { settings: {} } })])
            .mockResolvedValueOnce([]); // 2º ciclo: ya no queda nada pendiente
        const guards = makeGuards();

        await MainSyncStore.flush(guards);
        await MainSyncStore.flush(guards); // si _flushing quedara trabado, esto no llamaría a getAll() de nuevo

        testRunner.assertEquals(indexedDBService.getAll.mock.calls.length, 2,
            'el segundo flush() debe poder ejecutar su ciclo completo (el guard se liberó tras el primero)');
        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 1,
            'con la cola ya vacía en el 2º ciclo, no debe volver a subir nada');
    },

    async "el guard se libera aunque el flush termine con un error inesperado"() {
        resetMocks();
        indexedDBService.getAll.mockRejectedValueOnce(new Error('IDB caído')); // falla ANTES del bucle
        const guards = makeGuards();

        let threw = false;
        try { await MainSyncStore.flush(guards); } catch (_) { threw = true; }

        // Sin importar si flush() propaga o traga el error, el guard NO debe
        // quedar trabado en true para siempre (bloquearía todo flush futuro).
        indexedDBService.getAll.mockResolvedValue([outboxEntry(2, { kind: 'mirror', snapshot: { settings: {} } })]);
        await MainSyncStore.flush(guards);
        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 1,
            'tras un error inesperado, un flush posterior debe poder correr normalmente (guard liberado)');
    }
});

testRunner.addSuite("MainSyncStore — clearAll (Fase 0.5, U1)", {

    async "clearAll vacía el store del outbox y resuelve true"() {
        resetMocks();
        indexedDBService.clear.mockReset().mockResolvedValue(undefined);

        const ok = await MainSyncStore.clearAll();

        testRunner.assertEquals(ok, true, 'debe reportar éxito');
        testRunner.assert(
            indexedDBService.clear.mock.calls.some(c => c[0] === 'mainSyncOutbox'),
            'debe limpiar exactamente el store mainSyncOutbox'
        );
    },

    async "clearAll ante un error de IndexedDB NO lanza — resuelve false"() {
        // Los callers (Descargar y Reemplazar, Borrar Local) necesitan saber si
        // la purga falló para poder advertir, pero nunca deben reventar por esto.
        resetMocks();
        indexedDBService.clear.mockReset().mockRejectedValue(new Error('IDB caído'));

        let threw = false;
        let ok = null;
        try { ok = await MainSyncStore.clearAll(); } catch (_) { threw = true; }

        testRunner.assertEquals(threw, false, 'no debe propagar el error');
        testRunner.assertEquals(ok, false, 'debe reportar el fallo con false');
    }

});

testRunner.addSuite("MainSyncStore — clearAll aborta un flush en vuelo (JD-F5, ALTO)", {

    async "las entradas leídas ANTES de la purga no se suben DESPUÉS de ella"() {
        // flush() lee la lista pending a memoria UNA vez y la itera awaiteando
        // la red por entrada. Sin coordinación, un clearAll() disparado a mitad
        // (usuario tocó Borrar Local / Descargar y Reemplazar) purgaba el store
        // pero el bucle seguía subiendo su copia stale en memoria — re-subiendo
        // exactamente lo que la purga debía impedir (bug ALTA #1 en ventana).
        resetMocks();
        let releaseFirst;
        const gate = new Promise(r => { releaseFirst = r; });
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'mirror', snapshot: { settings: {} } }),
            outboxEntry(2, { kind: 'daily', dateKey: '2026-07-01', records: {} })
        ]);
        indexedDBService.clear.mockReset().mockResolvedValue(undefined);
        const guards = makeGuards({ saveMirror: jest.fn(() => gate) });

        const flushing = MainSyncStore.flush(guards);
        await Promise.resolve(); // dejar que el flush entre a la entrada 1 (bloqueada en la red)

        await MainSyncStore.clearAll(); // purga mientras la entrada 1 sigue en vuelo
        releaseFirst();
        await flushing;

        testRunner.assertEquals(guards.saveDaily.mock.calls.length, 0,
            'la entrada 2 (leída antes de la purga) NO debe subirse después del clearAll');
    },

    async "sin purga de por medio, el mismo flush procesa TODAS las entradas (control)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'mirror', snapshot: { settings: {} } }),
            outboxEntry(2, { kind: 'daily', dateKey: '2026-07-01', records: {} })
        ]);
        const guards = makeGuards();

        await MainSyncStore.flush(guards);

        testRunner.assertEquals(guards.saveMirror.mock.calls.length, 1);
        testRunner.assertEquals(guards.saveDaily.mock.calls.length, 1,
            'control: el corte del test anterior debe deberse SOLO al clearAll');
    }

});

testRunner.addSuite("MainSyncStore — la purga también protege el camino de FALLO (JD ronda 2, R2-5)", {

    async "una entrada que FALLA después de la purga NO se re-escribe al store recién vaciado"() {
        // El chequeo de generación de R1 sólo cubría el avance entre entradas
        // (camino de éxito). Si la entrada en vuelo FALLABA tras la purga, el
        // catch hacía update(OUTBOX, ...) incondicional — resucitando la
        // entrada en el store que clearAll acababa de vaciar; el próximo
        // flush (login/online) la subía igual.
        resetMocks();
        let failFirst;
        const gate = new Promise((_, reject) => { failFirst = reject; });
        gate.catch(() => { /* pre-manejada: evita unhandled rejection si el reject gana la carrera */ });
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'mirror', snapshot: { settings: {} } })
        ]);
        indexedDBService.clear.mockReset().mockResolvedValue(undefined);
        const guards = makeGuards({ saveMirror: jest.fn(() => gate) });

        const flushing = MainSyncStore.flush(guards);
        await new Promise(r => setTimeout(r, 0)); // tick real: el flush llega a await cloudCall()

        await MainSyncStore.clearAll();           // purga mientras vuela
        failFirst(new Error('unavailable'));      // y la red FALLA después
        await flushing;

        const outboxUpdates = indexedDBService.update.mock.calls.filter(c => c[0] === 'mainSyncOutbox');
        testRunner.assertEquals(outboxUpdates.length, 0,
            'el catch NO debe resucitar la entrada purgada re-escribiéndola a IndexedDB');
    },

    async "sin purga de por medio, el catch SÍ persiste el attempts/lastError (control)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            outboxEntry(1, { kind: 'mirror', snapshot: { settings: {} } })
        ]);
        const guards = makeGuards({ saveMirror: jest.fn().mockRejectedValue(new Error('unavailable')) });

        await MainSyncStore.flush(guards);

        const outboxUpdates = indexedDBService.update.mock.calls.filter(c => c[0] === 'mainSyncOutbox');
        testRunner.assertEquals(outboxUpdates.length, 1,
            'control: el dead-lettering normal (sin purga) debe seguir persistiendo el intento fallido');
    }

});

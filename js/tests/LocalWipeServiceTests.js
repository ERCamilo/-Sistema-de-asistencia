/**
 * 🧪 LocalWipeServiceTests (Fase 0.5, U3)
 *
 * "Borrar Local" prometía limpiar el dispositivo por completo, pero
 * storage.clear() sólo borraba la clave principal de localStorage: la cola
 * de borrados pendientes (asistencia_pending_cloud_deletes) sobrevivía y,
 * tras re-login, ejecutaba borrados viejos EN LA NUBE — rompiendo la promesa
 * "Los datos en la nube NO se borrarán" (bug ALTA #2 de la auditoría).
 *
 * wipeAllLocalTraces() es el borrado REAL: bloquea los guardados implícitos
 * (U2), purga pendientes hacia la nube (U1), y elimina TODO rastro local —
 * clave principal + backup, flags de migración/onboarding/pausa, caché de
 * caja chica, respaldo de sessionStorage, IndexedDB completo y la marca de
 * propiedad del dispositivo. No recarga la página: eso lo decide el caller.
 *
 * DI-friendly (mismo patrón que los guards de MainSyncStore.flush): las
 * dependencias efectosas se inyectan con defaults reales.
 */

import { wipeAllLocalTraces, LOCAL_TRACE_KEYS } from '../modules/services/LocalWipeService.js';

function makeDeps(overrides = {}) {
    return {
        beginWipe: jest.fn(),
        purgePendingCloudWrites: jest.fn().mockResolvedValue(true),
        clearMainStorage: jest.fn().mockReturnValue(true),
        clearIndexedDB: jest.fn().mockResolvedValue(true),
        clearOwnership: jest.fn(),
        ...overrides
    };
}

testRunner.addSuite("LocalWipeService — wipeAllLocalTraces (Fase 0.5, U3)", {

    async "ejecuta la secuencia completa: begin → purga → storage → claves → IDB → ownership"() {
        const deps = makeDeps();

        const result = await wipeAllLocalTraces(deps);

        testRunner.assertEquals(result.ok, true, 'debe reportar éxito');
        testRunner.assertEquals(deps.beginWipe.mock.calls.length, 1, 'debe bloquear los guardados implícitos');
        testRunner.assertEquals(deps.purgePendingCloudWrites.mock.calls.length, 1, 'debe purgar pendientes hacia la nube');
        testRunner.assertEquals(deps.clearMainStorage.mock.calls.length, 1, 'debe limpiar la clave principal de localStorage');
        testRunner.assertEquals(deps.clearIndexedDB.mock.calls.length, 1, 'debe limpiar IndexedDB completo');
        testRunner.assertEquals(deps.clearOwnership.mock.calls.length, 1, 'debe soltar la propiedad del dispositivo');
    },

    async "beginWipe corre ANTES que cualquier limpieza (si no, un save del debounce re-persiste a mitad del borrado)"() {
        const order = [];
        const deps = makeDeps({
            beginWipe: jest.fn(() => order.push('begin')),
            purgePendingCloudWrites: jest.fn(async () => { order.push('purge'); return true; }),
            clearIndexedDB: jest.fn(async () => { order.push('idb'); return true; })
        });

        await wipeAllLocalTraces(deps);

        testRunner.assertEquals(order[0], 'begin', 'begin debe ser lo PRIMERO de la secuencia');
    },

    async "elimina todas las claves del manifiesto de localStorage y el respaldo de sessionStorage"() {
        // El manifiesto es la lista explícita de TODO rastro conocido fuera de
        // la clave principal. Si alguien agrega una clave nueva de persistencia
        // y no la suma acá, este test documenta dónde hacerlo.
        const deps = makeDeps();
        LOCAL_TRACE_KEYS.forEach(k => { try { localStorage.setItem(k, 'x'); } catch (_) { /* noop */ } });
        try { sessionStorage.setItem('attendance-backup', '{"x":1}'); } catch (_) { /* noop */ }

        await wipeAllLocalTraces(deps);

        LOCAL_TRACE_KEYS.forEach(k => {
            testRunner.assertEquals(localStorage.getItem(k), null, `la clave ${k} debe eliminarse`);
        });
        testRunner.assertEquals(sessionStorage.getItem('attendance-backup'), null,
            'el auto-backup de sessionStorage también es un rastro local (contiene salarios/préstamos redactados)');
    },

    "el manifiesto incluye las claves críticas conocidas"() {
        // Documenta el inventario relevado en la auditoría 2026-07-01. La cola
        // de borrados pendientes es EL bug ALTA #2 — si desaparece del
        // manifiesto, ese bug vuelve (aunque la purga U1 también la cubre,
        // defensa en profundidad: dos capas independientes).
        const required = [
            'asistencia_pending_cloud_deletes',
            'asistencia-data-backup',
            'migrated-to-idb',
            'onboardingCompleted',
            'asistencia_last_snapshot_attempt',
            'asistencia_cloud_upload_paused',
            'asistencia_cloud_download_paused',
            '_pettycash_local_v2',
            '_pettycash_sel_v1'
        ];
        required.forEach(k => {
            testRunner.assert(LOCAL_TRACE_KEYS.includes(k), `el manifiesto debe incluir ${k}`);
        });
    },

    async "si IndexedDB falla, sigue limpiando el resto y reporta ok=false con el detalle"() {
        // Borrado best-effort: un fallo parcial NO debe dejar el resto sin
        // limpiar (peor sería abortar a mitad y dejar un estado zombie).
        const deps = makeDeps({
            clearIndexedDB: jest.fn().mockRejectedValue(new Error('IDB caído'))
        });

        const result = await wipeAllLocalTraces(deps);

        testRunner.assertEquals(result.ok, false, 'debe reportar que el borrado fue parcial');
        testRunner.assert(result.errors.length >= 1, 'debe detallar qué falló');
        testRunner.assertEquals(deps.clearOwnership.mock.calls.length, 1,
            'los pasos posteriores al fallo deben ejecutarse igual (best-effort)');
    }

});

console.log('🧪 LocalWipeService tests cargados.');

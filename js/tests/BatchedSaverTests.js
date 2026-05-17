/**
 * 🧪 BatchedSaverTests - Pruebas para la utilidad de guardado por lotes
 *
 * Uso desde la consola del navegador:
 *   await import('./js/tests/BatchedSaverTests.js')
 *   testRunner.runAll()
 */

import { BatchedSaver, defaultIdleScheduler } from '../modules/utils/BatchedSaver.js';

// ─────────────────────────────────────────────────────────────
// Helpers de testing
// ─────────────────────────────────────────────────────────────

/**
 * Scheduler manual: en vez de programar trabajo, lo guarda y se ejecuta
 * cuando llames `triggerScheduled()`. Permite tests deterministas
 * sin depender de timers reales.
 */
function createManualScheduler() {
    let pending = null;

    const scheduler = (callback /*, options */) => {
        pending = callback;
        return Symbol('handle');
    };

    const cancel = (/* handle */) => {
        pending = null;
    };

    const triggerScheduled = async () => {
        if (pending) {
            const cb = pending;
            pending = null;
            await cb();
        }
    };

    return { scheduler, cancel, triggerScheduled, hasPending: () => pending !== null };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// Suite de pruebas
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("BatchedSaver", {

    "constructor: lanza TypeError si no se proporciona flush"() {
        let threw = false;
        try {
            new BatchedSaver({});
        } catch (e) {
            threw = e instanceof TypeError;
        }
        testRunner.assert(threw, 'Debe lanzar TypeError si falta "flush"');
    },

    "add: acumula items en el batch interno"() {
        const ctrl = createManualScheduler();
        const saver = new BatchedSaver({
            flush: async () => {},
            scheduler: ctrl.scheduler,
            cancel: ctrl.cancel
        });

        saver.add('a');
        saver.add('b');
        saver.add('c');

        testRunner.assertEquals(saver.pendingCount, 3, "Deberían quedar 3 items pendientes");
        testRunner.assert(saver.hasScheduledFlush, "Debe haber un flush programado");
    },

    async "add: ráfaga de 17 adds dispara UN solo flush con todos los items"() {
        const ctrl = createManualScheduler();
        let flushCallCount = 0;
        let receivedBatch = null;

        const saver = new BatchedSaver({
            flush: async (batch) => {
                flushCallCount++;
                receivedBatch = batch;
            },
            scheduler: ctrl.scheduler,
            cancel: ctrl.cancel
        });

        // Ráfaga de 17 adds (simula 17 días de Firebase)
        for (let i = 0; i < 17; i++) {
            saver.add(`2026-04-${String(i + 1).padStart(2, '0')}`);
        }

        // Aún no se ha ejecutado nada
        testRunner.assertEquals(flushCallCount, 0, "Flush no debe haberse ejecutado todavía");
        testRunner.assertEquals(saver.pendingCount, 17, "Deben quedar 17 items pendientes");

        // Disparar el "tiempo idle" manualmente
        await ctrl.triggerScheduled();

        testRunner.assertEquals(flushCallCount, 1, "Flush debe ejecutarse UNA sola vez");
        testRunner.assertEquals(receivedBatch.length, 17, "El batch debe contener los 17 items");
        testRunner.assertEquals(saver.pendingCount, 0, "El batch debe estar vacío tras flush");
    },

    async "add: tras flush, nuevos adds inician un batch nuevo"() {
        const ctrl = createManualScheduler();
        const batches = [];

        const saver = new BatchedSaver({
            flush: async (batch) => { batches.push([...batch]); },
            scheduler: ctrl.scheduler,
            cancel: ctrl.cancel
        });

        saver.add('a');
        saver.add('b');
        await ctrl.triggerScheduled();

        saver.add('c');
        saver.add('d');
        saver.add('e');
        await ctrl.triggerScheduled();

        testRunner.assertEquals(batches.length, 2, "Deben haberse ejecutado 2 flushes separados");
        testRunner.assertEquals(batches[0].length, 2, "Primer batch debe tener 2 items");
        testRunner.assertEquals(batches[1].length, 3, "Segundo batch debe tener 3 items");
    },

    async "flushNow: fuerza ejecución inmediata"() {
        const ctrl = createManualScheduler();
        let flushCalled = false;

        const saver = new BatchedSaver({
            flush: async () => { flushCalled = true; },
            scheduler: ctrl.scheduler,
            cancel: ctrl.cancel
        });

        saver.add('x');
        testRunner.assert(!flushCalled, "Flush no debe haber ocurrido aún");

        await saver.flushNow();

        testRunner.assert(flushCalled, "flushNow() debe ejecutar el flush inmediatamente");
        testRunner.assertEquals(saver.pendingCount, 0, "Batch debe estar vacío");
        testRunner.assert(!ctrl.hasPending(), "El scheduler no debe quedar pendiente");
    },

    "cancel: descarta el batch sin ejecutar flush"() {
        const ctrl = createManualScheduler();
        let flushCalled = false;

        const saver = new BatchedSaver({
            flush: async () => { flushCalled = true; },
            scheduler: ctrl.scheduler,
            cancel: ctrl.cancel
        });

        saver.add('a');
        saver.add('b');
        saver.cancel();

        testRunner.assertEquals(saver.pendingCount, 0, "Batch debe estar vacío tras cancel");
        testRunner.assert(!ctrl.hasPending(), "Scheduler no debe quedar pendiente");
        testRunner.assert(!flushCalled, "Flush NO debe haberse ejecutado");
    },

    async "onError: captura excepciones del flush sin romper el saver"() {
        const ctrl = createManualScheduler();
        let capturedError = null;

        const saver = new BatchedSaver({
            flush: async () => { throw new Error('boom'); },
            scheduler: ctrl.scheduler,
            cancel: ctrl.cancel,
            onError: (err) => { capturedError = err; }
        });

        saver.add('a');
        await ctrl.triggerScheduled();

        testRunner.assert(capturedError !== null, "El error debe ser capturado");
        testRunner.assertEquals(capturedError.message, 'boom', "Mensaje de error preservado");

        // El saver debe seguir funcional tras un error
        saver.add('b');
        testRunner.assertEquals(saver.pendingCount, 1, "El saver sigue aceptando items");
    },

    async "stats: contador refleja adds y flushes acumulados"() {
        const ctrl = createManualScheduler();
        const saver = new BatchedSaver({
            flush: async () => {},
            scheduler: ctrl.scheduler,
            cancel: ctrl.cancel
        });

        saver.add('a');
        saver.add('b');
        saver.add('c');
        await ctrl.triggerScheduled();

        saver.add('d');
        await ctrl.triggerScheduled();

        const stats = saver.getStats();
        testRunner.assertEquals(stats.totalAdded, 4, "totalAdded debe contar todos los adds");
        testRunner.assertEquals(stats.totalFlushes, 2, "totalFlushes debe contar todos los flushes");
        testRunner.assertEquals(stats.lastBatchSize, 1, "lastBatchSize refleja el último batch");
    },

    async "fallback: defaultIdleScheduler usa setTimeout si no hay requestIdleCallback"() {
        // Guardar estado original
        const originalRIC = window.requestIdleCallback;

        try {
            // Simular navegador sin requestIdleCallback (Safari antiguo)
            delete window.requestIdleCallback;

            let executed = false;
            defaultIdleScheduler(() => { executed = true; }, { timeout: 100 });

            // setTimeout fallback dispara en 50ms (ver implementación)
            await sleep(100);

            testRunner.assert(executed, "El callback debe ejecutarse vía setTimeout fallback");
        } finally {
            // Restaurar estado original
            if (originalRIC) window.requestIdleCallback = originalRIC;
        }
    },

    async "integración: ráfaga de 17 días con timers reales → 1 sola escritura"() {
        // Test end-to-end con timers reales (sin manual scheduler)
        let writeCount = 0;
        let lastBatch = null;

        const saver = new BatchedSaver({
            flush: async (batch) => {
                writeCount++;
                lastBatch = batch;
            },
            maxWaitMs: 200  // Corto para que el test sea rápido
        });

        // Simular Firebase mandando 17 días en ráfaga
        for (let i = 1; i <= 17; i++) {
            saver.add(`2026-04-${String(i).padStart(2, '0')}`);
        }

        // Esperar a que se ejecute (con margen)
        await sleep(400);

        testRunner.assertEquals(writeCount, 1, "DEBE haber UNA sola escritura para 17 adds");
        testRunner.assertEquals(lastBatch.length, 17, "El batch debe contener los 17 días");
        testRunner.assertEquals(lastBatch[0], '2026-04-01', "Orden preservado: primer día");
        testRunner.assertEquals(lastBatch[16], '2026-04-17', "Orden preservado: último día");
    }
});

console.log('🧪 BatchedSaver tests cargados. Ejecuta `testRunner.runAll()` para correrlos.');

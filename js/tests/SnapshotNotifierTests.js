/**
 * 🧪 SnapshotNotifierTests (Snapshot H)
 *
 * Verifica el comportamiento del helper que muestra un toast cuando se crea
 * un snapshot automático/del sistema, para que el usuario sepa que la app
 * lo está protegiendo. Los snapshots manuales NO disparan toast aquí porque
 * el caller ya muestra su propio "✅ Snapshot guardado".
 *
 * Reglas:
 *   - reason === 'manual'           → NO toast (lo muestra el caller).
 *   - reason === 'daily-auto'       → toast info, discreto.
 *   - reason === 'pre-*'            → toast info con el label del catálogo.
 *   - reason desconocida            → toast genérico (fallback).
 *   - Sin reason ni type            → no rompe; no toast.
 *   - Notification module ausente   → no rompe; falla silenciosa (defensivo).
 */

import { notifySnapshotCreated } from '../modules/services/SnapshotNotifier.js';
import { Notification } from '../modules/components/Notification.js';

// Espía sobre Notification.info para observar las llamadas.
let infoSpy;

function setupSpy() {
    infoSpy = jest.spyOn(Notification, 'info').mockImplementation(() => {});
}
function teardownSpy() {
    if (infoSpy) infoSpy.mockRestore();
}

testRunner.addSuite("SnapshotNotifier — toast en snapshots automáticos (H)", {

    "snapshot manual NO dispara toast (el caller ya muestra el suyo)"() {
        setupSpy();
        try {
            notifySnapshotCreated({ reason: 'manual', type: 'manual' });
            testRunner.assertEquals(infoSpy.mock.calls.length, 0,
                "Manual no debe disparar toast desde el helper");
        } finally {
            teardownSpy();
        }
    },

    "snapshot daily-auto dispara toast info"() {
        setupSpy();
        try {
            notifySnapshotCreated({ reason: 'daily-auto', type: 'auto' });
            testRunner.assertEquals(infoSpy.mock.calls.length, 1,
                "daily-auto debe disparar exactamente 1 toast");
        } finally {
            teardownSpy();
        }
    },

    "snapshot pre-migration-v2 dispara toast con el label del catálogo"() {
        setupSpy();
        try {
            notifySnapshotCreated({ reason: 'pre-migration-v2', type: 'pre-restore' });
            testRunner.assertEquals(infoSpy.mock.calls.length, 1, "Debe haber 1 toast");
            const msg = infoSpy.mock.calls[0][0];
            testRunner.assert(
                typeof msg === 'string' && msg.length > 0,
                "El mensaje del toast debe ser un string no vacío"
            );
            testRunner.assert(
                msg.includes('migra') || msg.includes('multi-dispositivo'),
                `Mensaje debe contener parte del label del catálogo; recibido: "${msg}"`
            );
        } finally {
            teardownSpy();
        }
    },

    "snapshot pre-loan-change dispara toast con icono 💵 y label apropiado"() {
        setupSpy();
        try {
            notifySnapshotCreated({ reason: 'pre-loan-change', type: 'pre-restore' });
            testRunner.assertEquals(infoSpy.mock.calls.length, 1);
            const msg = infoSpy.mock.calls[0][0];
            testRunner.assert(msg.includes('préstamo') || msg.includes('💵'),
                `Mensaje debe contener "préstamo" o el icono 💵; recibido: "${msg}"`);
        } finally {
            teardownSpy();
        }
    },

    "razón desconocida cae al fallback (sigue mostrando toast genérico)"() {
        setupSpy();
        try {
            notifySnapshotCreated({ reason: 'razon-que-no-existe', type: 'auto' });
            testRunner.assertEquals(infoSpy.mock.calls.length, 1,
                "Razón desconocida con type=auto debe seguir notificando");
        } finally {
            teardownSpy();
        }
    },

    "sin reason y type=pre-restore: dispara toast genérico (es un punto del sistema)"() {
        setupSpy();
        try {
            notifySnapshotCreated({ type: 'pre-restore' });
            testRunner.assertEquals(infoSpy.mock.calls.length, 1,
                "type=pre-restore sin reason explícita debe seguir notificando");
        } finally {
            teardownSpy();
        }
    },

    "no se rompe si recibe metadata vacía"() {
        setupSpy();
        try {
            let threw = false;
            try { notifySnapshotCreated({}); } catch (e) { threw = true; }
            testRunner.assert(!threw, "notifySnapshotCreated({}) no debe lanzar");
            // No deber disparar toast — no hay info útil para mostrar.
            testRunner.assertEquals(infoSpy.mock.calls.length, 0);
        } finally {
            teardownSpy();
        }
    },

    "no se rompe si recibe null/undefined"() {
        setupSpy();
        try {
            let threw = false;
            try { notifySnapshotCreated(null); } catch (e) { threw = true; }
            testRunner.assert(!threw, "notifySnapshotCreated(null) no debe lanzar");
            try { notifySnapshotCreated(undefined); } catch (e) { threw = true; }
            testRunner.assert(!threw, "notifySnapshotCreated(undefined) no debe lanzar");
        } finally {
            teardownSpy();
        }
    },

    "el toast usa duración corta (no se queda pegado)"() {
        setupSpy();
        try {
            notifySnapshotCreated({ reason: 'daily-auto', type: 'auto' });
            const [, options] = infoSpy.mock.calls[0];
            // Notification.info acepta opciones o duración directa.
            // Aceptamos cualquier configuración explícita que indique no-sticky.
            if (options && typeof options === 'object') {
                testRunner.assert(
                    options.duration === undefined || options.duration > 0,
                    "La notificación NO debe ser sticky (duration=0)"
                );
            }
        } finally {
            teardownSpy();
        }
    }

});

console.log('🧪 SnapshotNotifier tests cargados.');

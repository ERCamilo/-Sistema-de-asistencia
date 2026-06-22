/**
 * 🧪 SaveOutcomeSpinnerTests
 *
 * Regresión del bug "spinner colgado": al crear un empleado SIN sesión (o
 * local-only), el toast de fase 0 ("Guardando — …") se quedaba girando para
 * siempre. Causa: el wiring del singleton (_notify) solo actualizaba el toast
 * en sitio para el caso 'warning'; el verde local-only (y el rojo) creaban un
 * toast NUEVO y dejaban el spinner sticky huérfano.
 *
 * Estos tests ejercen el SINGLETON real (no el notifier inyectable) contra el
 * componente Notification en jsdom y exigen que, tras CUALQUIER resultado
 * final, no quede ningún toast de tipo 'loading'.
 */

import { saveOutcomeNotifier } from '../modules/services/SaveOutcomeNotifier.js';
import { Notification } from '../modules/components/Notification.js';

function reset() {
    Notification.clearAll();
    document.querySelectorAll('[id^="notification-container-"]').forEach(c => c.remove());
    Notification.activeNotifications = [];
}

const loadingToasts = () => Notification.activeNotifications.filter(n => n.type === 'loading').length;

testRunner.addSuite("SaveOutcomeNotifier (singleton) — el spinner siempre se cierra", {

    "fase 0 muestra un spinner 'Guardando…'"() {
        reset();
        saveOutcomeNotifier.recordSaveStarted({ label: 'Empleado X creado' });
        testRunner.assert(loadingToasts() >= 1, 'recordSaveStarted debe mostrar un toast loading');
        reset();
    },

    "local OK sin nube: el spinner se resuelve (NO queda loading)"() {
        reset();
        saveOutcomeNotifier.recordSaveStarted({ label: 'Empleado X creado' });
        saveOutcomeNotifier.recordLocalResult({ localOk: true, cloudExpected: false, label: 'Empleado X creado' });
        testRunner.assertEquals(loadingToasts(), 0, 'tras el resultado local NO debe quedar ningún spinner');
        reset();
    },

    "local OK + nube OK: NO queda loading"() {
        reset();
        saveOutcomeNotifier.recordSaveStarted({ label: 'Empleado X creado' });
        saveOutcomeNotifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'Empleado X creado' });
        saveOutcomeNotifier.recordCloudResult(true);
        testRunner.assertEquals(loadingToasts(), 0, 'el flujo con nube OK no deja spinner');
        reset();
    },

    "local FALLÓ: el spinner se convierte en error (NO queda loading)"() {
        reset();
        saveOutcomeNotifier.recordSaveStarted({ label: 'Empleado X creado' });
        saveOutcomeNotifier.recordLocalResult({ localOk: false, cloudExpected: true, label: 'Empleado X creado' });
        testRunner.assertEquals(loadingToasts(), 0, 'un fallo local tampoco debe dejar el spinner colgado');
        reset();
    }

});

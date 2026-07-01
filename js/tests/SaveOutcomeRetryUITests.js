/**
 * 🧪 SaveOutcomeRetryUITests (U12)
 *
 * Ejercita el SINGLETON real de SaveOutcomeNotifier (no la fábrica inyectable)
 * contra el componente Notification en jsdom: el botón "Reintentar" del toast
 * amarillo debe existir, ejecutar el handler inyectado, no cerrar el toast, y
 * — lo más importante — el resultado del reintento debe actualizar el MISMO
 * toast a verde (no quedarse pegado en amarillo ni crear uno nuevo).
 */

import { saveOutcomeNotifier } from '../modules/services/SaveOutcomeNotifier.js';
import { Notification } from '../modules/components/Notification.js';

function reset() {
    Notification.clearAll();
    document.querySelectorAll('[id^="notification-container-"]').forEach(c => c.remove());
    Notification.activeNotifications = [];
    saveOutcomeNotifier.setCloudRetryHandler(null);
}

function driveCloudFailure(label = 'Gasto guardado') {
    saveOutcomeNotifier.recordLocalResult({ localOk: true, cloudExpected: true, label });
    saveOutcomeNotifier.recordCloudResult(false);
}

testRunner.addSuite("SaveOutcomeNotifier (singleton) — botón Reintentar (U12)", {

    "un fallo de nube CON handler inyectado muestra el botón Reintentar"() {
        reset();
        saveOutcomeNotifier.setCloudRetryHandler(() => {});
        try {
            driveCloudFailure();
            const toast = Notification.activeNotifications[0];
            testRunner.assert(!!toast, 'debe haber un toast activo');
            testRunner.assertEquals(toast.type, 'warning');
            const btn = toast.element.querySelector('.notification-action');
            testRunner.assert(!!btn, 'el toast de fallo debe tener el botón Reintentar');
            testRunner.assertEquals(btn.textContent, 'Reintentar');
        } finally { reset(); }
    },

    "sin handler inyectado, el fallo de nube NO muestra botón (caso PettyCash)"() {
        reset(); // setCloudRetryHandler(null) explícito dentro de reset()
        try {
            driveCloudFailure();
            const toast = Notification.activeNotifications[0];
            testRunner.assert(!toast.element.querySelector('.notification-action'),
                'sin handler inyectado no debe aparecer ningún botón');
        } finally { reset(); }
    },

    "clic en Reintentar ejecuta el handler y NO cierra el toast"() {
        reset();
        let called = 0;
        saveOutcomeNotifier.setCloudRetryHandler(() => { called++; });
        try {
            driveCloudFailure();
            const toast = Notification.activeNotifications[0];
            toast.element.querySelector('.notification-action').click();

            testRunner.assertEquals(called, 1, 'debe invocar el handler inyectado');
            testRunner.assert(Notification.activeNotifications.includes(toast),
                'closeOnClick:false — el toast debe seguir visible mientras se reintenta');
        } finally { reset(); }
    },

    "el retry exitoso actualiza el MISMO toast a verde (no crea uno nuevo, no queda pegado en amarillo)"() {
        reset();
        // El handler simula lo que _mainSyncGuards().onCloudResult haría tras
        // un MainSyncStore.flush() exitoso: llamar recordCloudResult(true).
        saveOutcomeNotifier.setCloudRetryHandler(() => {
            saveOutcomeNotifier.recordCloudResult(true);
        });
        try {
            driveCloudFailure();
            const toast = Notification.activeNotifications[0];
            testRunner.assertEquals(toast.type, 'warning', 'precondición: arranca amarillo');

            toast.element.querySelector('.notification-action').click();

            testRunner.assertEquals(Notification.activeNotifications.length, 1,
                'debe seguir habiendo UN solo toast — no se apiló uno nuevo');
            testRunner.assertEquals(Notification.activeNotifications[0], toast,
                'debe ser el MISMO objeto Notification, actualizado en sitio');
            testRunner.assertEquals(toast.type, 'success', 'el retry exitoso debe ponerlo en verde');
        } finally { reset(); }
    },

    "el retry fallido deja el MISMO toast en amarillo, con el botón disponible de nuevo"() {
        reset();
        saveOutcomeNotifier.setCloudRetryHandler(() => {
            saveOutcomeNotifier.recordCloudResult(false); // el reintento también falló
        });
        try {
            driveCloudFailure();
            const toast = Notification.activeNotifications[0];

            toast.element.querySelector('.notification-action').click();

            testRunner.assertEquals(toast.type, 'warning', 'sigue amarillo tras un segundo fallo');
            testRunner.assert(!!toast.element.querySelector('.notification-action'),
                'debe poder reintentarse de nuevo');
        } finally { reset(); }
    }

});

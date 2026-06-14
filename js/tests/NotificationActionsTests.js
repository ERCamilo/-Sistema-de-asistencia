/**
 * 🧪 NotificationActionsTests
 *
 * Notification ahora soporta botones de acción (opción `actions`). Se usa para
 * el toast "Nueva versión disponible · Recargar" del Service Worker, que antes
 * solo pedía un F5 manual (index.html). Estos tests fijan el contrato del
 * componente: render del botón, ejecución de onClick, cierre por defecto vs
 * closeOnClick:false, y que sin `actions` no haya regresión.
 */

import { Notification } from '../modules/components/Notification.js';

const cleanup = () => {
    Notification.clearAll();
    document.querySelectorAll('[id^="notification-container-"]').forEach((c) => c.remove());
    Notification.activeNotifications = [];
};

testRunner.addSuite("Notification — botones de acción", {

    "show() renderiza un botón de acción con su etiqueta"() {
        cleanup();
        const n = new Notification({
            message: 'Nueva versión disponible.',
            type: 'info',
            duration: 0,
            actions: [{ label: 'Recargar', onClick: () => {} }]
        }).show();
        const btn = n.element.querySelector('.notification-action');
        testRunner.assert(!!btn, 'debe existir un botón .notification-action');
        testRunner.assertEquals(btn.textContent, 'Recargar', 'la etiqueta debe ser la pasada en la acción');
        cleanup();
    },

    "con icon renderiza el ícono del IconSystem junto a la etiqueta"() {
        cleanup();
        const n = new Notification({
            message: 'Nueva versión disponible.', type: 'info', duration: 0,
            actions: [{ label: 'Recargar', icon: 'sync', onClick: () => {} }]
        }).show();
        const btn = n.element.querySelector('.notification-action');
        const iconEl = btn.querySelector('.notification-action-icon');
        testRunner.assert(!!iconEl, 'debe renderizar .notification-action-icon cuando se pasa icon');
        testRunner.assert(iconEl.innerHTML.trim().length > 0, 'el ícono no debe quedar vacío');
        const labelEl = btn.querySelector('.notification-action-label');
        testRunner.assertEquals(labelEl.textContent, 'Recargar', 'la etiqueta se mantiene junto al ícono');
        cleanup();
    },

    "clic en la acción ejecuta onClick"() {
        cleanup();
        let called = 0;
        const n = new Notification({
            message: 'x', type: 'info', duration: 0,
            actions: [{ label: 'Recargar', onClick: () => { called++; } }]
        }).show();
        n.element.querySelector('.notification-action').click();
        testRunner.assertEquals(called, 1, 'onClick debe ejecutarse una vez');
        cleanup();
    },

    "por defecto la acción cierra la notificación"() {
        cleanup();
        const n = new Notification({
            message: 'x', type: 'info', duration: 0,
            actions: [{ label: 'Recargar', onClick: () => {} }]
        }).show();
        n.element.querySelector('.notification-action').click();
        testRunner.assert(!Notification.activeNotifications.includes(n),
            'tras el clic la notificación debe salir de la lista activa');
        cleanup();
    },

    "closeOnClick:false ejecuta onClick pero NO cierra"() {
        cleanup();
        let called = 0;
        const n = new Notification({
            message: 'x', type: 'info', duration: 0,
            actions: [{ label: 'Mantener', onClick: () => { called++; }, closeOnClick: false }]
        }).show();
        n.element.querySelector('.notification-action').click();
        testRunner.assertEquals(called, 1, 'onClick se ejecuta igual');
        testRunner.assert(Notification.activeNotifications.includes(n),
            'con closeOnClick:false la notificación permanece activa');
        cleanup();
    },

    "sin actions no renderiza botones de acción (no regresión)"() {
        cleanup();
        const n = new Notification({ message: 'x', type: 'info', duration: 0 }).show();
        testRunner.assert(!n.element.querySelector('.notification-action'),
            'sin actions no debe haber botones .notification-action');
        cleanup();
    }

});

/**
 * 🧪 NotificationActionsTests
 *
 * Notification ahora soporta botones de acción (opción `actions`). Se usa para
 * el toast "Nueva versión disponible · Recargar" del Service Worker, que antes
 * solo pedía un F5 manual (index.html). Estos tests fijan el contrato del
 * componente: render del botón, ejecución de onClick, cierre por defecto vs
 * closeOnClick:false, y que sin `actions` no haya regresión.
 */

import fs from 'fs';
import path from 'path';
import { Notification } from '../modules/components/Notification.js';

const INDEX_SRC = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

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

    "la variante update conserva una acción principal y un cierre independiente"() {
        cleanup();
        const n = new Notification({
            message: 'Nueva versión disponible.',
            type: 'info',
            variant: 'update',
            duration: 0,
            updateInfo: {
                appVersion: '1.7.0',
                currentBuild: '24/07/2026 · 6:00 PM',
                availableBuild: '24/07/2026 · 7:00 PM'
            },
            actions: [{ label: 'Actualizar', onClick: () => {} }]
        }).show();
        testRunner.assert(n.element.classList.contains('notification-update'),
            'la notificación de versión recibe su variante visual aislada');
        testRunner.assert(!!n.element.querySelector('.notification-action'),
            'mantiene Recargar como acción principal');
        testRunner.assert(!!n.element.querySelector('.notification-close'),
            'mantiene el cierre como control independiente');
        testRunner.assert(!!n.element.querySelector('.notification-update__disclosure'),
            'la cápsula compacta puede expandirse sin abrir otro modal');
        testRunner.assertEquals(
            n.element.querySelector('[data-update-info=\"available-build\"]').textContent,
            '24/07/2026 · 7:00 PM',
            'muestra la compilación disponible real'
        );
        testRunner.assert(!!n.element.querySelector('.notification-action-icon svg'),
            'Actualizar usa un SVG determinista, no un emoji');
        cleanup();
    },

    "la variante update se expande y conserva los datos bajo demanda"() {
        cleanup();
        const n = new Notification({
            message: 'Nueva versión disponible.',
            type: 'info',
            variant: 'update',
            duration: 0,
            updateInfo: { appVersion: '1.7.0', currentBuild: 'A', availableBuild: 'B' },
            actions: [{ label: 'Actualizar', onClick: () => {} }]
        }).show();
        const disclosure = n.element.querySelector('.notification-update__disclosure');
        disclosure.open = true;
        disclosure.dispatchEvent(new Event('toggle'));
        testRunner.assert(n.element.classList.contains('is-expanded'),
            'el estado abierto amplía la notificación');
        disclosure.open = false;
        disclosure.dispatchEvent(new Event('toggle'));
        testRunner.assert(!n.element.classList.contains('is-expanded'),
            'el estado cerrado vuelve a la cápsula compacta');
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

testRunner.addSuite("Notification — update() acepta options.actions (U11)", {
    // update() YA re-renderizaba this.actions (rebuild de actionsEl + listeners),
    // pero nunca ASIGNABA this.actions desde options.actions — sólo el path del
    // constructor lo hacía. Sin esto, un botón de Reintentar (U12) no puede
    // agregarse a un toast YA existente (p. ej. el spinner que se actualiza a
    // "falló" en el mismo elemento).

    "update({actions}) asigna this.actions y renderiza el botón"() {
        cleanup();
        const n = new Notification({ message: 'Guardando…', type: 'info', duration: 0 }).show();
        testRunner.assert(!n.element.querySelector('.notification-action'),
            'precondición: sin actions al mostrar');

        n.update({ type: 'warning', message: 'Falló', actions: [{ label: 'Reintentar', onClick: () => {} }] });

        const btn = n.element.querySelector('.notification-action');
        testRunner.assert(!!btn, 'update() debe renderizar el botón de acción');
        testRunner.assertEquals(btn.textContent, 'Reintentar');
        cleanup();
    },

    "clic en la acción agregada por update() ejecuta onClick"() {
        cleanup();
        let called = 0;
        const n = new Notification({ message: 'Guardando…', type: 'info', duration: 0 }).show();
        n.update({ type: 'warning', message: 'Falló', actions: [{ label: 'Reintentar', onClick: () => { called++; } }] });

        n.element.querySelector('.notification-action').click();
        testRunner.assertEquals(called, 1, 'onClick debe ejecutarse');
        cleanup();
    },

    "closeOnClick:false en una acción agregada por update() NO cierra la notificación"() {
        cleanup();
        const n = new Notification({ message: 'Guardando…', type: 'info', duration: 0 }).show();
        n.update({
            type: 'warning', message: 'Falló',
            actions: [{ label: 'Reintentar', onClick: () => {}, closeOnClick: false }]
        });

        n.element.querySelector('.notification-action').click();
        testRunner.assert(Notification.activeNotifications.includes(n),
            'con closeOnClick:false debe permanecer activa tras el clic');
        cleanup();
    },

    "update() sin options.actions preserva las actions previas (no regresión)"() {
        cleanup();
        const n = new Notification({
            message: 'x', type: 'info', duration: 0,
            actions: [{ label: 'Reintentar', onClick: () => {} }]
        }).show();

        n.update({ message: 'y' }); // sin tocar actions

        const btn = n.element.querySelector('.notification-action');
        testRunner.assert(!!btn, 'las actions del constructor deben seguir renderizadas tras un update sin actions');
        testRunner.assertEquals(btn.textContent, 'Reintentar');
        cleanup();
    },

    "update({actions:[]}) SÍ reemplaza — vacía las actions previas"() {
        cleanup();
        const n = new Notification({
            message: 'x', type: 'info', duration: 0,
            actions: [{ label: 'Reintentar', onClick: () => {} }]
        }).show();

        n.update({ message: 'confirmado', actions: [] });

        testRunner.assert(!n.element.querySelector('.notification-action'),
            'pasar actions:[] explícitamente debe quitar los botones (p. ej. al confirmar éxito tras un retry)');
        cleanup();
    }
});

testRunner.addSuite("Notification — actualización del Service Worker", {

    "el aviso usa versiones reales y reserva Actualizar para el estado expandido"() {
        testRunner.assert(INDEX_SRC.includes("variant: 'update'"),
            'el Service Worker debe usar la variante compacta');
        testRunner.assert(INDEX_SRC.includes('queryWorkerVersion(newWorker)'),
            'consulta la compilación disponible al worker nuevo');
        testRunner.assert(INDEX_SRC.includes('currentBuild: formatBuild(BUILD).displayLocal'),
            'muestra la compilación instalada con fecha local desde la fuente de verdad');
        testRunner.assert(INDEX_SRC.includes("position: 'top-center'"),
            'centra el aviso para que no compita con los controles laterales');
        testRunner.assert(INDEX_SRC.includes("label: 'Actualizar'"),
            'la acción principal usa el lenguaje acordado');
        testRunner.assert(!INDEX_SRC.includes("label: 'Actualizar', icon:"),
            'la acción no depende de un icono Unicode del registro global');
    }

});

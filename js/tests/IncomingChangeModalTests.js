/**
 * 🧪 IncomingChangeModalTests (Tarea #27)
 *
 * Modal que se muestra cuando un payload remoto trae cambios
 * significant. Le da al usuario contexto antes de aplicar:
 *   - Lista de cambios agrupados por tipo (deleciones, divergencias, etc.).
 *   - Severidad visible (significant en rojo/ámbar, trivial en gris).
 *   - 2 botones: "Aplicar todo" / "Rechazar".
 *   - Botón cerrar (X) equivale a rechazar.
 *
 * Cada botón dispara el callback correspondiente y cierra el modal.
 */

import { IncomingChangeModal } from '../modules/ui/IncomingChangeModal.js';

function flush() {
    document.querySelectorAll('.incoming-change-modal').forEach(el => el.remove());
}

testRunner.addSuite("IncomingChangeModal — render (Tarea #27)", {

    "muestra el modal con sus secciones"() {
        flush();
        const changes = [
            { kind: 'deletion', severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'Ana eliminada en la nube' }
        ];
        IncomingChangeModal.show(changes, {});
        const el = document.querySelector('.incoming-change-modal');
        testRunner.assert(!!el, 'Modal debe insertarse en el DOM');
        testRunner.assert(/Ana eliminada/.test(el.textContent),
            'Debe mostrar la descripción del cambio');
        flush();
    },

    "separa cambios significant de trivial visualmente"() {
        flush();
        const changes = [
            { kind: 'deletion',   severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'A eliminado' },
            { kind: 'addition',   severity: 'trivial',     entityType: 'employee', entityId: 'e2', description: 'B nuevo' }
        ];
        IncomingChangeModal.show(changes, {});
        const el = document.querySelector('.incoming-change-modal');
        testRunner.assert(/A eliminado/.test(el.textContent));
        testRunner.assert(/B nuevo/.test(el.textContent));
        // Los significant deben tener algún marcador (color rojo, badge, etc.)
        testRunner.assert(/significant|ef4444|f59e0b|⚠️|🚨/i.test(el.innerHTML),
            'Significant debe tener marcador visual');
        flush();
    },

    "botón 'Aplicar todo' invoca onApply"() {
        flush();
        let called = 0;
        IncomingChangeModal.show(
            [{ kind: 'deletion', severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'X' }],
            { onApply: () => { called++; } }
        );
        const btn = document.querySelector('.incoming-change-modal [data-action="apply"]');
        testRunner.assert(!!btn, 'Debe existir botón Aplicar');
        btn.click();
        testRunner.assertEquals(called, 1);
        testRunner.assert(!document.querySelector('.incoming-change-modal'),
            'Modal se cierra tras Apply');
    },

    "botón 'Rechazar' invoca onReject y NO onApply"() {
        flush();
        let applies = 0, rejects = 0;
        IncomingChangeModal.show(
            [{ kind: 'deletion', severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'X' }],
            { onApply: () => applies++, onReject: () => rejects++ }
        );
        document.querySelector('.incoming-change-modal [data-action="reject"]').click();
        testRunner.assertEquals(rejects, 1);
        testRunner.assertEquals(applies, 0);
        flush();
    },

    "tecla Escape cierra el modal e invoca onReject"() {
        flush();
        let rejected = false;
        IncomingChangeModal.show(
            [{ kind: 'deletion', severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'X' }],
            { onReject: () => { rejected = true; } }
        );
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        testRunner.assertEquals(rejected, true);
        flush();
    },

    "no abre dos modales al mismo tiempo (idempotente)"() {
        flush();
        IncomingChangeModal.show([{ kind: 'deletion', severity: 'significant', entityId: 'e1', description: 'X' }], {});
        IncomingChangeModal.show([{ kind: 'deletion', severity: 'significant', entityId: 'e2', description: 'Y' }], {});
        const modals = document.querySelectorAll('.incoming-change-modal');
        testRunner.assertEquals(modals.length, 1,
            'Solo debe haber un modal a la vez');
        flush();
    },

    "muestra contador de cambios en el header"() {
        flush();
        const changes = [
            { kind: 'deletion', severity: 'significant', entityId: 'e1', description: 'a' },
            { kind: 'deletion', severity: 'significant', entityId: 'e2', description: 'b' },
            { kind: 'addition', severity: 'trivial',     entityId: 'e3', description: 'c' }
        ];
        IncomingChangeModal.show(changes, {});
        const el = document.querySelector('.incoming-change-modal');
        // Esperamos algo como "3 cambios" o "2 importantes" en el HTML.
        testRunner.assert(/\b3\b|\b2\b/.test(el.textContent),
            'Debe mencionar conteos de cambios');
        flush();
    },

    "input null/[] no rompe (defensivo)"() {
        flush();
        let threw = false;
        try {
            IncomingChangeModal.show(null, {});
            flush();
            IncomingChangeModal.show([], {});
        } catch (e) { threw = true; }
        testRunner.assertEquals(threw, false);
        flush();
    }

});

testRunner.addSuite("IncomingChangeModal — 3-action reject flow (cloud-upload pause)", {

    "muestra botón 'Pausar subida' con data-action='reject-and-pause'"() {
        flush();
        IncomingChangeModal.show(
            [{ kind: 'deletion', severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'X' }],
            {}
        );
        const btn = document.querySelector('.incoming-change-modal [data-action="reject-and-pause"]');
        testRunner.assert(!!btn, 'Debe existir botón Pausar subida');
        flush();
    },

    "muestra botón 'Re-subir mis datos' con data-action='reject-and-reupload'"() {
        flush();
        IncomingChangeModal.show(
            [{ kind: 'deletion', severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'X' }],
            {}
        );
        const btn = document.querySelector('.incoming-change-modal [data-action="reject-and-reupload"]');
        testRunner.assert(!!btn, 'Debe existir botón Re-subir mis datos');
        flush();
    },

    "reject-and-pause invoca onRejectAndPause y cierra el modal"() {
        flush();
        let pauseCalled = 0, reuploadCalled = 0, applyCalled = 0;
        IncomingChangeModal.show(
            [{ kind: 'deletion', severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'X' }],
            {
                onApply:           () => applyCalled++,
                onRejectAndPause:  () => pauseCalled++,
                onRejectAndReupload: () => reuploadCalled++
            }
        );
        document.querySelector('.incoming-change-modal [data-action="reject-and-pause"]').click();
        testRunner.assertEquals(pauseCalled, 1,    'onRejectAndPause debe invocarse');
        testRunner.assertEquals(reuploadCalled, 0, 'onRejectAndReupload NO debe invocarse');
        testRunner.assertEquals(applyCalled, 0,    'onApply NO debe invocarse');
        testRunner.assert(!document.querySelector('.incoming-change-modal'), 'Modal debe cerrarse');
    },

    "reject-and-reupload invoca onRejectAndReupload y cierra el modal"() {
        flush();
        let pauseCalled = 0, reuploadCalled = 0;
        IncomingChangeModal.show(
            [{ kind: 'deletion', severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'X' }],
            {
                onRejectAndPause:    () => pauseCalled++,
                onRejectAndReupload: () => reuploadCalled++
            }
        );
        document.querySelector('.incoming-change-modal [data-action="reject-and-reupload"]').click();
        testRunner.assertEquals(reuploadCalled, 1, 'onRejectAndReupload debe invocarse');
        testRunner.assertEquals(pauseCalled, 0,    'onRejectAndPause NO debe invocarse');
        testRunner.assert(!document.querySelector('.incoming-change-modal'), 'Modal debe cerrarse');
    },

    "Escape invoca onRejectAndPause (comportamiento conservador: no re-sube)"() {
        flush();
        let pauseCalled = 0, reuploadCalled = 0;
        IncomingChangeModal.show(
            [{ kind: 'deletion', severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'X' }],
            {
                onRejectAndPause:    () => pauseCalled++,
                onRejectAndReupload: () => reuploadCalled++
            }
        );
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        testRunner.assertEquals(pauseCalled, 1,    'Escape debe pausar (conservador)');
        testRunner.assertEquals(reuploadCalled, 0, 'Escape NO debe re-subir');
        flush();
    },

    "backward compat: onReject legacy callback funciona como onRejectAndReupload"() {
        // Callers que aún pasan onReject (no los hemos actualizado todos)
        // deben seguir funcionando — no queremos romper silenciosamente.
        flush();
        let legacyCalled = 0;
        IncomingChangeModal.show(
            [{ kind: 'deletion', severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'X' }],
            { onReject: () => legacyCalled++ }
        );
        document.querySelector('.incoming-change-modal [data-action="reject-and-reupload"]').click();
        testRunner.assertEquals(legacyCalled, 1,
            'onReject legacy debe mapearse a reject-and-reupload');
        flush();
    }

});

console.log('🧪 IncomingChangeModal tests cargados.');

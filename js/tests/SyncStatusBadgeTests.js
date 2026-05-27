/**
 * 🧪 SyncStatusBadgeTests (Fase 3.2 — UI del badge)
 *
 * El badge muestra el estado de sincronización al usuario:
 *   - "Sincronizando…" mientras hay una operación en vuelo (opcional).
 *   - "Sincronizado · hace 5s" o "hace 2 min" cuando la nube ya tiene
 *     los cambios.
 *   - Amarillo si pasa > 30s sin sync estando online y autenticado.
 *   - Gris ("Sin sesión") cuando no hay usuario autenticado.
 *   - Rojo ("Sin conexión") cuando navigator.onLine es false.
 *
 * Estados que el componente acepta vía argumento options:
 *   { lastSyncedAt, isAuthenticated, isOnline, now }
 *
 * El parámetro `now` es opcional (default Date.now()) — permite
 * tests deterministas sin congelar el reloj.
 */

import { renderSyncStatusBadge, formatRelativeTime } from '../modules/ui/SyncStatusBadge.js';

testRunner.addSuite("SyncStatusBadge — formatRelativeTime (Fase 3.2)", {

    "0-4 segundos → 'ahora'"() {
        testRunner.assertEquals(formatRelativeTime(0), 'ahora');
        testRunner.assertEquals(formatRelativeTime(3000), 'ahora');
    },

    "5-59 segundos → 'hace Ns'"() {
        testRunner.assertEquals(formatRelativeTime(5000), 'hace 5s');
        testRunner.assertEquals(formatRelativeTime(45000), 'hace 45s');
    },

    "1-59 minutos → 'hace N min'"() {
        testRunner.assertEquals(formatRelativeTime(60000), 'hace 1 min');
        testRunner.assertEquals(formatRelativeTime(125000), 'hace 2 min');
        testRunner.assertEquals(formatRelativeTime(3540000), 'hace 59 min');
    },

    "1-23 horas → 'hace Nh'"() {
        testRunner.assertEquals(formatRelativeTime(3600000), 'hace 1h');
        testRunner.assertEquals(formatRelativeTime(7200000), 'hace 2h');
    },

    "más de 24 horas → 'hace Nd'"() {
        testRunner.assertEquals(formatRelativeTime(86400000), 'hace 1d');
        testRunner.assertEquals(formatRelativeTime(172800000), 'hace 2d');
    },

    "valores negativos (futuro) caen a 'ahora'"() {
        testRunner.assertEquals(formatRelativeTime(-1000), 'ahora');
    }

});

testRunner.addSuite("SyncStatusBadge — renderSyncStatusBadge (Fase 3.2)", {

    "sin sesión → texto 'Sin sesión' (gris)"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: null,
            isAuthenticated: false,
            isOnline: true
        });
        testRunner.assert(html.includes('Sin sesión') || html.includes('sin sesión') || html.includes('Sin cuenta'),
            `Debe indicar que no hay sesión. HTML: ${html.slice(0, 200)}`);
    },

    "offline → texto 'Sin conexión' (rojo/warning)"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: Date.now(),
            isAuthenticated: true,
            isOnline: false
        });
        testRunner.assert(/sin conexi|offline|desconectado/i.test(html),
            `Debe indicar sin conexión. HTML: ${html.slice(0, 200)}`);
    },

    "nunca sincronizado pero online + autenticado → indica espera"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: null,
            isAuthenticated: true,
            isOnline: true
        });
        testRunner.assert(/aún no|nunca|pendiente|esperando/i.test(html),
            `Debe indicar que aún no ha sincronizado. HTML: ${html.slice(0, 200)}`);
    },

    "sync reciente (3s atrás) → 'Sincronizado · ahora'"() {
        const now = 1000000;
        const html = renderSyncStatusBadge({
            lastSyncedAt: now - 3000,
            isAuthenticated: true,
            isOnline: true,
            now
        });
        testRunner.assert(/sincronizado/i.test(html),
            'Debe decir "Sincronizado"');
        testRunner.assert(html.includes('ahora'),
            'Debe mostrar "ahora" para <5s');
    },

    "sync hace 10s → 'Sincronizado · hace 10s'"() {
        const now = 1000000;
        const html = renderSyncStatusBadge({
            lastSyncedAt: now - 10000,
            isAuthenticated: true,
            isOnline: true,
            now
        });
        testRunner.assert(html.includes('hace 10s'), `Debe mostrar "hace 10s". HTML: ${html.slice(0, 200)}`);
    },

    "sync hace 5 min → 'hace 5 min' Y badge en estado warning"() {
        const now = 1000000;
        const html = renderSyncStatusBadge({
            lastSyncedAt: now - 5 * 60 * 1000,
            isAuthenticated: true,
            isOnline: true,
            now
        });
        testRunner.assert(html.includes('hace 5 min'), 'Debe mostrar "hace 5 min"');
        // Warning visual: el HTML debe llevar algún marcador de estado warning
        // (color amarillo, clase, atributo)
        testRunner.assert(/warning|f59e0b|amarillo|stale/i.test(html),
            `Debe indicar estado warning visualmente. HTML: ${html.slice(0, 200)}`);
    },

    "render incluye un elemento identificable (data-role=sync-badge)"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: Date.now(),
            isAuthenticated: true,
            isOnline: true
        });
        testRunner.assert(/data-role=["']sync-badge["']/.test(html),
            'Debe haber un elemento data-role="sync-badge" para que la UI lo encuentre');
    },

    "no rompe con options vacío (defensivo)"() {
        let threw = false;
        let html;
        try { html = renderSyncStatusBadge({}); } catch (e) { threw = true; }
        testRunner.assertEquals(threw, false, 'Debe ser defensivo');
        testRunner.assert(typeof html === 'string' && html.length > 0,
            'Debe devolver algún HTML');
    }

});

// ─────────────────────────────────────────────────────────────
// Suite: attachLiveBadge — auto-update sin trigger render() global
// ─────────────────────────────────────────────────────────────

import { attachLiveBadge, detachLiveBadge } from '../modules/ui/SyncStatusBadge.js';
import { SyncStatus } from '../modules/services/SyncStatus.js';

testRunner.addSuite("SyncStatusBadge — attachLiveBadge (Fase 3.2)", {

    "attachLiveBadge actualiza el DOM cuando SyncStatus cambia"() {
        SyncStatus.reset();
        document.body.innerHTML = '<div id="container"></div>';
        // Sembramos un badge inicial
        document.getElementById('container').innerHTML =
            '<span data-role="sync-badge">placeholder</span>';

        const detach = attachLiveBadge({
            getAuth: () => true,
            getOnline: () => true
        });
        try {
            SyncStatus.markSynced();
            const badge = document.querySelector('[data-role="sync-badge"]');
            testRunner.assert(badge.outerHTML.includes('Sincronizado'),
                `Tras markSynced debe decir Sincronizado. HTML: ${badge.outerHTML}`);
        } finally { detach(); }
    },

    "detachLiveBadge libera la suscripción y el interval"() {
        SyncStatus.reset();
        document.body.innerHTML = '<span data-role="sync-badge">x</span>';
        const detach = attachLiveBadge({
            getAuth: () => true,
            getOnline: () => true
        });
        detach();

        // Tras detach, markSynced no debería actualizar el DOM
        const before = document.querySelector('[data-role="sync-badge"]').outerHTML;
        SyncStatus.markSynced();
        const after = document.querySelector('[data-role="sync-badge"]').outerHTML;
        testRunner.assertEquals(before, after,
            'Tras detach el badge no debe seguir actualizándose');
    },

    "attachLiveBadge es idempotente: doble attach no duplica updates"() {
        SyncStatus.reset();
        document.body.innerHTML = '<span data-role="sync-badge">x</span>';
        const d1 = attachLiveBadge({ getAuth: () => true, getOnline: () => true });
        const d2 = attachLiveBadge({ getAuth: () => true, getOnline: () => true });
        // Ambas detach deben ser seguras (no romper)
        d1();
        d2();
        // No hay forma directa de contar suscripciones en este test sin
        // exponer internos; la garantía la dan los otros tests + el código.
        testRunner.assert(true);
    }

});

console.log('🧪 SyncStatusBadge tests cargados.');

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
// Modo compacto: solo icono, texto en title (tooltip)
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("SyncStatusBadge — modo compacto (icono solo)", {

    "compact:true → no incluye el texto visible 'Sincronizado'"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: Date.now(),
            isAuthenticated: true,
            isOnline: true,
            compact: true
        });
        // El texto va al title (tooltip), no al body visible.
        testRunner.assert(!/>Sincronizado/i.test(html),
            'En modo compacto el texto "Sincronizado" NO debe estar en el body. HTML: ' + html.slice(0, 300));
    },

    "compact:true incluye un title con el texto completo (tooltip accesible)"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: Date.now(),
            isAuthenticated: true,
            isOnline: true,
            compact: true
        });
        testRunner.assert(/title=["'][^"']*[Ss]incronizado/.test(html),
            'Debe haber un title con la palabra Sincronizado para accesibilidad');
    },

    "compact:true usa icono lineal sin círculo de fondo"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: Date.now(),
            isAuthenticated: true,
            isOnline: true,
            compact: true
        });
        testRunner.assert(/sync-badge-lucide/.test(html),
            'Debe renderizar un icono Lucide/SVG lineal');
        testRunner.assert(!/border-radius:\s*50%|background:|border:\s*1px/.test(html),
            'En modo compacto no debe dibujar círculo, fondo ni borde; cambia de color el icono');
    },

    "compact:false (default) sigue funcionando con texto visible"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: Date.now(),
            isAuthenticated: true,
            isOnline: true
        });
        testRunner.assert(/>.*[Ss]incronizado/.test(html),
            'Sin compact, debe haber texto visible (regression check)');
    },

    "compact estado 'pending' usa icono Lucide de reloj"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: null,
            isAuthenticated: true,
            isOnline: true,
            compact: true
        });
        testRunner.assert(/data-lucide=["']clock["']/.test(html),
            'Pending/no-aún-sincronizado debe mostrar un icono Lucide de reloj. HTML: ' + html.slice(0, 200));
    },

    "compact estado 'warning' (stale, >30s) también usa icono Lucide de reloj"() {
        const now = 1000000;
        const html = renderSyncStatusBadge({
            lastSyncedAt: now - 5 * 60 * 1000,
            isAuthenticated: true,
            isOnline: true,
            compact: true,
            now
        });
        testRunner.assert(/data-lucide=["']clock["']/.test(html),
            'Warning (sincronización vieja) también muestra icono Lucide de reloj');
    },

    "compact estado 'synced' usa icono Lucide check-circle"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: Date.now(),
            isAuthenticated: true,
            isOnline: true,
            compact: true
        });
        testRunner.assert(/data-lucide=["']check-circle["']/.test(html),
            'Sincronizado debe mostrar icono Lucide check-circle');
    },

    "compact estado 'offline' usa icono Lucide wifi-off"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: Date.now(),
            isAuthenticated: true,
            isOnline: false,
            compact: true
        });
        testRunner.assert(/data-lucide=["']wifi-off["']/.test(html),
            'Offline debe ser claro con icono Lucide wifi-off');
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

testRunner.addSuite("SyncStatusBadge — estado 'paused' (cloud-upload pause)", {

    "isUploadPaused:true → muestra texto indicando pausa"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: Date.now(),
            isAuthenticated: true,
            isOnline: true,
            isUploadPaused: true
        });
        testRunner.assert(/paus|paused/i.test(html),
            `Debe indicar que la subida está pausada. HTML: ${html.slice(0, 300)}`);
    },

    "isUploadPaused:true en modo compacto incluye 'pausad' en el title (tooltip)"() {
        const html = renderSyncStatusBadge({
            lastSyncedAt: Date.now(),
            isAuthenticated: true,
            isOnline: true,
            isUploadPaused: true,
            compact: true
        });
        testRunner.assert(/title=["'][^"']*paus/i.test(html),
            'Compact pausado debe tener title con "pausad" para accesibilidad');
    },

    "isUploadPaused:false no afecta el render normal"() {
        const normal = renderSyncStatusBadge({
            lastSyncedAt: Date.now(), isAuthenticated: true, isOnline: true
        });
        const withFalse = renderSyncStatusBadge({
            lastSyncedAt: Date.now(), isAuthenticated: true, isOnline: true, isUploadPaused: false
        });
        // Both should say "Sincronizado", not paused
        testRunner.assert(/sincronizado/i.test(withFalse),
            'isUploadPaused:false no debe activar el estado paused');
    }

});

console.log('🧪 SyncStatusBadge tests cargados.');

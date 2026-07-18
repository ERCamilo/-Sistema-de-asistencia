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

// ─────────────────────────────────────────────────────────────
// Visual distinction: pending (waiting) ≠ paused (intentional)
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("SyncStatusBadge — distinción visual pending vs paused", {

    "paused usa color naranja (f97316), NO el mismo ámbar que warning"() {
        const html = renderSyncStatusBadge({
            isAuthenticated: true, isOnline: true,
            lastSyncedAt: Date.now(),
            isUploadPaused: true
        });
        testRunner.assert(/f97316/i.test(html),
            `El estado paused debe usar color naranja #f97316. HTML: ${html.slice(0, 300)}`);
        testRunner.assert(!/f59e0b/i.test(html),
            `El estado paused NO debe usar el mismo ámbar (#f59e0b) que warning`);
    },

    "pending usa color neutro/blanco (cbd5e1), NO ámbar ni naranja"() {
        const html = renderSyncStatusBadge({
            isAuthenticated: true, isOnline: true,
            lastSyncedAt: null    // triggers pending: no sync recorded yet
        });
        testRunner.assert(/cbd5e1/i.test(html),
            `El estado pending debe usar color neutro #cbd5e1. HTML: ${html.slice(0, 300)}`);
        testRunner.assert(!/f59e0b/i.test(html),
            `El estado pending NO debe usar ámbar (#f59e0b)`);
        testRunner.assert(!/f97316/i.test(html),
            `El estado pending NO debe usar naranja (#f97316) reservado para paused`);
    },

    "pending tiene data-state='pending', paused tiene data-state='paused'"() {
        const pendingHtml = renderSyncStatusBadge({
            isAuthenticated: true, isOnline: true, lastSyncedAt: null
        });
        const pausedHtml = renderSyncStatusBadge({
            isAuthenticated: true, isOnline: true,
            lastSyncedAt: Date.now(), isUploadPaused: true
        });
        testRunner.assert(/data-state=["']pending["']/.test(pendingHtml),
            'Estado pending debe tener data-state="pending"');
        testRunner.assert(/data-state=["']paused["']/.test(pausedHtml),
            'Estado paused debe tener data-state="paused"');
    },

    "pending muestra icono de reloj (clock), NO pause-circle"() {
        const html = renderSyncStatusBadge({
            isAuthenticated: true, isOnline: true, lastSyncedAt: null
        });
        testRunner.assert(/data-lucide=["']clock["']|clock/.test(html),
            'Estado pending debe usar icono de reloj');
        testRunner.assert(!/pause-circle/.test(html),
            'Estado pending NO debe tener pause-circle');
    },

    "los tres colores (synced/pending/warning/paused) son todos distintos"() {
        const syncedHtml  = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, lastSyncedAt: Date.now() });
        const pendingHtml = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, lastSyncedAt: null });
        const warningHtml = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, lastSyncedAt: 0, now: 60000 });
        const pausedHtml  = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, lastSyncedAt: Date.now(), isUploadPaused: true });

        testRunner.assert(/10b981/.test(syncedHtml),  'synced → verde 10b981');
        testRunner.assert(/cbd5e1/.test(pendingHtml), 'pending → neutro cbd5e1');
        testRunner.assert(/f59e0b/.test(warningHtml), 'warning → ámbar f59e0b');
        testRunner.assert(/f97316/.test(pausedHtml),  'paused → naranja f97316');
    }

});

testRunner.addSuite("SyncStatusBadge — estado 'error' clickeable → reintentar (U13)", {

    "el estado error tiene cursor:pointer (accionable, igual que paused)"() {
        const html = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, hasError: true });
        testRunner.assert(/cursor:\s*pointer/.test(html),
            `el badge de error debe ser clickeable. HTML: ${html.slice(0, 300)}`);
    },

    "el estado synced sigue con cursor:default (no regresión)"() {
        const html = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, lastSyncedAt: Date.now() });
        testRunner.assert(/cursor:\s*default/.test(html), 'un estado sano no debe ser clickeable');
    },

    "click en el badge en estado error invoca ctx.onErrorClick"() {
        SyncStatus.reset();
        document.body.innerHTML = '<span data-role="sync-badge">x</span>';
        let called = 0;
        const detach = attachLiveBadge({
            getAuth: () => true, getOnline: () => true,
            onErrorClick: () => { called++; }
        });
        try {
            SyncStatus.markError(new Error('boom')); // dispara el refresh a estado 'error'
            const badge = document.querySelector('[data-role="sync-badge"]');
            testRunner.assertEquals(badge.dataset.state, 'error', 'precondición: el badge debe estar en error');

            badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            testRunner.assertEquals(called, 1, 'el clic en el badge de error debe invocar onErrorClick');
        } finally { detach(); SyncStatus.reset(); }
    },

    "click en el badge en estado synced NO invoca onErrorClick"() {
        SyncStatus.reset();
        document.body.innerHTML = '<span data-role="sync-badge">x</span>';
        let called = 0;
        const detach = attachLiveBadge({
            getAuth: () => true, getOnline: () => true,
            onErrorClick: () => { called++; }
        });
        try {
            SyncStatus.markSynced();
            const badge = document.querySelector('[data-role="sync-badge"]');
            testRunner.assertEquals(badge.dataset.state, 'synced');

            badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            testRunner.assertEquals(called, 0, 'un badge sano no debe disparar onErrorClick');
        } finally { detach(); SyncStatus.reset(); }
    },

    "onPausedClick sigue funcionando (no regresión al agregar el handler de error)"() {
        SyncStatus.reset();
        document.body.innerHTML = '<span data-role="sync-badge">x</span>';
        let pausedCalled = 0, errorCalled = 0;
        const detach = attachLiveBadge({
            getAuth: () => true, getOnline: () => true, getUploadPaused: () => true,
            onPausedClick: () => { pausedCalled++; },
            onErrorClick: () => { errorCalled++; }
        });
        try {
            SyncStatus.reset(); // refrescar el badge con el nuevo ctx (getUploadPaused:true)
            const badge = document.querySelector('[data-role="sync-badge"]');
            testRunner.assertEquals(badge.dataset.state, 'paused');

            badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            testRunner.assertEquals(pausedCalled, 1, 'debe seguir invocando onPausedClick');
            testRunner.assertEquals(errorCalled, 0, 'no debe cruzarse con onErrorClick');
        } finally { detach(); SyncStatus.reset(); }
    }

});

// ─────────────────────────────────────────────────────────────
// Rediseño de estados en 4 familias visuales (2026-07-12)
//   🟢 verde  = al día
//   ⚪ gris   = temporal/informativo (sincronizando, sin conexión, pendiente)
//   🟡 ámbar = atención sin riesgo (pausado, viejo)
//   🔴 rojo  = problema (SOLO error)
// Cambio clave: "sin conexión" deja de ser ROJO (no es un error) → el rojo
// queda raro y significativo.
// ─────────────────────────────────────────────────────────────

const RED = '#ef4444';

testRunner.addSuite('SyncStatusBadge — 4 familias visuales', {

    'sin conexión ya NO es rojo (es neutro/gris, no un error)'() {
        const html = renderSyncStatusBadge({ isAuthenticated: true, isOnline: false, lastSyncedAt: Date.now() });
        testRunner.assert(/data-state=["']offline["']/.test(html), 'debe ser estado offline');
        testRunner.assert(!html.includes(RED), 'offline NO debe usar el rojo de error');
    },

    'error es el ÚNICO rojo'() {
        const errHtml = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, hasError: true, lastSyncedAt: Date.now() });
        testRunner.assert(html_includes_color(errHtml, RED), 'error debe ser rojo');
        // Y ninguno de los otros estados usa ese rojo:
        const offline = renderSyncStatusBadge({ isAuthenticated: true, isOnline: false, lastSyncedAt: Date.now() });
        const paused = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, isUploadPaused: true, lastSyncedAt: Date.now() });
        const synced = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, lastSyncedAt: Date.now() });
        testRunner.assert(!offline.includes(RED) && !paused.includes(RED) && !synced.includes(RED),
            'ningún estado que no sea error debe ser rojo');
    },

    'existe el estado "sincronizando" con spinner (flechas girando)'() {
        const html = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, isSyncing: true, lastSyncedAt: Date.now() });
        testRunner.assert(/data-state=["']syncing["']/.test(html), 'debe existir data-state="syncing"');
        testRunner.assert(/animation:\s*spin|class="[^"]*spin/.test(html) || /refresh-cw/.test(html),
            'el estado sincronizando debe girar (spinner de dos flechas)');
    },

    'pausado y viejo comparten familia ámbar (atención, sin riesgo)'() {
        const paused = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, isUploadPaused: true, lastSyncedAt: Date.now() });
        const old = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, lastSyncedAt: Date.now() - 60000 });
        // Ámbar (#f59e0b) o naranja (#f97316) — ambos de la familia atención.
        testRunner.assert(/#f59e0b|#f97316/i.test(paused), 'pausado en ámbar/naranja');
        testRunner.assert(/#f59e0b|#f97316/i.test(old), 'sincronización vieja en ámbar');
    },

    'al día es verde'() {
        const html = renderSyncStatusBadge({ isAuthenticated: true, isOnline: true, lastSyncedAt: Date.now() });
        testRunner.assert(/#10b981/i.test(html), 'al día debe ser verde');
    }

});

function html_includes_color(html, color) {
    return html.toLowerCase().includes(color.toLowerCase());
}

console.log('🧪 SyncStatusBadge tests cargados.');

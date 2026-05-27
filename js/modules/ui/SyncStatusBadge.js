/**
 * 🟢 SyncStatusBadge.js (Fase 3.2)
 *
 * Badge visible que informa al usuario el estado de sincronización:
 *   - "Sincronizado · ahora"           ← verde, sync exitosa <5s
 *   - "Sincronizado · hace 12s"        ← verde, <30s
 *   - "Sincronizado · hace 2 min"      ← amarillo (warning), >30s
 *   - "Aún no sincronizado"            ← gris, autenticado pero null
 *   - "Sin sesión"                     ← gris, sin auth
 *   - "Sin conexión"                   ← rojo, navigator.onLine === false
 *
 * Diseño: función pura que recibe estado actual y devuelve HTML. El
 * caller (Header / cualquier componente) decide cuándo re-renderizar
 * suscribiéndose a SyncStatus + listeners de online/offline.
 */

// Umbrales (ms)
const WARN_THRESHOLD_MS = 30 * 1000; // >30s sin sync → warning

// Re-export para no romper imports existentes; la implementación canónica
// vive en utils/RelativeTime.js para que pueda reusarse en el ledger y
// en el perfil del empleado sin acoplarse a este componente.
export { formatRelativeTime } from '../utils/RelativeTime.js';
import { formatRelativeTime } from '../utils/RelativeTime.js';

// Iconos por estado. El user pidió consolidar:
//   - 🕒 cuando aún no está totalmente sincronizado (pending O warning).
//   - ❌ si no se pudo sincronizar / error.
//   - ✅ cuando está totalmente sincronizado.
// Plus offline (🔌) y noauth (👤) que son condiciones distintas.
const STATES = {
    synced:    { color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)',  icon: '✅' },
    warning:   { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)',  icon: '🕒' },
    offline:   { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)',   icon: '🔌' },
    error:     { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)',   icon: '❌' },
    noauth:    { color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.1)', icon: '👤' },
    pending:   { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)',  icon: '🕒' }
};

function badgeHtml(state, text, extraAttr = '', compact = false) {
    const s = STATES[state] || STATES.pending;

    if (compact) {
        // Modo icono-solo: el texto va al title (tooltip). Más discreto,
        // todo el estado lo comunica el ícono + color.
        // Escapar comillas dobles del texto en el title.
        const safeTitle = String(text || '').replace(/"/g, '&quot;');
        return `
            <span data-role="sync-badge" data-state="${state}"
                  title="${safeTitle}" aria-label="${safeTitle}"
                  ${extraAttr}
                  style="display: inline-flex; align-items: center; justify-content: center;
                         width: 28px; height: 28px;
                         background: ${s.bg}; color: ${s.color}; border: 1px solid ${s.color};
                         border-radius: 50%; font-size: 0.95rem; line-height: 1;
                         cursor: default;">
                ${s.icon}
            </span>
        `;
    }

    return `
        <span data-role="sync-badge" data-state="${state}" ${extraAttr}
              style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
                     background: ${s.bg}; color: ${s.color}; border: 1px solid ${s.color};
                     border-radius: 12px; font-size: 0.72rem; font-weight: 700;
                     white-space: nowrap; line-height: 1.2;">
            <span style="font-size: 0.85rem; line-height: 1;">${s.icon}</span>
            <span>${text}</span>
        </span>
    `;
}

/**
 * @param {object} opts
 * @param {number|null} [opts.lastSyncedAt] Timestamp ms o null.
 * @param {boolean} [opts.isAuthenticated]  ¿Hay usuario logueado?
 * @param {boolean} [opts.isOnline]         ¿Hay conexión a Internet?
 * @param {boolean} [opts.compact]          Si true, renderiza solo el icono
 *                                          y pone el texto en el `title`
 *                                          (tooltip). Útil para headers densos.
 * @param {number}  [opts.now]              Override para tests (default Date.now()).
 * @returns {string} HTML del badge.
 */
export function renderSyncStatusBadge(opts = {}) {
    const isAuthenticated = !!opts.isAuthenticated;
    const isOnline = opts.isOnline !== false; // default true
    const lastSyncedAt = (typeof opts.lastSyncedAt === 'number' && Number.isFinite(opts.lastSyncedAt))
        ? opts.lastSyncedAt
        : null;
    const now = (typeof opts.now === 'number') ? opts.now : Date.now();
    const compact = !!opts.compact;

    // 1. Sin conexión: prioritario sobre todo.
    if (!isOnline) {
        return badgeHtml('offline', 'Sin conexión', '', compact);
    }

    // 2. Sin sesión.
    if (!isAuthenticated) {
        return badgeHtml('noauth', 'Sin sesión', '', compact);
    }

    // 3. Autenticado pero nunca ha sincronizado.
    if (lastSyncedAt === null) {
        return badgeHtml('pending', 'Aún no sincronizado', '', compact);
    }

    // 4. Sincronizado: verde si <30s, amarillo (reloj) si más viejo.
    const elapsed = Math.max(0, now - lastSyncedAt);
    const relative = formatRelativeTime(elapsed);
    if (elapsed > WARN_THRESHOLD_MS) {
        const extra = compact ? '' : 'title="Sincronización vieja — revisar conexión"';
        return badgeHtml('warning', `Sincronizado · ${relative}`, extra, compact);
    }
    return badgeHtml('synced', `Sincronizado · ${relative}`, '', compact);
}

// ─── Live updater ────────────────────────────────────────────────────────────
//
// Mantiene actualizado todos los elementos con data-role="sync-badge" en el
// DOM sin necesidad de triggerear un render() global. Es liviano: solo
// re-renderiza el badge cuando SyncStatus cambia O cuando pasa el intervalo
// (para que el texto relativo "hace 5s" → "hace 6s" se mantenga vivo).

import { SyncStatus } from '../services/SyncStatus.js';

let _activeUnsubscribe = null;
let _activeInterval = null;
const UPDATE_INTERVAL_MS = 5000;

function _refreshAllBadges({ getAuth, getOnline, compact }) {
    if (typeof document === 'undefined') return;
    const badges = document.querySelectorAll('[data-role="sync-badge"]');
    if (badges.length === 0) return;
    const baseOpts = {
        lastSyncedAt: SyncStatus.getLastSyncedAt(),
        isAuthenticated: !!(getAuth ? getAuth() : false),
        isOnline: !!(getOnline ? getOnline() : true)
    };
    badges.forEach(el => {
        // Detectar si el badge existente está en modo compacto leyendo
        // su tamaño/estructura: si tiene title= y no tiene texto hijo,
        // asumimos compact. El flag global compact:true del attach
        // tiene prioridad cuando se setea.
        const isCompact = compact !== undefined
            ? !!compact
            : !el.textContent.trim() || el.textContent.trim().length < 3;
        const html = renderSyncStatusBadge({ ...baseOpts, compact: isCompact });
        // Reemplazamos outerHTML para que el nuevo badge tenga el data-role.
        el.outerHTML = html;
    });
}

/**
 * Conecta el badge al estado: se redibuja al cambiar SyncStatus o cada 5s
 * para mantener el texto relativo fresco. Devuelve un detach.
 *
 * @param {object} args
 * @param {() => boolean} [args.getAuth]   Lee si hay sesión.
 * @param {() => boolean} [args.getOnline] Lee si hay conexión.
 * @returns {() => void} detach
 */
export function attachLiveBadge(args = {}) {
    // Idempotente: si ya hay uno, sustituye limpiamente.
    detachLiveBadge();

    const ctx = args;
    _activeUnsubscribe = SyncStatus.subscribe(() => _refreshAllBadges(ctx));
    if (typeof setInterval !== 'undefined') {
        _activeInterval = setInterval(() => _refreshAllBadges(ctx), UPDATE_INTERVAL_MS);
    }

    // Refresh inicial.
    _refreshAllBadges(ctx);

    return detachLiveBadge;
}

export function detachLiveBadge() {
    if (typeof _activeUnsubscribe === 'function') {
        try { _activeUnsubscribe(); } catch (_) {}
    }
    _activeUnsubscribe = null;
    if (_activeInterval) {
        try { clearInterval(_activeInterval); } catch (_) {}
    }
    _activeInterval = null;
}

export default renderSyncStatusBadge;

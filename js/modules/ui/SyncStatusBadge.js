/**
 * SyncStatusBadge.js
 *
 * Badge visible que informa el estado de sincronización.
 */

const WARN_THRESHOLD_MS = 30 * 1000;

export { formatRelativeTime } from '../utils/RelativeTime.js';
import { formatRelativeTime } from '../utils/RelativeTime.js';
import { SyncStatus } from '../services/SyncStatus.js';

// 🎨 4 familias visuales (2026-07-12):
//   🟢 verde  synced          = al día
//   ⚪ gris   syncing/pending/offline = temporal o informativo (sin riesgo)
//   🟡 ámbar  warning/paused   = atención, sin peligro de datos
//   🔴 rojo   error            = problema real (ÚNICO rojo → raro y significativo)
const NEUTRAL = '#94a3b8';
const STATES = {
    synced:  { color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)',   icon: 'check-circle' },
    // Sincronización EN CURSO — neutro/cian con spinner de dos flechas.
    syncing: { color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)',    icon: 'refresh-cw', spin: true },
    // Espera normal entre syncs — neutro (slate claro), no alarmante.
    pending: { color: '#cbd5e1', bg: 'rgba(203, 213, 225, 0.08)', icon: 'clock' },
    // Sincronización vieja (> umbral) — ámbar, vale notarlo.
    warning: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)',   icon: 'clock' },
    // Sin conexión NO es un error: neutro/gris. Tus datos están seguros acá.
    offline: { color: NEUTRAL,   bg: 'rgba(148, 163, 184, 0.1)',  icon: 'wifi-off' },
    // El ÚNICO rojo: un problema real que quizás quieras reintentar.
    error:   { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)',    icon: 'x-circle' },
    noauth:  { color: NEUTRAL,   bg: 'rgba(148, 163, 184, 0.1)',  icon: 'user' },
    // Pausa deliberada del usuario — naranja (familia atención).
    paused:  { color: '#f97316', bg: 'rgba(249, 115, 22, 0.12)',  icon: 'pause-circle' }
};

const LUCIDE_PATHS = {
    'check-circle':  '<path d="M21.8 10.9a10 10 0 1 1-5.9-8.9"/><path d="m9 11 3 3L22 4"/>',
    clock:           '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    'refresh-cw':    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'wifi-off':      '<path d="m2 2 20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.8a15 15 0 0 1 5.2-3.1"/><path d="M12 20h.01"/><path d="M17 5.6a15 15 0 0 1 5 3.2"/><path d="M5 12.5a10 10 0 0 1 5.5-2.4"/>',
    'x-circle':      '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    user:            '<path d="M19 21a7 7 0 0 0-14 0"/><circle cx="12" cy="7" r="4"/>',
    'pause-circle':  '<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>'
};

function lucideIcon(name, color, size = 20) {
    if (typeof window !== 'undefined' && window.lucide?.icons?.[name]) {
        return window.lucide.icons[name].toSvg({
            class: 'sync-badge-lucide',
            width: size,
            height: size,
            style: `color:${color};`,
            'stroke-width': 2
        });
    }

    return `
        <svg class="sync-badge-lucide" data-lucide="${name}" xmlns="http://www.w3.org/2000/svg"
             width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             style="color:${color};">
            ${LUCIDE_PATHS[name] || LUCIDE_PATHS.clock}
        </svg>
    `;
}

function badgeHtml(state, text, extraAttr = '', compact = false) {
    const s = STATES[state] || STATES.pending;
    let icon = lucideIcon(s.icon, s.color, compact ? 21 : 15);
    // El estado "sincronizando" gira (spinner de dos flechas). Reusa el
    // @keyframes spin global (styles.css).
    if (s.spin) {
        icon = `<span style="display:inline-flex; animation: spin 1s linear infinite;">${icon}</span>`;
    }
    // El badge es clickeable en el header (tocar = Sincronizar ahora), pero el
    // cursor lo define el wrapper del header; acá default salvo error/paused
    // por retrocompatibilidad de los tests de contrato visual.
    const cursor = (state === 'paused' || state === 'error') ? 'pointer' : 'default';

    if (compact) {
        const safeTitle = String(text || '').replace(/"/g, '&quot;');
        return `
            <span data-role="sync-badge" data-state="${state}"
                  title="${safeTitle}" aria-label="${safeTitle}"
                  ${extraAttr}
                  style="display: inline-flex; align-items: center; justify-content: center;
                         width: 28px; height: 28px; color: ${s.color}; line-height: 1;
                         cursor: ${cursor};">
                ${icon}
            </span>
        `;
    }

    return `
        <span data-role="sync-badge" data-state="${state}" ${extraAttr}
              style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
                     background: ${s.bg}; color: ${s.color}; border: 1px solid ${s.color};
                     border-radius: 12px; font-size: 0.72rem; font-weight: 700;
                     white-space: nowrap; line-height: 1.2; cursor: ${cursor};">
            <span style="display:inline-flex;line-height:1;">${icon}</span>
            <span>${text}</span>
        </span>
    `;
}

export function renderSyncStatusBadge(opts = {}) {
    const isAuthenticated = !!opts.isAuthenticated;
    const isOnline = opts.isOnline !== false;
    const isUploadPaused = !!opts.isUploadPaused;
    const hasError = !!opts.hasError;
    const isSyncing = !!opts.isSyncing;
    const lastSyncedAt = (typeof opts.lastSyncedAt === 'number' && Number.isFinite(opts.lastSyncedAt))
        ? opts.lastSyncedAt
        : null;
    const now = (typeof opts.now === 'number') ? opts.now : Date.now();
    const compact = !!opts.compact;

    if (!isOnline) {
        return badgeHtml('offline', 'Sin conexión', '', compact);
    }

    if (!isAuthenticated) {
        return badgeHtml('noauth', 'Sin sesión', '', compact);
    }

    // Sincronización EN CURSO → spinner (prioridad alta: es transitorio y
    // refleja la acción del usuario al tocar el badge).
    if (isSyncing) {
        const extra = 'title="Sincronizando con la nube…"';
        return badgeHtml('syncing', 'Sincronizando…', extra, compact);
    }

    // Paused state: shown regardless of last sync time when upload is paused.
    if (isUploadPaused) {
        const pausedText = 'Sync pausado';
        const extra = compact
            ? `title="${pausedText} — haz clic en Reanudar para volver a subir"`
            : 'title="Subida a la nube pausada. Tus datos locales están seguros."';
        return badgeHtml('paused', pausedText, extra, compact);
    }

    if (hasError) {
        const extra = compact ? 'title="Error al sincronizar con la nube"'
            : 'title="No se pudo guardar en la nube. Tus datos locales están seguros."';
        return badgeHtml('error', 'Error de sync', extra, compact);
    }

    if (lastSyncedAt === null) {
        return badgeHtml('pending', 'Aún no sincronizado', '', compact);
    }

    const elapsed = Math.max(0, now - lastSyncedAt);
    const relative = formatRelativeTime(elapsed);
    if (elapsed > WARN_THRESHOLD_MS) {
        const extra = compact ? '' : 'title="Sincronización vieja - revisar conexión"';
        return badgeHtml('warning', `Sincronizado · ${relative}`, extra, compact);
    }
    return badgeHtml('synced', `Sincronizado · ${relative}`, '', compact);
}

let _activeUnsubscribe = null;
let _activeInterval = null;
let _activeClickHandler = null;
const UPDATE_INTERVAL_MS = 5000;

function _refreshAllBadges({ getAuth, getOnline, getUploadPaused, compact }) {
    if (typeof document === 'undefined') return;
    const badges = document.querySelectorAll('[data-role="sync-badge"]');
    if (badges.length === 0) return;
    const baseOpts = {
        lastSyncedAt:    SyncStatus.getLastSyncedAt(),
        hasError:        SyncStatus.hasError(),
        isSyncing:       typeof SyncStatus.isSyncing === 'function' ? SyncStatus.isSyncing() : false,
        isAuthenticated: !!(getAuth ? getAuth() : false),
        isOnline:        !!(getOnline ? getOnline() : true),
        isUploadPaused:  !!(getUploadPaused ? getUploadPaused() : false)
    };
    badges.forEach(el => {
        const isCompact = compact !== undefined
            ? !!compact
            : !el.textContent.trim() || el.textContent.trim().length < 3;
        const html = renderSyncStatusBadge({ ...baseOpts, compact: isCompact });
        el.outerHTML = html;
    });
}

export function attachLiveBadge(args = {}) {
    detachLiveBadge();

    const ctx = args;
    _activeUnsubscribe = SyncStatus.subscribe(() => _refreshAllBadges(ctx));
    if (typeof setInterval !== 'undefined') {
        _activeInterval = setInterval(() => _refreshAllBadges(ctx), UPDATE_INTERVAL_MS);
    }

    // Click delegation: 'paused' (click → resume) y 'error' (click → reintentar,
    // U13) son los estados accionables. Delegación por evento para sobrevivir
    // al re-render periódico del badge (outerHTML lo reemplaza cada 5s).
    const hasPausedHandler = typeof ctx.onPausedClick === 'function';
    const hasErrorHandler = typeof ctx.onErrorClick === 'function';
    if (typeof document !== 'undefined' && (hasPausedHandler || hasErrorHandler)) {
        _activeClickHandler = (e) => {
            if (hasPausedHandler) {
                const pausedBadge = e.target.closest && e.target.closest('[data-role="sync-badge"][data-state="paused"]');
                if (pausedBadge) {
                    e.preventDefault();
                    try { ctx.onPausedClick(); }
                    catch (err) { console.error('Error en onPausedClick del badge:', err); }
                    return;
                }
            }
            if (hasErrorHandler) {
                const errorBadge = e.target.closest && e.target.closest('[data-role="sync-badge"][data-state="error"]');
                if (errorBadge) {
                    e.preventDefault();
                    try { ctx.onErrorClick(); }
                    catch (err) { console.error('Error en onErrorClick del badge:', err); }
                }
            }
        };
        document.addEventListener('click', _activeClickHandler);
    }

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
    if (_activeClickHandler && typeof document !== 'undefined') {
        try { document.removeEventListener('click', _activeClickHandler); } catch (_) {}
    }
    _activeClickHandler = null;
}

export default renderSyncStatusBadge;

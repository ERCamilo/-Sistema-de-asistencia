/**
 * ⏱️ RelativeTime.js
 * Función pura para formatear timestamps como "hace Xs", "hace X min", etc.
 * Compartida entre SyncStatusBadge y la nueva sección de "Último cambio"
 * en préstamos / empleados.
 */

/**
 * @param {number} elapsedMs Milisegundos transcurridos desde el evento.
 * @returns {string} "ahora", "hace 5s", "hace 2 min", "hace 1h", "hace 3d"
 */
export function formatRelativeTime(elapsedMs) {
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 5000) {
        return 'ahora';
    }
    const s = Math.floor(elapsedMs / 1000);
    if (s < 60)    return `hace ${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)    return `hace ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24)    return `hace ${h}h`;
    const d = Math.floor(h / 24);
    return `hace ${d}d`;
}

/**
 * Variante conveniente para timestamps absolutos (ms epoch).
 * @param {number|null|undefined} timestamp
 * @param {number} [now] Override opcional (tests).
 * @returns {string} "—" si no hay timestamp, sino "hace Xs".
 */
export function formatTimeSince(timestamp, now) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '—';
    const ref = typeof now === 'number' ? now : Date.now();
    return formatRelativeTime(Math.max(0, ref - timestamp));
}

export default formatRelativeTime;

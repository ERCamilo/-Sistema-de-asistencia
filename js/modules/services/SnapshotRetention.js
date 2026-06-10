/**
 * 🧹 SnapshotRetention.js (Auditoría 2026-06-09, hallazgo M5)
 *
 * Política de retención PURA para snapshots. Decide qué snapshots AUTOMÁTICOS
 * antiguos borrar, conservando los N más recientes por razón. No toca
 * Firestore/Storage — sólo devuelve los ids a eliminar; el efecto lo aplica
 * FirebaseService.pruneOldSnapshots(). Así es 100% testeable.
 *
 * Garantías de seguridad:
 *   - NUNCA selecciona protegidos (isProtected) ni 'pre-restore'.
 *   - NUNCA selecciona manuales (los crea el usuario a propósito).
 *   - Sólo poda automáticos (type === 'auto'), agrupados por razón.
 */

/** Tope por defecto de snapshots automáticos a conservar por razón. */
export const DEFAULT_KEEP_PER_AUTO_REASON = 14;

/**
 * @param {Array<{id, type, reason?, timestamp?, isProtected?}>} snapshots
 * @param {object} [opts]
 * @param {object} [opts.keep] mapa razón → cantidad a conservar
 * @param {number} [opts.defaultKeep] tope para razones no listadas
 * @returns {string[]} ids de snapshots a eliminar (los más antiguos sobrantes)
 */
export function selectSnapshotsToPrune(snapshots, opts = {}) {
    if (!Array.isArray(snapshots)) return [];

    const keep = (opts && typeof opts.keep === 'object' && opts.keep) || {};
    const defaultKeep = Number.isFinite(opts.defaultKeep)
        ? opts.defaultKeep
        : DEFAULT_KEEP_PER_AUTO_REASON;

    // Sólo automáticos no protegidos son candidatos.
    const prunable = snapshots.filter(s =>
        s && s.id != null && s.type === 'auto' && !s.isProtected
    );

    // Agrupar por razón (fallback al type).
    const groups = new Map();
    for (const s of prunable) {
        const key = s.reason || s.type || 'auto';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
    }

    const toDelete = [];
    for (const [reason, list] of groups) {
        const n = Number.isFinite(keep[reason]) ? keep[reason] : defaultKeep;
        // Más reciente primero (timestamp desc); conservamos los primeros N.
        list.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
        for (let i = Math.max(0, n); i < list.length; i++) {
            toDelete.push(list[i].id);
        }
    }
    return toDelete;
}

export default { selectSnapshotsToPrune, DEFAULT_KEEP_PER_AUTO_REASON };

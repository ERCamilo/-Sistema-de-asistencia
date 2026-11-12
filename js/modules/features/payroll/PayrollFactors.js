/**
 * ⚡ PayrollFactors.js
 * 
 * Funciones puras para resolución de factores salariales y recargos.
 */

export const DEFAULT_REST_DAY_FACTOR = 1.5;
export const DEFAULT_OVERTIME_FACTOR = 1.5;
export const DEFAULT_HOLIDAY_FACTOR = 2.0;

/**
 * Resuelve el factor de día no laborable / descanso. El día libre se paga con
 * lo que paga el líder de ese trabajo (decisión del usuario, 2026-11-10):
 * 1. Líder (lo que paga su equipo)
 * 2. Posición (solo si el líder no define el suyo)
 * 3. Settings (fallback global)
 *
 * @param {object|null} position
 * @param {object|null} leader
 * @param {object|null} settings
 * @returns {number}
 */
export function resolveRestDayFactor(position, leader, settings) {
    for (const source of [leader, position, settings]) {
        const factor = Number(source?.restDayFactor);
        if (source && Number.isFinite(factor) && factor > 0) return factor;
    }
    return DEFAULT_REST_DAY_FACTOR;
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/** The leader whose team did this work: the recorded one, or the job's leader in the catalogue. */
export function findWorkLeader(position, terms, leaders = []) {
    const leaderId = terms ? terms.workLeaderId : position?.leaderId;
    return leaderId == null ? null : (leaders || []).find(leader => sameId(leader.id, leaderId)) || null;
}

/** True when work was recorded for a leader who is no longer in the catalogue. */
export function workLeaderIsMissing(terms, leaders = []) {
    return Boolean(terms) && terms.workLeaderId != null && terms.workLeaderId !== ''
        && !(leaders || []).some(leader => sameId(leader.id, terms.workLeaderId));
}

/**
 * Factor de día libre de un trabajo concreto, el mismo para nómina, reporte y
 * tarjeta de asistencia. Manda lo que paga hoy el líder de ese trabajo; si ese
 * líder ya no existe en el catálogo, vale el factor registrado ese día y nunca
 * se sustituye en silencio por el general.
 */
export function resolveWorkRestDayFactor(position, terms, leaders, settings) {
    const recorded = Number(terms?.restDayFactor);
    if (workLeaderIsMissing(terms, leaders) && Number.isFinite(recorded) && recorded > 0) return recorded;
    return resolveRestDayFactor(position, findWorkLeader(position, terms, leaders), settings);
}

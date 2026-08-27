/**
 * ⚡ PayrollFactors.js
 * 
 * Funciones puras para resolución de factores salariales y recargos.
 */

export const DEFAULT_REST_DAY_FACTOR = 1.5;
export const DEFAULT_OVERTIME_FACTOR = 1.5;
export const DEFAULT_HOLIDAY_FACTOR = 2.0;

/**
 * Resuelve el factor de día no laborable / descanso aplicando la jerarquía en cascada:
 * 1. Posición (override específico del puesto)
 * 2. Líder (override de grupo/equipo)
 * 3. Settings (fallback global)
 *
 * @param {object|null} position
 * @param {object|null} leader
 * @param {object|null} settings
 * @returns {number}
 */
export function resolveRestDayFactor(position, leader, settings) {
    if (position && Number.isFinite(Number(position.restDayFactor)) && Number(position.restDayFactor) > 0) {
        return Number(position.restDayFactor);
    }
    if (leader && Number.isFinite(Number(leader.restDayFactor)) && Number(leader.restDayFactor) > 0) {
        return Number(leader.restDayFactor);
    }
    if (settings && Number.isFinite(Number(settings.restDayFactor)) && Number(settings.restDayFactor) > 0) {
        return Number(settings.restDayFactor);
    }
    return DEFAULT_REST_DAY_FACTOR;
}

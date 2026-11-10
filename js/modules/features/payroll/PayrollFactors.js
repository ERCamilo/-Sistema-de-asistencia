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

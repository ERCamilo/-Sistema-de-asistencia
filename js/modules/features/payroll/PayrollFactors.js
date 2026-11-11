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

/**
 * Pago avanzado de un préstamo de personal (editor del puesto → «Avanzado»).
 *
 * Solo vale para el trabajo de quien tiene ese puesto como préstamo; los demás
 * siguen la regla normal. Por concepto se elige de quién se toma o un factor
 * propio:
 *   - día libre: líder del equipo (por defecto), líder que paga, o propio;
 *   - feriado y horas extra: el general de la obra (por defecto) o propio.
 * Un valor por defecto no se guarda: sin ajustes, `loanPay` no existe.
 */
export const LOAN_PAY_SOURCES = Object.freeze({ TEAM: 'team', PAYER: 'payer', GENERAL: 'general', CUSTOM: 'custom' });
const LOAN_PAY_ALLOWED = Object.freeze({ restDay: ['payer', 'custom'], holiday: ['custom'], overtime: ['custom'] });

export function normalizeLoanPay(value) {
    const result = {};
    for (const [concept, sources] of Object.entries(LOAN_PAY_ALLOWED)) {
        const source = value?.[concept]?.source;
        if (!sources.includes(source)) continue;
        if (source !== LOAN_PAY_SOURCES.CUSTOM) { result[concept] = { source }; continue; }
        const raw = value[concept].factor;
        const factor = raw === '' || raw == null ? NaN : Number(raw);
        if (Number.isFinite(factor) && factor >= 1 && factor <= 5) result[concept] = { source, factor };
    }
    return Object.keys(result).length ? result : null;
}

/**
 * Los tres factores de un trabajo, con una sola regla para nómina, reporte y
 * tarjeta de asistencia. `base` trae horas extra y feriado ya resueltos para
 * quien llama (obra o ajustes generales).
 */
export function resolveWorkPayFactors(position, terms, leaders, settings, base = {}) {
    const factors = {
        restDayFactor: resolveWorkRestDayFactor(position, terms, leaders, settings),
        holidayFactor: base.holidayFactor,
        overtimeFactor: base.overtimeFactor
    };
    const loanPay = terms?.isLoanPosition === true ? normalizeLoanPay(position?.loanPay) : null;
    if (!loanPay) return factors;
    if (loanPay.restDay?.source === LOAN_PAY_SOURCES.PAYER) {
        const payer = (leaders || []).find(leader => sameId(leader.id, terms.payerLeaderId)) || null;
        factors.restDayFactor = resolveRestDayFactor(position, payer, settings);
    } else if (loanPay.restDay) factors.restDayFactor = loanPay.restDay.factor;
    if (loanPay.holiday) factors.holidayFactor = loanPay.holiday.factor;
    if (loanPay.overtime) factors.overtimeFactor = loanPay.overtime.factor;
    return factors;
}

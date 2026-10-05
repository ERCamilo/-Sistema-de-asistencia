/**
 * 📅 LoanPayPeriods — nóminas (periodo + día de pago) para las ventanas de la
 * cuenta de préstamos.
 *
 * Parte de la configuración de Nómina (payPeriod = { periodStart,
 * periodLength, payDay }) y proyecta periodos hacia atrás y hacia adelante.
 * El día de pago guarda la misma distancia al fin del periodo que el payDay
 * configurado (p. ej. fin 10/09 → pago 12/09 = 2 días después).
 */

const DAY = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const toTime = key => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
const toKey = time => new Date(time).toISOString().slice(0, 10);
const dm = key => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

/**
 * @param {object} payPeriod  { periodStart, periodLength, payDay? }
 * @param {string} today      'YYYY-MM-DD'
 * @param {{before?:number, after?:number}} [range]
 * @returns {Array<{key, start, end, payDate, label, short}>} vacío si no hay configuración
 */
export function buildPayPeriods(payPeriod, today, { before = 4, after = 8 } = {}) {
    const length = Number(payPeriod?.periodLength);
    const anchor = payPeriod?.periodStart;
    if (!ISO_DAY.test(String(anchor || '')) || !Number.isInteger(length) || length < 1 || length > 366) return [];
    if (!ISO_DAY.test(String(today || ''))) return [];
    const anchorEnd = toTime(anchor) + (length - 1) * DAY;
    const offset = ISO_DAY.test(String(payPeriod.payDay || ''))
        ? Math.round((toTime(payPeriod.payDay) - anchorEnd) / DAY)
        : 0;
    const current = Math.floor((toTime(today) - toTime(anchor)) / (length * DAY));
    const out = [];
    for (let k = current - before; k <= current + after; k++) {
        const start = toTime(anchor) + k * length * DAY;
        const end = start + (length - 1) * DAY;
        const pay = end + offset * DAY;
        const period = { key: toKey(end), start: toKey(start), end: toKey(end), payDate: toKey(pay) };
        period.short = `${dm(period.start)} – ${dm(period.end)}`;
        period.label = `${period.short} · pago ${dm(period.payDate)}`;
        out.push(period);
    }
    return out;
}

/** Primera nómina cuyo día de pago es hoy o después. */
export function nextPayPeriod(periods = [], today) {
    return periods.find(period => period.payDate >= today) || null;
}

/** Nómina siguiente a la que tiene ese día de pago. */
export function followingPayPeriod(periods = [], payDate) {
    return periods.find(period => period.payDate > payDate) || null;
}

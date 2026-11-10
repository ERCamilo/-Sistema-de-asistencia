/**
 * Aviso de cambio de pago.
 *
 * Regla (2026-11-10): una tarifa o un factor de día libre nuevos valen para
 * todo el período de pago abierto, incluidos los días ya registrados, e igual
 * para todos los empleados. Las nóminas cerradas conservan sus importes. Como
 * el cambio alcanza trabajo anterior, se avisa al guardarlo con la fecha desde
 * la que rige.
 */
import { Modal } from '../../components/Modal.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { getActivePayrollSettings } from './ActivePayrollSettings.js';
import { resolvePayrollPeriod } from './PayrollPeriod.js';

const displayDate = dateKey => String(dateKey).split('-').reverse().join('/');
const comparable = value => {
    const number = Number(value);
    return value == null || value === '' || !Number.isFinite(number) ? 0 : Math.round(number * 1e6) / 1e6;
};

/** Empty, null and zero all mean "no own value": only a real difference counts. */
export function payRateChanged(before, after) {
    return comparable(before) !== comparable(after);
}

export function describePayRateChange(state, { subject = 'Pago', today = new Date() } = {}) {
    const period = resolvePayrollPeriod(getActivePayrollSettings(state).payPeriod, today);
    return {
        effectiveFrom: period.periodStart,
        title: 'El cambio aplica a todo el período abierto',
        message: `${escapeHTML(subject)}: el nuevo pago rige desde el <strong>${displayDate(period.periodStart)}</strong>, `
            + 'inicio del período de pago abierto, incluidos los días ya registrados. Las nóminas cerradas no cambian.'
    };
}

export function notifyPayRateChange(state, options = {}) {
    const notice = describePayRateChange(state, options);
    return Modal.alert({ title: notice.title, message: notice.message, buttonText: 'Entendido' });
}

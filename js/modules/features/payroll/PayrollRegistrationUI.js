/**
 * Piezas del asistente de Nómina en modo «registrar un periodo ya pagado»:
 * aviso superior, paso 4 (qué hacer con los abonos ya anotados) y la
 * confirmación con el botón «Registrar cierre».
 */
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { REGISTRATION_LOAN_MODE } from './PayrollRegistration.js';
import { payrollClosureBlockerMessage } from './PayrollClosureUI.js';

function shortDay(key) {
    const value = String(key || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : escapeHTML(value);
}

function plural(count, singular, pluralForm) {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * @param {object} registration  registro guardado en exportConfig
 * @param {{active:boolean}} options  active=false cuando el generador muestra otras fechas
 */
export function renderPayrollRegistrationBanner(registration, { active = true } = {}) {
    if (!registration) return '';
    const period = `${shortDay(registration.periodStart)} – ${shortDay(registration.periodEnd)}`;
    const pay = registration.payDate ? `, pago del ${shortDay(registration.payDate)}` : '';
    const copy = active
        ? `<b>Registrando un periodo ya pagado:</b> ${period}${pay}.${registration.supersedesId ? ' Reemplaza al cierre que ya tenían esas fechas.' : ''}`
        : `<b>Cambiaste las fechas.</b> El registro del periodo ya pagado (${period}) solo aplica con esas fechas.`;
    return `
        <div class="payroll-registration-banner" role="status">
            <span>${copy}</span>
            <button type="button" class="payroll-registration-banner__cancel"
                    data-payroll-action="cancel-payroll-registration">
                Cancelar
            </button>
        </div>
    `;
}

export const REGISTRATION_EXCESS_COPY = 'El abono es mayor que el neto calculado hoy. Revisa si parte se pagó en efectivo.';

/** Aviso (no bloquea) de abonos ya hechos que superan el neto calculado hoy. */
export function renderPayrollRegistrationExcess(excess = []) {
    if (!excess || excess.length === 0) return '';
    return `
        <div class="payroll-registration-warning payroll-registration-excess" role="status">
            <p>${REGISTRATION_EXCESS_COPY}</p>
            <ul>
                ${excess.map(item => `<li>#${escapeHTML(item.employeeNumber)}: ${formatCurrency(item.excess)} más que el neto</li>`).join('')}
            </ul>
        </div>
    `;
}

export function renderPayrollRegistrationLoans({ registration, summary, excess = [] }) {
    const linkMode = registration.loanMode !== REGISTRATION_LOAN_MODE.NONE;
    const option = (mode, title, detail) => `
        <label class="payroll-registration-option ${registration.loanMode === mode ? 'is-on' : ''}">
            <input type="radio" name="payrollRegistrationLoanMode"
                   data-payroll-action="set-payroll-registration-loan-mode"
                   data-value="${mode}"
                   ${registration.loanMode === mode ? 'checked' : ''}>
            <span><b>${title}</b><small>${detail}</small></span>
        </label>
    `;
    const payDay = registration.payDate ? ` el ${shortDay(registration.payDate)}` : '';
    return `
        <div class="payroll-registration-card">
            <h4>¿Qué hacer con los préstamos?</h4>
            ${option(
                REGISTRATION_LOAN_MODE.LINK,
                `Usar ${summary.count === 1 ? 'el abono ya anotado' : `los ${summary.count} abonos ya anotados`} (${formatCurrency(summary.total)})`,
                'Se enlazan a este cierre y no se descuentan otra vez. Lo que deben no cambia. Recomendado.'
            )}
            ${option(
                REGISTRATION_LOAN_MODE.NONE,
                'Cerrar sin préstamos',
                'Los abonos se quedan como están, sin enlazar a ningún cierre.'
            )}
            ${linkMode && summary.employees.length > 0 ? `
                <div class="payroll-registration-table" tabindex="0" aria-label="Abonos ya anotados por empleado">
                    <table>
                        <thead><tr><th scope="col">N.º</th><th scope="col" class="is-amount">Abonos</th><th scope="col" class="is-amount">Monto</th></tr></thead>
                        <tbody>
                            ${summary.employees.map(item => `
                                <tr><td>#${escapeHTML(item.employeeNumber)}</td><td class="is-amount">${item.count}</td><td class="is-amount">${formatCurrency(item.amount)}</td></tr>
                            `).join('')}
                            <tr class="is-total"><td>${plural(summary.employees.length, 'empleado', 'empleados')}</td><td class="is-amount">${summary.count}</td><td class="is-amount">${formatCurrency(summary.total)}</td></tr>
                        </tbody>
                    </table>
                </div>
            ` : ''}
            ${linkMode && summary.count === 0 ? '<p class="payroll-registration-note">No hay abonos anotados para estas fechas.</p>' : ''}
            ${summary.excludedCount > 0 ? `
                <p class="payroll-registration-note">${plural(summary.excludedCount, 'abono', 'abonos')} (${formatCurrency(summary.excludedTotal)}) en efectivo, por transferencia o directos ${summary.excludedCount === 1 ? 'queda' : 'quedan'} fuera: solo se enlazan los descuentos de nómina.</p>
            ` : ''}
            ${linkMode ? renderPayrollRegistrationExcess(excess) : ''}
            ${summary.outsideCount > 0 ? `
                <p class="payroll-registration-note">${plural(summary.outsideCount, 'abono', 'abonos')} (${formatCurrency(summary.outsideTotal)}) de empleados sin pago en esta nómina ${summary.outsideCount === 1 ? 'queda' : 'quedan'} sin enlazar.</p>
            ` : ''}
            <div class="payroll-registration-warning">
                Los pasos 1 a 3 calculan la nómina con la asistencia guardada hoy. Si se corrigió después de pagar, puede no ser igual a lo que se pagó${payDay}.
            </div>
        </div>
    `;
}

/**
 * Casilla obligatoria y botón «Registrar cierre». variant 'summary' va dentro
 * del contenedor con margen del resumen lateral y usa sus estilos de botón;
 * 'panel' es la versión del paso 5.
 */
export function renderPayrollRegistrationActions({ registration, gate, excess = [], variant = 'panel' }) {
    const canConfirm = Boolean(
        gate?.hasRows && gate?.invalidCount === 0 &&
        !['history-loading', 'history-error', 'in-progress', 'already-closed', 'leader-filtered'].includes(gate?.reason)
    );
    const blocker = !gate?.enabled && gate?.reason && gate.reason !== 'payroll-not-confirmed'
        ? payrollClosureBlockerMessage(gate)
        : '';
    const payDay = registration.payDate ? ` el ${shortDay(registration.payDate)}` : '';
    const inSummary = variant === 'summary';
    return `
        <div class="payroll-registration-confirm ${inSummary ? 'payroll-guide-summary__actions is-summary' : ''}">
            ${registration.loanMode !== REGISTRATION_LOAN_MODE.NONE ? renderPayrollRegistrationExcess(excess) : ''}
            <label class="payroll-registration-confirm__check ${canConfirm ? '' : 'is-disabled'}">
                <input type="checkbox"
                       data-payroll-action="toggle-payroll-paid"
                       ${gate?.payrollPaid ? 'checked' : ''}
                       ${canConfirm ? '' : 'disabled aria-disabled="true"'}>
                <span>Revisé que coincide con lo que se pagó${payDay}</span>
            </label>
            ${blocker ? `<p class="payroll-registration-note">${escapeHTML(blocker)}</p>` : ''}
            <div class="payroll-registration-confirm__actions">
                <button type="button" class="${inSummary ? '' : 'payroll-registration-confirm__submit'}"
                        data-payroll-action="open-payroll-closure"
                        ${gate?.enabled ? '' : 'disabled aria-disabled="true"'}>
                    Registrar cierre
                </button>
                <button type="button" class="${inSummary ? '' : 'payroll-registration-banner__cancel'}"
                        data-payroll-action="cancel-payroll-registration">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

export default {
    renderPayrollRegistrationActions,
    renderPayrollRegistrationExcess,
    renderPayrollRegistrationBanner,
    renderPayrollRegistrationLoans
};

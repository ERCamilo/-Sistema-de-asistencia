import { Modal } from '../../components/Modal.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';

function blockerMessage(gate) {
    if (gate?.reason === 'no-loans') return 'Aplica al menos un préstamo o una cuota al resumen.';
    if (gate?.reason === 'invalid-net') {
        return `Resuelve ${gate.invalidCount} pago${gate.invalidCount === 1 ? '' : 's'} con saldo cero o negativo.`;
    }
    if (gate?.reason === 'payroll-not-confirmed') return 'Confirma que la nómina fue pagada para continuar.';
    if (gate?.reason === 'already-settled') return 'Los pagos de préstamos de esta nómina ya fueron registrados.';
    return 'Revisa la nómina antes de registrar los pagos.';
}

export function renderPayrollLoanSettlementPanel({ gate, activeBatch = null, now = Date.now() } = {}) {
    const canConfirmPayroll = Boolean(gate?.hasLoans && gate?.invalidCount === 0 && !activeBatch);
    const payrollPaid = Boolean(gate?.payrollPaid || activeBatch);
    const canUndo = Boolean(
        activeBatch && !activeBatch.incomplete && Number(now) <= Number(activeBatch.undoUntil || 0)
    );

    return `
        <section class="payroll-loan-settlement ${activeBatch ? 'is-settled' : ''}" aria-label="Cierre de préstamos de nómina">
            <div class="payroll-loan-settlement__copy">
                <span class="payroll-loan-settlement__eyebrow">Cierre de préstamos</span>
                <strong>${activeBatch
                    ? (activeBatch.incomplete ? 'Sincronización incompleta' : 'Pagos registrados')
                    : 'Registrar los descuentos verificados'}</strong>
                <p>${activeBatch
                    ? (activeBatch.incomplete
                        ? `${activeBatch.missingPaymentCount === 1 ? 'Falta' : 'Faltan'} ${activeBatch.missingPaymentCount} pago${activeBatch.missingPaymentCount === 1 ? '' : 's'} del lote. Espera la sincronización antes de continuar.`
                        : `${activeBatch.employeeCount} empleado${activeBatch.employeeCount === 1 ? '' : 's'} · ${formatCurrency(activeBatch.total)}`)
                    : blockerMessage(gate)}</p>
            </div>
            ${activeBatch ? `
                <div class="payroll-loan-settlement__completed">
                    <span>${activeBatch.incomplete
                        ? 'El cierre permanece bloqueado para evitar pagos duplicados.'
                        : 'El resumen de esta nómina quedó cerrado.'}</span>
                    ${canUndo ? `
                        <button type="button"
                                class="payroll-loan-settlement__undo"
                                data-payroll-action="undo-payroll-loan-settlement"
                                data-id="${escapeHTML(activeBatch.id)}">
                            Deshacer pagos
                        </button>
                    ` : (activeBatch.incomplete
                        ? '<small>Deshacer estará disponible cuando llegue el lote completo.</small>'
                        : '<small>La ventana para deshacer finalizó.</small>')}
                    <button type="button"
                            class="payroll-loan-settlement__button"
                            data-payroll-action="open-payroll-loan-settlement"
                            disabled aria-disabled="true">
                        ${activeBatch.incomplete ? 'Cierre bloqueado' : 'Pagos registrados'}
                    </button>
                </div>
            ` : `
                <label class="payroll-loan-settlement__paid-check ${canConfirmPayroll ? '' : 'is-disabled'}">
                    <input type="checkbox"
                           data-payroll-action="toggle-payroll-paid"
                           ${payrollPaid ? 'checked' : ''}
                           ${canConfirmPayroll ? '' : 'disabled aria-disabled="true"'}>
                    <span>Confirmo que la nómina fue pagada</span>
                </label>
                <button type="button"
                        class="payroll-loan-settlement__button"
                        data-payroll-action="open-payroll-loan-settlement"
                        ${gate?.enabled ? '' : 'disabled aria-disabled="true"'}>
                    Registrar pagos de préstamos
                </button>
            `}
        </section>
    `;
}

function renderLoanRows(employee) {
    return (employee.loans || []).map(loan => `
        <div class="payroll-settlement-modal__loan">
            <span>${escapeHTML(loan.concept || 'Préstamo')} · ${loan.chargeCount} ${loan.chargeCount === 1 ? 'cargo' : 'cargos'}</span>
            <strong>${formatCurrency(loan.amount)}</strong>
        </div>
    `).join('');
}

function renderModalContent(batch) {
    return `
        <div class="payroll-settlement-modal">
            <p class="payroll-settlement-modal__intro">
                Revisa los descuentos que ya fueron incluidos en la nómina. Al aceptar se registrarán como pagos en Cuentas por Cobrar.
            </p>
            <div class="payroll-settlement-modal__employees">
                ${(batch.employees || []).map(employee => `
                    <article class="payroll-settlement-modal__employee">
                        <header>
                            <div>
                                <small>#${escapeHTML(employee.employeeNumber)}</small>
                                <strong>${escapeHTML(employee.employeeName)}</strong>
                            </div>
                            <b>${formatCurrency(employee.paymentAmount)}</b>
                        </header>
                        ${renderLoanRows(employee)}
                        <footer>
                            <span>Saldo siguiente</span>
                            <strong>${employee.hasFuturePayment
                                ? formatCurrency(employee.remainingBalance)
                                : 'Sin saldo pendiente'}</strong>
                        </footer>
                    </article>
                `).join('')}
            </div>
            <div class="payroll-settlement-modal__total">
                <span>Total a registrar · ${batch.employeeCount} empleado${batch.employeeCount === 1 ? '' : 's'}</span>
                <strong>${formatCurrency(batch.total)}</strong>
            </div>
            <label class="payroll-settlement-modal__verify">
                <input type="checkbox" data-payroll-settlement-verify>
                <span>Verifiqué que estos pagos coinciden con la nómina realizada.</span>
            </label>
        </div>
    `;
}

export function openPayrollLoanSettlementModal(batch) {
    return new Promise(resolve => {
        let resolved = false;
        const finish = value => {
            if (resolved) return;
            resolved = true;
            resolve(value);
        };
        const modal = new Modal({
            title: 'Verificar pagos de préstamos',
            subtitle: `${batch.periodStart} – ${batch.periodEnd}`,
            content: renderModalContent(batch),
            size: 'large',
            onOpen() {
                const verify = this.element.querySelector('[data-payroll-settlement-verify]');
                const confirm = this.element.querySelector('[data-button-index="1"]');
                if (confirm) confirm.disabled = true;
                verify?.addEventListener('change', () => {
                    if (confirm) confirm.disabled = !verify.checked;
                });
            },
            onClose() {
                finish(false);
            },
            buttons: [{
                text: 'Cancelar',
                class: 'btn-secondary',
                onClick() {
                    finish(false);
                    this.close();
                }
            }, {
                text: 'Registrar pagos verificados',
                class: 'btn-primary',
                onClick() {
                    const verified = this.element
                        .querySelector('[data-payroll-settlement-verify]')?.checked;
                    if (!verified) return;
                    finish(true);
                    this.close();
                }
            }]
        });
        modal.open();
    });
}

export default {
    renderPayrollLoanSettlementPanel,
    openPayrollLoanSettlementModal
};

import { Modal } from '../../components/Modal.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';

function blockerMessage(gate) {
    if (gate?.reason === 'no-rows') return 'No hay empleados con un pago válido en esta vista previa.';
    if (gate?.reason === 'invalid-net') {
        return `Resuelve ${gate.invalidCount} pago${gate.invalidCount === 1 ? '' : 's'} con saldo cero o negativo.`;
    }
    if (gate?.reason === 'history-loading') return 'Verificando cierres anteriores de este período…';
    if (gate?.reason === 'history-error') return 'No se pudo verificar el historial local. Recargá antes de cerrar.';
    if (gate?.reason === 'in-progress') return 'El cierre se está procesando.';
    if (gate?.reason === 'payroll-not-confirmed') return 'Confirma que la nómina mostrada fue pagada.';
    if (gate?.reason === 'already-closed') return 'Esta vista previa ya fue cerrada.';
    if (gate?.reason === 'correction-required') {
        return 'Este período ya tiene un cierre. Prepará una corrección para conservar la auditoría.';
    }
    return 'Revisá la nómina antes de cerrarla.';
}

export function renderPayrollClosurePanel({ gate, now = Date.now() } = {}) {
    const exactClosure = gate?.exactClosure || null;
    const periodClosure = gate?.activeClosure || exactClosure;
    const showClosedState = Boolean(periodClosure && !gate?.correctionReady);
    const canUndo = Boolean(periodClosure?.status === 'closed');
    const canConfirm = Boolean(
        gate?.hasRows && gate?.invalidCount === 0 &&
        !['history-loading', 'in-progress', 'already-closed'].includes(gate?.reason)
    );

    return `
        <section class="payroll-loan-settlement ${showClosedState ? 'is-settled' : ''}"
                 aria-label="Cierre de nómina">
            <div class="payroll-loan-settlement__copy">
                <span class="payroll-loan-settlement__eyebrow">Cierre de nómina</span>
                <strong>${showClosedState
                    ? (exactClosure ? 'Nómina cerrada' : 'Período cerrado')
                    : (gate?.correctionReady ? 'Corrección preparada' : 'Guardar esta vista previa en el historial')}</strong>
                <p>${showClosedState
                    ? `${periodClosure.employeeCount} empleado${periodClosure.employeeCount === 1 ? '' : 's'} · ${formatCurrency(periodClosure.totals?.net)}`
                    : blockerMessage(gate)}</p>
            </div>
            ${showClosedState ? `
                <div class="payroll-loan-settlement__completed">
                    <span>El generador continúa disponible para nuevos cálculos.</span>
                    ${canUndo ? `
                        <button type="button"
                                class="payroll-loan-settlement__undo"
                                data-payroll-action="undo-payroll-closure"
                                data-id="${escapeHTML(periodClosure.id)}">
                            Deshacer cierre
                        </button>
                    ` : ''}
                    ${gate?.reason === 'correction-required' ? `
                        <button type="button"
                                class="payroll-loan-settlement__undo"
                                data-payroll-action="prepare-payroll-correction"
                                data-id="${escapeHTML(periodClosure.id)}">
                            Preparar corrección
                        </button>
                    ` : ''}
                    <button type="button" class="payroll-loan-settlement__undo"
                            data-payroll-action="open-payroll-history-detail"
                            data-id="${escapeHTML(periodClosure.id)}">
                        Ver en historial
                    </button>
                    <button type="button" class="payroll-loan-settlement__button"
                            data-payroll-action="open-payroll-closure" disabled aria-disabled="true">
                        Período cerrado
                    </button>
                </div>
            ` : `
                <label class="payroll-loan-settlement__paid-check ${canConfirm ? '' : 'is-disabled'}">
                    <input type="checkbox"
                           data-payroll-action="toggle-payroll-paid"
                           ${gate?.payrollPaid ? 'checked' : ''}
                           ${canConfirm ? '' : 'disabled aria-disabled="true"'}>
                    <span>Confirmo que la nómina mostrada fue pagada</span>
                </label>
                <button type="button"
                        class="payroll-loan-settlement__button"
                        data-payroll-action="open-payroll-closure"
                        ${gate?.enabled ? '' : 'disabled aria-disabled="true"'}>
                    Cerrar nómina
                </button>
            `}
        </section>
    `;
}

function renderLoanSummary(batch) {
    if (!batch) return '';
    return `
        <section class="payroll-settlement-modal__employees" aria-label="Pagos de préstamos">
            <h4>Préstamos incluidos</h4>
            ${(batch.employees || []).map(employee => `
                <article class="payroll-settlement-modal__employee">
                    <header>
                        <div><small>#${escapeHTML(employee.employeeNumber)}</small><strong>${escapeHTML(employee.employeeName)}</strong></div>
                        <b>${formatCurrency(employee.paymentAmount)}</b>
                    </header>
                    ${(employee.loans || []).map(loan => `
                        <div class="payroll-settlement-modal__loan">
                            <span>${escapeHTML(loan.concept || 'Préstamo')} · ${loan.chargeCount} ${loan.chargeCount === 1 ? 'cargo' : 'cargos'}</span>
                            <strong>${formatCurrency(loan.amount)}</strong>
                        </div>
                    `).join('')}
                    <footer><span>Saldo siguiente</span><strong>${employee.hasFuturePayment
                        ? formatCurrency(employee.remainingBalance)
                        : 'Sin saldo pendiente'}</strong></footer>
                </article>
            `).join('')}
        </section>
    `;
}

function renderModalContent({ closure, batch }) {
    return `
        <div class="payroll-settlement-modal">
            <p class="payroll-settlement-modal__intro">
                Revisá la instantánea que quedará guardada. Los importes históricos no podrán editarse.
            </p>
            <div class="payroll-settlement-modal__total">
                <span>Total neto · ${closure.employeeCount} empleado${closure.employeeCount === 1 ? '' : 's'}</span>
                <strong>${formatCurrency(closure.totals?.net)}</strong>
            </div>
            ${renderLoanSummary(batch)}
            <label class="payroll-settlement-modal__verify">
                <input type="checkbox" data-payroll-closure-verify>
                <span>Verifiqué que este cierre coincide con la nómina pagada.</span>
            </label>
        </div>
    `;
}

export function openPayrollClosureModal(draft) {
    return new Promise(resolve => {
        let resolved = false;
        const finish = value => {
            if (resolved) return;
            resolved = true;
            resolve(value);
        };
        const modal = new Modal({
            title: 'Verificar cierre de nómina',
            subtitle: `${draft.closure.periodStart} – ${draft.closure.periodEnd}`,
            content: renderModalContent(draft),
            size: 'large',
            onOpen() {
                const verify = this.element.querySelector('[data-payroll-closure-verify]');
                const confirm = this.element.querySelector('[data-button-index="1"]');
                if (confirm) confirm.disabled = true;
                verify?.addEventListener('change', () => {
                    if (confirm) confirm.disabled = !verify.checked;
                });
            },
            onClose() { finish(false); },
            buttons: [{
                text: 'Cancelar',
                class: 'btn-secondary',
                onClick() { finish(false); this.close(); }
            }, {
                text: 'Cerrar nómina verificada',
                class: 'btn-primary',
                onClick() {
                    if (!this.element.querySelector('[data-payroll-closure-verify]')?.checked) return;
                    finish(true);
                    this.close();
                }
            }]
        });
        modal.open();
    });
}

export default { renderPayrollClosurePanel, openPayrollClosureModal };

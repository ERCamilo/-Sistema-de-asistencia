import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { formatDateShort } from '../../utils/DateUtils.js';
import { getPayrollLoanSalaryAmounts, getPayrollLoanEquivalentPercentage } from './PayrollLoanSalary.js';
import { renderPayrollStatus } from './PayrollStatus.js';
import {
    getEligiblePayrollLoans,
    getPayrollLoanMode,
    getPayrollLoanPendingInterest,
    resolvePayrollLoanSelection,
    summarizePayrollLoans,
    PAYROLL_LOAN_MODE
} from './PayrollLoans.js';

function safe(value) {
    return escapeHTML(String(value ?? ''));
}

function splitEmployeeName(name) {
    const parts = String(name || 'Empleado').trim().split(/\s+/).filter(Boolean);
    const firstName = parts.shift() || 'Empleado';
    return {
        firstName,
        lastName: parts.join(' ')
    };
}

function getLoanWarningState(payrollRow) {
    if (!payrollRow) return 'missing';
    const net = Math.round((((Number(payrollRow?.monto) || 0) + Number.EPSILON) * 100)) / 100;
    if (net < 0) return 'negative';
    if (net === 0) return 'zero';
    return 'none';
}

function renderWarningSummary(model) {
    if (model.noticeCount === 0) {
        return '<strong class="is-clear">Sin alertas</strong>';
    }

    return `
        <span class="payroll-loans-warning-counts">
            ${model.negativeCount
                ? `<strong class="is-negative">${model.negativeCount} ${model.negativeCount === 1 ? 'negativo' : 'negativos'}</strong>`
                : ''}
            ${model.zeroCount
                ? `<strong class="is-zero">${model.zeroCount} en cero</strong>`
                : ''}
            ${model.missingCount ? renderPayrollStatus(`${model.missingCount} fuera de nómina`) : ''}
        </span>
    `;
}

function renderSelectionControl({ checked, mixed = false, employeeId, loanId = null, label }) {
    const action = loanId === null ? 'toggle-payroll-loan-employee' : 'toggle-payroll-loan';
    if (loanId === null) {
        return `
            <span class="payroll-loan-selection"
                  aria-checked="${mixed ? 'mixed' : String(checked)}"
                  aria-label="${safe(label)}"
                  data-payroll-action="${action}"
                  data-id="${safe(employeeId)}">
            </span>
        `;
    }
    return `
        <button type="button"
                class="payroll-loan-selection"
                role="checkbox"
                aria-checked="${mixed ? 'mixed' : String(checked)}"
                aria-label="${safe(label)}"
                data-payroll-action="${action}"
                data-id="${safe(employeeId)}"
                data-loan-id="${safe(loanId)}">
        </button>
    `;
}

export function buildPayrollLoansDesktopModel(employees = [], selection = [], payrollRows = [], periodEnd = null) {
    const resolvedByEmployee = new Map(
        resolvePayrollLoanSelection(employees, selection, periodEnd).map(item => [
            String(item.employeeId),
            new Map(item.loans.map(loan => [String(loan.loanId), loan]))
        ])
    );
    const payrollByEmployee = new Map(
        (payrollRows || []).map(row => [String(row._employeeId), row])
    );
    const groups = [];

    for (const employee of (employees || [])) {
        const eligibleLoans = getEligiblePayrollLoans(employee, periodEnd);
        if (eligibleLoans.length === 0) continue;
        const selectedLoansById = resolvedByEmployee.get(String(employee.id)) || new Map();
        const loanById = new Map((employee.loans || []).map(loan => [String(loan.id), loan]));
        const loans = eligibleLoans.map(loan => {
            const selectedLoan = selectedLoansById.get(String(loan.loanId));
            const pendingInterest = Math.min(loan.balance, getPayrollLoanPendingInterest(loanById.get(String(loan.loanId)) || {}));
            return {
                ...loan,
                pendingInterest,
                pendingCapital: Math.max(0, Math.round((loan.balance - pendingInterest) * 100) / 100),
                selected: !!selectedLoan,
                selectedChargeCount: selectedLoan?.selectedChargeCount || 0,
                selectedCharges: selectedLoan?.selectedCharges || [],
                selectedAmount: selectedLoan?.selectedAmount || 0,
                fullAmount: selectedLoan?.fullAmount || 0,
                interestPart: selectedLoan?.interestPart || 0,
                capitalPart: selectedLoan?.capitalPart || 0,
                selectedPendingInterest: selectedLoan?.pendingInterest || 0,
                firstInstallmentSeq: selectedLoan?.firstInstallmentSeq ?? loan.chargeOptions[0]?.installmentSeq ?? null,
                lastInstallmentSeq: selectedLoan?.lastInstallmentSeq ?? null
            };
        });
        const selectedLoans = loans.filter(loan => loan.selected);
        const payrollRow = payrollByEmployee.get(String(employee.id));
        const selectedBalance = selectedLoans.reduce((sum, loan) => sum + loan.selectedAmount, 0);
        const warningState = getLoanWarningState(payrollRow);
        const choice = getPayrollLoanMode(selection, employee.id);
        const sum = key => Math.round(selectedLoans.reduce((total, loan) => total + (Number(loan[key]) || 0), 0) * 100) / 100;
        const collectibleDebt = selectedLoans.length ? sum('fullAmount')
            : loans.reduce((total, loan) => total + loan.chargeOptions.slice(0, loan.defaultChargeCount)
                .reduce((amount, charge) => amount + charge.amount, 0), 0);
        const salaryAmounts = getPayrollLoanSalaryAmounts(payrollRow, collectibleDebt);

        groups.push({
            employeeId: employee.id,
            employeeNumber: employee.number,
            employeeName: employee.name || 'Empleado',
            loans,
            selectedCount: selectedLoans.length,
            eligibleCount: loans.length,
            selectedChargeCount: selectedLoans.reduce((sum, loan) => sum + loan.selectedChargeCount, 0),
            eligibleChargeCount: loans.reduce((sum, loan) => sum + loan.maxChargeCount, 0),
            // Casilla de 3 estados: completo solo con todo marcado y «Todo»; parcial si falta algo.
            selectionState: selectedLoans.length === 0 || selectedBalance <= 0.004
                ? (selectedLoans.length === 0 ? 'none' : 'mixed')
                : selectedLoans.length === loans.length && choice.mode === PAYROLL_LOAN_MODE.ALL ? 'all' : 'mixed',
            mode: choice.mode,
            customAmount: choice.amount,
            collectibleDebt,
            salaryAmounts,
            fullTotal: sum('fullAmount'),
            interestOnlyTotal: sum('selectedPendingInterest'),
            chargedInterest: sum('interestPart'),
            chargedCapital: sum('capitalPart'),
            selectedInterest: selectedLoans.reduce((sum, loan) => sum + loan.interest, 0),
            selectedBalance,
            eligibleBalance: loans.reduce((sum, loan) => sum + loan.balance, 0),
            netRemaining: Number(payrollRow?.monto) || 0,
            invalid: warningState === 'negative',
            warningState
        });
    }

    return {
        groups,
        summary: summarizePayrollLoans(employees, selection, periodEnd),
        invalidCount: groups.filter(group => group.invalid).length,
        negativeCount: groups.filter(group => group.warningState === 'negative').length,
        zeroCount: groups.filter(group => group.warningState === 'zero').length,
        missingCount: groups.filter(group => group.warningState === 'missing').length,
        noticeCount: groups.filter(group => group.warningState !== 'none').length
    };
}

function renderLoanRow(group, loan) {
    const concept = String(loan.concept || 'Préstamo').trim();
    const migrated = /\s*\(migrado\)\s*$/i.test(concept);
    const conceptLabel = migrated
        ? concept.replace(/\s*\(migrado\)\s*$/i, '').trim() || 'Préstamo'
        : concept;
    const isInstallments = loan.installmentMode === 'installments';
    const installmentSeqs = loan.chargeOptions
        .map(option => Number(option.installmentSeq))
        .filter(Number.isFinite);
    const totalInstallments = installmentSeqs.length > 0 ? Math.max(...installmentSeqs) : 0;
    const firstOption = loan.chargeOptions[0];
    const modeLabel = isInstallments && firstOption?.installmentSeq
        ? `Cuota ${firstOption.installmentSeq} de ${totalInstallments}`
        : firstOption?.kind === 'balance-adjustment' ? 'Ajuste de saldo' : 'Pago único';
    const dueLabel = firstOption?.dueDate ? ` · ${formatDateShort(firstOption.dueDate)}` : '';
    const selectedLabel = isInstallments
        ? `${loan.selectedChargeCount} de ${loan.maxChargeCount} seleccionadas`
        : (loan.selected ? 'Pago incluido' : 'Pago no incluido');
    const chargeControls = isInstallments ? `
        <span class="payroll-loan-charge-controls" aria-label="Cuotas seleccionadas para ${safe(conceptLabel)}">
            <button type="button"
                    data-payroll-action="adjust-payroll-loan-charge-count"
                    data-id="${safe(group.employeeId)}"
                    data-loan-id="${safe(loan.loanId)}"
                    data-delta="-1"
                    aria-label="Quitar una cuota"
                    ${loan.selectedChargeCount <= 0 ? 'disabled' : ''}>−</button>
            <output>${safe(selectedLabel)}</output>
            <button type="button"
                    data-payroll-action="adjust-payroll-loan-charge-count"
                    data-id="${safe(group.employeeId)}"
                    data-loan-id="${safe(loan.loanId)}"
                    data-delta="1"
                    aria-label="Agregar una cuota"
                    ${loan.selectedChargeCount >= loan.maxChargeCount ? 'disabled' : ''}>+</button>
            <button type="button"
                    class="payroll-loan-charge-controls__all"
                    data-payroll-action="select-all-payroll-loan-charges"
                    data-id="${safe(group.employeeId)}"
                    data-loan-id="${safe(loan.loanId)}"
                    ${loan.selectedChargeCount >= loan.maxChargeCount ? 'disabled' : ''}>Todas</button>
        </span>
    ` : '<span class="payroll-loan-child__spacer" aria-hidden="true"></span>';
    return `
        <div class="payroll-loan-child" role="row">
            <span class="payroll-loan-child__concept">
                <strong>${safe(conceptLabel)}</strong>
                ${migrated ? '<small>(migrado)</small>' : ''}
                <small>${safe(modeLabel)}${safe(dueLabel)}</small>
            </span>
            <span class="payroll-loan-child__interest">${formatCurrency(loan.pendingInterest)}</span>
            <span class="payroll-loan-child__capital">${formatCurrency(loan.pendingCapital)}</span>
            <span class="payroll-loan-child__total">${formatCurrency(loan.balance)}</span>
            <span class="payroll-loan-child__balance">
                <strong>${formatCurrency(loan.selectedAmount)}</strong>
                ${loan.selected ? `<small>${formatCurrency(loan.interestPart)} int. + ${formatCurrency(loan.capitalPart)} cap.</small>` : ''}
            </span>
            ${chargeControls}
            ${renderSelectionControl({
                checked: loan.selected,
                employeeId: group.employeeId,
                loanId: loan.loanId,
                label: `${loan.selected ? 'Excluir' : 'Incluir'} ${loan.concept} de esta nómina`
            })}
        </div>
    `;
}

/** «Cuánto descontar»: Todo, Solo interés u Otro monto, con el desglose y los avisos. */
function renderModePanel(group, draft = null, percentageDraft = null) {
    const id = safe(group.employeeId);
    const salary = group.salaryAmounts;
    const net = group.netRemaining;
    const selected = group.selectedBalance;
    const equivalent = getPayrollLoanEquivalentPercentage(selected, salary.salaryAvailable);
    const percentage = equivalent === null ? '' : Number(equivalent.toFixed(4));
    const button = (mode, label, amount) => `
        <button type="button" class="payroll-loan-mode__option"
                data-payroll-action="set-payroll-loan-mode" data-id="${id}" data-mode="${mode}"
                aria-pressed="${group.selectedCount > 0 && group.mode === mode}">${label} <b>${formatCurrency(amount)}</b></button>`;
    const customValue = group.selectedCount ? String(selected) : '';
    const errorId = `payroll-loan-percentage-error-${id}`;
    const owedLeft = Math.max(0, Math.round((group.eligibleBalance - selected) * 100) / 100);
    return `
        <div class="payroll-loan-mode" role="group" aria-label="Cuánto descontar a ${safe(group.employeeName)}"
             data-salary-available="${salary.salaryAvailable}" data-collectible-debt="${group.collectibleDebt}">
            <span class="payroll-loan-mode__label">Cuánto descontar</span>
            <div class="payroll-loan-mode__options">
                ${button(PAYROLL_LOAN_MODE.ALL, 'Todo', group.collectibleDebt)}
                ${button(PAYROLL_LOAN_MODE.INTEREST, 'Solo interés', group.selectedCount ? group.interestOnlyTotal : group.loans.reduce((t, l) => t + Math.min(l.pendingInterest, l.chargeOptions[0]?.amount || 0), 0))}
                <button type="button" class="payroll-loan-mode__option" data-payroll-action="set-payroll-loan-salary-amount"
                        data-id="${id}" data-kind="available" ${salary.available > 0 ? '' : 'disabled'}>
                    Disponible <b>${formatCurrency(salary.available)}</b>
                </button>
                <button type="button" class="payroll-loan-mode__option" data-payroll-action="set-payroll-loan-salary-amount"
                        data-id="${id}" data-kind="percentage" ${salary.suggested > 0 ? '' : 'disabled'}>
                    Sugerido 30 % <b>${formatCurrency(salary.suggested)}</b>
                </button>
            </div>
            <div class="payroll-loan-amount-controls">
                <label class="payroll-loan-mode__amount ${group.mode === PAYROLL_LOAN_MODE.CUSTOM ? 'is-active' : ''}">
                    <span>Otro monto $</span>
                    <input type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"
                           data-id="${id}" data-payroll-loan-custom-amount value="${safe(draft ? draft.value : customValue)}"
                           ${draft ? `aria-invalid="true" aria-describedby="payroll-loan-amount-error-${id}"` : ''}
                           aria-label="Otro monto para ${safe(group.employeeName)}"
                           onchange="PayrollUI.setPayrollLoanCustomAmount(this.dataset.id, this.value)">
                </label>
                <div class="payroll-loan-percentage">
                    <label class="sr-only" for="payroll-loan-range-${id}">Porcentaje del sueldo disponible para ${safe(group.employeeName)}</label>
                    <input type="range" id="payroll-loan-range-${id}" min="0" max="100" step="any" value="${Math.min(100, percentage || 0)}"
                           data-payroll-loan-percentage="range" data-id="${id}" aria-describedby="${errorId}"
                           aria-valuetext="${percentage === '' ? 'Sin sueldo disponible' : `${percentage} % del sueldo disponible`}"
                           ${salary.available > 0 ? '' : 'disabled'}>
                    <label class="payroll-loan-percentage__number">
                        <input type="number" min="0" step="any" value="${safe(percentageDraft ? percentageDraft.value : percentage)}" inputmode="decimal"
                               ${percentageDraft ? 'aria-invalid="true"' : ''}
                               data-payroll-loan-percentage="number" data-id="${id}" aria-label="Porcentaje del sueldo disponible para ${safe(group.employeeName)}"
                               aria-describedby="${errorId}" ${salary.available > 0 ? '' : 'disabled'}> %
                    </label>
                </div>
            </div>
            <p id="${errorId}" class="payroll-loan-mode__error" data-payroll-loan-percentage-error role="alert" ${percentageDraft ? '' : 'hidden'}>Indica un porcentaje entre 0 y 100.</p>
            ${draft ? `<p class="payroll-loan-mode__error" id="payroll-loan-amount-error-${id}" role="alert">${safe(draft.error)}</p>` : ''}
            <p class="payroll-loan-mode__split">Queda de sueldo <b data-payroll-loan-live-net class="${net < 0 ? 'is-negative' : ''}">${formatCurrency(net)}</b>
                · deuda pendiente <b>${formatCurrency(owedLeft)}</b></p>
            ${group.mode === PAYROLL_LOAN_MODE.CUSTOM && (group.customAmount || 0) > group.fullTotal + 0.004
                ? renderPayrollStatus('Monto limitado al saldo seleccionado', 'attention') : ''}
        </div>`;
}

function renderEmployeeGroup(group, expandedIds, customAmountDrafts, percentageDrafts) {
    const selectedAll = group.selectionState === 'all';
    const mixed = group.selectionState === 'mixed';
    const { firstName, lastName } = splitEmployeeName(group.employeeName);
    const isExpanded = expandedIds.has(String(group.employeeId));
    const warningClass = group.warningState === 'none'
        ? ''
        : `is-warning-${group.warningState}`;
    const warningLabel = group.warningState === 'negative'
        ? ', neto negativo'
        : group.warningState === 'zero' ? ', neto en cero' : group.warningState === 'missing' ? ', no está en la nómina' : '';
    const notice = group.warningState === 'negative' ? renderPayrollStatus('No tiene saldo suficiente', 'error')
        : group.warningState === 'missing' ? renderPayrollStatus('No está en la nómina')
        : group.warningState === 'zero' ? renderPayrollStatus(group.salaryAmounts.salaryAvailable > 0 ? 'Sin sueldo restante' : 'Sin sueldo disponible', 'attention') : '';
    return `
        <details class="payroll-loan-group ${warningClass}"
                 data-employee-id="${safe(group.employeeId)}"
                 aria-label="${safe(group.employeeName)}${warningLabel}"
                 ${isExpanded ? 'open' : ''}>
            <summary>
                <span class="payroll-loan-group__number">${safe(group.employeeNumber || '?')}</span>
                <span class="payroll-loan-group__employee">
                    <span class="payroll-loan-group__employee-copy">
                        <strong>
                            <span>${safe(firstName)}</span>
                            <span>${safe(lastName)}</span>
                        </strong>
                        ${notice}
                    </span>
                </span>
                <span class="payroll-loan-group__metrics">
                    <span class="payroll-loan-group__count" data-label="Cargos">${group.selectedChargeCount}/${group.eligibleChargeCount}</span>
                    <span class="payroll-loan-group__interest" data-label="Interés">${formatCurrency(group.selectedInterest)}</span>
                    <span class="payroll-loan-group__discount" data-label="A descontar">
                        <strong>${formatCurrency(group.selectedBalance)}</strong>
                        <small>de ${formatCurrency(group.eligibleBalance)}</small>
                    </span>
                    <strong class="payroll-loan-group__net ${warningClass}" data-label="Neto a pagar">${formatCurrency(group.netRemaining)}</strong>
                </span>
                <span class="payroll-loan-disclosure"
                      aria-expanded="${isExpanded}"
                      aria-label="${isExpanded ? 'Ocultar' : 'Mostrar'} préstamos de ${safe(group.employeeName)}"
                      data-payroll-action="toggle-payroll-loan-details"
                      data-id="${safe(group.employeeId)}">
                </span>
                ${renderSelectionControl({
                    checked: selectedAll,
                    mixed,
                    employeeId: group.employeeId,
                    label: selectedAll
                        ? `Excluir todos los préstamos de ${group.employeeName}`
                        : `Incluir todos los préstamos de ${group.employeeName}`
                })}
            </summary>
            <div class="payroll-loan-group__body has-modes">
                ${renderModePanel(group, customAmountDrafts[group.employeeId], percentageDrafts[group.employeeId])}
                <div class="payroll-loan-child-columns" aria-hidden="true">
                    <span>Préstamo</span><span>Interés pend.</span><span>Capital pend.</span><span>Total</span><span>A descontar</span>
                    <span>Cuotas</span><span></span>
                </div>
                ${group.loans.map(loan => renderLoanRow(group, loan)).join('')}
            </div>
        </details>
    `;
}

export function renderPayrollLoansDesktop({
    employees = [],
    selection = [],
    payrollRows = [],
    expandedEmployeeIds = [],
    customAmountDrafts = {},
    percentageDrafts = {},
    periodEnd = null
} = {}) {
    const model = buildPayrollLoansDesktopModel(employees, selection, payrollRows, periodEnd);
    const expandedIds = new Set((expandedEmployeeIds || []).map(String));
    const summary = model.summary;

    return `
        <section class="payroll-loans-desktop">
            <header class="payroll-loans-desktop__header">
                <div>
                    <span>Préstamos del período</span>
                    <h3>Seleccionar pagos y cuotas</h3>
                    <p>Esta selección sólo afecta la nómina actual y no registra pagos.</p>
                </div>
                <span class="payroll-loans-desktop__badge">${summary.selectedChargeCount}/${summary.eligibleChargeCount}</span>
            </header>
            <div class="payroll-loans-metrics">
                <span><small>Cargos</small><strong>${summary.selectedChargeCount}/${summary.eligibleChargeCount}</strong></span>
                <span><small>Intereses</small><strong>${formatCurrency(summary.selectedInterest)}</strong></span>
                <span><small>A descontar</small><strong>${formatCurrency(summary.selectedBalance)}</strong></span>
                <span class="payroll-loans-warning-summary ${model.invalidCount ? 'has-warnings' : ''}">
                    <small>Advertencias</small>${renderWarningSummary(model)}
                </span>
            </div>
            <div class="payroll-loans-toolbar">
                <button type="button" data-payroll-action="add-payroll-loans">Aplicar próximos cargos</button>
                <button type="button"
                        class="is-secondary"
                        data-payroll-action="clear-payroll-loans"
                        ${summary.selectedCount === 0 ? 'disabled' : ''}>
                    Limpiar selección
                </button>
            </div>
            <div class="payroll-loans-table">
                <div class="payroll-loans-table__columns" aria-hidden="true">
                    <span>N.º</span><span>Empleado</span>
                    <span class="payroll-loans-table__metric-columns">
                        <span>Préstamos</span><span>Interés</span>
                        <span>A descontar</span><span>Neto a pagar</span>
                    </span>
                    <span></span><span></span>
                </div>
                ${model.groups.length
                    ? model.groups.map(group => renderEmployeeGroup(group, expandedIds, customAmountDrafts, percentageDrafts)).join('')
                    : '<p class="payroll-loans-table__empty">No hay préstamos activos para este período.</p>'}
            </div>
        </section>
    `;
}

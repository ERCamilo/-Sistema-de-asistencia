import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { formatDateShort } from '../../utils/DateUtils.js';
import {
    getEligiblePayrollLoans,
    resolvePayrollLoanSelection,
    summarizePayrollLoans
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
    if (!payrollRow?._invalidLoanNet) return 'none';
    return Number(payrollRow.monto) < 0 ? 'negative' : 'zero';
}

function renderWarningSummary(model) {
    if (model.invalidCount === 0) {
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
        </span>
    `;
}

function renderSelectionControl({ checked, mixed = false, employeeId, loanId = null, label }) {
    const action = loanId === null ? 'toggle-payroll-loan-employee' : 'toggle-payroll-loan';
    return `
        <button type="button"
                class="payroll-loan-selection"
                role="checkbox"
                aria-checked="${mixed ? 'mixed' : String(checked)}"
                aria-label="${safe(label)}"
                data-payroll-action="${action}"
                data-id="${safe(employeeId)}"
                ${loanId === null ? '' : `data-loan-id="${safe(loanId)}"`}>
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
        const loans = eligibleLoans.map(loan => {
            const selectedLoan = selectedLoansById.get(String(loan.loanId));
            return {
                ...loan,
                selected: !!selectedLoan,
                selectedChargeCount: selectedLoan?.selectedChargeCount || 0,
                selectedCharges: selectedLoan?.selectedCharges || [],
                selectedAmount: selectedLoan?.selectedAmount || 0,
                firstInstallmentSeq: selectedLoan?.firstInstallmentSeq ?? loan.chargeOptions[0]?.installmentSeq ?? null,
                lastInstallmentSeq: selectedLoan?.lastInstallmentSeq ?? null
            };
        });
        const selectedLoans = loans.filter(loan => loan.selected);
        const payrollRow = payrollByEmployee.get(String(employee.id));
        const selectedBalance = selectedLoans.reduce((sum, loan) => sum + loan.selectedAmount, 0);
        const warningState = getLoanWarningState(payrollRow);

        groups.push({
            employeeId: employee.id,
            employeeNumber: employee.number,
            employeeName: employee.name || 'Empleado',
            loans,
            selectedCount: selectedLoans.length,
            eligibleCount: loans.length,
            selectedChargeCount: selectedLoans.reduce((sum, loan) => sum + loan.selectedChargeCount, 0),
            eligibleChargeCount: loans.reduce((sum, loan) => sum + loan.maxChargeCount, 0),
            selectionState: selectedLoans.length === 0
                ? 'none'
                : selectedLoans.length === loans.length ? 'all' : 'mixed',
            selectedInterest: selectedLoans.reduce((sum, loan) => sum + loan.interest, 0),
            selectedBalance,
            eligibleBalance: loans.reduce((sum, loan) => sum + loan.balance, 0),
            netRemaining: Number(payrollRow?.monto) || 0,
            invalid: warningState !== 'none',
            warningState
        });
    }

    return {
        groups,
        summary: summarizePayrollLoans(employees, selection, periodEnd),
        invalidCount: groups.filter(group => group.invalid).length,
        negativeCount: groups.filter(group => group.warningState === 'negative').length,
        zeroCount: groups.filter(group => group.warningState === 'zero').length
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
            <span class="payroll-loan-child__interest">${formatCurrency(loan.interest)}</span>
            <strong class="payroll-loan-child__balance">${formatCurrency(loan.selectedAmount)}</strong>
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

function renderEmployeeGroup(group, expandedIds) {
    const selectedAll = group.selectionState === 'all';
    const mixed = group.selectionState === 'mixed';
    const { firstName, lastName } = splitEmployeeName(group.employeeName);
    const isExpanded = expandedIds.has(String(group.employeeId));
    const warningClass = group.warningState === 'none'
        ? ''
        : `is-warning-${group.warningState}`;
    const warningLabel = group.warningState === 'negative'
        ? ', neto negativo'
        : group.warningState === 'zero' ? ', neto en cero' : '';
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
                <button type="button"
                        class="payroll-loan-disclosure"
                        aria-expanded="${isExpanded}"
                        aria-label="${isExpanded ? 'Ocultar' : 'Mostrar'} préstamos de ${safe(group.employeeName)}"
                        data-payroll-action="toggle-payroll-loan-details"
                        data-id="${safe(group.employeeId)}">
                </button>
                ${renderSelectionControl({
                    checked: selectedAll,
                    mixed,
                    employeeId: group.employeeId,
                    label: selectedAll
                        ? `Excluir todos los préstamos de ${group.employeeName}`
                        : `Incluir todos los préstamos de ${group.employeeName}`
                })}
            </summary>
            <div class="payroll-loan-group__body">
                <div class="payroll-loan-child-columns" aria-hidden="true">
                    <span>Préstamo</span><span>Interés</span><span>A descontar</span>
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
                    ? model.groups.map(group => renderEmployeeGroup(group, expandedIds)).join('')
                    : '<p class="payroll-loans-table__empty">No hay préstamos activos para este período.</p>'}
            </div>
        </section>
    `;
}

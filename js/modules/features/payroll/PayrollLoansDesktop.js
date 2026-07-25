import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { getEligiblePayrollLoans, summarizePayrollLoans } from './PayrollLoans.js';

function safe(value) {
    return escapeHTML(String(value ?? ''));
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

export function buildPayrollLoansDesktopModel(employees = [], selection = [], payrollRows = []) {
    const selectionByEmployee = new Map(
        (selection || []).map(item => [
            String(item.employeeId),
            new Set((item.loanIds || []).map(String))
        ])
    );
    const payrollByEmployee = new Map(
        (payrollRows || []).map(row => [String(row._employeeId), row])
    );
    const groups = [];

    for (const employee of (employees || [])) {
        const eligibleLoans = getEligiblePayrollLoans(employee);
        if (eligibleLoans.length === 0) continue;
        const selectedIds = selectionByEmployee.get(String(employee.id)) || new Set();
        const loans = eligibleLoans.map(loan => ({
            ...loan,
            selected: selectedIds.has(String(loan.loanId))
        }));
        const selectedLoans = loans.filter(loan => loan.selected);
        const payrollRow = payrollByEmployee.get(String(employee.id));
        const selectedBalance = selectedLoans.reduce((sum, loan) => sum + loan.balance, 0);

        groups.push({
            employeeId: employee.id,
            employeeNumber: employee.number,
            employeeName: employee.name || 'Empleado',
            loans,
            selectedCount: selectedLoans.length,
            eligibleCount: loans.length,
            selectionState: selectedLoans.length === 0
                ? 'none'
                : selectedLoans.length === loans.length ? 'all' : 'mixed',
            selectedInterest: selectedLoans.reduce((sum, loan) => sum + loan.interest, 0),
            selectedBalance,
            netRemaining: Number(payrollRow?.monto) || 0,
            invalid: Boolean(payrollRow?._invalidLoanNet)
        });
    }

    return {
        groups,
        summary: summarizePayrollLoans(employees, selection),
        invalidCount: groups.filter(group => group.invalid).length
    };
}

function renderLoanRow(group, loan) {
    return `
        <div class="payroll-loan-child" role="row">
            ${renderSelectionControl({
                checked: loan.selected,
                employeeId: group.employeeId,
                loanId: loan.loanId,
                label: `${loan.selected ? 'Excluir' : 'Incluir'} ${loan.concept} de esta nómina`
            })}
            <span class="payroll-loan-child__concept">
                <strong>${safe(loan.concept)}</strong>
                <small>${loan.selected ? 'Incluido en esta nómina' : 'Excluido de esta nómina'}</small>
            </span>
            <span>${formatCurrency(loan.interest)}</span>
            <strong>${formatCurrency(loan.balance)}</strong>
        </div>
    `;
}

function renderEmployeeGroup(group, expandedIds) {
    const selectedAll = group.selectionState === 'all';
    const mixed = group.selectionState === 'mixed';
    return `
        <details class="payroll-loan-group ${group.invalid ? 'is-invalid' : ''}"
                 data-employee-id="${safe(group.employeeId)}"
                 ${expandedIds.has(String(group.employeeId)) ? 'open' : ''}>
            <summary>
                ${renderSelectionControl({
                    checked: selectedAll,
                    mixed,
                    employeeId: group.employeeId,
                    label: selectedAll
                        ? `Excluir todos los préstamos de ${group.employeeName}`
                        : `Incluir todos los préstamos de ${group.employeeName}`
                })}
                <span class="payroll-loan-group__employee">
                    <strong>#${safe(group.employeeNumber || '?')} · ${safe(group.employeeName)}</strong>
                    ${group.invalid ? '<small>El descuento deja el pago en cero o negativo</small>' : ''}
                </span>
                <span>${group.selectedCount} de ${group.eligibleCount}</span>
                <span>${formatCurrency(group.selectedInterest)}</span>
                <strong>${formatCurrency(group.selectedBalance)}</strong>
                <strong class="${group.invalid ? 'is-invalid' : ''}">${formatCurrency(group.netRemaining)}</strong>
            </summary>
            <div class="payroll-loan-group__body">
                <div class="payroll-loan-child-columns" aria-hidden="true">
                    <span></span><span>Préstamo</span><span>Interés</span><span>Saldo</span>
                </div>
                ${group.loans.map(loan => renderLoanRow(group, loan)).join('')}
                <p>Excluir de esta nómina no elimina el préstamo de cuentas por cobrar.</p>
            </div>
        </details>
    `;
}

export function renderPayrollLoansDesktop({
    employees = [],
    selection = [],
    payrollRows = [],
    expandedEmployeeIds = []
} = {}) {
    const model = buildPayrollLoansDesktopModel(employees, selection, payrollRows);
    const expandedIds = new Set((expandedEmployeeIds || []).map(String));
    const summary = model.summary;

    return `
        <section class="payroll-loans-desktop">
            <header class="payroll-loans-desktop__header">
                <div>
                    <span>Préstamos del período</span>
                    <h3>Seleccionar préstamos activos</h3>
                    <p>Esta selección sólo afecta la nómina actual y no registra pagos.</p>
                </div>
                <span class="payroll-loans-desktop__badge">${summary.selectedCount} de ${summary.eligibleCount}</span>
            </header>
            <div class="payroll-loans-metrics">
                <span><small>Seleccionados</small><strong>${summary.selectedCount} de ${summary.eligibleCount}</strong></span>
                <span><small>Intereses</small><strong>${formatCurrency(summary.selectedInterest)}</strong></span>
                <span><small>A descontar</small><strong>${formatCurrency(summary.selectedBalance)}</strong></span>
                <span class="${model.invalidCount ? 'is-invalid' : ''}">
                    <small>Revisión</small><strong>${model.invalidCount || 'Sin alertas'}</strong>
                </span>
            </div>
            <div class="payroll-loans-toolbar">
                <button type="button" data-payroll-action="add-payroll-loans">Agregar todos</button>
                <button type="button"
                        class="is-secondary"
                        data-payroll-action="clear-payroll-loans"
                        ${summary.selectedCount === 0 ? 'disabled' : ''}>
                    Limpiar selección
                </button>
            </div>
            <div class="payroll-loans-table">
                <div class="payroll-loans-table__columns" aria-hidden="true">
                    <span></span><span>Empleado</span><span>Préstamos</span>
                    <span>Interés</span><span>A descontar</span><span>Neto restante</span>
                </div>
                ${model.groups.length
                    ? model.groups.map(group => renderEmployeeGroup(group, expandedIds)).join('')
                    : '<p class="payroll-loans-table__empty">No hay préstamos activos para este período.</p>'}
            </div>
        </section>
    `;
}

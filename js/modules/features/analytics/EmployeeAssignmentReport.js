import { getPayrollEmployeesForPeriodWithContext } from '../payroll/PayrollPeriod.js';
import { calculateEmployeePayrollWithContext } from '../payroll/PayrollService.js';
import { applyPayrollPreviewInclusion, filterPayrollRowsByLeader } from '../payroll/PayrollPreview.js';
import { applyPayrollLoanDeductions } from '../payroll/PayrollLoans.js';
import { buildPayrollLeaderAdjustments } from '../payroll/PayrollLeaderAdjustments.js';

/** Reuses canonical payroll; monetary columns never get mixed with worked days. */
export function buildEmployeeAssignmentReport({ state, settings, report, periodStart, periodEnd, projectId, ownerId }) {
    const ids = new Set(report.positions.flatMap(group => group.employees.map(employee => String(employee.id))));
    const ctx = { ...state, projectId, exportConfig: { ...state.exportConfig, leaderFilter: 'all' }, getAttendance: (employeeId, date) => state.attendance[`${employeeId}-${date}`] };
    const configuredRows = getPayrollEmployeesForPeriodWithContext(ctx, periodStart, periodEnd).filter(employee => ids.has(String(employee.id))).map(employee => {
        const payroll = calculateEmployeePayrollWithContext(ctx, settings, employee.id, periodStart, periodEnd,
            state.exportConfig?.deductions || [], state.exportConfig?.bonuses || [], [], []);
        return { _employeeId: employee.id, _employeeName: employee.name, _number: employee.number,
            _brutoOriginal: payroll.brutoOriginal, _bruto: payroll.bruto,
            _bonuses: payroll.bonuses, _bonusDetails: payroll.bonusBreakdown,
            _deductions: payroll.deductions, _deductionDetails: payroll.deductionBreakdown,
            _positionBreakdown: payroll.breakdown, _personalAdjustmentPayerId: payroll.personalAdjustmentPayerId, _loans: 0, monto: payroll.neto };
    });
    const rows = applyPayrollPreviewInclusion(applyPayrollLoanDeductions(configuredRows, state.employees,
        state.exportConfig?.payrollLoanSelection || [], periodEnd), state.exportConfig?.payrollPreviewInclusion);
    const options = { projectId, ownerId, periodStart, periodEnd, positions: state.positions, employees: state.employees,
        selections: state.exportConfig?.payrollLeaderAdjustments };
    return { rows, groups: buildPayrollLeaderAdjustments(rows, options),
        rowsForLeader: leaderId => filterPayrollRowsByLeader(rows, { ...options, leaderId }) };
}

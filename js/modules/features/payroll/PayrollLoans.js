import { getBalance, getTotalDue, getTotalInterestAccrued, LOAN_STATUS, round2 } from '../loans/LoansService.js';

/**
 * Pure helpers for the temporary payroll-loan selection.
 *
 * The selection stores IDs only. Loan balances remain the source of truth and
 * copying/downloading payroll never records payments or mutates employee data.
 */

export function calculatePayrollBeforeLoans(payrollService, employeeId, periodStart, periodEnd, deductions, bonuses) {
    return payrollService.calculateEmployeePayroll(
        employeeId,
        periodStart,
        periodEnd,
        deductions,
        bonuses,
        []
    );
}

export function getEligiblePayrollLoans(employee) {
    return (employee?.loans || [])
        .filter(loan => loan.status === LOAN_STATUS.ACTIVE && getBalance(loan) > 0)
        .map(loan => ({
            loanId: loan.id,
            concept: loan.concept || 'Préstamo',
            totalDue: getTotalDue(loan),
            interest: getTotalInterestAccrued(loan),
            balance: getBalance(loan)
        }));
}

export function buildPayrollLoanSelection(employees) {
    return (employees || []).map(employee => ({
        employeeId: employee.id,
        loanIds: getEligiblePayrollLoans(employee).map(loan => loan.loanId)
    })).filter(item => item.loanIds.length > 0);
}

export function removeEmployeePayrollLoans(selection, employeeId) {
    const normalizedEmployeeId = String(employeeId);
    return (selection || []).filter(item => String(item.employeeId) !== normalizedEmployeeId);
}

export function resolvePayrollLoanSelection(employees, selection) {
    const employeesById = new Map((employees || []).map(employee => [String(employee.id), employee]));

    return (selection || []).map(item => {
        const employee = employeesById.get(String(item.employeeId));
        if (!employee) return null;

        const selectedIds = new Set((item.loanIds || []).map(String));
        const loans = getEligiblePayrollLoans(employee).filter(loan => selectedIds.has(String(loan.loanId)));
        if (loans.length === 0) return null;

        return {
            employeeId: employee.id,
            employeeName: employee.name,
            employeeNumber: employee.number,
            loans,
            total: round2(loans.reduce((sum, loan) => sum + loan.balance, 0))
        };
    }).filter(Boolean);
}

/**
 * Apply the temporary selection exactly once to preview rows.
 * `_montoBeforeLoans` makes this idempotent even if a derived row is passed in.
 */
export function applyPayrollLoanDeductions(rows, employees, selection) {
    const resolvedByEmployee = new Map(
        resolvePayrollLoanSelection(employees, selection).map(item => [item.employeeId, item])
    );

    return (rows || []).map(row => {
        const baseAmount = Number(row._montoBeforeLoans ?? row.monto) || 0;
        const selected = resolvedByEmployee.get(row._employeeId);
        const loanAmount = selected?.total || 0;
        const finalAmount = loanAmount > 0 ? baseAmount - loanAmount : baseAmount;

        return {
            ...row,
            monto: finalAmount,
            _montoBeforeLoans: baseAmount,
            _loans: loanAmount,
            _loanDetails: selected?.loans || [],
            _invalidLoanNet: loanAmount > 0 && finalAmount <= 0
        };
    });
}

export function summarizePayrollLoans(employees, selection) {
    const eligibleByKey = new Map();
    for (const employee of (employees || [])) {
        for (const loan of getEligiblePayrollLoans(employee)) {
            const key = `${String(employee.id)}:${String(loan.loanId)}`;
            if (!eligibleByKey.has(key)) eligibleByKey.set(key, loan);
        }
    }
    const selectedKeys = new Set();
    for (const item of (selection || [])) {
        for (const loanId of (item.loanIds || [])) {
            const key = `${String(item.employeeId)}:${String(loanId)}`;
            if (eligibleByKey.has(key)) selectedKeys.add(key);
        }
    }
    const eligible = [...eligibleByKey.values()];
    const selected = [...selectedKeys].map(key => eligibleByKey.get(key));
    return {
        eligibleCount: eligible.length,
        selectedCount: selected.length,
        selectedInterest: round2(selected.reduce((sum, loan) => sum + loan.interest, 0)),
        selectedBalance: round2(selected.reduce((sum, loan) => sum + loan.balance, 0)),
        eligibleInterest: round2(eligible.reduce((sum, loan) => sum + loan.interest, 0)),
        eligibleTotalDue: round2(eligible.reduce((sum, loan) => sum + loan.totalDue, 0)),
        eligibleBalance: round2(eligible.reduce((sum, loan) => sum + loan.balance, 0))
    };
}

export function getInvalidPayrollLoanRows(rows) {
    return (rows || []).filter(row => row._invalidLoanNet);
}

export function toSplitXRows(rows) {
    return (rows || []).map(row => ({
        id: row.id,
        nombre: row.nombre,
        monto: Number(row.monto) || 0,
        bruto: Number(row._brutoOriginal) || 0,
        bonificaciones: Number(row._bonuses) || 0,
        descuentos: Number(row._deductions) || 0,
        prestamos: Number(row._loans) || 0
    }));
}

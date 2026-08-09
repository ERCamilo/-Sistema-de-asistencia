import {
    getBalance,
    getActiveLoanTerms,
    getPayrollDeductionOptions,
    getTotalDue,
    getTotalInterestAccrued,
    INSTALLMENT_MODE,
    LOAN_STATUS,
    round2
} from '../loans/LoansService.js';

/**
 * Pure helpers for the temporary payroll-loan selection.
 *
 * The selection stores loan IDs plus a consecutive charge count. Loan balances
 * remain the source of truth and copying/downloading payroll never records
 * payments or mutates employee data.
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

export function getEligiblePayrollLoans(employee, periodEnd = null) {
    return (employee?.loans || [])
        .filter(loan => loan.status === LOAN_STATUS.ACTIVE && getBalance(loan) > 0)
        .map(loan => {
            const chargeOptions = getPayrollDeductionOptions(loan, periodEnd);
            const terms = getActiveLoanTerms(loan);
            const isInstallments = terms.installmentMode === INSTALLMENT_MODE.INSTALLMENTS;
            return {
                loanId: loan.id,
                concept: loan.concept || 'Préstamo',
                installmentMode: isInstallments ? INSTALLMENT_MODE.INSTALLMENTS : INSTALLMENT_MODE.LUMP,
                totalDue: getTotalDue(loan),
                interest: getTotalInterestAccrued(loan),
                balance: getBalance(loan),
                chargeOptions,
                maxChargeCount: chargeOptions.length,
                defaultChargeCount: chargeOptions.length > 0 ? 1 : 0
            };
        })
        .filter(loan => loan.maxChargeCount > 0);
}

export function buildPayrollLoanSelection(employees, periodEnd = null) {
    return (employees || []).map(employee => {
        const loans = getEligiblePayrollLoans(employee, periodEnd)
            .filter(loan => loan.defaultChargeCount > 0)
            .map(loan => ({
                loanId: loan.loanId,
                chargeCount: loan.defaultChargeCount
            }));
        return {
            employeeId: employee.id,
            loans,
            loanIds: loans.map(loan => loan.loanId)
        };
    }).filter(item => item.loans.length > 0);
}

export function removeEmployeePayrollLoans(selection, employeeId) {
    const normalizedEmployeeId = String(employeeId);
    return (selection || []).filter(item => String(item.employeeId) !== normalizedEmployeeId);
}

function getRequestedLoanSelections(item) {
    const source = Array.isArray(item?.loans)
        ? item.loans
        : (item?.loanIds || []).map(loanId => ({ loanId, chargeCount: 1 }));
    const byId = new Map();
    for (const entry of source) {
        const loanId = typeof entry === 'object' ? entry?.loanId : entry;
        if (loanId === null || loanId === undefined || String(loanId) === '') continue;
        const chargeCount = Math.max(0, Math.trunc(Number(
            typeof entry === 'object' ? entry?.chargeCount : 1
        ) || 0));
        if (chargeCount <= 0) continue;
        const key = String(loanId);
        const previous = byId.get(key);
        if (!previous || chargeCount > previous.chargeCount) {
            byId.set(key, { loanId, chargeCount });
        }
    }
    return [...byId.values()];
}

export function setEmployeePayrollLoans(selection, employeeId, loans = []) {
    const normalizedEmployeeId = String(employeeId);
    const normalizedLoans = getRequestedLoanSelections({ loans });
    const next = removeEmployeePayrollLoans(selection, normalizedEmployeeId);
    if (normalizedLoans.length === 0) return next;
    return [...next, {
        employeeId,
        loans: normalizedLoans,
        loanIds: normalizedLoans.map(loan => loan.loanId)
    }];
}

export function togglePayrollLoan(selection, employeeId, loanId, selected) {
    const current = (selection || []).find(item => String(item.employeeId) === String(employeeId));
    const loans = new Map(getRequestedLoanSelections(current).map(item => [String(item.loanId), item]));
    if (selected) loans.set(String(loanId), { loanId, chargeCount: 1 });
    else loans.delete(String(loanId));
    return setEmployeePayrollLoans(selection, employeeId, [...loans.values()]);
}

export function setPayrollLoanChargeCount(selection, employeeId, loanId, chargeCount) {
    const current = (selection || []).find(item => String(item.employeeId) === String(employeeId));
    const loans = new Map(getRequestedLoanSelections(current).map(item => [String(item.loanId), item]));
    const normalizedCount = Math.max(0, Math.trunc(Number(chargeCount) || 0));
    if (normalizedCount > 0) {
        loans.set(String(loanId), { loanId, chargeCount: normalizedCount });
    } else {
        loans.delete(String(loanId));
    }
    return setEmployeePayrollLoans(selection, employeeId, [...loans.values()]);
}

export function resolvePayrollLoanSelection(employees, selection, periodEnd = null) {
    const employeesById = new Map((employees || []).map(employee => [String(employee.id), employee]));
    const requestedByEmployee = new Map();

    for (const item of (selection || [])) {
        const employeeKey = String(item.employeeId);
        const current = requestedByEmployee.get(employeeKey) || new Map();
        for (const requested of getRequestedLoanSelections(item)) {
            const loanKey = String(requested.loanId);
            const previous = current.get(loanKey);
            if (!previous || requested.chargeCount > previous.chargeCount) {
                current.set(loanKey, requested);
            }
        }
        requestedByEmployee.set(employeeKey, current);
    }

    return [...requestedByEmployee.entries()].map(([employeeKey, requestedLoans]) => {
        const employee = employeesById.get(employeeKey);
        if (!employee) return null;

        const loans = getEligiblePayrollLoans(employee, periodEnd).map(loan => {
            const requested = requestedLoans.get(String(loan.loanId));
            if (!requested) return null;
            const selectedChargeCount = Math.min(requested.chargeCount, loan.maxChargeCount);
            const selectedCharges = loan.chargeOptions.slice(0, selectedChargeCount);
            if (selectedCharges.length === 0) return null;
            return {
                ...loan,
                selectedChargeCount: selectedCharges.length,
                selectedCharges,
                selectedAmount: round2(selectedCharges.reduce((sum, charge) => sum + charge.amount, 0)),
                firstInstallmentSeq: selectedCharges[0].installmentSeq,
                lastInstallmentSeq: selectedCharges[selectedCharges.length - 1].installmentSeq
            };
        }).filter(Boolean);
        if (loans.length === 0) return null;

        return {
            employeeId: employee.id,
            employeeName: employee.name,
            employeeNumber: employee.number,
            loans,
            total: round2(loans.reduce((sum, loan) => sum + loan.selectedAmount, 0))
        };
    }).filter(Boolean);
}

/**
 * Apply the temporary selection exactly once to preview rows.
 * `_montoBeforeLoans` makes this idempotent even if a derived row is passed in.
 */
export function applyPayrollLoanDeductions(rows, employees, selection, periodEnd = null) {
    const resolvedByEmployee = new Map(
        resolvePayrollLoanSelection(employees, selection, periodEnd)
            .map(item => [String(item.employeeId), item])
    );

    return (rows || []).map(row => {
        const baseAmount = Number(row._montoBeforeLoans ?? row.monto) || 0;
        const selected = resolvedByEmployee.get(String(row._employeeId));
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

export function summarizePayrollLoans(employees, selection, periodEnd = null) {
    const eligibleByKey = new Map();
    for (const employee of (employees || [])) {
        for (const loan of getEligiblePayrollLoans(employee, periodEnd)) {
            const key = `${String(employee.id)}:${String(loan.loanId)}`;
            if (!eligibleByKey.has(key)) eligibleByKey.set(key, loan);
        }
    }
    const eligible = [...eligibleByKey.values()];
    const selected = resolvePayrollLoanSelection(employees, selection, periodEnd)
        .flatMap(item => item.loans);
    return {
        eligibleCount: eligible.length,
        selectedCount: selected.length,
        eligibleChargeCount: eligible.reduce((sum, loan) => sum + loan.maxChargeCount, 0),
        selectedChargeCount: selected.reduce((sum, loan) => sum + loan.selectedChargeCount, 0),
        selectedInterest: round2(selected.reduce((sum, loan) => sum + loan.interest, 0)),
        selectedBalance: round2(selected.reduce((sum, loan) => sum + loan.selectedAmount, 0)),
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

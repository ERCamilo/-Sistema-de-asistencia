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
import { replayLoan } from '../loans/LoanTimeline.js';

/**
 * Cuánto se descuenta a un empleado en esta nómina (paso 4):
 *   all       todo lo seleccionado (cuotas o saldo), como siempre
 *   interest  solo el interés pendiente de los préstamos marcados
 *   custom    un monto escrito a mano
 * «Solo interés» y «otro monto» se reparten igual que un abono a la cuenta:
 * primero el interés de todos los préstamos marcados y después el capital del
 * más viejo, sin pasar de lo que se cobraría en esta nómina por préstamo.
 */
export const PAYROLL_LOAN_MODE = Object.freeze({ ALL: 'all', INTEREST: 'interest', CUSTOM: 'custom' });
const MODES = new Set(Object.values(PAYROLL_LOAN_MODE));

/**
 * Pure helpers for the temporary payroll-loan selection.
 *
 * The selection stores loan IDs plus a consecutive charge count. Loan balances
 * remain the source of truth and copying/downloading payroll never records
 * payments or mutates employee data.
 */

export function calculatePayrollBeforeLoans(
    payrollService,
    employeeId,
    periodStart,
    periodEnd,
    deductions,
    bonuses,
    adjustmentSelections = []
) {
    return payrollService.calculateEmployeePayroll(
        employeeId,
        periodStart,
        periodEnd,
        deductions,
        bonuses,
        [],
        adjustmentSelections
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

/** Modo y monto guardados para el empleado ({ mode: 'all' } si no hay). */
export function getPayrollLoanMode(selection, employeeId) {
    const item = (selection || []).find(entry => String(entry.employeeId) === String(employeeId));
    const mode = MODES.has(item?.mode) ? item.mode : PAYROLL_LOAN_MODE.ALL;
    return { mode, amount: mode === PAYROLL_LOAN_MODE.CUSTOM ? round2(Math.max(0, Number(item?.amount) || 0)) : null };
}

/**
 * @param {object} [options]  { mode, amount }: si no se pasa, se conserva el del empleado.
 */
export function setEmployeePayrollLoans(selection, employeeId, loans = [], options = {}) {
    const normalizedEmployeeId = String(employeeId);
    const normalizedLoans = getRequestedLoanSelections({ loans });
    const previous = getPayrollLoanMode(selection, normalizedEmployeeId);
    const next = removeEmployeePayrollLoans(selection, normalizedEmployeeId);
    if (normalizedLoans.length === 0) return next;
    const mode = MODES.has(options.mode) ? options.mode : previous.mode;
    const amount = mode === PAYROLL_LOAN_MODE.CUSTOM
        ? round2(Math.max(0, Number(options.amount ?? previous.amount) || 0))
        : null;
    return [...next, {
        employeeId,
        loans: normalizedLoans,
        loanIds: normalizedLoans.map(loan => loan.loanId),
        ...(mode !== PAYROLL_LOAN_MODE.ALL ? { mode, amount } : {})
    }];
}

/** Cambia cuánto se descuenta al empleado sin tocar qué préstamos están marcados. */
export function setPayrollLoanMode(selection, employeeId, mode, amount = null) {
    const current = (selection || []).find(item => String(item.employeeId) === String(employeeId));
    if (!current) return selection || [];
    return setEmployeePayrollLoans(selection, employeeId, getRequestedLoanSelections(current), {
        mode: MODES.has(mode) ? mode : PAYROLL_LOAN_MODE.ALL,
        amount
    });
}

/** Interés pendiente de un préstamo (el abono paga primero el interés). */
export function getPayrollLoanPendingInterest(loan) {
    return pendingInterest(loan);
}

function pendingInterest(loan) {
    const last = replayLoan(loan).steps.at(-1);
    return round2(Math.max(0, last ? last.interestAfter : 0));
}

/**
 * Reparte el monto del modo entre los préstamos resueltos (ya con su monto
 * completo de esta nómina en `selectedAmount`). Devuelve los mismos préstamos
 * con `fullAmount`, `interestPart`, `capitalPart` y el nuevo `selectedAmount`.
 */
export function distributePayrollLoanAmount(loans, { mode = PAYROLL_LOAN_MODE.ALL, amount = null } = {}, loanById = new Map()) {
    const items = loans.map(item => {
        const loan = loanById.get(String(item.loanId));
        const full = round2(item.selectedAmount);
        const interest = Math.min(full, loan ? pendingInterest(loan) : 0);
        return { item, loan, full, interest, startDate: loan?.startDate || '' };
    });
    const totalFull = round2(items.reduce((t, x) => t + x.full, 0));
    const totalInterest = round2(items.reduce((t, x) => t + x.interest, 0));
    let target = mode === PAYROLL_LOAN_MODE.INTEREST ? totalInterest
        : mode === PAYROLL_LOAN_MODE.CUSTOM ? Math.min(Math.max(0, Number(amount) || 0), totalFull)
            : totalFull;
    target = round2(target);
    let left = target;
    const take = new Map(items.map(x => [x, { interest: 0, capital: 0 }]));
    const byAge = [...items].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    for (const x of byAge) { const v = round2(Math.min(x.interest, left)); take.get(x).interest = v; left = round2(left - v); }
    for (const x of byAge) {
        const room = round2(x.full - take.get(x).interest);
        const v = round2(Math.min(room, left));
        take.get(x).capital = v;
        left = round2(left - v);
    }
    return items.map(x => {
        const t = take.get(x);
        return {
            ...x.item,
            fullAmount: x.full,
            pendingInterest: x.interest,
            interestPart: t.interest,
            capitalPart: t.capital,
            selectedAmount: round2(t.interest + t.capital)
        };
    });
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

        const resolved = getEligiblePayrollLoans(employee, periodEnd).map(loan => {
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
        if (resolved.length === 0) return null;
        const choice = getPayrollLoanMode(selection, employee.id);
        const loanById = new Map((employee.loans || []).map(loan => [String(loan.id), loan]));
        const loans = distributePayrollLoanAmount(resolved, choice, loanById);

        return {
            employeeId: employee.id,
            employeeName: employee.name,
            employeeNumber: employee.number,
            mode: choice.mode,
            amount: choice.amount,
            loans,
            fullTotal: round2(loans.reduce((sum, loan) => sum + loan.fullAmount, 0)),
            interestTotal: round2(loans.reduce((sum, loan) => sum + loan.interestPart, 0)),
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
            _invalidLoanNet: loanAmount > 0 && round2(finalAmount) < 0
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
        .flatMap(item => item.loans)
        .filter(loan => loan.selectedAmount > 0.004);
    return {
        eligibleCount: eligible.length,
        selectedCount: selected.length,
        eligibleChargeCount: eligible.reduce((sum, loan) => sum + loan.maxChargeCount, 0),
        selectedChargeCount: selected.reduce((sum, loan) => sum + loan.selectedChargeCount, 0),
        selectedInterest: round2(selected.reduce((sum, loan) => sum + loan.interest, 0)),
        // Interés que se descuenta en esta nómina (el abono paga primero el interés).
        chargedInterest: round2(selected.reduce((sum, loan) => sum + (loan.interestPart ?? 0), 0)),
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
    return (rows || []).map(row => {
        const loanDetailsList = row._loanDetails || [];
        const loanAmount = Number(row._loans) || 0;
        
        let totalInterest = 0;
        let totalRemainingBalance = 0;
        let totalPrincipal = 0;

        if (loanDetailsList.length > 0) {
            loanDetailsList.forEach(l => {
                totalRemainingBalance += Number(l.balance) || 0;
                if (l.interestPart != null && l.capitalPart != null) {
                    totalInterest += Number(l.interestPart) || 0;
                    totalPrincipal += Number(l.capitalPart) || 0;
                    return;
                }
                const loanTotalDue = Number(l.totalDue) || Number(l.balance) || 0;
                const loanInterest = Number(l.interest) || 0;
                const selectedAmount = Number(l.selectedAmount) || 0;
                if (loanInterest > 0 && loanTotalDue > 0) {
                    const interestRatio = Math.min(1, Math.max(0, loanInterest / loanTotalDue));
                    const chargeInterest = round2(selectedAmount * interestRatio);
                    totalInterest += chargeInterest;
                    totalPrincipal += round2(selectedAmount - chargeInterest);
                } else {
                    totalPrincipal += selectedAmount;
                }
            });
            totalInterest = round2(totalInterest);
            totalPrincipal = round2(totalPrincipal);
            totalRemainingBalance = round2(totalRemainingBalance);
        } else if (loanAmount > 0) {
            totalPrincipal = loanAmount;
        }

        return {
            id: row.id,
            nombre: row.nombre,
            monto: Number(row.monto) || 0,
            bruto: Number(row._brutoOriginal) || 0,
            bonificaciones: Number(row._bonuses) || 0,
            descuentos: Number(row._deductions) || 0,
            prestamos: loanAmount,
            prestamoCapital: totalPrincipal,
            prestamoInteres: totalInterest,
            saldoPendiente: totalRemainingBalance,
            loanDetails: {
                principal: totalPrincipal,
                interestAmount: totalInterest,
                remainingBalance: totalRemainingBalance
            }
        };
    });
}

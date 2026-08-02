import { round2 } from '../loans/LoansService.js';

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

function money(value) {
    return round2(Number(value) || 0);
}

function canonicalCharge(charge = {}) {
    return {
        kind: text(charge.kind),
        amount: money(charge.amount),
        installmentSeq: Number.isFinite(Number(charge.installmentSeq))
            ? Number(charge.installmentSeq)
            : null,
        dueDate: text(charge.dueDate)
    };
}

function canonicalLoan(loan = {}) {
    return {
        loanId: text(loan.loanId),
        selectedAmount: money(loan.selectedAmount),
        charges: (loan.selectedCharges || [])
            .map(canonicalCharge)
            .sort((a, b) => {
                const seqA = a.installmentSeq ?? Number.MAX_SAFE_INTEGER;
                const seqB = b.installmentSeq ?? Number.MAX_SAFE_INTEGER;
                return seqA - seqB || a.dueDate.localeCompare(b.dueDate) || a.amount - b.amount;
            })
    };
}

function canonicalRow(row = {}) {
    return {
        employeeId: text(row._employeeId),
        number: text(row._number ?? row.id),
        gross: money(row._brutoOriginal),
        bonuses: money(row._bonuses),
        deductions: money(row._deductions),
        loans: money(row._loans),
        net: money(row.monto),
        loanDetails: (row._loanDetails || [])
            .map(canonicalLoan)
            .sort((a, b) => a.loanId.localeCompare(b.loanId))
    };
}

/**
 * Canonical, collision-free identity for the exact payroll preview confirmed by
 * the operator. It intentionally stores the canonical JSON instead of a short
 * hash: equality is the only operation and accounting state must not rely on a
 * probabilistic collision boundary.
 */
export function buildPayrollPreviewFingerprint({ periodStart, periodEnd, rows } = {}) {
    const canonicalRows = (rows || [])
        .map(canonicalRow)
        .sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.number.localeCompare(b.number));
    return JSON.stringify({
        periodStart: text(periodStart),
        periodEnd: text(periodEnd),
        rows: canonicalRows
    });
}

export function confirmPayrollPaid(fingerprint, confirmedAt = Date.now()) {
    if (!fingerprint || typeof fingerprint !== 'string') {
        throw new Error('No se puede confirmar una nómina sin vista previa');
    }
    return {
        fingerprint,
        confirmedAt: Number(confirmedAt) || Date.now()
    };
}

export function getPayrollLoanSettlementGate({
    rows = [],
    fingerprint = '',
    paidConfirmation = null,
    settledBatch = null
} = {}) {
    const hasLoans = rows.some(row => money(row?._loans) > 0);
    const invalidCount = rows.filter(row => money(row?.monto) <= 0).length;
    const payrollPaid = Boolean(
        fingerprint && paidConfirmation?.fingerprint === fingerprint
    );
    const alreadySettled = Boolean(
        settledBatch &&
        settledBatch.voided !== true &&
        settledBatch.previewFingerprint === fingerprint
    );

    let reason = null;
    if (!hasLoans) reason = 'no-loans';
    else if (invalidCount > 0) reason = 'invalid-net';
    else if (!payrollPaid) reason = 'payroll-not-confirmed';
    else if (alreadySettled) reason = 'already-settled';

    return {
        enabled: reason === null,
        hasLoans,
        invalidCount,
        payrollPaid,
        alreadySettled,
        reason
    };
}

export default {
    buildPayrollPreviewFingerprint,
    confirmPayrollPaid,
    getPayrollLoanSettlementGate
};

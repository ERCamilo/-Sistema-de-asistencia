import {
    buildPayrollPreviewFingerprint,
    confirmPayrollPaid,
    getPayrollLoanSettlementGate
} from '../modules/features/payroll/PayrollLoanSettlement.js';

function row(overrides = {}) {
    return {
        id: 7,
        _employeeId: 'emp-7',
        _employeeName: 'Ana Pérez',
        _number: '7',
        _brutoOriginal: 1200,
        _bonuses: 0,
        _deductions: 100,
        _loans: 250,
        monto: 850,
        _loanDetails: [{
            loanId: 'loan-1',
            concept: 'Botas',
            selectedAmount: 250,
            selectedCharges: [{ amount: 250, installmentSeq: 1, dueDate: '2026-08-16' }]
        }],
        ...overrides
    };
}

describe('Payroll loan settlement gate', () => {
    test('enables only when loans exist, every net is positive and this exact preview was paid', () => {
        const rows = [row()];
        const fingerprint = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-23',
            rows
        });
        const paidConfirmation = confirmPayrollPaid(fingerprint, 1234);

        expect(getPayrollLoanSettlementGate({ rows, fingerprint, paidConfirmation })).toEqual({
            enabled: true,
            hasLoans: true,
            invalidCount: 0,
            payrollPaid: true,
            alreadySettled: false,
            reason: null
        });
        expect(paidConfirmation).toEqual({ fingerprint, confirmedAt: 1234 });
    });

    test('rejects a stale payroll-paid confirmation after any preview amount changes', () => {
        const originalRows = [row()];
        const originalFingerprint = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-23',
            rows: originalRows
        });
        const changedFingerprint = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-23',
            rows: [row({ monto: 900, _bonuses: 50 })]
        });

        const gate = getPayrollLoanSettlementGate({
            rows: originalRows,
            fingerprint: changedFingerprint,
            paidConfirmation: confirmPayrollPaid(originalFingerprint, 1234)
        });

        expect(changedFingerprint).not.toBe(originalFingerprint);
        expect(gate.enabled).toBe(false);
        expect(gate.payrollPaid).toBe(false);
        expect(gate.reason).toBe('payroll-not-confirmed');
    });

    test.each([
        { rows: [row({ _loans: 0, _loanDetails: [] })], reason: 'no-loans' },
        { rows: [row({ monto: 0 })], reason: 'invalid-net' },
        { rows: [row({ monto: -0.01 })], reason: 'invalid-net' }
    ])('blocks $reason', ({ rows, reason }) => {
        const fingerprint = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-23',
            rows
        });
        const gate = getPayrollLoanSettlementGate({
            rows,
            fingerprint,
            paidConfirmation: confirmPayrollPaid(fingerprint, 1234)
        });

        expect(gate.enabled).toBe(false);
        expect(gate.reason).toBe(reason);
    });

    test('uses stable employee ordering but detects a different loan charge selection', () => {
        const second = row({ id: 8, _employeeId: 'emp-8', _number: '8' });
        const first = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-23',
            rows: [row(), second]
        });
        const reordered = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-23',
            rows: [second, row()]
        });
        const changedCharge = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-23',
            rows: [row({
                _loans: 500,
                monto: 600,
                _loanDetails: [{
                    loanId: 'loan-1',
                    concept: 'Botas',
                    selectedAmount: 500,
                    selectedCharges: [
                        { amount: 250, installmentSeq: 1, dueDate: '2026-08-16' },
                        { amount: 250, installmentSeq: 2, dueDate: '2026-08-30' }
                    ]
                }]
            }), second]
        });

        expect(reordered).toBe(first);
        expect(changedCharge).not.toBe(first);
    });

    test('blocks a preview that already has an active settlement batch', () => {
        const rows = [row()];
        const fingerprint = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-23',
            rows
        });
        const gate = getPayrollLoanSettlementGate({
            rows,
            fingerprint,
            paidConfirmation: confirmPayrollPaid(fingerprint, 1234),
            settledBatch: { previewFingerprint: fingerprint, voided: false }
        });

        expect(gate.enabled).toBe(false);
        expect(gate.alreadySettled).toBe(true);
        expect(gate.reason).toBe('already-settled');
    });
});

import {
    buildPayrollClosureDraft,
    getEffectivePayrollClosures,
    getPayrollClosureGate,
    undoPayrollClosureEffects
} from '../modules/features/payroll/PayrollClosureWorkflow.js';
import { confirmPayrollPaid } from '../modules/features/payroll/PayrollLoanSettlement.js';
import { applyPayrollLoanSettlementBatch } from '../modules/features/payroll/PayrollLoanSettlement.js';

function employee({ withLoan = false } = {}) {
    return {
        id: 'employee-1',
        number: '1',
        name: 'Ada',
        loans: withLoan ? [{
            id: 'loan-1',
            concept: 'Botas',
            principal: 100,
            total: 100,
            status: 'active',
            installmentMode: 'lump',
            payments: [],
            startDate: '2026-08-01',
            createdAt: 1
        }] : []
    };
}

function row({ withLoan = false, net = 1000 } = {}) {
    return {
        id: 1,
        nombre: 'Ada',
        monto: net,
        _brutoOriginal: withLoan ? 1100 : 1000,
        _bonuses: 0,
        _deductions: 0,
        _loans: withLoan ? 100 : 0,
        _employeeId: 'employee-1',
        _employeeName: 'Ada',
        _employeePosition: 'Operadora',
        _number: '1',
        _loanDetails: withLoan ? [{
            loanId: 'loan-1',
            concept: 'Botas',
            installmentMode: 'single',
            balance: 100,
            selectedAmount: 100,
            selectedCharges: [{
                kind: 'lump',
                amount: 100,
                dueDate: '2026-08-01'
            }]
        }] : []
    };
}

function draft(options = {}) {
    const withLoan = Boolean(options.withLoan);
    return buildPayrollClosureDraft({
        employees: [employee({ withLoan })],
        rows: [row({ withLoan })],
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        periodSource: 'configured',
        closedAt: options.closedAt || 100,
        closedBy: 'operator',
        supersedesId: options.supersedesId || null
    });
}

describe('Unified payroll closure workflow', () => {
    test('enables a paid valid payroll even when it has no loans', () => {
        const current = draft();
        expect(getPayrollClosureGate({
            rows: [row()],
            fingerprint: current.closure.fingerprint,
            paidConfirmation: confirmPayrollPaid(current.closure.fingerprint, 10),
            activeClosures: []
        })).toMatchObject({ enabled: true, hasLoans: false, reason: null });
        expect(current.batch).toBeNull();
        expect(current.closure.loanSettlementBatchId).toBeNull();
    });

    test.each([
        [[], 'no-rows'],
        [[row({ net: 0 })], 'invalid-net']
    ])('blocks invalid payroll rows', (rows, reason) => {
        expect(getPayrollClosureGate({
            rows,
            fingerprint: 'fingerprint',
            paidConfirmation: confirmPayrollPaid('fingerprint', 10),
            activeClosures: []
        })).toMatchObject({ enabled: false, reason });
    });

    test('links the optional loan batch and every payment reference to the closure', () => {
        const current = draft({ withLoan: true });
        expect(current.batch.closureId).toBe(current.closure.id);
        expect(current.closure.loanSettlementBatchId).toBe(current.batch.id);
        expect(current.closure.paymentRefs).toEqual(current.batch.paymentRefs);
    });

    test('blocks an exact duplicate and requires explicit correction for changed content', () => {
        const original = draft().closure;
        expect(getPayrollClosureGate({
            rows: [row()],
            fingerprint: original.fingerprint,
            paidConfirmation: confirmPayrollPaid(original.fingerprint, 10),
            activeClosures: [original]
        })).toMatchObject({ enabled: false, reason: 'already-closed' });

        const changedFingerprint = `${original.fingerprint}-changed`;
        expect(getPayrollClosureGate({
            rows: [row()],
            fingerprint: changedFingerprint,
            paidConfirmation: confirmPayrollPaid(changedFingerprint, 10),
            activeClosures: [original]
        })).toMatchObject({ enabled: false, reason: 'correction-required' });
        expect(getPayrollClosureGate({
            rows: [row()],
            fingerprint: changedFingerprint,
            paidConfirmation: confirmPayrollPaid(changedFingerprint, 10),
            activeClosures: [original],
            correctionSupersedesId: original.id
        })).toMatchObject({ enabled: true, reason: null });
    });

    test('uses only the leaf closure of a correction chain as the active period closure', () => {
        const original = draft().closure;
        const correction = {
            ...draft({ closedAt: 200 }).closure,
            id: 'correction-id',
            fingerprint: 'correction-fingerprint',
            supersedesId: original.id
        };
        expect(getEffectivePayrollClosures([original, correction]).map(item => item.id))
            .toEqual([correction.id]);
    });

    test('undo voids a closure without loans without inventing payments', () => {
        const noLoans = draft().closure;
        expect(undoPayrollClosureEffects([employee()], noLoans, {
            now: 110,
            voidedBy: 'operator'
        })).toMatchObject({
            closure: { status: 'voided', voidedBy: 'operator' },
            voidedPaymentCount: 0
        });
    });

    test('reclosing an undone payroll creates a successor instead of reviving its audit record', () => {
        const original = draft().closure;
        const voided = undoPayrollClosureEffects([employee()], original, {
            now: 110,
            voidedBy: 'operator'
        }).closure;
        const gate = getPayrollClosureGate({
            rows: [row()],
            fingerprint: original.fingerprint,
            paidConfirmation: confirmPayrollPaid(original.fingerprint, 120),
            activeClosures: [voided]
        });

        expect(gate).toMatchObject({
            enabled: true,
            activeClosure: null,
            nextSupersedesId: original.id
        });
        const replacement = draft({ closedAt: 120, supersedesId: gate.nextSupersedesId }).closure;
        expect(replacement.id).not.toBe(original.id);
        expect(replacement.supersedesId).toBe(original.id);
    });

    test('linked loan payments carry the closure id and are voided with the closure', () => {
        const employees = [employee({ withLoan: true })];
        const current = buildPayrollClosureDraft({
            employees,
            rows: [row({ withLoan: true })],
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            closedAt: 100,
            closedBy: 'operator'
        });
        applyPayrollLoanSettlementBatch(employees, current.batch, { now: 100 });
        expect(employees[0].loans[0].payments[0].payrollClosureId)
            .toBe(current.closure.id);

        const undone = undoPayrollClosureEffects(employees, current.closure, {
            now: 110,
            voidedBy: 'operator'
        });
        expect(undone.voidedPaymentCount).toBe(1);
        expect(employees[0].loans[0].payments[0].voided).toBe(true);
        expect(undone.closure.status).toBe('voided');
    });
});

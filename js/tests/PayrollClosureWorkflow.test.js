import {
    applyPayrollClosureEffects,
    buildPayrollClosureDraft,
    getEffectivePayrollClosures,
    getPayrollClosureGate,
    undoPayrollClosureEffects
} from '../modules/features/payroll/PayrollClosureWorkflow.js';
import {
    buildPayrollPreviewFingerprint,
    confirmPayrollPaid
} from '../modules/features/payroll/PayrollLoanSettlement.js';
import { applyPayrollLoanSettlementBatch } from '../modules/features/payroll/PayrollLoanSettlement.js';
import {
    ADJUSTMENT_PLAN_KIND,
    createPayrollAdjustmentInstallmentPlans
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import {
    buildPayrollAdjustmentInstallmentPreview
} from '../modules/features/payroll/PayrollAdjustmentInstallmentSettlement.js';

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
        [[row({ net: -0.01 })], 'invalid-net']
    ])('blocks invalid payroll rows', (rows, reason) => {
        expect(getPayrollClosureGate({
            rows,
            fingerprint: 'fingerprint',
            paidConfirmation: confirmPayrollPaid('fingerprint', 10),
            activeClosures: []
        })).toMatchObject({ enabled: false, reason });
    });

    test('permite continuar con un pago exactamente en cero para revisarlo como advertencia', () => {
        expect(getPayrollClosureGate({
            rows: [row({ net: 0 })],
            fingerprint: 'fingerprint',
            paidConfirmation: confirmPayrollPaid('fingerprint', 10),
            activeClosures: []
        })).toMatchObject({ enabled: true, invalidCount: 0, reason: null });
    });

    test('links the optional loan batch and every payment reference to the closure', () => {
        const current = draft({ withLoan: true });
        expect(current.batch.closureId).toBe(current.closure.id);
        expect(current.closure.loanSettlementBatchId).toBe(current.batch.id);
        expect(current.closure.paymentRefs).toEqual(current.batch.paymentRefs);
    });

    test('freezes applied adjustment rules and reports their reversal with the closure', () => {
        const adjustedRow = {
            ...row(),
            _bonuses: 50,
            _deductions: 20,
            _brutoOriginal: 1000,
            monto: 1030,
            _bonusDetails: [{ id: 'BON-1', name: 'Premio', amount: 50 }],
            _deductionDetails: [{ id: 'DED-1', name: 'Equipo', amount: 20 }]
        };
        const current = buildPayrollClosureDraft({
            employees: [employee()],
            rows: [adjustedRow],
            bonuses: [{ id: 'BON-1', name: 'Premio', type: 'fixed', value: 50 }],
            deductions: [{ id: 'DED-1', name: 'Equipo', type: 'fixed', value: 20 }],
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            closedAt: 100
        });

        expect(current.closure.adjustments).toMatchObject({
            bonuses: [{ id: 'BON-1', remembered: false }],
            deductions: [{ id: 'DED-1', remembered: false }]
        });
        expect(undoPayrollClosureEffects([employee()], current.closure, { now: 110 }))
            .toMatchObject({ voidedBonusCount: 1, voidedDeductionCount: 1 });
    });

    test('applies and reopens installment effects through the canonical closure identity', () => {
        let serial = 0;
        const plan = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['employee-1'],
            name: 'Uniforme',
            totalAmount: 90,
            installmentCount: 3,
            firstPeriodStart: '2026-08-01',
            createdAt: 50
        }, { createId: prefix => `${prefix}-${++serial}` })[0];
        const employees = [{ ...employee(), bonuses: [], deductions: [plan] }];
        const preview = buildPayrollAdjustmentInstallmentPreview(employees[0], {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });
        const payrollRow = {
            ...row(),
            _deductions: preview.deductionTotal,
            _deductionDetails: preview.deductionDetails,
            monto: 1000 - preview.deductionTotal
        };
        const current = buildPayrollClosureDraft({
            employees,
            rows: [payrollRow],
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            closedAt: 100,
            closedBy: 'operator'
        });

        const applied = applyPayrollClosureEffects(employees, current, {
            now: 100, recordedBy: 'operator'
        });
        const undone = undoPayrollClosureEffects(employees, current.closure, {
            now: 110, voidedBy: 'operator'
        });

        expect(applied).toMatchObject({
            appliedInstallmentCount: 1,
            affectedEmployeeIds: ['employee-1']
        });
        expect(current.closure.rows[0].deductionDetails[0]).toMatchObject({
            planId: plan.id,
            payrollPeriodStart: '2026-08-01',
            payrollPeriodEnd: '2026-08-15'
        });
        expect(undone).toMatchObject({
            revertedInstallmentCount: 1,
            affectedEmployeeIds: ['employee-1']
        });
        expect(employees[0].deductions[0]).toMatchObject({
            status: 'active', balance: 90, appliedAmount: 0
        });
    });

    test('uses one canonical snapshot for confirmation identity and immutable closure rows', () => {
        const base = row({ withLoan: true });
        base._bonusDetails = [{ name: 'Productividad', amount: 25 }];
        base._deductionDetails = [{ name: 'Uniforme', amount: 10 }];
        const fingerprint = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [base]
        });
        const current = buildPayrollClosureDraft({
            employees: [employee({ withLoan: true })],
            rows: [base],
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15'
        });

        expect(JSON.parse(fingerprint).rows).toEqual(current.closure.rows);

        const mutations = [
            changed => { changed._employeeName = 'Ada Lovelace'; },
            changed => { changed._number = '99'; },
            changed => { changed._employeePosition = 'Supervisora'; },
            changed => { changed._bonusDetails[0].name = 'Asistencia'; },
            changed => { changed._deductionDetails[0].amount = 11; },
            changed => { changed._loanDetails[0].concept = 'Equipo'; },
            changed => { changed._loanDetails[0].installmentMode = 'installments'; },
            changed => { changed._loanDetails[0].balance = 90; },
            changed => { changed._loanDetails[0].selectedCharges[0].amount = 90; }
        ];
        for (const mutate of mutations) {
            const changed = JSON.parse(JSON.stringify(base));
            mutate(changed);
            expect(buildPayrollPreviewFingerprint({
                periodStart: '2026-08-01',
                periodEnd: '2026-08-15',
                rows: [changed]
            })).not.toBe(fingerprint);
        }

        const second = {
            ...JSON.parse(JSON.stringify(base)),
            _employeeId: 'employee-2',
            _number: '2'
        };
        const ordered = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01', periodEnd: '2026-08-15', rows: [base, second]
        });
        const reversed = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01', periodEnd: '2026-08-15', rows: [second, base]
        });
        expect(reversed).toBe(ordered);
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

    test('permits undo after a legacy undo deadline but rejects an already voided closure', () => {
        const original = draft().closure;
        const undone = undoPayrollClosureEffects([employee()], original, {
            now: original.undoUntil + 1,
            voidedBy: 'operator'
        });

        expect(undone.closure.status).toBe('voided');
        expect(() => undoPayrollClosureEffects([employee()], undone.closure, {
            now: undone.closure.undoUntil + 1
        })).toThrow(/anulado/i);
    });

    test('rejects undo when a closed successor preserves the active correction lineage', () => {
        const original = draft().closure;
        const successor = draft({ closedAt: 200, supersedesId: original.id }).closure;

        expect(() => undoPayrollClosureEffects([employee()], original, {
            activeClosures: [original, successor]
        })).toThrow(/corrección vigente/i);
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

    test('transfers a retained charge only to its explicit correction successor', () => {
        const employees = [employee({ withLoan: true })];
        const original = buildPayrollClosureDraft({
            employees,
            rows: [row({ withLoan: true })],
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            closedAt: 100,
            closedBy: 'operator'
        });
        applyPayrollLoanSettlementBatch(employees, original.batch, { now: 100 });
        const payment = employees[0].loans[0].payments[0];
        const audit = { recordedAt: payment.recordedAt, recordedBy: payment.recordedBy };
        const correctedRow = { ...row({ withLoan: true }), _bonuses: 25, monto: 1025 };
        const unrelated = buildPayrollClosureDraft({
            employees,
            rows: [correctedRow],
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            closedAt: 200,
            closedBy: 'operator'
        });

        expect(() => applyPayrollLoanSettlementBatch(employees, unrelated.batch, { now: 200 }))
            .toThrow(/otra nómina|vista previa/i);

        const correction = buildPayrollClosureDraft({
            employees,
            rows: [correctedRow],
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            closedAt: 200,
            closedBy: 'operator',
            supersedesId: original.closure.id
        });
        applyPayrollLoanSettlementBatch(employees, correction.batch, { now: 200 });

        expect(correction.batch.supersedesClosureId).toBe(original.closure.id);
        expect(employees[0].loans[0].payments).toEqual([payment]);
        expect(payment).toMatchObject({
            id: original.batch.paymentRefs[0].paymentId,
            amount: original.batch.items[0].amount,
            payrollIdempotencyKey: original.batch.items[0].idempotencyKey,
            payrollChargeKeys: original.batch.items[0].chargeKeys,
            payrollBatchId: correction.batch.id,
            payrollClosureId: correction.closure.id,
            payrollSupersedesClosureId: original.closure.id,
            ...audit
        });
        expect(payment.payrollBatchSnapshot).toMatchObject({
            id: correction.batch.id,
            closureId: correction.closure.id,
            supersedesClosureId: original.closure.id
        });

        const undone = undoPayrollClosureEffects(employees, correction.closure, {
            now: 210,
            voidedBy: 'operator'
        });
        expect(undone.voidedPaymentCount).toBe(1);
        expect(payment.voided).toBe(true);
        expect(employees[0].loans[0].payments).toHaveLength(1);
    });
});

import {
    applyPayrollLoanSettlementBatch,
    buildPayrollLoanSettlementBatch,
    undoPayrollLoanSettlementBatch
} from '../modules/features/payroll/PayrollLoanSettlement.js';
import {
    buildLegacyPayrollClosures,
    migrateLegacyPayrollClosures
} from '../modules/features/payroll/PayrollClosureMigration.js';
import { MAX_PAYROLL_CLOSURE_BYTES } from '../modules/features/payroll/PayrollClosureSize.js';

function employee() {
    return {
        id: 'employee-1', number: '1', name: 'Ada', loans: [{
            id: 'loan-1', concept: 'Botas', principal: 100, total: 100,
            status: 'active', installmentMode: 'lump', payments: [], startDate: '2026-08-01'
        }]
    };
}

function row() {
    return {
        id: 1, monto: 900, _brutoOriginal: 1000, _bonuses: 0, _deductions: 0, _loans: 100,
        _employeeId: 'employee-1', _employeeName: 'Ada', _employeePosition: 'Operadora', _number: '1',
        _loanDetails: [{ loanId: 'loan-1', selectedAmount: 100, selectedCharges: [{ kind: 'lump', amount: 100, dueDate: '2026-08-01' }] }]
    };
}

function legacyFixture({ voided = false } = {}) {
    const employees = [employee()];
    const batch = buildPayrollLoanSettlementBatch({
        employees,
        rows: [row()],
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        createdAt: 100,
        recordedBy: 'legacy-operator'
    });
    applyPayrollLoanSettlementBatch(employees, batch, { now: 100 });
    for (const payment of employees[0].loans[0].payments) {
        delete payment.payrollClosureId;
        if (payment.payrollBatchSnapshot) delete payment.payrollBatchSnapshot.closureId;
    }
    if (voided) undoPayrollLoanSettlementBatch(employees, batch.id, { now: 110, voidedBy: 'legacy-operator' });
    return employees;
}

describe('Legacy payroll closure migration', () => {
    test('reconstructs a complete legacy batch without changing its financial snapshot', () => {
        const result = buildLegacyPayrollClosures(legacyFixture());
        expect(result.skipped).toEqual([]);
        expect(result.closures).toHaveLength(1);
        expect(result.closures[0]).toMatchObject({
            status: 'closed',
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            closedBy: 'legacy-operator',
            loanSettlementBatchId: expect.stringMatching(/^PAYROLL-BATCH-/),
            migrationSource: 'legacy-payroll-loan-batch',
            totals: { loans: 100, net: 900 }
        });
    });

    test('preserves a legacy logical void', () => {
        const { closures } = buildLegacyPayrollClosures(legacyFixture({ voided: true }));
        expect(closures[0]).toMatchObject({
            status: 'voided',
            voidedBy: 'legacy-operator'
        });
    });

    test('skips partial cross-device batches instead of inventing history', () => {
        const employees = legacyFixture();
        employees[0].loans[0].payments[0].payrollExpectedPaymentCount = 2;
        const result = buildLegacyPayrollClosures(employees);
        expect(result.closures).toEqual([]);
        expect(result.skipped).toEqual([
            expect.objectContaining({ reason: 'incomplete' })
        ]);
    });

    test('isolates an oversized legacy batch so later migrations can continue', () => {
        const employees = legacyFixture();
        const snapshot = employees[0].loans[0].payments[0].payrollBatchSnapshot;
        snapshot.previewRows[0]._employeeName = 'x'.repeat(MAX_PAYROLL_CLOSURE_BYTES);

        const result = buildLegacyPayrollClosures(employees);

        expect(result.closures).toEqual([]);
        expect(result.skipped).toEqual([
            expect.objectContaining({ reason: 'oversized' })
        ]);
    });

    test('persists and queues each legacy closure only once', async () => {
        const records = new Map();
        const store = {
            getById: jest.fn(id => Promise.resolve(records.get(id) || null)),
            saveWithEmployees: jest.fn(async closure => {
                records.set(closure.id, closure);
                return closure;
            })
        };
        await expect(migrateLegacyPayrollClosures(legacyFixture(), { store, schemaVersion: 3 }))
            .resolves.toMatchObject({ migrated: 1, existing: 0 });
        await expect(migrateLegacyPayrollClosures(legacyFixture(), { store, schemaVersion: 3 }))
            .resolves.toMatchObject({ migrated: 0, existing: 1 });
        expect(store.saveWithEmployees).toHaveBeenCalledTimes(1);
        expect(store.saveWithEmployees).toHaveBeenCalledWith(
            expect.any(Object), [], { enqueueCloud: true, schemaVersion: 3 }
        );
    });
});

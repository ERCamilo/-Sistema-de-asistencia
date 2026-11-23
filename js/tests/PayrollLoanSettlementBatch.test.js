import {
    buildPayrollLoanSettlementBatch,
    activatePayrollLoanSettlementBatch,
    applyPayrollLoanSettlementBatch,
    findPayrollLoanSettlementBatch,
    getClosedPayrollPreviewRows,
    undoPayrollLoanSettlementBatch,
    PAYROLL_LOAN_UNDO_WINDOW_MS
} from '../modules/features/payroll/PayrollLoanSettlement.js';
import {
    createLoan,
    getBalance,
    getPayrollDeductionOptions,
    recordPayment
} from '../modules/features/loans/LoansService.js';

function employee(id, name) {
    return { id, number: id.replace(/\D/g, '') || id, name, loans: [], updatedAt: 1 };
}

function installmentLoan(emp, principal = 1000) {
    return createLoan(emp, {
        principal,
        interestRate: 0,
        startDate: '2026-08-02',
        concept: 'Equipo personal',
        installmentMode: 'installments',
        installmentCount: 4,
        installmentFrequencyWeeks: 2
    });
}

function payrollRow(emp, loan, chargeCount = 1, overrides = {}) {
    const selectedCharges = getPayrollDeductionOptions(loan, '2026-08-23').slice(0, chargeCount);
    const selectedAmount = selectedCharges.reduce((sum, charge) => sum + charge.amount, 0);
    return {
        id: Number(emp.number) || 0,
        nombre: `${emp.name} (Ref #${emp.number})`,
        monto: 1500 - selectedAmount,
        _brutoOriginal: 1500,
        _bonuses: 0,
        _deductions: 0,
        _loans: selectedAmount,
        _employeeId: emp.id,
        _employeeName: emp.name,
        _number: emp.number,
        _invalidLoanNet: false,
        _loanDetails: [{
            loanId: loan.id,
            concept: loan.concept,
            balance: getBalance(loan),
            selectedAmount,
            selectedCharges
        }],
        ...overrides
    };
}

function buildBatch(employees, rows, createdAt = 100_000) {
    return buildPayrollLoanSettlementBatch({
        employees,
        rows,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-23',
        createdAt,
        recordedBy: 'operator-1'
    });
}

describe('Payroll loan settlement batches', () => {
    test('builds a compact employee summary with remaining balances', () => {
        const emp = employee('emp-7', 'Ana Pérez');
        const loan = installmentLoan(emp);
        const rows = [payrollRow(emp, loan, 2)];
        const batch = buildBatch([emp], rows);

        expect(batch.total).toBe(500);
        expect(batch.employeeCount).toBe(1);
        expect(batch.undoUntil).toBe(100_000 + PAYROLL_LOAN_UNDO_WINDOW_MS);
        expect(batch.employees[0]).toMatchObject({
            employeeId: emp.id,
            employeeName: emp.name,
            paymentAmount: 500,
            remainingBalance: 500,
            hasFuturePayment: true
        });
        expect(batch.employees[0].loans[0].chargeCount).toBe(2);
        expect(batch.previewRows[0]).not.toHaveProperty('_positionBreakdown');
    });

    test('starts the undo window when the verified batch is activated, not when the modal opened', () => {
        const emp = employee('emp-7', 'Ana Pérez');
        const loan = installmentLoan(emp);
        const draft = buildBatch([emp], [payrollRow(emp, loan)], 100_000);

        const activated = activatePayrollLoanSettlementBatch(draft, 200_000);

        expect(activated.createdAt).toBe(200_000);
        expect(activated.undoUntil).toBe(200_000 + PAYROLL_LOAN_UNDO_WINDOW_MS);
        expect(activated.paymentDate).toBe(new Date(200_000).toISOString().slice(0, 10));
        expect(draft.createdAt).toBe(100_000);
    });

    test('records one deterministic payment per loan and replay does not duplicate it', () => {
        const emp = employee('emp-7', 'Ana Pérez');
        const loan = installmentLoan(emp);
        const batch = buildBatch([emp], [payrollRow(emp, loan, 2)]);

        const first = applyPayrollLoanSettlementBatch([emp], batch, { now: 100_100 });
        const replay = applyPayrollLoanSettlementBatch([emp], batch, { now: 100_200 });

        expect(first.createdCount).toBe(1);
        expect(first.restoredCount).toBe(0);
        expect(replay.createdCount).toBe(0);
        expect(replay.restoredCount).toBe(0);
        expect(loan.payments).toHaveLength(1);
        expect(loan.payments[0]).toMatchObject({
            amount: 500,
            source: 'payroll',
            payrollBatchId: batch.id,
            payrollPreviewFingerprint: batch.previewFingerprint,
            voided: false
        });
        expect(loan.payments[0].id).toMatch(/^PAYROLL-/);
        expect(loan.payments[0].payrollChargeKeys).toHaveLength(2);
        expect(loan.payments[0].payrollBatchSnapshot).not.toHaveProperty('items');
        expect(loan.payments[0].payrollBatchSnapshot.employees[0].loans[0])
            .toEqual({
                concept: 'Equipo personal',
                amount: 500,
                chargeCount: 2,
                remainingBalance: 500,
                hasFuturePayment: true
            });
        expect(getBalance(loan)).toBe(500);
    });

    test('does not adopt an existing charge payment into a different payroll preview', () => {
        const emp = employee('emp-7', 'Ana Pérez');
        const loan = installmentLoan(emp);
        const firstBatch = buildBatch([emp], [payrollRow(emp, loan)]);
        applyPayrollLoanSettlementBatch([emp], firstBatch, { now: 100_100 });
        const changedRow = payrollRow(emp, loan, 1, {
            _bonuses: 50,
            monto: 1300
        });
        // Preserve the already-paid charge identity to exercise the accounting
        // collision guard rather than the current-schedule guard.
        changedRow._loanDetails[0] = firstBatch.previewRows[0]._loanDetails[0];
        changedRow._loans = 250;
        const changedBatch = buildBatch([emp], [changedRow], 200_000);

        expect(changedBatch.previewFingerprint).not.toBe(firstBatch.previewFingerprint);
        expect(() => applyPayrollLoanSettlementBatch([emp], changedBatch, { now: 200_100 }))
            .toThrow(/otra nómina|vista previa/i);
        expect(loan.payments).toHaveLength(1);
    });

    test('revalidates every loan before mutation and leaves the whole batch untouched on conflict', () => {
        const firstEmp = employee('emp-1', 'Primera');
        const secondEmp = employee('emp-2', 'Segunda');
        const firstLoan = installmentLoan(firstEmp);
        const secondLoan = installmentLoan(secondEmp);
        const batch = buildBatch(
            [firstEmp, secondEmp],
            [payrollRow(firstEmp, firstLoan), payrollRow(secondEmp, secondLoan)]
        );
        recordPayment(secondEmp, secondLoan.id, {
            amount: 100,
            date: '2026-08-10',
            note: 'Pago externo'
        });

        expect(() => applyPayrollLoanSettlementBatch([firstEmp, secondEmp], batch, { now: 100_100 }))
            .toThrow(/cambió/i);
        expect(firstLoan.payments).toHaveLength(0);
        expect(secondLoan.payments).toHaveLength(1);
    });

    test('reconstructs the active batch and returns its frozen preview after a reload', () => {
        const emp = employee('emp-7', 'Ana Pérez');
        const loan = installmentLoan(emp);
        const rows = [payrollRow(emp, loan)];
        const batch = buildBatch([emp], rows);
        applyPayrollLoanSettlementBatch([emp], batch, { now: 100_100 });

        const restored = findPayrollLoanSettlementBatch([emp], {
            periodStart: batch.periodStart,
            periodEnd: batch.periodEnd
        });
        const frozenRows = getClosedPayrollPreviewRows([emp], batch.periodStart, batch.periodEnd);

        expect(restored).toMatchObject({ id: batch.id, voided: false, total: 250 });
        expect(frozenRows).toEqual(batch.previewRows);
        expect(frozenRows).not.toBe(batch.previewRows);
    });

    test('detects an incomplete cross-device batch even when only a non-snapshot payment arrived', () => {
        const firstEmp = employee('emp-1', 'Primera');
        const secondEmp = employee('emp-2', 'Segunda');
        const firstLoan = installmentLoan(firstEmp);
        const secondLoan = installmentLoan(secondEmp);
        const batch = buildBatch(
            [firstEmp, secondEmp],
            [payrollRow(firstEmp, firstLoan), payrollRow(secondEmp, secondLoan)]
        );
        applyPayrollLoanSettlementBatch([firstEmp, secondEmp], batch, { now: 100_100 });

        firstLoan.payments = [];
        const partial = findPayrollLoanSettlementBatch([firstEmp, secondEmp], {
            periodStart: batch.periodStart,
            periodEnd: batch.periodEnd
        });

        expect(partial).toMatchObject({
            id: batch.id,
            incomplete: true,
            missingPaymentCount: 1,
            voided: false
        });
        expect(partial.previewRows).toBeNull();
        expect(() => undoPayrollLoanSettlementBatch(
            [firstEmp, secondEmp],
            batch.id,
            { now: 100_200 }
        )).toThrow(/incompleto/i);
        expect(secondLoan.payments[0].voided).toBe(false);
    });

    test('undo soft-voids the complete batch and the same settlement restores its stable payments', () => {
        const emp = employee('emp-7', 'Ana Pérez');
        const loan = installmentLoan(emp);
        const batch = buildBatch([emp], [payrollRow(emp, loan)]);
        applyPayrollLoanSettlementBatch([emp], batch, { now: 100_100 });

        const undone = undoPayrollLoanSettlementBatch([emp], batch.id, {
            now: 100_200,
            voidedBy: 'operator-1'
        });

        expect(undone.voidedCount).toBe(1);
        expect(loan.payments[0].voided).toBe(true);
        expect(getBalance(loan)).toBe(1000);
        expect(getClosedPayrollPreviewRows([emp], batch.periodStart, batch.periodEnd)).toBeNull();

        const reapplied = applyPayrollLoanSettlementBatch([emp], batch, { now: 100_300 });
        expect(reapplied.createdCount).toBe(0);
        expect(reapplied.restoredCount).toBe(1);
        expect(loan.payments).toHaveLength(1);
        expect(loan.payments[0].voided).toBe(false);
        expect(getBalance(loan)).toBe(750);

        undoPayrollLoanSettlementBatch([emp], batch.id, { now: 100_400 });
        const renewedBatch = buildBatch([emp], [payrollRow(emp, loan)], 200_000);
        applyPayrollLoanSettlementBatch([emp], renewedBatch, { now: 200_100 });
        expect(findPayrollLoanSettlementBatch([emp], { batchId: batch.id }).undoUntil)
            .toBe(200_000 + PAYROLL_LOAN_UNDO_WINDOW_MS);
    });

    test('voids a complete batch after its legacy undo deadline and rejects a repeated undo', () => {
        const emp = employee('emp-7', 'Ana Pérez');
        const loan = installmentLoan(emp);
        const batch = buildBatch([emp], [payrollRow(emp, loan)]);
        applyPayrollLoanSettlementBatch([emp], batch, { now: 100_100 });

        expect(undoPayrollLoanSettlementBatch([emp], batch.id, {
            now: batch.undoUntil + 1
        })).toMatchObject({ batch: { voided: true }, voidedCount: 1 });
        expect(loan.payments[0].voided).toBe(true);
        expect(getBalance(loan)).toBe(1000);
        expect(() => undoPayrollLoanSettlementBatch([emp], batch.id, {
            now: batch.undoUntil + 2
        })).toThrow(/anulado/i);
    });

    test('rejects a matched payment that belongs to a different payroll closure', () => {
        const emp = employee('emp-7', 'Ana Pérez');
        const loan = installmentLoan(emp);
        const batch = buildBatch([emp], [payrollRow(emp, loan)]);
        applyPayrollLoanSettlementBatch([emp], batch, { now: 100_100 });
        loan.payments[0].payrollClosureId = 'other-closure';

        expect(() => undoPayrollLoanSettlementBatch([emp], batch.id, {
            now: 100_200
        })).toThrow(/otro cierre/i);
        expect(loan.payments[0].voided).toBe(false);
    });

    // Incidente 2026-11-16 ("Conflicto de identidad en el pago de Préstamo"):
    // una Nómina se cerró, se deshizo (pago anulado) y el monto del cargo
    // cambió (abono externo). La identidad del cargo (período+préstamo+tipo)
    // es la misma, así que el paymentId determinista chocaba con el pago
    // ANULADO de otro monto y el cierre quedaba bloqueado para siempre.
    test('re-closing after undo with a changed charge amount creates a fresh payment instead of a conflict', () => {
        const emp = employee('emp-9', 'Luis Mora');
        const loan = createLoan(emp, {
            principal: 1000,
            interestRate: 0,
            startDate: '2026-08-02',
            concept: 'Préstamo',
            installmentMode: 'single'
        });
        const firstBatch = buildBatch([emp], [payrollRow(emp, loan)]);
        applyPayrollLoanSettlementBatch([emp], firstBatch, { now: 100_100 });
        undoPayrollLoanSettlementBatch([emp], firstBatch.id, { now: 100_200 });
        expect(loan.payments[0].voided).toBe(true);

        recordPayment(emp, loan.id, { amount: 200, date: '2026-08-10', note: 'Abono externo' });
        const secondBatch = buildBatch([emp], [payrollRow(emp, loan)], 200_000);

        expect(secondBatch.items[0].amount).toBe(800);
        expect(secondBatch.items[0].paymentId).not.toBe(firstBatch.items[0].paymentId);
        const result = applyPayrollLoanSettlementBatch([emp], secondBatch, { now: 200_100 });
        expect(result.createdCount).toBe(1);
        const old = loan.payments.find(p => p.id === firstBatch.items[0].paymentId);
        expect(old).toMatchObject({ voided: true, amount: 1000 });
        expect(getBalance(loan)).toBe(0);

        // Replay of the same batch stays idempotent.
        const replay = applyPayrollLoanSettlementBatch([emp], secondBatch, { now: 200_200 });
        expect(replay.createdCount).toBe(0);
    });

    test('a live (non-voided) payment with a different amount still blocks as a real conflict', () => {
        const emp = employee('emp-9', 'Luis Mora');
        const loan = installmentLoan(emp);
        const batch = buildBatch([emp], [payrollRow(emp, loan)]);
        applyPayrollLoanSettlementBatch([emp], batch, { now: 100_100 });
        loan.payments[0].amount = 999;
        expect(() => applyPayrollLoanSettlementBatch([emp], batch, { now: 100_200 }))
            .toThrow(/Conflicto de identidad/);
    });
});

import fs from 'fs';
import path from 'path';
import {
    openPayrollLoanSettlementModal,
    renderPayrollLoanSettlementPanel
} from '../modules/features/payroll/PayrollLoanSettlementUI.js';

const PAYROLL_UI_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollUI.js'),
    'utf8'
);

afterEach(() => {
    document.body.innerHTML = '';
});

function gate(overrides = {}) {
    return {
        enabled: false,
        hasLoans: true,
        invalidCount: 0,
        payrollPaid: false,
        alreadySettled: false,
        reason: 'payroll-not-confirmed',
        ...overrides
    };
}

function batch(overrides = {}) {
    return {
        id: 'PAYROLL-BATCH-1',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-23',
        createdAt: 100_000,
        undoUntil: 130_000,
        total: 750,
        employeeCount: 2,
        employees: [{
            employeeId: 'emp-1',
            employeeNumber: '1',
            employeeName: 'Ana Pérez',
            paymentAmount: 500,
            remainingBalance: 500,
            hasFuturePayment: true,
            loans: [{ concept: 'Botas', amount: 500, chargeCount: 2, remainingBalance: 500 }]
        }, {
            employeeId: 'emp-2',
            employeeNumber: '2',
            employeeName: 'Luis Gómez',
            paymentAmount: 250,
            remainingBalance: 0,
            hasFuturePayment: false,
            loans: [{ concept: 'Guantes', amount: 250, chargeCount: 1, remainingBalance: 0 }]
        }],
        ...overrides
    };
}

describe('Payroll loan settlement UI', () => {
    test('keeps the yellow action disabled until this payroll is confirmed as paid', () => {
        const html = renderPayrollLoanSettlementPanel({ gate: gate() });
        document.body.innerHTML = html;

        const checkbox = document.querySelector('[data-payroll-action="toggle-payroll-paid"]');
        const button = document.querySelector('[data-payroll-action="open-payroll-loan-settlement"]');
        expect(checkbox.checked).toBe(false);
        expect(checkbox.disabled).toBe(false);
        expect(button.disabled).toBe(true);
        expect(button.textContent).toMatch(/Registrar pagos de préstamos/i);
        expect(document.body.textContent).toMatch(/Confirma que la nómina fue pagada/i);
    });

    test('enables the action only for a valid confirmed preview', () => {
        const html = renderPayrollLoanSettlementPanel({
            gate: gate({ enabled: true, payrollPaid: true, reason: null })
        });
        document.body.innerHTML = html;

        expect(document.querySelector('[data-payroll-action="toggle-payroll-paid"]').checked).toBe(true);
        expect(document.querySelector('[data-payroll-action="open-payroll-loan-settlement"]').disabled).toBe(false);
    });

    test('explains loan and invalid-net blockers without allowing payroll confirmation', () => {
        const noLoans = renderPayrollLoanSettlementPanel({
            gate: gate({ hasLoans: false, reason: 'no-loans' })
        });
        const invalid = renderPayrollLoanSettlementPanel({
            gate: gate({ invalidCount: 2, reason: 'invalid-net' })
        });

        document.body.innerHTML = noLoans;
        expect(document.querySelector('input').disabled).toBe(true);
        expect(document.body.textContent).toMatch(/Aplica al menos un préstamo/i);

        document.body.innerHTML = invalid;
        expect(document.querySelector('input').disabled).toBe(true);
        expect(document.body.textContent).toMatch(/2 pagos con saldo cero o negativo/i);
    });

    test('shows an active batch summary and undo only inside its time window', () => {
        document.body.innerHTML = renderPayrollLoanSettlementPanel({
            gate: gate({ alreadySettled: true, reason: 'already-settled' }),
            activeBatch: batch(),
            now: 120_000
        });
        expect(document.body.textContent).toMatch(/Pagos registrados/i);
        expect(document.body.textContent).toMatch(/750/);
        expect(document.querySelector('[data-payroll-action="undo-payroll-loan-settlement"]')).not.toBeNull();

        document.body.innerHTML = renderPayrollLoanSettlementPanel({
            gate: gate({ alreadySettled: true, reason: 'already-settled' }),
            activeBatch: batch(),
            now: 130_001
        });
        expect(document.querySelector('[data-payroll-action="undo-payroll-loan-settlement"]')).toBeNull();
        expect(document.body.textContent).toMatch(/ventana para deshacer finalizó/i);
    });

    test('blocks an incomplete synchronized batch without offering undo', () => {
        document.body.innerHTML = renderPayrollLoanSettlementPanel({
            gate: gate({ alreadySettled: true, reason: 'already-settled' }),
            activeBatch: batch({ incomplete: true, missingPaymentCount: 1 }),
            now: 120_000
        });

        expect(document.body.textContent).toMatch(/Sincronización incompleta/i);
        expect(document.body.textContent).toMatch(/Falta 1 pago/i);
        expect(document.querySelector('[data-payroll-action="undo-payroll-loan-settlement"]')).toBeNull();
    });

    test('modal is concise and requires explicit verification before accepting', async () => {
        const promise = openPayrollLoanSettlementModal(batch());
        const modal = document.querySelector('[data-modal-container]');
        const verify = modal.querySelector('[data-payroll-settlement-verify]');
        const buttons = modal.querySelectorAll('.modal-footer button');
        const confirm = buttons[1];

        expect(modal.textContent).toMatch(/Ana Pérez/);
        expect(modal.textContent).toMatch(/Luis Gómez/);
        expect(modal.textContent).toMatch(/Saldo siguiente/);
        expect(modal.textContent).not.toMatch(/interés|capital|fecha de vencimiento/i);
        expect(confirm.disabled).toBe(true);

        verify.checked = true;
        verify.dispatchEvent(new Event('change', { bubbles: true }));
        expect(confirm.disabled).toBe(false);
        confirm.click();
        await expect(promise).resolves.toBe(true);
    });

    test('modal cancellation resolves false and never invokes settlement itself', async () => {
        const promise = openPayrollLoanSettlementModal(batch());
        document.querySelector('.modal-footer button').click();
        await expect(promise).resolves.toBe(false);
    });

    test('PayrollUI wires paid confirmation, settlement, frozen preview and undo actions', () => {
        expect(PAYROLL_UI_SOURCE).toContain("'toggle-payroll-paid'");
        expect(PAYROLL_UI_SOURCE).toContain("'open-payroll-loan-settlement'");
        expect(PAYROLL_UI_SOURCE).toContain("'undo-payroll-loan-settlement'");
        expect(PAYROLL_UI_SOURCE).toContain('getClosedPayrollPreviewRows');
        expect(PAYROLL_UI_SOURCE).toContain('applyPayrollLoanSettlementBatch');
        expect(PAYROLL_UI_SOURCE).toContain('openPayrollLoanSettlementModal');
        expect(PAYROLL_UI_SOURCE).toContain('renderPayrollLoanSettlementPanel');
    });
});

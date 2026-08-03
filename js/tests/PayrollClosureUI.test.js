import {
    openPayrollClosureModal,
    renderPayrollClosurePanel
} from '../modules/features/payroll/PayrollClosureUI.js';

function gate(overrides = {}) {
    return {
        enabled: false,
        hasRows: true,
        hasLoans: false,
        invalidCount: 0,
        payrollPaid: false,
        activeClosure: null,
        exactClosure: null,
        correctionReady: false,
        reason: 'payroll-not-confirmed',
        ...overrides
    };
}

function closure(overrides = {}) {
    return {
        id: 'closure-1',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        employeeCount: 2,
        totals: { gross: 2100, bonuses: 0, deductions: 0, loans: 0, net: 2100 },
        undoUntil: Date.now() + 30_000,
        ...overrides
    };
}

describe('Payroll closure UI', () => {
    test('allows a payroll without loans to be confirmed and closed', () => {
        document.body.innerHTML = renderPayrollClosurePanel({
            gate: gate({ enabled: true, payrollPaid: true, reason: null })
        });
        expect(document.querySelector('[data-payroll-action="toggle-payroll-paid"]').disabled).toBe(false);
        const button = document.querySelector('[data-payroll-action="open-payroll-closure"]');
        expect(button.disabled).toBe(false);
        expect(button.textContent).toContain('Cerrar nómina');
    });

    test('offers an explicit correction instead of overwriting an active period', () => {
        const activeClosure = closure();
        document.body.innerHTML = renderPayrollClosurePanel({
            gate: gate({
                payrollPaid: true,
                reason: 'correction-required',
                activeClosure
            }),
            now: Date.now()
        });
        expect(document.body.textContent).toContain('Período cerrado');
        expect(document.querySelector('[data-payroll-action="prepare-payroll-correction"]'))
            .not.toBeNull();
        expect(document.querySelector('[data-payroll-action="undo-payroll-closure"]')?.dataset.id)
            .toBe(activeClosure.id);
        expect(document.querySelector('[data-payroll-action="open-payroll-closure"]').disabled).toBe(true);
    });

    test('shows a logical undo only while the closure window is open', () => {
        document.body.innerHTML = renderPayrollClosurePanel({
            gate: gate({ reason: 'already-closed', exactClosure: closure() }),
            now: Date.now()
        });
        expect(document.querySelector('[data-payroll-action="undo-payroll-closure"]')).not.toBeNull();
    });

    test('general verification modal keeps loans optional', async () => {
        const promise = openPayrollClosureModal({ closure: closure(), batch: null });
        const modal = document.querySelector('.payroll-settlement-modal');
        expect(modal.textContent).toContain('Total neto');
        expect(modal.textContent).not.toContain('Saldo siguiente');
        const verify = modal.querySelector('[data-payroll-closure-verify]');
        const confirm = document.querySelector('[data-button-index="1"]');
        expect(confirm.disabled).toBe(true);
        verify.checked = true;
        verify.dispatchEvent(new Event('change', { bubbles: true }));
        expect(confirm.disabled).toBe(false);
        confirm.click();
        await expect(promise).resolves.toBe(true);
    });
});

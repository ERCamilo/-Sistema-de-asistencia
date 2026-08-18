import { state } from '../modules/core/AppState.js';
import { LoansLedger } from '../modules/features/loans/LoansLedger.js';
import {
    PAYMENT_PLAN_MODE,
    createLoanPaymentDraft,
    updateLoanPaymentDraft
} from '../modules/features/loans/LoanPaymentPlan.js';

function seedInstallmentPaymentForm() {
    const loan = {
        id: 'loan-1',
        principal: 1000,
        interestRate: 0,
        interestIncluded: false,
        startDate: '2026-08-02',
        concept: 'Equipo personal',
        status: 'active',
        installmentMode: 'installments',
        payments: [],
        refinancings: [],
        installments: [
            { id: 'i1', seq: 1, dueDate: '2026-08-16', scheduledAmount: 250 },
            { id: 'i2', seq: 2, dueDate: '2026-08-30', scheduledAmount: 250 },
            { id: 'i3', seq: 3, dueDate: '2026-09-13', scheduledAmount: 250 },
            { id: 'i4', seq: 4, dueDate: '2026-09-27', scheduledAmount: 250 }
        ]
    };
    state.employees = [{
        id: 'e1',
        number: '001',
        name: 'Juan Pérez',
        active: true,
        loans: [loan]
    }];
    state.loansLedger = {
        selectedEmployeeId: 'e1',
        showPaymentFormForLoan: loan.id,
        paymentDraft: createLoanPaymentDraft(loan, '2026-08-02')
    };
    return loan;
}

function renderPaymentForm() {
    const host = document.createElement('div');
    host.innerHTML = LoansLedger();
    return host;
}

describe('Installment payment options UI', () => {
    test('renders interactive checklist of pending installments with checkmarks', () => {
        seedInstallmentPaymentForm();
        const host = renderPaymentForm();
        const checklist = host.querySelector('.loan-installments-checklist');
        expect(checklist).not.toBeNull();

        const rows = checklist.querySelectorAll('[data-arg="toggleInstallment"]');
        expect(rows).toHaveLength(4);
        expect(rows[0].textContent).toContain('Cuota 1');
        expect(rows[0].textContent).toContain('$250.00');
        expect(rows[0].textContent).toContain('Seleccionada');
        expect(rows[1].textContent).toContain('Pendiente');
    });

    test('shows dynamic installment count, partial amount and total sum', () => {
        const loan = seedInstallmentPaymentForm();
        let draft = updateLoanPaymentDraft(loan, state.loansLedger.paymentDraft, 'installmentCount', 2);
        draft = updateLoanPaymentDraft(loan, draft, 'partialAmount', 50);
        state.loansLedger.paymentDraft = draft;

        const host = renderPaymentForm();
        expect(host.textContent).toContain('2 cuotas completas + abono parcial ($50.00)');
        expect(host.textContent).toContain('Monto total: $550.00');
        expect(host.querySelector('.loan-payment-form__action--save').textContent.trim()).toBe('Pagar $550.00');
    });

    test('selecting all cuotas presents full payment action', () => {
        const loan = seedInstallmentPaymentForm();
        state.loansLedger.paymentDraft = updateLoanPaymentDraft(
            loan,
            state.loansLedger.paymentDraft,
            'installmentCount',
            4
        );

        const host = renderPaymentForm();
        expect(host.textContent).toContain('4 cuotas completas');
        expect(host.textContent).toContain('Monto total: $1,000.00');
        expect(host.querySelector('.loan-payment-form__action--save').textContent.trim()).toBe('Pagar completo ($1,000.00)');
    });

    test('lump-sum loans keep the existing custom amount form', () => {
        const loan = {
            id: 'lump-1',
            principal: 500,
            interestRate: 0,
            interestIncluded: false,
            startDate: '2026-08-02',
            concept: 'Adelanto',
            status: 'active',
            installmentMode: 'lump',
            installments: [],
            payments: [],
            refinancings: []
        };
        state.employees = [{ id: 'e1', number: '001', name: 'Juan Pérez', active: true, loans: [loan] }];
        state.loansLedger = {
            selectedEmployeeId: 'e1',
            showPaymentFormForLoan: loan.id,
            paymentDraft: createLoanPaymentDraft(loan, '2026-08-02')
        };

        const host = renderPaymentForm();

        expect(host.querySelector('.loan-installments-checklist')).toBeNull();
        expect(host.textContent).toContain('Monto a pagar');
        expect(host.querySelector('.loan-payment-form__action--total')).not.toBeNull();
        expect(host.querySelector('input[type="number"]').readOnly).toBe(false);
    });
});

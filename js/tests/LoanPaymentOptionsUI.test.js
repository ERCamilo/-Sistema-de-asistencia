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
    test('shows one installment first, followed by multiple and full payment', () => {
        seedInstallmentPaymentForm();
        const host = renderPaymentForm();
        const options = [...host.querySelectorAll('.loan-payment-plan__option')];

        expect(options.map(option => option.textContent.replace(/\s+/g, ' ').trim())).toEqual([
            'Pagar una cuota $250.00 Cuota 1',
            'Pagar varias cuotas 2–4 Consecutivas',
            'Pagar completo $1,000.00 Saldar préstamo'
        ]);
        expect(options[0].getAttribute('aria-pressed')).toBe('true');
        expect(host.querySelector('.loan-payment-plan__amount').readOnly).toBe(true);
        expect(host.querySelector('.loan-payment-form__action--save').textContent.trim())
            .toBe('Pagar una cuota');
    });

    test('shows the consecutive installment count and calculated amount', () => {
        const loan = seedInstallmentPaymentForm();
        let draft = updateLoanPaymentDraft(
            loan,
            state.loansLedger.paymentDraft,
            'mode',
            PAYMENT_PLAN_MODE.MULTIPLE
        );
        draft = updateLoanPaymentDraft(loan, draft, 'installmentCount', 3);
        state.loansLedger.paymentDraft = draft;

        const host = renderPaymentForm();

        expect(host.querySelector('.loan-payment-plan__count select').value).toBe('3');
        expect(host.querySelector('.loan-payment-plan__summary').textContent)
            .toMatch(/Cuotas 1–3\s+·\s+\$750\.00/);
        expect(host.querySelector('.loan-payment-form__action--save').textContent.trim())
            .toBe('Pagar 3 cuotas');
    });

    test('full payment presents the exact balance as the final action', () => {
        const loan = seedInstallmentPaymentForm();
        state.loansLedger.paymentDraft = updateLoanPaymentDraft(
            loan,
            state.loansLedger.paymentDraft,
            'mode',
            PAYMENT_PLAN_MODE.TOTAL
        );

        const host = renderPaymentForm();

        expect(host.querySelector('.loan-payment-plan__summary').textContent)
            .toMatch(/Saldo completo\s+·\s+\$1,000\.00/);
        expect(host.querySelector('.loan-payment-form__action--save').textContent.trim())
            .toBe('Pagar préstamo completo');
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

        expect(host.querySelector('.loan-payment-plan')).toBeNull();
        expect(host.textContent).toContain('Monto a pagar');
        expect(host.querySelector('.loan-payment-form__action--total')).not.toBeNull();
        expect(host.querySelector('input[type="number"]').readOnly).toBe(false);
    });
});

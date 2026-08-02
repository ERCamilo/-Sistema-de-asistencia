import {
    PAYMENT_PLAN_MODE,
    createLoanPaymentDraft,
    getInstallmentPaymentChoices,
    updateLoanPaymentDraft
} from '../modules/features/loans/LoanPaymentPlan.js';

function installmentLoan(overrides = {}) {
    return {
        id: 'loan-1',
        principal: 1000,
        interestRate: 0,
        interestIncluded: false,
        startDate: '2026-08-02',
        status: 'active',
        installmentMode: 'installments',
        payments: [],
        refinancings: [],
        installments: [
            { id: 'i1', seq: 1, dueDate: '2026-08-16', scheduledAmount: 250 },
            { id: 'i2', seq: 2, dueDate: '2026-08-30', scheduledAmount: 250 },
            { id: 'i3', seq: 3, dueDate: '2026-09-13', scheduledAmount: 250 },
            { id: 'i4', seq: 4, dueDate: '2026-09-27', scheduledAmount: 250 }
        ],
        ...overrides
    };
}

describe('LoanPaymentPlan', () => {
    test('abre los préstamos en cuotas con una cuota seleccionada', () => {
        const draft = createLoanPaymentDraft(installmentLoan(), '2026-08-02');

        expect(draft.mode).toBe(PAYMENT_PLAN_MODE.SINGLE);
        expect(draft.installmentCount).toBe(1);
        expect(draft.amount).toBe(250);
    });

    test('calcula varias cuotas consecutivas sin exceder las pendientes', () => {
        const loan = installmentLoan();
        const initial = createLoanPaymentDraft(loan, '2026-08-02');
        const multiple = updateLoanPaymentDraft(loan, initial, 'mode', PAYMENT_PLAN_MODE.MULTIPLE);
        const three = updateLoanPaymentDraft(loan, multiple, 'installmentCount', 3);
        const clamped = updateLoanPaymentDraft(loan, three, 'installmentCount', 99);

        expect(multiple.installmentCount).toBe(2);
        expect(multiple.amount).toBe(500);
        expect(three.amount).toBe(750);
        expect(clamped.installmentCount).toBe(4);
        expect(clamped.amount).toBe(1000);
    });

    test('el pago completo usa el saldo exacto', () => {
        const loan = installmentLoan({ payments: [{ id: 'p1', amount: 125, voided: false }] });
        const initial = createLoanPaymentDraft(loan, '2026-08-02');
        const total = updateLoanPaymentDraft(loan, initial, 'mode', PAYMENT_PLAN_MODE.TOTAL);

        expect(total.amount).toBe(875);
    });

    test('expone importes acumulados para las opciones de varias cuotas', () => {
        const choices = getInstallmentPaymentChoices(installmentLoan());

        expect(choices.map(choice => [choice.count, choice.amount])).toEqual([
            [1, 250],
            [2, 500],
            [3, 750],
            [4, 1000]
        ]);
    });

});

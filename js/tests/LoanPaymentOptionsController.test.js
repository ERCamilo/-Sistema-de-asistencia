jest.mock('../modules/core/RenderManager.js', () => ({
    render: jest.fn()
}));

jest.mock('../modules/services/PersistenceService.js', () => ({
    saveApplicationData: jest.fn()
}));

import { state } from '../modules/core/AppState.js';
import { render } from '../modules/core/RenderManager.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';
import {
    setPaymentDraftField,
    submitPayment,
    togglePaymentForm
} from '../modules/features/loans/LoansController.js';
import { getBalance, LOAN_STATUS } from '../modules/features/loans/LoansService.js';

function seedControllerState() {
    state.employees = [{
        id: 'e1',
        number: '001',
        name: 'Juan Pérez',
        active: true,
        loans: [{
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
        }]
    }];
    state.loansLedger = {
        selectedEmployeeId: 'e1',
        showPaymentFormForLoan: null,
        showRefinanceFormForLoan: null
    };
}

describe('Installment payment options controller', () => {
    beforeEach(() => {
        seedControllerState();
        render.mockClear();
        saveApplicationData.mockClear();
    });

    test('opens with exactly one upcoming installment selected', () => {
        togglePaymentForm('loan-1');

        expect(state.loansLedger.paymentDraft).toMatchObject({
            mode: 'single',
            installmentCount: 1,
            amount: 250
        });
        expect(render).toHaveBeenCalledTimes(1);
    });

    test('records several calculated installments and leaves the remaining balance', () => {
        togglePaymentForm('loan-1');
        setPaymentDraftField('mode', 'multiple');
        setPaymentDraftField('installmentCount', 3);
        submitPayment('loan-1');

        const loan = state.employees[0].loans[0];
        expect(loan.payments[0].amount).toBe(750);
        expect(getBalance(loan)).toBe(250);
        expect(loan.status).toBe(LOAN_STATUS.ACTIVE);
        expect(saveApplicationData).toHaveBeenCalledWith(expect.objectContaining({ immediate: true }));
    });

    test('records the exact balance and closes the loan from full-payment mode', () => {
        togglePaymentForm('loan-1');
        setPaymentDraftField('mode', 'total');
        submitPayment('loan-1');

        const loan = state.employees[0].loans[0];
        expect(loan.payments[0].amount).toBe(1000);
        expect(getBalance(loan)).toBe(0);
        expect(loan.status).toBe(LOAN_STATUS.PAID);
    });
});

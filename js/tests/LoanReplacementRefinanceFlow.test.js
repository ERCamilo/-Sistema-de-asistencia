import { state } from '../modules/core/AppState.js';
import { toggleRefinanceForm, setRefinanceDraftField, submitRefinance } from '../modules/features/loans/LoansController.js';

describe('replacement refinance production flow', () => {
    beforeEach(() => {
        state.employees = [{ id: 'e1', name: 'Ada', loans: [{ id: 'l1', principal: 1000, interestRate: 0, startDate: '2026-01-01', status: 'active', installmentMode: 'lump', payments: [{ amount: 200 }] }] }];
        state.loansLedger = { selectedEmployeeId: 'e1', showRefinanceFormForLoan: null, refinanceDraft: null };
    });

    it('wires entered rate, count and frequency into the replacement contract', () => {
        toggleRefinanceForm('l1');
        setRefinanceDraftField('interestRate', '12');
        setRefinanceDraftField('installmentCount', '4');
        setRefinanceDraftField('installmentFrequencyWeeks', '3');
        submitRefinance('l1');
        const terms = state.employees[0].loans[0].refinancings[0].replacementTerms;
        expect(terms).toMatchObject({ principal: 800, interestRate: 12, installmentCount: 4, installmentFrequencyWeeks: 3 });
        expect(terms.installments).toHaveLength(4);
    });
});

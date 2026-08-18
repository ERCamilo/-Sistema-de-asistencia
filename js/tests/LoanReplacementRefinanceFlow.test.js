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

    it('wires lump-sum refinance on principal basis without creating replacement installments', () => {
        toggleRefinanceForm('l1');
        setRefinanceDraftField('basis', 'principal');
        setRefinanceDraftField('mode', 'lump');
        setRefinanceDraftField('interestRate', '10');
        submitRefinance('l1');
        const ref = state.employees[0].loans[0].refinancings[0];
        expect(ref.basis).toBe('principal');
        expect(ref.baseAmount).toBe(1000);
        expect(ref.interestAmount).toBe(100);
        expect(ref.replacementTerms).toBeUndefined();
    });

    it('wires lump-sum refinance on balance basis without creating replacement installments', () => {
        toggleRefinanceForm('l1');
        setRefinanceDraftField('basis', 'balance');
        setRefinanceDraftField('mode', 'lump');
        setRefinanceDraftField('interestRate', '10');
        submitRefinance('l1');
        const ref = state.employees[0].loans[0].refinancings[0];
        expect(ref.basis).toBe('balance');
        expect(ref.baseAmount).toBe(800);
        expect(ref.interestAmount).toBe(80);
        expect(ref.replacementTerms).toBeUndefined();
    });

    it('wires replacement installments on principal basis', () => {
        toggleRefinanceForm('l1');
        setRefinanceDraftField('basis', 'principal');
        setRefinanceDraftField('mode', 'installments');
        setRefinanceDraftField('interestRate', '10');
        setRefinanceDraftField('installmentCount', '2');
        submitRefinance('l1');
        const ref = state.employees[0].loans[0].refinancings[0];
        expect(ref.basis).toBe('principal');
        expect(ref.baseAmount).toBe(1000);
        expect(ref.interestAmount).toBe(100);
        expect(ref.replacementTerms).toBeDefined();
        expect(ref.replacementTerms.totalDue).toBe(900); // 800 balance + 100 interest
        expect(ref.replacementTerms.installments).toHaveLength(2);
        expect(ref.replacementTerms.installments[0].scheduledAmount).toBe(450);
        expect(ref.replacementTerms.installments[1].scheduledAmount).toBe(450);
    });
});

import {
    getActiveLoanTerms,
    getBalance,
    getPayrollDeductionOptions,
    getTotalDue, getRefinanceInterest, refinanceLoan,
    INSTALLMENT_MODE
} from '../modules/features/loans/LoansService.js';

describe('LoansService active refinancing terms', () => {
    const loan = {
        id: 'loan-1', principal: 1000, interestRate: 10, interestIncluded: false,
        startDate: '2026-01-01', installmentMode: INSTALLMENT_MODE.LUMP,
        installmentFrequencyWeeks: 2, installments: [], status: 'active', payments: [{ amount: 200 }],
        refinancings: [{
            id: 'refin-1', createdAt: 10, voided: false,
            replacementTerms: {
                principal: 800, interestRate: 5, interestIncluded: false,
                startDate: '2026-03-01', installmentMode: INSTALLMENT_MODE.INSTALLMENTS,
                installmentFrequencyWeeks: 2,
                installments: [{ id: 'new-1', seq: 1, dueDate: '2026-03-15', scheduledAmount: 420 }, { id: 'new-2', seq: 2, dueDate: '2026-03-29', scheduledAmount: 420 }]
            }
        }]
    };

    it('projects the latest non-voided replacement as the canonical active terms', () => {
        const terms = getActiveLoanTerms(loan);
        expect(terms).toMatchObject({ principal: 800, interestRate: 5, installmentMode: INSTALLMENT_MODE.INSTALLMENTS });
        expect(getTotalDue(loan)).toBe(840);
        expect(getBalance(loan)).toBe(640);
        expect(getPayrollDeductionOptions(loan, '2026-03-20')[0]).toMatchObject({ amount: 220, installmentSeq: 1 });
    });

    it('ignores voided replacements and preserves legacy loan terms', () => {
        const voided = { ...loan, refinancings: [{ ...loan.refinancings[0], voided: true }] };
        expect(getActiveLoanTerms(voided).principal).toBe(1000);
        expect(getTotalDue(voided)).toBe(1100);
    });

    it('creates a versioned replacement contract through the production refinance function', () => {
        const employee = { id: 'emp', loans: [{ id: 'loan', principal: 1000, interestRate: 0, startDate: '2026-01-01', installmentMode: 'lump', payments: [{ amount: 200 }], status: 'active' }] };
        const event = refinanceLoan(employee, 'loan', { basis: 'balance', interestRate: 10, installmentCount: 3, date: '2026-02-01', effectiveAt: 100 });
        expect(event).toMatchObject({ kind: 'replacement', effectiveAt: 100, replacementTerms: { version: 2, principal: 800, interestRate: 10, installmentCount: 3, totalDue: 880 } });
        expect(event.replacementTerms.installments).toHaveLength(3);
        expect(getBalance(employee.loans[0])).toBe(880);
    });

    it('selects the newest replacement independent of merged array order and uses the id tie-breaker', () => {
        const first = { ...loan.refinancings[0], id: 'A', effectiveAt: 10 };
        const second = { ...loan.refinancings[0], id: 'B', effectiveAt: 10, replacementTerms: { ...loan.refinancings[0].replacementTerms, principal: 700 } };
        expect(getActiveLoanTerms({ ...loan, refinancings: [second, first] }).principal).toBe(700);
        expect(getActiveLoanTerms({ ...loan, refinancings: [first, second] }).principal).toBe(700);
    });

    it('uses chronological additive interest after a replacement regardless of array order', () => {
        const replacement = { id: 'R', effectiveAt: 10, replacementTerms: { principal: 500, interestRate: 0, installments: [] } };
        const additive = { id: 'A', createdAt: 20, interestAmount: 25 };
        expect(getRefinanceInterest({ refinancings: [additive, replacement] })).toBe(25);
        expect(getRefinanceInterest({ refinancings: [replacement, additive] })).toBe(25);
    });
});

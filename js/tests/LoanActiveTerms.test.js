import {
    getActiveLoanTerms,
    getBalance,
    getPayrollDeductionOptions,
    getTotalDue,
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
});

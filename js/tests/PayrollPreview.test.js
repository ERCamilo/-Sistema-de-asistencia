import {
    applyPayrollPreviewInclusion,
    filterPayablePayrollPreviewRows,
    getPayrollPreviewInclusion,
    getPayrollPreviewCategoryCounts
} from '../modules/features/payroll/PayrollPreview.js';

describe('PayrollPreview inclusion controls', () => {
    const rows = [{
        id: 1,
        monto: 95,
        _brutoOriginal: 100,
        _bonuses: 20,
        _deductions: 10,
        _loans: 15,
        _bonusDetails: [{ name: 'Bono' }],
        _deductionDetails: [{ name: 'AFP' }],
        _loanDetails: [{ loanId: 'loan-1' }],
        _invalidLoanNet: false
    }, {
        id: 2,
        monto: 5,
        _brutoOriginal: 10,
        _bonuses: 0,
        _deductions: 0,
        _loans: 5,
        _loanDetails: [{ loanId: 'loan-2' }],
        _invalidLoanNet: true
    }];

    it('defaults every category to included', () => {
        expect(getPayrollPreviewInclusion()).toEqual({ bonuses: true, deductions: true, loans: true });
        expect(getPayrollPreviewInclusion({ loans: false })).toEqual({ bonuses: true, deductions: true, loans: false });
    });

    it('derives effective rows without changing configured source rows', () => {
        const effective = applyPayrollPreviewInclusion(rows, { bonuses: false, deductions: false, loans: false });

        expect(effective[0]).toMatchObject({ monto: 100, _bonuses: 0, _deductions: 0, _loans: 0, _invalidLoanNet: false });
        expect(effective[0]._bonusDetails).toEqual([]);
        expect(effective[0]._deductionDetails).toEqual([]);
        expect(effective[0]._loanDetails).toEqual([]);
        expect(rows[0]).toMatchObject({ monto: 95, _bonuses: 20, _deductions: 10, _loans: 15 });
        expect(rows[1]._invalidLoanNet).toBe(true);
    });

    it('recomputes the invalid loan state and makes excluded loans payable before filtering', () => {
        const effective = applyPayrollPreviewInclusion(rows, { loans: false });

        expect(effective[1]).toMatchObject({ monto: 10, _loans: 0, _invalidLoanNet: false });
        expect(effective.map(row => row.id)).toEqual([1, 2]);
    });

    it('reports active configured items instead of counting payroll rows', () => {
        expect(getPayrollPreviewCategoryCounts(
            { bonuses: 1, deductions: 2, loans: 3 },
            { bonuses: false, deductions: true, loans: true }
        )).toEqual({
            bonuses: { active: 0, total: 1 },
            deductions: { active: 2, total: 2 },
            loans: { active: 3, total: 3 }
        });
    });

    it('keeps a non-positive row visible when it contains an applied adjustment', () => {
        const invalidDeductionRow = {
            id: 3,
            monto: -500,
            _loans: 0,
            _bonusDetails: [],
            _deductionDetails: [{ id: 'DED-1', amount: 500 }]
        };

        expect(filterPayablePayrollPreviewRows([invalidDeductionRow])).toEqual([invalidDeductionRow]);
    });
});

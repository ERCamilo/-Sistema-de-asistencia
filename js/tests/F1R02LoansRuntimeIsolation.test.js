import { state } from '../modules/core/AppState.js';
import { LoansLedger } from '../modules/features/loans/LoansLedger.js';
import {
    selectLoansEmployee,
    pickEmployeeForNewLoan,
    submitNewLoan
} from '../modules/features/loans/LoansController.js';
import { replaceEntityScope } from '../modules/features/projects/EntityProjectScope.js';

const loan = id => ({
    id, principal: 1000, interestRate: 0, interestIncluded: false,
    startDate: '2026-09-14', concept: id, status: 'active',
    installmentMode: 'lump', installments: [], refinancings: [], payments: []
});

function seed() {
    replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' });
    state.employees = [
        { id: 'emp-a', projectId: 'A', number: '001', name: 'Ana Alfa', active: true, loans: [loan('loan-a')] },
        { id: 'emp-b', projectId: 'B', number: '001', name: 'Bruno Beta', active: true, loans: [loan('loan-b')] }
    ];
    state.loansLedger = null;
    window.showNotification = jest.fn();
    window.showAlert = jest.fn();
    window.showConfirm = undefined;
}
describe('F1 R02 — loans runtime isolation under active project A', () => {
    beforeEach(seed);
    afterEach(() => replaceEntityScope());

    test('overview and stale detail never render employee/loan data from B', () => {
        let html = LoansLedger();
        expect(html).toContain('Ana Alfa');
        expect(html).not.toContain('Bruno Beta');
        expect(html).not.toContain('loan-b');

        state.loansLedger = { selectedEmployeeId: 'emp-b' };
        html = LoansLedger();
        expect(html).not.toContain('Bruno Beta');
        expect(html).not.toContain('loan-b');
    });

    test('selection and picker handlers reject foreign employee ids', () => {
        selectLoansEmployee('emp-b');
        expect(state.loansLedger.selectedEmployeeId).not.toBe('emp-b');
        pickEmployeeForNewLoan('emp-b');
        expect(state.loansLedger.selectedEmployeeId).not.toBe('emp-b');
    });

    test('stale foreign selection cannot create a loan in B', () => {
        state.loansLedger = {
            selectedEmployeeId: 'emp-b',
            newLoanDraft: {
                principal: 250, interestRate: 0, interestIncluded: false,
                startDate: '2026-09-15', concept: 'NO-DEBE-CREARSE',
                installmentMode: 'lump', installmentCount: 1, installmentFrequencyWeeks: 2
            }
        };
        const before = state.employees[1].loans.length;
        submitNewLoan();
        expect(state.employees[1].loans).toHaveLength(before);
        expect(state.employees[1].loans.some(item => item.concept === 'NO-DEBE-CREARSE')).toBe(false);
    });
});

import {
    buildPayrollLoansDesktopModel,
    renderPayrollLoansDesktop
} from '../modules/features/payroll/PayrollLoansDesktop.js';

const employees = [{
    id: 'e1',
    number: '001',
    name: 'Juan Pérez',
    loans: [
        {
            id: 'loan-1', concept: 'Préstamo #1', principal: 1000,
            interestRate: 10, interestIncluded: false, status: 'active',
            payments: [], refinancings: []
        },
        {
            id: 'loan-2', concept: 'Herramientas', principal: 500,
            interestRate: 0, interestIncluded: false, status: 'active',
            payments: [], refinancings: []
        }
    ]
}];

const selection = [{ employeeId: 'e1', loanIds: ['loan-1'] }];
const payrollRows = [{
    _employeeId: 'e1',
    monto: 900,
    _loans: 1100,
    _invalidLoanNet: false
}];

describe('PayrollLoansDesktop', () => {
    test('builds a partial employee selection without changing persisted loans', () => {
        const before = JSON.stringify(employees);
        const model = buildPayrollLoansDesktopModel(employees, selection, payrollRows);
        const group = model.groups[0];

        expect(group.selectionState).toBe('mixed');
        expect(group.selectedCount).toBe(1);
        expect(group.eligibleCount).toBe(2);
        expect(group.selectedBalance).toBe(1100);
        expect(JSON.stringify(employees)).toBe(before);
    });

    test('renders a tri-state parent and individual loan checkboxes', () => {
        const host = document.createElement('div');
        host.innerHTML = renderPayrollLoansDesktop({
            employees,
            selection,
            payrollRows,
            expandedEmployeeIds: ['e1']
        });

        const group = host.querySelector('.payroll-loan-group');
        expect(group.open).toBe(true);
        expect(group.querySelector('.payroll-loan-disclosure').getAttribute('aria-expanded'))
            .toBe('true');
        expect(group.querySelector('.payroll-loan-group__employee-copy b').textContent)
            .toBe('#001');
        expect(group.querySelector('summary .payroll-loan-selection').getAttribute('aria-checked'))
            .toBe('mixed');
        expect(group.querySelectorAll('.payroll-loan-child .payroll-loan-selection'))
            .toHaveLength(2);
        expect(
            [...group.querySelectorAll('.payroll-loan-child .payroll-loan-selection')]
                .map(control => control.getAttribute('aria-checked'))
        ).toEqual(['true', 'false']);
        expect(host.textContent).toContain('Excluir de esta nómina no elimina el préstamo');
        expect(host.querySelector('[data-payroll-action="clear-payroll-loans"]')).not.toBeNull();
    });
});

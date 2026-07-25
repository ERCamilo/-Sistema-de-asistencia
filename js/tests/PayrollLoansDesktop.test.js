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
        expect(group.eligibleBalance).toBe(1600);
        expect(JSON.stringify(employees)).toBe(before);
    });

    test('separates zero and negative payroll warnings', () => {
        const warningEmployees = [
            { id: 'zero', number: '010', name: 'Neto Cero' },
            { id: 'negative', number: '011', name: 'Neto Negativo' },
            { id: 'valid', number: '012', name: 'Neto Válido' }
        ].map((employee, index) => ({
            ...employee,
            loans: [{
                id: `loan-${index}`,
                concept: 'Préstamo',
                principal: 100,
                interestRate: 0,
                interestIncluded: false,
                status: 'active',
                payments: [],
                refinancings: []
            }]
        }));
        const warningSelection = warningEmployees.map((employee, index) => ({
            employeeId: employee.id,
            loanIds: [`loan-${index}`]
        }));
        const warningRows = [
            { _employeeId: 'zero', monto: 0, _invalidLoanNet: true },
            { _employeeId: 'negative', monto: -25, _invalidLoanNet: true },
            { _employeeId: 'valid', monto: 50, _invalidLoanNet: false }
        ];

        const model = buildPayrollLoansDesktopModel(
            warningEmployees,
            warningSelection,
            warningRows
        );
        expect(model.zeroCount).toBe(1);
        expect(model.negativeCount).toBe(1);
        expect(model.invalidCount).toBe(2);

        const host = document.createElement('div');
        host.innerHTML = renderPayrollLoansDesktop({
            employees: warningEmployees,
            selection: warningSelection,
            payrollRows: warningRows
        });

        expect(host.querySelectorAll('.payroll-loan-group.is-warning-zero')).toHaveLength(1);
        expect(host.querySelectorAll('.payroll-loan-group.is-warning-negative')).toHaveLength(1);
        expect(host.querySelector('.payroll-loans-warning-counts').textContent)
            .toMatch(/1 negativo\s+1 en cero/);
        expect(host.textContent).not.toContain('El descuento deja el pago en cero o negativo');
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
        expect(group.querySelector('.payroll-loan-group__number').textContent)
            .toBe('001');
        expect(
            [...group.querySelectorAll('.payroll-loan-group__employee-copy strong > span')]
                .map(line => line.textContent)
        ).toEqual(['Juan', 'Pérez']);
        expect(group.querySelector('.payroll-loan-group__count').textContent)
            .toBe('1/2');
        expect(group.querySelector('.payroll-loan-group__discount small').textContent)
            .toContain('$1,600.00');
        expect(group.querySelector('.payroll-loan-group__net').dataset.label)
            .toBe('Neto a pagar');
        expect(group.querySelector('summary .payroll-loan-selection').getAttribute('aria-checked'))
            .toBe('mixed');
        const summaryControls = [...group.querySelector('summary').children].slice(-2);
        expect(summaryControls[0].classList).toContain('payroll-loan-disclosure');
        expect(summaryControls[1].classList).toContain('payroll-loan-selection');
        expect(group.querySelectorAll('.payroll-loan-child .payroll-loan-selection'))
            .toHaveLength(2);
        expect(
            [...group.querySelectorAll('.payroll-loan-child')]
                .every(row => row.lastElementChild.classList.contains('payroll-loan-selection'))
        ).toBe(true);
        expect(
            [...group.querySelectorAll('.payroll-loan-child .payroll-loan-selection')]
                .map(control => control.getAttribute('aria-checked'))
        ).toEqual(['true', 'false']);
        expect(host.textContent).toContain('Excluir de esta nómina no elimina el préstamo');
        expect(host.querySelector('[data-payroll-action="clear-payroll-loans"]')).not.toBeNull();
    });
});

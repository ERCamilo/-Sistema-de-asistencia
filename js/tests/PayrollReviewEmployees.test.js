import { getPayrollReviewEmployeeSelection, filterPayrollReviewEmployees, renderPayrollReviewEmployeeFilter } from '../modules/features/payroll/PayrollReviewEmployees.js';

const context = { projectId: 'P', period: { periodStart: '2026-03-01', periodEnd: '2026-03-15' },
    employees: [{ id: 'e1' }, { id: 2 }] };
const config = { projectId: 'P', periodStart: '2026-03-01', periodEnd: '2026-03-15',
    enabled: true, ids: ['e1', 2, 'e1', 'foreign', null] };

test('normalizes the selected IDs within the current project and period', () => {
    expect(getPayrollReviewEmployeeSelection(config, context)).toEqual({ enabled: true, ids: ['e1', '2'] });
    expect(getPayrollReviewEmployeeSelection(undefined, context)).toEqual({ enabled: false, ids: [] });
    expect(getPayrollReviewEmployeeSelection(undefined)).toEqual({ enabled: false, ids: [] });
    for (const change of [{ projectId: 'OTHER' }, { periodStart: '2026-02-01' }, { periodEnd: '2026-03-16' }]) {
        expect(getPayrollReviewEmployeeSelection({ ...config, ...change }, context)).toEqual({ enabled: false, ids: [] });
    }
});

test('filtering never falls back to everyone for an empty selection and does not change salaries', () => {
    const rows = [{ _employeeId: 'e1', monto: 1200 }, { _employeeId: 'e2', monto: 800 }];
    const before = JSON.stringify(rows);
    expect(filterPayrollReviewEmployees(rows, { enabled: true, ids: ['e1'] })).toEqual([rows[0]]);
    expect(filterPayrollReviewEmployees(rows, { enabled: true, ids: [] })).toEqual([]);
    expect(filterPayrollReviewEmployees(rows, { enabled: false, ids: [] })).toBe(rows);
    expect(JSON.stringify(rows)).toBe(before);
});

test('the control has a labelled checkbox and an explicit count', () => {
    const host = document.createElement('div');
    host.innerHTML = renderPayrollReviewEmployeeFilter({ enabled: true, ids: ['e1', '2'] });
    expect(host.querySelector('label input[type="checkbox"]').checked).toBe(true);
    expect(host.querySelector('label').textContent).toContain('Solo empleados seleccionados');
    expect(host.querySelector('button').getAttribute('aria-label')).toContain('2 seleccionados');
});

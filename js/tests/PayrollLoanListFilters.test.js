import { buildPayrollLoansDesktopModel, renderPayrollLoansDesktop } from '../modules/features/payroll/PayrollLoansDesktop.js';
import { buildPayrollLoanList, handlePayrollLoanListFilter, matchesPayrollLoanList, resetPayrollLoanListFilters } from '../modules/features/payroll/PayrollLoanListFilters.js';
import { buildPayrollLoanSelection } from '../modules/features/payroll/PayrollLoans.js';
import * as PayrollUI from 'actual/features/payroll/PayrollUI.js';

const loan = { id: 'loan', principal: 500, interestRate: 20, interestIncluded: false, status: 'active', payments: [], refinancings: [] };
const employee = (id, number, name, positions = []) => ({ id, number, name, positions, loans: [{ ...loan, id: `loan-${id}` }] });
const employees = [employee('ten', '010', 'Ana Méndez', ['p2']), employee('two', '002', 'Juan Pérez', ['p1']), employee('one', '001', 'Zoe', ['p2'])];
const positions = [{ id: 'p1', name: 'Albañil', leaderId: 'B' }, { id: 'p2', name: 'Electricista', leaderId: 'B' }];
const leaders = [{ id: 'A', name: 'Luis' }, { id: 'B', name: 'Marcos' }];
const payrollRows = [
    { _employeeId: 'two', monto: 400, _loans: 600, _positionBreakdown: [{ positionId: 'p1', assignmentSchemaVersion: 1, payerLeaderId: 'A', workLeaderId: 'B', subtotal: 1000 }] },
    { _employeeId: 'ten', monto: 400, _loans: 0, _positionBreakdown: [{ positionId: 'p2', subtotal: 400 }] },
    { _employeeId: 'one', monto: 400, _loans: 0, _positionBreakdown: [{ positionId: 'p2', subtotal: 400 }] }
];
let options;
beforeEach(() => {
    resetPayrollLoanListFilters();
    options = { employees, positions, leaders, payrollRows, filterKey: 'project-period-all',
        selection: buildPayrollLoanSelection([employees[1]]), expandedEmployeeIds: ['two'] };
    document.body.innerHTML = '';
});

const mount = () => { document.body.innerHTML = renderPayrollLoansDesktop(options); };
const change = (field, value) => {
    const target = document.querySelector(`[data-payroll-loan-filter="${field}"]`);
    target.value = value;
    target.focus();
    expect(handlePayrollLoanListFilter({ type: field === 'query' ? 'input' : 'change', target })).toBe(true);
};
const visible = () => [...document.querySelectorAll('.payroll-loan-group:not([hidden])')].map(element => element.dataset.employeeId);

test('orders numeric employee numbers naturally, puts missing numbers last and does not reorder source data', () => {
    const people = [...employees, employee('missing', null, 'AAA'), employee('numeric', 3, 'BBB'), employee('empty', '', 'CCC')];
    const before = JSON.stringify(people);
    expect(buildPayrollLoansDesktopModel(people).groups.map(group => group.employeeId)).toEqual(['one', 'two', 'numeric', 'ten', 'missing', 'empty']);
    expect(JSON.stringify(people)).toBe(before);
    mount(); expect(visible()).toEqual(['one', 'two', 'ten']);
});

test('leader filter follows the captured payer rather than the catalogue work leader', () => {
    mount(); change('leader', 'A');
    expect(visible()).toEqual(['two']);
    change('leader', 'B'); expect(visible()).toEqual(['one', 'ten']);
});

test('leader and position must match the same worked part', () => {
    const person = employee('mixed', '004', 'Mixto', ['p1', 'p2']);
    const groups = buildPayrollLoansDesktopModel([person]).groups;
    const list = buildPayrollLoanList(groups, { employees: [person], positions, leaders, payrollRows: [{ _employeeId: 'mixed',
        _positionBreakdown: [
            { positionId: 'p1', assignmentSchemaVersion: 1, payerLeaderId: 'A' },
            { positionId: 'p2', assignmentSchemaVersion: 1, payerLeaderId: 'B' }
        ] }] });
    expect(matchesPayrollLoanList(list.rows[0], { leader: 'A', position: 'p2' })).toBe(false);
    expect(matchesPayrollLoanList(list.rows[0], { leader: 'B', position: 'p2' })).toBe(true);
});

test('without worked parts uses the employee override and represents missing catalogues without dropping anyone', () => {
    const people = [{ ...employees[0], positionAssignments: { p2: { workLeaderId: 'B', payerLeaderId: 'A', isLoanPosition: true } } },
        employee('none', '003', 'Sin puesto'), employee('lost', '004', 'Histórico')];
    const list = buildPayrollLoanList(buildPayrollLoansDesktopModel(people).groups, {
        employees: people, positions, leaders, payrollRows: [{ _employeeId: 'lost', _positionBreakdown: [{ positionId: 'removed',
            positionName: 'Puesto anterior', assignmentSchemaVersion: 1, payerLeaderId: 'removed', payerLeaderName: 'Líder anterior' }] }]
    });
    expect(list.leaderOptions).toEqual(expect.arrayContaining([['A', 'Luis'], ['removed', 'Líder anterior'], ['__none__', 'Sin líder']]));
    expect(list.positionOptions).toContainEqual(['removed', 'Puesto anterior']);
    expect(matchesPayrollLoanList(list.rows.find(row => row.id === 'ten'), { leader: 'A' })).toBe(true);
    expect(matchesPayrollLoanList(list.rows.find(row => row.id === 'none'), { position: '__none__' })).toBe(true);
});

test('combines accent-insensitive search, employee number, position and selected charges', () => {
    mount(); change('query', 'perez #002'); change('position', 'p1'); change('selection', 'selected');
    expect(visible()).toEqual(['two']);
    change('selection', 'unselected'); expect(visible()).toEqual([]);
    expect(document.querySelector('[data-payroll-loan-list-empty]').hidden).toBe(false);
    expect(document.querySelector('[data-payroll-loan-list-count]').textContent).toContain('1 con cobros seleccionados fuera del filtro');
});

test('fixed-only payroll honours its explicit payer instead of matching every current assigned leader', () => {
    const person = employee('fixed', '005', 'Pago fijo', ['p1', 'p2']);
    const list = buildPayrollLoanList(buildPayrollLoansDesktopModel([person]).groups, { employees: [person], positions, leaders,
        payrollRows: [{ _employeeId: 'fixed', _personalAdjustmentPayerId: 'A', _positionBreakdown: [] }] });
    expect(matchesPayrollLoanList(list.rows[0], { leader: 'A' })).toBe(true);
    expect(matchesPayrollLoanList(list.rows[0], { leader: 'B' })).toBe(false);
});

test('filtering preserves amounts, selection, open details, input identity and draft edits without rendering payroll', () => {
    mount();
    const before = JSON.stringify(options);
    const metrics = document.querySelector('.payroll-loans-metrics').innerHTML;
    const details = document.querySelector('[data-employee-id="two"]');
    const draft = document.createElement('input'); draft.value = '123.45'; details.append(draft);
    const query = document.querySelector('[data-payroll-loan-filter="query"]');
    change('query', 'Ana'); expect(visible()).toEqual(['ten']);
    expect(details.hidden).toBe(true); expect(details.open).toBe(true); expect(draft.value).toBe('123.45');
    expect(document.querySelector('[data-payroll-loan-filter="query"]')).toBe(query);
    expect(document.activeElement).toBe(query);
    expect(document.querySelector('.payroll-loans-metrics').innerHTML).toBe(metrics);
    expect(JSON.stringify(options)).toBe(before);
    expect([...document.querySelectorAll('[data-payroll-loan-list-bulk]')].every(button => button.disabled)).toBe(true);
    expect(handlePayrollLoanListFilter({ type: 'click', target: document.querySelector('[data-payroll-loan-filter-clear]') })).toBe(true);
    expect(visible()).toEqual(['one', 'two', 'ten']);
    expect(document.querySelector('[data-payroll-action="clear-payroll-loans"]').disabled).toBe(false);
    expect(document.activeElement).toBe(query); expect(draft.value).toBe('123.45');
});

test('filters survive a loan-selection rerender but reset on project, period or payroll leader change', () => {
    mount(); change('query', 'Juan');
    mount(); expect(visible()).toEqual(['two']);
    expect(document.querySelector('[data-payroll-loan-filter="query"]').value).toBe('Juan');
    options.filterKey = 'another-project-period-leader';
    mount(); expect(visible()).toEqual(['one', 'two', 'ten']);
    expect(document.querySelector('[data-payroll-loan-filter="query"]').value).toBe('');
});

test('clearing filters does not reenable actions disabled by payroll rules', () => {
    options.bulkEnabled = false; options.selection = [];
    mount(); change('query', 'Juan');
    handlePayrollLoanListFilter({ type: 'click', target: document.querySelector('[data-payroll-loan-filter-clear]') });
    expect(document.querySelector('[data-payroll-action="set-payroll-loans-salary-bulk"]').disabled).toBe(true);
    expect(document.querySelector('[data-payroll-action="clear-payroll-loans"]').disabled).toBe(true);
});

test('renders an empty catalogue and untrusted names as text without executable markup', () => {
    options.employees = [employee('x', '005', '<img src=x onerror=alert(1)>', ['p1'])];
    options.leaders = [{ id: 'B', name: '<svg onload=alert(1)>' }];
    mount();
    expect(document.querySelector('img, svg[onload]')).toBeNull();
    change('query', 'onerror'); expect(visible()).toEqual(['x']);
    options.employees = []; mount();
    expect(document.querySelector('.payroll-loans-table__empty').textContent).toContain('No hay préstamos activos');
});

test('real payroll delegation handles typing, select changes and clearing without rendering or writing state', () => {
    const context = { state: { exportConfig: {} }, services: { payroll: {} }, render: jest.fn() };
    PayrollUI.init(context); mount();
    const before = JSON.stringify(context.state);
    const search = document.querySelector('[data-payroll-loan-filter="query"]');
    search.value = 'Juan'; search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(visible()).toEqual(['two']);
    const leader = document.querySelector('[data-payroll-loan-filter="leader"]');
    leader.value = 'B'; leader.dispatchEvent(new Event('change', { bubbles: true }));
    expect(visible()).toEqual([]);
    document.querySelector('[data-payroll-loan-filter-clear]').click();
    expect(visible()).toEqual(['one', 'two', 'ten']);
    expect(context.render).not.toHaveBeenCalled();
    expect(JSON.stringify(context.state)).toBe(before);
});

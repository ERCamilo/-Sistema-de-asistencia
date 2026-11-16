import { filterPayrollRowsByLeader } from '../modules/features/payroll/PayrollPreview.js';
import { renderPayrollLeaderAdjustments } from '../modules/features/payroll/PayrollLeaderAdjustments.js';

const positions = [{ id: 'a', leaderId: 'A' }, { id: 'b', leaderId: 'B' }];
const employees = [{ id: 'juan', positions: ['a', 'b'], positionAssignments: {
    b: { workLeaderId: 'B', isLoanPosition: true, payerLeaderId: 'A' }
} }];
const part = (positionId, workLeaderId, payerLeaderId) => ({
    positionId, positionName: positionId, assignmentSchemaVersion: 1,
    workLeaderId, payerLeaderId, isLoanPosition: workLeaderId !== payerLeaderId,
    regularHours: 8, subtotal: 900
});
const row = {
    _employeeId: 'juan', _brutoOriginal: 1800, monto: 1800,
    _totalHours: 16, _bonuses: 0, _deductions: 0, _loans: 0,
    _positionBreakdown: [part('a', 'A', 'A'), part('b', 'B', 'A')]
};
const filter = (rows, leaderId, hoursScope = 'all', options = {}) =>
    filterPayrollRowsByLeader(rows, { positions, employees, leaderId, hoursScope, ...options });

test('assigned payroll obeys the hours toggle without paying lent work twice', () => {
    const original = JSON.stringify(row);
    expect(filter([row], 'A')[0]).toMatchObject({ monto: 1800, _totalHours: 16 });
    expect(filter([row], 'A', 'leader')[0]).toMatchObject({ monto: 900, _totalHours: 8 });
    expect(filter([row], 'B')).toEqual([]);
    expect(filter([row], 'B', 'leader')).toEqual([]);
    expect(filter([row], 'all', 'leader')).toEqual([row]);
    expect(JSON.stringify(row)).toBe(original);
});

test('the same position can have different historical teams within one period', () => {
    const source = { ...row, _positionBreakdown: [part('b', 'A', 'A'), part('b', 'B', 'A')] };
    const result = filter([source], 'A', 'leader')[0];
    expect(result).toMatchObject({ monto: 900, _totalHours: 8 });
    expect(result._positionBreakdown).toEqual([source._positionBreakdown[0]]);
});

test('an overridden team uses its captured leader rather than the position catalogue', () => {
    const source = { ...row, monto: 900, _brutoOriginal: 900,
        _positionBreakdown: [part('b', 'A', 'A')] };
    expect(filter([source], 'A', 'leader')[0].monto).toBe(900);
    expect(filter([source], 'B', 'leader')).toEqual([]);
});

test('filtering mixed old and configured employees preserves their display order', () => {
    const legacy = { _employeeId: 'ana', monto: 500, _positionBreakdown: [{ positionId: 'a', subtotal: 500 }] };
    expect(filter([legacy, row], 'A').map(item => item._employeeId)).toEqual(['ana', 'juan']);
});

test('without work, only-hours mode excludes a loan assigned to another team', () => {
    const empty = { _employeeId: 'juan', monto: 200, _bonuses: 200, _positionBreakdown: [] };
    const onlyLoan = [{ ...employees[0], positions: ['b'] }];
    expect(filter([empty], 'A', 'all', { employees: onlyLoan })).toEqual([empty]);
    expect(filter([empty], 'A', 'leader', { employees: onlyLoan })).toEqual([]);
});

test('a partial hours report labels the full-period leader balance explicitly', () => {
    const group = { key: 'period', leaderId: 'B', leaderName: 'Bruno', enabled: true,
        subtotal: 500, amount: 900, balance: -400, entries: [] };
    const host = document.createElement('div');
    host.innerHTML = renderPayrollLeaderAdjustments([group], { hoursFiltered: true });
    expect(host.textContent).toContain('Subtotal completo $500.00');
    expect(host.textContent).toContain('Saldo completo −$400.00');
    expect(host.textContent).toContain('El filtro de puestos solo limita la tabla de empleados.');
    expect(host.querySelector('input').disabled).toBe(false);
    expect(group.balance).toBe(-400);
});

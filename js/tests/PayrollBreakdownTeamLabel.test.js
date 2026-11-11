import { payrollPartTeamLabel, renderPayrollReviewTable } from '../modules/features/payroll/PayrollReviewTable.js';

const catalogue = { positions: [{ id: 'p', name: 'Ayudante', leaderId: 'L2' }, { id: 'q', name: 'Plomero', leaderId: null }],
    leaders: [{ id: 'L1', name: 'Luis' }, { id: 'L2', name: 'Marcos' }] };

test('a line that follows the job shows the leader of the job', () => {
    expect(payrollPartTeamLabel({ positionId: 'p' }, catalogue)).toBe('Equipo de Marcos');
    expect(payrollPartTeamLabel({ positionId: 'q' }, catalogue)).toBe('Sin líder');
});

test('a line with a recorded team shows that team, and the payer only when it is someone else', () => {
    const own = { positionId: 'p', assignmentSchemaVersion: 1, workLeaderId: 'L1', workLeaderName: 'Luis', payerLeaderId: 'L1', payerLeaderName: 'Luis' };
    expect(payrollPartTeamLabel(own, catalogue)).toBe('Equipo de Luis');
    expect(payrollPartTeamLabel({ ...own, isLoanPosition: true, payerLeaderId: 'L2', payerLeaderName: 'Marcos' }, catalogue)).toBe('Equipo de Luis · paga Marcos');
});

test('a leader renamed or removed from the catalogue still reads sensibly', () => {
    expect(payrollPartTeamLabel({ assignmentSchemaVersion: 1, workLeaderId: 'L1', workLeaderName: 'Nombre viejo' }, catalogue)).toBe('Equipo de Luis');
    expect(payrollPartTeamLabel({ assignmentSchemaVersion: 1, workLeaderId: 'gone', workLeaderName: 'Pedro' }, catalogue)).toBe('Equipo de Pedro');
    expect(payrollPartTeamLabel({ assignmentSchemaVersion: 1, workLeaderId: 'gone' }, catalogue)).toBe('Líder no disponible');
});

test('the review table prints the team under each job, escaped', () => {
    const row = { _employeeId: 'e', _employeeName: 'Agenor', _number: '8', monto: 1800, _brutoOriginal: 1800, _totalHours: 16,
        _positionBreakdown: [
            { positionId: 'p', positionName: 'Ayudante', hourlyRate: 112.5, regularHours: 8, regularAmount: 900, subtotal: 900 },
            { positionId: 'p', positionName: 'Ayudante', hourlyRate: 112.5, regularHours: 8, regularAmount: 900, subtotal: 900,
                assignmentSchemaVersion: 1, workLeaderId: 'x', workLeaderName: '<b>Otro</b>', payerLeaderId: 'x' }] };
    document.body.innerHTML = `<table>${renderPayrollReviewTable({ rows: [row], sourceRows: [row], ...catalogue })}</table>`;
    const teams = [...document.querySelectorAll('.payroll-breakdown-details__team')].map(node => node.textContent);
    expect(teams).toEqual(['Equipo de Marcos', 'Equipo de <b>Otro</b>']);
    expect(document.querySelector('.payroll-breakdown-details__team b')).toBeNull();
});

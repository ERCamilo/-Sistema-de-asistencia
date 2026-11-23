import { renderPositionAssignmentControls, attachPositionAssignmentControls } from '../modules/features/employees/EmployeePositionAssignmentUI.js';
import { prepareEmployeePositionAssignments, captureAttendancePositionAssignments } from '../modules/features/employees/EmployeePositionAssignments.js';

const day = n => `2026-11-${String(n).padStart(2, '0')}`;
const at = (n, hour) => new Date(`${day(n)}T${String(hour).padStart(2, '0')}:00:00`).getTime();
function scene({ olderChange = true } = {}) {
    const state = { settings: { regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-11-01', periodLength: 15 } },
        leaders: [{ id: 'L1', name: 'Luis' }, { id: 'L2', name: 'Marcos' }],
        positions: [{ id: 'p', name: 'Ayudante', leaderId: 'L2', hourlyRate: 62.5, workingDays: [0, 1, 2, 3, 4, 5, 6] }],
        employees: [{ id: 'juan', number: '2', name: 'Juan', positions: ['p'] }], attendance: {} };
    const juan = state.employees[0];
    const mark = n => { state.attendance[`juan-${day(n)}`] = captureAttendancePositionAssignments({ employeeId: 'juan', date: day(n), present: true,
        selectedPosition: 'p', hoursWorked: 8, createdAt: at(n, 18), updatedAt: at(n, 18) }, state, at(n, 18)); };
    if (olderChange) {
        juan.positionAssignments = prepareEmployeePositionAssignments(juan, { p: { workLeaderId: 'L1' } }, state, at(1, 8));
        mark(3); mark(4);
        juan.positionAssignments = prepareEmployeePositionAssignments(juan, { p: { workLeaderId: 'L2' } }, state, at(5, 8));
    }
    mark(5);
    document.body.innerHTML = `<div id="list"><div class="card">${renderPositionAssignmentControls({ employee: juan, position: state.positions[0], leaders: state.leaders, primaryLeaderId: 'L2' })}</div></div>`;
    const card = document.querySelector('.card');
    attachPositionAssignmentControls(card, { list: document.getElementById('list'), state, employee: juan, position: state.positions[0] });
    return { card, notice: card.querySelector('[data-position-other-leader]'), work: card.querySelector('[data-position-work-leader]') };
}
afterEach(() => { document.body.innerHTML = ''; });

test('days left with a previous leader are announced on the job card with the action to move them', () => {
    const { notice } = scene();
    expect(notice.hidden).toBe(false);
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.querySelector('[data-position-other-leader-text]').textContent).toBe('2 días del período están con otro líder (Luis).');
    expect(notice.querySelector('button').textContent).toBe('Pasar a Marcos');
});

test('when every day already belongs to the current leader there is no notice', () => {
    expect(scene({ olderChange: false }).notice.hidden).toBe(true);
});

test('the notice refers to what is saved: it hides while the form holds an unsaved leader', () => {
    const { notice, work } = scene();
    work.value = 'L1'; work.dispatchEvent(new Event('change'));
    expect(notice.hidden).toBe(true);
    work.value = 'L2'; work.dispatchEvent(new Event('change'));
    expect(notice.hidden).toBe(false);
});

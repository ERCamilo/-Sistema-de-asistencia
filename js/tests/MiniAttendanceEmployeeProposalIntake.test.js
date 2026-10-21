import { buildAttendanceEmployeeProposals } from '../modules/features/attendance/MiniAttendanceEmployeeProposal.js';
import { buildEmployeeIntakePlan } from '../modules/features/p2p/MiniEmployeeIntake.js';

// End to end with the real intake rules: what Mini reports with the attendance can
// create an unknown employee, or link to an existing one and update it.
const PROJECT = 'P-1';
const scope = { enabled: true, projectId: PROJECT, defaultProjectId: PROJECT };
const row = { id: 'item-1', saEmployeeId: null, sources: [{
    sourcePeerId: 'peer-1', deviceId: 'Mini de Juan', miniLocalId: 'u7', number: '007', name: 'Pedro Nuevo',
    positionName: 'Albañil', dailySalary: 1600, workDate: '2026-10-20', capturedAt: '2026-10-20T20:00:00.000Z'
}] };
const proposal = () => buildAttendanceEmployeeProposals([row], { saProjectId: PROJECT }).groups[0].proposal;
const context = { scope, employees: [], positions: [], hoursPerDay: 8, now: Date.parse('2026-10-21T12:00:00.000Z'), createId: kind => `${kind}-new` };

test('crear: el empleado nuevo nace con el sueldo y el puesto que reportó Mini', () => {
    const plan = buildEmployeeIntakePlan(proposal(), [{ miniLocalId: 'u7', action: 'create' }], context);
    expect(plan.employees).toHaveLength(1);
    expect(plan.employees[0]).toMatchObject({ id: 'emp-new', number: '007', name: 'Pedro Nuevo', projectId: PROJECT, active: true });
    expect(plan.positions.map(p => p.name)).toEqual(['Albañil']);
    expect(plan.employees[0].positionSalaries['pos-new']).toBe(200); // 1600 por día / 8 horas
    expect(plan.mappings).toEqual([expect.objectContaining({ miniLocalId: 'u7', saEmployeeId: 'emp-new', dailySalary: 1600 })]);
});

test('crear reutiliza el puesto de SA con el mismo nombre', () => {
    const plan = buildEmployeeIntakePlan(proposal(), [{ miniLocalId: 'u7', action: 'create' }], {
        ...context, positions: [{ id: 'pos-1', name: 'Albañil', hourlyRate: 150, projectId: PROJECT, active: true }]
    });
    expect(plan.positions).toEqual([]);
    expect(plan.employees[0].positions).toEqual(['pos-1']);
    expect(plan.employees[0].positionSalaries['pos-1']).toBe(200);
});

test('vincular y actualizar: SA toma el sueldo y el puesto del Mini solo si se pide actualizar', () => {
    const existing = { id: 'emp-old', number: '70', name: 'Pedro Existente', positions: ['pos-1'], positionSalaries: { 'pos-1': 100 }, projectId: PROJECT, active: true };
    const positions = [{ id: 'pos-1', name: 'Peón', hourlyRate: 100, projectId: PROJECT, active: true }];

    const kept = buildEmployeeIntakePlan(proposal(), [{ miniLocalId: 'u7', action: 'link', employeeId: 'emp-old' }], { ...context, employees: [existing], positions });
    expect(kept.employees).toEqual([]);
    expect(kept.mappings[0]).toMatchObject({ saEmployeeId: 'emp-old', dailySalary: 800 }); // SA conserva su tarifa

    const updated = buildEmployeeIntakePlan(proposal(), [{ miniLocalId: 'u7', action: 'link', employeeId: 'emp-old', update: true, positionId: 'new' }], { ...context, employees: [existing], positions });
    expect(updated.employees[0]).toMatchObject({ id: 'emp-old', number: '007', name: 'Pedro Nuevo' });
    expect(updated.positions.map(p => p.name)).toEqual(['Albañil']);
    expect(updated.employees[0].positionSalaries['pos-new']).toBe(200);
    expect(updated.employees[0].positions).toEqual(['pos-1', 'pos-new']);
    expect(updated.mappings[0].saEmployeeId).toBe('emp-old');
});

test('falta de sueldo o puesto en Mini no se inventa: SA exige completarlo antes de crear', () => {
    const bare = buildAttendanceEmployeeProposals([{ ...row, sources: [{ ...row.sources[0], dailySalary: undefined, positionName: undefined }] }], { saProjectId: PROJECT }).groups[0].proposal;
    expect(bare.employees[0]).toMatchObject({ position: '', dailySalary: null });
    expect(() => buildEmployeeIntakePlan(bare, [{ miniLocalId: 'u7', action: 'create' }], context)).toThrow(/puesto y salario/i);
    const completed = buildEmployeeIntakePlan(bare, [{ miniLocalId: 'u7', action: 'create', fields: { position: 'Peón', dailySalary: 900 } }], context);
    expect(completed.employees[0].positionSalaries['pos-new']).toBe(112.5);
});

/**
 * Puestos no encontrados (2026-11-16): una restauración dejó a 42 empleados
 * apuntando a 7 puestos que ya no existen en el catálogo. La reparación se
 * hace desde Multiobra: detectar, proponer el puesto con el mismo nombre,
 * revisar salarios, aplicar (con datos para deshacer) y deshacer.
 */
import {
    findMissingPositionReferences,
    suggestRepairTarget,
    planPositionRepair,
    applyPositionRepairPlan,
    undoPositionRepair
} from '../modules/features/projects/MissingPositionRepair.js';

const OBRA = 'PRJ-1';

function data() {
    return {
        positions: [
            { id: 'varillero', name: 'Varillero', hourlyRate: 100 },
            { id: 'plomero', name: 'Plomero', hourlyRate: 0, salaryConfig: { amount: 24000 } },
            { id: 'varillero-otra', name: 'Varillero', hourlyRate: 90, projectId: 'PRJ-2' },
            { id: 'albanil', name: 'Albañil', hourlyRate: 80, projectId: OBRA }
        ],
        employees: [
            { id: 'e1', number: '1', name: 'Ana', projectId: OBRA, positions: ['old-var', 'albanil'],
                positionSalaries: { 'old-var': 120, albanil: 85 }, positionSalaryModes: { 'old-var': 'daily' },
                positionAssignments: { 'old-var': { workLeaderId: 'L1', positionName: 'Varillero' } },
                customWorkingDays: { 'old-var': [1, 2, 3] }, updatedAt: 1 },
            { id: 'e2', number: '2', name: 'Beto', projectId: OBRA, positions: ['old-var'], updatedAt: 1 },
            { id: 'e3', number: '3', name: 'Caro', projectId: OBRA, positions: ['old-plo'],
                positionSalaries: { 'old-plo': 70 }, updatedAt: 1 },
            { id: 'e4', number: '4', name: 'Dani', projectId: OBRA, positions: ['albanil'], updatedAt: 1 }
        ],
        attendance: {
            'e2-2026-11-02': { employeeId: 'e2', date: '2026-11-02', selectedPosition: 'old-var',
                positionHours: [{ positionId: 'old-var', hours: 8 }],
                positionAssignments: { 'old-var': { schemaVersion: 1, positionId: 'old-var', positionName: 'Varillero', hourlyRate: 100 } } },
            'e1-2026-11-02': { employeeId: 'e1', date: '2026-11-02',
                positionHours: [{ positionId: 'old-var', hours: 4 }, { positionId: 'albanil', hours: 4 }] },
            'e3-2026-11-03': { employeeId: 'e3', date: '2026-11-03', positionHours: [{ positionId: 'old-plo', hours: 8 }] }
        }
    };
}

describe('findMissingPositionReferences', () => {
    test('agrupa por id faltante con empleados, salarios, días y el nombre conocido', () => {
        const found = findMissingPositionReferences(data(), { defaultProjectId: OBRA, extraNames: { 'old-plo': 'Plomero' } });
        expect(found.map(item => item.positionId)).toEqual(['old-var', 'old-plo']);
        const varillero = found[0];
        expect(varillero.employeeIds.sort()).toEqual(['e1', 'e2']);
        expect(varillero.salaryEmployeeIds).toEqual(['e1']);
        expect(varillero.attendanceKeys.sort()).toEqual(['e1-2026-11-02', 'e2-2026-11-02']);
        expect(varillero.name).toBe('Varillero');
        expect(varillero.projectIds).toEqual([OBRA]);
        expect(found[1].name).toBe('Plomero'); // desde un respaldo (extraNames)
    });

    test('no reporta nada con un catálogo completo', () => {
        const d = data();
        d.positions.push({ id: 'old-var', name: 'Varillero' }, { id: 'old-plo', name: 'Plomero' });
        expect(findMissingPositionReferences(d)).toEqual([]);
    });

    test('sin ninguna pista de nombre queda sin nombre (no se inventa)', () => {
        const [, plomero] = findMissingPositionReferences(data(), { defaultProjectId: OBRA });
        expect(plomero.name).toBeNull();
    });
});

describe('suggestRepairTarget', () => {
    test('elige el puesto del mismo nombre de la obra de los empleados (sin obra = obra predeterminada)', () => {
        const [varillero] = findMissingPositionReferences(data(), { defaultProjectId: OBRA });
        const suggestion = suggestRepairTarget(varillero, data().positions, { defaultProjectId: OBRA });
        expect(suggestion.targetId).toBe('varillero');
        expect(suggestion.candidates.map(c => c.id).sort()).toEqual(['varillero', 'varillero-otra']);
    });

    test('sin nombre o con varios iguales en la misma obra no sugiere nada', () => {
        const [, plomero] = findMissingPositionReferences(data(), { defaultProjectId: OBRA });
        expect(suggestRepairTarget(plomero, data().positions, { defaultProjectId: OBRA }).targetId).toBeNull();
        const [varillero] = findMissingPositionReferences(data(), { defaultProjectId: OBRA });
        const twins = [...data().positions, { id: 'varillero-2', name: 'varillero ' }];
        expect(suggestRepairTarget(varillero, twins, { defaultProjectId: OBRA }).targetId).toBeNull();
    });
});

describe('planPositionRepair', () => {
    test('pasa salarios y ajustes por puesto, y lista quién usará la tarifa general', () => {
        const d = data();
        const plan = planPositionRepair(d, {
            'old-var': { targetId: 'varillero' },
            'old-plo': { targetId: 'plomero' }
        }, { hoursPerDay: 8 });
        expect(plan.ok).toBe(true);
        const e1 = plan.employeeChanges.find(c => c.employeeId === 'e1');
        expect(e1.after.positions).toEqual(['varillero', 'albanil']);
        expect(e1.after.positionSalaries).toEqual({ varillero: 120, albanil: 85 });
        expect(e1.after.positionSalaryModes).toEqual({ varillero: 'daily' });
        expect(e1.after.positionAssignments).toEqual({ varillero: { workLeaderId: 'L1', positionName: 'Varillero' } });
        expect(e1.after.customWorkingDays).toEqual({ varillero: [1, 2, 3] });
        expect(plan.generalRate).toEqual([
            expect.objectContaining({ employeeId: 'e2', targetId: 'varillero', hourlyRate: 100 })
        ]);
        expect(plan.attendanceChanges).toHaveLength(3);
        expect(plan.dateKeys.sort()).toEqual(['2026-11-02', '2026-11-03']);
        expect(plan.stats['old-var']).toMatchObject({ employees: 2, salaries: 1, days: 2, generalRate: 1 });
    });

    test('un salario escrito en la revisión se guarda como salario diario del puesto', () => {
        const plan = planPositionRepair(data(), {
            'old-var': { targetId: 'varillero', salaries: { e2: 960 } }
        }, { hoursPerDay: 8 });
        const e2 = plan.employeeChanges.find(c => c.employeeId === 'e2');
        expect(e2.after.positionSalaries).toEqual({ varillero: 120 });
        expect(e2.after.positionSalaryModes).toEqual({ varillero: 'daily' });
        expect(plan.generalRate).toEqual([]);
    });

    test('no pisa un salario que el empleado ya tenía en el puesto destino', () => {
        const d = data();
        d.employees[0].positionSalaries.varillero = 150;
        const plan = planPositionRepair(d, { 'old-var': { targetId: 'varillero' } }, { hoursPerDay: 8 });
        const e1 = plan.employeeChanges.find(c => c.employeeId === 'e1');
        expect(e1.after.positionSalaries.varillero).toBe(150);
        expect(plan.stats['old-var'].keptExistingSalary).toBe(1);
    });

    test('rechaza destinos que no existen o ids que sí están en el catálogo', () => {
        expect(planPositionRepair(data(), { 'old-var': { targetId: 'nada' } }).ok).toBe(false);
        expect(planPositionRepair(data(), { albanil: { targetId: 'varillero' } }).ok).toBe(false);
    });

    test('la asistencia conserva las horas y fusiona si el día ya tenía el destino', () => {
        const d = data();
        d.attendance['e1-2026-11-02'].positionHours = [{ positionId: 'old-var', hours: 4 }, { positionId: 'varillero', hours: 2 }];
        const plan = planPositionRepair(d, { 'old-var': { targetId: 'varillero' } });
        const day = plan.attendanceChanges.find(c => c.key === 'e1-2026-11-02').record;
        expect(day.positionHours).toEqual([{ positionId: 'varillero', hours: 6, overtimeHours: 0 }]);
        const e2day = plan.attendanceChanges.find(c => c.key === 'e2-2026-11-02').record;
        expect(e2day.selectedPosition).toBe('varillero');
        // Las condiciones congeladas del día pasan al puesto destino.
        expect(e2day.positionAssignments).toEqual({
            varillero: { schemaVersion: 1, positionId: 'varillero', positionName: 'Varillero', hourlyRate: 100 }
        });
    });
});

describe('applyPositionRepairPlan / undoPositionRepair', () => {
    test('aplica con estampas de sincronización y deshacer deja todo como estaba', () => {
        const d = data();
        const before = JSON.parse(JSON.stringify({ employees: d.employees, attendance: d.attendance }));
        const plan = planPositionRepair(d, { 'old-var': { targetId: 'varillero' }, 'old-plo': { targetId: 'plomero' } });
        const undo = applyPositionRepairPlan(d, plan, { now: 5000 });
        const e2 = d.employees.find(e => e.id === 'e2');
        expect(e2).toMatchObject({ positions: ['varillero'], updatedAt: 5000, positionsUpdatedAt: 5000, _isDirty: true });
        expect(d.attendance['e3-2026-11-03'].positionHours[0].positionId).toBe('plomero');
        expect(d.attendance['e3-2026-11-03'].updatedAt).toBe(5000);
        expect(findMissingPositionReferences(d)).toEqual([]);

        const result = undoPositionRepair(d, undo, { now: 6000 });
        expect(result.employeeIds.sort()).toEqual(['e1', 'e2', 'e3']);
        for (const original of before.employees) {
            const current = d.employees.find(e => e.id === original.id);
            for (const field of ['positions', 'positionSalaries', 'positionSalaryModes', 'positionAssignments', 'customWorkingDays']) {
                expect(current[field]).toEqual(original[field]);
            }
        }
        expect(d.attendance['e3-2026-11-03'].positionHours).toEqual(before.attendance['e3-2026-11-03'].positionHours);
        expect(d.attendance['e3-2026-11-03'].updatedAt).toBe(6000);
        expect(d.employees.find(e => e.id === 'e3').updatedAt).toBe(6000);
    });
});

describe('findPositionNamesInSnapshots', () => {
    test('toma el nombre del respaldo más reciente que lo tenga y se detiene al encontrarlos todos', async () => {
        const { findPositionNamesInSnapshots } = await import('../modules/features/projects/MissingPositionNameLookup.js');
        const getSnapshot = jest.fn(async snapId => ({
            s3: { state: { positions: [{ id: 'other', name: 'Otro' }] } },
            s2: { state: { positions: [{ id: 'old-var', name: 'Varillero', projectId: OBRA }] } },
            s1: { state: { positions: [{ id: 'old-var', name: 'Varillero viejo' }, { id: 'old-plo', name: 'Plomero' }] } },
            s0: { state: { positions: [] } }
        })[snapId]);
        const listSnapshots = async () => [{ id: 's3' }, { id: 'broken' }, { id: 's2', timestamp: 2 }, { id: 's1' }, { id: 's0' }];
        getSnapshot.mockImplementationOnce(async () => ({ state: { positions: [] } }));
        const failing = jest.fn(async snapId => { if (snapId === 'broken') throw new Error('x'); return getSnapshot(snapId); });
        const result = await findPositionNamesInSnapshots(['old-var', 'old-plo'], { listSnapshots, getSnapshot: failing });
        expect(result.names['old-var']).toMatchObject({ name: 'Varillero', projectId: OBRA, snapshotId: 's2' });
        expect(result.names['old-plo']).toMatchObject({ name: 'Plomero', snapshotId: 's1' });
        expect(result.failed).toBe(1);
        expect(failing).not.toHaveBeenCalledWith('s0');
    });
});

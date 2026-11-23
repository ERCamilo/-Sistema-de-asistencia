import { planProjectMerge, MERGE_BLOCKER } from '../modules/features/projects/ProjectMergePlan.js';

/**
 * Fusionar la obra B (sobrante) en la obra A (destino) es un cambio de DUEÑO:
 * los ids de empleados, puestos, líderes y asistencia no cambian, solo su obra.
 * El plan es puro y falla cerrado: solo es válido si, tras mover todo, B queda
 * vacía según la misma contabilidad que usa el borrado de obras.
 */
const TS = 5000;
const project = (id, name, extra = {}) => ({ id, name, status: 'active', createdAt: 100, updatedAt: 200, schemaVersion: 1, ...extra });
const emp = (id, projectId, extra = {}) => ({ id, number: id.toUpperCase(), name: `Emp ${id}`, projectId, loans: [], ...extra });
const att = (employeeId, date, projectId, extra = {}) => ({ key: `${employeeId}-${date}`, employeeId, date, projectId, present: true, hoursWorked: 8, ...extra });

function dataset(extra = {}) {
    return {
        projects: [project('A', 'Torre Norte'), project('B', 'Edificio Sur')],
        employees: [emp('e1', 'B'), emp('e2', 'B'), emp('e3', 'A'), emp('e4', 'OTRA')],
        positions: [{ id: 'p1', name: 'Albañil', projectId: 'B' }, { id: 'p2', name: 'Maestro', projectId: 'A' }],
        leaders: [{ id: 'l1', name: 'Jefe', projectId: 'B' }],
        attendance: [att('e1', '2026-01-05', 'B'), att('e2', '2026-01-05', 'B'), att('e3', '2026-01-05', 'A')],
        payrollClosures: [], pettyCashProjects: [], pettyCashPeriods: [], pettyCashMovements: [],
        mainSyncOutbox: [], pettyCashOutbox: [], sync_queue: [],
        ...extra
    };
}
const plan = (data, extra = {}) => planProjectMerge({ sourceId: 'B', targetId: 'A', data, timestamp: TS, ...extra });
const codes = result => result.blockers.map(b => b.code);

describe('lo que se mueve', () => {
    test('cambia la obra de empleados, puestos, líderes y asistencia de B a A, sin tocar ids', () => {
        const result = plan(dataset());
        expect(result.ok).toBe(true);
        expect(result.writes.employees.map(e => [e.id, e.projectId, e.updatedAt])).toEqual([['e1', 'A', TS], ['e2', 'A', TS]]);
        expect(result.writes.positions.map(p => [p.id, p.projectId])).toEqual([['p1', 'A']]);
        expect(result.writes.leaders.map(l => [l.id, l.projectId])).toEqual([['l1', 'A']]);
        expect(result.writes.attendance.map(a => [a.key, a.record.projectId]).sort()).toEqual([['e1-2026-01-05', 'A'], ['e2-2026-01-05', 'A']]);
        expect(result.counts).toMatchObject({ employees: 2, positions: 1, leaders: 1, attendance: 2 });
    });

    test('no muta las entradas ni toca lo de otras obras', () => {
        const data = dataset();
        const before = JSON.stringify(data);
        const result = plan(data);
        expect(JSON.stringify(data)).toBe(before);
        const touched = result.writes.employees.map(e => e.id);
        expect(touched).not.toContain('e3');
        expect(touched).not.toContain('e4');
    });

    test('incluye empleados borrados y asistencia con lápida: su historial aún referencia la obra', () => {
        const data = dataset({
            employees: [emp('e1', 'B', { deletedAt: 9 }), emp('e3', 'A')],
            attendance: [att('e1', '2026-01-05', 'B', { present: false, deletedAt: 9 })]
        });
        const result = plan(data);
        expect(result.ok).toBe(true);
        expect(result.writes.employees.map(e => e.id)).toEqual(['e1']);
        expect(result.writes.attendance).toHaveLength(1);
    });

    test('los registros sin obra no se tocan', () => {
        const result = plan(dataset({ employees: [emp('e1', 'B'), { id: 'e9', name: 'Sin obra' }] }));
        expect(result.writes.employees.map(e => e.id)).toEqual(['e1']);
    });

    test('reescribe la obra de préstamos, adelantos, bonos, deducciones y acuerdos de la persona', () => {
        const e1 = emp('e1', 'B', {
            loans: [{ id: 'L1', projectId: 'B', payments: [{ id: 'P1', projectId: 'B', amount: 10 }] }, { id: 'L2', projectId: 'A' }, { id: 'L3' }],
            advances: [{ id: 'AD1', projectId: 'B' }],
            bonuses: [{ id: 'BO1', projectId: 'B' }],
            deductions: [{ id: 'DE1', projectId: 'B' }],
            loanAgreements: [{ id: 'AG1', projectId: 'B' }]
        });
        const result = plan(dataset({ employees: [e1], attendance: [] }));
        expect(result.ok).toBe(true);
        const moved = result.writes.employees[0];
        expect(moved.loans[0]).toMatchObject({ id: 'L1', projectId: 'A' });
        expect(moved.loans[0].payments[0]).toMatchObject({ id: 'P1', projectId: 'A', amount: 10 });
        expect(moved.loans[1].projectId).toBe('A');
        expect(moved.loans[2]).toEqual({ id: 'L3' });
        expect(moved.advances[0].projectId).toBe('A');
        expect(moved.bonuses[0].projectId).toBe('A');
        expect(moved.deductions[0].projectId).toBe('A');
        expect(moved.loanAgreements[0].projectId).toBe('A');
    });

    test('un préstamo con obra explícita B de una persona sin obra también se pasa, y lo de otra obra no', () => {
        const e9 = { id: 'e9', name: 'Sin obra', loans: [{ id: 'L9', projectId: 'B' }] };
        const result = plan(dataset({ employees: [e9, emp('e3', 'A', { loans: [{ id: 'L3', projectId: 'OTRA' }] })], attendance: [] }));
        expect(result.ok).toBe(true);
        expect(result.writes.employees.map(e => e.id)).toEqual(['e9']);
        expect(result.writes.employees[0].loans[0].projectId).toBe('A');
    });

    test('el parche de memoria de cada empleado solo trae los campos que cambian', () => {
        const e1 = emp('e1', 'B', { name: 'Ana', loans: [{ id: 'L1', projectId: 'B' }], advances: [{ id: 'AD1' }] });
        const result = plan(dataset({ employees: [e1], attendance: [] }));
        const patch = result.memory.employeeMerges.get('e1');
        expect(Object.keys(patch).sort()).toEqual(['loans', 'projectId']);
        expect(patch.projectId).toBe('A');
        expect(result.memory.positionProjectIds.get('p1')).toBe('A');
        expect(result.memory.leaderProjectIds.get('l1')).toBe('A');
        expect(result.memory.attendanceProjectIds.size).toBe(0);
    });
});

describe('caja chica', () => {
    const cashData = (extra = {}) => dataset({
        pettyCashProjects: [
            { id: 'PC1', name: 'Gastos', officialProjectId: 'B', nextRecordNumber: 9 },
            { id: 'PC2', name: 'Otra caja', officialProjectId: 'A' },
            { id: 'PC3', name: 'De otra obra', officialProjectId: 'OTRA' },
            { id: 'PC4', name: 'Sin obra' }
        ],
        pettyCashPeriods: [{ id: 'per1', projectId: 'PC1', name: 'Septiembre' }],
        pettyCashMovements: [{ id: 'mov1', projectId: 'PC1', periodId: 'per1', amount: 250 }],
        ...extra
    });

    test('repunta el vínculo de las cajas de B a A, sin tocar períodos ni movimientos', () => {
        const result = plan(cashData());
        expect(result.ok).toBe(true);
        expect(result.writes.pettyCash).toEqual([{ id: 'PC1', name: 'Gastos', officialProjectId: 'A', nextRecordNumber: 9, updatedAt: TS }]);
        expect(result.memory.pettyCashProjectIds).toEqual(new Map([['PC1', 'A']]));
        expect(result.counts.pettyCash).toBe(1);
        expect(JSON.stringify(result.writes)).not.toContain('mov1');
    });

    test('las cajas de otra obra o sin vínculo no se tocan', () => {
        const { writes } = plan(cashData());
        expect(writes.pettyCash.map(c => c.id)).toEqual(['PC1']);
    });

    test('si solo hay caja chica que mover, la fusión no está vacía', () => {
        const result = plan(cashData({ employees: [], positions: [], leaders: [], attendance: [] }), { adopt: false });
        expect(result.empty).toBe(false);
        expect(result.counts).toMatchObject({ employees: 0, pettyCash: 1 });
    });

    test('también se mueve al adoptar en un dispositivo atrasado', () => {
        const tomb = { ...project('B', 'Edificio Sur'), deletedAt: 300, mergedIntoId: 'A' };
        const result = planProjectMerge({ sourceId: 'B', targetId: 'A', data: cashData({ projects: [project('A', 'Torre Norte'), tomb] }), timestamp: TS, adopt: true });
        expect(result.ok).toBe(true);
        expect(result.writes.pettyCash.map(c => c.id)).toEqual(['PC1']);
    });

    test('no muta las entradas', () => {
        const data = cashData();
        const before = JSON.stringify(data);
        plan(data);
        expect(JSON.stringify(data)).toBe(before);
    });
});

describe('catálogo', () => {
    test('retira B con lápida y mergedIntoId, y sube su updatedAt', () => {
        const { writes } = plan(dataset());
        const source = writes.projects.find(p => p.id === 'B');
        expect(source).toMatchObject({ deletedAt: TS, mergedIntoId: 'A', updatedAt: TS, name: 'Edificio Sur' });
    });

    test('el updatedAt nunca retrocede aunque el reloj local vaya atrasado', () => {
        const data = dataset({ projects: [project('A', 'Torre Norte'), project('B', 'Edificio Sur', { updatedAt: TS + 90 })] });
        const source = plan(data).writes.projects.find(p => p.id === 'B');
        expect(source.updatedAt).toBe(TS + 91);
        expect(source.deletedAt).toBe(TS + 91);
    });

    test('sin nombre nuevo, el destino conserva su nombre y no se reescribe', () => {
        const { writes } = plan(dataset());
        expect(writes.projects.map(p => p.id)).toEqual(['B']);
        expect(plan(dataset(), { projectName: '   ' }).writes.projects.map(p => p.id)).toEqual(['B']);
    });

    test('con nombre nuevo, el destino se renombra', () => {
        const { writes } = plan(dataset(), { projectName: '  Torre   Norte II ' });
        const target = writes.projects.find(p => p.id === 'A');
        expect(target).toMatchObject({ name: 'Torre Norte II', updatedAt: TS });
    });

    test('el nombre puede ser el de cualquiera de las dos obras', () => {
        expect(plan(dataset(), { projectName: 'Edificio Sur' }).ok).toBe(true);
        expect(plan(dataset(), { projectName: 'torre norte' }).ok).toBe(true);
    });

    test('rechaza un nombre que ya usa otra obra, también uno pendiente de resolver', () => {
        const others = [project('A', 'Torre Norte'), project('B', 'Edificio Sur'), project('C', 'Hospital'),
            project('D', 'Provisional (pendiente)', { metadata: { nameConflict: { requestedName: 'Clínica' } } })];
        expect(codes(plan(dataset({ projects: others }), { projectName: ' hospital ' }))).toEqual([MERGE_BLOCKER.NAME_TAKEN]);
        expect(codes(plan(dataset({ projects: others }), { projectName: 'Clínica' }))).toEqual([MERGE_BLOCKER.NAME_TAKEN]);
    });

    test('rechaza un nombre de más de 80 caracteres', () => {
        expect(codes(plan(dataset(), { projectName: 'x'.repeat(81) }))).toEqual([MERGE_BLOCKER.NAME_INVALID]);
    });
});

describe('cuándo se bloquea', () => {
    test('la misma obra, ids vacíos u obras que no existen', () => {
        expect(codes(planProjectMerge({ sourceId: 'A', targetId: 'A', data: dataset(), timestamp: TS }))).toContain(MERGE_BLOCKER.SAME_PROJECT);
        expect(codes(planProjectMerge({ sourceId: '', targetId: 'A', data: dataset(), timestamp: TS }))).toContain(MERGE_BLOCKER.SAME_PROJECT);
        expect(codes(planProjectMerge({ sourceId: 'X', targetId: 'A', data: dataset(), timestamp: TS }))).toEqual([MERGE_BLOCKER.SOURCE_UNAVAILABLE]);
        expect(codes(planProjectMerge({ sourceId: 'B', targetId: 'X', data: dataset(), timestamp: TS }))).toEqual([MERGE_BLOCKER.TARGET_UNAVAILABLE]);
    });

    test('obras borradas o que no están activas', () => {
        const closed = { closedAt: 1, status: 'closed' };
        expect(codes(plan(dataset({ projects: [project('A', 'x'), project('B', 'y', closed)] })))).toEqual([MERGE_BLOCKER.SOURCE_NOT_ACTIVE]);
        expect(codes(plan(dataset({ projects: [project('A', 'x', closed), project('B', 'y')] })))).toEqual([MERGE_BLOCKER.TARGET_NOT_ACTIVE]);
        expect(codes(plan(dataset({ projects: [project('A', 'x', { deletedAt: 3 }), project('B', 'y')] })))).toEqual([MERGE_BLOCKER.TARGET_UNAVAILABLE]);
        expect(codes(plan(dataset({ projects: [project('A', 'x'), project('B', 'y', { deletedAt: 3 })] })))).toEqual([MERGE_BLOCKER.SOURCE_UNAVAILABLE]);
    });

    test('la obra inicial no se puede retirar', () => {
        expect(codes(plan(dataset(), { protectedIds: { defaultProjectId: 'B' } }))).toEqual([MERGE_BLOCKER.SOURCE_IS_DEFAULT]);
        expect(plan(dataset(), { protectedIds: { defaultProjectId: 'A' } }).ok).toBe(true);
    });

    test('cierres de nómina de la obra sobrante', () => {
        const result = plan(dataset({ payrollClosures: [{ id: 'C1', projectId: 'B', rows: [] }] }));
        expect(result.ok).toBe(false);
        expect(codes(result)).toContain(MERGE_BLOCKER.PAYROLL_CLOSURES);
    });

    test('caja chica con otras referencias a la obra sobrante que no se saben mover', () => {
        const odd = dataset({ pettyCashProjects: [{ id: 'PC1', officialProjectId: 'B', meta: { sourceProjectId: 'B' } }] });
        expect(plan(odd).ok).toBe(false);
        expect(codes(plan(odd))).toContain(MERGE_BLOCKER.OTHER_REFERENCES);
    });

    test('cambios de caja chica sin sincronizar que mencionan la obra sobrante', () => {
        const result = plan(dataset({
            pettyCashProjects: [{ id: 'PC1', officialProjectId: 'B' }],
            pettyCashOutbox: [{ key: 1, op: 'save', col: 'projects', id: 'PC1', data: { id: 'PC1', officialProjectId: 'B' }, status: 'pending' }]
        }));
        expect(codes(result)).toContain(MERGE_BLOCKER.UNSYNCED_CHANGES);
    });

    test('cambios sin sincronizar que mencionan la obra sobrante', () => {
        const result = plan(dataset({ mainSyncOutbox: [{ id: 'o1', kind: 'daily', scope: { projectId: 'B' } }] }));
        expect(codes(result)).toContain(MERGE_BLOCKER.UNSYNCED_CHANGES);
    });

    test('un pago de nómina enlazado a un cierre no se reetiqueta', () => {
        const paid = emp('e1', 'B', { loans: [{ id: 'L1', projectId: 'B', payments: [{ id: 'P1', projectId: 'B', payrollClosureId: 'C9', payrollBatchSnapshot: { projectId: 'B' } }] }] });
        const result = plan(dataset({ employees: [paid], attendance: [] }));
        expect(result.ok).toBe(false);
        expect(codes(result)).toContain(MERGE_BLOCKER.PAYROLL_REFERENCE);
    });

    test('referencias a la obra que no se saben mover (origen/destino de un traspaso)', () => {
        const transferred = emp('e1', 'B', { loans: [{ id: 'L1', projectId: 'B', sourceProjectId: 'B' }] });
        const result = plan(dataset({ employees: [transferred], attendance: [] }));
        expect(result.ok).toBe(false);
        expect(codes(result)).toContain(MERGE_BLOCKER.NESTED_REFERENCE);
    });

    test('un puesto, líder o asistencia con la obra anidada se rechaza en lugar de adivinar', () => {
        const odd = dataset({ positions: [{ id: 'p1', name: 'Albañil', projectId: 'B', meta: { projectId: 'B' } }] });
        expect(codes(plan(odd))).toContain(MERGE_BLOCKER.NESTED_REFERENCE);
        const oddAtt = dataset({ attendance: [att('e1', '2026-01-05', 'B', { positionHours: [{ positionId: 'p1', hours: 8, projectId: 'B' }] })] });
        expect(codes(plan(oddAtt))).toContain(MERGE_BLOCKER.NESTED_REFERENCE);
    });

    test('otros registros que apuntan a la obra sobrante', () => {
        const result = plan(dataset({ tempAssignments: [{ id: 't1', employeeId: 'e1', projectId: 'B' }] }));
        expect(codes(result)).toContain(MERGE_BLOCKER.OTHER_REFERENCES);
    });

    test('un bloqueo no devuelve escrituras', () => {
        const result = plan(dataset({ payrollClosures: [{ id: 'C1', projectId: 'B', rows: [] }] }));
        expect(result.writes).toBeUndefined();
        expect(result.blockers[0].message).toEqual(expect.any(String));
    });
});

describe('cadenas de fusiones', () => {
    const old = { ...project('X', 'Vieja'), deletedAt: 50, mergedIntoId: 'B', updatedAt: 60 };

    test('las lápidas que apuntaban a la obra retirada pasan a apuntar al destino', () => {
        const { writes } = plan(dataset({ projects: [project('A', 'Torre Norte'), project('B', 'Edificio Sur'), old] }));
        const repointed = writes.projects.find(p => p.id === 'X');
        expect(repointed).toMatchObject({ deletedAt: 50, mergedIntoId: 'A', updatedAt: TS });
    });

    test('no toca lápidas que apuntan a otras obras ni obras que no están retiradas', () => {
        const unrelated = { ...project('Y', 'Otra'), deletedAt: 50, mergedIntoId: 'Z' };
        const live = { ...project('W', 'Viva'), mergedIntoId: 'B' };
        const { writes } = plan(dataset({ projects: [project('A', 'x'), project('B', 'y'), unrelated, live] }));
        expect(writes.projects.map(p => p.id)).toEqual(['B']);
    });

    test('al adoptar no se reescribe el catálogo', () => {
        const tomb = { ...project('B', 'y'), deletedAt: 300, mergedIntoId: 'A' };
        const result = planProjectMerge({ sourceId: 'B', targetId: 'A', data: dataset({ projects: [project('A', 'x'), tomb, old] }), timestamp: TS, adopt: true });
        expect(result.writes.projects).toEqual([]);
    });
});

describe('adopción en un dispositivo atrasado', () => {
    const tombstone = { ...project('B', 'Edificio Sur'), deletedAt: 300, mergedIntoId: 'A', updatedAt: 300 };
    const adoptPlan = (data, extra = {}) => planProjectMerge({ sourceId: 'B', targetId: 'A', data, timestamp: TS, adopt: true, ...extra });

    test('mueve lo que quedó con la obra retirada y no toca el catálogo', () => {
        const result = adoptPlan(dataset({ projects: [project('A', 'Torre Norte'), tombstone] }));
        expect(result.ok).toBe(true);
        expect(result.writes.employees.map(e => e.projectId)).toEqual(['A', 'A']);
        expect(result.writes.projects).toEqual([]);
    });

    test('también adopta una obra que la protección de borrados dejó visible', () => {
        const resurrected = { ...project('B', 'Edificio Sur'), mergedIntoId: 'A', metadata: { deletionConflict: { deletedAt: 300 } } };
        const result = adoptPlan(dataset({ projects: [project('A', 'Torre Norte'), resurrected] }));
        expect(result.ok).toBe(true);
        expect(result.writes.employees).toHaveLength(2);
    });

    test('solo adopta si la lápida apunta a ese destino', () => {
        const wrong = { ...tombstone, mergedIntoId: 'Z' };
        expect(codes(adoptPlan(dataset({ projects: [project('A', 'x'), wrong] })))).toEqual([MERGE_BLOCKER.SOURCE_NOT_MERGED]);
        expect(codes(adoptPlan(dataset({ projects: [project('A', 'x'), project('B', 'y')] })))).toEqual([MERGE_BLOCKER.SOURCE_NOT_MERGED]);
    });

    test('sin nada que mover no hay cambios, y repetirlo es inocuo', () => {
        const data = dataset({ projects: [project('A', 'Torre Norte'), tombstone], employees: [emp('e3', 'A')], positions: [], leaders: [], attendance: [] });
        const result = adoptPlan(data);
        expect(result.ok).toBe(true);
        expect(result.empty).toBe(true);
    });

    test('también falla cerrado: un cierre de la obra retirada bloquea la adopción', () => {
        const data = dataset({ projects: [project('A', 'Torre Norte'), tombstone], payrollClosures: [{ id: 'C1', projectId: 'B', rows: [] }] });
        expect(codes(adoptPlan(data))).toContain(MERGE_BLOCKER.PAYROLL_CLOSURES);
    });

    test('el nombre no cambia al adoptar', () => {
        const result = adoptPlan(dataset({ projects: [project('A', 'Torre Norte'), tombstone] }), { projectName: 'Otro' });
        expect(result.writes.projects).toEqual([]);
    });
});

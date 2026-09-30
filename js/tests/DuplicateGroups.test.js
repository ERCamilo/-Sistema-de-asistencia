import {
    buildDuplicateGroups, planGroupDecisions, suggestFreeNumber, DUPLICATE_ROLES as R
} from '../modules/features/employees/DuplicateGroups.js';

const emp = (id, number, name, extra = {}) => ({ id, number, name, projectId: 'PA', updatedAt: 1, loans: [], ...extra });
const att = (employeeId, date) => ({ [`${employeeId}-${date}`]: { employeeId, date } });

describe('DuplicateGroups — detección', () => {
    test('misma ficha y nombre idéntico en la misma obra: seguro, con el de más asistencia como principal', () => {
        const groups = buildDuplicateGroups({
            employees: [emp('a', '004', 'Wilmer Pérez'), emp('b', '004', 'Wilmer Pérez')],
            attendance: { ...att('b', '2026-09-01'), ...att('b', '2026-09-02') }
        });
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ reason: 'both', safe: true, proposedKeeperId: 'b' });
        expect(groups[0].decisions).toEqual({ b: { role: R.KEEP }, a: { role: R.MERGE } });
    });

    test('mismo nombre con otra ficha (copia de la nube): se agrupa pero se revisa', () => {
        const groups = buildDuplicateGroups({
            employees: [emp('a', '012', 'José  Martínez')],
            cloudEmployees: [emp('c', '034', 'jose martinez')]
        });
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ reason: 'name', safe: false });
        expect(groups[0].members.find(m => m.id === 'c').source).toBe('cloud');
        expect(groups[0].decisions.c.role).toBe(R.MERGE);
    });

    test('la misma ficha en obras distintas no es duplicado; un solo nombre tampoco', () => {
        const groups = buildDuplicateGroups({
            employees: [emp('a', '001', 'Juan'), emp('b', '001', 'Pedro Gómez', { projectId: 'PB' }), emp('c', '009', 'Juan')]
        });
        expect(groups).toHaveLength(0);
    });

    test('encadena ficha y nombre en un solo grupo; nombre distinto queda sin decidir', () => {
        const groups = buildDuplicateGroups({
            employees: [emp('a', '010', 'Ana Ruiz'), emp('b', '010', 'Luis Mora'), emp('c', '020', 'Ana Ruiz')],
            attendance: att('a', '2026-09-01')
        });
        expect(groups).toHaveLength(1);
        expect(groups[0].reason).toBe('both');
        expect(groups[0].decisions).toEqual({ a: { role: R.KEEP }, b: { role: null }, c: { role: R.MERGE } });
    });

    test('ignora borrados y grupos marcados como «no son duplicados»', () => {
        const members = [emp('a', '001', 'Ana Ruiz'), emp('b', '002', 'Ana Ruiz')];
        expect(buildDuplicateGroups({ employees: members, dismissed: new Set(['a|b']) })).toHaveLength(0);
        expect(buildDuplicateGroups({ employees: [members[0], { ...members[1], deletedAt: 5 }] })).toHaveLength(0);
    });
});

describe('DuplicateGroups — validación de decisiones', () => {
    const employees = [emp('a', '010', 'Ana Ruiz'), emp('b', '010', 'Luis Mora'), emp('x', '011', 'Otro Señor')];
    const [group] = buildDuplicateGroups({ employees });

    test('sin decidir o con dos principales no se puede aplicar, y dice por qué', () => {
        expect(planGroupDecisions(group, { a: { role: R.KEEP } }, { employees }).hint).toMatch(/Luis Mora/);
        expect(planGroupDecisions(group, { a: { role: R.KEEP }, b: { role: R.KEEP } }, { employees }).hint).toMatch(/solo un perfil/);
        expect(planGroupDecisions(group, { a: { role: R.MERGE }, b: { role: R.MERGE } }, { employees }).hint).toMatch(/se conserva/);
    });

    test('otra persona con la misma ficha necesita una ficha libre', () => {
        const same = planGroupDecisions(group, { a: { role: R.KEEP }, b: { role: R.OTHER } }, { employees });
        expect(same.ok).toBe(false);
        expect(same.hint).toMatch(/comparte la ficha 010/);
        const taken = planGroupDecisions(group, { a: { role: R.KEEP }, b: { role: R.OTHER, number: '011' } }, { employees });
        expect(taken.hint).toMatch(/ya es de Otro Señor/);
        const ok = planGroupDecisions(group, { a: { role: R.KEEP }, b: { role: R.OTHER, number: '012' } }, { employees });
        expect(ok).toMatchObject({ ok: true, keeperId: 'a', renumber: [{ id: 'b', number: '012' }], mergeIds: [] });
    });

    test('no deja eliminar a quien tiene préstamos con saldo', () => {
        const withDebt = [emp('a', '010', 'Ana Ruiz'), emp('b', '010', 'Ana Ruiz', {
            loans: [{ id: 'L1', status: 'active', principal: 500, interestRate: 0, payments: [] }]
        })];
        const [g] = buildDuplicateGroups({ employees: withDebt });
        const plan = planGroupDecisions(g, { a: { role: R.KEEP }, b: { role: R.DELETE } }, { employees: withDebt });
        expect(plan.ok).toBe(false);
        expect(plan.blocked).toEqual(['b']);
        expect(planGroupDecisions(g, { a: { role: R.KEEP }, b: { role: R.MERGE } }, { employees: withDebt }).ok).toBe(true);
    });

    test('sugiere la ficha siguiente a la más alta de la obra, sin rellenar huecos', () => {
        expect(suggestFreeNumber([emp('a', '001', 'A B'), emp('b', '005', 'C D'), emp('c', '009', 'E F', { projectId: 'PB' })], 'PA'))
            .toBe('006');
        expect(suggestFreeNumber([emp('a', '001', 'A B')], 'PA', null, ['002'])).toBe('003');
    });
});

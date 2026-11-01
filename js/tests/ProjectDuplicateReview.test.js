import { buildProjectPairReviews } from '../modules/features/projects/ProjectDuplicateReview.js';

/**
 * Lo que la pantalla «Obras repetidas» muestra por cada par sospechoso: un
 * resumen de cada obra y qué le falta a cada una respecto de la otra. Es la
 * misma comparación que la sugerencia, así lo que ves es lo que se sugirió.
 */
const project = (id, name, extra = {}) => ({ id, name, status: 'active', createdAt: 100, updatedAt: 100, ...extra });
const iso = n => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
const att = (employeeId, n) => ({ employeeId, date: iso(n) });
const person = (id, number, name, projectId, loans = []) => ({ id, number, name, projectId, loans: loans.map(loanId => ({ id: loanId })) });

const SHARED = [['001', 'Mathieu Dormeus'], ['002', 'Wadne Exilien'], ['003', 'Vernet Gran Pierre']];
const staffOf = (projectId, prefix, extra = []) => [
    ...SHARED.map(([number, name], i) => person(`${prefix}${i}`, number, name, projectId)),
    ...extra
];

function scenario() {
    const employees = [
        ...staffOf('A', 'a', [person('a9', '004', 'Solo En A', 'A')]),
        ...staffOf('B', 'b', [person('b9', '005', 'Solo En B', 'B')])
    ];
    employees[0].loans = [{ id: 'L1' }, { id: 'L2' }];
    employees[4].loans = [{ id: 'L2' }, { id: 'L3' }];
    const attendance = [
        att('a0', 0), att('a0', 1), att('a0', 2), att('b0', 1), att('b0', 2), att('b0', 3),
        att('a9', 5), att('b9', 6)
    ];
    return { projects: [project('A', 'Torre Norte'), project('B', 'Edificio Sur')], employees, attendance };
}

describe('buildProjectPairReviews', () => {
    test('un resumen por obra, con id estable del par', () => {
        const [review] = buildProjectPairReviews(scenario());
        expect(review.id).toBe('A|B');
        expect(review.a).toMatchObject({ id: 'A', name: 'Torre Norte', people: 4, days: 4, loans: 2, from: iso(0), to: iso(5) });
        expect(review.b).toMatchObject({ id: 'B', name: 'Edificio Sur', people: 4, days: 4, loans: 2, from: iso(1), to: iso(6) });
        expect(review.level).toBe('similar');
        expect(review.matched).toBe(3);
    });

    test('cuenta lo que está en las dos y lo que solo está en una', () => {
        const [{ diff }] = buildProjectPairReviews(scenario());
        expect(diff.both).toBe(3);
        expect(diff.onlyA.map(p => p.name)).toEqual(['Solo En A']);
        expect(diff.onlyB.map(p => p.name)).toEqual(['Solo En B']);
        // todo lo de A que B no tiene: el día 0 de la persona en común + el día de quien solo está en A
        expect(diff).toMatchObject({ daysBoth: 2, daysOnlyA: 2, daysOnlyB: 2 });
        expect(diff).toMatchObject({ loansBoth: 1, loansOnlyA: 1, loansOnlyB: 1 });
    });

    test('indica qué obra aporta algo que la otra no tiene', () => {
        const [review] = buildProjectPairReviews(scenario());
        expect(review.adds).toEqual({ a: true, b: true });
    });

    test('una obra desactualizada no aporta nada: todo lo suyo ya está en la otra', () => {
        const employees = [...staffOf('A', 'a', [person('a9', '004', 'Solo En A', 'A')]), ...staffOf('B', 'b')];
        const attendance = [att('a0', 0), att('a0', 1), att('b0', 1)];
        const [review] = buildProjectPairReviews({ projects: [project('A', 'Torre'), project('B', 'Torre (copia)')], employees, attendance });
        expect(review.adds).toEqual({ a: true, b: false });
        expect(review.diff.onlyB).toEqual([]);
        expect(review.diff.daysOnlyB).toBe(0);
    });

    test('obras idénticas: ninguna aporta nada', () => {
        const employees = [...staffOf('A', 'a'), ...staffOf('B', 'b')];
        const [review] = buildProjectPairReviews({ projects: [project('A', 'Uno'), project('B', 'Dos')], employees, attendance: [att('a0', 0), att('b0', 0)] });
        expect(review.level).toBe('identical');
        expect(review.adds).toEqual({ a: false, b: false });
    });

    test('incluye la evidencia de asistencia de la sugerencia', () => {
        const [review] = buildProjectPairReviews(scenario());
        expect(review.attendance).toMatchObject({ state: 'shared', sharedDays: 2 });
    });

    test('las obras sin fechas muestran rango vacío', () => {
        const employees = [...staffOf('A', 'a'), ...staffOf('B', 'b')];
        const [review] = buildProjectPairReviews({ projects: [project('A', 'Uno'), project('B', 'Dos')], employees, attendance: [] });
        expect(review.a).toMatchObject({ days: 0, from: null, to: null });
    });

    test('respeta «No son la misma» y entradas vacías', () => {
        const data = scenario();
        data.projects[0] = project('A', 'Torre Norte', { notSameAs: ['B'] });
        expect(buildProjectPairReviews(data)).toEqual([]);
        expect(buildProjectPairReviews()).toEqual([]);
        expect(buildProjectPairReviews({ projects: [] })).toEqual([]);
    });
});

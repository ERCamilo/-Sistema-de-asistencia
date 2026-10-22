import {
    compareProjects,
    findSimilarProjects
} from '../modules/features/projects/ProjectSimilarity.js';

/**
 * Dos dispositivos pueden crear «la misma obra» con ids distintos y nombres
 * distintos (el aviso de nombre repetido no salta). El detector compara el
 * personal de cada obra y sugiere cuáles parecen ser la misma.
 */
const project = (id, name, extra = {}) => ({ id, name, status: 'active', createdAt: 1, updatedAt: 1, ...extra });
const emp = (id, number, name, projectId, extra = {}) => ({ id, number, name, projectId, ...extra });
const crew = (projectId, prefix, people) => people.map(([number, name], i) => emp(`${prefix}${i}`, number, name, projectId));

const PEOPLE = [
    ['001', 'Mathieu Dormeus'], ['002', 'Wadne Exilien'], ['003', 'Vernet Gran Pierre'],
    ['004', 'Olissaint Phaicien'], ['005', 'Saint-fort Pierre'], ['006', 'Jean Baptiste'],
    ['007', 'Carlos Medina'], ['008', 'Luis Peña'], ['009', 'Ana Soto'], ['010', 'Rosa Lara']
];

describe('compareProjects', () => {
    test('mismo personal con otros ids de empleado y otra obra: idéntica', () => {
        const a = project('PRJ-a', 'Torre Norte');
        const b = project('PRJ-b', 'Edificio Norte');
        const employees = [...crew('PRJ-a', 'a', PEOPLE), ...crew('PRJ-b', 'b', PEOPLE)];
        const result = compareProjects(a, b, employees);
        expect(result.matched).toBe(10);
        expect(result.level).toBe('identical');
        expect(result.score).toBeGreaterThanOrEqual(0.9);
    });

    test('ignora acentos, mayúsculas, ceros a la izquierda y orden de las palabras', () => {
        const employees = [
            emp('a1', '007', 'Carlos  MEDINA', 'A'), emp('a2', '8', 'Luis Peña', 'A'),
            emp('b1', '7', 'medina carlos', 'B'), emp('b2', '008', 'Luis Pena', 'B')
        ];
        const result = compareProjects(project('A', 'x'), project('B', 'y'), employees);
        expect(result.matched).toBe(2);
        expect(result.level).toBe('identical');
    });

    test('8 de 10 personas en común: parecida', () => {
        const employees = [...crew('A', 'a', PEOPLE), ...crew('B', 'b', PEOPLE.slice(0, 8))];
        const result = compareProjects(project('A', 'Obra uno'), project('B', 'Obra dos'), employees);
        expect(result.matched).toBe(8);
        expect(result.level).toBe('similar');
    });

    test('mismo número de ficha con otra persona no cuenta como coincidencia', () => {
        const employees = [
            ...crew('A', 'a', [['001', 'Mathieu Dormeus'], ['002', 'Wadne Exilien'], ['003', 'Vernet Gran Pierre']]),
            ...crew('B', 'b', [['001', 'Pedro Gómez'], ['002', 'Juan Pérez'], ['003', 'Marta Díaz']])
        ];
        const result = compareProjects(project('A', 'A'), project('B', 'B'), employees);
        expect(result.matched).toBe(0);
        expect(result.level).toBeNull();
    });

    test('empleados borrados y de otras obras no cuentan', () => {
        const employees = [
            ...crew('A', 'a', PEOPLE.slice(0, 3)),
            emp('b0', '001', 'Mathieu Dormeus', 'B'),
            emp('b1', '002', 'Wadne Exilien', 'B', { deletedAt: 5 }),
            emp('b2', '003', 'Vernet Gran Pierre', 'OTRA')
        ];
        const result = compareProjects(project('A', 'A'), project('B', 'B'), employees);
        expect(result.matched).toBe(1);
        expect(result.sizeB).toBe(1);
    });

    test('un empleado repetido dentro de una obra no infla la coincidencia', () => {
        const employees = [
            emp('a1', '001', 'Mathieu Dormeus', 'A'), emp('a2', '001', 'Mathieu Dormeus', 'A'), emp('a3', '001', 'Mathieu Dormeus', 'A'),
            emp('b1', '001', 'Mathieu Dormeus', 'B'), emp('b2', '002', 'Wadne Exilien', 'B')
        ];
        const result = compareProjects(project('A', 'A'), project('B', 'B'), employees);
        expect(result.matched).toBe(1);
    });

    test('obras vacías no son parecidas entre sí', () => {
        const result = compareProjects(project('A', 'Mi obra'), project('B', 'Mi obra 2'), []);
        expect(result.level).toBeNull();
        expect(result.matched).toBe(0);
    });

    test('poco personal en común no basta', () => {
        const employees = [...crew('A', 'a', PEOPLE), ...crew('B', 'b', [PEOPLE[0], ['100', 'X Uno'], ['101', 'Y Dos'], ['102', 'Z Tres']])];
        expect(compareProjects(project('A', 'A'), project('B', 'B'), employees).level).toBeNull();
    });

    test('con una sola persona cada una, hace falta nombre de obra parecido', () => {
        const employees = [emp('a1', '001', 'Mathieu Dormeus', 'A'), emp('b1', '001', 'Mathieu Dormeus', 'B')];
        expect(compareProjects(project('A', 'Torre Norte'), project('B', 'Hospital'), employees).level).toBeNull();
        expect(compareProjects(project('A', 'Torre Norte'), project('B', 'torre norte 2'), employees).level).toBe('identical');
    });

    test('el parecido de nombres se reporta y no depende del orden de las obras', () => {
        const employees = [...crew('A', 'a', PEOPLE), ...crew('B', 'b', PEOPLE)];
        const ab = compareProjects(project('A', 'Torre Norte'), project('B', 'Norte Torre'), employees);
        const ba = compareProjects(project('B', 'Norte Torre'), project('A', 'Torre Norte'), employees);
        expect(ab.nameScore).toBe(1);
        expect(ba.score).toBe(ab.score);
        expect(ba.matched).toBe(ab.matched);
    });
});

describe('findSimilarProjects', () => {
    const employees = [
        ...crew('A', 'a', PEOPLE), ...crew('B', 'b', PEOPLE), ...crew('C', 'c', PEOPLE.slice(0, 7)),
        ...crew('D', 'd', [['500', 'Nadie Igual'], ['501', 'Otro Distinto']])
    ];

    test('lista cada par una vez, de más a menos parecido', () => {
        const pairs = findSimilarProjects([project('A', 'A'), project('B', 'B'), project('C', 'C'), project('D', 'D')], employees);
        expect(pairs.map(p => [p.a.id, p.b.id])).toEqual([['A', 'B'], ['A', 'C'], ['B', 'C']]);
        expect(pairs[0].level).toBe('identical');
        expect(pairs.every((p, i) => i === 0 || pairs[i - 1].score >= p.score)).toBe(true);
    });

    test('omite obras borradas, cerradas o archivadas', () => {
        const pairs = findSimilarProjects([
            project('A', 'A'), project('B', 'B', { deletedAt: 9 }), project('C', 'C', { status: 'closed' }), project('D', 'D')
        ], employees);
        expect(pairs).toEqual([]);
    });

    test('sin obras o sin empleados devuelve lista vacía', () => {
        expect(findSimilarProjects([], [])).toEqual([]);
        expect(findSimilarProjects([project('A', 'A'), project('B', 'B')], [])).toEqual([]);
        expect(findSimilarProjects(undefined, undefined)).toEqual([]);
    });

    test('las obras con id no válido se ignoran', () => {
        const pairs = findSimilarProjects([project('A', 'A'), project('legacy-unresolved:x', 'B')], employees);
        expect(pairs).toEqual([]);
    });
});

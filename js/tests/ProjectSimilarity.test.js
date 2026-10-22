import {
    compareProjects,
    findSimilarProjects,
    isDismissedPair
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

/**
 * La asistencia aporta evidencia, no veredicto: las mismas personas en los
 * mismos días o con fechas intercaladas apuntan a una copia; fechas muy
 * separadas apuntan a etapas distintas (una misma cuadrilla en dos obras).
 */
describe('señal de asistencia', () => {
    const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
    const att = (employeeId, n, extra = {}) => ({ employeeId, date: day(n), ...extra });
    const staff = [...crew('A', 'a', PEOPLE), ...crew('B', 'b', PEOPLE)];
    const A = project('A', 'Torre Norte');
    const B = project('B', 'Edificio Sur');
    const days = (prefix, from, to) => PEOPLE.flatMap((_, i) => Array.from({ length: to - from + 1 }, (__, k) => att(`${prefix}${i}`, from + k)));

    test('sin asistencia en alguna obra el estado es desconocido y el nivel no cambia', () => {
        const result = compareProjects(A, B, staff, { attendance: days('a', 0, 4) });
        expect(result.attendance.state).toBe('unknown');
        expect(result.level).toBe('identical');
    });

    test('los mismos días en ambas obras: compartida, contando personas-día', () => {
        const result = compareProjects(A, B, staff, { attendance: [...days('a', 0, 2), ...days('b', 1, 3)] });
        expect(result.attendance.state).toBe('shared');
        expect(result.attendance.sharedDays).toBe(PEOPLE.length * 2);
        expect(result.level).toBe('identical');
    });

    test('rangos que se cruzan sin compartir días: intercaladas', () => {
        const odd = PEOPLE.flatMap((_, i) => [att(`a${i}`, 0), att(`a${i}`, 2), att(`a${i}`, 4)]);
        const even = PEOPLE.flatMap((_, i) => [att(`b${i}`, 1), att(`b${i}`, 3)]);
        const result = compareProjects(A, B, staff, { attendance: [...odd, ...even] });
        expect(result.attendance).toMatchObject({ state: 'interleaved', sharedDays: 0 });
        expect(result.level).toBe('identical');
    });

    test('obras seguidas (dispositivo atrasado) no pierden el nivel', () => {
        const result = compareProjects(A, B, staff, { attendance: [...days('a', 0, 4), ...days('b', 5, 8)] });
        expect(result.attendance.state).toBe('adjacent');
        expect(result.level).toBe('identical');
    });

    test('más de 30 días de separación: etapas distintas, baja un nivel', () => {
        const result = compareProjects(A, B, staff, { attendance: [...days('a', 0, 4), ...days('b', 80, 84)] });
        expect(result.attendance.state).toBe('separated');
        expect(result.level).toBe('similar');
    });

    test('separadas y solo parecidas: deja de sugerirse', () => {
        const partial = [...crew('A', 'a', PEOPLE), ...crew('B', 'b', PEOPLE.slice(0, 8))];
        const result = compareProjects(A, B, partial, { attendance: [...days('a', 0, 4), ...days('b', 80, 84)] });
        expect(result.attendance.state).toBe('separated');
        expect(result.level).toBeNull();
    });

    test('empareja primero ficha y nombre iguales, así dos homónimos no se cruzan', () => {
        const twins = [
            emp('a1', '006', 'Jean Baptiste', 'A'), emp('a2', '009', 'Jean Baptiste', 'A'),
            emp('b1', '009', 'Jean Baptiste', 'B'), emp('b2', '006', 'Jean Baptiste', 'B')
        ];
        const attendance = [att('a1', 0), att('a2', 1), att('b1', 1), att('b2', 0)];
        const result = compareProjects(A, B, twins, { attendance });
        expect(result.matched).toBe(2);
        expect(result.attendance.sharedDays).toBe(2);
    });

    test('ignora asistencia borrada, sin fecha válida o de personas ajenas', () => {
        const attendance = [
            att('a0', 0, { deletedAt: 5 }), { employeeId: 'a1', date: 'ayer' }, att('zz', 3),
            att('a2', 0), att('b2', 0)
        ];
        const result = compareProjects(A, B, staff, { attendance });
        expect(result.attendance).toMatchObject({ state: 'shared', sharedDays: 1 });
    });

    test('acepta la asistencia como mapa por clave', () => {
        const map = Object.fromEntries([...days('a', 0, 1), ...days('b', 0, 1)].map((r, i) => [`k${i}`, r]));
        expect(compareProjects(A, B, staff, { attendance: map }).attendance.sharedDays).toBe(PEOPLE.length * 2);
    });

    test('findSimilarProjects la usa y devuelve su evidencia', () => {
        const pairs = findSimilarProjects([A, B], staff, { attendance: [...days('a', 0, 4), ...days('b', 80, 84)] });
        expect(pairs).toHaveLength(1);
        expect(pairs[0]).toMatchObject({ level: 'similar', attendance: { state: 'separated' } });
    });
});

describe('«No son la misma»', () => {
    const staff = [...crew('A', 'a', PEOPLE), ...crew('B', 'b', PEOPLE), ...crew('C', 'c', PEOPLE)];

    test('un par descartado no se vuelve a sugerir, estando en cualquiera de las dos obras', () => {
        const base = [project('A', 'A'), project('B', 'B'), project('C', 'C')];
        expect(findSimilarProjects(base, staff).map(p => [p.a.id, p.b.id])).toEqual([['A', 'B'], ['A', 'C'], ['B', 'C']]);
        const fromA = [project('A', 'A', { notSameAs: ['B'] }), project('B', 'B'), project('C', 'C')];
        expect(findSimilarProjects(fromA, staff).map(p => [p.a.id, p.b.id])).toEqual([['A', 'C'], ['B', 'C']]);
        const fromB = [project('A', 'A'), project('B', 'B', { notSameAs: ['A'] }), project('C', 'C')];
        expect(findSimilarProjects(fromB, staff).map(p => [p.a.id, p.b.id])).toEqual([['A', 'C'], ['B', 'C']]);
    });

    test('isDismissedPair es simétrico y tolera datos ausentes', () => {
        expect(isDismissedPair(project('A', 'A', { notSameAs: ['B'] }), project('B', 'B'))).toBe(true);
        expect(isDismissedPair(project('B', 'B'), project('A', 'A', { notSameAs: ['B'] }))).toBe(true);
        expect(isDismissedPair(project('A', 'A'), project('B', 'B'))).toBe(false);
        expect(isDismissedPair(project('A', 'A', { notSameAs: 'B' }), project('B', 'B'))).toBe(false);
        expect(isDismissedPair(null, undefined)).toBe(false);
    });

    test('descartar un par no afecta a los demás pares de esa obra', () => {
        const projects = [project('A', 'A', { notSameAs: ['B'] }), project('B', 'B'), project('C', 'C')];
        expect(compareProjects(projects[0], projects[2], staff).level).toBe('identical');
    });
});

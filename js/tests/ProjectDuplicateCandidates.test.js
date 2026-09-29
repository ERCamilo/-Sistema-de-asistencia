import {
    normalizePersonName,
    findDuplicateCandidates,
    countAttendanceByEmployee
} from '../modules/features/projects/ProjectDuplicateCandidates.js';
import { buildLocalReconciliationViewModel } from '../modules/features/projects/ProjectReconciliationUI.js';

/**
 * Un empleado pendiente que es la misma persona que uno ya asignado se sugiere
 * para fusionar (caso real 2026-09-29: copias viejas de #003, #011, #012… que
 * quedaron de una resolución de duplicados anterior).
 */
const emp = (id, number, name, extra = {}) => ({ id, number, name, active: true, ...extra });

test('normaliza acentos, mayúsculas, signos y espacios', () => {
    expect(normalizePersonName('  Olissaint  PHAÏCIEN ')).toBe('olissaint phaicien');
    expect(normalizePersonName('Saint-fort Pierre')).toBe('saint fort pierre');
});

describe('findDuplicateCandidates', () => {
    const assigned = [
        emp('v1', '028', 'Mathieu Dormeus', { projectId: 'PRJ-obra-uno-0001' }),
        emp('v2', '104', 'Wadne Exilien', { projectId: 'PRJ-obra-uno-0001' }),
        emp('v3', '003', 'Vernet Gran Pierre', { projectId: 'PRJ-obra-uno-0001' }),
        emp('v4', '555', 'Otra Persona', { projectId: 'PRJ-obra-uno-0001', deletedAt: 5 })
    ];

    test('mismo nombre aunque cambie el número', () => {
        const [c] = findDuplicateCandidates(emp('p1', '004', 'wadne  exilien'), assigned);
        expect(c).toMatchObject({ id: 'v2', strength: 'exact', number: '104' });
    });
    test('mismo nombre en otro orden', () => {
        expect(findDuplicateCandidates(emp('p1', '9', 'Dormeus Mathieu'), assigned)[0]).toMatchObject({ id: 'v1', strength: 'exact' });
    });
    test('mismo número y primer nombre es solo probable', () => {
        expect(findDuplicateCandidates(emp('p1', '3', 'Vernet G.'), assigned)[0]).toMatchObject({ id: 'v3', strength: 'probable' });
    });
    test('personas distintas con el mismo número no se sugieren', () => {
        expect(findDuplicateCandidates(emp('p1', '028', 'Jean Michel'), assigned)).toEqual([]);
    });
    test('ignora eliminados y al propio empleado', () => {
        expect(findDuplicateCandidates(emp('v4', '555', 'Otra Persona'), assigned)).toEqual([]);
    });
    test('ordena por coincidencia y luego por asistencia', () => {
        const others = [emp('a', '1', 'Ana Paz'), emp('b', '2', 'Ana Paz')];
        const counts = countAttendanceByEmployee({ k1: { employeeId: 'b' }, k2: { employeeId: 'b' }, k3: { employeeId: 'a', deletedAt: 1 } });
        expect(findDuplicateCandidates(emp('p', '9', 'Ana Paz'), others, { attendanceCounts: counts }).map(c => c.id)).toEqual(['b', 'a']);
    });
});

test('el asistente marca al pendiente con su posible duplicado ya asignado', () => {
    const projects = [{ id: 'PRJ-obra-uno-0001', name: 'Mi obra 1', status: 'active', createdAt: 1, updatedAt: 1 }];
    const model = buildLocalReconciliationViewModel({
        employees: [
            emp('v1', '028', 'Mathieu Dormeus', { projectId: 'PRJ-obra-uno-0001' }),
            emp('p1', '028', 'Mathieu Dormeus', { projectId: 'PRJ-no-existe' })
        ],
        attendance: { 'v1-2026-09-01': { employeeId: 'v1', date: '2026-09-01' } },
        positions: [], leaders: []
    }, { enabled: true, projects, defaultProjectId: 'PRJ-obra-uno-0001', activeProjectId: 'PRJ-obra-uno-0001' });
    const row = model.employeeRows.find(item => item.id === 'p1');
    expect(row).toBeTruthy();
    expect(row.duplicateCandidates[0]).toMatchObject({ id: 'v1', strength: 'exact', attendanceCount: 1 });
    // v1 aparece solo por su asistencia sin obra; como empleado es un destino válido.
    expect(model.employeeRows.find(item => item.id === 'v1')?.duplicateCandidates).toEqual([]);
});

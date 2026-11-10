import { createCatalogIncomingMerge } from '../../js/modules/services/CatalogIncomingMerge.js';
import { mergeIncomingEmployees, resetIncomingMergeBaseline } from '../../js/modules/services/EmployeesIncomingMerge.js';
import { mergeEmployees } from '../../js/modules/services/EmployeeMerge.js';
import { recordNestedTombstone } from '../../js/modules/services/NestedTombstones.js';
import { mergeAttendanceRecords } from '../../js/modules/features/attendance/AttendanceMerge.js';
import { tombstoneAttendanceWrite } from '../../js/modules/features/attendance/AttendanceRecordWriter.js';
import { detectIncomingChanges } from '../../js/modules/services/IncomingChangeDetector.js';

const live = id => ({ id, name: `Ficticio ${id}`, updatedAt: 100 });
const ids = values => values.map(value => String(value.id)).sort();
const SEED = 0x5a202611;
function rng(seed) {
    let value = seed >>> 0;
    return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0;return value / 4294967296; };
}

beforeEach(() => { resetIncomingMergeBaseline();localStorage.clear(); });

describe.each(['personal', 'puestos', 'líderes'])('[AUSENCIA] %s', entity => {
    const fresh = () => entity === 'personal' ? mergeIncomingEmployees : createCatalogIncomingMerge();
    test.each(['vacía', 'parcial', 'caché'])('no pierde registros ante una respuesta %s, aun después de conocerlos en la nube', mode => {
        const merge = fresh();
        let current = [live('a'), live('b'), live('c')];
        current = merge(current, current, { authoritative: true });
        const before = JSON.stringify(current);
        const remote = mode === 'vacía' ? [] : [live('a')];
        const output = merge(current, remote, { authoritative: mode !== 'caché' });
        expect(ids(output)).toEqual(['a', 'b', 'c']);
        expect(JSON.stringify(current)).toBe(before);
    });
    test('secuencia determinista de 256 subconjuntos/repeticiones mantiene todos los IDs sin marcas de borrado', () => {
        const merge = fresh(), random = rng(SEED);
        const initial = Array.from({ length: 12 }, (_, index) => live(`id-${index}`));
        let current = merge(initial, initial, { authoritative: true });
        for (let step = 0; step < 256; step++) {
            const snapshot = initial.filter(() => random() > 0.5);
            current = merge(current, snapshot, { authoritative: random() > 0.2 });
            expect({ seed: SEED, step, ids: ids(current) }).toEqual({ seed: SEED, step, ids: ids(initial) });
        }
    });
    test('la misma cantidad de registros con IDs diferentes tampoco acredita un borrado', () => {
        const merge = fresh();const local = [live('a'), live('b')];
        merge(local, local, { authoritative: true });
        expect(ids(merge(local, [live('c'), live('d')], { authoritative: true }))).toEqual(['a', 'b', 'c', 'd']);
    });
});

test('[PRÉSTAMOS] 256 respuestas parciales y repetidas conservan préstamos, pagos y cuotas', () => {
    const initial = { ...live('e'), loans: Array.from({ length: 12 }, (_, i) => ({
        ...live(`loan-${i}`), principal: 100 + i,
        payments: [live(`payment-${i}`)], installments: [live(`installment-${i}`)]
    })) };
    let current = initial;const random = rng(SEED);
    for (let step = 0; step < 256; step++) {
        const incoming = { ...live('e'), updatedAt: 200 + step,
            loans: initial.loans.filter(() => random() > 0.5).map(loan => ({ ...loan, payments: [], installments: [] })) };
        current = mergeEmployees(incoming, current);
        expect(ids(current.loans)).toEqual(ids(initial.loans));
        for (const loan of current.loans) {
            expect(loan.payments).toHaveLength(1);expect(loan.installments).toHaveLength(1);
        }
    }
});

test('[ASISTENCIAS] 256 respuestas vacías/parciales y fuera de orden conservan todos los días', () => {
    const initial = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`e-2026-11-${String(i + 1).padStart(2, '0')}`, {
        employeeId: 'e', present: true, hoursWorked: 8, updatedAt: 100
    }]));
    let current = initial;const random = rng(SEED);
    for (let step = 0; step < 256; step++) {
        const incoming = Object.fromEntries(Object.entries(initial).filter(() => random() > 0.5)
            .map(([key, value]) => [key, { ...value, updatedAt: random() > 0.5 ? 50 : 150 }]));
        current = mergeAttendanceRecords(current, incoming);
        expect(Object.keys(current).sort()).toEqual(Object.keys(initial).sort());
        expect(Object.values(current).reduce((sum, record) => sum + record.hoursWorked, 0)).toBe(96);
    }
});

test('[PRÉSTAMOS] comparar cantidades no basta: IDs distintos con la misma cantidad conservan ambas deudas', () => {
    const local = { ...live('e'), loans: [{ ...live('loan-a'), principal: 900 }] };
    const remote = { ...live('e'), updatedAt: 200, loans: [{ ...live('loan-b'), principal: 500 }] };
    const output = mergeEmployees(remote, local);
    expect(ids(output.loans)).toEqual(['loan-a', 'loan-b']);
    expect(output.loans.reduce((sum, loan) => sum + loan.principal, 0)).toBe(1400);
});

test('[ASISTENCIAS] una desmarcación remota sin deletedAt no elimina una asistencia existente', () => {
    const before = { employeeId: 'e', present: true, hoursWorked: 8, updatedAt: 100 };
    const output = mergeAttendanceRecords({ day: before }, { day: { ...before, present: false, hoursWorked: 0, updatedAt: 200 } });
    expect(output.day.present).toBe(true);
    expect(output.day.hoursWorked).toBe(8);
});

test('[MARCA] una marca explícita de asistencia sobrevive a un replay más viejo', () => {
    const before = { employeeId: 'e', present: true, hoursWorked: 8, updatedAt: 100 };
    const marked = tombstoneAttendanceWrite(before, 200);
    const deleted = mergeAttendanceRecords({ day: before }, { day: marked });
    expect(deleted.day.deletedAt).toBe(200);
    expect(mergeAttendanceRecords(deleted, { day: before }).day.deletedAt).toBe(200);
});

test('[MARCA] un préstamo con registro explícito de eliminación no reaparece con una copia vieja', () => {
    const original = { ...live('e'), loans: [{ ...live('loan'), principal: 900, payments: [] }] };
    const local = { ...live('e'), loans: [] };
    recordNestedTombstone(local, 'loans', 'loan');
    expect(mergeEmployees(original, local).loans).toEqual([]);
});

test('[RETENCIÓN] más de 300 borrados no olvidan la evidencia del primer préstamo eliminado', () => {
    const local = { ...live('e'), loans: [] };
    for (let index = 0; index < 301; index++) recordNestedTombstone(local, 'loans', `loan-${index}`);
    const stale = { ...live('e'), loans: [{ ...live('loan-0'), principal: 900 }] };
    expect(mergeEmployees(stale, local).loans).toEqual([]);
});

test('[REPLAY] personal eliminado no reaparece cuando llega después un snapshot viejo de caché', () => {
    const original = live('e');
    const deleted = mergeIncomingEmployees([original], [{ ...original, updatedAt: 200, deletedAt: 200 }]);
    expect(deleted).toEqual([]);
    expect(mergeIncomingEmployees(deleted, [original], { authoritative: false })).toEqual([]);
});

test('[DETECTOR] faltar en una lista no se presenta al usuario como eliminación confirmada', () => {
    const changes = detectIncomingChanges({ employees: [live('e')], settings: { schemaVersion: 1 } },
        { employees: [], schemaVersion: 1 });
    expect(changes.some(change => change.kind === 'deletion')).toBe(false);
});

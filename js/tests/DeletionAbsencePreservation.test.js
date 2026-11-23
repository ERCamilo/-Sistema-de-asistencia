// #361: conservar personal, puestos y líderes aunque una lectura omita IDs.
// Casos extraídos de la auditoría estricta #359 sin modificar expectativas.
import { createCatalogIncomingMerge } from '../modules/services/CatalogIncomingMerge.js';
import { mergeIncomingEmployees, resetIncomingMergeBaseline } from '../modules/services/EmployeesIncomingMerge.js';
import { mergeEmployees } from '../modules/services/EmployeeMerge.js';
import { recordNestedTombstone } from '../modules/services/NestedTombstones.js';
import { mergeAttendanceRecords } from '../modules/features/attendance/AttendanceMerge.js';
import { tombstoneAttendanceWrite } from '../modules/features/attendance/AttendanceRecordWriter.js';
import { detectIncomingChanges } from '../modules/services/IncomingChangeDetector.js';

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

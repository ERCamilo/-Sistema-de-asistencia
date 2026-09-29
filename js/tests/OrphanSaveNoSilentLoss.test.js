import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = (x) => JSON.parse(JSON.stringify(x));
}

/**
 * Un registro con obra inexistente (EXPLICIT_ORPHAN) bloqueaba TODO guardado
 * local no granular y saveState volvía como si nada: la app reportaba éxito y
 * las ediciones de empleados se perdían al recargar. Ahora solo se omite lo que
 * crearía una relación huérfana nueva; lo demás se guarda y se avisa.
 */
const OBRA = 'PRJ-obra-valida-0001';
const GHOST = 'PRJ-obra-inexistente-0009';
const scope = { enabled: true, projectId: OBRA, defaultProjectId: OBRA };

function emp(id, extra = {}) {
    return { id, number: id.slice(-1), name: 'Empleado ' + id, active: true, positions: [], projectId: OBRA, updatedAt: 1, ...extra };
}

describe('guardado con datos huérfanos de obra', () => {
    let db;
    beforeEach(async () => {
        setProjectsEnabled(true);
        db = new IndexedDBService('orphan-save-' + Math.random());
        await db.init();
        await db.update('projects', { id: OBRA, name: 'Obra', status: 'active' });
        // Ya persistido con una obra que este dispositivo no tiene.
        await db.update('employees', emp('emp-h', { projectId: GHOST }));
        await db.update('employees', emp('emp-a'));
    });
    afterEach(() => { db.db.close(); setProjectsEnabled(false); });

    test('un huérfano ya guardado no impide guardar las ediciones de los demás', async () => {
        const state = {
            employees: [emp('emp-a', { phone: '809-000-0000', updatedAt: 2 }), emp('emp-h', { projectId: GHOST, phone: '829', updatedAt: 2 })],
            positions: [], leaders: [], attendance: {}, settings: { companyName: 'Editado' }
        };
        const stats = await db.saveState(state, { entityScope: scope });

        expect(stats.orphanWritesSkipped).toBe(0);
        expect((await db.get('employees', 'emp-a')).phone).toBe('809-000-0000');
        // Se reescribe sin cambiar su obra: la relación huérfana no es nueva.
        expect(await db.get('employees', 'emp-h')).toMatchObject({ projectId: GHOST, phone: '829' });
        expect((await db.get('settings', 'app')).companyName).toBe('Editado');
    });

    test('un registro nuevo o movido a una obra inexistente se omite; el resto se guarda', async () => {
        const state = {
            employees: [
                emp('emp-a', { projectId: GHOST, updatedAt: 3 }),   // movido a obra inexistente
                emp('emp-n', { projectId: GHOST }),                 // nuevo en obra inexistente
                emp('emp-b')                                        // nuevo y válido
            ],
            positions: [], leaders: [],
            attendance: {
                'emp-b-2026-09-18': { employeeId: 'emp-b', date: '2026-09-18', present: true, hoursWorked: 8, projectId: OBRA },
                'emp-n-2026-09-18': { employeeId: 'emp-n', date: '2026-09-18', present: true, hoursWorked: 8, projectId: GHOST }
            },
            settings: { companyName: 'Editado' }
        };
        const stats = await db.saveState(state, { entityScope: scope });

        expect(stats.orphanWritesSkipped).toBe(3);
        expect((await db.get('employees', 'emp-a')).projectId).toBe(OBRA);
        expect(await db.get('employees', 'emp-n')).toBeUndefined();
        expect(await db.get('employees', 'emp-b')).toMatchObject({ projectId: OBRA });
        expect(await db.get('attendance', 'emp-b-2026-09-18')).toMatchObject({ hoursWorked: 8 });
        expect(await db.get('attendance', 'emp-n-2026-09-18')).toBeUndefined();
        expect((await db.get('settings', 'app')).companyName).toBe('Editado');
    });
});

describe('aviso al usuario', () => {
    const SRC = fs.readFileSync(path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8');
    test('los dos caminos de guardado local avisan cuando se omiten cambios', () => {
        expect(SRC.match(/_notifyOrphanWritesSkipped\(await indexedDBService\.saveState\(rawState, options\)\)/g)).toHaveLength(2);
        expect(SRC).toMatch(/NotificationSystem\.warning\(`⚠️ \$\{skipped\} registro\(s\) sin obra válida no se guardaron/);
    });
});

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { buildPayrollClosure, buildPayrollClosureSnapshot, validatePayrollClosureForScopedWrite } from '../modules/features/payroll/PayrollClosure.js';
import { validateDataIntegrity } from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';

if (!globalThis.structuredClone) globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));

/**
 * Casos de la cuenta con datos anteriores a multi-obra (2026-09-29):
 *  - dispositivo recién iniciado: 1847 asistencias sin obra no se guardaban;
 *  - cierres leídos de la nube con otro orden de claves fallaban la huella;
 *  - días con ids viejos de puestos fusionados perdían su puesto.
 */
const OBRA = 'PRJ-legacy-0001';

test('un dispositivo nuevo guarda los registros antiguos sin obra', async () => {
    setProjectsEnabled(true);
    const db = new IndexedDBService('fresh-legacy-' + Math.random());
    await db.init();
    try {
        const stats = await db.saveState({
            employees: [{ id: 'e1', number: '1', name: 'Ana', active: true, positions: [] }],
            positions: [], leaders: [],
            attendance: { 'e1-2026-09-01': { employeeId: 'e1', date: '2026-09-01', present: true, hoursWorked: 8 } },
            settings: {}
        }, { entityScope: { enabled: true, projectId: OBRA, defaultProjectId: OBRA } });
        expect(stats.orphanWritesSkipped).toBe(0);
        expect(await db.get('attendance', 'e1-2026-09-01')).toMatchObject({ hoursWorked: 8 });
        expect(await db.get('employees', 'e1')).toBeTruthy();
    } finally {
        db.db.close();
        setProjectsEnabled(false);
    }
});

describe('huella de cierres leídos de la nube', () => {
    const rows = [{ _employeeId: 'e1', _number: '1', _employeeName: 'Ana', _brutoOriginal: 100, monto: 100 }];
    const build = () => {
        const snapshot = buildPayrollClosureSnapshot({ projectId: OBRA, periodStart: '2026-09-01', periodEnd: '2026-09-15', rows });
        return buildPayrollClosure({ projectId: OBRA, schemaVersion: 3, periodStart: '2026-09-01', periodEnd: '2026-09-15', rows,
            fingerprint: JSON.stringify(snapshot), closedAt: 1, periodSource: 'configured' });
    };
    const reorderKeys = value => Array.isArray(value) ? value.map(reorderKeys)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).reverse().map(k => [k, reorderKeys(value[k])])) : value;

    test('mismo contenido con otro orden de claves es válido', () => {
        const closure = build();
        expect(() => validatePayrollClosureForScopedWrite(closure, OBRA)).not.toThrow();
        const fromCloud = { ...closure, rows: reorderKeys(closure.rows) };
        expect(() => validatePayrollClosureForScopedWrite(fromCloud, OBRA)).not.toThrow();
    });
    test('un cambio de datos sigue rechazándose', () => {
        const closure = build();
        const tampered = { ...closure, rows: closure.rows.map(row => ({ ...row, employeeName: 'Otra persona' })) };
        expect(() => validatePayrollClosureForScopedWrite(tampered, OBRA)).toThrow(/identidad nativa/);
    });
});

describe('asistencia con ids viejos de puestos fusionados', () => {
    let snapshot;
    beforeEach(() => { snapshot = { employees: state.employees, positions: state.positions, leaders: state.leaders, attendance: state.attendance }; });
    afterEach(() => Object.assign(state, snapshot));

    test('se pasan al puesto actual del mismo nombre en vez de borrarse', async () => {
        state.positions = [{ id: 'uuid-albanil', name: 'Albañil', active: true }, { id: 'uuid-op', name: 'Operador Ctk', active: true }];
        state.leaders = [];
        state.employees = [{ id: 'e1', positions: ['uuid-albanil'] }];
        state.attendance = {
            'e1-2026-09-01': { employeeId: 'e1', date: '2026-09-01', positionHours: [{ positionId: 'albanil', hours: 8 }], selectedPosition: 'albañil-1769317018450' },
            'e1-2026-09-02': { employeeId: 'e1', date: '2026-09-02', positionHours: [{ positionId: 'operador-ctk', hours: 4 }] },
            'e1-2026-09-03': { employeeId: 'e1', date: '2026-09-03', positionHours: [{ positionId: 'uuid-albanil', hours: 8 }] },
            'e1-2026-09-04': { employeeId: 'e1', date: '2026-09-04', positionHours: [{ positionId: 'uuid-albanil', hours: 8 }] },
            'e1-2026-09-05': { employeeId: 'e1', date: '2026-09-05', positionHours: [{ positionId: 'uuid-albanil', hours: 8 }] }
        };
        await validateDataIntegrity();
        expect(state.attendance['e1-2026-09-01'].positionHours).toEqual([{ positionId: 'uuid-albanil', hours: 8 }]);
        expect(state.attendance['e1-2026-09-01'].selectedPosition).toBe('uuid-albanil');
        expect(state.attendance['e1-2026-09-02'].positionHours).toEqual([{ positionId: 'uuid-op', hours: 4 }]);
    });

    test('si se perdería el puesto de muchos días, no se toca nada', async () => {
        state.positions = [{ id: 'uuid-albanil', name: 'Albañil', active: true }];
        state.leaders = [];
        state.employees = [{ id: 'e1', positions: ['uuid-albanil'] }];
        state.attendance = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`e1-2026-09-0${i + 1}`,
            { employeeId: 'e1', date: `2026-09-0${i + 1}`, positionHours: [{ positionId: 'puesto-desconocido', hours: 8 }] }]));
        await validateDataIntegrity();
        expect(Object.values(state.attendance).every(att => att.positionHours[0].positionId === 'puesto-desconocido')).toBe(true);
    });
});

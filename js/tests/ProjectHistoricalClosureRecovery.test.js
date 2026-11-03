import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { buildPayrollClosure, buildPayrollClosureSnapshot } from '../modules/features/payroll/PayrollClosure.js';
import { planHistoricalClosureRecovery, saveHistoricalClosureRecovery } from '../modules/features/projects/ProjectHistoricalClosureRecovery.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

const projects = [
    { id: 'target', name: 'Nueva obra', status: 'active', createdAt: 1 },
    { id: 'other', name: 'Obra histórica', status: 'archived', createdAt: 1, closedAt: 2, archivedAt: 3 }
];
function historicalClosure() {
    const payload = {
        projectId: 'deleted-project',
        periodStart: '2026-10-01', periodEnd: '2026-10-15', closedAt: 400,
        rows: [{ _employeeId: 'deleted-employee', _number: '34', _employeeName: 'Empleado eliminado',
            _employeePosition: 'Albañil', _brutoOriginal: 1000, _loans: 100,
            _deductions: 50, monto: 850 }]
    };
    return buildPayrollClosure({ ...payload, fingerprint: JSON.stringify(buildPayrollClosureSnapshot(payload)) });
}

describe('Recovery of orphan payroll closures with deleted employees', () => {
    test('immutable historical copy preserves amounts and original, with missing employee evidence', () => {
        const source = historicalClosure();
        const before = JSON.stringify(source);
        const result = planHistoricalClosureRecovery({
            sourceId: source.id, targetProjectId: 'target', projects,
            payrollClosures: [source], employees: [], timestamp: 1000
        });
        expect(result).toMatchObject({ created: true, missingEmployeeIds: ['deleted-employee'] });
        expect(result.closure.recovery).toMatchObject({
            sourceId: source.id, sourceProjectId: 'deleted-project',
            historicalOnly: true
        });
        expect(result.closure.rows).toEqual(source.rows);
        expect(result.closure.totals).toEqual(source.totals);
        expect(result.closure.paymentRefs).toEqual(source.paymentRefs);
        expect(JSON.stringify(source)).toBe(before);
    });

    test('atomic recovery persists only one historical copy/outbox, does not resurrect employee or repeat payment', async () => {
        const idb = new IndexedDBService('historical-closure-' + Math.random());
        const source = historicalClosure();
        try {
            await idb.init();
            for (const project of projects) await idb.update('projects', project);
            await idb.update('payrollClosures', source);
            const options = { sourceId: source.id, targetProjectId: 'target', idb, getUid: () => 'userA', now: () => 1000 };
            const one = await saveHistoricalClosureRecovery(options);
            expect(one.created).toBe(true);
            const two = await saveHistoricalClosureRecovery(options);
            expect(two.created).toBe(false);
            const closures = await idb.getAll('payrollClosures');
            expect(closures).toHaveLength(2);
            expect(closures.find(c => c.id === source.id)).toEqual(source);
            expect(closures.find(c => c.id !== source.id).totals.net).toBe(source.totals.net);
            expect(await idb.getAll('employees')).toHaveLength(0);
            const outbox = await idb.getAll('mainSyncOutbox');
            expect(outbox).toHaveLength(1);
            expect(outbox[0].kind).toBe('payrollRecoveredClosure');
        } finally {
            idb.db?.close();
        }
    });

    test('cannot steal a closure from an existing work or discard predecessor chain', () => {
        const source = historicalClosure();
        expect(() => planHistoricalClosureRecovery({
            sourceId: source.id, targetProjectId: 'target', projects: [
                ...projects, { id: 'deleted-project', name: 'Original restaurada', status: 'closed' }
            ], payrollClosures: [source]
        })).toThrow(/obra existente/);
        expect(() => planHistoricalClosureRecovery({
            sourceId: source.id, targetProjectId: 'target', projects,
            payrollClosures: [{ ...source, supersedesId: 'previous' }]
        })).toThrow(/cierre anterior/);
    });

    test('fails closed when authentication changes during pending read, with no new closure', async () => {
        const idb = new IndexedDBService('historical-session-' + Math.random());
        const source = historicalClosure();
        let uid = 'A';
        try {
            await idb.init();
            for (const project of projects) await idb.update('projects', project);
            await idb.update('payrollClosures', source);
            const originalInit = idb.init.bind(idb);
            idb.init = async () => { await originalInit(); uid = 'B'; };
            await expect(saveHistoricalClosureRecovery({
                sourceId: source.id, targetProjectId: 'target', idb, getUid: () => uid
            })).rejects.toThrow(/cuenta cambió/);
            expect(await idb.getAll('payrollClosures')).toHaveLength(1);
            expect(await idb.getAll('mainSyncOutbox')).toHaveLength(0);
        } finally {
            idb.db?.close();
        }
    });
});

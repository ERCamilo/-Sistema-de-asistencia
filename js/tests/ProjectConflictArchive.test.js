import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import {
    collectProjectConflictCases, applyProjectConflictArchive, ProjectConflictArchiveStore
} from '../modules/features/projects/ProjectConflictArchive.js';

if (typeof globalThis.structuredClone !== "function") {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const base = () => ({
    enabled: true,
    employeeRows: [{ id: 'e1', status: 'EXPLICIT_ORPHAN', employee: { number: '34' } }],
    otherIssues: [{ collection: 'positions', recordKey: 'p1', status: 'LEGACY_UNSCOPED' }],
    pettyCashRows: [{ id: 'c1', name: 'Caja principal' }],
    diagnosticIssues: [
        { kind: 'closures', key: 'close-1', label: 'Cierre de nómina', reason: 'Sin obra asignada' },
        { kind: 'payments', key: 'payment-1', reason: 'Obra no disponible', informational: true }
    ],
    pendingEmployeeCount: 1, totalPendingCount: 4, issueCount: 5
});

describe('Multiobra reversible issue archive', () => {
    test('archive only hides the selected current condition; original financial data stays unchanged', () => {
        const input = base(), original = JSON.stringify(input);
        const cases = collectProjectConflictCases(input);
        expect(cases.map(c => c.id)).toEqual([
            'employee:e1', 'positions:p1', 'pettyCash:c1',
            'diagnostic-closures:close-1', 'diagnostic-payments:payment-1'
        ]);
        const visible = applyProjectConflictArchive(input, [
            { id: 'diagnostic-closures:close-1', reason: 'Sin obra asignada', status: 'archived', archivedAt: 10 }
        ]);
        expect(visible.diagnosticIssues.some(c => c.kind === 'closures')).toBe(false);
        expect(visible.archivedCount).toBe(1);
        expect(visible.archivedCases[0].id).toBe('diagnostic-closures:close-1');
        expect(visible.totalPendingCount).toBe(3);
        expect(JSON.stringify(input)).toBe(original);
    });

    test('orphan attendance can be hidden without mutating attendance or employees', () => {
        const input = { ...base(), orphanAttendanceKeys: ['deleted-employee:2026-11-01'] };
        const original = JSON.stringify(input);
        const source = collectProjectConflictCases(input).find(row => row.kind === 'attendance');
        expect(source).toMatchObject({ id: 'orphanAttendance:deleted-employee:2026-11-01' });
        const view = applyProjectConflictArchive(input, [
            { id: source.id, reason: source.reason, status: 'archived', archivedAt: 50 }
        ]);
        expect(view.orphanAttendanceKeys).toEqual([]);
        expect(view.archivedCases.map(row => row.id)).toContain(source.id);
        expect(JSON.stringify(input)).toBe(original);
    });

    test('changed reason reappears as pending instead of remaining silently hidden', () => {
        const current = base();
        current.diagnosticIssues[0].reason = 'Nuevo problema después del archivo';
        const visible = applyProjectConflictArchive(current, [
            { id: 'diagnostic-closures:close-1', reason: 'Sin obra asignada', status: 'archived' }
        ]);
        expect(visible.archivedCount).toBe(0);
        expect(visible.diagnosticIssues.some(c => c.kind === 'closures')).toBe(true);
    });

    test('archive and restore survive reload and remain isolated by account UID', async () => {
        const db = new IndexedDBService('sa-archive-' + Math.random());
        let uid = 'userA';
        const storage = new ProjectConflictArchiveStore({ db, getUid: () => uid });
        const item = collectProjectConflictCases(base())[3];
        try {
            expect(await storage.list()).toEqual([]);
            await storage.setCase(item, { archived: true, note: 'Falta empleado original' });
            expect((await storage.list())[0]).toEqual(expect.objectContaining({
                id: item.id, reason: item.reason, note: 'Falta empleado original', status: 'archived'
            }));
            uid = 'userB';
            expect(await storage.list()).toEqual([]);
            uid = 'userA';
            await storage.setCase(item, { archived: false });
            expect(await storage.list()).toEqual([]);
            const untouched = await db.getAll('payrollClosures');
            expect(untouched).toEqual([]);
        } finally {
            db.db?.close();
        }
    });

    test('logout during a pending archive cannot write to previous account', async () => {
        let uid = 'A';
        const db = { atomicMutate: jest.fn(async (_store, _key, mutate) => {
            uid = 'B';
            mutate(null);
        }) };
        const storage = new ProjectConflictArchiveStore({ db, getUid: () => uid });
        await expect(storage.setCase({ id: 'employee:e1', reason: 'Pendiente' }))
            .rejects.toThrow(/cuenta cambió/);
    });
});

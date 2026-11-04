import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { buildPayrollClosure, buildPayrollClosureSnapshot } from '../modules/features/payroll/PayrollClosure.js';
import { planHistoricalClosureRecovery, saveHistoricalClosureRecovery, verifyHistoricalClosureSourceInCloud } from '../modules/features/projects/ProjectHistoricalClosureRecovery.js';
import * as firebase from '../modules/data/firebase.js';

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
            const options = { sourceId: source.id, targetProjectId: 'target', idb, getUid: () => 'userA', now: () => 1000,
                verifyCloudSource: async ({ uid, sourceProjectId }) => ({ verifiedForUid: uid, sourceProjectId }) };
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

    test('local tombstone of original work also prevents silent reassignment', () => {
        const source = historicalClosure();
        expect(() => planHistoricalClosureRecovery({
            sourceId: source.id, targetProjectId: 'target',
            projects: [...projects, { id: 'deleted-project', deletedAt: 123, status: 'closed' }],
            payrollClosures: [source]
        })).toThrow(/obra existente/);
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
            })).rejects.toThrow(/cuenta.*cambió/);
            expect(await idb.getAll('payrollClosures')).toHaveLength(1);
            expect(await idb.getAll('mainSyncOutbox')).toHaveLength(0);
        } finally {
            idb.db?.close();
        }
    });
});

describe('remote-first security gate for historical payroll copies', () => {
    const missing = { exists: () => false };
    const exists = data => ({ exists: () => true, data: () => data });
    let dbId = 0, idb, source;
    beforeEach(async () => {
        idb = new IndexedDBService('historical-remote-validation-' + ++dbId + '-' + Math.random());
        source = historicalClosure();
        await idb.init();
        for (const project of projects) await idb.update('projects', project);
        await idb.update('payrollClosures', source);
        // Mock Firestore references, NEVER touching a real production account.
        jest.spyOn(firebase, 'doc').mockImplementation((_db, ...segments) => segments.join('/'));
    });
    afterEach(() => { jest.restoreAllMocks(); idb.db?.close(); });
    const options = (idb, source, readServer, getUid = () => 'userA') => ({
        idb, sourceId: source.id, targetProjectId: 'target', getUid,
        verifyCloudSource: args => verifyHistoricalClosureSourceInCloud({ ...args, readServer })
    });
    const remote = entries => jest.fn(async path => {
        if (entries[path] instanceof Error) throw entries[path];
        return entries[path] || missing;
    });
    async function assertNoNewWrites(idb, source) {
        expect(await idb.getAll('payrollClosures')).toEqual([source]);
        expect(await idb.getAll('mainSyncOutbox')).toEqual([]);
    }

    test('remote original project exists but local catalog did not download it: BLOCKS', async () => {
        const read = remote({ 'users/userA/projectsV1/deleted-project': exists({ id: 'deleted-project', status: 'active' }) });
        await expect(saveHistoricalClosureRecovery(options(idb, source, read)))
            .rejects.toThrow(/obra original existe en Firebase/);
        expect(read).toHaveBeenCalledTimes(3);
        await assertNoNewWrites(idb, source);
    });

    test('remote archived or deleted tombstone still blocks automatic reassignment', async () => {
        const read = remote({ 'users/userA/projectsV1/deleted-project': exists({ deletedAt: 123, status: 'archived' }) });
        await expect(saveHistoricalClosureRecovery(options(idb, source, read)))
            .rejects.toThrow(/obra original existe en Firebase/);
        await assertNoNewWrites(idb, source);
    });

    test('alias mapping exists in cloud despite missing project document: BLOCKS', async () => {
        const read = remote({ 'users/userA/projectAliasesV1/deleted-project': exists({ canonicalId: 'other' }) });
        await expect(saveHistoricalClosureRecovery(options(idb, source, read)))
            .rejects.toThrow(/vinculación registrada/);
        await assertNoNewWrites(idb, source);
    });

    test('source is recorded as canonical remote project: BLOCKS', async () => {
        const read = remote({ 'users/userA/projectRegistryV1/default': exists({ canonicalProjectId: 'deleted-project' }) });
        await expect(saveHistoricalClosureRecovery(options(idb, source, read)))
            .rejects.toThrow(/vinculación registrada/);
        await assertNoNewWrites(idb, source);
    });

    test.each(['unavailable', 'permission-denied'])('%s Firestore server errors block recovery and never use local cache', async code => {
        const read = remote({ 'users/userA/projectsV1/deleted-project': Object.assign(new Error(code), { code }) });
        await expect(saveHistoricalClosureRecovery(options(idb, source, read)))
            .rejects.toThrow(/No se pudo verificar la obra original con Firebase/);
        await assertNoNewWrites(idb, source);
    });

    test('all remote references authoritatively absent: copies once and never repeats outbox', async () => {
        const read = remote({});
        const once = await saveHistoricalClosureRecovery(options(idb, source, read));
        expect(once.created).toBe(true);
        const again = await saveHistoricalClosureRecovery(options(idb, source, read));
        expect(again.created).toBe(false);
        expect(await idb.getAll('payrollClosures')).toHaveLength(2);
        expect(await idb.getAll('mainSyncOutbox')).toHaveLength(1);
        expect(read).toHaveBeenCalledTimes(6);
    });

    test('account changes while Firebase request is pending: blocks after server responds', async () => {
        let uid = 'userA';
        const read = remote({});
        read.mockImplementation(async () => { uid = 'userB'; return missing; });
        await expect(saveHistoricalClosureRecovery(options(idb, source, read, () => uid)))
            .rejects.toThrow(/cuenta o la restauración cambió/);
        await assertNoNewWrites(idb, source);
    });

    test('source closure moved locally while Firestore request is pending: blocks stale identity', async () => {
        const read = jest.fn(async () => {
            await idb.update('payrollClosures', { ...source, projectId: 'other-project' });
            return missing;
        });
        await expect(saveHistoricalClosureRecovery(options(idb, source, read)))
            .rejects.toThrow(/El cierre original cambió/);
        expect(await idb.getAll('payrollClosures')).toHaveLength(1);
        expect(await idb.getAll('mainSyncOutbox')).toHaveLength(0);
    });

    test('unknown original project identifier fails closed without remote reads', async () => {
        await idb.update('payrollClosures', { ...source, projectId: null });
        const read = remote({});
        await expect(saveHistoricalClosureRecovery(options(idb, source, read)))
            .rejects.toThrow(/No se pudo comprobar la identidad/);
        expect(read).not.toHaveBeenCalled();
        expect(await idb.getAll('mainSyncOutbox')).toHaveLength(0);
    });
});

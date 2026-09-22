/**
 * R07 A2c-2 H2 — project ownership repairs must propagate through durable outbox.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS
} from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const SOURCE = { id: 'PRJ-cloud-source-001', name: 'Source', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 3 };
const TARGET = { id: 'PRJ-cloud-target-002', name: 'Target', status: 'active', createdAt: 2, updatedAt: 2, schemaVersion: 3 };
const ORPHAN = 'PRJ-missing-cloud-999';

function employee() {
    return {
        id: 'emp-cloud-001', number: '1', name: 'Cloud Employee',
        active: true, positions: [], loans: [], projectId: ORPHAN, updatedAt: 10
    };
}
function attendance(emp) {
    const key = emp.id + '-2026-09-20';
    return {
        [key]: {
            key, employeeId: emp.id, date: '2026-09-20',
            present: true, hoursWorked: 8, notes: 'keep-me',
            projectId: ORPHAN, updatedAt: 10
        }
    };
}

describe('ProjectRepairCloudPropagationR07', () => {
    let db;
    let savedState;

    beforeEach(async () => {
        savedState = JSON.parse(JSON.stringify({
            employees: stateManager._state.employees || [],
            positions: stateManager._state.positions || [],
            leaders: stateManager._state.leaders || [],
            attendance: stateManager._state.attendance || {},
            settings: stateManager._state.settings || {}
        }));
        db = new IndexedDBService('r07-cloud-' + Math.random());
        await db.init();
        await db.update('projects', SOURCE);
        await db.update('projects', TARGET);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        stateManager.setState(savedState, { silent: true });
        globalThis.currentUser = null;
        try { db.db.close(); } catch (_) {}
    });

    test('repair stamps freshness and enqueues current entities plus scoped attendance patch', async () => {
        const emp = employee();
        const att = attendance(emp);
        await db.update('employees', emp);
        for (const rec of Object.values(att)) await db.update('attendance', rec);
        stateManager.setState({
            employees: [emp], positions: [], leaders: [], attendance: att,
            settings: { ...(stateManager._state.settings || {}), schemaVersion: 3 }
        }, { silent: true });

        const entitiesSpy = jest.spyOn(MainSyncStore, 'enqueueEntities').mockResolvedValue(undefined);
        const dailySpy = jest.spyOn(MainSyncStore, 'enqueueDailyRepairPatch').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(false);
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            attendance: att,
            catalog: [SOURCE, TARGET],
            targetProjectId: TARGET.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.cloudQueued).toBe(true);

        const durableEmp = (await db.getAll('employees')).find(e => e.id === emp.id);
        const durableAtt = (await db.getAll('attendance')).find(r => r.employeeId === emp.id);
        expect(durableEmp.projectId).toBe(TARGET.id);
        expect(durableEmp.updatedAt).toBeGreaterThan(10);
        expect(durableAtt.projectId).toBe(TARGET.id);
        expect(durableAtt.updatedAt).toBeGreaterThan(10);
        expect(durableAtt.notes).toBe('keep-me');

        expect(entitiesSpy).toHaveBeenCalledTimes(1);
        const queuedEmployees = entitiesSpy.mock.calls[0][0];
        expect(queuedEmployees.find(e => e.id === emp.id)?.projectId).toBe(TARGET.id);
        expect(dailySpy).toHaveBeenCalledTimes(1);
        const [dateKey, records, scope] = dailySpy.mock.calls[0];
        expect(dateKey).toBe('2026-09-20');
        expect(Object.values(records)).toHaveLength(1);
        expect(Object.values(records)[0].projectId).toBe(TARGET.id);
        expect(scope.projectId).toBe(TARGET.id);
    });

    test('normal daily coalescing never deletes an ownership-repair patch for same date', async () => {
        indexedDBService.getAll.mockReset().mockResolvedValue([
            { key: 41, kind: 'daily', source: 'ownership-repair', status: 'pending', dateKey: '2026-09-20' },
            { key: 42, kind: 'daily', status: 'pending', dateKey: '2026-09-20' }
        ]);
        indexedDBService.delete.mockReset().mockResolvedValue(undefined);
        indexedDBService.update.mockReset().mockResolvedValue(1);

        await MainSyncStore.enqueueDaily('2026-09-20', { x: { date: '2026-09-20' } });

        const deletedKeys = indexedDBService.delete.mock.calls.map(c => c[1]);
        expect(deletedKeys).toContain(42);
        expect(deletedKeys).not.toContain(41);
    });
    test('no session leaves ownership-repair daily entry pending', async () => {
        indexedDBService.getAll.mockReset().mockResolvedValue([
            { key: 77, kind: 'daily', source: 'ownership-repair', status: 'pending', dateKey: '2026-09-20', records: {} }
        ]);
        indexedDBService.delete.mockReset().mockResolvedValue(undefined);
        const saveDaily = jest.fn();

        await MainSyncStore.flush({
            hasSession: () => false,
            isApplyingRemote: () => false,
            isPaused: () => false,
            cloudWatermark: () => 0,
            saveMirror: jest.fn(), saveDaily, saveEntities: jest.fn(),
            saveSettings: jest.fn(), savePayrollEmployees: jest.fn(),
            savePayrollClosure: jest.fn(), deleteEntity: jest.fn(), onCloudResult: jest.fn()
        });

        expect(saveDaily).not.toHaveBeenCalled();
        expect(indexedDBService.delete).not.toHaveBeenCalled();
    });
    test('quarantine sentinel is never queued as a real project scope', async () => {
        const emp = { ...employee(), projectId: 'PRJ-missing-cloud-999' };
        const att = attendance(emp);
        Object.values(att).forEach(rec => { rec.projectId = emp.projectId; });
        await db.update('employees', emp);
        for (const rec of Object.values(att)) await db.update('attendance', rec);
        stateManager.setState({ employees: [emp], positions: [], leaders: [], attendance: att }, { silent: true });

        const entitiesSpy = jest.spyOn(MainSyncStore, 'enqueueEntities').mockResolvedValue(undefined);
        const dailySpy = jest.spyOn(MainSyncStore, 'enqueueDailyRepairPatch').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(false);

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [emp], attendance: att, catalog: [SOURCE, TARGET], _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.cloudQueued).toBe(true);
        expect(result.cloudDeferredQuarantine).toBe(true);
        expect(result.cloudDeferredQuarantinePatches).toBe(1);
        expect(dailySpy).not.toHaveBeenCalled();
        expect(entitiesSpy).toHaveBeenCalledTimes(1);
        const durableEmp = (await db.getAll('employees')).find(e => e.id === emp.id);
        expect(durableEmp.projectId).toMatch(/^legacy-unresolved:/);
    });

    test('outbox enqueue failure does not roll back committed local repair', async () => {
        const emp = employee();
        const att = attendance(emp);
        await db.update('employees', emp);
        for (const rec of Object.values(att)) await db.update('attendance', rec);
        stateManager.setState({ employees: [emp], positions: [], leaders: [], attendance: att }, { silent: true });

        jest.spyOn(MainSyncStore, 'enqueueEntities').mockRejectedValue(new Error('outbox unavailable'));
        const dailySpy = jest.spyOn(MainSyncStore, 'enqueueDailyRepairPatch').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(false);

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp], attendance: att, catalog: [SOURCE, TARGET],
            targetProjectId: TARGET.id, _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.cloudQueued).toBe(false);
        expect(result.cloudError).toMatch(/outbox unavailable/);
        expect(dailySpy).not.toHaveBeenCalled();
        expect((await db.getAll('employees')).find(e => e.id === emp.id)?.projectId).toBe(TARGET.id);
        expect((await db.getAll('attendance')).find(r => r.employeeId === emp.id)?.projectId).toBe(TARGET.id);
    });
});

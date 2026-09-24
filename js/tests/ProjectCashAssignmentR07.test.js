import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import { applyOwnershipRepair, REPAIR_ACTION, REPAIR_STATUS } from '../modules/features/projects/ProjectOwnershipRepairService.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
const A = { id: 'PRJ-cash-a', name: 'Obra A', status: 'active' };
const B = { id: 'PRJ-cash-b', name: 'Obra B', status: 'active' };
const cash = { id: 'cash-1', name: 'Caja gastos', officialProjectId: 'missing', nextRecordNumber: 9 };
const employee = { id: 'emp-1', name: 'Ana', positions: [], loans: [{ id: 'loan-1', amount: 1500, payments: [{ amount: 200 }] }] };
describe('cash and personnel project assignment', () => {
    let db, previous;
    beforeEach(async () => {
        previous = stateManager._state.pettyCash;
        db = new IndexedDBService('cash-assignment-' + Math.random());
        await db.init();
        for (const project of [A, B]) await db.update('projects', project);
        await db.update('pettyCashProjects', cash);
        await db.update('pettyCashPeriods', { id: 'period-1', projectId: cash.id, name: 'Septiembre' });
        await db.update('pettyCashMovements', { id: 'move-1', projectId: cash.id, periodId: 'period-1', amount: 250, receiptStatus: 'uploaded' });
        await db.update('employees', employee);
        stateManager.setState({ pettyCash: { projects: [cash], periods: [], movements: [] } }, { silent: true });
    });
    afterEach(() => {
        stateManager.setState({ pettyCash: previous }, { silent: true });
        db.db.close();
    });
    const params = db => ({ action: REPAIR_ACTION.MAP_TO_EXISTING, targetProjectId: A.id, employees: [], pettyCashIds: [cash.id], _db: db });
    test.each([false, true])('links a cash-only selection with new project=%s and keeps financial records unchanged', async create => {
        const periods = await db.getAll('pettyCashPeriods');
        const movements = await db.getAll('pettyCashMovements');
        const target = create ? 'PRJ-cash-new' : A.id;
        const result = await applyOwnershipRepair({ ...params(db), ...(create ? {
            action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP, projectId: target, projectName: 'Nueva obra'
        } : {}) });
        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect((await db.getAll('pettyCashProjects'))[0]).toMatchObject({ ...cash, officialProjectId: target });
        expect(await db.getAll('pettyCashPeriods')).toEqual(periods);
        expect(await db.getAll('pettyCashMovements')).toEqual(movements);
        expect((await db.getAll('pettyCashOutbox'))[0]).toMatchObject({
            op: 'save', col: 'projects', id: cash.id, data: { officialProjectId: target }, status: 'pending'
        });
        expect(stateManager._state.pettyCash.projects[0].officialProjectId).toBe(target);
        expect((await db.getAll('projects')).some(project => project.id === target)).toBe(true);
    });
    test('cash linked to another valid work blocks every selected employee write', async () => {
        await db.update('pettyCashProjects', { ...cash, officialProjectId: B.id });
        const result = await applyOwnershipRepair({ ...params(db), employees: [{ id: employee.id }] });
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect((await db.getAll('employees'))[0]).toEqual(employee);
        expect(await db.getAll('pettyCashOutbox')).toEqual([]);
    });
    test('a personnel conflict leaves cash and its queue unchanged', async () => {
        const result = await applyOwnershipRepair({ ...params(db), employees: [{ id: 'absent-employee' }] });
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect((await db.getAll('pettyCashProjects'))[0]).toEqual(cash);
        expect(await db.getAll('pettyCashOutbox')).toEqual([]);
    });
    test('assigns both together, preserves loans, and a retry does not duplicate cash queue', async () => {
        const proposal = { ...params(db), employees: [{ id: employee.id }] };
        expect((await applyOwnershipRepair(proposal)).status).toBe(REPAIR_STATUS.OK);
        expect((await db.getAll('employees'))[0]).toMatchObject({ projectId: A.id, loans: employee.loans });
        const queued = await db.getAll('pettyCashOutbox');
        expect((await applyOwnershipRepair(proposal)).status).toBe(REPAIR_STATUS.NO_OP);
        expect(await db.getAll('pettyCashOutbox')).toEqual(queued);
    });
    test('failure writing cash outbox rolls back employee and cash changes', async () => {
        const original = db.db.transaction.bind(db.db);
        const raw = { transaction(...args) {
            const tx = original(...args), getStore = tx.objectStore.bind(tx);
            tx.objectStore = name => {
                const store = getStore(name);
                if (name === 'pettyCashOutbox') store.put = () => { throw new Error('injected queue failure'); };
                return store;
            };
            return tx;
        }};
        await expect(applyOwnershipRepair({ ...params({ init: async () => {}, db: raw }), employees: [{ id: employee.id }] })).rejects.toThrow('injected queue failure');
        expect((await db.getAll('employees'))[0]).toEqual(employee);
        expect((await db.getAll('pettyCashProjects'))[0]).toEqual(cash);
        expect(await db.getAll('pettyCashOutbox')).toEqual([]);
    });
});

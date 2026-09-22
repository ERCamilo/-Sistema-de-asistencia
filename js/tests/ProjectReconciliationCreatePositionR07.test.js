/**
 * ProjectReconciliationCreatePositionR07.test.js — R07 Phase B (CREATE flow)
 *
 * Contracts for position resolution inside CREATE_PROJECT_AND_MAP (addendum):
 *   1. A position conflict (cross-project position) in the create flow resolves
 *      via a destination-owned copy instead of hard-blocking.
 *   2. Project + position copy + employees + attendance + meta commit in ONE
 *      transaction; an aborted plan leaves zero durable writes.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS,
    RECONCILIATION_META_KEY
} from '../modules/features/projects/ProjectOwnershipRepairService.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

const SOURCE_PROJECT = {
    id: 'PRJ-create-source', name: 'Obra origen', status: 'active',
    createdAt: 1, updatedAt: 1, schemaVersion: 1
};
const OLD_POSITION = {
    id: 'POS-create-old', name: 'Albañil origen', active: true,
    projectId: SOURCE_PROJECT.id, hourlyRate: 120
};
const NEW_PROJECT_ID = 'PRJ-create-position-new';
const NEW_PROJECT_NAME = 'Obra nueva';
const NEW_POSITION_ID = 'POS-create-new';

function employee() {
    return {
        id: 'emp-create-1', number: '34', name: 'Andres Sanchez',
        active: true, projectId: 'PRJ-create-orphan',
        positions: [OLD_POSITION.id],
        positionSalaries: { [OLD_POSITION.id]: 150 },
        positionSalaryModes: { [OLD_POSITION.id]: 'hourly' },
        customWorkingDays: { [OLD_POSITION.id]: [1, 2, 3, 4, 5] },
        loans: [{ id: 'loan-safe', balance: 275 }],
        updatedAt: 10, positionsUpdatedAt: 10
    };
}

function attendance(emp = employee()) {
    const key = emp.id + '-2026-09-18';
    return {
        [key]: {
            key, employeeId: emp.id, date: '2026-09-18',
            present: true, hoursWorked: 8, overtimeHours: 0,
            projectId: 'PRJ-create-orphan',
            selectedPosition: OLD_POSITION.id,
            positionHours: [{ positionId: OLD_POSITION.id, hours: 8, overtimeHours: 0 }],
            updatedAt: 10
        }
    };
}

describe('ProjectReconciliationCreatePositionR07', () => {
    let db;
    let previous;

    beforeEach(async () => {
        previous = JSON.parse(JSON.stringify({
            employees: stateManager._state.employees || [],
            positions: stateManager._state.positions || [],
            leaders: stateManager._state.leaders || [],
            attendance: stateManager._state.attendance || {}
        }));
        db = new IndexedDBService('r07-create-position-' + Math.random());
        await db.init();
        await db.update('projects', SOURCE_PROJECT);
        await db.update('positions', OLD_POSITION);
    });

    afterEach(() => {
        stateManager.setState(previous, { silent: true });
        try { db.db.close(); } catch (_) {}
        jest.restoreAllMocks();
    });

    async function seed(emp = employee(), att = attendance(emp)) {
        await db.update('employees', emp);
        for (const rec of Object.values(att)) await db.update('attendance', rec);
        stateManager.setState({
            employees: [emp],
            positions: [OLD_POSITION],
            leaders: [],
            attendance: att
        }, { silent: true });
        return { emp, att };
    }

    function createParams(emp, att, extra = {}) {
        return {
            action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
            employees: [emp],
            allEmployees: [emp],
            attendance: att,
            positions: [OLD_POSITION],
            leaders: [],
            catalog: [SOURCE_PROJECT],
            projectId: NEW_PROJECT_ID,
            projectName: NEW_PROJECT_NAME,
            _db: db,
            ...extra
        };
    }

    test('resolves a cross-project position conflict via a destination-owned copy in one transaction', async () => {
        const { emp, att } = await seed();
        const result = await applyOwnershipRepair(createParams(emp, att, {
            positionRemaps: [{
                employeeId: emp.id,
                fromPositionId: OLD_POSITION.id,
                toPositionId: NEW_POSITION_ID,
                migrateHistory: false
            }],
            positionCopies: [{
                fromPositionId: OLD_POSITION.id,
                newPositionId: NEW_POSITION_ID,
                name: 'Albañil nueva'
            }]
        }));

        expect(result.status).toBe(REPAIR_STATUS.OK);

        // Project committed.
        const projects = await db.getAll('projects');
        const createdProject = projects.find(p => p.id === NEW_PROJECT_ID);
        expect(createdProject).toBeDefined();
        expect(createdProject.name).toBe(NEW_PROJECT_NAME);

        // Position copy committed (destination-owned).
        const copy = (await db.getAll('positions')).find(p => p.id === NEW_POSITION_ID);
        expect(copy).toBeDefined();
        expect(copy.projectId).toBe(NEW_PROJECT_ID);
        expect(copy.name).toBe('Albañil nueva');
        expect(Object.prototype.hasOwnProperty.call(copy, 'crossProjectLeaderId')).toBe(false);

        // Employee + attendance committed in the same transaction.
        const durableEmp = (await db.getAll('employees')).find(e => e.id === emp.id);
        expect(durableEmp.projectId).toBe(NEW_PROJECT_ID);
        expect(durableEmp.positions).toEqual([NEW_POSITION_ID]);
        const durableAtt = (await db.getAll('attendance')).find(r => r.employeeId === emp.id);
        expect(durableAtt.projectId).toBe(NEW_PROJECT_ID);

        // Meta committed.
        const meta = await db.get('settings', RECONCILIATION_META_KEY);
        expect(meta.repairs.some(r => r.action === REPAIR_ACTION.CREATE_PROJECT_AND_MAP)).toBe(true);

        // Memory/durable parity for the created position.
        expect(stateManager._state.positions.find(p => p.id === NEW_POSITION_ID)).toBeDefined();
    });

    test('a position copy conflict aborts the create flow with zero durable writes', async () => {
        const { emp, att } = await seed();
        // Collide the copy id with a position already owned by another project.
        const colliding = { id: 'POS-create-collide', name: 'Ocupado', active: true, projectId: 'PRJ-other' };
        await db.update('positions', colliding);

        const beforeProjects = JSON.stringify(await db.getAll('projects'));
        const beforeEmployees = JSON.stringify(await db.getAll('employees'));
        const beforeAttendance = JSON.stringify(await db.getAll('attendance'));
        const beforePositions = JSON.stringify(await db.getAll('positions'));
        const beforeMeta = JSON.stringify(await db.get('settings', RECONCILIATION_META_KEY));

        const result = await applyOwnershipRepair(createParams(emp, att, {
            positionCopies: [{
                fromPositionId: OLD_POSITION.id,
                newPositionId: colliding.id,
                name: 'Duplicado'
            }]
        }));

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(JSON.stringify(await db.getAll('projects'))).toBe(beforeProjects);
        expect(JSON.stringify(await db.getAll('employees'))).toBe(beforeEmployees);
        expect(JSON.stringify(await db.getAll('attendance'))).toBe(beforeAttendance);
        expect(JSON.stringify(await db.getAll('positions'))).toBe(beforePositions);
        expect(JSON.stringify(await db.get('settings', RECONCILIATION_META_KEY))).toBe(beforeMeta);
    });

    test('a transaction abort after writes begin leaves every durable store unchanged', async () => {
        const { emp, att } = await seed();
        const beforeProjects = JSON.stringify(await db.getAll('projects'));
        const beforeEmployees = JSON.stringify(await db.getAll('employees'));
        const beforeAttendance = JSON.stringify(await db.getAll('attendance'));
        const beforePositions = JSON.stringify(await db.getAll('positions'));
        const beforeMeta = JSON.stringify(await db.get('settings', RECONCILIATION_META_KEY));

        const originalTransaction = db.db.transaction.bind(db.db);
        jest.spyOn(db.db, 'transaction').mockImplementation((...args) => {
            const tx = originalTransaction(...args);
            const settingsStore = tx.objectStore('settings');
            const originalPut = settingsStore.put.bind(settingsStore);
            settingsStore.put = (...putArgs) => {
                const request = originalPut(...putArgs);
                // Project, position, employee and attendance puts have already
                // been queued by the time metadata is written.
                tx.abort();
                return request;
            };
            return tx;
        });

        await expect(applyOwnershipRepair(createParams(emp, att, {
            positionRemaps: [{
                employeeId: emp.id,
                fromPositionId: OLD_POSITION.id,
                toPositionId: NEW_POSITION_ID,
                migrateHistory: false
            }],
            positionCopies: [{
                fromPositionId: OLD_POSITION.id,
                newPositionId: NEW_POSITION_ID,
                name: 'Albañil nueva'
            }]
        }))).rejects.toBeDefined();

        jest.restoreAllMocks();

        expect(JSON.stringify(await db.getAll('projects'))).toBe(beforeProjects);
        expect(JSON.stringify(await db.getAll('employees'))).toBe(beforeEmployees);
        expect(JSON.stringify(await db.getAll('attendance'))).toBe(beforeAttendance);
        expect(JSON.stringify(await db.getAll('positions'))).toBe(beforePositions);
        expect(JSON.stringify(await db.get('settings', RECONCILIATION_META_KEY))).toBe(beforeMeta);
    });
});

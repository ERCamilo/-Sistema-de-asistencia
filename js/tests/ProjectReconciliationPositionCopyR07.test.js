/**
 * ProjectReconciliationPositionCopyR07.test.js — R07 Phase B (positionCopies)
 *
 * Contracts for "Crear puesto similar" in the MAP flow (addendum, Puestos):
 *   1. A destination-owned copy is created with a new unique id, normalized
 *      Position contract, target projectId, and NO source project/leader or
 *      cross-project organizational relations (crossProjectLeaderId absent).
 *   2. The selected employee is remapped to the new position id in the same
 *      transaction.
 *   3. Fail-closed conflict kinds (SOURCE_MISSING, ID_INVALID, ID_COLLISION,
 *      LEADER_MISSING, LEADER_WRONG_PROJECT) abort with zero durable writes.
 *   4. Memory/durable parity: the copy is merged into in-memory positions.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS
} from '../modules/features/projects/ProjectOwnershipRepairService.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

const TARGET_PROJECT = {
    id: 'PRJ-copy-target', name: 'Obra destino', status: 'active',
    createdAt: 1, updatedAt: 1, schemaVersion: 1
};
const SOURCE_PROJECT = {
    id: 'PRJ-copy-source', name: 'Obra origen', status: 'active',
    createdAt: 2, updatedAt: 2, schemaVersion: 1
};
const SOURCE_LEADER = {
    id: 'LEAD-copy-src', number: '1', name: 'Líder origen', active: true, projectId: SOURCE_PROJECT.id
};
const OLD_POSITION = {
    id: 'POS-copy-old', name: 'Albañil origen', active: true,
    projectId: SOURCE_PROJECT.id, hourlyRate: 125,
    leaderId: SOURCE_LEADER.id, crossProjectLeaderId: 'LEAD-copy-legacy'
};

function employee() {
    return {
        id: 'emp-copy-1', number: '34', name: 'Andres Sanchez',
        active: true, projectId: 'PRJ-copy-orphan',
        positions: [OLD_POSITION.id],
        positionSalaries: { [OLD_POSITION.id]: 150 },
        positionSalaryModes: { [OLD_POSITION.id]: 'hourly' },
        customWorkingDays: { [OLD_POSITION.id]: [1, 2, 3, 4, 5] },
        loans: [{ id: 'loan-safe', balance: 275 }],
        updatedAt: 10, positionsUpdatedAt: 10
    };
}

describe('ProjectReconciliationPositionCopyR07', () => {
    let db;
    let previous;

    beforeEach(async () => {
        previous = JSON.parse(JSON.stringify({
            employees: stateManager._state.employees || [],
            positions: stateManager._state.positions || [],
            leaders: stateManager._state.leaders || [],
            attendance: stateManager._state.attendance || {}
        }));
        db = new IndexedDBService('r07-position-copy-' + Math.random());
        await db.init();
        await db.update('projects', TARGET_PROJECT);
        await db.update('projects', SOURCE_PROJECT);
        await db.update('positions', OLD_POSITION);
        await db.update('leaders', SOURCE_LEADER);
    });

    afterEach(() => {
        stateManager.setState(previous, { silent: true });
        try { db.db.close(); } catch (_) {}
        jest.restoreAllMocks();
    });

    async function seed(emp = employee()) {
        await db.update('employees', emp);
        stateManager.setState({
            employees: [emp],
            positions: [OLD_POSITION],
            leaders: [SOURCE_LEADER],
            attendance: {}
        }, { silent: true });
        return emp;
    }

    function copyParams(emp, positionCopies, positionRemaps) {
        return {
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            allEmployees: [emp],
            attendance: {},
            positions: [OLD_POSITION],
            leaders: [SOURCE_LEADER],
            catalog: [TARGET_PROJECT, SOURCE_PROJECT],
            targetProjectId: TARGET_PROJECT.id,
            positionCopies,
            positionRemaps,
            _db: db
        };
    }

    test('creates a normalized destination-owned copy and remaps the employee to it in one transaction', async () => {
        const emp = await seed();
        const NEW_ID = 'POS-copy-new';
        const result = await applyOwnershipRepair(copyParams(emp, [{
            fromPositionId: OLD_POSITION.id,
            newPositionId: NEW_ID,
            name: 'Albañil destino'
        }], [{
            employeeId: emp.id,
            fromPositionId: OLD_POSITION.id,
            toPositionId: NEW_ID,
            migrateHistory: false
        }]));

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.createdPositions).toHaveLength(1);

        // Durable copy contract.
        const durablePositions = await db.getAll('positions');
        const copy = durablePositions.find(p => p.id === NEW_ID);
        expect(copy).toBeDefined();
        expect(copy.projectId).toBe(TARGET_PROJECT.id);
        expect(copy.name).toBe('Albañil destino');
        expect(copy.active).toBe(true);
        // No copy of source project, previous leader, or cross-project relations.
        expect(copy.leaderId).toBeNull();
        expect(Object.prototype.hasOwnProperty.call(copy, 'crossProjectLeaderId')).toBe(false);
        // Normalized Position contract (salaryConfig / baseSalary present).
        expect(copy).toHaveProperty('salaryConfig');
        expect(copy).toHaveProperty('hourlyRate');
        expect(copy).toHaveProperty('workingDays');

        // Employee remapped to the new position id in the same transaction.
        const durableEmp = (await db.getAll('employees')).find(e => e.id === emp.id);
        expect(durableEmp.positions).toEqual([NEW_ID]);
        expect(durableEmp.projectId).toBe(TARGET_PROJECT.id);

        // Memory/durable parity for positions.
        const memoryCopy = stateManager._state.positions.find(p => p.id === NEW_ID);
        expect(memoryCopy).toBeDefined();
        expect(memoryCopy.projectId).toBe(TARGET_PROJECT.id);
        expect(memoryCopy.name).toBe('Albañil destino');
    });

    test('drops the source leader and any cross-project leader relation on the copy', async () => {
        const emp = await seed();
        const NEW_ID = 'POS-copy-no-leader';
        const result = await applyOwnershipRepair(copyParams(emp, [{
            fromPositionId: OLD_POSITION.id,
            newPositionId: NEW_ID
        }], [{
            employeeId: emp.id,
            fromPositionId: OLD_POSITION.id,
            toPositionId: NEW_ID,
            migrateHistory: false
        }]));

        expect(result.status).toBe(REPAIR_STATUS.OK);
        const copy = (await db.getAll('positions')).find(p => p.id === NEW_ID);
        expect(copy.leaderId).toBeNull();
        expect(copy.projectId).toBe(TARGET_PROJECT.id);
        expect(Object.prototype.hasOwnProperty.call(copy, 'crossProjectLeaderId')).toBe(false);
    });

    test.each([
        ['SOURCE_MISSING', [{ fromPositionId: 'POS-missing', newPositionId: 'POS-new' }], []],
        ['ID_INVALID', [{ fromPositionId: OLD_POSITION.id, newPositionId: OLD_POSITION.id }], []],
        ['ID_INVALID_EMPTY', [{ fromPositionId: OLD_POSITION.id, newPositionId: '' }], []]
    ])('fails closed on %s with zero durable writes', async (_kind, positionCopies) => {
        const emp = await seed();
        const beforeEmp = JSON.stringify(await db.getAll('employees'));
        const beforeAtt = JSON.stringify(await db.getAll('attendance'));
        const beforePos = JSON.stringify(await db.getAll('positions'));

        const result = await applyOwnershipRepair(copyParams(emp, positionCopies, []));

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(JSON.stringify(await db.getAll('employees'))).toBe(beforeEmp);
        expect(JSON.stringify(await db.getAll('attendance'))).toBe(beforeAtt);
        expect(JSON.stringify(await db.getAll('positions'))).toBe(beforePos);
    });

    test('fails closed on ID_COLLISION (new id owned by another project) with zero durable writes', async () => {
        const emp = await seed();
        const colliding = { id: 'POS-copy-collide', name: 'Ocupado', active: true, projectId: 'PRJ-other' };
        await db.update('positions', colliding);

        const beforeEmp = JSON.stringify(await db.getAll('employees'));
        const beforePos = JSON.stringify(await db.getAll('positions'));

        const result = await applyOwnershipRepair(copyParams(emp, [{
            fromPositionId: OLD_POSITION.id,
            newPositionId: colliding.id
        }], []));

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.some(c => c.kind === 'POSITION_COPY_ID_COLLISION')).toBe(true);
        expect(JSON.stringify(await db.getAll('employees'))).toBe(beforeEmp);
        expect(JSON.stringify(await db.getAll('positions'))).toBe(beforePos);
    });

    test('fails closed on ID_COLLISION when the new id already exists in the target project', async () => {
        const emp = await seed();
        // A position already owned by the TARGET with the same id: F2 requires
        // create-similar to produce a NEW id, so any pre-existing newPositionId
        // — same-project or not — is a collision with zero durable writes.
        const existing = { id: 'POS-copy-reuse', name: 'Reutilizado', active: true, projectId: TARGET_PROJECT.id };
        await db.update('positions', existing);

        const beforeEmp = JSON.stringify(await db.getAll('employees'));
        const beforePos = JSON.stringify(await db.getAll('positions'));

        const result = await applyOwnershipRepair(copyParams(emp, [{
            fromPositionId: OLD_POSITION.id,
            newPositionId: existing.id
        }], []));

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.some(c => c.kind === 'POSITION_COPY_ID_COLLISION')).toBe(true);
        expect(JSON.stringify(await db.getAll('employees'))).toBe(beforeEmp);
        expect(JSON.stringify(await db.getAll('positions'))).toBe(beforePos);
    });

    test.each([
        ['LEADER_MISSING', 'LEAD-ghost', null],
        ['LEADER_WRONG_PROJECT', SOURCE_LEADER.id, SOURCE_LEADER],
        ['LEADER_INACTIVE', SOURCE_LEADER.id, { ...SOURCE_LEADER, active: false }]
    ])('detaches %s from a resulting copy instead of blocking', async (_kind, leaderId, durableLeader) => {
        const emp = await seed();
        const newId = 'POS-copy-detach-' + _kind.toLowerCase();
        if (durableLeader) await db.update('leaders', durableLeader);

        const result = await applyOwnershipRepair(copyParams(emp, [{
            fromPositionId: OLD_POSITION.id,
            newPositionId: newId,
            leaderId
        }], [{
            employeeId: emp.id,
            fromPositionId: OLD_POSITION.id,
            toPositionId: newId,
            migrateHistory: false
        }]));

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.detachedPositionLeaders).toEqual([
            expect.objectContaining({
                positionId: newId,
                leaderId,
                kind: _kind === 'LEADER_MISSING'
                    ? 'MISSING_LEADER_DEFINITION'
                    : (_kind === 'LEADER_INACTIVE' ? 'INACTIVE_LEADER' : 'LEADER_PROJECT_CONFLICT')
            })
        ]);
        const copy = (await db.getAll('positions')).find(p => p.id === newId);
        expect(copy.leaderId).toBeNull();
        expect(Object.prototype.hasOwnProperty.call(copy, 'crossProjectLeaderId')).toBe(false);
    });
});

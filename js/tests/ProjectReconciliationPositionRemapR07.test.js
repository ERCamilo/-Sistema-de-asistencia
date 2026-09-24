import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS
} from '../modules/features/projects/ProjectOwnershipRepairService.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const TARGET_PROJECT = {
    id: 'PRJ-remap-target', name: 'Obra destino', status: 'active',
    createdAt: 1, updatedAt: 1, schemaVersion: 1
};
const ORPHAN_PROJECT = 'PRJ-remap-missing';
const HISTORY_PROJECT = {
    id: 'PRJ-history-valid', name: 'Obra histórica', status: 'active',
    createdAt: 2, updatedAt: 2, schemaVersion: 1
};
const OLD_POSITION = {
    id: 'POS-old', name: 'Albañil origen', active: true,
    projectId: ORPHAN_PROJECT, hourlyRate: 125
};
const TARGET_POSITION = {
    id: 'POS-target', name: 'Albañil destino', active: true,
    projectId: TARGET_PROJECT.id, hourlyRate: 140
};
function employee() {
    return {
        id: 'emp-remap-1', number: '34', name: 'Andres Sanchez',
        active: true, projectId: ORPHAN_PROJECT,
        positions: [OLD_POSITION.id],
        positionSalaries: { [OLD_POSITION.id]: 150 },
        positionSalaryModes: { [OLD_POSITION.id]: 'hourly' },
        customWorkingDays: { [OLD_POSITION.id]: [1, 2, 3, 4, 5] },
        loans: [{ id: 'loan-safe', balance: 275 }],
        updatedAt: 10, positionsUpdatedAt: 10
    };
}

function attendance(emp = employee(), extra = {}) {
    const key = emp.id + '-2026-09-18';
    return {
        [key]: {
            key, employeeId: emp.id, date: '2026-09-18',
            present: true, hoursWorked: 8, overtimeHours: 2,
            projectId: ORPHAN_PROJECT,
            selectedPosition: OLD_POSITION.id,
            positionHours: [{ positionId: OLD_POSITION.id, hours: 6, overtimeHours: 2 }],
            notes: 'preservar esta nota', updatedAt: 10,
            ...extra
        }
    };
}
describe('ProjectReconciliationPositionRemapR07', () => {
    let db;
    let previous;

    beforeEach(async () => {
        previous = JSON.parse(JSON.stringify({
            employees: stateManager._state.employees || [],
            positions: stateManager._state.positions || [],
            leaders: stateManager._state.leaders || [],
            attendance: stateManager._state.attendance || {}
        }));
        db = new IndexedDBService('r07-position-remap-' + Math.random());
        await db.init();
        await db.update('projects', TARGET_PROJECT);
        await db.update('projects', HISTORY_PROJECT);
        await db.update('positions', OLD_POSITION);
        await db.update('positions', TARGET_POSITION);
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
            positions: [OLD_POSITION, TARGET_POSITION],
            leaders: [],
            attendance: att
        }, { silent: true });
        return { emp, att };
    }

    test('moves project, current position and worked-day position atomically while preserving hours and employee fields', async () => {
        const { emp, att } = await seed();
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp], allEmployees: [emp], attendance: att,
            positions: [OLD_POSITION, TARGET_POSITION], leaders: [],
            catalog: [TARGET_PROJECT],
            targetProjectId: TARGET_PROJECT.id,
            positionRemaps: [{
                employeeId: emp.id,
                fromPositionId: OLD_POSITION.id,
                toPositionId: TARGET_POSITION.id,
                migrateHistory: true
            }],
            _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.affected[0].remappedHistoryCount).toBe(1);

        const durableEmp = (await db.getAll('employees')).find(x => x.id === emp.id);
        expect(durableEmp.projectId).toBe(TARGET_PROJECT.id);
        expect(durableEmp.positions).toEqual([TARGET_POSITION.id]);
        expect(durableEmp.positionSalaries).toEqual({ [TARGET_POSITION.id]: 150 });
        expect(durableEmp.positionSalaryModes).toEqual({ [TARGET_POSITION.id]: 'hourly' });
        expect(durableEmp.customWorkingDays).toEqual({ [TARGET_POSITION.id]: [1, 2, 3, 4, 5] });
        expect(durableEmp.loans[0].balance).toBe(275);
        expect(durableEmp.name).toBe('Andres Sanchez');
        expect(durableEmp.positionsUpdatedAt).toBeGreaterThan(10);

        const durableAtt = (await db.getAll('attendance')).find(x => x.employeeId === emp.id);
        expect(durableAtt.projectId).toBe(TARGET_PROJECT.id);
        expect(durableAtt.selectedPosition).toBe(TARGET_POSITION.id);
        expect(durableAtt.positionHours).toEqual([
            { positionId: TARGET_POSITION.id, hours: 6, overtimeHours: 2 }
        ]);
        expect(durableAtt.notes).toBe('preservar esta nota');
        const memoryEmp = stateManager._state.employees.find(x => x.id === emp.id);
        const memoryAtt = stateManager._state.attendance[emp.id + '-2026-09-18'];
        expect(memoryEmp.positions).toEqual([TARGET_POSITION.id]);
        expect(memoryEmp.loans[0].balance).toBe(275);
        expect(memoryAtt.projectId).toBe(TARGET_PROJECT.id);
        expect(memoryAtt.selectedPosition).toBe(TARGET_POSITION.id);
        expect(memoryAtt.positionHours[0].hours).toBe(6);
        expect(memoryAtt.positionHours[0].overtimeHours).toBe(2);
    });

    test('fuses hours when the destination position already exists on the same worked day', async () => {
        const emp = employee();
        const att = attendance(emp, {
            positionHours: [
                { positionId: OLD_POSITION.id, hours: 3, overtimeHours: 1 },
                { positionId: TARGET_POSITION.id, hours: 4, overtimeHours: 2 }
            ]
        });
        await seed(emp, att);
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp], allEmployees: [emp], attendance: att,
            positions: [OLD_POSITION, TARGET_POSITION], leaders: [],
            catalog: [TARGET_PROJECT], targetProjectId: TARGET_PROJECT.id,
            positionRemaps: [{
                employeeId: emp.id, fromPositionId: OLD_POSITION.id,
                toPositionId: TARGET_POSITION.id, migrateHistory: true
            }],
            _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);
        const rec = (await db.getAll('attendance')).find(x => x.employeeId === emp.id);
        expect(rec.positionHours).toEqual([
            { positionId: TARGET_POSITION.id, hours: 7, overtimeHours: 3 }
        ]);
    });

    test('attributes an unclassified worked day to the resulting first position without changing its total hours', async () => {
        const emp = { ...employee(), positions: [OLD_POSITION.id, TARGET_POSITION.id] };
        const key = emp.id + '-2026-09-19';
        const att = {
            [key]: { key, employeeId: emp.id, date: '2026-09-19', present: true,
                hoursWorked: 8, overtimeHours: 2, selectedPosition: null,
                positionHours: [], updatedAt: 10 }
        };
        await seed(emp, att);
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING, employees: [emp], allEmployees: [emp],
            attendance: att, positions: [OLD_POSITION, TARGET_POSITION], leaders: [],
            catalog: [TARGET_PROJECT], targetProjectId: TARGET_PROJECT.id,
            positionRemaps: [{ employeeId: emp.id, fromPositionId: OLD_POSITION.id,
                toPositionId: TARGET_POSITION.id, migrateHistory: true }],
            assignUnpositionedHistory: true, _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);
        const rec = (await db.getAll('attendance')).find(x => x.employeeId === emp.id);
        expect(rec.selectedPosition).toBe(TARGET_POSITION.id);
        expect(rec.positionHours).toEqual([{ positionId: TARGET_POSITION.id, hours: 8, overtimeHours: 2 }]);
        expect(rec.hoursWorked).toBe(8);
        expect(rec.overtimeHours).toBe(2);
    });

    test('attributes only the unclassified remainder of a partly positioned day to the first role', async () => {
        const emp = employee();
        const key = emp.id + '-2026-09-19';
        const att = { [key]: { key, employeeId: emp.id, date: '2026-09-19', present: true,
            hoursWorked: 8, overtimeHours: 0, selectedPosition: null,
            positionHours: [{ positionId: OLD_POSITION.id, hours: 3, overtimeHours: 0 }], updatedAt: 10 } };
        await seed(emp, att);
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING, employees: [emp], allEmployees: [emp],
            attendance: att, positions: [OLD_POSITION, TARGET_POSITION], leaders: [],
            catalog: [TARGET_PROJECT], targetProjectId: TARGET_PROJECT.id,
            positionRemaps: [{ employeeId: emp.id, fromPositionId: OLD_POSITION.id,
                toPositionId: TARGET_POSITION.id, migrateHistory: true }],
            assignUnpositionedHistory: true, _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);
        const rec = (await db.getAll('attendance')).find(x => x.employeeId === emp.id);
        expect(rec.positionHours).toEqual([{ positionId: TARGET_POSITION.id, hours: 8, overtimeHours: 0 }]);
        expect(rec.hoursWorked).toBe(8);
    });

    test('maps both roles and their worked days while retaining the special salary of the second role', async () => {
        const second = { id: 'POS-second', name: 'Segundo', active: true, projectId: ORPHAN_PROJECT };
        const secondTarget = { id: 'POS-second-target', name: 'Segundo destino', active: true, projectId: TARGET_PROJECT.id };
        const emp = { ...employee(), positions: [OLD_POSITION.id, second.id],
            positionSalaries: { [OLD_POSITION.id]: 150, [second.id]: 112.5 },
            positionSalaryModes: { [OLD_POSITION.id]: 'hourly', [second.id]: 'daily' } };
        const firstDay = attendance(emp);
        const secondKey = emp.id + '-2026-09-19';
        const att = { ...firstDay, [secondKey]: { key: secondKey, employeeId: emp.id, date: '2026-09-19',
            present: true, hoursWorked: 8, overtimeHours: 0, selectedPosition: second.id,
            positionHours: [{ positionId: second.id, hours: 8 }], updatedAt: 10 } };
        await db.update('positions', second);
        await db.update('positions', secondTarget);
        await seed(emp, att);
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING, employees: [emp], allEmployees: [emp],
            attendance: att, positions: [OLD_POSITION, second, TARGET_POSITION, secondTarget], leaders: [],
            catalog: [TARGET_PROJECT], targetProjectId: TARGET_PROJECT.id,
            positionRemaps: [[OLD_POSITION.id, TARGET_POSITION.id], [second.id, secondTarget.id]]
                .map(([fromPositionId, toPositionId]) => ({ employeeId: emp.id, fromPositionId,
                    toPositionId, migrateHistory: true })), _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);
        const durableEmp = (await db.getAll('employees')).find(x => x.id === emp.id);
        expect(durableEmp.positions).toEqual([TARGET_POSITION.id, secondTarget.id]);
        expect(durableEmp.positionSalaries).toEqual({ [TARGET_POSITION.id]: 150, [secondTarget.id]: 112.5 });
        expect(durableEmp.positionSalaryModes[secondTarget.id]).toBe('daily');
        const days = (await db.getAll('attendance')).filter(x => x.employeeId === emp.id);
        expect(days.map(x => x.selectedPosition).sort()).toEqual([TARGET_POSITION.id, secondTarget.id].sort());
        expect(days.reduce((sum, x) => sum + x.hoursWorked, 0)).toBe(16);
    });

    test('refuses to merge different special salaries into one destination position', async () => {
        const emp = { ...employee(), positions: [OLD_POSITION.id, 'POS-second'],
            positionSalaries: { [OLD_POSITION.id]: 150, 'POS-second': 175 } };
        const second = { id: 'POS-second', name: 'Segundo', active: true, projectId: ORPHAN_PROJECT };
        await db.update('positions', second);
        await seed(emp, {});
        const before = JSON.stringify(await db.getAll('employees'));
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING, employees: [emp], allEmployees: [emp],
            attendance: {}, positions: [OLD_POSITION, second, TARGET_POSITION], leaders: [],
            catalog: [TARGET_PROJECT], targetProjectId: TARGET_PROJECT.id,
            positionRemaps: [OLD_POSITION.id, second.id].map(fromPositionId => ({
                employeeId: emp.id, fromPositionId, toPositionId: TARGET_POSITION.id,
                migrateHistory: true
            })), _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(JSON.stringify(await db.getAll('employees'))).toBe(before);
    });

    test('rejects a target position from another project without mutating durable records', async () => {
        const { emp, att } = await seed();
        const wrong = { ...TARGET_POSITION, id: 'POS-wrong', projectId: 'PRJ-other' };
        await db.update('positions', wrong);
        const beforeEmp = JSON.stringify(await db.getAll('employees'));
        const beforeAtt = JSON.stringify(await db.getAll('attendance'));
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp], allEmployees: [emp], attendance: att,
            positions: [OLD_POSITION, wrong], leaders: [],
            catalog: [TARGET_PROJECT], targetProjectId: TARGET_PROJECT.id,
            positionRemaps: [{
                employeeId: emp.id, fromPositionId: OLD_POSITION.id,
                toPositionId: wrong.id, migrateHistory: true
            }],
            _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.some(c => c.kind === 'POSITION_REMAP_TARGET_WRONG_PROJECT')).toBe(true);
        expect(JSON.stringify(await db.getAll('employees'))).toBe(beforeEmp);
        expect(JSON.stringify(await db.getAll('attendance'))).toBe(beforeAtt);
    });

    test('changes the current position without rewriting worked-day position history by default', async () => {
        const { emp, att } = await seed();
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp], allEmployees: [emp], attendance: att,
            positions: [OLD_POSITION, TARGET_POSITION], leaders: [],
            catalog: [TARGET_PROJECT, HISTORY_PROJECT], targetProjectId: TARGET_PROJECT.id,
            positionRemaps: [{
                employeeId: emp.id, fromPositionId: OLD_POSITION.id,
                toPositionId: TARGET_POSITION.id, migrateHistory: false
            }],
            _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.affected[0].remappedHistoryCount).toBe(0);
        const durableEmp = (await db.getAll('employees')).find(x => x.id === emp.id);
        const durableAtt = (await db.getAll('attendance')).find(x => x.employeeId === emp.id);
        expect(durableEmp.projectId).toBe(TARGET_PROJECT.id);
        expect(durableEmp.positions).toEqual([TARGET_POSITION.id]);
        expect(durableAtt.projectId).toBe(TARGET_PROJECT.id);
        expect(durableAtt.selectedPosition).toBe(OLD_POSITION.id);
        expect(durableAtt.positionHours).toEqual([
            { positionId: OLD_POSITION.id, hours: 6, overtimeHours: 2 }
        ]);
    });

    test('preserves attendance that already belongs to another valid project', async () => {
        const emp = { ...employee(), positions: [], positionSalaries: {}, positionSalaryModes: {}, customWorkingDays: {} };
        const att = attendance(emp, {
            projectId: HISTORY_PROJECT.id,
            selectedPosition: undefined,
            positionHours: undefined,
            updatedAt: 10
        });
        await seed(emp, att);

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp], allEmployees: [emp], attendance: att,
            positions: [], leaders: [],
            catalog: [TARGET_PROJECT, HISTORY_PROJECT], targetProjectId: TARGET_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        const durableEmp = (await db.getAll('employees')).find(x => x.id === emp.id);
        const durableAtt = (await db.getAll('attendance')).find(x => x.employeeId === emp.id);
        expect(durableEmp.projectId).toBe(TARGET_PROJECT.id);
        expect(durableAtt.projectId).toBe(HISTORY_PROJECT.id);
        expect(durableAtt.updatedAt).toBe(10);
    });

    test('F1: does not rewrite position history of attendance owned by another valid project even with migrateHistory', async () => {
        const emp = employee();
        const att = attendance(emp, {
            projectId: HISTORY_PROJECT.id,
            selectedPosition: OLD_POSITION.id,
            positionHours: [{ positionId: OLD_POSITION.id, hours: 6, overtimeHours: 2 }],
            updatedAt: 10
        });
        await seed(emp, att);

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp], allEmployees: [emp], attendance: att,
            positions: [OLD_POSITION, TARGET_POSITION], leaders: [],
            catalog: [TARGET_PROJECT, HISTORY_PROJECT], targetProjectId: TARGET_PROJECT.id,
            positionRemaps: [{
                employeeId: emp.id, fromPositionId: OLD_POSITION.id,
                toPositionId: TARGET_POSITION.id, migrateHistory: true
            }],
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.affected[0].remappedHistoryCount).toBe(0);
        const durableAtt = (await db.getAll('attendance')).find(x => x.employeeId === emp.id);
        // Byte-stable history: the complete record, including identity,
        // ownership, selected position, hours and timestamp, is unchanged.
        expect(durableAtt).toEqual(att[emp.id + '-2026-09-18']);

        // The employee's current assignment still moves to the target position.
        const durableEmp = (await db.getAll('employees')).find(x => x.id === emp.id);
        expect(durableEmp.positions).toEqual([TARGET_POSITION.id]);
        expect(durableEmp.projectId).toBe(TARGET_PROJECT.id);
    });

    test('F4: detaches a cross-project leader from the resulting destination position (non-blocking)', async () => {
        const otherLeader = { id: 'LEAD-remap-other', number: '1', name: 'Líder otra obra', active: true, projectId: HISTORY_PROJECT.id };
        const targetWithLeader = {
            id: 'POS-target-led', name: 'Albañil destino con líder', active: true,
            projectId: TARGET_PROJECT.id, hourlyRate: 140,
            leaderId: otherLeader.id, crossProjectLeaderId: 'LEAD-remap-legacy'
        };
        await db.update('leaders', otherLeader);
        await db.update('positions', targetWithLeader);

        const emp = employee();
        const att = attendance(emp);
        await seed(emp, att);
        stateManager.setState({
            positions: [OLD_POSITION, TARGET_POSITION, targetWithLeader],
            leaders: [otherLeader]
        }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp], allEmployees: [emp], attendance: att,
            positions: [OLD_POSITION, TARGET_POSITION, targetWithLeader],
            leaders: [otherLeader],
            catalog: [TARGET_PROJECT, HISTORY_PROJECT], targetProjectId: TARGET_PROJECT.id,
            positionRemaps: [{
                employeeId: emp.id, fromPositionId: OLD_POSITION.id,
                toPositionId: targetWithLeader.id, migrateHistory: false
            }],
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.detachedPositionLeaders).toEqual([
            expect.objectContaining({
                positionId: targetWithLeader.id,
                leaderId: otherLeader.id,
                kind: 'LEADER_PROJECT_CONFLICT'
            })
        ]);

        // Durable: the destination position's cross-project leader is detached.
        const durablePos = (await db.getAll('positions')).find(p => p.id === targetWithLeader.id);
        expect(durablePos.leaderId).toBeNull();
        expect(Object.prototype.hasOwnProperty.call(durablePos, 'crossProjectLeaderId')).toBe(false);

        // Employee remapped to the destination position in the same transaction.
        const durableEmp = (await db.getAll('employees')).find(x => x.id === emp.id);
        expect(durableEmp.positions).toEqual([targetWithLeader.id]);
        expect(durableEmp.projectId).toBe(TARGET_PROJECT.id);

        // Memory parity for the detached position leader.
        const memPos = stateManager._state.positions.find(p => p.id === targetWithLeader.id);
        expect(memPos.leaderId).toBeNull();
    });
});

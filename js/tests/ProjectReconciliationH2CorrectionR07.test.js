/**
 * SA R07 final H2 corrective regressions.
 *
 * These tests intentionally describe the four authoritative findings before
 * the corrective implementation is applied.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { state, stateManager } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS
} from '../modules/features/projects/ProjectOwnershipRepairService.js';
import {
    openProjectReconciliation,
    closeProjectReconciliation,
    registerProjectReconciliationGlobals
} from '../modules/features/projects/ProjectReconciliationUI.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const P1 = { id: 'PRJ-h2-source', name: 'Obra Origen', status: 'active' };
const P2 = { id: 'PRJ-h2-target', name: 'Obra Destino', status: 'active' };
const P3 = { id: 'PRJ-h2-history', name: 'Obra Histórica', status: 'active' };

function validEmployee(overrides = {}) {
    return {
        id: 'emp-h2-valid', number: '34', name: 'Andres Sanchez', active: true,
        projectId: P1.id, positions: [], loans: [], ...overrides
    };
}

function orphanAttendance(employeeId, date, projectId = 'PRJ-h2-missing') {
    const key = `${employeeId}-${date}`;
    return {
        key, employeeId, date, present: true, hoursWorked: 8, projectId
    };
}

describe('ProjectReconciliationH2CorrectionR07', () => {
    let db;
    let getStateSpy;

    beforeEach(async () => {
        setProjectsEnabled(true);
        registerProjectReconciliationGlobals();
        state.employees = [];
        state.positions = [];
        state.leaders = [];
        state.attendance = {};
        getStateSpy = jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true,
            ready: true,
            activeProjectId: P1.id,
            defaultProjectId: P1.id,
            activeProject: P1,
            projects: [P1, P2, P3]
        });
        db = new IndexedDBService('r07-h2-correction-' + Math.random());
        await db.init();
        await db.update('projects', P1);
        await db.update('projects', P2);
        await db.update('projects', P3);
    });

    afterEach(() => {
        closeProjectReconciliation();
        getStateSpy?.mockRestore();
        try { db?.db?.close(); } catch (_) { /* ignore */ }
        document.body.innerHTML = '';
        delete window.render;
    });

    test('C1 service: attendance-only reconciliation preserves a valid employee project and moves only orphan attendance', async () => {
        const employee = validEmployee();
        const attendance = orphanAttendance(employee.id, '2026-09-20');
        stateManager.setState({
            employees: [employee], positions: [], leaders: [],
            attendance: { [attendance.key]: attendance }
        }, { silent: true });
        await db.update('employees', employee);
        await db.update('attendance', attendance);

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [employee],
            allEmployees: [employee],
            attendance: { [attendance.key]: attendance },
            catalog: [P1, P2, P3],
            targetProjectId: P2.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect((await db.getAll('employees')).find(row => row.id === employee.id)?.projectId).toBe(P1.id);
        expect((await db.getAll('attendance')).find(row => row.key === attendance.key)?.projectId).toBe(P2.id);
        expect(stateManager._state.employees.find(row => row.id === employee.id)?.projectId).toBe(P1.id);
        expect(stateManager._state.attendance[attendance.key].projectId).toBe(P2.id);
    });

    test('C1 service: CREATE attendance-only reconciliation also preserves valid employee ownership', async () => {
        const employee = validEmployee({ id: 'emp-h2-create-valid' });
        const attendance = orphanAttendance(employee.id, '2026-09-21');
        const createdProjectId = 'PRJ-h2-created';
        stateManager.setState({
            employees: [employee], positions: [], leaders: [],
            attendance: { [attendance.key]: attendance }
        }, { silent: true });
        await db.update('employees', employee);
        await db.update('attendance', attendance);

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
            employees: [employee],
            allEmployees: [employee],
            attendance: { [attendance.key]: attendance },
            catalog: [P1, P2, P3],
            projectId: createdProjectId,
            projectName: 'Obra Recuperada',
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect((await db.getAll('employees')).find(row => row.id === employee.id)?.projectId).toBe(P1.id);
        expect((await db.getAll('attendance')).find(row => row.key === attendance.key)?.projectId).toBe(createdProjectId);
        expect(stateManager._state.employees.find(row => row.id === employee.id)?.projectId).toBe(P1.id);
        expect(stateManager._state.attendance[attendance.key].projectId).toBe(createdProjectId);
    });

    async function openPositionFlow({ sourceName, targetName }) {
        const sourcePosition = {
            id: 'POS-h2-source', name: sourceName, active: true, projectId: P1.id
        };
        const targetPosition = {
            id: 'POS-h2-target', name: targetName, active: true, projectId: P2.id
        };
        const employee = validEmployee({
            id: 'emp-h2-position', projectId: 'PRJ-h2-missing', positions: [sourcePosition.id]
        });
        state.employees = [employee];
        state.positions = [sourcePosition, targetPosition];
        state.attendance = {};

        await openProjectReconciliation();
        const map = document.querySelector('input[name="r07-recon-action"][value="map"]');
        map.checked = true;
        map.dispatchEvent(new Event('change', { bubbles: true }));
        const projectSelect = document.querySelector('[data-r07-control="target-project"]');
        projectSelect.value = P2.id;
        projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    test('H1 keyboard activation of Crear puesto similar restores focus inside the same dialog', async () => {
        await openPositionFlow({ sourceName: 'Albañil origen', targetName: 'Albañil destino' });
        const button = document.querySelector('[data-r07-action="create-similar-position"]');
        button.focus();
        button.click();

        expect(document.querySelector('[role="dialog"]').contains(document.activeElement)).toBe(true);
        expect(document.activeElement).not.toBe(document.body);
        expect(document.activeElement.matches('[data-r07-position-target], [data-r07-action="apply"]')).toBe(true);
    });

    test('H1 keyboard activation of Usar este puesto restores focus inside the same dialog', async () => {
        await openPositionFlow({ sourceName: 'Albañil', targetName: 'Albañil' });
        const button = document.querySelector('[data-r07-action="use-equivalent-position"]');
        button.focus();
        button.click();

        expect(document.querySelector('[role="dialog"]').contains(document.activeElement)).toBe(true);
        expect(document.activeElement).not.toBe(document.body);
        expect(document.activeElement.matches('[data-r07-position-target], [data-r07-action="apply"]')).toBe(true);
    });

    test('H2/C1 preflight accounts for selected orphan attendance and preserves valid other-project history without claiming the employee moves', async () => {
        const employee = validEmployee();
        const orphan = orphanAttendance(employee.id, '2026-09-20');
        const historical = orphanAttendance(employee.id, '2026-09-19', P3.id);
        state.employees = [employee];
        state.attendance = {
            [orphan.key]: orphan,
            [historical.key]: historical
        };

        await openProjectReconciliation();
        const map = document.querySelector('input[name="r07-recon-action"][value="map"]');
        map.checked = true;
        map.dispatchEvent(new Event('change', { bubbles: true }));
        const projectSelect = document.querySelector('[data-r07-control="target-project"]');
        projectSelect.value = P2.id;
        projectSelect.dispatchEvent(new Event('change', { bubbles: true }));

        const summary = document.querySelector('.r07-preflight-summary');
        expect(summary.textContent).toMatch(/1 asistencia huérfana.*se asociará/i);
        expect(summary.textContent).toMatch(/1 asistencia válida en otras obras.*se conservará/i);
        expect(summary.textContent).not.toContain('Asignar las personas seleccionadas');
        expect(summary.textContent).toContain('2026-09-20');
        expect(summary.textContent).toContain('2026-09-19');
    });

    test('H3 close after a trigger replacement restores focus to the connected current trigger', async () => {
        const oldTrigger = document.createElement('button');
        oldTrigger.type = 'button';
        oldTrigger.dataset.appFn = 'openProjectReconciliation';
        oldTrigger.textContent = 'Revisar antigua';
        document.body.appendChild(oldTrigger);
        oldTrigger.focus();

        await openProjectReconciliation();
        const currentTrigger = document.createElement('button');
        currentTrigger.type = 'button';
        currentTrigger.dataset.appFn = 'openProjectReconciliation';
        currentTrigger.textContent = 'Revisar actual';
        window.render = jest.fn(() => oldTrigger.replaceWith(currentTrigger));
        window.render();

        expect(oldTrigger.isConnected).toBe(false);
        expect(currentTrigger.isConnected).toBe(true);

        closeProjectReconciliation();
        await new Promise(resolve => setTimeout(resolve, 350));

        expect(document.activeElement).toBe(currentTrigger);
    });

    test('C4 service: attendance-only repair preserves valid employee position and leader even if a target remap is supplied', async () => {
        const sourcePosition = { id: 'POS-h2-stable-source', name: 'Albañil A', active: true, projectId: P1.id };
        const targetPosition = { id: 'POS-h2-stable-target', name: 'Albañil B', active: true, projectId: P2.id };
        const sourceLeader = { id: 'LEAD-h2-stable-source', name: 'Líder A', active: true, projectId: P1.id };
        const employee = validEmployee({
            id: 'emp-h2-attendance-only-position',
            positions: [sourcePosition.id],
            positionId: sourcePosition.id,
            leaderId: sourceLeader.id
        });
        const attendance = orphanAttendance(employee.id, '2026-09-22');
        stateManager.setState({
            employees: [employee], positions: [sourcePosition, targetPosition], leaders: [sourceLeader],
            attendance: { [attendance.key]: attendance }
        }, { silent: true });
        await db.update('employees', employee);
        await db.update('positions', sourcePosition);
        await db.update('positions', targetPosition);
        await db.update('leaders', sourceLeader);
        await db.update('attendance', attendance);

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [employee],
            allEmployees: [employee],
            attendance: { [attendance.key]: attendance },
            catalog: [P1, P2, P3],
            targetProjectId: P2.id,
            positionRemaps: [{
                employeeId: employee.id,
                fromPositionId: sourcePosition.id,
                toPositionId: targetPosition.id,
                migrateHistory: false
            }],
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        const durableEmployee = (await db.getAll('employees')).find(row => row.id === employee.id);
        const durableAttendance = (await db.getAll('attendance')).find(row => row.key === attendance.key);
        expect(durableEmployee.projectId).toBe(P1.id);
        expect(durableEmployee.positions).toEqual([sourcePosition.id]);
        expect(durableEmployee.positionId).toBe(sourcePosition.id);
        expect(durableEmployee.leaderId).toBe(sourceLeader.id);
        expect(durableAttendance.projectId).toBe(P2.id);
        const ramEmployee = stateManager._state.employees.find(row => row.id === employee.id);
        expect(ramEmployee.projectId).toBe(P1.id);
        expect(ramEmployee.positions).toEqual([sourcePosition.id]);
        expect(ramEmployee.positionId).toBe(sourcePosition.id);
        expect(ramEmployee.leaderId).toBe(sourceLeader.id);
    });

    test('C4 UI: attendance-only row does not request a destination position remap', async () => {
        const sourcePosition = { id: 'POS-h2-ui-source', name: 'Albañil A', active: true, projectId: P1.id };
        const targetPosition = { id: 'POS-h2-ui-target', name: 'Albañil B', active: true, projectId: P2.id };
        const employee = validEmployee({
            id: 'emp-h2-ui-attendance-only',
            positions: [sourcePosition.id],
            positionId: sourcePosition.id
        });
        const attendance = orphanAttendance(employee.id, '2026-09-22');
        state.employees = [employee];
        state.positions = [sourcePosition, targetPosition];
        state.leaders = [];
        state.attendance = { [attendance.key]: attendance };

        await openProjectReconciliation();
        const map = document.querySelector('input[name="r07-recon-action"][value="map"]');
        map.checked = true;
        map.dispatchEvent(new Event('change', { bubbles: true }));
        const projectSelect = document.querySelector('[data-r07-control="target-project"]');
        projectSelect.value = P2.id;
        projectSelect.dispatchEvent(new Event('change', { bubbles: true }));

        expect(document.querySelector('[data-r07-position-target]')).toBeNull();
        expect(document.querySelector('[data-r07-action="create-similar-position"]')).toBeNull();
        const apply = document.querySelector('[data-r07-action="apply"]');
        expect(apply).toBeTruthy();
        expect(apply.disabled).toBe(false);
        expect(document.querySelector('.r07-preflight-summary').textContent).not.toMatch(/Puesto:/i);
    });


    test('C4 service: attendance-only repair succeeds without target dependency remaps and preserves employee relations', async () => {
        const sourcePosition = { id: 'POS-h2-stable-noremap', name: 'Capataz A', active: true, projectId: P1.id };
        const sourceLeader = { id: 'LEAD-h2-stable-noremap', name: 'Líder A', active: true, projectId: P1.id };
        const employee = validEmployee({
            id: 'emp-h2-attendance-only-noremap',
            positions: [sourcePosition.id], positionId: sourcePosition.id, leaderId: sourceLeader.id
        });
        const attendance = orphanAttendance(employee.id, '2026-09-23');
        stateManager.setState({
            employees: [employee], positions: [sourcePosition], leaders: [sourceLeader],
            attendance: { [attendance.key]: attendance }
        }, { silent: true });
        await db.update('employees', employee);
        await db.update('positions', sourcePosition);
        await db.update('leaders', sourceLeader);
        await db.update('attendance', attendance);

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [employee], allEmployees: [employee],
            attendance: { [attendance.key]: attendance }, catalog: [P1, P2, P3],
            targetProjectId: P2.id, positionRemaps: [], _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        const durableEmployee = (await db.getAll('employees')).find(row => row.id === employee.id);
        const durableAttendance = (await db.getAll('attendance')).find(row => row.key === attendance.key);
        expect(durableEmployee.projectId).toBe(P1.id);
        expect(durableEmployee.positions).toEqual([sourcePosition.id]);
        expect(durableEmployee.positionId).toBe(sourcePosition.id);
        expect(durableEmployee.leaderId).toBe(sourceLeader.id);
        expect(durableAttendance.projectId).toBe(P2.id);
    });

});

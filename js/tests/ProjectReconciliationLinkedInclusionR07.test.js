/**
 * PR #171 follow-up: explicit inclusion of linked catalog relations.
 *
 * The wizard captures the parameters sent by the UI and replays them through
 * the real durable repair so the UI contract and the transaction agree.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import * as repair from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { openProjectReconciliation, closeProjectReconciliation, registerProjectReconciliationGlobals }
    from '../modules/features/projects/ProjectReconciliationUI.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

const project = { id: 'PRJ-link', name: 'Obra Norte', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const other = { id: 'PRJ-other', name: 'Obra Sur', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const realApply = repair.applyOwnershipRepair;
const change = (selector, value) => {
    const input = document.querySelector(selector);
    if (input.type === 'radio' || input.type === 'checkbox') input.checked = value;
    else input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
};
const click = action => document.querySelector('[data-r07-action="' + action + '"]').click();
const visibleStep = () => document.querySelector('[data-r07-step]:not([hidden])').dataset.r07Step;
const blocker = () => document.querySelector('[data-r07-step]:not([hidden]) .r07-recon-blocker');
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

async function durableReplay(params) {
    const db = new IndexedDBService('r07-linked-' + Math.random());
    await db.init();
    for (const item of [project, other]) await db.update('projects', item);
    for (const employee of state.employees) await db.update('employees', employee);
    for (const position of state.positions) await db.update('positions', position);
    for (const leader of state.leaders) await db.update('leaders', leader);
    for (const [key, record] of Object.entries(state.attendance)) await db.update('attendance', { key, ...record });
    const result = await realApply({ ...params, _db: db });
    const read = async store => (await db.getAll(store)).sort((a, b) => String(a.id || a.key).localeCompare(String(b.id || b.key)));
    const out = { result, employees: await read('employees'), positions: await read('positions'),
        leaders: await read('leaders'), attendance: await read('attendance') };
    db.db.close();
    return out;
}

async function openMapWizard() {
    await openProjectReconciliation();
    change('[name="r07-recon-action"][value="map"]', true);
    change('[data-r07-control="target-project"]', project.id);
    click('wizard-next');
}

describe('linked relation inclusion', () => {
    let setup, apply, cashRead;
    beforeEach(() => {
        document.body.innerHTML = '';
        cashRead = jest.spyOn(indexedDBService, 'getAll').mockResolvedValue([]);
        setProjectsEnabled(true);
        setup = jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true, ready: true, activeProjectId: project.id, defaultProjectId: project.id, projects: [project, other]
        });
        apply = jest.spyOn(repair, 'applyOwnershipRepair').mockResolvedValue({ status: repair.REPAIR_STATUS.OK });
        state.employees = [{ id: 'emp-a', number: '1', name: 'Ana', positions: ['pos-a'], leaderId: 'lead-a',
            loans: [{ id: 'loan-a', amount: 500, payments: [{ id: 'pay-a', amount: 100, payrollClosureId: 'PAYROLL-CLOSURE-old' }] }] },
        { id: 'emp-o', number: '9', name: 'Otra obra', positions: ['pos-o'], projectId: other.id }];
        state.positions = [{ id: 'pos-a', name: 'Ayudante', leaderId: 'lead-a' },
            { id: 'pos-o', name: 'Chofer', projectId: other.id }];
        state.leaders = [{ id: 'lead-a', name: 'Pedro', active: true }];
        state.attendance = {
            'emp-a-2026-09-01': { employeeId: 'emp-a', date: '2026-09-01', selectedPosition: 'pos-a', hours: 8, specialSalary: 1200 },
            'emp-o-2026-09-01': { employeeId: 'emp-o', date: '2026-09-01', selectedPosition: 'pos-o', hours: 8, projectId: other.id },
            'missing-2026-09-01': { employeeId: 'emp-missing', date: '2026-09-01', hours: 4 }
        };
        registerProjectReconciliationGlobals();
    });
    afterEach(() => {
        closeProjectReconciliation();
        cashRead.mockRestore();
        setup.mockRestore();
        apply.mockRestore();
    });

    test('shared leader + omitted empty position: explicit inclusion commits durably and preserves history', async () => {
        state.positions.push({ id: 'pos-b', name: 'Varilla', leaderId: 'lead-a' });
        const before = JSON.parse(JSON.stringify(state));
        await openMapWizard();
        click('wizard-next'); click('assign-source-leader');
        click('wizard-next'); click('assign-source-position');
        expect(blocker().textContent).toContain('Varilla');
        blocker().querySelector('[data-r07-action="include-linked-relation"]').click();
        click('wizard-next');
        expect(visibleStep()).toBe('4');
        click('apply');
        await flush();
        const params = apply.mock.calls[0][0];
        expect(params.positionIds).toEqual(expect.arrayContaining(['pos-a', 'pos-b']));

        const out = await durableReplay(params);
        expect(out.result.status).toBe(repair.REPAIR_STATUS.OK);
        const byId = list => Object.fromEntries(list.map(item => [item.id || item.key, item]));
        const employees = byId(out.employees), positions = byId(out.positions), attendance = byId(out.attendance);
        expect(employees['emp-a']).toMatchObject({ projectId: project.id, leaderId: 'lead-a', loans: before.employees[0].loans });
        expect(positions['pos-b'].projectId).toBe(project.id);
        expect(byId(out.leaders)['lead-a'].projectId).toBe(project.id);
        expect(attendance['emp-a-2026-09-01']).toMatchObject({ hours: 8, specialSalary: 1200, selectedPosition: 'pos-a' });
        // Other works and attendance without a known employee stay byte-identical.
        expect(employees['emp-o']).toEqual(before.employees[1]);
        expect(positions['pos-o']).toEqual(before.positions[1]);
        expect(attendance['emp-o-2026-09-01']).toEqual({ key: 'emp-o-2026-09-01', ...before.attendance['emp-o-2026-09-01'] });
        expect(attendance['missing-2026-09-01']).toEqual({ key: 'missing-2026-09-01', ...before.attendance['missing-2026-09-01'] });
    });

    test.each([other.id, ' ' + other.id + ' '])('a position owned by a valid work (%p) is never offered for inclusion', async projectId => {
        state.positions.push({ id: 'pos-b', name: 'Puesto ajeno', leaderId: 'lead-a', projectId });
        await openMapWizard();
        click('wizard-next'); click('assign-source-leader');
        click('wizard-next'); click('assign-source-position');
        expect(blocker().textContent).toContain('Puesto ajeno');
        expect(blocker().querySelector('[data-r07-action="include-linked-relation"]')).toBeNull();
        expect(document.querySelector('[data-r07-action="wizard-next"]').disabled).toBe(true);
        expect(apply).not.toHaveBeenCalled();
    });

    test('including a person with an unresolved leader returns to the leader step instead of detaching it', async () => {
        state.employees.push({ id: 'emp-b', number: '2', name: 'Luis', positions: ['pos-a'], leaderId: 'lead-b' });
        state.leaders.push({ id: 'lead-b', name: 'Marta', active: true });
        await openMapWizard();
        change('[data-r07-select="emp-b"]', false);
        click('wizard-next'); click('assign-source-leader');
        click('wizard-next'); click('assign-source-position');
        expect(blocker().textContent).toContain('2 · Luis');
        blocker().querySelector('[data-r07-action="include-linked-relation"]').click();

        expect(visibleStep()).toBe('2');
        expect(document.querySelector('.r07-recon-footer-hint').textContent).toContain('Resuelve los líderes');
        expect(document.querySelector('[data-r07-action="wizard-next"]').disabled).toBe(true);
        expect(document.querySelector('[data-r07-step="2"]').textContent).toContain('Marta');
        expect(apply).not.toHaveBeenCalled();

        document.querySelector('[data-r07-action="assign-source-leader"][data-leader-id="lead-b"]').click();
        click('wizard-next'); click('wizard-next');
        expect(visibleStep()).toBe('4');
        click('apply');
        await flush();
        const params = apply.mock.calls[0][0];
        expect(params.employees.map(employee => employee.id).sort()).toEqual(['emp-a', 'emp-b']);
        expect(params.leaderIds).toEqual(expect.arrayContaining(['lead-a', 'lead-b']));

        const out = await durableReplay(params);
        expect(out.result.status).toBe(repair.REPAIR_STATUS.OK);
        expect(out.result.detachedLeaders).toEqual([]);
        expect(out.employees.find(employee => employee.id === 'emp-b')).toMatchObject({ projectId: project.id, leaderId: 'lead-b' });
    });
});

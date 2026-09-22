/**
 * ProjectReconciliationDirectionUIR07.test.js — R07 Phase B (UI behavioral)
 *
 * Covers the Direction addendum at the rendered-DOM level:
 *   1. "Resolver más tarde" is a true no-op (byte-equivalence across state).
 *   2. MAP flow offers an inline "Crear puesto similar" that never exits the
 *      reconciliation modal or switches project context.
 *   3. Duplicate guard suggests an equivalent existing destination position.
 *   4. CREATE flow exposes inline position resolution too.
 *   5. Preflight human summary ("Se actualizará / Se conservará /
 *      Se desvinculará") renders before confirm.
 */
import 'fake-indexeddb/auto';
import { state, stateManager } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import {
    openProjectReconciliation,
    closeProjectReconciliation,
    registerProjectReconciliationGlobals
} from '../modules/features/projects/ProjectReconciliationUI.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const P1 = { id: 'PRJ-dir-source', name: 'Obra Origen', status: 'active' };
const P2 = { id: 'PRJ-dir-target', name: 'Obra Destino', status: 'active' };

function orphan(id, number, extra = {}) {
    return { id, number: String(number), name: 'Persona ' + number, active: true, positions: [], loans: [], projectId: 'PRJ-missing-999', ...extra };
}

describe('ProjectReconciliationDirectionUIR07', () => {
    let getStateSpy;
    let db;

    beforeEach(async () => {
        setProjectsEnabled(true);
        registerProjectReconciliationGlobals();
        db = new IndexedDBService('r07-direction-ui-' + Math.random());
        await db.init();
        getStateSpy = jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true,
            ready: true,
            activeProjectId: P1.id,
            defaultProjectId: P1.id,
            activeProject: P1,
            projects: [P1, P2]
        });
    });

    afterEach(() => {
        closeProjectReconciliation();
        getStateSpy?.mockRestore();
        try { db?.db?.close(); } catch (_) {}
        document.body.innerHTML = '';
        delete window.showNotification;
    });

    async function dumpDurableState() {
        const stores = ['employees', 'attendance', 'positions', 'loans', 'settings'];
        const dump = {};
        for (const store of stores) {
            if (store === 'loans' && !db.db.objectStoreNames.contains(store)) {
                dump[store] = (dump.employees || []).flatMap(employee =>
                    (Array.isArray(employee?.loans) ? employee.loans : []).map(loan => ({
                        employeeId: employee.id,
                        ...loan
                    }))
                );
            } else {
                dump[store] = db.db.objectStoreNames.contains(store)
                    ? await db.getAll(store)
                    : [];
            }
        }
        return dump;
    }

    function pickAction(value) {
        const radio = document.querySelector('input[name="r07-recon-action"][value="' + value + '"]');
        expect(radio).toBeTruthy();
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function selectTargetProject(projectId) {
        const select = document.querySelector('[data-r07-control="target-project"]');
        expect(select).toBeTruthy();
        select.value = projectId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    test('Resolver más tarde is a true no-op (byte-equivalence across all stores)', async () => {
        const emp = { id: 'emp-dir-later', number: '34', name: 'Andres', active: true, positions: [], loans: [{ id: 'loan-1', balance: 275 }], projectId: 'PRJ-missing-999' };
        const attKey = emp.id + '-2026-09-18';
        state.employees = [emp];
        state.attendance = {
            [attKey]: { key: attKey, employeeId: emp.id, date: '2026-09-18', present: true, projectId: 'PRJ-missing-999' }
        };
        state.positions = [{ id: 'POS-dir', name: 'Albañil', active: true, projectId: P1.id }];
        state.leaders = [{ id: 'LEAD-dir', name: 'Líder', active: true, projectId: P1.id }];
        state.settings = { ...(state.settings || {}), companyName: 'Mi Obra' };
        await db.update('employees', emp);
        await db.update('attendance', state.attendance[attKey]);
        await db.update('positions', state.positions[0]);
        await db.update('settings', { ...state.settings, key: 'app' });
        window.showNotification = jest.fn();

        await openProjectReconciliation();

        const capture = () => JSON.stringify({
            employees: stateManager._state.employees,
            attendance: stateManager._state.attendance,
            positions: stateManager._state.positions,
            leaders: stateManager._state.leaders,
            settings: stateManager._state.settings
        });
        const before = capture();
        const durableBefore = await dumpDurableState();

        pickAction('later');
        const apply = document.querySelector('[data-r07-action="apply"]');
        expect(apply.disabled).toBe(false);
        apply.click();

        expect(capture()).toBe(before);
        expect(await dumpDurableState()).toEqual(durableBefore);
        expect(window.showNotification).toHaveBeenCalledWith(
            'La selección se mantuvo pendiente para revisarla después.',
            'success'
        );
    });

    test('map flow offers inline "Crear puesto similar" and never exits the modal', async () => {
        const oldPos = { id: 'POS-dir-old', name: 'Albañil origen', active: true, projectId: P1.id, hourlyRate: 120 };
        state.employees = [orphan('emp-dir-copy', 34, {
            positions: [oldPos.id],
            positionSalaries: { [oldPos.id]: 150 }
        })];
        state.positions = [oldPos];
        state.leaders = [];
        state.attendance = {};

        await openProjectReconciliation();
        pickAction('map');
        selectTargetProject(P2.id);

        const createSimilar = document.querySelector('[data-r07-action="create-similar-position"]');
        expect(createSimilar).toBeTruthy();
        createSimilar.click();

        // Modal stays open (no exit / project-context switch).
        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
        expect(document.querySelector('.r07-position-remap').textContent).toContain('Se creará');

        const apply = document.querySelector('[data-r07-action="apply"]');
        expect(apply.disabled).toBe(false);
    });

    test('duplicate guard suggests an equivalent existing destination position instead of creating one', async () => {
        const sourcePos = { id: 'POS-dir-same', name: 'Albañil', active: true, projectId: P1.id, hourlyRate: 120 };
        const equivPos = { id: 'POS-dir-equiv', name: 'Albañil', active: true, projectId: P2.id, hourlyRate: 130 };
        state.employees = [orphan('emp-dir-equiv', 34, {
            positions: [sourcePos.id],
            positionSalaries: { [sourcePos.id]: 150 }
        })];
        state.positions = [sourcePos, equivPos];
        state.leaders = [];
        state.attendance = {};

        await openProjectReconciliation();
        pickAction('map');
        selectTargetProject(P2.id);

        expect(document.querySelector('[data-r07-action="use-equivalent-position"]')).toBeTruthy();
        expect(document.querySelector('[data-r07-action="create-similar-position"]')).toBeNull();
        expect(document.querySelector('.r07-position-remap').textContent).toContain('Ya existe un puesto equivalente');
    });

    test('create flow exposes inline position copy resolution', async () => {
        const oldPos = { id: 'POS-dir-create-old', name: 'Albañil origen', active: true, projectId: P1.id, hourlyRate: 120 };
        state.employees = [orphan('emp-dir-create', 34, {
            positions: [oldPos.id],
            positionSalaries: { [oldPos.id]: 150 }
        })];
        state.positions = [oldPos];
        state.leaders = [];
        state.attendance = {};

        await openProjectReconciliation();
        pickAction('create');

        const nameInput = document.querySelector('#r07-create-project-name');
        nameInput.value = 'Obra nueva';
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));

        expect(document.querySelector('.r07-position-remap')).toBeTruthy();
        const createSimilar = document.querySelector('[data-r07-action="create-similar-position"]');
        expect(createSimilar).toBeTruthy();
        createSimilar.click();

        expect(document.querySelector('[data-r07-action="apply"]').disabled).toBe(false);
    });

    test('creates one queued similar position for multiple selected employees', async () => {
        const oldPos = { id: 'POS-dir-batch-old', name: 'Albañil origen', active: true, projectId: P1.id, hourlyRate: 120 };
        state.employees = [
            orphan('emp-dir-batch-1', 34, { positions: [oldPos.id] }),
            orphan('emp-dir-batch-2', 35, { positions: [oldPos.id] })
        ];
        state.positions = [oldPos];
        state.leaders = [];
        state.attendance = {};

        await openProjectReconciliation();
        pickAction('map');
        selectTargetProject(P2.id);

        let createButtons = [...document.querySelectorAll('[data-r07-action="create-similar-position"]')];
        expect(createButtons).toHaveLength(2);
        createButtons[0].click();
        createButtons = [...document.querySelectorAll('[data-r07-action="create-similar-position"]')];
        expect(createButtons).toHaveLength(1);
        createButtons[0].click();

        const summary = document.querySelector('.r07-preflight-summary');
        const updateList = summary.querySelector('.r07-preflight-section ul');
        expect(updateList.textContent.match(/Se creará/g)).toHaveLength(1);
    });

    test('preflight summary renders Se actualizará / Se conservará / Se desvinculará before confirm', async () => {
        const otherLeader = { id: 'LEAD-dir-other', name: 'Líder otra obra', active: true, projectId: P1.id };
        state.employees = [orphan('emp-dir-summary', 34, { leaderId: otherLeader.id })];
        state.positions = [];
        state.leaders = [otherLeader];
        state.attendance = {};

        await openProjectReconciliation();
        pickAction('map');
        selectTargetProject(P2.id);

        const summary = document.querySelector('.r07-preflight-summary');
        expect(summary).toBeTruthy();
        expect(summary.textContent).toContain('Resumen antes de confirmar');
        expect(summary.textContent).toContain('Obra destino');
        expect(summary.textContent).toContain('Obra Destino');
        expect(summary.textContent).toContain('Se actualizará');
        expect(summary.textContent).toContain('Se conservará');
        expect(summary.textContent).toContain('préstamos');
        expect(summary.textContent).toContain('Se desvinculará');
        expect(summary.textContent).toContain('Líder otra obra');
    });

    test('preflight summary identifies an inactive same-project leader as detached', async () => {
        const inactiveLeader = { id: 'LEAD-dir-inactive', name: 'Líder inactivo', active: false, projectId: P2.id };
        state.employees = [orphan('emp-dir-inactive', 34, { leaderId: inactiveLeader.id })];
        state.positions = [];
        state.leaders = [inactiveLeader];
        state.attendance = {};

        await openProjectReconciliation();
        pickAction('map');
        selectTargetProject(P2.id);

        const summary = document.querySelector('.r07-preflight-summary');
        expect(summary.textContent).toContain('Se desvinculará');
        expect(summary.textContent).toContain('Líder inactivo (líder inactivo)');
    });
});

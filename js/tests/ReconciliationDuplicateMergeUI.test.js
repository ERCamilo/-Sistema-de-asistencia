/**
 * En «Datos pendientes de asignación», un pendiente que es la misma persona que
 * un empleado ya asignado se ofrece para fusionar (con confirmación), en vez de
 * asignarlo como otra ficha.
 */
import indexedDBService from '../modules/services/IndexedDBService.js';
import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import * as duplicates from '../modules/features/employees/EmployeeDuplicateService.js';
import { openProjectReconciliation, closeProjectReconciliation, registerProjectReconciliationGlobals }
    from '../modules/features/projects/ProjectReconciliationUI.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

const project = { id: 'PRJ-dup-main', name: 'Mi obra 1', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const change = (selector, value) => {
    const input = document.querySelector(selector);
    if (input.type === 'radio' || input.type === 'checkbox') input.checked = value;
    else input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
const q = selector => document.querySelector(selector);

describe('fusión de duplicados en el asistente', () => {
    let merge, save, del;
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.spyOn(indexedDBService, 'getAll').mockResolvedValue([]);
        setProjectsEnabled(true);
        jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true, ready: true, activeProjectId: project.id, defaultProjectId: project.id, projects: [project]
        });
        merge = jest.spyOn(duplicates, 'mergeDuplicateEmployees').mockImplementation(({ duplicateIds }) => {
            state.employees = state.employees.filter(employee => !duplicateIds.includes(employee.id));
            return { merged: duplicateIds.length, skipped: [] };
        });
        save = jest.spyOn(duplicates, 'persistDuplicateResolution').mockResolvedValue(0);
        del = null;
        state.employees = [
            { id: 'v-028', number: '028', name: 'Mathieu Dormeus', projectId: project.id, active: true },
            { id: 'p-028', number: '028', name: 'Mathieu  Dormeus', projectId: 'PRJ-no-existe', active: true },
            { id: 'p-500', number: '500', name: 'Héctor excavadora', projectId: 'PRJ-no-existe', active: true }
        ];
        state.positions = [];
        state.leaders = [];
        state.attendance = { 'v-028-2026-09-01': { employeeId: 'v-028', date: '2026-09-01', projectId: project.id } };
        registerProjectReconciliationGlobals();
    });
    afterEach(() => { closeProjectReconciliation(); jest.restoreAllMocks(); });

    test('sugiere, pide confirmación y fusiona en el empleado que ya está en la obra', async () => {
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="map"]', true);
        change('[data-r07-control="target-project"]', project.id);
        expect(q('[data-r07-step="0"]').textContent).toContain('parecen duplicados');
        q('[data-r07-action="wizard-next"]').click();

        const hint = q('.r07-recon-duplicate');
        expect(hint.textContent).toContain('Posible duplicado de');
        expect(hint.textContent).toContain('#028 Mathieu Dormeus');
        // Solo el que coincide; el #500 no tiene par.
        expect(document.querySelectorAll('.r07-recon-duplicate')).toHaveLength(1);

        q('[data-r07-action="merge-duplicate"]').click();
        expect(merge).not.toHaveBeenCalled();
        expect(q('.r07-recon-merge-confirm').textContent).toContain('no se puede deshacer');

        q('[data-r07-action="confirm-merge"]').click();
        await flush();
        expect(merge).toHaveBeenCalledWith({ masterId: 'v-028', duplicateIds: ['p-028'] });
        expect(save).toHaveBeenCalled();
        expect(q('.r07-recon-message').textContent).toContain('1 empleado(s) duplicado(s) fusionado(s)');
        // El pendiente fusionado desaparece; el otro sigue para asignar.
        const rows = [...document.querySelectorAll('[data-r07-select]')].map(input => input.dataset.r07Select);
        expect(rows).toEqual(['p-500']);
    });

    test('cancelar no fusiona nada', async () => {
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="map"]', true);
        change('[data-r07-control="target-project"]', project.id);
        q('[data-r07-action="wizard-next"]').click();
        q('[data-r07-action="merge-all-duplicates"]').click();
        q('[data-r07-action="cancel-merge"]').click();
        await flush();
        expect(merge).not.toHaveBeenCalled();
        expect(q('.r07-recon-merge-confirm')).toBeNull();
    });
});

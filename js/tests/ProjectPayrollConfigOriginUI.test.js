import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { inspectPayrollConfigOrigin, PAYROLL_CONFIG_ORIGIN_STATUS } from '../modules/features/projects/ProjectPayrollConfigOrigin.js';
import * as repair from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { registerProjectReconciliationGlobals, openProjectReconciliation,
    closeProjectReconciliation } from '../modules/features/projects/ProjectReconciliationUI.js';

const setup = { enabled: true, ready: true, activeProjectId: 'valid-project',
    defaultProjectId: 'valid-project',
    projects: [{ id: 'valid-project', name: 'Obra actual', status: 'active' }] };
const makeResult = status => ({ status, readOnly: true, projectId: 'orphan-config-reference' });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Verificar origen de configuración de nómina desde el solucionador', () => {
    beforeEach(() => {
        registerProjectReconciliationGlobals();
        setProjectsEnabled(true);
        document.body.innerHTML = '';
        state.employees = []; state.positions = []; state.leaders = []; state.attendance = {};
        jest.spyOn(projectSetupService, 'getState').mockResolvedValue(setup);
        jest.spyOn(indexedDBService, 'getAll').mockImplementation(async store =>
            store === 'projectPayrollConfigs' ? [{ projectId: 'orphan-config-reference', regularHoursPerDay: 8 }] : []);
    });
    afterEach(() => {
        closeProjectReconciliation();
        jest.restoreAllMocks();
    });

    test('muestra referencia en sesión local y un botón específico de verificación, sin cambios', async () => {
        await openProjectReconciliation();
        expect(document.body.textContent).toContain('Configuraciones de nómina');
        const button = document.querySelector('[data-r07-action="verify-config-origin"]');
        expect(button).not.toBeNull();
        expect(button.dataset.r07ConfigOriginId).toBe('orphan-config-reference');
        expect(document.body.textContent).toContain('orphan-config-reference');
        const applyButton = document.querySelector('[data-r07-action="apply"]');
        expect(applyButton === null || applyButton.hidden || applyButton.disabled).toBe(true);
    });

    test('tras verificar, informa que la obra existe en Firebase y no modifica configuración', async () => {
        const read = jest.spyOn(
            require('../modules/features/projects/ProjectPayrollConfigOrigin.js'), 'inspectPayrollConfigOrigin'
        ).mockResolvedValue(makeResult(PAYROLL_CONFIG_ORIGIN_STATUS.REMOTE_PROJECT));
        const write = jest.spyOn(indexedDBService, 'update');
        await openProjectReconciliation();
        document.querySelector('[data-r07-action="verify-config-origin"]').click();
        await flush(); await flush();
        expect(read).toHaveBeenCalledWith(expect.objectContaining({
            projectId: 'orphan-config-reference',
            localProjects: setup.projects
        }));
        expect(document.body.textContent).toContain('existe en Firebase');
        expect(document.body.textContent).toContain('no reasignes');
        expect(write).not.toHaveBeenCalled();
    });

    test('recuperar una configuración vuelve a verificar en Firebase y BLOQUEA escrituras si la obra existe', async () => {
        const read = jest.spyOn(
            require('../modules/features/projects/ProjectPayrollConfigOrigin.js'), 'inspectPayrollConfigOrigin'
        ).mockResolvedValue(makeResult(PAYROLL_CONFIG_ORIGIN_STATUS.REMOTE_PROJECT));
        const mutate = jest.spyOn(repair, 'applyOwnershipRepair').mockResolvedValue({ status: repair.REPAIR_STATUS.OK });
        await openProjectReconciliation();
        const map = document.querySelector('input[name="r07-recon-action"][value="map"]');
        expect(map).not.toBeNull();
        map.click();
        const select = document.querySelector('[data-r07-control="target-project"]');
        select.value = 'valid-project';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('[data-r07-action="wizard-next"]').click();
        const financial = document.querySelector('[data-r07-financial-recovery]');
        expect(financial).not.toBeNull();
        financial.click();
        const config = document.querySelector('[data-r07-financial-config]');
        expect(config).not.toBeNull();
        config.value = 'orphan-config-reference';
        config.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('[data-r07-action="wizard-next"]').click();
        const apply = document.querySelector('[data-r07-action="apply"]');
        expect(apply).not.toBeNull();
        expect(apply.disabled).toBe(false);
        apply.click();
        await flush(); await flush();
        expect(read).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'orphan-config-reference' }));
        expect(mutate).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('No se puede recuperar esta configuración de nómina');
    });

    test('la comprobación no se traslada a otro asistente si el usuario cierra y reabre', async () => {
        let resolveOld;
        const old = new Promise(resolve => { resolveOld = resolve; });
        jest.spyOn(
            require('../modules/features/projects/ProjectPayrollConfigOrigin.js'), 'inspectPayrollConfigOrigin'
        ).mockImplementation(() => old);
        await openProjectReconciliation();
        document.querySelector('[data-r07-action="verify-config-origin"]').click();
        closeProjectReconciliation();
        await openProjectReconciliation();
        resolveOld(makeResult(PAYROLL_CONFIG_ORIGIN_STATUS.NOT_FOUND));
        await flush(); await flush();
        expect(document.body.textContent).not.toContain('Firebase no encontró la obra');
    });
});

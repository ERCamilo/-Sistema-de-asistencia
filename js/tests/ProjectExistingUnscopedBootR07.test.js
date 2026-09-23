import fs from 'fs';
import path from 'path';
import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { indexedDBService } from '../modules/services/IndexedDBService.js';
import {
    refreshProjectReconciliationSnapshot,
    getProjectReconciliationSnapshot,
    renderProjectReconciliationBanner,
    renderProjectReconciliationSettingsAction,
    openProjectReconciliation,
    closeProjectReconciliation
} from '../modules/features/projects/ProjectReconciliationUI.js';

const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const A = { id: 'PRJ-A', name: 'Mi obra', status: 'active' };
const B = { id: 'PRJ-B', name: 'Obra 02', status: 'active' };

describe('R07 actualización normal de cuenta existente con empleados sin obra', () => {
    let getState;
    beforeEach(() => {
        setProjectsEnabled(true);
        localStorage.setItem('migration.projectStamp.v1', JSON.stringify({
            v: 1, done: { employees: true, positions: true, leaders: true, attendance: true }
        }));
        getState = jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true, defaultProjectId: A.id, activeProjectId: A.id, projects: [A, B]
        });
        state.employees = Array.from({ length: 57 }, (_, i) => ({
            id: 'emp-' + (i + 1), number: String(i + 1), name: 'Empleado ' + (i + 1),
            ...(i >= 55 ? { projectId: A.id } : {})
        }));
        state.positions = [];
        state.leaders = [];
        state.attendance = {};
    });
    afterEach(() => {
        closeProjectReconciliation();
        getState.mockRestore();
        localStorage.removeItem('migration.projectStamp.v1');
        document.body.innerHTML = '';
    });

    test('el boot local hidratado calcula snapshot antes del render inicial', () => {
        const start = appSource.indexOf('(async function initializeApp()');
        const boot = appSource.indexOf('await initProjectsInfrastructure();', start);
        const refresh = appSource.indexOf('await refreshProjectReconciliationSnapshot();', boot);
        const render = appSource.indexOf('// 6. Renderizado Inicial', boot);
        expect(boot).toBeGreaterThan(start);
        expect(refresh).toBeGreaterThan(boot);
        expect(refresh).toBeLessThan(render);
    });
    test('marker viejo y 55 empleados sin projectId muestran banner, ajustes y modal numérico sin escritura', async () => {
        const before = JSON.stringify(state.employees);
        const marker = localStorage.getItem('migration.projectStamp.v1');
        const batchWrite = jest.spyOn(indexedDBService, 'batchUpdate');
        const fullWrite = jest.spyOn(indexedDBService, 'saveState');
        const snapshot = await refreshProjectReconciliationSnapshot();
        expect(snapshot.pendingEmployeeCount).toBe(55);
        expect(snapshot.validEmployeeCount).toBe(2);
        expect(getProjectReconciliationSnapshot().employeeRows[0].employee.number).toBe('1');
        expect(renderProjectReconciliationBanner()).toMatch(/Revisar 55 problemas/);
        expect(renderProjectReconciliationSettingsAction()).toMatch(/55 empleados pendientes/);
        await openProjectReconciliation();
        const numbers = [...document.querySelectorAll('.r07-recon-person-title strong')]
            .map(node => Number(node.textContent));
        expect(numbers).toEqual(Array.from({ length: 55 }, (_, i) => i + 1));
        expect(JSON.stringify(state.employees)).toBe(before);
        expect(localStorage.getItem('migration.projectStamp.v1')).toBe(marker);
        expect(batchWrite).not.toHaveBeenCalled();
        expect(fullWrite).not.toHaveBeenCalled();
        batchWrite.mockRestore();
        fullWrite.mockRestore();
    });

    test('la primera carga cloud vuelve a calcular el snapshot antes de renderizar', () => {
        const apply = appSource.indexOf('async function applyRemoteData()');
        const initial = appSource.indexOf('if (isInitialLoad) {', apply);
        const refresh = appSource.lastIndexOf('await refreshProjectReconciliationSnapshot();', initial);
        expect(refresh).toBeGreaterThan(apply);
        expect(refresh).toBeLessThan(initial);
    });
});

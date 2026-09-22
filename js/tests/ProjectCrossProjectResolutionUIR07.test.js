import { state } from '../modules/core/AppState.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { PositionModal } from '../modules/ui/modals/PositionModal.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import {
    openProjectReconciliation,
    closeProjectReconciliation,
    registerProjectReconciliationGlobals,
    renderProjectReconciliationSettingsAction
} from '../modules/features/projects/ProjectReconciliationUI.js';

const P1 = { id: 'PRJ-cross-ui-1', name: 'Obra Uno', status: 'active' };
const P2 = { id: 'PRJ-cross-ui-2', name: 'Obra Dos', status: 'active' };

function positionFormHTML({ leaderId = 'LEAD-NEW' } = {}) {
    return `
        <input id="posName" value="Capataz">
        <input id="posHourlyRate" value="100">
        <input id="posSalaryMode" value="hourly">
        <select id="posLeader"><option value="${leaderId}" selected>Líder</option></select>
        <input id="posRestDayFactor" value="">
        <input type="radio" name="posColor" value="#3b82f6" checked>
        <input type="checkbox" name="workingDay" value="1" checked>
    `;
}
describe('ProjectCrossProjectResolutionUIR07', () => {
    let getStateSpy;
    let originalRaf;
    let saveSpy;

    beforeEach(() => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: P1.id, defaultProjectId: P1.id });
        originalRaf = global.requestAnimationFrame;
        global.requestAnimationFrame = cb => { cb(); return 1; };
        window.showAlert = jest.fn();
        window.openPuestosPersonal = jest.fn();
        window.openPositionForm = jest.fn();
        window.openProjectListModal = jest.fn();
        window.closeProjectListModal = jest.fn();
        window.getProjectSetupState = () => projectSetupService.getState();
        registerProjectReconciliationGlobals();

        state.settings = { ...(state.settings || {}), regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2 };
        state.employees = [];
        state.attendance = {};
        state.leaders = [{ id: 'LEAD-NEW', number: '1', name: 'Líder nuevo', active: true, projectId: P1.id }];
        state.positions = [{
            id: 'POS-CROSS', name: 'Capataz', hourlyRate: 100, salaryInputMode: 'hourly',
            active: true, workingDays: [1], leaderId: null, projectId: P1.id,
            crossProjectLeaderId: 'LEAD-OLD', color: '#3b82f6'
        }];
        saveSpy = jest.fn();
        EmployeesUI.init({
            state,
            saveToLocalStorage: saveSpy,
            render: jest.fn(),
            closeModal: jest.fn(),
            services: {}
        });

        getStateSpy = jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true, ready: true,
            activeProjectId: P1.id, defaultProjectId: P1.id,
            activeProject: P1, projects: [P1]
        });
    });

    afterEach(() => {
        closeProjectReconciliation();
        resetEntityScope();
        getStateSpy?.mockRestore();
        global.requestAnimationFrame = originalRaf;
        document.body.innerHTML = '';
    });

    test('new position form makes the destination project explicit and offers the official switch path', async () => {
        const modal = PositionModal.open();
        await Promise.resolve();
        await Promise.resolve();

        const context = document.querySelector('.position-project-context');
        expect(context).toBeTruthy();
        expect(context.textContent).toContain('Obra Uno');
        expect(context.textContent).toContain('se guardará en esta obra');
        const switchButton = context.querySelector('[data-position-change-project]');
        expect(switchButton).toBeTruthy();
        expect(switchButton.textContent).toContain('Cambiar obra');
        modal.close();
    });

    test('editing an existing position shows its project but does not offer moving it between projects', async () => {
        const modal = PositionModal.open('POS-CROSS');
        await Promise.resolve();
        await Promise.resolve();

        const context = document.querySelector('.position-project-context');
        expect(context).toBeTruthy();
        expect(context.textContent).toContain('Obra Uno');
        expect(context.textContent).toContain('no se cambia desde este formulario');
        expect(context.querySelector('[data-position-change-project]')).toBeNull();
        modal.close();
    });

    test('position editor does not surface a blocking cross-project leader warning', () => {
        PositionModal.open('POS-CROSS');
        const warning = document.querySelector('.r07-position-cross-project-warning');
        expect(warning).toBeNull();
    });

    test('explicit position edit detaches the cross-project leader marker', () => {
        const el = document.createElement('div');
        el.innerHTML = positionFormHTML();
        const modal = { element: el, close: jest.fn() };
        const pos = state.positions[0];

        PositionModal.save(modal, pos);

        expect(pos.leaderId).toBe('LEAD-NEW');
        expect(Object.prototype.hasOwnProperty.call(pos, 'crossProjectLeaderId')).toBe(false);
        expect(modal.close).toHaveBeenCalled();
    });
});

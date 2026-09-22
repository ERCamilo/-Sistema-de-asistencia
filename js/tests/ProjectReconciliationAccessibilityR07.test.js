import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import {
    openProjectReconciliation,
    closeProjectReconciliation,
    renderProjectReconciliationBanner,
    renderProjectReconciliationSettingsAction,
    refreshProjectReconciliationSnapshot,
    registerProjectReconciliationGlobals
} from '../modules/features/projects/ProjectReconciliationUI.js';

/**
 * ProjectReconciliationAccessibilityR07 — BEHAVIORAL (rendered DOM) contract.
 * Does not rely on source-string checks: renders the real banner, settings entry
 * and local modal, then asserts dialog semantics, labelled controls, and that
 * Apply stays disabled until an explicit action is chosen.
 */
const P1 = { id: 'PRJ-a11y-1', name: 'Obra A11y', status: 'active' };

function pendingEmployee(id, number) {
    return { id, number: String(number), name: 'Empleado ' + number, active: true, projectId: 'PRJ-missing-999' };
}

describe('ProjectReconciliationAccessibilityR07', () => {
    let getStateSpy;

    beforeEach(() => {
        setProjectsEnabled(true);
        getStateSpy = jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true,
            ready: true,
            activeProjectId: P1.id,
            defaultProjectId: P1.id,
            activeProject: P1,
            projects: [P1]
        });
        state.employees = [pendingEmployee('emp-a11y-1', 34)];
        state.positions = [];
        state.leaders = [];
        state.attendance = {};
    });

    afterEach(() => {
        getStateSpy.mockRestore();
        closeProjectReconciliation();
        document.body.innerHTML = '';
    });

    test('banner renders an accessible labelled section with a Revisar button', async () => {
        await refreshProjectReconciliationSnapshot();
        document.body.innerHTML = renderProjectReconciliationBanner();

        const section = document.querySelector('.r07-recon-banner');
        expect(section).toBeTruthy();
        expect(section.getAttribute('aria-label')).toMatch(/1 empleado pendiente de asignación/i);
        expect(section.textContent).toContain('pendiente de asignación');

        const btn = section.querySelector('button[data-app-fn="openProjectReconciliation"]');
        expect(btn).toBeTruthy();
        expect(btn.type).toBe('button');
        expect(btn.textContent.trim()).toMatch(/^Revisar 1 problema$/);
    });

    test('settings entry renders the health action when pending exist', async () => {
        await refreshProjectReconciliationSnapshot();
        document.body.innerHTML = renderProjectReconciliationSettingsAction();

        const action = document.querySelector('[data-settings-action="open-project-reconciliation"]');
        expect(action).toBeTruthy();
        expect(action.tagName).toBe('BUTTON');
        expect(action.type).toBe('button');
        expect(action.textContent).toContain('pendiente de asignación');
    });

    test('local modal exposes dialog semantics and labelled controls', async () => {
        await openProjectReconciliation();

        const dialog = document.body.querySelector('[role="dialog"]');
        expect(dialog).toBeTruthy();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const titleId = dialog.getAttribute('aria-labelledby');
        expect(titleId).toBeTruthy();
        expect(document.getElementById(titleId).textContent).toContain('Pendientes de asignación');

        // Fieldset + legend group the explicit action choice.
        const fieldset = dialog.querySelector('fieldset');
        expect(fieldset).toBeTruthy();
        expect(fieldset.querySelector('legend').textContent).toContain('Elige');

        // Semantic checkboxes (person rows) and radios (map/create/later).
        expect(dialog.querySelectorAll('input[type="checkbox"][data-r07-select]').length).toBe(1);
        expect(dialog.querySelectorAll('input[type="radio"][name="r07-recon-action"]').length).toBe(3);

        // The footer only offers close + apply; apply is disabled until an
        // explicit action is chosen (no silent mapping).
        const apply = dialog.querySelector('[data-r07-action="apply"]');
        expect(apply).toBeTruthy();
        expect(apply.type).toBe('button');
        expect(apply.disabled).toBe(true);

        const close = dialog.querySelector('[data-r07-action="close"]');
        expect(close).toBeTruthy();
    });

    test('single selection offers safe handoff to Personal instead of duplicating destructive actions', async () => {
        const openPersonal = jest.fn();
        const openEditor = jest.fn();
        window.openEmpleadosPersonal = openPersonal;
        window.openEmployeeEditor = openEditor;
        window.requestAnimationFrame = callback => { callback(); return 1; };
        registerProjectReconciliationGlobals();

        await openProjectReconciliation();
        const dialog = document.body.querySelector('[role="dialog"]');
        const manage = dialog.querySelector('[data-r07-action="manage-person"]');

        expect(manage).toBeTruthy();
        expect(manage.textContent).toContain('Gestionar en Personal');
        expect(dialog.textContent).toContain('salvaguardas de historial, antigüedad y préstamos');

        manage.click();
        expect(openPersonal).toHaveBeenCalledTimes(1);
        expect(openEditor).toHaveBeenCalledWith('emp-a11y-1');

        delete window.openEmpleadosPersonal;
        delete window.openEmployeeEditor;
    });

    test('no native blocking dialogs are rendered or referenced', async () => {
        await openProjectReconciliation();
        const dialog = document.body.querySelector('[role="dialog"]');
        const html = dialog.outerHTML;
        expect(html).not.toMatch(/\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/);
    });

    function focusableIn(container) {
        const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
        return Array.from(container.querySelectorAll(selector));
    }

    test('Tab and Shift+Tab keep focus inside the reconciliation modal (focus trap)', async () => {
        await openProjectReconciliation();
        const dialog = document.body.querySelector('[role="dialog"]');
        const focusables = focusableIn(dialog);
        expect(focusables.length).toBeGreaterThan(0);

        // Tab from the last focusable must keep focus inside the dialog.
        const last = focusables[focusables.length - 1];
        last.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        expect(dialog.contains(document.activeElement)).toBe(true);

        // Shift+Tab from the first focusable must keep focus inside the dialog.
        focusables[0].focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    test('Escape closes the reconciliation modal and restores focus to the trigger', async () => {
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();

        await openProjectReconciliation();
        expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        // Wait for the modal exit timeout (300ms) that removes the DOM and restores focus.
        await new Promise(resolve => setTimeout(resolve, 350));

        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });
});

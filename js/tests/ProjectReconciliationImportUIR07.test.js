import {
    parkPendingFullImport,
    cancelFullImportProjectChoice,
    getPendingFullImport
} from '../modules/features/export/ExportController.js';
import {
    buildImportReconciliationViewModel,
    openImportReconciliation,
    closeImportReconciliation
} from '../modules/features/projects/ProjectReconciliationUI.js';

/**
 * ProjectReconciliationImportUIR07 — behavioral contract for the FULL-import
 * reconciliation modal (shared reconciliation UX in the import context).
 */
describe('ProjectReconciliationImportUIR07', () => {
    afterEach(() => {
        cancelFullImportProjectChoice();
        closeImportReconciliation();
        document.body.innerHTML = '';
    });

    test('buildImportReconciliationViewModel maps the pending payload', () => {
        expect(buildImportReconciliationViewModel(null)).toEqual({
            available: false,
            legacyUnscopedCount: 0,
            validProjects: []
        });

        const vm = buildImportReconciliationViewModel({
            legacyUnscopedCount: 5,
            validProjects: [{ id: 'A', name: 'Obra A' }, { id: 'B', name: 'Obra B' }],
            defaultProjectId: 'A'
        });
        expect(vm.available).toBe(true);
        expect(vm.legacyUnscopedCount).toBe(5);
        expect(vm.validProjects.map(p => p.id)).toEqual(['A', 'B']);
        expect(vm.defaultProjectId).toBe('A');
    });

    test('openImportReconciliation renders a dialog with one radio per valid project and Apply disabled until choice', () => {
        parkPendingFullImport(
            { employees: [] },
            [
                { id: 'PRJ-A', name: 'Obra A', status: 'active' },
                { id: 'PRJ-B', name: 'Obra B', status: 'active' }
            ],
            'PRJ-A',
            'MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS',
            { legacyUnscopedCount: 3 }
        );

        const modal = openImportReconciliation();
        expect(modal).toBeTruthy();

        const dialog = document.body.querySelector('[role="dialog"]');
        expect(dialog).toBeTruthy();
        expect(dialog.getAttribute('aria-modal')).toBe('true');

        const radios = dialog.querySelectorAll('input[type="radio"][name="r07-import-project"]');
        expect(radios.length).toBe(2);

        // Explicit choice required: Apply is disabled until a project is chosen.
        const apply = dialog.querySelector('[data-r07-import-action="apply"]');
        expect(apply).toBeTruthy();
        expect(apply.disabled).toBe(true);

        const cancel = dialog.querySelector('[data-r07-import-action="cancel"]');
        expect(cancel).toBeTruthy();
        expect(cancel.textContent).toContain('Cancelar importación');
    });

    test('openImportReconciliation with no pending returns null (no dialog)', () => {
        expect(openImportReconciliation()).toBeNull();
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });

    test('closing the import modal (X/Escape/backdrop) clears the pending payload', () => {
        parkPendingFullImport(
            { employees: [] },
            [{ id: 'PRJ-A', name: 'Obra A', status: 'active' }],
            'PRJ-A',
            'MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS',
            { legacyUnscopedCount: 1 }
        );
        expect(getPendingFullImport()).toBeTruthy();
        openImportReconciliation();
        closeImportReconciliation();
        expect(getPendingFullImport()).toBeNull();
    });

    test('selecting a project keeps focus inside the dialog after rerender', () => {
        parkPendingFullImport(
            { employees: [] },
            [
                { id: 'PRJ-A', name: 'Obra A', status: 'active' },
                { id: 'PRJ-B', name: 'Obra B', status: 'active' }
            ],
            'PRJ-A',
            'MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS',
            { legacyUnscopedCount: 3 }
        );
        openImportReconciliation();
        const dialog = document.body.querySelector('[role="dialog"]');
        const radio = dialog.querySelector('input[name="r07-import-project"][value="PRJ-A"]');
        radio.focus();
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        const active = document.activeElement;
        expect(active).toBeTruthy();
        expect(dialog.contains(active)).toBe(true);
        expect(active.name).toBe('r07-import-project');
    });
});

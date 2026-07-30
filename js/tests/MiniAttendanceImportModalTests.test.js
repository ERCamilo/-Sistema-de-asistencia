import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';

const employees = [
    { id: 'e1', number: '1', name: 'Ana Pérez', positions: ['p1'] }
];
const REPORT = '*Asistencia de hoy martes, 28 de julio* 001. Ana Perez *12h*';

function mounted(options = {}) {
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const controller = new MiniAttendanceImportModal({
        employees,
        proposedDate: '2026-07-28',
        regularLimit: 8,
        ...options
    });
    controller.mount(host);
    return { controller, host };
}

function input(element, value) {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

function analyze(host, source = REPORT) {
    input(host.querySelector('[data-mini-source]'), source);
    host.querySelector('[data-mini-action="analyze"]').click();
}

function expectStyledActions(host) {
    const actions = [...host.querySelectorAll('button[data-mini-action]')];
    expect(actions.length).toBeGreaterThan(0);
    actions.forEach(action => {
        expect(action.textContent.trim()).not.toBe('');
        expect(action.classList.contains('mini-import-action')).toBe(true);
    });
}

describe('MiniAttendanceImportModal setup slice', () => {
    test('starts as an accessible paste step and only enables analysis for content', () => {
        const { host } = mounted();
        const textarea = host.querySelector('[data-mini-source]');
        const analyzeButton = host.querySelector('[data-mini-action="analyze"]');

        expect(host.querySelector('[data-mini-stage]').dataset.miniStage).toBe('paste');
        expect(host.querySelector(`label[for="${textarea.id}"]`).textContent)
            .toContain('reporte de Mini');
        expect(analyzeButton.disabled).toBe(true);

        input(textarea, REPORT);
        expect(analyzeButton.disabled).toBe(false);
    });

    test('keeps every modal action labelled and scoped to the Mini button style', () => {
        const { host } = mounted();
        expectStyledActions(host);

        analyze(host);
        expectStyledActions(host);

        host.querySelector('[data-mini-action="confirm-date"]').click();
        expect(host.querySelector('[data-mini-action="continue"]').disabled).toBe(false);
        expectStyledActions(host);

        host.querySelector('[data-mini-action="continue"]').click();
        expectStyledActions(host);
    });

    test('renders exact pasted and unparsed content as text, never executable markup', () => {
        const source = '<img src=x onerror="window.__miniXss=1"> 001. Ana Perez *12h*';
        const { host } = mounted();
        analyze(host, source);

        const preview = host.querySelector('[data-mini-source-preview]');
        const details = host.querySelector('[data-mini-source-details]');
        expect(details.open).toBe(false);
        expect(details.querySelector('summary').textContent).toContain('reporte original');
        expect(preview.textContent).toBe(source);
        expect(preview.querySelector('img')).toBeNull();
        expect(host.querySelector('[data-mini-unparsed]').textContent)
            .toContain('<img src=x onerror="window.__miniXss=1">');
        expect(window.__miniXss).toBeUndefined();
    });

    test('summarizes setup and previews parsed employees in a semantic responsive table', () => {
        const { controller, host } = mounted();
        analyze(host);

        expect(host.querySelector('[data-mini-stage]').dataset.miniStage).toBe('setup');
        expect(host.querySelector('[data-mini-setup-summary]')).not.toBeNull();
        expect(host.querySelector('[data-mini-row-count]').textContent).toContain('1');
        expect(host.querySelector('[data-mini-summary-date]').textContent)
            .toContain('Fecha pendiente');
        expect(host.querySelector('[data-mini-summary-mode]').textContent)
            .toContain('Todas las horas como normales');
        expect(host.querySelector('[data-mini-date-hint]').textContent)
            .toContain('martes, 28/7');
        expect(host.querySelector('[data-mini-date-hint]').textContent)
            .toContain('año no incluido');
        const rowsDetails = host.querySelector('[data-mini-rows-details]');
        expect(rowsDetails.open).toBe(false);
        expect(rowsDetails.querySelector('summary').textContent)
            .toContain('1 fila · 0 requieren atención');
        const table = host.querySelector('table[data-mini-rows-table]');
        expect([...table.querySelectorAll('th')].map(cell => cell.textContent)).toEqual([
            'N.º Mini', 'Nombre', 'Total', 'Normales', 'Extra', 'Coincidencia SA'
        ]);
        const cells = [...table.querySelectorAll('tbody td')];
        expect(cells.map(cell => cell.dataset.label)).toEqual([
            'N.º Mini', 'Nombre', 'Total', 'Normales', 'Extra', 'Coincidencia SA'
        ]);
        expect(cells.map(cell => cell.textContent)).toEqual([
            '001', 'Ana Perez', '12 h', '12 h', '0 h', 'Coincidencia por número'
        ]);
        expect(controller.draft.allocationMode).toBe('all_normal');
        expect(host.querySelector('[value="all_normal"]').checked).toBe(true);
    });

    test('suggests the report date instead of forcing the currently selected day', () => {
        const { controller, host } = mounted({ proposedDate: '2026-07-30' });
        analyze(
            host,
            '*Asistencia de hoy miércoles, 29 de julio* 001. Ana Perez *8h*'
        );

        expect(host.querySelector('[data-mini-date]').value).toBe('2026-07-29');
        expect(controller.draft.proposedDate).toBe('2026-07-29');
        host.querySelector('[data-mini-action="confirm-date"]').click();
        expect(controller.draft.confirmedDate).toBe('2026-07-29');
        expect(host.querySelector('[data-mini-action="continue"]').disabled).toBe(false);
    });

    test('requires explicit matching ISO-date confirmation before continuing', () => {
        const onContinue = jest.fn();
        const { controller, host } = mounted({ onContinue });
        analyze(host);
        const continueButton = host.querySelector('[data-mini-action="continue"]');
        expect(continueButton.disabled).toBe(true);
        expect(continueButton.textContent).toBe('Continuar a revisión');
        expect(host.querySelector('[data-mini-date-help]').textContent)
            .toContain('encabezado de Mini');

        const dateInput = host.querySelector('[data-mini-date]');
        input(dateInput, '2026-07-27');
        host.querySelector('[data-mini-action="confirm-date"]').click();
        expect(controller.draft.confirmedDate).toBeNull();
        expect(host.querySelector('[data-mini-date-blockers]').textContent)
            .toContain('no coincide');

        input(host.querySelector('[data-mini-date]'), '2026-07-28');
        host.querySelector('[data-mini-action="confirm-date"]').click();
        expect(controller.draft.confirmedDate).toBe('2026-07-28');
        expect(host.querySelector('[data-mini-summary-date]').textContent)
            .toContain('28/07/2026');
        expect(host.querySelector('[data-mini-action="continue"]').disabled).toBe(false);
        host.querySelector('[data-mini-action="continue"]').click();
        expect(onContinue).toHaveBeenCalledWith(controller.draft);
    });

    test('keeps allocation mode visible and recomputes the immutable draft revision', () => {
        const { controller, host } = mounted();
        analyze(host);
        const previousRevision = controller.draft.revision;
        const split = host.querySelector('[value="split_at_regular_limit"]');

        split.checked = true;
        split.dispatchEvent(new Event('change', { bubbles: true }));

        expect(controller.draft.revision).toBe(previousRevision + 1);
        expect(controller.draft.allocationMode).toBe('split_at_regular_limit');
        expect(controller.draft.rows[0].allocation)
            .toEqual({ normalHours: 8, overtimeHours: 4 });
        expect(host.querySelector('[data-mini-allocation-help]').textContent)
            .toContain('límite regular de 8 horas');
        expect(host.querySelector('[data-mini-current-mode]').textContent)
            .toContain('Separar normales y extra');
        expect(host.querySelector('[data-mini-summary-mode]').textContent)
            .toContain('Separar normales y extra');
        expect(host.querySelector('[data-mini-allocation-row]').textContent)
            .toContain('8 h');
    });

    test('visible unparsed fragments keep continuation blocked', () => {
        const { host } = mounted();
        analyze(host, `unknown prefix ${REPORT}`);
        input(host.querySelector('[data-mini-date]'), '2026-07-28');
        host.querySelector('[data-mini-action="confirm-date"]').click();

        expect(host.querySelector('[data-mini-unparsed]').textContent)
            .toContain('unknown prefix');
        expect(host.querySelector('[data-mini-unparsed]').getAttribute('role')).toBe('alert');
        expect(host.querySelector('[data-mini-continue-help]').textContent)
            .toContain('corrige las advertencias');
        expect(host.querySelector('[data-mini-action="continue"]').disabled).toBe(true);
    });
});

import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';

const DATE = '2026-07-28';
const employees = [
    { id: 'e1', number: '1', name: 'Ana Pérez', positions: ['p1'] },
    { id: 'e2', number: '2', name: '<img src=x> Luis García', positions: ['p1', 'p2'] }
];
const positions = [
    { id: 'p1', name: 'Oficial' },
    { id: 'p2', name: 'Ayudante' }
];

function existingMulti() {
    return {
        employeeId: 'e2',
        date: DATE,
        present: true,
        hoursWorked: 7,
        overtimeHours: 2,
        selectedPosition: 'p1',
        multiPosition: true,
        positionHours: [
            { positionId: 'p1', hours: 4, overtimeHours: 0 },
            { positionId: 'p2', hours: 3, overtimeHours: 2 }
        ],
        notes: 'registro oficial'
    };
}

function enterReview(report, attendance = {}, roster = employees, options = {}) {
    const { stayOnAutomatic = false, ...modalOptions } = options;
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const controller = new MiniAttendanceImportModal({
        employees: roster,
        positions,
        attendance,
        proposedDate: DATE,
        regularLimit: 8,
        ...modalOptions
    }).mount(host);
    const source = host.querySelector('[data-mini-source]');
    source.value = report;
    source.dispatchEvent(new Event('input', { bubbles: true }));
    host.querySelector('[data-mini-action="analyze"]').click();
    host.querySelector('[data-mini-action="confirm-date"]').click();
    host.querySelector('[data-mini-action="continue"]').click();
    if (!stayOnAutomatic && host.querySelector('[data-mini-automatic-review]')) {
        host.querySelectorAll('[data-mini-auto-choice][value="modify"]').forEach(input => {
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        host.querySelector('[data-mini-action="accept-automatic"]').click();
    }
    return { controller, host };
}

function selectRadio(row, selector, value) {
    const input = [...row.querySelectorAll(selector)].find(option => option.value === value);
    if (!input) return false;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function reviewUnit(host, {
    employeeId,
    normal = 8,
    overtime = 0,
    position = '',
    source = ''
} = {}) {
    const row = host.querySelector('[data-mini-review-unit]');
    if (employeeId) {
        row.querySelector('[data-mini-employee]').value = employeeId;
        row.querySelector('[data-mini-employee]')
            .dispatchEvent(new Event('change', { bubbles: true }));
    }
    row.querySelector('[data-mini-normal]').value = normal;
    row.querySelector('[data-mini-overtime]').value = overtime;
    if (position) selectRadio(row, '[data-mini-target-position-option]', position);
    if (source) selectRadio(row, '[data-mini-attendance-source]', source);
    row.querySelector('[data-mini-action="confirm-unit"]').click();
}

function decide(host, { action, target = '' }) {
    const row = host.querySelector('[data-mini-review-unit]');
    selectRadio(row, '[data-mini-attendance-source]', action);
    if (target) selectRadio(row, '[data-mini-target-position-option]', target);
    row.querySelector('[data-mini-action="confirm-unit"]').click();
}

function expectEveryActionButtonToHaveText(host) {
    const emptyActions = [...host.querySelectorAll('button[data-mini-action]')]
        .filter(button => !button.textContent.trim());
    expect(emptyActions).toEqual([]);
}

describe('Mini attendance import review slice', () => {
    test('renders one employee page with one human next action', () => {
        const { controller, host } = enterReview('001. Ana Perez *8h*');

        expect(controller.stage).toBe('review');
        expect(controller.conflictPlan).toBeDefined();
        const unit = host.querySelector('[data-mini-review-unit]');
        expect(unit.textContent).toContain('001 · Ana Perez · 8 h');
        expect(host.querySelectorAll('[data-mini-review-unit]')).toHaveLength(1);
        expect(host.querySelector('[data-mini-review-progress]').textContent)
            .toContain('Empleado 1 de 1');
        expect(host.querySelector('[data-mini-current-mode]').textContent)
            .toContain('Todas las horas como normales');
        expect(host.querySelector('[data-mini-employee]').options).toHaveLength(3);
        expect(host.querySelector('[data-mini-employee]').textContent)
            .toContain('<img src=x> Luis García');
        expect(unit.querySelector('img')).toBeNull();
        expect(unit.querySelectorAll('[data-mini-next-action]')).toHaveLength(1);
        expect(unit.querySelector('[data-mini-action="confirm-unit"]').textContent)
            .toBe('Guardar selección');
        expect(unit.querySelector('[data-mini-identity-map]')).not.toBeNull();
        expect(unit.querySelector('[data-mini-hour-stepper="normal"]')).not.toBeNull();
        expect(unit.querySelector('[data-mini-hour-stepper="overtime"]')).not.toBeNull();
        unit.querySelector(
            '[data-mini-hour-stepper="normal"] [data-mini-hour-adjust="0.25"]'
        ).click();
        expect(unit.querySelector('[data-mini-normal]').value).toBe('8.25');
        expect(unit.querySelector('.mini-import-identity-local').textContent)
            .toContain('8.25 h importadas');
        expect(unit.querySelector('[data-mini-target-position-option]:checked').value)
            .toBe('p1');
        expect(host.querySelector('[data-mini-conflict-row]')).toBeNull();
        expect(host.textContent).not.toMatch(
            /employee_ambiguous|row_review_required|decision_unacknowledged/
        );
        expect(host.querySelector('[data-mini-action="apply"]')).toBeNull();
    });

    test('shows safe matches in a table before individual review and allows modification', () => {
        const { host } = enterReview(
            '001. Ana Perez *8h*',
            {},
            employees,
            { stayOnAutomatic: true }
        );

        expect(host.querySelector('[data-mini-automatic-review]')).not.toBeNull();
        expect(host.querySelectorAll('[data-mini-automatic-row]')).toHaveLength(1);
        expect(host.querySelector('[data-mini-automatic-row]').textContent)
            .toMatch(/001 · Ana Perez.*1 · Ana Pérez.*8 h.*Oficial/);
        expect(host.querySelector('[data-mini-review-unit]')).toBeNull();
        expect(host.querySelector('[data-mini-action="accept-automatic"]').textContent)
            .toBe('Aceptar y aplicar horas');

        selectRadio(host, '[data-mini-auto-choice]', 'modify');
        expect(host.querySelector('[data-mini-action="accept-automatic"]').textContent)
            .toBe('Aceptar selección y continuar');
        host.querySelector('[data-mini-action="accept-automatic"]').click();

        expect(host.querySelector('[data-mini-automatic-review]')).toBeNull();
        expect(host.querySelectorAll('[data-mini-review-unit]')).toHaveLength(1);
        expect(host.querySelector('[data-mini-review-unit]').textContent)
            .toContain('001 · Ana Perez · 8 h');
        expectEveryActionButtonToHaveText(host);
    });

    test('accepts safe rows and skips them while unresolved people continue individually', () => {
        const roster = [
            ...employees,
            { id: 'e501a', number: '501', name: 'Héctor Excavadora', positions: ['p1'] },
            { id: 'e501b', number: '501', name: 'Hector Excavadora', positions: ['p2'] }
        ];
        const attendance = { [`e2-${DATE}`]: existingMulti() };
        const { controller, host } = enterReview(
            '001. Ana Perez *8h* 501. Hector Excavadora *4h* ' +
            '0501. Héctor excavadora *4h* 002. <img src=x> Luis Garcia *9h*',
            attendance,
            roster,
            { stayOnAutomatic: true }
        );
        const rebuild = jest.spyOn(controller, 'rebuildConflictPlan');

        expect(host.querySelectorAll('[data-mini-automatic-row]')).toHaveLength(1);
        host.querySelector('[data-mini-action="accept-automatic"]').click();

        expect(controller.draft.rows.map(row => row.approved))
            .toEqual([true, false, false, false]);
        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(controller.conflictPlan.hasBlockingIssues).toBe(true);
        expect(host.querySelector('[data-mini-review-unit]').textContent)
            .not.toContain('001 · Ana Perez');
        expect(host.querySelector('[data-mini-action="apply"]')).toBeNull();
        expectEveryActionButtonToHaveText(host);
    });

    test('applies immediately when every detected person is an accepted safe match', async () => {
        const applyPlan = jest.fn(async () => ({ appliedCount: 1, keptCount: 0 }));
        const { controller, host } = enterReview(
            '001. Ana Perez *8h*',
            {},
            employees,
            { stayOnAutomatic: true, applyPlan }
        );

        host.querySelector('[data-mini-action="accept-automatic"]').click();
        await Promise.resolve();
        await Promise.resolve();

        expect(applyPlan).toHaveBeenCalledTimes(1);
        expect(controller.applyStatus).toBe('success');
        expect(host.querySelector('[data-mini-apply-status]').textContent)
            .toContain('1 aplicadas');
    });

    test('resolves an ambiguous 501 duplicate group across all occurrences before confirmation', () => {
        const roster = [
            { id: 'e501a', number: '501', name: 'Héctor Excavadora', positions: ['p1'] },
            { id: 'e501b', number: '501', name: 'Hector Excavadora', positions: ['p2'] }
        ];
        const { controller, host } = enterReview(
            '501. Hector Excavadora *4h* 0501. Héctor excavadora *4h*',
            {},
            roster
        );
        let unit = host.querySelector('[data-mini-review-unit]');
        expect(unit.querySelectorAll('.mini-import-identity-source p')).toHaveLength(2);
        expect(unit.textContent).toContain('Apariciones en Mini');
        expect(unit.textContent).toContain(
            'Se detectaron filas iguales. No se combinarán hasta que confirmes el empleado.'
        );
        expect(unit.querySelector('[data-mini-existing-breakdown]').hidden).toBe(true);
        expect(unit.querySelector('[data-mini-target-position]').hidden).toBe(true);
        expect(unit.querySelector('[data-mini-attendance-decision]').hidden).toBe(true);

        const select = unit.querySelector('[data-mini-employee]');
        select.value = 'e501a';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(controller.draft.rows.map(row => row.match.employeeId)).toEqual([null, null]);
        expect(unit.querySelector('[data-mini-target-position-option]:checked').value).toBe('p1');
        unit.querySelector('[data-mini-action="confirm-unit"]').click();
        expect(controller.draft.rows.map(row => row.match.employeeId))
            .toEqual(['e501a', 'e501a']);
        expect(controller.conflictPlan.rows).toHaveLength(1);
        expect(controller.draft.rows.every(row => row.approved)).toBe(true);
        expect(controller.conflictPlan.rows).toHaveLength(1);
    });

    test('employee/hour approval uses draft transitions and rebuilds conflicts', () => {
        const { controller, host } = enterReview('001. Ana Perez *8h*');
        const previousPlan = controller.conflictPlan;
        reviewUnit(host, {
            employeeId: 'e2',
            normal: 7,
            overtime: 1,
            position: 'p2'
        });

        expect(controller.draft.rows[0]).toMatchObject({
            reviewed: true,
            approved: true,
            allocation: { normalHours: 7, overtimeHours: 1 }
        });
        expect(controller.draft.rows[0].match.employeeId).toBe('e2');
        expect(controller.conflictPlan).not.toBe(previousPlan);
        expect(controller.conflictPlan.rows[0].employeeId).toBe('e2');
        expect(controller.conflictPlan.rows[0].targetPositionId).toBe('p2');
        expect(controller.conflictPlan.rows[0].blockers)
            .not.toContain('target_position_required');
    });

    test('shows full existing breakdown and accepts keeping SA in one action', () => {
        const attendance = { [`e2-${DATE}`]: existingMulti() };
        const { controller, host } = enterReview('002. <img src=x> Luis Garcia *9h*', attendance);

        expect(host.querySelector('[data-mini-existing-breakdown]').textContent)
            .toContain('Oficial: 4 normales · 0 extra');
        expect(host.querySelector('[data-mini-existing-breakdown]').textContent)
            .toContain('Ayudante: 3 normales · 2 extra');
        expect(host.querySelector('[data-mini-existing-breakdown] img')).toBeNull();
        decide(host, { action: 'keep_existing' });
        expect(controller.conflictPlan.hasBlockingIssues).toBe(false);
        expect(host.querySelector('[data-mini-action="apply"]').disabled).toBe(false);
        expect(controller.conflictPlan.rows[0].decision)
            .toEqual({ action: 'keep_existing', acknowledged: true });
    });

    test('uses visual Mini and position choices with one explicit acceptance', () => {
        const attendance = { [`e2-${DATE}`]: existingMulti() };
        const { controller, host } = enterReview('002. <img src=x> Luis Garcia *9h*', attendance);

        expect(host.querySelector('[data-mini-action="confirm-unit"]').textContent)
            .toBe('Guardar selección');
        expect(host.querySelectorAll('[data-mini-attendance-source]')).toHaveLength(2);
        expect(host.querySelectorAll('[data-mini-target-position-option]')).toHaveLength(2);
        selectRadio(host, '[data-mini-attendance-source]', 'use_imported');
        expect(host.querySelector('[data-mini-collapse-warning]').hidden).toBe(false);
        decide(host, { action: 'use_imported', target: 'p2' });
        expect(controller.conflictPlan.rows[0]).toMatchObject({
            targetPositionId: 'p2',
            decision: {
                action: 'use_imported',
                acknowledged: true,
                collapseAcknowledged: true
            }
        });
        expect(controller.conflictPlan.hasBlockingIssues).toBe(false);
        expect(host.querySelector('[data-mini-action="apply"]').disabled).toBe(false);
    });

    test('records a manually selected Mini-to-SA identity when requested', async () => {
        const aliasStore = {
            record: jest.fn(async input => ({ aliasId: `alias-${input.rawNumber}` })),
            list: jest.fn(async () => [])
        };
        const aliasScope = {
            ownerUid: 'owner-a',
            siteId: 'sa-current-site',
            sourceId: 'mini-whatsapp'
        };
        const { controller, host } = enterReview(
            '777. Pedro campo *8h*',
            {},
            employees,
            { aliasStore, aliasScope, actorUid: 'owner-a' }
        );
        const unit = host.querySelector('[data-mini-review-unit]');
        unit.querySelector('[data-mini-employee]').value = 'e1';
        unit.querySelector('[data-mini-employee]')
            .dispatchEvent(new Event('change', { bubbles: true }));
        unit.querySelector('[data-mini-remember-match]').checked = true;
        unit.querySelector('[data-mini-action="confirm-unit"]').click();
        await Promise.resolve();
        await Promise.resolve();

        expect(controller.draft.rows[0]).toMatchObject({
            approved: true,
            match: { employeeId: 'e1', status: 'confirmed' }
        });
        expect(aliasStore.record).toHaveBeenCalledWith({
            scope: aliasScope,
            rawNumber: '777',
            rawName: 'Pedro campo',
            targetEmployeeId: 'e1',
            targetNumberSnapshot: '1',
            targetNameSnapshot: 'Ana Pérez'
        }, { allowReplace: true, actorUid: 'owner-a' });
    });

    test('confirms and excludes a person that does not exist in SA', async () => {
        const confirmIgnore = jest.fn(async () => true);
        const { controller, host } = enterReview(
            '777. Persona inexistente *8h*',
            {},
            employees,
            { confirmIgnore }
        );

        expect(host.querySelector('[data-mini-action="ignore-unit"]').hidden).toBe(false);
        host.querySelector('[data-mini-action="ignore-unit"]').click();
        await Promise.resolve();
        await Promise.resolve();

        expect(confirmIgnore).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('no existe en el registro actual de SA')
        }));
        expect(controller.draft.rows[0]).toMatchObject({
            excluded: true,
            approved: false,
            blockers: []
        });
        expect(controller.conflictPlan.rows).toEqual([]);
        expect(host.querySelector('[data-mini-review-summary]').textContent)
            .toContain('1 ignoradas');
        expect(host.querySelector('[data-mini-action="apply"]').disabled).toBe(false);
    });

    test('keeps earlier accepted SA/Mini decisions while reviewing later people', async () => {
        const attendance = { [`e2-${DATE}`]: existingMulti() };
        const { controller, host } = enterReview(
            '002. <img src=x> Luis Garcia *9h* 001. Ana Perez *8h* ' +
            '777. Persona inexistente *6h*',
            attendance,
            employees,
            { confirmIgnore: async () => true }
        );
        let first = host.querySelector('[data-mini-review-unit]');
        expect(first.textContent).toContain('002 ·');
        selectRadio(first, '[data-mini-attendance-source]', 'use_imported');
        selectRadio(first, '[data-mini-target-position-option]', 'p2');
        first.querySelector('[data-mini-action="confirm-unit"]').click();

        let second = host.querySelector('[data-mini-review-unit]');
        expect(second.textContent).toContain('001 ·');
        second.querySelector('[data-mini-action="confirm-unit"]').click();

        const missing = host.querySelector('[data-mini-review-unit]');
        expect(missing.textContent).toContain('777 ·');
        missing.querySelector('[data-mini-action="ignore-unit"]').click();
        await Promise.resolve();
        await Promise.resolve();

        const preserved = controller.conflictPlan.rows
            .find(row => row.employeeId === 'e2');
        expect(preserved).toMatchObject({
            targetPositionId: 'p2',
            decision: {
                action: 'use_imported',
                acknowledged: true,
                collapseAcknowledged: true
            }
        });
        expect(controller.conflictPlan.hasBlockingIssues).toBe(false);
        expect(host.querySelector('[data-mini-action="apply"]').disabled).toBe(false);
    });

    test('paginates employees and blocks continuation until the current page is complete', () => {
        const { host } = enterReview(
            '001. Ana Perez *8h* 002. <img src=x> Luis Garcia *9h* ' +
            '777. Persona inexistente *6h*'
        );

        expect(host.querySelectorAll('[data-mini-review-unit]')).toHaveLength(1);
        expect(host.querySelector('[data-mini-review-progress]').textContent)
            .toContain('Empleado 1 de 3');
        expect(host.querySelector('[data-mini-action="next-unit"]').disabled).toBe(true);
        expect(host.querySelector('[data-mini-action="confirm-unit"]').textContent)
            .toBe('Guardar selección');
        expect(host.querySelector('[data-mini-action="ignore-unit"]').hidden).toBe(true);

        host.querySelector('[data-mini-action="confirm-unit"]').click();
        let current = host.querySelector('[data-mini-review-unit]');
        expect(current.textContent).toContain('002 ·');
        expect(host.querySelector('[data-mini-review-progress]').textContent)
            .toContain('Empleado 2 de 3');
        expect(current.querySelector('[data-mini-action="confirm-unit"]').disabled).toBe(true);

        selectRadio(current, '[data-mini-target-position-option]', 'p2');
        expect(current.querySelector('[data-mini-action="confirm-unit"]').disabled).toBe(false);
        current.querySelector('[data-mini-action="confirm-unit"]').click();

        current = host.querySelector('[data-mini-review-unit]');
        expect(current.textContent).toContain('777 ·');
        expect(host.querySelector('[data-mini-review-progress]').textContent)
            .toContain('Empleado 3 de 3');
        expect(current.querySelector('[data-mini-action="confirm-unit"]').disabled).toBe(true);
        expect(current.querySelector('[data-mini-action="ignore-unit"]').hidden).toBe(false);
    });

    test('keeps the review shell and scroll position stable when selecting Mini', () => {
        const attendance = { [`e2-${DATE}`]: existingMulti() };
        const { controller, host } = enterReview(
            '002. <img src=x> Luis Garcia *9h*',
            attendance
        );
        const modalElement = document.createElement('div');
        modalElement.innerHTML = '<div data-modal-container></div>';
        controller.modal = { element: modalElement };
        controller.syncModalLayout();
        const shell = modalElement.querySelector('[data-modal-container]');
        expect(shell.classList.contains('mini-attendance-review-shell')).toBe(true);

        const overlay = document.createElement('div');
        overlay.dataset.modalOverlay = '';
        const body = document.createElement('div');
        body.className = 'modal-body';
        const unit = host.querySelector('[data-mini-review-unit]');
        body.append(unit);
        overlay.append(body);
        Object.defineProperty(body, 'scrollTop', {
            value: 180,
            writable: true,
            configurable: true
        });
        Object.defineProperty(overlay, 'scrollTop', {
            value: 120,
            writable: true,
            configurable: true
        });
        const mini = unit.querySelector(
            '[data-mini-attendance-source][value="use_imported"]'
        );
        mini.checked = true;
        mini.dispatchEvent(new Event('change', { bubbles: true }));

        expect(body.scrollTop).toBe(180);
        expect(overlay.scrollTop).toBe(0);
        expect(unit.querySelector('[data-mini-collapse-warning]').hidden).toBe(false);
    });
});

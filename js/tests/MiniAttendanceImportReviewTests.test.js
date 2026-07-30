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

function existingSingle() {
    return {
        employeeId: 'e1',
        date: DATE,
        present: true,
        hoursWorked: 6,
        overtimeHours: 0,
        selectedPosition: 'p1',
        multiPosition: false,
        positionHours: [
            { positionId: 'p1', hours: 6, overtimeHours: 0 }
        ]
    };
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
    if (position) selectRadio(row, '[data-mini-target-position-option]', position);
    const allocationRow = position
        ? row.querySelector(`[data-mini-position-allocation="${position}"]`)
        : row.querySelector('[data-mini-position-allocation]');
    allocationRow.querySelector('[data-mini-position-normal]').value = normal;
    allocationRow.querySelector('[data-mini-position-overtime]').value = overtime;
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
        expect(unit.querySelector('[data-mini-position-allocation="p1"]')).not.toBeNull();
        expect(unit.querySelector('[data-mini-hour-stepper="normal"]')).not.toBeNull();
        expect(unit.querySelector('[data-mini-hour-stepper="overtime"]')).not.toBeNull();
        unit.querySelector(
            '[data-mini-hour-stepper="normal"] [data-mini-hour-adjust="0.25"]'
        ).click();
        expect(unit.querySelector('[data-mini-position-normal]').value).toBe('8.25');
        expect(unit.querySelector('.mini-import-identity-local').textContent)
            .toContain('Mini: 8 h · SA: 8.25 h · Diferencia: +0.25 h');
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
            .toBe('Aceptar y revisar resumen');

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

    test('shows ready and attention groups with direct and queued review actions', () => {
        const attendance = { [`e2-${DATE}`]: existingMulti() };
        const { host } = enterReview(
            '001. Ana Perez *8h* 002. <img src=x> Luis Garcia *10h* ' +
            '777. Persona inexistente *6h*',
            attendance,
            employees,
            { stayOnAutomatic: true }
        );

        expect(host.querySelectorAll('[data-mini-automatic-row]')).toHaveLength(1);
        expect(host.querySelectorAll('[data-mini-attention-row]')).toHaveLength(2);
        expect(host.textContent).toContain('SA necesita una decisión');
        expect(host.querySelector('[data-mini-action="edit-attention"]').textContent)
            .toBe('Resolver');
        expect(host.querySelector('[data-mini-action="ignore-attention"]').textContent)
            .toBe('Ignorar');
        expect(host.querySelector('[data-mini-action="review-all-attention"]').textContent)
            .toBe('Revisar todos los pendientes (2)');

        host.querySelector('[data-mini-action="edit-attention"]').click();
        expect(host.querySelectorAll('[data-mini-review-unit]')).toHaveLength(1);
        expect(host.querySelector('[data-mini-review-unit]').textContent).toContain('002 ·');
        host.querySelector('[data-mini-action="back-review"]').click();
        expect(host.querySelectorAll('[data-mini-attention-row]')).toHaveLength(2);

        host.querySelector('[data-mini-action="review-all-attention"]').click();
        expect(host.querySelector('[data-mini-review-progress]').textContent)
            .toContain('Empleado 1 de 2');
    });

    test('places equal Mini and SA hours in ready and accepts them without extra review', () => {
        const attendance = {
            [`e1-${DATE}`]: {
                ...existingSingle(),
                hoursWorked: 8,
                positionHours: [
                    { positionId: 'p1', hours: 8, overtimeHours: 0 }
                ]
            }
        };
        const { controller, host } = enterReview(
            '001. Ana Perez *8h*',
            attendance,
            employees,
            { stayOnAutomatic: true }
        );

        expect(host.querySelectorAll('[data-mini-automatic-row]')).toHaveLength(1);
        expect(host.querySelectorAll('[data-mini-attention-row]')).toHaveLength(0);
        host.querySelector('[data-mini-action="accept-automatic"]').click();

        expect(controller.conflictPlan.rows[0].decision).toEqual({
            action: 'keep_existing',
            acknowledged: true
        });
        expect(controller.conflictPlan.hasBlockingIssues).toBe(false);
        expect(host.querySelector('[data-mini-final-summary]')).not.toBeNull();
    });

    test('places Mini hours with an empty SA record in ready and imports Mini', () => {
        const attendance = {
            [`e1-${DATE}`]: {
                ...existingSingle(),
                hoursWorked: 0,
                positionHours: [
                    { positionId: 'p1', hours: 0, overtimeHours: 0 }
                ]
            }
        };
        const { controller, host } = enterReview(
            '001. Ana Perez *8h*',
            attendance,
            employees,
            { stayOnAutomatic: true }
        );

        expect(host.querySelectorAll('[data-mini-automatic-row]')).toHaveLength(1);
        host.querySelector('[data-mini-action="accept-automatic"]').click();

        expect(controller.conflictPlan.rows[0].decision).toMatchObject({
            action: 'use_imported',
            acknowledged: true
        });
        expect(controller.conflictPlan.hasBlockingIssues).toBe(false);
        expect(host.querySelector('[data-mini-final-summary]')).not.toBeNull();
    });

    test('shows red, orange, or yellow error summaries by highest severity', () => {
        const attendance = {
            [`e1-${DATE}`]: existingSingle(),
            [`e2-${DATE}`]: existingMulti()
        };
        const { host } = enterReview(
            '001. Ana Perez *9h* 002. <img src=x> Luis Garcia *10h* ' +
            '777. Persona inexistente *6h*',
            attendance,
            employees,
            { stayOnAutomatic: true }
        );

        const rows = [...host.querySelectorAll('[data-mini-attention-row]')];
        expect(rows).toHaveLength(3);
        expect(rows[0].dataset.miniProblemSeverity).toBe('caution');
        expect(rows[0].querySelector('.mini-import-status-badge').textContent)
            .toBe('1 error');
        expect(rows[1].dataset.miniProblemSeverity).toBe('warning');
        expect(rows[1].querySelector('.mini-import-status-badge').textContent)
            .toBe('2 errores');
        expect(rows[2].dataset.miniProblemSeverity).toBe('critical');
        expect(rows[2].querySelector('.mini-import-status-badge').textContent)
            .toBe('1 error');
    });

    test('changes every eligible attention row to Mini or SA from the table', () => {
        const attendance = {
            [`e1-${DATE}`]: existingSingle(),
            [`e2-${DATE}`]: existingMulti()
        };
        const { controller, host } = enterReview(
            '001. Ana Perez *9h* 002. <img src=x> Luis Garcia *10h*',
            attendance,
            employees,
            { stayOnAutomatic: true }
        );
        const panel = host.querySelector('[data-mini-automatic-review]');
        const buttons = [...host.querySelectorAll('[data-mini-attention-bulk] button')];

        expect(buttons.map(button => button.textContent))
            .toEqual(['Usar Mini en todos', 'Usar SA en todos']);
        host.querySelector('[data-mini-action="use-sa-all"]').click();

        expect(host.querySelector('[data-mini-automatic-review]')).toBe(panel);
        expect(controller.conflictPlan.rows.map(row => row.decision)).toEqual([
            { action: 'keep_existing', acknowledged: true },
            { action: 'keep_existing', acknowledged: true }
        ]);
        expect(host.querySelectorAll('[data-mini-attention-status="resolved"]'))
            .toHaveLength(2);

        host.querySelector('[data-mini-action="use-mini-all"]').click();

        expect(host.querySelector('[data-mini-automatic-review]')).toBe(panel);
        expect(controller.conflictPlan.rows.map(row => row.decision.action))
            .toEqual(['use_imported', 'use_imported']);
        expect(host.querySelectorAll('[data-mini-attention-status="resolved"]'))
            .toHaveLength(1);
        expect(host.querySelectorAll('[data-mini-attention-status="pending"]'))
            .toHaveLength(1);
    });

    test('returns to reconciliation after saving one punctual correction', () => {
        const attendance = { [`e2-${DATE}`]: existingMulti() };
        const { host } = enterReview(
            '002. <img src=x> Luis Garcia *10h* 777. Persona inexistente *6h*',
            attendance,
            employees,
            { stayOnAutomatic: true }
        );

        host.querySelector('[data-mini-action="edit-attention"]').click();
        expect(host.textContent).toContain('Edición puntual');
        host.querySelector('[data-mini-action="confirm-unit"]').click();

        expect(host.querySelector('[data-mini-automatic-review]')).not.toBeNull();
        expect(host.querySelectorAll('[data-mini-attention-row]')).toHaveLength(2);
        expect(host.querySelectorAll('[data-mini-attention-status="resolved"]'))
            .toHaveLength(1);
        expect(host.querySelector('[data-mini-attention-status="resolved"]').textContent)
            .toMatch(/002.*Resuelto.*Modificar/);
        expect(host.querySelector('[data-mini-attention-status="pending"]').textContent)
            .toContain('777 · Persona inexistente');
        expect(host.querySelector('[data-mini-action="review-all-attention"]').textContent)
            .toBe('Revisar todos los pendientes (1)');
    });

    test('chooses SA or Mini hours inline without opening the individual editor', () => {
        const attendance = { [`e1-${DATE}`]: existingSingle() };
        const { controller, host } = enterReview(
            '001. Ana Perez *9h*',
            attendance,
            employees,
            { stayOnAutomatic: true }
        );

        const panel = host.querySelector('[data-mini-automatic-review]');
        const modalBody = document.createElement('div');
        modalBody.className = 'modal-body';
        host.parentNode?.insertBefore(modalBody, host);
        modalBody.append(host);
        modalBody.scrollTop = 240;
        expect(host.querySelector('[data-mini-inline-source]').textContent)
            .toMatch(/Mini 9 h.*SA 6 h/);
        expect(host.querySelector('[data-mini-attention-source]:checked')).toBeNull();
        host.querySelector('[data-mini-attention-source="use_imported"]').click();

        expect(host.querySelector('[data-mini-automatic-review]')).toBe(panel);
        expect(modalBody.scrollTop).toBe(240);
        expect(host.querySelector('[data-mini-review-unit]')).toBeNull();
        expect(host.querySelector('[data-mini-attention-status="resolved"]')).not.toBeNull();
        expect(host.querySelector('[data-mini-attention-source="use_imported"]').checked)
            .toBe(true);
        expect(controller.draft.rows[0].approved).toBe(true);
        expect(controller.conflictPlan.rows[0].decision).toMatchObject({
            action: 'use_imported',
            acknowledged: true
        });

        host.querySelector('[data-mini-attention-source="keep_existing"]').click();
        expect(host.querySelector('[data-mini-attention-source="keep_existing"]').checked)
            .toBe(true);
        expect(controller.conflictPlan.rows[0].decision).toEqual({
            action: 'keep_existing',
            acknowledged: true
        });
    });

    test('keeps an inline Mini choice pending when position distribution is still required', () => {
        const attendance = { [`e2-${DATE}`]: existingMulti() };
        const { controller, host } = enterReview(
            '002. <img src=x> Luis Garcia *10h*',
            attendance,
            employees,
            { stayOnAutomatic: true }
        );

        host.querySelector('[data-mini-attention-source="use_imported"]').click();

        expect(host.querySelector('[data-mini-attention-status="pending"]')).not.toBeNull();
        expect(host.querySelector('[data-mini-attention-source="use_imported"]').checked)
            .toBe(true);
        expect(host.querySelector('[data-mini-attention-status="pending"]').textContent)
            .toContain('Selecciona un puesto válido');
        expect(host.querySelector('[data-mini-action="edit-attention"]').textContent)
            .toBe('Resolver');
        expect(controller.conflictPlan.rows[0].blockers)
            .toContain('target_position_required');
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
            '0501. Héctor excavadora *4h* 002. <img src=x> Luis Garcia *10h*',
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

    test('requires the final summary before applying accepted safe matches', async () => {
        const applyPlan = jest.fn(async () => ({ appliedCount: 1, keptCount: 0 }));
        const { controller, host } = enterReview(
            '001. Ana Perez *8h*',
            {},
            employees,
            { stayOnAutomatic: true, applyPlan }
        );

        host.querySelector('[data-mini-action="accept-automatic"]').click();
        expect(applyPlan).not.toHaveBeenCalled();
        expect(host.querySelector('[data-mini-final-summary]')).not.toBeNull();
        expect(host.querySelector('[data-mini-final-totals]').textContent)
            .toContain('Mini reportó 8 h');
        expect(host.querySelector('[data-mini-final-totals]').textContent)
            .toContain('SA aplicará 8 h');

        host.querySelector('[data-mini-action="apply"]').click();
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

    test('confirms same-number conflicting rows after assigning their correct employees', () => {
        const { controller, host } = enterReview(
            '501. Ana de campo *8h* 501. Luis de campo *12h*'
        );
        let unit = host.querySelector('[data-mini-review-unit]');
        expect(unit.querySelector('[data-mini-action="confirm-unit"]').textContent)
            .toBe('Confirmar coincidencia');
        unit.querySelector('[data-mini-employee]').value = 'e1';
        unit.querySelector('[data-mini-employee]')
            .dispatchEvent(new Event('change', { bubbles: true }));
        expect(unit.querySelector('[data-mini-completion-hint]').textContent)
            .toContain('confirmar la coincidencia con el botón de abajo');
        unit.querySelector('[data-mini-action="confirm-unit"]').click();

        unit = host.querySelector('[data-mini-review-unit]');
        expect(unit.textContent).toContain('501 · Luis de campo');
        unit.querySelector('[data-mini-employee]').value = 'e2';
        unit.querySelector('[data-mini-employee]')
            .dispatchEvent(new Event('change', { bubbles: true }));
        selectRadio(unit, '[data-mini-target-position-option]', 'p1');
        unit.querySelector('[data-mini-action="confirm-unit"]').click();

        expect(controller.draft.rows.map(row => row.blockers)).toEqual([[], []]);
        expect(controller.conflictPlan.hasBlockingIssues).toBe(false);
        expect(host.querySelector('[data-mini-queue-status]').textContent)
            .toContain('Todas las asistencias están resueltas');
        expect(host.querySelector('[data-mini-action="next-unit"]').textContent)
            .toBe('Revisar resumen');
    });

    test('asks which Mini hours to use when the same employee has conflicting entries', () => {
        const attendance = { [`e1-${DATE}`]: existingSingle() };
        const { controller, host } = enterReview(
            '001. Ana Perez *5h* 001. Ana Perez *9h*',
            attendance
        );
        const unit = host.querySelector('[data-mini-review-unit]');

        expect(unit.querySelector('[data-mini-duplicate-hours]').hidden).toBe(true);
        selectRadio(unit, '[data-mini-attendance-source]', 'use_imported');
        expect(unit.querySelector('[data-mini-duplicate-hours]').hidden).toBe(false);
        expect([...unit.querySelectorAll('[data-mini-duplicate-hour-choice]')]
            .map(input => input.nextElementSibling.textContent))
            .toEqual(['Usar 5 h', 'Usar 9 h']);
        expect(unit.querySelector('[data-mini-imported-breakdown]').textContent)
            .toContain('Valores detectados: 5 h · 9 h');
        expect(unit.querySelector('[data-mini-hours-comparison]').textContent)
            .toContain('Mini: 5 / 9 h');
        expect(unit.querySelector('[data-mini-action="confirm-unit"]').disabled).toBe(true);
        expect(unit.querySelector('[data-mini-completion-hint]').textContent)
            .toContain('elegir una de las horas enviadas por Mini');

        selectRadio(unit, '[data-mini-duplicate-hour-choice]', '9');
        expect(unit.querySelector('[data-mini-position-normal]').value).toBe('9');
        expect(unit.querySelector('[data-mini-hours-comparison]').textContent)
            .toContain('Mini: 9 h · SA: 9 h · Diferencia: 0 h');
        expect(unit.querySelector('[data-mini-action="confirm-unit"]').disabled).toBe(false);
        unit.querySelector('[data-mini-action="confirm-unit"]').click();

        expect(controller.draft.rows.map(row => row.allocation)).toEqual([
            { normalHours: 9, overtimeHours: 0 },
            { normalHours: 9, overtimeHours: 0 }
        ]);
        expect(controller.conflictPlan.rows[0].blockers)
            .not.toContain('conflicting_duplicate');
        expect(controller.conflictPlan.hasBlockingIssues).toBe(false);
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
            allocation: { normalHours: 8, overtimeHours: 0 }
        });
        expect(controller.draft.rows[0].match.employeeId).toBe('e2');
        expect(controller.conflictPlan).not.toBe(previousPlan);
        expect(controller.conflictPlan.rows[0].employeeId).toBe('e2');
        expect(controller.conflictPlan.rows[0].targetPositionId).toBe('p2');
        expect(controller.conflictPlan.rows[0].positionAllocations).toEqual([
            { positionId: 'p2', normalHours: 7, overtimeHours: 1 }
        ]);
        expect(controller.conflictPlan.rows[0].blockers)
            .not.toContain('target_position_required');
    });

    test('keeps Mini hours as evidence and distributes SA hours across positions', () => {
        const { controller, host } = enterReview(
            '002. <img src=x> Luis Garcia *12h*'
        );
        const unit = host.querySelector('[data-mini-review-unit]');
        selectRadio(unit, '[data-mini-target-position-option]', 'p1');
        selectRadio(unit, '[data-mini-target-position-option]', 'p2');
        const official = unit.querySelector('[data-mini-position-allocation="p1"]');
        const helper = unit.querySelector('[data-mini-position-allocation="p2"]');
        official.querySelector('[data-mini-position-normal]').value = '5';
        official.querySelector('[data-mini-position-overtime]').value = '1';
        helper.querySelector('[data-mini-position-normal]').value = '3';
        helper.querySelector('[data-mini-position-overtime]').value = '2';
        helper.querySelector('[data-mini-position-overtime]')
            .dispatchEvent(new Event('input', { bubbles: true }));

        expect(unit.querySelector('[data-mini-hours-comparison]').textContent)
            .toContain('Mini: 12 h · SA: 11 h · Diferencia: -1 h');
        unit.querySelector('[data-mini-action="confirm-unit"]').click();

        expect(controller.draft.rows[0].allocation)
            .toEqual({ normalHours: 12, overtimeHours: 0 });
        expect(controller.conflictPlan.rows[0].positionAllocations).toEqual([
            { positionId: 'p1', normalHours: 5, overtimeHours: 1 },
            { positionId: 'p2', normalHours: 3, overtimeHours: 2 }
        ]);
        expect(controller.conflictPlan.rows[0].blockers).toEqual([]);
        host.querySelector('[data-mini-action="show-summary"]').click();
        expect(host.querySelector('[data-mini-final-totals]').textContent)
            .toMatch(/Mini reportó 12 h.*SA aplicará 11 h.*Diferencia -1 h/);
        expect(host.querySelector('[data-mini-action="apply"]').textContent)
            .toBe('Aplicar asistencia en SA');
    });

    test('shows full existing breakdown and accepts keeping SA in one action', () => {
        const attendance = { [`e2-${DATE}`]: existingMulti() };
        const { controller, host } = enterReview('002. <img src=x> Luis Garcia *9h*', attendance);

        expect(host.querySelector('[data-mini-imported-breakdown]').textContent)
            .toContain('Total: 9 normales · 0 extra');
        expect(host.querySelector('[data-mini-existing-breakdown]').textContent)
            .toContain('Oficial: 4 normales · 0 extra');
        expect(host.querySelector('[data-mini-existing-breakdown]').textContent)
            .toContain('Ayudante: 3 normales · 2 extra');
        expect(host.querySelector('[data-mini-existing-breakdown] img')).toBeNull();
        decide(host, { action: 'keep_existing' });
        expect(controller.conflictPlan.hasBlockingIssues).toBe(false);
        expect(host.querySelector('[data-mini-action="show-summary"]').disabled).toBe(false);
        expect(controller.conflictPlan.rows[0].decision)
            .toEqual({ action: 'keep_existing', acknowledged: true });
    });

    test('uses visual Mini and position choices with one explicit acceptance', () => {
        const attendance = { [`e2-${DATE}`]: existingMulti() };
        const { controller, host } = enterReview('002. <img src=x> Luis Garcia *9h*', attendance);

        expect(host.querySelector('[data-mini-action="confirm-unit"]').textContent)
            .toBe('Guardar selección');
        expect(host.querySelectorAll('[data-mini-attendance-source]')).toHaveLength(2);
        expect([...host.querySelectorAll('[data-mini-attendance-source]')].map(input =>
            input.nextElementSibling.textContent
        )).toEqual(['Mini', 'SA']);
        const sourceChoice = host.querySelector('[data-mini-attendance-decision]');
        const comparison = host.querySelector('[data-mini-record-comparison]');
        const positions = host.querySelector('[data-mini-target-position]');
        expect(sourceChoice.compareDocumentPosition(comparison) &
            Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(comparison.compareDocumentPosition(positions) &
            Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
        expect(host.querySelector('[data-mini-action="show-summary"]').disabled).toBe(false);
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
        expect(unit.querySelector('[data-mini-remember-match]').checked).toBe(true);
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

    test('sorts SA employees by order and can reveal already assigned employees', () => {
        const roster = [
            { id: 'e10', number: '10', name: 'Diez', positions: ['p1'] },
            { id: 'e2', number: '2', name: 'Dos', positions: ['p1'] },
            { id: 'e1', number: '001', name: 'Uno', positions: ['p1'] }
        ];
        const { host } = enterReview(
            '900. Primera persona *8h* 901. Segunda persona *8h*',
            {},
            roster
        );
        let unit = host.querySelector('[data-mini-review-unit]');
        expect([...unit.querySelector('[data-mini-employee]').options]
            .slice(1)
            .map(option => option.textContent))
            .toEqual(['001 · Uno', '2 · Dos', '10 · Diez']);

        unit.querySelector('[data-mini-employee]').value = 'e1';
        unit.querySelector('[data-mini-employee]')
            .dispatchEvent(new Event('change', { bubbles: true }));
        unit.querySelector('[data-mini-action="confirm-unit"]').click();

        unit = host.querySelector('[data-mini-review-unit]');
        expect(unit.textContent).toContain('901 · Segunda persona');
        expect([...unit.querySelector('[data-mini-employee]').options]
            .map(option => option.value)).not.toContain('e1');
        const filter = unit.querySelector('[data-mini-hide-assigned]');
        expect(filter.checked).toBe(true);
        filter.checked = false;
        filter.dispatchEvent(new Event('change', { bubbles: true }));
        unit = host.querySelector('[data-mini-review-unit]');
        expect([...unit.querySelector('[data-mini-employee]').options]
            .map(option => option.value)).toContain('e1');
    });

    test('marks missing editor sections and exposes the summary after confirmation', () => {
        const { host } = enterReview('777. Persona por confirmar *8h*');
        let unit = host.querySelector('[data-mini-review-unit]');
        expect(unit.querySelector('.mini-import-identity-local')
            .classList.contains('mini-import-invalid')).toBe(true);
        expect(unit.querySelector('[data-mini-completion-hint]').textContent)
            .toContain('seleccionar el empleado');

        const employee = unit.querySelector('[data-mini-employee]');
        employee.value = 'e2';
        employee.dispatchEvent(new Event('change', { bubbles: true }));
        expect(unit.querySelector('[data-mini-target-position]')
            .classList.contains('mini-import-invalid')).toBe(true);
        expect(unit.querySelector('[data-mini-completion-hint]').textContent)
            .toMatch(/confirmar la coincidencia.*asignar horas y cargo/);

        selectRadio(unit, '[data-mini-target-position-option]', 'p1');
        expect(unit.querySelector('[data-mini-target-position]')
            .classList.contains('mini-import-invalid')).toBe(false);
        unit.querySelector('[data-mini-action="confirm-unit"]').click();

        unit = host.querySelector('[data-mini-review-unit]');
        expect(unit.querySelector('.mini-import-invalid')).toBeNull();
        expect(unit.querySelector('[data-mini-completion-hint]').textContent)
            .toContain('Asistencia confirmada');
        const next = host.querySelector('[data-mini-action="next-unit"]');
        expect(next.textContent).toBe('Revisar resumen');
        expect(next.disabled).toBe(false);
        next.click();
        expect(host.querySelector('[data-mini-final-summary]')).not.toBeNull();
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
            message: expect.stringContaining('se excluirá únicamente')
        }));
        expect(controller.draft.rows[0]).toMatchObject({
            excluded: true,
            approved: false,
            blockers: []
        });
        expect(controller.conflictPlan.rows).toEqual([]);
        expect(host.querySelector('[data-mini-review-summary]').textContent)
            .toContain('1 ignoradas');
        expect(host.querySelector('[data-mini-action="show-summary"]').disabled).toBe(false);
    });

    test('can ignore a matched entry with an existing SA record', async () => {
        const confirmIgnore = jest.fn(async () => true);
        const attendance = { [`e2-${DATE}`]: existingMulti() };
        const { controller, host } = enterReview(
            '002. <img src=x> Luis Garcia *9h*',
            attendance,
            employees,
            { confirmIgnore }
        );

        expect(host.querySelector('[data-mini-action="ignore-unit"]').hidden).toBe(false);
        host.querySelector('[data-mini-action="ignore-unit"]').click();
        await Promise.resolve();
        await Promise.resolve();

        expect(controller.draft.rows[0].excluded).toBe(true);
        expect(controller.conflictPlan.rows).toEqual([]);
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
        expect(host.querySelector('[data-mini-action="show-summary"]').disabled).toBe(false);
    });

    test('paginates every pending employee and reaches the summary when all are resolved', async () => {
        const { host } = enterReview(
            '001. Ana Perez *8h* 002. <img src=x> Luis Garcia *9h* ' +
            '777. Persona inexistente *6h*',
            {},
            employees,
            { confirmIgnore: async () => true }
        );

        expect(host.querySelectorAll('[data-mini-review-unit]')).toHaveLength(1);
        expect(host.querySelector('[data-mini-review-progress]').textContent)
            .toContain('Empleado 1 de 3');
        expect(host.querySelector('[data-mini-action="next-unit"]').disabled).toBe(true);
        expect(host.querySelector('[data-mini-action="confirm-unit"]').textContent)
            .toBe('Guardar selección');
        expect(host.querySelector('[data-mini-action="ignore-unit"]').hidden).toBe(false);

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
        current.querySelector('[data-mini-action="ignore-unit"]').click();
        await Promise.resolve();
        await Promise.resolve();

        expect(host.querySelector('[data-mini-queue-status]').textContent)
            .toContain('Todas las asistencias están resueltas');
        const finish = host.querySelector('[data-mini-action="next-unit"]');
        expect(finish.textContent).toBe('Revisar resumen');
        expect(finish.disabled).toBe(false);
        finish.click();
        expect(host.querySelector('[data-mini-final-summary]')).not.toBeNull();
    });

    test('keeps dynamically merged source rows visible instead of losing a blocker', () => {
        const { host } = enterReview(
            '900. Primera persona *8h* 901. Segunda persona *6h*'
        );
        let unit = host.querySelector('[data-mini-review-unit]');
        unit.querySelector('[data-mini-employee]').value = 'e1';
        unit.querySelector('[data-mini-employee]')
            .dispatchEvent(new Event('change', { bubbles: true }));
        unit.querySelector('[data-mini-action="confirm-unit"]').click();

        unit = host.querySelector('[data-mini-review-unit]');
        const showAssigned = unit.querySelector('[data-mini-hide-assigned]');
        showAssigned.checked = false;
        showAssigned.dispatchEvent(new Event('change', { bubbles: true }));
        unit = host.querySelector('[data-mini-review-unit]');
        unit.querySelector('[data-mini-employee]').value = 'e1';
        unit.querySelector('[data-mini-employee]')
            .dispatchEvent(new Event('change', { bubbles: true }));
        unit.querySelector('[data-mini-action="confirm-unit"]').click();

        unit = host.querySelector('[data-mini-review-unit]');
        expect(unit.textContent).toContain('900 · Primera persona');
        expect(unit.textContent).toContain('901 · Segunda persona');
        expect(host.querySelector('[data-mini-queue-status]').textContent)
            .toContain('1 asistencia pendiente');
        expect(host.querySelector('[data-mini-action="show-summary"]')).toBeNull();
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

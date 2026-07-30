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
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const controller = new MiniAttendanceImportModal({
        employees: roster,
        positions,
        attendance,
        proposedDate: DATE,
        regularLimit: 8,
        ...options
    }).mount(host);
    const source = host.querySelector('[data-mini-source]');
    source.value = report;
    source.dispatchEvent(new Event('input', { bubbles: true }));
    host.querySelector('[data-mini-action="analyze"]').click();
    host.querySelector('[data-mini-action="confirm-date"]').click();
    host.querySelector('[data-mini-action="continue"]').click();
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
    if (!host.querySelector('[data-mini-review-unit]')) {
        host.querySelector('[data-mini-review-filter="all"]').click();
    }
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
    test('renders one unified safe review unit with one human next action', () => {
        const { controller, host } = enterReview('001. Ana Perez *8h*');

        expect(controller.stage).toBe('review');
        expect(controller.conflictPlan).toBeDefined();
        host.querySelector('[data-mini-review-filter="all"]').click();
        const unit = host.querySelector('[data-mini-review-unit]');
        expect(unit.textContent).toContain('001 · Ana Perez · 8 h');
        expect(host.querySelector('[data-mini-current-mode]').textContent)
            .toContain('Todas las horas como normales');
        expect(host.querySelector('[data-mini-employee]').options).toHaveLength(3);
        expect(host.querySelector('[data-mini-employee]').textContent)
            .toContain('<img src=x> Luis García');
        expect(unit.querySelector('img')).toBeNull();
        expect(unit.querySelectorAll('[data-mini-next-action]')).toHaveLength(1);
        expect(unit.querySelector('[data-mini-action="confirm-unit"]').textContent)
            .toBe('Aceptar');
        expect(unit.querySelector('[data-mini-target-position-option]:checked').value)
            .toBe('p1');
        expect(host.querySelector('[data-mini-conflict-row]')).toBeNull();
        expect(host.textContent).not.toMatch(
            /employee_ambiguous|row_review_required|decision_unacknowledged/
        );
        expect(host.querySelector('[data-mini-action="apply"]').disabled).toBe(true);
    });

    test('starts with only attention items and exposes safe rows through Todos', () => {
        const { host } = enterReview('001. Ana Perez *8h*');
        const summary = host.querySelector('[data-mini-review-summary]');

        expect(host.querySelector('[data-mini-review-filter="needsAttention"]')
            .getAttribute('aria-pressed')).toBe('true');
        expect(summary.textContent)
            .toMatch(/Personas 1.*Claras 1.*Atención 0.*Confirmadas 0/);
        expect(host.querySelectorAll('[data-mini-review-unit]')).toHaveLength(0);
        expect(host.querySelector('[data-mini-review-empty]').textContent)
            .toContain('No hay elementos que necesiten atención');
        expect(host.querySelector('[data-mini-action="confirm-safe"]').disabled).toBe(false);
        expectEveryActionButtonToHaveText(host);

        host.querySelector('[data-mini-review-filter="all"]').click();
        expect(host.querySelectorAll('[data-mini-review-unit]')).toHaveLength(1);
        reviewUnit(host);
        host.querySelector('[data-mini-review-filter="needsAttention"]').click();
        expect(host.querySelector('[data-mini-review-empty]').textContent)
            .toContain('No hay elementos que necesiten atención');
        expectEveryActionButtonToHaveText(host);

        host.querySelector('[data-mini-review-filter="all"]').click();
        expect(host.querySelectorAll('[data-mini-review-unit]')).toHaveLength(1);
        expect(host.querySelector('[data-mini-review-unit]').classList)
            .toContain('is-confirmed');
    });

    test('bulk confirms only fresh safe indexes and rebuilds once without bypassing blockers', () => {
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
            roster
        );
        const rebuild = jest.spyOn(controller, 'rebuildConflictPlan');
        const bulk = host.querySelector('[data-mini-action="confirm-safe"]');

        expect(bulk.textContent).toBe('Confirmar coincidencias claras (1)');
        bulk.click();

        expect(controller.draft.rows.map(row => row.approved))
            .toEqual([true, false, false, false]);
        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(controller.conflictPlan.hasBlockingIssues).toBe(true);
        expect(host.querySelector('[data-mini-action="apply"]').disabled).toBe(true);
        expectEveryActionButtonToHaveText(host);
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
        expect(unit.querySelectorAll('.mini-import-unit-identity p')).toHaveLength(2);
        expect(unit.textContent).toContain('Apariciones detectadas en Mini');
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
        reviewUnit(host, { employeeId: 'e2', normal: 7, overtime: 1 });

        expect(controller.draft.rows[0]).toMatchObject({
            reviewed: true,
            approved: true,
            allocation: { normalHours: 7, overtimeHours: 1 }
        });
        expect(controller.draft.rows[0].match.employeeId).toBe('e2');
        expect(controller.conflictPlan).not.toBe(previousPlan);
        expect(controller.conflictPlan.rows[0].employeeId).toBe('e2');
        expect(controller.conflictPlan.rows[0].blockers)
            .toContain('target_position_required');
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
            .toBe('Aceptar');
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
            .toContain('Ignoradas 1');
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
        let first = [...host.querySelectorAll('[data-mini-review-unit]')]
            .find(card => card.textContent.includes('002 ·'));
        selectRadio(first, '[data-mini-attendance-source]', 'use_imported');
        selectRadio(first, '[data-mini-target-position-option]', 'p2');
        first.querySelector('[data-mini-action="confirm-unit"]').click();

        host.querySelector('[data-mini-review-filter="all"]').click();
        let second = [...host.querySelectorAll('[data-mini-review-unit]')]
            .find(card => card.textContent.includes('001 ·'));
        second.querySelector('[data-mini-action="confirm-unit"]').click();

        const missing = [...host.querySelectorAll('[data-mini-review-unit]')]
            .find(card => card.textContent.includes('777 ·'));
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
});

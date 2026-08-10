import {
    buildAdjustmentScopeSummary,
    calculateAdjustmentPreview,
    readAdjustmentForm,
    renderDesktopAdjustmentWorkspace,
    updateAdjustmentFormPresentation
} from '../modules/features/payroll/PayrollAdjustmentDesktop.js';

const state = {
    exportConfig: {
        deductions: [
            { id: 'g1', name: 'AFP', scope: 'global', type: 'percentage', value: 2 },
            { id: 'l1', name: 'Equipo norte', scope: 'leader', targetId: 'leader-1', type: 'fixed', value: 100 },
            { id: 'p1', name: 'Herramientas', scope: 'position', targetId: 'position-1', type: 'fixed', value: 50 },
            { id: 'e1', name: 'Adelanto', scope: 'employee', targetId: 'employee-1', type: 'fixed', value: 25 }
        ],
        bonuses: []
    },
    employees: [
        { id: 'employee-1', number: '007', name: 'Ada Lovelace', active: true },
        { id: 'employee-2', number: '009', name: 'Grace Hopper', active: false }
    ],
    leaders: [{ id: 'leader-1', name: 'Equipo Norte', active: true }],
    positions: [{ id: 'position-1', name: 'Albañil', leaderId: 'leader-1', active: true }]
};

const rows = [{
    _employeeId: 'employee-1',
    _brutoOriginal: 1000,
    _positionBreakdown: [{ positionId: 'position-1', subtotal: 1000 }],
    _deductionDetails: [
        { id: 'g1', amount: 20, appliedTo: 1000 },
        { id: 'l1', amount: 100, appliedTo: 1000 },
        { id: 'p1', amount: 50, appliedTo: 1000 },
        { id: 'e1', amount: 25, appliedTo: 1000 }
    ],
    _bonusDetails: []
}];

describe('PayrollAdjustmentDesktop', () => {
    test('groups totals into the four payroll scopes without losing detail', () => {
        const summary = buildAdjustmentScopeSummary(
            'deductions',
            state.exportConfig.deductions,
            rows,
            state
        );

        expect(summary.categories.map(category => category.id))
            .toEqual(['global', 'leader', 'position', 'employee']);
        expect(summary.categories.map(category => category.total))
            .toEqual([20, 100, 50, 25]);
        expect(summary.categories[1].rules[0].targetLabel).toBe('Equipo Norte');
        expect(summary.categories[3].rules[0].targetLabel).toBe('#007 · Ada Lovelace');
        expect(summary.total).toBe(195);
        expect(summary.overlapCount).toBe(1);
    });

    test('renders one shared desktop workspace and all scope controls', () => {
        const host = document.createElement('div');
        host.innerHTML = renderDesktopAdjustmentWorkspace('deductions', state, rows);

        expect(host.querySelector('.payroll-adjustment-desktop.is-deduction')).not.toBeNull();
        expect(host.querySelectorAll('.payroll-adjustment-composer input[name="scope"]')).toHaveLength(4);
        expect(
            [...host.querySelectorAll('.payroll-adjustment-composer input[name="type"]')]
                .map(input => input.value)
        ).toEqual(['fixed', 'percentage']);
        expect(
            [...host.querySelectorAll('.payroll-adjustment-composer .payroll-adjustment-value-type [data-mobile-label]')]
                .map(label => label.dataset.mobileLabel)
        ).toEqual(['$', '%']);
        expect(host.querySelectorAll('.payroll-adjustment-group')).toHaveLength(4);
        const layoutChildren = [...host.querySelector('.payroll-adjustment-desktop__layout').children];
        expect(layoutChildren[0].classList).toContain('payroll-adjustment-composer');
        expect(layoutChildren[1].classList).toContain('payroll-adjustment-summary');
        const editableRule = host.querySelector('.payroll-adjustment-rule');
        expect(editableRule.querySelector('.payroll-adjustment-rule__edit svg')).not.toBeNull();
        expect(host.querySelector('.payroll-adjustment-remember span').textContent).toBe('Guardar');
        expect(host.querySelector('.payroll-adjustment-summary__base')).toBeNull();
        expect(host.querySelector('.payroll-adjustment-summary__columns').textContent)
            .not.toContain('Base');
        expect(host.querySelector('.payroll-adjustment-group__rule-count').textContent)
            .toContain('1 regla');
        expect(host.querySelector('.payroll-adjustment-group__total').textContent)
            .toContain('$20.00');
        expect(host.textContent).toContain('Agregar deducción');
        expect(host.textContent).toContain('Por líder / equipo');
        expect(host.textContent).toContain('$195.00');
    });

    test('reads the selected group target and updates the live estimate', () => {
        const host = document.createElement('div');
        host.innerHTML = renderDesktopAdjustmentWorkspace('bonuses', {
            ...state,
            exportConfig: { ...state.exportConfig, bonuses: [] }
        }, rows);
        const form = host.querySelector('.payroll-adjustment-form');

        form.querySelector('input[value="position"]').checked = true;
        form.querySelector('[name="positionTarget"]').value = 'position-1';
        form.querySelector('[name="name"]').value = 'Bono de obra';
        form.querySelector('input[name="type"][value="percentage"]').checked = true;
        form.querySelector('[name="value"]').value = '10';

        const adjustment = readAdjustmentForm(form);
        expect(adjustment).toMatchObject({
            name: 'Bono de obra',
            type: 'percentage',
            value: 10,
            scope: 'position',
            targetId: 'position-1'
        });
        expect(calculateAdjustmentPreview(adjustment, rows, state.positions)).toEqual({
            employeeCount: 1,
            appliedTo: 1000,
            amount: 100
        });

        updateAdjustmentFormPresentation(form, rows, state.positions);
        expect(form.dataset.adjustmentScope).toBe('position');
        expect(form.querySelector('.payroll-adjustment-form__target--position').classList)
            .toContain('is-visible');
        expect(form.querySelector('[data-preview-total]').textContent).toBe('$100.00');
    });

    test('renders employee chips and reads several employees from one rule', () => {
        const host = document.createElement('div');
        host.innerHTML = renderDesktopAdjustmentWorkspace('bonuses', {
            ...state,
            exportConfig: {
                ...state.exportConfig,
                bonuses: [{
                    id: 'multi',
                    name: 'Bono especial',
                    scope: 'employee',
                    targetIds: ['employee-1', 'employee-2'],
                    type: 'fixed',
                    value: 500
                }]
            }
        }, rows);
        const editForm = host.querySelector('.payroll-adjustment-rule__editor .payroll-adjustment-form');

        expect(editForm.querySelectorAll('[data-adjustment-employee-chip]')).toHaveLength(2);
        expect(editForm.textContent).toContain('007 · Ada Lovelace');
        expect(editForm.textContent).toContain('009 · Grace Hopper');
        expect(editForm.querySelector('[data-payroll-action="open-adjustment-employee-picker"]'))
            .not.toBeNull();
        expect(readAdjustmentForm(editForm)).toMatchObject({
            scope: 'employee',
            targetId: 'employee-1',
            targetIds: ['employee-1', 'employee-2']
        });
    });
});

import fs from 'fs';
import path from 'path';
import {
    buildAdjustmentScopeSummary,
    calculateAdjustmentPreview,
    readAdjustmentForm,
    renderDesktopAdjustmentWorkspace,
    updateAdjustmentFormPresentation
} from '../modules/features/payroll/PayrollAdjustmentDesktop.js';
import {
    ADJUSTMENT_PLAN_KIND,
    createPayrollAdjustmentInstallmentPlans
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import { setPayrollAdjustmentPeriodRuntimeSelection } from
    '../modules/features/payroll/PayrollAdjustmentPeriodSelection.js';
import { resolveScheduledActionReference } from
    '../modules/features/payroll/PayrollAdjustmentScheduled.js';

const PAYROLL_CSS = fs.readFileSync(
    path.resolve(__dirname, '../../css/payroll-redesign.css'), 'utf8'
);

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
    test('adds scheduled employee amounts to Individuales without duplicating temporary rules', () => {
        let serial = 0;
        const [plan] = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION, employeeIds: ['employee-1'],
            name: 'Uniforme programado', totalAmount: 100, installmentCount: 3,
            firstPeriodStart: '2026-08-01', createdAt: 100
        }, { createId: prefix => `${prefix}-${++serial}` });
        setPayrollAdjustmentPeriodRuntimeSelection({
            kind: 'deductions', planId: plan.id, employeeId: 'employee-1',
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        }, { mode: 'count', count: 2 });
        const localState = {
            ...state,
            employees: [{ ...state.employees[0], deductions: [plan], bonuses: [] }],
            exportConfig: { ...state.exportConfig, periodStart: '2026-08-01', periodEnd: '2026-08-15',
                deductions: [{ id: 'TEMP', name: 'Temporal', scope: 'employee',
                    targetId: 'employee-1', type: 'fixed', value: 10 }] }
        };
        const localRows = [{ _employeeId: 'employee-1', _bonusDetails: [], _deductionDetails: [
            { id: 'TEMP', amount: 10, appliedTo: 1000 },
            ...plan.installments.slice(0, 2).map(item => ({ id: item.id, planId: plan.id,
                employeeId: 'employee-1', amount: item.amount,
                source: 'payroll-adjustment-installment' }))
        ] }];

        const host = document.createElement('div');
        host.innerHTML = renderDesktopAdjustmentWorkspace('deductions', localState, localRows);
        const individuals = [...host.querySelectorAll('.payroll-adjustment-group')]
            .find(item => item.querySelector('summary')?.textContent.includes('Individuales'));

        expect(individuals.textContent).toContain('Temporal');
        expect(individuals.textContent).toContain('Solo esta nómina');
        expect(individuals.textContent).toContain('Uniforme programado');
        expect(individuals.textContent).toContain('Programado');
        expect(individuals.textContent).toContain('2 de 3 cuotas');
        expect(individuals.textContent).toContain('$76.66');
        expect(host.querySelector('.payroll-adjustment-summary header').textContent).toContain('$76.66');
        expect(localState.exportConfig.deductions).toHaveLength(1);
    });

    test('groups every visible individual adjustment by normalized concept with exact details and opaque actions', () => {
        let serial = 0;
        const planned = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['employee-1', 'employee-2'],
            name: ' botas ',
            totalAmount: 30,
            installmentCount: 2,
            firstPeriodStart: '2026-08-01',
            createdAt: 100
        }, { createId: prefix => prefix + '-boots-' + (++serial) });
        const [single] = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['employee-3'],
            name: 'BOTAS',
            totalAmount: 12,
            installmentCount: 1,
            singlePayment: true,
            firstPeriodStart: '2026-08-01',
            createdAt: 200
        }, { createId: prefix => prefix + '-single-' + (++serial) });
        planned[0].history.push({ id: 'movement-1', amount: 1, status: 'applied' });
        const adjustments = [
            { id: 'TEMP-A', name: 'Botas', scope: 'employee',
                targetIds: ['employee-1', 'employee-2'], type: 'fixed', value: 10 },
            { id: 'TEMP-B', name: '  botas  ', scope: 'employee',
                targetIds: ['employee-3'], type: 'fixed', value: 5 }
        ];
        const employees = [
            { id: 'employee-1', number: '007', name: 'Ada Lovelace', active: true,
                deductions: [planned[0]], bonuses: [] },
            { id: 'employee-2', number: '009', name: 'Grace Hopper', active: true,
                deductions: [planned[1]], bonuses: [] },
            { id: 'employee-3', number: '011', name: 'Linus Torvalds', active: true,
                deductions: [single], bonuses: [] }
        ];
        const details = (temporaryId, temporaryAmount, plan) => [
            { id: temporaryId, amount: temporaryAmount, appliedTo: 1000 },
            { id: plan.installments[0].id, planId: plan.id,
                employeeId: plan.employeeId, amount: plan.installments[0].amount,
                source: 'payroll-adjustment-installment' }
        ];
        const localState = {
            ...state,
            employees,
            exportConfig: { ...state.exportConfig, periodStart: '2026-08-01',
                periodEnd: '2026-08-15', deductions: adjustments }
        };
        const localRows = [
            { _employeeId: 'employee-1', _deductionDetails: details('TEMP-A', 10, planned[0]), _bonusDetails: [] },
            { _employeeId: 'employee-2', _deductionDetails: details('TEMP-A', 10, planned[1]), _bonusDetails: [] },
            { _employeeId: 'employee-3', _deductionDetails: details('TEMP-B', 5, single), _bonusDetails: [] }
        ];

        const host = document.createElement('div');
        host.innerHTML = renderDesktopAdjustmentWorkspace('deductions', localState, localRows);
        const individuals = [...host.querySelectorAll('.payroll-adjustment-group')]
            .find(item => item.querySelector(':scope > summary')?.textContent.includes('Individuales'));
        const concepts = individuals.querySelectorAll('.payroll-adjustment-concept');

        expect(concepts).toHaveLength(1);
        expect(concepts[0].querySelector(':scope > summary').textContent)
            .toEqual(expect.stringContaining('Botas'));
        expect(concepts[0].querySelector(':scope > summary').textContent)
            .toEqual(expect.stringContaining('$67.00'));
        expect(concepts[0].querySelector(':scope > summary').textContent)
            .toEqual(expect.stringContaining('5 ajustes'));
        expect(concepts[0].querySelector(':scope > summary').textContent)
            .toEqual(expect.stringContaining('3 empleados'));
        expect(concepts[0].textContent).toEqual(expect.stringContaining('007 · Ada Lovelace'));
        expect(concepts[0].textContent).toEqual(expect.stringContaining('009 · Grace Hopper'));
        expect(concepts[0].textContent).toEqual(expect.stringContaining('011 · Linus Torvalds'));
        expect(concepts[0].textContent).toEqual(expect.stringContaining('Solo esta nómina'));
        expect(concepts[0].textContent).toEqual(expect.stringContaining('Programado'));
        expect(concepts[0].textContent).toEqual(expect.stringContaining('1 de 2 cuotas'));
        expect(concepts[0].textContent).toEqual(expect.stringContaining('Cancelar programación'));

        const scheduledButtons = [...concepts[0].querySelectorAll('button[data-scheduled-reference]')];
        scheduledButtons.forEach(button => {
            expect(button.getAttribute('aria-label')).toMatch(/^(Pausar|Reanudar|Quitar programación|Cancelar programación) Botas para (Ada|Grace|Linus)/i);
        });
        expect(PAYROLL_CSS).not.toContain('.payroll-adjustment-concept > summary > :nth-child(3),');
        expect(PAYROLL_CSS).not.toContain('.payroll-adjustment-concept__detail > :nth-child(3)');
        expect(PAYROLL_CSS).toMatch(/payroll-adjustment-concept__actions\s*{[^}]*grid-column:\s*1\s*\/\s*-1/s);

        const actions = [...concepts[0].querySelectorAll('[data-scheduled-reference]')];
        expect(actions.length).toBeGreaterThanOrEqual(4);
        actions.forEach(action => {
            expect(action.dataset.scheduledReference).toMatch(/^scheduled-action-/);
            expect(resolveScheduledActionReference(action.dataset.scheduledReference)).not.toBeNull();
        });
        [...planned, single].forEach(plan => {
            expect(concepts[0].innerHTML).not.toContain(plan.id);
            expect(concepts[0].innerHTML).not.toContain(plan.groupId);
        });
        expect(individuals.querySelector(':scope > summary').textContent)
            .toEqual(expect.stringContaining('5 reglas'));
        expect(host.querySelector('.payroll-adjustment-summary > header').textContent)
            .toEqual(expect.stringContaining('$67.00'));
    });

    test('keeps the current payroll total exact when its scheduled final payment completes the plan', () => {
        let serial = 0;
        const [plan] = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.BONUS, employeeIds: ['employee-1'], name: 'Bono final',
            totalAmount: 25, installmentCount: 2, firstPeriodStart: '2026-08-01', createdAt: 100
        }, { createId: prefix => `${prefix}-final-summary-${++serial}` });
        plan.installments.forEach(item => { item.status = 'applied'; item.appliedAmount = item.amount; });
        plan.appliedAmount = 25;
        plan.balance = 0;
        plan.appliedInstallments = 2;
        plan.status = 'completed';
        const localState = {
            ...state,
            employees: [{ ...state.employees[0], bonuses: [plan], deductions: [] }],
            exportConfig: { ...state.exportConfig, periodStart: '2026-08-16',
                periodEnd: '2026-08-31', bonuses: [] }
        };
        const host = document.createElement('div');
        host.innerHTML = renderDesktopAdjustmentWorkspace('bonuses', localState, [{
            _employeeId: 'employee-1', _deductionDetails: [], _bonusDetails: [{
                id: plan.installments[1].id, planId: plan.id, employeeId: 'employee-1',
                amount: plan.installments[1].amount, source: 'payroll-adjustment-installment'
            }]
        }]);

        expect(host.querySelector('.payroll-adjustment-summary').textContent).toContain('Bono final');
        expect(host.querySelector('.payroll-adjustment-summary').textContent).toContain('Ya aplicado');
        expect(host.querySelector('.payroll-adjustment-summary header').textContent).toContain('$12.50');
    });

    test('shows a temporary payroll pause as zero and excludes future or permanently paused plans', () => {
        let serial = 0;
        const plans = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.BONUS, employeeIds: ['employee-1', 'employee-2'],
            name: 'Bono programado', totalAmount: 60, installmentCount: 2,
            firstPeriodStart: '2026-09-01', createdAt: 100
        }, { createId: prefix => `${prefix}-${++serial}` });
        plans[0].firstPeriodStart = '2026-08-01';
        setPayrollAdjustmentPeriodRuntimeSelection({
            kind: 'bonuses', planId: plans[0].id, employeeId: 'employee-1',
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        }, { mode: 'pause' });
        plans[1].status = 'paused';
        const localState = {
            ...state,
            employees: [
                { ...state.employees[0], bonuses: [plans[0]], deductions: [] },
                { id: 'employee-2', name: 'Grace', active: true, bonuses: [plans[1]], deductions: [] }
            ],
            exportConfig: { ...state.exportConfig, periodStart: '2026-08-01',
                periodEnd: '2026-08-15', bonuses: [] }
        };
        const host = document.createElement('div');
        host.innerHTML = renderDesktopAdjustmentWorkspace('bonuses', localState, [{
            _employeeId: 'employee-1', _bonusDetails: [], _deductionDetails: []
        }]);

        expect(host.textContent).toContain('Pausado en esta nómina');
        expect(host.querySelector('.payroll-adjustment-summary header').textContent).toContain('$0.00');
        expect(host.querySelector('.payroll-adjustment-summary').textContent).not.toContain('Grace');
    });
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
        expect(host.querySelector('[data-scheduled-adjustments]')).not.toBeNull();
        expect(host.textContent).toContain('Programados');
        expect(host.textContent).toContain('No hay descuentos programados');
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

    test('uses clear accessible save copy by scope and only offers installments for saved individuals', () => {
        const host = document.createElement('div');
        host.innerHTML = renderDesktopAdjustmentWorkspace('deductions', {
            ...state,
            exportConfig: { ...state.exportConfig, deductions: [] }
        }, rows);
        const form = host.querySelector('.payroll-adjustment-form');
        const remember = form.querySelector('[name="remembered"]');
        const rememberLabel = remember.closest('label');
        const installmentOption = form.querySelector('[data-installment-option]');

        form.querySelector('input[name="scope"][value="employee"]').checked = true;
        form.querySelector('input[name="type"][value="fixed"]').checked = true;
        updateAdjustmentFormPresentation(form, rows, state.positions);
        expect(rememberLabel.textContent).toContain('Guardar como pago programado');
        expect(rememberLabel.textContent).toContain('una sola vez');
        expect(installmentOption.hidden).toBe(true);

        remember.checked = true;
        updateAdjustmentFormPresentation(form, rows, state.positions);
        expect(installmentOption.hidden).toBe(false);
        expect(installmentOption.textContent).toContain('Dividir en cuotas');

        form.querySelector('input[name="scope"][value="leader"]').checked = true;
        updateAdjustmentFormPresentation(form, rows, state.positions);
        expect(rememberLabel.textContent).toContain('Guardar para próximas nóminas');

        form.querySelector('input[name="scope"][value="position"]').checked = true;
        updateAdjustmentFormPresentation(form, rows, state.positions);
        expect(rememberLabel.textContent).toContain('Guardar para próximas nóminas');

        form.querySelector('input[name="scope"][value="global"]').checked = true;
        updateAdjustmentFormPresentation(form, rows, state.positions);
        expect(rememberLabel.textContent.trim()).toBe('Guardar');
    });

    test('shows installment controls only for fixed individual adjustments and explains the split', () => {
        const host = document.createElement('div');
        host.innerHTML = renderDesktopAdjustmentWorkspace('deductions', {
            ...state,
            exportConfig: {
                ...state.exportConfig,
                periodStart: '2026-08-16',
                deductions: []
            }
        }, rows);
        const form = host.querySelector('.payroll-adjustment-form');
        const option = form.querySelector('[data-installment-option]');
        const details = form.querySelector('[data-installment-details]');

        expect(option.hidden).toBe(true);
        form.querySelector('input[name="scope"][value="employee"]').checked = true;
        form.querySelector('input[name="type"][value="fixed"]').checked = true;
        form.querySelector('[name="remembered"]').checked = true;
        form.querySelector('[name="value"]').value = '100';
        updateAdjustmentFormPresentation(form, rows, state.positions);
        expect(option.hidden).toBe(false);

        form.querySelector('[name="installmentsEnabled"]').checked = true;
        form.querySelector('[name="installmentCount"]').value = '3';
        updateAdjustmentFormPresentation(form, rows, state.positions);

        expect(details.hidden).toBe(false);
        expect(form.querySelector('[name="firstPeriodStart"]').value).toBe('2026-08-16');
        expect(form.querySelector('[data-installment-regular]').textContent).toBe('$33.33');
        expect(form.querySelector('[data-installment-last]').textContent).toBe('$33.34');
        expect(form.querySelector('[data-installment-explanation]').textContent)
            .toContain('Cada empleado tendrá $100.00 en total');

        form.querySelector('input[name="type"][value="percentage"]').checked = true;
        updateAdjustmentFormPresentation(form, rows, state.positions);
        expect(option.hidden).toBe(true);
        expect(details.hidden).toBe(true);
        expect(readAdjustmentForm(form).installmentsEnabled).toBe(false);
    });
});

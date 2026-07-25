import { state } from '../modules/core/AppState.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import { LoansLedger } from '../modules/features/loans/LoansLedger.js';

function resetFinancialState() {
    state.employees = [];
    state.positions = [];
    state.leaders = [];
    state.attendance = {};
    state.attendanceByDate = {};
    state.payrollViewMode = 'generator';
    state.loansLedger = null;
    state.settings.payPeriod = {
        periodStart: '2026-07-01',
        periodLength: 15,
        payDay: '2026-07-16'
    };
    state.exportConfig = {
        periodStart: '2026-07-01',
        periodEnd: '2026-07-15',
        activePreset: 'payPeriod',
        periodSource: 'configured',
        leaderFilter: 'all',
        deductions: [],
        bonuses: [],
        employeeDeductionsAdded: false,
        employeeBonusesAdded: false,
        rememberedGlobalsHydrated: true,
        payrollGuideStep: 'period',
        collapsedSteps: ['step2', 'step2b', 'step2c', 'step3']
    };
}

describe('Financial desktop layouts', () => {
    const render = jest.fn();

    beforeAll(() => {
        window.PayrollUI = PayrollUI;
    });

    beforeEach(() => {
        render.mockClear();
        resetFinancialState();
        PayrollUI.init({
            state,
            services: {
                payroll: {
                    calculateEmployeePayroll: jest.fn(() => ({
                        brutoOriginal: 1200,
                        bruto: 1200,
                        bonuses: 100,
                        deductions: 300,
                        neto: 1000
                    }))
                }
            },
            render
        });
    });

    test('payroll renders the horizontal five-step guide and export summary', () => {
        const html = PayrollUI.PayrollTab();

        expect(html).toContain('class="payroll-guided-layout"');
        expect(html).toContain('aria-label="Pasos de nómina"');
        expect(html).toContain('data-value="period"');
        expect(html).toContain('data-value="deductions"');
        expect(html).toContain('data-value="bonuses"');
        expect(html).toContain('data-value="loans"');
        expect(html).toContain('data-value="review"');
        expect(html).toContain('aria-label="Resumen de nómina"');
        expect(html).toContain('Total neto');
        expect(html).toContain('data-payroll-action="copy-export-json"');
        expect(html).toContain('data-payroll-action="download-export-json"');
    });

    test('period presets share one responsive alignment row', () => {
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const presets = host.querySelector('.payroll-period-presets');

        expect(presets).not.toBeNull();
        expect(presets.querySelectorAll('.payroll-period-preset')).toHaveLength(3);
        expect(presets.textContent).toContain('Este mes');
        expect(presets.textContent).toContain('Mes anterior');
        expect(presets.textContent).toContain('Período Actual');
    });

    test('mobile summary starts compact and exposes the current payroll totals first', () => {
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const toggle = host.querySelector('.payroll-guide-summary__mobile-toggle');

        expect(toggle).not.toBeNull();
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.textContent).toContain('1 jul 2026');
        expect(toggle.textContent).toContain('15 jul 2026');
        expect(toggle.textContent).toContain('0 empleados');
        expect(toggle.textContent).toContain('Total neto');
        expect(toggle.textContent).toContain('$0.00');
        expect(toggle.textContent).toContain('Listo');
    });

    test('mobile summary expands without changing payroll values', () => {
        const deductions = state.exportConfig.deductions;
        const bonuses = state.exportConfig.bonuses;

        PayrollUI.togglePayrollMobileSummary();
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();

        expect(state.exportConfig.payrollMobileSummaryExpanded).toBe(true);
        expect(host.querySelector('.payroll-guide-summary').classList).toContain('is-mobile-expanded');
        expect(host.querySelector('.payroll-guide-summary__mobile-toggle').getAttribute('aria-expanded')).toBe('true');
        expect(host.querySelector('.payroll-guide-summary__mobile-toggle').textContent).toContain('Ocultar');
        expect(state.exportConfig.deductions).toBe(deductions);
        expect(state.exportConfig.bonuses).toBe(bonuses);
    });

    test('period shortcuts omit rolling and last-payment presets', () => {
        const html = PayrollUI.PayrollTab();

        expect(html).not.toContain('data-value="last15"');
        expect(html).not.toContain('data-value="sinceLastPay"');
        expect(html).toContain('data-value="thisMonth"');
        expect(html).toContain('data-value="lastMonth"');
        expect(html).toContain('data-value="payPeriod"');
    });

    test('changing the guide step exposes its panel without changing financial data', () => {
        const deductions = state.exportConfig.deductions;
        const bonuses = state.exportConfig.bonuses;

        PayrollUI.setPayrollGuideStep('deductions');

        expect(state.exportConfig.payrollGuideStep).toBe('deductions');
        expect(state.exportConfig.collapsedSteps).not.toContain('step2');
        expect(state.exportConfig.collapsedSteps).toContain('step2c');
        expect(state.exportConfig.deductions).toBe(deductions);
        expect(state.exportConfig.bonuses).toBe(bonuses);
        expect(PayrollUI.PayrollTab()).toMatch(
            /class="payroll-guide-step is-active [^"]*"[\s\S]{0,180}data-value="deductions"/
        );
    });

    test('loans are a dedicated fourth step', () => {
        PayrollUI.setPayrollGuideStep('loans');

        expect(state.exportConfig.payrollGuideStep).toBe('loans');
        expect(state.exportConfig.collapsedSteps).not.toContain('step2c');
        const html = PayrollUI.PayrollTab();
        expect(html).toMatch(
            /class="payroll-guide-step is-active [^"]*"[\s\S]{0,180}data-value="loans"/
        );
        expect(html).toContain('class="payroll-loans-desktop"');
        expect(html).toContain('class="payroll-loans-legacy"');
    });

    test('tri-state loan selection toggles all, partial, and none without changing loans', () => {
        state.employees = [{
            id: 'e1',
            number: '001',
            name: 'Juan Pérez',
            active: true,
            loans: [
                {
                    id: 'loan-1', principal: 100, interestRate: 0,
                    interestIncluded: false, status: 'active', payments: [], refinancings: []
                },
                {
                    id: 'loan-2', principal: 50, interestRate: 0,
                    interestIncluded: false, status: 'active', payments: [], refinancings: []
                }
            ]
        }];
        const before = JSON.stringify(state.employees[0].loans);

        PayrollUI.toggleEmployeePayrollLoans('e1');
        expect(state.exportConfig.payrollLoanSelection[0].loanIds).toHaveLength(2);

        PayrollUI.togglePayrollLoanSelection('e1', 'loan-2');
        expect(state.exportConfig.payrollLoanSelection[0].loanIds).toEqual(['loan-1']);

        PayrollUI.toggleEmployeePayrollLoans('e1');
        expect(state.exportConfig.payrollLoanSelection[0].loanIds).toHaveLength(2);

        PayrollUI.toggleEmployeePayrollLoans('e1');
        expect(state.exportConfig.payrollLoanSelection).toEqual([]);
        expect(JSON.stringify(state.employees[0].loans)).toBe(before);
    });

    test('desktop adjustments expose four scopes while retaining the legacy mobile panel', () => {
        PayrollUI.setPayrollGuideStep('deductions');
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();

        expect(host.querySelector('.payroll-adjustment-desktop.is-deduction')).not.toBeNull();
        expect(host.querySelector('#export-deductions-section.payroll-adjustment-legacy')).not.toBeNull();
        expect(
            [...host.querySelectorAll('.payroll-adjustment-desktop.is-deduction .payroll-adjustment-composer input[name="scope"]')]
                .map(input => input.value)
        ).toEqual(['global', 'leader', 'position', 'employee']);
    });

    test('desktop adjustment form adds a position-scoped deduction', () => {
        state.positions = [{ id: 'position-1', name: 'Albañil', active: true }];
        PayrollUI.setPayrollGuideStep('deductions');
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const form = host.querySelector('.payroll-adjustment-composer .payroll-adjustment-form');

        form.querySelector('input[value="position"]').checked = true;
        form.querySelector('[name="positionTarget"]').value = 'position-1';
        form.querySelector('[name="name"]').value = 'Herramientas';
        form.querySelector('input[name="type"][value="percentage"]').checked = true;
        form.querySelector('[name="value"]').value = '3';
        PayrollUI.addDesktopAdjustment(
            'deductions',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(state.exportConfig.deductions).toHaveLength(1);
        expect(state.exportConfig.deductions[0]).toMatchObject({
            name: 'Herramientas',
            type: 'percentage',
            value: 3,
            scope: 'position',
            targetId: 'position-1'
        });
        expect(render).toHaveBeenCalled();
    });

    test('desktop adjustments use a default name when concept is empty', () => {
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const deductionForm = host.querySelector(
            '.payroll-adjustment-desktop.is-deduction .payroll-adjustment-composer .payroll-adjustment-form'
        );
        const bonusForm = host.querySelector(
            '.payroll-adjustment-desktop.is-bonus .payroll-adjustment-composer .payroll-adjustment-form'
        );

        deductionForm.querySelector('[name="value"]').value = '25';
        bonusForm.querySelector('[name="value"]').value = '50';
        PayrollUI.addDesktopAdjustment(
            'deductions',
            deductionForm.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );
        PayrollUI.addDesktopAdjustment(
            'bonuses',
            bonusForm.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(state.exportConfig.deductions[0].name).toBe('Descuento');
        expect(state.exportConfig.bonuses[0].name).toBe('Bono');
    });

    test('bonus and deduction detail rows expand independently', () => {
        PayrollUI.togglePayrollSummaryDetail('bonuses');
        const html = PayrollUI.PayrollTab();

        expect(state.exportConfig.payrollSummaryExpanded.bonuses).toBe(true);
        expect(html).toContain('aria-label="Ocultar detalle de bonificaciones"');
        expect(html).toContain('payroll-summary-detail--bonuses');
        expect(html).toContain('Interés $0.00');
    });

    test('review table separates active loans and keeps employee identity sticky', () => {
        PayrollUI.setPayrollGuideStep('review');
        const host = document.createElement('div');
        const html = PayrollUI.PayrollTab();
        host.innerHTML = html;

        const headers = [...host.querySelectorAll('.payroll-guide-panel--review th')]
            .map(cell => cell.textContent.trim());

        expect(headers).toEqual(['#', 'EMPLEADO', 'BRUTO', 'BONIFIC.', 'DEDUCCIONES', 'PRÉSTAMOS', 'NETO']);
        expect(host.querySelector('th.payroll-review-table__number')).not.toBeNull();
        expect(host.querySelector('th.payroll-review-table__employee')).not.toBeNull();
        expect(html).toContain('payroll-review-table__amount is-bonus');
        expect(html).toContain('payroll-review-table__amount is-deduction');
    });

    test('review table shows selected active-loan discounts in red separately from deductions', () => {
        state.employees = [{
            id: 'e1',
            number: '12',
            name: 'Ada Lovelace',
            active: true,
            loans: [{
                id: 'loan-1',
                principal: 250,
                interestRate: 10,
                interestIncluded: false,
                status: 'active',
                payments: [],
                refinancings: []
            }]
        }];
        state.exportConfig.payrollLoanSelection = [{ employeeId: 'e1', loanIds: ['loan-1'] }];
        PayrollUI.setPayrollGuideStep('review');

        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const row = host.querySelector('tbody tr');

        expect(row.querySelector('.payroll-review-table__number').textContent.trim()).toBe('12');
        expect(row.querySelector('.payroll-review-table__employee').textContent.trim()).toBe('Ada Lovelace');
        expect(row.querySelector('.is-bonus').textContent.trim()).toBe('+$100.00');
        expect(row.querySelector('.is-deduction').textContent.trim()).toBe('−$300.00');
        expect(row.querySelector('.is-loan').textContent.trim()).toBe('−$275.00');
    });

    test('receivables renders a desktop table and keeps compact mobile indicators', () => {
        const html = LoansLedger();

        expect(html).toContain('class="loans-overview"');
        expect(html).toContain('class="loans-overview__summary"');
        expect(html).toContain('<table>');
        expect(html).toContain('class="loans-overview__mobile-kpis"');
        expect(html).toContain('Saldo pendiente');
        expect(html).toContain('Préstamos activos');
    });
});

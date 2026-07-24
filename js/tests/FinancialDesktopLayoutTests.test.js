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
        PayrollUI.init({
            state,
            services: { payroll: {} },
            render
        });
        window.PayrollUI = PayrollUI;
    });

    beforeEach(() => {
        render.mockClear();
        resetFinancialState();
    });

    test('payroll renders the four-step guide and sticky summary content', () => {
        const html = PayrollUI.PayrollTab();

        expect(html).toContain('class="payroll-guided-layout"');
        expect(html).toContain('aria-label="Pasos de nómina"');
        expect(html).toContain('data-value="period"');
        expect(html).toContain('data-value="adjustments"');
        expect(html).toContain('data-value="loans"');
        expect(html).toContain('data-value="review"');
        expect(html).toContain('aria-label="Resumen de nómina"');
        expect(html).toContain('Total neto');
    });

    test('changing the guide step exposes its panel without changing financial data', () => {
        const deductions = state.exportConfig.deductions;
        const bonuses = state.exportConfig.bonuses;

        PayrollUI.setPayrollGuideStep('loans');

        expect(state.exportConfig.payrollGuideStep).toBe('loans');
        expect(state.exportConfig.collapsedSteps).not.toContain('step2c');
        expect(state.exportConfig.deductions).toBe(deductions);
        expect(state.exportConfig.bonuses).toBe(bonuses);
        expect(PayrollUI.PayrollTab()).toMatch(
            /class="payroll-guide-step is-active [^"]*"[\s\S]{0,180}data-value="loans"/
        );
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

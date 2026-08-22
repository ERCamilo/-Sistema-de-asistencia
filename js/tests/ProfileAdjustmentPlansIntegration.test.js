import { state } from '../modules/core/AppState.js';
import { payrollService } from '../modules/services/index.js';
import { ProfileTabNomina } from '../modules/features/profile/ProfileTabs.js';
import {
    ADJUSTMENT_PLAN_KIND,
    createPayrollAdjustmentInstallmentPlans
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';

describe('Employee payroll profile scheduled adjustments integration', () => {
    let profileBefore;
    let settingsBefore;

    beforeEach(() => {
        profileBefore = state.employeeProfile;
        settingsBefore = state.settings;
        state.employeeProfile = {
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            deductionType: 'fixed',
            deductionValue: 0,
            deductions: [],
            expandedPositions: {},
            manualAdjustmentDraft: null
        };
        state.settings = {
            ...(settingsBefore || {}),
            regularHoursPerDay: 8,
            overtimeFactor: 1.35,
            payPeriod: {}
        };
        window.generateDeductionsHTML = jest.fn(() => '<div>Descuentos existentes</div>');
        window.generateBonusesHTML = jest.fn(() => '<div>Bonificaciones existentes</div>');
        window.generateAdvancesHTML = jest.fn(() => '<div>Adelantos existentes</div>');
        jest.spyOn(payrollService, 'calculateEmployeePayroll').mockReturnValue({
            bruto: 0,
            neto: 0,
            breakdown: []
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        state.employeeProfile = profileBefore;
        state.settings = settingsBefore;
        delete window.generateDeductionsHTML;
        delete window.generateBonusesHTML;
        delete window.generateAdvancesHTML;
    });

    test('renders the saved employee plan in the real payroll profile tab before legacy adjustments', () => {
        let serial = 0;
        const [plan] = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['EMP-1'],
            name: 'Uniforme',
            totalAmount: 90,
            installmentCount: 3,
            firstPeriodStart: '2026-08-01',
            createdAt: 100
        }, { createId: prefix => `${prefix}-integration-${++serial}` });
        const employee = {
            id: 'EMP-1',
            name: 'Ada',
            number: '1',
            deductions: [plan],
            bonuses: []
        };

        const markup = ProfileTabNomina(employee);
        const host = document.createElement('div');
        host.innerHTML = markup;

        const scheduled = host.querySelector('[data-employee-scheduled-adjustments]');
        const legacy = host.querySelector('#deductions-section');

        expect(scheduled).not.toBeNull();
        expect(scheduled.textContent).toContain('Uniforme');
        expect(scheduled.textContent).toContain('Registrar abono');
        expect(legacy).not.toBeNull();
        expect(scheduled.compareDocumentPosition(legacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

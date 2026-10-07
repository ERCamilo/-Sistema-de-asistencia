import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import payrollClosureStore from '../modules/features/payroll/PayrollClosureStore.js';

// Reproduce el error de producción: con obras activas, mientras la vista de la
// obra todavía no está habilitada (arranque, datos remotos aplicándose), Nómina
// renderizaba el generador legacy y PayrollService lanzaba
// LegacyPayrollUnavailableError.
function legacyCalculationUnavailable() {
    const error = new Error('Legacy payroll calculation unavailable while projects are enabled; use calculateEmployeePayrollScoped()');
    error.name = 'LegacyPayrollUnavailableError';
    throw error;
}

function setup(mode) {
    const state = {
        employees: [{ id: 'e1', number: '1', name: 'Uno', active: true, loans: [], bonuses: [], deductions: [] }],
        positions: [],
        leaders: [],
        attendance: {},
        settings: { payPeriod: { periodStart: '2026-09-11', periodLength: 21, payDay: '2026-10-03' } },
        exportConfig: { periodStart: '2026-09-11', periodEnd: '2026-10-01', deductions: [], bonuses: [] },
        payrollViewMode: mode
    };
    const calculateEmployeePayroll = jest.fn(legacyCalculationUnavailable);
    PayrollUI.init({
        state,
        services: {
            payroll: { calculateEmployeePayroll },
            payrollRuntime: {
                getCurrentView: () => ({ enabled: false, status: 'legacy', settingsView: state.settings }),
                subscribeInvalidation: () => () => {}
            }
        },
        render: jest.fn(),
        saveToLocalStorage: jest.fn()
    });
    return { calculateEmployeePayroll };
}

describe('Nómina con obras activas y la obra todavía no lista', () => {
    beforeEach(() => {
        localStorage.clear();
        setProjectsEnabled(true);
        jest.spyOn(payrollClosureStore, 'listPage').mockResolvedValue({ items: [], nextCursor: null });
        jest.spyOn(payrollClosureStore, 'getSyncStates').mockResolvedValue({});
    });

    afterEach(() => {
        jest.restoreAllMocks();
        setProjectsEnabled(false);
        localStorage.clear();
    });

    test('the generator shows a loading state instead of calling the legacy calculation', () => {
        const { calculateEmployeePayroll } = setup('generator');
        let html = '';
        expect(() => { html = PayrollUI.PayrollTab(); }).not.toThrow();
        expect(calculateEmployeePayroll).not.toHaveBeenCalled();
        document.body.innerHTML = html;
        expect(document.querySelector('[aria-busy="true"]').textContent).toContain('Preparando la nómina de la obra…');
        expect(document.querySelector('[data-value="history"]')).not.toBeNull();
        expect(document.querySelector('[data-value="ledger"]')).not.toBeNull();
    });

    test('the history stays reachable', () => {
        const { calculateEmployeePayroll } = setup('history');
        document.body.innerHTML = PayrollUI.PayrollTab();
        expect(document.querySelector('.payroll-history')).not.toBeNull();
        expect(calculateEmployeePayroll).not.toHaveBeenCalled();
    });

    test('export helpers never fall back to the legacy calculation', () => {
        const { calculateEmployeePayroll } = setup('generator');
        expect(() => PayrollUI.togglePayrollPreviewCategory('bonuses', false)).not.toThrow();
        expect(calculateEmployeePayroll).not.toHaveBeenCalled();
    });
});

import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import defaultClosureStore from '../modules/features/payroll/PayrollClosureStore.js';
import defaultClosureSync from '../modules/features/payroll/PayrollClosureSync.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';

function state(periodStart = '2026-09-01', periodEnd = '2026-09-15') {
    return {
        employees: [],
        positions: [],
        leaders: [],
        attendance: {},
        settings: {
            companyName: 'Offline payroll',
            regularHoursPerDay: 8,
            overtimeFactor: 1.5,
            holidayFactor: 2,
            holidays: [],
            payPeriod: { periodStart: '2026-09-01', periodLength: 15, payDay: '2026-09-15' },
            schemaVersion: 20
        },
        exportConfig: {
            periodStart,
            periodEnd,
            payrollLoanSelection: [],
            deductions: [],
            bonuses: []
        },
        payrollViewMode: 'generator'
    };
}

describe('R07 payroll history offline/auth retry guard', () => {
    beforeEach(() => {
        setProjectsEnabled(false);
        delete globalThis.currentUser;
        jest.restoreAllMocks();
    });

    afterEach(() => {
        delete globalThis.currentUser;
        jest.restoreAllMocks();
    });

    test('anonymous online render loads local once and does not retry remote on rerender', async () => {
        const getByPeriod = jest.spyOn(defaultClosureStore, 'getByPeriod').mockResolvedValue([]);
        const pullPeriod = jest.spyOn(defaultClosureSync, 'pullPeriod').mockResolvedValue({
            closures: [], imported: 0, conflicts: []
        });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const render = jest.fn();

        PayrollUI.init({
            state: state(),
            services: {
                payroll: {
                    calculateEmployeePayroll: () => ({
                        brutoOriginal: 0, neto: 0, breakdown: []
                    })
                }
            },
            render,
            saveToLocalStorage: jest.fn()
        });

        PayrollUI.PayrollTab();
        await Promise.resolve();
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(getByPeriod).toHaveBeenCalledTimes(1);
        expect(pullPeriod).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();

        PayrollUI.PayrollTab();
        await Promise.resolve();
        await Promise.resolve();

        expect(getByPeriod).toHaveBeenCalledTimes(1);
        expect(pullPeriod).not.toHaveBeenCalled();
        expect(render).toHaveBeenCalledTimes(1);
    });

    test('availability change from anonymous to authenticated allows one remote retry', async () => {
        const getByPeriod = jest.spyOn(defaultClosureStore, 'getByPeriod').mockResolvedValue([]);
        const pullPeriod = jest.spyOn(defaultClosureSync, 'pullPeriod').mockResolvedValue({
            closures: [], imported: 0, conflicts: []
        });

        PayrollUI.init({
            state: state('2026-10-01', '2026-10-15'),
            services: {
                payroll: {
                    calculateEmployeePayroll: () => ({
                        brutoOriginal: 0, neto: 0, breakdown: []
                    })
                }
            },
            render: jest.fn(),
            saveToLocalStorage: jest.fn()
        });

        PayrollUI.PayrollTab();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(pullPeriod).toHaveBeenCalledTimes(0);

        globalThis.currentUser = { uid: 'auth-restored' };
        PayrollUI.PayrollTab();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(pullPeriod).toHaveBeenCalledTimes(1);
        expect(getByPeriod).toHaveBeenCalledTimes(2);
    });
});

import { state } from '../modules/core/AppState.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import FirebaseService from '../modules/services/FirebaseService.js';
import {
    clearPayrollAdjustmentPeriodRuntime,
    getPayrollAdjustmentPeriodRuntimeSelections,
    setPayrollAdjustmentPeriodRuntimeSelection
} from '../modules/features/payroll/PayrollAdjustmentPeriodSelection.js';
import {
    ADJUSTMENT_PLAN_KIND,
    createPayrollAdjustmentInstallmentPlans
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import {
    applyPayrollAdjustmentInstallmentsForClosure,
    buildPayrollAdjustmentInstallmentPreview
} from '../modules/features/payroll/PayrollAdjustmentInstallmentSettlement.js';

const PERIOD = { periodStart: '2026-08-01', periodEnd: '2026-08-15' };

function reference(planId = 'runtime-plan-only') {
    return {
        kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
        planId,
        employeeId: 'EMP-RUNTIME',
        ...PERIOD
    };
}

describe('Payroll adjustment runtime selections stay outside persistence', () => {
    let previous;

    beforeEach(() => {
        previous = {
            exportConfig: state.exportConfig,
            settings: state.settings,
            employees: state.employees,
            positions: state.positions,
            leaders: state.leaders,
            attendance: state.attendance,
            isDataLoaded: state.isDataLoaded,
            useIndexedDB: state.useIndexedDB
        };
        clearPayrollAdjustmentPeriodRuntime();
        jest.clearAllMocks();
        state.exportConfig = { ...PERIOD, deductions: [], bonuses: [] };
        state.settings = { backupFrequency: 'none' };
        state.employees = [];
        state.positions = [];
        state.leaders = [];
        state.attendance = {};
        state.isDataLoaded = true;
        state.useIndexedDB = true;
    });

    afterEach(() => {
        clearPayrollAdjustmentPeriodRuntime();
        Object.assign(state, previous);
        delete globalThis.currentUser;
    });

    test('survives renders in memory, isolates periods and never enters saved or backup snapshots', async () => {
        const runtimeReference = reference();
        setPayrollAdjustmentPeriodRuntimeSelection(runtimeReference, {
            mode: 'count', count: 2
        });

        expect(getPayrollAdjustmentPeriodRuntimeSelections(
            PERIOD.periodStart, PERIOD.periodEnd
        )).toEqual([expect.objectContaining({
            planId: runtimeReference.planId,
            mode: 'count',
            count: 2
        })]);
        expect(getPayrollAdjustmentPeriodRuntimeSelections(
            '2026-08-16', '2026-08-31'
        )).toEqual([]);
        expect(state.exportConfig).not.toHaveProperty('payrollAdjustmentPeriodSelections');

        await saveApplicationData({ immediate: true, localOnly: true });

        expect(indexedDBService.saveState).toHaveBeenCalledTimes(1);
        const saved = JSON.parse(JSON.stringify(indexedDBService.saveState.mock.calls[0][0]));
        await FirebaseService.saveFullState(saved);
        await FirebaseService.createSnapshot(saved, 'manual', 'runtime-isolation');
        for (const payload of [
            saved,
            FirebaseService.saveFullState.mock.calls[0][0],
            FirebaseService.createSnapshot.mock.calls[0][0]
        ]) {
            const serialized = JSON.stringify(payload);
            expect(serialized).not.toContain('payrollAdjustmentPeriodSelections');
            expect(serialized).not.toContain(runtimeReference.planId);
            expect(serialized).not.toContain('runtime-isolation-token');
        }
    });

    test('passes an explicit temporary snapshot into preview and closure', () => {
        let serial = 0;
        const plan = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['EMP-RUNTIME'],
            name: 'Uniformes',
            totalAmount: 90,
            installmentCount: 3,
            firstPeriodStart: PERIOD.periodStart,
            createdAt: 100
        }, { createId: prefix => `${prefix}-runtime-${++serial}` })[0];
        const employee = {
            id: 'EMP-RUNTIME', name: 'Ada', bonuses: [], deductions: [plan]
        };
        setPayrollAdjustmentPeriodRuntimeSelection(reference(plan.id), {
            mode: 'count', count: 2
        });
        const selections = getPayrollAdjustmentPeriodRuntimeSelections(
            PERIOD.periodStart, PERIOD.periodEnd
        );
        const preview = buildPayrollAdjustmentInstallmentPreview(employee, {
            ...PERIOD,
            selections
        });
        const closure = {
            id: 'PAYROLL-RUNTIME', status: 'closed', ...PERIOD,
            rows: [{
                employeeId: employee.id,
                bonusDetails: preview.bonusDetails,
                deductionDetails: preview.deductionDetails
            }]
        };

        const result = applyPayrollAdjustmentInstallmentsForClosure(
            [employee], closure, { now: 200 }
        );

        expect(preview.deductionTotal).toBe(60);
        expect(preview.deductionDetails).toHaveLength(2);
        expect(result).toMatchObject({ appliedCount: 2 });
        expect(plan.history.filter(item => item.source === 'payroll')).toHaveLength(2);
    });

    test('a fresh module instance loses provisional choices without touching the plan', () => {
        const plan = { status: 'active', history: [], balance: 90 };
        jest.isolateModules(() => {
            const runtime = require(
                '../modules/features/payroll/PayrollAdjustmentPeriodSelection.js'
            );
            runtime.setPayrollAdjustmentPeriodRuntimeSelection(reference(), {
                mode: 'full'
            });
            expect(runtime.getPayrollAdjustmentPeriodRuntimeSelections(
                PERIOD.periodStart, PERIOD.periodEnd
            )).toHaveLength(1);
        });
        jest.isolateModules(() => {
            const runtime = require(
                '../modules/features/payroll/PayrollAdjustmentPeriodSelection.js'
            );
            expect(runtime.getPayrollAdjustmentPeriodRuntimeSelections(
                PERIOD.periodStart, PERIOD.periodEnd
            )).toEqual([]);
        });
        expect(plan).toEqual({ status: 'active', history: [], balance: 90 });
    });
});

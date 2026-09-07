import fs from 'fs';
import path from 'path';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { state } from '../modules/core/AppState.js';
import { payrollService } from '../modules/services/index.js';
import { ProfileTabNomina } from '../modules/features/profile/ProfileTabs.js';
import { EmployeeStatsService } from '../modules/features/stats/EmployeeStatsService.js';
import { EmployeeFloatingCard } from '../modules/ui/components/EmployeeFloatingCard.js';
import { buildEmployeePositionPeriodSnapshot } from '../modules/features/employees/EmployeePositionMetrics.js';
import { renderEmployeePositionEditor } from '../modules/features/employees/EmployeePositionEditor.js';

const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

describe('legacy payroll surfaces while projects are enabled', () => {
    afterEach(() => {
        setProjectsEnabled(false);
        state.showFloatingCard = false;
        state.floatingCardEmployee = null;
        jest.restoreAllMocks();
    });

    test('profile payroll tab renders scoped-unavailable without legacy calculation', () => {
        setProjectsEnabled(true);
        const calculate = jest.spyOn(payrollService, 'calculateEmployeePayroll');

        const markup = ProfileTabNomina({ id: 'EMP-A', name: 'Ada' });

        expect(markup).toContain('data-scoped-payroll-unavailable');
        expect(calculate).not.toHaveBeenCalled();
    });

    test('floating card omits gross and its stats service does not calculate legacy payroll', () => {
        setProjectsEnabled(true);
        const calculateEmployeePayroll = jest.fn();
        const employee = { id: 'EMP-A', name: 'Ada', positions: [] };
        const statsService = new EmployeeStatsService({
            employees: [employee],
            attendance: {},
            settings: { payPeriod: { periodStart: '2026-09-01', periodLength: 15 } }
        }, { calculateEmployeePayroll }, null);

        const summary = statsService.getFloatingCardSummary(employee.id, new Date('2026-09-06T12:00:00'));
        expect(summary.stats.gross).toBeNull();
        expect(calculateEmployeePayroll).not.toHaveBeenCalled();

        state.showFloatingCard = true;
        state.floatingCardEmployee = employee;
        state.floatingCardMonth = new Date('2026-09-01T12:00:00');
        const markup = new EmployeeFloatingCard({ getFloatingCardSummary: () => summary }).render();
        expect(markup).not.toContain('earnings-highlight');
        expect(markup).not.toContain('Ganancias Brutas');
    });

    test('employee editor omits accrued payroll without building a legacy snapshot', () => {
        setProjectsEnabled(true);
        const employee = { id: 'EMP-A', positions: ['POS-A'], positionSalaries: {}, positionSalaryModes: {} };
        const editorState = {
            employees: [employee],
            positions: [{ id: 'POS-A', name: 'Operator', hourlyRate: 100, workingDays: [1, 2, 3, 4, 5] }],
            attendance: {},
            settings: { regularHoursPerDay: 8, payPeriod: { periodStart: '2026-09-01', periodLength: 15 } }
        };

        const snapshot = buildEmployeePositionPeriodSnapshot(editorState, employee);
        const markup = renderEmployeePositionEditor(editorState, employee, 8);

        expect(snapshot.payrollAvailable).toBe(false);
        expect(snapshot.metricsByPosition.size).toBe(0);
        expect(markup).not.toContain('data-position-accrued');
        expect(markup).not.toContain('<small>Acumulado</small>');
    });

    test('legacy updatePayrollUI checks the projects gate before calculating', () => {
        const start = APP_SOURCE.indexOf('function updatePayrollUI(');
        const end = APP_SOURCE.indexOf('window.updatePayrollUI = updatePayrollUI;', start);
        const block = APP_SOURCE.slice(start, end);
        const gate = block.indexOf('if (isProjectsEnabled()) return;');
        const calculation = block.indexOf('payrollService.calculateEmployeePayroll(');

        expect(start).toBeGreaterThanOrEqual(0);
        expect(gate).toBeGreaterThanOrEqual(0);
        expect(calculation).toBeGreaterThan(gate);
    });
});

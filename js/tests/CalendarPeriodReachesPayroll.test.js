/**
 * El período de Ajustes → Calendario llega a Nómina, Reportes y la lista de
 * asistencia; un día con asistencia registrada no oculta al empleado.
 */
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
import { ProjectPayrollUIRuntime } from 'actual/features/payroll/ProjectPayrollUIRuntime.js';
import { clearPayrollAdjustmentPeriodRuntime } from 'actual/features/payroll/PayrollAdjustmentPeriodSelection.js';
import { isEmployeeVisibleOnDate } from '../modules/utils/DateUtils.js';
import { DashboardDateManagerV2 } from '../modules/utils/DateManagers.js';
import { setActivePayrollConfig, resetActivePayrollSettingsForTests } from '../modules/features/payroll/ActivePayrollSettings.js';

const PRJ = 'PRJ-cal-0001';
const config = (periodStart) => ({ ...createDefaultConfig(PRJ), projectId: PRJ, payPeriod: { periodStart, periodLength: 7, payDay: null } });
const makeState = () => ({ employees: [], positions: [], leaders: [], attendance: {}, exportConfig: {},
    settings: { regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-01-01', periodLength: 15 } } });

beforeEach(() => {
    localStorage.clear();
    clearPayrollAdjustmentPeriodRuntime();
    resetActivePayrollSettingsForTests();
    setProjectsEnabled(true);
    replaceEntityScope({ enabled: true, projectId: PRJ, defaultProjectId: PRJ });
});
afterEach(() => { resetEntityScope(); setProjectsEnabled(false); });

test('Nómina sigue el período configurado aunque ya se haya generado una vista previa', async () => {
    let stored = config('2026-09-15');
    const configStore = { getConfig: jest.fn(async () => stored), putConfig: jest.fn(async next => { stored = next; return next; }) };
    const runtime = new ProjectPayrollUIRuntime({ state: makeState(), configStore });
    const today = new Date('2026-09-20T12:00:00');
    const first = await runtime.generatePreview({ today });
    expect(first.period).toMatchObject({ periodStart: '2026-09-15', periodEnd: '2026-09-21' });

    // «Avanzar período» en Calendario.
    await runtime.updateConfig(current => ({ ...current, payPeriod: { ...current.payPeriod, periodStart: '2026-09-22' } }));
    const after = await runtime.generatePreview({ today: new Date('2026-09-23T12:00:00') });
    expect(after.period).toMatchObject({ periodStart: '2026-09-22', periodEnd: '2026-09-28' });
    runtime.dispose();
});

test('un período elegido a mano se conserva al volver a generar', async () => {
    const stored = config('2026-09-15');
    const runtime = new ProjectPayrollUIRuntime({ state: makeState(), configStore: { getConfig: async () => stored, putConfig: async c => c } });
    await runtime.generatePreview({ periodStart: '2026-08-01', periodEnd: '2026-08-31', preset: null });
    const again = await runtime.generatePreview({ today: new Date('2026-09-20T12:00:00') });
    expect(again.period).toMatchObject({ periodStart: '2026-08-01', periodEnd: '2026-08-31' });
    runtime.dispose();
});

test('Reportes: «Período de pago» usa el de la obra activa', () => {
    setActivePayrollConfig(config('2026-09-22'), { render: false });
    const state = makeState();
    const manager = new DashboardDateManagerV2(state, null);
    manager.setPayPeriod();
    expect(state.dashboardStartDate).toBe('2026-09-22');
    expect(state.dashboardEndDate).toBe('2026-09-28');
});

test('un día con asistencia registrada (p. ej. de Mini) no oculta al empleado aunque sea antes de su contratación', () => {
    const emp = { id: 'e34', number: '34', active: true, hireDate: '2026-09-20', statusHistory: [] };
    expect(isEmployeeVisibleOnDate(emp, '2026-09-19', {}).visible).toBe(false);
    const attendance = { 'e34-2026-09-19': { employeeId: 'e34', date: '2026-09-19', present: true, hoursWorked: 8 } };
    expect(isEmployeeVisibleOnDate(emp, '2026-09-19', attendance)).toEqual({ visible: true, flagged: true });
    attendance['e34-2026-09-19'].deletedAt = 5;
    expect(isEmployeeVisibleOnDate(emp, '2026-09-19', attendance).visible).toBe(false);
});

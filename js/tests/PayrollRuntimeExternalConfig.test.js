/** Nómina abierta recibe la configuración que llegó de otro dispositivo. */
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
import { ProjectPayrollUIRuntime } from 'actual/features/payroll/ProjectPayrollUIRuntime.js';
import { clearPayrollAdjustmentPeriodRuntime } from 'actual/features/payroll/PayrollAdjustmentPeriodSelection.js';

const PRJ = 'PRJ-ext-0001';
const config = (periodStart, updatedAt) => ({ ...createDefaultConfig(PRJ), projectId: PRJ, updatedAt, payPeriod: { periodStart, periodLength: 7, payDay: null } });

beforeEach(() => { clearPayrollAdjustmentPeriodRuntime(); setProjectsEnabled(true); replaceEntityScope({ enabled: true, projectId: PRJ, defaultProjectId: PRJ }); });
afterEach(() => { resetEntityScope(); setProjectsEnabled(false); });

test('una configuración recibida por la nube reemplaza la de la sesión y recalcula el período', async () => {
    let stored = config('2026-09-15', 1);
    const runtime = new ProjectPayrollUIRuntime({ state: { employees: [], positions: [], leaders: [], attendance: {}, settings: {}, exportConfig: {} },
        configStore: { getConfig: async () => stored, putConfig: async c => c } });
    await runtime.generatePreview({ today: new Date('2026-09-20T12:00:00') });
    stored = config('2026-09-22', 2);
    window.dispatchEvent(new CustomEvent('payroll-config:changed', { detail: { source: 'catalog-sync', config: stored } }));
    expect(runtime.getCurrentView().config.payPeriod.periodStart).toBe('2026-09-22');
    expect(runtime.getCurrentView().period).toBeNull();
    const again = await runtime.generatePreview({ today: new Date('2026-09-23T12:00:00') });
    expect(again.period).toMatchObject({ periodStart: '2026-09-22' });
    runtime.dispose();
});

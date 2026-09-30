/** Horas base por día de la obra activa (antes eran generales para todas las obras). */
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import {
    getActiveDayHours,
    updateActiveDayHours,
    setActivePayrollConfig,
    resetActivePayrollSettingsForTests
} from '../modules/features/payroll/ActivePayrollSettings.js';
import { toConfigDoc } from '../modules/features/projects/ProjectCatalogSync.js';

const OBRA = 'PRJ-horas-0001';
beforeEach(() => { resetActivePayrollSettingsForTests(); setProjectsEnabled(true); replaceEntityScope({ enabled: true, projectId: OBRA, defaultProjectId: OBRA }); });
afterEach(() => { resetEntityScope(); setProjectsEnabled(false); });

test('sin horas propias usa las generales; con horas propias, las de la obra', () => {
    const state = { dayHoursConfig: { '2026-09-01': 6 } };
    setActivePayrollConfig({ projectId: OBRA, updatedAt: 1 }, { render: false });
    expect(getActiveDayHours(state)).toEqual({ '2026-09-01': 6 });
    setActivePayrollConfig({ projectId: OBRA, updatedAt: 2, dayHours: { '2026-09-02': 4 } }, { render: false });
    expect(getActiveDayHours(state)).toEqual({ '2026-09-02': 4 });
});

test('guardar horas base las pone en la configuración de la obra (partiendo de las generales) y no toca las generales', async () => {
    const state = { dayHoursConfig: { '2026-09-01': 6 } };
    let saved = null;
    const store = { getConfig: async () => ({ projectId: OBRA, updatedAt: 1 }), putConfig: async config => (saved = { ...config, updatedAt: 5 }) };
    expect(await updateActiveDayHours({ '2026-09-03': 7 }, { state, store })).toBe(true);
    expect(saved.dayHours).toEqual({ '2026-09-01': 6, '2026-09-03': 7 });
    expect(getActiveDayHours(state)).toEqual({ '2026-09-01': 6, '2026-09-03': 7 });
    expect(state.dayHoursConfig).toEqual({ '2026-09-01': 6 });
});

test('las horas base viajan con la configuración de la obra', () => {
    expect(toConfigDoc({ projectId: OBRA, updatedAt: 3, dayHours: { '2026-09-03': 7 } }).dayHours).toEqual({ '2026-09-03': 7 });
});

test('sin obras no cambia nada', async () => {
    setProjectsEnabled(false);
    const state = { dayHoursConfig: { '2026-09-01': 6 } };
    expect(getActiveDayHours(state)).toBe(state.dayHoursConfig);
    expect(await updateActiveDayHours({ '2026-09-03': 7 }, { state })).toBe(false);
});

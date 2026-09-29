/** Reportes muestran solo la obra activa; las escrituras van al estado real. */
import { init, getReportsState } from '../modules/features/analytics/AnalyticsUI.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';

afterEach(() => { resetEntityScope(); setProjectsEnabled(false); });

test('solo empleados de la obra activa; sin obras, todos', () => {
    const state = { employees: [{ id: 'a', projectId: 'PRJ-uno-0001' }, { id: 'b', projectId: 'PRJ-dos-0002' }], attendance: {}, settings: {} };
    init({ state, render: () => {}, saveToLocalStorage: () => {} });
    expect(getReportsState().employees.map(e => e.id)).toEqual(['a', 'b']);

    setProjectsEnabled(true);
    replaceEntityScope({ enabled: true, projectId: 'PRJ-uno-0001', defaultProjectId: 'PRJ-uno-0001' });
    expect(getReportsState().employees.map(e => e.id)).toEqual(['a']);

    getReportsState().dashboardStartDate = '2026-09-01';
    expect(state.dashboardStartDate).toBe('2026-09-01');
    expect(state.employees).toHaveLength(2);
});

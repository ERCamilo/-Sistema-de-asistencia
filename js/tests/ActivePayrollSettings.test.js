/**
 * La interfaz (asistencia, panel lateral, calendario, préstamos, analítica) lee
 * la configuración de nómina de la OBRA ACTIVA, la misma que se edita en
 * Ajustes → Calendario. Antes leía la configuración general antigua.
 */
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import {
    getActivePayrollSettings,
    setActivePayrollConfig,
    refreshActivePayrollSettings,
    resetActivePayrollSettingsForTests,
    ACTIVE_PAYROLL_SETTING_FIELDS
} from '../modules/features/payroll/ActivePayrollSettings.js';
import { PROJECT_PAYROLL_UI_CONFIG_FIELDS } from '../modules/features/payroll/ProjectPayrollUIRuntime.js';
import { state } from '../modules/core/AppState.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { toggleHoliday } from '../modules/ui/AttendanceHandlers.js';

const OBRA = 'PRJ-activa-0001';
const OTRA = 'PRJ-otra-0002';
const legacy = { payPeriod: { periodStart: '2026-01-01', periodLength: 15 }, regularHoursPerDay: 8, holidays: ['2026-01-01'], companyName: 'X' };
const obraConfig = { projectId: OBRA, payPeriod: { periodStart: '2026-09-10', periodLength: 21, payDay: '2026-10-01' }, regularHoursPerDay: 9, holidays: ['2026-09-24'], overtimeFactor: 1.5, holidayFactor: 2 };

beforeEach(() => {
    resetActivePayrollSettingsForTests();
    setProjectsEnabled(true);
    replaceEntityScope({ enabled: true, projectId: OBRA, defaultProjectId: OBRA });
});
afterEach(() => { resetEntityScope(); jest.restoreAllMocks(); });

test('los campos coinciden con los de la configuración de obra', () => {
    expect([...ACTIVE_PAYROLL_SETTING_FIELDS].sort()).toEqual([...PROJECT_PAYROLL_UI_CONFIG_FIELDS].sort());
});

test('sin configuración cargada usa la general; con ella, la de la obra activa', () => {
    const appState = { settings: legacy };
    expect(getActivePayrollSettings(appState)).toBe(legacy);
    setActivePayrollConfig(obraConfig, { render: false });
    const view = getActivePayrollSettings(appState);
    expect(view.payPeriod).toEqual(obraConfig.payPeriod);
    expect(view.regularHoursPerDay).toBe(9);
    expect(view.holidays).toEqual(['2026-09-24']);
    expect(view.companyName).toBe('X');
    expect(getActivePayrollSettings(appState)).toBe(view); // memo en bucles de render
});

test('la configuración de otra obra no se aplica', () => {
    setActivePayrollConfig({ ...obraConfig, projectId: OTRA }, { render: false });
    expect(getActivePayrollSettings({ settings: legacy })).toBe(legacy);
});

test('sin obras activas se mantiene el comportamiento anterior', () => {
    setActivePayrollConfig(obraConfig, { render: false });
    setProjectsEnabled(false);
    expect(getActivePayrollSettings({ settings: legacy })).toBe(legacy);
});

test('refresh carga la configuración de la obra activa', async () => {
    const store = { getConfig: jest.fn().mockResolvedValue(obraConfig) };
    await refreshActivePayrollSettings({ render: false, store });
    expect(store.getConfig).toHaveBeenCalledWith(OBRA);
    expect(getActivePayrollSettings({ settings: legacy }).payPeriod.periodLength).toBe(21);
});

test('marcar feriado solo toca la asistencia de la obra activa y no la configuración general', () => {
    setActivePayrollConfig(obraConfig, { render: false });
    jest.spyOn(indexedDBService, 'get').mockResolvedValue(obraConfig);
    const snapshot = { settings: state.settings, attendance: state.attendance };
    state.settings = { ...legacy, holidays: [...legacy.holidays] };
    state.attendance = {
        'a-2026-09-25': { employeeId: 'a', date: '2026-09-25', projectId: OBRA, present: true },
        'b-2026-09-25': { employeeId: 'b', date: '2026-09-25', projectId: OTRA, present: true }
    };
    try {
        toggleHoliday('2026-09-25');
        expect(state.attendance['a-2026-09-25'].isHoliday).toBe(true);
        expect(state.attendance['b-2026-09-25'].isHoliday).toBeUndefined();
        expect(state.settings.holidays).toEqual(['2026-01-01']);
    } finally {
        state.settings = snapshot.settings;
        state.attendance = snapshot.attendance;
    }
});

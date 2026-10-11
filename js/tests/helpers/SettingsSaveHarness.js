// Executes the shipped save handler; the implementation is never copied into tests.
import fs from 'fs';
import path from 'path';
import * as drafts from '../../modules/ui/settings/SettingsDraftBar.js';
import { reconcileSettingsDraftBeforeSave } from '../../modules/ui/SettingsUI.js';

export function createSettingsSaveHarness(overrides = {}) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
    const start = source.indexOf('window.saveSettings = function');
    const end = source.indexOf('\n};', start) + 3;
    const expression = source.slice(start, end).replace('window.saveSettings = ', '').replace(/;\s*$/, '');
    const state = { settings: { companyName: 'Empresa', regularHoursPerDay: 8,
        overtimeFactor: 1.5, holidayFactor: 2, restDayFactor: 1.5,
        defaultDeductionPercentage: 2, scrollbarMode: 'always' }, weather: {} };
    const dependencies = {
        state, document, isProjectsEnabled: () => false,
        payrollUIRuntime: { getCurrentView: jest.fn(), updateConfig: jest.fn() },
        showNotification: jest.fn(), saveApplicationData: jest.fn(), render: jest.fn(),
        stateManager: { batchSetState: callback => callback() },
        updateWeatherApiKeyProvider: jest.fn(),
        guardSettingsDraftBeforeSave: drafts.guardSettingsDraftBeforeSave,
        reconcileSettingsDraftBeforeSave,
        ...overrides
    };
    const save = new Function(...Object.keys(dependencies), `return (${expression});`)(...Object.values(dependencies));
    return { ...dependencies, save };
}

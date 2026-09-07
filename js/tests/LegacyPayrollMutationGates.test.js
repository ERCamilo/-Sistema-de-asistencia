jest.mock('../modules/core/RenderManager.js', () => ({
    render: jest.fn()
}));

jest.mock('../modules/services/PersistenceService.js', () => ({
    saveApplicationData: jest.fn()
}));

import fs from 'fs';
import path from 'path';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { ProjectScopedGateError } from '../modules/config/TandaBGate.js';
import { state } from '../modules/core/AppState.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';
import {
    addAdvance,
    removeAdvance,
    updateAdvanceValue,
    updateAdvanceDate,
    updateAdvanceInterest,
    updateAdvanceNote,
    saveAdvance
} from '../modules/features/loans/LegacyAdvancesBridge.js';
import { migrateAllAdvances } from '../modules/features/loans/LoansController.js';
import { syncProfileToMaster } from '../modules/features/profile/ProfileController.js';

const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function seedProfile() {
    const employee = {
        id: 'EMP-LEGACY',
        deductions: [{ id: 'DED-1', type: 'fixed', value: 10 }],
        bonuses: [{ id: 'BON-1', type: 'fixed', value: 20 }],
        advances: [{ id: 'ADV-1', amount: 30, date: '2026-09-06', interest: 0, note: '' }]
    };
    state.employees = [employee];
    state.employeeProfile = {
        employeeId: employee.id,
        deductions: clone(employee.deductions),
        bonuses: clone(employee.bonuses),
        advances: clone(employee.advances),
        editingAdvances: { 0: true }
    };
    return state.employees[0];
}

function expectScopedGate(fn) {
    let error;
    try {
        fn();
    } catch (caught) {
        error = caught;
    }
    expect(error).toBeInstanceOf(ProjectScopedGateError);
    expect(error.code).toBe('TANDA_B_BLOCKED_WHEN_SCOPED');
}

function appBlock(name) {
    const start = APP_SOURCE.indexOf(`window.${name} =`);
    const end = APP_SOURCE.indexOf('\n};', start);
    return APP_SOURCE.slice(start, end);
}

describe('legacy payroll mutation gates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setProjectsEnabled(true);
    });

    afterEach(() => {
        setProjectsEnabled(false);
    });

    test.each([
        'addDeduction', 'removeDeduction', 'updateDeductionType', 'updateDeductionValue',
        'addBonus', 'removeBonus', 'updateBonusType', 'updateBonusValue',
        'addAdvance', 'removeAdvance', 'updateAdvanceValue', 'updateAdvanceDate',
        'updateAdvanceInterest', 'updateAdvanceNote', 'saveAdvance'
    ])('app.%s gates before its legacy mutation', name => {
        const block = appBlock(name);
        const gate = block.indexOf('assertTandaBBlockedWhenScoped(');
        const mutation = block.indexOf('state.employeeProfile');

        expect(block).toContain('assertTandaBBlockedWhenScoped(');
        expect(gate).toBeGreaterThanOrEqual(0);
        expect(mutation).toBeGreaterThanOrEqual(0);
        expect(gate).toBeLessThan(mutation);
    });

    test('LegacyAdvancesBridge handlers fail before changing scratch state', () => {
        seedProfile();
        const before = clone(state.employeeProfile);

        expectScopedGate(() => addAdvance());
        expectScopedGate(() => removeAdvance(0));
        expectScopedGate(() => updateAdvanceValue(0, '99'));
        expectScopedGate(() => updateAdvanceDate(0, '2026-10-01'));
        expectScopedGate(() => updateAdvanceInterest(0, '5'));
        expectScopedGate(() => updateAdvanceNote(0, 'blocked'));
        expectScopedGate(() => saveAdvance(0));

        expect(state.employeeProfile).toEqual(before);
        expect(saveApplicationData).not.toHaveBeenCalled();
    });

    test('syncProfileToMaster fails before copying legacy payroll arrays', () => {
        const employee = seedProfile();
        const before = clone(employee);
        state.employeeProfile.deductions[0].value = 999;

        expectScopedGate(() => syncProfileToMaster(employee.id));

        expect(employee).toEqual(before);
        expect(saveApplicationData).not.toHaveBeenCalled();
    });

    test('legacy advance migration fails before changing employee loans', () => {
        const employee = seedProfile();
        const before = clone(employee);

        expectScopedGate(() => migrateAllAdvances());

        expect(employee).toEqual(before);
        expect(saveApplicationData).not.toHaveBeenCalled();
    });

    test('OFF preserves legacy bridge and profile sync behavior', () => {
        const employee = seedProfile();
        setProjectsEnabled(false);

        updateAdvanceValue(0, '99');
        expect(state.employeeProfile.advances[0].amount).toBe(99);
        expect(saveApplicationData).toHaveBeenCalledWith({ immediate: true });

        saveApplicationData.mockClear();
        state.employeeProfile.deductions[0].value = 77;
        expect(syncProfileToMaster(employee.id)).toBe(true);
        expect(employee.deductions[0].value).toBe(77);
        expect(saveApplicationData).toHaveBeenCalledWith({ immediate: true });
    });
});

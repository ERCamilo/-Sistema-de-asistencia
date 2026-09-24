import { diagnoseExtendedProjectData } from '../modules/features/projects/ProjectExtendedDiagnostics.js';
import { buildLocalReconciliationViewModel, openProjectReconciliation, closeProjectReconciliation,
    renderProjectReconciliationSettingsAction } from '../modules/features/projects/ProjectReconciliationUI.js';
import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import * as repair from '../modules/features/projects/ProjectOwnershipRepairService.js';
const projects = [{ id: 'A', name: 'Obra A', status: 'active' }, { id: 'B', name: 'Obra B', status: 'archived' }];
const plan = { id: 'plan', recordType: 'payroll-adjustment-installment-plan', version: 1, employeeId: 'e', projectId: 'B' };
const setup = { enabled: true, projects, activeProjectId: 'A', defaultProjectId: 'A' };
const fixture = () => ({
    employees: [{ id: 'e', name: 'Ana', projectId: 'A', bonuses: [plan], deductions: [] }],
    payrollClosures: [{ id: 'c', projectId: 'missing', periodStart: '2026-09-01', periodEnd: '2026-09-15' }],
    projectPayrollConfigs: [{ projectId: 'missing' }],
    attendance: { 'gone-2026-09-01': { employeeId: 'gone', date: '2026-09-01', projectId: 'missing' } }
});
test('detects all four categories without changing financial data', () => {
    const data = fixture(), before = JSON.stringify(data);
    const result = diagnoseExtendedProjectData(data, projects);
    expect(result.map(row => row.kind)).toEqual(['closures', 'configs', 'plans', 'attendance']);
    expect(result.find(row => row.kind === 'plans').reason).toContain('no coincide');
    expect(JSON.stringify(data)).toBe(before);
    result[0].label = 'changed';
    expect(JSON.stringify(data)).toBe(before);
});
test('archived valid ownership and ordinary legacy adjustments are not orphans', () => {
    expect(diagnoseExtendedProjectData({
        payrollClosures: [{ projectId: 'B' }], projectPayrollConfigs: [{ projectId: 'A' }],
        employees: [{ id: 'e', projectId: 'B', bonuses: [plan, { amount: 20 }] }],
        attendance: [{ employeeId: 'e', projectId: 'B' }]
    }, projects)).toEqual([]);
});
test('counts missing employees once, including attendance assigned to a valid work', () => {
    const data = fixture();
    data.attendance.valid = { employeeId: 'also-gone', projectId: 'A' };
    const result = buildLocalReconciliationViewModel(data, setup);
    expect(result.totalPendingCount).toBe(5);
    expect(result.otherIssues).toEqual([]);
    expect(result.employeeRows).toEqual([]);
});
test('detects unscoped closures, configurations and modern plans without inventing ownership', () => {
    const result = diagnoseExtendedProjectData({
        payrollClosures: [{ id: 'c' }], projectPayrollConfigs: [{}],
        employees: [{ id: 'e', bonuses: [{ ...plan, projectId: null }] }],
        attendance: [{ date: '2026-09-01' }]
    }, projects);
    expect(result).toHaveLength(4);
});
describe('diagnostic-only UI', () => {
    beforeEach(() => {
        setProjectsEnabled(true);
        document.body.innerHTML = '';
        state.employees = fixture().employees; state.attendance = fixture().attendance;
        state.positions = []; state.leaders = [];
        jest.spyOn(projectSetupService, 'getState').mockResolvedValue(setup);
        jest.spyOn(indexedDBService, 'getAll').mockImplementation(async store => fixture()[store] || []);
    });
    afterEach(() => { closeProjectReconciliation(); jest.restoreAllMocks(); });
    test('review and close never apply a repair or show assignment controls', async () => {
        const apply = jest.spyOn(repair, 'applyOwnershipRepair');
        const writes = jest.spyOn(indexedDBService, 'update');
        await openProjectReconciliation();
        expect(document.querySelector('[aria-label="Pendientes de revisión especial"]')).not.toBeNull();
        expect(document.querySelectorAll('details')).toHaveLength(4);
        expect(document.querySelector('[data-r07-action="quick-assign"]')).toBeNull();
        expect(document.querySelector('[data-r07-action="apply"]')).toBeNull();
        expect(renderProjectReconciliationSettingsAction()).not.toContain('al día');
        document.querySelector('[data-r07-action="close"]').click();
        expect(apply).not.toHaveBeenCalled();
        expect(writes).not.toHaveBeenCalled();
    });
    test('failed store read is visible and cannot claim everything is up to date', async () => {
        state.employees = []; state.attendance = {};
        indexedDBService.getAll.mockImplementation(async store => {
            if (store === 'payrollClosures') throw new Error('unavailable');
            return [];
        });
        await openProjectReconciliation();
        expect(document.body.textContent).toContain('Revisión incompleta');
        expect(renderProjectReconciliationSettingsAction()).not.toContain('al día');
        expect(document.querySelector('[data-r07-action="apply"]')).toBeNull();
    });
});

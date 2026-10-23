import { registerPettyCashGlobals } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';
import { PettyCashStore } from '../modules/features/pettycash/PettyCashStore.js';
import { indexedDBService } from '../modules/services/IndexedDBService.js';
import { EmployeeModal } from '../modules/ui/modals/EmployeeModal.js';
import { PositionModal } from '../modules/ui/modals/PositionModal.js';
import { LeaderModal } from '../modules/ui/modals/LeaderModal.js';
import { putConfig } from '../modules/features/payroll/ProjectPayrollConfigStore.js';
import { rememberProjectWriteStates, assertProjectWritable, requireWritableProject } from '../modules/features/projects/ProjectWriteGuard.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { stampAttendanceWrite, tombstoneAttendanceWrite } from '../modules/features/attendance/AttendanceRecordWriter.js';
import { createLoan } from '../modules/features/loans/LoansService.js';
import { applyMiniAttendancePlan } from '../modules/features/attendance/MiniAttendanceImportService.js';
import { projectStore } from '../modules/features/projects/ProjectStore.js';
import { ProjectContextService } from '../modules/features/projects/ProjectContext.js';
import { DefaultProjectService } from '../modules/features/projects/DefaultProject.js';

beforeEach(() => {
    localStorage.clear(); setProjectsEnabled(true);
    replaceEntityScope({ enabled: true, projectId: 'paused', defaultProjectId: 'paused' });
    rememberProjectWriteStates([{ id: 'paused', status: 'paused' }]);
});
afterEach(() => setProjectsEnabled(false));
test.each(['paused', 'closed', 'archived'])('%s blocks local writes before mutating attendance and loans', status => {
    rememberProjectWriteStates([{ id: 'paused', status }]);
    const record = { employeeId: 'emp', projectId: 'paused', present: true };
    expect(() => stampAttendanceWrite(record)).toThrow(/no permite/);
    expect(() => tombstoneAttendanceWrite(record)).toThrow(/no permite/);
    const employee = { id: 'emp', projectId: 'paused', loans: [] };
    expect(() => createLoan(employee, { amount: 100, date: '2026-01-01' })).toThrow();
    expect(employee.loans).toEqual([]);
    expect(record).not.toHaveProperty('updatedAt');
});
test('async entry rereads lifecycle; missing/deleted projects fail closed', async () => {
    for (const project of [null, { status: 'paused' }, { status: 'active', deletedAt: 1 }]) {
        await expect(requireWritableProject('x', { store: { get: async () => project } })).rejects.toThrow();
    }
    await expect(requireWritableProject('x', { store: { get: async () => ({ status: 'active' }) } })).resolves.toBeUndefined();
});
test('legacy mode remains writable and resume refreshes policy', () => {
    setProjectsEnabled(false);
    expect(stampAttendanceWrite({ present: true }).present).toBe(true);
    setProjectsEnabled(true);
    rememberProjectWriteStates([{ id: 'paused', status: 'active' }]);
    expect(() => assertProjectWritable('paused')).not.toThrow();
});
test('paused default retains ownership; fallback selects an active project independently', async () => {
    localStorage.setItem('asistencia_default_project_id', 'paused');
    const rows = [{ id: 'paused', status: 'paused' }, { id: 'active', status: 'active' }];
    const store = { get: async id => rows.find(row => row.id === id), listAll: async () => rows, create: jest.fn() };
    const defaults = new DefaultProjectService({ store, crossTabLock: { run: async (_, fn) => fn() } });
    expect((await defaults.ensureDefaultProject()).id).toBe('paused');
    const context = new ProjectContextService({ store, defaults });
    expect(await context.getActiveProjectId()).toBe('active');
    expect(localStorage.getItem('asistencia_default_project_id')).toBe('paused');
    expect(store.create).not.toHaveBeenCalled();
});

test('Mini attendance refuses a paused destination before any batch or persistence', async () => {
    const get = jest.spyOn(projectStore, 'get').mockResolvedValue({ id: 'paused', status: 'paused' });
    const batchSetState = jest.fn(), saveApplicationData = jest.fn();
    const date = '2026-10-23';
    const record = { employeeId: 'emp', projectId: 'paused', date, present: true, hoursWorked: 8, overtimeHours: 0, selectedPosition: 'pos', multiPosition: false, positionHours: [{ positionId: 'pos', hours: 8, overtimeHours: 0 }] };
    try {
        await expect(applyMiniAttendancePlan({ date, draftRevision: 1, conflictRevision: 1, keptKeys: [], writes: [{ key: `emp-${date}`, record }] }, { deps: { state: { attendance: {} }, batchSetState, saveApplicationData } })).rejects.toThrow(/no permite/);
        expect(batchSetState).not.toHaveBeenCalled();
        expect(saveApplicationData).not.toHaveBeenCalled();
    } finally { get.mockRestore(); }
});

test('personal forms and payroll settings reject paused writes before changing data', async () => {
    const previousAlert = window.showAlert;
    window.showAlert = jest.fn();
    try {
        for (const modal of [EmployeeModal, PositionModal, LeaderModal]) {
            modal.save({}, { id: 'e', projectId: 'paused' });
        }
        expect(window.showAlert).toHaveBeenCalledTimes(3);
        const idb = { update: jest.fn() };
        await expect(putConfig({ projectId: 'paused' }, { idb })).rejects.toThrow(/no permite/);
        expect(idb.update).not.toHaveBeenCalled();
    } finally { window.showAlert = previousAlert; }
});

test('cash stops blocked fire-and-forget saves without an unhandled rejection', async () => {
    const get = jest.spyOn(projectStore, 'get').mockResolvedValue({ id: 'paused', status: 'paused' });
    const writesBefore = indexedDBService.update.mock.calls.length;
    try {
        await expect(PettyCashStore.save('projects', { id: 'cash', officialProjectId: 'paused' })).resolves.toBe(false);
        expect(indexedDBService.update.mock.calls.length).toBe(writesBefore);
    } finally { get.mockRestore(); }
});

test('cash confirmation blocks a paused owner before mutating in-memory movements', async () => {
    const previous = state.pettyCash;
    state.pettyCash = { projects: [{ id: 'cash', officialProjectId: 'paused' }], periods: [], movements: [{ id: 'm', projectId: 'cash', reviewPending: true }], selectedProjectId: 'cash' };
    try {
        registerPettyCashGlobals();
        await window.pcConfirmMovement('m');
        expect(state.pettyCash.movements[0].reviewPending).toBe(true);
        expect(state.pettyCash.movements[0]).not.toHaveProperty('updatedAt');
    } finally { state.pettyCash = previous; }
});

import fs from 'fs';
import path from 'path';
import { parseSync } from '@babel/core';
import { mergeIncomingEmployees, resetIncomingMergeBaseline } from '../../js/modules/services/EmployeesIncomingMerge.js';
import { mergeAttendanceRecords } from '../../js/modules/features/attendance/AttendanceMerge.js';
import { pauseCloudUpload, isDownloadPaused } from '../../js/modules/services/SyncPauseService.js';

// Execute the actual callback bodies shipped in app.js; do not copy their logic.
const source = fs.readFileSync(path.resolve(__dirname, '../../js/app.js'), 'utf8');
const tree = parseSync(source, { sourceType: 'module', configFile: false, babelrc: false });
function productionCallback(object, method, property, dependencies) {
    const stack = [tree];let found;
    while (stack.length && !found) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression'
            && node.callee.object?.name === object && node.callee.property?.name === method) {
            found = node.arguments.flatMap(argument => argument.properties || []).find(item => item.key?.name === property)?.value;
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) stack.push(...value);
            else if (value && typeof value === 'object') stack.push(value);
        }
    }
    if (!found) throw new Error(`Production callback not found: ${object}.${method}.${property}`);
    return new Function(...Object.keys(dependencies), `return (${source.slice(found.start, found.end)})`)(...Object.values(dependencies));
}

const live = { id: 'e', number: '001', name: 'Empleado ficticio', positions: [], updatedAt: 100 };
function environment(state) {
    return {
        state, isDownloadPaused, debug: { log: () => {} }, render: jest.fn(),
        mergeIncomingEmployees, mergeAttendanceRecords,
        absorbIncomingMergeMarkers: incoming => ({ incoming, absorbed: 0 }),
        persistDuplicateResolution: async () => {},
        employeePhotoService: { reconcileEmployeePhotoSignals: async () => [] },
        Employee: undefined, IncomingChangeModal: { show: jest.fn() },
        _isCurrentAuthCallback: () => true, armApplyingFlagWatchdog: () => {},
        invalidateEmployeeStats: () => {}, buildAttendanceIndex: () => {},
        getDateKey: () => '2026-11-01', getWeekDates: () => [],
        pauseCloudUpload
    };
}
beforeEach(() => {
    localStorage.clear();resetIncomingMergeBaseline();
    window._pendingIncomingReview = false;
    window._attendanceBatchedSaver = { add: jest.fn() };
});
afterEach(() => { window._isApplyingRemoteData = false;delete window._attendanceBatchedSaver; });

test('[REVISIÓN] una eliminación explícita de personal espera confirmación antes de cambiar la lista', () => {
    const state = { employees: [{ ...live }] }, deps = environment(state);
    const apply = productionCallback('EmployeesLiveSync', 'start', 'onApply', deps);
    apply([{ ...live, deletedAt: 200, updatedAt: 200 }], { authoritative: true });
    expect({ visibleIds: state.employees.map(employee => employee.id), asked: deps.IncomingChangeModal.show.mock.calls.length })
        .toEqual({ visibleIds: ['e'], asked: 1 });
});

test('[REVISIÓN] eliminar un préstamo desde otro equipo no cambia la deuda antes de confirmar', () => {
    const employee = { ...live, loans: [{ id: 'loan', principal: 900, updatedAt: 100 }] };
    const state = { employees: [employee] }, deps = environment(state);
    const apply = productionCallback('EmployeesLiveSync', 'start', 'onApply', deps);
    apply([{ ...employee, updatedAt: 200, loans: [], deletedItemIds: { loans: ['loan'] } }], { authoritative: true });
    expect({ loans: state.employees[0]?.loans.map(loan => loan.id), asked: deps.IncomingChangeModal.show.mock.calls.length })
        .toEqual({ loans: ['loan'], asked: 1 });
});

test('[REVISIÓN] una asistencia eliminada remotamente espera confirmación antes de dejar de contar', () => {
    const key = 'e-2026-11-01';
    const record = { employeeId: 'e', date: '2026-11-01', present: true, hoursWorked: 8, updatedAt: 100 };
    const state = { attendance: { [key]: record }, selectedDate: '2026-11-01', activeTab: 'payroll' }, deps = environment(state);
    const apply = productionCallback('FirebaseService', 'subscribeToAttendanceZonal', 'onModified', deps);
    apply('2026-11-01', { [key]: { ...record, present: false, deletedAt: 200, updatedAt: 200 } });
    expect({ present: state.attendance[key].present, asked: deps.IncomingChangeModal.show.mock.calls.length })
        .toEqual({ present: true, asked: 1 });
});

test('[PAUSA] elegir conservar y pausar impide aplicar la eliminación al llegar otro snapshot', async () => {
    const state = { employees: [{ ...live }] }, deps = environment(state);
    const pause = productionCallback('IncomingChangeModal', 'show', 'onRejectAndPause', deps);
    const apply = productionCallback('EmployeesLiveSync', 'start', 'onApply', deps);
    await pause();
    apply([{ ...live, deletedAt: 200, updatedAt: 200 }], { authoritative: true });
    expect(state.employees.map(employee => employee.id)).toEqual(['e']);
});

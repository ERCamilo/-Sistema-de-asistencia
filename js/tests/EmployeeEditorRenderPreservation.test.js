import { state, stateManager, renderOptimizer } from '../modules/core/AppState.js';
import { render, setRootComponent } from '../modules/core/RenderManager.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { EmployeeModal } from '../modules/ui/modals/EmployeeModal.js';
import { employeePhotoService } from '../modules/services/EmployeePhotoService.js';

let frames, open;
beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-09T12:00:00Z') });
    frames = new Map();
    let id = 0;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.set(++id, cb); return id; });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(key => frames.delete(key));
    jest.spyOn(employeePhotoService, 'getEmployeePhoto').mockResolvedValue(null);
    open = jest.spyOn(EmployeeModal, 'open');
    renderOptimizer._renderQueue.length = 0;
    renderOptimizer._rendering = false;
    renderOptimizer._lastRender = 0;
    window.render = render;
    window.ScrollService = null;
    window._systemAlerts = null;
    Object.assign(stateManager.getState(), {
        activeTab: 'employees', employeeViewMode: 'employees',
        employeeFilters: { search: '', positionIds: [], leaderIds: [], status: 'active' },
        selectedPersonnelEmployeeId: 'e1',
        positions: [{ id: 'p1', name: 'Puesto', hourlyRate: 100, active: true }], leaders: [],
        employees: [
            { id: 'e1', key: 'e1', number: '1', name: 'Uno', active: true, positions: ['p1'], hireDate: '2026-01-01' },
            { id: 'e2', key: 'e2', number: '2', name: 'Dos', active: true, positions: ['p1'], hireDate: '2026-01-01' }
        ], attendance: {},
        settings: { regularHoursPerDay: 8, overtimeFactor: 1, holidayFactor: 2, holidays: [], payPeriod: {} }
    });
    EmployeesUI.init({ state, saveToLocalStorage: jest.fn(), render, services: {} });
    document.body.innerHTML = '<div id="root"></div>';
    setRootComponent(EmployeesUI.EmployeesTab);
});
afterEach(() => {
    document.body.innerHTML = '';
    setRootComponent(null);
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
});
function flush() {
    for (let step = 0; step < 20; step++) {
        jest.advanceTimersByTime(20);
        const batch = [...frames.values()];
        frames.clear();
        batch.forEach(cb => cb());
        if (!frames.size && !jest.getTimerCount() && !renderOptimizer._renderQueue.length) return;
    }
    throw new Error('Render queue did not settle');
}
function mount() { render(); flush(); return document.getElementById('empName'); }

test('unrelated renders preserve the same form, draft, focus and photo lookup count', () => {
    const input = mount();
    const reads = employeePhotoService.getEmployeePhoto.mock.calls.length;
    input.value = 'Nombre sin guardar';
    input.focus();
    input.setSelectionRange(4, 8);
    state.syncStatus = 'syncing';
    render();
    flush();
    expect(document.getElementById('empName')).toBe(input);
    expect(input.value).toBe('Nombre sin guardar');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(4);
    expect(open).toHaveBeenCalledTimes(1);
    // The global avatar refresh can read the cache, but the editor must not
    // create an additional avatar and hydrate it again.
    expect(employeePhotoService.getEmployeePhoto.mock.calls.length - reads).toBeLessThanOrEqual(1);
});

test('selecting a different employee replaces the editor', () => {
    const input = mount();
    state.selectedPersonnelEmployeeId = 'e2';
    flush();
    expect(document.getElementById('empName')).not.toBe(input);
    expect(document.getElementById('empName').value).toBe('Dos');
});

test('toggling voice refreshes the name enrollment control in a clean editor', () => {
    mount();
    expect(document.querySelector('[data-voice-name-employee]')).toBeNull();
    state.settings.voiceMvpEnabled = true;
    flush();
    expect(document.querySelector('[data-voice-name-employee]').dataset.voiceNameEmployee).toBe('e1');
    state.settings.voiceMvpEnabled = false;
    flush();
    expect(document.querySelector('[data-voice-name-employee]')).toBeNull();
});

test('photo signals and sync metadata do not discard an unsaved employee name', () => {
    const input = mount();
    input.value = 'Nombre sin guardar';
    input.focus();
    state.employees[0].photo = { state: 'ready', revision: 'photo-new', updatedAt: 2000 };
    state.employees[0].updatedAt = 2000;
    state.employees[0]._isDirty = false;
    flush();
    expect(document.getElementById('empName')).toBe(input);
    expect(input.value).toBe('Nombre sin guardar');
    expect(document.activeElement).toBe(input);
    expect(open).toHaveBeenCalledTimes(1);
});

test('changes to another employee, their attendance, or sync metadata preserve the draft', () => {
    const input = mount();
    input.value = 'Borrador';
    state.employees[1].name = 'Otro nombre';
    state.attendance['e2-2026-10-09'] = { employeeId: 'e2', date: '2026-10-09', present: true };
    state.attendance['e1-2025-01-01'] = { employeeId: 'e1', date: '2025-01-01', present: true };
    state.settings.lastSnapshotTimestamp = Date.now();
    flush();
    expect(document.getElementById('empName')).toBe(input);
    expect(input.value).toBe('Borrador');
    expect(open).toHaveBeenCalledTimes(1);
});

test.each(['employee', 'position', 'attendance', 'payroll'])('updates the editor after a relevant %s change', kind => {
    const input = mount();
    if (kind === 'employee') state.employees[0].name = 'Actualizado';
    if (kind === 'position') state.positions[0].name = 'Puesto actualizado';
    if (kind === 'attendance') state.attendance['e1-2026-10-09'] = {
        employeeId: 'e1', date: '2026-10-09', present: true, hoursWorked: 8, positionId: 'p1'
    };
    if (kind === 'payroll') state.settings.regularHoursPerDay = 7;
    flush();
    expect(document.getElementById('empName')).not.toBe(input);
    expect(open).toHaveBeenCalledTimes(2);
});

test('removing the selection clears the editor and returning to the tab mounts it again', () => {
    mount();
    state.employeeFilters.search = 'no matching employee';
    flush();
    expect(document.getElementById('empName')).toBeNull();
    expect(document.getElementById('employee-editor-panel').textContent).toContain('Sin empleado');
    document.getElementById('root').replaceChildren();
    state.employeeFilters.search = '';
    render();
    flush();
    expect(document.getElementById('empName').value).toBe('Uno');
});

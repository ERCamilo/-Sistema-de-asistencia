import { ProjectReadOnlyContext } from '../modules/features/projects/ProjectReadOnlyContext.js';
import { projectHistoryCSV, renderProjectHistory, openProjectHistory } from '../modules/features/projects/ProjectHistoryUI.js';
import { replaceEntityScope, peekEntityScope } from '../modules/features/projects/EntityProjectScope.js';

test('history isolates owners, retains legacy default and freezes its independent snapshot', async () => {
    replaceEntityScope({ enabled: true, projectId: 'active', defaultProjectId: 'default' });
    const before = peekEntityScope();
    const data = { employees: [{ id: 'e1', name: '<script>', loans: [{ id: 'loan' }] }, { id: 'e2', projectId: 'active' }], attendance: [{ employeeId: 'e1', date: '2026-01-01' }, { employeeId: 'e2' }], pettyCashProjects: [{ id: 'c1', officialProjectId: 'default' }, { id: 'c2', officialProjectId: 'active' }], pettyCashMovements: [{ id: 'm1', projectId: 'c1' }, { id: 'm2', projectId: 'c2' }] };
    const idb = { getAll: async name => data[name] || [], update: jest.fn() };
    const context = new ProjectReadOnlyContext({ store: { get: async id => ({ id, name: '=Obra', status: 'paused' }) }, idb, defaultId: () => 'default' });
    const snapshot = await context.open('default');
    expect(snapshot.sections.employees.map(e => e.id)).toEqual(['e1']);
    expect(snapshot.sections.attendance).toHaveLength(1);
    expect(snapshot.sections.loans).toHaveLength(1);
    expect(snapshot.sections.pettyCashMovements.map(e => e.id)).toEqual(['m1']);
    data.employees[0].name = 'changed';
    expect(snapshot.sections.employees[0].name).toBe('<script>');
    expect(Object.isFrozen(snapshot.sections.employees[0])).toBe(true);
    expect(peekEntityScope()).toEqual(before);
    expect(idb.update).not.toHaveBeenCalled();
    expect(renderProjectHistory(snapshot)).toContain('&lt;script&gt;');
    expect(projectHistoryCSV(snapshot)).toContain('"\'=Obra"');
    const handle = await openProjectHistory('default', { context });
    expect(document.querySelector('[data-history-csv]')).not.toBeNull();
    expect(document.querySelector('[data-history-print]')).not.toBeNull();
    handle.close();
    expect(document.getElementById('project-history-modal')).toBeNull();
});
test('storage failure never displays an empty success', async () => {
    const context = new ProjectReadOnlyContext({ store: { get: async () => ({ id: 'a' }) }, idb: { getAll: async () => { throw new Error('offline storage'); } } });
    await expect(context.open('a')).rejects.toThrow('offline storage');
});

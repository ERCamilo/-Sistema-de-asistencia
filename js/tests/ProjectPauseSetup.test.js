import { ProjectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { mountProjectList, filterProjects } from '../modules/features/projects/ProjectListUI.js';

function harness() {
    let rows = [{ id: 'a', name: 'Activa', status: 'active' }, { id: 'b', name: 'Otra', status: 'active' }];
    const db = { getAll: async () => rows, update: jest.fn(async (_, row) => { rows = rows.map(p => p.id === row.id ? row : p); }) };
    const service = new ProjectSetupService({ store: { db, listAll: async () => rows }, flags: { isEnabled: () => true }, getScope: async () => ({ enabled: true, projectId: 'a', defaultProjectId: 'a' }), isDraftDirty: () => false });
    return { service, db };
}
beforeEach(() => localStorage.clear());
test('active context cannot be paused; another project pauses and resumes without switching', async () => {
    const { service, db } = harness();
    await expect(service.pauseProject('a')).rejects.toThrow(/otra obra/);
    expect(db.update).not.toHaveBeenCalled();
    expect((await service.pauseProject('b')).status).toBe('paused');
    await expect(service.pauseProject('b')).rejects.toThrow();
    expect((await service.resumeProject('b')).status).toBe('active');
    expect((await service.getState()).activeProjectId).toBe('a');
});
test('dirty configuration and missing projects fail before writes', async () => {
    const { service, db } = harness();
    await expect(service.pauseProject('missing')).rejects.toThrow(/inexistente/);
    service.isDraftDirty = () => true;
    await expect(service.pauseProject('b')).rejects.toThrow(/configuración/);
    expect(db.update).not.toHaveBeenCalled();
});
test('UI requires confirmation, cancellation does not write, and paused filter works', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const setupService = { pauseProject: jest.fn(async () => {}), getState: async () => ({ projects: [{ id: 'b', name: 'Otra', status: 'paused', pausedAt: 2 }] }) };
    mountProjectList(root, { projects: [{ id: 'b', name: 'Otra', status: 'active' }], setupService });
    root.querySelector('[data-project-lifecycle]').click();
    expect(setupService.pauseProject).not.toHaveBeenCalled();
    root.querySelector('[data-lifecycle-cancel]').click();
    root.querySelector('[data-project-lifecycle]').click();
    root.querySelector('[data-lifecycle-confirm]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(setupService.pauseProject).toHaveBeenCalledWith('b');
    expect(root.textContent).toContain('Reanudar');
    expect(filterProjects([{ status: 'paused' }, { status: 'active' }], 'paused')).toEqual([{ status: 'paused' }]);
    root.remove();
});

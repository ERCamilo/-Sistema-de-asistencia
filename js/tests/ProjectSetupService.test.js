import {
    ProjectSetupService,
    normalizeProjectSetupName
} from '../modules/features/projects/ProjectSetupService.js';

function harness({ enabled = false, scope = null, projects = null } = {}) {
    let flag = enabled;
    let rows = projects || [{
        id: 'PRJ-A-SETUP', name: 'Mi obra', status: 'active', schemaVersion: 1,
        createdAt: 1, updatedAt: 1
    }];
    const flags = {
        isEnabled: jest.fn(() => flag),
        setEnabled: jest.fn(value => { flag = value === true; })
    };
    const store = {
        listAll: jest.fn(async () => rows.map(row => ({ ...row }))),
        update: jest.fn(async project => {
            const payload = typeof project?.toJSON === 'function' ? project.toJSON() : { ...project };
            payload.updatedAt = 2;
            rows = rows.map(row => row.id === payload.id ? { ...payload } : row);
            return { ...payload };
        })
    };
    const getScope = jest.fn(async () => scope || (flag ? {
        enabled: true,
        projectId: 'PRJ-A-SETUP',
        defaultProjectId: 'PRJ-A-SETUP'
    } : { enabled: false, projectId: null, defaultProjectId: null }));
    const boot = jest.fn(async () => ({
        defaultProjectId: 'PRJ-A-SETUP', activeProjectId: 'PRJ-A-SETUP'
    }));
    const service = new ProjectSetupService({ store, getScope, boot, flags });
    return { service, flags, store, getScope, boot, isEnabled: () => flag };
}

describe('ProjectSetupService — explicit single-project setup for P2P', () => {
    test('flag OFF is read-only and does not touch project storage', async () => {
        const h = harness({ enabled: false });
        const state = await h.service.getState();
        expect(state).toEqual(expect.objectContaining({ enabled: false, ready: false, activeProjectId: null }));
        expect(h.store.listAll).not.toHaveBeenCalled();
        expect(h.getScope).not.toHaveBeenCalled();
    });

    test('explicit activation enables flag, runs canonical boot and resolves the official default project', async () => {
        const h = harness({ enabled: false });
        const state = await h.service.activate({ uid: 'uid-1' });
        expect(h.flags.setEnabled).toHaveBeenCalledWith(true);
        expect(h.boot).toHaveBeenCalledWith({ uid: 'uid-1' });
        expect(state.ready).toBe(true);
        expect(state.activeProjectId).toBe('PRJ-A-SETUP');
        expect(state.defaultProjectId).toBe('PRJ-A-SETUP');
        expect(state.activeProject.name).toBe('Mi obra');
    });

    test('failed first activation restores the feature flag to OFF', async () => {
        const h = harness({ enabled: false, scope: { enabled: true, projectId: null, defaultProjectId: null } });
        await expect(h.service.activate()).rejects.toThrow(/proyecto activo válido/i);
        expect(h.flags.setEnabled).toHaveBeenNthCalledWith(1, true);
        expect(h.flags.setEnabled).toHaveBeenLastCalledWith(false);
        expect(h.isEnabled()).toBe(false);
    });

    test('rename uses the active Project entity and never derives identity from companyName', async () => {
        const h = harness({ enabled: true });
        const state = await h.service.renameActiveProject('  Residencial   Norte  ');
        expect(state.activeProject.id).toBe('PRJ-A-SETUP');
        expect(state.activeProject.name).toBe('Residencial Norte');
        expect(h.store.update).toHaveBeenCalledTimes(1);
    });

    test('closed or missing active records are not P2P-ready', async () => {
        const h = harness({
            enabled: true,
            projects: [{ id: 'PRJ-A-SETUP', name: 'Cerrado', status: 'closed', schemaVersion: 1, createdAt: 1, updatedAt: 1, closedAt: 1 }]
        });
        const state = await h.service.getState();
        expect(state.ready).toBe(false);
    });
});

test('project setup names are bounded and normalized', () => {
    expect(normalizeProjectSetupName('  Obra   Central  ')).toBe('Obra Central');
    expect(() => normalizeProjectSetupName('   ')).toThrow(/obligatorio/i);
    expect(() => normalizeProjectSetupName('x'.repeat(81))).toThrow(/80/);
});

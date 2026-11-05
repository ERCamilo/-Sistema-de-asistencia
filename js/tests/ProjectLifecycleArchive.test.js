import { ProjectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { Project, PROJECT_STATUS } from '../modules/features/projects/Project.js';
import { renderProjectItemHTML } from '../modules/features/projects/ProjectListUI.js';

function harness() {
    const initial = Project.create({ id: 'A', name: 'Obra inicial', createdAt: 100, updatedAt: 100 }).toJSON();
    const other = Project.create({ id: 'B', name: 'Torre Central', createdAt: 200, updatedAt: 200 }).toJSON();
    const data = new Map([initial, other].map(row => [row.id, row]));
    const store = {
        listAll: jest.fn(async () => [...data.values()].map(row => ({ ...row }))),
        get: jest.fn(async id => data.has(id) ? { ...data.get(id) } : null),
        update: jest.fn(async project => {
            const row = project.toJSON();
            data.set(row.id, row);
            return { ...row };
        })
    };
    const setup = new ProjectSetupService({
        store,
        flags: { isEnabled: () => true, setEnabled: () => {} },
        getScope: async () => ({ enabled: true, projectId: 'A', defaultProjectId: 'A' }),
        isDraftDirty: () => false
    });
    return { setup, store, data };
}

describe('archivado reversible de obras y protección de borrado', () => {
    test('cerrar, archivar, sacar del archivo y reabrir preserva ids e historial', async () => {
        const { setup, data } = harness();
        expect((await setup.transitionProjectStatus('B', 'close')).project.status).toBe(PROJECT_STATUS.CLOSED);
        const closedAt = data.get('B').closedAt;
        expect(Number.isFinite(closedAt)).toBe(true);
        const archived = await setup.transitionProjectStatus('B', 'archive');
        expect(archived.project.status).toBe(PROJECT_STATUS.ARCHIVED);
        expect(archived.project.closedAt).toBe(closedAt);
        expect(archived.project.archivedAt).toEqual(expect.any(Number));
        expect((await setup.transitionProjectStatus('B', 'unarchive')).project.status).toBe(PROJECT_STATUS.CLOSED);
        expect((await setup.transitionProjectStatus('B', 'reopen')).project.status).toBe(PROJECT_STATUS.ACTIVE);
        expect(data.get('B').closedAt).toBeUndefined();
        expect(data.get('B').archivedAt).toBeUndefined();
        expect(data.size).toBe(2);
    });

    test('no permite modificar obra inicial o actual ni transición inválida', async () => {
        const { setup, store } = harness();
        await expect(setup.transitionProjectStatus('A', 'close')).rejects.toThrow(/obra activa|obra inicial|cambia a otra obra/i);
        await expect(setup.transitionProjectStatus('B', 'archive')).rejects.toThrow(/sólo un proyecto closed/i);
        await expect(setup.transitionProjectStatus('B', 'erase')).rejects.toThrow(/operación de estado/i);
        expect(store.update).not.toHaveBeenCalled();
    });

    test('lista ofrece archivo de obra cerrada y bloquea borrado cuando tiene historial', () => {
        const closed = Project.create({ id: 'B', name: 'Torre Central', status: 'closed', closedAt: 500, updatedAt: 500 });
        const html = renderProjectItemHTML(closed, {
            activeProjectId: 'A', defaultProjectId: 'A', allowSwitch: true,
            usage: { B: { verified: true, empty: false, employees: 4, positions: 2, loans: 2, payrollClosures: 6,
                leaders: 0, attendance: 40, pettyCash: 2, other: 0, pending: 0 } }
        });
        expect(html).toContain('data-project-status-action="archive"');
        expect(html).toContain('Archivar obra');
        expect(html).toContain('data-project-impact');
        expect(html).not.toContain('data-project-delete-confirm');
        expect(html).not.toContain('El borrado definitivo con datos está deshabilitado');
    });

    test('previsualización del borrado con dependencias no ejecuta ninguna eliminación', async () => {
        const { setup, store } = harness();
        setup.getProjectUsage = jest.fn(async () => ({
            A: { verified: true, empty: true },
            B: {
                verified: true, empty: false, employees: 3, attendance: 50,
                payrollClosures: 4, loans: 2, pending: 1,
                positions: 0, leaders: 0, pettyCash: 0, other: 0
            }
        }));
        const preview = await setup.previewProjectDeletion('B');
        expect(preview).toMatchObject({
            occupied: true, canDeleteWithData: false, requiresBackup: true,
            requiresCloudAcknowledgement: true, protectedProject: false
        });
        expect(preview.blockers).toEqual(expect.arrayContaining([
            { kind: 'payrollClosures', count: 4 }, { kind: 'pending', count: 1 }
        ]));
        expect(store.update).not.toHaveBeenCalled();
    });

    test('obra archivada permite salir del archivo pero no activar ni borrar sus datos', () => {
        const archived = Project.create({ id: 'B', name: 'Histórica', status: 'archived', closedAt: 100, archivedAt: 200 });
        const html = renderProjectItemHTML(archived, { activeProjectId: 'A', defaultProjectId: 'A', allowSwitch: true });
        expect(html).toContain('data-project-status-action="unarchive"');
        expect(html).not.toContain('data-project-switch');
    });
});

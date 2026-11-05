import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { ProjectStore } from '../modules/features/projects/ProjectStore.js';
import { projectDeletionPolicy, PROJECT_DELETION_WAIT_MS as WAIT } from '../modules/features/projects/ProjectDeletionPolicy.js';
import { deleteEmptyProject } from '../modules/features/projects/ProjectUsage.js';
import { toCatalogDoc, planCatalogMerge } from '../modules/features/projects/ProjectCatalogSync.js';
import { Project } from '../modules/features/projects/Project.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
const DAY = 86400000, NOW = 1793700000000;
const work = (overrides = {}) => ({
    id: 'B', name: 'Torre Central', status: 'closed', closedAt: NOW - 30 * DAY,
    createdAt: 1, updatedAt: 2, ...overrides
});

describe('30 días pausada + 30 días después de solicitar eliminación', () => {
    test('a los 29 días está bloqueada, al día 30 puede solicitarse', () => {
        const before = projectDeletionPolicy(work({ closedAt: NOW - 29 * DAY }), NOW);
        expect(before).toMatchObject({ stage: 'paused-wait', remainingDays: 1, canRequest: false });
        const eligible = projectDeletionPolicy(work(), NOW);
        expect(eligible).toMatchObject({ stage: 'eligible-to-request', canRequest: true });
        expect(WAIT).toBe(30 * DAY);
    });

    test('otros 30 días para cancelar; sin borrado automático ni adelanto de fechas', () => {
        const waiting = projectDeletionPolicy(work({ deletionRequestedAt: NOW - 10 * DAY,
            closedAt: NOW - 50 * DAY }), NOW);
        expect(waiting).toMatchObject({
            stage: 'grace-period', remainingDays: 20, canCancel: true, canFinalizeEmpty: false
        });
        expect(projectDeletionPolicy(work({ deletionRequestedAt: NOW - 30 * DAY,
            closedAt: NOW - 61 * DAY }), NOW).canFinalizeEmpty).toBe(true);
        expect(projectDeletionPolicy(work({ deletionRequestedAt: NOW - DAY }), NOW).stage).toBe('invalid');
        expect(projectDeletionPolicy(work({ deletionRequestedAt: NOW + DAY }), NOW).stage).toBe('invalid');
        expect(projectDeletionPolicy(work({ status: 'active' }), NOW).canRequest).toBe(false);
    });

    test('una obra archivada conserva su primera pausa; reabrir cancela el conteo antiguo', () => {
        const archived = work({ status: 'archived', archivedAt: NOW - DAY });
        expect(projectDeletionPolicy(archived, NOW).canRequest).toBe(true);
        const reopening = Project.fromJSON(work());
        reopening.reopen();
        expect(reopening.closedAt).toBeUndefined();
        expect(projectDeletionPolicy(reopening.toJSON(), NOW).stage).toBe('active');
    });

    test('solicitud se guarda atómicamente, se sincroniza y puede cancelarse sin reiniciar la pausa', async () => {
        const db = new IndexedDBService('sa-project-deletion-' + Math.random());
        const store = new ProjectStore({ db });
        try {
            await db.init();
            await db.update('projects', work());
            const requested = await store.requestDeletion('B', { now: () => NOW });
            expect(requested.deletionRequestedAt).toBe(NOW);
            expect(requested.closedAt).toBe(NOW - 30 * DAY);
            expect(toCatalogDoc(requested).deletionRequestedAt).toBe(NOW);
            await expect(store.requestDeletion('B', { now: () => NOW + DAY }))
                .rejects.toThrow(/30 días pausada/);
            await expect(store.transitionStatus('B', 'reopen')).rejects.toThrow(/Cancela primero/);
            const cancelled = await store.cancelDeletion('B', { now: () => NOW + DAY });
            expect(cancelled.deletionRequestedAt).toBeNull();
            expect(toCatalogDoc(cancelled).deletionRequestedAt).toBeNull();
            expect(planCatalogMerge([cancelled], [{ ...requested, updatedAt: requested.updatedAt - 1 }]).publish)
                .toEqual(expect.arrayContaining([expect.objectContaining({ deletionRequestedAt: null })]));
            expect((await store.get('B')).status).toBe('closed');
        } finally {
            db.db?.close();
        }
    });

    test('borrar obra vacía sin ambas esperas está prohibido en el almacenamiento, incluso saltando la UI', async () => {
        const db = new IndexedDBService('sa-deletion-guard-' + Math.random());
        try {
            await db.init();
            await db.update('projects', { ...work({ closedAt: Date.now() - 29 * DAY,
                deletionRequestedAt: null }), updatedAt: 1 });
            await expect(deleteEmptyProject('B', { idb: db, getProtectedIds: () => ({
                activeProjectId: 'A', defaultProjectId: 'A'
            }) })).rejects.toThrow(/30 días/);
            expect((await db.get('projects', 'B')).deletedAt).toBeUndefined();
            await db.update('projects', { ...work({ closedAt: Date.now() - 61 * DAY,
                deletionRequestedAt: Date.now() - 30 * DAY - 1000 }), updatedAt: 1 });
            const result = await deleteEmptyProject('B', {
                idb: db, getProtectedIds: () => ({ activeProjectId: 'A', defaultProjectId: 'A' })
            });
            expect(result.deletedAt).toEqual(expect.any(Number));
            // This is a catalog tombstone, NOT physical deletion of related data.
            expect(await db.get('projects', 'B')).toMatchObject({ deletedAt: expect.any(Number) });
        } finally {
            db.db?.close();
        }
    });
});

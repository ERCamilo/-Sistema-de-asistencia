/**
 * F1.3 — ProjectContext active-project preference against the REAL
 * IndexedDBService on fake-indexeddb (no mocks in the data path).
 */

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { ProjectStore } from 'actual/features/projects/ProjectStore.js';
import { Project, PROJECT_STATUS } from 'actual/features/projects/Project.js';
import { DefaultProjectService } from 'actual/features/projects/DefaultProject.js';
import {
    ProjectContextService,
    ACTIVE_PROJECT_LS_KEY
} from 'actual/features/projects/ProjectContext.js';
import { isProjectsEnabled, setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

function makeHarness(dbName) {
    const svc = new IndexedDBService(dbName);
    const store = new ProjectStore({ db: svc });
    const defaults = new DefaultProjectService({ store });
    const context = new ProjectContextService({ store, defaults });
    return { svc, store, defaults, context };
}

describe('ProjectContext (F1.3)', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
        expect(isProjectsEnabled()).toBe(true);
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('flag OFF: get returns null and set persists nothing', async () => {
        setProjectsEnabled(false);
        const { context } = makeHarness('attendance-app-db-context-off');

        await expect(context.getActiveProjectId()).resolves.toBeNull();
        await expect(context.setActiveProjectId('PRJ-algo-0000')).resolves.toBeNull();
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBeNull();
        context.clearActiveProjectId(); // must not throw
    });

    test('set → get round-trip survives a simulated restart (fresh module state)', async () => {
        const dbName = 'attendance-app-db-context-restart';
        const first = makeHarness(dbName);
        const project = Project.create({ name: 'Obra Activa' });
        await first.store.create(project);
        await expect(first.context.setActiveProjectId(project.id)).resolves.toBe(project.id);

        // Fresh service instances over the same IDB + LS key = "restart".
        const second = makeHarness(dbName);
        await expect(second.context.getActiveProjectId()).resolves.toBe(project.id);
    });

    test('active-project subscribers receive only real successful ON changes and can unsubscribe', async () => {
        const { store, context } = makeHarness('attendance-app-db-context-events');
        const projectA = Project.create({ name: 'Obra A' });
        const projectB = Project.create({ name: 'Obra B' });
        const rejected = Project.create({ name: 'Obra cerrada' });
        rejected.close();
        await store.create(projectA);
        await store.create(projectB);
        await store.create(rejected);
        const listener = jest.fn();
        const unsubscribe = context.subscribe(listener);

        await context.setActiveProjectId(projectA.id);
        expect(listener).toHaveBeenLastCalledWith({ previousProjectId: null, projectId: projectA.id });
        await context.setActiveProjectId(projectA.id);
        await expect(context.setActiveProjectId(rejected.id)).rejects.toThrow(/closed/);
        setProjectsEnabled(false);
        await expect(context.setActiveProjectId(projectB.id)).resolves.toBeNull();
        expect(listener).toHaveBeenCalledTimes(1);

        setProjectsEnabled(true);
        await context.setActiveProjectId(projectB.id);
        expect(listener).toHaveBeenLastCalledWith({ previousProjectId: projectA.id, projectId: projectB.id });
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        await context.setActiveProjectId(projectA.id);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    test('stored id pointing to a nonexistent project falls back cleanly to the default', async () => {
        const dbName = 'attendance-app-db-context-fallback';
        const harness = makeHarness(dbName);
        const fallback = await harness.defaults.ensureDefaultProject();

        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-fantasma-9999');
        await expect(harness.context.getActiveProjectId()).resolves.toBe(fallback.id);

        // Never throws on repeated reads; default pointer stays consistent.
        await expect(harness.context.getActiveProjectId()).resolves.toBe(fallback.id);
    });

    test('set rejects nonexistent ids and does not persist', async () => {
        const { context } = makeHarness('attendance-app-db-context-missing');

        await expect(context.setActiveProjectId('PRJ-nada-0000'))
            .rejects.toThrow(/inexistente/i);
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBeNull();
    });

    test.each([
        ['closed', p => p.close()],
        ['archived', async p => {
            p.close();
            p.archive();
        }]
    ])('set rejects a %s project and keeps the previous selection untouched', async (_status, transition) => {
        const dbName = `attendance-app-db-context-${_status}`;
        const { store, defaults, context } = makeHarness(dbName);
        const target = Project.create({ name: `Obra ${_status}` });
        await store.create(target);
        transition(target);
        await store.update(target);
        expect(target.status).not.toBe(PROJECT_STATUS.ACTIVE);

        const safeDefault = await defaults.ensureDefaultProject();
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, safeDefault.id);

        await expect(context.setActiveProjectId(target.id))
            .rejects.toThrow(_status === 'closed' ? /closed/ : /archived/);
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe(safeDefault.id);
    });

    test('clearActiveProjectId removes the preference; next get falls back to default', async () => {
        const { store, defaults, context } = makeHarness('attendance-app-db-context-clear');
        const fallback = await defaults.ensureDefaultProject();
        const other = Project.create({ name: 'Otra obra' });
        await store.create(other);
        await context.setActiveProjectId(other.id);

        context.clearActiveProjectId();
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBeNull();
        await expect(context.getActiveProjectId()).resolves.toBe(fallback.id);
    });

    test('genuine store failure during fallback propagates (deleted-id case never throws; IDB down does)', async () => {
        const failingStore = {
            get: async () => null,
            listAll: async () => [],
            create: async () => { throw new Error('IDB down'); }
        };
        const context = new ProjectContextService({
            store: failingStore,
            defaults: new DefaultProjectService({ store: failingStore })
        });
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-roto-0000');
        await expect(context.getActiveProjectId()).rejects.toThrow(/IDB down/i);
    });

    test('sanity: created fixture projects start active', () => {
        expect(Project.create({ name: 'X' }).status).toBe(PROJECT_STATUS.ACTIVE);
    });
});

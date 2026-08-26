/**
 * F1.4/E+F — ProjectsBoot flag-guarded boot wiring, exercised against the REAL
 * IndexedDBService on fake-indexeddb (fresh-harness-per-phase over the SAME
 * fake-indexeddb + localStorage = "reload" simulation).
 *
 * Error strategy pinned here too: initProjectsInfrastructure() must NEVER
 * throw outward — storage failures degrade to { null, null } + console.warn.
 */

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { ProjectStore } from 'actual/features/projects/ProjectStore.js';
import { DefaultProjectService, DEFAULT_PROJECT_LS_KEY } from 'actual/features/projects/DefaultProject.js';
import { ProjectContextService, ACTIVE_PROJECT_LS_KEY } from 'actual/features/projects/ProjectContext.js';
import { initProjectsInfrastructure } from 'actual/features/projects/ProjectsBoot.js';
import { isProjectsEnabled, setProjectsEnabled } from 'actual/config/FeatureFlags.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const DB_NAME = 'attendance-app-db-boot-seq';

function makeHarness(dbName = DB_NAME) {
    const svc = new IndexedDBService(dbName);
    const store = new ProjectStore({ db: svc });
    const defaults = new DefaultProjectService({ store });
    const context = new ProjectContextService({ store, defaults });
    return { svc, store, defaults, context };
}

describe('ProjectsBoot flag sequence', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        setProjectsEnabled(false);
        localStorage.clear();
    });

    test('OFF → init ⇒ inert: no project created, activeProjectId null, no LS writes', async () => {
        setProjectsEnabled(false);
        expect(isProjectsEnabled()).toBe(false);

        const harness = makeHarness();
        const result = await initProjectsInfrastructure({
            defaults: harness.defaults,
            context: harness.context
        });

        expect(result).toEqual({ defaultProjectId: null, activeProjectId: null });
        await harness.svc.init();
        await expect(harness.store.listAll()).resolves.toHaveLength(0);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBeNull();
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBeNull();
    });

    test('ON → init ⇒ single default created, context resolves to it', async () => {
        setProjectsEnabled(true);
        const harness = makeHarness();

        const result = await initProjectsInfrastructure({
            defaults: harness.defaults,
            context: harness.context
        });

        expect(result.defaultProjectId).toBeTruthy();
        expect(result.activeProjectId).toBe(result.defaultProjectId);
        await expect(harness.store.listAll()).resolves.toHaveLength(1);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(result.defaultProjectId);
    });

    test('simulated reload (fresh modules, same IDB+LS) with ON ⇒ same ids recovered, still one default', async () => {
        setProjectsEnabled(true);
        const first = makeHarness();
        const boot1 = await initProjectsInfrastructure({ defaults: first.defaults, context: first.context });

        // "Reload": brand-new service instances over the SAME db name + LS keys.
        const second = makeHarness();
        const boot2 = await initProjectsInfrastructure({ defaults: second.defaults, context: second.context });

        expect(boot2.defaultProjectId).toBe(boot1.defaultProjectId);
        expect(boot2.activeProjectId).toBe(boot1.activeProjectId);
        await expect(second.store.listAll()).resolves.toHaveLength(1);
    });

    test('ON→OFF→ON: OFF phase is a no-op WITHOUT deleting anything; final ON recovers the SAME id', async () => {
        setProjectsEnabled(true);
        const session1 = makeHarness();
        const original = await initProjectsInfrastructure({ defaults: session1.defaults, context: session1.context });
        expect(original.defaultProjectId).toBeTruthy();

        // OFF phase: fresh harness, flag off ⇒ nulls and ZERO mutations.
        setProjectsEnabled(false);
        const offSession = makeHarness();
        const offResult = await initProjectsInfrastructure({ defaults: offSession.defaults, context: offSession.context });
        expect(offResult).toEqual({ defaultProjectId: null, activeProjectId: null });
        await expect(offSession.store.get(original.defaultProjectId)).resolves.not.toBeNull();
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(original.defaultProjectId);

        // Final ON phase: same default persists, no duplicate created.
        setProjectsEnabled(true);
        const finalSession = makeHarness();
        const finalResult = await initProjectsInfrastructure({ defaults: finalSession.defaults, context: finalSession.context });
        expect(finalResult.defaultProjectId).toBe(original.defaultProjectId);
        await expect(finalSession.store.listAll()).resolves.toHaveLength(1);
    });

    test('flag OFF short-circuits BEFORE touching any service (inertness is explicit)', async () => {
        setProjectsEnabled(false);
        const defaultsSpy = { ensureDefaultProject: jest.fn() };
        const contextSpy = { getActiveProjectId: jest.fn() };

        await expect(initProjectsInfrastructure({ defaults: defaultsSpy, context: contextSpy }))
            .resolves.toEqual({ defaultProjectId: null, activeProjectId: null });
        expect(defaultsSpy.ensureDefaultProject).not.toHaveBeenCalled();
        expect(contextSpy.getActiveProjectId).not.toHaveBeenCalled();
    });

    test('storage failure never throws outward: degrades to {null,null} + console.warn', async () => {
        setProjectsEnabled(true);
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const result = await initProjectsInfrastructure({
                defaults: { ensureDefaultProject: async () => { throw new Error('IDB down'); } },
                context: { getActiveProjectId: async () => 'should-not-be-reached' }
            });
            expect(result).toEqual({ defaultProjectId: null, activeProjectId: null });
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ProjectsBoot'), 'IDB down');
        } finally {
            warnSpy.mockRestore();
        }
    });
});

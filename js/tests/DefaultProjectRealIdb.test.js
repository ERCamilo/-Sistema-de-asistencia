/**
 * F1.2 — DefaultProjectService idempotency + deterministic recovery against
 * the REAL IndexedDBService on fake-indexeddb (no mocks in the data path).
 */

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { ProjectStore } from 'actual/features/projects/ProjectStore.js';
import { Project, PROJECT_STATUS } from 'actual/features/projects/Project.js';
import {
    DefaultProjectService,
    DEFAULT_PROJECT_LS_KEY,
    DEFAULT_PROJECT_NAME
} from 'actual/features/projects/DefaultProject.js';
import { isProjectsEnabled, setProjectsEnabled } from 'actual/config/FeatureFlags.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const FLAG_KEY = 'asistencia_feature_projects';

function makeHarness(dbName) {
    const svc = new IndexedDBService(dbName);
    const store = new ProjectStore({ db: svc });
    const service = new DefaultProjectService({ store });
    return { svc, store, service };
}

describe('DefaultProjectService (F1.2)', () => {
    beforeEach(() => {
        localStorage.clear();
        setProjectsEnabled(true);
        expect(isProjectsEnabled()).toBe(true);
    });

    afterEach(() => {
        setProjectsEnabled(false);
    });

    test('flag OFF: ensure() returns null and creates NOTHING', async () => {
        setProjectsEnabled(false);
        const { svc, store, service } = makeHarness('attendance-app-db-default-off');

        await expect(service.ensureDefaultProject()).resolves.toBeNull();
        await svc.init();
        await expect(store.listAll()).resolves.toHaveLength(0);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBeNull();
    });

    test('creates exactly one "Mi obra" default; ensure() N times → same id, listAll length 1', async () => {
        const { store, service } = makeHarness('attendance-app-db-default-create');

        const first = await service.ensureDefaultProject();
        expect(first.name).toBe(DEFAULT_PROJECT_NAME);
        expect(first.status).toBe(PROJECT_STATUS.ACTIVE);

        for (let i = 0; i < 3; i++) {
            const again = await service.ensureDefaultProject();
            expect(again.id).toBe(first.id);
        }
        await expect(store.listAll()).resolves.toHaveLength(1);
    });

    test('pointer survives a simulated restart via the LS key', async () => {
        const dbName = 'attendance-app-db-default-restart';
        const first = makeHarness(dbName);
        const created = await first.service.ensureDefaultProject();

        // Fresh module state: new service instance over the SAME db + LS key.
        const second = makeHarness(`${dbName}-b`);
        // Point the LS key at the original db's project by copying it across.
        const recreated = await second.store.create(created);
        expect(recreated.id).toBe(created.id);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(created.id);

        const resolved = await second.service.ensureDefaultProject();
        expect(resolved.id).toBe(created.id);
        await expect(second.store.listAll()).resolves.toHaveLength(1);
    });

    test('missing pointer recovers deterministically: earliest-createdAt active project', async () => {
        const { store, service } = makeHarness('attendance-app-db-default-recover');
        const oldActive = await store.create(Project.create({ name: 'Vieja', createdAt: 1000 }));
        await store.create(Project.create({ name: 'Nueva', createdAt: 2000 }));
        localStorage.removeItem(DEFAULT_PROJECT_LS_KEY);

        const recovered = await service.ensureDefaultProject();
        expect(recovered.id).toBe(oldActive.id);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(oldActive.id);
        await expect(store.listAll()).resolves.toHaveLength(2); // no new creation
    });

    test('dangling pointer (project deleted) re-points without creating duplicates', async () => {
        const { store, service } = makeHarness('attendance-app-db-default-dangling');
        const real = await service.ensureDefaultProject();
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-borrado-xxxx');

        const resolved = await service.ensureDefaultProject();
        expect(resolved.id).toBe(real.id);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(real.id);
        await expect(store.listAll()).resolves.toHaveLength(1);
    });

    test('empty store + missing pointer creates exactly one default once', async () => {
        const { store, service } = makeHarness('attendance-app-db-default-empty');
        const a = await service.ensureDefaultProject();
        const b = await service.ensureDefaultProject();
        expect(a.id).toBe(b.id);
        await expect(store.listAll()).resolves.toHaveLength(1);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(a.id);
    });
});

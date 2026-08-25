/**
 * F1.1 — ProjectStore local CRUD against the REAL IndexedDBService running on
 * fake-indexeddb (no mocks in the data path). Proves attendance-app-db v17
 * exposes the `projects` store and that records round-trip as detached POJOs.
 */

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { ProjectStore } from 'actual/features/projects/ProjectStore.js';
import { Project } from 'actual/features/projects/Project.js';

// jest-environment-jsdom does not expose structuredClone; fake-indexeddb v6
// requires it. Established idiom (see PersistenceRoundTripIntegrityRealIdb).
if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

describe('ProjectStore — REAL IndexedDB runtime (fake-indexeddb)', () => {
    test('create → get → listAll → update round-trip on the v17 schema', async () => {
        const t0 = 1723000000000;
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
        const svc = new IndexedDBService('attendance-app-db-projectstore');
        const store = new ProjectStore({ db: svc });

        await svc.init();
        expect(svc.db.version).toBe(17);
        expect(Array.from(svc.db.objectStoreNames)).toContain('projects');

        const created = await store.create(Project.create({ name: 'Obra Norte' }));
        expect(created.id).toMatch(/^PRJ-[a-z0-9]+-.{4}$/);
        expect(created.updatedAt).toBe(t0);

        expect(await store.get(created.id)).toEqual(created);

        const listed = await store.listAll();
        expect(listed).toHaveLength(1);
        expect(listed[0]).toEqual(created);

        // update stamps updatedAt itself; POJO input is accepted too.
        nowSpy.mockReturnValue(t0 + 5000);
        const renamed = await store.update({ ...created, name: 'Obra Norte II' });
        expect(renamed.updatedAt).toBe(t0 + 5000);
        expect(await store.get(created.id)).toEqual(renamed);
        expect(await store.get(created.id)).not.toEqual(created);

        nowSpy.mockRestore();
    });

    test('update accepts a Project instance and persists conditional fields', async () => {
        const svc = new IndexedDBService('attendance-app-db-projectinst');
        const store = new ProjectStore({ db: svc });

        const project = Project.create({ name: 'Instancia' });
        await store.create(project);
        project.close();

        const saved = await store.update(project);
        expect(saved.status).toBe('closed');
        expect(saved.closedAt).toBeGreaterThan(0);
        expect(await store.get(project.id)).toEqual(project.toJSON());
    });

    test('reads return POJOs detached from stored state', async () => {
        const svc = new IndexedDBService('attendance-app-db-projectpojo');
        const store = new ProjectStore({ db: svc });

        await store.create(Project.create({
            name: 'POJO', metadata: { notes: 'original' }
        }));

        const fetched = await store.get((await store.listAll())[0].id);
        expect(Object.getPrototypeOf(fetched)).toBe(Object.prototype);

        fetched.name = 'mutado';
        fetched.metadata.notes = 'mutado';
        const fresh = await store.get(fetched.id);
        expect(fresh.name).toBe('POJO');
        expect(fresh.metadata.notes).toBe('original');

        const listed = await store.listAll();
        listed[0].status = 'archived';
        expect((await store.listAll())[0].status).toBe('active');
    });

    test('get() returns null for unknown ids', async () => {
        const svc = new IndexedDBService('attendance-app-db-projectmiss');
        const store = new ProjectStore({ db: svc });
        await expect(store.get('PRJ-nope-0000')).resolves.toBeNull();
    });
});

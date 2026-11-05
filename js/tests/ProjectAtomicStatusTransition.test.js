import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { ProjectStore } from '../modules/features/projects/ProjectStore.js';
import { Project } from '../modules/features/projects/Project.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

test('status transition uses latest durable project and never loses an updated name', async () => {
    const idb = new IndexedDBService('atomic-project-status-' + Math.random());
    const store = new ProjectStore({ db: idb });
    try {
        await idb.init();
        const first = Project.create({ id: 'B', name: 'Nombre antiguo', createdAt: 100, updatedAt: 100 });
        await store.create(first);
        // An older UI retained first, but a rename has already committed.
        await store.update(Project.create({ ...first.toJSON(), name: 'Nombre actualizado' }));
        const closed = await store.transitionStatus('B', 'close');
        expect(closed.name).toBe('Nombre actualizado');
        expect(closed.status).toBe('closed');
        expect(closed.closedAt).toEqual(expect.any(Number));
        const archived = await store.transitionStatus('B', 'archive');
        expect(archived.status).toBe('archived');
        expect(archived.name).toBe('Nombre actualizado');
        await expect(store.transitionStatus('B', 'close')).rejects.toThrow(/sólo active/i);
        expect((await store.get('B')).status).toBe('archived');
        expect((await store.get('B')).name).toBe('Nombre actualizado');
    } finally {
        idb.db?.close();
    }
});

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { Project } from 'actual/features/projects/Project.js';
import { ProjectStore } from 'actual/features/projects/ProjectStore.js';
import { dismissProjectPair } from '../modules/features/projects/ProjectPairDismissals.js';
import { isDismissedPair } from '../modules/features/projects/ProjectSimilarity.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

/**
 * «No son la misma» queda en el documento de la obra (el de id menor), viaja
 * con el catálogo y sobrevive a editar la obra desde la UI.
 */
const row = (id, name, extra = {}) => ({ id, name, status: 'active', createdAt: 1, updatedAt: 10, schemaVersion: 1, ...extra });

describe('Project conserva notSameAs', () => {
    test('fromJSON → toJSON no lo pierde y no inventa el campo', () => {
        const kept = Project.fromJSON(row('PRJ-a', 'Torre', { notSameAs: ['PRJ-b'] })).toJSON();
        expect(kept.notSameAs).toEqual(['PRJ-b']);
        expect('notSameAs' in Project.fromJSON(row('PRJ-a', 'Torre')).toJSON()).toBe(false);
    });

    test('la lista del modelo no comparte referencia con la entrada', () => {
        const input = row('PRJ-a', 'Torre', { notSameAs: ['PRJ-b'] });
        const project = Project.fromJSON(input);
        input.notSameAs.push('PRJ-z');
        expect(project.toJSON().notSameAs).toEqual(['PRJ-b']);
    });
});

describe('dismissProjectPair', () => {
    let db;
    beforeEach(async () => {
        db = new IndexedDBService('dismiss-' + Math.random());
        await db.init();
        await db.update('projects', row('PRJ-a', 'Torre Norte'));
        await db.update('projects', row('PRJ-b', 'Edificio Sur'));
        await db.update('projects', row('PRJ-c', 'Otra'));
    });
    afterEach(() => { try { db.db.close(); } catch (_) { /* ignore */ } });

    test('guarda el descarte en la obra de id menor, sin importar el orden', async () => {
        await dismissProjectPair('PRJ-b', 'PRJ-a', { idb: db });
        const a = await db.get('projects', 'PRJ-a');
        expect(a.notSameAs).toEqual(['PRJ-b']);
        expect(a.updatedAt).toBeGreaterThan(10);
        expect(a.name).toBe('Torre Norte');
        expect((await db.get('projects', 'PRJ-b')).notSameAs).toBeUndefined();
        expect(isDismissedPair(a, await db.get('projects', 'PRJ-b'))).toBe(true);
    });

    test('es idempotente: repetirlo no cambia nada ni mueve updatedAt', async () => {
        await dismissProjectPair('PRJ-a', 'PRJ-b', { idb: db });
        const first = await db.get('projects', 'PRJ-a');
        await dismissProjectPair('PRJ-b', 'PRJ-a', { idb: db });
        expect(await db.get('projects', 'PRJ-a')).toEqual(first);
    });

    test('acumula varios descartes ordenados y sin repetir', async () => {
        await dismissProjectPair('PRJ-a', 'PRJ-c', { idb: db });
        await dismissProjectPair('PRJ-a', 'PRJ-b', { idb: db });
        expect((await db.get('projects', 'PRJ-a')).notSameAs).toEqual(['PRJ-b', 'PRJ-c']);
    });

    test('rechaza la misma obra, ids vacíos, obras inexistentes o borradas', async () => {
        await expect(dismissProjectPair('PRJ-a', 'PRJ-a', { idb: db })).rejects.toThrow(/dos obras distintas/);
        await expect(dismissProjectPair('', 'PRJ-a', { idb: db })).rejects.toThrow(/dos obras distintas/);
        await expect(dismissProjectPair('PRJ-a', 'PRJ-nada', { idb: db })).rejects.toThrow(/ya no está disponible/);
        await db.update('projects', row('PRJ-c', 'Otra', { deletedAt: 50 }));
        await expect(dismissProjectPair('PRJ-a', 'PRJ-c', { idb: db })).rejects.toThrow(/ya no está disponible/);
        expect((await db.get('projects', 'PRJ-a')).notSameAs).toBeUndefined();
    });

    test('avisa al catálogo para que lo publique', async () => {
        const heard = [];
        const listener = event => heard.push(event.detail);
        window.addEventListener('projects:setup-changed', listener);
        try {
            await dismissProjectPair('PRJ-a', 'PRJ-b', { idb: db });
        } finally {
            window.removeEventListener('projects:setup-changed', listener);
        }
        expect(heard).toEqual([{ projectId: 'PRJ-a', dismissedPair: ['PRJ-a', 'PRJ-b'] }]);
    });

    test('editar la obra desde el store no borra el descarte', async () => {
        await dismissProjectPair('PRJ-a', 'PRJ-b', { idb: db });
        const store = new ProjectStore({ db });
        const project = Project.fromJSON(await db.get('projects', 'PRJ-a'));
        project.name = 'Torre Norte II';
        await store.update(project);
        expect((await db.get('projects', 'PRJ-a')).notSameAs).toEqual(['PRJ-b']);
    });
});

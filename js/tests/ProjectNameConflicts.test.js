import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { ProjectStore } from 'actual/features/projects/ProjectStore.js';
import { projectNameKey } from '../modules/features/projects/ProjectNames.js';
import { mutateProjectCatalog, stageProjectNameConflicts, getProjectNameConflicts, resolveProjectNameConflict, prepareStoredProjectNameConflicts } from '../modules/features/projects/ProjectNameConflicts.js';
import { syncProjectCatalog, stopProjectCatalogLiveSync } from '../modules/features/projects/ProjectCatalogSync.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { openProjectNameConflicts } from '../modules/features/projects/ProjectNameConflictUI.js';
import { ensureCanonicalProject } from '../modules/features/projects/ProjectRegistry.js';
import { runTransaction } from '../modules/data/firebase.js';
import { registerProjectSetupGlobals } from '../modules/features/projects/ProjectsUI.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
const project = (id, name, updatedAt = 10, extra = {}) => ({ id, name, status: 'active', createdAt: 1, updatedAt, schemaVersion: 1, ...extra });
const snapshot = list => ({ forEach: fn => list.forEach(row => fn({ id: row.id, data: () => row })) });
const waitFor = async predicate => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 1));
    }
    throw new Error('La interfaz no terminó la operación');
};

describe('nombres únicos y resolución durable de conflictos', () => {
    let db;
    beforeEach(async () => {
        localStorage.clear();
        setProjectsEnabled(true);
        db = new IndexedDBService(`name-conflicts-${Math.random()}`);
        await db.init();
        document.body.innerHTML = '';
    });
    afterEach(() => {
        stopProjectCatalogLiveSync();
        document.querySelector('[data-conflict-close]')?.click();
        document.body.innerHTML = '';
        db.db.close();
        setProjectsEnabled(false);
        localStorage.clear();
    });

    test('dos pestañas creando el mismo nombre: solo una confirma la transacción', async () => {
        const other = new IndexedDBService(db.dbName);
        await other.init();
        try {
            const results = await Promise.allSettled([
                new ProjectStore({ db }).create(project('A', 'Torre Norte')),
                new ProjectStore({ db: other }).create(project('B', '  TORRE   NORTE '))
            ]);
            expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
            expect(results.find(result => result.status === 'rejected').reason.message).toMatch(/Ya existe una obra/);
            expect(await db.getAll('projects')).toHaveLength(1);
        } finally { other.db.close(); }
    });

    test('la escritura rechaza renombrar con el nombre de una obra archivada y normaliza Unicode al comparar', async () => {
        await db.update('projects', project('A', 'Construcción', 10, { status: 'archived', closedAt: 1, archivedAt: 2 }));
        await db.update('projects', project('B', 'Sur'));
        expect(projectNameKey('Construccio\u0301n')).toBe(projectNameKey('Construcción'));
        await expect(new ProjectStore({ db }).update(project('B', 'CONSTRUCCIO\u0301N'))).rejects.toThrow(/Ya existe/);
        expect((await db.get('projects', 'B')).name).toBe('Sur');
    });

    test('llegan dos IDs con el mismo nombre: conserva ambos y no publica etiquetas pendientes', async () => {
        await db.update('projects', project('A', 'Mi obra'));
        await db.update('employees', { id: 'EMP-A', number: '001', projectId: 'A', loans: [{ id: 'loan', amount: 300 }] });
        await db.update('employees', { id: 'EMP-B', number: '002', projectId: 'B', loans: [] });
        const writeDoc = jest.fn();
        const remote = [project('B', ' mi  OBRA ', 20)];
        const options = { uid: 'test', idb: db, readDocs: async () => snapshot(remote), writeDoc };
        await syncProjectCatalog(options);
        const rows = await db.getAll('projects');
        expect(new Set(rows.map(row => projectNameKey(row.name))).size).toBe(2);
        const pending = await getProjectNameConflicts({ idb: db });
        expect(pending).toHaveLength(1);
        expect(pending[0]).toMatchObject({ id: 'B', metadata: { nameConflict: { requestedName: ' mi  OBRA ', source: 'cloud' } } });
        const before = JSON.stringify(rows);
        await syncProjectCatalog(options);
        expect(JSON.stringify(await db.getAll('projects'))).toBe(before);
        expect(writeDoc.mock.calls.some(([, data]) => data.id === 'B' && data.name)).toBe(false);
        expect((await db.getAll('employees')).map(row => row.projectId)).toEqual(['A', 'B']);
    });

    test('renombrado remoto del mismo ID que colisiona: también requiere resolver', async () => {
        await db.update('projects', project('A', 'Norte'));
        await db.update('projects', project('B', 'Sur'));
        await syncProjectCatalog({ uid: 'test', idb: db, readDocs: async () => snapshot([project('B', 'NORTE', 20)]), writeDoc: jest.fn() });
        expect((await db.get('projects', 'A')).name).toBe('Norte');
        expect((await getProjectNameConflicts({ idb: db }))[0].id).toBe('B');
    });

    test('actualizar la obra original no traslada el conflicto a otro ID', async () => {
        await db.update('projects', project('A', 'Norte'));
        const options = { uid: 'test', idb: db, writeDoc: jest.fn() };
        await syncProjectCatalog({ ...options, readDocs: async () => snapshot([project('B', 'NORTE', 20)]) });
        const [pending] = await getProjectNameConflicts({ idb: db });
        await syncProjectCatalog({ ...options, readDocs: async () => snapshot([project('A', 'Norte', 30), project('B', 'NORTE', 20)]) });
        expect((await db.get('projects', 'A')).name).toBe('Norte');
        expect((await getProjectNameConflicts({ idb: db }))[0]).toEqual(pending);
    });

    test('el registro canónico tampoco publica un nombre provisional', async () => {
        const [, pending] = stageProjectNameConflicts([project('A', 'Norte'), project('B', 'NORTE')]);
        const calls = runTransaction.mock.calls.length;
        expect(await ensureCanonicalProject({ uid: 'test', localProject: pending })).toEqual({ canonicalId: 'B', status: 'provisional-name-conflict' });
        expect(runTransaction.mock.calls).toHaveLength(calls);
    });

    test('registrar la UI no resuelve ni crea una obra antes de hidratar los datos', async () => {
        const getState = jest.spyOn(projectSetupService, 'getState');
        try {
            registerProjectSetupGlobals();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(getState).not.toHaveBeenCalled();
            expect(await db.getAll('projects')).toEqual([]);
        } finally { getState.mockRestore(); }
    });

    test('un dispositivo vacío conserva todos los IDs de un catálogo remoto ya duplicado', async () => {
        await syncProjectCatalog({ uid: 'test', idb: db, readDocs: async () => snapshot([
            project('A', 'Norte'), project('B', 'norte'), project('C', 'NORTE')
        ]), writeDoc: jest.fn() });
        const rows = await db.getAll('projects');
        expect(rows).toHaveLength(3);
        expect(new Set(rows.map(row => projectNameKey(row.name))).size).toBe(3);
        expect(await getProjectNameConflicts({ idb: db })).toHaveLength(2);
    });

    test('la resolución sobrevive a recargar y se publica por el mismo ID sin alterar sus datos', async () => {
        const future = Date.now() + 86400000;
        const remote = [project('A', 'Norte'), project('B', 'norte', future)];
        const writeDoc = jest.fn();
        await db.update('employees', { id: 'e', number: '001', projectId: 'B', loans: [{ id: 'l', amount: 700 }] });
        await db.update('attendance', { key: 'e-2026-10-21', employeeId: 'e', date: '2026-10-21', projectId: 'B', hoursWorked: 8 });
        const options = { uid: 'test', idb: db, readDocs: async () => snapshot(remote), writeDoc };
        await syncProjectCatalog(options);
        const config = await db.get('projectPayrollConfigs', 'B');
        const before = await db.getAll('employees');
        const attendance = await db.getAll('attendance');
        db.db.close();
        db = new IndexedDBService(db.dbName);
        await db.init();
        const [pending] = await getProjectNameConflicts({ idb: db });
        const saved = await resolveProjectNameConflict('B', 'Norte · segunda etapa', { idb: db, expectedConflict: pending.metadata.nameConflict });
        expect(saved.updatedAt).toBeGreaterThan(future);
        expect(await getProjectNameConflicts({ idb: db })).toEqual([]);
        writeDoc.mockClear();
        await syncProjectCatalog({ ...options, idb: db });
        expect(writeDoc.mock.calls.some(([, data]) => data.id === 'B' && data.name === 'Norte · segunda etapa')).toBe(true);
        expect(await db.getAll('employees')).toEqual(before);
        expect(await db.getAll('attendance')).toEqual(attendance);
        expect(await db.get('projectPayrollConfigs', 'B')).toEqual(config);
    });

    test('un nombre ocupado o un conflicto que cambió no se confirma', async () => {
        for (const row of stageProjectNameConflicts([project('A', 'Norte'), project('B', 'NORTE')])) await db.update('projects', row);
        const [pending] = await getProjectNameConflicts({ idb: db });
        await expect(resolveProjectNameConflict('B', 'norte', { idb: db })).rejects.toThrow(/Ya existe/);
        await expect(resolveProjectNameConflict('B', 'Sur', { idb: db, expectedConflict: { requestedName: 'Anterior' } })).rejects.toThrow(/conflicto cambió/);
        expect(await db.get('projects', 'B')).toEqual(pending);
    });

    test('un nombre remoto nuevo y libre elimina un pendiente anterior sin renombrar otras obras', async () => {
        const writeDoc = jest.fn();
        await db.update('projects', project('A', 'Norte'));
        await syncProjectCatalog({ uid: 'test', idb: db, readDocs: async () => snapshot([project('B', 'NORTE', 20)]), writeDoc });
        await syncProjectCatalog({ uid: 'test', idb: db, readDocs: async () => snapshot([project('B', 'Sur', 30)]), writeDoc });
        expect((await db.get('projects', 'B')).name).toBe('Sur');
        expect(await getProjectNameConflicts({ idb: db })).toEqual([]);
        expect((await db.get('projects', 'A')).name).toBe('Norte');
    });

    test('los duplicados preexistentes se distinguen de forma idempotente sin borrar obras', async () => {
        await db.update('projects', project('A', 'Mi obra'));
        await db.update('projects', project('B', 'MI OBRA'));
        const first = await prepareStoredProjectNameConflicts({ idb: db });
        expect(first).toHaveLength(1);
        expect(first[0].metadata.nameConflict.source).toBe('existing');
        expect(await prepareStoredProjectNameConflicts({ idb: db })).toEqual(first);
    });

    test('un fallo durante la escritura revierte todo el catálogo', async () => {
        await db.update('projects', project('A', 'Original'));
        const cycle = {}; cycle.self = cycle;
        await expect(mutateProjectCatalog(db, () => ({ writes: [project('A', 'Otro'), project('B', 'Sur', 10, { cycle })] }))).rejects.toThrow();
        expect((await db.get('projects', 'A')).name).toBe('Original');
        expect(await db.get('projects', 'B')).toBeUndefined();
    });

    test('el modal conserva edición ante errores, permite posponer y retomar, y resuelve', async () => {
        for (const row of stageProjectNameConflicts([project('A', 'Norte'), project('B', 'NORTE')])) await db.update('projects', row);
        document.body.innerHTML = '<button id="opener">Revisar nombres</button>';
        document.getElementById('opener').focus();
        await openProjectNameConflicts({ idb: db });
        document.querySelector('input').value = 'norte';
        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await waitFor(() => document.querySelector('[data-conflict-error]')?.textContent.includes('Ya existe'));
        expect(document.querySelector('input').value).toBe('norte');
        document.querySelector('[data-conflict-close]').click();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(await getProjectNameConflicts({ idb: db })).toHaveLength(1);
        expect(document.activeElement.id).toBe('opener');
        await openProjectNameConflicts({ idb: db });
        document.querySelector('input').value = 'Torre Sur';
        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await waitFor(() => !document.querySelector('[role="dialog"]'));
        expect((await db.get('projects', 'B')).name).toBe('Torre Sur');
        expect(await getProjectNameConflicts({ idb: db })).toEqual([]);
    });

    test('la revisión automática espera a app:ready y respeta un onboarding abierto', async () => {
        for (const row of stageProjectNameConflicts([project('C', 'Obra nueva'), project('D', 'OBRA NUEVA')])) await db.update('projects', row);
        const read = jest.spyOn(mockedIDB, 'getAll').mockImplementation((...args) => db.getAll(...args));
        try {
            window.dispatchEvent(new CustomEvent('projects:name-conflicts'));
            await new Promise(resolve => setTimeout(resolve, 5));
            expect(document.querySelector('#project-name-conflict-modal')).toBeNull();
            document.body.innerHTML = '<div role="dialog" id="onboarding-test">Configurando</div>';
            window.dispatchEvent(new CustomEvent('app:ready'));
            await new Promise(resolve => setTimeout(resolve, 5));
            expect(document.querySelector('#project-name-conflict-modal')).toBeNull();
            document.getElementById('onboarding-test').remove();
            window.dispatchEvent(new CustomEvent('projects:name-conflicts'));
            await waitFor(() => !!document.querySelector('#project-name-conflict-modal input'));
            document.querySelector('[data-conflict-close]').click();
        } finally { read.mockRestore(); }
    });
});

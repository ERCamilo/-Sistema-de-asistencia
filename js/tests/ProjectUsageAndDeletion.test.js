import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { ProjectStore } from 'actual/features/projects/ProjectStore.js';
import { summarizeProjectUsage, readProjectUsageData, deleteEmptyProject } from '../modules/features/projects/ProjectUsage.js';
import { syncProjectCatalog, planCatalogMerge, stopProjectCatalogLiveSync } from '../modules/features/projects/ProjectCatalogSync.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { renderProjectListHTML, mountProjectList } from '../modules/features/projects/ProjectListUI.js';
import { Header } from '../modules/ui/Header.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
const project = (id, name = id, extra = {}) => ({ id, name, status: 'active', schemaVersion: 1, createdAt: 1, updatedAt: 10, ...extra });
const snapshot = rows => ({ forEach: fn => rows.forEach(row => fn({ id: row.id, data: () => row })) });
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
const waitFor = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await tick(); } throw new Error('La interfaz no terminó'); };

describe('menú de obras: contenido y borrado de obras vacías', () => {
    let db;
    beforeEach(async () => {
        resetEntityScope(); localStorage.clear(); setProjectsEnabled(true);
        db = new IndexedDBService(`project-usage-${Math.random()}`); await db.init();
        await db.update('projects', project('A', 'Obra inicial'));
        await db.update('projects', project('B', 'Obra vacía'));
        localStorage.setItem('asistencia_active_project_id', 'A');
        localStorage.setItem('asistencia_default_project_id', 'A');
        document.body.innerHTML = '';
    });
    afterEach(() => { stopProjectCatalogLiveSync(); db.db.close(); document.body.innerHTML = ''; localStorage.clear(); resetEntityScope(); });

    test('el encabezado ofrece un botón accesible hacia el menú de obras y escapa el nombre', () => {
        document.body.innerHTML = Header({ companyName: 'Demo', activeProjectName: 'Obra <Norte>', activeTab: 'attendance' });
        const button = document.querySelector('[data-active-project-indicator]');
        expect(button.tagName).toBe('BUTTON');
        expect(button.dataset.headerAction).toBe('open-projects');
        expect(button.getAttribute('aria-haspopup')).toBe('dialog');
        expect(button.textContent).toContain('Obra <Norte>');
        expect(button.querySelector('norte')).toBeNull();
        const open = jest.fn();
        window.openProjectListModal = open;
        button.click();
        expect(open).toHaveBeenCalledTimes(1);
    });

    test('cuenta datos inactivos, préstamos pagados, asistencia histórica y cajas por vínculo oficial', () => {
        const usage = summarizeProjectUsage([project('A'), project('B')], {
            employees: [{ id: 'e1', projectId: 'A', active: false, loans: [{ id: 'l1', status: 'paid' }] }],
            positions: [{ id: 'p1', projectId: 'A', deletedAt: 5 }],
            attendance: [{ key: 'old', employeeId: 'gone', projectId: 'A' }],
            pettyCashProjects: [{ id: 'cash-1', officialProjectId: 'A' }],
            pettyCashMovements: [{ id: 'm1', projectId: 'cash-1' }],
            projectPayrollConfigs: [{ projectId: 'B', regularHoursPerDay: 8 }]
        }, { defaultProjectId: 'A' });
        expect(usage.A).toMatchObject({ empty: false, employees: 1, positions: 1, loans: 1, attendance: 1, pettyCash: 2 });
        expect(usage.B.empty).toBe(true);
    });

    test('los registros legacy pertenecen a la inicial; pagos históricos y colas bloquean su obra original', () => {
        const usage = summarizeProjectUsage([project('A'), project('B'), project('C')], {
            employees: [{ id: 'legacy' }, { id: 'moved', projectId: 'A', loans: [{ id: 'l', payments: [{ payrollProjectId: 'B' }] }] }],
            mainSyncOutbox: [{ key: 'pending', kind: 'entities', employees: [{ id: 'new', projectId: 'C' }] }]
        }, { defaultProjectId: 'A' });
        expect(usage.A.employees).toBe(2);
        expect(usage.B).toMatchObject({ employees: 0, other: 1, empty: false });
        expect(usage.C).toMatchObject({ pending: 1, empty: false });
    });

    test('los datos todavía en memoria también impiden borrar', async () => {
        await expect(deleteEmptyProject('B', { idb: db, getLiveState: () => ({ employees: [{ id: 'unsaved', projectId: 'B' }] }) })).rejects.toThrow(/contiene datos/);
        expect((await db.get('projects', 'B')).deletedAt).toBeUndefined();
    });

    test('la obra en uso y la inicial se conservan', async () => {
        await expect(deleteEmptyProject('A', { idb: db })).rejects.toThrow(/Cambia a otra obra/);
        localStorage.setItem('asistencia_active_project_id', 'B');
        await expect(deleteEmptyProject('A', { idb: db })).rejects.toThrow(/obra inicial/);
    });

    test('revalida antes del commit aunque la tarjeta hubiera mostrado cero', async () => {
        expect(summarizeProjectUsage([project('B')], await readProjectUsageData({ idb: db })).B.empty).toBe(true);
        await db.update('positions', { id: 'p', projectId: 'B', name: 'Nuevo puesto' });
        await expect(deleteEmptyProject('B', { idb: db })).rejects.toThrow(/No se borró/);
        expect((await db.get('projects', 'B')).deletedAt).toBeUndefined();
    });

    test('borrar una obra vacía persiste al recargar y no cambia otros datos', async () => {
        const employee = { id: 'e', number: '001', projectId: 'A', loans: [{ id: 'l', amount: 500 }] };
        await db.update('employees', employee);
        const deleted = await deleteEmptyProject('B', { idb: db });
        expect(deleted.deletedAt).toEqual(expect.any(Number));
        db.db.close(); db = new IndexedDBService(db.dbName); await db.init();
        const store = new ProjectStore({ db });
        expect((await store.listAll()).map(row => row.id)).toEqual(['A']);
        expect(await store.get('B')).toBeNull();
        expect(await db.get('employees', 'e')).toEqual(employee);
        await expect(store.update(project('B'))).rejects.toThrow(/fue borrada/);
    });

    test('el borrado se publica y una versión antigua no revive la obra', async () => {
        await deleteEmptyProject('B', { idb: db });
        const writeDoc = jest.fn();
        await syncProjectCatalog({ uid: 'test', idb: db, readDocs: async () => snapshot([project('B', 'Obra vacía', { updatedAt: Date.now() + 99999 })]), writeDoc });
        expect(writeDoc.mock.calls.some(([, data]) => data.id === 'B' && data.deletedAt)).toBe(true);
        expect((await new ProjectStore({ db }).listAll()).map(row => row.id)).toEqual(['A']);
        expect(planCatalogMerge([project('B', 'Vacía', { deletedAt: 20 })], [project('B', 'Vieja', { updatedAt: 999 })]).storeLocal).toEqual([]);
    });

    test('una eliminación recibida no oculta datos existentes en otro dispositivo', async () => {
        await db.update('employees', { id: 'e', projectId: 'B', loans: [{ id: 'l', amount: 800 }] });
        const writeDoc = jest.fn();
        await syncProjectCatalog({ uid: 'test', idb: db, readDocs: async () => snapshot([project('B', 'Obra vacía', { deletedAt: 50, updatedAt: 50 })]), writeDoc });
        const kept = await new ProjectStore({ db }).get('B');
        expect(kept.deletedAt).toBeUndefined();
        expect(kept.metadata.deletionConflict.deletedAt).toBe(50);
        expect((await db.get('employees', 'e')).loans[0].amount).toBe(800);
        expect(writeDoc.mock.calls.some(([, data]) => data.id === 'B')).toBe(false);
    });

    test('si los datos llegan después de la eliminación, la obra vuelve a ser visible para revisión', async () => {
        await db.update('projects', project('B', 'Obra vacía', { deletedAt: 50, updatedAt: 50 }));
        expect(await new ProjectStore({ db }).get('B')).toBeNull();
        await db.update('attendance', { key: 'late', employeeId: 'old', projectId: 'B', date: '2026-10-21', present: true });
        const kept = await new ProjectStore({ db }).get('B');
        expect(kept.metadata.deletionConflict.deletedAt).toBe(50);
        expect(kept.deletedAt).toBeUndefined();
    });

    test('un fallo al escribir no confirma el borrado', async () => {
        const original = db.db.transaction.bind(db.db);
        const fault = jest.spyOn(db.db, 'transaction').mockImplementation((...args) => {
            const tx = original(...args);
            if (args[1] === 'readwrite') {
                const getStore = tx.objectStore.bind(tx);
                tx.objectStore = name => {
                    const store = getStore(name);
                    if (name === 'projects') store.put = () => { throw new Error('Disco no disponible'); };
                    return store;
                };
            }
            return tx;
        });
        try { await expect(deleteEmptyProject('B', { idb: db })).rejects.toThrow('Disco no disponible'); }
        finally { fault.mockRestore(); }
        expect((await db.get('projects', 'B')).deletedAt).toBeUndefined();
    });

    test('la tarjeta solo ofrece borrado después de verificar y exige confirmación', async () => {
        document.body.innerHTML = '<div id="list"></div>';
        const list = document.getElementById('list');
        const service = {
            getProjectUsage: async rows => summarizeProjectUsage(rows, await readProjectUsageData({ idb: db })),
            deleteEmptyProject: jest.fn(async target => deleteEmptyProject(target, { idb: db })),
            getState: async () => ({ projects: await new ProjectStore({ db }).listAll(), activeProjectId: 'A', defaultProjectId: 'A' })
        };
        mountProjectList(list, { projects: [project('B')], setupService: service });
        expect(list.querySelector('[data-project-delete]')).toBeNull();
        await waitFor(() => !!list.querySelector('[data-project-delete]'));
        list.querySelector('[data-project-delete]').click();
        expect(service.deleteEmptyProject).not.toHaveBeenCalled();
        list.querySelector('[data-project-delete-cancel]').click();
        expect(service.deleteEmptyProject).not.toHaveBeenCalled();
        list.querySelector('[data-project-delete]').click();
        list.querySelector('[data-project-delete-confirm]').click();
        await waitFor(() => !list.querySelector('[data-project-id="B"]'));
        expect(service.deleteEmptyProject).toHaveBeenCalledTimes(1);
        expect(renderProjectListHTML({ projects: [project('B')] })).toContain('Datos sin verificar');
    });
});

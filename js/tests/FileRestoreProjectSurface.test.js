import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import {
    prepareRestoreProjectSurface,
    handleRestoreProjectChoiceRequired,
    getPendingFullImport,
    cancelFullImportProjectChoice
} from '../modules/features/export/ExportController.js';
import { projectStore } from '../modules/features/projects/ProjectStore.js';
import { defaultProjectService } from '../modules/features/projects/DefaultProject.js';
import { projectContext } from '../modules/features/projects/ProjectContext.js';
import { DEFAULT_PROJECT_LS_KEY, ACTIVE_PROJECT_LS_KEY, replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = (x) => JSON.parse(JSON.stringify(x));
}

/**
 * "Restaurar desde archivo" usa el mismo preflight de obras que FULL. Antes
 * no escribía projects/projectPayrollConfigs: la config de nómina de la obra
 * se perdía y, en un dispositivo que no conocía la obra, los projectId del
 * respaldo quedaban huérfanos (y bloqueaban los guardados).
 */
const PRJ_A = 'PRJ-obra-alpha-0001';
const PRJ_B = 'PRJ-obra-beta-0002';
const LOCAL_PROJECT = 'PRJ-local-limpio-0003';
const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

function backup({ multi = false } = {}) {
    const projects = [{ id: PRJ_A, name: 'Obra Alpha', status: 'active', createdAt: 1000 }];
    if (multi) projects.push({ id: PRJ_B, name: 'Obra Beta', status: 'active', createdAt: 2000 });
    return {
        settings: { companyName: 'Constructora', regularHoursPerDay: 8 },
        employees: [
            { id: 'emp-a', number: '1', name: 'Con obra', projectId: PRJ_A, active: true, positions: ['pos-a'], loans: [] },
            { id: 'emp-u', number: '2', name: 'Sin obra', active: true, positions: ['pos-a'], loans: [] }
        ],
        positions: [{ id: 'pos-a', name: 'Ayudante', projectId: PRJ_A, active: true }],
        leaders: [{ id: 'lead-u', number: '1', name: 'Lider', active: true }],
        attendance: { 'emp-u-2026-09-18': { employeeId: 'emp-u', date: '2026-09-18', present: true, hoursWorked: 8 } },
        tempAssignments: [],
        dayHoursConfig: {},
        projects,
        projectBackup: { version: 1, projectsEnabled: true, defaultProjectId: PRJ_A, activeProjectId: PRJ_A, projectIds: projects.map(p => p.id) },
        projectPayrollConfigs: [{ projectId: PRJ_A, regularHoursPerDay: 8, holidays: ['2026-01-26'], payPeriod: { periodStart: '2026-09-11', periodLength: 21 }, schemaVersion: 1 }]
    };
}

describe('Restaurar desde archivo: superficie de obras', () => {
    let db;

    beforeEach(async () => {
        localStorage.clear();
        db = new IndexedDBService('file-restore-projects-' + Math.random());
        await db.init();
        for (const method of ['saveState', 'getAll', 'get', 'update', 'delete', 'batchUpdate', 'batchDelete', 'clear', 'clearAll']) {
            mockedIDB[method].mockImplementation((...args) => db[method](...args));
        }
        projectStore.db = db;
        defaultProjectService.store = projectStore;
        projectContext.store = projectStore;
        projectContext.defaults = defaultProjectService;
        setProjectsEnabled(true);
        // Dispositivo que NO conoce la obra del respaldo.
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, LOCAL_PROJECT);
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, LOCAL_PROJECT);
        await db.update('projects', { id: LOCAL_PROJECT, name: 'Local', status: 'active', createdAt: 1 });
        replaceEntityScope({ enabled: true, projectId: LOCAL_PROJECT, defaultProjectId: LOCAL_PROJECT });
    });

    afterEach(() => {
        cancelFullImportProjectChoice();
        for (const method of ['saveState', 'getAll', 'get', 'update', 'delete', 'batchUpdate', 'batchDelete', 'clear', 'clearAll']) {
            mockedIDB[method].mockReset();
        }
        resetEntityScope();
        setProjectsEnabled(false);
        localStorage.clear();
        db.db.close();
    });

    test('una obra: adopta catálogo y config de nómina y asigna a esa obra los datos sin obra', async () => {
        const data = backup();
        const surface = await prepareRestoreProjectSurface(data);

        expect(surface.projects.map(p => p.id)).toEqual([PRJ_A]);
        expect(surface.projectPayrollConfigs).toEqual([expect.objectContaining({ projectId: PRJ_A, holidays: ['2026-01-26'] })]);
        expect(surface.incomingScope).toEqual({ enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_A });
        expect(data.employees.map(e => e.projectId)).toEqual([PRJ_A, PRJ_A]);
        expect(data.leaders[0].projectId).toBe(PRJ_A);
        expect(data.attendance['emp-u-2026-09-18'].projectId).toBe(PRJ_A);
        // Nada se escribe en el preflight.
        expect((await db.getAll('projects')).map(p => p.id)).toEqual([LOCAL_PROJECT]);
    });

    test('varias obras con datos sin obra: pide elegir con la misma UI que FULL sin mutar nada', async () => {
        const data = backup({ multi: true });
        let error;
        try { await prepareRestoreProjectSurface(data); } catch (e) { error = e; }

        expect(error?.reconciliation?.reason).toBe('MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS');
        expect(handleRestoreProjectChoiceRequired(error)).toBe(true);
        expect(getPendingFullImport().validProjects.map(p => p.id)).toEqual([PRJ_A, PRJ_B]);
        expect((await db.getAll('employees'))).toEqual([]);
        expect((await db.getAll('projects')).map(p => p.id)).toEqual([LOCAL_PROJECT]);
    });

    test('un projectId que no está en el catálogo del respaldo falla cerrado y no es una elección', async () => {
        const data = backup();
        data.employees[1].projectId = 'PRJ-inexistente-0009';
        let error;
        try { await prepareRestoreProjectSurface(data); } catch (e) { error = e; }

        expect(error?.message).toMatch(/projectId inexistente/);
        expect(handleRestoreProjectChoiceRequired(error)).toBe(false);
    });

    test('obras desactivadas: restauración legacy sin preflight', async () => {
        setProjectsEnabled(false);
        expect(await prepareRestoreProjectSurface(backup())).toBeNull();
    });
});

describe('applyBackupData: cableado del preflight de obras', () => {
    const body = APP_SRC.match(/async function applyBackupData[\s\S]*?\n\}/)[0];

    test('el preflight corre antes de aislar y de tocar el estado', () => {
        const preflight = body.indexOf('await prepareRestoreProjectSurface(data)');
        expect(preflight).toBeGreaterThan(-1);
        expect(preflight).toBeLessThan(body.indexOf('beginFullImportIsolation()'));
        expect(preflight).toBeLessThan(body.indexOf('state.settings = data.settings'));
    });

    test('guarda catálogo y config con la superficie y fija punteros solo tras el guardado durable', () => {
        expect(body).toMatch(/projectSurface: projects, entityScope: projects\.incomingScope/);
        const durable = body.indexOf('durableCommitted = true;');
        const commit = body.indexOf('commitRestoredProjectSurface(projects, previousProjectPointers)');
        expect(commit).toBeGreaterThan(durable);
        expect(body.indexOf('readRestoreProjectPointers()')).toBeLessThan(body.indexOf('await prepareRestoreProjectSurface(data)'));
    });

    test('una elección de obra pendiente no se reporta como error', () => {
        const choice = body.indexOf('handleRestoreProjectChoiceRequired(error)');
        expect(choice).toBeGreaterThan(-1);
        expect(choice).toBeLessThan(body.indexOf("logError(error, 'aplicar el backup local')"));
    });
});

import fs from 'fs';
import path from 'path';
import { PROJECT_STATUS } from '../modules/features/projects/Project.js';
import { ProjectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { DefaultProjectService } from '../modules/features/projects/DefaultProject.js';
import {
    projectNameKey,
    findProjectNameConflict,
    firstAvailableProjectName
} from '../modules/features/projects/ProjectNames.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';

/**
 * Dos obras no pueden llamarse igual (sin distinguir mayúsculas y con los
 * espacios normalizados). Crear ya lo validaba; renombrar la obra activa, la
 * obra creada desde "Datos pendientes de asignación" y la obra por defecto no.
 */
const row = (id, name, status = PROJECT_STATUS.ACTIVE) => ({ id, name, status, schemaVersion: 1, createdAt: 100, updatedAt: 100 });

function harness(rows, activeId) {
    let data = rows.map(r => ({ ...r }));
    const store = {
        listAll: jest.fn(async () => data.map(r => ({ ...r }))),
        get: jest.fn(async id => data.find(r => r.id === id) || null),
        create: jest.fn(async project => { const p = project.toJSON ? project.toJSON() : { ...project }; data.push(p); return { ...p }; }),
        update: jest.fn(async project => { const p = project.toJSON ? project.toJSON() : { ...project }; data = data.map(r => r.id === p.id ? p : r); return { ...p }; })
    };
    const service = new ProjectSetupService({
        store,
        getScope: async () => ({ enabled: true, projectId: activeId, defaultProjectId: activeId }),
        flags: { isEnabled: () => true, setEnabled: () => {} }
    });
    return { service, store, rows: () => data };
}

describe('nombres de obra únicos', () => {
    test('la clave ignora mayúsculas y espacios de más', () => {
        expect(projectNameKey('  Torre   Norte ')).toBe(projectNameKey('torre norte'));
        expect(findProjectNameConflict('TORRE NORTE', [row('A', 'Torre Norte')])).toMatchObject({ id: 'A' });
        expect(findProjectNameConflict('Torre Norte', [row('A', 'Torre Norte')], { excludeId: 'A' })).toBeNull();
        expect(findProjectNameConflict('Torre Sur', [row('A', 'Torre Norte')])).toBeNull();
    });

    test('renombrar la obra activa con el nombre de otra obra se rechaza', async () => {
        const h = harness([row('A', 'Torre Norte'), row('B', 'Torre Sur', PROJECT_STATUS.ARCHIVED)], 'A');
        await expect(h.service.renameActiveProject('  torre   SUR ')).rejects.toThrow(/Ya existe una obra con el nombre "Torre Sur"/);
        expect(h.store.update).not.toHaveBeenCalled();
    });

    test('renombrar la obra activa cambiando solo mayúsculas o a un nombre libre se permite', async () => {
        const h = harness([row('A', 'Torre Norte'), row('B', 'Torre Sur')], 'A');
        await expect(h.service.renameActiveProject('TORRE NORTE')).resolves.toMatchObject({ activeProject: { name: 'TORRE NORTE' } });
        await expect(h.service.renameActiveProject('Torre Este')).resolves.toMatchObject({ activeProject: { name: 'Torre Este' } });
    });

    test('la obra por defecto no repite el nombre de una obra cerrada o archivada', async () => {
        localStorage.clear();
        setProjectsEnabled(true);
        try {
            const h = harness([row('OLD-1', 'Mi obra', PROJECT_STATUS.ARCHIVED), row('OLD-2', 'mi obra 2', PROJECT_STATUS.CLOSED)], null);
            const service = new DefaultProjectService({ store: h.store, crossTabLock: { run: (_name, fn) => fn() } });
            const created = await service.ensureDefaultProject();
            expect(created.name).toBe('Mi obra 3');
            expect(firstAvailableProjectName('Mi obra', [])).toBe('Mi obra');
        } finally {
            setProjectsEnabled(false);
            localStorage.clear();
        }
    });

    test('crear una obra desde "Datos pendientes de asignación" valida el nombre también al escribir', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../modules/features/projects/ProjectOwnershipRepairService.js'), 'utf8');
        const create = src.slice(src.indexOf('function computeCreateProjectAndMap('));
        const check = create.indexOf('findProjectNameConflict(resolvedName, durableProjects, { excludeId: target })');
        expect(check).toBeGreaterThan(-1);
        expect(check).toBeLessThan(create.indexOf('txPut('));
        expect(create.slice(check, check + 300)).toContain('conflictResult(duplicateProjectNameMessage(nameConflict))');
    });
});

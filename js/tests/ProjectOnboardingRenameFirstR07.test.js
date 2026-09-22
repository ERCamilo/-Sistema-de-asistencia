import {
    executeFirstProjectOnboarding,
    executeProjectOnboarding
} from '../modules/features/projects/ProjectOnboarding.js';
import { ProjectSetupService, normalizeProjectSetupName } from '../modules/features/projects/ProjectSetupService.js';
import { PROJECT_STATUS } from '../modules/features/projects/Project.js';
import { getState } from '../modules/features/employees/EmployeesUI.js';

/**
 * R07 A2a — ProjectOnboardingRenameFirstR07
 *
 * Contract: first-project onboarding mode NEVER creates a second project.
 * ProjectsBoot/DefaultProject already guarantee one real default project at
 * boot, so first-project mode reconfigures (renames) THAT existing project.
 * Normal Projects-menu creation (createEmptyProject) still creates second+
 * projects. Rename/configure compensates/rolls back (durable snapshot) when
 * later optional structure persistence fails — all-or-nothing.
 */
function createHarness({ enabled = true, projects = null, activeId = 'PRJ-DEFAULT-0001' } = {}) {
    let flag = enabled;
    let rows = projects || [
        {
            id: activeId,
            name: 'Mi obra',
            status: PROJECT_STATUS.ACTIVE,
            schemaVersion: 1,
            createdAt: 1000,
            updatedAt: 1000
        }
    ];

    const flags = {
        isEnabled: jest.fn(() => flag),
        setEnabled: jest.fn(val => { flag = val === true; })
    };

    const store = {
        listAll: jest.fn(async () => rows.map(r => ({ ...r }))),
        get: jest.fn(async id => rows.find(r => r.id === id) || null),
        create: jest.fn(async project => {
            const payload = typeof project?.toJSON === 'function' ? project.toJSON() : { ...project };
            rows.push({ ...payload });
            return { ...payload };
        }),
        update: jest.fn(async project => {
            const payload = typeof project?.toJSON === 'function' ? project.toJSON() : { ...project };
            payload.updatedAt = Date.now();
            rows = rows.map(r => r.id === payload.id ? { ...payload } : r);
            return { ...payload };
        }),
        delete: jest.fn(async id => {
            rows = rows.filter(r => r.id !== id);
            return true;
        })
    };

    const getScope = jest.fn(async () => ({
        enabled: flag,
        projectId: flag ? activeId : null,
        defaultProjectId: flag ? activeId : null
    }));

    const service = new ProjectSetupService({ store, getScope, flags });
    return { service, flags, store, getRows: () => rows, activeId };
}

async function withStatePositions(positions, callback) {
    const appState = getState();
    const previousPositions = appState.positions;
    appState.positions = positions;
    try {
        return await callback(appState);
    } finally {
        appState.positions = previousPositions;
    }
}

function makeTemplate(id, name = 'Oficial Albañil') {
    return { id, name, hourlyRate: 350, color: '#06b6d4' };
}

describe('ProjectOnboardingRenameFirstR07 — first-project mode reuses the existing default project', () => {
    test('renameDefaultProjectForOnboarding renames the EXISTING active/default project in place (no creation)', async () => {
        const h = createHarness();
        const result = await h.service.renameDefaultProjectForOnboarding({ name: 'Torre Mirador' });

        expect(result.project.id).toBe(h.activeId);
        expect(result.project.name).toBe('Torre Mirador');
        expect(result.previousProject.name).toBe('Mi obra');
        expect(h.store.create).not.toHaveBeenCalled();
        expect(h.getRows().length).toBe(1);
        expect(h.getRows()[0].name).toBe('Torre Mirador');
    });

    test('rename allows the project own current name (any casing) but rejects collisions with ANOTHER project', async () => {
        const h = createHarness({
            projects: [
                { id: 'PRJ-DEFAULT-0001', name: 'Mi obra', status: PROJECT_STATUS.ACTIVE, schemaVersion: 1, createdAt: 1000, updatedAt: 1000 },
                { id: 'PRJ-OTHER-0002', name: 'Obra Vecina', status: PROJECT_STATUS.ACTIVE, schemaVersion: 1, createdAt: 2000, updatedAt: 2000 }
            ]
        });

        // Self-rename (same id) is valid.
        const ok = await h.service.renameDefaultProjectForOnboarding({ name: 'MI   OBRA' });
        expect(ok.project.id).toBe('PRJ-DEFAULT-0001');
        expect(ok.project.name).toBe('MI OBRA');

        // Collision with another project fails closed without touching the store.
        const updatesBeforeCollision = h.store.update.mock.calls.length;
        await expect(h.service.renameDefaultProjectForOnboarding({ name: 'obra vecina' }))
            .rejects.toThrow(/Ya existe un proyecto con el nombre "Obra Vecina"/i);
        expect(h.store.update.mock.calls.length).toBe(updatesBeforeCollision);
    });

    test('projects OFF: first-project rename fails closed without touching the store', async () => {
        const h = createHarness({ enabled: false });
        await expect(h.service.renameDefaultProjectForOnboarding({ name: 'Torre Mirador' }))
            .rejects.toThrow(/Activa Proyectos antes de configurar la primera obra/i);
        expect(h.store.update).not.toHaveBeenCalled();
        expect(h.getRows()[0].name).toBe('Mi obra');
    });

    test('executeFirstProjectOnboarding renames the existing project and NEVER creates a second one', async () => {
        const h = createHarness();
        const result = await executeFirstProjectOnboarding({
            projectName: 'Primera Obra Real',
            mode: 'empty',
            setupService: h.service,
            persistenceService: { savePositions: jest.fn(async () => true) }
        });

        expect(result.reusedExistingProject).toBe(true);
        expect(result.project.id).toBe(h.activeId);
        expect(result.project.name).toBe('Primera Obra Real');
        expect(h.store.create).not.toHaveBeenCalled();
        expect(h.getRows().length).toBe(1);
        expect(h.getRows()[0].name).toBe('Primera Obra Real');
    });

    test('first-project mode rejects empty names and the copy mode', async () => {
        const h = createHarness();
        await expect(executeFirstProjectOnboarding({
            projectName: '   ',
            setupService: h.service
        })).rejects.toThrow(/Escribe el nombre del proyecto/i);

        await expect(executeFirstProjectOnboarding({
            projectName: 'Primera Obra',
            mode: 'copy',
            setupService: h.service
        })).rejects.toThrow(/modo copiar estructura no está disponible para la primera obra/i);

        expect(h.store.create).not.toHaveBeenCalled();
        expect(h.store.update).not.toHaveBeenCalled();
    });

    test('manual structure clones positions into the reused project and persists before success', async () => {
        const h = createHarness();
        const savePositions = jest.fn(async () => true);

        await withStatePositions([], async appState => {
            const result = await executeFirstProjectOnboarding({
                projectName: 'Primera Obra Manual',
                mode: 'manual',
                setupService: h.service,
                selectedPositions: [makeTemplate('TPL-1')],
                persistenceService: { savePositions }
            });

            expect(result.positions).toHaveLength(1);
            expect(result.positions[0].projectId).toBe(h.activeId);
            expect(result.positions[0].id).toMatch(/^POS-CLONE-/);
            expect(result.positions[0].leaderId).toBeNull();
            expect(appState.positions).toContain(result.positions[0]);
            expect(savePositions).toHaveBeenCalledTimes(1);
        });

        expect(h.store.create).not.toHaveBeenCalled();
        expect(h.getRows().length).toBe(1);
        expect(h.getRows()[0].name).toBe('Primera Obra Manual');
    });

    test('optional structure persistence failure compensates: positions rolled back and durable rename snapshot restored', async () => {
        const h = createHarness();
        const savePositions = jest.fn(async () => false);

        await withStatePositions([], async appState => {
            let caught = null;
            try {
                await executeFirstProjectOnboarding({
                    projectName: 'Primera Obra Fallida',
                    mode: 'manual',
                    setupService: h.service,
                    selectedPositions: [makeTemplate('TPL-FAIL')],
                    persistenceService: { savePositions }
                });
            } catch (error) {
                caught = error;
            }

            expect(caught).toBeInstanceOf(Error);
            expect(caught.message).toMatch(/No se pudo persistir la estructura de la obra/i);

            // In-memory rollback: no cloned position left behind.
            expect(appState.positions.length).toBe(0);

            // Compensation: durable snapshot of the previous default restored.
            expect(h.store.create).not.toHaveBeenCalled();
            expect(h.getRows().length).toBe(1);
            expect(h.getRows()[0].name).toBe('Mi obra');
        });
    });

    test('compensation failure surfaces a combined error with cause, without half-renamed project', async () => {
        const h = createHarness();
        const rename = h.service.renameDefaultProjectForOnboarding.bind(h.service);
        const failingService = Object.create(h.service);
        failingService.renameDefaultProjectForOnboarding = rename;
        failingService.restoreDefaultProjectSnapshot = jest.fn(async () => {
            throw new Error('store offline');
        });

        await withStatePositions([], async appState => {
            let caught = null;
            try {
                await executeFirstProjectOnboarding({
                    projectName: 'Primera Obra Comp',
                    mode: 'manual',
                    setupService: failingService,
                    selectedPositions: [makeTemplate('TPL-COMP')],
                    persistenceService: { savePositions: jest.fn(async () => false) }
                });
            } catch (error) {
                caught = error;
            }

            expect(caught).toBeInstanceOf(Error);
            expect(caught.message).toMatch(/No se pudo persistir la estructura de la obra/i);
            expect(caught.message).toMatch(/La compensación del renombrado falló: store offline/i);
            expect(caught.cause).toBeTruthy();
            expect(caught.cause.compensationError).toBeTruthy();
            // In-memory clones were still rolled back.
            expect(appState.positions.length).toBe(0);
        });
    });

    test('normal Projects-menu onboarding still creates a SECOND project (unchanged path)', async () => {
        const h = createHarness();
        const result = await executeProjectOnboarding({
            mode: 'empty',
            projectName: 'Segunda Obra Nueva',
            setupService: h.service,
            persistenceService: { savePositions: jest.fn(async () => true) }
        });

        expect(result.project.id).not.toBe(h.activeId);
        expect(result.project.name).toBe('Segunda Obra Nueva');
        expect(h.store.create).toHaveBeenCalledTimes(1);
        expect(h.getRows().length).toBe(2);
        expect(h.getRows().some(p => p.name === 'Mi obra')).toBe(true);
    });

    test('name normalization matches the canonical setup rules', () => {
        expect(normalizeProjectSetupName('   Torre    Norte   ')).toBe('Torre Norte');
        expect(() => normalizeProjectSetupName('')).toThrow(/obligatorio/i);
        expect(() => normalizeProjectSetupName('A'.repeat(81))).toThrow(/80 caracteres/i);
    });
});

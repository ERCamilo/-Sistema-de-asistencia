/**
 * F2.2 — Crear proyecto vacío / wizard mínimo
 *
 * Proves:
 * 1. Canonical Project.create + ProjectStore integration (no parallel identity/store).
 * 2. Bounded normalized name + explicit duplicate-name rejection.
 * 3. Projects OFF remains inert / fail-closed.
 * 4. No automatic project switch (F2.3 owns switching; active project unchanged).
 * 5. Acceptance criterion: A newly created project has ZERO scoped operational or
 *    economic records (employees, attendance, payroll closures, loans, advances, cash).
 * 6. UI accessibility from official list and setup modals, XSS safe, and sw.js caching.
 */

import fs from 'fs';
import path from 'path';
import { Project, PROJECT_STATUS } from '../modules/features/projects/Project.js';
import { ProjectStore, PROJECTS_STORE } from '../modules/features/projects/ProjectStore.js';
import {
    ProjectSetupService,
    projectSetupService,
    normalizeProjectSetupName,
    assertUniqueProjectName,
    PROJECT_SETUP_NAME_MAX_LENGTH
} from '../modules/features/projects/ProjectSetupService.js';
import {
    renderProjectCreateFormHTML,
    mountProjectCreateForm,
    openProjectCreateModal,
    closeProjectCreateModal
} from '../modules/features/projects/ProjectCreateUI.js';
import {
    openProjectListModal,
    closeProjectListModal
} from '../modules/features/projects/ProjectListUI.js';
import {
    openProjectSetupModal,
    closeProjectSetupModal,
    registerProjectSetupGlobals
} from '../modules/features/projects/ProjectsUI.js';
import {
    effectiveProjectId,
    entityInScope
} from '../modules/features/projects/EntityProjectScope.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { createPayrollProjectContext } from '../modules/features/payroll/PayrollProjectContext.js';

describe('F2.2 — ProjectSetupService.createEmptyProject & Name Invariants', () => {
    function createHarness({ enabled = true, initialProjects = null, activeId = 'PRJ-A' } = {}) {
        let flag = enabled;
        let rows = initialProjects || [
            {
                id: activeId,
                name: 'Mi obra inicial',
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

    test('projects OFF: createEmptyProject fails closed without writing to store', async () => {
        const h = createHarness({ enabled: false });
        await expect(h.service.createEmptyProject({ name: 'Nueva Obra' }))
            .rejects.toThrow(/Activa Proyectos antes de crear un nuevo proyecto/i);

        expect(h.store.create).not.toHaveBeenCalled();
        expect(h.store.listAll).not.toHaveBeenCalled();
    });

    test('rejects empty or whitespace-only project name', async () => {
        const h = createHarness({ enabled: true });
        await expect(h.service.createEmptyProject({ name: '' }))
            .rejects.toThrow(/El nombre del proyecto es obligatorio/i);
        await expect(h.service.createEmptyProject({ name: '    ' }))
            .rejects.toThrow(/El nombre del proyecto es obligatorio/i);
        expect(h.store.create).not.toHaveBeenCalled();
    });

    test('rejects project name exceeding max length (80 characters)', async () => {
        const h = createHarness({ enabled: true });
        const tooLong = 'A'.repeat(PROJECT_SETUP_NAME_MAX_LENGTH + 1);
        await expect(h.service.createEmptyProject({ name: tooLong }))
            .rejects.toThrow(/no puede superar 80 caracteres/i);
        expect(h.store.create).not.toHaveBeenCalled();
    });

    test('normalizes whitespace in project name', async () => {
        const h = createHarness({ enabled: true });
        const result = await h.service.createEmptyProject({ name: '   Torre    Norte   Piso   1  ' });
        expect(result.project.name).toBe('Torre Norte Piso 1');
    });

    test('explicit duplicate-name behavior: rejects case-insensitive match against active project', async () => {
        const h = createHarness({
            enabled: true,
            initialProjects: [
                { id: 'PRJ-1', name: 'Residencial San Pedro', status: PROJECT_STATUS.ACTIVE, schemaVersion: 1, createdAt: 100, updatedAt: 100 }
            ]
        });

        await expect(h.service.createEmptyProject({ name: 'residencial san pedro' }))
            .rejects.toThrow(/Ya existe un proyecto con el nombre "Residencial San Pedro"/i);

        await expect(h.service.createEmptyProject({ name: '  RESIDENCIAL   SAN   PEDRO  ' }))
            .rejects.toThrow(/Ya existe un proyecto con el nombre "Residencial San Pedro"/i);

        expect(h.store.create).not.toHaveBeenCalled();
    });

    test('explicit duplicate-name behavior: rejects match against closed or archived project', async () => {
        const h = createHarness({
            enabled: true,
            initialProjects: [
                { id: 'PRJ-1', name: 'Obra Vieja', status: PROJECT_STATUS.CLOSED, schemaVersion: 1, createdAt: 100, updatedAt: 100, closedAt: 200 },
                { id: 'PRJ-2', name: 'Obra Archivada', status: PROJECT_STATUS.ARCHIVED, schemaVersion: 1, createdAt: 100, updatedAt: 100, closedAt: 200, archivedAt: 300 }
            ]
        });

        await expect(h.service.createEmptyProject({ name: 'Obra Vieja' }))
            .rejects.toThrow(/Ya existe un proyecto con el nombre "Obra Vieja"/i);
        await expect(h.service.createEmptyProject({ name: 'obra archivada' }))
            .rejects.toThrow(/Ya existe un proyecto con el nombre "Obra Archivada"/i);

        expect(h.store.create).not.toHaveBeenCalled();
    });

    test('creates canonical active Project with unique stable PRJ- id and timestamps', async () => {
        const h = createHarness({ enabled: true });
        const before = Date.now();
        const { project, state } = await h.service.createEmptyProject({ name: 'Edificio Horizonte' });
        const after = Date.now();

        expect(project.id).toMatch(/^PRJ-[0-9a-z]+-[0-9a-z]{4}$/);
        expect(project.name).toBe('Edificio Horizonte');
        expect(project.status).toBe(PROJECT_STATUS.ACTIVE);
        expect(project.schemaVersion).toBe(1);
        expect(project.createdAt).toBeGreaterThanOrEqual(before);
        expect(project.createdAt).toBeLessThanOrEqual(after);
        expect(project.updatedAt).toBe(project.createdAt);

        // Saved in store
        expect(h.store.create).toHaveBeenCalledTimes(1);
        const stored = h.getRows().find(r => r.id === project.id);
        expect(stored).toBeTruthy();
        expect(stored.name).toBe('Edificio Horizonte');

        // State overview reflects new project
        expect(state.projects.some(p => p.id === project.id)).toBe(true);
    });

    test('does NOT automatically switch active project (F2.3 owns switching)', async () => {
        const h = createHarness({ enabled: true, activeId: 'PRJ-A' });
        const { project, state } = await h.service.createEmptyProject({ name: 'Nueva Obra Sin Switch' });

        expect(project.id).not.toBe('PRJ-A');
        expect(state.activeProjectId).toBe('PRJ-A');
        expect(state.activeProject.id).toBe('PRJ-A');
    });
});

describe('F2.2 Acceptance Criterion — Newly Created Project Starts Completely EMPTY', () => {
    beforeAll(() => {
        setProjectsEnabled(true);
    });

    afterAll(() => {
        setProjectsEnabled(false);
    });

    test('newly created project has ZERO scoped operational or economic records', async () => {
        const PRJ_DEFAULT = 'PRJ-DEFAULT-0001';
        const store = new ProjectStore({
            db: {
                _data: new Map([
                    [PRJ_DEFAULT, { id: PRJ_DEFAULT, name: 'Obra Principal', status: 'active', schemaVersion: 1, createdAt: 1000, updatedAt: 1000 }]
                ]),
                async get(_store, id) { return this._data.get(id) || null; },
                async getAll() { return Array.from(this._data.values()); },
                async update(_store, val) { this._data.set(val.id, { ...val }); }
            }
        });

        const service = new ProjectSetupService({
            store,
            getScope: async () => ({ enabled: true, projectId: PRJ_DEFAULT, defaultProjectId: PRJ_DEFAULT }),
            flags: { isEnabled: () => true, setEnabled: () => {} }
        });

        // Pre-existing operational/economic state for PRJ_DEFAULT
        const existingState = {
            employees: [
                {
                    id: 'EMP-1',
                    nombre: 'Carlos Perez',
                    projectId: PRJ_DEFAULT,
                    loans: [{ id: 'LN-1', amount: 500, balance: 250 }],
                    advances: [{ id: 'ADV-1', amount: 100 }],
                    notes: 'Nota empleado 1'
                },
                {
                    id: 'EMP-2',
                    nombre: 'Ana Gómez',
                    // No explicit projectId => inherits default PRJ_DEFAULT
                    loans: [],
                    advances: []
                }
            ],
            positions: [
                { id: 'POS-1', name: 'Maestro de obra', projectId: PRJ_DEFAULT }
            ],
            leaders: [
                { id: 'LDR-1', name: 'Jefe A', projectId: PRJ_DEFAULT }
            ],
            attendance: {
                'EMP-1-2026-03-01': {
                    employeeId: 'EMP-1',
                    workDate: '2026-03-01',
                    hours: 8,
                    projectId: PRJ_DEFAULT,
                    notes: 'Presente'
                }
            },
            payrollClosures: [
                {
                    id: 'PC-1',
                    projectId: PRJ_DEFAULT,
                    periodStart: '2026-03-01',
                    periodEnd: '2026-03-15',
                    totalPaid: 1500
                }
            ],
            pettyCashMovements: [
                {
                    id: 'CASH-1',
                    officialProjectId: PRJ_DEFAULT,
                    amount: 300,
                    concept: 'Materiales'
                }
            ]
        };

        // Create the empty project
        const { project: newProject } = await service.createEmptyProject({ name: 'Obra Totalmente Vacía' });
        expect(newProject.id).toBeTruthy();
        expect(newProject.id).not.toBe(PRJ_DEFAULT);

        // Scope corresponding to the newly created project
        const scopeNewProject = {
            enabled: true,
            projectId: newProject.id,
            defaultProjectId: PRJ_DEFAULT
        };

        // 1. Employees in scope of new project: ZERO
        const scopedEmployees = existingState.employees.filter(e => entityInScope(e, scopeNewProject));
        expect(scopedEmployees).toHaveLength(0);

        // 2. Positions in scope: ZERO
        const scopedPositions = existingState.positions.filter(p => entityInScope(p, scopeNewProject));
        expect(scopedPositions).toHaveLength(0);

        // 3. Leaders in scope: ZERO
        const scopedLeaders = existingState.leaders.filter(l => entityInScope(l, scopeNewProject));
        expect(scopedLeaders).toHaveLength(0);

        // 4. Attendance & Payroll context scoped to new project: ZERO
        const payrollCtx = createPayrollProjectContext({
            state: existingState,
            scope: scopeNewProject
        });
        expect(payrollCtx.employees).toHaveLength(0);
        expect(payrollCtx.positions).toHaveLength(0);
        expect(payrollCtx.leaders).toHaveLength(0);
        expect(payrollCtx.getAttendance('EMP-1', '2026-03-01')).toBeUndefined();
        expect(Object.keys(payrollCtx.attendance).filter(k => entityInScope(payrollCtx.attendance[k], scopeNewProject))).toHaveLength(0);

        // 5. Loans and advances in scope of new project: ZERO
        const scopedLoans = existingState.employees
            .filter(e => entityInScope(e, scopeNewProject))
            .flatMap(e => e.loans || []);
        expect(scopedLoans).toHaveLength(0);

        const scopedAdvances = existingState.employees
            .filter(e => entityInScope(e, scopeNewProject))
            .flatMap(e => e.advances || []);
        expect(scopedAdvances).toHaveLength(0);

        // 6. Payroll closures for new project: ZERO
        const scopedClosures = existingState.payrollClosures.filter(c => c.projectId === newProject.id);
        expect(scopedClosures).toHaveLength(0);

        // 7. Petty cash movements for new project: ZERO
        const scopedCash = existingState.pettyCashMovements.filter(
            m => m.projectId === newProject.id || m.officialProjectId === newProject.id
        );
        expect(scopedCash).toHaveLength(0);
    });
});

describe('F2.2 ProjectCreateUI — Component and Form Interactivity', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        closeProjectCreateModal();
        closeProjectListModal();
        closeProjectSetupModal();
    });

    test('renderProjectCreateFormHTML includes input, bounds (80), subtitle, and buttons', () => {
        const html = renderProjectCreateFormHTML();
        expect(html).toContain('Crear proyecto vacío');
        expect(html).toContain('Asistente mínimo: el nuevo proyecto comenzará con asistencia, nómina y caja vacías');
        expect(html).toContain('data-project-create-name');
        expect(html).toContain('maxlength="80"');
        expect(html).toContain('data-project-create-submit');
        expect(html).toContain('data-project-create-cancel');
    });

    test('mountProjectCreateForm updates character count dynamically', () => {
        mountProjectCreateForm(container);
        const input = container.querySelector('[data-project-create-name]');
        const charCount = container.querySelector('[data-project-create-char-count]');

        expect(charCount.textContent).toBe('0/80');

        input.value = 'Mi nueva obra';
        input.dispatchEvent(new Event('input'));

        expect(charCount.textContent).toBe('13/80');
    });

    test('mountProjectCreateForm escapes error message preventing XSS', async () => {
        const mockSetup = {
            createEmptyProject: jest.fn(async () => {
                throw new Error('<script>alert("xss")</script> & error');
            })
        };

        mountProjectCreateForm(container, { setupService: mockSetup });
        const input = container.querySelector('[data-project-create-name]');
        const form = container.querySelector('[data-project-create-element]');
        const statusEl = container.querySelector('[data-project-create-status]');

        input.value = 'Obra XSS';
        input.dispatchEvent(new Event('input'));
        form.dispatchEvent(new Event('submit'));

        await Promise.resolve();
        await Promise.resolve();

        expect(statusEl.innerHTML).not.toContain('<script>');
        expect(statusEl.innerHTML).toContain('&lt;script&gt;');
        expect(statusEl.innerHTML).toContain('&amp; error');
    });

    test('mountProjectCreateForm calls onCancel when cancel buttons are clicked', () => {
        const onCancel = jest.fn();
        mountProjectCreateForm(container, { onCancel });

        const cancelBtn = container.querySelector('[data-project-create-cancel-btn]');
        cancelBtn.click();
        expect(onCancel).toHaveBeenCalledTimes(1);

        const cancelIcon = container.querySelector('[data-project-create-cancel]');
        cancelIcon.click();
        expect(onCancel).toHaveBeenCalledTimes(2);
    });

    test('mountProjectCreateForm successful submit calls service and onSuccess callback', async () => {
        const createdProject = { id: 'PRJ-NEW-1', name: 'Plaza Mayor', status: 'active' };
        const mockSetup = {
            createEmptyProject: jest.fn(async ({ name }) => ({
                project: { ...createdProject, name },
                state: { projects: [createdProject], activeProjectId: 'PRJ-OLD' }
            }))
        };

        const onSuccess = jest.fn();
        let notifiedMsg = '';
        window.showNotification = jest.fn(msg => { notifiedMsg = msg; });
        const eventListener = jest.fn();
        window.addEventListener('projects:created', eventListener);

        mountProjectCreateForm(container, { setupService: mockSetup, onSuccess });
        const input = container.querySelector('[data-project-create-name]');
        const form = container.querySelector('[data-project-create-element]');

        input.value = 'Plaza Mayor';
        form.dispatchEvent(new Event('submit'));

        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(mockSetup.createEmptyProject).toHaveBeenCalledWith({ name: 'Plaza Mayor' });
        expect(onSuccess).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Plaza Mayor' }),
            expect.any(Object)
        );
        expect(input.value).toBe('');
        expect(window.showNotification).toHaveBeenCalled();
        expect(notifiedMsg).toContain('Plaza Mayor');
        expect(eventListener).toHaveBeenCalled();

        window.removeEventListener('projects:created', eventListener);
    });

    test('openProjectCreateModal opens standalone creation dialog and handles close', async () => {
        const mockSetup = {
            getState: jest.fn(async () => ({ enabled: true })),
            createEmptyProject: jest.fn(async () => ({
                project: { id: 'PRJ-1', name: 'Obra 1' },
                state: {}
            }))
        };

        const modalEl = await openProjectCreateModal({ setupService: mockSetup });
        expect(modalEl).toBeTruthy();
        expect(document.getElementById('project-create-modal')).toBeTruthy();

        closeProjectCreateModal();
        expect(document.getElementById('project-create-modal')).toBeNull();
    });

    test('openProjectCreateModal fails closed if projects feature is disabled', async () => {
        const mockSetup = {
            getState: jest.fn(async () => ({ enabled: false }))
        };
        window.showNotification = jest.fn();

        const modalEl = await openProjectCreateModal({ setupService: mockSetup });
        expect(modalEl).toBeNull();
        expect(document.getElementById('project-create-modal')).toBeNull();
        expect(window.showNotification).toHaveBeenCalledWith(
            expect.stringMatching(/no está activado/i),
            'error'
        );
    });
});

describe('F2.2 Integration — Official Projects UI & List Creation Access', () => {
    afterEach(() => {
        closeProjectListModal();
        closeProjectSetupModal();
    });

    test('openProjectListModal includes creation button that reveals form and updates list', async () => {
        let projects = [
            { id: 'PRJ-ORIG', name: 'Obra Origen', status: 'active', schemaVersion: 1, createdAt: 100, updatedAt: 100 }
        ];

        const mockSetup = {
            getState: jest.fn(async () => ({
                enabled: true,
                ready: true,
                activeProjectId: 'PRJ-ORIG',
                defaultProjectId: 'PRJ-ORIG',
                projects: [...projects]
            })),
            createEmptyProject: jest.fn(async ({ name }) => {
                const created = { id: 'PRJ-NEW-2', name, status: 'active', schemaVersion: 1, createdAt: 200, updatedAt: 200 };
                projects.push(created);
                return {
                    project: created,
                    state: {
                        enabled: true,
                        ready: true,
                        activeProjectId: 'PRJ-ORIG',
                        defaultProjectId: 'PRJ-ORIG',
                        projects: [...projects]
                    }
                };
            })
        };

        await openProjectListModal({ setupService: mockSetup });
        const modalEl = document.getElementById('project-list-modal');
        expect(modalEl).toBeTruthy();

        // Check for creation trigger button
        const createBtn = modalEl.querySelector('[data-project-create-open]');
        expect(createBtn).toBeTruthy();
        expect(createBtn.textContent).toContain('Nuevo proyecto');

        // Click create button to reveal form slot
        createBtn.click();
        const createSlot = modalEl.querySelector('[data-project-create-slot]');
        expect(createSlot.style.display).not.toBe('none');

        const input = createSlot.querySelector('[data-project-create-name]');
        expect(input).toBeTruthy();

        // Submit form
        input.value = 'Segunda Obra';
        const form = createSlot.querySelector('[data-project-create-element]');
        form.dispatchEvent(new Event('submit'));

        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Form slot hides on success
        expect(createSlot.style.display).toBe('none');

        // New project appears in list HTML without page reload
        const listMount = modalEl.querySelector('[data-project-list-mount]');
        expect(listMount.textContent).toContain('Segunda Obra');

        // Active project indicator stays on PRJ-ORIG
        const originalItem = listMount.querySelector('[data-project-id="PRJ-ORIG"]');
        expect(originalItem.querySelector('[data-active-context-badge="true"]')).toBeTruthy();

        const newItem = listMount.querySelector('[data-project-id="PRJ-NEW-2"]');
        expect(newItem.querySelector('[data-active-context-badge="true"]')).toBeNull();
    });

    test('openProjectSetupModal includes creation trigger in list section when enabled and ready', async () => {
        window.currentUser = { uid: 'u1' };
        registerProjectSetupGlobals();

        expect(typeof window.openProjectCreateModal).toBe('function');
        expect(typeof window.mountProjectCreateForm).toBe('function');

        const originalGetState = projectSetupService.getState;
        projectSetupService.getState = jest.fn(async () => ({
            enabled: true,
            ready: true,
            activeProjectId: 'PRJ-1',
            defaultProjectId: 'PRJ-1',
            activeProject: { id: 'PRJ-1', name: 'Obra Uno' },
            projects: [{ id: 'PRJ-1', name: 'Obra Uno', status: 'active', schemaVersion: 1, createdAt: 1, updatedAt: 1 }]
        }));

        try {
            await openProjectSetupModal();
            const modalEl = document.getElementById('project-setup-modal');
            expect(modalEl).toBeTruthy();

            const createBtn = modalEl.querySelector('[data-project-create-open]');
            expect(createBtn).toBeTruthy();
            expect(createBtn.textContent).toContain('Nuevo proyecto');
        } finally {
            projectSetupService.getState = originalGetState;
        }
    });

    test('Service worker caches ProjectCreateUI.js', () => {
        const sw = fs.readFileSync(path.resolve(__dirname, '../../sw.js'), 'utf8');
        expect(sw).toContain('./js/modules/features/projects/ProjectCreateUI.js');
    });
});

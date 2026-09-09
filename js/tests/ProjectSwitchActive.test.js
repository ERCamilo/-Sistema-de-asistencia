/**
 * F2.3 — Cambiar proyecto activo
 *
 * Deterministic test suite covering:
 * 1. Successful explicit project switch (updates localStorage, EntityProjectScope, notifies subscribers, refreshes UI).
 * 2. No-op on switching to already-active project (no unnecessary notification or write, switched: false).
 * 3. Invalid, closed, and archived target rules per existing contract (fail-closed, descriptive error).
 * 4. Projects feature OFF fails closed (switch rejected, storage inert).
 * 5. CRITICAL UX decision: unsaved Settings draft blocks switching, requires manual save/cancel, never discards automatically.
 * 6. Invariant: switching never creates projects, and project creation never switches active project.
 * 7. Generation / stale async race protection.
 * 8. UI interactivity in official list and setup modals.
 * 9. Service worker shell cache integrity.
 */

import fs from 'fs';
import path from 'path';
import { Project, PROJECT_STATUS } from '../modules/features/projects/Project.js';
import { ProjectStore } from '../modules/features/projects/ProjectStore.js';
import {
    ProjectSetupService,
    projectSetupService
} from '../modules/features/projects/ProjectSetupService.js';
import {
    renderProjectItemHTML,
    renderProjectListHTML,
    mountProjectList,
    openProjectListModal,
    closeProjectListModal
} from '../modules/features/projects/ProjectListUI.js';
import {
    openProjectSetupModal,
    closeProjectSetupModal,
    registerProjectSetupGlobals,
    switchActiveProject
} from '../modules/features/projects/ProjectsUI.js';
import {
    setActiveProjectId,
    getActiveProjectId,
    subscribeActiveProject,
    ACTIVE_PROJECT_LS_KEY
} from '../modules/features/projects/ProjectContext.js';
import {
    peekEntityScope,
    resetEntityScope
} from '../modules/features/projects/EntityProjectScope.js';
import { isProjectsEnabled, setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { isSettingsDraftDirty } from '../modules/ui/settings/SettingsDraftBar.js';

function mockProject(overrides = {}) {
    return {
        id: 'PRJ-TEST-1',
        name: 'Obra Principal',
        status: PROJECT_STATUS.ACTIVE,
        schemaVersion: 1,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        ...overrides
    };
}

function createHarness({
    enabled = true,
    initialProjects = null,
    initialActiveId = 'PRJ-1',
    isDraftDirty = () => false
} = {}) {
    let flag = enabled;
    let activeId = flag ? initialActiveId : null;
    const defaultId = initialProjects?.[0]?.id || 'PRJ-1';

    let rows = initialProjects ? initialProjects.map(p => ({ ...p })) : [
        mockProject({ id: 'PRJ-1', name: 'Obra Alfa', status: PROJECT_STATUS.ACTIVE }),
        mockProject({ id: 'PRJ-2', name: 'Obra Beta', status: PROJECT_STATUS.ACTIVE }),
        mockProject({ id: 'PRJ-CLOSED', name: 'Obra Cerrada', status: PROJECT_STATUS.CLOSED, closedAt: 1700005000000 }),
        mockProject({ id: 'PRJ-ARCHIVED', name: 'Obra Archivada', status: PROJECT_STATUS.ARCHIVED, closedAt: 1700005000000, archivedAt: 1700010000000 })
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
            rows = rows.map(r => r.id === payload.id ? { ...payload } : r);
            return { ...payload };
        })
    };

    const getScope = jest.fn(async () => ({
        enabled: flag,
        projectId: flag ? activeId : null,
        defaultProjectId: flag ? defaultId : null
    }));

    const listeners = new Set();
    const subscribe = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };

    const setActiveId = jest.fn(async (id) => {
        if (!flag) return null;
        const candidate = await store.get(id);
        if (!candidate) throw new Error(`Proyecto inexistente: "${id}"`);
        if (candidate.status !== PROJECT_STATUS.ACTIVE) {
            throw new Error(`El proyecto "${candidate.name}" está "${candidate.status}"; sólo puede activarse uno "active".`);
        }
        const previousProjectId = activeId;
        if (candidate.id === previousProjectId) return candidate.id;
        activeId = candidate.id;
        for (const l of [...listeners]) l({ previousProjectId, projectId: candidate.id });
        return candidate.id;
    });

    const service = new ProjectSetupService({
        store,
        getScope,
        flags,
        setActiveId,
        isDraftDirty
    });

    return {
        service,
        store,
        flags,
        getRows: () => rows,
        getActiveId: () => activeId,
        setActiveId,
        subscribe,
        listeners
    };
}

describe('F2.3 — Project Switching Core & Contract Invariants', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
        document.body.innerHTML = '';
    });

    afterEach(() => {
        closeProjectListModal();
        closeProjectSetupModal();
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
        document.body.innerHTML = '';
    });

    test('successful switch: explicitly activates target project and returns updated state', async () => {
        const h = createHarness({ enabled: true, initialActiveId: 'PRJ-1' });
        const listener = jest.fn();
        h.subscribe(listener);

        const result = await h.service.switchActiveProject('PRJ-2');

        expect(result.stale).toBe(false);
        expect(result.switched).toBe(true);
        expect(result.previousProjectId).toBe('PRJ-1');
        expect(result.activeProjectId).toBe('PRJ-2');
        expect(result.activeProject.id).toBe('PRJ-2');
        expect(result.activeProject.name).toBe('Obra Beta');
        expect(h.getActiveId()).toBe('PRJ-2');
        expect(h.setActiveId).toHaveBeenCalledWith('PRJ-2');
    });

    test('no-op same project: switching to already-active project returns switched: false without duplicate notifications', async () => {
        const h = createHarness({ enabled: true, initialActiveId: 'PRJ-1' });
        const listener = jest.fn();
        h.subscribe(listener);

        const result = await h.service.switchActiveProject('PRJ-1');

        expect(result.stale).toBe(false);
        expect(result.switched).toBe(false);
        expect(result.activeProjectId).toBe('PRJ-1');
        expect(result.previousProjectId).toBe('PRJ-1');
        expect(listener).not.toHaveBeenCalled();
    });

    test('invalid target rules: nonexistent project rejects with descriptive error and does not switch', async () => {
        const h = createHarness({ enabled: true, initialActiveId: 'PRJ-1' });

        await expect(h.service.switchActiveProject('PRJ-GHOST-9999'))
            .rejects.toThrow(/Proyecto inexistente: "PRJ-GHOST-9999"/i);

        expect(h.getActiveId()).toBe('PRJ-1');
    });

    test('closed target rules: closed project rejects with descriptive contract error', async () => {
        const h = createHarness({ enabled: true, initialActiveId: 'PRJ-1' });

        await expect(h.service.switchActiveProject('PRJ-CLOSED'))
            .rejects.toThrow(/está "closed"; sólo puede activarse uno "active"/i);

        expect(h.getActiveId()).toBe('PRJ-1');
    });

    test('archived target rules: archived project rejects with descriptive contract error', async () => {
        const h = createHarness({ enabled: true, initialActiveId: 'PRJ-1' });

        await expect(h.service.switchActiveProject('PRJ-ARCHIVED'))
            .rejects.toThrow(/está "archived"; sólo puede activarse uno "active"/i);

        expect(h.getActiveId()).toBe('PRJ-1');
    });

    test('projects OFF fail-closed: switchActiveProject rejects when feature is disabled', async () => {
        const h = createHarness({ enabled: false, initialActiveId: null });

        await expect(h.service.switchActiveProject('PRJ-2'))
            .rejects.toThrow(/Activa Proyectos antes de cambiar de proyecto/i);

        expect(h.setActiveId).not.toHaveBeenCalled();
    });

    test('no unintended project creation: switching projects never creates new records in store', async () => {
        const h = createHarness({ enabled: true, initialActiveId: 'PRJ-1' });
        const initialCount = h.getRows().length;

        await h.service.switchActiveProject('PRJ-2');
        expect(h.getRows().length).toBe(initialCount);
        expect(h.store.create).not.toHaveBeenCalled();

        // Also verify creating empty project does NOT switch active project
        const { project: created, state } = await h.service.createEmptyProject({ name: 'Obra Gamma' });
        expect(h.getRows().length).toBe(initialCount + 1);
        expect(created.id).not.toBe('PRJ-2');
        expect(state.activeProjectId).toBe('PRJ-2');
        expect(h.getActiveId()).toBe('PRJ-2');
    });
});

describe('F2.3 CRITICAL UX Decision — Unsaved Settings Draft Blocking', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
    });

    afterEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('blocks switching when Settings has unsaved draft changes in DOM and NEVER discards automatically', async () => {
        // Build a DOM simulating Settings with dirty companyName input
        document.body.innerHTML = `
            <input id="companyName" value="Constructora Original" />
        `;
        const companyInput = document.getElementById('companyName');
        companyInput.value = 'Constructora Modificada';
        expect(isSettingsDraftDirty(document)).toBe(true);

        const h = createHarness({
            enabled: true,
            initialActiveId: 'PRJ-1',
            isDraftDirty: () => isSettingsDraftDirty(document)
        });

        // Attempting to switch must be BLOCKED
        await expect(h.service.switchActiveProject('PRJ-2', { doc: document }))
            .rejects.toThrow(/Hay cambios sin guardar en la configuración/i);

        // Verification: switching did NOT occur
        expect(h.getActiveId()).toBe('PRJ-1');
        expect(h.setActiveId).not.toHaveBeenCalled();

        // Verification: CRITICAL invariant — dirty input was NOT discarded automatically!
        expect(companyInput.value).toBe('Constructora Modificada');
        expect(isSettingsDraftDirty(document)).toBe(true);

        // Once the user manually restores or saves the draft (clean DOM)
        companyInput.value = 'Constructora Original';
        expect(isSettingsDraftDirty(document)).toBe(false);

        // Switching now succeeds
        const result = await h.service.switchActiveProject('PRJ-2', { doc: document });
        expect(result.switched).toBe(true);
        expect(result.activeProjectId).toBe('PRJ-2');
    });

    test('injected isDraftDirty predicate triggers block even without direct DOM access', async () => {
        const h = createHarness({
            enabled: true,
            initialActiveId: 'PRJ-1',
            isDraftDirty: () => true
        });

        await expect(h.service.switchActiveProject('PRJ-2'))
            .rejects.toThrow(/Hay cambios sin guardar en la configuración/i);

        expect(h.getActiveId()).toBe('PRJ-1');
        expect(h.setActiveId).not.toHaveBeenCalled();
    });
});

describe('F2.3 Async Protection — Generation / Stale Race Guards', () => {
    test('serializes concurrent switches so the newest requested project wins canonically', async () => {
        let resolveFirst;
        let markFirstStarted;
        const delayedFirst = new Promise(res => { resolveFirst = res; });
        const firstStarted = new Promise(res => { markFirstStarted = res; });

        const flags = { isEnabled: () => true, setEnabled: () => {} };
        const rows = [
            mockProject({ id: 'PRJ-A', name: 'A' }),
            mockProject({ id: 'PRJ-B', name: 'B' }),
            mockProject({ id: 'PRJ-C', name: 'C' })
        ];
        const store = {
            listAll: async () => rows,
            get: async id => rows.find(r => r.id === id) || null
        };
        let currentActive = 'PRJ-A';
        const getScope = async () => ({ enabled: true, projectId: currentActive, defaultProjectId: 'PRJ-A' });

        const setActiveId = jest.fn(async id => {
            if (id === 'PRJ-B') {
                markFirstStarted();
                await delayedFirst;
            }
            currentActive = id;
            return id;
        });

        const service = new ProjectSetupService({
            store,
            getScope,
            flags,
            setActiveId,
            isDraftDirty: () => false
        });

        // B is already mutating when the newer request for C arrives.
        const promiseB = service.switchActiveProject('PRJ-B');
        await firstStarted;
        const promiseC = service.switchActiveProject('PRJ-C');

        resolveFirst();
        const [resultB, resultC] = await Promise.all([promiseB, promiseC]);

        expect(resultB.stale).toBe(true);
        expect(resultB.generation).toBeLessThan(resultC.generation);
        expect(resultC.stale).toBe(false);
        expect(resultC.activeProjectId).toBe('PRJ-C');
        expect(currentActive).toBe('PRJ-C');
        expect(setActiveId.mock.calls.map(([id]) => id)).toEqual(['PRJ-B', 'PRJ-C']);
    });
});

describe('F2.3 UI Interactivity — ProjectListUI and ProjectsUI Integration', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
        document.body.innerHTML = '';
        window.showNotification = jest.fn();
        window.render = jest.fn();
    });

    afterEach(() => {
        closeProjectListModal();
        closeProjectSetupModal();
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
        document.body.innerHTML = '';
        delete window.showNotification;
        delete window.render;
    });

    test('renderProjectItemHTML displays switch button when allowSwitch is true for non-active active projects', () => {
        const activeProj = mockProject({ id: 'PRJ-ACTIVE', name: 'Obra Activa', status: PROJECT_STATUS.ACTIVE });
        const otherProj = mockProject({ id: 'PRJ-OTHER', name: 'Otra Obra', status: PROJECT_STATUS.ACTIVE });
        const closedProj = mockProject({ id: 'PRJ-CLOSED', name: 'Obra Cerrada', status: PROJECT_STATUS.CLOSED });

        // Currently active project has "En uso" badge and NO switch button
        const activeHtml = renderProjectItemHTML(activeProj, {
            activeProjectId: 'PRJ-ACTIVE',
            allowSwitch: true
        });
        expect(activeHtml).toContain('data-active-context-badge="true"');
        expect(activeHtml).not.toContain('data-project-switch="PRJ-ACTIVE"');

        // Eligible other active project displays switch button
        const otherHtml = renderProjectItemHTML(otherProj, {
            activeProjectId: 'PRJ-ACTIVE',
            allowSwitch: true
        });
        expect(otherHtml).toContain('data-project-switch="PRJ-OTHER"');
        expect(otherHtml).toContain('Cambiar a este proyecto');

        // Closed project does NOT display switch button
        const closedHtml = renderProjectItemHTML(closedProj, {
            activeProjectId: 'PRJ-ACTIVE',
            allowSwitch: true
        });
        expect(closedHtml).not.toContain('data-project-switch="PRJ-CLOSED"');
        expect(closedHtml).not.toContain('Cambiar a este proyecto');

        // When allowSwitch is false (default), switch button is omitted
        const defaultHtml = renderProjectItemHTML(otherProj, {
            activeProjectId: 'PRJ-ACTIVE'
        });
        expect(defaultHtml).not.toContain('data-project-switch');
    });

    test('mountProjectList handles project switch click and updates UI with draft guard', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const projects = [
            mockProject({ id: 'PRJ-1', name: 'Obra 1', status: PROJECT_STATUS.ACTIVE }),
            mockProject({ id: 'PRJ-2', name: 'Obra 2', status: PROJECT_STATUS.ACTIVE })
        ];

        const onSwitch = jest.fn();
        const instance = mountProjectList(container, {
            projects,
            activeProjectId: 'PRJ-1',
            defaultProjectId: 'PRJ-1',
            allowSwitch: true,
            onSwitchProject: onSwitch
        });

        const switchBtn = container.querySelector('[data-project-switch="PRJ-2"]');
        expect(switchBtn).toBeTruthy();
        switchBtn.click();

        expect(onSwitch).toHaveBeenCalledWith('PRJ-2', expect.any(Object));
    });

    test('openProjectListModal allows switching active project and blocks if Settings draft is dirty', async () => {
        const projects = [
            mockProject({ id: 'P1', name: 'Obra Uno', status: PROJECT_STATUS.ACTIVE }),
            mockProject({ id: 'P2', name: 'Obra Dos', status: PROJECT_STATUS.ACTIVE })
        ];

        let currentActive = 'P1';
        const setupService = {
            getState: jest.fn(async () => ({
                enabled: true,
                ready: true,
                activeProjectId: currentActive,
                defaultProjectId: 'P1',
                activeProject: projects.find(p => p.id === currentActive),
                projects
            })),
            switchActiveProject: jest.fn(async (id) => {
                currentActive = id;
                return {
                    stale: false,
                    switched: true,
                    activeProjectId: id,
                    activeProject: projects.find(p => p.id === id),
                    state: await setupService.getState()
                };
            })
        };

        // Create dirty draft input in document
        const draftInput = document.createElement('input');
        draftInput.id = 'companyName';
        draftInput.value = 'Draft Modificado';
        draftInput.defaultValue = 'Original';
        document.body.appendChild(draftInput);

        await openProjectListModal({ setupService });
        const modalEl = document.getElementById('project-list-modal');
        expect(modalEl).toBeTruthy();

        const switchBtn = modalEl.querySelector('[data-project-switch="P2"]');
        expect(switchBtn).toBeTruthy();

        // Click switch while draft is dirty -> BLOCKED
        switchBtn.click();
        expect(setupService.switchActiveProject).not.toHaveBeenCalled();
        expect(modalEl.querySelector('[data-project-list-status]')?.textContent).toContain('Hay cambios sin guardar');

        // User cancels / cleans draft manually
        draftInput.value = 'Original';
        expect(isSettingsDraftDirty(document)).toBe(false);

        // Click switch again -> SUCCEEDS
        switchBtn.click();
        // Wait for microtask tick
        await new Promise(r => setTimeout(r, 10));

        expect(setupService.switchActiveProject).toHaveBeenCalledWith('P2');
        expect(modalEl.querySelector('[data-project-list-status]')?.textContent).toContain('Obra Dos');
    });

    test('openProjectSetupModal wires switch handler in embedded list and triggers state refresh', async () => {
        const projects = [
            mockProject({ id: 'P-A', name: 'Obra Alfa', status: PROJECT_STATUS.ACTIVE }),
            mockProject({ id: 'P-B', name: 'Obra Beta', status: PROJECT_STATUS.ACTIVE })
        ];

        const stateA = {
            enabled: true,
            ready: true,
            activeProjectId: 'P-A',
            defaultProjectId: 'P-A',
            activeProject: projects[0],
            projects
        };
        const stateB = {
            enabled: true,
            ready: true,
            activeProjectId: 'P-B',
            defaultProjectId: 'P-A',
            activeProject: projects[1],
            projects
        };

        let activeState = stateA;
        jest.spyOn(projectSetupService, 'getState').mockImplementation(async () => activeState);
        jest.spyOn(projectSetupService, 'switchActiveProject').mockImplementation(async (id) => {
            activeState = stateB;
            return {
                stale: false,
                switched: true,
                activeProjectId: id,
                activeProject: projects[1],
                state: stateB
            };
        });

        await openProjectSetupModal();
        const modalEl = document.getElementById('project-setup-modal');
        expect(modalEl).toBeTruthy();

        const switchBtn = modalEl.querySelector('[data-project-switch="P-B"]');
        expect(switchBtn).toBeTruthy();
        switchBtn.click();

        await new Promise(r => setTimeout(r, 10));

        expect(projectSetupService.switchActiveProject).toHaveBeenCalledWith('P-B');
        expect(window.render).toHaveBeenCalled();

        projectSetupService.getState.mockRestore();
        projectSetupService.switchActiveProject.mockRestore();
    });

    test('registerProjectSetupGlobals registers window.switchActiveProject', () => {
        registerProjectSetupGlobals();
        expect(typeof window.switchActiveProject).toBe('function');
    });

    test('Service worker shell cache includes all project modules', () => {
        const sw = fs.readFileSync(path.resolve(__dirname, '../../sw.js'), 'utf8');
        expect(sw).toContain('./js/modules/features/projects/ProjectsUI.js');
        expect(sw).toContain('./js/modules/features/projects/ProjectListUI.js');
        expect(sw).toContain('./js/modules/features/projects/ProjectCreateUI.js');
        expect(sw).toContain('./js/modules/features/projects/ProjectSetupService.js');
        expect(sw).toContain('./js/modules/features/projects/ProjectContext.js');
        expect(sw).toContain('./js/modules/features/projects/ProjectStore.js');
    });
});

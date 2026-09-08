import fs from 'fs';
import path from 'path';
import {
    PROJECT_FILTERS,
    PROJECT_STATUS_META,
    calculateProjectStats,
    filterProjects,
    groupProjectsByStatus,
    formatProjectDate,
    renderProjectItemHTML,
    renderProjectListHTML,
    mountProjectList,
    renderProjectList,
    openProjectListModal,
    closeProjectListModal
} from '../modules/features/projects/ProjectListUI.js';
import { PROJECT_STATUS, Project } from '../modules/features/projects/Project.js';
import { ProjectStore } from '../modules/features/projects/ProjectStore.js';
import { ProjectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import {
    openProjectSetupModal,
    closeProjectSetupModal,
    registerProjectSetupGlobals
} from '../modules/features/projects/ProjectsUI.js';

function mockProject(overrides = {}) {
    return {
        id: 'PRJ-TEST-1',
        name: 'Obra Central',
        status: PROJECT_STATUS.ACTIVE,
        schemaVersion: 1,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        ...overrides
    };
}

afterEach(() => {
    closeProjectListModal();
    closeProjectSetupModal();
    document.body.innerHTML = '';
});

describe('F2.1 ProjectListUI — Pure calculations and data helpers', () => {
    test('calculateProjectStats tallies total and per-status project counts', () => {
        expect(calculateProjectStats([])).toEqual({ total: 0, active: 0, closed: 0, archived: 0 });
        expect(calculateProjectStats(null)).toEqual({ total: 0, active: 0, closed: 0, archived: 0 });

        const projects = [
            mockProject({ id: 'P1', status: PROJECT_STATUS.ACTIVE }),
            mockProject({ id: 'P2', status: PROJECT_STATUS.ACTIVE }),
            mockProject({ id: 'P3', status: PROJECT_STATUS.CLOSED, closedAt: 1700005000000 }),
            mockProject({ id: 'P4', status: PROJECT_STATUS.ARCHIVED, closedAt: 1700005000000, archivedAt: 1700010000000 })
        ];

        const stats = calculateProjectStats(projects);
        expect(stats).toEqual({
            total: 4,
            active: 2,
            closed: 1,
            archived: 1
        });
    });

    test('filterProjects filters correctly by status and returns all for "all"', () => {
        const projects = [
            mockProject({ id: 'P1', status: PROJECT_STATUS.ACTIVE }),
            mockProject({ id: 'P2', status: PROJECT_STATUS.CLOSED }),
            mockProject({ id: 'P3', status: PROJECT_STATUS.ARCHIVED })
        ];

        expect(filterProjects(projects, PROJECT_FILTERS.ALL).map(p => p.id)).toEqual(['P1', 'P2', 'P3']);
        expect(filterProjects(projects, 'all').map(p => p.id)).toEqual(['P1', 'P2', 'P3']);
        expect(filterProjects(projects, PROJECT_FILTERS.ACTIVE).map(p => p.id)).toEqual(['P1']);
        expect(filterProjects(projects, PROJECT_FILTERS.CLOSED).map(p => p.id)).toEqual(['P2']);
        expect(filterProjects(projects, PROJECT_FILTERS.ARCHIVED).map(p => p.id)).toEqual(['P3']);
    });

    test('groupProjectsByStatus classifies projects into active, closed, and archived arrays', () => {
        const projects = [
            mockProject({ id: 'P1', status: PROJECT_STATUS.ACTIVE }),
            mockProject({ id: 'P2', status: PROJECT_STATUS.CLOSED }),
            mockProject({ id: 'P3', status: PROJECT_STATUS.ACTIVE }),
            mockProject({ id: 'P4', status: PROJECT_STATUS.ARCHIVED })
        ];

        const grouped = groupProjectsByStatus(projects);
        expect(grouped[PROJECT_STATUS.ACTIVE].map(p => p.id)).toEqual(['P1', 'P3']);
        expect(grouped[PROJECT_STATUS.CLOSED].map(p => p.id)).toEqual(['P2']);
        expect(grouped[PROJECT_STATUS.ARCHIVED].map(p => p.id)).toEqual(['P4']);
    });

    test('formatProjectDate outputs deterministic YYYY-MM-DD or dash on invalid dates', () => {
        expect(formatProjectDate(null)).toBe('—');
        expect(formatProjectDate(undefined)).toBe('—');
        expect(formatProjectDate('invalid')).toBe('—');

        const timestamp = new Date(2026, 4, 15, 12, 0, 0).getTime();
        expect(formatProjectDate(timestamp)).toBe('2026-05-15');
    });

    test('PROJECT_STATUS_META provides metadata for active, closed, and archived states', () => {
        expect(PROJECT_STATUS_META[PROJECT_STATUS.ACTIVE].label).toBe('Activo');
        expect(PROJECT_STATUS_META[PROJECT_STATUS.ACTIVE].badgeClass).toBe('badge-status-active');
        expect(PROJECT_STATUS_META[PROJECT_STATUS.CLOSED].label).toBe('Cerrado');
        expect(PROJECT_STATUS_META[PROJECT_STATUS.CLOSED].badgeClass).toBe('badge-status-closed');
        expect(PROJECT_STATUS_META[PROJECT_STATUS.ARCHIVED].label).toBe('Archivado');
        expect(PROJECT_STATUS_META[PROJECT_STATUS.ARCHIVED].badgeClass).toBe('badge-status-archived');
    });
});

describe('F2.1 ProjectListUI — HTML Rendering and XSS Sanitization', () => {
    test('renderProjectItemHTML displays name, ID, status badge, and dates', () => {
        const project = mockProject({
            id: 'PRJ-ABC',
            name: 'Construcción Torre 1',
            status: PROJECT_STATUS.ACTIVE,
            createdAt: new Date(2026, 0, 10).getTime()
        });

        const html = renderProjectItemHTML(project, {
            activeProjectId: 'PRJ-ABC',
            defaultProjectId: 'PRJ-ABC'
        });

        expect(html).toContain('Construcción Torre 1');
        expect(html).toContain('PRJ-ABC');
        expect(html).toContain('data-status-badge="active"');
        expect(html).toContain('Activo');
        expect(html).toContain('data-active-context-badge="true"');
        expect(html).toContain('En uso');
        expect(html).toContain('data-default-project-badge="true"');
        expect(html).toContain('Inicial');
        expect(html).toContain('2026-01-10');
    });

    test('renderProjectItemHTML displays closedAt and archivedAt timestamps when present', () => {
        const closedProject = mockProject({
            id: 'PRJ-CLOSED',
            name: 'Obra Finalizada',
            status: PROJECT_STATUS.CLOSED,
            closedAt: new Date(2026, 2, 20).getTime()
        });
        const closedHtml = renderProjectItemHTML(closedProject);
        expect(closedHtml).toContain('data-status-badge="closed"');
        expect(closedHtml).toContain('Cerrado');
        expect(closedHtml).toContain('2026-03-20');

        const archivedProject = mockProject({
            id: 'PRJ-ARCHIVED',
            name: 'Obra Antigua',
            status: PROJECT_STATUS.ARCHIVED,
            closedAt: new Date(2026, 1, 1).getTime(),
            archivedAt: new Date(2026, 3, 1).getTime()
        });
        const archivedHtml = renderProjectItemHTML(archivedProject);
        expect(archivedHtml).toContain('data-status-badge="archived"');
        expect(archivedHtml).toContain('Archivado');
        expect(archivedHtml).toContain('2026-04-01');
    });

    test('renderProjectItemHTML escapes malicious HTML to prevent XSS', () => {
        const dangerousProject = mockProject({
            id: 'PRJ-XSS',
            name: '<script>alert("xss")</script> <b>Peligro</b>',
            metadata: {
                notes: '<img src=x onerror=alert(1)>',
                clonedFrom: { sourceProjectId: '<iframe src="bad">' }
            }
        });

        const html = renderProjectItemHTML(dangerousProject);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x');
        expect(html).not.toContain('<iframe');
        expect(html).toContain('&lt;iframe');
    });

    test('renderProjectListHTML renders filter tabs with live counters', () => {
        const projects = [
            mockProject({ id: 'P1', status: PROJECT_STATUS.ACTIVE }),
            mockProject({ id: 'P2', status: PROJECT_STATUS.CLOSED }),
            mockProject({ id: 'P3', status: PROJECT_STATUS.ARCHIVED })
        ];

        const html = renderProjectListHTML({
            projects,
            activeProjectId: 'P1',
            currentFilter: PROJECT_FILTERS.ALL
        });

        expect(html).toContain('Todos (3)');
        expect(html).toContain('Activos (1)');
        expect(html).toContain('Cerrados (1)');
        expect(html).toContain('Archivados (1)');
        expect(html).toContain('data-project-filter="all"');
        expect(html).toContain('aria-selected="true"');
    });

    test('renderProjectListHTML shows empty state message when list or filter is empty', () => {
        const emptyAll = renderProjectListHTML({ projects: [] });
        expect(emptyAll).toContain('data-empty-state="all"');
        expect(emptyAll).toContain('No hay proyectos registrados');

        const onlyActive = [mockProject({ id: 'P1', status: PROJECT_STATUS.ACTIVE })];
        const emptyClosed = renderProjectListHTML({ projects: onlyActive, currentFilter: PROJECT_STATUS.CLOSED });
        expect(emptyClosed).toContain('data-empty-state="closed"');
        expect(emptyClosed).toContain('No hay proyectos cerrados');
    });
});

describe('F2.1 ProjectListUI — Mounting and DOM Interactivity', () => {
    test('mountProjectList mounts into container and handles filter tab switches', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const projects = [
            mockProject({ id: 'P-ACTIVE', name: 'Activo 1', status: PROJECT_STATUS.ACTIVE }),
            mockProject({ id: 'P-CLOSED', name: 'Cerrado 1', status: PROJECT_STATUS.CLOSED }),
            mockProject({ id: 'P-ARCHIVED', name: 'Archivado 1', status: PROJECT_STATUS.ARCHIVED })
        ];

        const onFilterChange = jest.fn();
        const instance = mountProjectList(container, {
            projects,
            activeProjectId: 'P-ACTIVE',
            initialFilter: PROJECT_FILTERS.ALL,
            onFilterChange
        });

        expect(instance.getFilter()).toBe('all');
        expect(container.querySelectorAll('[data-project-id]').length).toBe(3);

        const closedTab = container.querySelector('[data-project-filter="closed"]');
        expect(closedTab).toBeTruthy();
        closedTab.click();

        expect(instance.getFilter()).toBe('closed');
        expect(onFilterChange).toHaveBeenCalledWith('closed');
        expect(container.querySelectorAll('[data-project-id]').length).toBe(1);
        expect(container.querySelector('[data-project-id="P-CLOSED"]')).toBeTruthy();
        expect(container.querySelector('[data-project-id="P-ACTIVE"]')).toBeNull();

        instance.setFilter('archived');
        expect(instance.getFilter()).toBe('archived');
        expect(container.querySelectorAll('[data-project-id]').length).toBe(1);
        expect(container.querySelector('[data-project-id="P-ARCHIVED"]')).toBeTruthy();

        instance.update({
            projects: [
                mockProject({ id: 'P-NEW', name: 'Nuevo Activo', status: PROJECT_STATUS.ACTIVE })
            ]
        });
        instance.setFilter('all');
        expect(container.querySelectorAll('[data-project-id]').length).toBe(1);
        expect(container.querySelector('[data-project-id="P-NEW"]')).toBeTruthy();
    });

    test('openProjectListModal and closeProjectListModal open and close the modal', async () => {
        const setupService = {
            getState: jest.fn(async () => ({
                enabled: true,
                ready: true,
                activeProjectId: 'P-MODAL',
                defaultProjectId: 'P-MODAL',
                projects: [mockProject({ id: 'P-MODAL', name: 'Obra Modal' })]
            }))
        };

        await openProjectListModal({ setupService });
        const modalEl = document.getElementById('project-list-modal');
        expect(modalEl).toBeTruthy();
        expect(modalEl.querySelector('[data-project-id="P-MODAL"]')).toBeTruthy();
        expect(modalEl.textContent).toContain('Obra Modal');

        closeProjectListModal();
        expect(document.getElementById('project-list-modal')).toBeNull();
    });

    test('openProjectListModal displays explanation when projects feature is disabled', async () => {
        const setupService = {
            getState: jest.fn(async () => ({
                enabled: false,
                ready: false,
                activeProjectId: null,
                defaultProjectId: null,
                projects: []
            }))
        };

        await openProjectListModal({ setupService });
        const modalEl = document.getElementById('project-list-modal');
        expect(modalEl).toBeTruthy();
        expect(modalEl.textContent).toContain('Proyectos no está activado');
    });
});

describe('F2.1 Negative Constraints — No lifecycle actions, no create, no switch', () => {
    test('reusable list HTML contains NO project creation or switcher actions', () => {
        const projects = [
            mockProject({ id: 'P1', status: PROJECT_STATUS.ACTIVE }),
            mockProject({ id: 'P2', status: PROJECT_STATUS.CLOSED }),
            mockProject({ id: 'P3', status: PROJECT_STATUS.ARCHIVED })
        ];

        const html = renderProjectListHTML({
            projects,
            activeProjectId: 'P1',
            defaultProjectId: 'P1'
        });

        expect(html).not.toContain('Crear proyecto');
        expect(html).not.toContain('Nuevo proyecto');
        expect(html).not.toContain('data-create-project');
        expect(html).not.toContain('Project.create(');

        expect(html).not.toContain('Cambiar a este proyecto');
        expect(html).not.toContain('Seleccionar proyecto');
        expect(html).not.toContain('data-switch-project');
        expect(html).not.toContain('setActiveProjectId');

        expect(html).not.toContain('Cerrar proyecto');
        expect(html).not.toContain('Reabrir proyecto');
        expect(html).not.toContain('Archivar proyecto');
        expect(html).not.toContain('Desarchivar proyecto');
        expect(html).not.toContain('data-close-project');
        expect(html).not.toContain('data-archive-project');
    });
});

describe('F2.1 Canonical Integration — ProjectStore, ProjectSetupService, ProjectsUI', () => {
    test('ProjectStore.listByStatus filters projects by active/closed/archived', async () => {
        const p1 = { id: 'PRJ-1', name: 'A', status: 'active', schemaVersion: 1, createdAt: 1, updatedAt: 1 };
        const p2 = { id: 'PRJ-2', name: 'B', status: 'closed', schemaVersion: 1, createdAt: 2, updatedAt: 2, closedAt: 2 };
        const p3 = { id: 'PRJ-3', name: 'C', status: 'archived', schemaVersion: 1, createdAt: 3, updatedAt: 3, closedAt: 2, archivedAt: 3 };

        const mockDb = {
            getAll: jest.fn(async () => [p1, p2, p3])
        };
        const store = new ProjectStore({ db: mockDb });

        const activeList = await store.listByStatus(PROJECT_STATUS.ACTIVE);
        expect(activeList.map(p => p.id)).toEqual(['PRJ-1']);

        const closedList = await store.listByStatus(PROJECT_STATUS.CLOSED);
        expect(closedList.map(p => p.id)).toEqual(['PRJ-2']);

        const archivedList = await store.listByStatus(PROJECT_STATUS.ARCHIVED);
        expect(archivedList.map(p => p.id)).toEqual(['PRJ-3']);
    });

    test('ProjectSetupService.getProjectsOverview returns state plus calculated stats', async () => {
        const rows = [
            { id: 'PRJ-1', name: 'Activo', status: 'active', schemaVersion: 1, createdAt: 1, updatedAt: 1 },
            { id: 'PRJ-2', name: 'Cerrado', status: 'closed', schemaVersion: 1, createdAt: 2, updatedAt: 2, closedAt: 2 }
        ];
        const store = { listAll: jest.fn(async () => rows) };
        const getScope = jest.fn(async () => ({ enabled: true, projectId: 'PRJ-1', defaultProjectId: 'PRJ-1' }));
        const flags = { isEnabled: () => true, setEnabled: () => {} };
        const service = new ProjectSetupService({ store, getScope, flags });

        const overview = await service.getProjectsOverview();
        expect(overview.enabled).toBe(true);
        expect(overview.projects.length).toBe(2);
        expect(overview.stats).toEqual({
            total: 2,
            active: 1,
            closed: 1,
            archived: 0
        });
    });

    test('ProjectsUI setup modal mounts the official reusable project list', async () => {
        window.currentUser = { uid: 'u1' };
        window.getProjectSetupState = undefined;
        registerProjectSetupGlobals();

        expect(typeof window.openProjectListModal).toBe('function');
        expect(typeof window.mountProjectList).toBe('function');
        expect(typeof window.renderProjectList).toBe('function');

        await openProjectSetupModal();
        const modalEl = document.getElementById('project-setup-modal');
        expect(modalEl).toBeTruthy();
    });

    test('Service worker caches ProjectListUI.js', () => {
        const sw = fs.readFileSync(path.resolve(__dirname, '../../sw.js'), 'utf8');
        expect(sw).toContain('./js/modules/features/projects/ProjectListUI.js');
    });
});

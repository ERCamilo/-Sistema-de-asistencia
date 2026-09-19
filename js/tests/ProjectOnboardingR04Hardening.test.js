import {
    copyProjectStructure,
    executeProjectOnboarding
} from '../modules/features/projects/ProjectOnboarding.js';
import {
    closeProjectListModal,
    openProjectListModal
} from '../modules/features/projects/ProjectListUI.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { getState } from '../modules/features/employees/EmployeesUI.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import {
    replaceEntityScope,
    resetEntityScope
} from '../modules/features/projects/EntityProjectScope.js';

function createMutablePosition({ id, projectId, leaderId = 'LDR-ORIGIN' } = {}) {
    return {
        id,
        name: 'Maestro de obra',
        projectId,
        leaderId,
        hourlyRate: 400,
        salaryConfig: {
            amount: 400,
            period: 'day',
            rules: { overtimeMultiplier: 1.5 }
        },
        workingDays: [1, 2, 3, 4, 5],
        statusHistory: [{
            active: true,
            audit: { source: 'origin' }
        }],
        metadata: {
            tags: ['origin'],
            nested: { label: 'source metadata' }
        }
    };
}

function createOnboardingSetup(projectId = 'PRJ-TARGET') {
    const projects = new Map();

    const store = {
        get: jest.fn(async id => projects.get(id) || null),
        listAll: jest.fn(async () => [...projects.values()]),
        delete: jest.fn(async id => projects.delete(id))
    };

    const setupService = {
        store,
        createEmptyProject: jest.fn(async ({ name }) => {
            const project = {
                id: projectId,
                name,
                status: 'active'
            };
            projects.set(projectId, project);
            return {
                project,
                state: {
                    activeProjectId: 'PRJ-SOURCE',
                    defaultProjectId: 'PRJ-SOURCE'
                }
            };
        }),
        compensateProjectCreation: jest.fn(async id => store.delete(id))
    };

    return { setupService, store };
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

describe('R04 hardening: project onboarding scope and durability', () => {
    test('copyProjectStructure deep-clones every mutable position structure', async () => {
        const origin = createMutablePosition({
            id: 'POS-ORIGIN',
            projectId: 'PRJ-ORIGIN'
        });

        const result = await copyProjectStructure({
            sourceProjectId: 'PRJ-ORIGIN',
            targetProjectId: 'PRJ-TARGET',
            positions: [origin],
            employees: [{ id: 'EMP-ORIGIN', projectId: 'PRJ-ORIGIN' }]
        });
        const clone = result.positions[0];

        expect(clone).toBeTruthy();
        expect(clone.id).not.toBe(origin.id);
        expect(clone.projectId).toBe('PRJ-TARGET');
        expect(clone.leaderId).toBeNull();
        expect(result.employees).toEqual([]);

        expect(clone.salaryConfig).not.toBe(origin.salaryConfig);
        expect(clone.salaryConfig.rules).not.toBe(origin.salaryConfig.rules);
        expect(clone.workingDays).not.toBe(origin.workingDays);
        expect(clone.statusHistory).not.toBe(origin.statusHistory);
        expect(clone.statusHistory[0]).not.toBe(origin.statusHistory[0]);
        expect(clone.statusHistory[0].audit).not.toBe(origin.statusHistory[0].audit);
        expect(clone.metadata).not.toBe(origin.metadata);
        expect(clone.metadata.nested).not.toBe(origin.metadata.nested);

        clone.salaryConfig.amount = 999;
        clone.salaryConfig.rules.overtimeMultiplier = 2;
        clone.workingDays.push(0);
        clone.statusHistory[0].active = false;
        clone.statusHistory[0].audit.source = 'target';
        clone.metadata.tags.push('target');
        clone.metadata.nested.label = 'target metadata';

        expect(origin.salaryConfig.amount).toBe(400);
        expect(origin.salaryConfig.rules.overtimeMultiplier).toBe(1.5);
        expect(origin.workingDays).toEqual([1, 2, 3, 4, 5]);
        expect(origin.statusHistory[0].active).toBe(true);
        expect(origin.statusHistory[0].audit.source).toBe('origin');
        expect(origin.metadata.tags).toEqual(['origin']);
        expect(origin.metadata.nested.label).toBe('source metadata');
    });

    test('manual onboarding applies the same deep independence and strips leader ownership', async () => {
        const template = createMutablePosition({
            id: 'TPL-ORIGIN',
            projectId: 'PRJ-CATALOG',
            leaderId: 'LDR-CATALOG'
        });
        const { setupService } = createOnboardingSetup('PRJ-MANUAL');

        await withStatePositions([], async appState => {
            const result = await executeProjectOnboarding({
                mode: 'manual',
                projectName: 'Obra manual R04',
                setupService,
                selectedPositions: [template],
                persistenceService: {
                    savePositions: jest.fn(async () => true)
                }
            });
            const clone = result.positions[0];

            expect(clone.leaderId).toBeNull();
            expect(clone.salaryConfig).not.toBe(template.salaryConfig);
            expect(clone.salaryConfig.rules).not.toBe(template.salaryConfig.rules);
            expect(clone.workingDays).not.toBe(template.workingDays);
            expect(clone.statusHistory).not.toBe(template.statusHistory);
            expect(clone.statusHistory[0].audit).not.toBe(template.statusHistory[0].audit);
            expect(clone.metadata).not.toBe(template.metadata);
            expect(appState.positions).toContain(clone);

            clone.salaryConfig.rules.overtimeMultiplier = 3;
            clone.workingDays[0] = 0;
            clone.statusHistory[0].audit.source = 'target';
            clone.metadata.nested.label = 'target metadata';

            expect(template.salaryConfig.rules.overtimeMultiplier).toBe(1.5);
            expect(template.workingDays).toEqual([1, 2, 3, 4, 5]);
            expect(template.statusHistory[0].audit.source).toBe('origin');
            expect(template.metadata.nested.label).toBe('source metadata');
        });
    });

    test.each([
        ['undefined', undefined],
        ['true', true],
        ['localOk true', { localOk: true }]
    ])('successful persistence adapter result %s remains onboarding success', async (_label, persistenceResult) => {
        const origin = createMutablePosition({
            id: 'POS-SUCCESS',
            projectId: 'PRJ-SOURCE'
        });
        const { setupService } = createOnboardingSetup(`PRJ-SUCCESS-${_label}`);

        await withStatePositions([origin], async () => {
            const result = await executeProjectOnboarding({
                mode: 'copy',
                projectName: `Obra éxito ${_label}`,
                sourceProjectId: 'PRJ-SOURCE',
                positions: [origin],
                setupService,
                persistenceService: {
                    savePositions: jest.fn(async () => persistenceResult)
                }
            });

            expect(result.project.id).toBe(`PRJ-SUCCESS-${_label}`);
            expect(result.positions).toHaveLength(1);
        });
    });

    test.each([
        ['false', false],
        ['localOk false', { localOk: false }]
    ])('persistence adapter result %s rejects and fully compensates onboarding', async (_label, persistenceResult) => {
        const origin = createMutablePosition({
            id: `POS-FAIL-${_label}`,
            projectId: 'PRJ-SOURCE'
        });
        const targetProjectId = `PRJ-FAIL-${_label}`;
        const { setupService, store } = createOnboardingSetup(targetProjectId);
        const persistenceService = {
            savePositions: jest.fn(async () => persistenceResult)
        };

        await withStatePositions([origin], async appState => {
            let caughtError = null;
            try {
                await executeProjectOnboarding({
                    mode: 'copy',
                    projectName: `Obra fallida ${_label}`,
                    sourceProjectId: 'PRJ-SOURCE',
                    positions: [origin],
                    setupService,
                    persistenceService
                });
            } catch (error) {
                caughtError = error;
            }

            expect(caughtError).toBeInstanceOf(Error);
            expect(appState.positions).toEqual([origin]);
            expect(appState.positions.some(position => position.projectId === targetProjectId)).toBe(false);
            expect(await store.get(targetProjectId)).toBeNull();
            expect(
                setupService.compensateProjectCreation.mock.calls.length > 0
                || store.delete.mock.calls.length > 0
            ).toBe(true);
        });
    });

    test('ProjectListUI New project entry mounts structured onboarding instead of the flat legacy form', async () => {
        setProjectsEnabled(true);
        const setupService = {
            getState: jest.fn(async () => ({
                enabled: true,
                ready: true,
                activeProjectId: 'PRJ-A',
                defaultProjectId: 'PRJ-A',
                projects: [{ id: 'PRJ-A', name: 'Obra A', status: 'active' }]
            }))
        };

        try {
            await openProjectListModal({ setupService });
            const modal = document.getElementById('project-list-modal');
            const createButton = modal?.querySelector('[data-project-create-open]');
            expect(createButton).toBeTruthy();

            createButton.click();

            expect(modal.querySelector('[data-project-onboarding]')).toBeTruthy();
            expect(modal.querySelector('[data-mode="empty"]')).toBeTruthy();
            expect(modal.querySelector('[data-mode="copy"]')).toBeTruthy();
            expect(modal.querySelector('[data-mode="manual"]')).toBeTruthy();
            expect(modal.querySelector('[data-project-create-form]')).toBeNull();
        } finally {
            closeProjectListModal();
            setProjectsEnabled(false);
        }
    });

    test('EmployeesUI leader filtering derives position links only from the active project scope', () => {
        setProjectsEnabled(true);
        replaceEntityScope({
            enabled: true,
            projectId: 'PRJ-A',
            defaultProjectId: 'PRJ-A'
        });

        const state = {
            employeeViewMode: 'employees',
            employeeFilters: {
                search: '',
                positionId: 'all',
                leaderId: 'LDR-A',
                positionIds: [],
                leaderIds: ['LDR-A'],
                status: 'active'
            },
            employees: [
                {
                    id: 'EMP-A-VALID',
                    name: 'Empleado de A',
                    number: '101',
                    active: true,
                    projectId: 'PRJ-A',
                    positions: ['POS-A']
                },
                {
                    id: 'EMP-A-CROSS-SCOPE',
                    name: 'Referencia cruzada de A',
                    number: '102',
                    active: true,
                    projectId: 'PRJ-A',
                    positions: ['POS-B']
                }
            ],
            positions: [
                { id: 'POS-A', name: 'Puesto A', active: true, projectId: 'PRJ-A', leaderId: 'LDR-A' },
                { id: 'POS-B', name: 'Puesto B', active: true, projectId: 'PRJ-B', leaderId: 'LDR-A' }
            ],
            leaders: [
                { id: 'LDR-A', name: 'Líder A', active: true, projectId: 'PRJ-A' }
            ],
            settings: { regularHoursPerDay: 8 }
        };

        try {
            EmployeesUI.init({ state, services: {} });
            const container = document.createElement('div');
            container.innerHTML = EmployeesUI.EmployeesTab();

            expect(container.querySelector('article[data-id="EMP-A-VALID"]')).toBeTruthy();
            expect(container.querySelector('article[data-id="EMP-A-CROSS-SCOPE"]')).toBeNull();
        } finally {
            resetEntityScope();
            setProjectsEnabled(false);
        }
    });
});

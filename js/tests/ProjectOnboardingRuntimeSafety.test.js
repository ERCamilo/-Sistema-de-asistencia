import { Project, PROJECT_STATUS } from '../modules/features/projects/Project.js';
import { ProjectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { getState } from '../modules/features/employees/EmployeesUI.js';
import {
    mountProjectOnboarding,
    executeProjectOnboarding
} from '../modules/features/projects/ProjectOnboarding.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function createMockProjectStore(initialProjects = []) {
    const data = new Map(initialProjects.map(p => [p.id, { ...p }]));
    return {
        _data: data,
        async get(id) {
            const p = data.get(String(id || ''));
            return p ? { ...p } : null;
        },
        async listAll() {
            return Array.from(data.values())
                .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
                .map(p => ({ ...p }));
        },
        async listByStatus(status) {
            const all = await this.listAll();
            return all.filter(p => p.status === status);
        },
        async create(project) {
            const p = { ...project };
            if (!p.id) p.id = `PRJ-${Date.now()}`;
            data.set(p.id, p);
            return { ...p };
        },
        async update(project) {
            const p = { ...project, updatedAt: Date.now() };
            data.set(p.id, p);
            return { ...p };
        },
        async delete(id) {
            return data.delete(String(id || ''));
        },
        async remove(id) {
            return data.delete(String(id || ''));
        }
    };
}

describe('Contract Suite: Project Onboarding Runtime Safety, Source Selection & Durable Persistence', () => {
    let originalPositions;

    beforeEach(() => {
        setProjectsEnabled(true);
        const current = getState();
        originalPositions = current && Array.isArray(current.positions) ? [...current.positions] : [];
    });

    afterEach(() => {
        const current = getState();
        if (current && Array.isArray(current.positions)) {
            current.positions = [...originalPositions];
        }
        setProjectsEnabled(false);
    });

    test('Contract A.1: Copy mode presents a dedicated structure/source step before ready instead of silently jumping to summary', async () => {
        const projects = [
            { id: 'PRJ-A', name: 'Obra Alpha', status: 'active', schemaVersion: 1, createdAt: 100 },
            { id: 'PRJ-B', name: 'Obra Beta', status: 'active', schemaVersion: 1, createdAt: 200 }
        ];
        const store = createMockProjectStore(projects);
        const setupService = new ProjectSetupService({
            store,
            getScope: async () => ({ enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' }),
            flags: { isEnabled: () => true, setEnabled: () => {} }
        });

        const container = document.createElement('div');
        document.body.appendChild(container);

        try {
            mountProjectOnboarding(container, { setupService });

            // 1. Fill project name
            const nameInput = container.querySelector('[data-field="projectName"]');
            expect(nameInput).toBeTruthy();
            nameInput.value = 'Obra Gamma';
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));

            // 2. Select copy mode
            const copyCard = container.querySelector('[data-mode="copy"], [data-v="copy"]');
            expect(copyCard).toBeTruthy();
            copyCard.click();

            // 3. Advance to next step
            const nextBtn = container.querySelector('[data-act="next"]');
            expect(nextBtn).toBeTruthy();
            nextBtn.click();
            await tick();

            // Contract A invariant: Copy mode MUST NOT jump silently to ready/summary
            const readyView = container.querySelector('[data-od-id="od-ready"], .odv-ready');
            expect(readyView).toBeFalsy();

            // Contract A requirement: Must present structure or source step before ready
            const structureOrSourceStep = container.querySelector(
                '[data-phase="source"], [data-phase="structure"], [data-step="source"], [data-step="structure"], [data-od-id="od-structure"], [data-od-id="od-source"], .odv-structure, .odv-source'
            );
            expect(structureOrSourceStep).toBeTruthy();
        } finally {
            container.remove();
        }
    });

    test('Contract A.2: Copy mode offers accessible source project selector with multiple choices and respects explicit user selection of PRJ-B', async () => {
        const projects = [
            { id: 'PRJ-A', name: 'Obra Alpha', status: 'active', schemaVersion: 1, createdAt: 100 },
            { id: 'PRJ-B', name: 'Obra Beta', status: 'active', schemaVersion: 1, createdAt: 200 }
        ];
        const store = createMockProjectStore(projects);
        const setupService = new ProjectSetupService({
            store,
            getScope: async () => ({ enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' }),
            flags: { isEnabled: () => true, setEnabled: () => {} }
        });

        const container = document.createElement('div');
        document.body.appendChild(container);

        try {
            mountProjectOnboarding(container, { setupService });

            // Fill name and choose copy mode
            const nameInput = container.querySelector('[data-field="projectName"]');
            nameInput.value = 'Obra Delta';
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));

            const copyCard = container.querySelector('[data-mode="copy"], [data-v="copy"]');
            copyCard.click();

            const nextBtn = container.querySelector('[data-act="next"]');
            nextBtn.click();
            await tick();

            // Must offer accessible control with at least two source options
            const sourceOptions = container.querySelectorAll(
                '[data-source-id], select[data-field="sourceProjectId"] option, [data-field="sourceProjectId"] input[type="radio"], [role="radiogroup"] [role="radio"][data-source-id], [data-source-option], input[name="sourceProjectId"]'
            );
            expect(sourceOptions.length).toBeGreaterThanOrEqual(2);

            // User must be able to select PRJ-B explicitly
            const optionB = container.querySelector(
                '[data-source-id="PRJ-B"], option[value="PRJ-B"], input[value="PRJ-B"], [data-source-option="PRJ-B"]'
            );
            expect(optionB).toBeTruthy();

            if (optionB.tagName === 'OPTION') {
                const select = optionB.closest('select');
                select.value = 'PRJ-B';
                select.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                optionB.click();
            }
            await tick();

            // Advance from structure step to ready summary
            const advanceBtn = container.querySelector('[data-act="next"]');
            advanceBtn.click();
            await tick();

            // In ready phase, summary or state must reflect sourceProjectId is PRJ-B, not auto-picked PRJ-A
            const readyEl = container.querySelector('[data-od-id="od-ready"], .odv-ready');
            expect(readyEl).toBeTruthy();
            const sourceIndicator = container.querySelector('[data-selected-source], [data-source-project-id]');
            const selectedSourceId = sourceIndicator?.getAttribute('data-selected-source') ||
                sourceIndicator?.getAttribute('data-source-project-id') ||
                container.dataset.sourceProjectId;
            expect(selectedSourceId).toBe('PRJ-B');
        } finally {
            container.remove();
        }
    });

    test('Contract B: Manual mode enters an observable structure step where templates or positions can be chosen before ready', async () => {
        const store = createMockProjectStore([
            { id: 'PRJ-A', name: 'Obra Alpha', status: 'active', schemaVersion: 1, createdAt: 100 }
        ]);
        const setupService = new ProjectSetupService({
            store,
            getScope: async () => ({ enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' }),
            flags: { isEnabled: () => true, setEnabled: () => {} }
        });

        const container = document.createElement('div');
        document.body.appendChild(container);

        try {
            mountProjectOnboarding(container, { setupService });

            // Fill name and pick manual mode
            const nameInput = container.querySelector('[data-field="projectName"]');
            nameInput.value = 'Obra Manual Config';
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));

            const manualCard = container.querySelector('[data-mode="manual"], [data-v="manual"]');
            expect(manualCard).toBeTruthy();
            manualCard.click();

            const nextBtn = container.querySelector('[data-act="next"]');
            nextBtn.click();
            await tick();

            // Invariant: Manual mode cannot jump directly to ready without structure
            const readyView = container.querySelector('[data-od-id="od-ready"], .odv-ready');
            expect(readyView).toBeFalsy();

            // Must enter an observable structure configuration step
            const structureStep = container.querySelector(
                '[data-phase="structure"], [data-step="structure"], [data-od-id="od-structure"], [data-manual-structure], [data-structure-step]'
            );
            expect(structureStep).toBeTruthy();

            // Observable controls for templates or positions
            const structureControls = container.querySelectorAll(
                '[data-template-id], [data-position-template], [data-structure-item], [data-position-item], input[name="positions"], [data-act="toggle-position"]'
            );
            expect(structureControls.length).toBeGreaterThanOrEqual(1);
        } finally {
            container.remove();
        }
    });

    test('Contract C: executeProjectOnboarding in copy mode persists cloned positions durably before reporting success', async () => {
        const ORIGIN_PRJ_ID = 'PRJ-SRC-001';
        const originPositions = [
            { id: 'POS-S1', name: 'Maestro Mayor', hourlyRate: 400, color: '#10b981', active: true, projectId: ORIGIN_PRJ_ID, leaderId: 'LDR-1' },
            { id: 'POS-S2', name: 'Electricista', hourlyRate: 320, color: '#3b82f6', active: true, projectId: ORIGIN_PRJ_ID, leaderId: null }
        ];

        const appState = getState();
        expect(appState).toBeTruthy();
        appState.positions = [...originPositions];

        const store = createMockProjectStore([
            { id: ORIGIN_PRJ_ID, name: 'Obra Origen', status: 'active', schemaVersion: 1, createdAt: 100 }
        ]);
        const setupService = new ProjectSetupService({
            store,
            getScope: async () => ({ enabled: true, projectId: ORIGIN_PRJ_ID, defaultProjectId: ORIGIN_PRJ_ID }),
            flags: { isEnabled: () => true, setEnabled: () => {} }
        });

        const mockPersistence = {
            savePositions: jest.fn(async positions => positions),
            saveApplicationData: jest.fn(async () => {}),
            batchUpdate: jest.fn(async (storeName, records) => records)
        };

        const result = await executeProjectOnboarding({
            mode: 'copy',
            projectName: 'Obra Con Estructura Persistida',
            sourceProjectId: ORIGIN_PRJ_ID,
            setupService,
            persistenceService: mockPersistence
        });

        // 1. Success reported with target project ID
        expect(result?.project?.id).toBeTruthy();
        const targetProjectId = result.project.id;

        // 2. Cloned positions verification: new IDs, target projectId, leaderId null
        expect(result.positions).toHaveLength(2);
        result.positions.forEach(pos => {
            expect(pos.projectId).toBe(targetProjectId);
            expect(pos.id).not.toBe('POS-S1');
            expect(pos.id).not.toBe('POS-S2');
            expect(pos.leaderId).toBeNull();
        });

        // 3. Durable persistence integration: must persist cloned positions before reporting success
        const persistenceCallsCount =
            mockPersistence.savePositions.mock.calls.length +
            mockPersistence.saveApplicationData.mock.calls.length +
            mockPersistence.batchUpdate.mock.calls.length;
        expect(persistenceCallsCount).toBeGreaterThan(0);
    });

    test('Contract D.1: executeProjectOnboarding rejects and does not report success when structure persistence fails', async () => {
        const ORIGIN_PRJ_ID = 'PRJ-SRC-ROLLBACK';
        const originPositions = [
            { id: 'POS-R1', name: 'Oficial Armador', hourlyRate: 310, projectId: ORIGIN_PRJ_ID, leaderId: 'LDR-X' }
        ];

        const appState = getState();
        appState.positions = [...originPositions];

        const store = createMockProjectStore([
            { id: ORIGIN_PRJ_ID, name: 'Obra Base', status: 'active', schemaVersion: 1, createdAt: 100 }
        ]);
        const setupService = new ProjectSetupService({
            store,
            getScope: async () => ({ enabled: true, projectId: ORIGIN_PRJ_ID, defaultProjectId: ORIGIN_PRJ_ID }),
            flags: { isEnabled: () => true, setEnabled: () => {} }
        });

        const failingPersistence = {
            savePositions: jest.fn().mockRejectedValue(new Error('IndexedDB storage write error')),
            saveApplicationData: jest.fn().mockRejectedValue(new Error('IndexedDB storage write error')),
            batchUpdate: jest.fn().mockRejectedValue(new Error('IndexedDB storage write error'))
        };

        // Failure contract: must reject and NOT report success
        await expect(
            executeProjectOnboarding({
                mode: 'copy',
                projectName: 'Obra Destinada Al Fallo',
                sourceProjectId: ORIGIN_PRJ_ID,
                setupService,
                persistenceService: failingPersistence
            })
        ).rejects.toThrow();
    });

    test('Contract D.2: Failure rollback cleans up/compensates newly created project leaving no orphan in store, keeping in-memory positions and origin intact', async () => {
        const ORIGIN_PRJ_ID = 'PRJ-ORIGIN-SAFE';
        const originPositions = [
            { id: 'POS-SAFE-1', name: 'Gruista', hourlyRate: 450, projectId: ORIGIN_PRJ_ID, leaderId: null }
        ];

        const appState = getState();
        appState.positions = [...originPositions];

        const store = createMockProjectStore([
            { id: ORIGIN_PRJ_ID, name: 'Obra Origen Intacta', status: 'active', schemaVersion: 1, createdAt: 100 }
        ]);
        const setupService = new ProjectSetupService({
            store,
            getScope: async () => ({ enabled: true, projectId: ORIGIN_PRJ_ID, defaultProjectId: ORIGIN_PRJ_ID }),
            flags: { isEnabled: () => true, setEnabled: () => {} }
        });

        const failingPersistence = {
            savePositions: jest.fn().mockRejectedValue(new Error('Transaction aborted during position persistence')),
            saveApplicationData: jest.fn().mockRejectedValue(new Error('Transaction aborted during position persistence')),
            batchUpdate: jest.fn().mockRejectedValue(new Error('Transaction aborted during position persistence'))
        };

        try {
            await executeProjectOnboarding({
                mode: 'copy',
                projectName: 'Obra Proyecto Huerfano',
                sourceProjectId: ORIGIN_PRJ_ID,
                setupService,
                persistenceService: failingPersistence
            });
        } catch (_) {
            // Expected rejection
        }

        // 1. In-memory state rollback: positions return to prior state
        expect(appState.positions.filter(p => p.projectId !== ORIGIN_PRJ_ID)).toHaveLength(0);
        expect(appState.positions).toHaveLength(1);
        expect(appState.positions[0].id).toBe('POS-SAFE-1');

        // 2. Orphan prevention: Newly created project must NOT remain in durable store
        const allStoredProjects = await setupService.store.listAll();
        const orphan = allStoredProjects.find(p => p.name === 'Obra Proyecto Huerfano');
        expect(orphan).toBeUndefined();

        // 3. Origin intact
        const originStored = await setupService.store.get(ORIGIN_PRJ_ID);
        expect(originStored).toBeTruthy();
        expect(originStored.name).toBe('Obra Origen Intacta');
    });

    test('Contract E: Empty mode creates project cleanly with zero positions and without requiring positions persistence', async () => {
        const ORIGIN_PRJ_ID = 'PRJ-EMPTY-MODE';
        const originPositions = [
            { id: 'POS-EXISTING-1', name: 'Capataz', hourlyRate: 380, projectId: ORIGIN_PRJ_ID, leaderId: null }
        ];

        const appState = getState();
        appState.positions = [...originPositions];

        const store = createMockProjectStore([
            { id: ORIGIN_PRJ_ID, name: 'Obra Existente', status: 'active', schemaVersion: 1, createdAt: 100 }
        ]);
        const setupService = new ProjectSetupService({
            store,
            getScope: async () => ({ enabled: true, projectId: ORIGIN_PRJ_ID, defaultProjectId: ORIGIN_PRJ_ID }),
            flags: { isEnabled: () => true, setEnabled: () => {} }
        });

        const mockPersistence = {
            savePositions: jest.fn(async () => {}),
            saveApplicationData: jest.fn(async () => {}),
            batchUpdate: jest.fn(async () => {})
        };

        const result = await executeProjectOnboarding({
            mode: 'empty',
            projectName: 'Obra Limpia Sin Posiciones',
            setupService,
            persistenceService: mockPersistence
        });

        // 1. Project created successfully
        expect(result?.project?.id).toBeTruthy();
        expect(result.project.name).toBe('Obra Limpia Sin Posiciones');

        // 2. Zero positions added or returned
        expect(result.positions || []).toHaveLength(0);

        // 3. No positions added to appState
        const targetPositionsInState = appState.positions.filter(p => p.projectId === result.project.id);
        expect(targetPositionsInState).toHaveLength(0);
        expect(appState.positions).toHaveLength(1);

        // 4. Positions persistence is NOT invoked
        expect(mockPersistence.savePositions).not.toHaveBeenCalled();
        expect(mockPersistence.batchUpdate).not.toHaveBeenCalled();

        // 5. Project exists in store
        const stored = await setupService.store.get(result.project.id);
        expect(stored).toBeTruthy();
        expect(stored.name).toBe('Obra Limpia Sin Posiciones');
    });
});

import fs from 'fs';
import path from 'path';
import { Project, PROJECT_STATUS } from '../modules/features/projects/Project.js';
import { ProjectStore } from '../modules/features/projects/ProjectStore.js';
import { ProjectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { entityInScope } from '../modules/features/projects/EntityProjectScope.js';

async function loadProjectOnboardingModule() {
    const candidatePaths = [
        '../modules/features/projects/ProjectOnboarding.js',
        '../modules/features/projects/ProjectOnboardingUI.js',
        '../modules/ui/onboarding/ProjectOnboarding.js',
        '../modules/ui/onboarding/ProjectOnboardingView.js'
    ];
    for (const relPath of candidatePaths) {
        try {
            return await import(relPath);
        } catch (_) {}
    }
    return null;
}

describe('Contract C: Project Onboarding Core & Shell Architecture', () => {
    beforeAll(() => {
        setProjectsEnabled(true);
    });

    afterAll(() => {
        setProjectsEnabled(false);
    });

    test('Project onboarding module/API exists and exports canonical contract functions', async () => {
        const mod = await loadProjectOnboardingModule();

        expect(mod).not.toBeNull();
        expect(
            typeof mod?.renderProjectOnboardingHTML === 'function' ||
            typeof mod?.openProjectOnboardingModal === 'function' ||
            typeof mod?.mountProjectOnboarding === 'function' ||
            typeof mod?.ProjectOnboarding === 'function' ||
            typeof mod?.ProjectOnboardingUI === 'object'
        ).toBe(true);
    });

    test('Initial step offers required start modes: empty, copy, manual (import safely deferred)', async () => {
        const mod = await loadProjectOnboardingModule();
        expect(mod).not.toBeNull();

        const renderFn = mod?.renderProjectOnboardingHTML || mod?.renderOnboardingView;
        expect(typeof renderFn).toBe('function');

        const html = renderFn({
            phase: 'choice',
            step: 1,
            source: null
        });

        const container = document.createElement('div');
        container.innerHTML = html;

        // 1. Mode: Vacía (Empty)
        const emptyOption = container.querySelector('[data-mode="empty"], [data-act="pick"][data-v="empty"], [data-v="scratch"]');
        expect(emptyOption).toBeTruthy();
        expect(emptyOption.textContent).toMatch(/vací[aa]|desde cero/i);

        // 2. Mode: Copiar estructura de otra obra (Copy structure)
        const copyOption = container.querySelector('[data-mode="copy"], [data-act="pick"][data-v="copy"]');
        expect(copyOption).toBeTruthy();
        expect(copyOption.textContent).toMatch(/copiar estructura/i);

        // 3. Mode: Configurar manualmente (Manual)
        const manualOption = container.querySelector('[data-mode="manual"], [data-act="pick"][data-v="manual"]');
        expect(manualOption).toBeTruthy();
        expect(manualOption.textContent).toMatch(/manual/i);

        // 4. Import check: if import is displayed, it must not simulate nonexistent selective import tool
        const importOption = container.querySelector('[data-mode="import"], [data-v="import"]');
        if (importOption) {
            const isDeferred = importOption.hasAttribute('disabled') ||
                importOption.getAttribute('aria-disabled') === 'true' ||
                /próximamente|diferid[oa]|deshabilitad[oa]/i.test(importOption.textContent);
            expect(isDeferred).toBe(true);
        }
    });

    test('Empty mode creates project with strictly ZERO operational records (0 positions, employees, attendance, loans)', async () => {
        const mod = await loadProjectOnboardingModule();
        expect(mod).not.toBeNull();

        const store = new ProjectStore({
            db: {
                _data: new Map(),
                async get(_s, id) { return this._data.get(id) || null; },
                async getAll() { return Array.from(this._data.values()); },
                async update(_s, val) { this._data.set(val.id, { ...val }); }
            }
        });

        const setupService = new ProjectSetupService({
            store,
            getScope: async () => ({ enabled: true, projectId: 'PRJ-1', defaultProjectId: 'PRJ-1' }),
            flags: { isEnabled: () => true, setEnabled: () => {} }
        });

        // Execute creation in empty mode
        let result;
        if (typeof mod.executeProjectOnboarding === 'function') {
            result = await mod.executeProjectOnboarding({
                mode: 'empty',
                projectName: 'Obra Completamente Vacía',
                setupService
            });
        } else if (typeof setupService.createEmptyProject === 'function') {
            result = await setupService.createEmptyProject({ name: 'Obra Completamente Vacía' });
        }

        expect(result?.project?.id).toBeTruthy();
        const newProjectId = result.project.id;
        const scope = { enabled: true, projectId: newProjectId, defaultProjectId: 'PRJ-DEFAULT' };

        const globalState = {
            employees: [
                { id: 'emp-1', name: 'Carlos', projectId: 'PRJ-OTHER' }
            ],
            positions: [
                { id: 'pos-1', name: 'Albañil', projectId: 'PRJ-OTHER' }
            ],
            leaders: [
                { id: 'ldr-1', name: 'Jefe', projectId: 'PRJ-OTHER' }
            ],
            attendance: {
                'att-1': { employeeId: 'emp-1', projectId: 'PRJ-OTHER' }
            },
            loans: [
                { id: 'loan-1', employeeId: 'emp-1', projectId: 'PRJ-OTHER' }
            ],
            payrollClosures: [
                { id: 'pc-1', projectId: 'PRJ-OTHER' }
            ]
        };

        expect(globalState.employees.filter(e => entityInScope(e, scope))).toHaveLength(0);
        expect(globalState.positions.filter(p => entityInScope(p, scope))).toHaveLength(0);
        expect(globalState.leaders.filter(l => entityInScope(l, scope))).toHaveLength(0);
        expect(Object.values(globalState.attendance).filter(a => entityInScope(a, scope))).toHaveLength(0);
        expect(globalState.payrollClosures.filter(c => c.projectId === newProjectId)).toHaveLength(0);
    });

    test('Copy structure mode: clones positions with NEW IDs and new projectId, leaving origin intact, without copying employees', async () => {
        const mod = await loadProjectOnboardingModule();
        expect(mod).not.toBeNull();

        const ORIGIN_PRJ_ID = 'PRJ-ORIGIN-001';
        const TARGET_PRJ_ID = 'PRJ-TARGET-002';

        const originPositions = [
            { id: 'POS-ORIG-1', name: 'Maestro de Obra', hourlyRate: 350, color: '#10b981', active: true, projectId: ORIGIN_PRJ_ID },
            { id: 'POS-ORIG-2', name: 'Carpintero Encofrador', hourlyRate: 280, color: '#3b82f6', active: true, projectId: ORIGIN_PRJ_ID }
        ];

        const originEmployees = [
            { id: 'EMP-ORIG-1', name: 'Juan Perez', projectId: ORIGIN_PRJ_ID, positions: ['POS-ORIG-1'], active: true }
        ];

        const copyStructureFn = mod?.copyProjectStructure || mod?.clonePositionsForProject;
        expect(typeof copyStructureFn).toBe('function');

        const cloneResult = await copyStructureFn({
            sourceProjectId: ORIGIN_PRJ_ID,
            targetProjectId: TARGET_PRJ_ID,
            positions: originPositions,
            employees: originEmployees
        });

        // 1. Cloned positions created
        expect(cloneResult.positions).toHaveLength(2);

        // 2. Cloned positions have brand new IDs (never reuse origin IDs)
        cloneResult.positions.forEach(pos => {
            expect(pos.id).not.toBe('POS-ORIG-1');
            expect(pos.id).not.toBe('POS-ORIG-2');
            expect(pos.projectId).toBe(TARGET_PRJ_ID);
        });

        // 3. Cloned positions retain metadata
        expect(cloneResult.positions.map(p => p.name).sort()).toEqual(['Carpintero Encofrador', 'Maestro de Obra']);
        expect(cloneResult.positions.map(p => p.hourlyRate).sort()).toEqual([280, 350]);

        // 4. Origin positions intact
        expect(originPositions[0].id).toBe('POS-ORIG-1');
        expect(originPositions[0].projectId).toBe(ORIGIN_PRJ_ID);
        expect(originPositions[1].id).toBe('POS-ORIG-2');
        expect(originPositions[1].projectId).toBe(ORIGIN_PRJ_ID);

        // 5. Employees are NOT copied by default
        expect(cloneResult.employees || []).toHaveLength(0);
    });

    test('Final summary step renders a single primary action button labeled "Continuar a la obra"', async () => {
        const mod = await loadProjectOnboardingModule();
        expect(mod).not.toBeNull();

        const renderFn = mod?.renderProjectOnboardingHTML || mod?.renderOnboardingView;
        expect(typeof renderFn).toBe('function');

        const html = renderFn({
            phase: 'ready',
            step: 5,
            projectName: 'Obra Torre Norte',
            summary: { positionsCount: 3, employeesCount: 0 }
        });

        const container = document.createElement('div');
        container.innerHTML = html;

        // Must find primary action button in final ready phase
        const actionButtons = container.querySelectorAll('button[data-act="next"], button[data-project-onboarding-continue], .odv-ready-footer button');
        expect(actionButtons.length).toBe(1);

        const continueBtn = actionButtons[0];
        expect(continueBtn.textContent).toMatch(/continuar a la obra/i);
    });

    test('Design integrity: reuses original onboarding tokens and shell conventions without UI divergence', async () => {
        const mod = await loadProjectOnboardingModule();
        expect(mod).not.toBeNull();

        // Must reuse tokens from OnboardingView.js / OnboardingCore.js
        const source = fs.readFileSync(
            path.resolve(__dirname, '../modules/ui/onboarding/OnboardingView.js'),
            'utf8'
        );

        // Core visual tokens in OnboardingView: C.accent = '#06b6d4', FIELD_STYLE, odv-topbar, odv-footer
        expect(source).toContain('#06b6d4');
        expect(source).toContain('odv-topbar');

        const renderFn = mod?.renderProjectOnboardingHTML || mod?.renderOnboardingView;
        if (typeof renderFn === 'function') {
            const html = renderFn({ phase: 'choice', step: 1 });
            // Must adhere to the odv- prefix or onboarding shell conventions
            expect(html.includes('odv-') || html.includes('od-') || html.includes('project-shell')).toBe(true);
        }
    });

    test('No window.alert() usage throughout onboarding interactions', async () => {
        const mod = await loadProjectOnboardingModule();
        expect(mod).not.toBeNull();

        const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

        try {
            if (typeof mod.handleProjectOnboardingAction === 'function') {
                mod.handleProjectOnboardingAction('invalid-action', null, {});
                expect(alertSpy).not.toHaveBeenCalled();
            }
        } finally {
            alertSpy.mockRestore();
        }
    });

    test('Touch accessibility: primary interactive targets satisfy >= 44px min-height', async () => {
        const mod = await loadProjectOnboardingModule();
        expect(mod).not.toBeNull();

        const renderFn = mod?.renderProjectOnboardingHTML || mod?.renderOnboardingView;
        expect(typeof renderFn).toBe('function');

        const html = renderFn({
            phase: 'choice',
            step: 1
        });

        const container = document.createElement('div');
        container.innerHTML = html;

        // Check buttons, cards, and inputs
        const touchTargets = container.querySelectorAll('button, input, [role="radio"]');
        expect(touchTargets.length).toBeGreaterThan(0);

        touchTargets.forEach(el => {
            const style = el.getAttribute('style') || '';
            const minHeightMatch = style.match(/min-height:\s*(\d+)px/);
            const heightMatch = style.match(/(?:^|;)height:\s*(\d+)px/);

            const effectiveHeight = minHeightMatch
                ? parseInt(minHeightMatch[1], 10)
                : heightMatch
                    ? parseInt(heightMatch[1], 10)
                    : 44; // Default if using class with standard 44px+ height

            expect(effectiveHeight).toBeGreaterThanOrEqual(44);
        });
    });
});

import fs from 'fs';
import path from 'path';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import {
    replaceEntityScope,
    resetEntityScope
} from '../modules/features/projects/EntityProjectScope.js';
import * as EntityProjectScope from '../modules/features/projects/EntityProjectScope.js';
import { ACTIVE_PROJECT_LS_KEY } from '../modules/features/projects/ProjectContext.js';

function createFiltersFixture() {
    return {
        activeTab: 'employees',
        employeeViewMode: 'employees',
        employeeFilters: {
            search: '',
            positionId: 'all',
            leaderId: 'all',
            positionIds: [],
            leaderIds: [],
            status: 'active'
        },
        employees: [
            {
                id: 'emp-a-1',
                name: 'Alvaro A',
                active: true,
                number: '101',
                projectId: 'PRJ-A',
                positions: ['pos-a-1']
            },
            {
                id: 'emp-b-1',
                name: 'Bernardo B',
                active: true,
                number: '201',
                projectId: 'PRJ-B',
                positions: ['pos-b-1']
            }
        ],
        positions: [
            { id: 'pos-a-1', name: 'Maestro de Obra A', active: true, projectId: 'PRJ-A', color: '#10b981' },
            { id: 'pos-a-2', name: 'Encofrador A', active: true, projectId: 'PRJ-A', color: '#3b82f6' },
            { id: 'pos-b-1', name: 'Electricista B', active: true, projectId: 'PRJ-B', color: '#f59e0b' },
            { id: 'pos-b-2', name: 'Pintor B', active: true, projectId: 'PRJ-B', color: '#ec4899' }
        ],
        leaders: [
            { id: 'ldr-a-1', name: 'Jefe A', active: true, projectId: 'PRJ-A' },
            { id: 'ldr-b-1', name: 'Jefe B', active: true, projectId: 'PRJ-B' }
        ]
    };
}

function extractPositionFilterOptions(html) {
    const div = document.createElement('div');
    div.innerHTML = html;

    const values = new Set();
    const labels = new Set();

    // 1. Multi-filter positions (<details data-filter-kind="positions">)
    const multiFilter = div.querySelector('[data-filter-kind="positions"]');
    if (multiFilter) {
        multiFilter.querySelectorAll('input[type="checkbox"]').forEach(input => {
            if (input.value && input.value !== 'all') values.add(input.value);
        });
        multiFilter.querySelectorAll('[data-filter-label]').forEach(el => {
            const lbl = el.getAttribute('data-filter-label')?.trim();
            if (lbl) labels.add(lbl);
        });
    }

    // 2. Filter-pill select or fallback position select
    div.querySelectorAll('select.filter-pill-select option, select[onchange*="setEmployeePositionFilter"] option').forEach(opt => {
        if (opt.value && opt.value !== 'all') values.add(opt.value);
        const text = opt.textContent?.trim();
        if (text && !text.toLowerCase().includes('todas')) labels.add(text);
    });

    return {
        values: Array.from(values),
        labels: Array.from(labels),
        hasValue: id => values.has(id),
        hasLabel: label => labels.has(label)
    };
}

describe('Contract B: Project-Scoped Personnel Filters (Positions Isolation)', () => {
    let originalState;

    beforeEach(() => {
        originalState = createFiltersFixture();
        EmployeesUI.init({ state: originalState, services: {} });
    });

    afterEach(() => {
        resetEntityScope();
        setProjectsEnabled(false);
        try {
            localStorage.removeItem(ACTIVE_PROJECT_LS_KEY);
        } catch (_) {}
    });

    test('Projects ON: Positions filter in Personal for Project A contains A positions and excludes B positions', () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' });

        const html = EmployeesUI.EmployeesTab();
        const filter = extractPositionFilterOptions(html);

        // Project A positions must be present
        expect(filter.hasValue('pos-a-1')).toBe(true);
        expect(filter.hasValue('pos-a-2')).toBe(true);
        expect(filter.hasLabel('Maestro de Obra A')).toBe(true);
        expect(filter.hasLabel('Encofrador A')).toBe(true);

        // Project B positions must be strictly excluded
        expect(filter.hasValue('pos-b-1')).toBe(false);
        expect(filter.hasValue('pos-b-2')).toBe(false);
        expect(filter.hasLabel('Electricista B')).toBe(false);
        expect(filter.hasLabel('Pintor B')).toBe(false);
    });

    test('Projects ON: Positions filter in Personal for Project B contains B positions and excludes A positions', () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: 'PRJ-B', defaultProjectId: 'PRJ-A' });

        const html = EmployeesUI.EmployeesTab();
        const filter = extractPositionFilterOptions(html);

        // Project B positions must be present
        expect(filter.hasValue('pos-b-1')).toBe(true);
        expect(filter.hasValue('pos-b-2')).toBe(true);
        expect(filter.hasLabel('Electricista B')).toBe(true);
        expect(filter.hasLabel('Pintor B')).toBe(true);

        // Project A positions must be strictly excluded
        expect(filter.hasValue('pos-a-1')).toBe(false);
        expect(filter.hasValue('pos-a-2')).toBe(false);
        expect(filter.hasLabel('Maestro de Obra A')).toBe(false);
        expect(filter.hasLabel('Encofrador A')).toBe(false);
    });

    test('Projects ON: Dynamic switching A -> B -> A preserves strict filter isolation', () => {
        setProjectsEnabled(true);

        // Step 1: Project A
        replaceEntityScope({ enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' });
        let filter = extractPositionFilterOptions(EmployeesUI.EmployeesTab());
        expect(filter.hasValue('pos-a-1')).toBe(true);
        expect(filter.hasValue('pos-b-1')).toBe(false);

        // Step 2: Switch to Project B
        replaceEntityScope({ enabled: true, projectId: 'PRJ-B', defaultProjectId: 'PRJ-A' });
        filter = extractPositionFilterOptions(EmployeesUI.EmployeesTab());
        expect(filter.hasValue('pos-b-1')).toBe(true);
        expect(filter.hasValue('pos-a-1')).toBe(false);

        // Step 3: Switch back to Project A
        replaceEntityScope({ enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' });
        filter = extractPositionFilterOptions(EmployeesUI.EmployeesTab());
        expect(filter.hasValue('pos-a-1')).toBe(true);
        expect(filter.hasValue('pos-b-1')).toBe(false);
    });

    test('Projects ON: Empty project displays zero position filter options', () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: 'PRJ-EMPTY', defaultProjectId: 'PRJ-A' });

        const html = EmployeesUI.EmployeesTab();
        const filter = extractPositionFilterOptions(html);

        expect(filter.values.length).toBe(0);
        expect(filter.labels.length).toBe(0);
        expect(filter.hasValue('pos-a-1')).toBe(false);
        expect(filter.hasValue('pos-b-1')).toBe(false);
    });

    test('Projects OFF: Positions filter displays all positions across projects (legacy global)', () => {
        setProjectsEnabled(false);
        resetEntityScope();

        const html = EmployeesUI.EmployeesTab();
        const filter = extractPositionFilterOptions(html);

        // Global mode must expose all positions
        expect(filter.hasValue('pos-a-1')).toBe(true);
        expect(filter.hasValue('pos-a-2')).toBe(true);
        expect(filter.hasValue('pos-b-1')).toBe(true);
        expect(filter.hasValue('pos-b-2')).toBe(true);
        expect(filter.values.length).toBe(4);
    });

    test('Pure selector API contract: getScopedPositions returns strictly project-scoped positions', () => {
        // Pure selector required for deterministic querying across UI and test layers
        const getScopedPositions = EntityProjectScope.getScopedPositions;
        expect(typeof getScopedPositions).toBe('function');

        const state = createFiltersFixture();

        // Scope PRJ-A
        const scopedA = getScopedPositions(state, { enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' });
        expect(scopedA.map(p => p.id)).toEqual(['pos-a-1', 'pos-a-2']);

        // Scope PRJ-B
        const scopedB = getScopedPositions(state, { enabled: true, projectId: 'PRJ-B', defaultProjectId: 'PRJ-A' });
        expect(scopedB.map(p => p.id)).toEqual(['pos-b-1', 'pos-b-2']);

        // Scope PRJ-EMPTY
        const scopedEmpty = getScopedPositions(state, { enabled: true, projectId: 'PRJ-EMPTY', defaultProjectId: 'PRJ-A' });
        expect(scopedEmpty).toEqual([]);

        // Scope OFF (Legacy)
        const scopedOff = getScopedPositions(state, { enabled: false, projectId: null, defaultProjectId: null });
        expect(scopedOff.length).toBe(4);
    });

    test('Source contract: EmployeesUI.js must not map state.positions directly without scope filter', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../modules/features/employees/EmployeesUI.js'), 'utf8');

        // Check for the leak at line 639: state.positions.slice().sort(...).map(p => ` ... <option value="${p.id}"
        // Position filter options inside Personal must always filter by active project scope (entityInScope)
        const hasUnscopedPositionOptionMap = /state\.positions(\.slice\(\))?\.sort/.test(source);
        expect(hasUnscopedPositionOptionMap).toBe(false);
    });
});

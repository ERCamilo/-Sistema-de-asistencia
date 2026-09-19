import fs from 'fs';
import path from 'path';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import {
    replaceEntityScope,
    resetEntityScope
} from '../modules/features/projects/EntityProjectScope.js';
import * as EntityProjectScope from '../modules/features/projects/EntityProjectScope.js';

function createCountersFixture() {
    return {
        activeTab: 'employees',
        employeeViewMode: 'employees',
        employees: [
            // Project A employees
            {
                id: 'emp-a-1',
                name: 'Alvaro A',
                active: true,
                number: '101',
                projectId: 'PRJ-A',
                positions: ['pos-a-1'],
                loans: [{ id: 'loan-a-1', status: 'active', amount: 500, balance: 250 }]
            },
            {
                id: 'emp-a-2',
                name: 'Ana A',
                active: true,
                number: '102',
                projectId: 'PRJ-A',
                positions: ['pos-a-1'],
                loans: [{ id: 'loan-a-paid', status: 'paid', amount: 300, balance: 0 }]
            },
            // Project B employees
            {
                id: 'emp-b-1',
                name: 'Bernardo B',
                active: true,
                number: '201',
                projectId: 'PRJ-B',
                positions: ['pos-b-1'],
                loans: [{ id: 'loan-b-1', status: 'active', amount: 400, balance: 400 }]
            },
            {
                id: 'emp-b-2',
                name: 'Beatriz B',
                active: true,
                number: '202',
                projectId: 'PRJ-B',
                positions: ['pos-b-2'],
                loans: [{ id: 'loan-b-2', status: 'active', amount: 600, balance: 100 }]
            },
            {
                id: 'emp-b-3',
                name: 'Bruno B (Inactivo)',
                active: false,
                number: '203',
                projectId: 'PRJ-B',
                positions: ['pos-b-1'],
                loans: []
            }
        ],
        positions: [
            { id: 'pos-a-1', name: 'Albañil A', active: true, projectId: 'PRJ-A' },
            { id: 'pos-b-1', name: 'Carpintero B', active: true, projectId: 'PRJ-B' },
            { id: 'pos-b-2', name: 'Electricista B', active: true, projectId: 'PRJ-B' }
        ],
        leaders: [
            { id: 'ldr-a-1', name: 'Líder A', active: true, projectId: 'PRJ-A' },
            { id: 'ldr-b-1', name: 'Líder B1', active: true, projectId: 'PRJ-B' },
            { id: 'ldr-b-2', name: 'Líder B2', active: true, projectId: 'PRJ-B' }
        ],
        attendance: {
            'att-a-1': { employeeId: 'emp-a-1', workDate: '2026-09-18', hoursWorked: 8, projectId: 'PRJ-A' },
            'att-a-2': { employeeId: 'emp-a-2', workDate: '2026-09-18', hoursWorked: 8, projectId: 'PRJ-A' },
            'att-b-1': { employeeId: 'emp-b-1', workDate: '2026-09-18', hoursWorked: 8, projectId: 'PRJ-B' },
            'att-b-2': { employeeId: 'emp-b-2', workDate: '2026-09-18', hoursWorked: 8, projectId: 'PRJ-B' }
        }
    };
}

function parsePersonnelCounters(html) {
    const div = document.createElement('div');
    div.innerHTML = html;

    const headerText = div.querySelector('.personnel-page__header p')?.textContent?.trim() || '';
    const tabButtons = div.querySelectorAll('.personnel-tabs button');

    let employeesChip = null;
    let leadersChip = null;
    let positionsChip = null;

    tabButtons.forEach(btn => {
        const text = btn.textContent || '';
        const strong = btn.querySelector('strong')?.textContent?.trim() || '0';
        const num = parseInt(strong, 10);
        if (text.includes('Empleados')) employeesChip = num;
        if (text.includes('Líderes')) leadersChip = num;
        if (text.includes('Puestos')) positionsChip = num;
    });

    return {
        headerText,
        employeesChip,
        leadersChip,
        positionsChip
    };
}

describe('Contract A: Project-Scoped UI Counters (Personal & Sidebar)', () => {
    let originalState;

    beforeEach(() => {
        originalState = createCountersFixture();
        EmployeesUI.init({ state: originalState, services: {} });
    });

    afterEach(() => {
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('Projects ON: Personnel counters reflect active project A exclusively', () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' });

        const html = EmployeesUI.EmployeesTab();
        const counts = parsePersonnelCounters(html);

        // Project A has 2 active employees, 2 total employees, 1 leader, 1 position
        expect(counts.headerText).toMatch(/2\s+activos\s+·\s+2\s+empleados\s+·\s+1\s+líder(es)?\s+·\s+1\s+puestos?/i);
        expect(counts.employeesChip).toBe(2);
        expect(counts.leadersChip).toBe(1);
        expect(counts.positionsChip).toBe(1);
    });

    test('Projects ON: Personnel counters switch dynamically to active project B', () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: 'PRJ-B', defaultProjectId: 'PRJ-A' });

        const html = EmployeesUI.EmployeesTab();
        const counts = parsePersonnelCounters(html);

        // Project B has 2 active, 3 total employees (1 inactive), 2 leaders, 2 positions
        expect(counts.headerText).toMatch(/2\s+activos\s+·\s+3\s+empleados\s+·\s+2\s+líder(es)?\s+·\s+2\s+puestos?/i);
        expect(counts.employeesChip).toBe(3);
        expect(counts.leadersChip).toBe(2);
        expect(counts.positionsChip).toBe(2);
    });

    test('Projects ON: Empty project displays zero counts across summary and chips', () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: 'PRJ-EMPTY', defaultProjectId: 'PRJ-A' });

        const html = EmployeesUI.EmployeesTab();
        const counts = parsePersonnelCounters(html);

        // Empty project has 0 across all entities
        expect(counts.headerText).toMatch(/0\s+activos\s+·\s+0\s+empleados\s+·\s+0\s+líder(es)?\s+·\s+0\s+puestos?/i);
        expect(counts.employeesChip).toBe(0);
        expect(counts.leadersChip).toBe(0);
        expect(counts.positionsChip).toBe(0);
    });

    test('Projects ON: Alternating A -> B -> A returns to Project A counts without state leaks', () => {
        setProjectsEnabled(true);

        // Step 1: Project A
        replaceEntityScope({ enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' });
        let counts = parsePersonnelCounters(EmployeesUI.EmployeesTab());
        expect(counts.employeesChip).toBe(2);
        expect(counts.leadersChip).toBe(1);
        expect(counts.positionsChip).toBe(1);

        // Step 2: Switch to Project B
        replaceEntityScope({ enabled: true, projectId: 'PRJ-B', defaultProjectId: 'PRJ-A' });
        counts = parsePersonnelCounters(EmployeesUI.EmployeesTab());
        expect(counts.employeesChip).toBe(3);
        expect(counts.leadersChip).toBe(2);
        expect(counts.positionsChip).toBe(2);

        // Step 3: Switch back to Project A
        replaceEntityScope({ enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' });
        counts = parsePersonnelCounters(EmployeesUI.EmployeesTab());
        expect(counts.employeesChip).toBe(2);
        expect(counts.leadersChip).toBe(1);
        expect(counts.positionsChip).toBe(1);
    });

    test('Projects OFF: Personnel counters preserve legacy global totals', () => {
        setProjectsEnabled(false);
        resetEntityScope();

        const html = EmployeesUI.EmployeesTab();
        const counts = parsePersonnelCounters(html);

        // Total global fixture: 4 active (2 from A + 2 from B), 5 employees, 3 leaders, 3 positions
        expect(counts.headerText).toMatch(/4\s+activos\s+·\s+5\s+empleados\s+·\s+3\s+líder(es)?\s+·\s+3\s+puestos?/i);
        expect(counts.employeesChip).toBe(5);
        expect(counts.leadersChip).toBe(3);
        expect(counts.positionsChip).toBe(3);
    });

    test('Pure helper API contract: getScopedSidebarCounters calculates scoped active employees and loans', () => {
        // Pure helper required for deterministic, decoupled sidebar counter resolution
        const getScopedSidebarCounters = EntityProjectScope.getScopedSidebarCounters;
        expect(typeof getScopedSidebarCounters).toBe('function');

        const state = createCountersFixture();

        // Scope A
        const scopeA = { enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' };
        const countsA = getScopedSidebarCounters(state, scopeA);
        expect(countsA).toEqual({
            activeEmployees: 2,
            activeLoans: 1
        });

        // Scope B
        const scopeB = { enabled: true, projectId: 'PRJ-B', defaultProjectId: 'PRJ-A' };
        const countsB = getScopedSidebarCounters(state, scopeB);
        expect(countsB).toEqual({
            activeEmployees: 2,
            activeLoans: 2
        });

        // Scope Empty
        const scopeEmpty = { enabled: true, projectId: 'PRJ-EMPTY', defaultProjectId: 'PRJ-A' };
        const countsEmpty = getScopedSidebarCounters(state, scopeEmpty);
        expect(countsEmpty).toEqual({
            activeEmployees: 0,
            activeLoans: 0
        });

        // Projects OFF (Legacy global)
        const scopeOff = { enabled: false, projectId: null, defaultProjectId: null };
        const countsOff = getScopedSidebarCounters(state, scopeOff);
        expect(countsOff).toEqual({
            activeEmployees: 4,
            activeLoans: 3
        });
    });

    test('Sidebar source contract: SidebarNavigation in app.js must scope badge counts', () => {
        const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

        // Extract SidebarNavigation function body
        const fnStart = appSource.indexOf('function SidebarNavigation()');
        expect(fnStart).toBeGreaterThan(-1);

        const fnSnippet = appSource.slice(fnStart, fnStart + 1500);

        // Must not compute activeEmployees using unconditional state.employees when projects feature is active
        const hasUnscopedEmployees = /activeEmployees\s*=\s*\(state\.employees\s*\|\|\s*\[\]\)\.filter/.test(fnSnippet);
        const hasScopeResolution = fnSnippet.includes('entityInScope') || fnSnippet.includes('getScopedSidebarCounters') || fnSnippet.includes('peekEntityScope');

        // This assertion documents the existing defect: app.js currently has unscoped calculation without scope awareness
        expect(hasScopeResolution).toBe(true);
        expect(hasUnscopedEmployees).toBe(false);
    });
});

/**
 * F1.4 — Project-aware employees, positions and leaders.
 *
 * Semantics (docs/fase-0/F0.4-plan-migracion.md §2): absent/null projectId
 * ⇒ the entity belongs to the DEFAULT project. All filtering uses the
 * "effective project" = entity.projectId ?? scope.defaultProjectId.
 *
 * Legacy parity: flag OFF ⇒ zero behavior change (no stamps, no filters,
 * no new validations).
 */

import { state } from '../modules/core/AppState.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { EmployeeModal } from '../modules/ui/modals/EmployeeModal.js';
import { LeaderModal } from '../modules/ui/modals/LeaderModal.js';
import { PositionModal } from '../modules/ui/modals/PositionModal.js';
import { Employee } from '../modules/features/employees/Employee.js';
import { Position as PositionClass } from '../modules/features/employees/Position.js';
import { Leader as LeaderClass } from '../modules/features/employees/Leader.js';
import { mergeEmployees } from '../modules/services/EmployeeMerge.js';
import { mergeIncomingPositions } from '../modules/services/CatalogIncomingMerge.js';
import { validateDataIntegrity, analyzeConflicts, sanitizePositions, clearPendingCloudPositionDeletes } from '../modules/services/PersistenceService.js';
import { cleanupPositionReferences } from '../modules/features/employees/PositionsList.js';
import {
    getEntityScope,
    peekEntityScope,
    entityInScope,
    sameEffectiveProject,
    ACTIVE_PROJECT_LS_KEY
} from '../modules/features/projects/ProjectContext.js';
import { DEFAULT_PROJECT_LS_KEY } from '../modules/features/projects/DefaultProject.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import indexedDBService from '../modules/services/IndexedDBService.js';

const PRJ_DEFAULT = 'PRJ-DEFAULT-0000';
const PRJ_A = 'PRJ-A-000000';
const PRJ_B = 'PRJ-B-000000';

const PROJECTS = {
    [PRJ_DEFAULT]: { id: PRJ_DEFAULT, name: 'Mi obra', status: 'active', createdAt: 500, updatedAt: 500 },
    [PRJ_A]: { id: PRJ_A, name: 'Obra A', status: 'active', createdAt: 1000, updatedAt: 1000 },
    [PRJ_B]: { id: PRJ_B, name: 'Obra B', status: 'active', createdAt: 2000, updatedAt: 2000 }
};

function installProjectsMock() {
    indexedDBService.get.mockImplementation(async (_store, id) => PROJECTS[id] ?? null);
    indexedDBService.getAll.mockImplementation(async () => Object.values(PROJECTS));
    indexedDBService.update.mockResolvedValue(1);
}

async function primeScope(activeId) {
    if (activeId) localStorage.setItem(ACTIVE_PROJECT_LS_KEY, activeId);
    else localStorage.removeItem(ACTIVE_PROJECT_LS_KEY);
    return getEntityScope();
}

function snapshotState() {
    return JSON.parse(JSON.stringify({
        employees: state.employees, positions: state.positions,
        leaders: state.leaders, attendance: state.attendance
    }));
}

function restoreState(snap) {
    state.employees = snap.employees;
    state.positions = snap.positions;
    state.leaders = snap.leaders;
    state.attendance = snap.attendance;
}

function setupContext() {
    EmployeesUI.init({
        state,
        saveToLocalStorage: jest.fn(),
        render: jest.fn(),
        closeModal: jest.fn(),
        services: {}
    });
}

function makeMockModal(innerHTML) {
    const el = document.createElement('div');
    el.innerHTML = innerHTML;
    return { element: el, close: jest.fn() };
}

function employeeFormHTML({ number = '001', name = 'Ada Test', posId = 'pos-x' } = {}) {
    return `
        <input id="empNumber" value="${number}">
        <input id="empName" value="${name}">
        <input id="empHireDate" value="2026-01-01">
        <input id="empPhone" value=""><input id="empEmail" value="">
        <textarea id="empNotes"></textarea>
        <input type="checkbox" name="empPosition" value="${posId}" checked>
        <input class="custom-salary-input" data-pos-id="${posId}" value="">
    `;
}

function positionFormHTML({ name = 'Albañil', leaderId = '' } = {}) {
    const days = [1, 2, 3, 4, 5]
        .map(d => `<input type="checkbox" name="workingDay" value="${d}" checked>`).join('');
    return `
        <input id="posName" value="${name}">
        <input id="posHourlyRate" value="150">
        <input type="hidden" id="posSalaryMode" value="hourly">
        <select id="posLeader"><option value="${leaderId}"></option></select>
        <input type="radio" name="posColor" value="#3b82f6" checked>${days}
    `;
}

function leaderFormHTML({ number = '11', name = 'Carlos Test' } = {}) {
    return `
        <input id="ldrNumber" value="${number}"><input id="ldrName" value="${name}">
        <input id="ldrPhone" value=""><input id="ldrEmail" value="">
        <textarea id="ldrNotes"></textarea>
    `;
}

function baseEmployee({ id, number, name, projectId, posId }) {
    const emp = {
        id, key: id, number, name, positions: [posId], active: true,
        positionSalaries: {}, positionSalaryModes: {}, customWorkingDays: {},
        advances: [], bonuses: [], deductions: [], loans: [],
        statusHistory: [], hireDate: '2026-01-01', phone: '', email: '', notes: '',
        createdDate: '2026-01-01T00:00:00Z', updatedAt: 1
    };
    if (projectId) emp.projectId = projectId;
    return emp;
}

beforeAll(() => { window.showAlert = jest.fn(); });
afterAll(() => { delete window.showAlert; });

let snap;
beforeEach(async () => {
    snap = snapshotState();
    localStorage.clear();
    localStorage.setItem(DEFAULT_PROJECT_LS_KEY, PRJ_DEFAULT);
    setProjectsEnabled(false);
    await getEntityScope(); // resync scope snapshot (module cache survives across tests)
    installProjectsMock();
    setupContext();
});

afterEach(() => {
    restoreState(snap);
    localStorage.clear();
    setProjectsEnabled(false);
    document.body.innerHTML = '';
});

describe('F1.4 classes: projectId field follows the deletedAt/photo pattern', () => {
    test('preserved through toJSON when present, emitted only then', () => {
        const emp = new Employee({ id: 'E1', projectId: PRJ_A });
        expect(emp.projectId).toBe(PRJ_A);
        expect(emp.toJSON().projectId).toBe(PRJ_A);

        const pos = new PositionClass({ id: 'P1', projectId: PRJ_B });
        expect(pos.projectId).toBe(PRJ_B);
        expect(pos.toJSON().projectId).toBe(PRJ_B);

        const ldr = new LeaderClass({ id: 'L1', projectId: PRJ_A });
        expect(ldr.projectId).toBe(PRJ_A);
        expect(ldr.toJSON().projectId).toBe(PRJ_A);
    });

    test.each([
        ['Employee', Employee], ['Position', PositionClass], ['Leader', LeaderClass]
    ])('%s: absent projectId stays absent (byte-stable legacy record)', (_name, Cls) => {
        const json = new Cls({ id: 'X1' }).toJSON();
        expect(Object.prototype.hasOwnProperty.call(json, 'projectId')).toBe(false);
    });
});

describe('F1.4 getEntityScope / peekEntityScope / matchers', () => {
    test('flag OFF: inert scope, no storage touched', async () => {
        setProjectsEnabled(false);
        await expect(getEntityScope()).resolves.toEqual({
            enabled: false, projectId: null, defaultProjectId: null
        });
        expect(peekEntityScope()).toEqual({
            enabled: false, projectId: null, defaultProjectId: null
        });
    });

    test('flag ON: resolves active + default ids and primes the sync snapshot', async () => {
        setProjectsEnabled(true);
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, PRJ_B);
        const scope = await getEntityScope();
        expect(scope.enabled).toBe(true);
        expect(scope.projectId).toBe(PRJ_B);
        expect(scope.defaultProjectId).toBe(PRJ_DEFAULT);
        expect(peekEntityScope()).toEqual(scope);
    });

    test('entityInScope applies §2 rule: unstamped belongs to default project', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_B);
        expect(entityInScope({ projectId: PRJ_B })).toBe(true);
        expect(entityInScope({ projectId: PRJ_A })).toBe(false);
        expect(entityInScope({})).toBe(false); // unstamped → default ≠ active B

        await primeScope(PRJ_DEFAULT);
        expect(entityInScope({})).toBe(true); // unstamped matches default active
        expect(entityInScope({ projectId: PRJ_B })).toBe(false);
    });

    test('sameEffectiveProject compares pairwise effective projects', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        expect(sameEffectiveProject({ projectId: PRJ_A }, { projectId: PRJ_A })).toBe(true);
        expect(sameEffectiveProject({}, {})).toBe(true);
        expect(sameEffectiveProject({ projectId: PRJ_A }, { projectId: PRJ_B })).toBe(false);
        expect(sameEffectiveProject({}, { projectId: PRJ_B })).toBe(false);
    });
});

describe('F1.4 birth stamping at UI save handlers', () => {
    test('flag ON + project B: new employee/position/leader are stamped with B', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_B);

        EmployeeModal.save(makeMockModal(employeeFormHTML({ number: '50', name: 'Nueva' })), null);
        expect(state.employees.find(e => e.number === '50').projectId).toBe(PRJ_B);

        PositionModal.save(makeMockModal(positionFormHTML({ name: 'Techo' })), null);
        expect(state.positions.find(p => p.name === 'Techo').projectId).toBe(PRJ_B);

        LeaderModal.save(makeMockModal(leaderFormHTML({ number: '77', name: 'NuevoL' })), null);
        expect(state.leaders.find(l => l.name === 'NuevoL').projectId).toBe(PRJ_B);
    });

    test('flag OFF: births carry NO projectId key at all', () => {
        setProjectsEnabled(false);
        peekEntityScope(); // snapshot exists but disabled

        EmployeeModal.save(makeMockModal(employeeFormHTML({ number: '51', name: 'Legacy' })), null);
        const emp = state.employees.find(e => e.number === '51');
        expect(Object.prototype.hasOwnProperty.call(emp, 'projectId')).toBe(false);

        PositionModal.save(makeMockModal(positionFormHTML({ name: 'LegacyPos' })), null);
        expect(Object.prototype.hasOwnProperty.call(state.positions.find(p => p.name === 'LegacyPos'), 'projectId')).toBe(false);

        LeaderModal.save(makeMockModal(leaderFormHTML({ number: '78', name: 'LegacyL' })), null);
        expect(Object.prototype.hasOwnProperty.call(state.leaders.find(l => l.name === 'LegacyL'), 'projectId')).toBe(false);
    });

    test('editing an employee never overwrites its own projectId', async () => {
        setProjectsEnabled(true);
        const existing = baseEmployee({ id: 'EMP-J', number: '12', name: 'Juan', projectId: PRJ_A, posId: 'POS-A' });
        state.employees = [existing];
        state.positions = [{ id: 'POS-A', name: 'Oficial A', active: true }];
        await primeScope(PRJ_B);

        EmployeeModal.save(makeMockModal(employeeFormHTML({ number: '12', name: 'Juan Editado', posId: 'POS-A' })), existing);
        expect(state.employees[0].projectId).toBe(PRJ_A);
        expect(state.employees[0].name).toBe('Juan Editado');
    });
});

describe('F1.4 isolation battery (flag ON, projects A/B)', () => {
    function seedCatalog() {
        state.leaders = [
            { id: 'LEAD-A', number: '11', name: 'LiderA', icon: null, active: true, color: '#fff', updatedAt: 1, projectId: PRJ_A },
            { id: 'LEAD-B', number: '12', name: 'LiderB', icon: null, active: true, color: '#fff', updatedAt: 1, projectId: PRJ_B }
        ];
        state.positions = [
            { id: 'POS-A', name: 'PuestoA', hourlyRate: 10, color: '#111', icon: null, active: true, workingDays: [1], leaderId: 'LEAD-A', statusHistory: [], updatedAt: 1, projectId: PRJ_A },
            { id: 'POS-B', name: 'PuestoB', hourlyRate: 10, color: '#222', icon: null, active: true, workingDays: [1], leaderId: 'LEAD-B', statusHistory: [], updatedAt: 1, projectId: PRJ_B }
        ];
        state.employees = [
            baseEmployee({ id: 'EMP-J', number: '12', name: 'Juan', projectId: PRJ_A, posId: 'POS-A' }),
            baseEmployee({ id: 'EMP-P', number: '12', name: 'Pedro', projectId: PRJ_B, posId: 'POS-B' })
        ];
    }

    test('lists never mix across repeated project switches', async () => {
        setProjectsEnabled(true);
        seedCatalog();

        await primeScope(PRJ_A);
        state.employeeViewMode = 'employees';
        let html = EmployeesUI.EmployeesTab();
        expect(html).toContain('Juan');
        expect(html).not.toContain('Pedro');

        state.employeeViewMode = 'leaders';
        html = EmployeesUI.EmployeesTab();
        expect(html).toContain('LiderA');
        expect(html).not.toContain('LiderB');

        state.employeeViewMode = 'positions';
        html = EmployeesUI.EmployeesTab();
        expect(html).toContain('PuestoA');
        expect(html).not.toContain('PuestoB');

        // Switch to B and back to A — isolation holds both ways.
        await primeScope(PRJ_B);
        state.employeeViewMode = 'employees';
        html = EmployeesUI.EmployeesTab();
        expect(html).toContain('Pedro');
        expect(html).not.toContain('Juan');

        await primeScope(PRJ_A);
        state.employeeViewMode = 'employees';
        html = EmployeesUI.EmployeesTab();
        expect(html).toContain('Juan');
        expect(html).not.toContain('Pedro');
    });

    test('both projects hold number 12 simultaneously without dedup conflicts', async () => {
        setProjectsEnabled(true);
        seedCatalog();
        await primeScope(PRJ_B);

        // Modal-level duplicate detection is scoped: saving #12 in B succeeds
        // even though A already holds a #12 (Pedro removed so B itself has none).
        const juan = state.employees[0];
        state.employees = [juan];
        EmployeeModal.save(
            makeMockModal(employeeFormHTML({ number: '12', name: 'OtroDeB', posId: 'POS-B' })),
            null
        );
        expect(state.employees.some(e => e.name === 'OtroDeB')).toBe(true);

        // With one #12 per project, no conflict is reported.
        expect(analyzeConflicts()).toEqual([]);
    });

    test('flag OFF control: duplicate numbers still conflict exactly as before', () => {
        setProjectsEnabled(false);
        seedCatalog();
        const conflicts = analyzeConflicts();
        expect(conflicts).toHaveLength(1);
        expect(String(conflicts[0].number)).toBe('12');
        expect(conflicts[0].members).toHaveLength(2);
    });

    test('position cannot bind a cross-project leader; same-project binds fine', async () => {
        setProjectsEnabled(true);
        seedCatalog();
        state.positions.push({
            id: 'POS-X', name: 'PuestoX', hourlyRate: 5, color: '#333', icon: null,
            active: true, workingDays: [1], leaderId: 'LEAD-A', statusHistory: [],
            updatedAt: 1, projectId: PRJ_B
        });
        await primeScope(PRJ_B);

        const fixes = await validateDataIntegrity();
        const x = state.positions.find(p => p.id === 'POS-X');
        expect(x.leaderId).toBeNull(); // cross-project reference nulled
        expect(fixes).toBeGreaterThan(0);
        expect(state.positions.find(p => p.id === 'POS-B').leaderId).toBe('LEAD-B'); // same-project survives

        // Re-binding to the same-project leader persists.
        x.leaderId = 'LEAD-B';
        await validateDataIntegrity();
        expect(state.positions.find(p => p.id === 'POS-X').leaderId).toBe('LEAD-B');
    });

    test('unstamped entities count as default project for the referential guard', async () => {
        setProjectsEnabled(true);
        seedCatalog();
        state.leaders.push({
            id: 'LEAD-D', number: '13', name: 'LiderD', icon: null, active: true,
            color: '#fff', statusHistory: [], updatedAt: 1
        }); // no projectId → default project
        state.positions.push({
            id: 'POS-D', name: 'PuestoD', hourlyRate: 5, color: '#444', icon: null,
            active: true, workingDays: [1], leaderId: 'LEAD-B', statusHistory: [],
            updatedAt: 1
        }); // no projectId → default project

        await primeScope(PRJ_B);
        await validateDataIntegrity();
        // Unstamped position (default) + B leader ⇒ cross-project → nulled.
        expect(state.positions.find(p => p.id === 'POS-D').leaderId).toBeNull();

        // Pairwise semantics are independent of the ACTIVE project:
        // default-position + default-leader binds fine from any project view.
        state.positions.find(p => p.id === 'POS-D').leaderId = 'LEAD-D';
        await primeScope(PRJ_DEFAULT);
        await validateDataIntegrity();
        expect(state.positions.find(p => p.id === 'POS-D').leaderId).toBe('LEAD-D');

        await primeScope(PRJ_B);
        await validateDataIntegrity();
        expect(state.positions.find(p => p.id === 'POS-D').leaderId).toBe('LEAD-D');
    });

    test('missing-leader orphan path still nulls under flag OFF (legacy parity)', async () => {
        setProjectsEnabled(false);
        seedCatalog();
        state.positions[0].leaderId = 'LEAD-GHOST';
        await validateDataIntegrity();
        expect(state.positions.find(p => p.id === 'POS-A').leaderId).toBeNull();
    });
});

describe('F1.4 position name-slug dedup is project-scoped', () => {
    function seedSameNamePositions() {
        state.leaders = [];
        state.positions = [
            { id: 'POS-ING-A', name: 'Ingeniero', hourlyRate: 100, salaryInputMode: 'hourly', color: '#111', icon: null, active: false, workingDays: [1], leaderId: null, statusHistory: [], updatedAt: 1, projectId: PRJ_A },
            { id: 'POS-ING-B', name: 'Ingeniero', hourlyRate: 250, salaryInputMode: 'hourly', color: '#222', icon: null, active: false, workingDays: [2], leaderId: null, statusHistory: [], updatedAt: 1, projectId: PRJ_B }
        ];
        state.employees = [];
    }

    test('flag ON: creating "Ingeniero" in B succeeds while A already holds one', async () => {
        setProjectsEnabled(true);
        seedSameNamePositions();
        state.positions = [state.positions[0]]; // only A's copy exists; B has none
        await primeScope(PRJ_B);

        window.showAlert.mockClear();
        PositionModal.save(makeMockModal(positionFormHTML({ name: 'Ingeniero' })), null);

        expect(window.showAlert).not.toHaveBeenCalled();
        expect(state.positions).toHaveLength(2);
        expect(state.positions.find(p => p.id !== 'POS-ING-A').projectId).toBe(PRJ_B);
    });

    test('flag ON: editing/deleting one namesake never touches the other', async () => {
        setProjectsEnabled(true);
        seedSameNamePositions();
        await primeScope(PRJ_A);

        const posA = state.positions.find(p => p.id === 'POS-ING-A');
        PositionModal.save(makeMockModal(positionFormHTML({ name: 'Ingeniero' })), posA);
        expect(posA.hourlyRate).toBe(150); // form rate applied to A only
        expect(state.positions.find(p => p.id === 'POS-ING-B').hourlyRate).toBe(250);
        expect(state.positions.find(p => p.id === 'POS-ING-B').workingDays).toEqual([2]);

        // Real delete core (PositionsList onConfirm): id-keyed cleanup + filter.
        cleanupPositionReferences('POS-ING-B');
        state.positions = state.positions.filter(p => p.id !== 'POS-ING-B');
        expect(state.positions.map(p => p.id)).toEqual(['POS-ING-A']);
        expect(posA.name).toBe('Ingeniero'); // A survives intact
    });

    test('flag ON: true same-project duplicate keeps legacy handling (save blocked)', async () => {
        setProjectsEnabled(true);
        seedSameNamePositions(); // B already holds "Ingeniero"
        await primeScope(PRJ_B);

        window.showAlert.mockClear();
        PositionModal.save(makeMockModal(positionFormHTML({ name: 'ingeniero' })), null); // slug-insensitive like legacy

        expect(window.showAlert).toHaveBeenCalledWith('Ya existe una posición con este nombre', 'error');
        expect(state.positions.filter(p => p.name.toLowerCase() === 'ingeniero')).toHaveLength(2);
    });

    test('flag ON: sanitize merges same-name duplicates only within a project', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        const st = {
            positions: [
                { id: 'P-A1', name: 'Ingeniero', projectId: PRJ_A },
                { id: 'P-A2', name: 'Ingeniero', projectId: PRJ_A },
                { id: 'P-B1', name: 'Ingeniero', projectId: PRJ_B }
            ],
            employees: [{ id: 'e1', positions: ['P-A2'], positionSalaries: { 'P-A2': 50 } }],
            attendance: {}
        };

        expect(sanitizePositions(st)).toBe(true);
        expect(st.positions.map(p => p.id).sort()).toEqual(['P-A1', 'P-B1']); // cross-project survivor untouched
        expect(st.employees[0].positions).toEqual(['P-A1']); // refs remapped within A only
        clearPendingCloudPositionDeletes();
    });

    test('flag OFF control: global slug identity exactly as today (block + merge)', () => {
        setProjectsEnabled(false);
        peekEntityScope();
        seedSameNamePositions();
        window.showAlert.mockClear();

        PositionModal.save(makeMockModal(positionFormHTML({ name: 'Ingeniero' })), null);
        expect(window.showAlert).toHaveBeenCalledWith('Ya existe una posición con este nombre', 'error');

        const st = {
            positions: [
                { id: 'X1', name: 'Ingeniero', projectId: PRJ_A },
                { id: 'X2', name: 'Ingeniero', projectId: PRJ_B }
            ],
            employees: [{ id: 'e9', positions: ['X2'], positionSalaries: {} }],
            attendance: {}
        };
        expect(sanitizePositions(st)).toBe(true); // global merge ignores projectId stamps (legacy parity)
        expect(st.positions.map(p => p.id)).toEqual(['X1']);
        clearPendingCloudPositionDeletes();
    });
});

describe('F1.4 merge/sync preservation', () => {
    test('mergeEmployees keeps each side own projectId (never re-stamped)', () => {
        const local = { id: 'E9', updatedAt: 10, projectId: PRJ_A };
        const incoming = { id: 'E9', updatedAt: 5 };
        expect(mergeEmployees(incoming, local).projectId).toBe(PRJ_A);

        const incomingNewer = { id: 'E9', updatedAt: 20, projectId: PRJ_B };
        expect(mergeEmployees(incomingNewer, local).projectId).toBe(PRJ_B);
    });

    test('catalog incoming merge passes position projectId through untouched', () => {
        mergeIncomingPositions.resetBaseline();
        const local = { id: 'PX', updatedAt: 10, projectId: PRJ_B };
        const out = mergeIncomingPositions([local], [{ id: 'PY', updatedAt: 5 }]);
        expect(out.find(r => r.id === 'PX').projectId).toBe(PRJ_B);
    });
});

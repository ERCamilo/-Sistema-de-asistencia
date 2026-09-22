import { buildLocalReconciliationViewModel } from '../modules/features/projects/ProjectReconciliationUI.js';

const P1 = { id: 'PRJ-ui-valid-001', name: 'Obra Uno', status: 'active' };
const OLD = 'PRJ-ui-missing-999';

function employee(id, number, projectId = P1.id, extra = {}) {
    const row = { id, number: String(number), name: 'Empleado ' + number, active: true, ...extra };
    if (projectId !== undefined) row.projectId = projectId;
    return row;
}

function projectState(overrides = {}) {
    return {
        enabled: true,
        ready: true,
        activeProjectId: P1.id,
        defaultProjectId: P1.id,
        projects: [P1],
        ...overrides
    };
}

function appState(overrides = {}) {
    return { employees: [], positions: [], leaders: [], attendance: {}, ...overrides };
}

describe('ProjectReconciliationUIR07 view model', () => {
    test('36 valid + employees 34/405 with missing project produces exactly 2 pending rows', () => {
        const valid = Array.from({ length: 36 }, (_, i) => employee('valid-' + i, 100 + i));
        const andres = { ...employee('emp-1789749741792', 34, OLD), name: 'Andres Sanchez' };
        const lano = { ...employee('emp-1789586033810', 405, OLD), name: 'Lano Borno' };
        const vm = buildLocalReconciliationViewModel(
            appState({ employees: [...valid, andres, lano] }),
            projectState()
        );

        expect(vm.pendingEmployeeCount).toBe(2);
        expect(vm.validEmployeeCount).toBe(36);
        expect(vm.employeeRows.map(row => row.employee.number)).toEqual(['34', '405']);
        expect(vm.employeeRows.map(row => row.id)).toEqual([
            'emp-1789749741792',
            'emp-1789586033810'
        ]);
    });

    test('a legitimate employee in a valid project is not pending', () => {
        const vm = buildLocalReconciliationViewModel(
            appState({ employees: [employee('ok-1', 1)] }),
            projectState()
        );
        expect(vm.pendingEmployeeCount).toBe(0);
        expect(vm.employeeRows).toHaveLength(0);
    });
    test('attendance-only missing ownership surfaces its valid employee', () => {
        const emp = employee('emp-att-only', 22);
        const attendance = {
            'emp-att-only-2026-09-20': {
                key: 'emp-att-only-2026-09-20',
                employeeId: emp.id,
                date: '2026-09-20',
                present: true,
                projectId: OLD
            }
        };
        const vm = buildLocalReconciliationViewModel(
            appState({ employees: [emp], attendance }),
            projectState()
        );

        expect(vm.pendingEmployeeCount).toBe(1);
        expect(vm.employeeRows[0].id).toBe(emp.id);
        expect(vm.employeeRows[0].employeeIssue).toBeNull();
        expect(vm.employeeRows[0].attendanceIssueCount).toBe(1);
    });

    test('legacy unscoped employee resolved by valid default is not persistent pending', () => {
        const unscoped = employee('legacy-1', 7, undefined);
        const vm = buildLocalReconciliationViewModel(
            appState({ employees: [unscoped] }),
            projectState()
        );
        expect(vm.pendingEmployeeCount).toBe(0);
        expect(vm.validEmployeeCount).toBe(1);
    });
    test('pending rows use numeric employee order', () => {
        const rows = [
            employee('e10', 10, OLD),
            employee('e2', 2, OLD),
            employee('e405', 405, OLD),
            employee('e34', 34, OLD)
        ];
        const vm = buildLocalReconciliationViewModel(appState({ employees: rows }), projectState());
        expect(vm.employeeRows.map(row => row.employee.number)).toEqual(['2', '10', '34', '405']);
    });

    test('Projects OFF returns a disabled empty model', () => {
        const vm = buildLocalReconciliationViewModel(
            appState({ employees: [employee('e1', 1, OLD)] }),
            projectState({ enabled: false })
        );
        expect(vm.enabled).toBe(false);
        expect(vm.totalPendingCount).toBe(0);
        expect(vm.employeeRows).toHaveLength(0);
    });

    test('cross-project leader marker is inert and does not surface as a pending item', () => {
        const vm = buildLocalReconciliationViewModel(
            appState({
                employees: [employee('e1', 1)],
                positions: [{ id: 'pos-1', name: 'Capataz', projectId: P1.id, crossProjectLeaderId: 'lead-other' }]
            }),
            projectState()
        );
        expect(vm.pendingEmployeeCount).toBe(0);
        expect(vm.totalPendingCount).toBe(0);
    });
});

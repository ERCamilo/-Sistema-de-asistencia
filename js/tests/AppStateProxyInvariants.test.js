/**
 * F1.4/D — AppState proxy INVARIANT characterization (pins CURRENT behavior).
 * Uses the REAL modules via the 'actual/' escape hatch (bypasses mock mapper).
 * OWNER DOMAIN: this suite only observes. If any invariant fails, AppState.js
 * itself must NOT be patched from this slice — its last modifiers in git
 * history are owner feature commits (feat(attendance)/feat(payroll)), so any
 * change belongs to the owner domain.
 */

import { state, stateManager } from 'actual/core/AppState.js';
import { Employee } from 'actual/features/employees/Employee.js';

describe('AppState proxy invariants (characterization)', () => {
    afterEach(() => {
        state.employees = [];
        delete state.projectsUiProbe;
        delete state.projectsRegistry;
    });

    test('INV-1: set() flattens a real Employee class instance (own fields kept, prototype methods dropped)', () => {
        const emp = new Employee({ id: 'EMP-flat-0001', number: 11, name: 'Ana' });
        state.employees = [emp];

        const stored = stateManager.getState().employees[0];
        expect(stored instanceof Employee).toBe(false);
        expect(stored.activate).toBeUndefined();
        expect(stored.hasPosition).toBeUndefined();
        expect(stored.id).toBe('EMP-flat-0001');
        expect(stored.number).toBe(11);
        expect(stored.name).toBe('Ana');
        expect(Array.isArray(stored.positions)).toBe(true);
        expect(stored.active).toBe(true);
    });

    test('INV-2: unknown/new fields on plain objects survive assignment + read', () => {
        state.projectsUiProbe = { novelField: 'v1', nested: { deeper: true } };
        const stored = stateManager.getState().projectsUiProbe;
        expect(stored.novelField).toBe('v1');
        expect(stored.nested.deeper).toBe(true);
    });

    test('INV-3: Employee-shaped object INCLUDING deletedAt survives state round-trip (H-01 synergy)', () => {
        state.employees = [new Employee({ id: 'EMP-tomb-0001', name: 'Bo', deletedAt: 1723000000000 })];
        const raw = stateManager.getState().employees[0];
        expect(raw.deletedAt).toBe(1723000000000);
        expect(state.employees[0].deletedAt).toBe(1723000000000);
    });

    test('INV-4: Project-shaped POJO with projectId-like extras survives without field loss', () => {
        const pojo = {
            id: 'PRJ-zz-9999',
            status: 'active',
            schemaVersion: 1,
            metadata: { notes: 'n' },
            projectId: 'PRJ-zz-9999',
            futureColumn: 42
        };
        state.projectsRegistry = [pojo];
        const stored = state.projectsRegistry[0]._rawTarget || state.projectsRegistry[0];
        expect(stored).toEqual(pojo);
    });
});

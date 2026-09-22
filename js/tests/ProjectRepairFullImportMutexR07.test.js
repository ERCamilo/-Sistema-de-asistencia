/**
 * ProjectRepairFullImportMutexR07.test.js — R07 A2c-2 (H3)
 *
 * Mutual exclusion between FULL import (reemplazo completo del dataset) and
 * project-ownership repair. Sin esta exclusión mutua, un import FULL que publica
 * estado provisional podía pisar una reparación en vuelo, o una reparación podía
 * escribir sobre un dataset a medio reemplazar.
 *
 *   a. una reparación SE NIEGA (CONFLICT, cero escrituras) mientras la isolación
 *      FULL está activa.
 *   b. un import FULL se frena ANTES de publicar/mutar estado mientras la
 *      isolación de reparación está activa.
 *   c. saveToIndexedDB con clearFirst devuelve false durante la isolación de
 *      reparación.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import {
    beginFullImportIsolation,
    endFullImportIsolation,
    isFullImportIsolationInProgress,
    beginProjectRepairIsolation,
    endProjectRepairIsolation,
    isProjectRepairIsolationInProgress,
    saveToIndexedDB
} from '../modules/services/PersistenceService.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS
} from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { confirmImportFull, setImportFullText } from '../modules/features/export/ExportController.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

const VALID_PROJECT = { id: 'PRJ-mutex-valid-001', name: 'Valid Mutex', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const ORPHAN_PID    = 'PRJ-mutex-orphan-999';

function makeEmployee(id, overrides = {}) {
    return { id, number: id, name: `Emp ${id}`, active: true, positions: [], loans: [], projectId: ORPHAN_PID, ...overrides };
}

const importPayload = () => ({ data: {
    employees: [{ id: 'new-e', number: '2', name: 'New' }],
    positions: [],
    leaders: [{ id: 'new-l', number: '2', name: 'New Leader' }],
    attendance: {},
    settings: { companyName: 'Imported' }
} });

let db;
let savedState;
let savedEmployees;

beforeEach(async () => {
    jest.useFakeTimers();
    localStorage.clear();
    savedState = {
        employees:  JSON.parse(JSON.stringify(stateManager._state.employees || [])),
        attendance: JSON.parse(JSON.stringify(stateManager._state.attendance || {}))
    };
    savedEmployees = JSON.parse(JSON.stringify(stateManager._state.employees || []));
    db = new IndexedDBService('r07-mutex-' + Math.random());
    await db.init();
    await db.update('projects', VALID_PROJECT);
});

afterEach(() => {
    // Ensure no isolation leaks into the next test. end*Isolation never
    // throws, so a FINITE, condition-guarded loop is the correct way to drain
    // any residual depth without hanging (the previous `while(true)` loop
    // never terminated).
    for (let i = 0; i < 10 && isProjectRepairIsolationInProgress(); i++) endProjectRepairIsolation();
    for (let i = 0; i < 10 && isFullImportIsolationInProgress(); i++) endFullImportIsolation();
    stateManager.setState({ employees: savedState.employees, attendance: savedState.attendance }, { silent: true });
    try { db.db.close(); } catch (_) { /* ignore */ }
    delete window.showConfirm;
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('ProjectRepairFullImportMutexR07', () => {
    test('a. repair refuses while FULL import isolation is active — zero writes', async () => {
        const emp = makeEmployee('emp-mutex-a-001');
        await db.update('employees', emp);
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });

        beginFullImportIsolation();
        try {
            const result = await applyOwnershipRepair({
                action: REPAIR_ACTION.MAP_TO_EXISTING,
                employees: [emp],
                attendance: {},
                catalog: [VALID_PROJECT],
                targetProjectId: VALID_PROJECT.id,
                _db: db
            });

            expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
            expect(result.conflicts.some(c => c.kind === 'FULL_IMPORT_ISOLATION_ACTIVE')).toBe(true);
        } finally {
            endFullImportIsolation();
        }

        // Cero escrituras: el empleado sigue con su projectId huérfano original.
        const durableEmployees = await db.getAll('employees');
        const durable = durableEmployees.find(e => e.id === emp.id);
        expect(durable?.projectId).toBe(ORPHAN_PID);
    });

    test('b. FULL import refuses and stops before mutation while project-repair isolation is active', async () => {
        const originalEmployee = { id: 'old-e', number: '1', name: 'Original' };
        await db.update('employees', originalEmployee);
        stateManager.setState({ employees: [originalEmployee], attendance: {} }, { silent: true });

        let callback;
        window.showConfirm = opts => { callback = opts.onConfirm; };

        beginProjectRepairIsolation();
        try {
            setImportFullText(JSON.stringify(importPayload()));
            confirmImportFull();
            expect(callback).toBeInstanceOf(Function);

            await callback();

            // El import FULL no publicó el estado importado: el empleado original
            // sigue siendo el único en memoria.
            expect(stateManager._state.employees.map(e => e.id)).toEqual(['old-e']);
            expect(stateManager._state.employees.find(e => e.id === 'new-e')).toBeUndefined();
        } finally {
            endProjectRepairIsolation();
        }
    });

    test('c. saveToIndexedDB clearFirst returns false during project-repair isolation', async () => {
        beginProjectRepairIsolation();
        try {
            const ok = await saveToIndexedDB({ clearFirst: true });
            expect(ok).toBe(false);
        } finally {
            endProjectRepairIsolation();
        }
    });
});

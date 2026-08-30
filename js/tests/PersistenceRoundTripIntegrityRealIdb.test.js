/**
 * F1.0.1 — Persistence round-trip integrity against the REAL IndexedDBService
 * running on fake-indexeddb (no mocks in the data path).
 *
 * Unlike the mocked sibling (PersistenceRoundTripIntegrity.test.js), this file
 * proves the real schema (attendance-app-db v17), the real dedup + batch
 * writes, and the real loadFullState reconstruction — including employee
 * tombstones (`deletedAt`) and the `${employeeId}-${date}` attendance key
 * contract. Receipt/photo-blob stores are out of scope here.
 */

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';

// jest-environment-jsdom does not expose structuredClone; fake-indexeddb v6
// requires it. Test payloads here are plain JSON-safe POJOs by contract.
if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const T0 = 1723000000000;
const FRESH_DELETED_AT = Date.now();

function employeeSeed(overrides = {}) {
    return {
        id: 'emp-1', key: 'emp-1', number: '1', name: 'Ana Pérez',
        positions: ['pos-1'], customSalary: null, active: true,
        hireDate: '2025-01-15', phone: '', email: '',
        positionSalaries: { 'pos-1': 12.5 }, positionSalaryModes: { 'pos-1': 'hourly' },
        customWorkingDays: {}, notes: '', advances: [], bonuses: [], deductions: [],
        loans: [{ id: 'loan-1', amount: 100, payments: [{ id: 'loan-1-pay-1' }] }],
        createdDate: '2025-01-15T00:00:00.000Z', lastStatusChange: null,
        statusHistory: [], updatedAt: T0, positionsUpdatedAt: T0, ...overrides
    };
}

function positionSeed(overrides = {}) {
    return {
        id: 'pos-1', name: 'Operadora', color: '#123456', icon: 'gear', active: true,
        salaryConfig: { amount: 120, period: 'day', workDays: [1, 2, 3, 4, 5] },
        baseSalary: 120, hourlyRate: 15, salaryInputMode: 'hourly',
        leaderId: null, workingDays: [1, 2, 3, 4, 5],
        lastStatusChange: null, statusHistory: [], updatedAt: T0, ...overrides
    };
}

function leaderSeed(overrides = {}) {
    return {
        id: 'lead-1', number: '1', name: 'Lidera López', phone: '', active: true,
        updatedAt: T0, ...overrides
    };
}

function attendanceSeed() {
    const base = {
        hoursWorked: 0, overtimeHours: 0, isHoliday: false, selectedPosition: null,
        multiPosition: false, positionHours: [], notes: '', deviceId: null
    };
    return {
        'emp-1-2026-08-20': {
            ...base, employeeId: 'emp-1', date: '2026-08-20', present: true,
            hoursWorked: 8, overtimeHours: 1, notes: 'puntual', deviceId: 'dev-1',
            updatedAt: T0, deletedAt: null
        },
        'emp-2-2026-08-21': {
            ...base, employeeId: 'emp-2', date: '2026-08-21', present: false,
            updatedAt: T0 + 1000, deletedAt: FRESH_DELETED_AT
        }
    };
}

describe('Persistence round-trip integrity — REAL IndexedDB runtime (fake-indexeddb)', () => {
    test('opens attendance-app-db at version 19 with the expected stores', async () => {
        const svc = new IndexedDBService();
        await svc.init();
        expect(svc.db.version).toBe(19);
        expect(Array.from(svc.db.objectStoreNames)).toEqual(expect.arrayContaining([
            'employees', 'positions', 'leaders', 'attendance', 'settings', 'sync_queue',
            'pettyCashReceipts', 'pettyCashProjects', 'pettyCashPeriods', 'pettyCashMovements',
            'mainSyncOutbox', 'syncLocks', 'payrollClosures', 'employeePhotos', 'projects', 'projectPayrollConfigs'
        ]));
    });

    test('saveState → loadFullState round-trips every collection with deep integrity', async () => {
        const svc = new IndexedDBService('attendance-app-db-roundtrip');
        const payload = {
            employees: [
                employeeSeed(),
                employeeSeed({ id: 'emp-tomb', key: 'emp-tomb', number: '2', name: 'Beto Suárez', active: false, deletedAt: FRESH_DELETED_AT }),
                // No `number`: must persist via the id fallback of the dedup key.
                employeeSeed({ id: 'emp-nonum', key: 'emp-nonum', number: null, name: 'Cami SinNúmero' })
            ],
            positions: [positionSeed()],
            leaders: [leaderSeed()],
            attendance: attendanceSeed(),
            settings: { regularHoursPerDay: 8, syncEnabled: true, schemaVersion: 3 }
        };

        await svc.saveState(payload);

        // Store level first: tombstones and the no-number employee reach IDB.
        // Object stores iterate in primary-key order, so compare sorted by id.
        const byId = list => [...list].sort((a, b) => a.id.localeCompare(b.id));
        const rawEmployees = await svc.getAll('employees');
        expect(byId(rawEmployees)).toEqual(byId(payload.employees));

        const loaded = await svc.loadFullState();

        expect(byId(loaded.employees)).toEqual(byId(payload.employees));
        expect(loaded.positions).toEqual(payload.positions);
        expect(loaded.leaders).toEqual(payload.leaders);
        expect(loaded.settings).toEqual({ ...payload.settings, key: 'app' });

        // Attendance keeps the `${employeeId}-${date}` key contract and deep fidelity.
        expect(Object.keys(loaded.attendance).sort())
            .toEqual(Object.keys(payload.attendance).sort());
        for (const [key, record] of Object.entries(loaded.attendance)) {
            expect(key).toBe(`${record.employeeId}-${record.date}`);
            expect(record).toEqual(payload.attendance[key]);
        }

        // The fresh tombstone survives; a second full save from the loaded
        // payload keeps it durable (idempotent round trip).
        await svc.saveState({ ...payload, employees: loaded.employees });
        const reloaded = await svc.loadFullState();
        expect(reloaded.employees.find(e => e.id === 'emp-tomb').deletedAt)
            .toBe(FRESH_DELETED_AT);
    });
});

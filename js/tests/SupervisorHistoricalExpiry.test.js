import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import { state, stateManager, invalidateAllStats, buildAttendanceIndex } from '../modules/core/AppState.js';
import { confirmImportFull, setImportFullText } from '../modules/features/export/ExportController.js';
import {
    planAttendanceEviction,
    attendanceRetentionStart,
    ATTENDANCE_RETENTION_MONTHS,
    HISTORICAL_ACCESS_RETENTION_MS,
    REQUIRED_TOMBSTONE_RETENTION_MS
} from '../modules/services/AttendanceRetentionPolicy.js';
import { createAttendanceCachePruner } from '../modules/services/AttendanceCachePruner.js';
import { peekEntityScope } from '../modules/features/projects/EntityProjectScope.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = (x) => JSON.parse(JSON.stringify(x));
}

const NOW_2026_09_19 = new Date('2026-09-19T12:00:00.000Z').getTime();
const HISTORICAL_DATE = '2025-08-25';
const MODERN_DATE = '2026-09-18';
const DAY_MS = 24 * 60 * 60 * 1000;

const HISTORICAL_KEYS_2025_08_25 = [
    'EMP1769317064404-2025-08-25',
    'EMP1769317082863-2025-08-25',
    'EMP1769317092992-2025-08-25',
    'EMP1769317108304-2025-08-25',
    'EMP1772642134930-2025-08-25',
    'EMP1772642218428-2025-08-25',
    'EMP1773500889676-2025-08-25',
    'EMP1773500924811-2025-08-25',
    'EMP1773939111272-2025-08-25',
    'EMP1773939137974-2025-08-25',
    'emp-1780528084921-2025-08-25',
    'emp-1780528180950-2025-08-25',
    'emp-1780528234989-2025-08-25',
    'emp-1785182598482-2025-08-25',
    'emp-1785182661276-2025-08-25',
    'emp-1785182682232-2025-08-25',
    'emp-1785182920585-2025-08-25',
    'emp-1785958875544-2025-08-25'
];

function makeAttendanceImportPayload() {
    const attendance = {
        'emp-modern-2026-09-18': {
            employeeId: 'emp-modern',
            date: MODERN_DATE,
            present: true,
            hoursWorked: 8,
            deletedAt: null
        }
    };

    for (const key of HISTORICAL_KEYS_2025_08_25) {
        const employeeId = key.replace('-2025-08-25', '');
        attendance[key] = {
            employeeId,
            date: HISTORICAL_DATE,
            present: true,
            hoursWorked: 8,
            deletedAt: null
        };
    }

    return {
        version: '1.0.0',
        exportDate: '2026-09-19T16:46:03.402Z',
        data: {
            settings: { regularHoursPerDay: 8, companyName: 'Construcciones S.A.' },
            employees: [
                { id: 'emp-modern', number: '1', name: 'Empleado Moderno', positions: [], loans: [], active: true },
                ...HISTORICAL_KEYS_2025_08_25.map((key, idx) => ({
                    id: key.replace('-2025-08-25', ''),
                    number: String(idx + 2),
                    name: `Empleado Historico ${idx + 1}`,
                    positions: [],
                    loans: [],
                    active: true
                }))
            ],
            positions: [],
            leaders: [],
            attendance,
            tempAssignments: [],
            dayHoursConfig: {}
        }
    };
}

describe('FullImportHistoricalRestartPersistenceR02 Contract (Suite B)', () => {
    let originalState;

    beforeEach(() => {
        jest.useFakeTimers();
        delete window.location;
        window.location = { reload: jest.fn(), href: 'http://localhost/' };
        localStorage.clear();

        originalState = JSON.parse(JSON.stringify({
            employees: state.employees,
            positions: state.positions,
            leaders: state.leaders,
            attendance: state.attendance,
            settings: state.settings,
            isDataLoaded: state.isDataLoaded,
            useIndexedDB: state.useIndexedDB,
            showImportFullModal: state.showImportFullModal,
            importFullText: state.importFullText
        }));

        Object.assign(state, {
            employees: [],
            positions: [],
            leaders: [],
            attendance: {},
            settings: { regularHoursPerDay: 8 },
            isDataLoaded: true,
            useIndexedDB: true
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        mockedIDB.saveState.mockReset();
        mockedIDB.getAll.mockReset();
        mockedIDB.get.mockReset();
        mockedIDB.update.mockReset();
        mockedIDB.delete.mockReset();
        mockedIDB.batchUpdate.mockReset();
        mockedIDB.batchDelete.mockReset();
        mockedIDB.clear.mockReset();
        mockedIDB.clearAll.mockReset();
        Object.assign(state, originalState);
        delete window.showConfirm;
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    function hookMockedIDBTo(dbInstance) {
        mockedIDB.saveState.mockImplementation((s, o) => dbInstance.saveState(s, o));
        mockedIDB.getAll.mockImplementation((...args) => dbInstance.getAll(...args));
        mockedIDB.get.mockImplementation((...args) => dbInstance.get(...args));
        mockedIDB.update.mockImplementation((...args) => dbInstance.update(...args));
        mockedIDB.delete.mockImplementation((...args) => dbInstance.delete(...args));
        mockedIDB.batchUpdate.mockImplementation((...args) => dbInstance.batchUpdate(...args));
        mockedIDB.batchDelete.mockImplementation((...args) => dbInstance.batchDelete(...args));
        mockedIDB.clear.mockImplementation((...args) => dbInstance.clear(...args));
        mockedIDB.clearAll.mockImplementation((...args) => dbInstance.clearAll(...args));
        mockedIDB.loadFullState.mockImplementation(() => dbInstance.loadFullState());
    }

    async function executeConfirmImport(payload) {
        let onConfirmCallback = null;
        window.showConfirm = (opts) => {
            onConfirmCallback = opts.onConfirm;
        };
        setImportFullText(JSON.stringify(payload));
        confirmImportFull();
        expect(onConfirmCallback).toBeInstanceOf(Function);
        await onConfirmCallback();
    }

    test('B1-B3: restored 18 historical attendances survive two restart cycles (close/reopen) and boot prune at 2026-09-19 with intact semantic fields', async () => {
        const dbName = 'test-att-fidelity-restart-r02-' + Math.random();

        // ─── CYCLE 1: Initial import into DB1 ──────────────────────────────
        const db1 = new IndexedDBService(dbName);
        await db1.init();
        hookMockedIDBTo(db1);

        const payload = makeAttendanceImportPayload();
        await executeConfirmImport(payload);

        // Verify pre-condition: 19 records present in memory and durable in DB1
        expect(Object.keys(state.attendance).length).toBe(19);
        const durableRecords1 = await db1.getAll('attendance');
        expect(durableRecords1.length).toBe(19);

        // Close connection 1
        db1.db.close();

        // ─── CYCLE 2: Fresh restart 1 (close -> reopen -> rebuild -> prune) ─
        // Reset in-memory state
        state.attendance = {};
        state.employees = [];

        const db2 = new IndexedDBService(dbName);
        await db2.init();
        hookMockedIDBTo(db2);

        // Reconstruct state via real load route
        const loadedState2 = await db2.loadFullState();
        Object.assign(state, {
            employees: loadedState2.employees || [],
            positions: loadedState2.positions || [],
            leaders: loadedState2.leaders || [],
            attendance: loadedState2.attendance || {},
            settings: loadedState2.settings || {},
            isDataLoaded: true,
            useIndexedDB: true
        });

        // Run boot prune with date 2026-09-19
        const pruner2 = createAttendanceCachePruner({
            readAttendance: () => state.attendance || {},
            writeAttendance: (att) => stateManager.silentSetState({ attendance: att }),
            getProtectedDateKeys: () => Promise.resolve(new Set()),
            deleteRecords: (keys) => db2.batchDelete('attendance', keys),
            getScope: () => peekEntityScope(),
            onPruned: () => {
                invalidateAllStats();
                buildAttendanceIndex();
            },
            now: () => NOW_2026_09_19
        });
        await pruner2.prune();

        // Verification after restart 1: All 18 historical records survive
        const historicalInState2 = Object.keys(state.attendance).filter(k => k.endsWith(HISTORICAL_DATE));
        expect(historicalInState2.length).toBe(18);

        for (const key of HISTORICAL_KEYS_2025_08_25) {
            const rec = state.attendance[key];
            expect(rec).toBeDefined();
            expect(rec.present).toBe(true);
            expect(rec.hoursWorked).toBe(8);
            expect(rec.deletedAt).toBeNull();
            expect(rec.date).toBe(HISTORICAL_DATE);
        }

        const durableHistorical2 = (await db2.getAll('attendance')).filter(
            r => r.date === HISTORICAL_DATE || (r.key && r.key.endsWith(HISTORICAL_DATE))
        );
        expect(durableHistorical2.length).toBe(18);

        // Close connection 2
        db2.db.close();

        // ─── CYCLE 3: Fresh restart 2 (close -> reopen -> rebuild -> prune again) ─
        state.attendance = {};
        state.employees = [];

        const db3 = new IndexedDBService(dbName);
        await db3.init();
        hookMockedIDBTo(db3);

        const loadedState3 = await db3.loadFullState();
        Object.assign(state, {
            employees: loadedState3.employees || [],
            positions: loadedState3.positions || [],
            leaders: loadedState3.leaders || [],
            attendance: loadedState3.attendance || {},
            settings: loadedState3.settings || {},
            isDataLoaded: true,
            useIndexedDB: true
        });

        const pruner3 = createAttendanceCachePruner({
            readAttendance: () => state.attendance || {},
            writeAttendance: (att) => stateManager.silentSetState({ attendance: att }),
            getProtectedDateKeys: () => Promise.resolve(new Set()),
            deleteRecords: (keys) => db3.batchDelete('attendance', keys),
            getScope: () => peekEntityScope(),
            onPruned: () => {
                invalidateAllStats();
                buildAttendanceIndex();
            },
            now: () => Math.max(...Object.values(state.attendance).map(r => Number(r.lastAccessed) || 0)) + 31 * DAY_MS
        });
        await pruner3.prune();

        // Verification after restart 2: All 18 historical records STILL survive
        const historicalInState3 = Object.keys(state.attendance).filter(k => k.endsWith(HISTORICAL_DATE));
        expect(historicalInState3.length).toBe(18);

        const durableHistorical3 = (await db3.getAll('attendance')).filter(
            r => r.date === HISTORICAL_DATE || (r.key && r.key.endsWith(HISTORICAL_DATE))
        );
        expect(durableHistorical3.length).toBe(18);

        db3.db.close();
    });

    test('B4 (Control): ordinary unrestored historical attendance outside 12-month window remains evictable', () => {
        const ordinaryAttendance = {
            'emp-ordinary-2025-08-25': {
                employeeId: 'emp-ordinary',
                date: '2025-08-25',
                present: true,
                hoursWorked: 8,
                deletedAt: null
            },
            'emp-modern-2026-09-18': {
                employeeId: 'emp-modern',
                date: MODERN_DATE,
                present: true,
                hoursWorked: 8,
                deletedAt: null
            }
        };

        const plan = planAttendanceEviction(ordinaryAttendance, {
            now: NOW_2026_09_19
        });

        expect(plan.cutoffDate).toBe('2025-09-19');
        expect(plan.evictKeys).toContain('emp-ordinary-2025-08-25');
        expect(plan.kept['emp-modern-2026-09-18']).toBeDefined();
    });

    test('B5 (Control): retention policy window is not widened beyond 12 months nor disabled globally', () => {
        expect(ATTENDANCE_RETENTION_MONTHS).toBe(12);
        const cutoff = attendanceRetentionStart(NOW_2026_09_19, ATTENDANCE_RETENTION_MONTHS);
        expect(cutoff).toBe('2025-09-19');
    });

    test('B6 (Control): existing retention protections (tombstones, recently accessed, protectedDateKeys) remain operational', () => {
        const attendance = {
            'emp-prot-2024-01-10': {
                employeeId: 'emp-prot',
                date: '2024-01-10',
                present: true,
                hoursWorked: 8
            },
            'emp-recent-2024-02-15': {
                employeeId: 'emp-recent',
                date: '2024-02-15',
                lastAccessed: NOW_2026_09_19 - (5 * DAY_MS)
            },
            'emp-req-tombstone': {
                employeeId: 'emp-tomb',
                date: '2024-03-20',
                deletedAt: NOW_2026_09_19 - (20 * DAY_MS)
            },
            'emp-exp-tombstone': {
                employeeId: 'emp-exp',
                date: '2024-04-25',
                deletedAt: NOW_2026_09_19 - (70 * DAY_MS)
            }
        };

        const plan = planAttendanceEviction(attendance, {
            now: NOW_2026_09_19,
            protectedDateKeys: new Set(['2024-01-10'])
        });

        expect(plan.kept['emp-prot-2024-01-10']).toBeDefined();
        expect(plan.kept['emp-recent-2024-02-15']).toBeDefined();
        expect(plan.kept['emp-req-tombstone']).toBeDefined();
        expect(plan.evictKeys).toContain('emp-exp-tombstone');
    });
});

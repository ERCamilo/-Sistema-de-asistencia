import 'fake-indexeddb/auto';
import crypto from 'crypto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import { state, stateManager, invalidateAllStats, buildAttendanceIndex } from '../modules/core/AppState.js';
import { confirmImportFull, setImportFullText } from '../modules/features/export/ExportController.js';
import { projectStore } from '../modules/features/projects/ProjectStore.js';
import { defaultProjectService } from '../modules/features/projects/DefaultProject.js';
import { projectContext, getEntityScope } from '../modules/features/projects/ProjectContext.js';
import {
    getScopedEmployees,
    effectiveProjectId,
    peekEntityScope,
    replaceEntityScope,
    DEFAULT_PROJECT_LS_KEY
} from '../modules/features/projects/EntityProjectScope.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { createAttendanceCachePruner } from '../modules/services/AttendanceCachePruner.js';
import * as ProjectPayrollConfigStore from '../modules/features/payroll/ProjectPayrollConfigStore.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = (x) => JSON.parse(JSON.stringify(x));
}

const OLD_PROJECT_ID = 'PRJ-mu1p73r3-iu8a';
const NEW_PROJECT_ID = 'PRJ-mu8nkbk5-qbli';
const EMP_34_ID = 'emp-1789749741792';
const EMP_405_ID = 'emp-1789586033810';
const NOW_2026_09_19 = new Date('2026-09-19T12:00:00.000Z').getTime();
const HISTORICAL_DATE = '2025-08-25';

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

function hashObject(obj) {
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function semanticAttendanceDigest(record) {
    const payload = {
        employeeId: record?.employeeId,
        date: record?.date,
        present: Boolean(record?.present),
        hoursWorked: Number(record?.hoursWorked || 0),
        deletedAt: record?.deletedAt ?? null
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function computeGlobalAttendanceSemanticDigest(attendanceMap) {
    const sortedKeys = Object.keys(attendanceMap || {}).sort();
    const digests = sortedKeys.map(k => `${k}:${semanticAttendanceDigest(attendanceMap[k])}`);
    return crypto.createHash('sha256').update(digests.join('\n')).digest('hex');
}

function generateRepresentativeFixture() {
    const employees = [];

    const nestedLoan34 = [
        {
            id: 'loan-34-nested',
            amount: 1500,
            balance: 500,
            installments: 3,
            status: 'active',
            createdAt: 1724000000000
        }
    ];

    const nestedLoan1 = [
        {
            id: 'loan-1-nested',
            amount: 3000,
            balance: 1200,
            installments: 6,
            status: 'active',
            createdAt: 1724100000000,
            notes: 'Prestamo herramientas'
        }
    ];

    HISTORICAL_KEYS_2025_08_25.forEach((key, idx) => {
        const empId = key.replace('-2025-08-25', '');
        const loans = (idx === 0) ? nestedLoan1 : [];
        employees.push({
            id: empId,
            number: String(idx + 1),
            name: `Empleado Historico ${idx + 1}`,
            active: true,
            positions: ['pos-1'],
            loans
        });
    });

    for (let i = 19; i <= 55; i++) {
        employees.push({
            id: `emp-rep-${i}`,
            number: String(i),
            name: `Empleado ${i}`,
            active: true,
            positions: ['pos-1'],
            loans: []
        });
    }

    employees.push({
        id: EMP_34_ID,
        number: '34',
        name: 'Andres Sanchez',
        projectId: OLD_PROJECT_ID,
        active: true,
        positions: ['pos-1'],
        loans: nestedLoan34
    });

    employees.push({
        id: EMP_405_ID,
        number: '405',
        name: 'Lano Borno',
        projectId: OLD_PROJECT_ID,
        active: true,
        positions: ['pos-1'],
        loans: []
    });

    const positions = [];
    for (let i = 1; i <= 12; i++) {
        positions.push({ id: `pos-${i}`, name: `Cargo ${i}`, active: true });
    }
    positions.push({
        id: 'pos-13',
        name: 'Cargo Especialista',
        projectId: OLD_PROJECT_ID,
        active: true
    });

    const leaders = [];
    for (let i = 1; i <= 4; i++) {
        leaders.push({ id: `lead-${i}`, number: String(i), name: `Lider ${i}`, active: true });
    }

    const attendance = {};

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

    let modernCount = 0;
    let dayOffset = 0;
    while (modernCount < 3211) {
        const emp = employees[modernCount % employees.length];
        const dateObj = new Date(2026, 0, 1 + dayOffset);
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${d}`;
        const key = `${emp.id}-${dateStr}`;

        if (!attendance[key]) {
            attendance[key] = {
                employeeId: emp.id,
                date: dateStr,
                present: true,
                hoursWorked: 8,
                deletedAt: null
            };
            modernCount++;
        }
        dayOffset = (dayOffset + 1) % 250;
    }

    const movements = [];
    for (let i = 1; i <= 84; i++) {
        movements.push({
            id: `mov-${i}`,
            projectId: 'pc-proj-1',
            periodId: 'pc-per-1',
            amount: 20 + i,
            concept: `Comprobante Operativo ${i}`,
            date: '2026-08-10'
        });
    }

    const pettyCash = {
        projects: [{ id: 'pc-proj-1', name: 'Caja Obra Principal', officialProjectId: OLD_PROJECT_ID }],
        periods: [{ id: 'pc-per-1', projectId: 'pc-proj-1', status: 'open' }],
        movements
    };

    return {
        version: '1.0.0',
        exportDate: '2026-09-19T16:46:03.402Z',
        data: {
            settings: { companyName: 'Construccion Integral', regularHoursPerDay: 8 },
            employees,
            positions,
            leaders,
            attendance,
            tempAssignments: [],
            dayHoursConfig: {},
            projects: [
                { id: OLD_PROJECT_ID, name: 'Obra Principal', status: 'active', createdAt: 1720000000000 }
            ],
            projectBackup: {
                version: 1,
                projectsEnabled: true,
                exportedAt: '2026-09-19T16:46:03.402Z',
                defaultProjectId: OLD_PROJECT_ID,
                activeProjectId: OLD_PROJECT_ID,
                projectIds: [OLD_PROJECT_ID]
            },
            projectPayrollConfigs: [
                { projectId: OLD_PROJECT_ID, regularHoursPerDay: 8, schemaVersion: 1 }
            ],
            pettyCash
        },
        meta: {
            nestedLoan1Hash: hashObject(nestedLoan1),
            nestedLoan34Hash: hashObject(nestedLoan34)
        }
    };
}

describe('FullImportValidatorRoundTripRestartR02 Contract (Suite C)', () => {
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
            settings: { companyName: 'Base Limpia' },
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

        projectStore.db = dbInstance;
        defaultProjectService.store = projectStore;
        projectContext.store = projectStore;
        projectContext.defaults = defaultProjectService;
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

    test('full round-trip restart fidelity gate: 57/13/4/3229 and 84 movements survive two restart cycles with semantic digests and relational fidelity intact', async () => {
        const fixture = generateRepresentativeFixture();
        const expectedGlobalAttendanceDigest = computeGlobalAttendanceSemanticDigest(fixture.data.attendance);
        const expectedIndividualDigests = {};
        for (const [key, val] of Object.entries(fixture.data.attendance)) {
            expectedIndividualDigests[key] = semanticAttendanceDigest(val);
        }

        const dbName = 'test-full-roundtrip-restart-r02-' + Math.random();

        // ─── STEP 1: Clean pre-environment in DB1 ─────────────────────────
        const db1 = new IndexedDBService(dbName);
        await db1.init();
        hookMockedIDBTo(db1);

        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, NEW_PROJECT_ID);
        await db1.update('projects', { id: NEW_PROJECT_ID, name: 'Mi obra limpia', status: 'active', createdAt: 500 });
        replaceEntityScope({ enabled: true, projectId: NEW_PROJECT_ID, defaultProjectId: NEW_PROJECT_ID });

        // ─── STEP 2: Execute FULL import ──────────────────────────────────
        await executeConfirmImport(fixture);

        // Close DB1 connection
        db1.db.close();

        // ─── STEP 3: Restart 1 (close -> reopen -> rebuild -> boot prune) ──
        state.attendance = {};
        state.employees = [];
        state.positions = [];
        state.leaders = [];

        const db2 = new IndexedDBService(dbName);
        await db2.init();
        hookMockedIDBTo(db2);

        const loaded2 = await db2.loadFullState();
        Object.assign(state, {
            employees: loaded2.employees || [],
            positions: loaded2.positions || [],
            leaders: loaded2.leaders || [],
            attendance: loaded2.attendance || {},
            settings: loaded2.settings || {},
            isDataLoaded: true,
            useIndexedDB: true
        });

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

        // Close DB2 connection
        db2.db.close();

        // ─── STEP 4: Restart 2 (close -> reopen again -> rebuild context) ──
        state.attendance = {};
        state.employees = [];
        state.positions = [];
        state.leaders = [];

        const db3 = new IndexedDBService(dbName);
        await db3.init();
        hookMockedIDBTo(db3);

        const loaded3 = await db3.loadFullState();
        Object.assign(state, {
            employees: loaded3.employees || [],
            positions: loaded3.positions || [],
            leaders: loaded3.leaders || [],
            attendance: loaded3.attendance || {},
            settings: loaded3.settings || {},
            isDataLoaded: true,
            useIndexedDB: true
        });

        const scope = await getEntityScope();

        // ─── VERIFICATIONS ────────────────────────────────────────────────

        // 1. Exact entity counts
        expect(state.employees.length).toBe(57);
        expect(state.positions.length).toBe(13);
        expect(state.leaders.length).toBe(4);
        expect(Object.keys(state.attendance).length).toBe(3229);

        // 2. Exact attendance key set: missing 0, added 0
        const currentAttendanceKeys = Object.keys(state.attendance);
        const fixtureAttendanceKeys = Object.keys(fixture.data.attendance);
        const missingKeys = fixtureAttendanceKeys.filter(k => !state.attendance[k]);
        const addedKeys = currentAttendanceKeys.filter(k => !fixture.data.attendance[k]);
        expect(missingKeys).toEqual([]);
        expect(addedKeys).toEqual([]);

        // Exactly 18 historical attendances from 2025-08-25 preserved
        const historicalInState = currentAttendanceKeys.filter(k => k.endsWith(HISTORICAL_DATE));
        expect(historicalInState.length).toBe(18);

        // 3. Semantic digests: per-attendance record and global
        for (const key of fixtureAttendanceKeys) {
            const actualRecordDigest = semanticAttendanceDigest(state.attendance[key]);
            expect(actualRecordDigest).toBe(expectedIndividualDigests[key]);
        }
        const actualGlobalAttendanceDigest = computeGlobalAttendanceSemanticDigest(state.attendance);
        expect(actualGlobalAttendanceDigest).toBe(expectedGlobalAttendanceDigest);

        // 4. Employee IDs, numbers and nested loans deep equal
        const restoredEmp34 = state.employees.find(e => e.id === EMP_34_ID);
        expect(restoredEmp34).toBeDefined();
        expect(restoredEmp34.number).toBe('34');
        const fixtureEmp34 = fixture.data.employees.find(e => e.id === EMP_34_ID);
        expect(restoredEmp34.loans).toEqual(fixtureEmp34.loans);
        expect(hashObject(restoredEmp34.loans)).toBe(fixture.meta.nestedLoan34Hash);

        const emp1Id = HISTORICAL_KEYS_2025_08_25[0].replace('-2025-08-25', '');
        const restoredEmp1 = state.employees.find(e => e.id === emp1Id);
        expect(restoredEmp1).toBeDefined();
        expect(restoredEmp1.number).toBe('1');
        const fixtureEmp1 = fixture.data.employees.find(e => e.id === emp1Id);
        expect(restoredEmp1.loans).toEqual(fixtureEmp1.loans);
        expect(hashObject(restoredEmp1.loans)).toBe(fixture.meta.nestedLoan1Hash);

        // 5. Employee-position references valid
        const positionIds = new Set(state.positions.map(p => p.id));
        for (const emp of state.employees) {
            for (const posId of emp.positions || []) {
                expect(positionIds.has(posId)).toBe(true);
            }
        }

        // 6. Effective projectIds of employees, positions, leaders, attendance resolvable to catalog
        const allProjects = await projectStore.listAll();
        const catalogProjectIds = allProjects.map(p => p.id);
        expect(catalogProjectIds).toContain(OLD_PROJECT_ID);

        const effectiveEmployeeProjects = new Set(state.employees.map(e => effectiveProjectId(e, scope)));
        expect(effectiveEmployeeProjects.size).toBe(1);
        expect(catalogProjectIds).toContain([...effectiveEmployeeProjects][0]);

        // 7. Emp 34 and Emp 405 visible in same scope
        const scopedEmployees = getScopedEmployees(state, scope);
        expect(scopedEmployees.length).toBe(57);
        expect(scopedEmployees.some(e => e.id === EMP_34_ID)).toBe(true);
        expect(scopedEmployees.some(e => e.id === EMP_405_ID)).toBe(true);

        // 8. Project catalog, default pointer, active pointer, projectPayrollConfigs coherent
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(OLD_PROJECT_ID);
        expect(scope.defaultProjectId).toBe(OLD_PROJECT_ID);
        const config = await ProjectPayrollConfigStore.getConfig(OLD_PROJECT_ID, { idb: db3 });
        expect(config).not.toBeNull();
        expect(config?.projectId).toBe(OLD_PROJECT_ID);
        expect(config?.regularHoursPerDay).toBe(8);

        // 9. Petty Cash: 84 movements and exact relations/IDs preserved
        const dbMovements = await db3.getAll('pettyCashMovements');
        expect(dbMovements.length).toBe(84);
        for (let i = 1; i <= 84; i++) {
            const mov = dbMovements.find(m => m.id === `mov-${i}`);
            expect(mov).toBeDefined();
            expect(mov.projectId).toBe('pc-proj-1');
            expect(mov.periodId).toBe('pc-per-1');
            expect(mov.amount).toBe(20 + i);
            expect(mov.concept).toBe(`Comprobante Operativo ${i}`);
        }

        const dbProjects = await db3.getAll('pettyCashProjects');
        expect(dbProjects.length).toBe(1);
        expect(dbProjects[0].officialProjectId).toBe(OLD_PROJECT_ID);

        const dbPeriods = await db3.getAll('pettyCashPeriods');
        expect(dbPeriods.length).toBe(1);
        expect(dbPeriods[0].projectId).toBe('pc-proj-1');

        db3.db.close();
    }, 60000);
});

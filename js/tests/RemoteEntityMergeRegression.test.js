import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { mergeLoadedRemoteEntities, referencedPositionIds, referencedLeaderIds } from 'actual/services/RemoteEntityMerge.js';
import { createCatalogIncomingMerge, mergeIncomingPositions, mergeIncomingLeaders } from 'actual/services/CatalogIncomingMerge.js';
import { resetIncomingMergeBaseline } from 'actual/services/EmployeesIncomingMerge.js';
import { EmployeeRepository } from 'actual/services/EmployeeRepository.js';
import { PositionRepository } from 'actual/services/PositionRepository.js';
import { LeaderRepository } from 'actual/services/LeaderRepository.js';
import { EmployeesLiveSync } from 'actual/services/EmployeesLiveSync.js';
import { PositionsLiveSync } from 'actual/services/PositionsLiveSync.js';
import { LeadersLiveSync } from 'actual/services/LeadersLiveSync.js';
import { auth, onSnapshot } from '../modules/data/firebase.js';
import { captureAttendancePositionAssignments } from 'actual/features/employees/EmployeePositionAssignments.js';
import { PayrollService } from 'actual/features/payroll/PayrollService.js';
import { filterPayrollRowsByLeader } from 'actual/features/payroll/PayrollPreview.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

const list = (prefix, count) => Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`, name: `${prefix} ${i}`, updatedAt: 100
}));

beforeEach(() => {
    resetIncomingMergeBaseline();mergeIncomingPositions.resetBaseline();mergeIncomingLeaders.resetBaseline();
});

test('a partial mirror preserves 86 employees, 27 positions and 7 leaders with local edits', async () => {
    const local = { employees: list('e', 86), positions: list('p', 27), leaders: list('l', 7) };
    local.positions[0] = { ...local.positions[0], name: 'Editado localmente', updatedAt: 200 };
    local.employees[0].loans = [{ id: 'loan-local', amount: 900, payments: [] }];
    const incoming = { employees: list('e', 83), positions: list('p', 5), leaders: list('l', 4) };
    const original = JSON.stringify(local);
    const merged = mergeLoadedRemoteEntities(local, incoming);
    expect([merged.employees.length, merged.positions.length, merged.leaders.length]).toEqual([86, 27, 7]);
    expect(merged.positions.find(p => p.id === 'p0').name).toBe('Editado localmente');
    expect(merged.employees.find(e => e.id === 'e0').loans[0].id).toBe('loan-local');
    expect(JSON.stringify(local)).toBe(original);
    const db = new IndexedDBService('partial-mirror-regression');
    try {
        await db.saveState({ ...merged, settings: { schemaVersion: 4 }, attendance: {} });
        const restored = await db.loadFullState();
        expect([restored.employees.length, restored.positions.length, restored.leaders.length]).toEqual([86, 27, 7]);
    } finally { db.db?.close(); }
});

test('empty or failed mirror reads preserve the local collections', () => {
    const local = { employees: list('e', 3), positions: list('p', 3), leaders: list('l', 3) };
    expect(mergeLoadedRemoteEntities(local, { employees: null, positions: [], leaders: null })).toEqual(local);
});

test.each(['L1', null])('a mirror cannot erase an individual leader when the catalogue leader is %s', catalogueLeader => {
    const local = {
        employees: [{ id: 'e', number: '001', positions: ['p'], updatedAt: 200, positionsUpdatedAt: 200,
            positionAssignments: { p: { workLeaderId: 'L2', isLoanPosition: false } } }],
        positions: [{ id: 'p', name: 'Albañil', hourlyRate: 100, leaderId: catalogueLeader, updatedAt: 100,
            workingDays: [0,1,2,3,4,5,6] }],
        leaders: [{ id: 'L1', name: 'Uno' }, { id: 'L2', name: 'Dos' }]
    };
    const remote = { ...local, employees: [{ id: 'e', number: '001', name: 'Cambio de otro dispositivo',
        positions: ['p'], updatedAt: 300, positionsUpdatedAt: 100 }] };
    const merged = mergeLoadedRemoteEntities(local, remote);
    expect(merged.employees[0].positionAssignments.p.workLeaderId).toBe('L2');
    const state = { ...merged, settings: { regularHoursPerDay: 8, overtimeFactor: 1.35, holidays: [] }, attendance: {}, exportConfig: {} };
    const date = '2026-11-11';
    state.attendance[`e-${date}`] = captureAttendancePositionAssignments({ employeeId: 'e', date, present: true,
        selectedPosition: 'p', hoursWorked: 8, overtimeHours: 0 }, state);
    const payroll = new PayrollService(state).calculateEmployeePayroll('e', date, date, [], [], []);
    const row = { _employeeId: 'e', _brutoOriginal: payroll.brutoOriginal, monto: payroll.neto,
        _positionBreakdown: payroll.breakdown };
    expect(filterPayrollRowsByLeader([row], { ...state, leaderId: 'L2', hoursScope: 'leader' })[0].monto).toBe(800);
    expect(filterPayrollRowsByLeader([row], { ...state, leaderId: 'L1' })).toEqual([]);
});

test('an incomplete mirror cannot advance or contaminate a live catalog baseline', () => {
    const catalog = createCatalogIncomingMerge();
    catalog([], list('p', 3));
    expect(catalog(list('p', 3), list('p', 1), { authoritative: false })).toHaveLength(3);
    // A later confirmed deletion still works; a cache read did not replace its baseline.
    expect(catalog(list('p', 3), list('p', 1))).toHaveLength(1);
});

test('referenced positions survive a server shrink and can be removed once no longer referenced', () => {
    const catalog = createCatalogIncomingMerge();catalog([], list('p', 3));
    const state = { employees: [{ positions: ['p1'] }], attendance: {
        'e-day': { present: true, positionHours: [{ positionId: 'p2', hours: 4 }] }
    } };
    expect(catalog(list('p', 3), list('p', 1), { preserveIds: referencedPositionIds(state) })).toHaveLength(3);
    expect(catalog(list('p', 3), list('p', 1))).toHaveLength(1);
});

test('leader protection includes an individual team and alternate payer', () => {
    const ids = referencedLeaderIds({ positions: [{ leaderId: 'catalogue' }], employees: [{
        positionAssignments: { p: { workLeaderId: 'team', isLoanPosition: true, payerLeaderId: 'payer' } }
    }] });
    expect([...ids].sort()).toEqual(['catalogue', 'payer', 'team']);
});

describe.each([
    ['employees', EmployeeRepository, EmployeesLiveSync],
    ['positions', PositionRepository, PositionsLiveSync],
    ['leaders', LeaderRepository, LeadersLiveSync]
])('%s repository → LiveSync snapshot provenance', (_name, repository, live) => {
    afterEach(() => { live.stop();jest.useRealTimers();auth.currentUser = null; });
    test('cached and pending snapshots are partial; only confirmed server snapshots authorize absence', () => {
        jest.useFakeTimers();auth.currentUser = { uid: 'fictional-user' };
        let emit;onSnapshot.mockImplementation((_ref, callback) => { emit = callback;return () => {}; });
        const applied = jest.fn();
        live.start({ subscribe: callback => repository.subscribe(callback), onApply: applied });
        for (const metadata of [
            { fromCache: true, hasPendingWrites: false },
            { fromCache: false, hasPendingWrites: true },
            { fromCache: false, hasPendingWrites: false }
        ]) emit({ metadata, forEach: callback => callback({ data: () => ({ id: 'entry', updatedAt: 1 }) }) });
        expect(applied.mock.calls.map(call => call[1])).toEqual([
            { authoritative: false }, { authoritative: false }, { authoritative: true }
        ]);
    });
});

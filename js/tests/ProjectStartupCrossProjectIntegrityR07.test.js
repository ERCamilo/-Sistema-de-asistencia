import { state } from '../modules/core/AppState.js';
import { validateDataIntegrity } from '../modules/services/PersistenceService.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope, peekEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { Position } from '../modules/features/employees/Position.js';

const PRJ_A = 'PRJ-A-000000';
const PRJ_B = 'PRJ-B-000000';

/**
 * R07 A2c-3 H8 — ProjectStartupCrossProjectIntegrityR07
 *
 * Contract for non-destructive startup integrity: `validateDataIntegrity` must
 * NOT silently null a cross-project leader/position relationship. It preserves
 * the problematic leader reference (crossProjectLeaderId) for explicit
 * reconciliation/diagnostics while keeping the frozen F1.4 leaderId=null sever.
 * A genuinely MISSING leader stays a plain null (no pending reference). Projects
 * OFF keeps legacy behavior (no cross-project branch, no new field).
 */

function snapshotState() {
    return JSON.parse(JSON.stringify({
        employees: state.employees,
        positions: state.positions,
        leaders: state.leaders,
        attendance: state.attendance
    }));
}

function restoreState(snap) {
    state.employees = snap.employees;
    state.positions = snap.positions;
    state.leaders = snap.leaders;
    state.attendance = snap.attendance;
}

function seedCrossProjectPair() {
    state.leaders = [
        { id: 'LEAD-A', number: '11', name: 'LiderA', icon: null, active: true, color: '#fff', updatedAt: 1, projectId: PRJ_A },
        { id: 'LEAD-B', number: '12', name: 'LiderB', icon: null, active: true, color: '#fff', updatedAt: 1, projectId: PRJ_B }
    ];
    state.positions = [
        { id: 'POS-X', name: 'PuestoX', hourlyRate: 5, color: '#333', icon: null, active: true, workingDays: [1], leaderId: 'LEAD-A', statusHistory: [], updatedAt: 1, projectId: PRJ_B },
        { id: 'POS-B', name: 'PuestoB', hourlyRate: 5, color: '#222', icon: null, active: true, workingDays: [1], leaderId: 'LEAD-B', statusHistory: [], updatedAt: 1, projectId: PRJ_B }
    ];
    state.employees = [];
    state.attendance = {};
}

describe('ProjectStartupCrossProjectIntegrityR07', () => {
    let snap;

    beforeEach(() => {
        snap = snapshotState();
        localStorage.clear();
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_B });
    });

    afterEach(() => {
        restoreState(snap);
        localStorage.clear();
        setProjectsEnabled(false);
        resetEntityScope();
    });

    test('cross-project leader sever preserves the pending reference for reconciliation', async () => {
        seedCrossProjectPair();

        const fixes = await validateDataIntegrity();

        const x = state.positions.find(p => p.id === 'POS-X');
        expect(x.leaderId).toBeNull(); // frozen F1.4 sever kept
        expect(x.crossProjectLeaderId).toBe('LEAD-A'); // preserved for explicit reconciliation
        expect(fixes).toBeGreaterThan(0);
        // Same-project pair survives untouched.
        expect(state.positions.find(p => p.id === 'POS-B').leaderId).toBe('LEAD-B');
        expect(state.positions.find(p => p.id === 'POS-B').crossProjectLeaderId).toBeUndefined();
    });

    test('zero collateral mutation on cross-project sever', async () => {
        seedCrossProjectPair();
        const beforePosB = JSON.parse(JSON.stringify(state.positions.find(p => p.id === 'POS-B')));
        const beforeLeaders = JSON.parse(JSON.stringify(state.leaders));
        const beforeEmployees = JSON.parse(JSON.stringify(state.employees));
        const beforeAttendance = JSON.parse(JSON.stringify(state.attendance));

        await validateDataIntegrity();

        // Only the affected position's leaderId/crossProjectLeaderId/updatedAt change.
        expect(state.positions.find(p => p.id === 'POS-B')).toEqual(beforePosB);
        expect(state.leaders).toEqual(beforeLeaders);
        expect(state.employees).toEqual(beforeEmployees);
        expect(state.attendance).toEqual(beforeAttendance);
    });

    test('idempotent: second run fixes nothing and preserves the pending evidence', async () => {
        seedCrossProjectPair();
        await validateDataIntegrity();
        const x = state.positions.find(p => p.id === 'POS-X');
        const pending = x.crossProjectLeaderId;

        const fixes2 = await validateDataIntegrity();

        expect(fixes2).toBe(0);
        expect(state.positions.find(p => p.id === 'POS-X').crossProjectLeaderId).toBe(pending);
        expect(state.positions.find(p => p.id === 'POS-X').leaderId).toBeNull();
    });

    test('no auto-restore: validation never re-animates leaderId from the pending reference', async () => {
        seedCrossProjectPair();
        await validateDataIntegrity();

        // Catalog unchanged; run again with the same (still cross-project) state.
        await validateDataIntegrity();

        const x = state.positions.find(p => p.id === 'POS-X');
        expect(x.leaderId).toBeNull();
        expect(x.crossProjectLeaderId).toBe('LEAD-A');
    });

    test('missing leader is a true orphan: nulled without any pending reference', async () => {
        state.leaders = [
            { id: 'LEAD-A', number: '11', name: 'LiderA', icon: null, active: true, color: '#fff', updatedAt: 1, projectId: PRJ_A }
        ];
        state.positions = [
            { id: 'POS-G', name: 'PuestoG', hourlyRate: 5, color: '#444', icon: null, active: true, workingDays: [1], leaderId: 'LEAD-GHOST', statusHistory: [], updatedAt: 1, projectId: PRJ_B }
        ];
        state.employees = [];
        state.attendance = {};

        await validateDataIntegrity();

        const g = state.positions.find(p => p.id === 'POS-G');
        expect(g.leaderId).toBeNull();
        expect(g.crossProjectLeaderId).toBeUndefined();
    });

    test('Projects OFF keeps legacy parity: cross-project relation is left intact and no new field is written', async () => {
        setProjectsEnabled(false);
        replaceEntityScope();
        seedCrossProjectPair();

        await validateDataIntegrity();

        const x = state.positions.find(p => p.id === 'POS-X');
        expect(x.leaderId).toBe('LEAD-A'); // preserved (OFF ⇒ sameEffectiveProject passthrough)
        expect(x.crossProjectLeaderId).toBeUndefined();
    });

    test('Position model: crossProjectLeaderId is byte-stable through toJSON', () => {
        const withField = new Position({ id: 'P1', crossProjectLeaderId: 'LEAD-A' });
        expect(withField.crossProjectLeaderId).toBe('LEAD-A');
        expect(withField.toJSON().crossProjectLeaderId).toBe('LEAD-A');

        const withoutField = new Position({ id: 'P2' });
        expect(Object.prototype.hasOwnProperty.call(withoutField.toJSON(), 'crossProjectLeaderId')).toBe(false);
    });
});

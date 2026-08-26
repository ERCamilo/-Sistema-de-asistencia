/**
 * F1.5 slice 1 — attendance CORE project-awareness (local side).
 *
 * Contract: docs/fase-1/README.md §"Contrato preparado para F1.5" + roadmap §13 ADR-008.
 * Semantics: flag OFF ⇒ zero change (legacy parity); optional projectId via the
 * established hasOwnProperty conditional pattern; birth stamping only when the
 * record has NO own projectId (edits/tombstones never re-tag ownership);
 * merge keeps each record's OWN projectId; pruning never evicts another
 * project's data while a scope is active.
 */

import { Attendance } from '../modules/features/attendance/Attendance.js';
import { stampAttendanceWrite, tombstoneAttendanceWrite } from '../modules/features/attendance/AttendanceRecordWriter.js';
import { buildMarkVisiblePresentPlan, buildClearVisibleAttendancePlan } from '../modules/features/attendance/AttendanceBulkActions.js';
import { mergeAttendanceRecords } from '../modules/features/attendance/AttendanceMerge.js';
import { planAttendanceEviction } from '../modules/services/AttendanceRetentionPolicy.js';
import { AttendanceService } from '../modules/features/attendance/AttendanceService.js';
import { upsertNote } from '../modules/features/notes/NotesService.js';
import { getEntityScope, peekEntityScope, ACTIVE_PROJECT_LS_KEY } from '../modules/features/projects/ProjectContext.js';
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

beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(DEFAULT_PROJECT_LS_KEY, PRJ_DEFAULT);
    setProjectsEnabled(false);
    await getEntityScope(); // resync scope snapshot (module cache survives across tests)
    installProjectsMock();
});

afterEach(() => {
    localStorage.clear();
    setProjectsEnabled(false);
    document.body.innerHTML = '';
});

describe('F1.5 Attendance class: optional projectId (hasOwnProperty pattern)', () => {
    test('absent projectId stays absent through toJSON + re-inflate (byte-stable)', () => {
        const json = new Attendance({ employeeId: 'e1', date: '2026-06-15' }).toJSON();
        expect(Object.prototype.hasOwnProperty.call(json, 'projectId')).toBe(false);
        const again = new Attendance(json).toJSON();
        expect(Object.prototype.hasOwnProperty.call(again, 'projectId')).toBe(false);
        expect(again).toEqual(json);
    });

    test('present projectId survives constructor → toJSON → re-inflate', () => {
        const original = new Attendance({ employeeId: 'e1', date: '2026-06-15', projectId: PRJ_A });
        const revived = new Attendance(original.toJSON());
        expect(revived.projectId).toBe(PRJ_A);
        expect(revived.toJSON().projectId).toBe(PRJ_A);
    });

    test('null projectId is preserved as null (absence stays distinct)', () => {
        const att = new Attendance({ employeeId: 'e1', date: '2026-06-15', projectId: null });
        expect(att.projectId).toBeNull();
        expect(new Attendance(att.toJSON()).projectId).toBeNull();
    });
});

describe('F1.5 birth stamping through every local creation path', () => {
    test('flag OFF ⇒ writer outputs carry NO projectId (legacy parity)', () => {
        const stamped = stampAttendanceWrite({ employeeId: 'e1', date: 'D', present: true }, 12345);
        const tombstoned = tombstoneAttendanceWrite({ employeeId: 'e1', date: 'D' }, 12345);
        expect(Object.prototype.hasOwnProperty.call(stamped, 'projectId')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(tombstoned, 'projectId')).toBe(false);
    });

    test('scope ON ⇒ births stamp ACTIVE scope; LEGACY tombstones inherit DEFAULT (never active)', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        const stamped = stampAttendanceWrite({ employeeId: 'e1', date: 'D', present: true }, 1);
        const tombstoned = tombstoneAttendanceWrite({ employeeId: 'e1', date: 'D' }, 2);
        expect(stamped.projectId).toBe(PRJ_A);          // birth ⇒ active project
        expect(tombstoned.projectId).toBe(PRJ_DEFAULT); // frozen rule: projectId ?? DEFAULT
        expect(tombstoned.deletedAt).toBe(2);
    });

    test('existing own projectId is NEVER re-tagged (edit/tombstone while another project active)', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        const foreign = { employeeId: 'e1', date: 'D', projectId: PRJ_B };
        expect(stampAttendanceWrite({ ...foreign, present: true }, 1).projectId).toBe(PRJ_B);
        expect(tombstoneAttendanceWrite({ ...foreign }, 1).projectId).toBe(PRJ_B);
    });

    test('writer stays pure (input not mutated)', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        const rec = { employeeId: 'e1', date: 'D', present: true };
        stampAttendanceWrite(rec, 1);
        expect(Object.prototype.hasOwnProperty.call(rec, 'projectId')).toBe(false);
    });

    test('bulk mark-visible-present plan stamps births when ON; none when OFF', async () => {
        const args = {
            employees: [{ id: 'e1', positions: ['p1'] }],
            attendance: {},
            dateKey: '2026-06-15',
            dayHours: 8,
            isHoliday: false,
            now: 12345
        };
        const off = buildMarkVisiblePresentPlan(args);
        expect(Object.prototype.hasOwnProperty.call(off[0].next, 'projectId')).toBe(false);

        setProjectsEnabled(true);
        await primeScope(PRJ_B);
        const on = buildMarkVisiblePresentPlan(args);
        expect(on[0].next.projectId).toBe(PRJ_B);
    });

    test('bulk clear plan tombstones keep the previous record own tag', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        const previous = { employeeId: 'e1', date: '2026-06-15', present: true, hoursWorked: 8, projectId: PRJ_B };
        const plan = buildClearVisibleAttendancePlan({
            employees: [{ id: 'e1', positions: [] }],
            attendance: { 'e1-2026-06-15': previous },
            dateKey: '2026-06-15',
            now: 777
        });
        expect(plan[0].next.projectId).toBe(PRJ_B);
        expect(plan[0].next.deletedAt).toBe(777);
    });

    test('AttendanceService.createRecord stamps when ON; absent when OFF', async () => {
        const fakeState = () => ({
            employees: [{ id: 'e1', positions: ['p1'] }],
            attendance: {},
            settings: { regularHoursPerDay: 8, holidays: [] }
        });
        const off = new AttendanceService(fakeState());
        const offRec = off.createRecord('e1', '2026-06-15');
        expect(Object.prototype.hasOwnProperty.call(offRec, 'projectId')).toBe(false);

        setProjectsEnabled(true);
        await primeScope(PRJ_B);
        const on = new AttendanceService(fakeState());
        const onRec = on.createRecord('e1', '2026-06-15');
        expect(onRec.projectId).toBe(PRJ_B);
    });

    test('NotesService.upsertNote-born minimal record stamps when ON, absent OFF; pre-existing keeps own tag', async () => {
        const baseState = extra => ({
            employees: [{ id: 'e1', positions: ['p1'] }],
            attendance: extra,
            settings: {}
        });
        const offRec = upsertNote(baseState({}), 'e1', '2026-06-15', 'off-note');
        expect(Object.prototype.hasOwnProperty.call(offRec, 'projectId')).toBe(false);

        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        const born = upsertNote(baseState({}), 'e1', '2026-06-15', 'born-note');
        expect(born.projectId).toBe(PRJ_A);

        const preExisting = { 'e1-2026-06-15': { employeeId: 'e1', date: '2026-06-15', notes: '', projectId: PRJ_B } };
        const edited = upsertNote(baseState(preExisting), 'e1', '2026-06-15', 'edited');
        expect(edited.projectId).toBe(PRJ_B);
    });
});

describe('F1.5 merge preservation (LWW keeps each record OWN projectId)', () => {
    test('incoming payload for B while active=A keeps its B tag; absence never deletes', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        const local = {
            'E-A-2026-06-15': { employeeId: 'E-A', date: '2026-06-15', present: true, hoursWorked: 8, updatedAt: 10, projectId: PRJ_A }
        };
        const incoming = {
            'E-B-2026-06-15': { employeeId: 'E-B', date: '2026-06-15', present: true, hoursWorked: 9, updatedAt: 20, projectId: PRJ_B },
            'E-A-2026-06-15': { employeeId: 'E-A', date: '2026-06-15', present: true, hoursWorked: 7, updatedAt: 30, projectId: PRJ_A }
        };
        const merged = mergeAttendanceRecords(local, incoming);
        expect(merged['E-B-2026-06-15'].projectId).toBe(PRJ_B);
        expect(merged['E-B-2026-06-15'].hoursWorked).toBe(9);
        expect(merged['E-A-2026-06-15'].projectId).toBe(PRJ_A);
        expect(merged['E-A-2026-06-15'].hoursWorked).toBe(7);
    });

    test('older incoming cannot re-tag a newer local record', () => {
        const local = { 'K': { employeeId: 'x', date: 'D', updatedAt: 100, projectId: PRJ_A } };
        const incoming = { 'K': { employeeId: 'x', date: 'D', updatedAt: 50, projectId: PRJ_B } };
        expect(mergeAttendanceRecords(local, incoming)['K'].projectId).toBe(PRJ_A);
    });
});

describe('F1.5 retention/pruner becomes per-project only when enabled', () => {
    // Both dates far outside the 12-month retention window; lastAccessed/deletedAt unset.
    const OLD = '2024-01-01';
    const seed = () => ({
        [`EA-${OLD}`]: { employeeId: 'EA', date: OLD, present: true, projectId: PRJ_A },
        [`EB-${OLD}`]: { employeeId: 'EB', date: OLD, present: true, projectId: PRJ_B },
        [`ED-${OLD}`]: { employeeId: 'ED', date: OLD, present: true } // legacy ⇒ default
    });

    test('scope ON: foreign-project records survive, expired own-project record removed', () => {
        const plan = planAttendanceEviction(seed(), {
            now: new Date('2026-08-01').getTime(),
            scope: { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT }
        });
        expect(plan.evictKeys).toEqual([`EA-${OLD}`]);
        expect(plan.kept[`EB-${OLD}`].projectId).toBe(PRJ_B);
        expect(plan.kept[`ED-${OLD}`]).toBeDefined();
    });

    test('scope OFF/null: whole-day behavior unchanged (all expired evicted)', () => {
        const attendance = seed();
        const plan = planAttendanceEviction(attendance, { now: new Date('2026-08-01').getTime() });
        expect(plan.evictKeys.sort()).toEqual([`EA-${OLD}`, `EB-${OLD}`, `ED-${OLD}`]);
        expect(plan.kept).toEqual({});
    });

    test('enabled scope without known default keeps legacy records (conservative)', () => {
        const plan = planAttendanceEviction(seed(), {
            now: new Date('2026-08-01').getTime(),
            scope: { enabled: true, projectId: PRJ_A, defaultProjectId: null }
        });
        expect(plan.evictKeys).toEqual([`EA-${OLD}`]);
        expect(plan.kept[`ED-${OLD}`]).toBeDefined();
    });
});

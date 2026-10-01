// Mini >= 2.15: employees with more than one position report the day's position
// (WhatsApp " _Position_" suffix, or positionName/saPositionId in P2P rows), and
// SA's roster export sends up to 3 positions. See Mini .sdd-review/multi-position.
import { resolveMiniPositionId } from '../modules/features/attendance/MiniPositionMatch.js';
import { parseMiniAttendanceReport } from '../modules/features/attendance/MiniAttendanceParser.js';
import {
    confirmMiniAttendanceDraftDate, createMiniAttendanceDraft, createMiniAttendanceConflictPlan,
    createMiniAttendanceDraftFromConsolidatedDay
} from '../modules/features/attendance/MiniAttendanceDraft.js';
import { validateAttendanceSubmission } from '../modules/services/AttendanceSubmissionInboxStore.js';
import { consolidateAttendanceSubmissions } from '../modules/features/attendance/AttendanceConsolidation.js';
import { adaptResolvedDayToConflictPlan } from '../modules/features/attendance/MultiDayAttendanceResolver.js';
import { buildSaMiniRosterPayload } from '../modules/features/export/SaMiniRosterExport.js';

const PROJECT = 'PRJ-OBRA-NORTE';
const positions = [
    { id: 'pos-alb', name: 'Albañil' },
    { id: 'pos-plo', name: 'Plomero' },
    { id: 'pos-pin', name: 'Pintor' },
    { id: 'pos-cho', name: 'Chofer' }
];
const employees = [
    { id: 'e1', number: '001', name: 'Franklin Henrriquez', positions: ['pos-alb', 'pos-plo'], active: true },
    { id: 'e2', number: '002', name: 'Pauliny Buchamps', positions: ['pos-cho'], active: true }
];

describe('resolveMiniPositionId', () => {
    test('by SA id, then by name (accent/case-insensitive), only among the employee positions', () => {
        const ids = ['pos-alb', 'pos-plo'];
        expect(resolveMiniPositionId({ positionIds: ids, positions, id: 'pos-plo' })).toBe('pos-plo');
        expect(resolveMiniPositionId({ positionIds: ids, positions, name: 'plomero' })).toBe('pos-plo');
        expect(resolveMiniPositionId({ positionIds: ids, positions, name: 'ALBANIL' })).toBe('pos-alb');
        expect(resolveMiniPositionId({ positionIds: ids, positions, id: 'pos-cho' })).toBeNull();
        expect(resolveMiniPositionId({ positionIds: ids, positions, name: 'Chofer' })).toBeNull();
        expect(resolveMiniPositionId({ positionIds: ids, positions, name: 'Electricista' })).toBeNull();
        expect(resolveMiniPositionId({ positionIds: ids, positions })).toBeNull();
    });
});

describe('WhatsApp import uses the " _Position_" suffix', () => {
    function plan(text) {
        const draft = confirmMiniAttendanceDraftDate(createMiniAttendanceDraft({
            parsed: parseMiniAttendanceReport(text), employees, proposedDate: '2026-09-30'
        }), '2026-09-30');
        return createMiniAttendanceConflictPlan(draft, {}, { positions });
    }
    const header = '*Asistencia de hoy miércoles, 30 de septiembre*\n_Última actualización: 12:05 a. m._\n\n';

    test('multi-position employee: the named position is assigned with its hours', () => {
        const row = plan(header + '001. Franklin Henrriquez  *8h* _Plomero_\n').rows[0];
        expect(row.targetPositionId).toBe('pos-plo');
        expect(row.positionAllocations).toEqual([{ positionId: 'pos-plo', normalHours: 8, overtimeHours: 0 }]);
    });

    test('without suffix (older Mini) a multi-position employee still asks, as before', () => {
        const row = plan(header + '001. Franklin Henrriquez  *8h*\n').rows[0];
        expect(row.targetPositionId).toBeNull();
        expect(row.positionAllocations).toEqual([]);
    });

    test('single-position employee is unchanged', () => {
        expect(plan(header + '002. Pauliny Buchamps  *8h*\n').rows[0].targetPositionId).toBe('pos-cho');
    });
});

describe('P2P rows carry the day position', () => {
    const row = (extra = {}) => ({
        miniLocalId: 'm1', number: '001', name: 'Franklin Henrriquez', normalHours: 8, overtimeHours: 0,
        status: 'present', saEmployeeId: 'e1', ...extra
    });
    const submission = (rows, overrides = {}) => ({
        schema: 'attendance-submission/v1', submissionId: '123e4567-e89b-42d3-a456-426614174001', saProjectId: PROJECT,
        scope: { ownerUid: 'o', siteId: 's', sourceId: 'mini-1' }, deviceId: 'mini-1', rosterVersion: 'r1',
        capturedAt: '2026-09-30T12:00:00.000Z', workDate: '2026-09-30', rows, ...overrides
    });

    test('the inbox validator accepts positionName/saPositionId and keeps them', () => {
        const safe = validateAttendanceSubmission(submission([row({ positionName: 'Plomero', saPositionId: 'pos-plo' })]), PROJECT);
        expect(safe.rows[0].positionName).toBe('Plomero');
        expect(safe.rows[0].saPositionId).toBe('pos-plo');
        expect(() => validateAttendanceSubmission(submission([row({ positionName: '' })]), PROJECT)).toThrow(/positionName/);
        expect(() => validateAttendanceSubmission(submission([row({ saPositionId: 'pos-plo' })]), PROJECT)).toThrow(/positionName/);
    });

    test('consolidation → day plan assigns the reported position', () => {
        const consolidation = consolidateAttendanceSubmissions([submission([row({ positionName: 'Plomero', saPositionId: 'pos-plo' })])], { expectedSaProjectId: PROJECT });
        const item = consolidation.items.find(i => i.saEmployeeId === 'e1');
        expect([item.positionName, item.saPositionId]).toEqual(['Plomero', 'pos-plo']);

        const multiDay = adaptResolvedDayToConflictPlan({ date: '2026-09-30', items: consolidation.items, employees, positions });
        expect(multiDay.rows[0].targetPositionId).toBe('pos-plo');

        const draft = createMiniAttendanceDraftFromConsolidatedDay({ date: '2026-09-30', items: consolidation.items, employees });
        expect(createMiniAttendanceConflictPlan(draft, {}, { positions }).rows[0].targetPositionId).toBe('pos-plo');
    });

    test('two Minis reporting different positions for the same day: no automatic position', () => {
        const a = submission([row({ positionName: 'Plomero', saPositionId: 'pos-plo' })]);
        const b = submission([row({ miniLocalId: 'x', positionName: 'Albañil', saPositionId: 'pos-alb' })], {
            submissionId: '123e4567-e89b-42d3-a456-426614174002', deviceId: 'mini-2', scope: { ownerUid: 'o', siteId: 's', sourceId: 'mini-2' }
        });
        const item = consolidateAttendanceSubmissions([a, b], { expectedSaProjectId: PROJECT }).items.find(i => i.saEmployeeId === 'e1');
        expect(item.positionName ?? null).toBeNull();
    });
});

describe('roster export sends up to 3 positions', () => {
    const payload = emps => buildSaMiniRosterPayload({
        saProjectId: PROJECT, employees: emps, positions, generatedAt: '2026-09-30T12:00:00.000Z'
    });

    test('multi-position employee: principal in `position`, all in `positions`', () => {
        const [row] = payload([{ id: 'e1', number: '001', name: 'Franklin', positions: ['pos-alb', 'pos-plo', 'pos-pin', 'pos-cho'], active: true, saProjectId: PROJECT }]).employees;
        expect(row.position).toBe('Albañil');
        expect(row.positions).toEqual([{ id: 'pos-alb', name: 'Albañil' }, { id: 'pos-plo', name: 'Plomero' }, { id: 'pos-pin', name: 'Pintor' }]);
    });

    test('single-position employee: row unchanged (no `positions`), so older Minis keep importing it', () => {
        const [row] = payload([{ id: 'e2', number: '002', name: 'Pauliny', positions: ['pos-cho'], active: true, saProjectId: PROJECT }]).employees;
        expect(row.position).toBe('Chofer');
        expect('positions' in row).toBe(false);
    });
});

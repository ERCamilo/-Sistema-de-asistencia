import {
    attendanceProposalPeerId,
    hasEmployeeProfile,
    buildAttendanceEmployeeProposals
} from '../modules/features/attendance/MiniAttendanceEmployeeProposal.js';

const PROJECT = 'PRJ-OBRA-1';
const NOW = Date.parse('2026-10-21T12:00:00.000Z');

function source(overrides = {}) {
    return {
        sourcePeerId: 'peer-1',
        deviceId: 'Mini de Juan',
        rawDeviceId: 'phone-1',
        sourceId: 'mini-principal',
        workDate: '2026-10-20',
        capturedAt: '2026-10-20T20:00:00.000Z',
        miniLocalId: 'u1',
        number: '7',
        name: 'Pedro Nuevo',
        positionName: 'Albañil',
        dailySalary: 1500,
        ...overrides
    };
}
function item(id, sourceOverrides = {}, overrides = {}) {
    return {
        id,
        status: 'identity_conflict',
        conflictType: 'missing_sa_employee_id',
        saEmployeeId: null,
        sources: [source(sourceOverrides)],
        ...overrides
    };
}
const build = (items, extra = {}) => buildAttendanceEmployeeProposals(items, { saProjectId: PROJECT, now: NOW, ...extra });

describe('MiniAttendanceEmployeeProposal — unlinked attendance rows to an employee proposal', () => {
    test('hasEmployeeProfile is true when the source carries salary or position', () => {
        expect(hasEmployeeProfile(source())).toBe(true);
        expect(hasEmployeeProfile(source({ positionName: undefined }))).toBe(true);
        expect(hasEmployeeProfile(source({ dailySalary: undefined }))).toBe(true);
        expect(hasEmployeeProfile(source({ positionName: undefined, dailySalary: undefined }))).toBe(false);
        expect(hasEmployeeProfile(null)).toBe(false);
    });

    test('attendanceProposalPeerId uses the real peer, else a stable synthetic id for imports', () => {
        expect(attendanceProposalPeerId(source())).toBe('peer-1');
        const imported = attendanceProposalPeerId(source({ sourcePeerId: null }));
        expect(imported).toBe('attendance:phone-1');
        expect(attendanceProposalPeerId(source({ sourcePeerId: null }))).toBe(imported);
        expect(attendanceProposalPeerId(source({ sourcePeerId: null, rawDeviceId: '', sourceId: 'x'.repeat(300) })).length).toBeLessThanOrEqual(128);
    });

    test('builds a valid daily DOP proposal with the Mini profile of each unlinked employee', () => {
        const { groups, skipped } = build([item('a')]);
        expect(skipped).toEqual([]);
        expect(groups).toHaveLength(1);
        const [group] = groups;
        expect(group.peerId).toBe('peer-1');
        expect(group.peerName).toBe('Mini de Juan');
        expect(group.proposal).toMatchObject({
            schema: 'mini-roster-proposal/v1', saProjectId: PROJECT, salaryPeriod: 'daily', currency: 'DOP',
            generatedAt: '2026-10-20T20:00:00.000Z'
        });
        expect(group.proposal.employees).toEqual([
            { miniLocalId: 'u1', number: '7', name: 'Pedro Nuevo', position: 'Albañil', dailySalary: 1500, phone: '', email: '' }
        ]);
        expect(group.itemIds).toEqual(['a']);
    });

    test('is deterministic so repeating the action reuses the same proposal', () => {
        const first = build([item('a')]).groups[0].proposal;
        const second = build([item('a')], { now: NOW + 60000 }).groups[0].proposal;
        expect(second.proposalId).toBe(first.proposalId);
        expect(second.requestId).toBe(first.requestId);
        const changed = build([item('a', { dailySalary: 1600 })]).groups[0].proposal;
        expect(changed.proposalId).not.toBe(first.proposalId);
    });

    test('the same employee on several days becomes one row, using the latest data', () => {
        const items = [
            item('d1', { workDate: '2026-10-19', capturedAt: '2026-10-19T20:00:00.000Z', dailySalary: 1400 }),
            item('d2', { workDate: '2026-10-20', dailySalary: 1500 })
        ];
        const { groups } = build(items);
        expect(groups[0].proposal.employees).toHaveLength(1);
        expect(groups[0].proposal.employees[0].dailySalary).toBe(1500);
        expect(groups[0].itemIds.sort()).toEqual(['d1', 'd2']);
    });

    test('rows missing data are kept with empty fields; invalid salary is dropped, not guessed', () => {
        const { groups } = build([item('a', { positionName: undefined, dailySalary: 'abc' })]);
        expect(groups[0].proposal.employees[0]).toMatchObject({ position: '', dailySalary: null });
    });

    test('splits by Mini peer: one proposal per source device', () => {
        const { groups } = build([item('a'), item('b', { sourcePeerId: 'peer-2', miniLocalId: 'u2', number: '8', name: 'Otro' })]);
        expect(groups.map(g => g.peerId).sort()).toEqual(['peer-1', 'peer-2']);
    });

    test('skips rows that cannot be proposed and says why', () => {
        const items = [
            item('linked', {}, { saEmployeeId: 'EMP-1' }),
            item('excluded', {}, { excluded: true }),
            item('badnumber', { number: 'A12', miniLocalId: 'u3' }),
            item('noname', { name: ' ', miniLocalId: 'u4', number: '9' }),
            item('nolocal', { miniLocalId: null, number: '10' }),
            item('ok', { miniLocalId: 'u5', number: '11', name: 'Bueno' })
        ];
        const { groups, skipped } = build(items);
        expect(groups[0].proposal.employees.map(e => e.miniLocalId)).toEqual(['u5']);
        expect(skipped.map(s => [s.itemId, s.reason]).sort()).toEqual([
            ['badnumber', 'invalid_number'],
            ['nolocal', 'missing_local_id'],
            ['noname', 'missing_name']
        ].sort());
    });

    test('returns no groups when nothing is eligible', () => {
        const { groups, skipped } = build([item('x', { number: 'A1' })]);
        expect(groups).toEqual([]);
        expect(skipped).toHaveLength(1);
    });

    test('row order does not depend on input order, so the stored proposal is stable', () => {
        const a = item('a', { miniLocalId: 'u9', number: '9', name: 'Nueve' });
        const b = item('b', { miniLocalId: 'u2', number: '2', name: 'Dos' });
        const forward = build([a, b]).groups[0].proposal;
        const backward = build([b, a]).groups[0].proposal;
        expect(forward.employees.map(e => e.number)).toEqual(['2', '9']);
        expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
    });

    test('caps a proposal at 500 employees', () => {
        const many = Array.from({ length: 501 }, (_, i) => item(`i${i}`, { miniLocalId: `u${i}`, number: String(i + 1), name: `Emp ${i}` }));
        const { groups, skipped } = build(many);
        expect(groups[0].proposal.employees).toHaveLength(500);
        expect(skipped.some(s => s.reason === 'too_many')).toBe(true);
    });
});

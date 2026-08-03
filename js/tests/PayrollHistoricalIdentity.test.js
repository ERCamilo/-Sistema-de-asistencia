import { buildPayrollHistoricalOrganization } from '../modules/features/payroll/PayrollHistoricalIdentity.js';

describe('Payroll historical organization', () => {
    const positions = [
        { id: 'old-position', name: 'Ayudante actualizada', leaderId: 'leader-1' },
        { id: 'new-position', name: 'Supervisora', leaderId: 'leader-2' }
    ];
    const leaders = [
        { id: 'leader-1', number: 7, name: 'Marta' },
        { id: 'leader-2', number: 8, name: 'Linus' }
    ];

    test('uses positions worked in the period instead of a later employee assignment', () => {
        expect(buildPayrollHistoricalOrganization({
            employee: { positions: ['new-position'] },
            breakdown: [{ positionId: 'old-position', positionName: 'Ayudante histórica' }],
            positions,
            leaders
        })).toEqual({
            positionName: 'Ayudante histórica',
            leaderRefs: [{ id: 'leader-1', name: 'Marta', number: 7 }]
        });
    });

    test('falls back to the assigned position when no period breakdown exists', () => {
        expect(buildPayrollHistoricalOrganization({
            employee: { positions: ['new-position'] },
            positions,
            leaders
        })).toMatchObject({
            positionName: 'Supervisora',
            leaderRefs: [{ id: 'leader-2' }]
        });
    });
});

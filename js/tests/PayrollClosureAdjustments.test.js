import {
    buildPayrollAdjustmentSnapshot,
    consumePayrollClosureAdjustments,
    restorePayrollClosureAdjustments
} from '../modules/features/payroll/PayrollClosureAdjustments.js';

function rows() {
    return [{
        _bonusDetails: [{ id: 'BON-ONCE', amount: 50 }],
        _deductionDetails: [
            { id: 'DED-ONCE', amount: 20 },
            { id: 'DED-RECURRING', amount: 10 }
        ]
    }];
}

function exportConfig() {
    return {
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        bonuses: [
            { id: 'BON-ONCE', name: 'Premio puntual', type: 'fixed', value: 50, scope: 'global' },
            { id: 'BON-UNUSED', name: 'No aplicado', type: 'fixed', value: 5, scope: 'employee', targetId: 'other' }
        ],
        deductions: [
            { id: 'DED-ONCE', name: 'Uniforme', type: 'fixed', value: 20, scope: 'global' },
            { id: 'DED-RECURRING', name: 'Comedor', type: 'fixed', value: 10, scope: 'global', remembered: true }
        ]
    };
}

describe('Payroll closure adjustments', () => {
    test('freezes only adjustment rules that produced an applied row detail', () => {
        expect(buildPayrollAdjustmentSnapshot({
            rows: rows(),
            bonuses: exportConfig().bonuses,
            deductions: exportConfig().deductions
        })).toEqual({
            bonuses: [expect.objectContaining({ id: 'BON-ONCE', remembered: false })],
            deductions: [
                expect.objectContaining({ id: 'DED-ONCE', remembered: false }),
                expect.objectContaining({ id: 'DED-RECURRING', remembered: true })
            ]
        });
    });

    test('consumes applied one-time rules but keeps recurring and unapplied rules', () => {
        const config = exportConfig();
        const closure = {
            adjustments: buildPayrollAdjustmentSnapshot({
                rows: rows(), bonuses: config.bonuses, deductions: config.deductions
            })
        };

        expect(consumePayrollClosureAdjustments(config, closure)).toMatchObject({
            bonuses: [{ id: 'BON-UNUSED' }],
            deductions: [{ id: 'DED-RECURRING', remembered: true }]
        });
    });

    test('restores one-time rules once and returns to the closed period', () => {
        const original = exportConfig();
        const adjustments = buildPayrollAdjustmentSnapshot({
            rows: rows(), bonuses: original.bonuses, deductions: original.deductions
        });
        const consumed = consumePayrollClosureAdjustments(original, { adjustments });
        const closure = {
            periodStart: original.periodStart,
            periodEnd: original.periodEnd,
            adjustments
        };

        const restored = restorePayrollClosureAdjustments({
            ...consumed,
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15'
        }, closure);
        const restoredAgain = restorePayrollClosureAdjustments(restored, closure);

        expect(restored).toMatchObject({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15'
        });
        expect(restored.bonuses.filter(item => item.id === 'BON-ONCE')).toHaveLength(1);
        expect(restored.deductions.filter(item => item.id === 'DED-ONCE')).toHaveLength(1);
        expect(restoredAgain).toEqual(restored);
    });

    test('rejects restoring over a different rule with the same identity', () => {
        const original = exportConfig();
        const adjustments = buildPayrollAdjustmentSnapshot({
            rows: rows(), bonuses: original.bonuses, deductions: original.deductions
        });
        expect(() => restorePayrollClosureAdjustments({
            ...original,
            bonuses: [{ ...original.bonuses[0], value: 999 }]
        }, { periodStart: original.periodStart, periodEnd: original.periodEnd, adjustments }))
            .toThrow('BON-ONCE');
    });

    test('preserves every employee selected by one rule through close and restore', () => {
        const multiRule = {
            id: 'BON-MULTI',
            name: 'Bono de equipo',
            type: 'fixed',
            value: 500,
            scope: 'employee',
            targetId: 'e1',
            targetIds: ['e1', 'e2']
        };
        const appliedRows = [{
            _bonusDetails: [{ id: 'BON-MULTI', amount: 500 }],
            _deductionDetails: []
        }];
        const snapshot = buildPayrollAdjustmentSnapshot({
            rows: appliedRows,
            bonuses: [multiRule],
            deductions: []
        });
        const restored = restorePayrollClosureAdjustments(
            { bonuses: [], deductions: [] },
            { adjustments: snapshot }
        );

        expect(snapshot.bonuses[0].targetIds).toEqual(['e1', 'e2']);
        expect(restored.bonuses[0].targetIds).toEqual(['e1', 'e2']);
    });
});

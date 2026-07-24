import { summarizeAdjustmentDetails } from '../modules/features/payroll/PayrollSummary.js';

describe('PayrollSummary — grouped adjustment details', () => {
    const rows = [
        { _employeeId: 'e1', _brutoOriginal: 1000 },
        { _employeeId: 'e2', _brutoOriginal: 2000 }
    ];

    test('details every global adjustment using its applied payroll total', () => {
        const result = summarizeAdjustmentDetails([
            { id: 'tax', name: 'Impuesto', type: 'percentage', value: 10 },
            { id: 'fee', name: 'Cargo fijo', type: 'fixed', value: 25 }
        ], rows, 'Deducción');

        expect(result.globals).toEqual([
            expect.objectContaining({ key: 'tax', label: 'Impuesto', amount: 300 }),
            expect.objectContaining({ key: 'fee', label: 'Cargo fijo', amount: 50 })
        ]);
        expect(result.totalAmount).toBe(350);
    });

    test('groups all employee adjustments into one accumulated amount', () => {
        const result = summarizeAdjustmentDetails([
            { id: 'b1', employeeId: 'e1', type: 'fixed', value: 200 },
            { id: 'b2', employeeId: 'e2', type: 'fixed', value: 200 },
            { id: 'b3', employeeId: 'e2', type: 'percentage', value: 5 }
        ], rows, 'Bonificación');

        expect(result.globals).toEqual([]);
        expect(result.individualCount).toBe(3);
        expect(result.individualAmount).toBe(500);
        expect(result.totalAmount).toBe(500);
    });

    test('ignores an individual adjustment when its employee is outside the payroll rows', () => {
        const result = summarizeAdjustmentDetails([
            { employeeId: 'missing', type: 'fixed', value: 900 }
        ], rows);

        expect(result.individualAmount).toBe(0);
        expect(result.totalAmount).toBe(0);
    });
});

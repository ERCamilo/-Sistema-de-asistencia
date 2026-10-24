import { parsePayrollLoanAmount } from '../modules/features/payroll/PayrollLoanAmount.js';

test.each([
    ['900,50', 900.5], ['900.50', 900.5], ['900', 900], [' 900,5 ', 900.5],
    ['9,000.50', 9000.5], ['9.000,50', 9000.5], ['1,000', 1000], ['1.000', 1000],
    ['1,000,000.25', 1000000.25], ['1.000.000,25', 1000000.25], ['0,01', 0.01]
])('parses %p as %p', (text, expected) => expect(parsePayrollLoanAmount(text)).toBe(expected));

test.each(['', ' ', '0', '-900', '1e3', '9,00,50', '1.00.000', 'abc900', '900abc',
    '900,5010', 'NaN', 'Infinity', '9007199254740992', null, undefined])('rejects invalid amount %p', value => {
    expect(parsePayrollLoanAmount(value)).toBeNull();
});

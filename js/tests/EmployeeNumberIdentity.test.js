import { normalizeEmployeeNumber, employeeNumberIdentityKey, sameEmployeeNumber } from '../modules/features/employees/EmployeeNumberIdentity.js';

describe('EmployeeNumberIdentity — SA/Mini canonical number semantics', () => {
    test.each([['1', 1], ['01', 1], ['001', 1], [1, 1], ['1.0', 1]])('normalize %p -> %p', (raw, expected) => {
        expect(normalizeEmployeeNumber(raw)).toBe(expected);
    });

    test('001, 01 and 1 are one logical employee number while display strings remain untouched', () => {
        expect(sameEmployeeNumber('001', '01')).toBe(true);
        expect(sameEmployeeNumber('01', '1')).toBe(true);
        expect(employeeNumberIdentityKey('001')).toBe(employeeNumberIdentityKey('1'));
    });

    test('legacy alphanumeric fichas retain exact trimmed identity', () => {
        expect(normalizeEmployeeNumber('A-01')).toBeNull();
        expect(sameEmployeeNumber('A-01', ' A-01 ')).toBe(true);
        expect(sameEmployeeNumber('A-01', 'A-1')).toBe(false);
    });
});

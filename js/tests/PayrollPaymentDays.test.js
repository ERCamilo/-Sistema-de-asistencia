import { payrollPaymentDays, payrollWorkedDays } from '../modules/features/payroll/PayrollWorkDays.js';

test('eight regular hours plus two overtime at 1.5 display 1.375 without changing worked days', () => {
    const row = { _positionBreakdown: [{ regularHours: 8, overtimeHours: 2, hourlyRate: 100, overtimeRate: 150 }] };
    const before = JSON.stringify(row);
    expect(payrollPaymentDays(row)).toBe(1.375);
    expect(payrollWorkedDays(row)).toBe(1);
    expect(JSON.stringify(row)).toBe(before);
});

test('each work segment uses its calculated holiday and rest rates, even after settings change', () => {
    const row = { _positionBreakdown: [
        { holidayHours: 8, hourlyRate: 100, holidayRate: 200 },
        { restDayHours: 4, hourlyRate: 150, restDayRate: 450, restDayFactor: 3 }
    ] };
    expect(payrollPaymentDays(row, 8, { holidayFactor: 4, restDayFactor: 1 })).toBe(3.5);
    expect(payrollWorkedDays(row, 8)).toBe(1.5);
    expect(payrollPaymentDays(row, 4)).toBe(7);
});

test('calculated rates take precedence over factors and explicit zero rates stay zero', () => {
    expect(payrollPaymentDays({ _positionBreakdown: [{ overtimeHours: 8, hourlyRate: 100, overtimeRate: 150, overtimeFactor: 2 }] })).toBe(1.5);
    expect(payrollPaymentDays({ _positionBreakdown: [{ holidayHours: 8, hourlyRate: 100, holidayRate: 0 }] }, 8, { holidayFactor: 2 })).toBe(0);
});

test('zero-rate segments use recorded factors, then supplied settings, without inventing work', () => {
    expect(payrollPaymentDays({ _positionBreakdown: [{ restDayHours: 8, hourlyRate: 0, restDayFactor: 3 }] })).toBe(3);
    expect(payrollPaymentDays({ _totalHours: 10, _overtimeHours: 2 }, 8, { overtimeFactor: 1.5 })).toBe(1.375);
    expect(payrollPaymentDays({ _holidayHours: 8 }, 8, { holidayFactor: 2 })).toBe(2);
    expect(payrollPaymentDays({ _positionBreakdown: [] })).toBe(0);
    expect(payrollPaymentDays({ _positionBreakdown: [{ regularHours: -1, overtimeHours: NaN, restDayHours: Infinity }] })).toBe(0);
});

test.each([0, -1, NaN, Infinity])('rejects an invalid %s-hour day', hours => {
    expect(() => payrollPaymentDays({}, hours)).toThrow('La jornada debe ser mayor que cero');
});

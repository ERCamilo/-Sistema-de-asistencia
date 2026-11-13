/** Worked equivalents, without turning pay multipliers or overtime into worked days. */
export function payrollWorkedDays(row, hoursPerDay = 8) {
    const divisor = Number(hoursPerDay);
    if (!Number.isFinite(divisor) || divisor <= 0) throw new Error('La jornada debe ser mayor que cero para mostrar días.');
    const parts = row?._positionBreakdown?.length ? row._positionBreakdown : [{
        regularHours: row?._regularHours ?? Math.max(0, (Number(row?._totalHours) || 0) - (Number(row?._overtimeHours) || 0)
            - (Number(row?._holidayHours) || 0) - (Number(row?._restDayHours) || 0)),
        holidayHours: row?._holidayHours, restDayHours: row?._restDayHours
    }];
    const hours = parts.reduce((sum, part) => sum + ['regularHours', 'holidayHours', 'restDayHours']
        .reduce((total, key) => total + (Number(part[key]) || 0), 0), 0);
    return Math.round(hours / divisor * 1e6) / 1e6;
}

export const formatPayrollDays = value => Number(value).toLocaleString('es-DO', { maximumFractionDigits: 3 });

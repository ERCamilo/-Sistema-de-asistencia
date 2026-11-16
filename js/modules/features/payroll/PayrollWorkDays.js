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

/** Display-only pay equivalents using the rates already calculated for each part. */
export function payrollPaymentDays(row, hoursPerDay = 8, factors = {}) {
    const divisor = Number(hoursPerDay);
    if (!Number.isFinite(divisor) || divisor <= 0) throw new Error('La jornada debe ser mayor que cero para mostrar días.');
    const hours = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    const parts = row?._positionBreakdown?.length ? row._positionBreakdown : [{
        regularHours: row?._regularHours ?? Math.max(0, hours(row?._totalHours) - hours(row?._overtimeHours) - hours(row?._holidayHours) - hours(row?._restDayHours)),
        overtimeHours: row?._overtimeHours, holidayHours: row?._holidayHours, restDayHours: row?._restDayHours
    }];
    const factor = (part, kind) => {
        const rate = part[`${kind}Rate`], base = Number(part.hourlyRate);
        if (rate != null && base > 0 && Number.isFinite(Number(rate)) && Number(rate) >= 0) return Number(rate) / base;
        const direct = part[`${kind}Factor`];
        if (direct != null && Number.isFinite(Number(direct)) && Number(direct) >= 0) return Number(direct);
        const fallback = factors[`${kind}Factor`];
        return fallback != null && Number.isFinite(Number(fallback)) && Number(fallback) >= 0 ? Number(fallback) : 1;
    };
    const total = parts.reduce((sum, part) => sum + hours(part.regularHours)
        + ['overtime', 'holiday', 'restDay'].reduce((weighted, kind) => weighted + hours(part[`${kind}Hours`]) * factor(part, kind), 0), 0);
    return Math.round(total / divisor * 1e6) / 1e6;
}

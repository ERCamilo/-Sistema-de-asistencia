import { getDateKey, parseDate } from '../../utils/DateUtils.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateKey(value) {
    if (!DATE_KEY_RE.test(String(value || ''))) return false;
    const parsed = new Date(`${value}T00:00:00`);
    return !Number.isNaN(parsed.getTime()) && getDateKey(parsed) === value;
}

export function resolvePayrollPeriod(payPeriod, today = new Date()) {
    const length = Number(payPeriod?.periodLength);
    if (isValidDateKey(payPeriod?.periodStart) && Number.isInteger(length) && length >= 1 && length <= 366) {
        const startDate = new Date(`${payPeriod.periodStart}T00:00:00`);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + length - 1);
        return {
            periodStart: payPeriod.periodStart,
            periodEnd: getDateKey(endDate),
            source: 'configured'
        };
    }

    const safeToday = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
    const startDate = new Date(safeToday.getFullYear(), safeToday.getMonth(), 1);
    return {
        periodStart: getDateKey(startDate),
        periodEnd: getDateKey(safeToday),
        source: 'month-fallback'
    };
}

export function getPresentAttendanceInPeriod(employee, periodStart, periodEnd, attendance = {}) {
    if (!employee || !isValidDateKey(periodStart) || !isValidDateKey(periodEnd) || periodStart > periodEnd) return [];
    const records = [];
    const start = parseDate(periodStart);
    const end = parseDate(periodEnd);

    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
        const dateKey = getDateKey(date);
        const record = attendance[`${employee.id}-${dateKey}`];
        if (record?.present === true && record.deletedAt == null) records.push(record);
    }
    return records;
}

function normalizeIds(values) {
    return new Set((values || []).filter(value => value != null).map(value => String(value)));
}

function attendancePositionIds(records) {
    const ids = [];
    for (const record of records) {
        if (record.selectedPosition != null) ids.push(record.selectedPosition);
        for (const position of (record.positionHours || [])) {
            if (position?.positionId != null) ids.push(position.positionId);
        }
    }
    return normalizeIds(ids);
}

export function getPayrollEmployeesForPeriod(state, periodStart, periodEnd) {
    const leaderFilter = state?.exportConfig?.leaderFilter || 'all';
    const leaderPositions = normalizeIds(
        (state?.positions || [])
            .filter(position => String(position.leaderId) === String(leaderFilter))
            .map(position => position.id)
    );

    return (state?.employees || []).filter(employee => {
        const presentRecords = getPresentAttendanceInPeriod(
            employee,
            periodStart,
            periodEnd,
            state?.attendance || {}
        );
        if (employee.active === false && presentRecords.length === 0) return false;
        if (leaderFilter === 'all') return true;

        const currentPositions = normalizeIds([
            ...(employee.positions || []),
            employee.position
        ]);
        const historicalPositions = attendancePositionIds(presentRecords);
        return [...leaderPositions].some(id => currentPositions.has(id) || historicalPositions.has(id));
    }).sort((a, b) => String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true }));
}

import {
    getDateKey,
    parseDate,
    wasEmployeeActiveOnDate
} from '../../utils/DateUtils.js';
import { resolvePayrollPeriod } from '../payroll/PayrollPeriod.js';
import {
    normalizeRegularHoursPerDay,
    resolveDailyTargetHours
} from '../../utils/AttendanceHours.js';

export { normalizeRegularHoursPerDay } from '../../utils/AttendanceHours.js';

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

function validDate(value, fallback = new Date()) {
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : fallback;
}

function resolveRange(selectedDate, today, payPeriod) {
    const selectedKey = getDateKey(selectedDate);
    const configured = resolvePayrollPeriod(payPeriod, selectedDate);
    if (configured.source === 'configured'
        && selectedKey >= configured.periodStart
        && selectedKey <= configured.periodEnd) {
        return {
            source: 'configured',
            rangeStart: configured.periodStart,
            rangeEnd: [selectedKey, getDateKey(today), configured.periodEnd].sort()[0]
        };
    }

    const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    return {
        source: 'month-to-date',
        rangeStart: getDateKey(monthStart),
        rangeEnd: getDateKey(selectedDate > today ? today : selectedDate)
    };
}

function resolveRelevantPositionId(employee, record) {
    const workedPositions = (record?.positionHours || [])
        .filter(item => Number(item?.hours || 0) + Number(item?.overtimeHours || 0) > 0)
        .map(item => item.positionId)
        .filter(Boolean);
    if (record?.selectedPosition) return record.selectedPosition;
    if (workedPositions.length === 1) return workedPositions[0];
    return employee?.positionId || employee?.position || employee?.positions?.[0] || workedPositions[0] || null;
}

function resolveWorkingDays(employee, positions, positionId) {
    const custom = employee?.customWorkingDays?.[positionId];
    if (Array.isArray(custom) && custom.length > 0) return custom;
    const position = (positions || []).find(item => String(item.id) === String(positionId));
    if (Array.isArray(position?.workingDays) && position.workingDays.length > 0) return position.workingDays;
    return DEFAULT_WORKING_DAYS;
}

function resolveScheduledWorkingDays(employee, positions, record) {
    // With actual attendance, the worked/relevant position is authoritative.
    // Without attendance, any assigned position may schedule the employee, so
    // use the conservative union instead of silently choosing the first one.
    if (record?.present === true && record.deletedAt == null) {
        return resolveWorkingDays(employee, positions, resolveRelevantPositionId(employee, record));
    }

    const assignedIds = [
        ...(employee?.positions || []),
        employee?.positionId,
        employee?.position
    ].filter(Boolean);
    if (assignedIds.length === 0) return DEFAULT_WORKING_DAYS;
    return [...new Set(assignedIds.flatMap(positionId =>
        resolveWorkingDays(employee, positions, positionId)
    ))];
}

function getRegularAndOvertime(record, dailyTargetHours) {
    if (!record?.present || record.deletedAt != null) return { regular: 0, overtime: 0 };
    const workedRegular = Math.max(0, Number(record.hoursWorked) || 0);
    const positionOvertime = (record.positionHours || []).reduce(
        (sum, item) => sum + Math.max(0, Number(item?.overtimeHours) || 0),
        0
    );
    const overtime = Number.isFinite(Number(record.overtimeHours))
        ? Math.max(0, Number(record.overtimeHours))
        : (positionOvertime > 0 ? positionOvertime : Math.max(0, workedRegular - dailyTargetHours));
    return {
        regular: Math.min(workedRegular, dailyTargetHours),
        overtime
    };
}

export function buildAttendanceCardPeriodMetrics({
    employee,
    selectedDate,
    today = new Date(),
    attendance = {},
    positions = [],
    settings = {},
    dayHoursConfig = {}
}) {
    const safeSelected = validDate(selectedDate);
    const safeToday = validDate(today);
    const selectedKey = getDateKey(safeSelected);
    const regularHoursPerDay = normalizeRegularHoursPerDay(settings.regularHoursPerDay);
    const range = resolveRange(safeSelected, safeToday, settings.payPeriod);
    const holidays = new Set(settings.holidays || []);
    let scheduledDays = 0;
    let scheduledHours = 0;
    let creditedRegularHours = 0;
    let workedDays = 0;
    let overtimeHours = 0;

    if (range.rangeStart <= range.rangeEnd) {
        const start = parseDate(range.rangeStart);
        const end = parseDate(range.rangeEnd);
        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
            const dateKey = getDateKey(date);
            const record = attendance[`${employee.id}-${dateKey}`];
            const workingDays = resolveScheduledWorkingDays(employee, positions, record);
            const active = wasEmployeeActiveOnDate(employee, dateKey, attendance);
            const eligible = active && !holidays.has(dateKey) && workingDays.includes(date.getDay());
            const dailyTarget = resolveDailyTargetHours(dateKey, dayHoursConfig, regularHoursPerDay);
            const hours = getRegularAndOvertime(record, dailyTarget);
            if (active) overtimeHours += hours.overtime;
            if (!eligible) continue;

            scheduledDays += 1;
            scheduledHours += dailyTarget;
            const creditedForDate = Math.min(hours.regular, dailyTarget);
            creditedRegularHours += creditedForDate;
            // A zero-hour eligible date remains in the calendar denominator but
            // cannot contribute a regular-hour day equivalent (division by zero).
            workedDays += dailyTarget > 0 ? creditedForDate / dailyTarget : 0;
        }
    }

    const deficitHours = Math.max(0, scheduledHours - creditedRegularHours);
    const deficitDays = Math.max(0, scheduledDays - workedDays);
    const selectedRecord = attendance[`${employee.id}-${selectedKey}`];
    const selectedDayNote = typeof selectedRecord?.notes === 'string' ? selectedRecord.notes.trim() : '';

    return {
        ...range,
        scheduledDays,
        workedDays,
        scheduledHours,
        creditedRegularHours,
        creditedRegularDays: workedDays,
        deficitHours,
        deficitDays,
        overtimeHours,
        selectedDayNote,
        fingerprint: [range.rangeStart, range.rangeEnd, scheduledDays, workedDays, creditedRegularHours, deficitHours, deficitDays, overtimeHours, selectedDayNote].join('|')
    };
}

const DISPLAY_DECIMAL_PLACES = 12;

/**
 * Display-only numeric contract: preserve finite decimals as written by JS when
 * they fit, otherwise cap repeating/binary-artifact tails at 12 decimal places.
 * Metric values themselves remain unrounded.
 */
export function formatAttendanceDecimal(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Object.is(numeric, -0)) return '0';
    if (Number.isInteger(numeric)) return String(numeric);

    const direct = String(numeric);
    const decimalPart = direct.includes('.') ? direct.split('.')[1] : '';
    if (!/[eE]/.test(direct) && decimalPart.length <= DISPLAY_DECIMAL_PLACES) return direct;
    return numeric.toFixed(DISPLAY_DECIMAL_PLACES).replace(/\.?0+$/, '');
}

/** Presentation-only day contract: conventional decimal rounding, max 1 place. */
export function formatAttendanceDayNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Object.is(numeric, -0)) return '0';
    const rounded = Math.round((numeric + Number.EPSILON) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatAttendanceDeficit(metrics, unit = 'days') {
    if (unit === 'hours') return `−${formatAttendanceDecimal(metrics?.deficitHours || 0)}h`;
    const days = Number(metrics?.deficitDays) || 0;
    return `−${formatAttendanceDayNumber(days)} ${days === 1 ? 'día' : 'días'}`;
}

export function formatAttendancePeriodRange(metrics) {
    if (metrics.rangeStart > metrics.rangeEnd) return 'Sin jornadas hasta hoy';
    const start = parseDate(metrics.rangeStart);
    const end = parseDate(metrics.rangeEnd);
    const startText = start.toLocaleDateString('es', { day: 'numeric', month: 'short' }).replace('.', '');
    const endText = end.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
    return `${startText}–${endText}`;
}

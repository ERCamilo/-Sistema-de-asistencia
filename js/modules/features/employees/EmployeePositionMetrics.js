import { PayrollService } from '../payroll/PayrollService.js';
import { resolvePayrollPeriod } from '../payroll/PayrollPeriod.js';

const EMPTY_METRICS = Object.freeze({
    days: 0,
    regularHours: 0,
    overtimeHours: 0,
    holidayHours: 0,
    restDayHours: 0,
    restDayFactor: 1.5
});

export function buildEmployeePositionPeriodSnapshot(state, employee, today = new Date()) {
    const period = resolvePayrollPeriod(state?.settings?.payPeriod, today);
    if (!employee?.id) {
        return { period, metricsByPosition: new Map() };
    }

    const payroll = new PayrollService(state).calculateEmployeePayroll(
        employee.id,
        period.periodStart,
        period.periodEnd,
        [],
        [],
        []
    );
    const metricsByPosition = new Map(
        (payroll.breakdown || []).map(item => [String(item.positionId), {
            days: Number(item.days) || 0,
            regularHours: Number(item.regularHours) || 0,
            overtimeHours: Number(item.overtimeHours) || 0,
            holidayHours: Number(item.holidayHours) || 0,
            restDayHours: Number(item.restDayHours) || 0,
            restDayFactor: Number(item.restDayFactor) || 1.5
        }])
    );

    return { period, metricsByPosition };
}

export function getPositionPeriodMetrics(snapshot, positionId) {
    return snapshot?.metricsByPosition?.get(String(positionId)) || EMPTY_METRICS;
}

export function calculatePositionAccrued(metrics, hourlyRate, settings = {}) {
    const rate = Number(hourlyRate);
    if (!Number.isFinite(rate) || rate <= 0) return 0;

    const regularHours = Number(metrics?.regularHours) || 0;
    const overtimeHours = Number(metrics?.overtimeHours) || 0;
    const holidayHours = Number(metrics?.holidayHours) || 0;
    const restDayHours = Number(metrics?.restDayHours) || 0;
    const overtimeFactor = Number(settings.overtimeFactor) || 1;
    const holidayFactor = Number(settings.holidayFactor) || 2;
    const restDayFactor = Number(metrics?.restDayFactor) || Number(settings.restDayFactor) || 1.5;

    return (regularHours * rate)
        + (overtimeHours * rate * overtimeFactor)
        + (holidayHours * rate * holidayFactor)
        + (restDayHours * rate * restDayFactor);
}

export function getPositionTotalHours(metrics) {
    return (Number(metrics?.regularHours) || 0)
        + (Number(metrics?.overtimeHours) || 0)
        + (Number(metrics?.holidayHours) || 0)
        + (Number(metrics?.restDayHours) || 0);
}

export function resolvePositionBaseHourlyRate(position, regularHoursPerDay = 8) {
    const hourlyRate = Number(position?.hourlyRate);
    if (Number.isFinite(hourlyRate) && hourlyRate > 0) return hourlyRate;

    const legacyAmount = Number(position?.salaryConfig?.amount);
    const regularHours = Number(regularHoursPerDay) > 0 ? Number(regularHoursPerDay) : 8;
    return Number.isFinite(legacyAmount) && legacyAmount > 0
        ? legacyAmount / 30 / regularHours
        : 0;
}

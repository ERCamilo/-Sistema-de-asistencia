import { getDateKey } from '../../utils/DateUtils.js';
import { createPayrollProjectContext } from '../payroll/PayrollProjectContext.js';
import { captureEntityProjectScope } from '../projects/EntityProjectScope.js';
import { getActivePayrollSettings, peekActivePayrollConfig } from '../payroll/ActivePayrollSettings.js';
import { PayrollService, calculateEmployeePayrollWithContext } from '../payroll/PayrollService.js';
import { resolvePayrollPeriod } from '../payroll/PayrollPeriod.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';

const EMPTY_METRICS = Object.freeze({
    days: 0,
    regularHours: 0,
    overtimeHours: 0,
    holidayHours: 0,
    restDayHours: 0,
    restDayFactor: 1.5
});

export function buildEmployeePositionPeriodSnapshot(state, employee, today = new Date()) {
    const settings = getActivePayrollSettings(state);
    const scoped = isProjectsEnabled();
    const scope = captureEntityProjectScope();
    const config = scoped ? peekActivePayrollConfig() : null;
    const period = scoped && !config
        ? { periodStart: '', periodEnd: '', source: 'pending' }
        : resolvePayrollPeriod((config || settings).payPeriod, today);
    const unavailable = { period, settings, metricsByPosition: new Map(), metricsAvailable: false, payrollAvailable: false };
    if (scoped && (!scope.projectId || !config || config.projectId !== scope.projectId)) return unavailable;
    if (!employee?.id) return { period, settings, metricsByPosition: new Map() };

    // A card needs one employee and one period, not a clone of the entire
    // attendance archive. The canonical context still enforces project scope.
    const attendance = {};
    for (const date = new Date(`${period.periodStart}T12:00:00`), end = new Date(`${period.periodEnd}T12:00:00`); date <= end; date.setDate(date.getDate() + 1)) {
        const key = `${employee.id}-${getDateKey(date)}`;
        if (state.attendance?.[key]) attendance[key] = state.attendance[key];
    }
    const ctx = createPayrollProjectContext({ state: {
        employees: [employee], positions: state.positions || [], leaders: state.leaders || [], attendance, settings
    }, scope });
    if (scoped && (!ctx.isScoped || !ctx.employees.length)) return unavailable;
    const payroll = scoped
        ? calculateEmployeePayrollWithContext(ctx, config, employee.id, period.periodStart, period.periodEnd, [], [], [])
        : new PayrollService(state).calculateEmployeePayroll(employee.id, period.periodStart, period.periodEnd, [], [], []);
    const metricsByPosition = new Map();
    const accruedByPosition = new Map();
    const frozenPositions = new Set();
    for (const item of payroll.breakdown || []) {
        const key = String(item.positionId);
        const metrics = metricsByPosition.get(key) || { ...EMPTY_METRICS, restDayFactor: Number(item.restDayFactor) || 1.5 };
        for (const field of ['days', 'regularHours', 'overtimeHours', 'holidayHours', 'restDayHours']) metrics[field] += Number(item[field]) || 0;
        accruedByPosition.set(key, (accruedByPosition.get(key) || 0) + Number(item.subtotal || 0));
        if (item.assignmentSchemaVersion === 1) frozenPositions.add(key);
        metricsByPosition.set(key, metrics);
    }

    // Count dates, not salary buckets: a job may have multiple historical
    // rates/payers or multiple entries on the same date.
    const daysByPosition = new Map();
    for (const key of Object.keys(attendance)) {
        const date = key.slice(-10);
        const record = ctx.getAttendance(employee.id, date);
        if (!record?.present || record.deletedAt != null) continue;
        const ids = record.positionHours?.length ? record.positionHours.map(part => part.positionId || record.selectedPosition || employee.positions?.[0])
            : [record.selectedPosition || employee.positions?.[0]];
        for (const positionId of new Set(ids.filter(value => value != null).map(String))) {
            daysByPosition.set(positionId, (daysByPosition.get(positionId) || 0) + 1);
        }
    }
    for (const [key, metrics] of metricsByPosition) metrics.days = daysByPosition.get(key) || 0;
    for (const key of frozenPositions) metricsByPosition.get(key).frozenAccrued = accruedByPosition.get(key);
    return { period, settings, metricsByPosition };
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

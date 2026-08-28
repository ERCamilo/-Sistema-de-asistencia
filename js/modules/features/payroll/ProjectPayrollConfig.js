/**
 * F1.6-A2 — ProjectPayrollConfig
 * Versioned local payroll configuration per canonical projectId.
 *
 * Minimal fields (direction frozen): regularHoursPerDay, overtimeFactor,
 * holidayFactor, holidays, payPeriod {periodStart, periodLength, payDay},
 * defaultDeductionPercentage, payrollDefaults {version,deductions,bonuses},
 * schemaVersion, updatedAt + projectId.
 * Uses exact field names from legacy settings; no invented fields.
 */

import { normalizeRegularHoursPerDay } from '../../utils/AttendanceHours.js';
import { normalizePayrollDefaults } from './PayrollAdjustments.js';

export const PROJECT_PAYROLL_CONFIG_SCHEMA_VERSION = 1;
export const PROJECT_PAYROLL_CONFIG_STORE = 'projectPayrollConfigs';

function isValidProjectId(id) {
    if (!id || typeof id !== 'string') return false;
    const t = id.trim();
    return !!t && !t.startsWith('legacy-unresolved:');
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeHolidays(arr) {
    if (!Array.isArray(arr)) return [];
    const out = arr
        .filter(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()))
        .map(v => v.trim());
    return [...new Set(out)].sort();
}

function normalizePayPeriod(src) {
    const out = { periodStart: null, periodLength: 21, payDay: null };
    if (!src || typeof src !== 'object') return out;
    if (typeof src.periodStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.periodStart.trim())) {
        out.periodStart = src.periodStart.trim();
    } else if (src.periodStart == null) {
        out.periodStart = null;
    }
    const len = Number(src.periodLength);
    if (Number.isInteger(len) && len >= 1 && len <= 366) out.periodLength = len;
    else if (Number.isFinite(len) && len >= 1 && len <= 366) out.periodLength = Math.round(len);

    if (typeof src.payDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.payDay.trim())) {
        out.payDay = src.payDay.trim();
    } else if (src.payDay == null) {
        out.payDay = null;
    }
    return out;
}

function normalizeOvertimeFactor(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 1;
}

function normalizeHolidayFactor(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 2;
}

function normalizeDefaultDeductionPercentage(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 2;
}

export function validateProjectPayrollConfig(config) {
    if (!config || typeof config !== 'object') throw new TypeError('ProjectPayrollConfig must be an object');
    if (!isValidProjectId(config.projectId)) throw new TypeError('Invalid projectId for payroll config');
    if (!Number.isFinite(Number(config.regularHoursPerDay)) || Number(config.regularHoursPerDay) <= 0) {
        throw new TypeError('Invalid regularHoursPerDay');
    }
    if (!Number.isFinite(Number(config.overtimeFactor))) throw new TypeError('Invalid overtimeFactor');
    if (!Number.isFinite(Number(config.holidayFactor))) throw new TypeError('Invalid holidayFactor');
    if (!Array.isArray(config.holidays)) throw new TypeError('holidays must be an array');
    if (!config.payPeriod || typeof config.payPeriod !== 'object') throw new TypeError('payPeriod required');
    if (!Number.isFinite(Number(config.defaultDeductionPercentage))) throw new TypeError('Invalid defaultDeductionPercentage');
    if (!config.payrollDefaults || typeof config.payrollDefaults !== 'object') throw new TypeError('payrollDefaults required');
    if (config.schemaVersion !== PROJECT_PAYROLL_CONFIG_SCHEMA_VERSION) throw new TypeError('Invalid schemaVersion');
    if (!Number.isFinite(Number(config.updatedAt))) throw new TypeError('Invalid updatedAt');
}

export function createDefaultConfig(projectId, legacySettings = {}) {
    if (!isValidProjectId(projectId)) throw new TypeError('createDefaultConfig requires valid canonical projectId');
    const s = legacySettings && typeof legacySettings === 'object' ? legacySettings : {};
    const payrollDefaults = normalizePayrollDefaults(s);
    return {
        projectId: String(projectId),
        regularHoursPerDay: normalizeRegularHoursPerDay(s.regularHoursPerDay),
        overtimeFactor: normalizeOvertimeFactor(s.overtimeFactor),
        holidayFactor: normalizeHolidayFactor(s.holidayFactor),
        holidays: normalizeHolidays(s.holidays),
        payPeriod: normalizePayPeriod(s.payPeriod),
        defaultDeductionPercentage: normalizeDefaultDeductionPercentage(s.defaultDeductionPercentage),
        payrollDefaults: clone(payrollDefaults),
        schemaVersion: PROJECT_PAYROLL_CONFIG_SCHEMA_VERSION,
        updatedAt: Date.now()
    };
}

export function cloneConfig(config) {
    return clone(config);
}

export function normalizeProjectPayrollConfig(config) {
    if (!config || typeof config !== 'object') throw new TypeError('normalize requires config object');
    const cloned = clone(config);
    cloned.projectId = String(cloned.projectId);
    cloned.regularHoursPerDay = normalizeRegularHoursPerDay(cloned.regularHoursPerDay);
    cloned.overtimeFactor = normalizeOvertimeFactor(cloned.overtimeFactor);
    cloned.holidayFactor = normalizeHolidayFactor(cloned.holidayFactor);
    cloned.holidays = normalizeHolidays(cloned.holidays);
    cloned.payPeriod = normalizePayPeriod(cloned.payPeriod);
    cloned.defaultDeductionPercentage = normalizeDefaultDeductionPercentage(cloned.defaultDeductionPercentage);
    cloned.payrollDefaults = clone(normalizePayrollDefaults({ payrollDefaults: cloned.payrollDefaults }));
    cloned.schemaVersion = PROJECT_PAYROLL_CONFIG_SCHEMA_VERSION;
    cloned.updatedAt = Number.isFinite(Number(cloned.updatedAt)) ? Number(cloned.updatedAt) : Date.now();
    return cloned;
}

export default {
    PROJECT_PAYROLL_CONFIG_SCHEMA_VERSION,
    PROJECT_PAYROLL_CONFIG_STORE,
    isValidProjectId,
    createDefaultConfig,
    cloneConfig,
    normalizeProjectPayrollConfig,
    validateProjectPayrollConfig
};

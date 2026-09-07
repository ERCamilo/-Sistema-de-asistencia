/**
 * F1.6-A1 — PayrollProjectContext
 *
 * Single payroll boundary that captures projectId ONCE before first await
 * and delivers ONLY employees/positions/leaders/attendance/settings of that
 * project to payroll consumers.
 *
 * Contract (Direction frozen):
 * - stable snapshot: freeze captured scope + shallow-cloned collections immediately
 * - flag OFF → exact legacy passthrough (no filtering, original references)
 * - flag ON  → filter by entityInScope(effectiveProjectId === capturedProjectId)
 * - buildAttendanceIndex stays RAW; this module provides scoped getAttendance closure
 * - pure, no IO except FeatureFlags/localStorage via captureEntityProjectScope
 * - must NOT import PayrollService (avoid cycle); imports only EntityProjectScope / FeatureFlags
 */

import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import {
    captureEntityProjectScope,
    entityInScope
} from '../projects/EntityProjectScope.js';

function normalizeScope(explicitScope) {
    if (explicitScope && typeof explicitScope === 'object') {
        return { ...explicitScope };
    }
    return captureEntityProjectScope();
}

function frozenArray(arr) {
    return Object.freeze([...arr]);
}

function frozenMap(obj) {
    return Object.freeze({ ...obj });
}

function deepClone(value) {
    if (value == null || typeof value !== 'object') return value;
    try {
        if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
    } catch (_) {}
    return JSON.parse(JSON.stringify(value));
}

function frozenArrayDeep(arr) {
    const cloned = arr.map(item => {
        const c = deepClone(item);
        if (c && typeof c === 'object') Object.freeze(c);
        return c;
    });
    return Object.freeze(cloned);
}

function frozenAttendanceMap(obj) {
    const cloned = {};
    for (const [k, v] of Object.entries(obj)) {
        const c = deepClone(v);
        if (c && typeof c === 'object') Object.freeze(c);
        cloned[k] = c;
    }
    return Object.freeze(cloned);
}

function frozenSettingsDeep(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const c = deepClone(obj);
    return Object.freeze(c);
}

/**
 * Core factory: synchronously captures scope and freezes collections.
 * Call this BEFORE first await of any payroll operation.
 *
 * @param {object} opts
 * @param {object} opts.state - AppState shape { employees, positions, leaders, attendance, settings, exportConfig }
 * @param {object} [opts.scope] - optional captured scope override for testing/determinism; if omitted reads captureEntityProjectScope()
 */
export function createPayrollProjectContext({ state, scope: explicitScope } = {}) {
    const safeState = state || {};
    const capturedScope = normalizeScope(explicitScope);
    const flagOn = isProjectsEnabled() && capturedScope.enabled === true && !!capturedScope.projectId;

    // Flag OFF — exact legacy passthrough (no filtering, original refs, no freeze)
    if (!flagOn) {
        const rawAttendance = safeState.attendance || {};
        return {
            enabled: false,
            isScoped: false,
            projectId: null,
            scope: { ...capturedScope, enabled: false, projectId: null },
            employees: safeState.employees || [],
            positions: safeState.positions || [],
            leaders: safeState.leaders || [],
            attendance: rawAttendance,
            settings: safeState.settings || null,
            config: safeState.settings || null,
            exportConfig: safeState.exportConfig || null,
            getAttendance: (employeeId, dateKey) => rawAttendance[`${employeeId}-${dateKey}`] ?? undefined,
            getAttendanceMap: () => rawAttendance,
            assertEmployeeInProject: () => {},
            assertNoCross: () => {},
            _rawScope: capturedScope
        };
    }

    // Flag ON — frozen, filtered, scoped
    const scopeSnapshot = Object.freeze({
        enabled: true,
        projectId: String(capturedScope.projectId),
        defaultProjectId: capturedScope.defaultProjectId ?? null
    });

    const rawEmployees = safeState.employees || [];
    const rawPositions = safeState.positions || [];
    const rawLeaders = safeState.leaders || [];
    const rawAttendance = safeState.attendance || {};

    const employees = frozenArrayDeep(rawEmployees.filter(e => entityInScope(e, scopeSnapshot)));
    const positions = frozenArrayDeep(rawPositions.filter(p => entityInScope(p, scopeSnapshot)));
    const leaders = frozenArrayDeep(rawLeaders.filter(l => entityInScope(l, scopeSnapshot)));

    // attendance snapshot deep-frozen at capture — prevents live-reference drift and in-place mutation
    const attendanceSnapshot = frozenAttendanceMap(rawAttendance);
    const settingsSnapshot = safeState.settings ? frozenSettingsDeep(safeState.settings) : safeState.settings;

    // fast membership for asserts / attendance guard
    const employeeIdSet = new Set(employees.map(e => String(e.id)));

    const getAttendance = (employeeId, dateKey) => {
        const key = `${employeeId}-${dateKey}`;
        const rec = attendanceSnapshot[key];
        if (!rec) return undefined;
        // record must belong to captured project (entityInScope handles effectiveProjectId fallback)
        if (!entityInScope(rec, scopeSnapshot)) return undefined;
        // employee must belong to project — prevents cross-employeeId leakage
        if (!employeeIdSet.has(String(employeeId))) return undefined;
        return rec;
    };

    const assertEmployeeInProject = (employeeId) => {
        if (!employeeIdSet.has(String(employeeId))) {
            throw new Error(`Employee "${employeeId}" not in project "${scopeSnapshot.projectId}"`);
        }
    };

    const assertNoCross = (entity) => {
        if (!entityInScope(entity, scopeSnapshot)) {
            const eid = entity?.id ?? entity?.employeeId ?? 'unknown';
            throw new Error(`Cross-project entity "${eid}" not in project "${scopeSnapshot.projectId}"`);
        }
    };

    return {
        enabled: true,
        isScoped: true,
        projectId: scopeSnapshot.projectId,
        scope: scopeSnapshot,
        employees,
        positions,
        leaders,
        attendance: attendanceSnapshot,
        settings: settingsSnapshot,
        config: settingsSnapshot,
        exportConfig: safeState.exportConfig || null,
        getAttendance,
        getAttendanceMap: () => attendanceSnapshot,
        assertEmployeeInProject,
        assertNoCross,
        _rawScope: scopeSnapshot
    };
}

/**
 * Convenience capture that internally calls captureEntityProjectScope()
 * (reads flag + defaultProjectId from localStorage at call instant).
 * Caller must invoke this BEFORE first await.
 */
export function capturePayrollProjectContext(state) {
    const scope = captureEntityProjectScope();
    return createPayrollProjectContext({ state, scope });
}

// Aliases for task spec tolerance
export const capturePayrollContext = capturePayrollProjectContext;
export const createPayrollContext = createPayrollProjectContext;

export default {
    createPayrollProjectContext,
    capturePayrollProjectContext,
    capturePayrollContext,
    createPayrollContext
};

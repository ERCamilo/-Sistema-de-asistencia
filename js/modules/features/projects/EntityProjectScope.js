import { isProjectsEnabled } from '../../config/FeatureFlags.js';

export const DEFAULT_PROJECT_LS_KEY = 'asistencia_default_project_id';
const EMPTY_SCOPE = Object.freeze({ enabled: false, projectId: null, defaultProjectId: null });
let resolvedScope = { ...EMPTY_SCOPE };

function readDefaultProjectId() {
    try {
        return localStorage.getItem(DEFAULT_PROJECT_LS_KEY);
    } catch (_) {
        return null;
    }
}

export function replaceEntityScope(scope = EMPTY_SCOPE) {
    resolvedScope = { ...scope };
    if (scope?.defaultProjectId && typeof scope.defaultProjectId === 'string') {
        try {
            localStorage.setItem(DEFAULT_PROJECT_LS_KEY, scope.defaultProjectId);
        } catch (_) {}
    }
    return { ...resolvedScope };
}

export function resetEntityScope() {
    resolvedScope = { ...EMPTY_SCOPE };
    return { ...resolvedScope };
}

export function peekEntityScope() {
    return { ...resolvedScope };
}

/** Captura flag + default actuales para una operación completa de persistencia. */
export function captureEntityProjectScope() {
    if (!isProjectsEnabled()) return { ...EMPTY_SCOPE };
    return {
        ...resolvedScope,
        enabled: true,
        defaultProjectId: readDefaultProjectId() ?? null
    };
}

export function effectiveProjectId(entity, scope = resolvedScope) {
    const defaultPid = scope && Object.prototype.hasOwnProperty.call(scope, 'defaultProjectId')
        ? scope.defaultProjectId
        : (readDefaultProjectId() ?? null);
    return entity?.projectId ?? defaultPid ?? null;
}

export function entityInScope(entity, scope = resolvedScope) {
    if (!scope?.enabled || !scope?.projectId) return true;
    return effectiveProjectId(entity, scope) === scope.projectId;
}

export function sameEffectiveProject(a, b, scope = resolvedScope) {
    if (!scope?.enabled) return true;
    return effectiveProjectId(a, scope) === effectiveProjectId(b, scope);
}

export function getScopedPositions(state, scope = resolvedScope) {
    const positions = state?.positions || [];
    if (!scope?.enabled || !scope?.projectId) {
        return positions;
    }
    return positions.filter(p => entityInScope(p, scope));
}

export function getScopedLeaders(state, scope = resolvedScope) {
    const leaders = state?.leaders || [];
    if (!scope?.enabled || !scope?.projectId) {
        return leaders;
    }
    return leaders.filter(l => entityInScope(l, scope));
}

export function getScopedEmployees(state, scope = resolvedScope) {
    const employees = state?.employees || [];
    if (!scope?.enabled || !scope?.projectId) {
        return employees;
    }
    return employees.filter(e => entityInScope(e, scope));
}

export function getScopedSidebarCounters(state, scope = resolvedScope) {
    const employees = state?.employees || [];
    const isScoped = scope?.enabled && scope?.projectId;
    const scopedEmployees = isScoped
        ? employees.filter(e => entityInScope(e, scope))
        : employees;
    const activeEmployees = scopedEmployees.filter(e => e.active !== false).length;
    let activeLoans = 0;
    try {
        scopedEmployees.forEach(e => {
            (e.loans || []).forEach(l => {
                if (l && l.status === 'active') activeLoans++;
            });
        });
    } catch (_) {
        activeLoans = 0;
    }
    return {
        activeEmployees,
        activeLoans
    };
}

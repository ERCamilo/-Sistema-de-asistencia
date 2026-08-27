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
        defaultProjectId: readDefaultProjectId()
    };
}

export function effectiveProjectId(entity, scope = resolvedScope) {
    return entity?.projectId ?? scope.defaultProjectId ?? null;
}

export function entityInScope(entity, scope = resolvedScope) {
    if (!scope.enabled || !scope.projectId) return true;
    return effectiveProjectId(entity, scope) === scope.projectId;
}

export function sameEffectiveProject(a, b, scope = resolvedScope) {
    if (!scope?.enabled) return true;
    return effectiveProjectId(a, scope) === effectiveProjectId(b, scope);
}

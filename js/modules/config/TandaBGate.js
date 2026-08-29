/**
 * F1.6-A6 - Tanda B Gate
 * When projects are enabled (flag ON), all Tanda B economic operations must
 * fail explicitly and safely BEFORE any mutation, IDB write, or external call.
 * Flag OFF preserves legacy behavior without gate.
 */
import { isProjectsEnabled } from './FeatureFlags.js';

export class ProjectScopedGateError extends Error {
    constructor(context = 'Tanda B operation') {
        super(`Tanda B blocked: ${context} unavailable while projects are enabled`);
        this.name = 'ProjectScopedGateError';
        this.code = 'TANDA_B_BLOCKED_WHEN_SCOPED';
    }
}

export function assertTandaBBlockedWhenScoped(context = 'Tanda B operation') {
    if (isProjectsEnabled()) {
        throw new ProjectScopedGateError(context);
    }
}

export function isTandaBBlocked() {
    return isProjectsEnabled();
}

export default { ProjectScopedGateError, assertTandaBBlockedWhenScoped, isTandaBBlocked };

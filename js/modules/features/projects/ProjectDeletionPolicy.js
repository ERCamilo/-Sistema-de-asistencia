/**
 * Two distinct waiting periods for Multiobra deletion requests.
 * A closed/archived work counts as paused from its closedAt.
 * This policy NEVER authorizes deleting employee, loan or payroll data.
 *
 * Dates are local-clock estimates: final irreversible deletion must also
 * verify server time, cloud references and a restorable backup.
 */
export const PROJECT_DELETION_WAIT_MS = 30 * 24 * 60 * 60 * 1000;

export function projectDeletionPolicy(project, now = Date.now()) {
    const base = { canRequest: false, canFinalizeEmpty: false, canCancel: false };
    if (!project || project.deletedAt != null || !Number.isFinite(now)) {
        return { ...base, stage: 'invalid' };
    }
    if (!['closed', 'archived'].includes(project.status)) {
        return { ...base, stage: 'active' };
    }
    if (!Number.isFinite(project.closedAt) || project.closedAt > now) {
        return { ...base, stage: 'invalid' };
    }

    const eligibleAt = project.closedAt + PROJECT_DELETION_WAIT_MS;
    const requestedAt = project.deletionRequestedAt;
    if (requestedAt != null) {
        // A corrupted or prematurely created request cannot shorten the wait.
        if (!Number.isFinite(requestedAt) || requestedAt < eligibleAt || requestedAt > now) {
            return { ...base, stage: 'invalid', eligibleAt };
        }
        const finalizeAt = requestedAt + PROJECT_DELETION_WAIT_MS;
        return {
            ...base,
            stage: now >= finalizeAt ? 'ready-for-review' : 'grace-period',
            eligibleAt, requestedAt, finalizeAt, canCancel: true,
            canFinalizeEmpty: now >= finalizeAt,
            remainingDays: Math.max(0, Math.ceil((finalizeAt - now) / 86400000))
        };
    }
    return {
        ...base, eligibleAt,
        stage: now >= eligibleAt ? 'eligible-to-request' : 'paused-wait',
        canRequest: now >= eligibleAt,
        remainingDays: Math.max(0, Math.ceil((eligibleAt - now) / 86400000))
    };
}

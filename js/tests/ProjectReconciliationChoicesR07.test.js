/**
 * R07 A1 — ProjectReconciliationChoicesR07
 *
 * Resolution-planning contract:
 * - LEGACY_UNSCOPED + exactly one valid project => deterministic assignment.
 * - LEGACY_UNSCOPED + zero valid projects => requires project creation.
 * - LEGACY_UNSCOPED + multiple valid projects => explicit user choice.
 * - EXPLICIT_ORPHAN => explicit choice (map-to-existing / create-new-project /
 *   resolve-later); never auto-applied.
 * - PENDING stays pending until explicit resolution.
 */
import {
    CLASSIFICATION,
    RESOLUTION_KIND,
    planResolution
} from '../modules/features/projects/ProjectOwnershipReconciliation.js';

const P1 = { id: 'PRJ-solo-0001', name: 'Obra Unica', status: 'active' };
const P2 = { id: 'PRJ-dos-0002', name: 'Obra Dos', status: 'active' };

describe('ProjectReconciliationChoicesR07', () => {
    test('LEGACY_UNSCOPED with exactly one valid project proposes deterministic assignment', () => {
        const plan = planResolution({ status: CLASSIFICATION.LEGACY_UNSCOPED, validProjects: [P1] });
        expect(plan.kind).toBe(RESOLUTION_KIND.ASSIGN_TO_SINGLE_VALID);
        expect(plan.ok).toBe(true);
        expect(plan.assignableProjectId).toBe(P1.id);
        expect(plan.requiresUserChoice).toBe(false);
        expect(plan.requiresProjectCreation).toBe(false);
    });

    test('LEGACY_UNSCOPED with zero valid projects requires creating a real project first', () => {
        const plan = planResolution({ status: CLASSIFICATION.LEGACY_UNSCOPED, validProjects: [] });
        expect(plan.kind).toBe(RESOLUTION_KIND.REQUIRES_PROJECT_CREATION);
        expect(plan.ok).toBe(false);
        expect(plan.requiresProjectCreation).toBe(true);
        expect(plan.assignableProjectId).toBeNull();
    });

    test('LEGACY_UNSCOPED with multiple valid projects requires explicit user choice', () => {
        const plan = planResolution({ status: CLASSIFICATION.LEGACY_UNSCOPED, validProjects: [P1, P2] });
        expect(plan.kind).toBe(RESOLUTION_KIND.REQUIRES_USER_CHOICE);
        expect(plan.ok).toBe(false);
        expect(plan.requiresUserChoice).toBe(true);
        expect(plan.assignableProjectId).toBeNull();
    });

    test('LEGACY_UNSCOPED can map to an explicitly selected valid project when multiple exist', () => {
        const plan = planResolution({
            status: CLASSIFICATION.LEGACY_UNSCOPED,
            validProjects: [P1, P2],
            requestedChoice: 'map-to-existing',
            requestedProjectId: P2.id
        });
        expect(plan.kind).toBe(RESOLUTION_KIND.ASSIGN_SELECTED_VALID);
        expect(plan.ok).toBe(true);
        expect(plan.assignableProjectId).toBe(P2.id);

        const invalid = planResolution({
            status: CLASSIFICATION.LEGACY_UNSCOPED,
            validProjects: [P1, P2],
            requestedChoice: 'map-to-existing',
            requestedProjectId: 'PRJ-ghost-9999'
        });
        expect(invalid.ok).toBe(false);
        expect(invalid.assignableProjectId).toBeNull();
    });

    test('EXPLICIT_ORPHAN without choice is never auto-applied', () => {
        const plan = planResolution({
            status: CLASSIFICATION.EXPLICIT_ORPHAN,
            validProjects: [P1],
            orphanProjectId: 'PRJ-ghost-0009'
        });
        expect(plan.kind).toBe(RESOLUTION_KIND.REQUIRES_USER_CHOICE);
        expect(plan.ok).toBe(false);
        expect(plan.assignableProjectId).toBeNull();
        expect(plan.requiresUserChoice).toBe(true);
        expect(plan.allowedChoices).toEqual(['map-to-existing', 'create-new-project', 'resolve-later']);
    });

    test('EXPLICIT_ORPHAN map-to-existing uses one deterministic target or an explicitly selected target', () => {
        const withOne = planResolution({
            status: CLASSIFICATION.EXPLICIT_ORPHAN,
            validProjects: [P1],
            orphanProjectId: 'PRJ-ghost-0009',
            requestedChoice: 'map-to-existing'
        });
        expect(withOne.ok).toBe(true);
        expect(withOne.kind).toBe(RESOLUTION_KIND.ASSIGN_SELECTED_VALID);
        expect(withOne.assignableProjectId).toBe(P1.id);
        expect(withOne.chosenChoice).toBe('map-to-existing');
        // Post-choice normalization: a resolved assignment never asks again.
        expect(withOne.requiresUserChoice).toBe(false);

        const missingSelection = planResolution({
            status: CLASSIFICATION.EXPLICIT_ORPHAN,
            validProjects: [P1, P2],
            orphanProjectId: 'PRJ-ghost-0009',
            requestedChoice: 'map-to-existing'
        });
        expect(missingSelection.ok).toBe(false);
        expect(missingSelection.assignableProjectId).toBeNull();
        expect(missingSelection.requiresUserChoice).toBe(true);

        const selected = planResolution({
            status: CLASSIFICATION.EXPLICIT_ORPHAN,
            validProjects: [P1, P2],
            orphanProjectId: 'PRJ-ghost-0009',
            requestedChoice: 'map-to-existing',
            requestedProjectId: P2.id
        });
        expect(selected.kind).toBe(RESOLUTION_KIND.ASSIGN_SELECTED_VALID);
        expect(selected.ok).toBe(true);
        expect(selected.assignableProjectId).toBe(P2.id);
        expect(selected.requiresUserChoice).toBe(false);

        const invalidSelection = planResolution({
            status: CLASSIFICATION.EXPLICIT_ORPHAN,
            validProjects: [P1, P2],
            orphanProjectId: 'PRJ-ghost-0009',
            requestedChoice: 'map-to-existing',
            requestedProjectId: 'legacy-unresolved:num:34'
        });
        expect(invalidSelection.ok).toBe(false);
        expect(invalidSelection.assignableProjectId).toBeNull();
    });

    test('EXPLICIT_ORPHAN create-new-project and resolve-later are accepted without assignment', () => {
        const create = planResolution({
            status: CLASSIFICATION.EXPLICIT_ORPHAN,
            validProjects: [],
            orphanProjectId: 'PRJ-ghost-0009',
            requestedChoice: 'create-new-project'
        });
        expect(create.ok).toBe(true);
        // Post-choice normalization: explicit creation leaves orphan via a
        // dedicated creation pathway, not via another user-choice round.
        expect(create.kind).toBe(RESOLUTION_KIND.REQUIRES_PROJECT_CREATION);
        expect(create.requiresProjectCreation).toBe(true);
        expect(create.requiresUserChoice).toBe(false);
        expect(create.assignableProjectId).toBeNull();
        expect(create.chosenChoice).toBe('create-new-project');

        const later = planResolution({
            status: CLASSIFICATION.EXPLICIT_ORPHAN,
            validProjects: [P1],
            orphanProjectId: 'PRJ-ghost-0009',
            requestedChoice: 'resolve-later'
        });
        expect(later.ok).toBe(true);
        // Post-choice normalization: an explicit deferral stays pending but
        // acknowledged — it no longer asks for another choice.
        expect(later.kind).toBe(RESOLUTION_KIND.STAYS_PENDING);
        expect(later.requiresUserChoice).toBe(false);
        expect(later.assignableProjectId).toBeNull();
        expect(later.requiresProjectCreation).toBe(false);
        expect(later.chosenChoice).toBe('resolve-later');
    });

    test('EXPLICIT_ORPHAN rejects an unknown choice (fail closed)', () => {
        const plan = planResolution({
            status: CLASSIFICATION.EXPLICIT_ORPHAN,
            validProjects: [P1],
            requestedChoice: 'auto-map-to-default'
        });
        expect(plan.ok).toBe(false);
        expect(plan.assignableProjectId).toBeNull();
    });

    test('PENDING stays pending until explicit resolution — even with one valid project', () => {
        const plan = planResolution({ status: CLASSIFICATION.PENDING, validProjects: [P1] });
        expect(plan.kind).toBe(RESOLUTION_KIND.STAYS_PENDING);
        expect(plan.ok).toBe(false);
        expect(plan.assignableProjectId).toBeNull();
        expect(plan.requiresUserChoice).toBe(true);
    });

    test('VALID requires no resolution', () => {
        const plan = planResolution({ status: CLASSIFICATION.VALID, validProjects: [P1] });
        expect(plan.kind).toBe(RESOLUTION_KIND.NO_ACTION);
        expect(plan.kind).not.toBe(RESOLUTION_KIND.STAYS_PENDING);
        expect(plan.ok).toBe(true);
        expect(plan.assignableProjectId).toBeNull();
        expect(plan.requiresUserChoice).toBe(false);
    });

    test('R07-hardening: requestedTargetProjectId resolves map-to-existing when multiple valid exist (never implicit)', () => {
        // LEGACY_UNSCOPED + multiple: only an explicit real catalog target resolves.
        const legacyResolved = planResolution({
            status: CLASSIFICATION.LEGACY_UNSCOPED,
            validProjects: [P1, P2],
            requestedChoice: 'map-to-existing',
            requestedTargetProjectId: P2.id
        });
        expect(legacyResolved.kind).toBe(RESOLUTION_KIND.ASSIGN_SELECTED_VALID);
        expect(legacyResolved.ok).toBe(true);
        expect(legacyResolved.assignableProjectId).toBe(P2.id);

        const legacyMissing = planResolution({
            status: CLASSIFICATION.LEGACY_UNSCOPED,
            validProjects: [P1, P2],
            requestedChoice: 'map-to-existing'
        });
        expect(legacyMissing.ok).toBe(false);
        expect(legacyMissing.assignableProjectId).toBeNull();

        const legacyGhost = planResolution({
            status: CLASSIFICATION.LEGACY_UNSCOPED,
            validProjects: [P1, P2],
            requestedChoice: 'map-to-existing',
            requestedTargetProjectId: 'PRJ-ghost-9999'
        });
        expect(legacyGhost.ok).toBe(false);
        expect(legacyGhost.assignableProjectId).toBeNull();

        // EXPLICIT_ORPHAN + multiple: same rule via the same param.
        const orphanResolved = planResolution({
            status: CLASSIFICATION.EXPLICIT_ORPHAN,
            validProjects: [P1, P2],
            orphanProjectId: 'PRJ-ghost-0009',
            requestedChoice: 'map-to-existing',
            requestedTargetProjectId: P1.id
        });
        expect(orphanResolved.kind).toBe(RESOLUTION_KIND.ASSIGN_SELECTED_VALID);
        expect(orphanResolved.ok).toBe(true);
        expect(orphanResolved.assignableProjectId).toBe(P1.id);
        expect(orphanResolved.requiresUserChoice).toBe(false);

        const orphanSentinel = planResolution({
            status: CLASSIFICATION.EXPLICIT_ORPHAN,
            validProjects: [P1, P2],
            orphanProjectId: 'PRJ-ghost-0009',
            requestedChoice: 'map-to-existing',
            requestedTargetProjectId: 'legacy-unresolved:num:34'
        });
        expect(orphanSentinel.ok).toBe(false);
        expect(orphanSentinel.assignableProjectId).toBeNull();
    });

    test('R07-hardening: sentinel catalog entries never count as valid targets', () => {
        const withSentinel = planResolution({
            status: CLASSIFICATION.LEGACY_UNSCOPED,
            validProjects: [{ id: 'legacy-unresolved:num:1' }, P1]
        });
        // Only one REAL valid project remains: deterministic single assignment to P1.
        expect(withSentinel.kind).toBe(RESOLUTION_KIND.ASSIGN_TO_SINGLE_VALID);
        expect(withSentinel.assignableProjectId).toBe(P1.id);

        const onlySentinel = planResolution({
            status: CLASSIFICATION.LEGACY_UNSCOPED,
            validProjects: [{ id: 'legacy-unresolved:num:1' }]
        });
        expect(onlySentinel.kind).toBe(RESOLUTION_KIND.REQUIRES_PROJECT_CREATION);
        expect(onlySentinel.assignableProjectId).toBeNull();
    });

    test('R07-hardening: planResolution honors enabled:false as disabled no-op', () => {
        const plan = planResolution({ status: CLASSIFICATION.EXPLICIT_ORPHAN, validProjects: [P1, P2], enabled: false });
        expect(plan.kind).toBe(RESOLUTION_KIND.NO_ACTION);
        expect(plan.disabled).toBe(true);
        expect(plan.enabled).toBe(false);
        expect(plan.requiresUserChoice).toBe(false);
        expect(plan.requiresProjectCreation).toBe(false);
        expect(plan.assignableProjectId).toBeNull();
    });
});

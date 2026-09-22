/**
 * R07 A1 — ProjectOrphanQuarantineR07
 *
 * Quarantine contract: reuses the existing `legacy-unresolved:` sentinel
 * semantics (RecordKey namespace) — no second sentinel system. Records
 * carrying a `legacy-unresolved:*` projectId classify as PENDING and stay
 * pending until explicit resolution; the helper is deterministic and
 * idempotent.
 */
import {
    CLASSIFICATION,
    RESOLUTION_KIND,
    LEGACY_UNRESOLVED_PREFIX,
    isQuarantineProjectId,
    makeQuarantineProjectId,
    isExplicitProjectId,
    classifyOwnership,
    analyzeProjectOwnership,
    planResolution,
    planEmployeeProjectReassignment
} from '../modules/features/projects/ProjectOwnershipReconciliation.js';
import { dedupKeyForRecord } from '../modules/services/RecordKey.js';

const VALID_PROJECT = 'PRJ-valid-0001';
const SCOPE_ON = { enabled: true, projectId: VALID_PROJECT, defaultProjectId: VALID_PROJECT };

describe('ProjectOrphanQuarantineR07', () => {
    test('makeQuarantineProjectId produces the existing legacy-unresolved: namespace', () => {
        expect(makeQuarantineProjectId('num:12')).toBe('legacy-unresolved:num:12');
        expect(makeQuarantineProjectId('id:emp-1')).toBe('legacy-unresolved:id:emp-1');
    });

    test('makeQuarantineProjectId is deterministic and idempotent', () => {
        const first = makeQuarantineProjectId('num:34');
        expect(makeQuarantineProjectId('num:34')).toBe(first);
        expect(makeQuarantineProjectId(first)).toBe(first);
    });

    test('makeQuarantineProjectId returns null for empty keys', () => {
        expect(makeQuarantineProjectId('')).toBeNull();
        expect(makeQuarantineProjectId('   ')).toBeNull();
        expect(makeQuarantineProjectId(null)).toBeNull();
    });

    test('isQuarantineProjectId recognizes the sentinel and rejects explicit ids', () => {
        expect(isQuarantineProjectId('legacy-unresolved:num:12')).toBe(true);
        expect(isQuarantineProjectId('  legacy-unresolved:num:12 ')).toBe(true);
        expect(isQuarantineProjectId(VALID_PROJECT)).toBe(false);
        expect(isQuarantineProjectId('')).toBe(false);
        expect(isQuarantineProjectId(null)).toBe(false);
    });

    test('quarantine ids share the RecordKey dedup namespace (no second sentinel system)', () => {
        const legacyRecord = { id: 'emp-legacy-q1', number: '12' };
        const key = dedupKeyForRecord(legacyRecord, { enabled: false, projectId: null, defaultProjectId: null });
        // dedupKey without scope is bare; with unresolved scope it is prefixed
        const quarantineKey = dedupKeyForRecord(legacyRecord, {
            enabled: true, projectId: VALID_PROJECT, defaultProjectId: null
        });
        expect(quarantineKey).toBe(`${LEGACY_UNRESOLVED_PREFIX}num:12`);
        expect(makeQuarantineProjectId(key)).toBe(`legacy-unresolved:${key}`);
        // the same prefix the RecordKey module emits for unresolved ownership
        expect(quarantineKey.startsWith(LEGACY_UNRESOLVED_PREFIX)).toBe(true);
    });

    test('records with legacy-unresolved:* projectId classify as PENDING', () => {
        const record = { id: 'emp-q1', number: '50', name: 'Cuarentena', projectId: 'legacy-unresolved:num:50' };
        const c = classifyOwnership(record, [{ id: VALID_PROJECT, status: 'active' }]);
        expect(c.status).toBe(CLASSIFICATION.PENDING);
        expect(c.effectiveProjectId).toBe('legacy-unresolved:num:50');
    });

    test('PENDING is not treated as VALID even if a sentinel-named catalog entry existed', () => {
        // The catalog validity rule itself excludes sentinels (same as stores)
        expect(isExplicitProjectId('legacy-unresolved:num:50')).toBe(false);
        const record = { id: 'emp-q2', number: '51', projectId: 'legacy-unresolved:num:51' };
        const c = classifyOwnership(record, [{ id: 'legacy-unresolved:num:51', status: 'active' }]);
        expect(c.status).toBe(CLASSIFICATION.PENDING);
    });

    test('analyze groups pending records under their quarantine id for UI phase B', () => {
        const state = {
            employees: [
                { id: 'emp-q3', number: '52', name: 'Q3', projectId: 'legacy-unresolved:num:52' },
                { id: 'emp-ok', number: '53', name: 'Ok', projectId: VALID_PROJECT }
            ],
            positions: [],
            leaders: [],
            attendance: {}
        };
        const result = analyzeProjectOwnership(state, [{ id: VALID_PROJECT, status: 'active' }]);
        expect(result.summary.counts[CLASSIFICATION.PENDING]).toBe(1);
        expect(result.summary.counts[CLASSIFICATION.VALID]).toBe(1);
        expect(result.summary.totalRecords).toBe(2);
        expect(result.summary.issueCount).toBe(1);
        expect(Object.keys(result.summary.pendingByQuarantineId)).toEqual(['legacy-unresolved:num:52']);
        expect(result.summary.pendingByQuarantineId['legacy-unresolved:num:52'][0].record.id).toBe('emp-q3');
    });

    test('OFF mode: quarantine helpers remain pure and classification is not forced', () => {
        expect(makeQuarantineProjectId('num:9')).toBe('legacy-unresolved:num:9');
        const c = classifyOwnership(
            { id: 'emp-x', projectId: 'legacy-unresolved:num:9' },
            [],
            { enabled: false }
        );
        expect(c.status).toBe('DISABLED');
    });

    test('R07-hardening: PENDING with no choice stays pending (never implicit)', () => {
        const single = planResolution({ status: CLASSIFICATION.PENDING, validProjects: [{ id: VALID_PROJECT }] });
        expect(single.kind).toBe(RESOLUTION_KIND.STAYS_PENDING);
        expect(single.ok).toBe(false);
        expect(single.assignableProjectId).toBeNull();
        expect(single.requiresUserChoice).toBe(true);

        const multi = planResolution({
            status: CLASSIFICATION.PENDING,
            validProjects: [{ id: VALID_PROJECT }, { id: 'PRJ-second-0002' }]
        });
        expect(multi.kind).toBe(RESOLUTION_KIND.STAYS_PENDING);
        expect(multi.ok).toBe(false);
        expect(multi.assignableProjectId).toBeNull();
    });

    test('R07-hardening: PENDING explicit map-to-existing resolves only with a real catalog target', () => {
        const P2 = 'PRJ-second-0002';
        // Explicit valid target via preferred param resolves.
        const resolved = planResolution({
            status: CLASSIFICATION.PENDING,
            validProjects: [{ id: VALID_PROJECT }, { id: P2 }],
            requestedChoice: 'map-to-existing',
            requestedTargetProjectId: P2
        });
        expect(resolved.kind).toBe(RESOLUTION_KIND.ASSIGN_SELECTED_VALID);
        expect(resolved.ok).toBe(true);
        expect(resolved.assignableProjectId).toBe(P2);
        // Post-choice normalization: a resolved assignment never asks again.
        expect(resolved.requiresUserChoice).toBe(false);

        // Legacy alias still honored.
        const viaAlias = planResolution({
            status: CLASSIFICATION.PENDING,
            validProjects: [{ id: VALID_PROJECT }, { id: P2 }],
            requestedChoice: 'map-to-existing',
            requestedProjectId: VALID_PROJECT
        });
        expect(viaAlias.ok).toBe(true);
        expect(viaAlias.assignableProjectId).toBe(VALID_PROJECT);
        expect(viaAlias.requiresUserChoice).toBe(false);

        // Multiple valid but no target: stays unresolvable, never picks implicitly.
        const missing = planResolution({
            status: CLASSIFICATION.PENDING,
            validProjects: [{ id: VALID_PROJECT }, { id: P2 }],
            requestedChoice: 'map-to-existing'
        });
        expect(missing.ok).toBe(false);
        expect(missing.assignableProjectId).toBeNull();
        expect(missing.requiresUserChoice).toBe(true);

        // Ghost/sentinel targets fail closed.
        for (const bad of ['PRJ-ghost-9999', 'legacy-unresolved:num:52', '  ']) {
            const invalid = planResolution({
                status: CLASSIFICATION.PENDING,
                validProjects: [{ id: VALID_PROJECT }, { id: P2 }],
                requestedChoice: 'map-to-existing',
                requestedTargetProjectId: bad.trim() ? bad : 'PRJ-ghost-9999'
            });
            expect(invalid.ok).toBe(false);
            expect(invalid.assignableProjectId).toBeNull();
        }
    });

    test('R07-hardening: PENDING single-valid + explicit map choice resolves deterministically', () => {
        const plan = planResolution({
            status: CLASSIFICATION.PENDING,
            validProjects: [{ id: VALID_PROJECT }],
            requestedChoice: 'map-to-existing'
        });
        expect(plan.kind).toBe(RESOLUTION_KIND.ASSIGN_SELECTED_VALID);
        expect(plan.ok).toBe(true);
        expect(plan.assignableProjectId).toBe(VALID_PROJECT);
        expect(plan.requiresUserChoice).toBe(false);
    });

    test('R07-hardening: PENDING explicit create-new-project / resolve-later leave quarantine via safe pathways', () => {
        const create = planResolution({
            status: CLASSIFICATION.PENDING,
            validProjects: [{ id: VALID_PROJECT }],
            requestedChoice: 'create-new-project'
        });
        expect(create.ok).toBe(true);
        expect(create.kind).toBe(RESOLUTION_KIND.REQUIRES_PROJECT_CREATION);
        expect(create.requiresProjectCreation).toBe(true);
        expect(create.requiresUserChoice).toBe(false);
        expect(create.assignableProjectId).toBeNull();

        const later = planResolution({
            status: CLASSIFICATION.PENDING,
            validProjects: [{ id: VALID_PROJECT }],
            requestedChoice: 'resolve-later'
        });
        expect(later.ok).toBe(true);
        expect(later.kind).toBe(RESOLUTION_KIND.STAYS_PENDING);
        expect(later.requiresUserChoice).toBe(false);
        expect(later.assignableProjectId).toBeNull();

        const invalid = planResolution({
            status: CLASSIFICATION.PENDING,
            validProjects: [{ id: VALID_PROJECT }],
            requestedChoice: 'auto-map-to-default'
        });
        expect(invalid.ok).toBe(false);
        expect(invalid.assignableProjectId).toBeNull();
    });

    test('R07-hardening: PENDING analyze payloads are copies (mutating them never touches inputs)', () => {
        const state = {
            employees: [{ id: 'emp-q-mut', number: '60', projectId: 'legacy-unresolved:num:60', name: 'Orig' }],
            positions: [],
            leaders: [],
            attendance: {}
        };
        const before = JSON.stringify(state);
        const result = analyzeProjectOwnership(state, [{ id: VALID_PROJECT, status: 'active' }]);
        expect(result.summary.counts[CLASSIFICATION.PENDING]).toBe(1);
        result.issues[0].record.name = 'TAMPERED';
        expect(JSON.stringify(state)).toBe(before);
    });

    test('R07 Direction: reassignment never rewrites attendance already owned by a valid catalog project', () => {
        const VALID_A = 'PRJ-valid-history-a';
        const TARGET = 'PRJ-valid-history-b';
        const emp = { id: 'emp-hist', number: '70', projectId: 'PRJ-missing' };
        const att = {
            'emp-hist-2026-09-18': {
                key: 'emp-hist-2026-09-18',
                employeeId: 'emp-hist',
                date: '2026-09-18',
                present: true,
                projectId: VALID_A
            }
        };
        const plan = planEmployeeProjectReassignment({
            employee: emp,
            attendance: att,
            targetProjectId: TARGET,
            catalog: [{ id: VALID_A, status: 'active' }, { id: TARGET, status: 'active' }]
        });
        expect(plan.ok).toBe(true);
        expect(plan.employee.projectId).toBe(TARGET);
        // Valid history stays in its original project (byte-stable).
        expect(plan.attendanceRecords[0].record.projectId).toBe(VALID_A);
    });
});

/**
 * R07 A1 — ProjectNoAutoOrphanMappingR07
 *
 * Contract: an EXPLICIT_ORPHAN (explicit non-sentinel projectId absent from
 * the catalog) is NEVER equivalent to LEGACY_UNSCOPED and is NEVER silently
 * mapped to the active/default project. Known historical employees
 * (34 Andres Sanchez emp-1789749741792, 405 Lano Borno emp-1789586033810,
 * explicit PRJ-mu1p73r3-iu8a) are VALID when the project exists and
 * EXPLICIT_ORPHAN when it does not — never auto-mapped either way.
 */
import {
    CLASSIFICATION,
    RESOLUTION_KIND,
    classifyOwnership,
    analyzeProjectOwnership,
    planResolution
} from '../modules/features/projects/ProjectOwnershipReconciliation.js';

const HISTORIC_PROJECT = 'PRJ-mu1p73r3-iu8a';
const EMP_34 = { id: 'emp-1789749741792', number: '34', name: 'Andres Sanchez', projectId: HISTORIC_PROJECT, loans: [] };
const EMP_405 = { id: 'emp-1789586033810', number: '405', name: 'Lano Borno', projectId: HISTORIC_PROJECT, loans: [] };

const OTHER_PROJECT = 'PRJ-other-0001';

describe('ProjectNoAutoOrphanMappingR07', () => {
    test('historical employees are VALID when the referenced project exists in catalog', () => {
        const catalog = [{ id: HISTORIC_PROJECT, name: 'Obra Historica', status: 'active' }];
        for (const emp of [EMP_34, EMP_405]) {
            const c = classifyOwnership(emp, catalog);
            expect(c.status).toBe(CLASSIFICATION.VALID);
            expect(c.effectiveProjectId).toBe(HISTORIC_PROJECT);
            expect(c.effectiveProjectId).not.toBe(OTHER_PROJECT);
        }
    });

    test('historical employees are EXPLICIT_ORPHAN when the referenced project is absent — never mapped to default', () => {
        const catalog = [{ id: OTHER_PROJECT, name: 'Otra Obra', status: 'active' }];
        const defaultProjectId = OTHER_PROJECT;
        for (const emp of [EMP_34, EMP_405]) {
            const c = classifyOwnership(emp, catalog, { defaultProjectId });
            expect(c.status).toBe(CLASSIFICATION.EXPLICIT_ORPHAN);
            expect(c.effectiveProjectId).toBe(HISTORIC_PROJECT);
            expect(c.effectiveProjectId).not.toBe(defaultProjectId);
        }
    });

    test('EXPLICIT_ORPHAN and LEGACY_UNSCOPED are distinct classifications', () => {
        const catalog = [{ id: OTHER_PROJECT, status: 'active' }];
        const orphan = classifyOwnership(EMP_34, catalog);
        const unscoped = classifyOwnership({ id: 'emp-legacy-1', number: '7', name: 'Legacy' }, catalog);
        expect(orphan.status).toBe(CLASSIFICATION.EXPLICIT_ORPHAN);
        expect(unscoped.status).toBe(CLASSIFICATION.LEGACY_UNSCOPED);
        expect(orphan.status).not.toBe(unscoped.status);
        expect(orphan.projectId ?? orphan.explicitProjectId).toBe(HISTORIC_PROJECT);
    });

    test('analyze scan never proposes default/active mapping for orphan records', () => {
        const state = {
            employees: [
                EMP_34,
                EMP_405,
                { id: 'emp-legacy-9', number: '9', name: 'Legacy Nueve' },
                { id: 'emp-valid-10', number: '10', name: 'Valido', projectId: OTHER_PROJECT }
            ],
            positions: [],
            leaders: [],
            attendance: {}
        };
        const catalog = [{ id: OTHER_PROJECT, status: 'active' }];
        const result = analyzeProjectOwnership(state, catalog, { defaultProjectId: OTHER_PROJECT });

        const orphanIssues = result.issues.filter(i => i.status === CLASSIFICATION.EXPLICIT_ORPHAN);
        expect(orphanIssues.map(i => i.record.id).sort()).toEqual([EMP_34.id, EMP_405.id].sort());
        // grouping by missing referenced projectId, not by default
        expect(Object.keys(result.summary.orphansByProjectId)).toEqual([HISTORIC_PROJECT]);
        // legacy unscoped reported separately
        expect(result.summary.counts[CLASSIFICATION.LEGACY_UNSCOPED]).toBe(1);
        expect(result.summary.counts[CLASSIFICATION.EXPLICIT_ORPHAN]).toBe(2);
        expect(result.summary.counts[CLASSIFICATION.VALID]).toBe(1);
        expect(result.summary.totalRecords).toBe(4);
        expect(result.summary.issueCount).toBe(3);
    });

    test('planResolution for EXPLICIT_ORPHAN never returns an implicit assignment without a choice', () => {
        const catalog = [{ id: OTHER_PROJECT, status: 'active' }];
        const plan = planResolution({
            status: CLASSIFICATION.EXPLICIT_ORPHAN,
            validProjects: catalog,
            orphanProjectId: HISTORIC_PROJECT
        });
        expect(plan.assignableProjectId).toBeNull();
        expect(plan.requiresUserChoice).toBe(true);
    });

    test('OFF mode: classification passthrough does not force R07 status', () => {
        const c = classifyOwnership(EMP_34, [], { enabled: false });
        expect(c.status).toBe('DISABLED');
        const scan = analyzeProjectOwnership({ employees: [EMP_34] }, [], { enabled: false });
        expect(scan.enabled).toBe(false);
        expect(scan.issues).toEqual([]);
    });

    test('R07-hardening: catalog sentinel ids are excluded (legacy-unresolved never valid)', () => {
        // A catalog entry named like a quarantine id must not make anything VALID.
        const catalog = [{ id: 'legacy-unresolved:num:50', status: 'active' }, { id: OTHER_PROJECT, status: 'active' }];
        const pending = classifyOwnership({ id: 'emp-q', number: '50', projectId: 'legacy-unresolved:num:50' }, catalog);
        expect(pending.status).toBe(CLASSIFICATION.PENDING);
        // Sentinel catalog entry is ignored: an explicit orphan stays orphan, never VALID via sentinel.
        const orphan = classifyOwnership({ id: 'emp-o', number: '60', projectId: HISTORIC_PROJECT }, catalog);
        expect(orphan.status).toBe(CLASSIFICATION.EXPLICIT_ORPHAN);
        // And a record pointing at the sentinel is PENDING even though the catalog "contains" that string.
        const scan = analyzeProjectOwnership(
            { employees: [{ id: 'emp-q', number: '50', projectId: 'legacy-unresolved:num:50' }], positions: [], leaders: [], attendance: {} },
            [{ id: 'legacy-unresolved:num:50', status: 'active' }]
        );
        expect(scan.summary.counts[CLASSIFICATION.PENDING]).toBe(1);
        expect(scan.summary.counts[CLASSIFICATION.VALID]).toBe(0);
    });

    test('R07-hardening: summary.counts describes ALL scanned records (36 valid + 2 pending)', () => {
        const employees = [];
        for (let i = 0; i < 36; i++) {
            employees.push({ id: `emp-valid-${i}`, number: `${100 + i}`, projectId: OTHER_PROJECT });
        }
        employees.push({ id: 'emp-q1', number: '900', projectId: 'legacy-unresolved:num:900' });
        employees.push({ id: 'emp-q2', number: '901', projectId: 'legacy-unresolved:num:901' });
        const result = analyzeProjectOwnership(
            { employees, positions: [], leaders: [], attendance: {} },
            [{ id: OTHER_PROJECT, status: 'active' }]
        );
        expect(result.summary.totalRecords).toBe(38);
        expect(result.summary.counts[CLASSIFICATION.VALID]).toBe(36);
        expect(result.summary.counts[CLASSIFICATION.PENDING]).toBe(2);
        expect(result.summary.issueCount).toBe(2);
        // issues stay unresolved-only: no VALID payloads leak into issues.
        expect(result.issues.every(i => i.status !== CLASSIFICATION.VALID)).toBe(true);
        expect(result.issues).toHaveLength(2);
    });

    test('R07-hardening: returned record payloads are copies — mutating them never touches input state', () => {
        const state = {
            employees: [{ id: 'emp-mut-1', number: '70', projectId: HISTORIC_PROJECT, name: 'Orig' }],
            positions: [],
            leaders: [],
            attendance: {}
        };
        const before = JSON.stringify(state);
        const result = analyzeProjectOwnership(state, [{ id: OTHER_PROJECT, status: 'active' }]);
        expect(result.issues).toHaveLength(1);
        // Mutate the returned payload every way a UI could.
        result.issues[0].record.name = 'TAMPERED';
        result.issues[0].record.projectId = 'PRJ-TAMPERED';
        result.summary.orphansByProjectId[HISTORIC_PROJECT][0].record.name = 'TAMPERED-2';
        expect(JSON.stringify(state)).toBe(before);
        expect(state.employees[0].name).toBe('Orig');
        expect(state.employees[0].projectId).toBe(HISTORIC_PROJECT);
    });

    test('R07-hardening: VALID resolution is NO_ACTION (never STAYS_PENDING)', () => {
        const plan = planResolution({ status: CLASSIFICATION.VALID, validProjects: [{ id: OTHER_PROJECT }] });
        expect(plan.kind).toBe(RESOLUTION_KIND.NO_ACTION);
        expect(plan.kind).not.toBe('STAYS_PENDING');
        expect(plan.ok).toBe(true);
        expect(plan.assignableProjectId).toBeNull();
        expect(plan.requiresUserChoice).toBe(false);
    });

    test('R07-hardening: planResolution honors enabled:false as disabled no-op', () => {
        const plan = planResolution({ status: CLASSIFICATION.EXPLICIT_ORPHAN, validProjects: [{ id: OTHER_PROJECT }], enabled: false });
        expect(plan.kind).toBe(RESOLUTION_KIND.NO_ACTION);
        expect(plan.disabled).toBe(true);
        expect(plan.enabled).toBe(false);
        expect(plan.assignableProjectId).toBeNull();
        expect(plan.requiresUserChoice).toBe(false);
        expect(plan.requiresProjectCreation).toBe(false);
        expect(plan.allowedChoices).toEqual([]);
    });
});

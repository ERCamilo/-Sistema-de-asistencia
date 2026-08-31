import fs from 'fs';
import path from 'path';

const REPO = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosureRepository.js'),
    'utf8'
);
const STORE = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosureStore.js'),
    'utf8'
);
const SYNC = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosureSync.js'),
    'utf8'
);
const RULES = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8');
const INDEXES = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../firestore.indexes.json'), 'utf8')
);
const CLOSURE = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosure.js'),
    'utf8'
);
const APP = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const CONTRACT = fs.readFileSync(
    path.resolve(__dirname, '../../docs/fase-1/F1.6-B3-contract.md'),
    'utf8'
);

describe('B3.0 contract audit — no behavior change', () => {
    test('repository keeps global OFF queries and defines a gated scoped query path', () => {
        expect(REPO).toContain("where('status'");
        expect(REPO).toContain("where('periodStart'");
        expect(REPO).toContain("where('periodEnd'");
        expect(REPO).toContain("where('projectId', '==', capturedPid)");
        expect(REPO).toContain('assertTandaBBlockedWhenScoped');
    });

    test('loadById retains its gate and now validates scoped ownership before returning detail', () => {
        expect(REPO).toMatch(/async loadById\(id\)/);
        expect(REPO).toContain('loadByIdScoped');
        expect(REPO).toContain('isScopedClosure');
        expect(REPO).toContain('promoteLegacyCloudClosure');
        expect(SYNC).toContain('pullDetail');
        expect(SYNC).toContain('remoteRepository.loadById');
        expect(SYNC).toContain('localStore.save(closure)');
    });

    test('closureSummary still lacks project metadata — LiveSync remains dormant until B3.5', () => {
        const summary = REPO.match(/function closureSummary[\s\S]*?return \{[\s\S]*?\n\}/)?.[0] || '';
        expect(summary).not.toContain('projectId');
        expect(summary).not.toContain('identityKind');
        expect(summary).not.toContain('ownershipToken');
        expect(REPO).toContain('closureSummary');
    });

    test('firestore.rules wildcard still covers payrollClosures — must be excluded in B3.4', () => {
        expect(RULES).toMatch(/match \/users\/\{userId\}\/\{document=\*\*\}/);
        expect(RULES).not.toMatch(/payrollClosures/);
    });

    test('OFF legacy path remains global — no projectId index required when flag off', () => {
        expect(STORE).toContain('if (!isProjectsEnabled())');
        expect(STORE).toMatch(/getByPeriod[\s\S]*?periodKey/);
        // Store global listPage uses statusClosedAtId without projectId
        expect(STORE).toMatch(/statusClosedAtId/);
        expect(CLOSURE).toContain('LEGACY_PAYROLL_CLOSURE_SCHEMA_VERSION = 2');
        expect(CLOSURE).toContain('PAYROLL_CLOSURE_SCHEMA_VERSION = 3');
    });

    test('LiveSync is dormant — app never autostarts recent subscription', () => {
        expect(APP).not.toContain('PayrollClosureLiveSync.start(');
        expect(APP).not.toContain('payrollClosureSync.subscribeRecent');
        // Summary items fed to live path also lack projectId so gating impossible today
        expect(SYNC).toContain('subscribeRecent');
        expect(SYNC).toContain('importClosures');
    });

    test('firestore indexes: only legacy status+closedAt+__name__, projectId composites not yet added', () => {
        const fields = INDEXES.indexes[0]?.fields || [];
        expect(fields).toEqual(expect.arrayContaining([
            { fieldPath: 'status', order: 'ASCENDING' },
            { fieldPath: 'closedAt', order: 'DESCENDING' },
            { fieldPath: '__name__', order: 'DESCENDING' }
        ]));
        const hasProjectIdIndex = INDEXES.indexes.some(idx =>
            (idx.fields || []).some(f => f.fieldPath === 'projectId')
        );
        expect(hasProjectIdIndex).toBe(false);
    });

    test('capture-before-await / stale completion contract exists in store', () => {
        expect(STORE).toContain('function captureScopedProjectId()');
        expect(STORE).toContain('function ensureNotStale(');
        expect(STORE).toContain('function ownsClosure(');
        expect(STORE).toContain('captureScopedProjectId()');
        expect(STORE).toContain('ensureNotStale(pid)');
        expect(STORE).toContain('PAYROLL_CLOSURE_STALE_READ');
    });

    test('transition rules: schema2->promoted-legacy allowed, schema3->schema2 and owner change forbidden', () => {
        expect(CLOSURE).toContain('function promoteLegacyPayrollClosure');
        expect(CLOSURE).toContain("PROMOTED_LEGACY: 'promoted-legacy'");
        expect(CLOSURE).toContain('No se puede cambiar el projectId de un cierre promovido');
        expect(CLOSURE).toContain('Sólo se puede promover un cierre histórico schema 2 válido');
        expect(CLOSURE).toContain('La pertenencia del cierre de Nómina no es válida');
    });
});

describe('B3.1 truth-table freeze — doc-only hardening (no Rules enforcement yet)', () => {
    test('contract freezes explicit 8-row truth table as doc, not as Rules code', () => {
        expect(CONTRACT).toContain('truth table frozen in B3.1');
        expect(CONTRACT).toContain('4.1 Firestore Rules truth table');
        expect(CONTRACT).toContain('create — schema2 legacy');
        expect(CONTRACT).toContain('create — schema3');
        expect(CONTRACT).toContain('schema2 → promoted-legacy');
        expect(CONTRACT).toContain('schema3 → schema2');
        expect(CONTRACT).toContain('schema3 owner change');
        expect(CONTRACT).toContain('closed → voided');
        expect(CONTRACT).toContain('voided → closed');
        expect(CONTRACT).toContain('wildcard bypass');
        // Still doc-only: firestore.rules itself remains unhardened in B3.1
        expect(RULES).toMatch(/match \/users\/\{userId\}\/\{document=\*\*\}/);
        expect(RULES).not.toMatch(/payrollClosures/);
    });

    test('create rows: schema2 allowed preserving OFF, schema3 requires canonical projectId', () => {
        expect(CONTRACT).toMatch(/create — schema2 legacy[\s\S]*?ALLOW[\s\S]*?Preserve OFF contract/);
        expect(CONTRACT).toMatch(/create — schema3[\s\S]*?ALLOW only if canonical/);
        expect(CONTRACT).toMatch(/canonical valid/);
        // Current Rules have not yet enforced canonical check — B3.1 is doc-only
        expect(RULES).not.toMatch(/canonicalProjectId|isValidProjectId/);
    });

    test('promotion vs downgrade: schema2→promoted-legacy preserves identity, schema3→schema2 rejected, owner immutable', () => {
        expect(CONTRACT).toMatch(/schema2 → promoted-legacy[\s\S]*?preserves `id`\/`fingerprint`/);
        expect(CONTRACT).toMatch(/schema3 → schema2[\s\S]*?REJECT[\s\S]*?Downgrade never allowed/);
        expect(CONTRACT).toMatch(/schema3 owner change[\s\S]*?REJECT[\s\S]*?Owner immutable/);
        expect(CONTRACT).toContain('request.resource.data.projectId == resource.data.projectId');
    });

    test('tautology replaced: doc explains proper validation instead of self-comparison', () => {
        expect(CONTRACT).toContain('NOT tautology');
        expect(CONTRACT).toContain('request.resource.data.projectId == resource.data.projectId');
        expect(CONTRACT).toMatch(/isValidProjectId|canonicalProjectId/);
        // Old tautology must not appear as the sole validation description
        expect(CONTRACT).not.toMatch(/with `projectId==request\.resource\.data\.projectId` \/ ownership checks/);
    });

    test('status transitions: closed→voided allowed, voided→closed rejected', () => {
        expect(CONTRACT).toMatch(/closed → voided[\s\S]*?ALLOW/);
        expect(CONTRACT).toMatch(/voided → closed[\s\S]*?REJECT[\s\S]*?Irreversible void/);
    });

    test('wildcard must not grant alternative allow to payrollClosures — restructure required', () => {
        expect(CONTRACT).toMatch(/wildcard bypass[\s\S]*?MUST NOT/);
        expect(CONTRACT).toMatch(/exclude `payrollClosures`|restructured so `payrollClosures` has its own/);
        // Current code still has the bypass — B3.1 documents but does not fix it
        expect(RULES).toMatch(/\{document=\*\*\}/);
    });

    test('closureSummary frozen target: projectId, identityKind, ownershipToken must survive for B3.5', () => {
        expect(CONTRACT).toContain('closureSummary frozen target');
        expect(CONTRACT).toContain('at minimum `projectId`, `identityKind`, `ownershipToken`');
        expect(CONTRACT).toMatch(/Current code \*\*omits them as found in B3\.0 audit/);
        // Current implementation still omits them — B3.1 is doc-only, test stays green
        const summary = REPO.match(/function closureSummary[\s\S]*?return \{[\s\S]*?\n\}/)?.[0] || '';
        expect(summary).not.toContain('projectId');
        expect(summary).not.toContain('identityKind');
        expect(summary).not.toContain('ownershipToken');
    });

    test('ON/OFF matrix and B3.0 freezes remain intact in B3.1', () => {
        expect(CONTRACT).toContain('ON/OFF matrix');
        expect(CONTRACT).toContain('Schema variants:');
        expect(CONTRACT).toContain('Legacy discovery strategy');
        expect(CONTRACT).toContain('Transition rules');
        expect(CONTRACT).toContain('B3.1-B3.5');
    });
});

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
        expect(REPO).not.toContain('assertTandaBBlockedWhenScoped');
    });

    test('loadById validates scoped ownership before returning detail', () => {
        expect(REPO).toMatch(/async loadById\(id,/);
        expect(REPO).toContain('loadByIdScoped');
        expect(REPO).toContain('isScopedClosure');
        expect(REPO).toContain('promoteLegacyCloudClosure');
        expect(SYNC).toContain('pullDetail');
        expect(SYNC).toContain('remoteRepository.loadById');
        expect(SYNC).toContain('localStore.importRemote(closure');
    });

    test('B3.4 Unit 3 releases only protected Repository entrypoints', () => {
        const publicRepo = REPO.slice(REPO.indexOf('export const PayrollClosureRepository'));
        const methodSource = (name, nextName) => {
            const start = publicRepo.indexOf(`async ${name}`);
            const end = publicRepo.indexOf(`async ${nextName}`, start);
            return publicRepo.slice(start, end < 0 ? undefined : end);
        };
        for (const method of ['saveOne', 'loadPage', 'loadById', 'loadByPeriod']) {
            expect(methodSource(method, method === 'loadByPeriod' ? 'subscribeRecent' : {
                saveOne: 'loadPage',
                loadPage: 'loadById',
                loadById: 'loadByPeriod'
            }[method])).not.toContain(`PayrollClosureRepository.${method}`);
        }
        const subscription = publicRepo.slice(publicRepo.indexOf('subscribeRecent'));
        expect(subscription).not.toContain('PayrollClosureRepository.subscribeRecent');
        expect(CLOSURE).toContain('validatePayrollClosureForScopedWrite');
        expect(SYNC).toContain("assertTandaBBlockedWhenScoped('PayrollClosureSync.record')");
        for (const method of ['pullPage', 'pullDetail', 'pullPeriod', 'importClosures', 'subscribeRecent']) {
            expect(SYNC).not.toContain(`PayrollClosureSync.${method}`);
        }
        expect(STORE).toContain('async importRemote');
    });

    test('closureSummary carries scoped identity metadata while LiveSync remains dormant', () => {
        const summary = REPO.match(/function closureSummary[\s\S]*?return \{[\s\S]*?\n\}/)?.[0] || '';
        expect(summary).toContain('projectId');
        expect(summary).toContain('identityKind');
        expect(summary).toContain('ownershipToken');
        expect(REPO).toContain('closureSummary');
        expect(REPO).toContain('validatePayrollClosureSummaryForScopedRead');
        expect(APP).toContain('PayrollClosureLiveSync.start(');
        expect(APP).toContain('projectContext.subscribe');
    });

    test('firestore.rules gives payrollClosures a separate non-overlapping match', () => {
        expect(RULES).not.toMatch(/match \/users\/\{userId\}\/\{document=\*\*\}/);
        expect(RULES).toMatch(/match \/users\/\{userId\}\/payrollClosures\/\{closureId\}/);
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
        expect(APP).toContain('PayrollClosureLiveSync.start(');
        expect(APP).toContain('PayrollClosureLiveSync.stop(');
        expect(APP).toContain('isProjectsEnabled');
        expect(APP).toContain('captureScopedScope');
        expect(APP).toContain('projectContext.subscribe');
        expect(SYNC).toContain('subscribeRecent');
        expect(SYNC).toContain('importClosures');
    });

    test('firestore indexes preserve legacy and contain the four scoped composites', () => {
        expect(INDEXES.indexes).toHaveLength(5);
        const shapes = INDEXES.indexes.map(index => (index.fields || [])
            .map(field => `${field.fieldPath}:${field.order}`).join('|'));
        expect(shapes).toEqual(expect.arrayContaining([
            'projectId:ASCENDING|closedAt:DESCENDING|__name__:DESCENDING',
            'projectId:ASCENDING|status:ASCENDING|closedAt:DESCENDING|__name__:DESCENDING',
            'schemaVersion:ASCENDING|closedAt:DESCENDING|__name__:DESCENDING',
            'schemaVersion:ASCENDING|status:ASCENDING|closedAt:DESCENDING|__name__:DESCENDING',
            'status:ASCENDING|closedAt:DESCENDING|__name__:DESCENDING'
        ]));
        expect(JSON.stringify(INDEXES)).not.toContain('periodStart');
        expect(JSON.stringify(INDEXES)).not.toContain('periodEnd');
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

describe('B3.4 Unit 1 truth-table enforcement — Rules boundary only', () => {
    test('contract freezes the explicit 8-row truth table and Rules enforce its server-visible parts', () => {
        expect(CONTRACT).toContain('B3.1 freeze');
        expect(CONTRACT).toContain('4.1 Firestore Rules truth table');
        expect(CONTRACT).toContain('create — schema2 legacy');
        expect(CONTRACT).toContain('create — schema3');
        expect(CONTRACT).toContain('schema2 → promoted-legacy');
        expect(CONTRACT).toContain('schema3 → schema2');
        expect(CONTRACT).toContain('schema3 owner change');
        expect(CONTRACT).toContain('closed → voided');
        expect(CONTRACT).toContain('voided → closed');
        expect(CONTRACT).toContain('wildcard bypass');
        expect(RULES).not.toMatch(/match \/users\/\{userId\}\/\{document=\*\*\}/);
        expect(RULES).toContain('match /users/{userId}/payrollClosures/{closureId}');
    });

    test('create rows: schema2 allowed preserving OFF, schema3 requires canonical projectId', () => {
        expect(CONTRACT).toMatch(/create — schema2 legacy[\s\S]*?ALLOW[\s\S]*?Preserve OFF contract/);
        expect(CONTRACT).toMatch(/create — schema3[\s\S]*?ALLOW only if canonical-shaped/);
        expect(CONTRACT).toMatch(/canonical-shaped/);
        expect(RULES).toContain('isCanonicalProjectId');
    });

    test('promotion vs downgrade: schema2→promoted-legacy preserves identity, schema3→schema2 rejected, owner immutable', () => {
        expect(CONTRACT).toMatch(/schema2 → promoted-legacy[\s\S]*?preserves identity\/payload fields/);
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
        expect(RULES).not.toMatch(/match \/users\/\{userId\}\/\{document=\*\*\}/);
        expect(RULES).toContain('match /users/{userId}/payrollClosures/{closureId}');
    });

    test('B3.5 Unit 1 implements the frozen closureSummary target', () => {
        expect(CONTRACT).toContain('closureSummary frozen target');
        expect(CONTRACT).toContain('at minimum `projectId`, `identityKind`, and `ownershipToken`');
        expect(CONTRACT).toContain('validatePayrollClosureSummaryForScopedRead()');
        expect(CONTRACT).toContain('It deliberately does not inspect rows or totals');
        const summary = REPO.match(/function closureSummary[\s\S]*?return \{[\s\S]*?\n\}/)?.[0] || '';
        expect(summary).toContain('projectId');
        expect(summary).toContain('identityKind');
        expect(summary).toContain('ownershipToken');
    });

    test('B3.5 Unit 2 is frozen separately while Unit 3 is closed', () => {
        expect(CONTRACT).toContain('B3.4 Units 1-3');
        expect(CONTRACT).toContain('B3.4 complete boundary');
        expect(CONTRACT).toContain('B3.5 Unit 1 validated summaries');
        expect(CONTRACT).toContain('B3.5 Unit 2 — protected remote admission');
        expect(CONTRACT).toContain('B3.5 Unit 3 is closed');
        expect(CONTRACT).toContain('Unit 3 removes the Repository saveOne/loadPage/loadByPeriod/loadById gates');
        expect(CONTRACT).toContain('LiveSync lifecycle — closed');
    });

    test('ON/OFF matrix and B3.0 freezes remain intact in B3.4 Unit 1', () => {
        expect(CONTRACT).toContain('ON/OFF matrix');
        expect(CONTRACT).toContain('Schema variants:');
        expect(CONTRACT).toContain('Legacy discovery strategy');
        expect(CONTRACT).toContain('Transition rules');
        expect(CONTRACT).toContain('B3.1 -> B3.5');
    });
});

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

describe('B3.0 contract audit — no behavior change', () => {
    test('repository queries are currently global (no projectId filter) — B3.3 will scope', () => {
        expect(REPO).toContain("where('status'");
        expect(REPO).toContain("where('periodStart'");
        expect(REPO).toContain("where('periodEnd'");
        expect(REPO).not.toMatch(/where\(\s*['"]projectId['"]/);
    });

    test('loadById is direct document access without owner check — leaks B->A via pullDetail', () => {
        expect(REPO).toMatch(/async loadById\(id\)/);
        const loadByIdBlock = REPO.slice(REPO.indexOf('async loadById'));
        expect(loadByIdBlock).not.toMatch(/projectId/);
        expect(loadByIdBlock).not.toMatch(/ownsClosure|captureScopedProjectId|ensureNotStale/);
        expect(SYNC).toContain('pullDetail');
        expect(SYNC).toContain('remoteRepository.loadById');
        expect(SYNC).toContain('localStore.save(closure)');
    });

    test('closureSummary lacks projectId/identityKind/ownershipToken — LiveSync dormant until B3.5', () => {
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

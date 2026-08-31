import fs from 'fs';
import path from 'path';

const REPO = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosureRepository.js'),
    'utf8'
);
const SYNC = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosureSync.js'),
    'utf8'
);
const CLOSURE = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosure.js'),
    'utf8'
);
const INDEXES_RAW = fs.readFileSync(path.resolve(__dirname, '../../firestore.indexes.json'), 'utf8');
const INDEXES = JSON.parse(INDEXES_RAW);
const CONTRACT = fs.readFileSync(
    path.resolve(__dirname, '../../docs/fase-1/F1.6-B3-contract.md'),
    'utf8'
);
const RULES = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8');

describe('B3.2 preflight — provisional index & Rules verifiability', () => {
    test('scoped loadByPeriod adds project equality and remains equality-only — no period composite required', () => {
        expect(REPO).toContain("where('periodStart'");
        expect(REPO).toContain("where('periodEnd'");
        expect(REPO).toContain("where('projectId', '==', capturedPid)");
        const loadByPeriodBlock = REPO.slice(REPO.indexOf('async function loadByPeriodScoped'));
        expect(loadByPeriodBlock).not.toMatch(/orderBy\(/);
    });

    test('firestore.indexes.json has the four scoped composites plus the legacy index', () => {
        expect(INDEXES.indexes).toHaveLength(5);
        expect(INDEXES.indexes.every(index =>
            index.collectionGroup === 'payrollClosures' && index.queryScope === 'COLLECTION'
        )).toBe(true);
        const shapes = INDEXES.indexes.map(index => (index.fields || [])
            .map(field => `${field.fieldPath}:${field.order}`).join('|'));
        expect(shapes).toEqual(expect.arrayContaining([
            'projectId:ASCENDING|closedAt:DESCENDING|__name__:DESCENDING',
            'projectId:ASCENDING|status:ASCENDING|closedAt:DESCENDING|__name__:DESCENDING',
            'schemaVersion:ASCENDING|closedAt:DESCENDING|__name__:DESCENDING',
            'schemaVersion:ASCENDING|status:ASCENDING|closedAt:DESCENDING|__name__:DESCENDING',
            'status:ASCENDING|closedAt:DESCENDING|__name__:DESCENDING'
        ]));
        // Provisional period index absent — raw JSON must not invent it "just in case"
        expect(INDEXES_RAW).not.toContain('periodStart');
        expect(INDEXES_RAW).not.toContain('periodEnd');
    });

    test('emulator does not reliably enforce composite-index FAILED_PRECONDITION — provisional decision documented', () => {
        // Contract must explain why no FAILED_PRECONDITION repro exists in this harness
        expect(CONTRACT).toContain('B3.2 preflight');
        expect(CONTRACT).toContain('does not track composite indexes');
        expect(CONTRACT).toContain('FAILED_PRECONDITION');
        expect(CONTRACT).toContain('not reliably reproducible');
        // Provisional index explicitly kept out, only added after real repro
        expect(CONTRACT).toMatch(/provisional.*NOT added|provisional.*absent/i);
        expect(CONTRACT).toContain('projectId+periodStart+periodEnd');
        expect(CONTRACT).toContain('provisional and absent from `firestore.indexes.json`');
    });

    test('contract preserves Rules verifiability nuance for B3.4 — flag not server-visible, token only if expressible', () => {
        expect(CONTRACT).toContain('Rules cannot know client-only feature flag');
        // Same for 11.3 phrasing variants
        expect(CONTRACT).toMatch(/Rules cannot (know|read) client.*flag/i);
        expect(CONTRACT).toContain('create schema2 OFF');
        expect(CONTRACT).toContain('server-visible signal');
        expect(CONTRACT).toContain('defaultCanonical/ownershipToken');
        expect(CONTRACT).toMatch(/only.*Firestore-expressible|only if.*verifiable/i);
        expect(CONTRACT).toContain('stableToken');
        // B3.4 Unit 1 now applies the preserved Rules boundary without changing indexes.
        expect(RULES).not.toMatch(/match \/users\/\{userId\}\/\{document=\*\*\}/);
        expect(RULES).toContain('match /users/{userId}/payrollClosures/{closureId}');
    });

    test('contract states scoped pagination indexes are B3.4 (not B3.2) and equality-only period index needs no composite', () => {
        expect(CONTRACT).toMatch(/three equality filters, no range, no `orderBy`/);
        expect(CONTRACT).toMatch(/merge.*single-field indexes|re-use existing indexes/i);
        expect(CONTRACT).toContain('projectId ASC, closedAt DESC');
        expect(CONTRACT).toContain('projectId ASC, status ASC, closedAt DESC');
        expect(CONTRACT).toMatch(/B3\.4 Unit 2.*indexes/i);
    });

    test('B3.4 Unit 3 releases protected Repository methods but keeps Sync blocked', () => {
        expect(REPO).toContain('if (isProjectsEnabled()) return loadByPeriodScoped');
        expect(REPO).toContain('assertTandaBBlockedWhenScoped');
        expect(REPO).toContain('validatePayrollClosureForScopedWrite');
        for (const method of ['saveOne', 'loadPage', 'loadById', 'loadByPeriod']) {
            const start = REPO.indexOf(`async ${method}`);
            const next = method === 'loadByPeriod' ? 'subscribeRecent' : {
                saveOne: 'loadPage', loadPage: 'loadById', loadById: 'loadByPeriod'
            }[method];
            const end = REPO.indexOf(`async ${next}`, start);
            expect(REPO.slice(start, end < 0 ? undefined : end))
                .not.toContain(`PayrollClosureRepository.${method}`);
        }
        expect(REPO.slice(REPO.indexOf('subscribeRecent(onChange')))
            .toContain('PayrollClosureRepository.subscribeRecent');
        expect(CLOSURE).toContain('validatePayrollClosureForScopedWrite');
        expect(SYNC).toContain('assertTandaBBlockedWhenScoped');
        expect(SYNC).toContain('PayrollClosureSync.subscribeRecent');
    });
});

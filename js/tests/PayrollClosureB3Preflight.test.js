import fs from 'fs';
import path from 'path';

const REPO = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosureRepository.js'),
    'utf8'
);
const INDEXES_RAW = fs.readFileSync(path.resolve(__dirname, '../../firestore.indexes.json'), 'utf8');
const INDEXES = JSON.parse(INDEXES_RAW);
const CONTRACT = fs.readFileSync(
    path.resolve(__dirname, '../../docs/fase-1/F1.6-B3-contract.md'),
    'utf8'
);
const RULES = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8');

describe('B3.2 preflight — provisional index & Rules verifiability (no productive change)', () => {
    test('loadByPeriod is still equality-only (periodStart== + periodEnd==, no orderBy) — no composite required', () => {
        expect(REPO).toContain("where('periodStart'");
        expect(REPO).toContain("where('periodEnd'");
        // No projectId filter yet (B3.3 will add), no orderBy in loadByPeriod
        const loadByPeriodBlock = REPO.slice(REPO.indexOf('async loadByPeriod'));
        expect(loadByPeriodBlock).not.toMatch(/where\(\s*['"]projectId['"]/);
        expect(loadByPeriodBlock).not.toMatch(/orderBy\(/);
    });

    test('firestore.indexes.json stays legacy-only — no projectId composite added speculatively in B3.2', () => {
        expect(INDEXES.indexes).toHaveLength(1);
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
        // Provisional period index absent — raw JSON must not invent it "just in case"
        expect(INDEXES_RAW).not.toContain('periodStart');
        expect(INDEXES_RAW).not.toContain('periodEnd');
        expect(INDEXES_RAW).not.toContain('projectId');
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
        expect(CONTRACT).toContain('provisional, absent from `firestore.indexes.json`');
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
        // Rules still untouched in B3.2 — wildcard bypass remains, no payrollClosures hardening yet
        expect(RULES).toMatch(/match \/users\/\{userId\}\/\{document=\*\*\}/);
        expect(RULES).not.toMatch(/payrollClosures/);
    });

    test('contract states scoped pagination indexes are B3.4 (not B3.2) and equality-only period index needs no composite', () => {
        expect(CONTRACT).toMatch(/three equality filters, no range, no `orderBy`/);
        expect(CONTRACT).toMatch(/merge.*single-field indexes|re-use existing indexes/i);
        expect(CONTRACT).toContain('projectId ASC, closedAt DESC');
        expect(CONTRACT).toContain('projectId ASC, status ASC, closedAt DESC');
        expect(CONTRACT).toMatch(/B3\.4.*pagination|pagination.*B3\.4/i);
    });

    test('no production query code added in B3.2 — repo still global, no projectId where', () => {
        expect(REPO).not.toMatch(/where\(\s*['"]projectId['"]/);
    });
});

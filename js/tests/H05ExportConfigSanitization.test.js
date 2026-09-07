import fs from 'fs';
import path from 'path';
import { sanitizeExportConfig } from 'actual/services/ExportConfigSanitizer.js';

// ─────────────────────────────────────────────────────────────────────────────
// Behavioral unit tests for the central helper
// ─────────────────────────────────────────────────────────────────────────────
describe('H-05 ExportConfigSanitizer helper', () => {
    test('sanitizeExportConfig deletes only exportConfig and preserves durable config', () => {
        const clone = {
            exportConfig: { periodStart: '2026-01-01', foo: 'bar', payrollLoanSelection: [] },
            settings: { payrollDefaults: { regularHoursPerDay: 8 }, companyName: 'Acme' },
            projectPayrollConfigs: [{ projectId: 'PRJ-A', regularHoursPerDay: 6 }],
            employees: [{ id: 'e1' }]
        };
        const out = sanitizeExportConfig({ ...clone });
        expect(out.exportConfig).toBeUndefined();
        expect(out.settings.payrollDefaults.regularHoursPerDay).toBe(8);
        expect(out.projectPayrollConfigs[0].projectId).toBe('PRJ-A');
        expect(out.employees[0].id).toBe('e1');
    });

    test('legacy payload containing exportConfig{foo} is loaded without foo surviving (ingress)', () => {
        const incoming = { settings: { companyName: 'Acme', payrollDefaults: { x: 1 } }, exportConfig: { foo: 'legacy', periodStart: '2020-01-01' } };
        const clone = JSON.parse(JSON.stringify(incoming));
        sanitizeExportConfig(clone);
        expect(clone.exportConfig).toBeUndefined();
        expect(clone.settings.payrollDefaults).toBeDefined();
        // foo must not survive under any key
        expect(JSON.stringify(clone).includes('foo')).toBe(false);
    });

    test('round-trip does not resurrect old exportConfig', () => {
        const egress = { exportConfig: { periodStart: '2026-01-01', payrollPreviewInclusion: { loans: true } }, settings: { payrollDefaults: { a: 1 } } };
        const egressClone = JSON.parse(JSON.stringify(egress));
        sanitizeExportConfig(egressClone);
        // Simulate persist then ingress of legacy data that still had exportConfig
        const legacyIngress = { exportConfig: { periodStart: '2026-01-01', foo: 'old' }, settings: egressClone.settings };
        sanitizeExportConfig(legacyIngress);
        expect(legacyIngress.exportConfig).toBeUndefined();
        expect(legacyIngress.settings.payrollDefaults.a).toBe(1);
    });

    test('OFF does not alter durable config unexpectedly', () => {
        const state = { settings: { payrollDefaults: { regularHoursPerDay: 6 }, payPeriod: { periodStart: null } }, exportConfig: { periodStart: 'x' } };
        const before = JSON.stringify(state.settings);
        sanitizeExportConfig(state);
        expect(JSON.stringify(state.settings)).toBe(before);
        expect(state.exportConfig).toBeUndefined();
    });

    test('null/undefined/non-object is no-op', () => {
        expect(sanitizeExportConfig(null)).toBeNull();
        expect(sanitizeExportConfig(undefined)).toBeUndefined();
        expect(sanitizeExportConfig(42)).toBe(42);
    });

    test('A→B→A sanitization preservation: durable config survives multiple sanitizations', () => {
        const configA = { projectId: 'A', regularHoursPerDay: 6, payrollDefaults: { regularHoursPerDay: 6 } };
        const configB = { projectId: 'B', regularHoursPerDay: 8, payrollDefaults: { regularHoursPerDay: 8 } };
        // Simulate egress for A
        const cloneA = { exportConfig: { periodStart: 'A' }, settings: { payrollDefaults: configA.payrollDefaults }, projectPayrollConfigs: [configA] };
        sanitizeExportConfig(cloneA);
        expect(cloneA.settings.payrollDefaults.regularHoursPerDay).toBe(6);
        // Simulate egress for B
        const cloneB = { exportConfig: { periodStart: 'B' }, settings: { payrollDefaults: configB.payrollDefaults }, projectPayrollConfigs: [configB] };
        sanitizeExportConfig(cloneB);
        expect(cloneB.settings.payrollDefaults.regularHoursPerDay).toBe(8);
        // Back to A should still have its durable config
        const backA = { exportConfig: { foo: 'oldA' }, settings: { payrollDefaults: configA.payrollDefaults }, projectPayrollConfigs: [configA] };
        sanitizeExportConfig(backA);
        expect(backA.settings.payrollDefaults.regularHoursPerDay).toBe(6);
        expect(backA.exportConfig).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Frontier wiring: every egress/ingress imports and calls sanitizeExportConfig
// ─────────────────────────────────────────────────────────────────────────────
describe('H-05 frontier wiring (egress/ingress symmetric)', () => {
    const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

    test('mirror (FirebaseService.saveFullState) strips exportConfig', () => {
        const src = read('../modules/services/FirebaseService.js');
        expect(src).toMatch(/sanitizeExportConfig/);
        // saveFullState must call helper on snapshotContext before cleanState
        const block = src.slice(src.indexOf('async saveFullState'), src.indexOf('async saveFullState') + 5000);
        expect(block).toMatch(/sanitizeExportConfig\s*\(\s*snapshotContext\s*\)/);
    });

    test('replace cloud (FirebaseService.replaceCloudFull) strips exportConfig', () => {
        const src = read('../modules/services/FirebaseService.js');
        const start = src.indexOf('async replaceCloudFull');
        const block = src.slice(start, start + 5000);
        expect(block).toMatch(/sanitizeExportConfig\s*\(\s*snapshotContext\s*\)/);
    });

    test('snapshot save (FirebaseService.createSnapshot) strips exportConfig', () => {
        const src = read('../modules/services/FirebaseService.js');
        const start = src.indexOf('async createSnapshot');
        const block = src.slice(start, start + 5000);
        expect(block).toMatch(/sanitizeExportConfig\s*\(\s*snapshotContext\s*\)/);
    });

    test('DataOps local→cloud branch strips exportConfig from frozen payload', () => {
        const src = read('../modules/services/DataOps.js');
        expect(src).toMatch(/sanitizeExportConfig/);
        // frozen clone handling must sanitize before upload
        expect(src).toMatch(/sanitizeExportConfig\s*\(\s*frozen\s*\)/);
    });

    test('DataOps restore/snapshot ingress strips exportConfig (replaceLocalWithCloud cleanCloud)', () => {
        const src = read('../modules/services/DataOps.js');
        // cleanCloud is spread of cloudState for ingress; must be sanitized
        expect(src).toMatch(/sanitizeExportConfig\s*\(\s*cleanCloud\s*\)/);
    });

    test('DataOps ingress handles legacy cloud payload with exportConfig{foo} (sanitize before assign)', () => {
        const src = read('../modules/services/DataOps.js');
        // ensure sanitize is invoked before Object.assign(state, cleanCloud)
        const idxSanitize = src.indexOf('sanitizeExportConfig(cleanCloud)');
        const idxAssign = src.indexOf('Object.assign(state, cleanCloud)');
        expect(idxSanitize).toBeGreaterThan(-1);
        expect(idxAssign).toBeGreaterThan(-1);
        expect(idxSanitize).toBeLessThan(idxAssign);
    });

    test('snapshot/cloud ingress (FirebaseService.getSnapshot / getFullState) sanitize legacy payload', () => {
        const src = read('../modules/services/FirebaseService.js');
        // getSnapshot must sanitize state before return, getFullState sanitize if exportConfig present
        expect(src).toMatch(/sanitizeExportConfig/);
        // at least one ingress sanitize: getSnapshot or getFullState
        const hasSnapshotIngress = /getSnapshot[\s\S]{0,2000}sanitizeExportConfig/.test(src);
        const hasFullStateIngress = /getFullState[\s\S]{0,2000}sanitizeExportConfig/.test(src);
        expect(hasSnapshotIngress || hasFullStateIngress).toBe(true);
    });

    test('PersistenceService mirror egress (outbox enqueue) strips exportConfig', () => {
        const src = read('../modules/services/PersistenceService.js');
        expect(src).toMatch(/sanitizeExportConfig/);
        // _mirrorSnapshot sanitized before enqueue
        expect(src).toMatch(/sanitizeExportConfig\s*\(\s*_mirrorSnapshot\s*\)/);
    });

    test('AppState mirror subscription ingress (app.js applyRemoteData) strips exportConfig', () => {
        const src = read('../app.js');
        expect(src).toMatch(/sanitizeExportConfig/);
        // applyRemoteData must sanitize remoteData before using
        const idx = src.indexOf('applyRemoteData');
        const tail = src.slice(idx, idx + 6000);
        expect(tail).toMatch(/sanitizeExportConfig\s*\([^)]*remoteData[^)]*\)/);
    });

    test('snapshot restore ingress (app.js applyBackupData / restore) strips exportConfig', () => {
        const src = read('../app.js');
        // applyBackupData handles imported backup; should sanitize
        expect(src).toMatch(/sanitizeExportConfig/);
        const hasBackupIngress = /applyBackupData[\s\S]{0,3000}sanitizeExportConfig/.test(src);
        const hasRestoreIngress = /restoreSnapshot[\s\S]{0,3000}sanitizeExportConfig/.test(src) || /getSnapshot[\s\S]{0,1000}sanitizeExportConfig/.test(src);
        expect(hasBackupIngress || hasRestoreIngress).toBe(true);
    });

    test('ExportConfigSanitizer is single helper imported by each frontier (centralized)', () => {
        const files = [
            '../modules/services/FirebaseService.js',
            '../modules/services/DataOps.js',
            '../modules/services/PersistenceService.js',
            '../app.js'
        ];
        files.forEach(rel => {
            const src = read(rel);
            expect(src).toMatch(/from ['"].*ExportConfigSanitizer.*['"]|require.*ExportConfigSanitizer/);
        });
    });
});

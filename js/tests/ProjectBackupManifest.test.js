import fs from 'fs';
import path from 'path';
import {
    buildProjectBackupManifest,
    diagnoseProjectBackup,
    hasProjectBackupMetadata,
    isLegacyProjectBackup,
    collectBackupProjectIds,
    getEffectiveBackupProjectId
} from 'actual/services/ProjectBackupManifest.js';
import { RestoreUI } from 'actual/ui/RestoreUI.js';
import { LegacyMigrator } from 'actual/utils/LegacyMigrator.js';

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const clone = (v) => JSON.parse(JSON.stringify(v));

const PRJ_A = 'PRJ-A-000001';
const PRJ_B = 'PRJ-B-000002';
const PRJ_DEFAULT = 'PRJ-DEFAULT-0000';

function makeOnBackup() {
    return {
        version: '1.0.0',
        exportDate: '2026-09-01T00:00:00.000Z',
        companyName: 'Acme',
        data: {
            settings: { companyName: 'Acme' },
            positions: [{ id: 'POS-A', projectId: PRJ_A }, { id: 'POS-B', projectId: PRJ_B }],
            employees: [{ id: 'E-A', projectId: PRJ_A }, { id: 'E-B', projectId: PRJ_B }, { id: 'E-LEG' }],
            leaders: [{ id: 'L-A', projectId: PRJ_A }],
            attendance: {
                'E-A-2026-01-01': { employeeId: 'E-A', date: '2026-01-01', projectId: PRJ_A },
                'E-LEG-2026-01-01': { employeeId: 'E-LEG', date: '2026-01-01' }
            },
            tempAssignments: [],
            dayHoursConfig: {},
            projects: [
                { id: PRJ_A, name: 'A', status: 'active' },
                { id: PRJ_B, name: 'B', status: 'active' }
            ],
            projectPayrollConfigs: [{ projectId: PRJ_A, regularHoursPerDay: 8 }],
            projectBackup: {
                version: 1,
                projectsEnabled: true,
                exportedAt: '2026-09-01T00:00:00.000Z',
                defaultProjectId: PRJ_A,
                activeProjectId: PRJ_A,
                projectIds: [PRJ_A, PRJ_B]
            },
            pettyCash: {
                projects: [{ id: 'pc-1', officialProjectId: PRJ_A }],
                periods: [{ id: 'per-1', projectId: 'INTERNAL-X' }],
                movements: [
                    { id: 'm-ok', hasReceipt: true, receiptStorage: 'supabase', receiptUrl: 'receipts/m-ok.pdf' },
                    { id: 'm-lost', hasReceipt: true, receiptStorage: 'local-only' }
                ]
            }
        }
    };
}

function makeLegacyBackup() {
    return {
        version: '1.0.0',
        exportDate: '2025-01-01T00:00:00.000Z',
        companyName: 'Acme Vieja',
        data: {
            settings: { companyName: 'Acme Vieja' },
            positions: [{ id: 'POS-1' }],
            employees: [{ id: 'E-1' }, { id: 'E-2' }],
            leaders: [{ id: 'L-1' }],
            attendance: { 'E-1-2025-01-01': { employeeId: 'E-1', date: '2025-01-01' } },
            tempAssignments: [],
            dayHoursConfig: {}
        }
    };
}

describe('F1.9 S1 manifest counts effective ownership without mutating', () => {
    test('buildProjectBackupManifest counts effective project (unstamped → default) and leaves inputs intact', () => {
        const input = {
            employees: [{ id: 'E-A', projectId: PRJ_A }, { id: 'E-LEG' }],
            positions: [{ id: 'P-A', projectId: PRJ_A }],
            leaders: [],
            attendance: { 'E-A-2026-01-01': { employeeId: 'E-A', projectId: PRJ_A }, 'E-LEG-2026-01-01': { employeeId: 'E-LEG' } },
            projects: [{ id: PRJ_A }],
            projectPayrollConfigs: [{ projectId: PRJ_A }],
            defaultProjectId: PRJ_A,
            activeProjectId: PRJ_A,
            exportedAt: '2026-09-01T00:00:00.000Z'
        };
        const before = clone(input);
        const manifest = buildProjectBackupManifest(input);
        expect(manifest.version).toBe(1);
        expect(manifest.projectsEnabled).toBe(true);
        expect(manifest.defaultProjectId).toBe(PRJ_A);
        // Effective: unstamped employee resolves to default PRJ_A
        expect(manifest.counts.employees.perProject[PRJ_A]).toBe(2);
        expect(manifest.counts.employees.unstamped).toBe(1);
        expect(manifest.counts.attendance.perProject[PRJ_A]).toBe(2);
        expect(manifest.projectIds).toEqual([PRJ_A]);
        expect(input).toEqual(before);
    });

    test('getEffectiveBackupProjectId mirrors F0.4 §2 without scope globals', () => {
        expect(getEffectiveBackupProjectId({ projectId: PRJ_B }, PRJ_A)).toBe(PRJ_B);
        expect(getEffectiveBackupProjectId({}, PRJ_A)).toBe(PRJ_A);
        expect(getEffectiveBackupProjectId({ projectId: null }, PRJ_A)).toBe(PRJ_A);
        expect(getEffectiveBackupProjectId({}, null)).toBeNull();
    });

    test('collectBackupProjectIds is distinct + sorted and ignores unstamped', () => {
        const ids = collectBackupProjectIds(makeOnBackup());
        expect(ids).toEqual([PRJ_A, PRJ_B]);
    });
});

describe('F1.9 S1 OFF shape unchanged / ON additive surface', () => {
    test('OFF export must not add meta/projects/projectPayrollConfigs keys (byte-identical base)', () => {
        const src = read('../app.js');
        const block = src.match(/window\.exportData\s*=\s*async\s*function[\s\S]*?showExportMenu/);
        expect(block).toBeTruthy();
        const text = block[0];
        // Base payload keeps legacy keys only
        expect(text).toMatch(/settings:\s*state\.settings/);
        expect(text).toMatch(/pettyCash/);
        // window.exportData delegates project surface to helper (keeps legacy
        // 2500-char shape contract); it must not write project keys directly.
        const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        expect(code).not.toMatch(/exportData\.data\.projects\s*=/);
        expect(code).not.toMatch(/exportData\.data\.projectPayrollConfigs\s*=/);
        expect(code).not.toMatch(/exportData\.data\.projectBackup\s*=/);
        expect(code).not.toMatch(/getAll\(['"]projects['"]\)/);
        expect(code).toMatch(/maybeAttachProjectBackup/);
        // Helper itself guards OFF first (no keys/reads when OFF)
        const helperStart = src.indexOf('async function maybeAttachProjectBackup');
        expect(helperStart).toBeGreaterThan(-1);
        const helper = src.slice(helperStart, helperStart + 2000).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        expect(helper).toMatch(/if\s*\(\s*!isProjectsEnabled\(\)\s*\)\s*return/);
        const guardIdx = helper.indexOf('isProjectsEnabled');
        const beforeGuard = helper.slice(0, guardIdx);
        expect(beforeGuard).not.toMatch(/getAll\(['"]projects['"]\)/);
    });

    test('ON export adds projects[] + projectPayrollConfigs[] + projectBackup via existing reads, never closures', () => {
        const src = read('../app.js');
        const helperStart = src.indexOf('async function maybeAttachProjectBackup');
        expect(helperStart).toBeGreaterThan(-1);
        const helper = src.slice(helperStart, helperStart + 3000);
        const code = helper.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        expect(code).toMatch(/getAll\(['"]projects['"]\)/);
        expect(code).toMatch(/getAll\(['"]projectPayrollConfigs['"]\)/);
        expect(code).toMatch(/buildProjectBackupManifest/);
        expect(code).toMatch(/exportData\.data\.projects\s*=/);
        expect(code).toMatch(/exportData\.data\.projectPayrollConfigs\s*=/);
        expect(code).toMatch(/exportData\.data\.projectBackup\s*=/);
        // S1 file surface never includes closures
        expect(code).not.toMatch(/payrollClosures/);
        // Petty sanitized payload preserved in window.exportData
        const block = src.match(/window\.exportData\s*=\s*async\s*function[\s\S]*?showExportMenu/);
        expect(block[0]).toMatch(/sanitizePettyCashForSnapshot/);
        expect(block[0]).toMatch(/PettyCashStore\.loadLocal/);
    });

    test('OFF loadBackup path uses empty local context (no project API calls)', () => {
        const src = read('../app.js');
        const start = src.indexOf('window.loadBackupFromFile');
        const block = src.slice(start, start + 8000);
        expect(block).toMatch(/if\s*\(\s*!isProjectsEnabled\(\)\s*\)/);
        // OFF branch diagnoses with empty lists only — no IDB project reads there
        const offBranch = block.slice(block.indexOf('if (!isProjectsEnabled())'), block.indexOf('} else {'));
        expect(offBranch).not.toMatch(/getAll\(['"]projects['"]\)/);
        expect(offBranch).not.toMatch(/getAll\(['"]payrollClosures['"]\)/);
        expect(offBranch).toMatch(/diagnoseProjectBackup/);
    });
});

describe('F1.9 S1 diagnose: legacy, foreign A→B, gaps, no rewrite', () => {
    test('legacy projectless backup warns and performs zero rewrite', () => {
        const backup = makeLegacyBackup();
        const before = clone(backup);
        expect(hasProjectBackupMetadata(backup)).toBe(false);
        expect(isLegacyProjectBackup(backup)).toBe(true);
        const localCtx = { localProjects: [], localProjectIds: [], defaultProjectId: null, activeProjectId: null, localClosures: [] };
        const ctxBefore = clone(localCtx);
        const diag = diagnoseProjectBackup(backup, localCtx);
        expect(diag.isLegacyBackup).toBe(true);
        expect(diag.hasProjectMetadata).toBe(false);
        expect(diag.warnings).toContain('legacy-no-project');
        expect(diag.legacyCounts.employees).toBe(2);
        expect(backup).toEqual(before);
        expect(localCtx).toEqual(ctxBefore);
    });

    test('A→B foreign IDs diagnosed and local pointers/context unchanged', () => {
        const backup = makeOnBackup();
        const before = clone(backup);
        localStorage.setItem('asistencia_default_project_id', PRJ_A);
        localStorage.setItem('asistencia_active_project_id', PRJ_A);
        const localCtx = {
            localProjects: [{ id: PRJ_A, name: 'A' }],
            defaultProjectId: PRJ_A,
            activeProjectId: PRJ_A,
            canonicalProjectId: null,
            localClosures: [],
            localPayrollConfigs: [{ projectId: PRJ_A }]
        };
        const ctxBefore = clone(localCtx);
        const diag = diagnoseProjectBackup(backup, localCtx);
        expect(diag.hasProjectMetadata).toBe(true);
        expect(diag.backupProjectIds).toEqual([PRJ_A, PRJ_B]);
        expect(diag.foreignProjectIds).toEqual([PRJ_B]);
        expect(diag.warnings).toContain('foreign-project');
        expect(diag.missingConfigProjectIds).toEqual([PRJ_B]);
        expect(diag.warnings).toContain('payroll-config-gap');
        // No rewrite of inputs
        expect(backup).toEqual(before);
        expect(localCtx).toEqual(ctxBefore);
        // No auto switch of pointers
        expect(localStorage.getItem('asistencia_default_project_id')).toBe(PRJ_A);
        expect(localStorage.getItem('asistencia_active_project_id')).toBe(PRJ_A);
        localStorage.clear();
    });

    test('local closures/configs untouched; orphan risk reported read-only', () => {
        const backup = makeOnBackup();
        // Backup roster only knows E-A/E-B/E-LEG; closure references ghost employee + foreign project
        const localCtx = {
            localProjects: [{ id: PRJ_A }],
            defaultProjectId: PRJ_A,
            activeProjectId: PRJ_A,
            localClosures: [
                { id: 'C-OK', projectId: PRJ_A, rows: [{ employeeId: 'E-A' }] },
                { id: 'C-RISK', projectId: 'PRJ-GHOST', rows: [{ employeeId: 'E-GHOST' }] }
            ],
            localPayrollConfigs: [{ projectId: PRJ_A }]
        };
        const closuresBefore = clone(localCtx.localClosures);
        const configsBefore = clone(localCtx.localPayrollConfigs);
        const diag = diagnoseProjectBackup(backup, localCtx);
        expect(diag.closureRisks.localClosureCount).toBe(2);
        expect(diag.closureRisks.atRiskIds).toEqual(['C-RISK']);
        expect(diag.warnings).toContain('closure-orphan-risk');
        expect(localCtx.localClosures).toEqual(closuresBefore);
        expect(localCtx.localPayrollConfigs).toEqual(configsBefore);
    });

    test('petty internal projectId never conflated; official orphans + receipt loss counted', () => {
        const backup = makeOnBackup();
        // periods/movements carry decoy internal projectIds that must be ignored
        backup.data.pettyCash.periods = [{ id: 'per-1', projectId: 'PRJ-GHOST-INTERNAL' }];
        backup.data.pettyCash.movements.push({ id: 'm-decoy', projectId: 'PRJ-GHOST-INTERNAL', hasReceipt: false });
        backup.data.pettyCash.projects.push({ id: 'pc-orph', officialProjectId: 'PRJ-GHOST-OFFICIAL' });
        backup.data.pettyCash.projects.push({ id: 'pc-missing' });
        const before = clone(backup);
        const diag = diagnoseProjectBackup(backup, {
            localProjects: [{ id: PRJ_A }, { id: PRJ_B }],
            defaultProjectId: PRJ_A,
            activeProjectId: PRJ_A,
            localClosures: []
        });
        // Internal decoy must not create foreign/petty signals beyond official links
        expect(diag.petty.internalProjectIdIgnored).toBe(true);
        expect(diag.petty.orphanMissing).toBe(1);
        expect(diag.petty.orphanInvalid).toBe(1);
        expect(diag.warnings).toContain('petty-orphan');
        // Receipt loss only for local-only without URL (m-lost), not supabase one
        expect(diag.receiptLoss.unrecoverableReceiptCount).toBe(1);
        expect(diag.warnings).toContain('receipt-loss');
        expect(backup).toEqual(before);
    });

    test('helper never auto-creates/adopts/switches: no forbidden IO in module source', () => {
        const src = read('../modules/services/ProjectBackupManifest.js');
        // Strip comments so doc mentions (e.g. "clearFirst") do not false-positive;
        // only real code may not contain IO/mutation APIs.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        const forbidden = [
            'setActiveProjectId', 'ensureDefaultProject', 'adoptProject', 'ensureAlias',
            'ensureCanonicalProject', 'projectStore.create', 'projectStore.update',
            'localStorage.setItem', 'localStorage.removeItem', 'indexedDBService',
            'batchUpdate', '.clear(', 'applyRemote', 'clearFirst'
        ];
        forbidden.forEach((token) => {
            expect(code).not.toMatch(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        });
        // No projectId rewrite assignment in code (single `=`, not `==`/`===`/`=>`)
        expect(code).not.toMatch(/\.projectId\s*=(?![=>])/);
    });

    test('unknown/new metadata does not break LegacyMigrator path', () => {
        const futuristic = makeOnBackup();
        futuristic.data.projectBackup.version = 99;
        futuristic.data.futureField = { hello: 'world' };
        futuristic.unknownTop = { v: 2 };
        expect(() => LegacyMigrator.needsMigration(futuristic)).not.toThrow();
        expect(() => LegacyMigrator.needsMigration({ future: 1 })).not.toThrow();
        const legacyFlat = { personal: [{ id: 'E1' }], unknownMeta: { projectBackup: { version: 99 } } };
        expect(LegacyMigrator.needsMigration(legacyFlat)).toBe(true);
        const migrated = LegacyMigrator.migrate(legacyFlat);
        expect(migrated).toBeTruthy();
        expect(Array.isArray(migrated.data.employees)).toBe(true);
    });
});

describe('F1.9 S1 applyBackupData semantics preserved (default-preserve, no widened clearFirst)', () => {
    test('applyBackupData keeps existing roster/petty semantics and ignores project surface', () => {
        const src = read('../app.js');
        const start = src.indexOf('async function applyBackupData');
        // Isolate to the function body only (up to its closing + next doc block),
        // so later loadBackupFromFile preservation code does not false-positive.
        const tail = src.slice(start, start + 8000);
        const endRel = tail.search(/\n\}\n\n\/\*\*\n \* 📁/);
        const block = endRel > 0 ? tail.slice(0, endRel) : tail.slice(0, 4500);
        expect(block).toMatch(/state\.settings\s*=\s*data\.settings/);
        expect(block).toMatch(/state\.employees\s*=\s*data\.employees/);
        expect(block).toMatch(/saveToIndexedDB\(\{\s*clearFirst:\s*true\s*\}\)/);
        expect(block).toMatch(/PettyCashStore\.applyRemote/);
        expect(block).toMatch(/preparePettyCashBackupForRestore/);
        // S1 must not restore projects/configs/closures or widen clearFirst
        expect(block).not.toMatch(/data\.projects/);
        expect(block).not.toMatch(/projectPayrollConfigs/);
        expect(block).not.toMatch(/payrollClosures/);
    });
});

describe('F1.9 S1 RestoreUI shows diagnostics before choices, keeps callbacks', () => {
    beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); delete window.currentUser; });
    afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); delete window.currentUser; });

    test('legacy backup renders legacy warning and local-restore callback still fires', () => {
        const backup = makeLegacyBackup();
        const diag = diagnoseProjectBackup(backup, { localProjects: [], localProjectIds: [] });
        let called = false;
        RestoreUI.showComparisonModal(backup, { settings: {}, employees: [], attendance: {} }, {
            onLocalRestore: () => { called = true; }
        }, { projectDiagnostics: diag });
        const box = document.getElementById('project-backup-diagnostics');
        expect(box).toBeTruthy();
        expect(box.getAttribute('data-warning')).toMatch(/legacy-no-project/);
        expect(box.textContent).toMatch(/legacy/i);
        const btn = document.getElementById('btn-restore-local');
        expect(btn).toBeTruthy();
        btn.click();
        expect(called).toBe(true);
    });

    test('ON backup renders foreign/config/closure/petty/receipt warnings before action buttons', () => {
        const backup = makeOnBackup();
        // Add an explicit petty orphan so the petty warning is exercised here
        // (base fixture links pc-1 to PRJ_A which is known in this scenario).
        backup.data.pettyCash.projects.push({ id: 'pc-orph-ui' });
        const diag = diagnoseProjectBackup(backup, {
            localProjects: [{ id: PRJ_A }],
            defaultProjectId: PRJ_A,
            activeProjectId: PRJ_B,
            localClosures: [{ id: 'C-RISK', projectId: 'PRJ-GHOST', rows: [{ employeeId: 'E-GHOST' }] }]
        });
        RestoreUI.showComparisonModal(backup, { settings: {}, employees: [], attendance: {} }, {
            onLocalRestore: () => {}
        }, { projectDiagnostics: diag });
        const box = document.getElementById('project-backup-diagnostics');
        expect(box).toBeTruthy();
        const warn = box.getAttribute('data-warning');
        expect(warn).toMatch(/foreign-project/);
        expect(warn).toMatch(/payroll-config-gap/);
        expect(warn).toMatch(/closure-orphan-risk/);
        expect(warn).toMatch(/petty-orphan/);
        expect(warn).toMatch(/receipt-loss/);
        // Section sits before the action buttons in DOM order
        const html = document.body.innerHTML;
        expect(html.indexOf('project-backup-diagnostics')).toBeLessThan(html.indexOf('btn-restore-local'));
    });

    test('fallback without diagnostics still shows legacy warning and preserves cancel/close', () => {
        const backup = makeLegacyBackup();
        RestoreUI.showComparisonModal(backup, { settings: {}, employees: [], attendance: {} }, {});
        const box = document.getElementById('project-backup-diagnostics');
        expect(box).toBeTruthy();
        expect(box.textContent).toMatch(/legacy/i);
        // Cancel removes modal (existing behavior preserved)
        const cancel = document.querySelector('.btn-cancel');
        expect(cancel).toBeTruthy();
        cancel.click();
        expect(document.getElementById('restore-comparison-modal')).toBeNull();
    });
});

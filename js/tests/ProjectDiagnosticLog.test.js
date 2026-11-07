import { buildProjectDiagnosticLog, shareProjectDiagnosticLog } from '../modules/features/projects/ProjectDiagnosticLog.js';

const sample = () => ({
    employeeRows: [{ id: 'emp-real-secret', employee: { name: 'Sensitive Name', number: '405',
        loans: [{ amount: 999999 }] }, status: 'EXPLICIT_ORPHAN' }],
    otherIssues: [{ collection: 'positions', recordKey: 'private-position', label: 'Someone' }],
    diagnosticIssues: [{
        kind: 'closures', key: 'PAYROLL-SECRET', label: 'Secret Corp',
        reason: 'La obra de origen no está disponible para Alice'
    }],
    diagnosticReadErrors: ['payrollClosures', 'private-api-key'],
    pettyCashRows: [{ id: 'cash-private', name: 'Secret cash' }],
    orphanAttendanceKeys: ['employee-405-2026-11-01'],
    archivedCount: 2
});

describe('manual privacy-safe Multiobra diagnostic export', () => {
    test('log contains useful categories, version/time and no personal, financial or raw records', () => {
        const input = sample(), before = JSON.stringify(input);
        const report = buildProjectDiagnosticLog(input, {
            now: new Date('2026-11-03T20:44:00.000Z'), version: '1.7.126'
        });
        expect(report.filename).toBe('sa-multiobra-diagnostico-2026-11-03-20-44-00.log');
        expect(report.content).toContain('Version de SA: 1.7.126');
        expect(report.content).toContain('[DIAGNOSTIC_CLOSURES_REFERENCE_UNAVAILABLE] count=1');
        expect(report.content).toContain('[READ_PAYROLLCLOSURES] count=1');
        expect(report.content).toContain('[READ_OTHER] count=1');
        for (const secret of ['Sensitive Name', '405', '999999', 'Secret Corp', 'PAYROLL-SECRET',
            'private-api-key', 'Alice', 'emp-real-secret', 'cash-private', 'employee-405']) {
            expect(report.content).not.toContain(secret);
        }
        expect(JSON.stringify(input)).toBe(before);
    });
    test('offers share sheet when supported, never auto-uploading', async () => {
        const nav = {
            canShare: jest.fn(() => true),
            share: jest.fn(async () => {})
        };
        const result = await shareProjectDiagnosticLog(sample(), { navigatorApi: nav });
        expect(result.action).toBe('shared');
        expect(nav.share).toHaveBeenCalledTimes(1);
        expect(nav.share.mock.calls[0][0].files[0].name).toMatch(/\.log$/);
    });
    test('a cancelled share does not silently download a file', async () => {
        const nav = { canShare: () => true, share: async () => {
            const error = new Error('User cancelled');
            error.name = 'AbortError';
            throw error;
        } };
        const url = { createObjectURL: jest.fn() };
        expect((await shareProjectDiagnosticLog(sample(), {
            navigatorApi: nav, urlApi: url
        })).action).toBe('cancelled');
        expect(url.createObjectURL).not.toHaveBeenCalled();
    });
    test('desktop fallback downloads one .log and revokes the URL', async () => {
        const click = jest.fn(), appendChild = jest.fn(), remove = jest.fn();
        const doc = { body: { appendChild }, createElement: () => ({ click, remove }) };
        const url = { createObjectURL: jest.fn(() => 'blob:temporary'),
            revokeObjectURL: jest.fn() };
        const result = await shareProjectDiagnosticLog(sample(), {
            navigatorApi: {}, documentApi: doc, urlApi: url
        });
        expect(result.action).toBe('downloaded');
        expect(click).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(url.createObjectURL).toHaveBeenCalledTimes(1);
    });
});

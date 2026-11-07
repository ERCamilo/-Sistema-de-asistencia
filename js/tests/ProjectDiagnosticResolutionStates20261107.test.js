import { buildProjectDiagnosticLog, classifyProjectDiagnosticIssue } from '../modules/features/projects/ProjectDiagnosticLog.js';

describe('Multiobra explainable diagnostics #352', () => {
  test('A04: separates historical read-only, pending synchronization, repairable and manual review', () => {
    expect(classifyProjectDiagnosticIssue({ kind: 'closures', informational: true,
      reason: 'El empleado original ya no está disponible; se conserva el cierre histórico' }).status).toBe('HISTORICAL_READ_ONLY');
    expect(classifyProjectDiagnosticIssue({ kind: 'plans',
      reason: 'Un cierre del historial no está disponible localmente; comprueba la sincronización o el respaldo' }).status).toBe('SYNC_REVIEW');
    expect(classifyProjectDiagnosticIssue({ kind: 'configs',
      reason: 'Sin obra asignada' }).status).toBe('REPAIRABLE');
    expect(classifyProjectDiagnosticIssue({ kind: 'plans',
      reason: 'La obra del plan no coincide con la del empleado' }).status).toBe('MANUAL_REVIEW');
  });
  test('A05: failed read is not reported as a missing reference or a successful resolution', () => {
    expect(classifyProjectDiagnosticIssue({ readError: true }).status).toBe('READ_FAILED');
  });
  test('A07: log exposes normalized resolution status and cause but never raw labels or IDs', () => {
    const report = buildProjectDiagnosticLog({
      diagnosticIssues: [{ kind: 'plans', key: 'loan-PRIVATE', label: 'Juan PRIVATE',
        reason: 'Un cierre del historial no está disponible localmente; comprueba la sincronización o el respaldo' }],
      diagnosticReadErrors: ['payrollClosures']
    }, { now: new Date('2026-11-07T22:00:00Z'), version: '1.7.128' });
    expect(report.content).toContain('estado=SYNC_REVIEW');
    expect(report.content).toContain('causa=REFERENCE_UNAVAILABLE');
    expect(report.content).toContain('estado=READ_FAILED');
    expect(report.content).not.toContain('PRIVATE');
    expect(report.content).not.toContain('Juan');
    expect(report.content).not.toContain('loan-');
  });
});

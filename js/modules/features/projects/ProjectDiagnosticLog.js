/**
 * User-initiated, privacy-preserving Multiobra diagnostics.
 *
 * This deliberately accepts only known categories, counts and fixed codes.
 * NEVER serialize arbitrary records, errors, employee labels/IDs, names,
 * payroll amounts, URLs, authentication tokens or complete browser info.
 */
import { APP_VERSION } from '../../config/AppVersion.js';

const safelyCount = value => Math.min(1000000, Math.max(0, Number.isFinite(value) ? Math.round(value) : 0));
const list = value => Array.isArray(value) ? value : [];
const ALLOWED_STORES = new Set([
    'employees', 'positions', 'leaders', 'attendance',
    'payrollClosures', 'projectPayrollConfigs', 'pettyCashProjects',
    'pettyCashPeriods', 'pettyCashMovements', 'conflictArchive'
]);
const ISSUE_KINDS = new Set([
    'closures', 'payments', 'configs', 'plans', 'cashLinks',
    'attendance', 'employee', 'position', 'leader', 'pettyCash'
]);
const EMPLOYEE_STATES = new Set(['LEGACY_UNSCOPED', 'EXPLICIT_ORPHAN', 'PENDING']);
const ALLOWED_COLLECTIONS = new Set(['employees', 'positions', 'leaders', 'attendance']);

function reasonCode(value) {
    const text = String(value ?? '').toLowerCase();
    if (/no coincide|distinta|relaci[oó]n/.test(text)) return 'RELATION_MISMATCH';
    if (/sin obra|no identifica su obra/.test(text)) return 'PROJECT_MISSING';
    if (/no est[aá] disponible|falta|ya no existe/.test(text)) return 'REFERENCE_UNAVAILABLE';
    if (/sin empleado/.test(text)) return 'EMPLOYEE_MISSING';
    return 'REVIEW_REQUIRED';
}


/**
 * Conservative classification of diagnostics, based only on normalized kinds
 * and explanatory reasons already present in the local snapshot. This does not
 * prove that a remote record exists, or authorize a financial repair.
 */
export function classifyProjectDiagnosticIssue(issue = {}) {
    if (issue.readError) return { status: 'READ_FAILED', label: 'Lectura fallida: reintenta la revisión' };
    if (issue.informational && issue.kind === 'closures') {
        return { status: 'HISTORICAL_READ_ONLY', label: 'Historial conservado: no modificar el cierre original' };
    }
    const reason = String(issue.reason || '').toLowerCase();
    if (/no est[aá] disponible localmente|comprueba la sincronizaci[oó]n|falta.*localmente/.test(reason)) {
        return { status: 'SYNC_REVIEW', label: 'Pendiente de comprobar sincronización o respaldo' };
    }
    if (/sin obra asignada|obra de origen no est[aá] disponible/.test(reason)) {
        return { status: 'REPAIRABLE', label: 'Revisar la obra de destino antes de reasignar' };
    }
    return { status: 'MANUAL_REVIEW', label: 'Requiere revisión manual; no modificar automáticamente' };
}

function group(rows) {
    const counts = new Map();
    for (const entry of rows) {
        const code = String(entry);
        counts.set(code, (counts.get(code) || 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([code, count]) => '[' + code + '] count=' + safelyCount(count));
}

export function buildProjectDiagnosticLog(snapshot = {}, {
    now = new Date(), version = APP_VERSION
} = {}) {
    const generatedAt = now instanceof Date && !Number.isNaN(now.getTime())
        ? now.toISOString() : new Date().toISOString();
    const employee = list(snapshot.employeeRows).map(item =>
        'EMPLOYEE_' + (EMPLOYEE_STATES.has(item?.status) ? item.status : 'REVIEW_REQUIRED'));
    const catalog = list(snapshot.otherIssues).map(item =>
        'CATALOG_' + (ALLOWED_COLLECTIONS.has(item?.collection) ? item.collection.toUpperCase() : 'OTHER'));
    const diagnostic = list(snapshot.diagnosticIssues).map(item =>
        'DIAGNOSTIC_' + (ISSUE_KINDS.has(item?.kind) ? item.kind.toUpperCase() : 'OTHER')
        + '_' + reasonCode(item?.reason));
    const extra = [
        ...list(snapshot.orphanAttendanceKeys).map(() => 'ORPHAN_ATTENDANCE'),
        ...list(snapshot.pettyCashRows).map(() => 'PETTY_CASH_UNSCOPED')
    ];
    const issueCodes = [...employee, ...catalog, ...diagnostic, ...extra];
    const readErrors = list(snapshot.diagnosticReadErrors).map(item =>
        'READ_' + (ALLOWED_STORES.has(item) ? item.toUpperCase() : 'OTHER'));
    const counts = [
        ['employeesPending', list(snapshot.employeeRows).length],
        ['catalogIssues', list(snapshot.otherIssues).length],
        ['financialAndSpecialIssues', list(snapshot.diagnosticIssues).length],
        ['orphanAttendance', list(snapshot.orphanAttendanceKeys).length],
        ['pettyCashWithoutProject', list(snapshot.pettyCashRows).length],
        ['archivedCases', safelyCount(snapshot.archivedCount)],
        ['readFailures', readErrors.length]
    ];
    const sections = [
        'SA MULTIOBRA - INFORME DE DIAGNOSTICO (v1)',
        'Fecha UTC: ' + generatedAt,
        'Version de SA: ' + (/^\d+\.\d+\.\d+$/.test(String(version)) ? version : 'no-disponible'),
        'Modo: generado localmente por solicitud del usuario',
        'Privacidad: sin nombres, fichas, identificadores, datos financieros ni credenciales.',
        'NOTA: este archivo no se envia automaticamente.',
        '',
        '[RESUMEN]',
        ...counts.map(([name, count]) => name + '=' + safelyCount(count)),
        '',
        '[TIPOS DE PROBLEMA]',
        ...(issueCodes.length ? group(issueCodes) : ['Ningun problema clasificado']),
        '',
        '[CASOS ANONIMOS]',
        // A bounded case-by-case sequence is more useful to support than only
        // totals, without exposing employee identifiers or financial facts.
        ...issueCodes.slice(0, 250).map((code, index) => {
            const employeeCount = employee.length;
            const catalogCount = catalog.length;
            const diagnosticCount = diagnostic.length;
            const diagnosticIndex = index - employeeCount - catalogCount;
            const issue = diagnosticIndex >= 0 && diagnosticIndex < diagnosticCount
                ? list(snapshot.diagnosticIssues)[diagnosticIndex] : null;
            const status = issue ? classifyProjectDiagnosticIssue(issue).status
                : 'MANUAL_REVIEW';
            const cause = issue ? reasonCode(issue.reason) : 'REVIEW_REQUIRED';
            return 'caso-' + String(index + 1).padStart(3, '0')
                + ' codigo=' + code + ' estado=' + status + ' causa=' + cause;
        }),
        ...(issueCodes.length > 250 ? ['Casos restantes omitidos por limite de tamano: '
            + (issueCodes.length - 250)] : []),
        '',
        '[FALLOS DE LECTURA]',
        ...(readErrors.length ? group(readErrors) : ['Ninguno']),
        ...readErrors.slice(0, 250).map(code => code + ' estado=READ_FAILED causa=READ_ERROR'),
        '',
        '[LIMITACIONES]',
        'Clasificacion sin datos personales. No incluye la consola ni el contenido de IndexedDB.',
        'No confirma el estado de Firestore remoto ni sustituye una prueba multidispositivo.',
        ''
    ];
    return {
        filename: 'sa-multiobra-diagnostico-' + generatedAt.slice(0, 19).replace(/[T:]/g, '-') + '.log',
        content: sections.join('\n')
    };
}

/**
 * Mobile: OS share sheet. Desktop/fallback: download the same text file.
 * A user cancellation does not trigger an unexpected download.
 */
export async function shareProjectDiagnosticLog(snapshot, {
    navigatorApi = typeof navigator !== 'undefined' ? navigator : null,
    documentApi = typeof document !== 'undefined' ? document : null,
    urlApi = typeof URL !== 'undefined' ? URL : null
} = {}) {
    const report = buildProjectDiagnosticLog(snapshot);
    const file = typeof File === 'function'
        ? new File([report.content], report.filename, { type: 'text/plain;charset=utf-8' })
        : null;
    if (file && typeof navigatorApi?.share === 'function'
        && typeof navigatorApi?.canShare === 'function') {
        let shareable = false;
        try { shareable = navigatorApi.canShare({ files: [file] }); } catch (_) { /* fallback */ }
        if (shareable) {
            try {
                await navigatorApi.share({ title: 'Diagnóstico de Multiobra', files: [file] });
                return { action: 'shared', filename: report.filename };
            } catch (error) {
                if (error?.name === 'AbortError') return { action: 'cancelled', filename: report.filename };
                // Only after an OS share failure may we offer the download.
            }
        }
    }
    if (!documentApi?.createElement || typeof urlApi?.createObjectURL !== 'function') {
        throw new Error('No es posible descargar el diagnóstico en este navegador.');
    }
    const blob = new Blob([report.content], { type: 'text/plain;charset=utf-8' });
    const objectUrl = urlApi.createObjectURL(blob);
    try {
        const anchor = documentApi.createElement('a');
        anchor.href = objectUrl;
        anchor.download = report.filename;
        anchor.hidden = true;
        documentApi.body.appendChild(anchor);
        try { anchor.click(); } finally { anchor.remove(); }
        return { action: 'downloaded', filename: report.filename };
    } finally {
        // Leave time for the browser's download manager to capture the blob.
        if (typeof setTimeout === 'function' && typeof urlApi.revokeObjectURL === 'function') {
            setTimeout(() => urlApi.revokeObjectURL(objectUrl), 2000);
        }
    }
}

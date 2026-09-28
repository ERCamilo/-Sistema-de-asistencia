import {
    PAYROLL_CLOSURE_IDENTITY_KIND,
    promoteLegacyPayrollClosure,
    validatePayrollClosureForScopedWrite
} from './PayrollClosure.js';
import { resolvePayrollClosureMutation } from './PayrollClosureMerge.js';

const clone = value => JSON.parse(JSON.stringify(value));

/** Read durable closure details, including orphan and archived-project history. */
export async function readPayrollClosuresForBackup(db) {
    await db.init();
    const closures = await db.getAll('payrollClosures');
    if (!Array.isArray(closures)) throw new Error('No se pudieron leer los cierres de nómina para el respaldo.');
    return clone(closures);
}

/** Absence means legacy: never interpret an omitted store as a deletion. */
export function payrollClosureRestoreOptions(data = {}) {
    if (data.payrollClosures === undefined) return {};
    if (!Array.isArray(data.payrollClosures)) {
        throw new Error('El respaldo contiene una lista de cierres de nómina inválida.');
    }
    const seen = new Set();
    const payrollClosures = clone(data.payrollClosures);
    for (const closure of payrollClosures) {
        if (!closure || typeof closure.id !== 'string' || !closure.id.trim()
            || typeof closure.fingerprint !== 'string' || !closure.fingerprint
            || ![1, 2, 3].includes(closure.schemaVersion)
            || !['closed', 'voided'].includes(closure.status)
            || !Array.isArray(closure.rows) || !closure.totals || typeof closure.totals !== 'object'
            || typeof closure.periodStart !== 'string' || typeof closure.periodEnd !== 'string') {
            throw new Error('El respaldo contiene un cierre de nómina incompleto: ' + (closure?.id || 'sin identidad'));
        }
        if (seen.has(closure.id)) throw new Error('El respaldo contiene un cierre duplicado: ' + closure.id);
        seen.add(closure.id);
        // Historical v1/v2 closures are restored verbatim, including void audit
        // and payment references. Import is not a promotion or a recalculation.
        if (closure.schemaVersion === 3) validatePayrollClosureForScopedWrite(closure, closure.projectId);
    }
    return { payrollClosures };
}

/**
 * Restore merge. A backup taken before promotion carries the schema 2 form of
 * a closure that this device already holds as promoted (same id). Keep the
 * promoted owner: compare the backup in promoted form so only the monotonic
 * void audit can advance. Restore never promotes, demotes or reopens closures.
 */
export function resolveRestoredPayrollClosure(existing, incoming) {
    if (existing?.identityKind === PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY
        && incoming?.schemaVersion === 2 && existing.id === incoming.id) {
        let promoted = null;
        try { promoted = promoteLegacyPayrollClosure(incoming, existing.projectId); } catch (_) { /* not its source */ }
        if (promoted) return resolvePayrollClosureMutation(existing, promoted);
    }
    return resolvePayrollClosureMutation(existing, incoming);
}

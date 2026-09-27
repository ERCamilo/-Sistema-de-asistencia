import { validatePayrollClosureForScopedWrite } from './PayrollClosure.js';

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
            || ![2, 3].includes(closure.schemaVersion)
            || !['closed', 'voided'].includes(closure.status)
            || !Array.isArray(closure.rows) || !closure.totals || typeof closure.totals !== 'object'
            || typeof closure.periodStart !== 'string' || typeof closure.periodEnd !== 'string') {
            throw new Error('El respaldo contiene un cierre de nómina incompleto: ' + (closure?.id || 'sin identidad'));
        }
        if (seen.has(closure.id)) throw new Error('El respaldo contiene un cierre duplicado: ' + closure.id);
        seen.add(closure.id);
        if (closure.schemaVersion === 3) validatePayrollClosureForScopedWrite(closure, closure.projectId);
    }
    return { payrollClosures };
}

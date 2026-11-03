/**
 * Explicit historical-only recovery when the employee was deleted.
 *
 * A copied historical closure is immutable evidence: it does NOT regenerate
 * wages, loan installments, deductions or employee records. The original
 * closure remains intact and the standard recovered-closure outbox uploads
 * the copy. Never run without an explicit target and source selection.
 */
import indexedDBService from '../../services/IndexedDBService.js';
import { auth } from '../../data/firebase.js';
import { isFullImportIsolationInProgress, isProjectRepairIsolationInProgress } from '../../services/PersistenceService.js';
import { isDetachedRestoreSyncBlocked } from '../../services/DetachedRestoreGuard.js';
import { buildPayrollClosureId, validatePayrollClosureForScopedWrite } from '../payroll/PayrollClosure.js';

const id = value => String(value ?? '').trim();
const clone = value => JSON.parse(JSON.stringify(value));
const list = value => Array.isArray(value) ? value : [];

export function planHistoricalClosureRecovery({
    sourceId, targetProjectId, projects = [], payrollClosures = [], employees = [],
    timestamp = Date.now()
} = {}) {
    const sourceKey = id(sourceId), target = id(targetProjectId);
    const projectList = list(projects);
    const knownProjects = new Set(projectList.filter(row => row?.deletedAt == null).map(row => id(row.id)));
    if (!target || !projectList.some(row => id(row.id) === target && row.status === 'active' && row.deletedAt == null)) {
        throw new Error('Selecciona una obra activa de destino.');
    }
    const source = payrollClosures.find(row => id(row.id) === sourceKey);
    if (!source) throw new Error('El cierre original ya no está disponible. Sincroniza antes de continuar.');
    if (knownProjects.has(id(source.projectId))) {
        throw new Error('El cierre pertenece a una obra existente. No se permite reasignarlo.');
    }
    if (!source.id || !list(source.rows).length || !source.fingerprint) {
        throw new Error('El cierre no conserva el detalle necesario para recuperarlo.');
    }
    if (source.supersedesId) {
        throw new Error('El cierre tiene un cierre anterior vinculado. Revisa la cadena completa antes de recuperarlo.');
    }
    const existing = payrollClosures.filter(row => id(row?.recovery?.sourceId) === sourceKey);
    if (existing.some(row => id(row.projectId) !== target)) {
        throw new Error('Este cierre ya fue recuperado en otra obra. No se creará una segunda copia.');
    }
    if (existing.length > 1) throw new Error('Existen recuperaciones duplicadas; revisa el historial antes de continuar.');
    if (existing.length === 1) {
        validatePayrollClosureForScopedWrite(existing[0], target);
        return { closure: existing[0], created: false, missingEmployeeIds: [] };
    }

    const present = new Set(list(employees).map(row => id(row.id)));
    const missingEmployeeIds = [...new Set(source.rows.map(row => id(row.employeeId))
        .filter(employeeId => employeeId && !present.has(employeeId)))];
    if (!missingEmployeeIds.length) {
        throw new Error('Este cierre no tiene empleados eliminados. Usa la recuperación financiera habitual.');
    }
    const fingerprint = JSON.stringify({
        projectId: target,
        periodStart: source.periodStart,
        periodEnd: source.periodEnd,
        rows: clone(source.rows)
    });
    const restored = {
        ...clone(source),
        schemaVersion: 3,
        projectId: target,
        fingerprint,
        periodKey: source.periodStart + ':' + source.periodEnd,
        id: buildPayrollClosureId(fingerprint, null, target),
        supersedesId: null,
        updatedAt: Math.max(timestamp, Number(source.updatedAt) || 0),
        recovery: {
            sourceId: source.id,
            sourceProjectId: source.projectId ?? null,
            sourceFingerprint: source.fingerprint,
            recoveredAt: timestamp,
            historicalOnly: true,
            missingEmployeeIds
        }
    };
    delete restored.identityKind;
    delete restored.ownershipToken;
    const sameId = payrollClosures.find(row => id(row.id) === id(restored.id));
    if (sameId) throw new Error('Ya existe un cierre con esta identidad en el destino. Revisa ambos cierres.');
    validatePayrollClosureForScopedWrite(restored, target);
    return { closure: restored, created: true, missingEmployeeIds };
}

/** Atomic local copy + durable outbox. No real cloud or employees touched. */
export async function saveHistoricalClosureRecovery({
    sourceId, targetProjectId, idb = indexedDBService,
    getUid = () => auth?.currentUser?.uid, now = () => Date.now()
} = {}) {
    const expectedUid = id(getUid());
    if (!expectedUid) throw new Error('Inicia sesión antes de recuperar un cierre histórico.');
    const isolated = () => isFullImportIsolationInProgress()
        || isProjectRepairIsolationInProgress() || isDetachedRestoreSyncBlocked();
    if (isolated()) throw new Error('Termina primero la restauración o reparación pendiente.');
    await idb.init();
    if (!idb.db?.transaction) throw new Error('El almacenamiento local no admite la recuperación atómica.');
    const stores = ['projects', 'employees', 'payrollClosures', 'mainSyncOutbox'];
    return new Promise((resolve, reject) => {
        const tx = idb.db.transaction(stores, 'readwrite');
        const data = {};
        let remaining = 3, result = null, failure = null;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('No se pudo guardar el cierre histórico.'));
        for (const name of ['projects', 'employees', 'payrollClosures']) {
            tx.objectStore(name).getAll().onsuccess = event => {
                data[name] = event.target.result;
                if (--remaining !== 0) return;
                try {
                    if (id(getUid()) !== expectedUid) throw new Error('La cuenta cambió durante la recuperación.');
                    if (isolated()) throw new Error('La restauración o reparación impide recuperar el cierre ahora.');
                    result = planHistoricalClosureRecovery({
                        sourceId, targetProjectId,
                        projects: data.projects, employees: data.employees,
                        payrollClosures: data.payrollClosures, timestamp: now()
                    });
                    if (result.created) {
                        tx.objectStore('payrollClosures').put(result.closure);
                        tx.objectStore('mainSyncOutbox').put({
                            kind: 'payrollRecoveredClosure',
                            closureId: result.closure.id,
                            closure: result.closure,
                            ts: result.closure.updatedAt,
                            status: 'pending'
                        });
                    }
                } catch (error) {
                    failure = error;
                    tx.abort();
                }
            };
        }
    });
}

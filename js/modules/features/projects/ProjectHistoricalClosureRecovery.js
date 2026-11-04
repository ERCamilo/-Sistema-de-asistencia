/**
 * Explicit historical-only recovery when the employee was deleted.
 *
 * A copied historical closure is immutable evidence: it does NOT regenerate
 * wages, loan installments, deductions or employee records. The original
 * closure remains intact and the standard recovered-closure outbox uploads
 * the copy. Never run without an explicit target and source selection.
 */
import indexedDBService from '../../services/IndexedDBService.js';
import { auth, db, doc, getDocFromServer } from '../../data/firebase.js';
import { PROJECTS_V1_COLLECTION, ALIASES_V1_COLLECTION, REGISTRY_COLLECTION, REGISTRY_DOC_ID } from './ProjectRegistry.js';
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
    // Even a local tombstone means the original work was recognized before:
    // it must be restored/reviewed rather than copied silently.
    const knownProjects = new Set(projectList.map(row => id(row.id)));
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

/**
 * Authoritative source-identity lookup; never use getDoc(), a cache, or a
 * catalog snapshot here. Any network/permission failure is a hard blocker.
 * Check the primary catalog, aliases and canonical project registry: a stale
 * device may not know about any of these Firestore records.
 */
export async function verifyHistoricalClosureSourceInCloud({
    uid, sourceProjectId, firestore = db, readServer = getDocFromServer
} = {}) {
    const user = id(uid), source = id(sourceProjectId);
    if (!user || !source || source.startsWith('legacy-unresolved:') || source.includes('/')) {
        throw new Error('No se pudo comprobar la identidad de la obra original. No se creó una copia.');
    }
    if (typeof readServer !== 'function') {
        throw new Error('No se puede verificar la obra original contra Firebase.');
    }
    const refs = [
        doc(firestore, 'users', user, PROJECTS_V1_COLLECTION, source),
        doc(firestore, 'users', user, ALIASES_V1_COLLECTION, source),
        doc(firestore, 'users', user, REGISTRY_COLLECTION, REGISTRY_DOC_ID)
    ];
    let records;
    try {
        records = await Promise.all(refs.map(ref => readServer(ref)));
    } catch (_) {
        throw new Error('No se pudo verificar la obra original con Firebase. Revisa conexión y permisos; no se guardó nada.');
    }
    if (records.some(snapshot => !snapshot || typeof snapshot.exists !== 'function')) {
        throw new Error('Respuesta no verificable de Firebase. No se guardó el cierre.');
    }
    if (records[0].exists() || records[1].exists()
        || (records[2].exists() && id(records[2].data()?.canonicalProjectId) === source)) {
        throw new Error('La obra original existe en Firebase o tiene una vinculación registrada. Sincroniza antes de recuperar.');
    }
    return { sourceProjectId: source, verifiedForUid: user };
}

/** Atomic local copy + durable outbox. No real cloud or employees touched. */
export async function saveHistoricalClosureRecovery({
    sourceId, targetProjectId, idb = indexedDBService,
    getUid = () => auth?.currentUser?.uid, now = () => Date.now(),
    verifyCloudSource = verifyHistoricalClosureSourceInCloud
} = {}) {
    const expectedUid = id(getUid());
    if (!expectedUid) throw new Error('Inicia sesión antes de recuperar un cierre histórico.');
    const isolated = () => isFullImportIsolationInProgress()
        || isProjectRepairIsolationInProgress() || isDetachedRestoreSyncBlocked();
    if (isolated()) throw new Error('Termina primero la restauración o reparación pendiente.');
    await idb.init();
    if (!idb.db?.transaction) throw new Error('El almacenamiento local no admite la recuperación atómica.');
    if (id(getUid()) !== expectedUid || isolated()) {
        throw new Error('La cuenta o la restauración cambió antes de verificar la obra.');
    }
    const sourceBefore = await idb.get('payrollClosures', sourceId);
    if (!sourceBefore) throw new Error('El cierre original ya no está disponible.');
    const sourceProjectId = id(sourceBefore.projectId);
    const sourceFingerprintBefore = JSON.stringify(sourceBefore);
    // Awaiting Firestore outside IndexedDB is essential; IDB transactions
    // cannot remain open over asynchronous network operations.
    const verification = await verifyCloudSource({ uid: expectedUid, sourceProjectId });
    if (verification?.sourceProjectId !== sourceProjectId
        || verification?.verifiedForUid !== expectedUid) {
        throw new Error('No se pudo comprobar la identidad de la obra original con Firebase.');
    }
    if (id(getUid()) !== expectedUid || isolated()) {
        throw new Error('La cuenta o la restauración cambió durante la verificación de Firebase.');
    }
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
                    const sourceLatest = data.payrollClosures.find(row => id(row.id) === id(sourceId));
                    if (!sourceLatest || id(sourceLatest.projectId) !== sourceProjectId
                        || JSON.stringify(sourceLatest) !== sourceFingerprintBefore) {
                        throw new Error('El cierre original cambió durante la comprobación remota. Reintenta.');
                    }
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

/**
 * Read-only verification of an orphaned payroll configuration's ownership.
 * Local catalog absence NEVER authorizes moving or deleting financial settings.
 * This returns status codes only; it never returns Firestore snapshots or
 * payroll configuration values and does not mutate IndexedDB or Firebase.
 */
import { db, auth, doc, getDocFromServer } from '../../data/firebase.js';
import {
    PROJECTS_V1_COLLECTION, ALIASES_V1_COLLECTION,
    REGISTRY_COLLECTION, REGISTRY_DOC_ID
} from './ProjectRegistry.js';

export const PAYROLL_CONFIG_ORIGIN_STATUS = Object.freeze({
    INVALID_ID: 'invalid-id',
    AUTH_REQUIRED: 'auth-required',
    LOCAL_PRESENT: 'local-present',
    REMOTE_PROJECT: 'remote-project',
    REMOTE_TOMBSTONE: 'remote-tombstone',
    REMOTE_ALIAS: 'remote-alias',
    BROKEN_ALIAS: 'broken-alias',
    CANONICAL_REFERENCE: 'canonical-reference',
    NOT_FOUND: 'not-found-remotely',
    ACCOUNT_CHANGED: 'account-changed',
    UNVERIFIED: 'unverified'
});

const id = value => String(value ?? '').trim();
const safeId = value => !!id(value) && !id(value).includes('/')
    && !id(value).startsWith('legacy-unresolved:')
    && !/[\x00-\x1F]/.test(id(value));

const result = (status, fields = {}) => ({ status, readOnly: true, ...fields });

export function describePayrollConfigOrigin(verification) {
    switch (verification?.status) {
        case PAYROLL_CONFIG_ORIGIN_STATUS.LOCAL_PRESENT:
            return 'La obra original figura en este dispositivo. Actualiza la revisión antes de cambiar cualquier configuración.';
        case PAYROLL_CONFIG_ORIGIN_STATUS.REMOTE_PROJECT:
            return 'La obra original existe en Firebase, pero falta en el catálogo local. Sincroniza obras y revisa de nuevo; no reasignes la configuración.';
        case PAYROLL_CONFIG_ORIGIN_STATUS.REMOTE_TOMBSTONE:
            return 'Firebase conserva una referencia de obra eliminada. Es un caso histórico: revisa la restauración y sus relaciones antes de decidir el destino.';
        case PAYROLL_CONFIG_ORIGIN_STATUS.REMOTE_ALIAS:
            return 'Firebase indica que esta obra usa otro identificador. Sincroniza el catálogo y comprueba la adopción del identificador antes de mover la configuración.';
        case PAYROLL_CONFIG_ORIGIN_STATUS.BROKEN_ALIAS:
            return 'Existe un alias remoto, pero no se pudo verificar su obra de destino. Requiere revisión de identidad; no se recomienda reasignar.';
        case PAYROLL_CONFIG_ORIGIN_STATUS.CANONICAL_REFERENCE:
            return 'La referencia sigue registrada como obra principal de la cuenta. Es necesario recuperar o conciliar su catálogo antes de reasignar.';
        case PAYROLL_CONFIG_ORIGIN_STATUS.NOT_FOUND:
            return 'Firebase no encontró la obra, su alias ni una referencia principal con este identificador. Revisa el respaldo y la obra de destino antes de una recuperación manual; no confirma borrado definitivo.';
        case PAYROLL_CONFIG_ORIGIN_STATUS.AUTH_REQUIRED:
            return 'Inicia sesión con la cuenta propietaria de los datos para verificar el origen en Firebase.';
        case PAYROLL_CONFIG_ORIGIN_STATUS.ACCOUNT_CHANGED:
            return 'La cuenta cambió durante la consulta. Se descartó el resultado; vuelve a iniciar la revisión.';
        case PAYROLL_CONFIG_ORIGIN_STATUS.INVALID_ID:
            return 'La referencia local no tiene un identificador válido. No se consultó ni modificó Firebase.';
        default:
            return 'No fue posible comprobar el origen en Firebase. Revisa la conexión y los permisos y vuelve a intentarlo. No se cambió ningún dato.';
    }
}

/**
 * Explicit network check. Call only in response to a user action: never on
 * every render or as a precondition inferred from an anonymous diagnostic.
 */
export async function inspectPayrollConfigOrigin({
    projectId, localProjects = [],
    getUid = () => auth?.currentUser?.uid,
    firestore = db, createDoc = doc, readServer = getDocFromServer
} = {}) {
    const project = id(projectId);
    if (!safeId(project)) return result(PAYROLL_CONFIG_ORIGIN_STATUS.INVALID_ID);
    const uid = id(getUid?.());
    if (!safeId(uid)) return result(PAYROLL_CONFIG_ORIGIN_STATUS.AUTH_REQUIRED);
    if (Array.isArray(localProjects) && localProjects.some(item => id(item?.id) === project)) {
        return result(PAYROLL_CONFIG_ORIGIN_STATUS.LOCAL_PRESENT, { projectId: project });
    }
    const ref = (collection, key) => createDoc(firestore, 'users', uid, collection, key);
    let docs;
    try {
        docs = await Promise.all([
            readServer(ref(PROJECTS_V1_COLLECTION, project)),
            readServer(ref(ALIASES_V1_COLLECTION, project)),
            readServer(ref(REGISTRY_COLLECTION, REGISTRY_DOC_ID))
        ]);
    } catch (_) {
        // Errors (offline, denied permissions, expired sessions) cannot count
        // as proof that a project is missing.
        return result(id(getUid?.()) === uid
            ? PAYROLL_CONFIG_ORIGIN_STATUS.UNVERIFIED
            : PAYROLL_CONFIG_ORIGIN_STATUS.ACCOUNT_CHANGED);
    }
    if (id(getUid?.()) !== uid) return result(PAYROLL_CONFIG_ORIGIN_STATUS.ACCOUNT_CHANGED);
    if (docs.some(item => !item || typeof item.exists !== 'function')) {
        return result(PAYROLL_CONFIG_ORIGIN_STATUS.UNVERIFIED);
    }
    const [remoteProject, alias, registry] = docs;
    if (remoteProject.exists()) {
        const data = remoteProject.data?.() || {};
        return result(data.deletedAt != null
            ? PAYROLL_CONFIG_ORIGIN_STATUS.REMOTE_TOMBSTONE
            : PAYROLL_CONFIG_ORIGIN_STATUS.REMOTE_PROJECT, {
            projectId: project, remotePayrollConfig: !!data.payrollConfig
        });
    }
    if (alias.exists()) {
        const canonical = id(alias.data?.()?.canonicalId);
        if (!safeId(canonical) || canonical === project) {
            return result(PAYROLL_CONFIG_ORIGIN_STATUS.BROKEN_ALIAS, { projectId: project });
        }
        try {
            const target = await readServer(ref(PROJECTS_V1_COLLECTION, canonical));
            if (id(getUid?.()) !== uid) return result(PAYROLL_CONFIG_ORIGIN_STATUS.ACCOUNT_CHANGED);
            if (!target || typeof target.exists !== 'function') {
                return result(PAYROLL_CONFIG_ORIGIN_STATUS.UNVERIFIED);
            }
            if (!target.exists() || target.data?.()?.deletedAt != null) {
                return result(PAYROLL_CONFIG_ORIGIN_STATUS.BROKEN_ALIAS, { projectId: project });
            }
        } catch (_) {
            return result(id(getUid?.()) === uid
                ? PAYROLL_CONFIG_ORIGIN_STATUS.UNVERIFIED
                : PAYROLL_CONFIG_ORIGIN_STATUS.ACCOUNT_CHANGED);
        }
        return result(PAYROLL_CONFIG_ORIGIN_STATUS.REMOTE_ALIAS, {
            projectId: project, canonicalProjectId: canonical
        });
    }
    if (registry.exists() && id(registry.data?.()?.canonicalProjectId) === project) {
        return result(PAYROLL_CONFIG_ORIGIN_STATUS.CANONICAL_REFERENCE, { projectId: project });
    }
    return result(PAYROLL_CONFIG_ORIGIN_STATUS.NOT_FOUND, { projectId: project });
}

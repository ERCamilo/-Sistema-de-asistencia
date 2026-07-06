/**
 * 🔀 EmployeesIncomingMerge.js (Fase 2, U2)
 *
 * Reemplaza el "reemplazo mayorista" del onApply de EmployeesLiveSync:
 * antes, CUALQUIER cambio remoto (aunque fuera a OTRO empleado) pisaba
 * TODA la lista local con el snapshot entrante de Firestore — una edición
 * local todavía no subida (p. ej. un préstamo recién registrado offline)
 * se perdía si llegaba un snapshot de otro empleado antes de que esa
 * edición terminara de subirse.
 *
 * mergeIncomingEmployees fusiona por-registro:
 *   - Presente en ambos lados → mergeEmployees (LWW por updatedAt, unión
 *     por id en loans/advances/etc.).
 *   - Solo en el snapshot entrante (alta de otro dispositivo) → se agrega.
 *   - Solo local, nunca visto antes en un snapshot entrante → se conserva
 *     (alta local todavía no subida).
 *   - Solo local, visto antes en un snapshot entrante (borrado confirmado
 *     en el servidor) → se remueve, SALVO que la edición local sea más
 *     nueva que la última versión confirmada del servidor (podría ser una
 *     edición offline en carrera con el borrado de otro dispositivo — ver
 *     unionById en EmployeeMerge.js: perder datos en silencio cuesta más
 *     que una demora visible en propagar un borrado).
 *
 * La "línea de base" (última versión conocida del servidor por id) vive a
 * nivel de módulo, igual que el patrón ya usado en EmployeesLiveSync.js
 * (_unsubscribe). Ningún caller la resetea explícitamente hoy — es
 * seguro porque `EmployeesLiveSync.start()` es un singleton que nunca se
 * detiene con `.stop()` en ningún flujo de app.js (ni siquiera el logout,
 * que NO recarga la página): un cambio de cuenta en la misma pestaña deja
 * la suscripción VIEJA colgada en vez de re-suscribirse y contaminar esta
 * línea de base con ids de otra cuenta. ⚠️ Si algún día se agrega
 * `EmployeesLiveSync.stop()` al logout (el fix natural para ESE bug
 * preexistente y no relacionado a esta unidad), agregar también
 * `resetIncomingMergeBaseline()` en el mismo punto.
 *
 * LÍMITE CONOCIDO: la línea de base solo vive en memoria y arranca vacía
 * en cada carga de página. Si el primer snapshot de la sesión encuentra
 * localmente un empleado YA borrado confirmado en el servidor (posible
 * solo por el fallback de error de carga en app.js, que reusa
 * state.employees si `loadAndMigrateEmployees` falla), ese empleado se
 * trata como "alta local sin subir" y puede resucitar hasta el próximo
 * login/recarga — no hay tombstone de borrado para empleados que permita
 * distinguir ambos casos sin una llamada previa. Aceptado como parte de
 * la misma filosofía que el resto de esta unidad (ver arriba).
 */

import { mergeEmployees } from './EmployeeMerge.js';

// Map, no objeto plano: con {} un id "__proto__" (alcanzable vía import de un
// backup crafteado) hace la asignación un no-op silencioso y la lectura
// devuelve Object.prototype — ese id quedaría como "nunca visto" para siempre
// y sus borrados remotos jamás se propagarían.
let _lastKnownIncomingById = new Map();

/**
 * Fusiona la lista local de empleados con el snapshot entrante de Firestore.
 * @param {Array<object>} localEmployees Lista local actual (state.employees).
 * @param {Array<object>} incomingEmployees Snapshot completo recibido del
 *   listener de Firestore (EmployeeRepository.subscribe).
 * @returns {Array<object>} La lista fusionada a asignar a state.employees.
 */
export function mergeIncomingEmployees(localEmployees, incomingEmployees) {
    const local = Array.isArray(localEmployees) ? localEmployees : [];
    const incoming = Array.isArray(incomingEmployees) ? incomingEmployees : [];

    const localById = new Map();
    local.forEach(e => { if (e && e.id != null) localById.set(String(e.id), e); });

    const incomingById = new Map();
    incoming.forEach(e => { if (e && e.id != null) incomingById.set(String(e.id), e); });

    const result = [];

    incomingById.forEach((incomingRecord, id) => {
        const localRecord = localById.get(id);
        result.push(localRecord ? mergeEmployees(incomingRecord, localRecord) : incomingRecord);
    });

    localById.forEach((localRecord, id) => {
        if (incomingById.has(id)) return; // ya resuelto arriba (fusionado)

        const lastKnownUpdatedAt = _lastKnownIncomingById.get(id);
        if (!Number.isFinite(lastKnownUpdatedAt)) {
            // Nunca visto en un snapshot entrante (o la línea de base para
            // este id es NaN/corrupta, lo cual NO cuenta como confirmación
            // válida de borrado): alta local todavía no subida.
            result.push(localRecord);
            return;
        }

        const localUpdatedAt = Number.isFinite(localRecord?.updatedAt) ? localRecord.updatedAt : -Infinity;
        if (localUpdatedAt > lastKnownUpdatedAt) {
            // Edición local posterior a la última sync confirmada: no confiar
            // en el borrado remoto, puede ser una carrera con una edición
            // offline todavía no subida.
            result.push(localRecord);
        }
        // si no: borrado remoto confirmado — se respeta (no se agrega).
    });

    // Nueva línea de base: SIEMPRE refleja el snapshot entrante actual
    // completo (no acumula ids que ya salieron de la nube).
    const nextBaseline = new Map();
    incomingById.forEach((rec, id) => {
        nextBaseline.set(id, Number.isFinite(rec?.updatedAt) ? rec.updatedAt : 0);
    });
    _lastKnownIncomingById = nextBaseline;

    // 🪦 Tombstones de empleado: state.employees se mantiene SIEMPRE limpio
    // (sin tombstoneados), así ninguna vista/lógica tiene que filtrar deletedAt.
    // El merge de arriba ya produjo deletedAt donde correspondía (un empleado
    // vivo local + un tombstone entrante más nuevo → mergeEmployees puso
    // deletedAt); acá se filtran esos registros. Una edición local más nueva
    // que el tombstone NO tiene deletedAt (revivió) y pasa el filtro.
    return result.filter(e => !Number.isFinite(e?.deletedAt));
}

/** Utilidad de test: reinicia la línea de base entre casos. */
export function resetIncomingMergeBaseline() {
    _lastKnownIncomingById = new Map();
}

export default mergeIncomingEmployees;

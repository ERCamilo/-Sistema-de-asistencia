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
 *   - Solo local, aunque apareciese antes en la nube → se conserva.
 *     La ausencia no demuestra una eliminación intencional: respuestas
 *     incompletas, de caché o de otro alcance no autorizan borrados.
 *     Una baja debe incluir evidencia explícita (deletedAt) y debe
 *     resolverse por el protocolo de bajas, no por diferencia de listas. *
 * No se mantiene línea de base para inferir borrados. La retención
 * de tombstones entre sesiones y la revisión receptora siguen pendientes
 * de un protocolo explícito y durable (#362–#364).
 */

import { mergeEmployees } from './EmployeeMerge.js';

/**
 * Fusiona la lista local de empleados con el snapshot entrante de Firestore.
 * @param {Array<object>} localEmployees Lista local actual (state.employees).
 * @param {Array<object>} incomingEmployees Datos recibidos del
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
        // Ni siquiera un snapshot anteriormente completo prueba que
        // la ausencia actual sea una baja. Conservar toda copia local
        // hasta recibir evidencia explícita de eliminación.
        if (!incomingById.has(id)) result.push(localRecord);
    });

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
    // Compatibilidad con pruebas anteriores: no existe línea de base borradora.
}

export default mergeIncomingEmployees;

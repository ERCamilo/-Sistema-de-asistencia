/**
 * 🧹 AttendanceCleanupRunner.js
 *
 * Orquestador (toca state + nube) del borrado robusto de historial de
 * asistencia. Reúne las funciones puras de AttendanceCleanup con los efectos:
 * tombstonear en state (dentro de batchSetState), reconstruir el índice, y
 * subir cada fecha tocada (canal 'daily' — así el borrado se propaga a los
 * demás dispositivos, no revive).
 *
 * Compartido por los 3 puntos que lo usan: eliminar empleado (lista),
 * wizard de duplicados, y la acción de Ajustes/Datos.
 */

import { state, stateManager, buildAttendanceIndex } from '../core/AppState.js';
import { saveApplicationData } from './PersistenceService.js';
import {
    collectEmployeeAttendanceKeys,
    collectOrphanAttendanceKeys,
    tombstoneAttendanceKeys
} from './AttendanceCleanup.js';

/** Tombstonea las claves dadas y sube las fechas tocadas. @returns {number} claves borradas */
function _purgeKeys(keys) {
    if (!Array.isArray(keys) || keys.length === 0) return 0;
    let touched = [];
    stateManager.batchSetState(() => {
        touched = tombstoneAttendanceKeys(state.attendance, keys).dateKeys;
        buildAttendanceIndex(); // muchas fechas → rebuild total
    });
    // Subir TODAS las fechas tocadas en UN solo guardado: dateKeys encola un
    // 'daily' por fecha (granular, con tombstone) pero un solo mirror/entities.
    // `immediate: true` evita el debounce (que además colapsaría a una sola
    // fecha). Antes se hacía un saveApplicationData({dateKey, immediate}) POR
    // fecha, lo que disparaba N mirrors completos = write amplification contra
    // la cuota (Judgment Day Ronda 2). saveApplicationData puede retornar una
    // Promise o `undefined` (p.ej. borrado local en curso): se encadena
    // `.catch()` sólo si es promesa, para no reventar con un TypeError síncrono.
    if (touched.length > 0) {
        try {
            const savePromise = saveApplicationData({ dateKeys: touched, immediate: true });
            if (savePromise && typeof savePromise.catch === 'function') {
                savePromise.catch(e => console.warn('⚠️ purge asistencia: fallo al subir', e));
            }
        } catch (e) { console.warn('⚠️ purge asistencia: fallo al subir', e); }
    }
    return keys.length;
}

/** Borra (tombstonea) TODO el historial de asistencia vivo de un empleado. */
export function purgeEmployeeAttendanceHistory(employeeId) {
    return _purgeKeys(collectEmployeeAttendanceKeys(state.attendance, employeeId));
}

/**
 * Borra la asistencia HUÉRFANA: registros vivos cuyo empleado ya no existe
 * (p.ej. eliminados sin borrar su historial). @returns {number} borrados
 */
export function purgeOrphanAttendance() {
    const liveIds = new Set((state.employees || []).map(e => String(e.id)));
    return _purgeKeys(collectOrphanAttendanceKeys(state.attendance, liveIds));
}

export default { purgeEmployeeAttendanceHistory, purgeOrphanAttendance };

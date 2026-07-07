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
    // Subir cada fecha tocada. saveApplicationData({dateKey}) la encola en el
    // canal 'daily' (granular, con tombstone). El outbox reintenta si falla.
    touched.forEach(dateKey => {
        try { saveApplicationData({ dateKey }); } catch (e) { console.warn('⚠️ purge asistencia: fallo al subir', dateKey, e); }
    });
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

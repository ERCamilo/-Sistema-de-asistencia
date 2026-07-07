/**
 * 🧹 AttendanceCleanup.js
 *
 * Borrado ROBUSTO del historial de asistencia. Como en Fase 1, NO se hace
 * `delete state.attendance[key]` (un delete de clave local nunca se propaga
 * a la nube y el registro resucita por el eco de otro dispositivo); se
 * tombstonea (present:false + deletedAt) para que el borrado viaje como dato.
 *
 * Este módulo solo COLECTA claves (funciones puras). El orquestador
 * (attendanceCleanupOrchestrator, con state) las tombstonea y sube las
 * fechas tocadas. Dos usos:
 *   - al eliminar un empleado: borrar SU historial (opcional, vía modal).
 *   - Ajustes/Datos: limpiar la asistencia HUÉRFANA (de empleados que ya no
 *     existen — p.ej. eliminados sin borrar su historial).
 */

import { tombstoneAttendanceWrite } from '../features/attendance/AttendanceRecordWriter.js';

// Las claves de asistencia son `${employeeId}-${YYYY-MM-DD}` (los últimos 11
// caracteres son `-YYYY-MM-DD`). Cuando falta att.employeeId, el id se infiere
// quitando ese sufijo (robusto ante ids con guiones, a diferencia de split).
function employeeIdOf(record, key) {
    if (record && record.employeeId != null && record.employeeId !== '') {
        return String(record.employeeId);
    }
    const k = String(key || '');
    return k.length > 11 ? k.slice(0, -11) : k;
}

function isTombstoned(record) {
    return !!record && record.deletedAt != null;
}

/**
 * Claves de asistencia VIVA (no tombstoneada) de un empleado.
 * @returns {string[]}
 */
export function collectEmployeeAttendanceKeys(attendance, employeeId) {
    const empId = String(employeeId || '').trim();
    if (!attendance || typeof attendance !== 'object' || !empId) return [];
    const out = [];
    for (const [key, rec] of Object.entries(attendance)) {
        if (isTombstoned(rec)) continue;
        if (employeeIdOf(rec, key) === empId) out.push(key);
    }
    return out;
}

/** Cuántos registros de asistencia VIVOS tiene un empleado (para el modal). */
export function countLiveAttendance(attendance, employeeId) {
    return collectEmployeeAttendanceKeys(attendance, employeeId).length;
}

/**
 * Claves de asistencia HUÉRFANA (viva) — cuyo empleado no está en el set de
 * ids vivos. Los ya tombstoneados no cuentan (idempotente).
 * @param {object} attendance
 * @param {Set<string>} liveEmployeeIds
 * @returns {string[]}
 */
export function collectOrphanAttendanceKeys(attendance, liveEmployeeIds) {
    if (!attendance || typeof attendance !== 'object') return [];
    const live = liveEmployeeIds instanceof Set ? liveEmployeeIds : new Set();
    const out = [];
    for (const [key, rec] of Object.entries(attendance)) {
        if (isTombstoned(rec)) continue;
        if (!live.has(employeeIdOf(rec, key))) out.push(key);
    }
    return out;
}

/**
 * Tombstonea (in-place) las claves dadas del objeto attendance y devuelve las
 * fechas únicas tocadas (para que el caller las suba: cada día viaja por el
 * canal 'daily'). El caller debe correr esto dentro de batchSetState y luego
 * reconstruir el índice + subir las dateKeys.
 * @returns {{dateKeys: string[]}}
 */
export function tombstoneAttendanceKeys(attendance, keys, now = Date.now()) {
    const dateKeys = new Set();
    if (attendance && typeof attendance === 'object' && Array.isArray(keys)) {
        for (const key of keys) {
            const rec = attendance[key];
            if (!rec) continue;
            attendance[key] = tombstoneAttendanceWrite(rec, now);
            const date = rec.date || (typeof key === 'string' && key.length > 11 ? key.slice(-10) : null);
            if (date) dateKeys.add(date);
        }
    }
    return { dateKeys: [...dateKeys] };
}

export default { collectEmployeeAttendanceKeys, countLiveAttendance, collectOrphanAttendanceKeys, tombstoneAttendanceKeys };

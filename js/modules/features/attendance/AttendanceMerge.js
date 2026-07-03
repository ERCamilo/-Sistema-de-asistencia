/**
 * 🔀 AttendanceMerge.js (Fase 1 — Portero por-registro, U3)
 *
 * Función pura que reemplaza el spread ciego `{...local, ...incoming}` que
 * usaban los 3 sitios de merge entrante (descarga completa + zonal
 * inicial/modificado). El spread ciego dejaba que CUALQUIER registro
 * entrante pisara al local sin comparar frescura — un dispositivo
 * desconectado que sube tarde con datos viejos pisaba ediciones locales
 * más nuevas.
 *
 * Reglas (mismo criterio que EmployeeMerge.js para consistencia):
 *   - Por cada clave, gana el registro con mayor `updatedAt`.
 *   - Empate → gana LOCAL (más conservador para el dispositivo con la
 *     sesión activa).
 *   - La AUSENCIA nunca borra: una clave que solo existe de un lado
 *     sobrevive intacta en el resultado — así es como un tombstone
 *     (tratado como un registro más, sin caso especial) logra propagar un
 *     borrado sin que la reconexión de otro dispositivo lo resucite.
 *
 * No muta los inputs. Los 8 sitios de escritura LOCAL siguen pasando por
 * stampAttendanceWrite/tombstoneAttendanceWrite (AttendanceRecordWriter.js) —
 * esta función es SOLO para el merge de datos que vienen de la nube.
 */

export function mergeAttendanceRecords(local, incoming) {
    const merged = { ...(local || {}) };

    for (const [key, incomingRecord] of Object.entries(incoming || {})) {
        const localRecord = merged[key];
        if (!localRecord) {
            merged[key] = incomingRecord;
            continue;
        }
        const localUpdatedAt = localRecord.updatedAt || 0;
        const incomingUpdatedAt = incomingRecord.updatedAt || 0;
        if (incomingUpdatedAt > localUpdatedAt) {
            merged[key] = incomingRecord;
        }
        // empate o incoming más viejo → se conserva local (ya está en merged)
    }

    return merged;
}

export default mergeAttendanceRecords;

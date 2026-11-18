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
 * Las notas con noteUpdatedAt tienen una revisión independiente dentro del
 * mismo proyecto. Para datos anteriores se conserva el criterio por registro.
 *
 * No muta los inputs. Los 8 sitios de escritura LOCAL siguen pasando por
 * stampAttendanceWrite/tombstoneAttendanceWrite (AttendanceRecordWriter.js) —
 * esta función es SOLO para el merge de datos que vienen de la nube.
 */

import { effectiveProjectId, peekEntityScope } from '../projects/EntityProjectScope.js';

export function mergeAttendanceRecords(local, incoming) {
    const merged = { ...(local || {}) };
    const scope = peekEntityScope();

    for (const [key, incomingRecord] of Object.entries(incoming || {})) {
        const localRecord = merged[key];
        if (!localRecord) {
            merged[key] = incomingRecord;
            continue;
        }
        const localUpdatedAt = localRecord.updatedAt || 0;
        const incomingUpdatedAt = incomingRecord.updatedAt || 0;
        if (incomingUpdatedAt > localUpdatedAt) {
            const samePosition = String(incomingRecord.selectedPosition || '') === String(localRecord.selectedPosition || '')
                && JSON.stringify((incomingRecord.positionHours || []).map(part => part.positionId)) === JSON.stringify((localRecord.positionHours || []).map(part => part.positionId));
            merged[key] = !incomingRecord.positionAssignments && localRecord.positionAssignments && samePosition
                ? { ...incomingRecord, positionAssignments: localRecord.positionAssignments } : incomingRecord;
        }
        // Versioned notes are merged independently from hours and position changes.
        // A record from an older client can inherit the last note revision without
        // taking ownership of it. Missing revisions never erase a versioned note.
        const sameProject = effectiveProjectId(localRecord, scope) === effectiveProjectId(incomingRecord, scope);
        if (sameProject && (Number.isFinite(localRecord.noteUpdatedAt) || Number.isFinite(incomingRecord.noteUpdatedAt))) {
            const noteRecord = (incomingRecord.noteUpdatedAt ?? -1) > (localRecord.noteUpdatedAt ?? -1)
                ? incomingRecord : localRecord;
            const attendance = merged[key];
            if (attendance !== noteRecord) {
                const combined = { ...attendance, notes: noteRecord.notes ?? '', noteUpdatedAt: noteRecord.noteUpdatedAt };
                delete combined.voiceNoteRequests;
                if (noteRecord.voiceNoteRequests) combined.voiceNoteRequests = noteRecord.voiceNoteRequests;
                merged[key] = combined;
            }
        }
        // empate o incoming más viejo → se conserva local (ya está en merged)
    }

    return merged;
}

export default mergeAttendanceRecords;

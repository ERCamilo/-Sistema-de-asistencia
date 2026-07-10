/**
 * 🔎 AttendancePositionAudit.js
 *
 * Funciones PURAS que sostienen el flujo "quitar una posición a un empleado
 * que trabajó días con ella":
 *
 *   - collectPositionDays: detecta los días VIVOS y PRESENTES que referencian
 *     una posición (para el modal de impacto: cuántos días, entre qué fechas,
 *     cuántas horas). Con employeeId audita a UN empleado (desasignar); sin
 *     employeeId audita a TODOS (guardia de eliminar del catálogo).
 *
 *   - reassignPositionDays: reescribe esos días a otra posición del empleado.
 *     Es una decisión EXPLÍCITA del usuario (el default del producto es
 *     conservar el historial: el pasado es un hecho). Cada registro tocado se
 *     estampa por el choke point (stampAttendanceWrite) para que el cambio
 *     gane el merge LWW y suba por el canal 'daily' — sin la estampa, la
 *     reescritura quedaría solo-local y resucitaría desde otro dispositivo.
 *
 * Solo cuentan registros vivos (sin deletedAt) y PRESENTES: un día ausente o
 * tombstoneado no es un día trabajado, y su selectedPosition es cosmético
 * (la posición sigue existiendo en el catálogo).
 */

import { stampAttendanceWrite } from '../features/attendance/AttendanceRecordWriter.js';

// Mismas convenciones que AttendanceCleanup: clave `${employeeId}-${YYYY-MM-DD}`,
// employeeId inferible del sufijo si falta en el registro.
function employeeIdOf(record, key) {
    if (record && record.employeeId != null && record.employeeId !== '') {
        return String(record.employeeId);
    }
    const k = String(key || '');
    return k.length > 11 ? k.slice(0, -11) : k;
}

function dateOf(record, key) {
    if (record && record.date) return record.date;
    const k = String(key || '');
    return k.length > 11 ? k.slice(-10) : null;
}

function isTombstoned(record) {
    return !!record && record.deletedAt != null;
}

/** Entrada de positionHours de la posición dada, o null. */
function positionEntryOf(record, positionId) {
    if (!Array.isArray(record?.positionHours)) return null;
    return record.positionHours.find(ph => ph && String(ph.positionId) === String(positionId)) || null;
}

function matchesPosition(record, positionId) {
    if (String(record?.selectedPosition ?? '') === String(positionId)) return true;
    return positionEntryOf(record, positionId) !== null;
}

/**
 * Días trabajados (vivos + presentes) que referencian la posición.
 *
 * @param {object} attendance mapa `${empId}-${fecha}` → registro
 * @param {object} opts
 * @param {string} [opts.employeeId] limitar a un empleado; sin él, todos
 * @param {string} opts.positionId
 * @returns {{keys: string[], dateKeys: string[], count: number,
 *            firstDate: string|null, lastDate: string|null, totalHours: number}}
 */
export function collectPositionDays(attendance, { employeeId, positionId } = {}) {
    const empId = employeeId != null ? String(employeeId).trim() : null;
    const out = { keys: [], dateKeys: [], count: 0, firstDate: null, lastDate: null, totalHours: 0 };
    if (!attendance || typeof attendance !== 'object' || !positionId) return out;

    const dates = new Set();
    for (const [key, rec] of Object.entries(attendance)) {
        if (isTombstoned(rec)) continue;
        if (rec?.present !== true) continue; // solo días TRABAJADOS
        if (empId && employeeIdOf(rec, key) !== empId) continue;
        if (!matchesPosition(rec, positionId)) continue;

        out.keys.push(key);
        const date = dateOf(rec, key);
        if (date) dates.add(date);

        // Horas de ESA posición: la entrada multi si existe (horas + extra);
        // si no, las horas del día simple. Suma lo registrado, sin inventar.
        const entry = positionEntryOf(rec, positionId);
        if (entry) {
            out.totalHours += (Number(entry.hours) || 0) + (Number(entry.overtimeHours) || 0);
        } else {
            out.totalHours += Number(rec.hoursWorked) || 0;
        }
    }

    out.dateKeys = [...dates];
    out.count = out.keys.length;
    if (out.dateKeys.length > 0) {
        const sorted = [...out.dateKeys].sort();
        out.firstDate = sorted[0];
        out.lastDate = sorted[sorted.length - 1];
    }
    return out;
}

/**
 * Reasigna (in-place sobre el mapa) los días trabajados del empleado en
 * `fromId` hacia `toId`. En días multi-posición, si ya existe una entrada de
 * `toId`, se FUSIONAN las horas (no se duplica la posición en el día).
 *
 * El caller es responsable de: correr esto dentro de batchSetState,
 * reconstruir el índice de asistencia y subir las dateKeys por el canal
 * 'daily' (mismo contrato que tombstoneAttendanceKeys).
 *
 * @returns {{changedKeys: string[], dateKeys: string[]}}
 */
export function reassignPositionDays(attendance, { employeeId, fromId, toId, now = Date.now() } = {}) {
    const result = { changedKeys: [], dateKeys: [] };
    if (!attendance || typeof attendance !== 'object' || !fromId || !toId || String(fromId) === String(toId)) {
        return result;
    }

    const affected = collectPositionDays(attendance, { employeeId, positionId: fromId });
    const dates = new Set();

    for (const key of affected.keys) {
        const rec = attendance[key];
        const copy = { ...rec };

        if (String(copy.selectedPosition ?? '') === String(fromId)) {
            copy.selectedPosition = toId;
        }

        if (Array.isArray(copy.positionHours)) {
            const fromEntry = positionEntryOf(copy, fromId);
            if (fromEntry) {
                const rest = copy.positionHours.filter(ph => ph !== fromEntry);
                const toEntry = rest.find(ph => ph && String(ph.positionId) === String(toId));
                if (toEntry) {
                    // Fusión: el día no puede tener dos entradas de la misma posición.
                    rest[rest.indexOf(toEntry)] = {
                        ...toEntry,
                        hours: (Number(toEntry.hours) || 0) + (Number(fromEntry.hours) || 0),
                        overtimeHours: (Number(toEntry.overtimeHours) || 0) + (Number(fromEntry.overtimeHours) || 0)
                    };
                    copy.positionHours = rest;
                } else {
                    copy.positionHours = [...rest, { ...fromEntry, positionId: toId }];
                }
            }
        }

        attendance[key] = stampAttendanceWrite(copy, now);
        result.changedKeys.push(key);
        const date = dateOf(rec, key);
        if (date) dates.add(date);
    }

    result.dateKeys = [...dates];
    return result;
}

export default { collectPositionDays, reassignPositionDays };

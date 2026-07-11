/**
 * 🧰 RestorePrepare.js — prepara un snapshot para que la restauración GANE.
 *
 * Incidente de campo 2026-07-11: restaurar aplicaba el snapshot con sus
 * estampas VIEJAS. Con el portero por-registro (LWW por updatedAt +
 * positionsUpdatedAt + tombstones), el dato restaurado perdía todos los
 * merges contra la nube "más nueva", el watermark de subida lo filtraba y
 * nunca viajaba, y el limpiador de integridad terminaba borrando las
 * posiciones de todos los empleados y propagando el borrado.
 *
 * Restaurar significa "quiero ESTE estado". Este módulo re-estampa todo el
 * snapshot con `now` para que:
 *   - cada entidad gane el LWW entrante (incluida la frescura fina de
 *     puestos) y REVIVA sobre tombstones más viejos;
 *   - el tracker de subida las vea como cambiadas (junto con el reset de
 *     watermarks que hace el caller) y el roster completo re-suba;
 *   - la asistencia viaje entera por el canal dateKeys (el espejo la
 *     excluye — sin fechas explícitas jamás subiría).
 *
 * Puro: no toca state, no muta el snapshot de entrada.
 */

import { stampAttendanceWrite } from '../features/attendance/AttendanceRecordWriter.js';

/**
 * @param {object|null} snapshotState — el `state` guardado dentro del snapshot.
 * @param {{now?: number}} [opts]
 * @returns {{employees: object[], positions: object[], leaders: object[],
 *            attendance: Object<string, object>, dateKeys: string[]}}
 */
export function prepareRestoredState(snapshotState, { now = Date.now() } = {}) {
    const src = (snapshotState && typeof snapshotState === 'object') ? snapshotState : {};

    const employees = (Array.isArray(src.employees) ? src.employees : []).map(e => ({
        ...e,
        updatedAt: now,
        positionsUpdatedAt: now
    }));
    const positions = (Array.isArray(src.positions) ? src.positions : []).map(p => ({
        ...p,
        updatedAt: now
    }));
    const leaders = (Array.isArray(src.leaders) ? src.leaders : []).map(l => ({
        ...l,
        updatedAt: now
    }));

    const attendance = {};
    const dates = new Set();
    Object.entries(src.attendance || {}).forEach(([key, rec]) => {
        if (!rec || typeof rec !== 'object') return;
        attendance[key] = stampAttendanceWrite(rec, now);
        if (rec.date) dates.add(rec.date);
    });

    return { employees, positions, leaders, attendance, dateKeys: [...dates] };
}

export default prepareRestoredState;

/**
 * ✍️ AttendanceRecordWriter.js (Fase 1 — Portero por-registro, U1b)
 *
 * Punto ÚNICO de estampado para toda escritura LOCAL de un registro de
 * asistencia. Antes, ~10 sitios en app.js hacían `state.attendance[key] = {...}`
 * directo, y sólo algunos estampaban `updatedAt` a mano (inconsistente): el
 * próximo sitio nuevo se olvidaba y reintroducía el bug del portero (un
 * registro sin frescura pierde en el merge por-registro de U3).
 *
 * Rutear cada escritura local por acá garantiza que TODAS lleven `updatedAt`
 * fresco. Es una función PURA (el `now` es inyectable para test): no toca
 * `state`, no hace coherencia ni batching — eso sigue siendo responsabilidad
 * del caller, sin cambios.
 *
 * ⚠️ NO usar para escrituras de sync ENTRANTE (merge zonal/mirror): esos
 * registros vienen de otro dispositivo con su PROPIO updatedAt, y re-estamparlo
 * con `now` destruiría la frescura que el merge LWW (U3) necesita comparar.
 */

/**
 * Devuelve una copia del registro con `updatedAt` estampado al momento de la
 * escritura local. Preserva el resto de los campos tal cual (incluido
 * `deletedAt` si el caller lo trae — el manejo de tombstones es U2).
 *
 * @param {object} record - el registro de asistencia a escribir
 * @param {number} [now] - timestamp de la escritura (default Date.now())
 * @returns {object} copia con updatedAt fresco
 */
export function stampAttendanceWrite(record, now = Date.now()) {
    return { ...record, updatedAt: now };
}

export default stampAttendanceWrite;

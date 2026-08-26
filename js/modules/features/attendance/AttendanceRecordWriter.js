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

import { peekEntityScope } from '../projects/ProjectContext.js';

/**
 * F1.5 (ADR-008) — NACIMIENTO: estampa el proyecto activo en un registro
 * NUEVO cuando el scope está habilitado. Flag OFF o scope sin resolver ⇒
 * no-op exacto (paridad legacy). Un registro que YA tiene su propia clave
 * `projectId` jamás se re-etiqueta: editar o tombstonear no cambia el
 * dueño (el merge entrante y los registros ajenos conservan su tag).
 *
 * @param {object} record - registro recién creado (o buffer intermedio)
 * @returns {object} el mismo registro, con projectId propio si correspondía
 */
export function stampBirthProject(record) {
    if (!record) return record;
    const scope = peekEntityScope();
    if (!scope.enabled || !scope.projectId) return record;
    if (Object.prototype.hasOwnProperty.call(record, 'projectId')) return record;
    record.projectId = scope.projectId;
    return record;
}

/**
 * Devuelve una copia del registro con `updatedAt` estampado al momento de la
 * escritura local. Preserva el resto de los campos tal cual.
 *
 * U2a — REVIVIR: si la escritura marca el registro como presente
 * (`present === true`), LIMPIA el tombstone (`deletedAt = null`). Marcar
 * presente un día es, por definición, revivirlo: no puede quedar a la vez
 * presente y borrado. Cualquier otra escritura (nota, present=false) PRESERVA
 * el `deletedAt` que traiga el registro — editar una nota en un día borrado no
 * lo revive.
 *
 * @param {object} record - el registro de asistencia a escribir
 * @param {number} [now] - timestamp de la escritura (default Date.now())
 * @returns {object} copia con updatedAt fresco (y deletedAt=null si revive)
 */
export function stampAttendanceWrite(record, now = Date.now()) {
    const stamped = stampBirthProject({ ...record, updatedAt: now });
    if (record.present === true) stamped.deletedAt = null; // revivir: presente ⇒ sin tombstone
    return stamped;
}

/**
 * U2a — TOMBSTONE: marca un registro como borrado en vez de sacar la clave del
 * mapa. Un `delete state.attendance[key]` local NUNCA se propaga a la nube
 * (`setDoc merge:true` no borra claves de mapa) → el borrado resucita vía el
 * eco de otro dispositivo. Marcarlo `deletedAt` hace que el borrado viaje como
 * DATO y sobreviva el merge.
 *
 * - `present = false`: los ~30 sitios que filtran `.present` lo tratan como
 *   ausente sin un solo cambio (incluida la nómina — no se paga un día borrado).
 * - `deletedAt = now`: el tombstone. La UI/coherencia que mira EXISTENCIA (no
 *   `.present`) debe filtrarlo aparte (U2c).
 * - `updatedAt = now`: un borrado local es una escritura local → frescura para
 *   ganarle en el merge LWW (U3) a un registro vivo más viejo de otro equipo.
 *
 * @param {object} record - el registro a tombstonear (se preservan sus campos)
 * @param {number} [now] - timestamp del borrado (default Date.now())
 * @returns {object} copia tombstoneada
 */
export function tombstoneAttendanceWrite(record, now = Date.now()) {
    const tomb = { ...record, present: false, deletedAt: now, updatedAt: now };
    // F1.5 micro-closure — regla congelada por Dirección: un tombstone hereda
    // el proyecto EFECTIVO del registro que elimina (projectId propio ?? el
    // Proyecto Predeterminado); JAMÁS se determina por activeProjectId a
    // secas. Borrar un legado sin projectId con la obra B activa NO convierte
    // el borrado en dato de B: viaja dueño del default para que el merge y el
    // scope filtering lo lleven al alcance correcto. Flag OFF o default sin
    // resolver ⇒ sin clave (paridad legacy exacta).
    if (record && !Object.prototype.hasOwnProperty.call(record, 'projectId')) {
        const scope = peekEntityScope();
        if (scope.enabled && scope.defaultProjectId) tomb.projectId = scope.defaultProjectId;
    }
    return tomb;
}

export default stampAttendanceWrite;

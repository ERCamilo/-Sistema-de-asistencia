/**
 * 🪦 NestedTombstones.js (Auditoría préstamos 2026-06-10, hallazgo P1)
 *
 * Problema: borrar un adelanto/bono/deducción hacía splice del arreglo y
 * guardaba, pero el merge con la nube (unionById = UNIÓN por id) re-agregaba
 * el item desde la copia remota → el borrado "no pegaba" y reaparecían
 * registros fantasma.
 *
 * Solución: cada borrado registra el id en emp.deletedItemIds[campo]
 * (tombstone). El merge (EmployeeMerge.mergeEmployees):
 *   1. Une los tombstones de ambos lados.
 *   2. Excluye del resultado cualquier item cuyo id esté tombstoneado.
 *   3. Propaga la unión en el resultado para proteger futuros merges.
 *
 * Los consumidores (nómina, UI) no cambian: los arreglos siguen sin contener
 * los items borrados. Un item "re-creado" recibe SIEMPRE un id nuevo, así
 * que los tombstones nunca bloquean entradas nuevas.
 *
 * Cap: las listas se capan a MAX_TOMBSTONES_PER_FIELD conservando los más
 * recientes (el final del arreglo). Si un tombstone antiquísimo se cae del
 * cap y un dispositivo congelado por meses reintroduce ese item, el usuario
 * puede volver a borrarlo — costo aceptable a cambio de no crecer sin tope.
 */

export const TOMBSTONE_FIELDS = Object.freeze(['loans', 'advances', 'bonuses', 'deductions']);
export const MAX_TOMBSTONES_PER_FIELD = 300;

/**
 * Registra el borrado de un item anidado en el empleado (o scratch del
 * perfil). Sube updatedAt para que el merge escalar no trate el cambio
 * como viejo.
 *
 * @param {object} emp   empleado maestro o scratch de perfil (se muta)
 * @param {string} field uno de TOMBSTONE_FIELDS
 * @param {string} id    id del item borrado
 * @returns {boolean} true si se registró
 */
export function recordNestedTombstone(emp, field, id) {
    if (!emp || typeof emp !== 'object') return false;
    if (!TOMBSTONE_FIELDS.includes(field)) return false;
    const key = String(id ?? '').trim();
    if (!key) return false;

    if (!emp.deletedItemIds || typeof emp.deletedItemIds !== 'object') {
        emp.deletedItemIds = {};
    }
    const list = Array.isArray(emp.deletedItemIds[field]) ? emp.deletedItemIds[field] : [];
    if (!list.includes(key)) list.push(key);
    emp.deletedItemIds[field] = list.slice(-MAX_TOMBSTONES_PER_FIELD);
    emp.updatedAt = Date.now();
    return true;
}

/**
 * Une dos mapas de tombstones campo por campo (unión deduplicada, capada).
 * No muta los inputs. Devuelve {} si ambos están vacíos.
 */
export function mergeTombstoneMaps(a, b) {
    const out = {};
    for (const field of TOMBSTONE_FIELDS) {
        const listA = Array.isArray(a?.[field]) ? a[field] : [];
        const listB = Array.isArray(b?.[field]) ? b[field] : [];
        if (listA.length === 0 && listB.length === 0) continue;
        const seen = new Set();
        const union = [];
        for (const id of [...listA, ...listB]) {
            const key = String(id ?? '').trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            union.push(key);
        }
        out[field] = union.slice(-MAX_TOMBSTONES_PER_FIELD);
    }
    return out;
}

/** Set de ids tombstoneados para un campo (consulta rápida en el merge). */
export function tombstoneSetFor(map, field) {
    const list = Array.isArray(map?.[field]) ? map[field] : [];
    return new Set(list.map(id => String(id)));
}

export default {
    TOMBSTONE_FIELDS,
    MAX_TOMBSTONES_PER_FIELD,
    recordNestedTombstone,
    mergeTombstoneMaps,
    tombstoneSetFor
};

/**
 * 🏗️ PettyCashObraFilter — qué cajas se listan según la obra activa.
 *
 * Con una obra activa se muestran sus cajas y las que no tienen obra
 * asignada (huérfanas: sin vínculo o vinculadas a una obra que no existe).
 * Las de otras obras se ocultan, pero NUNCA en silencio: `hiddenCount`
 * alimenta el enlace visible "Ver cajas de todas las obras (N)". La caja
 * seleccionada siempre se lista, aunque sea de otra obra (p. ej. al saltar
 * a un movimiento desde la búsqueda).
 *
 * Puro: no toca el estado ni los vínculos (contrato F1.7 / DEP-SA-001).
 */

import { getOfficialProjectId } from './PettyCashOfficialLink.js';

/** 'own' (de la obra), 'orphan' (sin obra válida) u 'other' (de otra obra). */
export function cajaObraRelation(caja, obraId, knownObraIds = []) {
    const link = getOfficialProjectId(caja);
    if (!link) return 'orphan';
    if (link === obraId) return 'own';
    const known = [...(knownObraIds || [])];
    if (known.length && !known.includes(link)) return 'orphan';
    return 'other';
}

/**
 * @returns {{visible: Array, hiddenCount: number, scoped: boolean}}
 */
export function filterCajasByObra(cajas, { obraId = null, knownObraIds = [], showAll = false, selectedId = null } = {}) {
    const list = Array.isArray(cajas) ? cajas.filter(caja => caja && caja.id != null) : [];
    if (!obraId) return { visible: list, hiddenCount: 0, scoped: false };
    const inObra = caja => cajaObraRelation(caja, obraId, knownObraIds) !== 'other';
    const hiddenCount = list.filter(caja => !inObra(caja)).length;
    const visible = showAll
        ? list
        : list.filter(caja => inObra(caja) || String(caja.id) === String(selectedId));
    return { visible, hiddenCount, scoped: true };
}

/**
 * Al cambiar de obra: conserva la caja seleccionada si es de la obra (o
 * huérfana); si no, elige la primera caja propia, luego la primera huérfana.
 * Devuelve el id a seleccionar (o null si no hay ninguna).
 */
export function pickCajaForObra(cajas, selectedId, { obraId = null, knownObraIds = [] } = {}) {
    const list = Array.isArray(cajas) ? cajas.filter(caja => caja && caja.id != null) : [];
    if (!obraId) return selectedId ?? list[0]?.id ?? null;
    const current = list.find(caja => String(caja.id) === String(selectedId));
    if (current && cajaObraRelation(current, obraId, knownObraIds) !== 'other') return current.id;
    const own = list.find(caja => cajaObraRelation(caja, obraId, knownObraIds) === 'own');
    if (own) return own.id;
    const orphan = list.find(caja => cajaObraRelation(caja, obraId, knownObraIds) === 'orphan');
    return orphan ? orphan.id : null;
}

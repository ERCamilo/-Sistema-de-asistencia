/**
 * 🛡️ MirrorSizeGuard.js (R4)
 *
 * El doc espejo users/{uid}/data/current tiene el límite DURO de 1 MiB de
 * Firestore. Las cuentas migradas (schemaVersion>=2) escriben empleados/
 * posiciones/líderes en subcolecciones, así que el doc espejo queda chico.
 * Las cuentas LEGACY (schemaVersion<2) llevan esas entidades INLINE: una nómina
 * grande con préstamos anidados puede superar 1 MiB y hacer que setDoc lance,
 * perdiendo el sync silenciosamente.
 *
 * Este guard mide el tamaño y decide si el write inline es seguro. NUNCA hay que
 * recortar entidades en silencio (eso perdería préstamos/empleados de la única
 * copia espejo de una cuenta legacy): la salida es pedir migración a per-doc.
 */

// Límite duro de un documento Firestore.
export const FIRESTORE_DOC_LIMIT_BYTES = 1048576; // 1 MiB
// Margen de aviso por debajo del límite (deja lugar a metadata: updatedAt,
// lastDevice, lastChangedBy y al overhead de codificación de Firestore).
export const MIRROR_SIZE_WARN_BYTES = 900000;

/**
 * Tamaño en bytes de un objeto serializado a JSON (UTF-8).
 * @param {*} obj
 * @returns {number}
 */
export function jsonByteLength(obj) {
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(str).length;
    }
    // Fallback (entornos sin TextEncoder): aproximación por code units.
    return unescape(encodeURIComponent(str)).length;
}

/**
 * Decide si el doc espejo puede escribirse inline o si la cuenta legacy necesita
 * migrar a per-doc.
 *
 * @param {Object} cleanState - el estado YA limpio que se escribiría en data/current
 * @param {number|undefined} schemaVersion - state.settings.schemaVersion
 * @returns {{bytes:number, ok:boolean, needsMigration:boolean}}
 *   ok=false / needsMigration=true SÓLO cuando la cuenta es legacy (<2) Y supera
 *   el margen: en ese caso el caller debe omitir el write inline y solicitar la
 *   migración, nunca recortar entidades en silencio.
 */
export function checkMirrorDocSize(cleanState, schemaVersion) {
    const bytes = jsonByteLength(cleanState);
    const isLegacy = !(typeof schemaVersion === 'number' && schemaVersion >= 2);
    const tooBig = bytes > MIRROR_SIZE_WARN_BYTES;
    const needsMigration = tooBig && isLegacy;
    return { bytes, ok: !needsMigration, needsMigration };
}

/**
 * 🗂️ CatalogIncomingMerge.js — puestos/líderes entrantes sin reemplazo mayorista.
 *
 * Incidente 2026-07-11: los LiveSync de cargos y líderes hacían
 * `state.positions = listaDeLaNube` (reemplazo TOTAL, sin merge). Una nube
 * envenenada o parcial pisaba el catálogo local sano y disparaba la cadena
 * que terminó borrando las posiciones de todos los empleados.
 *
 * Réplica del patrón de EmployeesIncomingMerge para entidades ESCALARES
 * (sin merge anidado — el registro con updatedAt más nuevo gana entero):
 *
 *   - registro en ambos lados → LWW por updatedAt (empate: gana la nube,
 *     que es la copia confirmada);
 *   - solo local y NUNCA visto en un snapshot entrante → alta local sin
 *     subir: se conserva;
 *   - solo local, aunque antes estuviera en la línea de base → conservar.
 *     Una ausencia no es evidencia explícita de baja y jamás destruye
 *     registros locales por diferencia de listas (#361).
 *
 * Cada catálogo mantiene un combinador independiente para compatibilidad,
 * pero ninguna ausencia de registros implica una eliminación.
 */

function _ts(rec) {
    return Number.isFinite(rec?.updatedAt) ? rec.updatedAt : null;
}

export function createCatalogIncomingMerge() {
    function mergeIncoming(localList, incomingList) {
        const local = Array.isArray(localList) ? localList : [];
        const incoming = Array.isArray(incomingList) ? incomingList : [];

        const localById = new Map();
        local.forEach(r => { if (r && r.id != null) localById.set(String(r.id), r); });

        const incomingById = new Map();
        incoming.forEach(r => { if (r && r.id != null) incomingById.set(String(r.id), r); });

        const result = [];

        incomingById.forEach((incomingRecord, id) => {
            const localRecord = localById.get(id);
            if (!localRecord) {
                result.push(incomingRecord);
                return;
            }
            const localTs = _ts(localRecord) ?? -Infinity;
            const incomingTs = _ts(incomingRecord) ?? -Infinity;
            result.push(localTs > incomingTs ? localRecord : incomingRecord);
        });

        localById.forEach((localRecord, id) => {
            // Las descargas vacías, parciales o de caché conservan
            // todas las entidades que no traen una baja explícita.
            if (!incomingById.has(id)) result.push(localRecord);
        });

        return result;
    }

    /** Utilidad de test: reinicia la línea de base. */
    mergeIncoming.resetBaseline = () => {}; // compatibilidad con pruebas previas

    return mergeIncoming;
}

export const mergeIncomingPositions = createCatalogIncomingMerge();
export const mergeIncomingLeaders = createCatalogIncomingMerge();

export default createCatalogIncomingMerge;

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
 *   - solo local pero SÍ estaba en la línea de base → borrado remoto
 *     confirmado: se elimina, SALVO que la copia local tenga una edición
 *     posterior a la última sync (carrera con un cambio offline no subido).
 *
 * Cada catálogo usa su PROPIA instancia (línea de base separada):
 * mergeIncomingPositions y mergeIncomingLeaders.
 */

function _ts(rec) {
    return Number.isFinite(rec?.updatedAt) ? rec.updatedAt : null;
}

export function createCatalogIncomingMerge() {
    // Map, no objeto plano: un id "__proto__" sobre un objeto plano es un
    // no-op silencioso (misma razón que EmployeesIncomingMerge).
    let _lastKnownIncomingById = new Map();

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
            if (incomingById.has(id)) return; // ya resuelto arriba

            const lastKnownUpdatedAt = _lastKnownIncomingById.get(id);
            if (!Number.isFinite(lastKnownUpdatedAt)) {
                // Nunca visto en un snapshot entrante: alta local sin subir.
                result.push(localRecord);
                return;
            }
            const localUpdatedAt = _ts(localRecord) ?? -Infinity;
            if (localUpdatedAt > lastKnownUpdatedAt) {
                // Edición local posterior a la última sync confirmada: puede
                // ser una carrera con un cambio offline — no confiar en el
                // borrado remoto.
                result.push(localRecord);
            }
            // si no: borrado remoto confirmado — no se agrega.
        });

        // Nueva línea de base: SIEMPRE el snapshot entrante actual completo.
        const nextBaseline = new Map();
        incomingById.forEach((rec, id) => {
            nextBaseline.set(id, Number.isFinite(rec?.updatedAt) ? rec.updatedAt : 0);
        });
        _lastKnownIncomingById = nextBaseline;

        return result;
    }

    /** Utilidad de test: reinicia la línea de base. */
    mergeIncoming.resetBaseline = () => { _lastKnownIncomingById = new Map(); };

    return mergeIncoming;
}

export const mergeIncomingPositions = createCatalogIncomingMerge();
export const mergeIncomingLeaders = createCatalogIncomingMerge();

export default createCatalogIncomingMerge;

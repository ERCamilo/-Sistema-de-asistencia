/**
 * 🚦 EntityUploadTracker.js (fix crítico post-Fase-2-U1)
 *
 * FirebaseService.saveEntities() (canal 'entities' del outbox, Fase 2 U1)
 * subía TODAS las entidades de un tipo (empleados/puestos/líderes) en CADA
 * guardado, sin importar si el guardado era por algo no relacionado (una
 * nota, un día de asistencia). Con mergeRemote:true (lectura + escritura
 * por entidad), eso agotó en horas la cuota diaria de Firestore de una
 * cuenta con 28 empleados + 20 puestos + 6 líderes.
 *
 * Cada tracker recuerda, por id, el updatedAt con el que se subió con
 * éxito la última vez. filterChanged() descarta los items cuyo updatedAt
 * no superó esa marca — solo lo que cambió de verdad (o nunca se subió)
 * vuelve a viajar. markUploaded() solo debe llamarse tras un saveMany
 * exitoso (si falla, el próximo intento debe volver a considerarlos
 * candidatos — más costoso que perder un borrado/edición en silencio).
 *
 * Map, no objeto plano: mismo motivo que EmployeesIncomingMerge.js — un id
 * "__proto__" sobre un objeto plano es un no-op silencioso.
 */

export function createEntityUploadTracker() {
    let lastUploadedById = new Map();

    return {
        /**
         * @param {Array<object>} items
         * @returns {Array<object>} solo los items cuyo updatedAt es más
         *   nuevo que la última subida exitosa registrada (o que nunca
         *   se subieron). Items sin id se descartan (no rastreables).
         */
        filterChanged(items) {
            const arr = Array.isArray(items) ? items : [];
            return arr.filter(item => {
                if (!item || item.id == null) return false;
                const key = String(item.id);
                const last = lastUploadedById.get(key);
                const current = Number.isFinite(item.updatedAt) ? item.updatedAt : 0;
                return !Number.isFinite(last) || current > last;
            });
        },

        /** Registrar como subidos con éxito. Llamar SOLO tras un saveMany exitoso. */
        markUploaded(items) {
            (Array.isArray(items) ? items : []).forEach(item => {
                if (!item || item.id == null) return;
                const current = Number.isFinite(item.updatedAt) ? item.updatedAt : 0;
                lastUploadedById.set(String(item.id), current);
            });
        },

        /** Utilidad de test / logout: olvida todo lo rastreado. */
        reset() {
            lastUploadedById = new Map();
        }
    };
}

export default createEntityUploadTracker;

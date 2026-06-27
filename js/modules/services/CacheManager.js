/**
 * 🧹 CacheManager — limpieza del Cache Storage del Service Worker.
 *
 * Borra los archivos que el Service Worker dejó cacheados y desregistra los
 * SW activos, para que al recargar la página baje la última versión publicada.
 * Es la salida para el clásico "no veo los cambios nuevos en el navegador".
 *
 * ⚠️ IMPORTANTE: el Cache Storage es DISTINTO de localStorage / IndexedDB.
 * Los datos del usuario (empleados, asistencia, configuración) viven en esos
 * otros almacenes y NO se tocan acá. Limpiar el cache es seguro respecto de
 * los datos.
 *
 * Las dependencias del navegador (`caches`, `navigator.serviceWorker`) se
 * inyectan para que la función sea testeable sin un navegador real.
 */

/**
 * @param {object} [deps]
 * @param {CacheStorage} [deps.cacheStorage] - por defecto `globalThis.caches`
 * @param {ServiceWorkerContainer} [deps.serviceWorker] - por defecto `navigator.serviceWorker`
 * @returns {Promise<{deletedCaches: number, unregistered: number}>}
 */
export async function clearAppCaches(deps = {}) {
    const cacheStorage = 'cacheStorage' in deps
        ? deps.cacheStorage
        : (typeof globalThis !== 'undefined' ? globalThis.caches : undefined);
    const serviceWorker = 'serviceWorker' in deps
        ? deps.serviceWorker
        : (typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined);

    let deletedCaches = 0;
    let unregistered = 0;

    // 1. Borrar todas las entradas de Cache Storage.
    if (cacheStorage && typeof cacheStorage.keys === 'function') {
        const keys = await cacheStorage.keys();
        await Promise.all(keys.map(k => cacheStorage.delete(k)));
        deletedCaches = keys.length;
    }

    // 2. Desregistrar los Service Workers activos (el próximo load registra
    //    uno fresco y vuelve a cachear la última versión).
    if (serviceWorker && typeof serviceWorker.getRegistrations === 'function') {
        const regs = await serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
        unregistered = regs.length;
    }

    return { deletedCaches, unregistered };
}

/**
 * 🧪 CacheManagerTests — limpieza del Cache Storage del Service Worker.
 *
 * clearAppCaches() borra los archivos cacheados (Cache Storage) y desregistra
 * los Service Workers para forzar la última versión al recargar. NO toca
 * localStorage ni IndexedDB (ahí viven los datos del usuario), así que es
 * seguro respecto de la información de empleados/asistencia.
 *
 * El módulo es puro respecto de las dependencias del navegador: se le inyectan
 * `cacheStorage` y `serviceWorker` para poder testearlo sin un navegador real.
 */

import { clearAppCaches } from '../modules/services/CacheManager.js';

describe('CacheManager — clearAppCaches', () => {

    test('borra TODAS las entradas de Cache Storage y desregistra los SW', async () => {
        const deleted = [];
        const fakeCaches = {
            keys: async () => ['app-v1', 'app-v2'],
            delete: async (k) => { deleted.push(k); return true; }
        };
        const unregistered = [];
        const fakeSW = {
            getRegistrations: async () => [
                { unregister: async () => { unregistered.push('a'); return true; } },
                { unregister: async () => { unregistered.push('b'); return true; } }
            ]
        };

        const res = await clearAppCaches({ cacheStorage: fakeCaches, serviceWorker: fakeSW });

        expect(deleted).toEqual(['app-v1', 'app-v2']);
        expect(unregistered).toEqual(['a', 'b']);
        expect(res).toEqual({ deletedCaches: 2, unregistered: 2 });
    });

    test('no rompe si no hay Cache Storage ni Service Worker disponibles', async () => {
        const res = await clearAppCaches({ cacheStorage: null, serviceWorker: null });
        expect(res).toEqual({ deletedCaches: 0, unregistered: 0 });
    });

    test('limpia el cache aunque no haya Service Worker (solo Cache Storage)', async () => {
        const deleted = [];
        const fakeCaches = {
            keys: async () => ['only-cache'],
            delete: async (k) => { deleted.push(k); return true; }
        };
        const res = await clearAppCaches({ cacheStorage: fakeCaches, serviceWorker: null });
        expect(deleted).toEqual(['only-cache']);
        expect(res).toEqual({ deletedCaches: 1, unregistered: 0 });
    });

});

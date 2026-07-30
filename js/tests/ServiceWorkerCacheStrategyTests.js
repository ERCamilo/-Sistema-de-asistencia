import fs from 'fs';
import path from 'path';

const SW_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../sw.js'), 'utf8');

testRunner.addSuite('Service Worker — consistencia de módulos JavaScript', {

    'los módulos propios usan Network First antes que Stale While Revalidate'() {
        const jsRule = SW_SOURCE.indexOf("url.pathname.endsWith('.js')");
        const jsNetworkFirst = SW_SOURCE.indexOf(
            'event.respondWith(networkFirstAsset(event.request))',
            jsRule
        );
        const genericStaleWhileRevalidate = SW_SOURCE.indexOf(
            'event.respondWith(staleWhileRevalidate(event.request))',
            jsRule
        );

        testRunner.assert(jsRule !== -1, 'debe existir una regla específica para .js');
        testRunner.assert(jsNetworkFirst > jsRule,
            'la regla .js debe usar Network First');
        testRunner.assert(genericStaleWhileRevalidate > jsNetworkFirst,
            'la regla genérica de assets debe ejecutarse después de la regla .js');
    },

    'el fallback de módulos no responde con index.html'() {
        const helperStart = SW_SOURCE.indexOf('async function networkFirstAsset');
        const helperEnd = SW_SOURCE.indexOf(
            'async function staleWhileRevalidate',
            helperStart
        );
        const helper = SW_SOURCE.slice(helperStart, helperEnd);

        testRunner.assert(helperStart !== -1, 'debe existir networkFirstAsset');
        testRunner.assert(helper.includes("cache: 'no-cache'"),
            'la red debe revalidar el módulo');
        testRunner.assert(!helper.includes("caches.match('./index.html')"),
            'un import nunca debe recibir el documento HTML como fallback');
    }

});

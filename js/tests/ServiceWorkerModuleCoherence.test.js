import fs from 'fs';
import path from 'path';

const serviceWorkerPath = path.resolve(__dirname, '../../sw.js');
const source = fs.readFileSync(serviceWorkerPath, 'utf8');

describe('Service Worker — coherencia de módulos JavaScript', () => {
    test('las hojas de estilo propias usan la misma estrategia de red que los módulos', () => {
        const styleRule = source.indexOf("url.pathname.endsWith('.css')");
        const networkFirstAfterRule = source.indexOf(
            'event.respondWith(networkFirstAsset(event.request, event))',
            styleRule
        );
        const genericStale = source.indexOf(
            'event.respondWith(staleWhileRevalidate(event.request))',
            styleRule
        );

        expect(styleRule).toBeGreaterThan(-1);
        expect(networkFirstAfterRule).toBeGreaterThan(styleRule);
        expect(genericStale).toBeGreaterThan(networkFirstAfterRule);
    });

    test('los scripts propios usan red primero', () => {
        expect(source).toContain("url.origin === self.location.origin");
        expect(source).toContain("url.pathname.endsWith('.js')");

        const scriptRule = source.indexOf("url.pathname.endsWith('.js')");
        const networkFirstAfterRule = source.indexOf(
            'event.respondWith(networkFirstAsset(event.request, event))',
            scriptRule
        );
        expect(scriptRule).toBeGreaterThan(-1);
        expect(networkFirstAfterRule).toBeGreaterThan(scriptRule);
    });

    test('la regla de scripts se evalúa antes del stale-while-revalidate genérico', () => {
        const scriptRule = source.indexOf("url.pathname.endsWith('.js')");
        const genericStale = source.indexOf(
            'event.respondWith(staleWhileRevalidate(event.request))'
        );
        expect(scriptRule).toBeGreaterThan(-1);
        expect(genericStale).toBeGreaterThan(scriptRule);
    });

    test('la ruta offline conserva el fallback del caché', () => {
        // networkFirstAsset delega en el helper con límite de espera, que es
        // quien cae a la copia del caché (ver ServiceWorkerSlowNetwork.test.js
        // para el comportamiento ejecutado).
        const assetStart = source.indexOf('async function networkFirstAsset(request, event)');
        const assetEnd = source.indexOf('async function staleWhileRevalidate(request)', assetStart);
        expect(source.slice(assetStart, assetEnd)).toContain('networkFirstWithDeadline(request, event');

        const helperStart = source.indexOf('async function networkFirstWithDeadline(');
        const helperEnd = source.indexOf('async function networkFirst(', helperStart);
        const helperSource = source.slice(helperStart, helperEnd);
        expect(helperStart).toBeGreaterThan(-1);
        expect(helperSource).toContain('const cached = await caches.match(request)');
        expect(helperSource).toContain('return cached');
    });
});

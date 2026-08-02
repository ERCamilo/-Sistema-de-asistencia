import fs from 'fs';
import path from 'path';

const serviceWorkerPath = path.resolve(__dirname, '../../sw.js');
const source = fs.readFileSync(serviceWorkerPath, 'utf8');

describe('Service Worker — coherencia de módulos JavaScript', () => {
    test('las hojas de estilo propias usan la misma estrategia de red que los módulos', () => {
        const styleRule = source.indexOf("url.pathname.endsWith('.css')");
        const networkFirstAfterRule = source.indexOf(
            'event.respondWith(networkFirstAsset(event.request))',
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
            'event.respondWith(networkFirstAsset(event.request))',
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
        const networkFirstStart = source.indexOf('async function networkFirstAsset(request)');
        const networkFirstEnd = source.indexOf(
            'async function staleWhileRevalidate(request)',
            networkFirstStart
        );
        const networkFirstSource = source.slice(networkFirstStart, networkFirstEnd);
        expect(networkFirstSource).toContain('const cached = await caches.match(request)');
        expect(networkFirstSource).toContain('if (cached) return cached');
    });
});

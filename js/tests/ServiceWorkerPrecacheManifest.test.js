import fs from 'fs';
import path from 'path';
import { loadServiceWorker } from './helpers/serviceWorkerHarness.js';

const projectRoot = path.resolve(__dirname, '../..');
const { collectPrecacheAssets, renderManifest, MANIFEST_FILE } = require('../../scripts/sw-precache.cjs');

const readManifest = () => {
    const file = path.join(projectRoot, MANIFEST_FILE);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
};

describe('Service Worker — manifiesto de precache del grafo de arranque', () => {
    const assets = collectPrecacheAssets(projectRoot);

    test('el manifiesto generado está al día (si falla: npm run sw:precache)', () => {
        expect(readManifest()).toBe(renderManifest(assets));
    });

    test('incluye el punto de entrada, sus dependencias y los módulos del index.html', () => {
        expect(assets).toEqual(expect.arrayContaining([
            './js/app.js',
            './js/boot-loader.js',
            './js/modules/data/firebase.js',
            './js/modules/services/PersistenceService.js',
            './js/modules/features/payroll/PayrollUI.js',
            './js/modules/config/BuildInfo.js',
            './js/modules/utils/BuildVersion.js'
        ]));
        // Grafo completo, no solo el app shell histórico (~160 entradas).
        expect(assets.filter((a) => a.endsWith('.js')).length).toBeGreaterThan(300);
    });

    test('usa la URL exacta que pide la página (Cache Storage compara la query)', () => {
        const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
        const hrefs = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map((m) => `./${m[1]}`);
        expect(hrefs.length).toBeGreaterThan(0);
        expect(assets).toEqual(expect.arrayContaining(hrefs));
        expect(assets).toContain('./css/employee_profile.css?v=2');
    });

    test('no incluye URLs externas ni archivos de test', () => {
        expect(assets.every((a) => a.startsWith('./'))).toBe(true);
        expect(assets.some((a) => a.includes('/tests/'))).toBe(false);
    });

    test('sw.js carga el manifiesto versionado y lo precachea completo al instalar', async () => {
        const manifest = ['./js/app.js', './js/modules/deep/OnlyInGraph.js', './css/employee_profile.css?v=2'];
        const sw = loadServiceWorker({ manifest });
        expect(sw.imported).toHaveLength(1);
        expect(sw.imported[0]).toMatch(/^\.\/sw-precache-manifest\.js\?v=/);

        await sw.install();

        for (const url of manifest) {
            expect(sw.store.has(new URL(url, 'https://app.test/').href)).toBe(true);
        }
        // El app shell estático (íconos, manifest) se sigue precacheando.
        expect(sw.store.has('https://app.test/manifest.json')).toBe(true);
    });

    test('un recurso caído no impide precachear el resto', async () => {
        const sw = loadServiceWorker({
            manifest: ['./js/a.js', './js/broken.js', './js/b.js'],
            network: (url) => (url.endsWith('/broken.js') ? { status: 404 } : {})
        });
        await sw.install();
        expect(sw.store.has('https://app.test/js/a.js')).toBe(true);
        expect(sw.store.has('https://app.test/js/b.js')).toBe(true);
        expect(sw.store.has('https://app.test/js/broken.js')).toBe(false);
    });
});

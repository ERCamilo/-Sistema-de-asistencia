/**
 * npm run build → dist/: lo que publica Cloudflare Pages.
 *
 * Contrato: dist/ es el sitio de siempre, pero con js/app.js empaquetado
 * (misma ruta, así index.html y sw.js no cambian), sin archivos de desarrollo,
 * y con un manifiesto de precache que apunta al paquete, no a los ~390 módulos.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const projectRoot = path.resolve(__dirname, '../..');

// esbuild no corre dentro de jsdom: el build se ejecuta como lo hará
// Cloudflare, en un proceso Node aparte.
function runBuild(out) {
    const stdout = execFileSync(process.execPath, [path.join(projectRoot, 'scripts/build.cjs'), '--out', out, '--json'], {
        cwd: projectRoot, encoding: 'utf8'
    });
    return JSON.parse(stdout.trim().split('\n').pop());
}

describe('scripts/build.cjs', () => {
    let out;
    let result;
    let repoDistBefore;
    const repoDist = path.join(projectRoot, 'dist');
    const repoManifest = path.join(projectRoot, 'sw-precache-manifest.js');
    let repoManifestBefore;
    const read = rel => fs.readFileSync(path.join(out, rel), 'utf8');
    const exists = rel => fs.existsSync(path.join(out, rel));

    beforeAll(() => {
        out = fs.mkdtempSync(path.join(os.tmpdir(), 'asistencia-dist-'));
        repoDistBefore = fs.existsSync(repoDist) ? fs.statSync(repoDist).mtimeMs : null;
        repoManifestBefore = fs.readFileSync(repoManifest, 'utf8');
        result = runBuild(out);
    }, 60000);

    afterAll(() => {
        fs.rmSync(out, { recursive: true, force: true });
    });

    test('publica el sitio: páginas, PWA, estilos, cabeceras de Cloudflare y .well-known', () => {
        for (const rel of ['index.html', 'sw.js', 'manifest.json', '_headers', 'privacy.html', 'delete-account.html',
            'icon-192.png', 'css/styles.css', 'css/employee_profile.css', 'js/boot-loader.js', 'js/p2p/P2PCore.js']) {
            expect(exists(rel)).toBe(true);
        }
        const wellKnown = fs.readdirSync(path.join(projectRoot, '.well-known'));
        expect(wellKnown.length).toBeGreaterThan(0);
        for (const name of wellKnown) expect(exists(`.well-known/${name}`)).toBe(true);
    });

    test('index.html y sw.js se publican sin cambios (el paquete conserva la ruta js/app.js)', () => {
        expect(read('index.html')).toBe(fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8'));
        expect(read('sw.js')).toBe(fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8'));
        expect(read('index.html')).toContain('<script type="module" src="js/app.js"></script>');
    });

    test('no publica archivos de desarrollo', () => {
        for (const rel of ['js/tests', 'node_modules', 'docs', 'supabase', 'scripts', 'infra', '.github', '.git',
            'package.json', 'pnpm-lock.yaml', 'jest.config.js', 'firestore.rules', 'dist']) {
            expect(exists(rel)).toBe(false);
        }
    });

    test('js/app.js es un solo paquete minificado: sin imports relativos y Firebase externo', () => {
        const bundle = read('js/app.js');
        expect(bundle).not.toMatch(/\bfrom\s*["']\.{1,2}\//);
        expect(bundle).not.toMatch(/\bimport\s*\(?\s*["']\.{1,2}\//);
        expect(bundle).toContain('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
        expect(bundle).toMatch(/\/\/# sourceMappingURL=app\.js\.map\s*$/);
        expect(exists('js/app.js.map')).toBe(true);
        expect(result.bundledModules).toBeGreaterThan(300);
        // Mucho más chico que el código fuente que reemplaza (~5.6 MB).
        expect(result.bundleBytes).toBeLessThan(4 * 1024 * 1024);
    });

    test('el manifiesto de precache apunta al paquete, no a los módulos sueltos', () => {
        const manifest = read('sw-precache-manifest.js');
        expect(manifest).toContain('"./js/app.js"');
        expect(manifest).toContain('"./js/boot-loader.js"');
        expect(manifest).toContain('"./css/employee_profile.css?v=2"');
        // El script inline del index.html sigue importando Config/BuildInfo sueltos.
        expect(manifest).toContain('"./js/modules/config/Config.js"');
        expect(manifest).not.toContain('"./js/modules/services/PersistenceService.js"');
        expect(manifest).not.toContain('"./js/modules/features/payroll/PayrollUI.js"');
        expect(result.precache.length).toBeLessThan(60);
    });

    test('compilar hacia otra carpeta no modifica el repositorio', () => {
        // El manifiesto de desarrollo sigue listando los módulos sueltos…
        expect(fs.readFileSync(repoManifest, 'utf8')).toBe(repoManifestBefore);
        expect(repoManifestBefore).toContain('"./js/modules/services/PersistenceService.js"');
        // …y un dist/ local (si alguien compiló antes) queda intacto.
        expect(fs.existsSync(repoDist) ? fs.statSync(repoDist).mtimeMs : null).toBe(repoDistBefore);
    });
});

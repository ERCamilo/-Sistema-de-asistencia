/**
 * scripts/resolve-build-version-conflicts.mjs: solo resuelve conflictos cuyo
 * único contenido es la línea de versión del build.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.resolve(__dirname, '../../scripts/resolve-build-version-conflicts.mjs'), 'utf8');
// El script es ESM y Jest corre en CJS: se evalúa solo la función pura.
const body = SRC.slice(SRC.indexOf('const PATTERNS'), SRC.indexOf('if (import.meta.url'))
    .replace(/^export /gm, '');
const { resolveVersionConflicts, VERSION_RE } = new Function(body + '; return { resolveVersionConflicts, VERSION_RE };')();

const conflict = (ours, theirs) => ['<<<<<<< HEAD', ours, '=======', theirs, '>>>>>>> origin/main'].join('\n');

describe('resolución automática de conflictos de versión', () => {
    test('reemplaza el bloque de CACHE_VERSION por la versión nueva y conserva lo demás', () => {
        const text = ['// sw', conflict("const CACHE_VERSION = '2026.0928.232908'", "const CACHE_VERSION = '2026.0929.064300'"),
            "const CACHE_NAME = `asistencia-v${CACHE_VERSION}`;", "    './js/modules/features/projects/ProjectNames.js',"].join('\n');
        const result = resolveVersionConflicts(text, '2026.0929.120000');
        expect(result).toMatchObject({ ok: true, resolved: 1 });
        expect(result.text).toBe(['// sw', "const CACHE_VERSION = '2026.0929.120000'",
            "const CACHE_NAME = `asistencia-v${CACHE_VERSION}`;", "    './js/modules/features/projects/ProjectNames.js',"].join('\n'));
    });

    test('resuelve también BuildInfo.js', () => {
        const result = resolveVersionConflicts(conflict("export const BUILD = '2026.0928.1'", "export const BUILD = '2026.0929.2'"), '2026.0929.120000');
        expect(result.text).toBe("export const BUILD = '2026.0929.120000'");
    });

    test('cualquier otro conflicto se deja para una persona', () => {
        const other = conflict("    './js/a.js',", "    './js/b.js',");
        expect(resolveVersionConflicts(other, '2026.0929.120000')).toMatchObject({ ok: false });
        const mixed = conflict("const CACHE_VERSION = '1'\nconst X = 1", "const CACHE_VERSION = '2'");
        expect(resolveVersionConflicts(mixed, '2026.0929.120000')).toMatchObject({ ok: false });
    });

    test('sin conflictos no cambia nada', () => {
        expect(resolveVersionConflicts("const CACHE_VERSION = 'x'", '2026.0929.120000')).toEqual({ ok: true, text: "const CACHE_VERSION = 'x'", resolved: 0 });
    });

    test('valida el formato de versión del hook', () => {
        expect(VERSION_RE.test('2026.0929.064300')).toBe(true);
        expect(VERSION_RE.test('2026.1332.250000')).toBe(false);
    });

    test('los PRs solo reciben conflictos de versión resueltos; main solo recibe el commit de versión', () => {
        const wf = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/refresh-pr-build-version.yml'), 'utf8');
        expect(wf).toMatch(/git push --quiet origin "HEAD:\$BRANCH"/);
        // El único push a main es el de la versión (Config + sw.js + BuildInfo), con reintento.
        expect(wf.match(/push[^\n]*\bmain\b/g)).toEqual(['push --quiet origin HEAD:main']);
        expect(wf).toMatch(/git add js\/modules\/config\/Config\.js sw\.js js\/modules\/config\/BuildInfo\.js/);
        expect(wf).toMatch(/\$3 \+ 1/);
        expect(wf).toMatch(/conflictos que requieren revisión[\s\S]*git merge --abort/);
        expect(wf).toMatch(/select\(\.isCrossRepository \| not\)/);
    });
});

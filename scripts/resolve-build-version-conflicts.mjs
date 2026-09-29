#!/usr/bin/env node
/**
 * Resuelve SOLO los conflictos de merge cuyo único contenido es la línea de
 * versión del build (sw.js CACHE_VERSION / BuildInfo.js BUILD). El hook de
 * pre-commit estampa esa línea en cada commit, así que dos PRs abiertos a la
 * vez siempre chocan ahí aunque el resto no se toque.
 *
 *   node scripts/resolve-build-version-conflicts.mjs <version> <archivo>...
 *
 * Cada bloque <<<<<<< … >>>>>>> cuyos dos lados contienen únicamente la línea
 * de versión se reemplaza por esa línea con <version>. Si un archivo tiene
 * cualquier otro conflicto no se escribe y la salida es 2 (resolución manual).
 */
import fs from 'node:fs';

const PATTERNS = [
    /^const CACHE_VERSION = '[^']*';?$/,
    /^export const BUILD = '[^']*';?$/
];
export const VERSION_RE = /^\d{4}\.(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\.([01]\d|2[0-3])[0-5]\d[0-5]\d$/;

const isVersionLine = line => PATTERNS.some(pattern => pattern.test(line.trim()));

export function resolveVersionConflicts(text, version) {
    const lines = text.split('\n');
    const out = [];
    let resolved = 0;
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('<<<<<<< ')) { out.push(lines[i]); continue; }
        const mid = lines.indexOf('=======', i + 1);
        const end = lines.findIndex((line, index) => index > mid && line.startsWith('>>>>>>> '));
        if (mid < 0 || end < 0) return { ok: false, reason: 'marcadores incompletos' };
        const ours = lines.slice(i + 1, mid).filter(line => line.trim());
        const theirs = lines.slice(mid + 1, end).filter(line => line.trim());
        const onlyVersion = ours.length === 1 && theirs.length === 1
            && isVersionLine(ours[0]) && isVersionLine(theirs[0])
            && ours[0].trim().split(' = ')[0] === theirs[0].trim().split(' = ')[0];
        if (!onlyVersion) return { ok: false, reason: 'conflicto que no es solo de versión' };
        const indent = ours[0].match(/^\s*/)[0];
        out.push(indent + ours[0].trim().replace(/'[^']*'/, `'${version}'`));
        resolved++;
        i = end;
    }
    return { ok: true, text: out.join('\n'), resolved };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const [version, ...files] = process.argv.slice(2);
    if (!VERSION_RE.test(version || '') || !files.length) {
        console.error('Uso: resolve-build-version-conflicts.mjs <YYYY.MMDD.HHmmss> <archivo>...');
        process.exit(1);
    }
    const results = files.map(file => ({ file, ...resolveVersionConflicts(fs.readFileSync(file, 'utf8'), version) }));
    const blocked = results.filter(result => !result.ok);
    if (blocked.length) {
        for (const result of blocked) console.error(`✗ ${result.file}: ${result.reason}`);
        process.exit(2);
    }
    for (const result of results) {
        fs.writeFileSync(result.file, result.text);
        console.log(`✓ ${result.file}: ${result.resolved} conflicto(s) de versión → ${version}`);
    }
}

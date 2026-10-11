#!/usr/bin/env node
/**
 * Production build → dist/ (what Cloudflare Pages publishes).
 *
 * Why: the app reached the phone as ~390 separate ES modules (~5.6 MB of
 * source). Requesting them in an import waterfall and parsing them all cost
 * ~2.75 s to first use on a 4G phone (4x CPU, brotli + HTTP/2); bundled and
 * minified it is ~1.5 s, 414 → 31 requests (measured 2026-10-11).
 *
 * Steps
 *   1. Copy the site into dist/, leaving out development-only files.
 *   2. Bundle js/app.js (and everything it imports) into dist/js/app.js —
 *      same path, so index.html, sw.js and the boot loader need no changes.
 *      Firebase stays external (loaded from gstatic at runtime).
 *   3. Regenerate dist/sw-precache-manifest.js from dist/ so the Service
 *      Worker precaches the bundle instead of the ~390 source modules.
 *
 * Source stays the source of truth: local development (any static server
 * on the repo root) and the Jest suite keep using the unbundled modules.
 *
 * Usage: npm run build            → ./dist
 *        node scripts/build.cjs --out <dir> [--json]
 * Kept honest by js/tests/BuildScript.test.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { collectPrecacheAssets, renderManifest, MANIFEST_FILE } = require('./sw-precache.cjs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = 'js/app.js';

/** Top-level paths (relative to the repo root) that are never published. */
const EXCLUDED = new Set([
    '.git', '.github', '.githooks', '.claude', '.vscode', '.legacy-archive',
    '.firebaserc', '.gitignore',
    'node_modules', 'dist', 'docs', 'openspec', 'supabase', 'infra', 'scripts', '__mocks__',
    'package.json', 'package-lock.json', 'pnpm-lock.yaml',
    'jest.config.js', 'jest.emulator.config.cjs', 'jest.setup.js', 'babel.config.json',
    'firebase.json', 'firebase.sync-lab.json', 'firestore.rules', 'firestore.indexes.json', 'storage.rules',
    'capture_screenshots.js'
]);
/** Nested paths that are never published. */
const EXCLUDED_NESTED = new Set(['js/tests']);

function copySite(root, out) {
    const walk = (rel) => {
        const from = path.join(root, rel);
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            if (!rel && EXCLUDED.has(entry.name)) continue;
            if (EXCLUDED_NESTED.has(childRel)) continue;
            const src = path.join(root, childRel);
            const dest = path.join(out, childRel);
            if (entry.isDirectory()) {
                fs.mkdirSync(dest, { recursive: true });
                walk(childRel);
            } else if (entry.isFile()) {
                fs.copyFileSync(src, dest);
            }
        }
    };
    fs.mkdirSync(out, { recursive: true });
    walk('');
}

function bundle(root, out) {
    const result = esbuild.buildSync({
        entryPoints: [path.join(root, ENTRY)],
        outfile: path.join(out, ENTRY),
        bundle: true,
        format: 'esm',
        target: 'es2020',
        minify: true,
        sourcemap: 'linked',
        legalComments: 'none',
        external: ['https://*'],
        logLevel: 'silent',
        metafile: true,
        allowOverwrite: true
    });
    const errors = result.errors || [];
    if (errors.length) throw new Error(`esbuild: ${errors.map(e => e.text).join('; ')}`);
    return result;
}

function build({ root = ROOT, out = path.join(ROOT, 'dist'), log = console.log } = {}) {
    const started = Date.now();
    fs.rmSync(out, { recursive: true, force: true });
    copySite(root, out);
    const result = bundle(root, out);
    const assets = collectPrecacheAssets(out);
    fs.writeFileSync(path.join(out, MANIFEST_FILE), renderManifest(assets));

    const bundled = Object.keys(result.metafile.inputs).length;
    const bytes = fs.statSync(path.join(out, ENTRY)).size;
    log(`✓ dist ready in ${Date.now() - started} ms — ${bundled} modules → ${ENTRY} (${(bytes / 1024).toFixed(0)} KB), ${assets.length} precached assets`);
    return { out, bundledModules: bundled, bundleBytes: bytes, precache: assets, warnings: result.warnings };
}

module.exports = { build, EXCLUDED, EXCLUDED_NESTED };

if (require.main === module) {
    const i = process.argv.indexOf('--out');
    const out = i > -1 ? path.resolve(process.argv[i + 1]) : undefined;
    const json = process.argv.includes('--json');
    try {
        const result = build({ ...(out ? { out } : {}), log: json ? () => {} : console.log });
        if (json) {
            const { bundledModules, bundleBytes, precache } = result;
            console.log(JSON.stringify({ out: result.out, bundledModules, bundleBytes, precache }));
        }
    } catch (error) {
        console.error(`✗ build failed: ${error.message}`);
        process.exitCode = 1;
    }
}

#!/usr/bin/env node
/**
 * check-state-writes.mjs — Anti-debt guard for the global `state` decoupling effort.
 *
 * Counts direct `state.x = ...` (and `delete state.x`) writes per source file and
 * compares them against a committed baseline. The build FAILS only when a file's
 * write count INCREASES (or a new file introduces writes). Counts that drop are
 * welcome — that is the ratchet: debt can only go down.
 *
 * It does NOT rewrite anything and adds no runtime dependency. It is a dev-time
 * fence against NEW direct-mutation debt while the remaining direct writes (see
 * scripts/state-writes-baseline.json) are migrated to the managed API
 * (stateManager.batchSetState) incrementally.
 *
 * Usage:
 *   node scripts/check-state-writes.mjs                 # check against baseline (CI / pre-commit)
 *   node scripts/check-state-writes.mjs --update-baseline   # regenerate the baseline after a migration
 *   STATE_GUARD_OFF=1 node scripts/check-state-writes.mjs   # escape hatch (always passes)
 *
 * Known limitation: line-regex based. Multi-line writes, computed keys spanning
 * lines, or aliased references (`const s = state; s.x = ...`) can evade it. It is
 * a fence against the common case, not a type system.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, 'js');
const BASELINE_PATH = join(ROOT, 'scripts', 'state-writes-baseline.json');

// Directories (by name) skipped entirely.
const EXCLUDE_DIRS = new Set(['tests']);
// Files that legitimately own state writes (the state core itself).
const EXCLUDE_FILES = new Set([
    'js/modules/core/AppState.js',
    'js/modules/core/RenderManager.js',
]);

// A write is `state` followed by one or more `.prop` / `[key]` accessors then `=`
// (not `==`, `===`, `=>`). The leading class avoids matching `foo.state.x`.
const WRITE_RE = /(^|[^.\w$])state\s*(\.[A-Za-z0-9_$]+|\[[^\]\n]+\])+\s*(\+\+|--|[-+*/]?=(?![=>]))/;
const DELETE_RE = /(^|[^.\w$])delete\s+state\s*(\.[A-Za-z0-9_$]+|\[[^\]\n]+\])/;

// A write is "managed" (not debt) when it sits inside a batchSetState/silentSetState
// callback — the render scheduling is then controlled. Since Fase 4 Paso 4 the proxy
// is domain-agnostic and attendance coherence is maintained EXPLICITLY by the handlers
// (invalidateEmployeeStats + buildAttendanceIndex), so an attendance write inside a
// batch is just as managed as any other — no special case (the old EXCEPTION here that
// kept batched attendance as debt was a pre-Paso-4 carryover and is now removed).
const MANAGED_OPENER_RE = /\b(batchSetState|silentSetState)\s*\(/;

function walk(dir, acc = []) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
            if (!EXCLUDE_DIRS.has(ent.name)) walk(p, acc);
        } else if (ent.isFile() && ent.name.endsWith('.js') && !ent.name.endsWith('.test.js')) {
            acc.push(p);
        }
    }
    return acc;
}

function relPosix(file) {
    return relative(ROOT, file).split(sep).join('/');
}

function countWrites(file) {
    const text = readFileSync(file, 'utf8');
    let n = 0;
    let depth = 0;
    const managed = []; // brace depths at which a batchSetState/silentSetState body is open
    for (const line of text.split('\n')) {
        const t = line.trim();
        const isComment = t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
        if (!isComment && (WRITE_RE.test(line) || DELETE_RE.test(line))) {
            const insideManaged = managed.length > 0;
            if (!insideManaged) n++;
        }
        // Track brace balance for this line, closing managed blocks as they end.
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                while (managed.length && managed[managed.length - 1] > depth) managed.pop();
            }
        }
        // A managed callback opened on this line: its body sits at the current depth.
        if (MANAGED_OPENER_RE.test(line)) managed.push(depth);
    }
    return n;
}

function scan() {
    const counts = {};
    for (const file of walk(SCAN_DIR)) {
        const rel = relPosix(file);
        if (EXCLUDE_FILES.has(rel)) continue;
        const n = countWrites(file);
        if (n > 0) counts[rel] = n;
    }
    return counts;
}

function total(counts) {
    return Object.values(counts).reduce((a, b) => a + b, 0);
}

const counts = scan();

if (process.argv.includes('--update-baseline')) {
    const sorted = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
    writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
    console.log(`✓ Baseline actualizado: ${Object.keys(sorted).length} archivos, ${total(sorted)} escrituras directas a state.`);
    process.exit(0);
}

if (process.env.STATE_GUARD_OFF) {
    console.log('⚠ STATE_GUARD_OFF: check de escrituras a state omitido.');
    process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
    console.error('✗ No existe scripts/state-writes-baseline.json. Generalo con: npm run lint:state -- --update-baseline');
    process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const violations = [];
const improvements = [];

for (const [file, n] of Object.entries(counts)) {
    const base = baseline[file] ?? 0;
    if (n > base) violations.push({ file, base, now: n });
    else if (n < base) improvements.push({ file, base, now: n });
}

if (improvements.length) {
    console.log('↓ Deuda reducida (acordate de correr --update-baseline para fijar el avance):');
    for (const i of improvements) console.log(`    ${i.file}: ${i.base} → ${i.now}`);
}

if (violations.length) {
    console.error('\n✗ Escrituras directas a `state` por encima del baseline:');
    for (const v of violations) {
        const label = v.base === 0 ? 'archivo nuevo' : `era ${v.base}`;
        console.error(`    ${v.file}: ${v.now}  (${label})`);
    }
    console.error('\n  Envolvé las mutaciones en stateManager.batchSetState(() => { ... }) en vez de escribir state.x directo.');
    console.error('  NO uses setState({...}): hace Object.assign sobre el _state crudo y saltea el proxy (desincroniza statsCache/attendanceByDate).');
    process.exit(1);
}

console.log(`✓ Sin deuda nueva. ${total(counts)} escrituras directas a state en ${Object.keys(counts).length} archivos (baseline ${total(baseline)}).`);
process.exit(0);


const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const MINI = false;
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'scripts/release-manifest.cjs');
const canonical = MINI ? 'src/app-version.ts' : 'js/modules/config/AppVersion.js';
const template = fs.readFileSync(path.join(root, canonical), 'utf8');
const older = { version: '1.9.0', date: '2026-10-20', title: 'Anterior', items: ['Novedad anterior.'] };
const newer = { version: '1.10.0', date: '2026-10-21', title: 'Nueva entrega', items: ['Corregimos la actualización sin perder cambios.'] };
function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-guard-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (name, value) => { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  function release(entry, history = [], options = {}) {
    const list = [entry, ...history];
    const source = template.replace(/const APP_VERSION = '[^']+'/, `const APP_VERSION = '${entry.version}'`).replace(/const CHANGELOG(?:\s*:\s*AppRelease\[\])? = \[[\s\S]*?\n\s*\];/, `const CHANGELOG${MINI ? ': AppRelease[]' : ''} = ${JSON.stringify(list, null, 2)};`);
    write(canonical, source); write('app-release.json', JSON.stringify({ version: entry.version, changelog: list }, null, 2) + '\n');
    write('sw.js', `const CACHE_VERSION = '${MINI ? 'asistencia-v' + entry.version + '-' : ''}${options.stamp || entry.version}';\nself.addEventListener('fetch', () => {});\n`);
    if (MINI) {
      const ts = require(path.join(root, 'node_modules/typescript'));
      write('app-version.js', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.None } }).outputText);
      write('package.json', JSON.stringify({ version: entry.version }));
      write('package-lock.json', JSON.stringify({ version: entry.version, packages: { '': { version: entry.version } } }));
      write('build-info.js', `window.MINI_BUILD_INFO = {version:'${entry.version}'};`);
    } else write('js/modules/config/BuildInfo.js', `export const BUILD = '${options.stamp || entry.version}';`);
  }
  const check = extra => spawnSync(process.execPath, [cli, '--root', dir, '--check', '--release', '--base', 'base', ...(extra || [])], { encoding: 'utf8' });
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Release Test'); git('config', 'user.email', 'test@example.invalid');
    release(older); write('index.html', '<main>Anterior</main>'); commit(); git('tag', 'base');
    run({ dir, git, write, release, commit, check });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const rejected = (result, pattern) => { assert.notEqual(result.status, 0, result.stdout); assert.match(result.stderr, pattern); };
test('rechaza cambios de app con la misma versión aunque el catálogo sea coherente', () => fixture(({ write, check }) => {
  write('index.html', '<main>Nueva funcionalidad</main>'); rejected(check(), /versión mayor/);
}));
test('acepta una versión nueva con sus novedades, historial y caché nuevos', () => fixture(({ write, release, check }) => {
  write('index.html', '<main>Nueva funcionalidad</main>'); release(newer, [older]); const result = check(); assert.equal(result.status, 0, result.stderr);
}));
test('rechaza subir solo el número, notas vacías o copiadas y borrar el historial', () => fixture(({ release, write, check }) => {
  release({ ...newer, items: ['   '] }, [older]); rejected(check(), /novedades/);
  release({ ...newer, items: older.items }, [older]); rejected(check(), /novedades propias/);
  release(newer); rejected(check(), /historial/);
  release(newer, [older]); write('app-release.json', JSON.stringify({ version: newer.version, changelog: [older] })); rejected(check(), /catálogo|fuente/);
}));
test('no exige subir versión por documentos/tests o por sellar solo el build', () => fixture(({ git, write, check }) => {
  write('docs/guia.md', 'Documentación'); write('tests/check.test.js', '// Prueba');
  write('qa/multiobra360/probe.mjs', 'export const testOnly = true;');
  write('qa/multiobra360/issues.json', '{"R1":296}');
  git('add', 'qa');
  write('sw.js', `const CACHE_VERSION = '${MINI ? 'asistencia-v1.9.0-' : ''}otro-build';\nself.addEventListener('fetch', () => {});\n`);
  write(MINI ? 'build-info.js' : 'js/modules/config/BuildInfo.js', MINI ? "window.MINI_BUILD_INFO={version:'1.9.0',buildId:'otro'};" : "export const BUILD='otro-build';");
  const result = check(); assert.equal(result.status, 0, result.stderr);
}));
test('cambiar la lógica del worker exige versión y no basta con cambiar su sello', () => fixture(({ write, check }) => {
  write('sw.js', "const CACHE_VERSION = 'otro';\nself.skipWaiting();"); rejected(check(), /versión mayor|build\/caché/);
}));
test('el índice preparado se valida sin incorporar arreglos que aún no se prepararon', () => fixture(({ git, write, release, check }) => {
  write('index.html', '<main>Nueva</main>'); git('add', '.'); release(newer, [older]);
  rejected(check(['--staged']), /versión mayor/);
  git('add', '.'); write(canonical, 'const BROKEN = true;'); const result = check(['--staged']); assert.equal(result.status, 0, result.stderr);
}));
test('valida el commit que se envía y no permite encubrirlo con cambios locales', () => fixture(({ release, write, commit, check }) => {
  write('index.html', '<main>Nueva</main>'); const bad = commit(); release(newer, [older]);
  rejected(check(['--head', bad]), /versión mayor/);
  const good = commit(); write('app-release.json', '{}'); const result = check(['--head', good]); assert.equal(result.status, 0, result.stderr);
}));
test('una rama concurrente también debe superar la versión actual del destino', () => fixture(({ git, release, write, commit, check }) => {
  git('checkout', '-qb', 'feature'); release(newer, [older]); write('index.html', '<main>Feature</main>'); const feature = commit();
  git('checkout', '-q', 'main'); release({ ...newer, version: '1.11.0', items: ['Otra entrega.'] }, [older]); commit(); git('tag', '-f', 'base');
  rejected(check(['--head', feature]), /versión mayor/);
}));
test('rechaza una entrega con novedades nuevas si conserva el mismo caché publicado', () => fixture(({ release, write, check }) => {
  release(newer, [older]); write('sw.js', `const CACHE_VERSION = '${MINI ? 'asistencia-v1.10.0-' : ''}1.9.0';\nself.addEventListener('fetch', () => {});\n`);
  if (MINI) { // Same semantic-version stamp and no new build ID is caught through metadata if necessary.
    write('sw.js', "const CACHE_VERSION = 'asistencia-v1.9.0-1.9.0';\nself.addEventListener('fetch', () => {});\n");
    rejected(check(), /build\/caché|caché publicado/);
  } else rejected(check(), /caché publicado/);
}));
if (MINI) test('detecta JS compilado obsoleto aunque APP_VERSION no haya cambiado', () => fixture(({ release, write, check }) => {
  release(newer, [older]); const before = fs.readFileSync(path.join(root, 'app-version.js'), 'utf8'); write('app-version.js', before);
  rejected(check(), /app-version.js está obsoleto/);
}));

test('el hook pre-push rechaza el commit enviado aunque haya una corrección local sin subir', () => fixture(({ dir, git, write, release, commit }) => {
  const hook = path.join(root, '.githooks/pre-push');
  write('scripts/release-manifest.cjs', `process.argv.splice(2,0,'--root',${JSON.stringify(dir)});require(${JSON.stringify(cli)});`);
  write('index.html', '<main>Cambio sin versión</main>'); const bad = commit(); release(newer, [older]);
  const base = git('rev-parse', 'base');
  const push = sha => spawnSync('sh', [hook], { cwd: dir, encoding: 'utf8', input: `refs/heads/main ${sha} refs/heads/main ${base}\n` });
  rejected(push(bad), /versión mayor/);
  const good = commit(); const accepted = push(good); assert.equal(accepted.status, 0, accepted.stderr);
  const deletion = spawnSync('sh', [hook], { cwd: dir, encoding: 'utf8', input: `refs/heads/old ${'0'.repeat(40)} refs/heads/old ${bad}\n` });
  assert.equal(deletion.status, 0, deletion.stderr);
}));

test('CI y los hooks ejecutan la comprobación contra base/head e índice preparados', () => {
  const hook = fs.readFileSync(path.join(root, '.githooks/pre-commit'), 'utf8');
  const push = fs.readFileSync(path.join(root, '.githooks/pre-push'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, MINI ? '.github/workflows/ci.yml' : '.github/workflows/test.yml'), 'utf8');
  assert.match(hook, /release-manifest\.cjs[^\n]*--staged[^\n]*--release/);
  assert.match(push, /release-manifest\.cjs[^\n]*--head/);
  assert.match(workflow, /fetch-depth: 0/); assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /release-manifest\.cjs[^\n]*--base[^\n]*--head/);
  if (!MINI) assert.match(workflow, /npm run test:app-updates/);
});

test('la validación de CI transmite base/head y conserva el fallo del checker', () => {
  const workflow = fs.readFileSync(path.join(root, MINI ? '.github/workflows/ci.yml' : '.github/workflows/test.yml'), 'utf8');
  const step = workflow.match(/      - name: Verify release version and notes\n[\s\S]*?        run: \|\n((?:          [^\n]*\n?)+)/);
  assert.ok(step, 'release validation must execute, not just appear in comments');
  const shell = step[1].replace(/^          /gm, '');
  const stub = 'node() { printf "%s\\n" "$*"; return "${STUB_EXIT:-0}"; };\n';
  for (const base of ['base-sha', '']) {
    const env = { ...process.env, RELEASE_BASE: base, RELEASE_HEAD: 'head-sha', STUB_EXIT: '0' };
    const result = spawnSync('bash', ['-e', '-c', stub + shell], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--head head-sha/);
    if (base) assert.match(result.stdout, /--base base-sha/); else assert.doesNotMatch(result.stdout, /--base/);
    const failed = spawnSync('bash', ['-e', '-c', stub + shell], { env: { ...env, STUB_EXIT: '7' }, encoding: 'utf8' });
    assert.equal(failed.status, 7, failed.stderr);
  }
});

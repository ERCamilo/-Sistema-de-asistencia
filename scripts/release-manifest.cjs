// Generate the catalog, or validate the exact staged/committed release before publication.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const MINI = false;
const args = process.argv.slice(2);
function argument(name) { const i = args.indexOf(name); if (i < 0) return null; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Falta el valor de ${name}.`); return args[i + 1]; }
const root = path.resolve(argument('--root') || path.join(__dirname, '..'));
const canonical = MINI ? 'src/app-version.ts' : 'js/modules/config/AppVersion.js';
const staged = args.includes('--staged');
const git = parameters => execFileSync('git', parameters, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
function resolve(ref) { return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim(); }
function read(name, ref = null) { return ref === null ? fs.readFileSync(path.join(root, name), 'utf8') : git(['show', ref === ':index' ? ':' + name : `${ref}:${name}`]); }
function exists(name, ref = null) {
  if (ref === null) return fs.existsSync(path.join(root, name));
  try { git(['cat-file', '-e', ref === ':index' ? ':' + name : `${ref}:${name}`]); return true; } catch { return false; }
}
async function loadPolicy(source) {
  if (!MINI) return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const ts = require('typescript');
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.None } }).outputText;
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(javascript, sandbox, { timeout: 2000 });
  return sandbox.module.exports;
}
function data(policy) { return { version: policy.APP_VERSION, changelog: policy.CHANGELOG }; }
async function snapshot(ref, allowMissing = false, loaded = null) {
  if (allowMissing && !exists(canonical, ref)) return null; // Adoption into an older project.
  const result = data(loaded || await loadPolicy(read(canonical, ref)));
  if (MINI) {
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(read('app-version.js', ref), sandbox, { timeout: 2000 });
    if (JSON.stringify(data(sandbox.module.exports)) !== JSON.stringify(result)) throw new Error('app-version.js está obsoleto: compila src/app-version.ts con npm run build.');
  }
  return result;
}
function runtimeFile(name) {
  if (/^(?:docs|tests|qa|js\/tests|tutorials|scripts|infra|supabase|openspec|\.sdd-review|\.github|\.githooks)\//.test(name))
    return ['scripts/build.cjs', 'scripts/sw-precache.cjs', 'scripts/private-turn/package-mini-pages.mts'].includes(name);
  if (['build-info.js', 'js/modules/config/BuildInfo.js', 'package-lock.json', 'pnpm-lock.yaml', 'package.json', 'jest.config.js', 'jest.setup.js'].includes(name)) return false;
  return /\.(?:[cm]?js|ts|html|css|json|svg|png|jpe?g|webp|ico|woff2?)$/i.test(name) || ['_headers', '_redirects'].includes(name);
}
function runtimeChanges(base, candidate, anchor) {
  const diffBase = git(['merge-base', base, anchor]).trim();
  const command = staged ? ['diff', '--cached', diffBase] : candidate ? ['diff', diffBase, candidate] : ['diff', diffBase];
  return git([...command, '--name-only', '-z', '--no-renames']).split('\0').filter(Boolean).filter(runtimeFile).filter(name => {
    if (name !== 'sw.js') return true;
    const normalize = text => text.replace(/^const CACHE_VERSION = '[^']*';?/m, 'const CACHE_VERSION = <build>');
    return !exists(name, diffBase) || !exists(name, candidate) || normalize(read(name, diffBase)) !== normalize(read(name, candidate));
  });
}
function checkMiniMetadata(release, ref) {
  for (const name of ['package.json', 'package-lock.json']) {
    const value = JSON.parse(read(name, ref));
    if (value.version !== release.version || (value.packages?.[''] && value.packages[''].version !== release.version)) throw new Error(`${name} no coincide con APP_VERSION. Ejecuta npm run build.`);
  }
  const sandbox = { window: {} }; vm.runInNewContext(read('build-info.js', ref), sandbox, { timeout: 2000 });
  if (sandbox.window.MINI_BUILD_INFO?.version !== release.version || !read('sw.js', ref).includes(`asistencia-v${release.version}-`)) throw new Error('El build/caché no coincide con APP_VERSION. Ejecuta npm run build.');
}
(async () => {
  if (staged && argument('--head')) throw new Error('Usa --staged o --head, no ambos.');
  const head = argument('--head') ? resolve(argument('--head')) : null;
  const ref = staged ? ':index' : head;
  const candidatePolicy = await loadPolicy(read(canonical, ref));
  const policy = typeof candidatePolicy.getReleaseErrors === 'function' ? candidatePolicy : await loadPolicy(fs.readFileSync(path.join(__dirname, '..', canonical), 'utf8'));
  const manifest = await snapshot(ref, false, candidatePolicy);
  const errors = policy.getReleaseErrors(null, manifest, false);
  if (errors.length) throw new Error(errors.join('\n'));
  const output = JSON.stringify(manifest, null, 2) + '\n';
  const verify = args.includes('--check') || args.includes('--release') || !!argument('--base') || !!head || staged;
  if (!verify) { fs.writeFileSync(path.join(root, 'app-release.json'), output); return; }
  if (!exists('app-release.json', ref) || read('app-release.json', ref) !== output) throw new Error('app-release.json no coincide con la fuente. Ejecuta npm run build y prepara el catálogo.');
  if (MINI) checkMiniMetadata(manifest, ref);
  if (args.includes('--release') || argument('--base')) {
    const anchor = head || resolve('HEAD');
    let base = argument('--base');
    if (!base) { try { base = resolve('origin/main'); } catch { base = anchor; } }
    base = resolve(base);
    const files = runtimeChanges(base, ref, anchor);
    const previous = await snapshot(base, true);
    const problems = policy.getReleaseErrors(previous, manifest, files.length > 0);
    if (problems.length) throw new Error(problems.join('\n') + '\nActualiza APP_VERSION/CHANGELOG y ejecuta npm run build.');
    if (files.length && previous && !staged) {
      const stamp = text => /^const CACHE_VERSION = '([^']+)'/m.exec(text)?.[1];
      if (!stamp(read('sw.js', ref)) || stamp(read('sw.js', ref)) === stamp(read('sw.js', base))) throw new Error('Cambia el build del service worker con el hook de commit; el caché publicado sigue igual.');
    }
    console.log(`✓ Release ${manifest.version}: ${files.length ? 'versión nueva, novedades e historial verificados' : 'sin cambios de la aplicación'}.`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

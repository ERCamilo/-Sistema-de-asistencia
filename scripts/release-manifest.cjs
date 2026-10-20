const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
(async () => {
  const root = path.resolve(__dirname, '..');
  const staged = process.argv.includes('--staged');
  const read = name => staged ? execFileSync('git', ['show', ':' + name], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, name), 'utf8');
  const source = read('js/modules/config/AppVersion.js');
  const policy = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const manifest = { version: policy.APP_VERSION, changelog: policy.CHANGELOG };
  if (!policy.isReleaseManifest(manifest)) throw new Error('APP_VERSION y CHANGELOG deben coincidir.');
  const output = JSON.stringify(manifest, null, 2) + '\n';
  const target = path.join(root, 'app-release.json');
  if (process.argv.includes('--check')) {
    if ((!staged && !fs.existsSync(target)) || read('app-release.json') !== output) throw new Error('Ejecuta node scripts/release-manifest.cjs.');
  } else fs.writeFileSync(target, output);
})().catch(error => { console.error(error.message); process.exitCode = 1; });

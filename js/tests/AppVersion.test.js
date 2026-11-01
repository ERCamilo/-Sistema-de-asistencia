const assert = require('node:assert/strict');
const policy = require('../modules/config/AppVersion.js');
const fs = require('node:fs');

test('versión y primera entrada coinciden; el catálogo es válido y está ordenado', () => {
  assert.equal(policy.APP_VERSION, policy.CHANGELOG[0].version);
  assert.equal(policy.isReleaseManifest({ version: policy.APP_VERSION, changelog: policy.CHANGELOG }), true);
  assert.equal(require('../modules/config/Config.js').APP_CONFIG.VERSION, policy.APP_VERSION);
  assert.deepEqual(require('../../app-release.json'), { version: policy.APP_VERSION, changelog: policy.CHANGELOG });
  const sw = fs.readFileSync(require.resolve('../../sw.js'), 'utf8');
  assert.ok(sw.includes("searchParams.has('__incoming')"));
});
test('compara números semánticos, no texto; los inválidos no provocan avisos', () => {
  assert.equal(policy.compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(policy.compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(policy.compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(policy.compareVersions('1.10.0', '1.10.0'), 0);
  for (const value of ['invalid', '1', 'v1.0.0', '01.0.0']) assert.equal(policy.compareVersions(value, '1.0.0'), 0);
});
test('primera instalación no tiene novedades pendientes; las omitidas se acumulan', () => {
  const list = [{ version: '1.10.0' }, { version: '1.9.0' }, { version: '1.8.0' }];
  assert.deepEqual(policy.getUnseenReleases(null, list), []);
  assert.deepEqual(policy.getUnseenReleases('1.10.0', list), []);
  assert.deepEqual(policy.getUnseenReleases('1.8.0', list).map(r => r.version), ['1.10.0', '1.9.0']);
});
test('no ofrece actualización por primera toma de control ni repite una pospuesta', () => {
  const input = { hasController: true, currentVersion: '1.9.0', availableVersion: '1.10.0' };
  assert.equal(policy.shouldPromptForUpdate(input), true);
  assert.equal(policy.shouldPromptForUpdate({ ...input, hasController: false }), false);
  assert.equal(policy.shouldPromptForUpdate({ ...input, lastPromptedVersion: '1.10.0' }), false);
  assert.equal(policy.shouldPromptForUpdate({ ...input, availableVersion: '1.8.0' }), false);
});
test('intervalo de 30 minutos, sin red y reloj atrasado', () => {
  assert.equal(policy.shouldCheckForUpdate({ now: 1000, lastCheckedAt: 0 }), true);
  assert.equal(policy.shouldCheckForUpdate({ now: 1001, lastCheckedAt: 1000 }), false);
  assert.equal(policy.shouldCheckForUpdate({ now: 1801000, lastCheckedAt: 1000 }), true);
  assert.equal(policy.shouldCheckForUpdate({ now: 100, lastCheckedAt: 1000 }), true);
  assert.equal(policy.shouldCheckForUpdate({ now: 1801000, lastCheckedAt: 1000, online: false }), false);
});
test('rechaza catálogos incompletos, versiones incoherentes o cadenas sin límites', () => {
  const good = { version: policy.APP_VERSION, changelog: policy.CHANGELOG };
  assert.equal(policy.isReleaseManifest(null), false);
  assert.equal(policy.isReleaseManifest({ ...good, version: '999.0.0' }), false);
  assert.equal(policy.isReleaseManifest({ ...good, changelog: [] }), false);
  assert.equal(policy.isReleaseManifest({ ...good, changelog: [{ ...policy.CHANGELOG[0], items: ['x'.repeat(501)] }] }), false);
});


test('cada entrega de la app aumenta versión, añade novedades propias y conserva el historial', () => {
  const old = { version: '1.9.0', changelog: [{ version: '1.9.0', date: '2026-10-20', title: 'Anterior', items: ['Mejora anterior'] }] };
  const current = { version: '1.10.0', changelog: [{ version: '1.10.0', date: '2026-10-21', title: 'Actualización', items: ['Corregimos la búsqueda de actualizaciones.'] }, ...old.changelog] };
  assert.deepEqual(policy.getReleaseErrors(old, current, true), []);
  assert.match(policy.getReleaseErrors(old, old, true).join(' '), /versión.*mayor/i);
  assert.match(policy.getReleaseErrors(old, { ...current, changelog: old.changelog }, true).join(' '), /catálogo|novedades/i);
  assert.match(policy.getReleaseErrors(old, { ...current, changelog: [{ ...current.changelog[0], items: ['   '] }, ...old.changelog] }, true).join(' '), /novedades/i);
  assert.match(policy.getReleaseErrors(old, { ...current, changelog: [{ ...current.changelog[0], items: old.changelog[0].items }, ...old.changelog] }, true).join(' '), /novedades.*propias/i);
  assert.match(policy.getReleaseErrors(old, { ...current, changelog: current.changelog.slice(0, 1) }, true).join(' '), /historial/i);
  assert.deepEqual(policy.getReleaseErrors(old, old, false), []);
  assert.deepEqual(policy.getReleaseErrors(null, current, true), []);
});

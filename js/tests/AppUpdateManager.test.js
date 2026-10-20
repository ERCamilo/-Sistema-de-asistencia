const assert = require('node:assert/strict');
const base = require('../modules/config/AppVersion.js');
const { createReleaseManager } = require('../modules/services/AppUpdateManager.js');
const releases = [
  { version: '1.10.0', date: '2026-10-20', title: 'Nueva', items: ['Mejora nueva'] },
  { version: '1.9.0', date: '2026-10-19', title: 'Anterior', items: ['Mejora anterior'] }
];
function fixture(seen) {
  const storage = new Map(), shown = [], statuses = [];
  if (seen) storage.set('test:lastSeenVersion', seen);
  let now = 1000, canShow = true, reloads = 0, fetches = 0, saveFails = false;
  const manager = createReleaseManager({
    prefix: 'test', policy: { ...base, APP_VERSION: '1.9.0', CHANGELOG: releases.slice(1) },
    read: k => storage.get(k) || null, write: (k, v) => storage.set(k, v), now: () => now, online: () => true,
    fetchRelease: async () => { fetches++; return { version: '1.10.0', changelog: releases }; },
    canShow: () => canShow, show: (kind, entries, version, close, apply) => { shown.push({ kind, entries, version, close, apply }); return true; },
    beforeReload: async () => { if (saveFails) throw new Error('disk'); }, reload: () => reloads++, status: s => statuses.push(s)
  });
  return { manager, storage, shown, statuses, setBusy: v => { canShow = !v; }, setSaveFails: () => { saveFails = true; }, advance: () => { now += 1800000; }, stats: () => ({ reloads, fetches }) };
}
test('primer arranque y primera instalación no abren avisos ni recargan', async () => {
  const f = fixture(); f.manager.boot(); f.manager.boot();
  await f.manager.controllerChanged(false);
  assert.equal(f.storage.get('test:lastSeenVersion'), '1.9.0');
  assert.equal(f.shown.length, 0); assert.deepEqual(f.stats(), { reloads: 0, fetches: 0 });
});
test('espera a que cierre la edición; marca novedades vistas solamente al cerrar', () => {
  const f = fixture('1.8.0'); f.setBusy(true); f.manager.boot();
  assert.equal(f.shown.length, 0); f.setBusy(false); f.manager.flush();
  assert.equal(f.shown[0].kind, 'news'); assert.equal(f.storage.get('test:lastSeenVersion'), '1.8.0');
  f.shown[0].close(); assert.equal(f.storage.get('test:lastSeenVersion'), '1.9.0');
});
test('una pestaña antigua no retrocede la última versión vista', () => {
  const f = fixture('1.10.0'); f.manager.boot(); f.manager.showNews(true); f.shown[0].close();
  assert.equal(f.storage.get('test:lastSeenVersion'), '1.10.0');
});
test('Más tarde mantiene la página y la referencia; búsqueda manual recupera el aviso', async () => {
  const f = fixture('1.9.0'); f.manager.boot(); await f.manager.check(true); f.shown[0].close();
  f.manager.flush(); await f.manager.controllerChanged(true);
  assert.equal(f.shown.length, 1); assert.equal(f.stats().reloads, 0);
  assert.equal(f.storage.get('test:lastSeenVersion'), '1.9.0');
  await f.manager.check(true); assert.equal(f.shown.length, 2);
});
test('solo recarga por acción explícita después de guardar; el error conserva la página', async () => {
  const f = fixture('1.9.0'); f.manager.boot(); await f.manager.check(true);
  assert.equal(f.stats().reloads, 0); f.setSaveFails(); await f.shown[0].apply();
  assert.equal(f.stats().reloads, 0); assert.match(f.statuses.at(-1), /No se pudo actualizar/);
  const ok = fixture('1.9.0'); await ok.manager.check(true); await ok.shown[0].apply(); assert.equal(ok.stats().reloads, 1);
});
test('respeta intervalo y comparte consultas simultáneas', async () => {
  const f = fixture('1.9.0'); await Promise.all([f.manager.check(), f.manager.check()]);
  await f.manager.check(); assert.equal(f.stats().fetches, 1);
  f.advance(); await f.manager.check(); assert.equal(f.stats().fetches, 2);
});
test('cerrar mientras guarda cancela la recarga pendiente', async () => {
  let done, close, update, reloads = 0;
  const manager = createReleaseManager({
    prefix: 'cancel', policy: { ...base, APP_VERSION: '1.9.0' }, read: () => null, write() {}, now: () => 1000, online: () => true,
    fetchRelease: async () => ({ version: '1.10.0', changelog: releases }), canShow: () => true,
    show: (_, entries, version, onClose, apply) => { close = onClose; update = apply; return true; },
    beforeReload: () => new Promise(resolve => { done = resolve; }), reload: () => reloads++, status() {}
  });
  await manager.check(true); const saving = update(); close(); done(); await saving;
  assert.equal(reloads, 0);
});
test('una búsqueda manual que coincide con la automática conserva su respuesta visible', async () => {
  let finish, fetches = 0; const messages = [];
  const manager = createReleaseManager({
    policy: base, prefix: 'shared', read: () => null, write() {}, now: () => 1000, online: () => true,
    fetchRelease: () => { fetches++; return new Promise(resolve => { finish = resolve; }); },
    canShow: () => true, show: () => true, beforeReload: async () => {}, reload() {}, status: s => messages.push(s)
  });
  const automatic = manager.check(); const manual = manager.check(true);
  finish({}); await Promise.all([automatic, manual]);
  assert.equal(fetches, 1); assert.match(messages.at(-1) || '', /No se pudo consultar/);
});

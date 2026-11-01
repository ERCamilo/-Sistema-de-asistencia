const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Request, Response } = vm.runInThisContext('({ Request, Response })');
const handlers = {};
const sandbox = { URL, Request, Response, AbortController, setTimeout, clearTimeout, console, importScripts() {},
  self: { location: new URL('https://example.test/mini/sw.js'), registration: { scope: 'https://example.test/mini/' },
    SW_PRECACHE_MANIFEST: [], addEventListener: (type, handler) => { handlers[type] = handler; } }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../sw.js'), 'utf8'), sandbox);
const refreshAppShell = options => sandbox.refreshAppShell(options);
const getFreshShellResponse = (...args) => sandbox.getFreshShellResponse(...args);

const scope = 'https://example.test/mini/';
function fixture() {
  const values = new Map([[scope + 'app-version.js', 'old'], [scope + 'stale.js', 'obsolete']]);
  const calls = [];
  const cache = {
    match: async request => values.has(request.url) ? new Response(values.get(request.url)) : undefined,
    keys: async () => [...values.keys()].map(url => new Request(url)),
    put: async (key, response) => { calls.push('put'); values.set(String(key), await response.text()); },
    delete: async key => { calls.push('delete'); return values.delete(key.url || key); }
  };
  const storage = { open: async name => { assert.equal(name, 'app-shell'); return cache; } };
  const options = { assets: ['./app-version.js', './theme.css', './app-version.js'], scope, cacheName: 'app-shell', storage,
    stamp: 123, fetcher: async (url, init) => {
      calls.push('fetch'); assert.equal(new URL(url).searchParams.get('__v'), '123'); assert.equal(init.cache, 'reload');
      return new Response('fresh', { headers: { 'Content-Type': String(url).includes('.js') ? 'text/javascript' : 'text/css' } });
    }
  };
  return { values, calls, options };
}
test('renueva solo el shell, sin duplicados ni claves obsoletas, tras descargar todos los archivos', async () => {
  const f = fixture();
  assert.equal(await refreshAppShell(f.options), 2);
  assert.deepEqual(f.calls, ['fetch', 'fetch', 'put', 'put', 'delete']);
  assert.deepEqual([...f.values.entries()], [[scope + 'app-version.js', 'fresh'], [scope + 'theme.css', 'fresh']]);
});
test('un archivo que falla, responde 404 o devuelve HTML en lugar de JS conserva el caché anterior', async () => {
  for (const kind of ['network', '404', 'html']) {
    const f = fixture();
    f.options.fetcher = async () => {
      if (kind === 'network') throw new Error('offline');
      return new Response('unavailable', { status: kind === '404' ? 404 : 200, headers: { 'Content-Type': 'text/html' } });
    };
    await assert.rejects(() => refreshAppShell(f.options));
    assert.deepEqual(f.calls, []);
    assert.deepEqual([...f.values.values()], ['old', 'obsolete']);
  }
});
test('rechaza assets fuera del ámbito de la aplicación', async () => {
  for (const asset of ['https://other.test/app.js', '../other/app.js']) {
    const f = fixture(); f.options.assets = [asset];
    await assert.rejects(() => refreshAppShell(f.options)); assert.deepEqual(f.calls, []);
  }
});

test('un corte durante el cuerpo de una descarga conserva todos los archivos anteriores', async () => {
  const f = fixture();
  f.options.assets = ['./app-version.js'];
  let downloaded = false;
  f.options.fetcher = async () => ({ ok: true, headers: { get: () => 'text/javascript' },
    clone: () => ({ arrayBuffer: async () => { downloaded = true; throw new Error('connection lost'); } }),
    text: async () => 'incomplete'
  });
  await assert.rejects(() => refreshAppShell(f.options));
  assert.equal(downloaded, true); assert.deepEqual(f.calls, []);
  assert.deepEqual([...f.values.values()], ['old', 'obsolete']);
});

test('la recarga inmediata usa los archivos recién renovados; después vuelve a la estrategia habitual', async () => {
  const f = fixture();
  await refreshAppShell(f.options);
  const request = new Request(scope + 'app-version.js');
  const fresh = await getFreshShellResponse(request, f.options.storage, 'app-shell');
  assert.equal(await fresh.text(), 'fresh');
  assert.equal(await getFreshShellResponse(request, f.options.storage, 'app-shell', Date.now() + 61000), undefined);
});

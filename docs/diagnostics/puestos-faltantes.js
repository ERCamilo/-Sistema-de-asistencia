// Diagnóstico de SOLO LECTURA: puestos que usan los empleados pero no están
// en el catálogo. Pegar en la consola de la app (F12 → Consola) y copiar el
// resultado. No modifica nada. No muestra nombres de empleados, solo conteos.
(async () => {
  const slug = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-').replace(/^-+|-+$/g, '');
  const s = window.state;
  const catalog = new Map((s.positions || []).map(p => [p.id, p]));
  const bySlug = new Map((s.positions || []).map(p => [slug(p.name), p]));
  // Puestos guardados en IndexedDB (por si el catálogo en memoria está incompleto)
  let idb = [];
  try {
    idb = await new Promise((ok, ko) => {
      const open = indexedDB.open('attendance-app-db');
      open.onerror = () => ko(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (![...db.objectStoreNames].includes('positions')) return ok([]);
        const req = db.transaction('positions').objectStore('positions').getAll();
        req.onsuccess = () => ok(req.result || []);
        req.onerror = () => ko(req.error);
      };
    });
  } catch (e) { idb = [{ error: String(e) }]; }
  const idbById = new Map(idb.filter(p => p && p.id).map(p => [p.id, p]));
  const missing = new Map();
  for (const e of s.employees || []) {
    for (const pid of e.positions || []) {
      if (catalog.has(pid)) continue;
      const m = missing.get(pid) || { id: pid, empleados: 0 };
      m.empleados++;
      missing.set(pid, m);
    }
  }
  const rows = [...missing.values()].map(m => {
    const inIdb = idbById.get(m.id);
    const guess = bySlug.get(slug(String(m.id).replace(/-\d{10,}$/, '').replace(/-/g, ' ')))
      || (inIdb && bySlug.get(slug(inIdb.name)));
    return {
      idFaltante: m.id,
      empleados: m.empleados,
      enIndexedDB: inIdb ? `sí (${inIdb.name}${inIdb.deletedAt ? ', borrado' : ''}${inIdb.projectId ? ', obra ' + inIdb.projectId : ''})` : 'no',
      coincideConPuestoActual: guess ? `${guess.name} (${guess.id})` : '—'
    };
  }).sort((a, b) => b.empleados - a.empleados);
  console.log('Catálogo en memoria:', catalog.size, '· en IndexedDB:', idb.length,
    '· empleados:', (s.employees || []).length, '· ids de puesto faltantes:', rows.length);
  console.table(rows);
  return rows;
})();

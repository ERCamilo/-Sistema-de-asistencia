// Diagnóstico de SOLO LECTURA (paso 3): busca en los respaldos (snapshots) de
// la nube el nombre original de los puestos que faltan y compara con los
// puestos actuales de la misma obra. No modifica nada.
(async () => {
  const V = '10.8.0';
  const { getApps } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  const { getAuth } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
  const app = getApps()[0];
  const db = fs.getFirestore(app);
  const uid = getAuth(app).currentUser?.uid;
  if (!uid) return console.warn('No hay sesión iniciada.');
  const s = window.state;
  const catalog = new Map((s.positions || []).map(p => [p.id, p]));
  const missing = new Set();
  for (const e of s.employees || []) for (const pid of e.positions || []) if (!catalog.has(pid)) missing.add(pid);

  const gunzip = async b64 => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(out).text());
  };
  const readState = async (id, data) => {
    if (data.state) return data.state;
    if (data.compressedState && data.encoding === 'gzip-base64') return gunzip(data.compressedState);
    if (data.encoding === 'gzip-base64-chunked') {
      const parts = [];
      for (let i = 0; i < (Number(data.chunkCount) || 0); i++) {
        const c = await fs.getDoc(fs.doc(db, 'users', uid, 'snapshots', `${id}__chunk_${i}`));
        parts.push(c.exists() ? c.data().data : '');
      }
      return gunzip(parts.join(''));
    }
    return null; // respaldos viejos en Storage: no se leen aquí
  };

  const q = fs.query(fs.collection(db, 'users', uid, 'snapshots'), fs.orderBy('metadata.timestamp', 'desc'), fs.limit(25));
  const snaps = await fs.getDocs(q);
  const found = new Map();      // id faltante -> info del respaldo más reciente que lo tiene
  const seen = [];
  for (const d of snaps.docs) {
    const meta = d.data().metadata || {};
    const fecha = meta.timestamp ? new Date(meta.timestamp).toISOString().slice(0, 16).replace('T', ' ') : d.id;
    let st = null;
    try { st = await readState(d.id, d.data()); } catch (e) { seen.push({ respaldo: fecha, error: String(e).slice(0, 80) }); continue; }
    if (!st) { seen.push({ respaldo: fecha, nota: 'sin datos legibles' }); continue; }
    const tiene = (st.positions || []).filter(p => missing.has(p.id));
    seen.push({ respaldo: fecha, tipo: meta.type || '', puestos: (st.positions || []).length, conLosFaltantes: tiene.length });
    for (const p of tiene) if (!found.has(p.id)) found.set(p.id, { p, fecha });
  }
  console.log('Respaldos revisados:'); console.table(seen);

  const usage = new Map();
  for (const e of s.employees || []) for (const pid of e.positions || []) usage.set(pid, (usage.get(pid) || 0) + 1);
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const rows = [...missing].map(id => {
    const f = found.get(id);
    const p = f?.p;
    const same = p ? (s.positions || []).filter(x => norm(x.name) === norm(p.name)) : [];
    return {
      idFaltante: id,
      empleados: usage.get(id) || 0,
      nombreEnRespaldo: p ? p.name : '(no aparece)',
      obraEnRespaldo: p ? String(p.projectId || '—') : '',
      respaldo: f ? f.fecha : '',
      puestoActualMismoNombre: same.map(x => `${x.name} · obra ${x.projectId || '—'} · ${x.id}`).join(' | ') || '—'
    };
  });
  console.log('Puestos que faltan:'); console.table(rows);
  const obra = rows.find(r => r.obraEnRespaldo)?.obraEnRespaldo;
  console.log('Puestos actuales de la obra y cuántos empleados los usan:');
  console.table((s.positions || []).filter(p => p.projectId).map(p => ({ id: p.id, nombre: p.name, obra: p.projectId, empleados: usage.get(p.id) || 0 })));
})();

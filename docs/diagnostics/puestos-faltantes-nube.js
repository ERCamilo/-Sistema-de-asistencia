// Diagnóstico de SOLO LECTURA (paso 2): ¿los puestos que faltan existen en la
// nube (Firestore users/{uid}/positions)? Usa la misma sesión de la app.
// Pegar en la consola de la app. No modifica nada.
(async () => {
  const V = '10.8.0';
  const { getApps } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const { getFirestore, collection, getDocs } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  const { getAuth } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
  const app = getApps()[0];
  const uid = getAuth(app).currentUser?.uid;
  if (!uid) return console.warn('No hay sesión iniciada.');
  const s = window.state;
  const local = new Set((s.positions || []).map(p => p.id));
  const missing = new Map();
  for (const e of s.employees || []) for (const pid of e.positions || []) {
    if (local.has(pid)) continue;
    const m = missing.get(pid) || { empleados: 0, obras: new Set(), salario: 0 };
    m.empleados++;
    m.obras.add(String(e.projectId || '—'));
    if (e.positionSalaries && e.positionSalaries[pid] != null) m.salario++;
    missing.set(pid, m);
  }
  const snap = await getDocs(collection(getFirestore(app), 'users', uid, 'positions'));
  const cloud = new Map();
  snap.forEach(d => cloud.set(d.id, d.data() || {}));
  const fecha = t => (Number(t) ? new Date(Number(t)).toISOString().slice(0, 10) : '');
  const rows = [...missing.entries()].map(([id, m]) => {
    const c = cloud.get(id);
    return {
      idFaltante: id,
      empleados: m.empleados,
      conSalarioDelPuesto: m.salario,
      obrasDeEsosEmpleados: [...m.obras].join(', '),
      enLaNube: c ? 'sí' : 'no',
      nombreEnNube: c ? (c.name || '') : '',
      borradoEnNube: c ? (c.deletedAt ? 'sí ' + fecha(c.deletedAt) : 'no') : '',
      obraDelPuesto: c ? String(c.projectId || '—') : '',
      actualizado: c ? fecha(c.updatedAt) : ''
    };
  });
  const obrasCatalogo = {};
  for (const p of s.positions || []) { const k = String(p.projectId || '—'); obrasCatalogo[k] = (obrasCatalogo[k] || 0) + 1; }
  console.log('Puestos en la nube:', cloud.size, '· en el dispositivo:', local.size, '· puestos por obra en el dispositivo:', obrasCatalogo);
  console.table(rows);
})();

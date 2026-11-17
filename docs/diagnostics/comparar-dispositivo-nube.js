// Diagnóstico de SOLO LECTURA: compara puestos, líderes y empleados de este
// dispositivo con la nube (Firestore). Útil cuando dos dispositivos muestran
// catálogos distintos. No modifica nada. No muestra nombres de empleados.
(async () => {
  const V = '10.8.0';
  const { getApps } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  const { getAuth } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
  const app = getApps()[0], db = fs.getFirestore(app), uid = getAuth(app).currentUser?.uid;
  if (!uid) return console.warn('No hay sesión iniciada.');
  const s = window.state;
  const fecha = t => (Number(t) ? new Date(Number(t)).toISOString().slice(0, 16).replace('T', ' ') : '');
  const read = async name => {
    const out = new Map();
    (await fs.getDocs(fs.collection(db, 'users', uid, name))).forEach(d => out.set(d.id, d.data() || {}));
    return out;
  };
  const [cPos, cLead, cEmp] = await Promise.all([read('positions'), read('leaders'), read('employees')]);
  const lPos = new Map((s.positions || []).map(p => [p.id, p]));
  const lLead = new Map((s.leaders || []).map(l => [l.id, l]));
  const lEmp = new Map((s.employees || []).map(e => [e.id, e]));
  let defaultObra = null; try { defaultObra = localStorage.getItem('asistencia_default_project_id'); } catch (_) {}
  console.log(`Versión: ${document.querySelector('[data-app-version]')?.textContent || '(ver Ajustes)'} · obra predeterminada: ${defaultObra || '—'}`);
  console.table({
    puestos: { dispositivo: lPos.size, nube: cPos.size, soloEnNube: [...cPos.keys()].filter(k => !lPos.has(k)).length, soloAqui: [...lPos.keys()].filter(k => !cPos.has(k)).length },
    lideres: { dispositivo: lLead.size, nube: cLead.size, soloEnNube: [...cLead.keys()].filter(k => !lLead.has(k)).length, soloAqui: [...lLead.keys()].filter(k => !cLead.has(k)).length },
    empleados: { dispositivo: lEmp.size, nube: cEmp.size, soloEnNube: [...cEmp.keys()].filter(k => !lEmp.has(k)).length, soloAqui: [...lEmp.keys()].filter(k => !cEmp.has(k)).length }
  });
  const fila = (id, p, donde) => ({ donde, id, nombre: p.name || '', obra: p.projectId || '—', borrado: p.deletedAt ? fecha(p.deletedAt) : '', actualizado: fecha(p.updatedAt) });
  console.log('Puestos que no coinciden:');
  console.table([
    ...[...cPos].filter(([k]) => !lPos.has(k)).map(([k, p]) => fila(k, p, 'solo en la nube')),
    ...[...lPos].filter(([k]) => !cPos.has(k)).map(([k, p]) => fila(k, p, 'solo aquí'))
  ]);
  console.log('Líderes que no coinciden:');
  console.table([
    ...[...cLead].filter(([k]) => !lLead.has(k)).map(([k, p]) => fila(k, p, 'solo en la nube')),
    ...[...lLead].filter(([k]) => !cLead.has(k)).map(([k, p]) => fila(k, p, 'solo aquí'))
  ]);
  // Empleados: solo conteos por obra y estado (sin nombres).
  const resumen = (map, donde) => {
    const out = {};
    for (const [k, e] of map) {
      const otro = donde === 'solo en la nube' ? lEmp : cEmp;
      if (otro.has(k)) continue;
      const clave = `${donde} · obra ${e.projectId || '—'}${e.deletedAt ? ' · borrado' : ''}${e.mergedIntoId ? ' · fusionado' : ''}`;
      out[clave] = (out[clave] || 0) + 1;
    }
    return out;
  };
  console.log('Empleados que no coinciden (conteo):');
  console.table({ ...resumen(cEmp, 'solo en la nube'), ...resumen(lEmp, 'solo aquí') });
  // ¿Los puestos que usan los empleados de aquí existen en la nube?
  const faltan = new Map();
  for (const e of s.employees || []) for (const pid of e.positions || []) if (!lPos.has(pid)) faltan.set(pid, (faltan.get(pid) || 0) + 1);
  console.log('Puestos usados aquí que no están en el catálogo de este dispositivo:');
  console.table([...faltan].map(([pid, n]) => {
    const c = cPos.get(pid);
    return { id: pid, empleados: n, enLaNube: c ? 'sí' : 'no', nombreEnNube: c?.name || '', obra: c?.projectId || '', borradoEnNube: c?.deletedAt ? fecha(c.deletedAt) : '' };
  }).sort((a, b) => b.empleados - a.empleados));
})();

// Reparación única de puestos huérfanos (2026-11-16).
// Los 7 ids eran puestos de la obra PRJ-mtrwcg20-24o3 que desaparecieron tras
// la restauración del 10/11 (el respaldo pre-restore de las 14:01 los tiene).
// Cada uno tiene hoy un puesto con el MISMO nombre en el catálogo.
//
// PASO 1: ejecútalo tal cual (SIMULAR = true): solo muestra lo que cambiaría.
// PASO 2: crea un respaldo manual en la app.
// PASO 3: cambia SIMULAR a false y ejecútalo otra vez.
// Guarda en localStorage ('reparacion-puestos-2026-11-16') lo anterior
// para poder deshacer.
(async () => {
  const SIMULAR = true;
  const MAPA = {
    '06192a80-de42-47d4-91e2-97f3962653ea': { nombre: 'Operador Ctk', a: 'operador-ctk' },
    '0df580fd-c725-4371-b4a6-4b0bd2e3a399': { nombre: 'Cubo', a: 'cubo' },
    '062946cf-3140-4ea5-a0d3-98d314ba19cc': { nombre: 'Martillo', a: 'calmonita-1769317303481' },
    '037e0e96-eb04-4813-9e0c-9ddde99f412b': { nombre: 'Compresor', a: 'compresor' },
    '06d08f9f-dd39-446c-8c24-6ad7b991288a': { nombre: 'Varillero', a: 'varillero' },
    '0973cca9-5388-4de8-a5c7-ff0c025844c8': { nombre: 'Carpintero', a: 'carpintero' },
    '1ff69828-5445-4f4a-aa48-ef6fbf396f59': { nombre: 'Plomero', a: 'plomero' }
  };
  const s = window.state;
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const byId = new Map((s.positions || []).map(p => [p.id, p]));
  // 1) Verificar destinos
  for (const [viejo, m] of Object.entries(MAPA)) {
    const destino = byId.get(m.a);
    if (!destino) return console.error(`❌ No existe el puesto destino ${m.a}. No se cambió nada.`);
    if (norm(destino.name) !== norm(m.nombre)) return console.error(`❌ ${m.a} se llama «${destino.name}», no «${m.nombre}». No se cambió nada.`);
    if (byId.has(viejo)) return console.error(`❌ El id ${viejo} ya existe en el catálogo. No se cambió nada.`);
  }
  let defaultObra = null;
  try { defaultObra = localStorage.getItem('asistencia_default_project_id'); } catch (_) {}
  // 2) Calcular cambios
  const now = Date.now();
  const deshacer = { empleados: {}, asistencia: {} };
  const resumen = Object.fromEntries(Object.entries(MAPA).map(([v, m]) => [v, { puesto: m.nombre, destino: m.a, empleados: 0, salarios: 0, salarioYaExistia: 0, dias: 0 }]));
  const cambiosEmp = [];
  for (const e of s.employees || []) {
    const pos = e.positions || [];
    const sal = e.positionSalaries || {};
    const tocaPos = pos.some(id => MAPA[id]);
    const tocaSal = Object.keys(sal).some(id => MAPA[id]);
    if (!tocaPos && !tocaSal) continue;
    deshacer.empleados[e.id] = { positions: [...pos], positionSalaries: { ...sal }, updatedAt: e.updatedAt, positionsUpdatedAt: e.positionsUpdatedAt };
    const nuevasPos = [...new Set(pos.map(id => (MAPA[id] ? MAPA[id].a : id)))];
    const nuevosSal = { ...sal };
    for (const [viejo, m] of Object.entries(MAPA)) {
      if (pos.includes(viejo)) resumen[viejo].empleados++;
      if (Object.prototype.hasOwnProperty.call(sal, viejo)) {
        resumen[viejo].salarios++;
        // Si ya tenía salario en el destino, se respeta el del destino.
        if (Object.prototype.hasOwnProperty.call(sal, m.a)) resumen[viejo].salarioYaExistia++;
        else nuevosSal[m.a] = sal[viejo];
        delete nuevosSal[viejo];
      }
    }
    cambiosEmp.push({ e, nuevasPos, nuevosSal });
  }
  const cambiosAsis = [];
  for (const [key, att] of Object.entries(s.attendance || {})) {
    const ph = Array.isArray(att?.positionHours) ? att.positionHours : [];
    const usa = ph.some(h => MAPA[h?.positionId]) || MAPA[att?.selectedPosition];
    if (!usa) continue;
    deshacer.asistencia[key] = { positionHours: ph.map(h => ({ ...h })), selectedPosition: att.selectedPosition ?? null, updatedAt: att.updatedAt };
    const merged = [];
    for (const h of ph) {
      const id = MAPA[h?.positionId] ? MAPA[h.positionId].a : h?.positionId;
      if (MAPA[h?.positionId]) resumen[h.positionId].dias++;
      const prev = merged.find(x => x.positionId === id);
      if (prev) { prev.hours = (Number(prev.hours) || 0) + (Number(h.hours) || 0); prev.overtimeHours = (Number(prev.overtimeHours) || 0) + (Number(h.overtimeHours) || 0); }
      else merged.push({ ...h, positionId: id });
    }
    cambiosAsis.push({ att, merged, sel: MAPA[att.selectedPosition] ? MAPA[att.selectedPosition].a : att.selectedPosition });
  }
  console.log(`Obra predeterminada: ${defaultObra || '—'} · empleados a corregir: ${cambiosEmp.length} · días de asistencia a corregir: ${cambiosAsis.length}`);
  console.table(Object.values(resumen));
  if (SIMULAR) return console.log('🔎 SIMULACIÓN: no se cambió nada. Crea un respaldo manual y vuelve a ejecutar con SIMULAR = false.');
  // 3) Aplicar
  localStorage.setItem('reparacion-puestos-2026-11-16', JSON.stringify({ at: now, mapa: MAPA, deshacer }));
  for (const { e, nuevasPos, nuevosSal } of cambiosEmp) {
    e.positions = nuevasPos;
    e.positionSalaries = nuevosSal;
    e.updatedAt = now;
    e.positionsUpdatedAt = now;
  }
  for (const { att, merged, sel } of cambiosAsis) {
    att.positionHours = merged;
    att.selectedPosition = sel ?? null;
    att.updatedAt = now;
  }
  await window.saveApplicationData({ force: true });
  console.log(`✅ Reparado: ${cambiosEmp.length} empleado(s) y ${cambiosAsis.length} día(s). Datos para deshacer guardados en localStorage 'reparacion-puestos-2026-11-16'. Recarga la app.`);
})();

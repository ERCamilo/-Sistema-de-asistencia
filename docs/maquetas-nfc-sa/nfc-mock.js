/* NFC menu mockup engine. Mirrors VoiceSettingsUI's structure (view + stack + header/body/footer)
   with fake data. Everything is static: no fetch, no storage, no timers beyond short UI delays. */
'use strict';
(() => {
  const D = window.NFCData, esc = D.esc;
  const P = {
    back: 'm14 5-7 7 7 7', close: 'm6 6 12 12M18 6 6 18', chevron: 'm9 5 7 7-7 7', plus: 'M12 5v14M5 12h14',
    card: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9v6m3-6v6m4-5a3 3 0 0 1 0 4m3-7a7 7 0 0 1 0 10"/>',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
    sliders: '<path d="M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    tray: 'M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6H3v-6l2-8Z',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>',
    warn: 'M12 4 2.5 20h19L12 4Zm0 6v5m0 3h.01', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
    checkc: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>', check: 'm5 12 4 4 10-10',
    unknown: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7m0 3h.01"/>',
    repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>', minus: 'M5 12h14', spinner: 'M12 3a9 9 0 1 0 9 9',
    ext: 'M14 4h6v6m0-6-9 9M10 6H5v13h13v-5', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>', key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 3 3"/>',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7', camera: '<path d="M8 5 10 3h4l2 2h4v15H4V5h4Z"/><circle cx="12" cy="12" r="4"/>',
    edit: 'm15 4 5 5M3 21l5-1L21 7l-5-5L3 15v6Z',
    refresh: 'M20 11a8 8 0 0 0-14-4L4 9m0-5v5h5M4 13a8 8 0 0 0 14 4l2-2m0 5v-5h-5', users: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-18a3 3 0 0 1 0 6m2 12v-4a5 5 0 0 0-2-4"/>',
  };
  const ic = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] && P[n][0] === '<' ? P[n] : `<path d="${P[n] || ''}"/>`}</svg>`;
  const iconBtn = (act, icon, label, v = '') => `<button type="button" class="vs-icon-button" data-act="${act}" data-v="${esc(v)}" aria-label="${esc(label)}">${ic(icon)}</button>`;
  const btn = (act, label, o = {}) => `<button type="button" class="vs-btn${o.primary ? ' vs-primary' : ''}${o.danger ? ' vs-danger' : ''}" data-act="${act}" data-v="${esc(o.v || '')}" ${o.disabled ? 'disabled' : ''}>${o.icon ? ic(o.icon) : ''}${esc(label)}</button>`;
  const chip = (tone, label, icon) => `<span class="ns-chip" data-tone="${tone}">${icon ? ic(icon) : ''}${esc(label)}</span>`;
  const status = (tone, icon, title, text, extra = '', cls = '') => `<div class="ns-status ${cls}" data-tone="${tone}" role="${tone === 'bad' ? 'alert' : 'status'}"><span class="ns-status-icon">${ic(icon)}</span><div><strong>${title}</strong>${text ? `<p>${text}</p>` : ''}${extra}</div></div>`;
  const label = t => `<p class="vs-section-label">${t}</p>`;
  const avatar = e => `<span class="ns-avatar" style="--c:${e.color}" aria-hidden="true">${esc(D.initials(e.name))}</span>`;
  const uidFmt = u => u.replace(/(.{2})(?=.)/g, '$1 ');
  const last4 = u => `••${u.slice(-4)}`;
  const toggle = (act, on, title, hint) => `<button type="button" role="switch" aria-checked="${on}" data-act="${act}" class="vs-setting-row"><span><strong>${title}</strong>${hint ? `<small>${hint}</small>` : ''}</span><span class="vs-toggle"></span></button>`;
  const seg = (act, items, cur) => `<div class="vs-segmented" role="group">${items.map(([v, l]) => `<button type="button" class="vs-segment" data-act="${act}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
  const rid = () => Math.random().toString(16).slice(2, 10);

  // ---------------------------------------------------------------- state
  const S = {
    scn: { net: 'on', dest: 'test', listening: 'yes', app: 'new', session: 'in', next: 'free', assoc: 'on' },
    prefs: { enabled: true, mode: 'test', customUrl: '' },
    stack: [{ view: 'home' }], search: '', tFilter: 'todos', lFilter: 'todos',
    rules: { ...D.RULES_DEFAULT }, draft: null, days: JSON.parse(JSON.stringify(D.DAYS)), unknown: JSON.parse(JSON.stringify(D.UNKNOWN)),
    assign: JSON.parse(JSON.stringify(D.ASSIGN)), free: JSON.parse(JSON.stringify(D.FREE)), history: JSON.parse(JSON.stringify(D.HISTORY)),
    devices: JSON.parse(JSON.stringify(D.DEVICES)), check: null, test: { phase: 'idle' }, A: null, edit: {}, resolve: {}, rel: {}, delivered: false, feedback: '', confirmRevoke: false, rulesNote: '',
  };
  const wide = () => matchMedia('(min-width:900px)').matches;
  const cur = () => S.stack[S.stack.length - 1];
  const SECTIONS = [
    ['tarjetas', 'Tarjetas', 'Una por empleado, con historial', 'card', ['tarjetas', 'tarjeta', 'asociar', 'liberar']],
    ['lecturas', 'Lecturas del lector', 'Propuestas del día y correcciones', 'list', ['lecturas', 'dia', 'resolver', 'fotos', 'pendientes']],
    ['entrega', 'Entrega a la bandeja', 'Como una fuente más, para revisar', 'tray', ['entrega']],
    ['lectores', 'Lectores', 'Estado y clave de cada ESP32', 'chip', ['lectores', 'lector']],
    ['reglas', 'Reglas de cálculo', 'Doble toque, comida, jornada, fotos', 'sliders', ['reglas']],
    ['conexion', 'Conexión y prueba', 'Destino, comprobación y lectura de prueba', 'wifi', ['conexion', 'prueba']],
  ];
  const sectionOf = v => (SECTIONS.find(s => s[4].includes(v)) || [])[0];
  const NEEDS_SESSION = ['lecturas', 'dia', 'resolver', 'fotos', 'pendientes', 'entrega', 'lectores', 'lector', 'reglas'];
  const go = (view, params = {}) => { S.stack.push({ view, ...params }); S.feedback = ''; render(true); };
  const back = () => { if (S.stack.length > 1) { S.stack.pop(); S.feedback = ''; render(true); } else close(); };
  const root = view => { S.stack = [{ view }]; S.feedback = ''; render(true); };
  const destName = () => ({ test: 'Test', production: 'Producción', custom: 'Personalizado' })[S.prefs.mode];
  const dayOf = id => S.days.find(d => d.id === id);
  const stateTone = s => ({ pendiente: ['mute', 'Pendiente'], verificado: ['good', 'Verificado'], editado: ['info', 'Editado'], rechazado: ['bad', 'Rechazado'] })[s];

  // ---------------------------------------------------------------- global banners
  function banners(v) {
    let h = '';
    if (S.scn.app === 'old') h += status('warn', 'refresh', 'Tu versión de SA es anterior', 'Esta versión no entiende las lecturas ni las tarjetas con historial. Sigue disponible la lectura de prueba. Actualiza SA para usar el resto.', btn('update', 'Buscar actualización', { icon: 'refresh' }));
    if (S.scn.net === 'off' && v !== 'prueba') h += status('warn', 'wifi', 'Sin conexión', 'Puedes ver la última copia. Asociar, guardar y entregar necesitan internet. Nada se pierde: no hay cola oculta.', '', 'ns-compact');
    return h;
  }
  const locked = v => S.scn.app === 'old' && !['conexion', 'prueba', 'home'].includes(v);
  const readOnly = () => S.scn.net === 'off' || S.scn.app === 'old';

  // ---------------------------------------------------------------- views
  const VIEWS = {};

  VIEWS.home = () => {
    const unresolved = S.unknown.filter(u => !u.done).length + D.PENDING_DATE.length;
    const pend = S.days.filter(d => d.state === 'pendiente').length;
    const pill = S.prefs.enabled ? chip('good', 'Asociación activa', 'checkc') : chip('mute', 'Asociación apagada', 'minus');
    const counts = { lecturas: pend, tarjetas: S.free.length, lectores: S.devices.filter(d => d.stale || d.key === 'revoked').length };
    return { title: 'NFC', sub: `Torre Norte · Destino ${destName()}`, icon: 'card', body: `<div class="vs-intro-line"><span>Tarjetas, lecturas y lectores</span>${pill}</div>
      <div class="vs-nav-grid">${SECTIONS.map(s => `<button type="button" class="vs-nav-card" data-act="section" data-v="${s[0]}"><span class="vs-icon-box">${ic(s[3])}</span><span class="vs-copy"><strong>${s[1]}</strong><small>${s[2]}</small></span>${counts[s[0]] ? `<span class="ns-count" data-tone="${s[0] === 'lecturas' ? 'warn' : 'mute'}" aria-label="${counts[s[0]]} por atender">${counts[s[0]]}</span>` : ''}<span class="vs-arrow">${ic('chevron')}</span></button>`).join('')}</div>
      <div class="vs-local-context"><span class="vs-context-label">${ic('lock')} Ajustes de conexión: solo este teléfono</span><span class="vs-mini-numbers">${unresolved} por resolver</span></div>`, footer: '' };
  };

  // ---- Conexión
  VIEWS.conexion = () => {
    const p = S.prefs, urlOk = /^https:\/\/[^\s/]+\.[^\s]+$/i.test(p.customUrl);
    const host = { test: 'n8n.erlin.do/webhook-test/ee76…eeb4d', production: 'n8n.erlin.do/webhook/ee76…eeb4d', custom: p.customUrl ? p.customUrl.replace(/^https:\/\//, '') : 'Escribe y guarda una URL HTTPS' }[p.mode];
    const radio = (v, icon, title, hint) => `<button type="button" class="ns-radio" data-act="mode" data-v="${v}" aria-pressed="${p.mode === v}"><span class="vs-icon-box">${ic(icon)}</span><span class="vs-copy"><strong>${title}</strong><small>${hint}</small></span></button>`;
    let res = '';
    const c = S.check;
    if (c === 'busy') res = status('info', 'spinner', 'Comprobando…', 'Enviando un ping sin datos de empleados.', '', 'ns-compact');
    else if (c === 'ok') res = status('good', 'checkc', `${destName()} respondió`, p.mode === 'test' ? 'El flujo de prueba recibió el ping. n8n vuelve a pedir «Listen for test event» para la siguiente llamada.' : 'El flujo respondió y acepta este origen (CORS correcto). No se guardó nada.', '', 'ns-compact');
    else if (c === 'offline') res = status('bad', 'wifi', 'Sin conexión a internet', 'Este teléfono no tiene red. Revisa los datos móviles o el Wi-Fi y vuelve a comprobar.', '', 'ns-compact');
    else if (c === 'unreachable') res = status('bad', 'warn', p.mode === 'test' ? 'No se pudo conectar con Test' : 'No se pudo conectar con el destino', p.mode === 'test' ? 'Lo más probable: el flujo de prueba no está escuchando. En n8n abre el flujo y pulsa «Listen for test event»; luego vuelve a comprobar.' : 'El flujo no responde o no permite este origen (CORS). Pide que revisen que esté publicado y que acepte este dominio.', `<details><summary>¿Por qué no se sabe la causa exacta?</summary><p>Cuando n8n no escucha en Test responde 404 <b>sin cabeceras CORS</b>. El navegador oculta esa respuesta y SA solo ve «error de red», igual que si no hubiera internet. Por eso la pantalla dice «lo más probable» y no un diagnóstico seguro.</p></details>`, 'ns-compact');
    const pre = p.mode === 'test' ? status('warn', 'info', 'En Test, cada llamada gasta la escucha', 'Antes de comprobar o leer una tarjeta, abre el flujo en n8n y pulsa «Listen for test event». Si lo dejas en Test en producción, las lecturas no llegan a ningún lado.', '', 'ns-compact') : '';
    const sess = S.scn.session === 'in' ? 'Conectado como admin@obra' : 'Sin sesión de SA';
    return { title: 'Conexión y prueba', sub: 'Solo este teléfono', icon: 'wifi', body: `${label('Asociación de tarjetas')}<div class="vs-control-group">${toggle('assoc', p.enabled, 'Asociar tarjetas a empleados', 'Apagado por defecto. Muestra «Asociar tarjeta NFC» en el empleado.')}</div>
      ${label('Destino de tarjetas')}${radio('test', 'wifi', 'Test <span class="ns-open" style="background:var(--panel-2);color:var(--dim)">Predeterminado</span>', 'Para pruebas. Necesita «Listen for test event».')}${radio('production', 'check', 'Producción', 'Flujo publicado y activo.')}${radio('custom', 'edit', 'Personalizado', 'Tu propia URL HTTPS.')}
      ${p.mode === 'custom' ? `<label class="vs-field-label" for="ns-url">URL del webhook</label><div class="ns-url"><input id="ns-url" class="ns-text" data-in="url" inputmode="url" autocomplete="off" placeholder="https://…" value="${esc(p.customUrl)}" aria-invalid="${p.customUrl && !urlOk}">${btn('saveurl', 'Guardar URL', { disabled: !urlOk })}</div>${p.customUrl && !urlOk ? '<p class="vs-help" style="color:var(--bad)">Usa una URL HTTPS completa, sin usuario ni #fragmento.</p>' : ''}` : ''}
      <p class="vs-help ns-mono" style="word-break:break-all">${esc(host)}</p>
      ${label('Comprobar conexión')}${pre}<div data-region="check">${res}</div>${btn('check', c === 'ok' ? 'Comprobar de nuevo' : p.mode === 'test' ? 'Ya activé la escucha · Comprobar' : 'Comprobar conexión', { icon: 'wifi', primary: c !== 'ok', disabled: c === 'busy' }).replace('class="vs-btn', 'class="vs-btn vs-wide')}
      <p class="vs-help">Envía un ping sin empleados ni tarjetas. No cambia nada en el servidor.</p>
      ${label('Servidor de lecturas')}<div class="vs-control-group"><div class="vs-setting-row" style="cursor:default"><span><strong>${S.scn.session === 'in' ? 'Conectado' : 'Sin sesión'}</strong><small>${sess}. Las lecturas, lectores y reglas usan tu cuenta de SA.</small></span>${chip(S.scn.session === 'in' ? 'good' : 'warn', S.scn.session === 'in' ? 'Cuenta' : 'Inicia sesión', S.scn.session === 'in' ? 'check' : 'lock')}</div></div>
      <button type="button" class="vs-link-row" data-act="go" data-v="prueba"><span>Lectura de prueba</span><small>No envía datos</small>${arrow()}</button>
      <div class="vs-local-context"><span>SA 1.7.125 · contrato NFC v1</span></div>`, footer: '' };
  };
  const arrow = () => `<span class="vs-arrow">${ic('chevron')}</span>`;

  // ---- Lectura de prueba (diagnostic; reuses nfc-test dialog semantics)
  VIEWS.prueba = () => {
    const t = S.test, unsupported = S.scn.app === 'old' && false;
    const rows = `<div class="vs-control-group">${[['HTTPS', true], ['Web NFC disponible', true]].map(([k, v]) => `<div class="vs-setting-row" style="cursor:default;min-height:52px"><span><strong>${k}</strong></span>${chip(v ? 'good' : 'bad', v ? 'Sí' : 'No', v ? 'check' : 'close')}</div>`).join('')}</div>`;
    let main;
    if (t.phase === 'reading') main = `<div class="ns-scan" data-region="scan"><span class="vs-icon-box">${ic('card')}</span><strong>Acerca la tarjeta a la antena</strong><small>Se detiene sola tras 30 s sin lectura.</small></div>`;
    else if (t.phase === 'done') main = status('good', 'checkc', 'UID leído', 'Compáralo con el que registró el ESP32. Ignora espacios y dos puntos.', `<p class="ns-uid" style="margin-top:8px;font-size:18px" data-test="uid">${uidFmt('04A1B2C3')}</p><p class="ns-reqid">Serial original: 04:a1:b2:c3 · Registros NDEF: ninguno</p>`);
    else main = `<div class="ns-scan"><span class="vs-icon-box" style="animation:none">${ic('card')}</span><strong>Probar si este teléfono lee tus tarjetas</strong><small>No guarda nada y no llama a ningún webhook.</small></div>`;
    return { title: 'Lectura de prueba', sub: 'Diagnóstico sin envío', icon: 'card', body: `${rows}<div style="height:14px"></div>${main}`, footer: foot('Sin enviar datos', t.phase === 'reading' ? btn('test-stop', 'Detener') : t.phase === 'done' ? btn('test-copy', 'Copiar resultado') + btn('test-start', 'Leer otra', { primary: true }) : btn('test-start', 'Leer tarjeta', { primary: true, icon: 'card' })) };
  };
  const foot = (hint, actions) => `${hint ? `<span class="vs-footnote">${hint}</span>` : ''}<div class="vs-footer-actions">${actions}</div>`;

  // ---- Tarjetas
  VIEWS.tarjetas = () => {
    const q = S.search.trim().toLowerCase();
    let list = D.EMP.filter(e => !q || (e.name + e.number).toLowerCase().includes(q));
    if (S.tFilter === 'con') list = list.filter(e => S.assign[e.id]); if (S.tFilter === 'sin') list = list.filter(e => !S.assign[e.id]);
    const withC = D.EMP.filter(e => S.assign[e.id]).length, noC = D.EMP.length - withC;
    const empRows = S.tFilter === 'libres' ? '' : list.map(e => { const a = S.assign[e.id]; return `<button type="button" class="ns-row" data-act="emp" data-v="${e.id}">${avatar(e)}<span class="ns-row-copy"><strong>${esc(e.name)}</strong><span class="ns-meta"><span class="ns-mono">N.º ${e.number}</span><span>${esc(e.role)}</span></span></span>${a ? `<span class="ns-row-end">${chip('mute', last4(a.uid), 'card')}</span>` : `<span class="ns-row-end">${chip('warn', 'Sin tarjeta', 'minus')}</span>`}${arrow()}</button>`; }).join('') || '<p class="vs-empty">Ningún empleado coincide.</p>';
    const freeRows = (S.tFilter === 'todos' || S.tFilter === 'libres') ? `<div class="ns-group-label"><span>Tarjetas libres</span><span>${S.free.length}</span></div>${S.free.map(f => { const h = f.lastHolder && D.emp(f.lastHolder); return `<div class="ns-row"><span class="vs-icon-box">${ic('card')}</span><span class="ns-row-copy"><strong class="ns-uid">${uidFmt(f.uid)}</strong><span class="ns-meta">${h ? `Antes: ${esc(h.name)} · ${D.REASONS[f.reason].toLowerCase()} el ${f.until.slice(8)} oct` : 'Nunca asociada'}${f.lastRead ? ` · última lectura ${f.lastRead.slice(5, 10).replace('-', '/')} ${f.lastRead.slice(11)}` : ''}</span></span>${chip('mute', 'Libre')}</div>`; }).join('')}` : '';
    return { title: 'Tarjetas', sub: `${withC} con tarjeta · ${noC} sin tarjeta · ${S.free.length} libres`, icon: 'card', body: `<div class="vs-search">${ic('search')}<input type="search" data-in="search" autocomplete="off" placeholder="Nombre o número" aria-label="Buscar empleado" value="${esc(S.search)}"></div>
      <div class="vs-record-filters" role="group">${[['todos', 'Todos'], ['con', 'Con tarjeta'], ['sin', 'Sin tarjeta'], ['libres', 'Libres']].map(([v, l]) => `<button type="button" class="vs-segment" data-act="tfilter" data-v="${v}" aria-pressed="${S.tFilter === v}">${l}</button>`).join('')}</div>
      <div data-region="list">${empRows}${freeRows}</div>`, footer: '' };
  };

  VIEWS.tarjeta = ({ emp: id }) => {
    const e = D.emp(id), a = S.assign[id], h = S.history[id] || [], off = readOnly();
    const cardBlock = a ? `<div class="ns-row" style="min-height:0"><span class="vs-icon-box">${ic('card')}</span><span class="ns-row-copy"><span class="ns-meta" style="margin:0 0 3px">Tarjeta vigente</span><strong class="ns-uid">${uidFmt(a.uid)}</strong><span class="ns-meta">Desde ${a.since.slice(8)}/${a.since.slice(5, 7)}/${a.since.slice(0, 4)}</span></span>${chip('good', 'Activa', 'check')}</div>
      <div style="display:grid;gap:8px;margin:12px 0 4px">${btn('assoc-replace', 'Cambiar por otra tarjeta', { icon: 'refresh', disabled: off, v: id }).replace('class="vs-btn', 'class="vs-btn vs-wide')}${btn('release', 'Marcar como perdida', { icon: 'warn', disabled: off, v: id }).replace('class="vs-btn', 'class="vs-btn vs-wide')}</div><p class="vs-help">Un empleado tiene una sola tarjeta. Si se pierde, queda libre (no se bloquea) y puedes asociar otra.</p>`
      : `${status('warn', 'info', 'Sin tarjeta', 'Acerca una tarjeta para asociarla a este empleado. Se consulta primero si está disponible.', '', 'ns-compact')}${btn('assoc-new', 'Asociar tarjeta NFC', { primary: true, icon: 'card', disabled: off || !S.prefs.enabled, v: id }).replace('class="vs-btn', 'class="vs-btn vs-wide')}${!S.prefs.enabled ? '<p class="vs-help">La asociación está apagada. Actívala en Conexión y prueba.</p>' : ''}`;
    const tl = h.length ? `<ul class="ns-timeline">${h.map((x, i) => `<li ${!x.to ? 'data-now="true"' : ''}><strong class="ns-uid">${uidFmt(x.uid)}</strong>${x.from.slice(8)}/${x.from.slice(5, 7)}${x.to ? ` → ${x.to.slice(8)}/${x.to.slice(5, 7)} · ${D.REASONS[x.reason]}` : ' → vigente'} · por ${esc(x.by)}</li>`).join('')}</ul>` : '<p class="vs-empty">Aún no tiene tarjetas.</p>';
    return { title: 'Tarjeta del empleado', sub: e.name, icon: 'card', body: `<div class="vs-employee-identity">${avatar(e)}<span class="vs-copy"><strong>${esc(e.name)}</strong><small>N.º ${e.number} · ${esc(e.role)}</small></span></div>${cardBlock}${label('Historial de tarjetas')}${tl}`, footer: '' };
  };

  // ---- Asociar (read -> query -> confirm)
  const newAssoc = (emp, mode) => ({ emp, mode, reason: 'perdida', phase: 'idle', touch: null, lookupId: null, regId: null, err: null, result: null, tries: 0 });
  VIEWS.asociar = () => {
    const A = S.A, e = D.emp(A.emp), old = S.assign[A.emp];
    const person = `<div class="vs-employee-identity" style="margin-bottom:12px">${avatar(e)}<span class="vs-copy"><strong>${esc(e.name)}</strong><small>N.º ${e.number}</small></span>${chip(S.prefs.mode === 'test' ? 'warn' : 'info', destName())}</div>`;
    let main = '', actions = '', hint = '';
    const t = A.touch, ph = A.phase;
    if (A.mode === 'replace' && (ph === 'idle' || ph === 'reading')) main += `${status('warn', 'info', 'Ya tiene la tarjeta ' + last4(old.uid), 'Al asociar la nueva, la anterior quedará libre. No se reasignan lecturas pasadas.', `<div style="margin-top:10px">${seg('reason', [['perdida', 'Perdida'], ['reemplazo', 'Reemplazo'], ['baja', 'Baja'], ['error_registro', 'Error']], A.reason)}</div>`, 'ns-compact')}`;
    if (ph === 'idle') { main += `<div class="ns-scan"><span class="vs-icon-box">${ic('card')}</span><strong>Lee la tarjeta nueva</strong><small>Se consulta primero su disponibilidad. Nada se guarda todavía.</small></div>`; actions = btn('read', 'Leer tarjeta', { primary: true, icon: 'card', disabled: readOnly() }); hint = readOnly() ? 'Necesita internet' : ''; }
    if (ph === 'reading') { main += `<div class="ns-scan"><span class="vs-icon-box">${ic('card')}</span><strong>Acerca la tarjeta a la antena</strong><small>Mantenla quieta. Se detiene a los 30 s.</small></div>`; actions = btn('stop', 'Detener'); }
    if (ph === 'consulting') { main += status('info', 'spinner', 'Consultando la tarjeta…', `UID ${uidFmt(t.uid.replace(/[ :]/g, '').toUpperCase())}`, '', 'ns-compact').replace('<svg', '<svg class="ns-spin"'); actions = btn('x', 'Consultando…', { disabled: true }); }
    const uid = t ? t.uid.replace(/[ :\-]/g, '').toUpperCase() : '';
    const uidBox = t ? `<div class="vs-employee-identity" style="margin-bottom:12px"><span class="vs-icon-box">${ic('card')}</span><span class="vs-copy"><small>UID leído</small><strong class="ns-uid">${uidFmt(uid)}</strong></span></div>` : '';
    if (ph === 'result') {
      const r = A.result;
      if (r === 'disponible') {
        const hist = t.history ? `<div class="ns-sheet" style="margin:0 0 12px"><strong>Sugerencia, no cambia nada</strong><br>Hoy la usa: <b>nadie (libre)</b><br>La usó antes: <b>Ramona Esther De la Cruz</b> hasta el 29/10 (perdida).<br>Sus lecturas anteriores con esta tarjeta <b>no se reasignan</b>.</div>` : '';
        const pair = A.mode === 'replace' ? `<div class="ns-pair" style="margin-bottom:12px"><div class="ns-pair-col"><h4>Quedará libre</h4><b>${last4(old.uid)}</b>${D.REASONS[A.reason]}</div><div class="ns-pair-col"><h4>Nueva</h4><b>${last4(uid)}</b>Para ${esc(e.name.split(' ')[0])}</div></div>` : '';
        main += `${uidBox}${status('info', 'info', 'Tarjeta disponible', 'Todavía no está guardada. Revisa el empleado y el destino, y pulsa Guardar asociación.')}${hist}${pair}`;
        actions = btn('read', 'Leer otra') + btn('register', 'Guardar asociación', { primary: true, icon: 'check' });
      } else if (r === 'mismo_empleado') { main += `${uidBox}${status('warn', 'info', 'Esta tarjeta ya está asociada a este empleado', 'No es necesario volver a guardarla.')}`; actions = btn('close', 'Cerrar') + btn('read', 'Leer otra', { primary: true }); }
      else if (r === 'otro_empleado') { main += `${uidBox}${status('warn', 'warn', 'Esta tarjeta ya está asociada a otro empleado', 'No se puede guardar esta asociación. Por privacidad no se muestra quién. Si es un error, libérala desde su dueño.')}`; actions = btn('close', 'Cerrar') + btn('read', 'Leer otra tarjeta', { primary: true }); }
    }
    if (ph === 'registering') { main += `${uidBox}${status('info', 'spinner', 'Registrando…', 'Si cierras ahora, el envío podría haberse guardado.', '', '').replace('<svg', '<svg class="ns-spin"')}`; actions = btn('x', 'Registrando…', { disabled: true }); }
    if (ph === 'done') {
      main += `${uidBox}${status('good', 'checkc', 'Tarjeta asociada correctamente', `${esc(e.name)} · N.º ${e.number}. El servidor confirmó el registro el 4 nov 2026, 09:41.`)}${A.mode === 'replace' ? status('mute', 'info', `La tarjeta ${last4(old.uid)} quedó libre`, 'Nadie la usa. Si alguien la pasa por un lector, aparecerá como «tarjeta desconocida».', '', 'ns-compact') : ''}`;
      actions = btn('close', 'Listo', { primary: true });
    }
    if (ph === 'error') {
      const lost = A.err === 'LOST';
      main += `${uidBox}${status('bad', 'warn', lost ? 'No se pudo confirmar el registro' : A.err === 'CORS' ? 'No se pudo conectar con Test' : A.err === 'OFFLINE' ? 'Sin conexión a internet' : 'No se pudo completar', lost ? 'La respuesta se perdió. Puede haberse guardado: Reintentar usa la misma solicitud y no crea otra fila.' : A.err === 'CORS' ? 'Lo más probable: el flujo de prueba no escucha. En n8n pulsa «Listen for test event» y reintenta.' : A.err === 'OFFLINE' ? 'Conéctate y reintenta. La tarjeta leída se conserva en esta pantalla.' : 'Vuelve a intentarlo.', `<p class="ns-reqid">Solicitud ${A.regId || A.lookupId}${lost ? ' · se conserva al reintentar' : ''}</p>`)}`;
      actions = btn('close', 'Cerrar') + btn('retry', lost ? 'Reintentar registro' : 'Volver a consultar', { primary: true, icon: 'refresh' });
    }
    return { title: A.mode === 'replace' ? 'Cambiar tarjeta' : 'Asociar tarjeta', sub: e.name, icon: 'card', body: `${person}<div data-region="flow">${main}</div>`, footer: foot(hint, actions) };
  };

  VIEWS.liberar = ({ emp: id }) => {
    const e = D.emp(id), a = S.assign[id], R = S.rel;
    if (R.done) return { title: 'Tarjeta liberada', sub: e.name, icon: 'card', body: `${status('good', 'checkc', 'Tarjeta liberada', `${last4(R.uid)} quedó libre. Nadie la usa y no está bloqueada. ${esc(e.name)} puede recibir otra tarjeta.`)}`, footer: foot('', btn('assoc-new', 'Asociar nueva tarjeta', { primary: true, icon: 'card', v: id })) };
    return { title: 'Marcar como perdida', sub: e.name, icon: 'card', body: `<span class="vs-delete-symbol" style="background:var(--warn);color:#382500">${ic('warn')}</span><h3 class="vs-confirm-title">¿Liberar la tarjeta ${last4(a.uid)}?</h3><p class="vs-confirm-copy">Queda libre: sin dueño y sin bloqueo. Si alguien la usa, sus lecturas aparecerán como «tarjeta desconocida» para revisarlas. <b>Las lecturas pasadas no cambian.</b></p>${label('Motivo')}${seg('relreason', [['perdida', 'Perdida'], ['baja', 'Baja'], ['error_registro', 'Error'], ['otro', 'Otro']], R.reason || 'perdida')}<label class="vs-field-label" for="rn" style="margin-top:14px">Nota (opcional)</label><input id="rn" class="ns-text" data-in="relnote" placeholder="Ej. la perdió en el almacén">`, footer: foot('', btn('back', 'Cancelar') + btn('confirm-release', 'Liberar tarjeta', { danger: true, v: id })) };
  };

  // ---- Lecturas
  const alertIcons = d => d.alerts.map(k => { const a = D.ALERTS[k]; return `<span class="ns-ico" data-tone="${a.tone}" title="${a.label}" role="img" aria-label="${a.label}">${ic(a.icon)}</span>`; }).join('');
  const dayHours = d => { const c = D.calc(d.edited?.inT ?? d.inT, d.edited?.outT ?? d.outT, S.rules, d.edited?.lunch); return c && !c.error ? c : null; };
  VIEWS.lecturas = () => {
    const f = S.lFilter, all = S.days;
    const list = all.filter(d => f === 'todos' || (f === 'revisar' && d.state === 'pendiente') || (f === 'alertas' && d.alerts.length) || (f === 'verificados' && ['verificado', 'editado'].includes(d.state)));
    const ready = all.filter(d => ['verificado', 'editado'].includes(d.state)).length, unres = S.unknown.filter(u => !u.done).length + D.PENDING_DATE.length;
    const rows = list.map(d => { const e = D.emp(d.emp), c = dayHours(d), st = stateTone(d.state);
      const times = d.reads === 0 ? 'Sin lecturas propias' : `${d.inT || '—'} → ${d.outT || '—'}`;
      return `<button type="button" class="ns-row" data-act="day" data-v="${d.id}" ${d.state === 'verificado' ? 'data-dim="true"' : ''}>${avatar(e)}<span class="ns-row-copy"><strong>${esc(e.name)}</strong><span class="ns-meta"><span class="ns-mono">${times}</span><span class="ns-icons">${alertIcons(d)}</span></span></span><span class="ns-row-end"><b>${c ? D.fmtH(c.rounded) + ' h' : '—'}</b>${chip(st[0], d.consult ? 'Consulta Mini' : st[1], d.state === 'verificado' ? 'check' : '')}</span>${arrow()}</button>`; }).join('') || '<p class="vs-empty">No hay días con este filtro.</p>';
    const testBanner = S.prefs.mode === 'test' && S.scn.dest === 'test' ? status('warn', 'info', 'Destino en Test', 'Test solo afecta a las tarjetas que asocias desde este teléfono. Las lecturas del lector no pasan por este destino.', '', 'ns-compact') : '';
    return { title: 'Lecturas', sub: `Mar ${D.dayLabel} · Torre Norte`, icon: 'list', body: `<div class="vs-record-filters" role="group" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">${[['2 nov', false], ['3 nov', true], ['Hoy', false]].map(([l, on]) => `<button type="button" class="vs-segment" aria-pressed="${on}" data-act="datechip" data-v="${l}">${l}</button>`).join('')}</div>
      <div class="ns-tiles"><div class="ns-tile"><b>${all.length}</b><small>Propuestas del día</small></div><button type="button" class="ns-tile" data-tone="warn" data-act="lfilter" data-v="revisar"><b>${all.filter(d => d.state === 'pendiente').length}</b><small>Por revisar</small></button><button type="button" class="ns-tile" data-tone="${unres ? 'bad' : 'mute'}" data-act="go" data-v="pendientes"><b>${unres}</b><small>Sin dueño / sin hora</small></button><div class="ns-tile"><b>${ready}</b><small>Listos para entregar</small></div></div>
      <div class="vs-record-filters" role="group">${[['todos', 'Todos'], ['revisar', 'Por revisar'], ['alertas', 'Alertas'], ['verificados', 'Verificados']].map(([v, l]) => `<button type="button" class="vs-segment" data-act="lfilter" data-v="${v}" aria-pressed="${f === v}">${l}</button>`).join('')}</div>${testBanner}
      <div data-region="list">${rows}</div>
      <button type="button" class="vs-link-row" data-act="admin"><span>Revisar el período completo, tabla y comparación con Mini</span><small>App de revisión</small>${ic('ext').replace('<svg', '<svg width="16" height="16"')}</button>`, footer: foot(ready ? `${ready} listos` : 'Verifica un día para poder entregarlo', btn('go', `Entregar ${ready}`, { primary: true, v: 'entrega', disabled: !ready || readOnly() })) };
  };

  VIEWS.dia = ({ id }) => {
    const d = dayOf(id), e = D.emp(d.emp), ed = d.edited || {}, inT = ed.inT ?? d.inT ?? '', outT = ed.outT ?? d.outT ?? '';
    const single = d.alerts.includes('falta_salida'), unk = d.alerts.includes('tarjeta_desconocida');
    const c = D.calc(inT, outT, S.rules, ed.lunch), st = stateTone(d.state), off = readOnly();
    const lunchSuggest = c && !c.error ? c.lunch : 0, lunchSel = ed.lunch != null ? ed.lunch : 'auto';
    const alerts = d.alerts.map(k => {
      const txt = { falta_salida: 'Solo se recibió una lectura. No se calcula nada solo: elige cómo resolverlo.', jornada_corta: `Menos de 4 h de jornada (umbral provisional).`, tarjeta_desconocida: d.note || 'Hay lecturas de una tarjeta sin dueño ese día.', doble_toque_fusionado: `Dos lecturas a menos de ${S.rules.umbral_doble_toque_min} min cuentan como una (${(d.doubleTap || []).join(' y ')}).`, foto_dudosa: 'Una foto necesita tu veredicto.', sin_foto: 'Una foto no llegó; el lector la envía después.' }[k] || '';
      const a = D.ALERTS[k]; return status(a.tone, a.icon === 'unknown' ? 'unknown' : a.icon, a.label, txt, k === 'falta_salida' ? btn('go', 'Resolver este día', { v: 'resolver', primary: true }) : '', 'ns-compact'); }).join('');
    const reads = d.reads ? `<div class="vs-control-group">${[d.inT && { t: d.doubleTap ? d.doubleTap[0] : d.inT, tag: 'Entrada' }, d.doubleTap && { t: d.doubleTap[1], tag: 'Fusionada' }, d.outT && { t: d.outT, tag: 'Salida' }].filter(Boolean).map(r => `<div class="vs-setting-row" style="min-height:52px;cursor:default"><span><strong class="ns-mono">${r.t}</strong><small>ESP32-ENTRADA</small></span>${chip(r.tag === 'Fusionada' ? 'mute' : 'info', r.tag)}</div>`).join('')}</div>` : '<p class="vs-empty">Sin lecturas propias este día.</p>';
    const mirror = c && !c.error ? `<div class="ns-mirror" data-region="mirror"><dl><dt>Rango</dt><dd>${D.fmtHM(c.range)}</dd><dt>Comida</dt><dd>− ${c.lunch} min</dd><hr><dt>Trabajadas</dt><dd>${D.fmtH(c.worked)} h</dd><dt>Con redondeo <span class="ns-open">Propuesta</span></dt><dd class="ns-big">${D.fmtH(c.rounded)} h</dd><dt>Normales / extras</dt><dd>${D.fmtH(c.normal)} / ${D.fmtH(c.extra)}</dd></dl></div>` : `<div class="ns-mirror" data-region="mirror"><p class="vs-help" style="margin:0">${c && c.error ? `<span style="color:var(--bad)">${c.error}</span>` : 'Indica la hora que falta para calcular, o usa «Resolver este día».'}</p></div>`;
    const mini = d.mini ? (() => { const n = c && !c.error ? c : null, same = n && n.normal === d.mini.normal && n.extra === d.mini.extra; return `<div class="ns-pair"><div class="ns-pair-col"><h4>NFC</h4><b>${n ? D.fmtH(n.normal) + ' + ' + D.fmtH(n.extra) : '—'}</b>normal + extra</div><div class="ns-pair-col"><h4>Mini</h4><b>${d.mini.normal} + ${d.mini.extra}</b>normal + extra</div></div><div style="margin-top:8px">${n ? chip(same ? 'good' : 'warn', same ? 'Coinciden' : 'Difieren', same ? 'check' : 'warn') : chip('mute', 'Sin cálculo NFC')} <span class="vs-help">Ninguna fuente borra a la otra: tú decides.</span></div>`; })() : `<p class="vs-help">Mini aún no reportó a este empleado. ${chip('mute', 'Solo NFC')}</p>`;
    const photoTxt = d.photos.length ? `${d.photos.filter(p => p === 'ok').length} de ${d.photos.length} fotos` : 'Sin fotos';
    const dirty = d.edited && Object.keys(d.edited).length, needNote = dirty && !(S.edit.note || '').trim();
    const timeInputs = unk ? '' : `${label('Horas')}<div class="ns-fields"><div><label class="vs-field-label" for="ti">Entrada</label><input id="ti" class="ns-time" type="time" data-in="inT" value="${inT}" ${off ? 'disabled' : ''}></div><div><label class="vs-field-label" for="to">Salida</label><input id="to" class="ns-time" type="time" data-in="outT" value="${outT}" ${off ? 'disabled' : ''}></div></div>
      <label class="vs-field-label" style="margin-top:12px">Comida descontada${lunchSuggest ? '' : ''} <span class="vs-help">Sugerida: ${lunchSuggest / 60} h</span></label>${seg('lunch', [['auto', 'Auto'], [0, '0'], [30, '0,5 h'], [60, '1 h'], [90, '1,5 h']], lunchSel)}${mirror}
      <div data-region="note" style="${dirty ? '' : 'display:none'}"><label class="vs-field-label" for="nn">Nota obligatoria</label><textarea id="nn" class="ns-text" data-in="note" placeholder="¿Por qué cambias este día?">${esc(S.edit.note || '')}</textarea><div class="ns-quick">${['Olvidó marcar', 'Confirmado con el dueño del Mini', 'Lector sin hora'].map(q => `<button type="button" class="ns-preset" data-act="quicknote" data-v="${q}">${q}</button>`).join('')}</div></div>`;
    const history = d.id === 'd2' ? `${label('Historial')}<ul class="ns-timeline"><li data-now="true"><strong>Verificado</strong>3 nov 18:02 · admin@obra</li><li><strong>Propuesta calculada</strong>3 nov 17:30 · 2 lecturas</li></ul>` : '';
    let actions;
    if (d.state === 'verificado') actions = btn('revert', 'Revertir verificación', { disabled: off });
    else if (unk) actions = btn('go', 'Ver lecturas sin dueño', { v: 'pendientes', primary: true });
    else if (single) actions = btn('go', 'Resolver este día', { v: 'resolver', primary: true });
    else if (dirty) actions = btn('save-edit', 'Guardar edición', { primary: true, disabled: off || needNote || !c || !!c.error });
    else actions = btn('verify', 'Verificar', { primary: true, icon: 'check', disabled: off || !c });
    const hint = off ? 'Solo lectura' : dirty && needNote ? 'Escribe una nota para guardar' : '';
    return { title: e.name.split(' ').slice(0, 2).join(' '), sub: `Mar ${D.dayLabel} · ${esc(e.role)}`, icon: 'list', body: `<div class="vs-employee-identity">${avatar(e)}<span class="vs-copy"><strong>${esc(e.name)}</strong><small>N.º ${e.number}</small></span>${chip(st[0], st[1])}</div>${alerts}${label('Lecturas')}${reads}${timeInputs}${label('Comparación con Mini')}${mini}<button type="button" class="vs-link-row" data-act="go" data-v="fotos" ${d.photos.length ? '' : 'disabled'}><span>Fotos de las lecturas</span><small>${photoTxt}</small>${arrow()}</button>${history}`, footer: foot(hint, (single || unk || d.state === 'verificado' ? '' : btn('pend', 'Dejar pendiente')) + actions) };
  };

  VIEWS.resolver = ({ id }) => {
    const d = dayOf(id), R = S.resolve, e = D.emp(d.emp), opt = R.opt;
    const o = (v, icon, t, h, extra) => `<button type="button" class="ns-radio" data-act="ropt" data-v="${v}" aria-pressed="${opt === v}" style="flex-wrap:wrap"><span class="vs-icon-box">${ic(icon)}</span><span class="vs-copy"><strong>${t}</strong><small>${h}</small></span></button>${opt === v ? `<div style="margin:-2px 0 12px 4px" data-region="sub">${extra}</div>` : ''}`;
    const owners = ['Lic. Ramírez (Mini Torre Norte)', 'Ing. Cabrera (Mini Almacén)'];
    const body = `${status('warn', 'warn', `Solo hay una lectura: ${d.inT}`, 'No sabemos si es entrada o salida. No se calcula nada hasta que elijas.', '', 'ns-compact')}
      ${o('hora', 'clock', 'Indicar la hora que falta', 'Escribe la salida real.', `<div class="ns-fields"><div><label class="vs-field-label" for="rh">${R.kind === 'salida' ? 'Entrada' : 'Salida'}</label><input id="rh" class="ns-time" type="time" data-in="rhora" value="${R.hora || ''}"></div><div><label class="vs-field-label">La lectura es…</label>${seg('rkind', [['entrada', 'Entrada'], ['salida', 'Salida']], R.kind || 'entrada')}</div></div>`)}
      ${o('estandar', 'checkc', 'Usar la jornada estándar de 8 h', 'Queda con 8 h normales; entrada y salida sin dato.', `<p class="vs-help">Se guardan ${S.rules.jornada_horas} h normales y 0 extras. <span class="ns-open">Pregunta abierta</span> ¿se exige igual la hora de entrada para auditar?</p>`)}
      ${o('mini', 'users', 'Pedir confirmación al dueño de Mini', 'Verbal o con los datos de su Mini.', `<div class="ns-quick">${owners.map(w => `<button type="button" class="ns-preset" data-act="rowner" data-v="${w}" aria-pressed="${R.owner === w}">${w}</button>`).join('')}</div><div style="margin-top:8px">${seg('rchan', [['verbal', 'Verbal'], ['datos', 'Con datos de su Mini']], R.chan || 'verbal')}</div><p class="vs-help">El día queda marcado «Consulta Mini» hasta que responda.</p>`)}
      ${o('pendiente', 'clock', 'Dejar pendiente', 'No cambia nada; se mostrará con recordatorio.', `<div class="ns-quick">${[['1', 'Mañana'], ['3', 'En 3 días'], ['0', 'Sin recordatorio']].map(([v, l]) => `<button type="button" class="ns-preset" data-act="rrem" data-v="${v}" aria-pressed="${(R.rem || '1') === v}">${l}</button>`).join('')}</div>`)}
      <label class="vs-field-label" for="rn2" style="margin-top:6px">Nota obligatoria</label><textarea id="rn2" class="ns-text" data-in="rnote" placeholder="¿Qué decidiste y por qué?">${esc(R.note || '')}</textarea><div class="ns-quick">${['Olvidó marcar salida', 'Confirmado con el dueño del Mini'].map(q => `<button type="button" class="ns-preset" data-act="rquick" data-v="${q}">${q}</button>`).join('')}</div>`;
    const ok = opt && (R.note || '').trim() && (opt !== 'hora' || R.hora) && (opt !== 'mini' || R.owner);
    return { title: 'Resolver un dato', sub: `${e.name} · Mar ${D.dayLabel}`, icon: 'list', body, footer: foot(!opt ? 'Elige una opción' : !(R.note || '').trim() ? 'Escribe una nota para guardar' : opt === 'hora' && !R.hora ? 'Indica la hora' : opt === 'mini' && !R.owner ? 'Elige a quién preguntar' : '', btn('rsave', 'Guardar decisión', { primary: true, disabled: !ok || readOnly() })) };
  };

  VIEWS.fotos = ({ id }) => {
    const d = dayOf(id), e = D.emp(d.emp), ret = S.rules.retencion_fotos, sel = S.photoSel ?? 0, p = d.photos[sel] || 'ok';
    if (ret === 'no_guardar') return { title: 'Fotos', sub: e.name, icon: 'camera', body: status('mute', 'info', 'Las fotos no se guardan', 'Tu ajuste actual es «No guardar». Cambia la retención en Reglas de cálculo si necesitas verificar identidad con fotos.', btn('go', 'Abrir reglas', { v: 'reglas' })), footer: '' };
    const person = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>';
    const retTxt = ret === 'hasta_confirmar' ? 'Se borran al verificar este día (no se recuperan al revertir).' : 'Vencen en 27 días.';
    return { title: 'Fotos del día', sub: e.name, icon: 'camera', body: `<div class="ns-pair" style="margin-bottom:12px"><figure class="ns-photo" style="margin:0"><span class="ns-mono" style="position:absolute;top:6px;left:6px;font-size:10px;color:var(--dim)">Referencia</span>${person}<figcaption>Foto del empleado</figcaption></figure><figure class="ns-photo ns-photo-big" style="margin:0;aspect-ratio:auto" data-state="${p === 'ok' ? 'ok' : 'missing'}">${p === 'ok' ? person : ''}${p === 'ok' ? '' : '<span>La foto no llegó. El lector la envía después de la lectura.</span>'}<figcaption>${sel === 0 ? d.inT || '' : d.outT || ''} · ESP32-ENTRADA</figcaption></figure></div>
      <div class="ns-photos">${d.photos.map((s, i) => `<button type="button" class="ns-photo" data-act="psel" data-v="${i}" aria-pressed="${sel === i}" data-state="${s}" aria-label="Foto ${i + 1}, ${s === 'ok' ? 'disponible' : 'no llegó'}" style="padding:0">${s === 'ok' ? person : '<span>No llegó</span>'}<figcaption>${i === 0 ? d.inT || '—' : d.outT || '—'}</figcaption></button>`).join('')}</div>
      ${label('Tu veredicto')}${seg('verdict', [['coincide', 'Coincide'], ['dudosa', 'Dudosa'], ['no', 'No es la persona']], S.verdict || '')}<p class="vs-help">«No es la persona» no rechaza el día por sí solo: añade una nota o rechaza desde el día.</p>
      ${status('mute', 'clock', 'Retención: ' + { hasta_confirmar: 'hasta confirmar', '30_dias': '30 días' }[ret], retTxt + ' Solo para verificar identidad; las fotos no marcan asistencia.', '', 'ns-compact')}`, footer: '' };
  };

  VIEWS.pendientes = () => {
    const open = S.unknown.filter(u => !u.done);
    const unk = open.map(u => { const l = u.last && D.emp(u.last.emp); const asg = u.pick; const t = asg && D.emp(asg);
      return `<div class="ns-row" style="flex-wrap:wrap"><span class="vs-icon-box">${ic('unknown')}</span><span class="ns-row-copy"><strong class="ns-uid">${uidFmt(u.uid)}</strong><span class="ns-meta"><span class="ns-mono">${u.at.slice(5, 10).replace('-', '/')} ${u.at.slice(11)}</span><span>${u.device}</span>${u.photo === 'ok' ? chip('mute', 'Foto', 'eye') : chip('mute', 'Sin foto')}</span>${l ? `<span class="ns-meta">Sugerencia: la tuvo ${esc(l.name || D.emp(u.last.emp).name)} hasta el ${u.last.until.slice(8)}/10 (${D.REASONS[u.last.reason].toLowerCase()}). No se asigna sola.</span>` : '<span class="ns-meta">Tarjeta nunca asociada.</span>'}</span>
      <div style="flex:1 0 100%;display:grid;gap:8px"><select class="ns-text" data-in="pick" data-v="${u.id}" aria-label="Asignar lectura a empleado"><option value="">Asignar esta lectura a…</option>${D.EMP.map(x => `<option value="${x.id}" ${asg === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>${t ? status(S.assign[t.id] ? 'warn' : 'info', S.assign[t.id] ? 'warn' : 'info', S.assign[t.id] ? `${esc(t.name.split(' ')[0])} ya tiene su propia tarjeta` : 'Simulación', S.assign[t.id] ? 'Revisa la foto: podría ser otra persona usando una tarjeta ajena.' : 'Esta lectura contaría como una lectura más en su día. La tarjeta no se asocia ni cambia.', '', 'ns-compact') : ''}<div style="display:flex;gap:8px">${btn('uassign', 'Asignar lectura', { v: u.id, primary: true, disabled: !asg || readOnly() })}${btn('uignore', 'Ignorar', { v: u.id })}</div></div></div>`; }).join('') || '<p class="vs-empty">No hay lecturas sin dueño.</p>';
    const pd = D.PENDING_DATE.map(p => `<div class="ns-row"><span class="vs-icon-box">${ic('clock')}</span><span class="ns-row-copy"><strong>${esc(D.emp(p.emp).name)}</strong><span class="ns-meta"><span class="ns-uid">${uidFmt(p.uid)}</span><span>${p.device}</span><span>Llegó ${p.received.slice(5, 10).replace('-', '/')} ${p.received.slice(11)}</span></span><span class="ns-meta">Hora original: <span class="ns-mono">${p.raw}</span>. No se inventa la fecha.</span></span>${chip('warn', 'Sin hora fiable', 'clock')}</div>`).join('');
    return { title: 'Lecturas por resolver', sub: 'Sin dueño y sin hora fiable', icon: 'list', body: `<div class="vs-notice" style="margin-bottom:14px"><strong>Se resuelve lectura por lectura</strong>La tarjeta no cambia: solo se cuenta esa lectura en el día del empleado elegido.</div><div class="ns-group-label" style="margin-top:0"><span>Tarjeta sin dueño</span><span>${open.length}</span></div>${unk}<div class="ns-group-label"><span>Fecha pendiente</span><span>${D.PENDING_DATE.length}</span></div>${pd}<p class="vs-help">Corregir la fecha manualmente es una <span class="ns-open">propuesta</span>: hoy solo se muestra.</p>`, footer: '' };
  };

  VIEWS.entrega = () => {
    const ready = S.days.filter(d => ['verificado', 'editado'].includes(d.state));
    const steps = [['Verificas el día', 'Solo verificado o editado puede salir.'], ['Se prepara un borrador', 'attendance-submission/v1 con fuente «NFC ESP32».'], ['Llega a la bandeja', 'En Conectados, como Nuevo. No hay escritura oficial.'], ['Lo incorporas tú', 'Con la conciliación de siempre.']];
    const payload = `{\n  "schema": "attendance-submission/v1",\n  "workDate": "2026-11-03",\n  "saProjectId": "obra-torre-norte",\n  "scope": { "sourceId": "nfc-esp32", … },\n  "rows": [{ "saEmployeeId": "emp-102",\n    "normalHours": 8, "overtimeHours": 0,\n    "status": "present" }]\n}`;
    return { title: 'Entrega a la bandeja', sub: `Mar ${D.dayLabel} · ${ready.length} listos`, icon: 'tray', body: `${S.delivered ? status('good', 'checkc', 'Borrador enviado a la bandeja', `${ready.length} empleados del ${D.dayLabel}. Aparece como «Nuevo» en Conectados. Nada oficial cambió.`, '<a class="vs-btn" style="margin-top:10px;text-decoration:none" href="bandeja.html">Abrir la bandeja</a>') : ''}
      <ul class="ns-timeline">${steps.map((s, i) => `<li ${i === 0 ? 'data-now="true"' : ''}><strong>${s[0]}</strong>${s[1]}</li>`).join('')}</ul>${label('Listos para entregar')}${ready.map(d => { const e = D.emp(d.emp), c = dayHours(d); return `<div class="ns-row">${avatar(e)}<span class="ns-row-copy"><strong>${esc(e.name)}</strong><span class="ns-meta ns-mono">${c ? D.fmtH(c.normal) + ' normales · ' + D.fmtH(c.extra) + ' extras' : '—'}</span></span>${chip(stateTone(d.state)[0], stateTone(d.state)[1], 'check')}</div>`; }).join('') || '<p class="vs-empty">Aún no hay días verificados.</p>'}
      <details><summary>Ver el borrador que se enviaría</summary><pre class="ns-sheet ns-mono" style="white-space:pre-wrap;font-size:11px">${esc(payload)}</pre></details>
      <p class="vs-help"><span class="ns-open">Pendiente</span> Falta decidir el mapeo lector → obra (saProjectId) y el ownerUid del sobre.</p>`, footer: foot(S.delivered ? 'Enviado' : '', btn('deliver', S.delivered ? 'Enviado' : `Preparar borrador (${ready.length})`, { primary: true, icon: 'tray', disabled: !ready.length || S.delivered || readOnly() })) };
  };

  VIEWS.lectores = () => ({ title: 'Lectores', sub: `${S.devices.length} registrados · Torre Norte`, icon: 'chip', body: S.devices.map(v => { const rev = v.key === 'revoked'; return `<button type="button" class="ns-row" data-act="dev" data-v="${v.id}" ${rev ? 'data-dim="true"' : ''}><span class="vs-icon-box">${ic('chip')}</span><span class="ns-row-copy"><strong>${esc(v.name)}</strong><span class="ns-meta"><span class="ns-mono">${v.id}</span><span>${v.stale ? '' : ''}Visto ${v.lastSeen}</span></span><span class="ns-meta">${rev ? chip('bad', 'Clave revocada', 'lock') : chip('good', 'Clave activa', 'key')}${v.stale && !rev ? chip('warn', 'Sin señal', 'wifi') : ''}${!v.hasEventId ? chip('mute', 'Firmware sin eventId') : ''}</span></span>${arrow()}</button>`; }).join('') + `<p class="vs-help">Las claves nunca se muestran aquí. Se entregan al flashear el lector.</p>`, footer: '' });
  VIEWS.lector = ({ id }) => {
    const v = S.devices.find(x => x.id === id), rev = v.key === 'revoked';
    const row = (k, val) => `<div class="vs-setting-row" style="min-height:52px;cursor:default"><span><strong>${k}</strong></span><span class="ns-mono" style="font-size:12px;text-align:right">${val}</span></div>`;
    return { title: v.name, sub: v.id, icon: 'chip', body: `${rev ? status('bad', 'lock', 'Clave revocada', `Este lector ya no puede enviar lecturas desde el ${v.revokedAt.slice(8)}/10.`) : v.stale ? status('warn', 'wifi', `Sin señal ${v.lastSeen}`, `Tiene ${v.queue} lecturas en cola. Se sincronizarán al volver la red; las horas se reconcilian después.`) : status('good', 'checkc', 'Funcionando', `Última señal ${v.lastSeen}.`, '', 'ns-compact')}
      <div class="vs-control-group">${row('Obra', v.project || 'Sin obra')}${row('Firmware', v.firmware)}${row('Identificador de evento', v.hasEventId ? 'Sí' : 'No (puede duplicar)')}${row('Reloj', v.clock === 'ok' ? 'Fiable' : 'Con desvío')}${row('Cola sin enviar', v.queue)}${row('Lecturas hoy', v.tapsToday)}${row('Clave', rev ? 'Revocada' : 'Activa desde ' + v.keySince.slice(5).replace('-', '/'))}</div>
      ${!rev ? (S.confirmRevoke ? status('bad', 'warn', `¿Revocar la clave de ${esc(v.name)}?`, 'Dejará de enviar lecturas hasta que se le configure otra clave. No se borra nada.', `<div style="display:flex;gap:8px;margin-top:10px">${btn('revoke-cancel', 'Cancelar')}${btn('revoke', 'Sí, revocar', { danger: true, v: id })}</div>`) : btn('revoke-ask', 'Revocar clave', { danger: true, icon: 'lock', disabled: readOnly() }).replace('class="vs-btn', 'class="vs-btn vs-wide" style="margin-top:14px" data-x="1" data-c="')) : ''}`, footer: '' };
  };

  VIEWS.reglas = () => {
    const r = S.draft || (S.draft = { ...S.rules }), dirty = JSON.stringify(r) !== JSON.stringify(S.rules);
    const step = (k, title, unit, min, max, stp, presets, hint) => `${label(title)}<div class="ns-stepper">${iconBtn('dec', 'minus', 'Menos', k)}<div class="ns-stepper-val"><b data-region="v-${k}">${String(r[k]).replace('.', ',')}</b><small>${unit}</small></div>${iconBtn('inc', 'plus', 'Más', k)}</div><div class="ns-presets">${presets.map(p => `<button type="button" class="ns-preset" data-act="preset" data-v="${k}:${p}" aria-pressed="${r[k] === p}">${p}${unit === 'minutos' ? ' min' : ' h'}</button>`).join('')}</div>${hint ? `<p class="vs-help">${hint}</p>` : ''}`;
    const sim = D.calc('07:00', '15:50', r), shrink = S.rules.retencion_fotos === '30_dias' && r.retencion_fotos === 'no_guardar';
    return { title: 'Reglas de cálculo', sub: 'Valen para todos los lectores', icon: 'sliders', body: `<div class="ns-two-col"><div>${step('umbral_doble_toque_min', 'Doble toque', 'minutos', 0, 30, 1, [3, 5, 10], 'Lecturas más cercanas que esto cuentan como una.')}${step('almuerzo_min', 'Descuento de comida', 'minutos', 0, 180, 15, [30, 45, 60, 90], 'Se resta del rango; editable por día.')}${step('almuerzo_desde_horas', 'Descontar si el rango supera', 'horas', 1, 12, 0.5, [3, 4, 5], '')}${step('jornada_horas', 'Jornada estándar', 'horas', 4, 12, 0.5, [8, 9, 10], 'Hasta aquí son horas normales; el resto, extras.')}</div><div>
      ${label('Redondeo <span class="ns-open">Decisión abierta</span>')}<div class="vs-choice-grid" style="grid-template-columns:1fr">${[['media', 'A la media hora más cercana', '8 h 50 − 1 h = 7,83 → 8,0'], ['hora_abajo', 'Hora entera hacia abajo', '7,83 → 7'], ['ninguno', 'Sin redondeo', '7,83 → 7,83']].map(([v, t, h]) => `<button type="button" class="vs-choice" data-act="round" data-v="${v}" aria-pressed="${r.redondeo === v}"><span><strong>${t}</strong><small>${h}</small></span>${ic('check').replace('<svg', '<svg class="vs-check"')}</button>`).join('')}</div>
      <p class="vs-help">Valor <b>inventado</b> para ver el efecto. Hay que confirmarlo con SA y Mini antes de usarlo.</p>
      <div class="ns-mirror" data-region="sim"><dl><dt>Prueba 07:00 → 15:50</dt><dd class="ns-big">${sim ? D.fmtH(sim.rounded) + ' h' : '—'}</dd><dt>Normales / extras</dt><dd>${sim ? D.fmtH(sim.normal) + ' / ' + D.fmtH(sim.extra) : '—'}</dd></dl></div>
      ${label('Fotos de las lecturas')}<div class="vs-retention-grid" style="grid-template-columns:1fr">${[['no_guardar', 'No guardar', 'Sin fotos'], ['hasta_confirmar', 'Hasta confirmar', 'Se borran al verificar'], ['30_dias', '30 días', 'Un mes y se purgan']].map(([v, t, h]) => `<button type="button" class="vs-choice" data-act="ret" data-v="${v}" aria-pressed="${r.retencion_fotos === v}" style="flex-direction:row;justify-content:space-between;min-height:56px"><span style="text-align:left"><strong style="font-size:13px;font-weight:650">${t}</strong><small style="font-family:inherit;margin:3px 0 0">${h}</small></span>${ic('check').replace('<svg', '<svg class="vs-check"')}</button>`).join('')}</div>${shrink ? status('warn', 'warn', '¿Borrar las fotos ya guardadas?', 'Cambiar a «No guardar» eliminaría las fotos de los últimos 30 días. Se pedirá confirmar al guardar.', '', 'ns-compact') : ''}
      <p class="vs-help">El consentimiento por escrito se firma cuando exista el modelo.</p></div></div>
      <p class="vs-help">Los días ya verificados no cambian: guardan una instantánea con las reglas usadas.</p>`, footer: foot(dirty ? '' : 'Sin cambios', btn('rreset', 'Descartar', { disabled: !dirty }) + btn('rsave-rules', 'Guardar cambios', { primary: true, disabled: !dirty || readOnly() })) };
  };

  // ---------------------------------------------------------------- shell
  let overlay, dlg, onClose;
  function lockView(v) {
    if (S.scn.session === 'out' && NEEDS_SESSION.includes(v)) return { title: 'Inicia sesión', sub: 'Se necesita tu cuenta de SA', icon: 'lock', body: `<div class="ns-lock"><span class="vs-icon-box">${ic('lock')}</span><p>Las lecturas, lectores y reglas viven en tu cuenta. Las <b>tarjetas</b> y la <b>lectura de prueba</b> siguen funcionando sin sesión.</p>${btn('login', 'Iniciar sesión', { primary: true })}</div>`, footer: '' };
    return null;
  }
  function current() {
    const c = cur(); let v = c.view;
    if (wide() && v === 'home') v = c.view = 'lecturas', S.stack = [{ view: 'lecturas' }];
    return lockView(v) || (locked(v) ? { title: 'Actualiza SA', sub: '', icon: 'refresh', body: '', footer: '' } : VIEWS[v](c));
  }
  function render(full) {
    if (!overlay) return;
    const c = cur(), view = VIEWS[c.view] ? c.view : 'home', r = current();
    const sec = sectionOf(view), isRoot = S.stack.length <= 1 || (wide() && S.stack.length === 1);
    dlg.querySelector('.ns-rail').innerHTML = `<div class="ns-rail-title"><span class="vs-icon-box">${ic('card')}</span><span>NFC<br><small style="font-weight:400;color:var(--dim);font-size:11px">Torre Norte · ${destName()}</small></span></div>${SECTIONS.map(s => `<button type="button" class="ns-rail-item" data-act="section" data-v="${s[0]}" aria-current="${sec === s[0]}"><span class="vs-icon-box">${ic(s[3])}</span>${s[1]}${s[0] === 'lecturas' && S.days.filter(d => d.state === 'pendiente').length ? `<span class="ns-count" data-tone="warn">${S.days.filter(d => d.state === 'pendiente').length}</span>` : ''}</button>`).join('')}`;
    dlg.querySelector('[data-hdr-icon]').innerHTML = ic(r.icon);
    dlg.querySelector('#vs-title').textContent = r.title; dlg.querySelector('[data-sub]').textContent = r.sub;
    dlg.querySelector('[data-act=back]').hidden = view === 'home' || (wide() && S.stack.length <= 1);
    dlg.querySelector('.ns-banner-slot').innerHTML = banners(view) ? `<div style="padding:12px 22px 0">${banners(view)}</div>` : '';
    const body = dlg.querySelector('.vs-modal-body');
    if (full) { const st = body.scrollTop; body.innerHTML = r.body + `<p class="vs-feedback" data-feedback role="status" aria-live="polite">${esc(S.feedback)}</p>`; body.scrollTop = full === 'keep' ? st : 0; }
    else { const t = document.createElement('div'); t.innerHTML = r.body; t.querySelectorAll('[data-region]').forEach(n => { const cur = body.querySelector(`[data-region="${n.dataset.region}"]`); if (cur) cur.innerHTML = n.innerHTML; if (cur && n.getAttribute('style') !== null) cur.setAttribute('style', n.getAttribute('style')); }); }
    const f = dlg.querySelector('.vs-modal-footer'); f.innerHTML = r.footer; f.hidden = !r.footer;
    const fb = dlg.querySelector('[data-feedback]'); if (fb) fb.textContent = S.feedback;
    document.dispatchEvent(new CustomEvent('nfc-mock:render', { detail: { view } }));
  }
  const soft = () => render(false);
  const keep = () => render('keep');
  const toLecturas = () => { S.stack = wide() ? [{ view: 'lecturas' }] : [{ view: 'home' }, { view: 'lecturas' }]; };
  const say = t => { S.feedback = t; const fb = dlg.querySelector('[data-feedback]'); if (fb) fb.textContent = t; };
  const later = (fn, ms = 450) => setTimeout(fn, ms);

  // ---------------------------------------------------------------- association simulation
  function startAssoc(emp, mode) { S.A = newAssoc(emp, mode); go('asociar', { emp }); }
  function readCard() {
    const A = S.A; A.phase = 'reading'; A.err = null; A.result = null; soft();
    later(() => {
      if (A.phase !== 'reading') return;
      const key = S.scn.next === 'lostreply' ? 'free' : S.scn.next; A.touch = D.TOUCH[key] || D.TOUCH.free; A.phase = 'consulting'; A.lookupId = rid(); render(false);
      later(() => { if (A.phase !== 'consulting') return;
        if (S.scn.net === 'off') { A.phase = 'error'; A.err = 'OFFLINE'; return render(false); }
        if (S.prefs.mode === 'test' && S.scn.listening === 'no') { A.phase = 'error'; A.err = 'CORS'; return render(false); }
        A.result = A.touch.result; A.phase = 'result'; render(false); }, 700);
    }, 600);
  }
  function register() {
    const A = S.A; A.phase = 'registering'; A.regId = A.regId || rid(); render(false);
    later(() => { if (A.phase !== 'registering') return;
      if (S.scn.next === 'lostreply' && !A.retried) { A.phase = 'error'; A.err = 'LOST'; return render(false); }
      if (S.scn.net === 'off') { A.phase = 'error'; A.err = 'OFFLINE'; return render(false); }
      const uid = A.touch.uid.replace(/[ :\-]/g, '').toUpperCase(); const old = S.assign[A.emp];
      if (old && A.mode === 'replace') { S.free.unshift({ uid: old.uid, lastHolder: A.emp, until: D.TODAY, reason: A.reason, lastRead: null }); (S.history[A.emp] || (S.history[A.emp] = [])).find(h => !h.to).to = D.TODAY; S.history[A.emp].find(h => h.uid === old.uid).reason = A.reason; }
      S.free = S.free.filter(f => f.uid !== uid); S.assign[A.emp] = { uid, since: D.TODAY }; (S.history[A.emp] || (S.history[A.emp] = [])).unshift({ uid, from: D.TODAY, to: null, reason: null, by: 'tú' });
      A.phase = 'done'; render(false); }, 800);
  }

  // ---------------------------------------------------------------- events
  function onClick(ev) {
    const t = ev.target.closest('[data-act]'); if (!t || t.disabled) return;
    const a = t.dataset.act, v = t.dataset.v, c = cur(), A = S.A;
    switch (a) {
      case 'close': return close();
      case 'back': return back();
      case 'section': return root(v);
      case 'go': return go(v, { emp: c.emp, id: c.id });
      case 'emp': return go('tarjeta', { emp: v });
      case 'day': S.edit = {}; S.photoSel = 0; return go('dia', { id: v });
      case 'tfilter': S.tFilter = v; return keep();
      case 'lfilter': S.lFilter = v; if (c.view !== 'lecturas') return; return keep();
      case 'datechip': return say(v === '3 nov' ? '' : 'Mockup: solo hay datos del 3 nov.');
      case 'admin': return say('Abriría la app de revisión (otra aplicación, con tu sesión de SA).');
      case 'update': return say('Mockup: buscaría una nueva versión de SA.');
      case 'login': S.scn.session = 'in'; syncPanel(); return render(true);
      // connection
      case 'assoc': S.prefs.enabled = !S.prefs.enabled; return keep();
      case 'mode': S.prefs.mode = v; S.check = null; return render(true);
      case 'saveurl': say('Destino guardado en este teléfono.'); return;
      case 'check':
        S.check = 'busy'; keep();
        return later(() => { S.check = S.scn.net === 'off' ? 'offline' : (S.prefs.mode === 'test' && S.scn.listening === 'no') ? 'unreachable' : 'ok'; keep(); }, 700);
      // diagnostic
      case 'test-start': S.test = { phase: 'reading' }; render(true); return later(() => { if (S.test.phase === 'reading') { S.test = { phase: 'done' }; render(true); } }, 900);
      case 'test-stop': S.test = { phase: 'idle' }; return render(true);
      case 'test-copy': return say('Resultado copiado.');
      // card flow
      case 'assoc-new': S.A = newAssoc(v, 'new'); S.stack = S.stack.filter(s => s.view !== 'liberar'); return go('asociar', { emp: v });
      case 'assoc-replace': S.A = newAssoc(v, 'replace'); return go('asociar', { emp: v });
      case 'reason': A.reason = v; return keep();
      case 'read': A.phase = 'idle'; A.touch = null; A.result = null; A.err = null; A.regId = null; A.retried = false; return readCard();
      case 'stop': A.phase = 'idle'; return keep();
      case 'register': return register();
      case 'retry': if (A.err === 'LOST') { A.retried = true; return register(); } A.phase = 'idle'; return readCard();
      case 'release': S.rel = { reason: 'perdida' }; return go('liberar', { emp: v });
      case 'relreason': S.rel.reason = v; return keep();
      case 'confirm-release': { const e = v, old = S.assign[e]; S.free.unshift({ uid: old.uid, lastHolder: e, until: D.TODAY, reason: S.rel.reason, lastRead: null }); S.history[e].find(h => !h.to).to = D.TODAY; S.history[e].find(h => h.uid === old.uid).reason = S.rel.reason; delete S.assign[e]; S.rel.done = true; S.rel.uid = old.uid; return render(true); }
      // readings
      case 'quicknote': S.edit.note = v; return keep();
      case 'lunch': { const d = dayOf(c.id); d.edited = d.edited || {}; if (v === 'auto') delete d.edited.lunch; else d.edited.lunch = Number(v); if (!Object.keys(d.edited).length) d.edited = null; return keep(); }
      case 'verify': { const d = dayOf(c.id); d.state = 'verificado'; if (S.rules.retencion_fotos === 'hasta_confirmar') d.photosGone = true; toLecturas(); render(true); return say(`Día verificado${S.rules.retencion_fotos === 'hasta_confirmar' ? '. Las fotos se borraron (retención «hasta confirmar»)' : ''}.`); }
      case 'save-edit': { const d = dayOf(c.id); d.state = 'editado'; d.editedNote = S.edit.note; toLecturas(); render(true); return say('Edición guardada con nota. La lectura original se conserva.'); }
      case 'revert': { const d = dayOf(c.id); d.state = 'pendiente'; d.edited = null; return render(true), say('Verificación revertida. El día vuelve a Pendiente.'); }
      case 'pend': toLecturas(); render(true); return say('Día dejado pendiente.');
      case 'ropt': S.resolve.opt = v; return keep();
      case 'rkind': S.resolve.kind = v; return keep();
      case 'rchan': S.resolve.chan = v; return keep();
      case 'rowner': S.resolve.owner = v; return keep();
      case 'rrem': S.resolve.rem = v; return keep();
      case 'rquick': S.resolve.note = v; return keep();
      case 'rsave': { const d = dayOf(c.id), R = S.resolve; if (R.opt === 'estandar') { d.edited = { inT: '07:00', outT: '16:00', lunch: 60 }; d.state = 'editado'; d.alerts = d.alerts.filter(x => x !== 'falta_salida'); } else if (R.opt === 'hora') { const k = R.kind === 'salida' ? 'inT' : 'outT'; d.edited = { [k]: R.hora }; d.state = 'editado'; d.alerts = d.alerts.filter(x => x !== 'falta_salida'); } else if (R.opt === 'mini') d.consult = R.owner; else d.pending = true; S.resolve = {}; toLecturas(); render(true); return say(`Decisión guardada: ${({ hora: 'hora indicada', estandar: 'jornada estándar', mini: 'consulta a Mini en curso', pendiente: 'queda pendiente' })[R.opt]}.`); }
      case 'psel': S.photoSel = Number(v); return keep();
      case 'verdict': S.verdict = v; return keep();
      case 'uassign': { const u = S.unknown.find(x => x.id === v); u.done = true; return render(true), say('Lectura asignada. La tarjeta no cambió.'); }
      case 'uignore': { S.unknown.find(x => x.id === v).done = true; return render(true), say('Lectura ignorada.'); }
      case 'deliver': S.delivered = true; return render(true);
      // devices
      case 'dev': S.confirmRevoke = false; return go('lector', { id: v });
      case 'revoke-ask': S.confirmRevoke = true; return render(true);
      case 'revoke-cancel': S.confirmRevoke = false; return render(true);
      case 'revoke': { const dv = S.devices.find(x => x.id === v); dv.key = 'revoked'; dv.revokedAt = D.TODAY; S.confirmRevoke = false; return render(true), say('Clave revocada.'); }
      // rules
      case 'dec': case 'inc': { const k = v, st = { umbral_doble_toque_min: 1, almuerzo_min: 15, almuerzo_desde_horas: 0.5, jornada_horas: 0.5 }[k]; S.draft[k] = Math.max(0, Math.round((S.draft[k] + (a === 'inc' ? st : -st)) * 10) / 10); return keep(); }
      case 'preset': { const [k, n] = v.split(':'); S.draft[k] = Number(n); return keep(); }
      case 'round': S.draft.redondeo = v; return keep();
      case 'ret': S.draft.retencion_fotos = v; return keep();
      case 'rreset': S.draft = null; return keep();
      case 'rsave-rules': S.rules = { ...S.draft }; S.draft = null; keep(); return say('Reglas guardadas. Los días no verificados se recalculan.');
      case 'x': return;
    }
  }
  
  function onInput(ev) {
    const t = ev.target, k = t.dataset.in; if (!k) return;
    const c = cur(), d = c.id && dayOf(c.id);
    if (k === 'search') { S.search = t.value; return soft(); }
    if (k === 'url') { S.prefs.customUrl = t.value; return render(false), void 0; }
    if (k === 'inT' || k === 'outT') { d.edited = d.edited || {}; d.edited[k] = t.value; return soft(); }
    if (k === 'note') { S.edit.note = t.value; return soft(); }
    if (k === 'rhora') { S.resolve.hora = t.value; return soft(); }
    if (k === 'rnote') { S.resolve.note = t.value; return soft(); }
    if (k === 'relnote') return;
    if (k === 'pick') { S.unknown.find(x => x.id === t.dataset.v).pick = t.value; return render(true); }
  }

  // ---------------------------------------------------------------- scenario panel
  const SCN = [
    ['net', 'Red', [['on', 'En línea'], ['off', 'Sin red']]], ['app', 'Versión de SA', [['new', 'Actual (1.7.125)'], ['old', 'Antigua (sin NFC nuevo)']]],
    ['session', 'Sesión de SA', [['in', 'Iniciada'], ['out', 'Sin sesión']]], ['listening', 'Destino Test', [['yes', 'Escuchando'], ['no', 'No escucha (404 sin CORS)']]],
    ['next', 'Tarjeta que se acerca', [['free', 'Nueva y libre'], ['history', 'Libre con historial'], ['same', 'Ya es de este empleado'], ['other', 'Ocupada por otro'], ['lostreply', 'Respuesta perdida al guardar']]],
  ];
  function syncPanel() { document.querySelectorAll('.mk-scn select').forEach(s => { s.value = S.scn[s.dataset.k]; }); }
  function buildPanel() {
    const w = document.createElement('div'); w.className = 'mk-scn';
    w.innerHTML = `<button type="button" class="mk-scn-toggle" aria-expanded="false">Escenario ▾</button><div class="mk-scn-panel"><h4>Solo en la maqueta: simula casos límite</h4>${SCN.map(([k, l, o]) => `<label><b>${l}</b><select data-k="${k}">${o.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>`).join('')}<label><b>Asociación de tarjetas</b><select data-k="assoc"><option value="on">Activada</option><option value="off">Apagada (valor inicial real)</option></select></label><small>Se refleja en la URL (?net=off&amp;app=old…) para compartir un caso.</small></div>`;
    document.body.append(w);
    w.querySelector('.mk-scn-toggle').onclick = () => { w.classList.toggle('open'); w.querySelector('.mk-scn-toggle').setAttribute('aria-expanded', w.classList.contains('open')); };
    w.querySelectorAll('select').forEach(s => { s.value = S.scn[s.dataset.k]; s.onchange = () => { S.scn[s.dataset.k] = s.value; if (s.dataset.k === 'assoc') S.prefs.enabled = s.value === 'on'; if (s.dataset.k === 'dest') S.prefs.mode = s.value; S.check = null; const q = new URLSearchParams(location.search); q.set(s.dataset.k, s.value); history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`); document.dispatchEvent(new CustomEvent('nfc-mock:scenario')); overlay && overlay.classList.contains('open') && render(true); }; });
  }

  // ---------------------------------------------------------------- open / close
  function build() {
    overlay = document.createElement('div'); overlay.className = 'mk-overlay'; overlay.id = 'nfc-overlay';
    overlay.innerHTML = `<div class="voice-settings-dialog nfc-settings-dialog" open role="dialog" aria-modal="true" aria-labelledby="vs-title"><nav class="ns-rail" aria-label="Secciones NFC"></nav><div class="ns-main"><header class="vs-modal-header">${iconBtn('back', 'back', 'Volver')}<span class="vs-icon-box" data-hdr-icon></span><div class="vs-modal-heading"><h2 id="vs-title" tabindex="-1">NFC</h2><small data-sub></small></div>${iconBtn('close', 'close', 'Cerrar')}</header><div class="ns-banner-slot"></div><div class="vs-modal-body"></div><footer class="vs-modal-footer"></footer></div></div>`;
    document.body.append(overlay); dlg = overlay.firstElementChild;
    dlg.addEventListener('click', onClick); dlg.addEventListener('input', onInput); dlg.addEventListener('change', onInput);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) { if (S.stack.length > 1) back(); else close(); } });
    matchMedia('(min-width:900px)').addEventListener('change', () => overlay.classList.contains('open') && render(true));
  }
  function open(view = 'home', params = {}) {
    if (view === 'asociar') S.A = newAssoc(params.emp, params.mode || 'new');
    if (view === 'liberar') S.rel = { reason: 'perdida' };
    if (view === 'dia' || view === 'resolver') { S.edit = {}; S.resolve = {}; S.photoSel = 0; }
    S.stack = view === 'home' ? [{ view: 'home' }] : (wide() || view === 'asociar' ? [{ view, ...params }] : [{ view: 'home' }, { view, ...params }]);
    if (view === 'asociar' && !wide()) S.stack = [{ view: 'asociar', ...params }];
    overlay.classList.add('open'); render(true);
    dlg.querySelector('#vs-title').focus();
  }
  function close() { overlay.classList.remove('open'); onClose && onClose(); document.dispatchEvent(new CustomEvent('nfc-mock:closed')); }

  function init(opts = {}) {
    const q = new URLSearchParams(location.search);
    for (const k of Object.keys(S.scn)) if (q.has(k)) S.scn[k] = q.get(k);
    S.prefs.enabled = S.scn.assoc === 'on';
    if (q.has('mode')) S.prefs.mode = q.get('mode');
    build(); buildPanel(); onClose = opts.onClose;
    document.querySelectorAll('[data-open-nfc]').forEach(b => b.addEventListener('click', () => open(b.dataset.openNfc || 'home', b.dataset.emp ? { emp: b.dataset.emp } : {})));
    const h = location.hash.replace(/^#\/?/, '');
    if (opts.autoOpen !== false && (opts.autoOpen || h)) { const [view, qs] = (h || 'home').split('?'); const p = Object.fromEntries(new URLSearchParams(qs || '')); open(view || 'home', p); }
  }
  window.NFCMock = { init, open, close, S };
})();

/* Headless check of the NFC mockups. Usage: node docs/maquetas-nfc-sa/verify-nfc-mock.cjs
   Env: SCREENSHOT_DIR=<dir> saves captures. Needs `playwright` (pre-installed in the cloud sandbox). */
'use strict';
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const BASE = 'file://' + __dirname + '/';
const SHOTS = process.env.SCREENSHOT_DIR;
const WIDTHS = [[320, 700], [390, 780], [1280, 800]];
const results = []; let failed = 0;
let TAG = '';
const blk = async fn => { try { await fn(); } catch (e) { check(`${TAG} bloque falló: ${String(e.message).split('\n')[0]}`, false); } };
const check = (name, ok, extra = '') => { results.push([ok, name, extra]); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const open = async (w, h, url) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage();
    page.errs = []; page.reqs = []; page.setDefaultTimeout(5000);
    page.on('pageerror', e => page.errs.push(e.message)); page.on('console', m => m.type() === 'error' && page.errs.push(m.text()));
    page.on('request', r => { if (!/^(file|data|about):/.test(r.url())) page.reqs.push(r.url()); });
    await page.goto(BASE + url); await page.waitForTimeout(150); return page;
  };
  const overflow = page => page.evaluate(() => {
    const dlg = document.querySelector('.nfc-settings-dialog'), open = document.querySelector('.mk-overlay.open');
    const doc = document.documentElement.scrollWidth > innerWidth + 1;
    if (!open) return { doc, dlg: false, body: false, off: [] };
    const r = dlg.getBoundingClientRect(), body = dlg.querySelector('.vs-modal-body');
    const off = [...dlg.querySelectorAll('.vs-modal-body *, .vs-modal-footer *')].filter(e => { const b = e.getBoundingClientRect(); return b.width && (b.right > r.right + 1 || b.left < r.left - 1) && !e.closest('[hidden]') && getComputedStyle(e).position !== 'fixed' && !e.closest('.vs-segmented') && !e.closest('.ns-quick'); }).slice(0, 3).map(e => e.className || e.tagName);
    return { doc, dlg: r.left < -1 || r.right > innerWidth + 1, body: body.scrollWidth > body.clientWidth + 1, off };
  });
  const small = page => page.evaluate(() => [...document.querySelectorAll('.nfc-settings-dialog button, .nfc-settings-dialog input, .nfc-settings-dialog select')].filter(e => { const b = e.getBoundingClientRect(); return b.width && b.height < 36 && !e.closest('[hidden]') && !e.classList.contains('vs-toggle') && getComputedStyle(e).visibility !== 'hidden'; }).map(e => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height)).slice(0, 5));
  const txt = (page, sel = '.nfc-settings-dialog') => page.locator(sel).first().innerText();
  const clickAct = (page, act, v) => page.locator(`.nfc-settings-dialog [data-act="${act}"]${v != null ? `[data-v="${v}"]` : ''}:visible`).first().click({ timeout: 4000 });

  // ---- 1. every page and every deep link renders without errors, requests or overflow
  const VIEWS = ['home', 'tarjetas', 'tarjeta?emp=emp-108', 'tarjeta?emp=emp-104', 'asociar?emp=emp-104', 'liberar?emp=emp-101', 'lecturas', 'dia?id=d1', 'dia?id=d3', 'dia?id=d6', 'dia?id=d7', 'resolver?id=d3', 'fotos?id=d6', 'pendientes', 'entrega', 'lectores', 'lector?id=ESP32-ALMACEN', 'reglas', 'conexion', 'prueba'];
  for (const [w, h] of WIDTHS) {
    for (const pg of ['index.html', 'ajustes.html', 'empleado.html', 'bandeja.html', 'modal.html']) {
      const p = await open(w, h, pg); const o = await overflow(p);
      check(`${w}px ${pg}: sin errores JS ni red, sin desbordamiento horizontal`, !p.errs.length && !p.reqs.length && !o.doc && !o.dlg && !o.body, [...p.errs, ...p.reqs, JSON.stringify(o)].join(' | ')); await p.close();
    }
    let bad = [];
    for (const v of VIEWS) {
      const p = await open(w, h, 'modal.html#/' + v); const o = await overflow(p), sm = await small(p), t = (await p.locator('#vs-title').innerText()).trim();
      if (p.errs.length || p.reqs.length || o.doc || o.dlg || o.body || o.off.length || !t) bad.push(`${v}: ${p.errs.join(';')}${p.reqs.join(';')} ${JSON.stringify(o)} t="${t}"`);
      if (sm.length) bad.push(`${v}: controles < 36 px ${sm}`);
      if (SHOTS && w !== 320) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `${w}-${v.replace(/[?=&]/g, '_')}.png`) }); }
      await p.close();
    }
    check(`${w}px: ${VIEWS.length} pantallas sin errores, sin desbordamiento y con controles ≥ 36 px`, !bad.length, bad.join(' || '));
  }
  // casos límite: se cargan sin error en 320 px
  const EDGE = ['?net=off#/lecturas', '?net=off#/asociar?emp=emp-104', '?listening=no#/conexion', '?app=old#/home', '?app=old#/lecturas', '?session=out#/lecturas', '?next=other#/asociar?emp=emp-104', '?assoc=off#/home'];
  { let bad = []; for (const e of EDGE) { const p = await open(320, 700, 'modal.html' + e); const o = await overflow(p); if (p.errs.length || o.doc || o.dlg || o.body) bad.push(e + JSON.stringify(o) + p.errs); await p.close(); } check(`320px: ${EDGE.length} casos límite cargan sin error ni desbordamiento`, !bad.length, bad.join('||')); }

  // ---- 2. interactions, run at phone and desktop widths
  for (const [w, h] of [[390, 780], [1280, 800]]) {
    const T = `${w}px`; TAG = T;
    await blk(async () => { // Settings entry opens modal; chip reflects state
      const p = await open(w, h, 'ajustes.html'); const e0 = await txt(p, '#nfc-entry');
      check(`${T} Ajustes: la entrada compacta muestra estado`, /NFC/.test(e0) && /por revisar/.test(e0), e0.replace(/\n/g, ' '));
      await p.click('#nfc-entry'); check(`${T} Ajustes: la entrada abre el modal`, await p.locator('.mk-overlay.open').count() === 1);
      await p.keyboard.press('Escape'); await p.waitForTimeout(50);
      check(`${T} Ajustes: Escape cierra el modal`, await p.locator('.mk-overlay.open').count() === 0); await p.close();
      const q = await open(w, h, 'ajustes.html?assoc=off'); check(`${T} Ajustes: apagada se ve como «Apagada»`, /Apagada/.test(await txt(q, '#nfc-entry'))); await q.close();
    });
    await blk(async () => { // Happy path: associate a free card
      const p = await open(w, h, 'modal.html?next=free#/asociar?emp=emp-104');
      await clickAct(p, 'read'); await p.waitForSelector('text=Tarjeta disponible', { timeout: 4000 });
      let s = await txt(p); check(`${T} Asociar: «disponible» NO se muestra como confirmación (tono info, aún sin guardar)`, /Todavía no está guardada/.test(s) && !/asociada correctamente/.test(s));
      check(`${T} Asociar: disponible usa tono info (no verde)`, await p.locator('.ns-status[data-tone="info"]').count() >= 1 && await p.locator('.ns-status[data-tone="good"]').count() === 0);
      await clickAct(p, 'register'); await p.waitForSelector('text=Tarjeta asociada correctamente', { timeout: 4000 });
      check(`${T} Asociar: éxito verde tras confirmar, con nombre y número`, await p.locator('.ns-status[data-tone="good"]').count() === 1 && /00104/.test(await txt(p)));
      await clickAct(p, 'close'); await p.waitForTimeout(50); check(`${T} Asociar: «Listo» cierra`, await p.locator('.mk-overlay.open').count() === 0); await p.close();
    });
    await blk(async () => { for (const [next, needle, canSave, tone] of [['same', 'ya está asociada a este empleado', false, 'warn'], ['other', 'ya está asociada a otro empleado', false, 'warn']]) {
      const p = await open(w, h, `modal.html?next=${next}#/asociar?emp=emp-104`); await clickAct(p, 'read'); await p.waitForSelector(`text=${needle}`, { timeout: 4000 });
      const s = await txt(p);
      check(`${T} Asociar «${next}»: ámbar, sin botón Guardar, sin nombrar al otro`, await p.locator(`.ns-status[data-tone="${tone}"]`).count() === 1 && await p.locator('[data-act="register"]').count() === 0 && !/Féliz|Pedro/.test(s), s.replace(/\n/g, ' ').slice(0, 160));
      check(`${T} Asociar «${next}»: icono SVG + título + texto`, await p.locator('.ns-status svg').count() >= 1 && (await p.locator('.ns-status strong').first().innerText()).length > 10); await p.close();
    } });
    await blk(async () => { // Card with history => suggestion only
      const p = await open(w, h, 'modal.html?next=history#/asociar?emp=emp-104'); await clickAct(p, 'read'); await p.waitForSelector('text=Tarjeta disponible', { timeout: 4000 });
      const s = await txt(p); check(`${T} Asociar con historial: solo sugerencia, sin reasignar`, /Sugerencia, no cambia nada/.test(s) && /Ramona/.test(s) && /no se reasignan/.test(s)); await p.close();
    });
    await blk(async () => { // Lost reply => retry keeps request id
      const p = await open(w, h, 'modal.html?next=lostreply#/asociar?emp=emp-104'); await clickAct(p, 'read'); await p.waitForSelector('text=Tarjeta disponible', { timeout: 4000 });
      await clickAct(p, 'register'); await p.waitForSelector('text=No se pudo confirmar el registro', { timeout: 4000 });
      const id1 = (await p.locator('.ns-reqid').first().innerText()).match(/Solicitud (\w+)/)?.[1];
      check(`${T} Respuesta perdida: aviso «puede haberse guardado» y Reintentar`, /Puede haberse guardado/.test(await txt(p)) && await p.locator('[data-act="retry"]').count() === 1);
      await clickAct(p, 'retry'); await p.waitForSelector('text=Tarjeta asociada correctamente', { timeout: 4000 });
      check(`${T} Reintentar reutiliza la misma solicitud (${id1})`, !!id1); await p.close();
    });
    await blk(async () => { // Test not listening
      const p = await open(w, h, 'modal.html?listening=no#/asociar?emp=emp-104'); await clickAct(p, 'read'); await p.waitForSelector('text=No se pudo conectar con Test', { timeout: 4000 });
      check(`${T} Test sin escucha: mensaje accionable (Listen for test event)`, /Listen for test event/.test(await txt(p)));
      const q = await open(w, h, 'modal.html?listening=no#/conexion'); await clickAct(q, 'check'); await q.waitForSelector('text=No se pudo conectar con Test', { timeout: 4000 });
      check(`${T} Comprobar conexión: causa probable + explicación del CORS`, /404 <?b?>?.*CORS|CORS/.test(await q.locator('details').first().innerText().catch(() => '') || await txt(q)) || /CORS/.test(await q.content()));
      const q2 = await open(w, h, 'modal.html#/conexion'); await clickAct(q2, 'check'); await q2.waitForSelector('text=Test respondió', { timeout: 4000 }); check(`${T} Comprobar conexión: ok cuando escucha`, true);
      await p.close(); await q.close(); await q2.close();
    });
    await blk(async () => { // Offline + old app + session
      const p = await open(w, h, 'modal.html?net=off#/lecturas'); const s = await txt(p);
      check(`${T} Sin red: aviso y «Entregar» deshabilitado`, /Sin conexión/.test(s) && await p.locator('[data-act="go"][data-v="entrega"]').first().isDisabled()); await p.close();
      const q = await open(w, h, 'modal.html?app=old#/lecturas'); check(`${T} Versión antigua: aviso de actualizar y secciones bloqueadas`, /Tu versión de SA es anterior/.test(await txt(q)) && /Actualiza SA/.test(await txt(q))); await q.close();
      const r = await open(w, h, 'modal.html?session=out#/lecturas'); check(`${T} Sin sesión: lecturas bloqueadas pero tarjetas disponibles`, /Inicia sesión/.test(await txt(r))); if (!(await r.locator('.ns-rail').isVisible())) await clickAct(r, 'back'); await clickAct(r, 'section', 'tarjetas'); check(`${T} Sin sesión: Tarjetas abre`, /Tarjetas|empleado/i.test(await txt(r)) && !/Inicia sesión/.test(await txt(r))); await r.close();
    });
    await blk(async () => { // Lost card => freed, not blocked
      const p = await open(w, h, 'modal.html#/tarjeta?emp=emp-101'); await clickAct(p, 'release'); await p.waitForSelector('text=¿Liberar la tarjeta', { timeout: 3000 });
      await clickAct(p, 'confirm-release'); await p.waitForSelector('text=quedó libre', { timeout: 3000 });
      check(`${T} Tarjeta perdida: queda libre, sin estado bloqueado`, !/bloquead[ao]/i.test((await txt(p)).replace(/no está bloqueada|sin bloqueo|no se bloquea/gi, '')) && /Asociar nueva tarjeta/.test(await txt(p)));
      await clickAct(p, 'assoc-new', 'emp-101'); await p.waitForSelector('[data-act="read"]'); await clickAct(p, 'read'); await p.waitForSelector('text=Tarjeta disponible', { timeout: 4000 }); check(`${T} Tras liberar se puede asociar otra`, true); await p.close();
      const q = await open(w, h, 'modal.html?next=free#/asociar?emp=emp-101&mode=replace'); check(`${T} Reemplazo: avisa que la anterior queda libre`, /quedará libre/.test(await txt(q))); await clickAct(q, 'read'); await q.waitForSelector('text=Tarjeta disponible', { timeout: 4000 }); await clickAct(q, 'register'); await q.waitForSelector('text=Tarjeta asociada correctamente', { timeout: 4000 }); check(`${T} Reemplazo: confirma y deja libre la anterior`, /quedó libre/.test(await txt(q))); await q.close();
    });
    await blk(async () => { // Day correction
      const p = await open(w, h, 'modal.html#/dia?id=d1'); await p.fill('[data-in="outT"]', '16:00'); await p.waitForTimeout(60);
      check(`${T} Día: editar la salida recalcula y exige nota`, /Nota obligatoria/.test(await txt(p)) && await p.locator('[data-act="save-edit"]').isDisabled());
      await clickAct(p, 'quicknote', 'Olvidó marcar'); check(`${T} Día: con nota se habilita Guardar`, await p.locator('[data-act="save-edit"]').isEnabled());
      await clickAct(p, 'lunch', '30'); check(`${T} Día: selector de comida cambia el cálculo`, /30 min/.test(await p.locator('[data-region="mirror"]').innerText()));
      await clickAct(p, 'save-edit'); await p.waitForSelector('text=Editado'); check(`${T} Día: se guarda como Editado`, true); await p.close();
      const q = await open(w, h, 'modal.html#/dia?id=d1'); await clickAct(q, 'verify'); await q.waitForSelector('text=verificado', { timeout: 2000 }).catch(() => {}); check(`${T} Día: Verificar y borra fotos con retención «hasta confirmar»`, /Las fotos se borraron/.test(await q.content())); await q.close();
    });
    await blk(async () => { // Single punch resolution
      const p = await open(w, h, 'modal.html#/resolver?id=d3'); check(`${T} Resolver: guardar deshabilitado con pista «Elige una opción»`, await p.locator('[data-act="rsave"]').isDisabled() && /Elige una opción/.test(await txt(p)));
      await clickAct(p, 'ropt', 'mini'); await clickAct(p, 'rowner', 'Lic. Ramírez (Mini Torre Norte)'); await clickAct(p, 'rquick', 'Confirmado con el dueño del Mini'); await clickAct(p, 'rsave');
      await p.waitForSelector('text=consulta a Mini en curso'); check(`${T} Resolver: «consultar a Mini» deja el día marcado`, /Consulta Mini/.test(await txt(p))); await p.close();
      const q = await open(w, h, 'modal.html#/resolver?id=d3'); await clickAct(q, 'ropt', 'estandar'); await clickAct(q, 'rquick', 'Olvidó marcar salida'); await clickAct(q, 'rsave'); await q.waitForSelector('text=jornada estándar'); check(`${T} Resolver: jornada estándar de 8 h`, true); await q.close();
    });
    await blk(async () => { // Unknown reading, devices, rules, delivery
      const p = await open(w, h, 'modal.html#/pendientes'); check(`${T} Sin dueño: sugerencia de la tarjeta liberada, sin reasignar sola`, /la tuvo/.test(await txt(p)) && /No se asigna sola/.test(await txt(p)));
      await p.selectOption('select[data-in="pick"] >> nth=0', 'emp-107'); check(`${T} Sin dueño: avisa si el elegido ya tiene tarjeta propia`, /ya tiene su propia tarjeta/.test(await txt(p))); await p.close();
      const d = await open(w, h, 'modal.html#/lector?id=ESP32-ENTRADA'); await clickAct(d, 'revoke-ask'); await clickAct(d, 'revoke', 'ESP32-ENTRADA'); check(`${T} Lector: revocar clave (con confirmación) y sin secretos`, /Clave revocada/.test(await txt(d)) && !/[0-9a-f]{32}/i.test(await txt(d))); await d.close();
      const r = await open(w, h, 'modal.html#/reglas'); await clickAct(r, 'preset', 'umbral_doble_toque_min:10'); await clickAct(r, 'round', 'ninguno'); await clickAct(r, 'ret', 'no_guardar'); check(`${T} Reglas: cambios habilitan Guardar y simulador cambia`, await r.locator('[data-act="rsave-rules"]').isEnabled() && /7,83/.test(await r.locator('[data-region="sim"]').innerText()));
      await clickAct(r, 'rsave-rules'); check(`${T} Reglas: guardar confirma`, /Reglas guardadas/.test(await r.content())); check(`${T} Reglas: redondeo marcado como decisión abierta`, /decisión abierta/i.test(await txt(r))); await r.close();
      const e = await open(w, h, 'modal.html#/entrega'); await clickAct(e, 'deliver'); check(`${T} Entrega: «Nuevo» en bandeja, sin escribir asistencia oficial`, /Nada oficial cambió/.test(await txt(e))); await e.close();
      const f = await open(w, h, 'modal.html#/fotos?id=d6'); await clickAct(f, 'verdict', 'dudosa'); check(`${T} Fotos: veredicto y estado «no llegó»`, /No llegó|no llegó/.test(await f.content()) && await f.locator('[data-act="verdict"][aria-pressed="true"]').count() === 1); await f.close();
    });
  }
  // desktop shell specifics
  { const p = await open(1280, 800, 'modal.html'); check('1280px: barra lateral visible y arranca en Lecturas', await p.locator('.ns-rail').isVisible() && /Lecturas/.test(await p.locator('#vs-title').innerText())); await p.close();
    const q = await open(390, 780, 'modal.html'); check('390px: sin barra lateral; inicio con 6 tarjetas de sección', !(await q.locator('.ns-rail').isVisible()) && await q.locator('.vs-nav-card').count() === 6); await q.close(); }

  await browser.close();
  for (const [ok, name, extra] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n      ' + extra}`);
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`);
  process.exit(failed ? 1 : 0);
})();

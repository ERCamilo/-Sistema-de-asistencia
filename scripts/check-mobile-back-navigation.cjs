#!/usr/bin/env node
/**
 * Atrás/Adelante como app nativa (AppHistory) en Chromium headless real.
 *
 *   CHROMIUM_PATH=/snap/bin/chromium node scripts/check-mobile-back-navigation.cjs
 *
 * Sirve el repositorio en 127.0.0.1, bloquea Firebase/Google/n8n/Supabase y usa
 * datos sintéticos en IndexedDB. Escenarios:
 *  - móvil 390 px en modo standalone (matchMedia sustituido solo para
 *    display-mode, que CDP no emula): pestañas, subvistas, diálogo con Atrás,
 *    cierre por la ×, Adelante, guardia de salida, recarga, cambios sin guardar
 *    y doble Atrás rápido;
 *  - escritorio 1280 px en pestaña normal: sin guardia, Atrás sale de la app.
 * Atrás se dispara con history.back() (misma vía que el botón o el gesto del
 * sistema: popstate sin activación de usuario). Salida 0 si todo pasa.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const results = [];
const pass = label => { results.push(label); process.stdout.write(`PASS ${label}\n`); };

function serve() {
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/plain' };
    const server = http.createServer((req, res) => {
        const file = path.resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
        if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
        fs.readFile(file, (err, data) => {
            if (err) { res.writeHead(404).end(); return; }
            res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
            res.end(data);
        });
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openApp(browser, origin, { width, height, standalone }) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
        const host = new URL(req.url()).hostname;
        const blocked = ['googleapis.com', 'firebaseio.com', 'cloudfunctions.net', 'firebaseapp.com', 'supabase.co']
            .some(suffix => host.endsWith(suffix)) || host.includes('n8n');
        if (blocked) req.abort(); else req.continue();
    });
    await page.setViewport({ width, height, isMobile: width < 600, hasTouch: width < 600 });
    if (standalone) {
        await page.evaluateOnNewDocument(() => {
            const original = window.matchMedia.bind(window);
            window.matchMedia = query => (/display-mode:\s*standalone/.test(query)
                ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
                : original(query));
        });
    }
    await page.goto(origin + '/design.md');
    await page.evaluate(async () => {
        localStorage.setItem('onboardingCompleted', 'true');
        const { default: db } = await import('/js/modules/services/IndexedDBService.js');
        await db.init();
        await db.update('settings', { key: 'app', companyName: 'Prueba Navegación', regularHoursPerDay: 8, schemaVersion: 3, legacyNavigation: false });
        await db.update('positions', { id: 'pos-1', name: 'Ayudante', active: true, hourlyRate: 100 });
        for (const i of [1, 2]) {
            await db.update('employees', { id: 'emp-' + i, number: String(i), name: 'Persona ' + i, active: true, positions: ['pos-1'], loans: [] });
        }
    });
    await page.goto(origin + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => window.appHistory && window.appHistory.current && window.App?.state, { timeout: 30000 });
    await sleep(300);
    return { context, page, errors };
}

const nav = page => page.evaluate(() => {
    const s = history.state?.saNav || {};
    const st = window.App.state;
    return {
        tab: st.activeTab, kind: s.kind, idx: s.idx, depth: s.depth, view: s.view,
        len: history.length, profile: !!st.showEmployeeProfile,
        layers: window.appHistory.openLayers().length
    };
});

async function tap(page, selector) {
    await page.waitForSelector(selector, { visible: true, timeout: 10000 });
    await page.tap(selector);
    await sleep(450);
}

async function back(page, wait = 450) {
    await page.evaluate(() => history.back());
    await sleep(wait);
}

async function forward(page, wait = 450) {
    await page.evaluate(() => history.forward());
    await sleep(wait);
}

async function mobileStandalone(browser, origin) {
    const { context, page, errors } = await openApp(browser, origin, { width: 390, height: 844, standalone: true });
    const start = await nav(page);
    assert.equal(start.tab, 'attendance');
    assert.equal(start.idx, 0);
    const baseLen = start.len;

    // Capas anidadas en Asistencia: ficha rápida del empleado y, dentro, la hoja
    // de foto. Atrás cierra primero la hoja y después la ficha.
    await tap(page, '[data-att-action="view-employee-details"]');
    let n = await nav(page);
    assert.deepEqual([n.tab, n.kind, n.depth], ['attendance', 'layer', 1]);
    await tap(page, '.floating-card [data-employee-photo-acquisition-trigger]');
    const sheetOpen = () => page.evaluate(() => [...document.querySelectorAll('.floating-card [data-employee-photo-sheet]')].some(el => !el.hidden));
    assert.equal(await sheetOpen(), true);
    assert.equal((await nav(page)).depth, 2);
    await back(page);
    n = await nav(page);
    assert.equal(await sheetOpen(), false, 'Atrás cierra la hoja de foto');
    assert.equal(await page.evaluate(() => !!document.querySelector('.floating-card')), true, 'la ficha sigue abierta');
    assert.equal(n.depth, 1);
    await back(page);
    n = await nav(page);
    assert.equal(await page.evaluate(() => !!document.querySelector('.floating-card')), false);
    assert.deepEqual([n.tab, n.depth, n.idx], ['attendance', 0, 1]);
    pass('capas anidadas: Atrás cierra la hoja de foto y después la ficha del empleado');

    // Pestañas: una entrada por cambio real, ninguna por render.
    await tap(page, '.bottom-nav-tab[data-app-fn="openEmpleadosPersonal"]');
    n = await nav(page);
    assert.equal(n.tab, 'employees');
    assert.equal(n.idx, 2, 'guardia (1) + Personal (2)');
    const lenAfterPersonal = n.len;
    await page.evaluate(async () => { for (let i = 0; i < 6; i++) { window.render(); await new Promise(r => setTimeout(r, 30)); } });
    await sleep(200);
    assert.equal((await nav(page)).len, lenAfterPersonal);
    pass('pestañas: una entrada por navegación y ninguna por render repetido');

    // Diálogo: Atrás cierra la capa superior sin cambiar de pestaña.
    await tap(page, '[data-action="open-employee-profile"]');
    n = await nav(page);
    assert.equal(n.profile, true);
    assert.equal(n.kind, 'layer');
    assert.equal(n.depth, 1);
    await back(page);
    n = await nav(page);
    assert.equal(n.profile, false, 'Atrás cierra el perfil');
    assert.equal(n.tab, 'employees');
    assert.equal(n.kind, 'view');
    pass('Atrás cierra primero el diálogo abierto y se queda en la pestaña');

    // Adelante no reabre un diálogo cerrado.
    await forward(page);
    n = await nav(page);
    assert.equal(n.profile, false);
    assert.equal(n.tab, 'employees');
    assert.equal(n.kind, 'view');
    pass('Adelante no reabre un diálogo cerrado');

    // Cerrar con la × retira su entrada: el siguiente Atrás cambia de vista.
    await tap(page, '[data-action="open-employee-profile"]');
    assert.equal((await nav(page)).kind, 'layer');
    await tap(page, '[data-app-fn="close-employee-profile"]');
    n = await nav(page);
    assert.equal(n.profile, false);
    assert.equal(n.kind, 'view');
    assert.equal(n.idx, 2);
    pass('cerrar con la × retira la entrada del diálogo');


    // Subvistas y orden natural Atrás/Adelante.
    await tap(page, '.bottom-nav-tab[data-app-fn="openNomina"]');
    await tap(page, '.bottom-nav-tab[data-app-fn="openAjustesGenerales"]');
    n = await nav(page);
    assert.deepEqual([n.tab, n.idx], ['settings', 4]);
    await back(page);
    assert.equal((await nav(page)).tab, 'export');
    await back(page);
    assert.equal((await nav(page)).tab, 'employees');
    await forward(page);
    assert.equal((await nav(page)).tab, 'export');
    await forward(page);
    n = await nav(page);
    assert.deepEqual([n.tab, n.view.sub], ['settings', 'general']);
    pass('Atrás/Adelante recorren las pestañas en orden natural y Adelante reabre la vista');

    // Cambios sin guardar en Ajustes: Atrás pregunta y no pierde la posición.
    const dirtyField = await page.evaluate(() => {
        const input = document.querySelector('#company-name, #companyName, #settings-company-name, input[id*="company" i]');
        if (!input) return null;
        input.value = input.value + ' editado';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input.id;
    });
    if (dirtyField) {
        const dirty = await page.evaluate(async () => (await import('/js/modules/ui/settings/SettingsDraftBar.js')).isSettingsDraftDirty(document));
        if (dirty) {
            await back(page, 700);
            n = await nav(page);
            assert.equal(n.tab, 'settings', 'no sale con cambios sin guardar');
            // Recupera la entrada de Ajustes; el diálogo de confirmación puede
            // tener su propia entrada de capa encima.
            assert.ok(n.idx === 4 || (n.idx === 5 && n.kind === 'layer'), 'posición tras Atrás: ' + JSON.stringify(n));
            const confirmText = await page.evaluate(() => document.body.innerText.includes('Cambios sin guardar'));
            assert.ok(confirmText, 'muestra el diálogo de cambios sin guardar');
            // Atrás sobre el diálogo de confirmación equivale a «Quedarme».
            await back(page, 700);
            const confirmOpen = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => /Quedarme/.test(b.textContent) && b.getClientRects().length));
            assert.equal(confirmOpen, false, 'Atrás cierra el diálogo de confirmación');
            n = await nav(page);
            assert.deepEqual([n.tab, n.idx, n.kind], ['settings', 4, 'view']);
            await page.evaluate(async () => (await import('/js/modules/ui/settings/SettingsDraftBar.js')).discardSettingsDraft?.(document));
            pass('Ajustes con cambios sin guardar: Atrás pide confirmación y conserva la vista');
        }
    }

    // Recarga: la entrada conserva su vista y Atrás sigue funcionando.
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => window.appHistory && window.appHistory.current, { timeout: 30000 });
    await sleep(500);
    n = await nav(page);
    assert.equal(n.tab, 'settings');
    assert.equal(n.idx, 4);
    await back(page, 1500);
    await page.waitForFunction(() => window.appHistory && window.appHistory.current, { timeout: 30000 });
    await sleep(500);
    assert.equal((await nav(page)).tab, 'export');
    pass('recarga: se conserva la vista de la entrada y Atrás vuelve a la anterior');

    // Doble Atrás rápido: sin bucles ni errores.
    await page.evaluate(() => { history.back(); history.back(); });
    await sleep(1500);
    await page.waitForFunction(() => window.appHistory && window.appHistory.current, { timeout: 30000 });
    await sleep(400);
    n = await nav(page);
    assert.ok(['attendance', 'employees'].includes(n.tab), 'doble Atrás termina en una vista anterior: ' + n.tab);

    // Vista inicial: primer Atrás avisa, un toque rearma, segundo Atrás sale.
    while ((await nav(page)).idx > 1) await back(page, 1200);
    await page.waitForFunction(() => window.appHistory && window.appHistory.current, { timeout: 30000 });
    n = await nav(page);
    assert.equal(n.tab, 'attendance');
    await back(page, 700);
    n = await nav(page);
    assert.equal(n.idx, 0);
    assert.ok(page.url().endsWith('/index.html'), 'sigue dentro de la app');
    const hint = await page.evaluate(() => document.body.innerText.includes('Pulsa Atrás otra vez para salir'));
    assert.ok(hint, 'aviso de salida visible');
    pass('vista inicial: el primer Atrás no sale y muestra el aviso');

    await page.tap('.bottom-nav-tab[data-app-fn="changeTab"][data-arg="attendance"]');
    await sleep(400);
    assert.equal((await nav(page)).idx, 1, 'un toque rearma la guardia');
    await back(page, 700);
    assert.ok(page.url().endsWith('/index.html'));
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => location.pathname.endsWith('/design.md'), { timeout: 10000 });
    pass('guardia rearmada tras un toque; con dos Atrás seguidos se sale (no atrapa)');

    assert.deepEqual(errors, []);
    await context.close();
    return baseLen;
}

async function onboardingSteps(browser, origin) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
        const host = new URL(req.url()).hostname;
        if (['googleapis.com', 'firebaseio.com', 'supabase.co'].some(x => host.endsWith(x)) || host.includes('n8n')) req.abort(); else req.continue();
    });
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(origin + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('#onboarding-preview-overlay [data-act="next"]', { visible: true, timeout: 30000 });
    const step = () => page.evaluate(() => {
        const current = document.querySelector('#onboarding-preview-overlay [data-act="dot"][aria-current="step"]');
        return current ? Number(current.dataset.n) : null;
    });
    assert.equal(await step(), 1);
    await tap(page, '#onboarding-preview-overlay [data-act="next"]');
    await tap(page, '#onboarding-preview-overlay [data-act="next"]');
    assert.equal(await step(), 3);
    await back(page);
    assert.equal(await step(), 2, 'Atrás vuelve al paso anterior del onboarding');
    await back(page);
    assert.equal(await step(), 1);
    const open = await page.evaluate(() => !!document.querySelector('#onboarding-preview-overlay'));
    assert.equal(open, true, 'el onboarding sigue abierto en el primer paso');
    pass('onboarding: Atrás retrocede de paso dentro del diálogo');
    assert.deepEqual(errors, []);
    await context.close();
}

async function desktopBrowser(browser, origin) {
    const { context, page, errors } = await openApp(browser, origin, { width: 1280, height: 900, standalone: false });
    const sidebar = '.sidebar-nav [data-app-fn], nav [data-app-fn="openEmpleadosPersonal"]';
    await page.waitForSelector(sidebar, { timeout: 10000 });
    await page.evaluate(() => document.querySelector('[data-app-fn="openEmpleadosPersonal"]:not(.bottom-nav-tab)')?.click()
        || document.querySelector('[data-app-fn="openEmpleadosPersonal"]').click());
    await sleep(500);
    let n = await nav(page);
    assert.equal(n.tab, 'employees');
    assert.equal(n.idx, 1, 'sin guardia fuera de standalone');
    await back(page);
    assert.equal((await nav(page)).tab, 'attendance');
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => location.pathname.endsWith('/design.md'), { timeout: 10000 });
    pass('escritorio: Atrás vuelve a la pestaña anterior y luego sale sin guardia');
    assert.deepEqual(errors, []);
    await context.close();
}

(async () => {
    const { default: puppeteer } = await import('puppeteer-core');
    const server = await serve();
    const origin = 'http://127.0.0.1:' + server.address().port;
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    try {
        await mobileStandalone(browser, origin);
        await onboardingSteps(browser, origin);
        await desktopBrowser(browser, origin);
        process.stdout.write(`OK ${results.length} verificaciones\n`);
    } finally {
        await browser.close();
        server.close();
    }
})().catch(error => {
    console.error('FAILED', error);
    process.exitCode = 1;
});

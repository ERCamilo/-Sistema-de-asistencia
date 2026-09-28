#!/usr/bin/env node
/**
 * M2 — dos pestañas reales (mismo perfil de Chromium, mismo IndexedDB y
 * localStorage). La pestaña B está abierta con el dataset anterior cuando la
 * pestaña A restaura un respaldo (FILE, botón visible). B debe recargar sola y
 * no volver a guardar su estado viejo encima de lo restaurado.
 *
 *   CHROMIUM_PATH=/snap/bin/chromium node scripts/check-cross-tab-restore.cjs
 *
 * Datos sintéticos; Firebase/Google/n8n/Supabase bloqueados. Salida 0 si pasa.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function guard(page, errors) {
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
        const host = new URL(req.url()).hostname;
        const blocked = ['googleapis.com', 'firebaseio.com', 'cloudfunctions.net', 'firebaseapp.com', 'supabase.co']
            .some(suffix => host.endsWith(suffix)) || host.includes('n8n');
        if (blocked) req.abort(); else req.continue();
    });
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
}

async function seed(page, origin, names) {
    await page.goto(origin + '/design.md');
    await page.evaluate(async list => {
        localStorage.setItem('onboardingCompleted', 'true');
        const { default: db } = await import('/js/modules/services/IndexedDBService.js');
        await db.init();
        await db.clear('employees');
        await db.update('settings', { key: 'app', companyName: 'Prueba Pestañas', regularHoursPerDay: 8, schemaVersion: 3, legacyNavigation: false });
        await db.update('positions', { id: 'pos-1', name: 'Ayudante', active: true, hourlyRate: 100 });
        for (const [i, name] of list.entries()) {
            await db.update('employees', { id: 'emp-' + (i + 1), number: String(i + 1), name, active: true, positions: ['pos-1'], loans: [] });
        }
    }, names);
}

const openApp = async (page, origin) => {
    await page.goto(origin + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => typeof window.loadBackupFromFile === 'function' && window.App?.state?.employees?.length > 0, { timeout: 30000 });
};
const memoryNames = page => page.evaluate(() => window.App.state.employees.map(e => e.name).sort());
const storedNames = page => page.evaluate(async () => {
    const { default: db } = await import('/js/modules/services/IndexedDBService.js');
    return (await db.getAll('employees')).map(e => e.name).sort();
});

(async () => {
    const { default: puppeteer } = await import('puppeteer-core');
    const server = await serve();
    const origin = 'http://127.0.0.1:' + server.address().port;
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const errors = [];
    try {
        const context = await browser.createBrowserContext();
        const a = await context.newPage();
        await guard(a, errors);

        // Respaldo sintético exportado por la propia app (3 empleados).
        await seed(a, origin, ['Restaurada Uno', 'Restaurada Dos', 'Restaurada Tres']);
        await openApp(a, origin);
        const backup = await a.evaluate(async () => {
            await window.exportData();
            const { state } = await import('/js/modules/core/AppState.js');
            return JSON.parse(await state.exportMenuData.blob.text());
        });
        assert.equal(backup.data.employees.length, 3);

        // Dataset anterior (2 empleados) abierto en ambas pestañas.
        await seed(a, origin, ['Vieja Uno', 'Vieja Dos']);
        await openApp(a, origin);
        const b = await context.newPage();
        await guard(b, errors);
        await openApp(b, origin);
        assert.deepEqual(await memoryNames(b), ['Vieja Dos', 'Vieja Uno']);
        let bLoads = 0;
        b.on('load', () => { bLoads += 1; });

        // B tiene un guardado pendiente con su estado viejo.
        await b.bringToFront();
        await b.evaluate(() => {
            window.App.state.employees[0].name = 'Vieja Editada En B';
            window.saveToLocalStorage?.();
        });

        // A restaura el respaldo con el botón visible (el usuario vuelve a A;
        // B queda en segundo plano, como en un teléfono o un escritorio real).
        await a.bringToFront();
        await a.evaluate(payload => window.loadBackupFromFile(new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' })), backup);
        await a.waitForSelector('#btn-restore-local', { visible: true });
        await Promise.all([a.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }), a.click('#btn-restore-local')]);
        await a.waitForFunction(() => window.App?.state?.employees?.length === 3, { timeout: 30000 });

        // B recarga sola en segundo plano; al volver a ella muestra lo restaurado.
        await sleep(2500);
        await b.bringToFront();
        await b.waitForFunction(() => window.App?.state?.employees?.length === 3, { timeout: 30000 });
        assert.ok(bLoads >= 1, 'la pestaña B recargó');
        const restored = ['Restaurada Dos', 'Restaurada Tres', 'Restaurada Uno'];
        assert.deepEqual(await memoryNames(b), restored);
        process.stdout.write('PASS la pestaña abierta antes de restaurar recarga y adopta lo restaurado\n');

        // Nada viejo volvió a IndexedDB (ni el guardado pendiente ni el pagehide).
        await sleep(1500);
        assert.deepEqual(await storedNames(a), restored);
        await b.close();
        await sleep(500);
        assert.deepEqual(await storedNames(a), restored);
        process.stdout.write('PASS el estado viejo de la otra pestaña no pisa lo restaurado (ni al cerrarla)\n');

        assert.deepEqual(errors, []);
        await context.close();
        process.stdout.write('OK 2 verificaciones\n');
    } finally {
        await browser.close();
        server.close();
    }
})().catch(error => {
    console.error('FAILED', error);
    process.exitCode = 1;
});

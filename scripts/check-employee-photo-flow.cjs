#!/usr/bin/env node
/**
 * Foto del personal en Chromium móvil real, SIN sesión (sin subida): elegir
 * foto desde la ficha rápida del empleado (Asistencia), verla tras
 * recargar, cerrar la hoja con Atrás y eliminarla. Se cuenta cualquier petición
 * a n8n/Supabase (debe ser cero sin sesión). La subida con sesión, los
 * reintentos ante el 404 del proxy y la señal en Firestore están cubiertos por
 * Jest con backend simulado (EmployeePhotoProxyOutageCycle,
 * EmployeePhotoMetadataTests); aquí no hay Firebase ni n8n reales.
 *
 *   CHROMIUM_PATH=/snap/bin/chromium node scripts/check-employee-photo-flow.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = label => process.stdout.write(`PASS ${label}\n`);

// Toca el primer elemento visible (en móvil hay variantes ocultas por CSS).
async function tapVisible(page, selector) {
    const handles = await page.$$(selector);
    for (const handle of handles) {
        const box = await handle.boundingBox();
        if (box && box.width > 0 && box.height > 0) { await handle.tap(); await sleep(500); return; }
    }
    throw new Error('Sin elemento visible: ' + selector);
}

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

(async () => {
    const { default: puppeteer } = await import('puppeteer-core');
    const server = await serve();
    const origin = 'http://127.0.0.1:' + server.address().port;
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    // Chromium de snap tiene su propio /tmp y no lee carpetas ocultas de $HOME:
    // el archivo vive en una carpeta temporal visible que se borra al final.
    const tmp = fs.mkdtempSync(path.join(process.env.SA_PHOTO_TMP_ROOT || os.homedir(), 'sa-photo-check-'));
    try {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        const errors = [];
        const remoteCalls = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', req => {
            const host = new URL(req.url()).hostname;
            if (host.includes('n8n') || host.endsWith('supabase.co')) remoteCalls.push(host);
            const blocked = ['googleapis.com', 'firebaseio.com', 'cloudfunctions.net', 'firebaseapp.com', 'supabase.co']
                .some(suffix => host.endsWith(suffix)) || host.includes('n8n');
            if (blocked) req.abort(); else req.continue();
        });
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        await page.goto(origin + '/design.md');
        // Imagen sintética generada por el propio navegador (PNG 96×96).
        const png = await page.evaluate(async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 96; canvas.height = 96;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#0e7490'; ctx.fillRect(0, 0, 96, 96);
            ctx.fillStyle = '#f8fafc'; ctx.fillRect(24, 24, 48, 48);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            return [...new Uint8Array(await blob.arrayBuffer())];
        });
        const photoFile = path.join(tmp, 'foto.png');
        fs.writeFileSync(photoFile, Buffer.from(png));
        await page.evaluate(async () => {
            localStorage.setItem('onboardingCompleted', 'true');
            const { default: db } = await import('/js/modules/services/IndexedDBService.js');
            await db.init();
            await db.update('settings', { key: 'app', companyName: 'Prueba Fotos', regularHoursPerDay: 8, schemaVersion: 3, legacyNavigation: false });
            await db.update('positions', { id: 'pos-1', name: 'Ayudante', active: true, hourlyRate: 100 });
            await db.update('employees', { id: 'emp-1', number: '1', name: 'Persona Foto', active: true, positions: ['pos-1'], loans: [] });
        });
        await page.goto(origin + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForFunction(() => window.appHistory?.current && window.App?.state?.employees?.length === 1, { timeout: 30000 });

        const imageShown = selector => page.evaluate(sel => [...document.querySelectorAll(sel)]
            .some(img => !img.hidden && img.getAttribute('src')), selector);
        const storedPhoto = () => page.evaluate(async () => {
            const { default: db } = await import('/js/modules/services/IndexedDBService.js');
            await db.init();
            return new Promise(resolve => {
                const tx = db.db.transaction(['employeePhotos'], 'readonly');
                const req = tx.objectStore('employeePhotos').get('emp-1');
                req.onsuccess = () => resolve({ hasImage: !!req.result && Object.values(req.result).some(v => v instanceof Blob && v.size > 0) });
                req.onerror = () => resolve(null);
            });
        });

        const cardAvatarShown = () => page.evaluate(() => [...document.querySelectorAll('.floating-card [data-avatar-image]')]
            .some(img => !img.hidden && img.getAttribute('src')));
        const sheetOpen = () => page.evaluate(() => [...document.querySelectorAll('.floating-card [data-employee-photo-sheet]')].some(s => !s.hidden));
        const openCard = async () => {
            await tapVisible(page, '[data-att-action="view-employee-details"][data-id="emp-1"]');
            await page.waitForSelector('.floating-card', { visible: true, timeout: 10000 });
        };
        const openSheet = async () => {
            await tapVisible(page, '.floating-card [data-employee-photo-acquisition-trigger]');
            await page.waitForFunction(() => [...document.querySelectorAll('.floating-card [data-employee-photo-sheet]')].some(s => !s.hidden), { timeout: 10000 });
        };

        // Asistencia → ficha rápida → avatar → hoja.
        await openCard();
        await openSheet();
        pass('la hoja de foto se abre desde el avatar de la ficha del empleado');

        await page.evaluate(() => history.back());
        await sleep(500);
        assert.equal(await sheetOpen(), false);
        assert.equal(await page.evaluate(() => !!document.querySelector('.floating-card')), true);
        pass('Atrás cierra la hoja de foto y deja la ficha abierta');

        await openSheet();
        const input = await page.$('.floating-card [data-employee-photo-sheet]:not([hidden]) [data-employee-photo-input="gallery"]');
        assert.ok(input, 'entrada de galería');
        await input.uploadFile(photoFile);
        await page.waitForFunction(() => [...document.querySelectorAll('.floating-card [data-avatar-image]')]
            .some(img => !img.hidden && img.getAttribute('src')), { timeout: 15000 });
        assert.equal((await storedPhoto()).hasImage, true, 'foto guardada en IndexedDB');
        pass('la foto elegida se guarda en el dispositivo y aparece en la ficha');

        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForFunction(() => window.appHistory?.current, { timeout: 30000 });
        await openCard();
        await page.waitForFunction(() => [...document.querySelectorAll('.floating-card [data-avatar-image]')]
            .some(img => !img.hidden && img.getAttribute('src')), { timeout: 15000 });
        pass('tras recargar, la ficha sigue mostrando la foto');

        // Con foto, el avatar abre el visor: Atrás lo cierra; «Eliminar» borra.
        const viewerOpen = () => page.evaluate(() => [...document.querySelectorAll('[data-employee-photo-viewer]')].some(v => v.getClientRects().length));
        await tapVisible(page, '.floating-card [data-employee-avatar][data-employee-id="emp-1"]');
        await page.waitForFunction(() => [...document.querySelectorAll('[data-employee-photo-viewer]')].some(v => v.getClientRects().length), { timeout: 10000 });
        await page.evaluate(() => history.back());
        await sleep(500);
        assert.equal(await viewerOpen(), false, 'Atrás cierra el visor');
        assert.equal(await page.evaluate(() => !!document.querySelector('.floating-card')), true, 'la ficha sigue abierta');
        pass('con foto, el avatar abre el visor y Atrás lo cierra sin cerrar la ficha');

        await tapVisible(page, '.floating-card [data-employee-avatar][data-employee-id="emp-1"]');
        await page.waitForFunction(() => [...document.querySelectorAll('[data-employee-photo-viewer]')].some(v => v.getClientRects().length), { timeout: 10000 });
        page.once('dialog', dialog => dialog.accept());   // confirmación de borrado de la app
        await tapVisible(page, '[data-employee-photo-viewer] [data-employee-photo-action="delete"]');
        await page.waitForFunction(() => ![...document.querySelectorAll('.floating-card [data-avatar-image]')]
            .some(img => !img.hidden && img.getAttribute('src')), { timeout: 15000 });
        assert.equal((await storedPhoto()).hasImage, false, 'la imagen se eliminó del dispositivo');
        pass('eliminar la foto vuelve al avatar por defecto');

        assert.deepEqual(remoteCalls, [], 'sin sesión no hay llamadas a n8n/Supabase');
        assert.deepEqual(errors, []);
        await context.close();
        process.stdout.write('OK flujo local de foto\n');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        await browser.close();
        server.close();
    }
})().catch(error => {
    console.error('FAILED', error);
    process.exitCode = 1;
});

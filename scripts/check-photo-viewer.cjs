#!/usr/bin/env node
// Real image load/error events with synthetic Blobs and no account/network calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const names = fs.readFileSync(path.join(ROOT, 'js/modules/data/firebase.js'), 'utf8')
    .match(/export\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g, '').split(',').map(name => name.trim()).filter(Boolean);
const firebaseStub = names.map(name => name === 'auth' ? 'export const auth = {currentUser:null};' : `export const ${name} = () => {};`).join('\n');
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/styles.css"></head>
<body><div id="avatar"></div><script type="module">
import {EmployeePhotoViewerController,registerEmployeePhotoViewerEvents} from '/js/modules/ui/components/EmployeePhotoViewer.js';
import {EmployeeAvatar,hydrateEmployeeAvatars,cleanupEmployeeAvatars} from '/js/modules/ui/components/EmployeeAvatar.js';
const canvas=document.createElement('canvas');canvas.width=240;canvas.height=240;canvas.getContext('2d').fillRect(0,0,240,240);
const good=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp'));
const bad=new Blob(['invalid image'],{type:'image/webp'});
window.mode='missing';window.version=1;window.readCalls=0;window.urls=new Set();
const urls={createObjectURL(blob){const url=URL.createObjectURL(blob);window.urls.add(url);return url;},revokeObjectURL(url){window.urls.delete(url);URL.revokeObjectURL(url);}};
const record=()=>({version:window.version,thumbnailBlob:good,optimizedBlob:window.mode==='corrupt'?bad:good});
const photoStore={async getEmployeePhoto(){return record();},async getEmployeeOriginal(){window.readCalls++;if(window.mode==='slow')return new Promise(resolve=>window.completeRead=()=>resolve(record()));return window.mode==='missing'?{version:window.version,thumbnailBlob:good}:record();},async refreshEmployeePhoto(){return {status:'updated',record:record()};}};
document.getElementById('avatar').innerHTML=EmployeeAvatar({id:'employee-test',name:'Ana de prueba'});
await hydrateEmployeeAvatars(document,{photoStore,urlApi:urls});
window.viewer=new EmployeePhotoViewerController({photoStore,urlApi:urls});registerEmployeePhotoViewerEvents(document,window.viewer);
window.cleanupAvatars=()=>cleanupEmployeeAvatars(document);window.ready=true;
</script></body></html>`;

(async () => {
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://fixture').pathname;
        if (pathname === '/photo-fixture') { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
        if (pathname === '/js/modules/data/firebase.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(firebaseStub); return; }
        const file = path.resolve(ROOT, '.' + pathname);
        if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
        fs.readFile(file, (error, body) => {
            if (error) { res.writeHead(404).end(); return; }
            res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream'); res.end(body);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        const { default: puppeteer } = await import('puppeteer-core');
        browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        for (const width of [1440, 390, 320]) {
            const page = await browser.newPage(); const errors = [];
            await page.setViewport({ width, height: width === 320 ? 568 : 844 });
            page.on('pageerror', error => errors.push(error.message));
            await page.setRequestInterception(true);
            page.on('request', request => ['127.0.0.1', ''].includes(new URL(request.url()).hostname) ? request.continue() : request.abort());
            await page.goto(`http://127.0.0.1:${server.address().port}/photo-fixture`); await page.waitForFunction(() => window.ready);
            await page.click('[data-employee-photo-viewer-trigger]');
            await page.waitForSelector('[data-employee-photo-viewer-retry]:not([hidden])');
            const layout = await page.evaluate(() => {
                const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
                return { width: innerWidth, dialog: rect('[data-employee-photo-viewer-content]'), status: rect('[data-employee-photo-viewer-status]'), retry: rect('[data-employee-photo-viewer-retry]'), actions: rect('.employee-photo-viewer__actions') };
            });
            assert.ok(layout.dialog.left >= 0 && layout.dialog.right <= layout.width, JSON.stringify(layout));
            assert.ok(layout.status.bottom <= layout.retry.top && layout.retry.bottom <= layout.actions.top, JSON.stringify(layout));
            assert.equal(await page.evaluate(() => window.readCalls), 1);
            await page.evaluate(() => window.mode = 'corrupt');
            await page.click('[data-employee-photo-viewer-retry]');
            await page.waitForFunction(() => document.querySelector('[data-employee-photo-viewer-status]').textContent.includes('No se pudo mostrar'));
            assert.equal(await page.evaluate(() => window.urls.size), 1); // Only the avatar thumbnail.
            await page.evaluate(() => window.mode = 'slow');
            await page.focus('[data-employee-photo-viewer-retry]'); await page.keyboard.press('Enter');
            await page.waitForFunction(() => !!window.completeRead);
            assert.equal(await page.$eval('[data-employee-photo-viewer-retry]', el => el.disabled), true);
            await page.evaluate(() => { window.mode = 'ready'; window.completeRead(); });
            await page.waitForFunction(() => document.querySelector('[data-employee-photo-viewer-image]').naturalWidth === 240);
            assert.equal(await page.$eval('[data-employee-photo-viewer-retry]', el => el.hidden), true);
            assert.equal(await page.evaluate(() => document.activeElement.dataset.employeePhotoAction), 'update');
            const goodSource = await page.$eval('[data-employee-photo-viewer-image]', el => el.src);
            await page.evaluate(() => { window.mode = 'corrupt'; window.version = 2; });
            await page.click('[data-employee-photo-action="update"]');
            await page.waitForFunction(() => document.querySelector('[data-employee-photo-viewer-status]').textContent.includes('No se pudo mostrar'));
            assert.equal(await page.$eval('[data-employee-photo-viewer-image]', el => el.src), goodSource);
            await page.focus('[data-employee-photo-action="delete"]'); await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Cerrar foto');
            await page.keyboard.press('Escape');
            assert.equal(await page.$('[data-employee-photo-viewer]'), null);
            assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-employee-photo-viewer-trigger')), true);
            await page.evaluate(() => window.cleanupAvatars()); assert.equal(await page.evaluate(() => window.urls.size), 0);
            assert.deepEqual(errors, []);
            console.log(`PASS visor ${width}px: descarga fallida, decode real, reintento por teclado, copia visible, foco y URLs`);
            await page.close();
        }
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

#!/usr/bin/env node
// Real shipped modal and CSS, simulated NFC events. Physical cards need Android.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const output = process.env.NFC_TEST_ARTIFACT_DIR || '/tmp/sa-nfc-test';
const fixture = `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba NFC</title><link rel="stylesheet" href="/css/nfc-test.css"></head><body style="background:#0b1320;color:#f4f6fa;font-family:system-ui"><main id="entry"></main><script type="module">
import {NfcReadTest,SettingsNfcReadTestCard} from '/js/modules/ui/settings/NfcReadTest.js';
window.fixtureEnv={isSecureContext:window.isSecureContext,NDEFReader:class{constructor(){window.lastReader=this}async scan({signal}){this.signal=signal}},navigator:{clipboard:{writeText:async text=>{window.copied=text}}}};
window.nfcTest=new NfcReadTest({env:fixtureEnv}).mount();
document.querySelector('#entry').innerHTML=SettingsNfcReadTestCard();
document.querySelector('[data-settings-action=test-nfc-read]').addEventListener('click',()=>nfcTest.open());
window.emitCard=serial=>lastReader.onreading({serialNumber:serial,message:{records:[{recordType:'text',data:'not exported'}]}});
window.ready=true;
</script></body></html>`;
(async () => {
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://fixture').pathname;
        if (pathname === '/nfc-fixture') { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
        const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname));
        if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
        fs.readFile(file, (error, data) => {
            if (error) { res.writeHead(404).end(); return; }
            res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream'); res.end(data);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        const { default: puppeteer } = await import('puppeteer-core');
        browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage(); const errors = []; const outgoing = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (new URL(request.url()).hostname === '127.0.0.1') request.continue();
            else { outgoing.push(request.url()); request.abort(); }
        });
        fs.mkdirSync(output, { recursive: true });
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewport({ width, height: 740 });
            await page.goto(`http://127.0.0.1:${server.address().port}/nfc-fixture`); await page.waitForFunction('window.ready');
            await page.click('[data-settings-action=test-nfc-read]');
            await page.click('[data-nfc-test=start]');
            assert.equal(await page.evaluate(() => nfcTest.reading), true);
            await page.evaluate(() => emitCard('04:00:ab:cd:ef:12:34'));
            assert.equal(await page.$eval('[data-nfc-test=uid]', node => node.textContent), '0400ABCDEF1234');
            assert.equal(await page.evaluate(() => lastReader.signal.aborted), true);
            const layout = await page.evaluate(() => {
                const box = nfcTest.dialog.getBoundingClientRect();
                const buttons = [...nfcTest.dialog.querySelectorAll('button:not([hidden])')].map(button => {
                    const rect = button.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
                });
                return { left: box.left, right: box.right, bottom: box.bottom, top: box.top, overflow: nfcTest.dialog.scrollWidth > nfcTest.dialog.clientWidth, buttons };
            });
            assert.ok(layout.left >= 0 && layout.right <= width && layout.top >= 0 && layout.bottom <= 740, JSON.stringify(layout));
            assert.equal(layout.overflow, false);
            for (const button of layout.buttons) assert.ok(button.width >= 44 && button.height >= 44 && button.right <= width && button.bottom <= 740, JSON.stringify(button));
            await page.click('[data-nfc-test=copy]'); await page.waitForFunction('window.copied');
            assert.equal(JSON.parse(await page.evaluate(() => copied)).uid, '0400ABCDEF1234');
            await page.screenshot({ path: path.join(output, `nfc-read-${width}.png`) });
            await page.click('[data-nfc-test=start]'); await page.click('[data-nfc-test=stop]');
            assert.equal(await page.evaluate(() => lastReader.signal.aborted), true);
            await page.click('[data-nfc-test=start]'); await page.click('[data-nfc-test=close]');
            assert.equal(await page.evaluate(() => lastReader.signal.aborted && !nfcTest.dialog.open), true);
            await page.evaluate(() => { delete fixtureEnv.NDEFReader; nfcTest.open(); });
            assert.equal(await page.$eval('[data-nfc-test=start]', button => button.disabled), true);
            await page.screenshot({ path: path.join(output, `nfc-unsupported-${width}.png`) });
        }
        assert.deepEqual(errors, []); assert.deepEqual(outgoing, []);
        console.log('✓ NFC: 320/390/768/1440px, UID, clipboard, stop, close and unsupported API; no external requests. NFC events are simulated.');
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

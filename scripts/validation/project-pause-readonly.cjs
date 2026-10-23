// Run with Playwright available in NODE_PATH and a local static server.
// Uses a new browser context and synthetic fixtures; never opens the live app.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
    const origin = process.env.SA_TEST_ORIGIN || 'http://127.0.0.1:18761';
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const context = await browser.newContext({ acceptDownloads: true });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route(`${origin}/__project_test__`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><head><link rel="stylesheet" href="/css/project-management.css"></head><body><button id="start">Historial</button></body></html>' }));
        await page.goto(`${origin}/__project_test__`);
        await page.evaluate(async () => {
            const { Project } = await import('/js/modules/features/projects/Project.js');
            const { replaceEntityScope, peekEntityScope } = await import('/js/modules/features/projects/EntityProjectScope.js');
            const { ProjectReadOnlyContext } = await import('/js/modules/features/projects/ProjectReadOnlyContext.js');
            const { openProjectHistory } = await import('/js/modules/features/projects/ProjectHistoryUI.js');
            const project = Project.create({ id: 'history', name: 'Obra de prueba' }).pause();
            replaceEntityScope({ enabled: true, projectId: 'working', defaultProjectId: 'history' });
            window.testScope = peekEntityScope;
            const data = { employees: [{ id: 'e1', name: '=Prueba', projectId: 'history', loans: [{ id: 'l1', amount: 10 }] }, { id: 'e2', projectId: 'working' }], attendance: [{ employeeId: 'e1', projectId: 'history', date: '2026-10-23' }] };
            const source = new ProjectReadOnlyContext({ store: { get: async () => project.toJSON() }, idb: { getAll: async store => data[store] || [] }, defaultId: () => 'history' });
            window.testProject = project;
            document.getElementById('start').onclick = () => openProjectHistory('history', { context: source });
        });
        await page.click('#start');
        await page.getByRole('heading', { name: 'Historial: Obra de prueba' }).waitFor();
        assert.equal(await page.locator('#project-history-modal').getByText('Personal (1)', { exact: true }).count(), 1);
        assert.equal(await page.evaluate(() => window.testScope().projectId), 'working');
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Exportar CSV' }).click();
        assert.equal((await downloaded).suggestedFilename(), 'historial-history.csv');
        await page.evaluate(() => {
            window.printed = false;
            window.open = () => ({ document: { write: html => { window.printContent = html; }, close() {}, querySelectorAll: () => [] }, focus() {}, print: () => { window.printed = true; } });
        });
        await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
        assert.equal(await page.evaluate(() => window.printed && window.printContent.includes('Obra de prueba')), true);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#project-history-modal').count(), 0);
        assert.equal(await page.evaluate(() => { window.testProject.resume(); return window.testProject.status; }), 'active');
        assert.deepEqual(errors, []);
        console.log('PASS Playwright: isolated history, scope, CSV download, print, mobile viewport, Escape, resume.');
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

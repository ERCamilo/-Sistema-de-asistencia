const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

describe('F1 R02 — FULL import single-commit safety', () => {
    test('applyFullImport has no early compatibility persistence before restore', () => {
        const src = read('modules/features/export/ExportController.js');
        const start = src.indexOf('async function applyFullImport');
        const end = src.indexOf('export function confirmImportFull', start);
        const body = src.slice(start, end);
        expect(body).not.toMatch(/saveApplicationData\(\{\s*localOnly:\s*true\s*\}\)/);
        expect(body).not.toMatch(/preSave/);
    });

    test('success occurs only after petty cash, clearFirst and final awaited persistence', () => {
        const src = read('modules/features/export/ExportController.js');
        const start = src.indexOf('async function applyFullImport');
        const end = src.indexOf('export function confirmImportFull', start);
        const body = src.slice(start, end);
        const petty = body.indexOf('await restorePettyCashFromImport');
        const clear = body.indexOf('await saveToIndexedDB({ clearFirst: true })');
        const finalSave = body.indexOf('await saveApplicationData()', clear);
        const success = body.indexOf("notify('✅ Datos importados correctamente'");
        expect(clear).toBeGreaterThanOrEqual(0);
        expect(finalSave).toBeGreaterThan(clear);
        expect(success).toBeGreaterThan(finalSave);
        if (petty >= 0) expect(finalSave).toBeGreaterThan(petty);
    });
});

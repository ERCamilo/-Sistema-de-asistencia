/**
 * ExportControllerCoherenceTests — Fase 4 Paso 3 (familia 7: ExportController.applyFullImport).
 *
 * applyFullImport reemplaza TODO el dataset dentro de stateManager.batchSetState
 * (proxy silencioso → sin rebuild automático). Tras Paso 4 (y de hecho ya hoy,
 * hasta el reload) eso deja stats/índice stale. Debe mantener coherencia EXPLÍCITA:
 * total rebuild + limpieza mayorista de stats, tras sanitizePositions y antes de
 * persistir/render. Test de contrato sobre el fuente (igual que app.js: la función
 * no es exportada y arrastra deps de UI/reload).
 */

import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/export/ExportController.js'), 'utf8'
);

function applyFullImportBody() {
    const start = SRC.indexOf('function applyFullImport');
    if (start === -1) return '';
    const end = SRC.indexOf('export function confirmImportFull', start);
    return SRC.slice(start, end === -1 ? SRC.length : end);
}

testRunner.addSuite("ExportController.applyFullImport — Coherencia total (Fase 4 Paso 3)", {

    "importa invalidateAllStats y buildAttendanceIndex desde core/AppState"() {
        testRunner.assert(
            /import\s*\{[^}]*\binvalidateAllStats\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/core\/AppState\.js['"]/.test(SRC),
            'debe importar invalidateAllStats de ../../core/AppState.js'
        );
        testRunner.assert(
            /import\s*\{[^}]*\bbuildAttendanceIndex\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/core\/AppState\.js['"]/.test(SRC),
            'debe importar buildAttendanceIndex de ../../core/AppState.js'
        );
    },

    "applyFullImport mantiene coherencia total tras sanitizePositions y antes de persistir"() {
        const body = applyFullImportBody();
        testRunner.assert(body.length > 0 && body.length < 2500, 'el cuerpo de applyFullImport debe acotarse bien');
        testRunner.assert(body.includes('invalidateAllStats()'), 'debe limpiar todas las stats (bulk)');
        testRunner.assert(/buildAttendanceIndex\(\s*\)/.test(body), 'debe reconstruir el índice TOTAL (sin argumento)');
        // Orden: tras sanitizePositions, antes de saveApplicationData.
        const sanitizeIdx = body.indexOf('sanitizePositions(state)');
        const coherenceIdx = body.search(/invalidateAllStats\(\)/);
        const persistIdx = body.indexOf('saveApplicationData()');
        testRunner.assert(sanitizeIdx !== -1 && persistIdx !== -1, 'deben existir sanitizePositions y saveApplicationData');
        testRunner.assert(
            coherenceIdx > sanitizeIdx && coherenceIdx < persistIdx,
            'la coherencia debe ir tras sanitizePositions y antes de saveApplicationData'
        );
    }
});

console.log('ExportControllerCoherence tests cargados.');

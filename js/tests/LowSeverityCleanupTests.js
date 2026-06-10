/**
 * 🧪 LowSeverityCleanupTests (Auditoría 2026-06-09, hallazgos L2/L3/L5)
 *
 * L2 — migrateFromLocalStorage tenía como clave por defecto 'attendance-app-data',
 *      que NO coincide con la clave real de localStorage ('asistencia-data',
 *      APP_CONFIG.STORAGE_KEY). app.js la llama sin argumento → la migración
 *      buscaba una clave inexistente y nunca encontraba los datos legacy.
 *
 * L3 — saveState escribía settings como { key: 'app', ...state.settings }. Si
 *      state.settings llegara a tener una propiedad `key`, el spread pisaría
 *      'app' y rompería el keyPath del store. El `key: 'app'` debe ir DESPUÉS
 *      del spread para ganar siempre.
 *
 * L5 — importDB escribía registro por registro (update en bucle). En un backup
 *      grande eso es lento; debe usar batchUpdate.
 */

import fs from 'fs';
import path from 'path';

const IDB_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/IndexedDBService.js'), 'utf8'
);
const CONFIG_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/config/Config.js'), 'utf8'
);

testRunner.addSuite("Limpieza de baja severidad (L2/L3/L5)", {

    "L2: migrateFromLocalStorage usa la clave real 'asistencia-data' por defecto"() {
        const m = IDB_SRC.match(/migrateFromLocalStorage\s*\(\s*storageKey\s*=\s*'([^']+)'/);
        testRunner.assert(!!m, 'migrateFromLocalStorage debe tener un default de storageKey');
        testRunner.assertEquals(m[1], 'asistencia-data',
            'el default debe coincidir con la clave real de localStorage (APP_CONFIG.STORAGE_KEY)');
    },

    "L2: la clave por defecto coincide con APP_CONFIG.STORAGE_KEY"() {
        const m = CONFIG_SRC.match(/STORAGE_KEY:\s*"([^"]+)"/);
        testRunner.assert(!!m, 'APP_CONFIG.STORAGE_KEY debe existir');
        testRunner.assertEquals(m[1], 'asistencia-data', 'la clave real sigue siendo asistencia-data');
    },

    "L3: settings se escribe con key:'app' DESPUÉS del spread (no se puede pisar)"() {
        // Debe verse `{ ...state.settings, key: 'app' }`, NO `{ key: 'app', ...state.settings }`.
        testRunner.assert(
            /\{\s*\.\.\.state\.settings\s*,\s*key:\s*'app'\s*\}/.test(IDB_SRC),
            "saveState debe escribir { ...state.settings, key: 'app' } para que el keyPath nunca se pise"
        );
        testRunner.assert(
            !/\{\s*key:\s*'app'\s*,\s*\.\.\.state\.settings\s*\}/.test(IDB_SRC),
            "no debe quedar la forma vieja { key: 'app', ...state.settings } (vulnerable a settings.key)"
        );
    },

    "L5: importDB usa batchUpdate, no update en bucle"() {
        const block = IDB_SRC.match(/async importDB\s*\([\s\S]{0,1400}?\n    \}/);
        testRunner.assert(!!block, 'importDB debe existir');
        testRunner.assert(/batchUpdate\s*\(/.test(block[0]),
            'importDB debe escribir con batchUpdate (rápido), no update() registro por registro');
        testRunner.assert(
            !/for\s*\(const\s+\w+\s+of\s+data\.\w+\)\s*await\s+this\.update/.test(block[0]),
            'no debe quedar el patrón update() uno-por-uno en importDB'
        );
    }

});

/**
 * 🧪 AppWiringMigrationTests (Fase 4.1 paso 4c)
 *
 * Tests de contrato sobre app.js para asegurar que el cableado de la
 * migración no se rompa por refactors futuros. La lógica está probada
 * exhaustivamente en EmployeeLoaderTests; aquí solo verificamos que
 * app.js la conecte donde corresponde.
 */

import fs from 'fs';
import path from 'path';

const APP_PATH = path.resolve(__dirname, '../app.js');
const appSource = fs.readFileSync(APP_PATH, 'utf8');

testRunner.addSuite("app.js — Cableado de migración (Fase 4.1)", {

    "app.js importa loadAndMigrateEmployees"() {
        testRunner.assert(
            /from\s+['"]\.\/modules\/services\/EmployeeLoader\.js['"]/.test(appSource),
            "app.js debe importar el EmployeeLoader"
        );
    },

    "el callback de subscribeToChanges es async (porque usa await)"() {
        testRunner.assert(
            /subscribeToChanges\s*\(\s*async\s*\(/.test(appSource),
            "El callback debe ser async para poder await loadAndMigrateEmployees"
        );
    },

    "subscribeToChanges invoca loadAndMigrateEmployees"() {
        testRunner.assert(
            /loadAndMigrateEmployees\s*\(/.test(appSource),
            "Debe invocar loadAndMigrateEmployees dentro del callback"
        );
    },

    "subscribeToChanges propaga isDemo desde state.usingDemoData"() {
        // Encontramos la llamada y verificamos que pasa usingDemoData.
        const match = appSource.match(/loadAndMigrateEmployees\s*\(\s*\{[\s\S]*?\}\s*\)/);
        testRunner.assert(!!match, "Debe encontrarse la llamada");
        testRunner.assert(
            /usingDemoData/.test(match[0]),
            "Debe propagar state.usingDemoData a isDemo"
        );
    },

    "subscribeToChanges marca state.settings.schemaVersion tras migrar"() {
        // Sin esta propagación, saveFullState no sabría tomar el camino granular.
        testRunner.assert(
            /state\.settings\.schemaVersion\s*=/.test(appSource),
            "Debe asignar state.settings.schemaVersion para que saveFullState use el camino granular"
        );
    },

    "subscribeToChanges usa loaderResult.employees en vez de remoteData.employees"() {
        // Buscamos el bloque cerca de "newEmployees = dedup(loaderResult"
        testRunner.assert(
            /loaderResult\.employees/.test(appSource),
            "state.employees debe poblarse con loaderResult.employees (no remoteData.employees directo)"
        );
    }

});

console.log('🧪 App wiring migration contract tests cargados.');

/**
 * DataServiceCoherenceTests — Fase 4 Paso 3 (DataService.loadAll, carga masiva).
 *
 * loadAll() hace un REEMPLAZO TOTAL de state.attendance (carga legacy de
 * localStorage; se usa en la migración LS→IndexedDB, PersistenceService L655).
 * Tras Paso 4 el proxy ya no reconstruye nada, así que loadAll debe mantener la
 * coherencia EXPLÍCITAMENTE: rebuild TOTAL del índice + limpieza mayorista de
 * statsCache.mtd.
 *
 * ⚠️ POR QUÉ ES UN TEST DE CONTRATO SOBRE EL FUENTE (no de contexto silencioso):
 * DataService está auto-mockeado en toda la suite vía jest moduleNameMapper
 * (jest.config.js → __mocks__/DataService.js, donde loadAll es jest.fn()). Eso
 * hace IMPOSIBLE ejercitar el loadAll real por import normal. Seguimos la misma
 * convención que StorageResilienceTests: leer el fuente y verificar el contrato.
 * El comportamiento de buildAttendanceIndex() ya está cubierto por las
 * caracterizaciones de Fase 0 / NotesCoherence / AdvancedAttendanceCoherence.
 */

import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/DataService.js'), 'utf8'
);

// Aísla el cuerpo de loadAll() para que las aserciones no matcheen por accidente
// coherencia escrita en otro método.
function loadAllBody() {
    const start = SRC.indexOf('loadAll()');
    testRunner.assert(start !== -1, 'loadAll() debe existir en DataService');
    const next = SRC.indexOf('\n    async reset()', start);
    return SRC.slice(start, next === -1 ? SRC.length : next);
}

testRunner.addSuite("DataService.loadAll — Coherencia explícita (Fase 4 Paso 3)", {

    "importa buildAttendanceIndex e invalidateAllStats desde AppState"() {
        testRunner.assert(
            /import\s*\{[^}]*\bbuildAttendanceIndex\b[^}]*\}\s*from\s*['"]\.\.\/core\/AppState\.js['"]/.test(SRC),
            'DataService debe importar buildAttendanceIndex de ../core/AppState.js'
        );
        testRunner.assert(
            /import\s*\{[^}]*\binvalidateAllStats\b[^}]*\}\s*from\s*['"]\.\.\/core\/AppState\.js['"]/.test(SRC),
            'DataService debe importar invalidateAllStats de ../core/AppState.js'
        );
    },

    "tras cargar la asistencia, reconstruye el índice TOTAL (no granular)"() {
        const body = loadAllBody();
        // buildAttendanceIndex() SIN argumento = rebuild total (la carga masiva
        // cambia todo el mapa; granular por fecha sería incorrecto).
        testRunner.assert(
            /buildAttendanceIndex\(\s*\)/.test(body),
            'loadAll debe llamar buildAttendanceIndex() (total, sin argumento) tras la carga masiva'
        );
    },

    "tras cargar la asistencia, limpia statsCache mayoristamente vía invalidateAllStats()"() {
        const body = loadAllBody();
        testRunner.assert(
            /invalidateAllStats\(\s*\)/.test(body),
            'loadAll debe llamar invalidateAllStats() (las stats viejas son basura tras un restore)'
        );
    },

    "la coherencia vive DENTRO del bloque if (data.attendance) (no corre sin datos)"() {
        const body = loadAllBody();
        const guardIdx = body.indexOf('if (data.attendance)');
        const coherenceIdx = body.search(/invalidateAllStats\(\s*\)/);
        testRunner.assert(guardIdx !== -1, 'debe existir el guard if (data.attendance)');
        testRunner.assert(
            coherenceIdx > guardIdx,
            'la coherencia mayorista debe estar después del guard if (data.attendance), no en el camino sin asistencia'
        );
    }
});

console.log('DataServiceCoherence tests cargados.');

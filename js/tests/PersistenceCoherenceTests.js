/**
 * PersistenceCoherenceTests — Fase 4 Paso 3 (PersistenceService, 4 sitios bulk).
 *
 * Sitios:
 *  - mergeEmployees       → remapeo de claves duplicateId→masterId (multi-fecha).
 *  - restoreAutoBackup    → Object.assign masivo desde sessionStorage (antes SIN coherencia).
 *  - loadApplicationData   → Object.assign masivo desde IndexedDB (async + deps pesadas).
 *  - prepareDataForNewAccount → reescritura total de claves (async + deps pesadas).
 *
 * Los dos sync (merge/restore) se prueban CONDUCTUALMENTE en contexto silencioso
 * (batchSetState → proxy mudo): si índice/stats quedan coherentes, fue la
 * coherencia explícita. Los dos async se prueban por CONTRATO sobre el fuente
 * (deps de IndexedDB/Firebase/PettyCash hacen inviable el conductual), igual que
 * DataService. buildAttendanceIndex/invalidateAllStats ya están cubiertos aparte.
 */

import fs from 'fs';
import path from 'path';
import { state, stateManager } from '../modules/core/AppState.js';
import { mergeEmployees, restoreAutoBackup } from '../modules/services/PersistenceService.js';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);

function emptyState() {
    const raw = stateManager.getState();
    raw.attendance = {};
    raw.attendanceByDate = {};
    raw.statsCache.mtd = {};
    raw.employees = [];
    raw.settings.holidays = [];
    return raw;
}

// ───────────────────────── mergeEmployees (conductual) ─────────────────────────
testRunner.addSuite("PersistenceService.mergeEmployees — Coherencia (Fase 4 Paso 3)", {

    "en batchSetState remapea el índice y limpia stats de ambos empleados"() {
        const raw = emptyState();
        const mk = (id) => ({ id, name: id, positions: [], loans: [], advances: [], bonuses: [], deductions: [], hireDate: '2020-01-01' });
        raw.employees = [mk('master'), mk('dup-01')]; // duplicado con guion (trampa)
        raw.attendance = {
            'dup-01-2026-06-18': { employeeId: 'dup-01', date: '2026-06-18', present: true, hoursWorked: 8 },
            'dup-01-2026-06-19': { employeeId: 'dup-01', date: '2026-06-19', present: true, hoursWorked: 5 },
        };
        raw.statsCache.mtd = { master: { x: 1 }, 'dup-01': { y: 1 } };

        stateManager.batchSetState(() => { mergeEmployees('master', 'dup-01'); });

        // Fase 1 (U2b): la clave vieja del duplicado se TOMBSTONEA, no se borra
        // (setDoc merge:true nunca borra claves de mapa en la nube — un delete
        // resucitaría vía eco). Por eso sigue indexada: el índice todavía no
        // filtra tombstones (eso es U2c). Cada fecha queda con 2 entradas: el
        // registro vivo bajo master y el tombstone bajo la clave vieja.
        const day18 = raw.attendanceByDate['2026-06-18'] || [];
        testRunner.assertEquals(day18.length, 2, "fecha 18 indexada (vivo + tombstone; U2c filtrará)");
        const liveDay18 = day18.find(r => r.present);
        const tombstonedDay18 = day18.find(r => !r.present);
        testRunner.assertEquals(liveDay18 && liveDay18.employeeId, 'master', "el registro vivo quedó bajo master");
        testRunner.assert(tombstonedDay18 && tombstonedDay18.deletedAt != null, "la clave vieja del duplicado quedó tombstoneada, no borrada");
        testRunner.assertEquals((raw.attendanceByDate['2026-06-19'] || []).length, 2, "fecha 19 indexada (vivo + tombstone)");
        // Stats de ambos invalidadas (por employeeId, no split de la clave con guion).
        testRunner.assert(!raw.statsCache.mtd['master'], "stats de master invalidadas");
        testRunner.assert(!raw.statsCache.mtd['dup-01'], "stats del duplicado con guion invalidadas");
    }
});

// ──────────────────────── restoreAutoBackup (conductual) ───────────────────────
testRunner.addSuite("PersistenceService.restoreAutoBackup — Coherencia (Fase 4 Paso 3)", {

    "en batchSetState reconstruye el índice y limpia stats tras el restore"() {
        const raw = emptyState();
        // Basura de "sesión previa" que un rebuild total debe borrar.
        raw.attendanceByDate = { '2000-01-01': [{ employeeId: 'ghost', date: '2000-01-01' }] };
        raw.statsCache.mtd = { ghost: { x: 1 } };
        raw.employees = []; // restoreAutoBackup solo corre si no hay empleados

        const backup = {
            data: {
                employees: [{ id: 'e1', name: 'E1', positions: [], hireDate: '2020-01-01' }],
                attendance: {
                    'e1-2026-06-19': { employeeId: 'e1', date: '2026-06-19', present: true, hoursWorked: 8 },
                },
            },
        };
        sessionStorage.setItem('attendance-backup', JSON.stringify(backup));
        try {
            stateManager.batchSetState(() => { restoreAutoBackup(); });
            testRunner.assertEquals((raw.attendanceByDate['2026-06-19'] || []).length, 1, "fecha del backup indexada sin el proxy");
            testRunner.assert(!raw.attendanceByDate['2000-01-01'], "la fecha fantasma no sobrevive al rebuild total");
            testRunner.assert(!raw.statsCache.mtd['ghost'], "stats fantasma limpiadas");
        } finally {
            sessionStorage.removeItem('attendance-backup');
        }
    }
});

// ─────────────── loadApplicationData / prepareDataForNewAccount (contrato) ──────────────
function methodBody(name, endAnchor) {
    const start = SRC.indexOf(name);
    testRunner.assert(start !== -1, `${name} debe existir`);
    const end = SRC.indexOf(endAnchor, start);
    return SRC.slice(start, end === -1 ? SRC.length : end);
}

testRunner.addSuite("PersistenceService — Coherencia bulk async (contrato, Fase 4 Paso 3)", {

    "importa invalidateAllStats e invalidateEmployeeStats de AppState"() {
        testRunner.assert(/import\s*\{[^}]*\binvalidateAllStats\b[^}]*\}\s*from\s*['"]\.\.\/core\/AppState\.js['"]/.test(SRC),
            'debe importar invalidateAllStats');
        testRunner.assert(/import\s*\{[^}]*\binvalidateEmployeeStats\b[^}]*\}\s*from\s*['"]\.\.\/core\/AppState\.js['"]/.test(SRC),
            'debe importar invalidateEmployeeStats');
    },

    "loadApplicationData limpia statsCache mayoristamente tras la carga masiva"() {
        const body = methodBody('export async function loadApplicationData', 'export async function prepareDataForNewAccount');
        const dirtyIdx = body.indexOf('markAttendanceDirty');
        const clearIdx = body.search(/invalidateAllStats\(\s*\)/);
        testRunner.assert(dirtyIdx !== -1, 'debe seguir marcando el índice dirty');
        testRunner.assert(clearIdx > dirtyIdx, 'invalidateAllStats() debe ir tras markAttendanceDirty en la carga masiva');
    },

    "prepareDataForNewAccount reconstruye índice total y limpia stats tras reescribir claves"() {
        const body = methodBody('export async function prepareDataForNewAccount', 'export function restoreAutoBackup');
        const assignIdx = body.indexOf('state.attendance = newAttendance');
        const rebuildIdx = body.search(/buildAttendanceIndex\(\s*\)/);
        const clearIdx = body.search(/invalidateAllStats\(\s*\)/);
        testRunner.assert(assignIdx !== -1, 'debe reescribir state.attendance = newAttendance');
        testRunner.assert(rebuildIdx > assignIdx, 'buildAttendanceIndex() total debe ir tras la reescritura');
        testRunner.assert(clearIdx > assignIdx, 'invalidateAllStats() debe ir tras la reescritura');
    }
});

console.log('PersistenceCoherence tests cargados.');

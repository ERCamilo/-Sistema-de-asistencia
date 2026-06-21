/**
 * AppAttendanceCoherenceTests — Fase 4 Paso 3 (app.js, el god file).
 *
 * app.js NO es testeable conductualmente (es el entry point; importarlo corre
 * toda la inicialización + listeners DOM). Convención del repo para app.js:
 * TEST DE CONTRATO sobre el fuente (ver AppWiringMigrationTests / AttendanceSyncRing).
 * Verificamos que cada handler de asistencia mantenga la coherencia EXPLÍCITA
 * (invalidateEmployeeStats/invalidateAllStats + buildAttendanceIndex), incluida
 * la que va DENTRO de las closures de undo. El comportamiento de esos helpers ya
 * está cubierto por sus propios tests conductuales.
 *
 * Se crece por familia (un sub-commit = una familia de handlers).
 */

import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

// Extrae el cuerpo de un handler acotando entre dos anchors fijos del archivo.
function between(startAnchor, endAnchor) {
    const start = SRC.indexOf(startAnchor);
    if (start === -1) return '';
    const end = SRC.indexOf(endAnchor, start + startAnchor.length);
    return SRC.slice(start, end === -1 ? SRC.length : end);
}

function countOccurrences(haystack, needle) {
    if (!haystack) return 0;
    return haystack.split(needle).length - 1;
}

// Para sitios bulk: toma una ventana corta JUSTO después de la mutación y
// verifica el patrón total (invalidateAllStats + buildAttendanceIndex SIN argumento).
function sliceAfter(anchor, len) {
    const i = SRC.indexOf(anchor);
    if (i === -1) return '';
    return SRC.slice(i, i + len);
}
const TOTAL_REBUILD = /buildAttendanceIndex\(\s*\)/; // sin arg = rebuild total (NO el granular (dateKey))

testRunner.addSuite("app.js — Coherencia de asistencia (contrato, Fase 4 Paso 3)", {

    "importa los helpers de coherencia desde AppState"() {
        testRunner.assert(
            /import\s*\{[\s\S]*?\binvalidateEmployeeStats\b[\s\S]*?\}\s*from\s*['"]\.\/modules\/core\/AppState\.js['"]/.test(SRC),
            'app.js debe importar invalidateEmployeeStats de AppState'
        );
        testRunner.assert(
            /import\s*\{[\s\S]*?\bbuildAttendanceIndex\b[\s\S]*?\}\s*from\s*['"]\.\/modules\/core\/AppState\.js['"]/.test(SRC),
            'app.js debe importar buildAttendanceIndex de AppState'
        );
        testRunner.assert(
            /import\s*\{[\s\S]*?\binvalidateAllStats\b[\s\S]*?\}\s*from\s*['"]\.\/modules\/core\/AppState\.js['"]/.test(SRC),
            'app.js debe importar invalidateAllStats de AppState (para los sitios bulk)'
        );
    },

    // ─── FAMILIA 1: toggle de día (window.toggleAttendance) ───
    // Dos ramas (alta/baja) cubiertas por UNA llamada compartida + cada closure
    // de undo con su propia coherencia → 3 insertions de cada helper.
    "toggleAttendance mantiene coherencia en alta, baja y ambas closures de undo"() {
        const body = between('window.toggleAttendance = (empId, date', 'function updateCheckboxOnly');
        // Guard de boundary: si un anchor cambia y between() captura de más, el
        // conteo se inflaría y el test daría falso verde. Acotamos el tamaño.
        testRunner.assert(body.length > 0 && body.length < 6000, 'el cuerpo de toggleAttendance debe acotarse bien (boundary sano)');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(empId)') >= 3,
            'toggleAttendance debe invalidar stats en alta/baja + las 2 closures de undo (>=3)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(getDateKey(date))') >= 3,
            'toggleAttendance debe reconstruir el índice del día en alta/baja + las 2 closures de undo (>=3)'
        );
    },

    // ─── FAMILIA 2: borrado directo (window.deleteCurrentAttendance) ───
    // Delete principal + closure de undo (restaurar) → 2 insertions de cada helper.
    // Usa un dateKey capturado (estable para la closure).
    "deleteCurrentAttendance mantiene coherencia en el delete y en la closure de undo"() {
        const body = between('window.deleteCurrentAttendance = function', 'window.removePositionHours');
        testRunner.assert(body.length > 0 && body.length < 4000, 'el cuerpo de deleteCurrentAttendance debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(emp.id)') >= 2,
            'deleteCurrentAttendance debe invalidar stats en el delete + la closure de undo (>=2)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateKey)') >= 2,
            'deleteCurrentAttendance debe reconstruir el índice en el delete + la closure de undo (>=2)'
        );
    },

    // ─── FAMILIA 3: multi-posición ───
    // Solo el COMMIT (saveMultiPosition) y el DELETE (removePositionHours) tocan
    // hoursWorked/las claves. Las ops de edición (add/update/splice) cambian
    // positionHours pero NO hoursWorked → las stats mensuales (que suman hoursWorked)
    // no cambian → NO llevan coherencia (decisión por evidencia, no por el mapa).
    "saveMultiPosition mantiene coherencia en el commit y en la closure de undo"() {
        const body = between('window.saveMultiPosition = function', 'window.deleteCurrentAttendance');
        testRunner.assert(body.length > 0 && body.length < 5000, 'el cuerpo de saveMultiPosition debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(emp.id)') >= 2,
            'saveMultiPosition debe invalidar stats en el commit + la closure de undo (>=2)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateKey)') >= 2,
            'saveMultiPosition debe reconstruir el índice en el commit + la closure de undo (>=2)'
        );
    },

    "removePositionHours mantiene coherencia solo en la rama de borrado del registro"() {
        const body = between('window.removePositionHours = async function', 'LOCALSTORAGE - PERSISTENCIA');
        testRunner.assert(body.length > 0 && body.length < 2500, 'el cuerpo de removePositionHours debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(emp.id)') >= 1,
            'removePositionHours debe invalidar stats al borrar el registro completo'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateKey)') >= 1,
            'removePositionHours debe reconstruir el índice al borrar el registro completo'
        );
    },

    "las ops de edición de posiciones NO llevan coherencia (no tocan hoursWorked)"() {
        const addBody = between('window.addPositionHours', 'window.updatePositionHours');
        const updBody = between('window.updatePositionHours', 'window.updateTotalsDisplay');
        testRunner.assert(addBody.length > 0 && updBody.length > 0, 'deben encontrarse addPositionHours y updatePositionHours');
        testRunner.assert(
            countOccurrences(addBody, 'invalidateEmployeeStats') === 0,
            'addPositionHours NO debe invalidar stats (cambia positionHours, no hoursWorked)'
        );
        testRunner.assert(
            countOccurrences(updBody, 'invalidateEmployeeStats') === 0,
            'updatePositionHours NO debe invalidar stats (edición in-place de positionHours)'
        );
    },

    // ─── FAMILIA 4: vista semanal (handleWeekCheck, removeAttendance) ───
    // Cada uno: mutación principal + closure de undo → 2 insertions de cada helper.
    // (dateStr ES el dateKey en esta vista.)
    "handleWeekCheck mantiene coherencia en el alta y en la closure de undo"() {
        const body = between('window.handleWeekCheck = ', 'window.handleWeekCheckClick');
        testRunner.assert(body.length > 0 && body.length < 6000, 'el cuerpo de handleWeekCheck debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(empId)') >= 2,
            'handleWeekCheck debe invalidar stats en el alta + la closure de undo (>=2)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateStr)') >= 2,
            'handleWeekCheck debe reconstruir el índice en el alta + la closure de undo (>=2)'
        );
    },

    "removeAttendance mantiene coherencia en la baja in-place y en la closure de undo"() {
        const body = between('window.removeAttendance = ', 'window.toggleLegend');
        testRunner.assert(body.length > 0 && body.length < 2500, 'el cuerpo de removeAttendance debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(empId)') >= 2,
            'removeAttendance debe invalidar stats en la baja + la closure de undo (>=2)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateStr)') >= 2,
            'removeAttendance debe reconstruir el índice en la baja + la closure de undo (>=2)'
        );
    },

    // ─── FAMILIA 5: detalle de horas y nota rápida ───
    "saveAttendanceDetailHours mantiene coherencia tras escribir hoursWorked"() {
        const body = between('window.saveAttendanceDetailHours = ', 'window.saveQuickNoteFromDetail');
        testRunner.assert(body.length > 0 && body.length < 3500, 'el cuerpo de saveAttendanceDetailHours debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(emp.id)') >= 1,
            'saveAttendanceDetailHours debe invalidar stats (edita hoursWorked)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateKey)') >= 1,
            'saveAttendanceDetailHours debe reconstruir el índice del día'
        );
    },

    "saveQuickNoteFromDetail mantiene coherencia (el upsert puede crear un registro)"() {
        const body = between('window.saveQuickNoteFromDetail = ', 'Click delegation');
        testRunner.assert(body.length > 0 && body.length < 2500, 'el cuerpo de saveQuickNoteFromDetail debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(empId)') >= 1,
            'saveQuickNoteFromDetail debe invalidar stats (patrón uniforme con NotesController)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateKey)') >= 1,
            'saveQuickNoteFromDetail debe reconstruir el índice (un upsert puede crear el registro)'
        );
    },

    // ─── FAMILIA 6a: cargas bulk cloud/snapshot ───
    // Reemplazos de TODO el dataset → patrón TOTAL: invalidateAllStats() + buildAttendanceIndex()
    // SIN argumento, sincrónico justo tras la mutación (antes del render que lee derivados).
    "downloadFromCloud (sobrescritura) mantiene coherencia total tras reemplazar la asistencia"() {
        const s = sliceAfter('state.attendance = cloudAttendance', 600);
        testRunner.assert(s.length > 0, 'debe existir la sobrescritura cloudAttendance');
        testRunner.assert(s.includes('invalidateAllStats()'), 'debe limpiar todas las stats (bulk)');
        testRunner.assert(TOTAL_REBUILD.test(s), 'debe reconstruir el índice TOTAL (sin argumento)');
    },

    "snapshot onRestore mantiene coherencia total tras reemplazar la asistencia"() {
        const s = sliceAfter('state.attendance = snapshot.state.attendance', 700);
        testRunner.assert(s.length > 0, 'debe existir el reemplazo del snapshot');
        testRunner.assert(s.includes('invalidateAllStats()'), 'debe limpiar todas las stats (bulk)');
        testRunner.assert(TOTAL_REBUILD.test(s), 'debe reconstruir el índice TOTAL (sin argumento)');
    },

    "downloadFromCloud (merge) mantiene coherencia total tras fusionar la asistencia remota"() {
        const s = sliceAfter('...remoteAttendance };', 300);
        testRunner.assert(s.length > 0, 'debe existir el merge de remoteAttendance');
        testRunner.assert(s.includes('invalidateAllStats()'), 'debe limpiar todas las stats (bulk)');
        testRunner.assert(TOTAL_REBUILD.test(s), 'debe reconstruir el índice TOTAL (sin argumento)');
    },

    // ─── FAMILIA 6b: restore local (applyBackupData) ───
    // Una sola coherencia bulk tras sanitizePositions y antes de persistir; subsume
    // la invalidación de sanitize.
    "applyBackupData mantiene coherencia total tras el restore (post-sanitize, pre-persist)"() {
        const body = between('async function applyBackupData', 'window.importData');
        testRunner.assert(body.length > 0 && body.length < 3000, 'el cuerpo de applyBackupData debe acotarse bien');
        testRunner.assert(body.includes('invalidateAllStats()'), 'debe limpiar todas las stats (bulk)');
        testRunner.assert(TOTAL_REBUILD.test(body), 'debe reconstruir el índice TOTAL (sin argumento)');
        // Orden: coherencia DESPUÉS de sanitizePositions y ANTES de saveToIndexedDB.
        const sanitizeIdx = body.indexOf('sanitizePositions(state)');
        const coherenceIdx = body.search(/invalidateAllStats\(\)/);
        const persistIdx = body.indexOf('saveToIndexedDB');
        testRunner.assert(sanitizeIdx !== -1 && persistIdx !== -1, 'deben existir sanitizePositions y saveToIndexedDB');
        testRunner.assert(
            coherenceIdx > sanitizeIdx && coherenceIdx < persistIdx,
            'la coherencia debe ir tras sanitizePositions y antes de saveToIndexedDB'
        );
    },

    // ─── FAMILIA 6c: Firebase zonal ───
    // onInitialLoad = muchas fechas → TOTAL; onModified = una fecha (hot path) → GRANULAR.
    "Firebase onInitialLoad mantiene coherencia TOTAL tras la carga remota inicial"() {
        const body = between('onInitialLoad: (allAttendance) =>', 'onModified:');
        testRunner.assert(body.length > 0 && body.length < 3500, 'el cuerpo de onInitialLoad debe acotarse bien');
        testRunner.assert(body.includes('invalidateAllStats()'), 'debe limpiar todas las stats (bulk)');
        testRunner.assert(TOTAL_REBUILD.test(body), 'debe reconstruir el índice TOTAL (sin argumento)');
        // Orden: coherencia DESPUÉS de validateDataIntegrity (que muta in-place) y ANTES del render.
        const vdiIdx = body.indexOf('validateDataIntegrity()');
        const cohIdx = body.search(/invalidateAllStats\(\)/);
        const renderIdx = body.indexOf('render()');
        testRunner.assert(vdiIdx !== -1 && renderIdx !== -1, 'deben existir validateDataIntegrity y render');
        testRunner.assert(
            cohIdx > vdiIdx && cohIdx < renderIdx,
            'la coherencia total debe ir tras validateDataIntegrity y antes del render'
        );
    },

    "Firebase onModified mantiene coherencia GRANULAR (por empleado + bucket del día, sin total)"() {
        const body = between('onModified: (dateKey, records) =>', 'Iniciar primera suscripción');
        testRunner.assert(body.length > 0 && body.length < 3000, 'el cuerpo de onModified debe acotarse bien');
        testRunner.assert(body.includes('buildAttendanceIndex(dateKey)'), 'debe reconstruir GRANULAR el bucket del día');
        testRunner.assert(body.includes('invalidateEmployeeStats('), 'debe invalidar stats por empleado tocado');
        // Negativos: hot path → NUNCA bulk ni rebuild total.
        testRunner.assert(!body.includes('invalidateAllStats('), 'onModified NO debe usar invalidateAllStats (hot path)');
        testRunner.assert(!TOTAL_REBUILD.test(body), 'onModified NO debe usar buildAttendanceIndex() total (solo granular)');
        // Hyphen-safety: deriva por employeeId, no por split de la clave.
        testRunner.assert(body.includes('r.employeeId') || body.includes('record.employeeId'),
            'debe derivar el empleado por employeeId, no por split de la clave compuesta');
    }
});

console.log('AppAttendanceCoherence tests cargados.');

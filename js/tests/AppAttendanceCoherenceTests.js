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
    }
});

console.log('AppAttendanceCoherence tests cargados.');

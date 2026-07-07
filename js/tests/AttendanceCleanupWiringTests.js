/**
 * 🧪 AttendanceCleanupWiringTests
 *
 * Contract tests del cableado del borrado de historial:
 *   - modal extra al eliminar un empleado (lista) que pregunta por el historial;
 *   - el wizard borra el historial de los eliminados;
 *   - acción de Ajustes/Datos para limpiar asistencia huérfana.
 * La lógica está en AttendanceCleanupTests.
 */

import fs from 'fs';
import path from 'path';

const LIST_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/features/employees/EmployeesList.js'), 'utf8');
const MAINT_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/MaintenanceUI.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const UI_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/SettingsUI.js'), 'utf8');
const DATA_TAB_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/settings/SettingsDataTab.js'), 'utf8');
const RUNNER_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/services/AttendanceCleanupRunner.js'), 'utf8');

testRunner.addSuite("AttendanceCleanupWiring — modal extra al eliminar (lista)", {

    "EmployeesList importa countLiveAttendance y purgeEmployeeAttendanceHistory"() {
        testRunner.assert(/countLiveAttendance/.test(LIST_SRC) && /AttendanceCleanup\.js/.test(LIST_SRC));
        testRunner.assert(/purgeEmployeeAttendanceHistory/.test(LIST_SRC) && /AttendanceCleanupRunner\.js/.test(LIST_SRC));
    },

    "tras eliminar el empleado, si tiene asistencia, abre un modal extra por el historial"() {
        const idx = LIST_SRC.indexOf('export function deleteEmployeeHandler');
        const block = LIST_SRC.slice(idx, idx + 3400);
        testRunner.assert(/countLiveAttendance\s*\(\s*state\.attendance\s*,\s*empId\s*\)/.test(block),
            'debe contar la asistencia viva del empleado');
        testRunner.assert(/attCount\s*>\s*0[\s\S]{0,200}Modal\.confirm/.test(block),
            'el modal extra debe abrirse solo si hay asistencia');
        testRunner.assert(/eliminar historial|Eliminar historial|eliminar también su historial/i.test(block),
            'el modal debe preguntar por el historial');
    },

    "solo purga el historial si el usuario dice que sí (conservar es el default seguro)"() {
        const idx = LIST_SRC.indexOf('export function deleteEmployeeHandler');
        const block = LIST_SRC.slice(idx, idx + 3400);
        testRunner.assert(/if\s*\(\s*!alsoHistory\s*\)\s*return/.test(block),
            'si elige conservar, NO se purga');
        testRunner.assert(/purgeEmployeeAttendanceHistory\s*\(\s*empId\s*\)/.test(block));
    }

});

testRunner.addSuite("AttendanceCleanupWiring — wizard borra el historial de los eliminados", {

    "MaintenanceUI importa y llama purgeEmployeeAttendanceHistory por cada eliminado"() {
        testRunner.assert(/purgeEmployeeAttendanceHistory/.test(MAINT_SRC) && /AttendanceCleanupRunner\.js/.test(MAINT_SRC));
        testRunner.assert(/for\s*\(\s*const\s+delId[\s\S]{0,400}purgeEmployeeAttendanceHistory\s*\(\s*delId\s*\)/.test(MAINT_SRC),
            'cada empleado eliminado en el wizard debe purgar su historial');
    }

});

testRunner.addSuite("AttendanceCleanupWiring — acción de Ajustes/Datos (huérfanos)", {

    "SettingsDataTab tiene el botón purge-orphan-attendance"() {
        testRunner.assert(/data-settings-action="purge-orphan-attendance"/.test(DATA_TAB_SRC));
        testRunner.assert(/empleados borrados|historial/i.test(DATA_TAB_SRC));
    },

    "SettingsUI mapea purge-orphan-attendance a window.purgeOrphanAttendanceHandler"() {
        testRunner.assert(
            /['"]purge-orphan-attendance['"]\s*:\s*\(\)\s*=>\s*window\.purgeOrphanAttendanceHandler\?\.\(\)/.test(UI_SRC)
        );
    },

    "app.js define window.purgeOrphanAttendanceHandler con confirmación y usa purgeOrphanAttendance"() {
        testRunner.assert(/window\.purgeOrphanAttendanceHandler\s*=\s*function/.test(APP_SRC));
        const idx = APP_SRC.indexOf('window.purgeOrphanAttendanceHandler');
        const block = APP_SRC.slice(idx, idx + 1300);
        testRunner.assert(/collectOrphanAttendanceKeys\s*\(/.test(block), 'debe contar los huérfanos antes de confirmar');
        testRunner.assert(/showConfirm/.test(block), 'debe pedir confirmación (destructivo)');
        testRunner.assert(/purgeOrphanAttendance\s*\(\s*\)/.test(block), 'debe ejecutar la limpieza');
    },

    "si no hay huérfanos, avisa sin abrir el diálogo destructivo"() {
        const idx = APP_SRC.indexOf('window.purgeOrphanAttendanceHandler');
        const block = APP_SRC.slice(idx, idx + 1300);
        testRunner.assert(/orphanCount\s*===\s*0/.test(block));
    }

});

testRunner.addSuite("AttendanceCleanupRunner — la propagación multi-fecha no colapsa en el debounce", {

    // 🐛 Judgment Day Fase 2A: _purgeKeys subía cada fecha con
    // saveApplicationData({dateKey}) SIN `immediate:true`. Pero
    // _pendingSaveOptions sólo trackea UN dateKey a la vez (ver
    // PersistenceService: "varias llamadas sin immediate en el mismo tick
    // colapsan en un solo debounce y sólo la ÚLTIMA fecha sobrevive"). Al
    // borrar el historial de un empleado con asistencia en varias fechas,
    // sólo la última fecha se tombstoneaba en la nube; el resto revivía
    // desde otro dispositivo. Mismo bug ya arreglado en mergeEmployees.
    "_purgeKeys sube cada fecha tocada con immediate:true (no colapsa multi-fecha)"() {
        const idx = RUNNER_SRC.indexOf('function _purgeKeys');
        const block = RUNNER_SRC.slice(idx, idx + 1600);
        testRunner.assert(/touched\.forEach/.test(block), 'debe recorrer cada fecha tocada');
        testRunner.assert(
            /saveApplicationData\(\s*\{[^}]*dateKey[^}]*immediate:\s*true[^}]*\}\s*\)/.test(block),
            'cada fecha debe subirse con immediate:true para no colapsar en el debounce'
        );
    }

});

console.log('🧪 AttendanceCleanupWiring contract tests cargados.');

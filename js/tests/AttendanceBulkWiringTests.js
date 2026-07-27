import fs from 'fs';
import path from 'path';

const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

function between(startAnchor, endAnchor) {
    const start = APP_SOURCE.indexOf(startAnchor);
    if (start === -1) return '';
    const end = APP_SOURCE.indexOf(endAnchor, start + startAnchor.length);
    return APP_SOURCE.slice(start, end === -1 ? APP_SOURCE.length : end);
}

testRunner.addSuite('Attendance bulk actions — wiring y coherencia', {
    'el commit masivo batchea, persiste por día y ofrece deshacer'() {
        const body = between('function commitBulkAttendancePlan', 'window.markVisibleEmployeesPresent');

        testRunner.assert(body.includes('stateManager.batchSetState'), 'las escrituras masivas deben ocurrir en un batch');
        testRunner.assert(body.includes('UndoManager.push'), 'la operación masiva debe poder deshacerse');
        testRunner.assert(body.includes('buildBulkUndoPlan'), 'el undo debe restaurar los snapshots');
        testRunner.assert(body.includes('invalidateEmployeeStats'), 'debe invalidar las estadísticas financieras');
        testRunner.assert(body.includes('buildAttendanceIndex(dateKey)'), 'debe reconstruir el índice del día');
        testRunner.assert(body.includes('saveApplicationData({ dateKey })'), 'debe persistir mediante sincronización granular');
    },

    'marcar presentes opera únicamente sobre la lista filtrada'() {
        const body = between('window.markVisibleEmployeesPresent', 'window.clearVisibleAttendance');

        testRunner.assert(body.includes('getFilteredEmployeesForDay()'), 'debe obtener los empleados visibles');
        testRunner.assert(body.includes('buildMarkVisiblePresentPlan'), 'debe construir un plan seguro y testeable');
        testRunner.assert(body.includes('parseDate(state.selectedDate)'), 'debe conservar la fecha local elegida');
        testRunner.assert(!body.includes('new Date(state.selectedDate)'), 'no debe interpretar YYYY-MM-DD como UTC');
        testRunner.assert(body.includes('getDayHours(selectedDate)'), 'debe respetar las horas configuradas');
        testRunner.assert(body.includes('isDayHoliday(selectedDate'), 'debe respetar los feriados');
    },

    'limpiar confirma cantidad, fecha y alcance antes de tombstonear'() {
        const body = between('window.clearVisibleAttendance', 'function updateCheckboxOnly');
        const selectedDateInit = body.match(/const selectedDate\s*=\s*[^;]+;/)?.[0] || '';

        testRunner.assert(body.includes('Modal.confirm'), 'la operación destructiva debe pedir confirmación');
        testRunner.assert(body.includes('parseDate(state.selectedDate)'), 'debe confirmar y limpiar la fecha local elegida');
        testRunner.assert(!selectedDateInit.includes('new Date('), 'no debe desplazar la fecha por zona horaria');
        testRunner.assert(body.includes('Los filtros actuales definen el alcance'), 'debe explicar que solo afecta la lista visible');
        testRunner.assert(body.includes('buildClearVisibleAttendancePlan'), 'debe generar tombstones sincronizables');
        testRunner.assert(body.includes("type: 'danger'"), 'el modal debe comunicar el riesgo destructivo');
    }
});

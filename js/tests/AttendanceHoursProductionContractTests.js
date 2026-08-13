import fs from 'fs';
import path from 'path';
import { normalizeRegularHoursPerDay } from '../modules/utils/AttendanceHours.js';

const SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const ADVANCED_MODAL_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/modals/AdvancedAttendanceModal.js'),
    'utf8'
);
const EMPLOYEE_MODAL_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/modals/EmployeeModal.js'),
    'utf8'
);
const POSITION_MODAL_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/modals/PositionModal.js'),
    'utf8'
);

function between(startAnchor, endAnchor) {
    const start = SRC.indexOf(startAnchor);
    const end = SRC.indexOf(endAnchor, start + startAnchor.length);
    return start === -1 ? '' : SRC.slice(start, end === -1 ? SRC.length : end);
}

testRunner.addSuite('app.js — contrato productivo de horas de asistencia', {
    'modal avanzado enlaza su valor inicial al normalizador canónico'() {
        testRunner.assert(
            /const\s+hoursWorked\s*=\s*att\.hoursWorked\s*!==\s*undefined\s*\?\s*att\.hoursWorked\s*:\s*normalizeRegularHoursPerDay\s*\(\s*state\.settings\?\.regularHoursPerDay\s*\)/.test(ADVANCED_MODAL_SRC),
            'AdvancedAttendanceModal debe normalizar el setting persistido y no mantener su propio || 8'
        );
        testRunner.assertEquals(normalizeRegularHoursPerDay(6), 6);
        testRunner.assertEquals(normalizeRegularHoursPerDay('7.5'), 7.5);
        testRunner.assertEquals(normalizeRegularHoursPerDay('invalid'), 8);
    },

    'modales de empleado y posición no mantienen defaults paralelos de jornada'() {
        [EMPLOYEE_MODAL_SRC, POSITION_MODAL_SRC].forEach((source) => {
            testRunner.assert(
                /import\s*\{\s*normalizeRegularHoursPerDay\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/AttendanceHours\.js['"]/.test(source),
                'cada modal consumidor debe importar el normalizador canónico'
            );
            testRunner.assert(!/regularHoursPerDay\s*(?:\|\||\?\?)\s*8/.test(source),
                'ningún modal debe mantener un fallback paralelo de 8h');
        });
    },

    'handleWeekCheck preserva override diario cero mediante el resolver canónico'() {
        const body = between("window.handleWeekCheck = (empId, dateStr)", 'window.handleWeekCheckClick');
        testRunner.assert(
            /resolveDailyTargetHours\s*\(\s*dateStr\s*,\s*state\.dayHoursConfig\s*,\s*state\.settings\?\.regularHoursPerDay\s*\)/.test(body),
            'handleWeekCheck debe resolver la jornada diaria sin usar ||, que descarta el cero explícito'
        );
    },

    'título y detalle normalizan 6h/7.5h y el objetivo por fecha usa dayHoursConfig'() {
        const title = between('function AttendancePageTitle()', 'function AttendanceDetailPanel()');
        const detail = between('function _AttendanceDetailPanelInner()', 'function getAttendanceDetailPositionHours');
        testRunner.assert(
            /normalizeRegularHoursPerDay\s*\(\s*state\.settings\?\.regularHoursPerDay\s*\)/.test(title),
            'el título debe mostrar la jornada persistida normalizada, incluyendo 6 y 7.5'
        );
        testRunner.assert(
            /const\s+regularHours\s*=\s*normalizeRegularHoursPerDay\s*\(/.test(detail),
            'el detalle debe normalizar la jornada regular antes de calcular'
        );
        testRunner.assert(
            /resolveDailyTargetHours\s*\(\s*dk\s*,\s*state\.dayHoursConfig\s*,\s*regularHours\s*\)/.test(detail),
            'extras y objetivo del período deben respetar la jornada configurada para cada fecha'
        );
    },

    'app importa los helpers canónicos y no mantiene defaults paralelos de 8h en este flujo'() {
        testRunner.assert(
            /import\s*\{[^}]*normalizeRegularHoursPerDay[^}]*resolveDailyTargetHours[^}]*\}\s*from\s*['"]\.\/modules\/utils\/AttendanceHours\.js['"]/.test(SRC),
            'app.js debe consumir AttendanceHours.js'
        );
        const productionFlow = between("window.toggleAttendance = (empId, date", 'function getAttendanceDetailPositionHours');
        testRunner.assert(!/regularHoursPerDay\s*\|\|\s*8/.test(productionFlow),
            'el flujo productivo auditado no debe poseer un default accidental de 8h');
    }
});

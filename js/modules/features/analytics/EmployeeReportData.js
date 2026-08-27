/**
 * 📊 EmployeeReportData.js
 *
 * Armador PURO del reporte de días trabajados (desglose por posición →
 * empleados → valor por día), extraído de AnalyticsUI.calculateEmployeeReportData
 * para poder testearlo y para arreglar un bug de campo (2026-07-10):
 *
 * 🐛 El reporte agrupaba por las posiciones ACTUALES del empleado y solo
 * iteraba posiciones ACTIVAS del catálogo. Los días trabajados con una
 * posición que el empleado ya no tiene (desasignada) — o con una posición
 * desactivada como archivo — desaparecían del desglose/Excel y esos días se
 * veían vacíos/ausentes.
 *
 * Regla: EL HISTORIAL MANDA. Un día registrado aparece bajo su posición:
 *   - el grupo de una posición incluye a los asignados actuales Y a todo
 *     empleado con días registrados con ella en el rango;
 *   - una posición inactiva aparece si tiene días registrados en el rango
 *     (sin días, no ensucia el reporte).
 *
 * La atribución por día NO cambia: entrada de positionHours en días
 * multi-posición; selectedPosition (con fallback legacy a la primera
 * posición actual) en días simples; feriados multiplican por holidayFactor.
 */

import { getDateKey, wasEmployeeActiveInRange } from '../../utils/DateUtils.js';
import { resolveRestDayFactor } from '../payroll/PayrollFactors.js';

/** ¿El registro (vivo y presente) referencia la posición? */
function recordReferencesPosition(att, positionId) {
    if (!att || att.present !== true) return false;
    if (att.multiPosition && Array.isArray(att.positionHours)) {
        return att.positionHours.some(ph => ph && ph.positionId === positionId);
    }
    return att.selectedPosition === positionId;
}

/**
 * @param {object} args
 * @param {Array<object>} args.employees
 * @param {Array<object>} args.positions catálogo completo (activas e inactivas)
 * @param {object} args.attendance mapa `${empId}-${fecha}` → registro
 * @param {Array<{date: Date, isHoliday: boolean}>} args.days rango ya expandido
 * @param {string} args.startDate YYYY-MM-DD (para wasEmployeeActiveInRange)
 * @param {string} args.endDate
 * @param {number} args.regularHours horas de un día regular
 * @param {number} args.holidayFactor multiplicador de feriado
 * @param {Array<object>} [args.leaders] catálogo de líderes
 * @param {object} [args.settings] configuración global
 * @param {number} [args.restDayFactor] fallback directo de factor de día libre
 * @returns {{days: Array, positions: Array<{position, employees}>}}
 */
export function buildEmployeeReportData({
    employees, positions, attendance, days,
    startDate, endDate, regularHours, holidayFactor,
    leaders = [], settings = {}, restDayFactor
}) {
    const allEmployees = Array.isArray(employees) ? employees : [];
    const allPositions = Array.isArray(positions) ? positions : [];
    const allLeaders = Array.isArray(leaders) ? leaders : [];
    const att = attendance && typeof attendance === 'object' ? attendance : {};
    const range = Array.isArray(days) ? days : [];

    // ¿Tiene el empleado días registrados con esta posición dentro del rango?
    const hasRecordedDays = (emp, positionId) => range.some(day =>
        recordReferencesPosition(att[`${emp.id}-${getDateKey(day.date)}`], positionId)
    );

    // Posiciones del reporte: las activas + las archivadas CON días en rango.
    const reportPositions = allPositions.filter(p =>
        p.active || allEmployees.some(e => hasRecordedDays(e, p.id))
    );

    const groups = [];
    reportPositions.forEach(position => {
        const empsByPosition = allEmployees.filter(e => {
            if (!wasEmployeeActiveInRange(e, startDate, endDate, att)) return false;
            const assigned = (e.positions && Array.isArray(e.positions) && e.positions.includes(position.id))
                || e.position === position.id;
            return assigned || hasRecordedDays(e, position.id);
        });

        const groupEmployees = [];
        empsByPosition.forEach(emp => {
            const dayValues = {};
            let total = 0;
            const workingDays = emp.customWorkingDays?.[position.id] || position.workingDays || [1, 2, 3, 4, 5];
            const leader = position.leaderId ? allLeaders.find(l => l.id === position.leaderId) : null;
            const effectiveSettings = settings && Number(settings.restDayFactor) > 0
                ? settings
                : { restDayFactor: restDayFactor || 1.5 };
            const resolvedFactor = resolveRestDayFactor(position, leader, effectiveSettings);

            range.forEach(day => {
                const dateKey = getDateKey(day.date);
                const record = att[`${emp.id}-${dateKey}`];
                if (record && record.present) {
                    let dayValue = 0;
                    if (record.multiPosition && record.positionHours) {
                        const posHours = record.positionHours.find(ph => ph.positionId === position.id);
                        if (posHours) dayValue = (posHours.hours || 0) / regularHours;
                    } else {
                        const selectedPos = record.selectedPosition || (emp.positions || [])[0];
                        if (selectedPos !== position.id) return;
                        dayValue = (record.hoursWorked || 0) / regularHours;
                    }

                    const isHoliday = day.isHoliday || record.isHoliday;
                    const isRestDay = !workingDays.includes(day.date.getDay());

                    if (isHoliday) {
                        dayValue *= (holidayFactor || 1);
                    } else if (isRestDay) {
                        dayValue *= (resolvedFactor || 1);
                    }

                    if (!isNaN(dayValue)) { dayValues[dateKey] = dayValue; total += dayValue; }
                }
            });
            if (!isNaN(total)) groupEmployees.push({ id: emp.id, number: emp.number, name: emp.name, dayValues, total });
        });

        groupEmployees.sort((a, b) => String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true }));

        if (groupEmployees.length > 0) groups.push({ position, employees: groupEmployees });
    });

    return { days: range, positions: groups };
}

export default buildEmployeeReportData;

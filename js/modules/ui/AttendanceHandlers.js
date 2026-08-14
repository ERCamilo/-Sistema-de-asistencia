/**
 * 🛰️ AttendanceHandlers.js - Manejadores de Interfaz para Asistencia
 * Lógica para el Stepper de horas y Switch de feriado.
 */

import { state, stateManager, invalidateEmployeeStats, buildAttendanceIndex } from '../core/AppState.js';
import { saveApplicationData } from '../services/PersistenceService.js';
import { DateUtils, getDateKey } from '../utils/DateUtils.js';
import { resolveDailyTargetHours } from '../utils/AttendanceHours.js';
import { Notification } from '../components/Notification.js';

/**
 * ⏱️ Ajusta las horas base para el día seleccionado o la semana completa (+/- 0.5h)
 */
export function changeBaseHours(delta) {
    // Si estamos en vista semanal, actualizamos los 7 días de la semana actual
    const datesToUpdate = state.viewMode === 'week' 
        ? DateUtils.getWeekDates(state.selectedDate)
        : [getDateKey(state.selectedDate)];
    
    // ⚡ Fase 4 Paso 5: las N escrituras de dayHoursConfig (hasta 7 en semana) se
    // batchean → el proxy corre silencioso y batchSetState agenda 1 render al cerrar.
    stateManager.batchSetState(() => {
        datesToUpdate.forEach(dateKey => {
            // Obtener horas actuales del día o las regulares
            const currentHours = resolveDailyTargetHours(
                dateKey,
                state.dayHoursConfig,
                state.settings?.regularHoursPerDay
            );

            // Calcular nuevo valor
            let newHours = Math.max(0, Math.min(24, currentHours + delta));

            // Actualizar configuración
            if (!state.dayHoursConfig) state.dayHoursConfig = {};
            state.dayHoursConfig[dateKey] = newHours;
        });
    });

    console.log(`⏱️ Horas base ajustadas para ${datesToUpdate.length} días. Último valor: ${state.dayHoursConfig[datesToUpdate[datesToUpdate.length-1]]}h`);

    // Guardar; el render lo agenda batchSetState al cerrar (1 render en vez de N).
    saveApplicationData({ dateKey: datesToUpdate[0] });
}

/**
 * 🗓️ Alterna el estado de feriado para el día seleccionado
 */
export function toggleHoliday(providedDateKey = null) {
    const dateKey = providedDateKey || getDateKey(state.selectedDate);
    const holidays = state.settings.holidays || [];
    
    const index = holidays.indexOf(dateKey);
    let isNowHoliday = false;

    if (index > -1) {
        holidays.splice(index, 1);
        isNowHoliday = false;
        Notification.info('Día marcado como laborable');
    } else {
        holidays.push(dateKey);
        isNowHoliday = true;
        Notification.success('Día marcado como FERIADO 🚩', { icon: 'gold' });
    }
    
    // ⚡ Fase 4 Paso 5: batchear settings.holidays + la sincronización por-registro +
    // la coherencia → 1 render en vez de uno por registro tocado. isHoliday alimenta
    // nómina, así que la coherencia (invalidateEmployeeStats + buildAttendanceIndex) va
    // DENTRO del mismo batch: el único render del cierre lee statsCache.mtd ya fresco.
    const touched = new Set();
    stateManager.batchSetState(() => {
        state.settings.holidays = holidays;

        // 🔥 Sincronizar los registros existentes para este día (mutación IN-PLACE: el
        // proxy no dispara, por eso la coherencia es explícita y load-bearing tras Paso 4)
        Object.keys(state.attendance).forEach(key => {
            const att = state.attendance[key];
            if (att && att.date === dateKey) {
                att.isHoliday = isNowHoliday;
                att.updatedAt = Date.now();
                touched.add(att.employeeId); // por employeeId, NO split de la clave (ids con guion)
            }
        });

        touched.forEach(empId => invalidateEmployeeStats(empId));
        buildAttendanceIndex(dateKey);
    });

    // Guardar; el render lo agenda batchSetState al cerrar (1 render en vez de N).
    saveApplicationData();
}

/**
 * ⌨️ Establece horas base manualmente (vía input) para el día o la semana
 */
export function setDayHours(val) {
    const hours = Number.parseFloat(val);
    if (Number.isNaN(hours) || hours < 0 || hours > 24) return;
    
    const datesToUpdate = state.viewMode === 'week' 
        ? DateUtils.getWeekDates(state.selectedDate)
        : [getDateKey(state.selectedDate)];

    // ⚡ Fase 4 Paso 5: batchear las N escrituras → 1 render al cerrar el batch.
    stateManager.batchSetState(() => {
        datesToUpdate.forEach(dateKey => {
            if (!state.dayHoursConfig) state.dayHoursConfig = {};
            state.dayHoursConfig[dateKey] = hours;
        });
    });

    // Guardar; el render lo agenda batchSetState al cerrar (1 render en vez de N).
    saveApplicationData({ dateKey: datesToUpdate[0] });
}

// 🌐 Exponer a window para acceso desde el HTML generado por AttendanceUI
globalThis.changeBaseHours = changeBaseHours;
globalThis.toggleHoliday = toggleHoliday;
globalThis.setDayHours = setDayHours;
globalThis.markDayAsHoliday = toggleHoliday; // Alias para compatibilidad temporal

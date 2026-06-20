/**
 * 🛰️ AttendanceHandlers.js - Manejadores de Interfaz para Asistencia
 * Lógica para el Stepper de horas y Switch de feriado.
 */

import { state, invalidateEmployeeStats, buildAttendanceIndex } from '../core/AppState.js';
import { render } from '../core/RenderManager.js';
import { saveApplicationData } from '../services/PersistenceService.js';
import { DateUtils, getDateKey } from '../utils/DateUtils.js';
import { Notification } from '../components/Notification.js';

/**
 * ⏱️ Ajusta las horas base para el día seleccionado o la semana completa (+/- 0.5h)
 */
export function changeBaseHours(delta) {
    // Si estamos en vista semanal, actualizamos los 7 días de la semana actual
    const datesToUpdate = state.viewMode === 'week' 
        ? DateUtils.getWeekDates(state.selectedDate)
        : [getDateKey(state.selectedDate)];
    
    datesToUpdate.forEach(dateKey => {
        // Obtener horas actuales del día o las regulares
        let currentHours = state.dayHoursConfig[dateKey] ?? (state.settings?.regularHoursPerDay || 8);
        
        // Calcular nuevo valor
        let newHours = Math.max(0, Math.min(24, currentHours + delta));
        
        // Actualizar configuración
        if (!state.dayHoursConfig) state.dayHoursConfig = {};
        state.dayHoursConfig[dateKey] = newHours;
    });
    
    console.log(`⏱️ Horas base ajustadas para ${datesToUpdate.length} días. Último valor: ${state.dayHoursConfig[datesToUpdate[datesToUpdate.length-1]]}h`);
    
    // Guardar y refrescar
    saveApplicationData({ dateKey: datesToUpdate[0] });
    render();
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
    
    state.settings.holidays = holidays;
    
    // 🔥 Sincronizar los registros existentes para este día
    const touched = new Set();
    Object.keys(state.attendance).forEach(key => {
        const att = state.attendance[key];
        if (att && att.date === dateKey) {
            att.isHoliday = isNowHoliday;
            att.updatedAt = Date.now();
            touched.add(att.employeeId); // por employeeId, NO split de la clave (ids con guion)
        }
    });

    // These are IN-PLACE field mutations → the proxy traps never fire on them,
    // so maintain coherence explicitly (load-bearing after Paso 4): isHoliday
    // feeds payroll, so invalidate the touched employees' monthly stats + rebuild
    // this day's index bucket.
    touched.forEach(empId => invalidateEmployeeStats(empId));
    buildAttendanceIndex(dateKey);

    // Guardar y refrescar
    saveApplicationData();
    render();
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

    datesToUpdate.forEach(dateKey => {
        let currentHours = state.dayHoursConfig?.[dateKey] ?? (state.settings?.regularHoursPerDay || 8);
        if (!state.dayHoursConfig) state.dayHoursConfig = {};
        state.dayHoursConfig[dateKey] = hours;
    });
    
    saveApplicationData({ dateKey: datesToUpdate[0] });
    render();
}

// 🌐 Exponer a window para acceso desde el HTML generado por AttendanceUI
globalThis.changeBaseHours = changeBaseHours;
globalThis.toggleHoliday = toggleHoliday;
globalThis.setDayHours = setDayHours;
globalThis.markDayAsHoliday = toggleHoliday; // Alias para compatibilidad temporal

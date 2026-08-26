/**
 * DomainResetService.js — reset TOTAL del dominio de la app: personal, puestos,
 * líderes, asistencia, ajustes y configuración de horas por día, más la coherencia
 * explícita de asistencia (stats + índice).
 *
 * Extraído del clearAllData() del wizard legacy (ui/Onboarding.js) al convertir el
 * onboarding v2 en el flujo de arranque real; replicación EXACTA de comportamiento:
 * mismas colecciones vaciadas, mismos defaults de settings y las dos llamadas de
 * coherencia que exige AttendanceCoherenceCoverageTests (invalidateAllStats +
 * buildAttendanceIndex junto a la mutación de state.attendance).
 */
import { state, invalidateAllStats, buildAttendanceIndex } from '../core/AppState.js';

/* app.js expone resolveIconSet como global (window.resolveIconSet); el reset debe
 * resolver el icon set vigente igual que el wizard legacy. El fallback 'unicode' es
 * el mismo default terminal de resolveIconSet en app.js para cuando el puente
 * global no está cargado (p. ej., entorno de tests sin app.js). */
function currentIconSet() {
    return typeof globalThis.resolveIconSet === 'function' ? globalThis.resolveIconSet() : 'unicode';
}

export function resetDomainData() {
    state.positions = [];
    state.leaders = [];
    state.employees = [];
    state.attendance = {};
    state.settings = {
        companyName: 'Mi Empresa',
        regularHoursPerDay: 8,
        attendancePositionWatermarks: true,
        attendanceWatermarkVisibility: 'present',
        attendanceWatermarkContent: 'position',
        holidayFactor: 2,
        iconSet: currentIconSet(),
        holidays: []
    };
    state.dayHoursConfig = {};
    // Full domain reset → explicit attendance coherence (load-bearing once the
    // proxy traps are removed in Paso 4): wholesale stats clear + total index
    // rebuild (empty attendance yields an empty index).
    invalidateAllStats();
    buildAttendanceIndex();
}

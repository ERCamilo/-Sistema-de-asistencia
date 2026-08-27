/**
 * 📧 AppState.js - Gestión Centralizada del Estado Reactivo
 * Parte de la Fase 4: Modularización y Componentización
 */

import { getDateKey, wasEmployeeActiveOnDate, parseDate } from '../utils/DateUtils.js';
import { DEFAULT_REGULAR_HOURS_PER_DAY, normalizeRegularHoursPerDay } from '../utils/AttendanceHours.js';
import { peekEntityScope, entityInScope } from '../features/projects/ProjectContext.js';

// 1. Clase Optimizador (Batch Rendering)
class RenderOptimizer {
    constructor() {
        this._renderQueue = [];
        this._rendering = false;
        this._lastRender = 0;
        this._minRenderInterval = 16;
    }
    scheduleRender(callback) {
        if (typeof callback !== 'function') return;
        if (!this._renderQueue.includes(callback)) this._renderQueue.push(callback);
        this._processQueue();
    }
    _processQueue() {
        if (this._rendering) return;
        const now = Date.now();
        const timeSinceLastRender = now - this._lastRender;
        if (timeSinceLastRender < this._minRenderInterval) {
            setTimeout(() => this._processQueue(), this._minRenderInterval - timeSinceLastRender);
            return;
        }
        if (this._renderQueue.length === 0) return;
        this._rendering = true;
        this._lastRender = now;
        requestAnimationFrame(() => {
            const callbacks = [...this._renderQueue];
            this._renderQueue = [];
            callbacks.forEach(cb => { 
                try { cb(); } catch (e) { console.error('❌ Error en render:', e); } 
            });
            this._rendering = false;
        });
    }
}

export const renderOptimizer = new RenderOptimizer();
window.renderOptimizer = renderOptimizer;

/**
 * 🧹 toRaw(value) - Desenuelve recursivamente Proxies generados por createRecursiveProxy.
 * Vital para evitar DataCloneError al guardar en IndexedDB.
 */
export function toRaw(value) {
    if (value === null || typeof value !== 'object' || value instanceof Date || value instanceof Blob) {
        return value;
    }
    
    // Si es un Proxy de nuestro sistema, tomamos su target original
    const raw = value._rawTarget || value;
    
    // Si es un array, procesar sus elementos
    if (Array.isArray(raw)) {
        return raw.map(item => toRaw(item));
    }
    
    // Si es un objeto (POJO o Clase), crear un clon plano de sus propiedades
    const result = {};
    for (const key in raw) {
        if (Object.prototype.hasOwnProperty.call(raw, key)) {
            result[key] = toRaw(raw[key]);
        }
    }
    return result;
}
window.toRaw = toRaw;

// 2. StateManager
class StateManager {
    constructor(initialState = {}) {
        this._state = initialState;
        this._silent = false;
        this._attendanceDirty = false;
    }
    isSilent() { return this._silent; }
    isAttendanceDirty() { return this._attendanceDirty; }
    markAttendanceDirty() { this._attendanceDirty = true; }
    getState() { return this._state; }
    setState(updates, options = {}) {
        const { silent = false } = options;
        const oldSilent = this._silent;
        this._silent = silent;
        
        // 🧹 Sanitizar actualizaciones para evitar filtración de Proxies
        const sanitizedUpdates = toRaw(updates);
        Object.assign(this._state, sanitizedUpdates);
        
        // ⚡ P3-OPT: Si se actualizó la asistencia, marcamos para rebuild
        if (updates.attendance) this.markAttendanceDirty();
        
        if (!this._silent && window.render) {
            renderOptimizer.scheduleRender(window.render);
        }
        
        this._silent = oldSilent;
        return this._state;
    }
    silentSetState(updates) { return this.setState(updates, { silent: true }); }
    
    /**
     * ⚡ BATCH UPDATE: Ejecuta múltiples actualizaciones y solo dispara un render al final.
     */
    batchSetState(callback) {
        const oldSilent = this._silent;
        this._silent = true;
        try {
            callback(this._state);
        } finally {
            this._silent = oldSilent;
            if (!this._silent && window.render) renderOptimizer.scheduleRender(window.render);
        }
    }
}


const initialState = {
    activeTab: 'attendance',
    settingsActiveTab: 'general', // ⚡ Pestaña activa por defecto en Ajustes
    viewMode: 'day', 
    selectedDate: new Date(),
    employees: [],
    attendance: {},
    attendanceByDate: {}, // ⚡ P3-OPT: Índice rápido { dateKey -> [records] }
    positions: [],
    leaders: [],
    positionSortBy: 'employees',
    leaderSortBy: 'employees',
    employeeSalaryView: 'month',
    selectedPersonnelEmployeeId: null,
    settings: {
        companyName: '', // nombre de la empresa/proyecto: se lee en cabecera, reportes y exportaciones
        regularHoursPerDay: DEFAULT_REGULAR_HOURS_PER_DAY,
        syncEnabled: true,
        attendancePositionWatermarks: true,
        attendanceWatermarkVisibility: 'present',
        attendanceWatermarkContent: 'position',
        showAttendanceCardDeficit: false,
        attendanceDeficitUnit: 'days',
        overtimeFactor: 1,
        holidayFactor: 2,
        holidays: [],
        scrollbarMode: 'on-scroll', // Opciones: 'always', 'on-scroll', 'hidden'
        payPeriod: {
            periodStart: null,   // '2026-03-27' — primer día del período actual
            periodLength: 21,    // cantidad de días del ciclo
            payDay: null         // '2026-04-18' — día en que se paga
        }
    },
    employeeFilter: '', 
    searchQuery: '',
    leaderFilter: '',
    filters: {
        position: 'all',
        search: '',
        leaderId: 'all'
    },
    showFilters: false,
    attendanceFilterCatalog: 'positions',
    showLegend: false,
    showDatePicker: false,
    datePickerTarget: null,
    datePickerMonth: new Date(),
    datePickerView: 'calendar',
    isScrolled: false,
    tempPositionSelection: {},
    listDisplayMode: 'relaxed',
    attendanceListColumns: 1,
    isDataLoaded: false,
    syncStatus: 'idle',
    showFloatingCard: false,
    bottomNavHidden: false, // ⚡ Control de visibilidad de la barra inferior
    selectedDetailEmployeeId: null, // 🏠 Empleado mostrado en el panel lateral derecho del split-view (desktop ≥1024px)
    attendanceDetailPanelTab: 'calendar',
    attendanceDetailCalendarView: 'period',
    attendanceDetailCalendarMonth: new Date(),
    floatingCardEmployee: null,
    floatingCardMonth: new Date(),
    chartPeriod: 'week',
    dayHoursConfig: {},
    quickWeekHours: 8,
    showEmployeeProfile: false,
    employeeProfile: {
        employeeId: null,
        activeTab: 'resumen',
        periodStart: null,
        periodEnd: null,
        showStartPicker: false,
        showEndPicker: false,
        deductions: [],
        expandedPositions: {},
        editingAdvances: {}
    },
    settingsCalendarMonth: new Date(),
    calendarMarkerMode: 'holiday',
    supabaseSyncStatus: 'offline',
    exportConfig: {
        periodStart: null,
        periodEnd: null,
        activePreset: 'thisMonth',
        leaderFilter: 'all',
        deductions: [],
        payrollPreviewInclusion: { bonuses: true, deductions: true, loans: true },
        employeeDeductionsAdded: false
    },
    statsCache: { 
        mtd: {} // ⚡ P3-OPT: Caché de estadísticas mensuales { empId: { days: N, hours: H, overtime: O, monthKey: 'YYYY-MM' } }
    }
};

export const stateManager = new StateManager(initialState);
window.stateManager = stateManager;

const proxyCache = new WeakMap();

const createRecursiveProxy = (obj, path = []) => {
    if (obj === null || typeof obj !== 'object' || obj instanceof Date || obj instanceof Blob) {
        return obj;
    }
    
    // Devolver del caché si ya existe
    if (proxyCache.has(obj)) return proxyCache.get(obj);

    const handler = {
        get(target, prop, receiver) {
            if (prop === '_isProxy') return true;
            if (prop === '_rawTarget') return target;
            
            const value = Reflect.get(target, prop, receiver);
            
            // Solo proxificar objetos/arrays que no sean nativos especiales
            if (value !== null && typeof value === 'object' && 
                !(value instanceof Date) && !(value instanceof Blob)) {
                return createRecursiveProxy(value, [...path, prop]);
            }
            return value;
        },
        set(target, prop, value, receiver) {
            const oldValue = target[prop];
            // 🧹 Desenvolver el valor si es un proxy antes de guardarlo en el target real
            const rawValue = toRaw(value);
            // Importante: Reflect.set sin receiver previene problemas en arrays y herencia
            const result = Reflect.set(target, prop, rawValue);

            if (oldValue !== value && !stateManager.isSilent()) {
                // 🎯 Fase 4 Paso 4: el proxy es AGNÓSTICO al dominio. La coherencia de
                // asistencia (statsCache.mtd / attendanceByDate) la mantienen ahora los
                // handlers de forma EXPLÍCITA (invalidateEmployeeStats + buildAttendanceIndex;
                // ver los *CoherenceTests.js). El proxy sólo agenda el render global.
                if (window.render) renderOptimizer.scheduleRender(window.render);
            }
            return result;
        },
        deleteProperty(target, prop) {
            const result = Reflect.deleteProperty(target, prop);

            if (result && !stateManager.isSilent()) {
                // 🎯 Fase 4 Paso 4: proxy agnóstico — la coherencia de asistencia al borrar
                // la mantienen ahora los handlers de forma EXPLÍCITA. El proxy sólo agenda render.
                if (window.render) renderOptimizer.scheduleRender(window.render);
            }
            return result;
        }
    };

    const proxy = new Proxy(obj, handler);
    proxyCache.set(obj, proxy);
    return proxy;
};

export const state = createRecursiveProxy(stateManager._state);
window.state = state;

/**
 * ⚡ P3-OPT: Invalida la caché de estadísticas mensuales (MTD) de un empleado.
 * Extraído del set/delete trap del proxy (Fase 4 — desacople del estado) para que
 * la coherencia sea EXPLÍCITA y llamable, no un efecto escondido del proxy. Cualquier
 * camino de escritura de asistencia que invoque esto mantiene las stats coherentes,
 * aunque no pase por el proxy.
 */
export function invalidateEmployeeStats(empId) {
    if (empId && stateManager._state.statsCache.mtd[empId]) {
        delete stateManager._state.statsCache.mtd[empId];
    }
}
window.invalidateEmployeeStats = invalidateEmployeeStats;

/**
 * Wholesale clear of the monthly stats cache. Use after a BULK attendance
 * replace/load (backup restore, import, full reset) where every employee's
 * cached monthly figure may be stale. The per-employee form is invalidateEmployeeStats.
 */
export function invalidateAllStats() {
    stateManager._state.statsCache.mtd = {};
}
window.invalidateAllStats = invalidateAllStats;



/**
 * ⚡ P3-OPT: Construye o actualiza el índice de asistencia por fecha.
 * @param {string} specificDate - Si se provee, solo actualiza esa fecha ($O(M)$).
 */
export function buildAttendanceIndex(specificDate = null) {
    const mainAttendance = stateManager._state.attendance;
    const index = stateManager._state.attendanceByDate;

    if (specificDate) {
        // ACTUALIZACIÓN GRANULAR: Reconstruir solo el bucket de esa fecha
        // Fase 1 (U2c): excluir tombstones — un borrado marcado no es asistencia.
        index[specificDate] = Object.values(mainAttendance)
            .filter(record => record.date === specificDate && record.deletedAt == null);
        return;
    }

    // RECONSTRUCCIÓN TOTAL: Escaneo completo de la asistencia
    const newIndex = {};
    for (const record of Object.values(mainAttendance)) {
        const dKey = record.date;
        if (!dKey) continue;
        if (record.deletedAt != null) continue; // Fase 1 (U2c): tombstone, no cuenta
        if (!newIndex[dKey]) newIndex[dKey] = [];
        newIndex[dKey].push(record);
    }
    
    stateManager._state.attendanceByDate = newIndex;
    stateManager._attendanceDirty = false;
}
window.buildAttendanceIndex = buildAttendanceIndex;

export function calculateStats() {
    // ⚡ P3-OPT: Reconstrucción lazy si los datos están sucios
    if (stateManager.isAttendanceDirty()) {
        if (window.debug) window.debug.log('🔄 Reconstruyendo índice de asistencia (Auto)...');
        buildAttendanceIndex();
    }

    const dKey = getDateKey(state.selectedDate);
    // F1.5 (ADR-008): los números visibles del día se resuelven por proyecto
    // efectivo (record.projectId ?? default === activo). Flag OFF o scope sin
    // resolver ⇒ entityInScope es true ⇒ cero filtrado (paridad legacy). El
    // ESTADO crudo y attendanceByDate siguen COMPLETOS: el filtro es de vista.
    const scope = peekEntityScope();
    const todayAtt = (state.attendanceByDate[dKey] || []).filter(a => entityInScope(a, scope));
    const present = todayAtt.filter(a => a.present).length;

    // Filtrar empleados activos usando la utilidad centralizada
    const activeEmps = state.employees.filter(e =>
        entityInScope(e, scope) &&
        wasEmployeeActiveOnDate(e, state.selectedDate, state.attendance)
    ).length;
    const absent = Math.max(0, activeEmps - present);
    
    const totalHours = todayAtt.reduce((sum, a) => sum + (a.present ? (a.hoursWorked || 0) : 0), 0);
    const overtimeHours = todayAtt.reduce((sum, a) => {
        if (!a.present) return sum;
        
        // ⚡ REGLA: Si es multiposición, ya tenemos las extras calculadas manualmente (prioridad)
        if (a.multiPosition && typeof a.overtimeHours === 'number') {
            return sum + a.overtimeHours;
        }

        // Cálculo automático basado en el umbral global de ajustes (no el selector diario)
        const threshold = normalizeRegularHoursPerDay(state.settings?.regularHoursPerDay);
        return sum + Math.max(0, (a.hoursWorked || 0) - threshold);
    }, 0);
    
    return { present, absent, totalHours, overtimeHours };
}
window.calculateStats = calculateStats;

// getEmployeeTotalHours movido a js/modules/features/stats/EmployeeStatsService.js

/**
 * ⚡ P3-OPT: Obtener estadísticas mensuales acumuladas con caché persistente (O(1) amortizado).
 */
export function getEmployeeMTDStats(empId, dateInput) {
    const date = parseDate(dateInput);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const cache = stateManager._state.statsCache.mtd[empId];

    // Devolver caché si es válido para el mes actual
    if (cache && cache.monthKey === monthKey) {
        return cache;
    }

    // Calcular si no hay caché o si es de otro mes
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    const today = new Date(date);
    
    let hours = 0;
    let days = 0;
    let overtime = 0;

    for (let d = new Date(firstDay); d <= today; d.setDate(d.getDate() + 1)) {
        const key = `${empId}-${getDateKey(new Date(d))}`;
        const att = stateManager._state.attendance[key];
        if (att && att.present) {
            days++;
            hours += (att.hoursWorked || 0);
            overtime += (att.overtimeHours || 0);
        }
    }

    const stats = { hours, days, overtime, monthKey };
    stateManager._state.statsCache.mtd[empId] = stats;
    
    return stats;
}


export function getHoursWorked(empId, dateKey) {
    const att = stateManager._state.attendance[`${empId}-${dateKey}`];
    return (att && att.present) ? (att.hoursWorked || 0) : 0;
}

export function getEmployeeTotalHours(empId, start, end) {
    let total = 0;
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        total += getHoursWorked(empId, getDateKey(new Date(d)));
    }
    return total;
}

window.getEmployeeTotalHours = getEmployeeTotalHours;
// state ya está exportado arriba como proxy (L233)

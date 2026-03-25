/**
 * 📧 AppState.js - Gestión Centralizada del Estado Reactivo
 * Parte de la Fase 4: Modularización y Componentización
 */

import { getDateKey, wasEmployeeActiveOnDate } from '../utils/DateUtils.js';

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

// 2. StateManager
class StateManager {
    constructor(initialState = {}) {
        this._state = initialState;
        this._silent = false;
    }
    isSilent() { return this._silent; }
    getState() { return this._state; }
    setState(updates, options = {}) {
        const { silent = false } = options;
        this._silent = silent;
        Object.assign(this._state, updates);
        if (!silent && window.render) renderOptimizer.scheduleRender(window.render);
        this._silent = false;
        return this._state;
    }
    silentSetState(updates) { return this.setState(updates, { silent: true }); }
}

const initialState = {
    activeTab: 'attendance',
    viewMode: 'day', 
    selectedDate: new Date(),
    employees: [],
    attendance: {},
    positions: [],
    leaders: [],
    settings: {
        regularHoursPerDay: 8,
        syncEnabled: true,
        lastPaymentDate: null,
        nextPaymentDate: null,
        overtimeFactor: 1.5,
        holidayFactor: 2.0,
        holidays: []
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
    showLegend: false,
    showDatePicker: false,
    datePickerTarget: null,
    isScrolled: false,
    tempPositionSelection: {},
    listDisplayMode: 'relaxed',
    isDataLoaded: false,
    syncStatus: 'idle',
    showFloatingCard: false,
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
        expandedPositions: {}
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
        employeeDeductionsAdded: false
    }
};

export const stateManager = new StateManager(initialState);
window.stateManager = stateManager;

const stateHandler = {
    get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
            return new Proxy(value, stateHandler);
        }
        return value;
    },
    set(target, prop, value, receiver) {
        const oldValue = target[prop];
        const result = Reflect.set(target, prop, value, receiver);
        if (oldValue !== value && !stateManager.isSilent()) {
            if (window.render) renderOptimizer.scheduleRender(window.render);
        }
        return result;
    }
};

export const state = new Proxy(stateManager._state, stateHandler);
window.state = state;

// 📊 Funciones de Cálculo de Estadísticas (Exportadas para UI)
export function calculateStats() {
    const dKey = getDateKey(state.selectedDate);
    const todayAtt = Object.values(state.attendance).filter(a => a.date === dKey);
    const present = todayAtt.filter(a => a.present).length;
    
    // Filtrar empleados activos usando la utilidad centralizada
    const activeEmps = state.employees.filter(e => wasEmployeeActiveOnDate(e, state.selectedDate, state.attendance)).length;
    const absent = Math.max(0, activeEmps - present);
    
    const totalHours = todayAtt.reduce((sum, a) => sum + (a.present ? (a.hoursWorked || 0) : 0), 0);
    const overtimeHours = todayAtt.reduce((sum, a) => {
        if (!a.present) return sum;
        return sum + Math.max(0, (a.hoursWorked || 0) - (state.settings?.regularHoursPerDay || 8));
    }, 0);
    
    return { present, absent, totalHours, overtimeHours };
}
window.calculateStats = calculateStats;

export function getEmployeeTotalHours(empId, start, end) {
    let total = 0;
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const key = `${empId}-${getDateKey(new Date(d))}`;
        const att = state.attendance[key];
        if (att && att.present) total += (att.hoursWorked || 0);
    }
    return total;
}
window.getEmployeeTotalHours = getEmployeeTotalHours;

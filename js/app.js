const DEBUG_MODE = false; // Cambiar a true para ver logs en desarrollo

import { SupabaseService } from './modules/services/SupabaseService.js';
// ═══════════════════════════════════════════════════════════

window.debug = {
    log: (...args) => { if (DEBUG_MODE) console.log(...args); },
    error: (...args) => console.error(...args), // Errores siempre se muestran
    warn: (...args) => { if (DEBUG_MODE) console.warn(...args); }
};

// Sistema de Debounce (evita renders excesivos en búsquedas)
window.debounce = (func, wait = 300) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// ============================================
// 🏗️ SISTEMA POO - CLASES Y OBJETOS REUTILIZABLES
// ============================================

// ============================================
// 📢 CLASE NOTIFICATION (POO - Profesional)
// ============================================
import { Notification } from './modules/components/Notification.js';
import { Modal } from './modules/components/Modal.js';
import { Employee } from './modules/features/employees/Employee.js';
import { Position } from './modules/features/employees/Position.js';
import { Leader } from './modules/features/employees/Leader.js';
import { Attendance } from './modules/features/attendance/Attendance.js';
import { UndoManager } from './modules/utils/UndoManager.js';
import { DateUtils, parseDate, getDateKey, isDayHoliday, formatDate, formatDateShort, formatMonthYear, formatDateRangeWithMonth } from './modules/utils/DateUtils.js';
import { SyncConflictModal } from './modules/ui/SyncConflictModal.js';
import { formatCurrency } from './modules/utils/Formatters.js';
import { StorageService } from './modules/services/StorageService.js';
import { DataService } from './modules/services/DataService.js';
import { ValidationService } from './modules/services/ValidationService.js';
import { ComponentBase } from './modules/components/ComponentBase.js';
import { AttendanceService } from './modules/features/attendance/AttendanceService.js';
import { PayrollService } from './modules/features/payroll/PayrollService.js';
import { ChartService } from './modules/features/analytics/ChartService.js';
import { demoData, generateDemoAttendance } from './modules/data/DemoData.js'; // ⚡ NUEVO IMPORT
import { TabComponent } from './modules/components/TabComponent.js';
import { TableComponent } from './modules/components/TableComponent.js';
import { FormComponent } from './modules/components/FormComponent.js';
import { CalendarPickerComponent } from './modules/components/CalendarPickerComponent.js';
import { StatCardComponent } from './modules/components/StatCardComponent.js';
import { SearchComponent } from './modules/components/SearchComponent.js';
import { BadgeComponent } from './modules/components/BadgeComponent.js';
import { TooltipComponent } from './modules/components/TooltipComponent.js';
import { COLOR_PALETTE } from './modules/utils/Constants.js';
import { icons } from './modules/ui/IconSystem.js';
import {
    DateRangeManager,
    DashboardDateManager,
    DashboardDateManagerV2,
    EmployeeReportDateManager,
    EmployeeReportDateManagerV2
} from './modules/utils/DateManagers.js';

import * as EmployeesUI from './modules/features/employees/EmployeesUI.js';
import * as AnalyticsUI from './modules/features/analytics/AnalyticsUI.js';
import * as PayrollUI from './modules/features/payroll/PayrollUI.js';

const ICON_SET_STORAGE_KEY = 'icon-set';

function resolveIconSet(preferred) {
    const available = icons.getAvailableSets();
    const saved = localStorage.getItem(ICON_SET_STORAGE_KEY);
    if (preferred && available.includes(preferred)) return preferred;
    if (saved && available.includes(saved)) return saved;
    return 'unicode';
}

function applyIconSet(preferred, { persist = true } = {}) {
    const setName = resolveIconSet(preferred);
    icons.setSet(setName);
    if (persist) localStorage.setItem(ICON_SET_STORAGE_KEY, setName);
    icons.refresh();
    return setName;
}

// Inicializar el sistema de iconos desde preferencia guardada (si existe)
const initialIconSet = resolveIconSet();
icons.init(initialIconSet);

// ============================================
// 📢 CLASE NOTIFICATION (POO - Profesional)
// ============================================
// Movido a js/modules/components/Notification.js

// ============================================
// 🪟 CLASE MODAL (POO - Profesional)
// ============================================
// Movido a js/modules/components/Modal.js

// ============================================
// COMPATIBILIDAD CON CÓDIGO VIEJO
// ============================================
const NotificationSystem = {
    success: (msg, dur) => Notification.success(msg, dur),
    error: (msg, dur) => Notification.error(msg, dur),
    warning: (msg, dur) => Notification.warning(msg, dur),
    info: (msg, dur) => Notification.info(msg, dur),
    clear: () => Notification.clearAll()
};

function showNotification(message, type = 'info') {
    return Notification[type] ? Notification[type](message) : Notification.info(message);
}

// ============================================
// 🔄 SISTEMA UNDO — Botón "Deshacer"
// ============================================
// Movido a js/modules/utils/UndoManager.js
// Inicialización diferida para asegurar dependencias
document.addEventListener('DOMContentLoaded', () => {
    UndoManager.init({
        saveFn: saveApplicationData,
        renderFn: render,
        showNotificationFn: showNotification
    });
});

// ============================================
// 🎯 CLASE EMPLOYEE
// ============================================
// Movido a js/modules/models/Employee.js

// ============================================
// 🏢 CLASE POSITION
// ============================================
// Movido a js/modules/models/Position.js

// ============================================
// 👔 CLASE LEADER
// ============================================
// Movido a js/modules/models/Leader.js

// ============================================
// 📅 CLASE ATTENDANCE
// ============================================
// Movido a js/modules/models/Attendance.js

// ============================================
// 📊 OBJETO HELPERS (Utilidades compartidas)
// ============================================
const Helpers = {
    // Formatear fecha
    formatDate(date, format = 'long') {
        const d = new Date(date);
        const options = format === 'long'
            ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
            : { year: 'numeric', month: '2-digit', day: '2-digit' };
        return d.toLocaleDateString('es-ES', options);
    },

    // Obtener clave de fecha (YYYY-MM-DD)
    getDateKey(date) {
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    // Generar ID único
    generateId(prefix = '') {
        return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },

    // Formatear moneda
    formatCurrency(amount) {
        return new Intl.NumberFormat('es-DO', {
            style: 'currency',
            currency: 'DOP',
            minimumFractionDigits: 0
        }).format(amount);
    },

    // Validar email
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },

    // Validar teléfono
    isValidPhone(phone) {
        return /^\d{10}$/.test(phone.replace(/\D/g, ''));
    },

    // Debounce
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

// ============================================
// ESTADO GLOBAL
// ============================================
const state = {
    activeTab: 'attendance',

    // ✅ NUEVO SISTEMA DE FECHAS (String format: YYYY-MM-DD)
    today: getDateKey(new Date()),           // Fecha de hoy (no cambia)
    selectedDate: getDateKey(new Date()),    // Fecha seleccionada por el usuario (cambia)

    viewMode: 'day',

    // Fase 5: IndexedDB
    useIndexedDB: true, // Se activará después de migración exitosa

    // Auto-backup para Canvas de Claude (sessionStorage)
    autoBackupEnabled: true, // Activo por defecto para Canvas

    // Onboarding
    showOnboarding: false,
    onboardingStep: 0,
    onboardingMode: null, // 'demo' o 'scratch'
    usingDemoData: false, // Flag para saber si está en modo demo

    positions: [], // Inicialmente vacío
    leaders: [], // Inicialmente vacío
    employees: [], // Inicialmente vacío
    attendance: {}, // Inicialmente vacío
    settings: {
        companyName: 'Control de Asistencia',
        regularHoursPerDay: 8,
        overtimeFactor: 1.5,  // ⚡ Factor multiplicador para horas extras (x1.5 = tiempo y medio)
        holidayFactor: 2,  // Factor multiplicador para días festivos (x2 = doble pago)
        defaultDeductionPercentage: 2,  // ⚡ NUEVO: Deducción por defecto 2%
        globalPaymentDay: null,  // 📅 Día del mes para pagos (1-31), null si no está configurado
        lastPaymentDate: null,  // 💵 Fecha del último pago realizado (YYYY-MM-DD)
        nextPaymentDate: null,  // 📅 Fecha del próximo pago programado (YYYY-MM-DD)
        iconSet: initialIconSet, // 🎨 Set de iconos preferido
        holidays: [], // Inicialmente sin festivos
        updatedAt: Date.now()
    },

    // Configuración de horas específicas por día
    dayHoursConfig: {}, // { '2026-01-20': 4, '2026-01-21': 6 }

    // ✅ Horas rápidas para vista semanal
    quickWeekHours: 8, // Horas por defecto al marcar en vista semanal

    // Filtros
    filters: {
        position: 'all',  // 'all' | 'albanil' | 'carpintero'...
        leaderId: 'all',   // 'all' | leaderId
        search: ''
    },
    showFilters: false,  // Filtros colapsados por defecto
    isDataLoaded: false, // 🚩 Bandera de carga para evitar sobrescrituras

    // Dashboard
    dashboardChart: 'attendance',  // 'attendance' | 'hours' | 'positions' | 'top10' | 'heatmap'
    dashboardStartDate: null,      // String YYYY-MM-DD (se inicializa al abrir dashboard)
    dashboardEndDate: null,        // String YYYY-MM-DD (se inicializa al abrir dashboard)
    showStartDatePicker: false,    // Mostrar calendario de inicio
    showEndDatePicker: false,      // Mostrar calendario de fin
    startDatePickerMonth: new Date(), // Mes del calendario inicio
    endDatePickerMonth: new Date(),   // Mes del calendario fin

    // Settings Modal
    settingsCalendarMonth: new Date(), // Mes del calendario de festivos
    calendarMarkerMode: 'holiday', // 'holiday', 'lastPayment', 'nextPayment'

    // Employee Report
    employeeReportStartDate: null,     // String YYYY-MM-DD (se inicializa al abrir reporte)
    employeeReportEndDate: null,       // String YYYY-MM-DD (se inicializa al abrir reporte)
    showEmployeeReportStartPicker: false,
    showEmployeeReportEndPicker: false,
    employeeReportStartPickerMonth: new Date(),
    employeeReportEndPickerMonth: new Date(),
    collapsedPositions: {},            // {positionId: boolean} - posiciones colapsadas

    // ⚡ NUEVO: Sub-pestañas de configuración
    settingsActiveTab: 'data',      // 'general' | 'data' | 'calendar'

    // ⚡ NUEVO: Dashboard de configuración
    lastSupabaseSync: null,            // Timestamp ISO de última sincronización
    supabaseSyncStatus: null,          // Cache de estadísticas de sync

    // ⚡ NUEVO: Indicador de estado de sincronización en header
    syncStatus: 'idle',                // 'idle' | 'syncing' | 'synced' | 'error'

    showModal: false,
    modalType: null,
    selectedEmployee: null,

    // Sistema de confirmación modal
    // showConfirmDialog: ELIMINADO - ahora usamos Modal.confirm()
    // confirmDialogData: ELIMINADO - ahora usamos Modal.confirm()

    // Menú de exportar
    showExportMenu: false,
    showShareOptions: false,
    showImportFullModal: false,
    importFullText: '',
    showNotesCenter: false,
    notesCenterEmployeeId: null,
    showNoteModal: false,
    noteModalEmployeeId: null,
    noteModalDate: '',
    noteModalText: '',
    exportMenuData: {
        x: 0,
        y: 0,
        filename: '',
        blob: null,
        title: '',
        text: ''
    },

    // ⚡ NUEVO: Configuración de exportación de nómina
    exportConfig: {
        periodStart: null,   // Se inicializa al abrir tab
        periodEnd: null,     // Se inicializa al abrir tab
        deductions: [        // Deducciones globales
            { id: 'DED-1', type: 'percentage', value: 2, name: 'Deducción' }
        ],
        excludedEmployees: [],  // IDs de empleados a excluir
        generatedJSON: null     // JSON generado para copiar
    },

    showFloatingCard: false,
    floatingCardEmployee: null,
    floatingCardMonth: new Date(),
    chartPeriod: 'week',
    contextMenu: null,
    isProcessingClick: false, // Flag para prevenir clicks múltiples
    showLegend: false,
    showDatePicker: false,
    datePickerTarget: 'full', // 'full' | 'compact'
    datePickerMonth: new Date(),
    isScrolled: false, // âš¡ NUEVO: Detectar scroll para controles flotantes
    employeeFilter: null, // null = todos, 'present' = presentes, 'absent' = ausentes, 'overtime' = con extras
    employeeViewMode: 'employees', // 'employees' | 'leaders' | 'positions'
    reportViewMode: 'employee-report', // 'employee-report' | 'dashboard'
    employeeSearchQuery: '',
    employeeStatusFilter: 'active', // 'active' | 'inactive' | 'all'
    employeeFilters: {
        search: '',
        positionId: 'all',
        leaderId: 'all',
        status: 'active'
    },
    positionFilters: {
        search: '',
        leaderId: 'all',
        status: 'active'
    },
    editingEmployee: null,
    editingLeader: null,
    positionStatusFilter: 'active', // 'active' | 'inactive' | 'all'
    showOptionalFields: false, // Para colapsar campos opcionales en formularios
    isExporting: false, // Para mostrar loading en exportar
    formErrors: {}, // Para validación inline en formularios
    isFractionated: false, // Para modo fraccionado en modal avanzado
    tempPositionSelection: {}, // { 'empId-date': 'positionId' } - Selección temporal antes del check
    positionSortBy: 'name', // 'name' | 'salary'
    editingPosition: null,
    scrollPosition: { x: 0, y: 0 }, // Guardar posición del scroll

    // ⚡ NUEVO: Perfil de empleado
    showEmployeeProfile: false,
    employeeProfile: {
        employeeId: null,
        activeTab: 'nomina', // 'resumen' | 'nomina' | 'asistencia' | 'documentos'
        periodStart: null,   // Se inicializa al abrir
        periodEnd: null,     // Se inicializa al abrir
        showStartPicker: false,
        showEndPicker: false,
        startPickerMonth: new Date(),
        endPickerMonth: new Date(),
        deductionType: 'percentage', // ⚠️ DEPRECATED - mantener para compatibilidad
        deductionValue: 0,           // ⚠️ DEPRECATED - mantener para compatibilidad
        deductions: [                // ⚡ NUEVO: Array de deducciones múltiples
            { type: 'percentage', value: 2, id: 'DED-1' }  // Deducción por defecto 2%
        ],
        expandedPositions: {},  // ⚡ NUEVO: { positionId: true/false }
        activePeriod: null   // ⚡ NUEVO: '7days' | '15days' | 'month' | 'lastPayment'
    },
    // ⚡ NUEVO: Configuración de exportación
    exportConfig: {
        periodStart: null,
        periodEnd: null,
        activePreset: null, // 'thisMonth', 'lastMonth', 'last15'
        deductions: []
    }
};

// ============================================
// 💾 CLASE INDEXEDDBSERVICE (POO - Base de datos local)
// ============================================
class IndexedDBService {
    constructor(dbName = 'attendance-app-db', version = 6) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
        this.isInitialized = false;
    }

    // Inicializar base de datos
    async init() {
        if (this.isInitialized) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                debug.error('❌ Error al abrir IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;
                debug.log('✅ IndexedDB inicializado');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Store: Empleados
                if (!db.objectStoreNames.contains('employees')) {
                    const empStore = db.createObjectStore('employees', { keyPath: 'id' });
                    empStore.createIndex('number', 'number', { unique: true });
                    empStore.createIndex('active', 'active', { unique: false });
                    empStore.createIndex('name', 'name', { unique: false });
                }

                // Store: Posiciones
                if (!db.objectStoreNames.contains('positions')) {
                    const posStore = db.createObjectStore('positions', { keyPath: 'id' });
                    posStore.createIndex('name', 'name', { unique: false });
                }

                // Store: Líderes
                if (!db.objectStoreNames.contains('leaders')) {
                    const leadStore = db.createObjectStore('leaders', { keyPath: 'id' });
                    leadStore.createIndex('number', 'number', { unique: true });
                } else {
                    const leadStore = event.target.transaction.objectStore('leaders');
                    if (leadStore.indexNames.contains('code')) {
                        leadStore.deleteIndex('code');
                    }
                    if (!leadStore.indexNames.contains('number')) {
                        leadStore.createIndex('number', 'number', { unique: true });
                    }
                }

                // Store: Asistencia
                if (!db.objectStoreNames.contains('attendance')) {
                    const attStore = db.createObjectStore('attendance', { keyPath: 'key' });
                    attStore.createIndex('employeeId', 'employeeId', { unique: false });
                    attStore.createIndex('date', 'date', { unique: false });
                    attStore.createIndex('employeeDate', ['employeeId', 'date'], { unique: true });
                }

                // Store: Settings
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                // Store: Cola de sincronización
                if (!db.objectStoreNames.contains('sync_queue')) {
                    const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
                    syncStore.createIndex('status', 'status', { unique: false });
                    syncStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                debug.log('📦 Stores de IndexedDB creados');
            };
        });
    }

    // Agregar registro
    async add(storeName, data) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Obtener registro
    async get(storeName, key) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Obtener todos los registros
    async getAll(storeName) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    // Actualizar registro
    async update(storeName, data) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Eliminar registro
    async delete(storeName, key) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Limpiar store
    async clear(storeName) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Buscar por índice
    async query(storeName, indexName, value) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    // Contar registros
    async count(storeName) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.count();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Migrar desde localStorage
    async migrateFromLocalStorage() {
        try {
            const oldData = localStorage.getItem('attendance-app-data');
            if (!oldData) {
                debug.log('ℹ️ No hay datos en localStorage para migrar');
                return false;
            }

            const parsed = JSON.parse(oldData);
            const data = parsed.data || parsed;

            debug.log('🔄 Migrando datos desde localStorage...');

            // Migrar empleados
            if (data.employees) {
                for (const emp of data.employees) {
                    await this.update('employees', emp);
                }
                debug.log(`✅ ${data.employees.length} empleados migrados`);
            }

            // Migrar posiciones
            if (data.positions) {
                for (const pos of data.positions) {
                    await this.update('positions', pos);
                }
                debug.log(`✅ ${data.positions.length} posiciones migradas`);
            }

            // Migrar líderes
            if (data.leaders) {
                for (const leader of data.leaders) {
                    await this.update('leaders', leader);
                }
                debug.log(`✅ ${data.leaders.length} líderes migrados`);
            }

            // Migrar asistencia
            if (data.attendance) {
                const attRecords = Object.entries(data.attendance).map(([key, value]) => ({
                    key,
                    ...value
                }));

                for (const att of attRecords) {
                    await this.update('attendance', att);
                }
                debug.log(`✅ ${attRecords.length} registros de asistencia migrados`);
            }

            // Migrar settings
            if (data.settings) {
                await this.update('settings', { key: 'app', ...data.settings });
                debug.log('✅ Settings migrados');
            }

            // Backup de localStorage antes de borrar
            localStorage.setItem('attendance-app-data-backup', oldData);

            debug.log('✅ Migración completada exitosamente');
            Notification.success('✅ Datos migrados a IndexedDB');

            return true;
        } catch (error) {
            debug.error('❌ Error en migración:', error);
            Notification.error('❌ Error al migrar datos');
            return false;
        }
    }

    // Exportar toda la DB
    async exportDB() {
        const data = {
            employees: await this.getAll('employees'),
            positions: await this.getAll('positions'),
            leaders: await this.getAll('leaders'),
            attendance: await this.getAll('attendance'),
            settings: await this.getAll('settings'),
            exportedAt: new Date().toISOString(),
            version: this.version
        };

        return data;
    }

    // Importar DB completa
    async importDB(data) {
        try {
            // Limpiar stores
            await this.clear('employees');
            await this.clear('positions');
            await this.clear('leaders');
            await this.clear('attendance');
            await this.clear('settings');

            // Importar datos
            if (data.employees) {
                for (const emp of data.employees) {
                    await this.update('employees', emp);
                }
            }

            if (data.positions) {
                for (const pos of data.positions) {
                    await this.update('positions', pos);
                }
            }

            if (data.leaders) {
                for (const leader of data.leaders) {
                    await this.update('leaders', leader);
                }
            }

            if (data.attendance) {
                for (const att of data.attendance) {
                    await this.update('attendance', att);
                }
            }

            if (data.settings) {
                for (const setting of data.settings) {
                    await this.update('settings', setting);
                }
            }

            debug.log('✅ Datos importados correctamente');
            return true;
        } catch (error) {
            debug.error('❌ Error al importar datos:', error);
            return false;
        }
    }
}

// Instancia global de IndexedDB
const indexedDBService = new IndexedDBService();

const supabaseService = new SupabaseService({
    state: state,
    render: () => render(),
    showNotification: (msg, type) => showNotification(msg, type),
    saveToLocalStorage: () => saveApplicationData(),
    applyIconSet: (preferred, options) => applyIconSet(preferred, options),
    resolveIconSet: (preferred) => resolveIconSet(preferred)
});
supabaseService.setIndexedDBService(indexedDBService); // Asegurar que tenga acceso a DB

// Exponer funciones críticas al scope global (window)
window.render = render;
window.saveToLocalStorage = saveApplicationData;
window.showNotification = showNotification;
window.applyIconSet = applyIconSet;
window.resolveIconSet = resolveIconSet;
window.updateSyncStatus = updateSyncStatus;

// Proxies para compatibilidad con código existente (HTML onclick, etc)
window.supabaseClient = supabaseService.client;
window.syncNow = () => supabaseService.syncNow();
window.migrateToSupabase = () => supabaseService.migrateToSupabase();
window.loadFromSupabase = () => supabaseService.loadFromSupabase();
window.disconnectSupabase = () => supabaseService.disconnect();

// Getters/Setters para mantener las variables globales sincronizadas con el servicio
Object.defineProperties(window, {
    useSupabase: {
        get: () => supabaseService.useSupabase,
        set: (v) => supabaseService.useSupabase = v
    },
    currentUser: {
        get: () => supabaseService.currentUser,
        set: (v) => supabaseService.currentUser = v
    },
    isSyncing: {
        get: () => supabaseService.isSyncing,
        set: (v) => supabaseService.isSyncing = v
    },
    autoSyncEnabled: {
        get: () => supabaseService.autoSyncEnabled,
        set: (v) => supabaseService.autoSyncEnabled = v
    }
});

function generateUUID() { return supabaseService.generateUUID(); }
function isValidUUID(id) { return supabaseService.isValidUUID(id); }
function ensureUUID(id) { return supabaseService.ensureUUID(id); }

// Helper Functions
// Movido a js/modules/utils/DateUtils.js y js/modules/utils/Formatters.js
// - saveScrollPosition y restoreScrollPosition se mantienen aquí o mueven a UIHelpers
// - formatCurrency -> Formatters.js
// - DateUtils y funciones de fecha -> DateUtils.js

function saveScrollPosition() {
    const container = document.querySelector('.week-table-container');
    if (container) {
        state.scrollPosition = {
            x: container.scrollLeft,
            y: container.scrollTop
        };
    } else {
        state.scrollPosition = {
            x: window.scrollX,
            y: window.scrollY
        };
    }
}

function restoreScrollPosition() {
    // Restaurar en el próximo frame para asegurar que el DOM esté listo
    requestAnimationFrame(() => {
        const container = document.querySelector('.week-table-container');
        if (container && (state.scrollPosition.x > 0 || state.scrollPosition.y > 0)) {
            container.scrollLeft = state.scrollPosition.x;
            container.scrollTop = state.scrollPosition.y;
        } else if (state.scrollPosition.y > 0) {
            window.scrollTo(state.scrollPosition.x, state.scrollPosition.y);
        }
    });
}

// Obtener horas configuradas para un día específico
function getDayHours(date) {
    const key = getDateKey(date);
    return state.dayHoursConfig[key] ?? state.settings.regularHoursPerDay;
}

// Establecer horas para el día actual
window.setDayHours = function (hours) {
    const key = getDateKey(state.selectedDate);
    const h = parseFloat(hours);

    if (isNaN(h) || h < 0.5 || h > 24) {
        alert('❌ Las horas deben estar entre 0.5 y 24');
        return;
    }

    state.dayHoursConfig[key] = h;
    render();
};

// ✅ NUEVO: Configurar horas rápidas para vista semanal
window.setQuickWeekHours = function (hours) {
    const h = parseFloat(hours);

    if (isNaN(h) || h < 0.5 || h > 24) {
        alert('❌ Las horas deben estar entre 0.5 y 24');
        return;
    }

    state.quickWeekHours = h;
    console.log('⚡ Horas rápidas semanales configuradas a:', h);
    saveApplicationData();
    render();
};

// ✅ NUEVO: Configurar período de perfil
window.setProfilePeriod = function (periodType) {
    const today = new Date();
    let startDate, endDate;

    endDate = getDateKey(today);

    if (periodType === '7days') {
        const start = new Date(today);
        start.setDate(today.getDate() - 6);
        startDate = getDateKey(start);
    } else if (periodType === '15days') {
        const start = new Date(today);
        start.setDate(today.getDate() - 14);
        startDate = getDateKey(start);
    } else if (periodType === 'month') {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        startDate = getDateKey(start);
    } else if (periodType === 'lastPayment') {
        // Obtener fecha de último pago del sistema o del empleado
        // Prioridad: Empleado > Sistema > 15 días atrás
        const emp = state.employees.find(e => e.id === state.employeeProfile.employeeId);

        if (emp && emp.lastPaymentDate) {
            startDate = emp.lastPaymentDate;
        } else if (state.settings.lastPaymentDate) {
            startDate = state.settings.lastPaymentDate;
        } else {
            // Fallback a 15 días si no hay registro
            const start = new Date(today);
            start.setDate(today.getDate() - 15);
            startDate = getDateKey(start);
            NotificationSystem.info('ℹ️ No se encontró fecha de último pago, mostrando últimos 15 días');
        }

        // Si la fecha de inicio es mayor o igual a hoy, ajustar
        if (startDate >= endDate) {
            // Ajustar fin a hoy, inicio a fecha guardada
        }
    } else {
        return; // Tipo desconocido
    }

    state.employeeProfile.periodStart = startDate;
    state.employeeProfile.periodEnd = endDate;
    state.employeeProfile.activePeriod = periodType;

    // Actualizar pickers por si acaso
    state.employeeProfile.startPickerMonth = parseDate(startDate);
    state.employeeProfile.endPickerMonth = parseDate(endDate);

    render();
    NotificationSystem.success(`📅 Período actualizado: ${periodType === 'lastPayment' ? 'Desde último pago' : periodType}`);
};

// Toggle mostrar/ocultar filtros
window.toggleFilters = function () {
    state.showFilters = !state.showFilters;
    render();
};

// Establecer filtro de posición
window.setPositionFilter = function (positionId) {
    state.filters.position = positionId;
    render();
};

// Establecer filtro de líder
window.setLeaderFilter = function (leaderId) {
    state.filters.leaderId = leaderId;
    render();
};

// Abrir modal de distribución de horas multi-posición
window.openMultiPositionModal = function (employeeId) {
    const emp = state.employees.find(e => e.id === employeeId);
    if (!emp) return;

    state.selectedEmployee = emp;
    state.modalType = 'multi-position';
    state.showModal = true;
    render();

    // Inicializar totales después de render
    setTimeout(updateTotalsDisplay, 100);
};

// Abrir modal multi-posición desde menú contextual (para vista semana)
// ============================================
// 🎯 CLASE MODALMANAGER (POO)
// ============================================
class ModalManager {
    constructor() {
        this.state = state; // Referencia al estado global
    }

    // Abrir modal avanzado de asistencia
    openAdvanced(employeeId, forceMultiPosition = false) {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) {
            NotificationSystem.error('❌ Empleado no encontrado');
            return;
        }

        this.state.selectedEmployee = emp;
        this.state.modalType = 'advanced';
        this.state.showModal = true;

        // Determinar si debe abrir en modo fraccionado
        const key = `${employeeId}-${this.state.selectedDate}`;
        const att = this.state.attendance[key];

        if (forceMultiPosition) {
            // Forzar modo fraccionado
            this.state.isFractionated = true;
        } else if (att && att.multiPosition) {
            // Ya está en modo fraccionado
            this.state.isFractionated = true;
        } else if (att && att.present && emp.positions.length > 1) {
            // Tiene asistencia simple pero múltiples posiciones
            // Activar fraccionado Y pre-llenar con la posición actual
            this.state.isFractionated = true;
        } else {
            // Modo normal
            this.state.isFractionated = false;
        }

        render();
    }

    // Abrir desde menú contextual (vista semana)
    openFromContext() {
        if (!this.state.contextMenu) return;

        const emp = this.state.employees.find(e => e.id === this.state.contextMenu.employeeId);
        if (!emp) return;

        // ✅ NUEVO: Cambiar temporalmente selectedDate al día clickeado
        // La fecha del menú contextual ya es string (YYYY-MM-DD)
        this.state.selectedDate = this.state.contextMenu.date;

        this.openAdvanced(emp.id);
        this.state.contextMenu = null; // Cerrar menú
    }

    // Cerrar modal
    close() {
        // ✅ NUEVO: selectedDate ya está en el día correcto, no necesita restauración
        // porque selectedDate se usa para la navegación y el modal

        this.state.showModal = false;
        this.state.modalType = null;
        this.state.selectedEmployee = null;
        this.state.showOptionalFields = false;
        this.state.isFractionated = false;
        render();
    }
}

// Instancia global del manager
const modalManager = new ModalManager();

// ============================================
// 💾 CLASE STORAGESERVICE (POO - Persistencia)
// ============================================
// ============================================
// 💾 CLASE STORAGESERVICE (POO - Persistencia)
// ============================================
// Movido a js/modules/services/StorageService.js

// Instancia global
const storageService = new StorageService();

// ============================================
// 📊 CLASE ATTENDANCESERVICE (POO - Lógica de Asistencia)
// ============================================
// Movido a js/modules/services/AttendanceService.js

// Instancia global
// Instancia global
const attendanceService = new AttendanceService(state);

// 💰 CLASE PAYROLLSERVICE
const payrollService = new PayrollService(state);

// 📈 CLASE CHARTSERVICE
const chartService = new ChartService(state);

// ============================================
// ✅ CLASE VALIDATIONSERVICE (POO - Validaciones)
// ============================================
// Movido a js/modules/services/ValidationService.js

// ============================================
// 🔄 CLASE DATASERVICE (POO - Operaciones de Datos)
// ============================================
// ============================================
// 🔄 CLASE DATASERVICE (POO - Operaciones de Datos)
// ============================================
// Movido a js/modules/services/DataService.js

// Instancia global
const dataService = new DataService(state, storageService);

// ============================================
// 📅 CLASE DASHBOARDDATEMANAGER (POO - Manejo de fechas del dashboard)
// ============================================
// Movido a js/modules/utils/DateManagers.js

// Instancia global del manejador de fechas del dashboard (Legacy)
const dashboardDateManager = new DashboardDateManager(state, saveApplicationData);

// ============================================
// 🧩 FEATURE MODULES INITIALIZATION
// ============================================

const moduleContext = {
    state,
    services: {
        payroll: payrollService,
        attendance: attendanceService,
        storage: storageService,
        data: dataService,
        chart: chartService
    },
    render,
    saveToLocalStorage: saveApplicationData,
    closeModal: () => {
        state.showModal = false;
        render();
    }
};

// Initialize Modules
EmployeesUI.init(moduleContext);
AnalyticsUI.init(moduleContext);
PayrollUI.init(moduleContext);

// Expose Modules to Window (for HTML onclick handlers)
window.EmployeesUI = EmployeesUI;
window.AnalyticsUI = AnalyticsUI;
window.PayrollUI = PayrollUI;

// Map Global Functions for Legacy Compatibility (Employees)
window.changeEmployeeViewMode = EmployeesUI.changeEmployeeViewMode;
window.setEmployeeStatusFilter = EmployeesUI.setEmployeeStatusFilter;
window.setEmployeeSearchFilter = EmployeesUI.setEmployeeSearchFilter;
window.setEmployeePositionFilter = EmployeesUI.setEmployeePositionFilter;
window.setEmployeeLeaderFilter = EmployeesUI.setEmployeeLeaderFilter;
window.resetEmployeeFilters = EmployeesUI.resetEmployeeFilters;
window.openEmployeeForm = EmployeesUI.openEmployeeForm;
window.openLeaderForm = EmployeesUI.openLeaderForm;
window.saveEmployee = EmployeesUI.saveEmployee;
window.saveLeader = EmployeesUI.saveLeader;
window.toggleEmployeeStatus = EmployeesUI.toggleEmployeeStatus;
window.toggleLeaderStatus = EmployeesUI.toggleLeaderStatus;
window.setPositionStatusFilter = EmployeesUI.setPositionStatusFilter;
window.setPositionSearchFilter = EmployeesUI.setPositionSearchFilter;
window.setPositionLeaderFilter = EmployeesUI.setPositionLeaderFilter;
window.setPositionSortBy = EmployeesUI.setPositionSortBy;
window.openPositionForm = EmployeesUI.openPositionForm;
window.savePosition = EmployeesUI.savePosition;
window.togglePositionStatus = EmployeesUI.togglePositionStatus;
window.deletePosition = EmployeesUI.deletePosition;
window.openEmployeeFloating = EmployeesUI.openEmployeeFloating;
window.closeFloatingCard = EmployeesUI.closeFloatingCard;
window.changeFloatingMonth = EmployeesUI.changeFloatingMonth;
window.openEmployeeProfile = EmployeesUI.openEmployeeProfile;

// ============================================
// 📅 REFACTORIZACIÓN POO - Clase base para manejadores de fecha
// ============================================
// Movido a js/modules/utils/DateManagers.js

// ============================================
// 📅 Clases específicas heredando de DateRangeManager
// ============================================
// Movido a js/modules/utils/DateManagers.js

// ✅ Reemplazar instancias con versiones optimizadas
const dashboardDateManagerV2 = new DashboardDateManagerV2(state, saveApplicationData);
const employeeReportDateManagerV2 = new EmployeeReportDateManagerV2(state, saveApplicationData);

// ============================================
// 📅 CLASE EMPLOYEEREPORTDATEMANAGER (POO - Manejo de fechas del reporte de empleados)
// ============================================
// Movido a js/modules/utils/DateManagers.js

// Instancia global del manejador de fechas del reporte de empleados (Legacy)
const employeeReportDateManager = new EmployeeReportDateManager(state, saveApplicationData);

// ============================================
// 🎨 FASE 3: COMPONENTES UI POO
// ============================================
// Movidos a js/modules/components/

// Instancia global del calendario (necesaria para los onclick del HTML generado)
window.calendarPicker = null;

// ============================================
// ⚡ FASE 4: OPTIMIZACIONES DE PERFORMANCE
// ============================================

// ============================================
// 🎯 CLASE STATEMANAGER (POO - Gestión centralizada de estado)
// ============================================
class StateManager {
    constructor(initialState = {}) {
        this._state = initialState;
        this._listeners = new Map();
        this._history = [];
        this._maxHistory = 50;
        this._batch = null;
        this._batchTimeout = null;
    }

    // Obtener estado completo
    getState() {
        return this._state;
    }

    // Obtener parte del estado
    get(path) {
        const keys = path.split('.');
        let value = this._state;

        for (const key of keys) {
            if (value === undefined || value === null) return undefined;
            value = value[key];
        }

        return value;
    }

    // Actualizar estado
    setState(updates, options = {}) {
        const { silent = false, merge = true } = options;

        // Guardar estado anterior
        if (this._history.length >= this._maxHistory) {
            this._history.shift();
        }
        this._history.push(JSON.stringify(this._state));

        // Aplicar cambios
        if (merge) {
            this._state = { ...this._state, ...updates };
        } else {
            this._state = updates;
        }

        // Notificar listeners
        if (!silent) {
            this._notifyListeners(updates);
        }

        return this._state;
    }

    // Actualizar estado en batch (múltiples cambios = 1 render)
    batchUpdate(updateFn) {
        if (this._batch === null) {
            this._batch = {};
        }

        // Ejecutar función de actualización
        updateFn();

        // Programar notificación después de todos los cambios
        clearTimeout(this._batchTimeout);
        this._batchTimeout = setTimeout(() => {
            const updates = this._batch;
            this._batch = null;
            this._notifyListeners(updates);
        }, 0);
    }

    // Suscribirse a cambios
    subscribe(listener, keys = []) {
        const id = Date.now() + Math.random();
        this._listeners.set(id, { listener, keys });

        // Retornar función para cancelar suscripción
        return () => this._listeners.delete(id);
    }

    // Notificar a listeners
    _notifyListeners(updates) {
        const changedKeys = Object.keys(updates);

        this._listeners.forEach(({ listener, keys }) => {
            // Si no hay keys específicas, notificar siempre
            if (keys.length === 0) {
                listener(this._state, updates);
                return;
            }

            // Si alguna key cambió, notificar
            const shouldNotify = changedKeys.some(key => keys.includes(key));
            if (shouldNotify) {
                listener(this._state, updates);
            }
        });
    }

    // Deshacer último cambio
    undo() {
        if (this._history.length === 0) return false;

        const previousState = this._history.pop();
        this._state = JSON.parse(previousState);
        this._notifyListeners(this._state);

        return true;
    }

    // Resetear estado
    reset(newState = {}) {
        this._history = [];
        this._state = newState;
        this._notifyListeners(this._state);
    }
}

// ============================================
// 💾 CLASE CACHESERVICE (POO - Caché inteligente)
// ============================================
class CacheService {
    constructor(options = {}) {
        this._cache = new Map();
        this._ttl = options.ttl || 5 * 60 * 1000; // 5 minutos default
        this._maxSize = options.maxSize || 100;
        this._hits = 0;
        this._misses = 0;
    }

    // Generar key de caché
    _generateKey(fn, args) {
        return `${fn.name}_${JSON.stringify(args)}`;
    }

    // Obtener valor de caché
    get(key) {
        const item = this._cache.get(key);

        if (!item) {
            this._misses++;
            return null;
        }

        // Verificar expiración
        if (Date.now() - item.timestamp > this._ttl) {
            this._cache.delete(key);
            this._misses++;
            return null;
        }

        this._hits++;
        item.lastAccessed = Date.now();
        return item.value;
    }

    // Guardar en caché
    set(key, value) {
        // Si está lleno, eliminar el menos usado
        if (this._cache.size >= this._maxSize) {
            this._evictLRU();
        }

        this._cache.set(key, {
            value,
            timestamp: Date.now(),
            lastAccessed: Date.now()
        });
    }

    // Eliminar menos recientemente usado (LRU)
    _evictLRU() {
        let oldestKey = null;
        let oldestTime = Infinity;

        this._cache.forEach((item, key) => {
            if (item.lastAccessed < oldestTime) {
                oldestTime = item.lastAccessed;
                oldestKey = key;
            }
        });

        if (oldestKey) {
            this._cache.delete(oldestKey);
        }
    }

    // Memoizar función
    memoize(fn) {
        return (...args) => {
            const key = this._generateKey(fn, args);
            const cached = this.get(key);

            if (cached !== null) {
                debug.log('🎯 Cache HIT:', key);
                return cached;
            }

            debug.log('❌ Cache MISS:', key);
            const result = fn(...args);
            this.set(key, result);
            return result;
        };
    }

    // Limpiar caché
    clear() {
        this._cache.clear();
        this._hits = 0;
        this._misses = 0;
    }

    // Invalidar por patrón
    invalidate(pattern) {
        const regex = new RegExp(pattern);
        const toDelete = [];

        this._cache.forEach((_, key) => {
            if (regex.test(key)) {
                toDelete.push(key);
            }
        });

        toDelete.forEach(key => this._cache.delete(key));
        debug.log(`🗑️ Invalidados ${toDelete.length} items de caché`);
    }

    // Estadísticas
    getStats() {
        const total = this._hits + this._misses;
        const hitRate = total > 0 ? (this._hits / total * 100).toFixed(2) : 0;

        return {
            size: this._cache.size,
            hits: this._hits,
            misses: this._misses,
            hitRate: `${hitRate}%`,
            maxSize: this._maxSize
        };
    }
}

// Instancia global de caché
const cacheService = new CacheService({
    ttl: 5 * 60 * 1000,  // 5 minutos
    maxSize: 100
});

// ============================================
// 🎭 CLASE RENDEROPTIMIZER (POO - Optimización de renders)
// ============================================
class RenderOptimizer {
    constructor() {
        this._renderQueue = [];
        this._rendering = false;
        this._lastRender = 0;
        this._minRenderInterval = 16; // ~60fps
        this._renderCount = 0;
    }

    // Encolar render
    scheduleRender(callback) {
        if (!this._renderQueue.includes(callback)) {
            this._renderQueue.push(callback);
        }

        this._processQueue();
    }

    // Procesar cola de renders
    _processQueue() {
        if (this._rendering) return;

        const now = Date.now();
        const timeSinceLastRender = now - this._lastRender;

        // Throttle renders (máximo 60fps)
        if (timeSinceLastRender < this._minRenderInterval) {
            setTimeout(() => this._processQueue(), this._minRenderInterval - timeSinceLastRender);
            return;
        }

        if (this._renderQueue.length === 0) return;

        this._rendering = true;
        this._lastRender = now;

        // Usar requestAnimationFrame para mejor performance
        requestAnimationFrame(() => {
            const callbacks = [...this._renderQueue];
            this._renderQueue = [];

            callbacks.forEach(callback => {
                try {
                    callback();
                    this._renderCount++;
                } catch (error) {
                    debug.error('❌ Error en render:', error);
                }
            });

            this._rendering = false;

            // Si hay más en cola, procesar
            if (this._renderQueue.length > 0) {
                this._processQueue();
            }
        });
    }

    // Debounce de render
    debounceRender(callback, delay = 300) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                this.scheduleRender(() => callback(...args));
            }, delay);
        };
    }

    // Throttle de render
    throttleRender(callback, limit = 100) {
        let inThrottle;
        return (...args) => {
            if (!inThrottle) {
                this.scheduleRender(() => callback(...args));
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // Estadísticas
    getStats() {
        return {
            queueLength: this._renderQueue.length,
            totalRenders: this._renderCount,
            lastRender: this._lastRender,
            rendering: this._rendering
        };
    }

    // Resetear contador
    resetStats() {
        this._renderCount = 0;
    }
}

// Instancia global
const renderOptimizer = new RenderOptimizer();

// ============================================
// 💾 CLASE MEMOCACHE (POO - Caché de resultados para optimización)
// ============================================
class MemoCache {
    constructor() {
        this.cache = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            size: 0
        };
    }

    // Obtener o generar valor
    get(key, generator, deps = []) {
        const depsKey = JSON.stringify(deps);
        const fullKey = `${key}::${depsKey}`;

        if (this.cache.has(fullKey)) {
            this.stats.hits++;
            console.log('💾 Cache HIT:', key);
            return this.cache.get(fullKey);
        }

        this.stats.misses++;
        console.log('🔄 Cache MISS, generando:', key);
        const result = generator();
        this.cache.set(fullKey, result);
        this.stats.size = this.cache.size;
        return result;
    }

    // Limpiar cache específico
    clear(prefix) {
        if (prefix) {
            let cleared = 0;
            for (let key of this.cache.keys()) {
                if (key.startsWith(prefix)) {
                    this.cache.delete(key);
                    cleared++;
                }
            }
            console.log(`🧹 Cache cleared: ${cleared} entries with prefix "${prefix}"`);
        } else {
            const size = this.cache.size;
            this.cache.clear();
            console.log(`🧹 Cache cleared: ${size} entries`);
        }
        this.stats.size = this.cache.size;
    }

    // Invalidar por patrón
    invalidate(pattern) {
        const regex = new RegExp(pattern);
        let invalidated = 0;
        for (let key of this.cache.keys()) {
            if (regex.test(key)) {
                this.cache.delete(key);
                invalidated++;
            }
        }
        console.log(`🗑️ Cache invalidated: ${invalidated} entries matching "${pattern}"`);
        this.stats.size = this.cache.size;
    }

    // Obtener estadísticas
    getStats() {
        const hitRate = this.stats.hits + this.stats.misses > 0
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
            : 0;

        return {
            ...this.stats,
            hitRate: `${hitRate}%`
        };
    }

    // Resetear estadísticas
    resetStats() {
        this.stats.hits = 0;
        this.stats.misses = 0;
    }
}

// Instancia global de cache
const memoCache = new MemoCache();

// ============================================
// 🎨 CLASE RENDERMANAGER (POO - Render selectivo por zona)
// ============================================
class RenderManager {
    constructor() {
        this.zones = new Map();
        this.renderCount = 0;
    }

    // Registrar una zona renderizable
    registerZone(zoneId, generator) {
        this.zones.set(zoneId, generator);
    }

    // Render selectivo de una zona específica
    renderZone(zoneId, data) {
        const element = document.getElementById(zoneId);
        if (!element) {
            console.warn('⚠️ Zone not found:', zoneId);
            return false;
        }

        const generator = this.zones.get(zoneId);
        if (!generator) {
            console.warn('⚠️ No generator for zone:', zoneId);
            return false;
        }

        try {
            perfMonitor.start(`renderZone:${zoneId}`);
            const html = typeof generator === 'function' ? generator(data) : generator;
            element.innerHTML = html;
            this.renderCount++;
            perfMonitor.end(`renderZone:${zoneId}`);
            console.log(`✅ Zone rendered: ${zoneId}`);
            return true;
        } catch (error) {
            console.error(`❌ Error rendering zone ${zoneId}:`, error);
            return false;
        }
    }

    // Render de múltiples zonas
    renderZones(zones) {
        const results = {};
        for (const [zoneId, data] of Object.entries(zones)) {
            results[zoneId] = this.renderZone(zoneId, data);
        }
        return results;
    }

    // Obtener estadísticas
    getStats() {
        return {
            registeredZones: this.zones.size,
            totalRenders: this.renderCount,
            zoneList: Array.from(this.zones.keys())
        };
    }
}

// Instancia global de render manager
const renderManager = new RenderManager();

// Función helper para render selectivo rápido
window.renderZone = function (zoneId, htmlOrGenerator) {
    const element = document.getElementById(zoneId);
    if (!element) {
        console.warn('⚠️ Zone not found:', zoneId);
        return false;
    }

    try {
        const html = typeof htmlOrGenerator === 'function'
            ? htmlOrGenerator()
            : htmlOrGenerator;
        element.innerHTML = html;
        console.log(`✅ Zone rendered: ${zoneId}`);
        return true;
    } catch (error) {
        console.error(`❌ Error rendering zone ${zoneId}:`, error);
        return false;
    }
};

// ============================================
// 📡 CLASE EVENTBUS (POO - Sistema de eventos desacoplado)
// ============================================
class EventBus {
    constructor() {
        this._events = new Map();
        this._eventHistory = [];
        this._maxHistory = 100;
    }

    // Suscribirse a evento
    on(eventName, callback, options = {}) {
        const { once = false, priority = 0 } = options;

        if (!this._events.has(eventName)) {
            this._events.set(eventName, []);
        }

        const listener = {
            callback,
            once,
            priority,
            id: Date.now() + Math.random()
        };

        const listeners = this._events.get(eventName);
        listeners.push(listener);

        // Ordenar por prioridad (mayor primero)
        listeners.sort((a, b) => b.priority - a.priority);

        // Retornar función para cancelar suscripción
        return () => this.off(eventName, listener.id);
    }

    // Suscribirse una sola vez
    once(eventName, callback, priority = 0) {
        return this.on(eventName, callback, { once: true, priority });
    }

    // Cancelar suscripción
    off(eventName, listenerId) {
        if (!this._events.has(eventName)) return;

        const listeners = this._events.get(eventName);
        const index = listeners.findIndex(l => l.id === listenerId);

        if (index !== -1) {
            listeners.splice(index, 1);
        }
    }

    // Emitir evento
    emit(eventName, data) {
        // Guardar en historial
        this._addToHistory(eventName, data);

        if (!this._events.has(eventName)) {
            debug.log(`📡 Evento '${eventName}' emitido sin listeners`);
            return;
        }

        const listeners = this._events.get(eventName);
        const toRemove = [];

        debug.log(`📡 Emitiendo evento '${eventName}' a ${listeners.length} listeners`);

        listeners.forEach(listener => {
            try {
                listener.callback(data);

                if (listener.once) {
                    toRemove.push(listener.id);
                }
            } catch (error) {
                debug.error(`❌ Error en listener de '${eventName}':`, error);
            }
        });

        // Eliminar listeners 'once'
        toRemove.forEach(id => this.off(eventName, id));
    }

    // Agregar al historial
    _addToHistory(eventName, data) {
        if (this._eventHistory.length >= this._maxHistory) {
            this._eventHistory.shift();
        }

        this._eventHistory.push({
            event: eventName,
            data,
            timestamp: Date.now()
        });
    }

    // Limpiar todos los eventos
    clear() {
        this._events.clear();
        debug.log('🗑️ EventBus limpiado');
    }

    // Obtener historial
    getHistory(limit = 10) {
        return this._eventHistory.slice(-limit);
    }

    // Estadísticas
    getStats() {
        const stats = {};
        this._events.forEach((listeners, event) => {
            stats[event] = listeners.length;
        });
        return stats;
    }
}

// Instancia global
const eventBus = new EventBus();

// ============================================
// 🔄 CLASE LAZYLOADER (POO - Lazy loading de recursos)
// ============================================
class LazyLoader {
    constructor() {
        this._loaded = new Set();
        this._loading = new Map();
        this._observers = new Map();
    }

    // Lazy load de imágenes
    lazyLoadImages(selector = 'img[data-src]') {
        const images = document.querySelectorAll(selector);

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        observer.unobserve(img);
                    }
                });
            });

            images.forEach(img => observer.observe(img));
            this._observers.set(selector, observer);
        } else {
            // Fallback para navegadores sin IntersectionObserver
            images.forEach(img => {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            });
        }
    }

    // Lazy load de componente
    async loadComponent(componentName, loader) {
        // Si ya está cargado, retornar
        if (this._loaded.has(componentName)) {
            debug.log(`✅ Componente '${componentName}' ya cargado`);
            return true;
        }

        // Si ya se está cargando, esperar
        if (this._loading.has(componentName)) {
            return this._loading.get(componentName);
        }

        // Cargar componente
        const loadPromise = (async () => {
            try {
                debug.log(`⏳ Cargando componente '${componentName}'...`);
                await loader();
                this._loaded.add(componentName);
                debug.log(`✅ Componente '${componentName}' cargado`);
                return true;
            } catch (error) {
                debug.error(`❌ Error cargando '${componentName}':`, error);
                return false;
            } finally {
                this._loading.delete(componentName);
            }
        })();

        this._loading.set(componentName, loadPromise);
        return loadPromise;
    }

    // Precargar recurso
    preload(url, type = 'script') {
        return new Promise((resolve, reject) => {
            if (this._loaded.has(url)) {
                resolve();
                return;
            }

            const element = type === 'script'
                ? document.createElement('script')
                : document.createElement('link');

            if (type === 'script') {
                element.src = url;
            } else {
                element.rel = 'stylesheet';
                element.href = url;
            }

            element.onload = () => {
                this._loaded.add(url);
                resolve();
            };

            element.onerror = reject;

            document.head.appendChild(element);
        });
    }

    // Cleanup observers
    cleanup() {
        this._observers.forEach(observer => observer.disconnect());
        this._observers.clear();
    }
}

// Instancia global
const lazyLoader = new LazyLoader();

// ============================================
// 📊 CLASE PERFORMANCEMONITOR (POO - Monitoreo de performance)
// ============================================
class PerformanceMonitor {
    constructor() {
        this._metrics = new Map();
        this._marks = new Map();
    }

    // Iniciar medición
    start(name) {
        this._marks.set(name, performance.now());
    }

    // Finalizar medición
    end(name) {
        const start = this._marks.get(name);
        if (!start) {
            debug.warn(`⚠️ No se encontró marca '${name}'`);
            return 0;
        }

        const duration = performance.now() - start;
        this._marks.delete(name);

        // Guardar métrica
        if (!this._metrics.has(name)) {
            this._metrics.set(name, []);
        }
        this._metrics.get(name).push(duration);

        debug.log(`⏱️ ${name}: ${duration.toFixed(2)}ms`);
        return duration;
    }

    // Medir función
    measure(name, fn) {
        this.start(name);
        const result = fn();
        this.end(name);
        return result;
    }

    // Medir función async
    async measureAsync(name, fn) {
        this.start(name);
        const result = await fn();
        this.end(name);
        return result;
    }

    // Obtener estadísticas
    getStats(name) {
        const measurements = this._metrics.get(name);
        if (!measurements || measurements.length === 0) {
            return null;
        }

        const sorted = [...measurements].sort((a, b) => a - b);
        const sum = measurements.reduce((a, b) => a + b, 0);

        return {
            count: measurements.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            avg: sum / measurements.length,
            median: sorted[Math.floor(sorted.length / 2)]
        };
    }

    // Reporte completo
    report() {
        const report = {};
        this._metrics.forEach((_, name) => {
            report[name] = this.getStats(name);
        });
        return report;
    }

    // Limpiar métricas
    clear() {
        this._metrics.clear();
        this._marks.clear();
    }
}

// Instancia global
const perfMonitor = new PerformanceMonitor();

// ============================================
// 🚀 FASE 5: COMPONENTES AVANZADOS
// ============================================


// ============================================
// 📡 CLASE SYNCMANAGER (POO - Sincronización local)
// ============================================
class SyncManager {
    constructor(indexedDB) {
        this.indexedDB = indexedDB;
        this.isPending = false;
    }

    // Agregar operación a cola
    async queueOperation(operation) {
        const queueItem = {
            type: operation.type,
            data: operation.data,
            status: 'pending',
            timestamp: Date.now(),
            retries: 0
        };

        await this.indexedDB.add('sync_queue', queueItem);
        this.isPending = true;

        debug.log('📝 Operación agregada a cola de sync');
        this.updateSyncBadge();
    }

    // Obtener operaciones pendientes
    async getPendingOperations() {
        return await this.indexedDB.query('sync_queue', 'status', 'pending');
    }

    // Procesar cola (versión local sin backend)
    async processPendingQueue() {
        const pending = await this.getPendingOperations();

        if (pending.length === 0) {
            Notification.info('ℹ️ No hay cambios pendientes');
            return;
        }

        debug.log(`🔄 Procesando ${pending.length} operaciones pendientes...`);

        let processed = 0;
        for (const item of pending) {
            try {
                // Procesar según tipo
                switch (item.type) {
                    case 'attendance:create':
                    case 'attendance:update':
                        await this.indexedDB.update('attendance', item.data);
                        break;
                    case 'employee:create':
                    case 'employee:update':
                        await this.indexedDB.update('employees', item.data);
                        break;
                    case 'position:create':
                    case 'position:update':
                        await this.indexedDB.update('positions', item.data);
                        break;
                }

                // Marcar como procesado
                await this.indexedDB.update('sync_queue', {
                    ...item,
                    status: 'synced',
                    syncedAt: Date.now()
                });

                processed++;
            } catch (error) {
                debug.error('❌ Error procesando operación:', error);

                // Marcar como fallida
                await this.indexedDB.update('sync_queue', {
                    ...item,
                    status: 'failed',
                    error: error.message,
                    retries: item.retries + 1
                });
            }
        }

        this.isPending = (await this.getPendingOperations()).length > 0;
        this.updateSyncBadge();

        Notification.success(`✅ ${processed} cambios procesados`);
    }

    // Actualizar badge de sincronización
    updateSyncBadge() {
        eventBus.emit('sync:update', {
            pending: this.isPending
        });
    }

    // Limpiar cola procesada
    async clearProcessed() {
        const synced = await this.indexedDB.query('sync_queue', 'status', 'synced');

        for (const item of synced) {
            await this.indexedDB.delete('sync_queue', item.id);
        }

        debug.log(`🗑️ ${synced.length} operaciones procesadas eliminadas`);
    }

    // Obtener estadísticas
    async getStats() {
        const all = await this.indexedDB.getAll('sync_queue');

        return {
            pending: all.filter(i => i.status === 'pending').length,
            synced: all.filter(i => i.status === 'synced').length,
            failed: all.filter(i => i.status === 'failed').length,
            total: all.length
        };
    }
}

// Instancia global
const syncManager = new SyncManager(indexedDBService);

// ============================================
// 🌐 CLASE OFFLINEMANAGER (POO - Gestión offline/online)
// ============================================
class OfflineManager {
    constructor() {
        this.online = navigator.onLine;
        this.setupListeners();
    }

    setupListeners() {
        window.addEventListener('online', () => {
            this.online = true;
            this.handleOnline();
        });

        window.addEventListener('offline', () => {
            this.online = false;
            this.handleOffline();
        });
    }

    handleOnline() {
        debug.log('🌐 Conexión restaurada');
        Notification.success('✅ Conexión restaurada', 3000);
        eventBus.emit('connection:online');
        this.hideBanner();
    }

    handleOffline() {
        debug.log('📵 Sin conexión');
        Notification.warning('⚠️ Sin conexión - Modo offline', 5000);
        eventBus.emit('connection:offline');
        this.showBanner();
    }

    isOnline() {
        return this.online;
    }

    isOffline() {
        return !this.online;
    }

    showBanner() {
        // El banner se renderiza en el header
        render();
    }

    hideBanner() {
        render();
    }

    getConnectionType() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        return connection ? connection.effectiveType : 'unknown';
    }
}

// Instancia global
const offlineManager = new OfflineManager();

// ============================================
// 🧵 CLASE WEBWORKERPOOL (POO - Workers inline)
// ============================================
class WebWorkerPool {
    constructor() {
        this.workers = new Map();
        this.tasks = this.defineTasksDefinitions();
    }

    // Definir tareas inline
    defineTasksDefinitions() {
        return {
            'calculateMonthlyStats': function (e) {
                const { attendance, employees, startDate, endDate } = e.data;

                const stats = {
                    totalDays: 0,
                    totalHours: 0,
                    totalOvertime: 0,
                    employeeStats: {}
                };

                // Calcular estadísticas por empleado
                employees.forEach(emp => {
                    const empAttendance = attendance.filter(a =>
                        a.employeeId === emp.id &&
                        a.date >= startDate &&
                        a.date <= endDate &&
                        a.present
                    );

                    stats.employeeStats[emp.id] = {
                        days: empAttendance.length,
                        hours: empAttendance.reduce((sum, a) => sum + (a.hoursWorked || 0), 0),
                        overtime: empAttendance.reduce((sum, a) => sum + (a.overtimeHours || 0), 0)
                    };

                    stats.totalDays += empAttendance.length;
                    stats.totalHours += stats.employeeStats[emp.id].hours;
                    stats.totalOvertime += stats.employeeStats[emp.id].overtime;
                });

                self.postMessage({ type: 'result', data: stats });
            },

            'generateReport': function (e) {
                const { employees, attendance, period } = e.data;

                const report = {
                    period: period,
                    generatedAt: new Date().toISOString(),
                    employees: []
                };

                employees.forEach(emp => {
                    const empAtt = attendance.filter(a => a.employeeId === emp.id && a.present);

                    report.employees.push({
                        id: emp.id,
                        name: emp.name,
                        number: emp.number,
                        totalDays: empAtt.length,
                        totalHours: empAtt.reduce((sum, a) => sum + (a.hoursWorked || 0), 0),
                        averageHours: empAtt.length > 0 ?
                            empAtt.reduce((sum, a) => sum + (a.hoursWorked || 0), 0) / empAtt.length : 0
                    });
                });

                self.postMessage({ type: 'result', data: report });
            }
        };
    }

    // Crear worker inline desde función
    createInlineWorker(taskFunction) {
        const code = `
                    self.onmessage = ${taskFunction.toString()};
                `;

        const blob = new Blob([code], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);

        return new Worker(url);
    }

    // Ejecutar tarea
    async execute(taskName, data) {
        const taskFunction = this.tasks[taskName];

        if (!taskFunction) {
            throw new Error(`Tarea '${taskName}' no encontrada`);
        }

        return new Promise((resolve, reject) => {
            const worker = this.createInlineWorker(taskFunction);

            const timeout = setTimeout(() => {
                worker.terminate();
                reject(new Error('Worker timeout'));
            }, 30000); // 30 segundos timeout

            worker.onmessage = (e) => {
                clearTimeout(timeout);
                if (e.data.type === 'result') {
                    resolve(e.data.data);
                }
                worker.terminate();
            };

            worker.onerror = (error) => {
                clearTimeout(timeout);
                worker.terminate();
                reject(error);
            };

            worker.postMessage(data);
        });
    }

    // Terminar todos los workers
    terminateAll() {
        this.workers.forEach(worker => worker.terminate());
        this.workers.clear();
    }
}

// Instancia global
const webWorkerPool = new WebWorkerPool();

// ============================================
// 📜 CLASE VIRTUALSCROLLCOMPONENT (POO - Scroll virtual)
// ============================================
class VirtualScrollComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: { items, itemHeight, containerHeight, renderItem, buffer }
        this.scrollTop = 0;
        this.container = null;
    }

    calculateVisibleRange() {
        const { items, itemHeight, containerHeight, buffer = 5 } = this.props;

        if (!items || items.length === 0) {
            return { start: 0, end: 0, offsetY: 0 };
        }

        const visibleCount = Math.ceil(containerHeight / itemHeight);
        const startIndex = Math.floor(this.scrollTop / itemHeight);
        const endIndex = startIndex + visibleCount;

        return {
            start: Math.max(0, startIndex - buffer),
            end: Math.min(items.length, endIndex + buffer),
            offsetY: Math.max(0, startIndex - buffer) * itemHeight
        };
    }

    handleScroll(event) {
        this.scrollTop = event.target.scrollTop;
        this.updateVisibleItems();
    }

    updateVisibleItems() {
        if (!this.container) return;

        const { items, renderItem } = this.props;
        const { start, end, offsetY } = this.calculateVisibleRange();

        const visibleItems = items.slice(start, end);
        const content = this.container.querySelector('.virtual-scroll-content');

        if (content) {
            content.innerHTML = visibleItems.map(item => renderItem(item)).join('');
            content.style.transform = `translateY(${offsetY}px)`;
        }
    }

    render() {
        const { items = [], itemHeight, containerHeight } = this.props;
        const totalHeight = items.length * itemHeight;
        const { start, end, offsetY } = this.calculateVisibleRange();
        const visibleItems = items.slice(start, end);

        const id = `virtual-scroll-${Date.now()}`;

        // Guardar referencia después del render
        setTimeout(() => {
            this.container = document.getElementById(id);
            if (this.container) {
                this.container.addEventListener('scroll', (e) => this.handleScroll(e));
            }
        }, 0);

        return `
                    <div id="${id}" class="virtual-scroll-container" 
                         style="height: ${containerHeight}px; overflow-y: auto;">
                        <div class="virtual-scroll-spacer" style="height: ${totalHeight}px; position: relative;">
                            <div class="virtual-scroll-content" style="transform: translateY(${offsetY}px);">
                                ${visibleItems.map(item => this.props.renderItem(item)).join('')}
                            </div>
                        </div>
                    </div>
                `;
    }
}

// ============================================
// 📱 CLASE INSTALLPROMPTMANAGER (POO - PWA Install)
// ============================================
class InstallPromptManager {
    constructor() {
        this.deferredPrompt = null;
        this.isInstalled = false;
        this.setupListeners();
    }

    setupListeners() {
        // Capturar evento de instalación
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            debug.log('📱 Install prompt disponible');
            eventBus.emit('install:available');
        });

        // Detectar cuando se instala
        window.addEventListener('appinstalled', () => {
            this.isInstalled = true;
            this.deferredPrompt = null;
            debug.log('✅ App instalada');
            Notification.success('✅ App instalada correctamente');
            eventBus.emit('install:completed');
        });
    }

    canInstall() {
        return this.deferredPrompt !== null;
    }

    async install() {
        if (!this.deferredPrompt) {
            Notification.warning('⚠️ La app ya está instalada o no está disponible para instalación');
            return false;
        }

        try {
            // Mostrar prompt
            this.deferredPrompt.prompt();

            // Esperar respuesta del usuario
            const { outcome } = await this.deferredPrompt.userChoice;

            if (outcome === 'accepted') {
                debug.log('✅ Usuario aceptó instalación');
                return true;
            } else {
                debug.log('❌ Usuario rechazó instalación');
                Notification.info('ℹ️ Instalación cancelada');
                return false;
            }
        } catch (error) {
            debug.error('❌ Error en instalación:', error);
            Notification.error('❌ Error al instalar');
            return false;
        } finally {
            this.deferredPrompt = null;
        }
    }

    // Generar banner de instalación
    renderInstallBanner() {
        if (!this.canInstall()) return '';

        return `
                    <div class="install-banner" style="
                        position: fixed;
                        bottom: 20px;
                        left: 50%;
                        transform: translateX(-50%);
                        background: linear-gradient(135deg, #06b6d4, #0891b2);
                        color: white;
                        padding: 16px 24px;
                        border-radius: 12px;
                        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                        display: flex;
                        align-items: center;
                        gap: 16px;
                        z-index: 9999;
                        animation: slideUp 0.3s ease-out;">
                        <div style="font-size: 2rem;">📱</div>
                        <div>
                            <div style="font-weight: 700; margin-bottom: 4px;">
                                Instalar Aplicación
                            </div>
                            <div style="font-size: 0.875rem; opacity: 0.9;">
                                Acceso rápido desde tu pantalla de inicio
                            </div>
                        </div>
                        <button onclick="installPrompt.install()" 
                                style="background: white; color: #0891b2; border: none; 
                                       padding: 8px 16px; border-radius: 8px; font-weight: 600;
                                       cursor: pointer;">
                            Instalar
                        </button>
                        <button onclick="installPrompt.dismissBanner()" 
                                style="background: transparent; color: white; border: 1px solid white;
                                       padding: 8px; border-radius: 8px; cursor: pointer;
                                       width: 32px; height: 32px;">
                            ✕
                        </button>
                    </div>
                `;
    }

    dismissBanner() {
        this.deferredPrompt = null;
        render();
    }
}

// Instancia global
const installPrompt = new InstallPromptManager();

// ============================================
// 📤 CLASE EXPORTSERVICE (POO - Exportación avanzada)
// ============================================
class ExportService {
    constructor() {
        this.exportWorker = null;
    }

    // Crear worker inline para exportación
    createExportWorker() {
        const workerCode = `
                    self.onmessage = (e) => {
                        const { type, data } = e.data;
                        
                        if (type === 'csv') {
                            const csv = convertToCSV(data);
                            self.postMessage({ type: 'csv', data: csv });
                        }
                        
                        if (type === 'json') {
                            const json = JSON.stringify(data, null, 2);
                            self.postMessage({ type: 'json', data: json });
                        }
                    };
                    
                    function convertToCSV(data) {
                        if (!data || data.length === 0) return '';
                        
                        const headers = Object.keys(data[0]);
                        const csvHeaders = headers.join(',');
                        
                        const rows = data.map(row => {
                            return headers.map(header => {
                                let value = row[header];
                                
                                // Escapar valores con comas o comillas
                                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                                    value = '"' + value.replace(/"/g, '""') + '"';
                                }
                                
                                return value;
                            }).join(',');
                        });
                        
                        return [csvHeaders, ...rows].join('\\n');
                    }
                `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(blob));
    }

    // Exportar a CSV
    async exportToCSV(data, filename = 'export.csv') {
        return new Promise((resolve, reject) => {
            if (!this.exportWorker) {
                this.exportWorker = this.createExportWorker();
            }

            this.exportWorker.onmessage = (e) => {
                if (e.data.type === 'csv') {
                    const blob = new Blob([e.data.data], { type: 'text/csv;charset=utf-8;' });
                    this.downloadBlob(blob, filename);
                    resolve();
                }
            };

            this.exportWorker.onerror = (error) => {
                reject(error);
            };

            this.exportWorker.postMessage({ type: 'csv', data });
        });
    }

    // Exportar a JSON
    async exportToJSON(data, filename = 'export.json') {
        return new Promise((resolve, reject) => {
            if (!this.exportWorker) {
                this.exportWorker = this.createExportWorker();
            }

            this.exportWorker.onmessage = (e) => {
                if (e.data.type === 'json') {
                    const blob = new Blob([e.data.data], { type: 'application/json' });
                    this.downloadBlob(blob, filename);
                    resolve();
                }
            };

            this.exportWorker.onerror = (error) => {
                reject(error);
            };

            this.exportWorker.postMessage({ type: 'json', data });
        });
    }

    // Descargar blob
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Exportar asistencia del mes
    async exportMonthlyAttendance(year, month) {
        try {
            // Obtener datos
            const employees = await indexedDBService.getAll('employees');
            const attendance = await indexedDBService.getAll('attendance');

            // Filtrar por mes
            const monthlyData = attendance.filter(a => {
                const date = new Date(a.date);
                return date.getFullYear() === year && date.getMonth() === month;
            });

            // Preparar datos para export
            const exportData = monthlyData.map(a => {
                const emp = employees.find(e => e.id === a.employeeId);
                return {
                    Fecha: a.date,
                    Empleado: emp ? emp.name : a.employeeId,
                    Numero: emp ? emp.number : '',
                    Horas: a.hoursWorked || 0,
                    HorasExtra: a.overtimeHours || 0,
                    Festivo: a.isHoliday ? 'Sí' : 'No',
                    Notas: a.notes || ''
                };
            });

            // Exportar
            const filename = `asistencia-${year}-${String(month + 1).padStart(2, '0')}.csv`;
            await this.exportToCSV(exportData, filename);

            Notification.success(`✅ Exportado: ${filename}`);
        } catch (error) {
            debug.error('❌ Error al exportar:', error);
            Notification.error('❌ Error al exportar datos');
        }
    }

    // Share API (si está disponible)
    async shareFile(blob, title, filename) {
        if (!navigator.share || !navigator.canShare) {
            Notification.info('ℹ️ Share no disponible, descargando...');
            this.downloadBlob(blob, filename);
            return false;
        }

        try {
            const file = new File([blob], filename, { type: blob.type });

            if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: title,
                    files: [file]
                });

                Notification.success('✅ Archivo compartido');
                return true;
            } else {
                this.downloadBlob(blob, filename);
                return false;
            }
        } catch (error) {
            debug.error('❌ Error al compartir:', error);
            this.downloadBlob(blob, filename);
            return false;
        }
    }
}

// Instancia global
const exportService = new ExportService();

// ============================================
// FUNCIONES DE COMPATIBILIDAD (usan el manager)
// ============================================
window.openMultiPositionModalFromContext = function () {
    modalManager.openFromContext();
};

// Agregar posición al modal
window.addPositionHours = function () {
    const emp = state.selectedEmployee;
    if (!emp) return;

    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    let att = state.attendance[key] || {};

    // Inicializar positionHours si no existe
    if (!att.positionHours) {
        att.positionHours = [];
    }

    // Encontrar posición no usada
    const usedPositions = att.positionHours.map(ph => ph.positionId);
    const availablePosition = emp.positions.find(pid => !usedPositions.includes(pid));

    if (availablePosition) {
        att.positionHours.push({
            positionId: availablePosition,
            hours: 0,
            overtimeHours: 0
        });

        state.attendance[key] = att;
        att.updatedAt = Date.now();
        att._isDirty = true;
        render();

        // Actualizar totales después de render
        setTimeout(updateTotalsDisplay, 100);
    }
};

// Remover posición del modal
// Actualizar horas de una posición específica
window.updatePositionHours = function (index, field, value) {
    const emp = state.selectedEmployee;
    if (!emp) return;

    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];

    if (att && att.positionHours && att.positionHours[index]) {
        att.positionHours[index][field] = parseFloat(value) || 0;
        att._isDirty = true;
        att.updatedAt = Date.now();

        // Actualizar totales visuales
        updateTotalsDisplay();
    }
};

// Actualizar display de totales en tiempo real
window.updateTotalsDisplay = function () {
    const emp = state.selectedEmployee;
    if (!emp) return;

    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];

    if (att && att.positionHours && att.positionHours.length > 0) {
        const totalH = att.positionHours.reduce((sum, ph) => sum + (parseFloat(ph.hours) || 0), 0);
        const totalO = att.positionHours.reduce((sum, ph) => sum + (parseFloat(ph.overtimeHours) || 0), 0);

        const displayH = document.getElementById('totalHoursDisplay');
        const displayO = document.getElementById('totalOvertimeDisplay');

        if (displayH) displayH.textContent = totalH + 'h';
        if (displayO) displayO.textContent = totalO + 'h';
    }
};

// Guardar distribución multi-posición
window.saveMultiPosition = function () {
    const emp = state.selectedEmployee;
    if (!emp) return;

    // ─── SNAPSHOT antes de mutar (para undo) ───
    const mpKey = `${emp.id}-${getDateKey(state.selectedDate)}`;
    const previousMpAtt = state.attendance[mpKey]
        ? { ...state.attendance[mpKey], positionHours: [...(state.attendance[mpKey].positionHours || [])] }
        : null;

    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    let att = state.attendance[key] || {
        employeeId: emp.id,
        date: getDateKey(state.selectedDate),
        present: true,
        multiPosition: false,
        positionHours: []
    };

    // Leer valores del formulario
    const notesInput = document.getElementById('attendanceNotes');
    const isHolidayInput = document.getElementById('isHolidayCheck');
    const simpleHoursInput = document.getElementById('simpleHours');
    const simpleOvertimeInput = document.getElementById('simpleOvertimeHours');

    // Guardar notas y festivo
    att.notes = notesInput ? notesInput.value.trim() : '';
    att.isHoliday = isHolidayInput ? isHolidayInput.checked : false;

    // Si usa distribución multi-posición
    if (att.positionHours && att.positionHours.length > 0) {
        // Calcular totales
        const totalHours = att.positionHours.reduce((sum, ph) => sum + (parseFloat(ph.hours) || 0), 0);
        const totalOvertime = att.positionHours.reduce((sum, ph) => sum + (parseFloat(ph.overtimeHours) || 0), 0);

        if (totalHours === 0) {
            alert('❌ Debes asignar al menos 1 hora');
            return;
        }

        // Actualizar registro
        att.multiPosition = att.positionHours.length > 1;
        att.hoursWorked = totalHours;
        att.overtimeHours = totalOvertime;
        att.present = true;

        // Si solo hay una posición, usar selectedPosition
        if (att.positionHours.length === 1) {
            att.selectedPosition = att.positionHours[0].positionId;
            att.multiPosition = false;
        }
    } else {
        // Modo simple (sin distribución)
        const hours = parseFloat(simpleHoursInput?.value) || 0;
        const overtime = parseFloat(simpleOvertimeInput?.value) || 0;

        if (hours === 0) {
            alert('❌ Debes asignar al menos 1 hora');
            return;
        }

        att.hoursWorked = hours;
        att.overtimeHours = overtime;
        att.multiPosition = false;
        att.selectedPosition = emp.positions?.[0] || null;
        att.positionHours = [];
    }

    // Guardar en state
    state.attendance[key] = att;
    att.updatedAt = Date.now();

    // ─── Registrar Undo: restaurar estado previo de multi-posición ───
    UndoManager.push(
        previousMpAtt,
        `Multi-posición de ${emp.name}`,
        () => {
            if (previousMpAtt) {
                state.attendance[mpKey] = previousMpAtt;
            } else {
                delete state.attendance[mpKey];
            }
        }
    );

    closeModal();
};

// Eliminar asistencia actual
window.deleteCurrentAttendance = function () {
    const emp = state.selectedEmployee;
    if (!emp) return;

    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;

    // ─── SNAPSHOT antes de eliminar ───
    const previousAtt = state.attendance[key]
        ? { ...state.attendance[key], positionHours: [...(state.attendance[key].positionHours || [])] }
        : null;

    // Eliminar directamente — sin confirm(). El botón Deshacer es el safety net.
    delete state.attendance[key];

    // ─── Registrar Undo ───
    UndoManager.push(
        previousAtt,
        `Eliminación de ${emp.name}`,
        () => { if (previousAtt) state.attendance[key] = previousAtt; }
    );

    saveApplicationData();
    closeModal();
    render();
};

// Remover posición del modal
window.removePositionHours = function (index) {
    const emp = state.selectedEmployee;
    if (!emp) return;

    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];

    if (att && att.positionHours) {
        att.positionHours.splice(index, 1);

        // Si no quedan posiciones, eliminar toda la asistencia
        if (att.positionHours.length === 0) {
            const confirmDelete = confirm('No quedan posiciones asignadas. ¿Eliminar la asistencia completa?');
            if (confirmDelete) {
                delete state.attendance[key];
                closeModal();
                render();
                return;
            }
        }

        render();

        // Actualizar totales
        setTimeout(updateTotalsDisplay, 100);
    }
};

// ========================================
// LOCALSTORAGE - PERSISTENCIA DE DATOS
// ========================================

async function saveToIndexedDB() {
    try {
        // Guardar empleados
        for (const emp of state.employees) {
            await indexedDBService.update('employees', emp);
        }

        // Guardar posiciones
        for (const pos of state.positions) {
            await indexedDBService.update('positions', pos);
        }

        // Guardar líderes
        for (const leader of state.leaders) {
            await indexedDBService.update('leaders', leader);
        }

        // Guardar asistencia
        const attRecords = Object.entries(state.attendance).map(([key, value]) => ({
            key,
            ...value
        }));

        for (const att of attRecords) {
            await indexedDBService.update('attendance', att);
        }

        // Guardar settings
        await indexedDBService.update('settings', {
            key: 'app',
            ...state.settings
        });

        debug.log('💾 Datos guardados en IndexedDB');
        return true;
    } catch (error) {
        debug.error('❌ Error guardando en IndexedDB:', error);
        throw error; // Re-lanzar para que saveApplicationData lo vea
    }
}

async function saveApplicationData() {
    if (window._isSavingData) return;
    window._isSavingData = true;
    if (!state.isDataLoaded) {
        console.warn('⚠️ Intento de guardado ignorado: los datos aún no se han cargado completamente.');
        return;
    }
    console.log('🔵 saveApplicationData() iniciado');

    // Auto-sync de Supabase si aplica
    supabaseService.handleAutoSync();
    // ═══════════════════════════════════════════════════════════

    if (state.useIndexedDB) {
        console.log('💾 Guardando en IndexedDB...');
        try {
            await saveToIndexedDB();
        } catch (error) {
            console.error('❌ Error guardando en IndexedDB:', error);
            
            // 🛰️ Manejo de conflictos de sincronización (ConstraintError)
            if (error.name === 'ConstraintError' || error.message.includes('ConstraintError')) {
                console.warn('⚡ Conflicto de integridad detectado. Abriendo gestor de conflictos...');
                new SyncConflictModal({
                    error: error.message,
                    supabaseService: supabaseService,
                    onResolved: (type) => {
                        console.log(`✅ Conflicto resuelto via: ${type}`);
                        showNotification('✅ Sincronización re-establecida', 'success');
                        render();
                    }
                }).open();
            } else {
                // Fallback a localStorage si dataService existe
                if (typeof dataService !== 'undefined') {
                    dataService.saveAll();
                }
                showNotification('❌ Error al guardar datos localmente', 'error');
            }
        }
    } else {
        // ✅ Usar DataService POO (localStorage)
        if (typeof dataService !== 'undefined') {
            dataService.saveAll();
        }
    }

    // 🔄 Auto-backup para Canvas de Claude (localStorage no persiste)
    if (state.autoBackupEnabled) {
        createAutoBackup();
    }

    // ⚡ Invalidar caché al guardar datos
    cacheService.invalidate('.*'); // Invalidar todo el caché

    // 📡 Emitir evento de guardado
    eventBus.emit('data:saved', {
        timestamp: Date.now()
    });

    window._isSavingData = false;
}

/**
 * 🔄 REGENERACIÓN DE IDs PARA CLONADO
 * Genera nuevos UUIDs para todos los datos locales para poder 
 * subirlos a una cuenta nueva de Supabase sin conflictos de Primary Key.
 */
async function prepareDataForNewAccount() {
    console.log('🔄 Iniciando regeneración de IDs para nueva cuenta...');
    
    // 0. Limpiar IndexedDB para evitar conflictos de índices únicos (ConstraintError)
    try {
        await indexedDBService.clear('leaders');
        await indexedDBService.clear('positions');
        await indexedDBService.clear('employees');
        await indexedDBService.clear('attendance');
        await indexedDBService.clear('settings');
        await indexedDBService.clear('sync_queue');
        console.log('🧹 Almacenes de IndexedDB limpiados');
    } catch (clearError) {
        console.warn('⚠️ Error limpiando stores (posiblemente vacíos):', clearError);
    }

    const idMap = new Map();
    const now = Date.now();

    // 1. Líderes
    state.leaders.forEach(l => {
        const oldId = l.id;
        l.id = generateUUID();
        l.updatedAt = now;
        idMap.set(oldId, l.id);
    });

    // 2. Posiciones
    state.positions.forEach(p => {
        const oldId = p.id;
        p.id = generateUUID();
        p.updatedAt = now;
        if (p.leaderId && idMap.has(p.leaderId)) {
            p.leaderId = idMap.get(p.leaderId);
        }
        idMap.set(oldId, p.id);
    });

    // 3. Empleados
    state.employees.forEach(e => {
        const oldId = e.id;
        e.id = generateUUID();
        e.updatedAt = now;
        if (e.positions) {
            e.positions = e.positions.map(pid => idMap.has(pid) ? idMap.get(pid) : pid);
        }
        idMap.set(oldId, e.id);
    });

    // 4. Asistencia
    const newAttendance = {};
    Object.entries(state.attendance).forEach(([oldKey, att]) => {
        const oldEmpId = att.employeeId || oldKey.split('-')[0];
        const newEmpId = idMap.get(oldEmpId) || oldEmpId;
        const newKey = `${newEmpId}-${att.date}`;
        
        att.id = generateUUID();
        att.employeeId = newEmpId;
        att.updatedAt = now;
        if (att.selectedPosition && idMap.has(att.selectedPosition)) {
            att.selectedPosition = idMap.get(att.selectedPosition);
        }
        if (att.positionHours) {
            att.positionHours.forEach(ph => {
                if (idMap.has(ph.positionId)) ph.positionId = idMap.get(ph.positionId);
            });
        }
        newAttendance[newKey] = att;
    });
    state.attendance = newAttendance;

    // 5. Guardar localmente
    await saveApplicationData();
    console.log('✅ IDs regenerados exitosamente');
    return true;
}

// Alias para compatibilidad
window.saveToLocalStorage = saveApplicationData;
window.prepareDataForNewAccount = prepareDataForNewAccount;

// Sistema de auto-backup para Canvas de Claude
function createAutoBackup() {
    try {
        const backupData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            data: {
                employees: state.employees,
                positions: state.positions,
                leaders: state.leaders,
                attendance: state.attendance,
                settings: state.settings
            }
        };

        // Guardar en sessionStorage (persiste mientras esté abierto)
        sessionStorage.setItem('attendance-backup', JSON.stringify(backupData));

        debug.log('💾 Auto-backup creado');
    } catch (error) {
        debug.error('❌ Error en auto-backup:', error);
    }
}

// Recuperar auto-backup al cargar
function restoreAutoBackup() {
    try {
        const backup = sessionStorage.getItem('attendance-backup');
        if (backup) {
            const parsed = JSON.parse(backup);

            if (parsed.data) {
                // Solo restaurar si no hay datos en localStorage
                const hasData = state.employees.length > 0 ||
                    state.positions.length > 0;

                if (!hasData) {
                    state.employees = parsed.data.employees || [];
                    state.positions = parsed.data.positions || [];
                    state.leaders = parsed.data.leaders || [];
                    state.attendance = parsed.data.attendance || {};

                    if (parsed.data.settings) {
                        Object.assign(state.settings, parsed.data.settings);
                    }

                    debug.log('✅ Datos restaurados desde auto-backup');
                    Notification.success('✅ Sesión anterior restaurada');
                    return true;
                }
            }
        }
    } catch (error) {
        debug.error('❌ Error restaurando backup:', error);
    }
    return false;
}

async function loadFromIndexedDB() {
    try {
        // Cargar empleados
        const employees = await indexedDBService.getAll('employees');
        if (employees.length > 0) {
            state.employees = employees.map(e => new Employee(e));
        }

        // Cargar posiciones
        const positions = await indexedDBService.getAll('positions');
        if (positions.length > 0) {
            state.positions = positions.map(p => new Position(p));
        }

        // Cargar líderes
        const leaders = await indexedDBService.getAll('leaders');
        if (leaders.length > 0) {
            state.leaders = leaders.map(l => new Leader(l));
        }

        // Cargar asistencia
        const attendance = await indexedDBService.getAll('attendance');
        state.attendance = {};
        attendance.forEach(att => {
            const { key, ...data } = att;
            state.attendance[key] = data;
        });

        // Cargar settings
        const settings = await indexedDBService.get('settings', 'app');
        if (settings) {
            const { key, ...settingsData } = settings;
            Object.assign(state.settings, settingsData);
        }

        debug.log('✅ Datos cargados desde IndexedDB');
        return true;
    } catch (error) {
        debug.error('❌ Error cargando desde IndexedDB:', error);
        return false;
    }
}

async function loadApplicationData() {
    console.log('🔵 loadApplicationData() iniciado');

    try {
        // 1. Intentar cargar desde IndexedDB si está activo
        if (state.useIndexedDB) {
            console.log('📦 Intentando cargar desde IndexedDB...');
            const idbSuccess = await loadFromIndexedDB();
            
            if (idbSuccess && state.employees.length > 0) {
                console.log('✅ Datos cargados desde IndexedDB');
                state.isDataLoaded = true;
                return true;
            }
            
            console.log('ℹ️ IndexedDB está vacío, verificando migración desde localStorage...');
        }

        // 2. Fallback o Migración desde localStorage
        const savedData = localStorage.getItem('asistencia-data');
        const hasBeenMigrated = localStorage.getItem('migrated-to-idb') === 'true';

        if (savedData && !hasBeenMigrated) {
            console.log('🚀 Iniciando migración de localStorage a IndexedDB...');
            
            // Cargar datos actuales de localStorage
            const result = dataService.loadAll();
            
            if (result) {
                console.log('✅ Datos cargados de localStorage para migración');
                
                // Si IndexedDB está activo, guardar inmediatamente
                if (state.useIndexedDB) {
                    await saveToIndexedDB();
                    localStorage.setItem('migrated-to-idb', 'true');
                    console.log('✅ Migración a IndexedDB completada con éxito');
                }
                state.isDataLoaded = true;
                return true;
            }
        } else if (savedData && hasBeenMigrated) {
            // Ya fue migrado pero por alguna razón IDB falló o está vacío
            console.warn('⚠️ Datos ya migrados pero no encontrados en IDB. Usando localStorage como backup.');
            const success = dataService.loadAll();
            state.isDataLoaded = true;
            return success;
        }

        console.log('ℹ️ No hay datos guardados para cargar');
        state.isDataLoaded = true; // No hay datos, pero ya terminamos de "cargar"
        return false;

    } catch (error) {
        console.error('❌ Error al cargar datos:', error);
        state.isDataLoaded = true; // Evitar bloquear para siempre en caso de error
        return false;
    }
}

// Alias para compatibilidad
window.loadFromLocalStorage = loadApplicationData;

function exportDataToJSON() {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `asistencia-backup-${getDateKey(new Date())}.json`;
    link.click();

    console.log('📥 Datos exportados');
}

function clearAllData() {
    const confirmed = confirm(
        '⚠️ ADVERTENCIA\n\n' +
        'Esto borrará TODOS los datos de la aplicación:\n' +
        '• Empleados\n' +
        '• Asistencias\n' +
        '• Posiciones\n' +
        '• Configuración\n\n' +
        '¿Estás seguro? Esta acción NO se puede deshacer.'
    );

    if (confirmed) {
        const doubleConfirm = prompt('Escribe "BORRAR" para confirmar:');

        if (doubleConfirm === 'BORRAR') {
            localStorage.clear();
            location.reload();
        }
    }
}

// Funciones globales de utilidad
window.exportData = exportDataToJSON;
window.clearData = clearAllData;


function getWeekOfMonth(date) {
    const d = new Date(date);
    const firstDayOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    const firstSunday = new Date(firstDayOfMonth);
    const dayOfWeek = firstDayOfMonth.getDay();
    firstSunday.setDate(firstDayOfMonth.getDate() - dayOfWeek);

    const weekDates = getWeekDates(d);
    const sunday = weekDates[0];

    const diffTime = sunday.getTime() - firstSunday.getTime();
    const diffWeeks = Math.floor(diffTime / (7 * 24 * 60 * 60 * 1000));
    const weekNumber = diffWeeks + 1;

    return weekNumber;
}

function getWeekRangeText(date) {
    const weekDates = getWeekDates(date);
    const firstDay = weekDates[0];
    const lastDay = weekDates[6];

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const firstMonth = monthNames[firstDay.getMonth()];
    const lastMonth = monthNames[lastDay.getMonth()];
    const year = lastDay.getFullYear();

    // Si la semana está en el mismo mes
    if (firstDay.getMonth() === lastDay.getMonth()) {
        const weekNum = getWeekOfMonth(date);
        const weekText = weekNum === 1 ? 'Primera' :
            weekNum === 2 ? 'Segunda' :
                weekNum === 3 ? 'Tercera' :
                    weekNum === 4 ? 'Cuarta' :
                        weekNum === 5 ? 'Quinta' :
                            `${weekNum}ª`;
        return `${weekText} semana de ${firstMonth} ${year}`;
    } else {
        // Si la semana cruza meses
        return `${firstDay.getDate()} ${firstMonth} - ${lastDay.getDate()} ${lastMonth} ${year}`;
    }
}

// ========================================
// FUNCIONES DE CÁLCULO DE SUELDO
// ========================================


function getCheckColor(att, date) {
    if (!att || !att.present) return '';

    // ⚡ PRIORIDAD 1: Multi-posición (MORADO) - Se sobrepone a TODO
    // Solo si trabajó en 2+ posiciones ESE DÍA específicamente
    if (att.positionHours && att.positionHours.length > 1) {
        return 'check-multiposition';  // 🟣 MORADO
    }

    // ⚡ IMPORTANTE: Verificar SOLO configuración actual, no valor histórico
    // Esto permite que al quitar un festivo, los checks cambien de color inmediatamente

    // PRIORIDAD 2: Día festivo (DORADO)
    // Solo verifica isDayHoliday(date) - configuración ACTUAL
    if (isDayHoliday(date)) return 'check-holiday';

    // PRIORIDAD 3-5: Horas trabajadas
    // ✅ Agregar tolerancia de 6 minutos (0.1 horas)
    const tolerance = 0.1;
    const hours = att.hoursWorked || 0;
    const regular = state.settings.regularHoursPerDay;

    if (hours > regular + tolerance) return 'check-overtime';   // Azul (más horas)
    if (hours < regular - tolerance) return 'check-undertime';  // Rosa (menos horas)
    return 'check-regular';  // Verde (horas normales)
}
function getWeekDates(date) {
    // ✅ Convertir string a Date si es necesario
    const d = typeof date === 'string' ? parseDate(date) : date;
    const dayOfWeek = d.getDay();
    const diff = d.getDate() - dayOfWeek;
    const sunday = new Date(d); // ✅ Crear copia primero
    sunday.setDate(diff); // ✅ Modificar solo la copia
    const week = [];
    for (let i = 0; i < 7; i++) {
        const weekDay = new Date(sunday);
        weekDay.setDate(sunday.getDate() + i);
        week.push(weekDay);
    }
    return week;
}
// ⚡ Versión original (sin caché)
function _calculateStatsOriginal() {
    const dateKey = getDateKey(state.selectedDate);
    const todayAtt = Object.values(state.attendance).filter(a => a.date === dateKey);
    const present = todayAtt.filter(a => a.present).length;
    const activeEmps = state.employees.filter(e => e.active).length;
    const absent = activeEmps - present;
    const totalHours = todayAtt.reduce((sum, a) => sum + (a.present ? a.hoursWorked : 0), 0);
    const overtimeHours = todayAtt.reduce((sum, a) => {
        if (!a.present) return sum;
        return sum + Math.max(0, a.hoursWorked - state.settings.regularHoursPerDay);
    }, 0);
    return { present, absent, totalHours, overtimeHours };
}

// ⚡ Versión optimizada con caché
const calculateStats = cacheService.memoize(_calculateStatsOriginal);

// ⚡ Versión original de getEmployeeTotalHours
function _getEmployeeTotalHoursOriginal(empId, start, end) {
    let total = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = `${empId}-${getDateKey(new Date(d))}`;
        const att = state.attendance[key];
        if (att && att.present) total += att.hoursWorked;
    }
    return total;
}

// ⚡ Versión optimizada con caché
const getEmployeeTotalHours = cacheService.memoize(_getEmployeeTotalHoursOriginal);

// ⚡ NUEVO: Calcular nómina completa de un empleado en un período

function getDaysInMonth(date) {
    const y = date.getFullYear(), m = date.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const days = [];
    const start = first.getDay();
    for (let i = 0; i < start; i++) days.push({ date: new Date(y, m, -start + i + 1), currentMonth: false });
    for (let i = 1; i <= last.getDate(); i++) days.push({ date: new Date(y, m, i), currentMonth: true });
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) days.push({ date: new Date(y, m + 1, i), currentMonth: false });
    return days;
}

// Event Handlers
window.changeTab = (tab) => {
    state.activeTab = tab;
    render();

    // Si se abre settings y está usando IndexedDB, actualizar estadísticas
    if (tab === 'settings' && state.useIndexedDB) {
        setTimeout(() => {
            updateIndexedDBStats();
        }, 100);
    }

    // Si se abre settings, actualizar estado del botón de instalación PWA
    if (tab === 'settings') {
        setTimeout(() => {
            updateInstallPWAButton();
        }, 100);
    }

    // ⚡ NUEVO: Si se abre settings, actualizar dashboard de sincronización
    if (tab === 'settings') {
        setTimeout(async () => {
            await updateSyncStatus();
            render(); // Re-renderizar para mostrar stats actualizadas
        }, 100);
    }
};

// ⚡ NUEVO: Cambiar pestaña de configuración
window.changeSettingsTab = (tab) => {
    state.settingsActiveTab = tab;
    render();
};

window.changeDate = (days) => {
    // Si estamos en vista semanal, cambiar por semanas completas (7 días)
    if (state.viewMode === 'week') {
        state.selectedDate = DateUtils.addDays(state.selectedDate, days * 7);
    } else {
        state.selectedDate = DateUtils.addDays(state.selectedDate, days);
    }

    // ✅ Guardar cambios
    saveApplicationData();

    render();
};

window.goToToday = () => {
    state.selectedDate = DateUtils.today();
    state.today = DateUtils.today(); // Actualizar today también

    // ✅ Guardar cambios
    saveApplicationData();

    render();
};

window.changeViewMode = (mode) => {
    state.viewMode = mode;

    // ✅ Guardar cambios
    saveApplicationData();

    render();
};

window.toggleDatePicker = (target = 'full') => {
    const currentTarget = state.datePickerTarget || 'full';
    if (state.showDatePicker && currentTarget === target) {
        state.showDatePicker = false;
        state.datePickerTarget = null;
    } else {
        state.showDatePicker = true;
        state.datePickerTarget = target;
        state.datePickerMonth = parseDate(state.selectedDate);
    }
    render();
};

window.changeDatePickerMonth = (delta) => {
    state.datePickerMonth.setMonth(state.datePickerMonth.getMonth() + delta);
    state.datePickerMonth = new Date(state.datePickerMonth);
    render();
};

window.selectDate = (isoDate) => {
    // Convertir ISO string a YYYY-MM-DD
    const dateStr = isoDate.split('T')[0];
    state.selectedDate = dateStr;
    state.showDatePicker = false;
    state.datePickerTarget = null;

    // ✅ Guardar cambios
    saveApplicationData();
    // Si estamos en vista semanal, mantener en esa vista
    // La fecha seleccionada se usará para mostrar su semana
    render();
};

// ⚡ NUEVO: Funciones para date picker de fecha de contratación
window.changeHireDatePickerMonth = (delta) => {
    if (!state.hireDatePickerMonth) {
        state.hireDatePickerMonth = new Date();
    }
    state.hireDatePickerMonth.setMonth(state.hireDatePickerMonth.getMonth() + delta);
    state.hireDatePickerMonth = new Date(state.hireDatePickerMonth);
    render();
};

window.selectHireDate = (dateKey) => {
    document.getElementById('empHireDate').value = dateKey;
    state.showHireDatePicker = false;
    render();
};

window.handleCheckboxClick = (event, empId) => {
    event.preventDefault();
    event.stopPropagation();

    const key = `${empId}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];
    const isChecked = att && att.present;

    if (!isChecked) {
        // Primera vez: activar el check con la posición seleccionada
        toggleAttendance(empId);
    } else {
        // Ya está checado: mostrar menú contextual
        const rect = event.target.closest('.check-container').getBoundingClientRect();
        state.contextMenu = {
            type: 'check-options',
            employeeId: empId,
            date: getDateKey(state.selectedDate),
            x: Math.min(rect.left, window.innerWidth - 200),
            y: rect.bottom + 5
        };
        render();
    }
};

// ⚡ OPTIMIZACIÓN: Render selectivo en toggleAttendance
window.toggleAttendance = (empId, date = state.selectedDate) => {
    perfMonitor.start('toggleAttendance');

    const key = `${empId}-${getDateKey(date)}`;
    const att = state.attendance[key];
    const emp = state.employees.find(e => e.id === empId);

    // ─── SNAPSHOT antes de mutar (para undo) ───
    const previousAtt = att
        ? { ...att, positionHours: att.positionHours ? [...att.positionHours] : [] }
        : null;

    if (att && att.present) {
        if (state.viewMode === 'week') return;
        delete state.attendance[key];
        // Limpiar selección temporal
        if (state.tempPositionSelection) {
            delete state.tempPositionSelection[key];
        }

        // ─── Registrar Undo: restaurar el registro eliminado ───
        UndoManager.push(
            previousAtt,
            `Asistencia de ${emp.name}`,
            () => { state.attendance[key] = previousAtt; }
        );

    } else {
        // Usar horas configuradas para este día específico
        const dayHours = getDayHours(date);

        // Obtener posición seleccionada temporalmente o usar la primera
        const selectedPos = state.tempPositionSelection?.[key] || emp.positions?.[0] || null;

        state.attendance[key] = {
            employeeId: empId,
            date: getDateKey(date),
            present: true,
            hoursWorked: dayHours,
            overtimeHours: 0,
            isHoliday: isDayHoliday(date),
            selectedPosition: selectedPos,
            multiPosition: false,
            positionHours: [],
            notes: '',
            updatedAt: Date.now()
        };

        // Mostrar notificación con la posición
        const posName = state.positions.find(p => p.id === selectedPos)?.name || 'N/A';
        showNotification(`✅ ${emp.name} - ${dayHours}h como ${posName}`, 'success');

        // Limpiar selección temporal después de usarla
        if (state.tempPositionSelection) {
            delete state.tempPositionSelection[key];
        }

        // ─── Registrar Undo: eliminar el registro que se acaba de agregar ───
        UndoManager.push(
            null,
            `Asistencia de ${emp.name}`,
            () => { delete state.attendance[key]; }
        );
    }

    // ✅ Guardar cambios en localStorage
    saveApplicationData();

    // ⚡⚡⚡ ULTRA-SELECTIVO: Solo actualizar el checkbox, NO toda la fila
    if (state.viewMode === 'day') {
        // 1. Actualizar solo el checkbox
        updateCheckboxOnly(empId);

        // 2. Actualizar estadísticas (son independientes)
        const statsElement = document.getElementById('day-stats');
        if (statsElement) {
            renderZone('day-stats', () => StatsGrid());
        }

        perfMonitor.end('toggleAttendance');
        console.log('⚡⚡⚡ Ultra-selective render: checkbox only');
    } else {
        // Fallback: Render completo (vista semana)
        perfMonitor.end('toggleAttendance');
        render();
    }
};

// ⚡⚡⚡ FUNCIÓN NUEVA: Actualizar solo el checkbox sin tocar el resto
function updateCheckboxOnly(empId) {
    const key = `${empId}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];
    const emp = state.employees.find(e => e.id === empId);
    const isChecked = att && att.present;
    const checkColor = getCheckColor(att, state.selectedDate);
    const isMultiPosition = att?.multiPosition || false;
    const hasMultiplePositions = emp.positions.length > 1;

    // Encontrar el checkbox específico
    const checkboxContainer = document.querySelector(`#emp-row-${empId} .check-container`);
    if (!checkboxContainer) {
        console.warn('Checkbox container not found, fallback to full render');
        render();
        return;
    }

    // Actualizar el input checked
    const checkInput = checkboxContainer.querySelector('.check-input');
    if (checkInput) {
        checkInput.checked = isChecked;
    }

    // Actualizar el check-box (visual)
    const checkBox = checkboxContainer.querySelector('.check-box');
    if (checkBox) {
        // Actualizar clase de color
        checkBox.className = `check-box ${checkColor}`;
        // Actualizar checkmark
        checkBox.textContent = isChecked ? '✓' : '';
    }

    // Actualizar/agregar/quitar hours-badge
    let hoursBadge = checkboxContainer.querySelector('.hours-badge');

    if (isChecked) {
        if (!hoursBadge) {
            // Crear badge si no existe
            hoursBadge = document.createElement('div');
            hoursBadge.className = 'hours-badge';
            checkboxContainer.appendChild(hoursBadge);
        }

        // Actualizar contenido del badge
        let badgeContent = `${att.hoursWorked}h${isMultiPosition ? ' 🔄' : ''}`;
        if (att.notes && att.notes.trim()) {
            badgeContent += `<span style="margin-left: 4px;" title="${att.notes.replace(/"/g, '&quot;')}">📝</span>`;
        }
        hoursBadge.innerHTML = badgeContent;
    } else {
        // Quitar badge si existe
        if (hoursBadge) {
            hoursBadge.remove();
        }
    }

    // Actualizar botón [+] si es necesario
    const buttonContainer = checkboxContainer.parentElement;
    let addButton = buttonContainer.querySelector('button');
    let spacer = buttonContainer.querySelector('div[style*="width: 40px"]');

    if (isChecked && hasMultiplePositions) {
        // Debe mostrar botón [+]
        if (!addButton && spacer) {
            // Reemplazar spacer con botón
            spacer.outerHTML = `
                        <button onclick="event.stopPropagation(); openAdvancedAttendance('${empId}')" 
                                style="width: 40px; height: 40px; border-radius: 8px; background: #1e293b; border: 2px solid #334155; color: #06b6d4; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center;"
                                onmouseover="this.style.borderColor='#06b6d4'; this.style.background='rgba(6, 182, 212, 0.1)'"
                                onmouseout="this.style.borderColor='#334155'; this.style.background='#1e293b'"
                                title="Agregar otra posición o modificar horas">
                            +
                        </button>
                    `;
        }
    } else {
        // Debe mostrar spacer
        if (addButton && !spacer) {
            // Reemplazar botón con spacer
            addButton.outerHTML = `<div style="width: 40px; height: 40px;"></div>`;
        }
    }
}

window.openCheckMenu = (event, empId) => {
    event.stopPropagation();
    const rect = event.target.closest('.check-container').getBoundingClientRect();
    state.contextMenu = {
        type: 'check',
        employeeId: empId,
        date: getDateKey(state.selectedDate),
        x: Math.min(rect.left, window.innerWidth - 220),
        y: Math.min(rect.bottom + 5, window.innerHeight - 150)
    };
    render();
};
window.togglePosition = (empId, posId) => {
    const key = `${empId}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];
    if (att && att.present) {
        // Cambiar a modo simple con una sola posición
        att.selectedPosition = posId;
        att.multiPosition = false;
        att.positionHours = [];

        const posName = state.positions.find(p => p.id === posId)?.name || 'N/A';
        showNotification(`✅ Cambiado a ${posName}`, 'success');
        render();
    }
};

window.selectTempPosition = (empId, posId) => {
    // Solo guardar la selección temporal (NO marcar asistencia todavía)
    const key = `${empId}-${getDateKey(state.selectedDate)}`;
    if (!state.tempPositionSelection) {
        state.tempPositionSelection = {};
    }
    state.tempPositionSelection[key] = posId;
    render(); // Re-renderizar para mostrar botón activo
};

window.selectPositionBeforeCheck = (empId, posId) => {
    // DEPRECADA: Mantener por compatibilidad pero usar selectTempPosition
    selectTempPosition(empId, posId);
};

window.toggleWeekPosition = (empId, posId, dateStr) => {
    saveScrollPosition();
    const key = `${empId}-${dateStr}`;
    const att = state.attendance[key];
    if (att && att.present) {
        att.selectedPosition = posId;
        saveApplicationData(); // ✅ Guardar cambios
        showNotification('✅ Posición actualizada', 'success');
        render();
    }
};
window.openEmployeeFloating = (empId) => {
    state.floatingCardEmployee = state.employees.find(e => e.id === empId);
    state.showFloatingCard = true;
    state.floatingCardMonth = new Date();
    render();
};
window.closeFloatingCard = () => {
    state.showFloatingCard = false;
    state.floatingCardEmployee = null;
    render();
};
window.changeFloatingMonth = (delta) => {
    state.floatingCardMonth.setMonth(state.floatingCardMonth.getMonth() + delta);
    state.floatingCardMonth = new Date(state.floatingCardMonth);
    render();
};
window.changeChartPeriod = (period) => { state.chartPeriod = period; render(); };

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE PROFILE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

window.openEmployeeProfile = (employeeId) => {
    const emp = state.employees.find(e => e.id === employeeId || e.key === employeeId);
    if (!emp) {
        console.error('Empleado no encontrado:', employeeId);
        return;
    }

    // Inicializar período
    const today = new Date();
    const lastPayment = emp.lastPaymentDate ? new Date(emp.lastPaymentDate + 'T00:00:00') : null;

    // Si hay último pago, desde día siguiente hasta hoy
    // Si no, últimos 15 días
    let start, end;
    if (lastPayment) {
        start = new Date(lastPayment);
        start.setDate(start.getDate() + 1);
        end = today;
    } else {
        start = new Date(today);
        start.setDate(start.getDate() - 14);
        end = today;
    }

    // ⚡ NUEVO: Inicializar deducciones con valor por defecto
    const defaultPercentage = state.settings.defaultDeductionPercentage || 2;
    const existingDeductions = Array.isArray(emp.deductions) && emp.deductions.length > 0
        ? emp.deductions.map(d => ({ ...d }))
        : [{ id: 'DED-1', type: 'percentage', value: defaultPercentage, name: 'Deducción' }];

    state.employeeProfile = {
        employeeId: emp.id,
        activeTab: 'nomina',
        periodStart: getDateKey(start),
        periodEnd: getDateKey(end),
        showStartPicker: false,
        showEndPicker: false,
        startPickerMonth: start,
        endPickerMonth: end,
        deductionType: 'percentage',  // ⚠️ DEPRECATED
        deductionValue: 0,            // ⚠️ DEPRECATED
        deductions: existingDeductions, // ⚡ NUEVO: Array de deducciones
        expandedPositions: {}
    };

    state.showEmployeeProfile = true;
    state.showFloatingCard = false; // Cerrar floating si está abierto
    render();
};

window.closeEmployeeProfile = () => {
    state.showEmployeeProfile = false;
    render();
};

window.changeProfileTab = (tabName) => {
    state.employeeProfile.activeTab = tabName;
    render();
};

// ═══ Handlers para editar hireDate desde perfil ═══
window.changeProfileHireDateMonth = (delta) => {
    if (!state.profileHireDatePickerMonth) {
        state.profileHireDatePickerMonth = new Date();
    }
    state.profileHireDatePickerMonth.setMonth(state.profileHireDatePickerMonth.getMonth() + delta);
    state.profileHireDatePickerMonth = new Date(state.profileHireDatePickerMonth);
    render();
};

window.selectProfileHireDate = (empId, dateKey) => {
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return;

    emp.hireDate = dateKey;
    state.showProfileHireDatePicker = false;
    saveApplicationData();
    showNotification(`📅 Fecha de contratación actualizada a ${dateKey}`, 'success');
    render();
};

window.toggleProfileStartPicker = () => {
    state.employeeProfile.showStartPicker = !state.employeeProfile.showStartPicker;
    state.employeeProfile.showEndPicker = false;
    if (state.employeeProfile.showStartPicker) {
        state.employeeProfile.startPickerMonth = new Date(state.employeeProfile.periodStart + 'T00:00:00');
    }
    render();
};

window.toggleProfileEndPicker = () => {
    state.employeeProfile.showEndPicker = !state.employeeProfile.showEndPicker;
    state.employeeProfile.showStartPicker = false;
    if (state.employeeProfile.showEndPicker) {
        state.employeeProfile.endPickerMonth = new Date(state.employeeProfile.periodEnd + 'T00:00:00');
    }
    render();
};

window.changeProfileStartMonth = (delta) => {
    state.employeeProfile.startPickerMonth.setMonth(state.employeeProfile.startPickerMonth.getMonth() + delta);
    state.employeeProfile.startPickerMonth = new Date(state.employeeProfile.startPickerMonth);
    render();
};

window.changeProfileEndMonth = (delta) => {
    state.employeeProfile.endPickerMonth.setMonth(state.employeeProfile.endPickerMonth.getMonth() + delta);
    state.employeeProfile.endPickerMonth = new Date(state.employeeProfile.endPickerMonth);
    render();
};

window.selectProfileStartDate = (dateKey) => {
    state.employeeProfile.periodStart = dateKey;
    state.employeeProfile.showStartPicker = false;
    render();
};

window.selectProfileEndDate = (dateKey) => {
    state.employeeProfile.periodEnd = dateKey;
    state.employeeProfile.showEndPicker = false;
    render();
};

window.setProfilePeriod = (preset) => {
    const today = new Date();
    const emp = state.employees.find(e => e.id === state.employeeProfile.employeeId);
    let start, end;

    switch (preset) {
        case '7days':
            start = new Date(today);
            start.setDate(start.getDate() - 6);
            end = today;
            break;
        case '15days':
            start = new Date(today);
            start.setDate(start.getDate() - 14);
            end = today;
            break;
        case 'month':
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            end = today;
            break;
        case 'lastPayment':
            // ⚡ NUEVO: Usar fecha individual del empleado o global de settings
            const lastPayDate = emp?.lastPaymentDate || state.settings.globalLastPaymentDate;

            if (lastPayDate) {
                start = new Date(lastPayDate + 'T00:00:00');
                start.setDate(start.getDate() + 1);  // Día siguiente al último pago
                end = today;
            } else {
                showAlert('❌ No hay registro de último pago. Configura uno en Ajustes o marca un pago en el perfil.', 'warning');
                return;
            }
            break;
        default:
            return;
    }

    state.employeeProfile.periodStart = getDateKey(start);
    state.employeeProfile.periodEnd = getDateKey(end);
    render();
};

// ⚡ NUEVO: Sistema de múltiples deducciones con render selectivo
window.addDeduction = () => {
    if (!state.employeeProfile.deductions) {
        state.employeeProfile.deductions = [];
    }

    // Obtener porcentaje por defecto de settings
    const defaultPercentage = state.settings.defaultDeductionPercentage || 2;

    state.employeeProfile.deductions.push({
        id: `DED-${Date.now()}`,
        type: 'percentage',
        value: defaultPercentage
    });

    // ⚡ Render selectivo: solo actualizar sección de deducciones
    updateDeductionsSection();
};

window.removeDeduction = (index) => {
    if (state.employeeProfile.deductions.length <= 1) {
        showNotification('❌ Debe haber al menos una deducción', 'error');
        return;
    }
    state.employeeProfile.deductions.splice(index, 1);

    // ⚡ Render selectivo: solo actualizar sección de deducciones
    updateDeductionsSection();
};

window.updateDeductionType = (index, type) => {
    if (state.employeeProfile.deductions[index]) {
        state.employeeProfile.deductions[index].type = type;

        // ⚡ Render selectivo: solo actualizar sección de deducciones
        updateDeductionsSection();
    }
};

window.updateDeductionValue = (index, value) => {
    if (state.employeeProfile.deductions[index]) {
        state.employeeProfile.deductions[index].value = parseFloat(value) || 0;

        // ⚡ Render selectivo: solo actualizar sección de deducciones
        updateDeductionsSection();
    }
};

// ⚡ NUEVO: Función para actualizar solo la sección de deducciones
function updateDeductionsSection() {
    const emp = state.employees.find(e => e.id === state.employeeProfile.employeeId);
    if (!emp) return;

    // Recalcular nómina
    const payroll = payrollService.calculateEmployeePayroll(
        state.employeeProfile.employeeId,
        state.employeeProfile.periodStart,
        state.employeeProfile.periodEnd,
        state.employeeProfile.deductions
    );
    emp.deductions = (state.employeeProfile.deductions || []).map(d => ({
        id: d.id || `DED-${Date.now()}`,
        type: d.type,
        value: d.value,
        name: d.name || 'Deducción'
    }));

    // Encontrar contenedor de deducciones
    const deductionsContainer = document.querySelector('#deductions-section');
    if (!deductionsContainer) {
        render(); // Fallback si no encontramos el elemento
        return;
    }

    // Actualizar HTML de deducciones
    deductionsContainer.innerHTML = generateDeductionsHTML(payroll);

    // Actualizar también el total neto
    const netoElement = document.querySelector('#neto-total');
    if (netoElement) {
        netoElement.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-size: 0.875rem; color: rgba(0,0,0,0.7); font-weight: 600; margin-bottom: 4px;">💰 NETO A PAGAR</div>
                            <div style="font-size: 2rem; font-weight: 900; color: #000;">${formatCurrency(payroll.neto)}</div>
                        </div>
                    </div>
                `;
    }
}

// ⚡ NUEVO: Generar HTML de deducciones (separado para reusabilidad)
function generateDeductionsHTML(payroll) {
    return `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4;">
                        💸 DEDUCCIONES
                    </div>
                    <button onclick="addDeduction()" 
                            style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.transform='scale(1.05)'"
                            onmouseout="this.style.transform='scale(1)'">
                        +
                    </button>
                </div>
                
                ${payroll.deductionBreakdown && payroll.deductionBreakdown.length > 0 ? payroll.deductionBreakdown.map((ded, index) => `
                    <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 12px;">
                        <div style="display: flex; gap: 12px; align-items: start;">
                            <!-- Radio buttons de tipo -->
                            <div style="flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px;">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                                    <input type="radio" 
                                           name="deductionType_${index}" 
                                           value="fixed" 
                                           ${ded.type === 'fixed' ? 'checked' : ''} 
                                           onchange="updateDeductionType(${index}, 'fixed')" 
                                           style="accent-color: #06b6d4;">
                                    <span style="color: #f1f5f9;">Monto</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                                    <input type="radio" 
                                           name="deductionType_${index}" 
                                           value="percentage" 
                                           ${ded.type === 'percentage' ? 'checked' : ''} 
                                           onchange="updateDeductionType(${index}, 'percentage')" 
                                           style="accent-color: #06b6d4;">
                                    <span style="color: #f1f5f9;">Porcentaje%</span>
                                </label>
                            </div>
                            
                            <!-- Input de valor -->
                            <div style="flex: 1;">
                                <input type="number" 
                                       class="form-input" 
                                       value="${ded.value.toFixed(2)}" 
                                       onchange="updateDeductionValue(${index}, this.value)"
                                       placeholder="0.00"
                                       min="0"
                                       step="${ded.type === 'fixed' ? '0.01' : '0.1'}"
                                       style="width: 100%; font-size: 0.875rem; padding: 8px;">
                            </div>
                            
                            <!-- Botón eliminar (solo si hay más de 1) -->
                            ${payroll.deductionBreakdown.length > 1 ? `
                                <button onclick="removeDeduction(${index})" 
                                        style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: all 0.2s;"
                                        onmouseover="this.style.background='#dc2626'"
                                        onmouseout="this.style.background='#ef4444'">
                                    🗑️
                                </button>
                            ` : ''}
                        </div>
                        
                        <!-- Preview de esta deducción -->
                        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #334155; font-size: 0.75rem; color: #94a3b8;">
                            Descuento: <span style="color: #ec4899; font-weight: 600;">
                                ${ded.type === 'fixed'
            ? formatCurrency(ded.amount)
            : `${ded.value}% de ${formatCurrency(ded.appliedTo)} = ${formatCurrency(ded.amount)}`
        }
                            </span>
                            <br>
                            Restante: <span style="color: #10b981; font-weight: 600;">${formatCurrency(ded.appliedTo - ded.amount)}</span>
                        </div>
                    </div>
                `).join('') : '<div style="text-align: center; color: #64748b; padding: 20px;">No hay deducciones</div>'}
                
                <!-- Total de deducciones -->
                <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; margin-top: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.875rem; color: #94a3b8;">Total deducciones:</span>
                        <span style="font-size: 1.125rem; font-weight: 700; color: #ec4899;">-${formatCurrency(payroll.deductions)}</span>
                    </div>
                </div>
            `;
}

// ⚠️ DEPRECATED: Mantener para compatibilidad
window.setDeductionType = (type) => {
    state.employeeProfile.deductionType = type;
    render();
};

// ============================================
// FUNCIONES DE EXPORTACIÓN
// ============================================

window.updateExportPeriod = (field, value) => {
    if (field === 'start') {
        state.exportConfig.periodStart = value;
    } else {
        state.exportConfig.periodEnd = value;
    }
    render();
};

window.setExportPreset = (preset) => {
    const today = new Date();
    let start, end;

    switch (preset) {
        case 'thisMonth':
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            end = today;
            break;
        case 'lastMonth':
            start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            end = new Date(today.getFullYear(), today.getMonth(), 0);
            break;
        case 'last15':
            start = new Date(today);
            start.setDate(start.getDate() - 14);
            end = today;
            break;
    }

    state.exportConfig.periodStart = getDateKey(start);
    state.exportConfig.periodEnd = getDateKey(end);
    render();
};

window.addExportDeduction = () => {
    const defaultPercentage = state.settings.defaultDeductionPercentage || 2;
    state.exportConfig.deductions.push({
        id: `DED-${Date.now()}`,
        type: 'percentage',
        value: defaultPercentage,
        name: 'Deducción'
    });
    updateExportDeductionsSection();
};

window.removeExportDeduction = (index) => {
    if (state.exportConfig.deductions.length <= 1) {
        showNotification('❌ Debe haber al menos una deducción', 'error');
        return;
    }
    state.exportConfig.deductions.splice(index, 1);
    updateExportDeductionsSection();
};

window.updateExportDeductionType = (index, type) => {
    if (state.exportConfig.deductions[index]) {
        state.exportConfig.deductions[index].type = type;
        updateExportDeductionsSection();
    }
};

window.updateExportDeductionValue = (index, value) => {
    if (state.exportConfig.deductions[index]) {
        state.exportConfig.deductions[index].value = parseFloat(value) || 0;
        updateExportDeductionsSection();
    }
};

window.updateExportDeductionName = (index, name) => {
    if (state.exportConfig.deductions[index]) {
        state.exportConfig.deductions[index].name = name;
    }
};

function updateExportDeductionsSection() {
    const container = document.querySelector('#export-deductions-section');
    if (!container) {
        render(); // Fallback
        return;
    }

    // Actualizar solo la sección de deducciones
    const newHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="margin: 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        💸 Paso 2: Deducciones Globales
                    </h3>
                    <button onclick="addExportDeduction()" 
                            style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.transform='scale(1.05)'"
                            onmouseout="this.style.transform='scale(1)'">
                        +
                    </button>
                </div>
                
                <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 16px;">
                    💡 Estas deducciones se aplicarán a todos los empleados de forma encadenada
                </div>
                
                ${generateExportDeductionsHTML()}
            `;

    container.innerHTML = newHTML;

    // Re-render para actualizar vista previa
    render();
}

window.copyExportJSON = async () => {
    try {
        const exportData = generateExportData();

        if (!exportData || exportData.length === 0) {
            showNotification('❌ No hay datos para exportar', 'error');
            return;
        }

        // Limpiar propiedades privadas (_bruto, _deductions, _employeeName, _employeePosition)
        const cleanData = exportData.map(({ id, nombre, monto }) => ({
            id,
            nombre,
            monto
        }));

        const json = JSON.stringify(cleanData, null, 2);

        // Intentar copiar con clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(json);
            showNotification('✅ JSON copiado al portapapeles', 'success');
        } else {
            // Fallback: Crear textarea temporal
            const textarea = document.createElement('textarea');
            textarea.value = json;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();

            const success = document.execCommand('copy');
            document.body.removeChild(textarea);

            if (success) {
                showNotification('✅ JSON copiado al portapapeles', 'success');
            } else {
                throw new Error('execCommand failed');
            }
        }
    } catch (error) {
        console.error('Error copiando JSON:', error);
        showNotification('❌ Error al copiar. Intenta descargar el archivo.', 'error');
    }
};

window.downloadExportJSON = () => {
    try {
        const exportData = generateExportData();

        if (!exportData || exportData.length === 0) {
            showNotification('❌ No hay datos para exportar', 'error');
            return;
        }

        // Limpiar propiedades privadas
        const cleanData = exportData.map(({ id, nombre, monto }) => ({
            id,
            nombre,
            monto
        }));

        const json = JSON.stringify(cleanData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const today = new Date();
        const filename = `nomina-${getDateKey(today)}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification(`✅ Archivo ${filename} descargado`, 'success');
    } catch (error) {
        console.error('Error descargando JSON:', error);
        showNotification('❌ Error al descargar archivo', 'error');
    }
};

window.togglePositionBreakdown = (positionId) => {
    if (!state.employeeProfile.expandedPositions) {
        state.employeeProfile.expandedPositions = {};
    }

    // Toggle estado
    const isExpanded = !state.employeeProfile.expandedPositions[positionId];
    state.employeeProfile.expandedPositions[positionId] = isExpanded;

    // ⚡ OPTIMIZACIÓN: Solo actualizar el elemento específico sin render completo
    const positionCard = document.querySelector(`[data-position-id="${positionId}"]`);
    if (!positionCard) {
        render(); // Fallback si no encontramos el elemento
        return;
    }

    // Actualizar flecha
    const arrow = positionCard.querySelector('.position-arrow');
    if (arrow) {
        arrow.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
    }

    // Mostrar/ocultar detalles
    const details = positionCard.querySelector('.position-details');
    if (details) {
        details.style.display = isExpanded ? 'block' : 'none';
    }
};

window.markAsPaid = () => {
    const emp = state.employees.find(e => e.id === state.employeeProfile.employeeId);
    if (!emp) return;

    const today = getDateKey(new Date());
    emp.lastPaymentDate = today;

    // Agregar al historial
    if (!emp.paymentHistory) emp.paymentHistory = [];

    const period = `${state.employeeProfile.periodStart} to ${state.employeeProfile.periodEnd}`;
    const { neto } = payrollService.calculateEmployeePayroll(emp.id, state.employeeProfile.periodStart, state.employeeProfile.periodEnd, state.employeeProfile.deductions);

    emp.paymentHistory.push({
        date: today,
        amount: neto,
        period: period,
        deductionType: state.employeeProfile.deductionType,
        deductionValue: state.employeeProfile.deductionValue
    });

    saveApplicationData();
    showAlert('✅ Marcado como pagado', 'success');
    render();
};

window.openQuickEdit = (empId, dateStr) => {
    const emp = state.employees.find(e => e.id === empId);
    state.selectedEmployee = emp;
    state.selectedDate = parseDate(dateStr);
    state.modalType = 'advanced';
    state.showModal = true;
    state.contextMenu = null;
    render();
};
window.openAdvancedModal = (empId) => {
    modalManager.openAdvanced(empId, false);
};

window.openAdvancedAttendance = (empId) => {
    modalManager.openAdvanced(empId, false);
};

window.openAdvancedAttendanceForFraction = (empId) => {
    modalManager.openAdvanced(empId, true); // Forzar modo fraccionado
};

window.openAdvancedModalFromContext = () => {
    modalManager.openFromContext();
};

window.closeModal = () => {
    modalManager.close();

    // Limpiar todos los modales de Supabase del DOM
    const overlays = document.querySelectorAll('.modal-overlay');
    overlays.forEach(overlay => overlay.remove());
};
window.saveAdvancedAttendance = () => {
    debug.log('🔵 Función saveAdvancedAttendance llamada');

    const emp = state.selectedEmployee;
    if (!emp) {
        console.error('❌ No hay empleado seleccionado');
        return;
    }

    const dateKey = getDateKey(state.selectedDate);
    const key = `${emp.id}-${dateKey}`;

    // ─── SNAPSHOT antes de mutar (para undo) ───
    const previousAdvAtt = state.attendance[key]
        ? { ...state.attendance[key], positionHours: [...(state.attendance[key].positionHours || [])] }
        : null;

    // Verificar si es modo fraccionado
    const multiPositionModeCheckbox = document.getElementById('multiPositionMode');
    const isMultiPosition = multiPositionModeCheckbox ? multiPositionModeCheckbox.checked : false;

    let attendanceRecord;

    if (isMultiPosition) {
        // MODO FRACCIONADO
        const positionHours = [];
        let totalHours = 0;
        let totalOvertime = 0;

        // Leer horas de cada posición
        emp.positions.forEach(pid => {
            const hoursInput = document.getElementById(`posHours_${pid}`);
            const overtimeInput = document.getElementById(`posOvertime_${pid}`);

            if (hoursInput) {
                const hours = parseFloat(hoursInput.value) || 0;
                const overtime = parseFloat(overtimeInput.value) || 0;

                if (hours > 0 || overtime > 0) {
                    positionHours.push({
                        positionId: pid,
                        hours: hours,
                        overtimeHours: overtime
                    });
                    totalHours += hours;
                    totalOvertime += overtime;
                }
            }
        });

        // Validar que haya al menos una posición con horas
        if (positionHours.length === 0) {
            showAlert('❌ Debe asignar horas a al menos una posición', 'error');
            return;
        }

        // Validar total de horas
        if (totalHours > 24) {
            showAlert('❌ El total de horas no puede exceder 24', 'error');
            return;
        }

        attendanceRecord = {
            employeeId: emp.id,
            date: dateKey,
            present: true,
            hoursWorked: totalHours,
            overtimeHours: totalOvertime,
            isHoliday: document.getElementById('isHoliday')?.checked || false,
            multiPosition: true,
            positionHours: positionHours,
            selectedPosition: positionHours[0].positionId, // Primera posición como referencia
            notes: document.getElementById('notes')?.value.trim() || ''
        };

        debug.log('💾 Guardando (Fraccionado):', attendanceRecord);

    } else {
        // MODO SIMPLE
        const hoursInput = document.getElementById('hoursWorked');
        const overtimeInput = document.getElementById('overtimeHours');
        const holidayInput = document.getElementById('isHoliday');
        const notesInput = document.getElementById('notes');
        const positionInput = document.getElementById('selectedPosition');

        const hours = parseFloat(hoursInput?.value || 0);
        const overtime = parseFloat(overtimeInput?.value || 0);
        const holiday = holidayInput?.checked || false;
        const notes = notesInput?.value.trim() || '';
        const selPos = positionInput ? positionInput.value : (emp.positions?.[0] || null);

        // Validar horas
        if (isNaN(hours) || hours < 0 || hours > 24) {
            showAlert('❌ Las horas trabajadas deben estar entre 0 y 24', 'error');
            return;
        }

        attendanceRecord = {
            employeeId: emp.id,
            date: dateKey,
            present: true,
            hoursWorked: hours,
            overtimeHours: overtime,
            isHoliday: holiday,
            selectedPosition: selPos,
            multiPosition: false,
            positionHours: [],
            notes: notes
        };

        debug.log('💾 Guardando (Simple):', attendanceRecord);
    }

    // Guardar en el estado
    attendanceRecord.updatedAt = Date.now();
    attendanceRecord._isDirty = true;
    state.attendance[key] = attendanceRecord;

    // ─── Registrar Undo ───
    UndoManager.push(
        previousAdvAtt,
        `Asistencia de ${emp.name}`,
        () => {
            if (previousAdvAtt) {
                state.attendance[key] = previousAdvAtt;
            } else {
                state.attendance[key] = {
                    employeeId: emp.id,
                    date: dateKey,
                    present: false,
                    _isDirty: true,
                    updatedAt: Date.now()
                };
            }
        }
    );

    // Resetear modo fraccionado
    state.isFractionated = false;

    // Cerrar modal
    state.showModal = false;
    state.modalType = null;
    state.selectedEmployee = null;

    // Mostrar notificación
    showNotification('✅ Asistencia guardada correctamente', 'success');

    // Re-renderizar
    render();
};
// ============================================
// NUEVA FUNCIÓN: handleWeekCheck (Vista Semanal)
// ============================================
window.handleWeekCheck = (empId, dateStr) => {
    // Prevenir clicks múltiples rápidos
    if (state.isProcessingClick) return;

    state.isProcessingClick = true;
    saveScrollPosition();

    const key = `${empId}-${dateStr}`;
    const att = state.attendance[key];
    const isPresent = att && att.present;

    if (isPresent) {
        // Ya está marcado -> SOLO abrir menú contextual (NO desmarcar)

        // Si ya hay un menú abierto para este mismo checkbox, cerrarlo
        if (state.contextMenu &&
            state.contextMenu.employeeId === empId &&
            state.contextMenu.date === dateStr) {
            state.contextMenu = null;
        } else {
            // Abrir menú nuevo - Posición calculada cerca del centro
            let menuX = Math.max(20, Math.min(window.innerWidth - 240, window.innerWidth / 2 - 110));
            let menuY = Math.max(20, window.scrollY + 150);

            // Ajustar si está muy abajo
            if (menuY + 150 > window.scrollY + window.innerHeight) {
                menuY = window.scrollY + window.innerHeight - 170;
            }

            state.contextMenu = {
                type: 'week',
                employeeId: empId,
                date: dateStr,
                x: menuX,
                y: menuY
            };
        }

        state.isProcessingClick = false;
        render();

    } else {
        // No está marcado -> Marcar asistencia
        // ✅ FIX: Crear fecha correctamente sin problemas de zona horaria
        const date = parseDate(dateStr);

        const emp = state.employees.find(e => e.id === empId);

        if (!emp) {
            state.isProcessingClick = false;
            return;
        }

        debug.log('📝 Creando asistencia:', {
            dateStr,
            dateObject: date,
            isHoliday: isDayHoliday(date)
        });

        // Crear registro de asistencia
        const newAttendance = {
            employeeId: empId,
            date: dateStr,
            present: true,
            hoursWorked: state.quickWeekHours, // ✅ Usar horas rápidas semanales
            overtimeHours: 0,
            isHoliday: isDayHoliday(date),
            useTempPosition: false,
            notes: '',
            multiPosition: emp.positions?.length > 1,
            positionHours: emp.positions?.length > 0 ?
                [{ positionId: emp.positions[0], hours: state.quickWeekHours }] :  // ✅ También aquí
                [],
            selectedPosition: emp.positions?.[0] || null
        };

        console.log('⚡ Asistencia creada con', state.quickWeekHours, 'horas (vista semanal)');

        // ─── SNAPSHOT antes de mutar (para undo) ───
        const prevWeekAtt = state.attendance[key]
            ? { ...state.attendance[key], positionHours: [...(state.attendance[key].positionHours || [])] }
            : null;

        state.attendance[key] = newAttendance;

        // ─── Registrar Undo ───
        UndoManager.push(
            prevWeekAtt,
            `Asistencia de ${emp.name} (${dateStr})`,
            () => {
                if (prevWeekAtt) {
                    state.attendance[key] = prevWeekAtt;
                } else {
                    state.attendance[key] = {
                        employeeId: empId,
                        date: dateStr,
                        present: false,
                        _isDirty: true,
                        updatedAt: Date.now()
                    };
                }
            }
        );

        saveApplicationData();

        state.isProcessingClick = false;
        render();
    }
};

// Mantener función antigua por compatibilidad (redirige a nueva)
window.handleWeekCheckClick = (empId, dateStr) => {
    handleWeekCheck(empId, dateStr);
};

window.removeAttendance = (empId, dateStr) => {
    const key = `${empId}-${dateStr}`;
    const emp = state.employees.find(e => e.id === empId);

    // ─── SNAPSHOT antes de eliminar ───
    const prevRemoveAtt = state.attendance[key]
        ? { ...state.attendance[key], positionHours: [...(state.attendance[key].positionHours || [])] }
        : null;

    const att = state.attendance[key];
    if (att) {
        att.present = false;
        att.hoursWorked = 0;
        att.overtimeHours = 0;
        att.positionHours = [];
        att.updatedAt = Date.now();
        att._isDirty = true;
    }
    state.contextMenu = null;

    // ─── Registrar Undo ───
    UndoManager.push(
        prevRemoveAtt,
        `Eliminación de ${emp?.name || empId} (${dateStr})`,
        () => { if (prevRemoveAtt) state.attendance[key] = prevRemoveAtt; }
    );

    saveApplicationData();
    render();
};
window.markDayAsHoliday = () => {
    const key = getDateKey(state.selectedDate);
    const idx = state.settings.holidays.indexOf(key);
    if (idx > -1) state.settings.holidays.splice(idx, 1);
    else state.settings.holidays.push(key);
    render();
};

// ═══ Marcadores de fechas de pago ═══
window.toggleLegend = () => { state.showLegend = !state.showLegend; render(); };
window.setEmployeeFilter = (filter) => {
    // Si se hace click en el filtro ya activo, desactivarlo
    state.employeeFilter = state.employeeFilter === filter ? null : filter;
    render();
};

// ═══════════════════════════════════════════════════════════
// FUNCIONES DE SUPABASE
// ═══════════════════════════════════════════════════════════

// Mostrar modal de login/registro
window.showSupabaseLogin = function () {
    const html = `
                <div class="modal-overlay" onclick="if(event.target === this) closeModal()">
                    <div class="modal-content" style="max-width: 420px;">
                        <div class="modal-header">
                            <h2 class="modal-title">☁️ Conectar con la Nube</h2>
                            <button class="modal-close" onclick="closeModal()">✕</button>
                        </div>
                        <div class="modal-body">
                            <p style="color: #94a3b8; margin-bottom: 20px; font-size: 0.9rem; line-height: 1.6;">
                                Sincroniza tus datos entre todos tus dispositivos. Tus datos locales se migrarán automáticamente a la nube.
                            </p>
                            
                            <div class="form-group">
                                <label class="form-label">Email</label>
                                <input type="email" id="supabase-email" class="form-input" placeholder="tu@email.com" autocomplete="email">
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label">Contraseña</label>
                                <input type="password" id="supabase-password" class="form-input" placeholder="Mínimo 6 caracteres" autocomplete="current-password">
                            </div>
                            
                            <div id="auth-error" style="display: none; color: #ef4444; background: rgba(239,68,68,0.1); padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 0.85rem;"></div>
                            
                            <div style="display: flex; gap: 10px; margin-top: 20px;">
                                <button onclick="loginSupabase()" class="btn-primary" style="flex: 1;">
                                    Iniciar Sesión
                                </button>
                                <button onclick="registerSupabase()" class="btn-secondary" style="flex: 1;">
                                    Registrarse
                                </button>
                            </div>
                            
                            <div style="margin-top: 16px; padding: 12px; background: rgba(6,182,212,0.1); border-radius: 8px; font-size: 0.8rem; color: #94a3b8;">
                                <strong style="color: #06b6d4;">💡 Primera vez:</strong> Regístrate para crear tu cuenta. Luego podrás acceder desde cualquier dispositivo.
                            </div>
                        </div>
                    </div>
                </div>
            `;

    document.body.insertAdjacentHTML('beforeend', html);
    // Focus en el email
    setTimeout(() => document.getElementById('supabase-email')?.focus(), 100);
};

// Login
window.loginSupabase = async function () {
    const email = document.getElementById('supabase-email').value.trim();
    const password = document.getElementById('supabase-password').value;
    const errorDiv = document.getElementById('auth-error');

    if (!email || !password) {
        errorDiv.textContent = '❌ Por favor completa todos los campos';
        errorDiv.style.display = 'block';
        return;
    }

    errorDiv.style.display = 'none';

    try {
        await supabaseService.signIn(email, password);
        closeModal();

        showNotification('✅ Conectado exitosamente', 'success');

        // Mostrar opciones de sincronización
        await showSyncOptionsModal();

    } catch (error) {
        console.error('Error en login:', error);
        errorDiv.textContent = '❌ ' + (error.message || 'Error al iniciar sesión');
        errorDiv.style.display = 'block';
    }
};

// Registro
window.registerSupabase = async function () {
    const email = document.getElementById('supabase-email').value.trim();
    const password = document.getElementById('supabase-password').value;
    const errorDiv = document.getElementById('auth-error');

    if (!email || !password) {
        errorDiv.textContent = '❌ Por favor completa todos los campos';
        errorDiv.style.display = 'block';
        return;
    }

    if (password.length < 6) {
        errorDiv.textContent = '❌ La contraseña debe tener al menos 6 caracteres';
        errorDiv.style.display = 'block';
        return;
    }

    errorDiv.style.display = 'none';

    try {
        await supabaseService.signUp(email, password);

        showNotification('✅ Cuenta creada exitosamente', 'success');

        // Primera vez: auto-subir datos locales
        await showSyncOptionsModal();

    } catch (error) {
        console.error('Error en registro:', error);
        errorDiv.textContent = '❌ ' + (error.message || 'Error al crear cuenta');
        errorDiv.style.display = 'block';
    }
};


// Modal de opciones de sincronización
window.showSyncOptionsModal = async function () {
    // Detectar si hay datos locales y en la nube
    const hasLocalData = state.employees.length > 0 || state.positions.length > 0;

    const hasCloudData = await supabaseService.hasCloudData();

    // Decidir qué mostrar
    if (!hasLocalData && !hasCloudData) {
        // Sin datos en ningún lado - no hacer nada
        render();
        return;
    }

    if (hasLocalData && !hasCloudData) {
        // Solo datos locales - preguntar si subir
        showUploadConfirmModal();
        return;
    }

    if (!hasLocalData && hasCloudData) {
        // Solo datos en la nube - preguntar si descargar
        showDownloadConfirmModal();
        return;
    }

    // Ambos tienen datos - mostrar opciones completas
    showFullSyncModal();
};

// Modal: Confirmar subir datos locales
function showUploadConfirmModal() {
    const html = `
                <div class="modal-overlay" onclick="if(event.target === this) { closeModal(); render(); }">
                    <div class="modal-content" style="max-width: 480px;">
                        <div class="modal-header">
                            <h2 class="modal-title">📤 Subir datos a la nube</h2>
                            <button class="modal-close" onclick="closeModal(); render();">✕</button>
                        </div>
                        <div class="modal-body">
                            <p style="color: #cbd5e1; margin-bottom: 20px; line-height: 1.6;">
                                Tienes <strong>${state.employees.length} empleados</strong> y <strong>${state.positions.length} posiciones</strong> guardados localmente.
                            </p>
                            <p style="color: #cbd5e1; margin-bottom: 20px; line-height: 1.6;">
                                ¿Deseas subirlos a Supabase para sincronizarlos entre dispositivos?
                            </p>
                            
                            <div style="display: flex; gap: 10px; margin-top: 20px;">
                                <button onclick="uploadToCloud()" class="btn-primary" style="flex: 1;">
                                    📤 Sí, subir datos
                                </button>
                                <button onclick="closeModal(); render();" class="btn-secondary" style="flex: 1;">
                                    Ahora no
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

    document.body.insertAdjacentHTML('beforeend', html);
}

// Modal: Confirmar descargar datos de la nube
function showDownloadConfirmModal() {
    const html = `
                <div class="modal-overlay" onclick="if(event.target === this) { closeModal(); render(); }">
                    <div class="modal-content" style="max-width: 480px;">
                        <div class="modal-header">
                            <h2 class="modal-title">☁️ Descargar datos de la nube</h2>
                            <button class="modal-close" onclick="closeModal(); render();">✕</button>
                        </div>
                        <div class="modal-body">
                            <p style="color: #cbd5e1; margin-bottom: 20px; line-height: 1.6;">
                                Tienes datos guardados en Supabase de otro dispositivo.
                            </p>
                            <p style="color: #cbd5e1; margin-bottom: 20px; line-height: 1.6;">
                                ¿Deseas descargarlos para verlos en este dispositivo?
                            </p>
                            
                            <div style="display: flex; gap: 10px; margin-top: 20px;">
                                <button onclick="downloadFromCloud()" class="btn-primary" style="flex: 1;">
                                    ☁️ Sí, descargar
                                </button>
                                <button onclick="closeModal(); render();" class="btn-secondary" style="flex: 1;">
                                    Ahora no
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

    document.body.insertAdjacentHTML('beforeend', html);
}

// Modal: Opciones completas cuando hay datos en ambos lados
function showFullSyncModal() {
    const html = `
                <div class="modal-overlay" onclick="if(event.target === this) { closeModal(); render(); }">
                    <div class="modal-content" style="max-width: 560px;">
                        <div class="modal-header">
                            <h2 class="modal-title">🔄 ¿Cómo deseas sincronizar?</h2>
                            <button class="modal-close" onclick="closeModal(); render();">✕</button>
                        </div>
                        <div class="modal-body">
                            <p style="color: #cbd5e1; margin-bottom: 24px; line-height: 1.6;">
                                Tienes datos <strong>en este dispositivo</strong> y <strong>en la nube</strong>. Elige la acción que deseas realizar:
                            </p>
                            
                            <div style="display: flex; flex-direction: column; gap: 12px;">
                                <button onclick="uploadToCloud()" class="btn-primary" style="text-align: left; padding: 18px; background: linear-gradient(135deg, #3b82f6, #2563eb);">
                                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                                        <span style="font-size: 1.5rem;">📤</span>
                                        <span style="font-weight: 700; font-size: 1.05rem;">Subir mis datos locales</span>
                                    </div>
                                    <div style="font-size: 0.85rem; opacity: 0.9; margin-left: 40px;">
                                        Reemplaza los datos en la nube con los que tienes aquí
                                    </div>
                                </button>
                                
                                <button onclick="downloadFromCloud()" class="btn-primary" style="text-align: left; padding: 18px; background: linear-gradient(135deg, #06b6d4, #0891b2);">
                                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                                        <span style="font-size: 1.5rem;">☁️</span>
                                        <span style="font-weight: 700; font-size: 1.05rem;">Descargar desde la nube</span>
                                    </div>
                                    <div style="font-size: 0.85rem; opacity: 0.9; margin-left: 40px;">
                                        Reemplaza tus datos locales con los de la nube
                                    </div>
                                </button>
                                
                                <button onclick="closeModal(); render();" class="btn-secondary" style="margin-top: 8px;">
                                    ❌ Cancelar (no hacer nada ahora)
                                </button>
                            </div>
                            
                            <div style="margin-top: 20px; padding: 14px; background: rgba(251,191,36,0.1); border-left: 3px solid #f59e0b; border-radius: 6px; font-size: 0.85rem; color: #fbbf24;">
                                <strong>⚠️ Importante:</strong> Cualquiera de las opciones sobrescribirá completamente los datos del otro lado. Asegúrate de elegir la correcta.
                            </div>
                        </div>
                    </div>
                </div>
            `;

    document.body.insertAdjacentHTML('beforeend', html);
}

// Operaciones de Supabase UI
window.uploadToCloud = () => supabaseService.manualSync();
window.downloadFromCloud = () => supabaseService.downloadFromCloud();
window.manualSync = () => supabaseService.manualSync();
window.toggleAutoSync = () => supabaseService.toggleAutoSync();

// ═══════════════════════════════════════════════════════════

window.changeEmployeeViewMode = (mode) => {
    state.employeeViewMode = mode;
    render();
};
window.changeReportViewMode = (mode) => {
    state.reportViewMode = mode;
    render();
};
window.setEmployeeStatusFilter = (filter) => {
    state.employeeStatusFilter = filter;
    if (!state.employeeFilters) {
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
    }
    state.employeeFilters.status = filter;
    render();
};
window.setEmployeeSearchFilter = (value) => {
    if (!state.employeeFilters) {
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
    }
    state.employeeFilters.search = value;
    render();
};
window.setEmployeePositionFilter = (positionId) => {
    if (!state.employeeFilters) {
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
    }
    state.employeeFilters.positionId = positionId;
    render();
};
window.setEmployeeLeaderFilter = (leaderId) => {
    if (!state.employeeFilters) {
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
    }
    state.employeeFilters.leaderId = leaderId;
    render();
};
// Mapeos de formularios movidos a EmployeesUI.js

// Redundant saveEmployee removed (moved to EmployeesUI.js)

// saveEmployeeData movida a EmployeesUI.js


// window.saveLeader movida a EmployeesUI.js

// Sistema de menú de exportar
window.showExportMenu = (options) => {
    state.showExportMenu = true;
    state.showShareOptions = false;
    state.exportMenuData = {
        x: options.x || 0,
        y: options.y || 0,
        filename: options.filename || 'archivo',
        blob: options.blob,
        title: options.title || 'Archivo',
        text: options.text || ''
    };
    render();
};

window.closeExportMenu = () => {
    state.showExportMenu = false;
    state.showShareOptions = false;
    state.showImportFullModal = false;
    state.importFullText = '';
    state.showNotesCenter = false;
    state.notesCenterEmployeeId = null;
    state.showNoteModal = false;
    state.exportMenuData = {
        x: 0,
        y: 0,
        filename: '',
        blob: null,
        title: '',
        text: ''
    };
    render();
};

window.performShare = async () => {
    const data = state.exportMenuData;
    if (!data.blob) return;

    try {
        // Mostrar loading
        state.isExporting = true;
        render();

        const file = new File([data.blob], data.filename, {
            type: data.blob.type
        });

        if (navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: data.title,
                text: data.text,
                files: [file]
            });

            showNotification('✅ Archivo compartido correctamente', 'success');
            closeExportMenu();
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error compartiendo:', error);
            showNotification('❌ Error al compartir', 'error');
        }
    } finally {
        state.isExporting = false;
        render();
    }
};

async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
}

window.toggleShareOptions = () => {
    state.showShareOptions = !state.showShareOptions;
    render();
};

window.shareExportFull = async () => {
    const data = state.exportMenuData;
    if (!data.blob) {
        showNotification('❌ No hay datos para compartir', 'error');
        return;
    }

    try {
        state.isExporting = true;
        render();

        let jsonText = '';
        if (data.blob.text) {
            jsonText = await data.blob.text();
        } else {
            jsonText = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result || '');
                reader.onerror = reject;
                reader.readAsText(data.blob);
            });
        }

        const copied = await copyTextToClipboard(jsonText);
        if (!copied) {
            throw new Error('copy failed');
        }

        showNotification('✅ Datos FULL copiados al portapapeles', 'success');
        closeExportMenu();
    } catch (error) {
        console.error('Error copiando FULL:', error);
        showNotification('❌ Error al copiar datos FULL', 'error');
    } finally {
        state.isExporting = false;
        render();
    }
};

window.shareExportMini = async () => {
    try {
        state.isExporting = true;
        render();

        const mini = state.employees.map((emp) => {
            const posId = emp.positions && emp.positions.length ? emp.positions[0] : null;
            const pos = posId ? state.positions.find(p => p.id === posId) : null;
            return {
                number: `${emp.number ?? ''}`,
                name: emp.name || '',
                position: pos ? pos.name : ''
            };
        });

        const json = JSON.stringify(mini, null, 2);
        const copied = await copyTextToClipboard(json);
        if (!copied) {
            throw new Error('copy failed');
        }

        showNotification('✅ Datos MINI copiados al portapapeles', 'success');
        closeExportMenu();
    } catch (error) {
        console.error('Error copiando MINI:', error);
        showNotification('❌ Error al copiar datos MINI', 'error');
    } finally {
        state.isExporting = false;
        render();
    }
};

window.openImportFullModal = () => {
    state.showImportFullModal = true;
    state.importFullText = '';
    render();
};

window.closeImportFullModal = () => {
    state.showImportFullModal = false;
    state.importFullText = '';
    render();
};

window.setImportFullText = (value) => {
    state.importFullText = value;
};

function applyFullImport(importedData) {
    state.settings = importedData.data.settings || state.settings;
    state.positions = importedData.data.positions || [];
    state.employees = importedData.data.employees || [];
    state.leaders = importedData.data.leaders || [];
    state.attendance = importedData.data.attendance || {};
    state.tempAssignments = importedData.data.tempAssignments || [];
    state.dayHoursConfig = importedData.data.dayHoursConfig || {};

    saveApplicationData();
    showNotification('✅ Datos importados correctamente', 'success');
    closeImportFullModal();
    closeExportMenu();
    render();
}

window.confirmImportFull = () => {
    try {
        const text = (state.importFullText || '').trim();
        if (!text) {
            showNotification('❌ Pega los datos FULL primero', 'error');
            return;
        }

        const importedData = JSON.parse(text);
        if (!importedData.data) {
            throw new Error('Formato de datos inválido');
        }

        const employeesCount = (importedData.data.employees || []).length;

        // Cerrar el modal de importaciÃ³n antes de mostrar confirmaciÃ³n
        state.showImportFullModal = false;
        render();

        showConfirm({
            title: 'Importar datos FULL',
            message:
                `Se encontraron ${employeesCount} empleados.\n\n` +
                'Esto reemplazará TODOS tus datos actuales por estos nuevos.\n\n' +
                '¿Deseas continuar?',
            confirmText: 'Importar',
            cancelText: 'Cancelar',
            type: 'warning',
            onConfirm: () => applyFullImport(importedData),
            onCancel: () => { }
        });
    } catch (error) {
        console.error('Error importando FULL:', error);
        showNotification('❌ Error al importar: ' + error.message, 'error');
    }
};

window.selectNotesEmployee = (employeeId) => {
    state.notesCenterEmployeeId = employeeId;
    render();
};

window.openNoteEditor = (employeeId, dateKey) => {
    const key = `${employeeId}-${dateKey}`;
    const att = state.attendance[key];
    if (!att || !att.notes) return;

    state.showNotesCenter = true;
    state.showNoteModal = true;
    state.noteModalEmployeeId = employeeId;
    state.noteModalDate = dateKey;
    state.noteModalText = att.notes || '';
    render();
};

window.openNewNote = (employeeId) => {
    if (!employeeId) {
        showNotification('❌ Selecciona un empleado primero', 'error');
        return;
    }
    state.showNotesCenter = true;
    state.showNoteModal = true;
    state.noteModalEmployeeId = employeeId;
    state.noteModalDate = getDateKey(new Date());
    state.noteModalText = '';
    state.notesCenterEmployeeId = employeeId;
    render();
};

window.closeNoteModal = () => {
    state.showNoteModal = false;
    state.noteModalEmployeeId = null;
    state.noteModalDate = '';
    state.noteModalText = '';
    state.showNotesCenter = true;
    render();
};

window.setNoteModalText = (value) => {
    state.noteModalText = value;
};

window.setNoteModalDate = (value) => {
    state.noteModalDate = value;
};

window.saveNoteModal = () => {
    const employeeId = state.noteModalEmployeeId;
    const text = (state.noteModalText || '').trim();
    const dateKey = getDateKey(state.noteModalDate || new Date());

    if (!employeeId) return;
    if (!text) {
        showNotification('âŒ La nota estÃ¡ vacÃ­a', 'error');
        return;
    }

    const emp = state.employees.find(e => e.id === employeeId);
    if (!emp) {
        showNotification('âŒ Empleado no encontrado', 'error');
        return;
    }

    const key = `${employeeId}-${dateKey}`;
    const existing = state.attendance[key] || {
        employeeId: employeeId,
        date: dateKey,
        present: false,
        hoursWorked: 0,
        overtimeHours: 0,
        isHoliday: isDayHoliday(dateKey),
        selectedPosition: emp.positions?.[0] || null,
        multiPosition: false,
        positionHours: [],
        notes: ''
    };

    if (!existing.selectedPosition && emp.positions?.[0]) {
        existing.selectedPosition = emp.positions[0];
    }

    existing.notes = text;
    existing._isDirty = true;
    state.attendance[key] = existing;
    existing.updatedAt = Date.now();

    saveApplicationData();
    showNotification('âœ… Nota guardada', 'success');
    closeNoteModal();
    render();
};

window.deleteNoteModal = () => {
    const employeeId = state.noteModalEmployeeId;
    const dateKey = state.noteModalDate;
    if (!employeeId || !dateKey) return;

    showConfirm({
        title: 'Eliminar nota',
        message: 'Esta acciÃ³n eliminarÃ¡ la nota de este dÃ­a.\nÂ¿Deseas continuar?',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        type: 'warning',
        onConfirm: () => {
            const key = `${employeeId}-${dateKey}`;
            const att = state.attendance[key];
            if (att) {
                att.notes = '';
                att.updatedAt = Date.now();
                att._isDirty = true;
                state.attendance[key] = att;
            }
            saveApplicationData();
            showNotification('âœ… Nota eliminada', 'success');
            closeNoteModal();
            render();
        }
    });
};

window.openNotesCenter = () => {
    state.showNotesCenter = true;
    if (!state.notesCenterEmployeeId) {
        state.notesCenterEmployeeId = null;
    }
    state.showNoteModal = false;
    render();
};

window.closeNotesCenter = () => {
    state.showNotesCenter = false;
    state.notesCenterEmployeeId = null;
    state.showNoteModal = false;
    render();
};

window.backToNotesList = () => {
    state.notesCenterEmployeeId = null;
    render();
};

window.performDownload = () => {
    const data = state.exportMenuData;
    if (!data.blob) return;

    try {
        // Mostrar loading
        state.isExporting = true;
        render();

        const url = URL.createObjectURL(data.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification('✅ Archivo descargado correctamente', 'success');
        closeExportMenu();
    } catch (error) {
        console.error('Error descargando:', error);
        showNotification('❌ Error al descargar', 'error');
    } finally {
        state.isExporting = false;
        render();
    }
};

// Sistema de confirmación modal (reemplaza alert y confirm)
window.showConfirm = (options) => {
    Modal.confirm({
        title: options.title || '¿Estás seguro?',
        message: options.message || '',
        confirmText: options.confirmText || 'Confirmar',
        cancelText: options.cancelText || 'Cancelar',
        type: options.type || 'warning',
        onConfirm: options.onConfirm || (() => { }),
        onCancel: () => {
            if (options.onCancel) options.onCancel();
        }
    });
};

// Funciones obsoletas (compatibilidad)
window.closeConfirmDialog = () => { };
window.confirmAction = () => { };

// Función mejorada de notificación (ya existía pero la mejoramos)
window.showAlert = (message, type = 'info') => {
    showNotification(message, type);
};

// Verificar si empleado estaba activo en una fecha específica
function wasEmployeeActiveOnDate(employee, date) {
    console.log('');
    console.log('🔍 wasEmployeeActiveOnDate() iniciado');
    console.log('   Empleado:', employee.name);
    console.log('   Fecha recibida:', date, '(tipo:', typeof date + ')');

    const dateKey = typeof date === 'string' ? date : getDateKey(date);
    console.log('   dateKey:', dateKey);

    // Si tiene fecha de contratación y la fecha consultada es anterior, no estaba activo
    if (employee.hireDate) {
        console.log('   hireDate:', employee.hireDate);
        console.log('   Comparación:', dateKey, '<', employee.hireDate, '=', dateKey < employee.hireDate);

        if (dateKey < employee.hireDate) {
            console.log('   ❌ RETORNA FALSE: No contratado aún');
            return false;
        }
    } else {
        console.log('   ℹ️ Sin hireDate definido');
    }

    // Si tiene asistencia registrada en esa fecha, definitivamente estaba activo
    const attKey = `${employee.id}-${dateKey}`;
    console.log('   Buscando asistencia con key:', attKey);

    if (state.attendance[attKey]) {
        console.log('   ✅ RETORNA TRUE: Tiene asistencia registrada');
        return true;
    } else {
        console.log('   ℹ️ No tiene asistencia en esta fecha');
    }

    // Si no tiene historial de cambios de estado
    if (!employee.statusHistory || employee.statusHistory.length === 0) {
        console.log('   ℹ️ Sin historial de cambios');
        console.log('   employee.active:', employee.active);
        console.log('   ✅ RETORNA:', employee.active);
        return employee.active;
    }

    // Buscar el estado en la fecha específica usando el historial
    console.log('   📊 Tiene historial, procesando...');
    const sortedHistory = [...employee.statusHistory].sort((a, b) => a.timestamp - b.timestamp);

    // Encontrar el último cambio de estado ANTES o EN la fecha consultada
    let wasActive = employee.active; // Por defecto, el estado actual

    for (let i = sortedHistory.length - 1; i >= 0; i--) {
        const change = sortedHistory[i];
        console.log('   Revisando cambio:', change.date, 'active:', change.active);
        if (change.date <= dateKey) {
            wasActive = change.active;
            console.log('   ✅ Encontrado estado en historial:', wasActive);
            break;
        }
    }

    console.log('   ✅ RETORNA:', wasActive);
    return wasActive;
}

// Verificar si empleado estuvo activo en algún día del rango
function wasEmployeeActiveInRange(employee, startDate, endDate) {
    const start = typeof startDate === 'string' ? startDate : getDateKey(startDate);
    const end = typeof endDate === 'string' ? endDate : getDateKey(endDate);

    // Verificar si tiene asistencia en el rango
    const hasAttendanceInRange = Object.keys(state.attendance).some(key => {
        if (!key.startsWith(employee.id + '-')) return false;
        const dateKey = key.split('-').slice(1).join('-');
        return dateKey >= start && dateKey <= end;
    });

    if (hasAttendanceInRange) return true;

    // Verificar historial de estado
    if (!employee.statusHistory || employee.statusHistory.length === 0) {
        return employee.active;
    }

    // Verificar si estuvo activo en algún punto del rango
    for (let d = new Date(start); d <= new Date(end); d.setDate(d.getDate() + 1)) {
        if (wasEmployeeActiveOnDate(employee, d)) {
            return true;
        }
    }

    return false;
}

// Funciones de posiciones y estados movidas a EmployeesUI.js

window.togglePositionEmployees = (positionId) => {
    const elem = document.getElementById(`pos-employees-${positionId}`);
    if (elem) {
        elem.style.display = elem.style.display === 'none' ? 'block' : 'none';
    }
};

window.toggleLeaderEmployees = (leaderId) => {
    const elem = document.getElementById(`leader-employees-${leaderId}`);
    if (elem) {
        elem.style.display = elem.style.display === 'none' ? 'block' : 'none';
    }
};

document.addEventListener('click', (e) => {
    if (state.contextMenu && !e.target.closest('.context-menu')) {
        state.contextMenu = null;
        render();
    }
    if (state.showDatePicker && !e.target.closest('.date-display') && !e.target.closest('.date-picker-popup')) {
        state.showDatePicker = false;
        state.datePickerTarget = null;
        render();
    }
});

// ============================================
// INDICADOR DE SINCRONIZACIÓN
// ============================================

function SyncIndicator() {
    if (!useSupabase || !currentUser) {
        // No mostrar indicador si no está usando Supabase
        return '';
    }

    const status = state.syncStatus;

    // Definir configuración por estado
    const statusConfig = {
        idle: {
            icon: icons.get('cloud'),
            color: '#64748b',
            text: 'Sin actividad',
            title: 'Nube: Sin actividad'
        },
        syncing: {
            icon: icons.get('sync'),
            color: '#06b6d4',
            text: 'Sincronizando...',
            title: 'Sincronizando con la nube...',
            animate: true
        },
        synced: {
            icon: icons.get('check'),
            color: '#10b981',
            text: 'Sincronizado',
            title: `Última sync: ${state.lastSupabaseSync ? getTimeAgo(new Date(state.lastSupabaseSync)) : 'Nunca'}`
        },
        error: {
            icon: icons.get('x-circle'),
            color: '#ef4444',
            text: 'Error',
            title: 'Error en la sincronización'
        }
    };

    const config = statusConfig[status] || statusConfig.idle;

    return `
                <button 
                    class="settings-btn sync-indicator-btn" 
                    style="
                        color: ${config.color}; 
                        font-size: 1.25rem;
                        position: relative;
                        ${config.animate ? 'animation: spin 2s linear infinite;' : ''}
                    "
                    title="${config.title}"
                    onclick="changeTab('settings')"
                >
                    ${config.icon}
                </button>
            `;
}

// UI Components
function Header() {
    return `<header class="header">
                <div class="container">
                    <div class="header-content">
                        <div class="header-top">
                            <div class="company-name">🏗️ ${state.settings.companyName}</div>
                            <div style="display: flex; gap: 8px;">
                                ${SyncIndicator()}
                                <button class="settings-btn" onclick="openNotesCenter()" title="Notas de empleados">${icons.get('mail')}</button>
                                <button class="settings-btn" onclick="exportData()" title="Exportar datos">${icons.get('download')}</button>
                            </div>
                        </div>
                        <nav class="nav-tabs">
                            <button class="nav-tab ${state.activeTab === 'attendance' ? 'active' : ''}" 
                                    onclick="changeTab('attendance')"
                                    title="Registrar asistencia diaria">
                                <span>${icons.get('attendance')}</span><span class="tab-text"> Asistencia</span>
                            </button>
                            <button class="nav-tab ${state.activeTab === 'employees' || state.activeTab === 'positions' ? 'active' : ''}" 
                                    onclick="changeTab('employees')"
                                    title="Gestionar empleados y posiciones">
                                <span>${icons.get('personnel')}</span><span class="tab-text"> Personal</span>
                            </button>
                            <button class="nav-tab ${state.activeTab === 'employee-report' || state.activeTab === 'dashboard' ? 'active' : ''}" 
                                    onclick="changeTab('employee-report')"
                                    title="Ver reportes y estadísticas">
                                <span>${icons.get('reports')}</span><span class="tab-text"> Reportes</span>
                            </button>
                            <button class="nav-tab ${state.activeTab === 'export' ? 'active' : ''}" 
                                    onclick="changeTab('export')"
                                    title="Nómina">
                                <span>${icons.get('payroll')}</span><span class="tab-text"> Nómina</span>
                            </button>
                            <button class="nav-tab ${state.activeTab === 'settings' ? 'active' : ''}" 
                                    onclick="changeTab('settings')"
                                    title="Configuración del sistema">
                                <span>${icons.get('settings')}</span><span class="tab-text"> Ajustes</span>
                            </button>
                        </nav>
                    </div>
                </div>
            </header>`;
}

function DatePicker() {
    if (!state.showDatePicker) return '';
    const days = getDaysInMonth(state.datePickerMonth);
    const dayNames = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
    const today = getDateKey(new Date());
    const selected = getDateKey(state.selectedDate);

    return `<div class="date-picker-popup">
                <div class="date-picker-header">
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); changeDatePickerMonth(-1)">◀</button>
                    <div class="date-picker-month">${formatMonthYear(state.datePickerMonth)}</div>
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); changeDatePickerMonth(1)">▶</button>
                </div>
                <div class="date-picker-grid">
                    ${dayNames.map(d => `<div class="date-picker-day-label">${d}</div>`).join('')}
                    ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        let cls = ['date-picker-day'];
        if (!currentMonth) cls.push('other-month');
        if (dKey === today) cls.push('today');
        if (dKey === selected) cls.push('selected');
        return `<div class="${cls.join(' ')}" onclick="event.stopPropagation(); selectDate('${date.toISOString()}')">${date.getDate()}</div>`;
    }).join('')}
                </div>
            </div>`;
}

function DateControls() {
    const isHoliday = isDayHoliday(state.selectedDate);
    const isToday = getDateKey(state.selectedDate) === getDateKey(new Date());
    const dayHours = getDayHours(state.selectedDate);
    const showPicker = state.showDatePicker && (state.datePickerTarget || 'full') === 'full';

    // Determinar qué texto mostrar según la vista
    const dateText = state.viewMode === 'week'
        ? getWeekRangeText(state.selectedDate)
        : formatDateShort(state.selectedDate);

    return `<div class="date-controls">
                <div class="date-navigation">
                    <button class="date-btn" onclick="changeDate(-1)">◀</button>
                    <div class="date-display" onclick="toggleDatePicker('full')">
                        ${dateText}
                        ${showPicker ? DatePicker() : ''}
                    </div>
                    <button class="date-btn" onclick="changeDate(1)">▶</button>
                </div>
                
                <div class="view-controls">
                    <button class="view-btn ${state.viewMode === 'day' ? 'active' : ''}" onclick="changeViewMode('day')">Día</button>
                    <button class="view-btn ${state.viewMode === 'week' ? 'active' : ''}" onclick="changeViewMode('week')">Semana</button>
                    <button class="view-btn ${isToday ? 'active' : ''}" onclick="goToToday()">🎯 Hoy</button>
                </div>
                
                ${state.viewMode === 'day' ? `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
                        <div style="display: flex; align-items: center; gap: 6px; background: #1e293b; padding: 8px 10px; border-radius: 8px; border: 1px solid #334155;">
                            <label style="font-size: 0.75rem; color: #94a3b8; white-space: nowrap;">⏱️ Horas:</label>
                            <input type="number" value="${dayHours}" min="0.5" max="24" step="0.5"
                                   onchange="setDayHours(this.value)"
                                   style="flex: 1; background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 6px 8px; border-radius: 6px; font-size: 0.875rem; min-width: 50px;"
                                   title="Horas de trabajo configuradas para este día">
                        </div>
                        <button class="view-btn ${isHoliday ? 'active' : ''}" onclick="markDayAsHoliday()" style="font-size: 0.75rem; padding: 8px 6px;">
                            ${isHoliday ? '☀️ Quitar' : '☀️ Festivo'}
                        </button>
                    </div>
                ` : ''}

                ${state.viewMode === 'week' ? `
                    <div style="display: flex; align-items: center; gap: 8px; background: #1e293b; padding: 8px 12px; border-radius: 8px; border: 1px solid #334155; margin-top: 8px;">
                        <label style="font-size: 0.875rem; color: #94a3b8; white-space: nowrap;">⚡ Horas rápidas:</label>
                        <input type="number" value="${state.quickWeekHours}" min="0.5" max="24" step="0.5"
                               onchange="setQuickWeekHours(this.value)"
                               style="background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 6px 8px; border-radius: 6px; font-size: 0.875rem; width: 70px;"
                               title="Horas que se aplicarán automáticamente al marcar asistencia en vista semanal">
                        <span style="font-size: 0.75rem; color: #64748b;">
                            (Al marcar ✓ se aplicarán estas horas automáticamente)
                        </span>
                    </div>
                ` : ''}
            </div>`;
}

function DateControlsCompact() {
    const dateText = state.viewMode === 'week'
        ? getWeekRangeText(state.selectedDate)
        : formatDateShort(state.selectedDate);
    const showPicker = state.showDatePicker && (state.datePickerTarget || 'full') === 'compact';
    const isVisible = state.isScrolled && (state.activeTab === 'attendance');
    const isWeek = state.viewMode === 'week';

    return `
            <div class="date-controls-compact ${isVisible ? 'visible' : ''} ${isWeek ? 'at-bottom' : ''}">
                <div class="date-navigation">
                    <button class="date-btn" onclick="changeDate(-1)">◀</button>
                    <div class="date-display" onclick="toggleDatePicker('compact')">
                        <span style="display:flex; align-items:center; gap:6px;">
                            ${icons.get('calendar', { size: 14 })}
                            ${dateText}
                        </span>
                        ${showPicker ? DatePicker() : ''}
                    </div>
                    <button class="date-btn" onclick="changeDate(1)">▶</button>
                </div>
            </div>
        `;
}

function StatsGrid() {
    const stats = calculateStats();
    const f = state.employeeFilter;
    const filterNames = {
        present: 'Mostrando solo PRESENTES',
        absent: 'Mostrando solo AUSENTES',
        overtime: 'Mostrando solo con EXTRAS'
    };
    // ⚡ ID único para render selectivo
    return `<div id="day-stats" class="stats-combined"><div class="stats-row">
                <div class="stat-item ${f === 'present' ? 'active' : ''}" onclick="setEmployeeFilter('present')">
                    <div class="stat-icon">✅</div>
                    <div class="stat-value">${stats.present}</div>
                    <div class="stat-label">Presentes</div>
                </div>
                <div class="stat-item ${f === 'absent' ? 'active' : ''}" onclick="setEmployeeFilter('absent')">
                    <div class="stat-icon">❌</div>
                    <div class="stat-value">${stats.absent}</div>
                    <div class="stat-label">Ausentes</div>
                </div>
                <div class="stat-item">
                    <div class="stat-icon">⏱️</div>
                    <div class="stat-value">${stats.totalHours}h</div>
                    <div class="stat-label">Horas</div>
                </div>
                <div class="stat-item ${f === 'overtime' ? 'active' : ''}" onclick="setEmployeeFilter('overtime')">
                    <div class="stat-icon">⚡</div>
                    <div class="stat-value">${stats.overtimeHours}h</div>
                    <div class="stat-label">Extras</div>
                </div>
            </div>${f ? `<div style="margin-top:12px;padding:8px 12px;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.3);border-radius:8px;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;"><span style="font-size:0.875rem;color:#06b6d4;font-weight:600;">🔍 ${filterNames[f]}</span><button onclick="setEmployeeFilter(null)" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:4px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;font-weight:600;">✕ Limpiar</button></div>` : ''}</div>`;
}

function Legend() {
    return `<div class="legend"><div class="legend-header" onclick="toggleLegend()"><div class="legend-title">🎨 Leyenda de Colores</div><div style="color:#64748b;font-size:1.25rem;">${state.showLegend ? '▼' : '▶'}</div></div>${state.showLegend ? '<div class="legend-items"><div class="legend-item"><div class="legend-color check-regular"></div><span class="legend-text">Regular</span></div><div class="legend-item"><div class="legend-color check-multiposition"></div><span class="legend-text">Multi-Pos</span></div><div class="legend-item"><div class="legend-color check-holiday"></div><span class="legend-text">Festivo</span></div><div class="legend-item"><div class="legend-color check-overtime"></div><span class="legend-text">Extras</span></div><div class="legend-item"><div class="legend-color check-undertime"></div><span class="legend-text">Menos</span></div></div>' : ''}</div>`;
}

function PositionFilters() {
    // Deduplicar posiciones por nombre (mantener primera ocurrencia)
    const allActivePositions = state.positions.filter(p => p.active);
    const seenNames = new Set();
    const activePositions = allActivePositions.filter(pos => {
        if (seenNames.has(pos.name)) return false;
        seenNames.add(pos.name);
        return true;
    });
    const activeEmployees = state.employees.filter(e => e.active);

    // Contar empleados por posición (incluir duplicados del mismo nombre)
    const positionCounts = {};
    activePositions.forEach(pos => {
        // Obtener todos los IDs de posiciones con el mismo nombre
        const sameNameIds = allActivePositions
            .filter(p => p.name === pos.name)
            .map(p => p.id);
        positionCounts[pos.id] = activeEmployees.filter(emp =>
            emp.positions.some(pId => sameNameIds.includes(pId))
        ).length;
    });

    const totalCount = activeEmployees.length;
    const currentFilter = state.filters.position;

    return `
                <div class="position-filters-container" style="margin-top: 16px;">
                    <button class="filters-toggle" onclick="toggleFilters()" 
                            style="width: 100%; background: #1e293b; border: 1px solid #334155; padding: 10px 14px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s;">
                        <span style="color: #f1f5f9; font-weight: 600; font-size: 0.875rem;">🎯 Filtrar Posición</span>
                        <span style="font-size: 1.25rem; color: #94a3b8;">${state.showFilters ? '▼' : '▶'}</span>
                    </button>
                    
                    ${state.showFilters ? `
                        <div class="filters-content" style="margin-top: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px;">
                            <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" 
                                    onclick="setPositionFilter('all')"
                                    style="background: ${currentFilter === 'all' ? 'linear-gradient(135deg, #06b6d4, #10b981)' : '#1e293b'}; border: 2px solid ${currentFilter === 'all' ? '#06b6d4' : '#334155'}; padding: 10px; border-radius: 8px; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                                <span style="font-size: 0.875rem; font-weight: 600; color: #f1f5f9;">Todos</span>
                                <span style="font-size: 1.25rem; font-weight: 700; color: ${currentFilter === 'all' ? '#fff' : '#06b6d4'};">${totalCount}</span>
                            </button>
                            
                            ${activePositions.map(pos => `
                                <button class="filter-btn ${currentFilter === pos.id ? 'active' : ''}" 
                                        onclick="setPositionFilter('${pos.id}')"
                                        style="background: ${currentFilter === pos.id ? pos.color : '#1e293b'}; border: 2px solid ${currentFilter === pos.id ? pos.color : '#334155'}; padding: 10px; border-radius: 8px; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                                    <span style="font-size: 0.875rem; font-weight: 600; color: ${currentFilter === pos.id ? '#fff' : '#f1f5f9'};">${pos.name}</span>
                                    <span style="font-size: 1.25rem; font-weight: 700; color: ${currentFilter === pos.id ? '#fff' : pos.color};">${positionCounts[pos.id] || 0}</span>
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
}

function EmployeeRow(emp) {
    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];
    const checkColor = getCheckColor(att, state.selectedDate);
    const isChecked = att && att.present;
    const selPos = att?.selectedPosition || emp.positions?.[0] || null;
    const isMultiPosition = att?.multiPosition || false;
    const hasMultiplePositions = emp.positions.length > 1;

    // Calcular horas y días del mes
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthHours = getEmployeeTotalHours(emp.id, firstDay, today);
    let monthDays = 0;
    let monthOvertimeHours = 0;
    for (let d = new Date(firstDay); d <= today; d.setDate(d.getDate() + 1)) {
        const k = `${emp.id}-${getDateKey(new Date(d))}`;
        const a = state.attendance[k];
        if (a && a.present) {
            monthDays++;
            if (a.overtimeHours) monthOvertimeHours += a.overtimeHours;
        }
    }

    // Obtener posición seleccionada temporalmente (antes de checkear)
    const tempKey = `${emp.id}-${getDateKey(state.selectedDate)}`;
    const selectedPosId = state.tempPositionSelection?.[tempKey] || emp.positions[0];

    // ⚡ ID único para render selectivo
    return `<div id="emp-row-${emp.id}" class="employee-row">
                <div class="employee-info">
                    <div class="employee-header">
                        <div class="employee-number">${emp.number}</div>
                        <div class="employee-name" onclick="openEmployeeFloating('${emp.id}')">${emp.name}${!emp.active ? '<span style="margin-left:8px;padding:2px 8px;background:rgba(239,68,68,0.2);border:1px solid #ef4444;border-radius:6px;font-size:0.65rem;color:#ef4444;font-weight:600;">INACTIVO</span>' : ''}</div>
                    </div>
                    
                    <!-- Botones de posición - SIEMPRE VISIBLES si tiene múltiples posiciones -->
                    ${hasMultiplePositions ? `
                        <div class="position-toggles" style="margin-top: 8px;">
                            ${emp.positions.map(pid => {
        const pos = state.positions.find(p => p.id === pid); if (!pos) return '';
        const isActive = isChecked ? (selPos === pid) : (selectedPosId === pid);
        return `<button class="position-toggle ${isActive ? 'active' : ''}" 
                                               onclick="${isChecked ? `togglePosition('${emp.id}', '${pid}')` : `event.stopPropagation(); selectTempPosition('${emp.id}', '${pid}')`}">
                                    <span class="pos-dot" style="background:${pos.color || "#64748b"};"></span>${pos.name || "PosiciÃ³n"}
                                </button>`;
    }).join('')}
                        </div>
                    ` : `
                        <!-- Empleado con una sola posición -->
                        <div class="position-toggles" style="margin-top: 8px;">
                            ${emp.positions.map(pid => {
        const pos = state.positions.find(p => p.id === pid); if (!pos) return '';
        return `<span class="position-toggle" style="opacity:0.7;cursor:default;">
                                    <span class="pos-dot" style="background:${pos.color || "#64748b"};"></span>${pos.name || "PosiciÃ³n"}
                                </span>`;
    }).join('')}
                        </div>
                    `}
                    
                    <!-- Desglose si es multi-posición -->
                    ${isMultiPosition ? `
                        <div class="multi-position-breakdown" style="margin-top: 8px; padding: 8px; background: #1e293b; border-radius: 6px; border: 1px solid #334155;">
                            <div style="font-size: 0.75rem; color: #06b6d4; margin-bottom: 4px; font-weight: 600;">🔄 Múltiples Posiciones:</div>
                            ${att.positionHours.map(ph => {
        const pos = state.positions.find(p => p.id === ph.positionId);
        return `<div style="display: flex; align-items: center; gap: 8px; font-size: 0.875rem; margin-bottom: 4px;">
                                    <span style="width: 8px; height: 8px; border-radius: 50%; background: ${pos?.color || '#64748b'};"></span>
                                    <span style="flex: 1; color: #f1f5f9;">${pos?.name || '?'}</span>
                                    <span style="color: #10b981; font-weight: 600;">${ph.hours}h${ph.overtimeHours > 0 ? ` +${ph.overtimeHours}h` : ''}</span>
                                </div>`;
    }).join('')}
                        </div>
                    ` : ''}
                    
                    <div class="employee-meta">
                        <div class="employee-meta-item">📅 ${monthDays} días</div>
                        <div class="employee-meta-divider"></div>
                        <div class="employee-meta-item">⏱️ ${monthHours}h</div>
                        ${monthOvertimeHours > 0 ? `<div class="employee-meta-divider"></div><div class="employee-meta-item" style="color:#06b6d4;">⚡ +${monthOvertimeHours}h extras mes</div>` : ''}
                    </div>
                    
                    <div class="employee-meta" style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #1e293b; min-height: 24px; display: flex; align-items: center; overflow: hidden;">
                        ${isChecked && att.hoursWorked > state.settings.regularHoursPerDay ? `
                            <div class="employee-meta-item" style="color: #3b82f6; font-weight: 600; white-space: nowrap; flex-shrink: 0;">⚡ +${(att.hoursWorked - state.settings.regularHoursPerDay).toFixed(1)}h extras</div>
                        ` : ''}
                        
                        ${isChecked && att.hoursWorked > state.settings.regularHoursPerDay && att.notes && att.notes.trim() ? `
                            <div class="employee-meta-divider"></div>
                        ` : ''}

                        ${isChecked && att.notes && att.notes.trim() ? `
                            <div class="employee-meta-item" style="color: #94a3b8; font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; flex: 1;" 
                                 onclick="event.stopPropagation(); openAdvancedAttendance('${emp.id}')" 
                                 title="${att.notes.replace(/"/g, '&quot;')}">
                                📝 ${att.notes}
                            </div>
                        ` : ''}
                        
                        ${(!isChecked || (att.hoursWorked <= state.settings.regularHoursPerDay && (!att.notes || !att.notes.trim()))) ? `
                            <div style="height: 20px;"></div>
                        ` : ''}
                    </div>
                </div>
                
                <!-- CHECK Y BOTÓN [+] SIEMPRE VISIBLES -->
                <div style="display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: flex-start; min-width: 80px; width: 80px; flex-shrink: 0;">
                    <label class="check-container" style="position: relative;">
                        <input type="checkbox" class="check-input" ${isChecked ? 'checked' : ''} 
                               onclick="handleCheckboxClick(event, '${emp.id}')">
                        <div class="check-box ${checkColor}">${isChecked ? '✓' : ''}</div>
                        ${isChecked ? `
                            <div class="hours-badge">
                                ${att.hoursWorked}h${isMultiPosition ? ' 🔄' : ''}
                                ${att.notes && att.notes.trim() ? '<span style="margin-left: 4px;" title="' + att.notes.replace(/"/g, '&quot;') + '">📝</span>' : ''}
                            </div>
                        ` : ''}
                    </label>
                    
                    <!-- ⚡ FIX: Siempre reservar espacio para botón [+], pero invisible si no se necesita -->
                    ${isChecked && hasMultiplePositions ? `
                        <button onclick="event.stopPropagation(); openAdvancedAttendance('${emp.id}')" 
                                style="width: 40px; height: 40px; border-radius: 8px; background: #1e293b; border: 2px solid #334155; color: #06b6d4; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center;"
                                onmouseover="this.style.borderColor='#06b6d4'; this.style.background='rgba(6, 182, 212, 0.1)'"
                                onmouseout="this.style.borderColor='#334155'; this.style.background='#1e293b'"
                                title="Agregar otra posición o modificar horas">
                            +
                        </button>
                    ` : `
                        <div style="width: 40px; height: 40px;"></div>
                    `}
                </div>
            </div>`;
}


function DayViewList() {
    const dateKey = getDateKey(state.selectedDate);
    // Filtrar empleados que estaban activos en esta fecha
    let employees = state.employees.filter(emp => wasEmployeeActiveOnDate(emp, state.selectedDate));

    // 🔢 ORDENAR POR NÚMERO (Orden natural)
    employees.sort((a, b) => (a.number || '').localeCompare(b.number || '', 'es', { numeric: true }));

    // 🔍 APLICAR FILTRO DE LÍDER
    if (state.filters.leaderId && state.filters.leaderId !== 'all') {
        employees = employees.filter(emp => {
            return emp.positions?.some(pid => {
                const pos = state.positions.find(p => p.id === pid); if (!pos) return '';
                return pos && pos.leaderId === state.filters.leaderId;
            });
        });
    }

    // 🔍 APLICAR FILTRO DE BÚSQUEDA
    if (state.filters.search) {
        const term = state.filters.search;
        employees = employees.filter(emp => {
            const matchesName = emp.name.toLowerCase().includes(term);
            const matchesNumber = emp.number.toLowerCase().includes(term);

            // Buscar también en los nombres de las posiciones
            const matchesPosition = emp.positions?.some(pid => {
                const pos = state.positions.find(p => p.id === pid); if (!pos) return '';
                return pos && pos.name.toLowerCase().includes(term);
            });

            return matchesName || matchesNumber || matchesPosition;
        });
    }

    // Aplicar filtro de asistencia si está activo
    if (state.employeeFilter === 'present') {
        employees = employees.filter(emp => {
            const key = `${emp.id}-${dateKey}`;
            const att = state.attendance[key];
            return att && att.present;
        });
    } else if (state.employeeFilter === 'absent') {
        employees = employees.filter(emp => {
            const key = `${emp.id}-${dateKey}`;
            const att = state.attendance[key];
            return !att || !att.present;
        });
    } else if (state.employeeFilter === 'overtime') {
        employees = employees.filter(emp => {
            const key = `${emp.id}-${dateKey}`;
            const att = state.attendance[key];
            return att && att.present && att.hoursWorked > state.settings.regularHoursPerDay;
        });
    }

    // Aplicar filtro de posición
    if (state.filters.position !== 'all') {
        employees = employees.filter(emp =>
            emp.positions.includes(state.filters.position)
        );
    }

    if (employees.length === 0) {
        return '<div style="text-align:center;padding:40px 20px;color:#64748b;"><div style="font-size:3rem;margin-bottom:12px;opacity:0.3;">🔍</div><div style="font-size:1rem;">No hay empleados que coincidan con los filtros</div></div>';
    }

    return employees.map(emp => EmployeeRow(emp)).join('');
}

function DayView() {
    return `${StatsGrid()}${PositionFilters()}${Legend()}${SearchBar()}${DateControlsCompact()}<div id="day-view-list">${DayViewList()}</div>`;
}

function WeekViewTable() {
    const week = getWeekDates(new Date(state.selectedDate));
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    // Filtrar empleados que estuvieron activos en algún día de la semana
    const startDate = week[0];
    const endDate = week[6];
    let activeEmployees = state.employees.filter(emp =>
        wasEmployeeActiveInRange(emp, startDate, endDate)
    );

    // 🔢 ORDENAR POR NÚMERO (Orden natural)
    activeEmployees.sort((a, b) => (a.number || '').localeCompare(b.number || '', 'es', { numeric: true }));

    // 🔍 APLICAR FILTRO DE LÍDER
    if (state.filters.leaderId && state.filters.leaderId !== 'all') {
        activeEmployees = activeEmployees.filter(emp => {
            // Un empleado aparece si cualquiera de sus posiciones es liderada por el líder seleccionado
            return emp.positions?.some(pid => {
                const pos = state.positions.find(p => p.id === pid); if (!pos) return '';
                return pos && pos.leaderId === state.filters.leaderId;
            });
        });
    }

    // 🔍 APLICAR FILTRO DE BÚSQUEDA
    if (state.filters.search) {
        const term = state.filters.search;
        activeEmployees = activeEmployees.filter(emp => {
            const matchesName = emp.name.toLowerCase().includes(term);
            const matchesNumber = emp.number.toLowerCase().includes(term);

            // Buscar también en los nombres de las posiciones
            const matchesPosition = emp.positions?.some(pid => {
                const pos = state.positions.find(p => p.id === pid); if (!pos) return '';
                return pos && pos.name.toLowerCase().includes(term);
            });

            return matchesName || matchesNumber || matchesPosition;
        });
    }

    if (activeEmployees.length === 0) {
        return `
                    <div style="text-align:center;padding:60px 20px;color:#64748b;">
                        <div style="font-size:5rem;margin-bottom:24px;opacity:0.3;">👷</div>
                        <h3 style="font-size:1.5rem;color:#f1f5f9;margin-bottom:12px;">No hay empleados activos</h3>
                        <p style="font-size:0.875rem;color:#94a3b8;margin-bottom:32px;">Agrega empleados para comenzar a registrar asistencia</p>
                        <button onclick="changeTab('employees')" class="btn btn-primary" style="padding: 12px 32px;">
                            ➕ Agregar Empleados
                        </button>
                    </div>
                `;
    }

    return `
                <div class="week-table-container">
                    <table class="week-table">
                        <thead>
                            <tr>
                                <th style="text-align:left;">Empleado</th>
                                ${week.map((d, i) => {
        const isH = isDayHoliday(d);
        const showYear = d.getFullYear() !== new Date().getFullYear();
        return `
                                        <th>
                                            <div>${days[i]}${isH ? ' ☀️' : ''}</div>
                                            <div style="font-size:0.7rem;color:#64748b;">
                                                ${d.getDate()}/${d.getMonth() + 1}${showYear ? `/${d.getFullYear()}` : ''}
                                            </div>
                                        </th>
                                    `;
    }).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${activeEmployees.map(emp => {
        return `
                                    <tr>
                                        <td>
                                            <div class="week-employee-cell">
                                                <div class="employee-number">${emp.number}</div>
                                                <div class="week-employee-name-container">
                                                    <div class="week-employee-name">${emp.name}</div>
                                                    <div class="week-employee-positions" style="font-size: 0.65rem; color: #94a3b8; margin-top: 2px;">
                                                        ${emp.positions?.map(pid => state.positions.find(p => p.id === pid)?.name).filter(Boolean).join(' • ') || 'Sin posición'}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        ${week.map(date => {
            const dKey = getDateKey(date);
            const aKey = `${emp.id}-${dKey}`;
            const att = state.attendance[aKey];
            const isCh = att && att.present;
            const cColor = getCheckColor(att, date);
            const selP = att?.selectedPosition || emp.positions?.[0] || null;

            // ID único para cada checkbox
            const checkId = `check-${emp.id}-${dKey}`;

            return `
                                                <td>
                                                    <div class="day-cell">
                                                        <!-- Checkbox clickable -->
                                                        <div class="week-check-wrapper" onclick="event.stopPropagation(); handleWeekCheck('${emp.id}', '${dKey}')">
                                                            <div class="check-box week-check-box ${cColor}">
                                                                ${isCh ? '✓' : ''}
                                                            </div>
                                                            ${isCh ? `<div class="hours-badge">${att.hoursWorked}h</div>` : ''}
                                                        </div>
                                                        
                                                        <!-- Botones de posiciones multi (si aplica) -->
                                                        ${isCh && emp.positions?.length > 1 ? `
                                                            <div class="week-position-toggles">
                                                                ${emp.positions.map(pid => {
                const pos = state.positions.find(p => p.id === pid); if (!pos) return '';
                if (!pos) return '';
                const isSel = selP === pid;
                return `
                                                                        <button 
                                                                            class="week-position-toggle ${isSel ? 'active' : ''}" 
                                                                            onclick="event.stopPropagation(); toggleWeekPosition('${emp.id}', '${pid}', '${dKey}')"
                                                                        >
                                                                            ${pos.name.substring(0, 3)}
                                                                        </button>
                                                                    `;
            }).filter(Boolean).join('')}
                                                            </div>
                                                        ` : ''}
                                                    </div>
                                                </td>
                                            `;
        }).join('')}
                                    </tr>
                                `;
    }).join('')}
                            
                            <!-- Fila de totales -->
                            <tr style="background: linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(16, 185, 129, 0.1)); border-top: 2px solid #06b6d4;">
                                <td style="padding: 12px 16px;">
                                    <div style="font-weight: 700; color: #06b6d4; font-size: 0.875rem;">TOTALES</div>
                                </td>
                                ${week.map(date => {
        const dKey = getDateKey(date);
        const dayAttendance = Object.values(state.attendance).filter(a =>
            a.date === dKey && a.present
        );
        const totalHours = dayAttendance.reduce((sum, a) => sum + (a.hoursWorked || 0), 0);
        const presentCount = dayAttendance.length;

        return `
                                        <td style="text-align: center; padding: 12px 8px;">
                                            <div style="color: #06b6d4; font-weight: 700; font-size: 1rem; margin-bottom: 4px;">${presentCount}</div>
                                            <div style="font-size: 0.7rem; color: #94a3b8;">${totalHours.toFixed(1)}h</div>
                                        </td>
                                    `;
    }).join('')}
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;
}

function WeekView() {
    return `${SearchBar()}${DateControlsCompact()}<div id="week-view-list">${WeekViewTable()}</div>`;
}

// ============================================
// LEGACY EMPLOYEES UI — Removed (now in EmployeesUI.js)
// ============================================

// [LEGACY REMOVED] EmployeesTab, EmployeeCard, LeaderCard, PositionsTab, PositionCard -> EmployeesUI.js
window.setSearchFilter = debounce((value) => {
    state.filters.search = value.trim().toLowerCase();

    // Renderizado selectivo para mantener el foco en el input
    const dayList = document.getElementById('day-view-list');
    const weekList = document.getElementById('week-view-list');

    if (state.viewMode === 'day' && dayList) {
        dayList.innerHTML = DayViewList();
    } else if (state.viewMode === 'week' && weekList) {
        weekList.innerHTML = WeekViewTable();
    } else {
        render();
    }
}, 300);

function SearchBar() {
    const searchValue = state.filters.search || '';
    const leaderFilter = state.filters.leaderId || 'all';

    return `
                <div class="search-container" style="margin-bottom: 16px; display: flex; gap: 12px; width: 100%;">
                    <!-- Búsqueda (3/5 del espacio) -->
                    <div style="position: relative; flex: 3;">
                        <input type="text" 
                               id="search-input"
                               value="${searchValue}"
                               oninput="setSearchFilter(this.value)"
                               placeholder="🔍 Buscar por nombre, número o posición..."
                               style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #f1f5f9; padding: 10px 12px; padding-left: 36px; border-radius: 8px; font-size: 0.875rem;">
                        <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 1rem; opacity: 0.5;">🔍</span>
                        ${searchValue ? `
                            <button onclick="setSearchFilter('');" 
                                    style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px;">
                                 ✕
                            </button>
                        ` : ''}
                    </div>

                    <!-- Filtro de Líder (2/5 del espacio) -->
                    <div style="flex: 2; position: relative;">
                        <div style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 1rem; opacity: 0.5;">
                            ${icons.get('key')}
                        </div>
                        <select onchange="setLeaderFilter(this.value)" 
                                style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #f1f5f9; padding: 10px 12px; padding-left: 36px; border-radius: 8px; font-size: 0.875rem; cursor: pointer; outline: none; appearance: none; -webkit-appearance: none;">
                            <option value="all" ${leaderFilter === 'all' ? 'selected' : ''}>Todos</option>
                            ${state.leaders.filter(l => l.active).map(l => `
                                <option value="${l.id}" ${leaderFilter === l.id ? 'selected' : ''}>
                                    ${l.name}
                                </option>
                            `).join('')}
                        </select>
                        <span style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; opacity: 0.5;">▼</span>
                    </div>
                </div>
            `;
}

function AttendanceTab() {
    return `${DateControls()}${state.viewMode === 'day' ? DayView() : WeekView()}`;
}

// ============================================
// 📅 MARCADORES DE FECHA — FloatingCard
// ============================================
function getDateMarker(emp, dateKey) {
    const markers = [];

    // 🎯 Fecha de contratación
    if (emp.hireDate === dateKey) {
        markers.push('🎯');
    }

    // 🔴/🟢 Última activación/desactivación
    if (emp.statusHistory && emp.statusHistory.length > 0) {
        const lastChange = emp.statusHistory[emp.statusHistory.length - 1];
        if (lastChange.date === dateKey) {
            markers.push(lastChange.active ? '🟢' : '🔴');
        }
    }

    // 💵 Fecha del último pago
    if (state.settings?.lastPaymentDate === dateKey) {
        markers.push('💵');
    }

    // 📅 Fecha del próximo pago
    if (state.settings?.nextPaymentDate === dateKey) {
        markers.push('📅');
    }

    if (markers.length === 0) return '';

    return `<div class="calendar-day-markers" style="position:absolute; bottom:2px; left:50%; transform:translateX(-50%); display:flex; gap:1px; font-size:0.6rem; line-height:1;">${markers.join('')}</div>`;
}

function FloatingCard() {
    if (!state.showFloatingCard || !state.floatingCardEmployee) return '';
    const emp = state.floatingCardEmployee;
    const days = getDaysInMonth(state.floatingCardMonth);
    const dayN = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
    const today = getDateKey(new Date());
    const l7 = new Date(); l7.setDate(l7.getDate() - 6);
    const h7 = getEmployeeTotalHours(emp.id, l7, new Date());
    const fm = new Date(); fm.setDate(1);
    const hm = getEmployeeTotalHours(emp.id, fm, new Date());
    const chartData = chartService.getChartData(emp.id, state.chartPeriod);
    const maxH = Math.max(...chartData.map(d => d.regular + d.overtime + d.holiday + d.absent), 1);
    const scale = 140 / maxH;

    return `<div class="overlay" onclick="closeFloatingCard()"></div><div class="floating-card" onclick="event.stopPropagation()"><div class="floating-card-header"><div class="floating-card-title">👤 ${emp.name}</div><button class="floating-card-close" onclick="closeFloatingCard()">✕</button></div><div class="stats-compact"><div class="stat-compact"><div class="stat-compact-label">Últimos 7 días</div><div class="stat-compact-value">${h7}h</div></div><div class="stat-compact"><div class="stat-compact-label">Este mes</div><div class="stat-compact-value">${hm}h</div></div></div><div class="calendar-compact"><div class="calendar-nav"><button class="calendar-nav-btn" onclick="changeFloatingMonth(-1)">◀</button><div class="calendar-month">${formatMonthYear(state.floatingCardMonth)}</div><button class="calendar-nav-btn" onclick="changeFloatingMonth(1)">▶</button></div><div class="calendar-header">${dayN.map(d => `<div class="calendar-header-day">${d}</div>`).join('')}</div><div class="calendar-grid">${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        const aKey = `${emp.id}-${dKey}`;
        const att = state.attendance[aKey];
        const isT = dKey === today;
        let cls = ['calendar-day'];
        if (!currentMonth) cls.push('other-month');
        if (att && att.present) {
            cls.push('has-attendance');
            const col = getCheckColor(att, date).replace('check-', '');
            cls.push(col);
        }
        if (isT) cls.push('today');
        return `<div class="${cls.join(' ')}"><div>${date.getDate()}</div>${att && att.present ? `<div class="calendar-day-hours">${att.hoursWorked}h</div>` : ''}${getDateMarker(emp, dKey)}</div>`;
    }).join('')}</div></div><div class="chart-compact"><div class="chart-compact-header"><div class="chart-compact-title">📈 ${state.chartPeriod === 'all' ? 'Historial por Meses' : 'Asistencia y Horas'}</div><div class="chart-filter"><button class="chart-filter-btn ${state.chartPeriod === 'week' ? 'active' : ''}" onclick="changeChartPeriod('week')">7D</button><button class="chart-filter-btn ${state.chartPeriod === 'month' ? 'active' : ''}" onclick="changeChartPeriod('month')">Mes</button><button class="chart-filter-btn ${state.chartPeriod === 'all' ? 'active' : ''}" onclick="changeChartPeriod('all')">Todo</button></div></div><div class="chart-bars">${chartData.map(d => {
        const tot = (d.regular + d.overtime + d.holiday + d.absent) * scale;
        const rH = d.regular * scale;
        const oH = d.overtime * scale;
        const hH = d.holiday * scale;
        const aH = d.absent * scale;
        return `<div class="chart-bar-wrapper"><div class="chart-bar" style="height:${Math.max(tot, 10)}px;">${d.absent > 0 ? `<div class="chart-segment absent" style="height:${aH}px;"></div>` : ''}${d.regular > 0 ? `<div class="chart-segment regular" style="height:${rH}px;"></div>` : ''}${d.overtime > 0 ? `<div class="chart-segment overtime" style="height:${oH}px;"></div>` : ''}${d.holiday > 0 ? `<div class="chart-segment holiday" style="height:${hH}px;"></div>` : ''}</div><div class="chart-bar-label">${d.label || `${d.date.getDate()}/${d.date.getMonth() + 1}`}</div></div>`;
    }).join('')}</div></div>

                        <!-- 📝 VISTA PREVIA DE NOTAS GENERALES -->
                        ${emp.notes && emp.notes.trim() ? `
                            <div style="padding: 12px 16px; border-top: 1px solid #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: rgba(15, 23, 42, 0.5);" 
                                 title="${emp.notes.replace(/"/g, '&quot;')}">
                                <div style="color: #94a3b8; font-size: 0.8rem; display: flex; align-items: center; gap: 8px;">
                                    <span>📝</span>
                                    <span style="overflow: hidden; text-overflow: ellipsis;">${emp.notes}</span>
                                </div>
                            </div>
                        ` : ''}

    <div style="padding: 16px; border-top: 1px solid #334155;"><button onclick="openEmployeeProfile('${emp.id}')" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #06b6d4, #10b981); border: none; border-radius: 8px; color: #000; font-weight: 700; cursor: pointer; font-size: 0.875rem; transition: all 0.2s;">👤 Ver Perfil Completo</button></div></div>`;
}

function EmployeeFormModal() {
    const emp = state.editingEmployee;
    const isEdit = !!emp;
    const title = isEdit ? `Editar Empleado - ${emp.name}` : 'Nuevo Empleado';

    const usesCustom = emp?.customSalary !== null && emp?.customSalary !== undefined;

    // Generar número sugerido para nuevo empleado
    const suggestedNumber = isEdit ? emp.number : (() => {
        const maxNum = Math.max(0, ...state.employees.map(e => parseInt(e.number) || 0));
        return String(maxNum + 1).padStart(3, '0');
    })();

    // Auto-expandir campos opcionales si tienen contenido
    const hasOptionalContent = emp?.phone || emp?.email || emp?.notes;
    const showOptional = state.showOptionalFields || hasOptionalContent;

    // Inicializar sueldos personalizados por posición si no existen
    if (!state.tempPositionSalaries) {
        state.tempPositionSalaries = emp?.positionSalaries || {};
    }

    // ⚡ NUEVO: Date picker para fecha de contratación
    const hireDateValue = emp?.hireDate || new Date().toISOString().split('T')[0];
    const hireDateDisplay = new Date(hireDateValue + 'T00:00:00').toLocaleDateString('es-DO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    // Inicializar mes del date picker si no existe
    if (!state.hireDatePickerMonth) {
        state.hireDatePickerMonth = new Date(hireDateValue + 'T00:00:00');
    }

    return `<div class="modal-overlay" onclick="if(event.target === this) closeModal()">
                <div class="modal-content" style="max-width: 600px;">
                    <div class="modal-header">
                        <h2 class="modal-title" style="font-size: 1.25rem;">${title}</h2>
                        <button class="modal-close" onclick="closeModal()">✕</button>
                    </div>
                    <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
                        <div class="form-group">
                            <label class="form-label" style="font-size: 0.875rem;">🔢 Número</label>
                            <input type="text" id="empNumber" class="form-input" value="${suggestedNumber}" placeholder="001" required pattern="[0-9A-Za-z-]+" maxlength="10">
                            <div style="font-size: 0.7rem; color: #64748b; margin-top: 4px;">
                                Aparece en la lista de asistencia
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label" style="font-size: 0.875rem;">📝 Nombre Completo *</label>
                            <input type="text" id="empName" class="form-input" value="${emp?.name || ''}" placeholder="Miguel Rodríguez" required>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label" style="font-size: 0.875rem;">📅 Fecha de Contratación</label>
                            <input type="date" id="empHireDate" class="form-input"
                                   value="${hireDateValue}"
                                   max="${getDateKey(new Date())}">
                            <div style="font-size: 0.7rem; color: #64748b; margin-top: 4px;">
                                ${isEdit ? 'Puedes modificar si es necesario' : 'Ajusta si el empleado ya trabajaba antes'}
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label" style="font-size: 0.875rem;">🎯 Posiciones * (Al menos 1)</label>
                            <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px; max-height: 300px; overflow-y: auto; padding-right: 8px;">
                                ${state.positions.filter(p => p.active || emp?.positions?.includes(p.id)).map(pos => {
        const isChecked = emp?.positions?.includes(pos.id);
        const posSalary = pos.salaryConfig?.amount ?? pos.baseSalary ?? 0;
        const customSalary = state.tempPositionSalaries[pos.id] || '';

        return `<div style="background: #1e293b; padding: 10px; border-radius: 8px; border: 1px solid #334155;">
                                        <label class="form-checkbox" style="cursor: pointer; margin-bottom: 6px;">
                                            <input type="checkbox" name="empPosition" value="${pos.id}" ${isChecked ? 'checked' : ''}
                                                   onchange="
                                                       const salaryInput = document.getElementById('salary-${pos.id}');
                                                       if (this.checked) {
                                                           salaryInput.style.display = 'block';
                                                       } else {
                                                           salaryInput.style.display = 'none';
                                                           salaryInput.value = '';
                                                           delete state.tempPositionSalaries['${pos.id}'];
                                                       }
                                                   ">
                                            <span style="display: flex; align-items: center; gap: 8px; flex: 1;">
                                                <span style="width: 10px; height: 10px; border-radius: 50%; background: ${pos.color}; flex-shrink: 0;"></span>
                                                <span style="font-size: 0.875rem; font-weight: 600; color: #f1f5f9;">${pos.name}</span>
                                                <span style="margin-left: auto; font-size: 0.75rem; color: #06b6d4;">$${posSalary.toLocaleString()}</span>
                                            </span>
                                        </label>
                                        <div id="salary-${pos.id}" style="display: ${isChecked ? 'block' : 'none'}; margin-left: 24px;">
                                            <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">
                                                💰 Sueldo personalizado (opcional):
                                            </label>
                                            <input type="number" 
                                                   class="form-input" 
                                                   style="font-size: 0.875rem; padding: 6px 10px;"
                                                   value="${customSalary}" 
                                                   placeholder="Dejar vacío para usar $${posSalary.toLocaleString()}" 
                                                   min="0" 
                                                   step="1000"
                                                   onchange="state.tempPositionSalaries['${pos.id}'] = this.value ? parseFloat(this.value) : null;">
                                        </div>
                                    </div>`;
    }).join('')}
                            </div>
                            <div style="font-size: 0.7rem; color: #64748b; margin-top: 8px;">
                                💡 Cada posición puede tener un sueldo diferente
                            </div>
                        </div>
                        
                        <!-- Botón para expandir campos opcionales -->
                        <div style="margin: 16px 0;">
                            <button type="button" 
                                    onclick="state.showOptionalFields = !state.showOptionalFields; render();" 
                                    style="width: 100%; padding: 10px; background: transparent; border: 1px dashed #334155; border-radius: 8px; color: #94a3b8; cursor: pointer; font-size: 0.75rem; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 6px;"
                                    onmouseover="this.style.borderColor='#06b6d4'; this.style.color='#06b6d4'"
                                    onmouseout="this.style.borderColor='#334155'; this.style.color='#94a3b8'">
                                <span>${showOptional ? '▼' : '▶'}</span>
                                <span>${showOptional ? 'Ocultar' : 'Mostrar'} campos opcionales</span>
                            </button>
                        </div>
                        
                        <!-- Campos opcionales colapsables -->
                        ${showOptional ? `
                            <div class="form-group" style="animation: slideDown 0.3s ease-out;">
                                <label class="form-label" style="font-size: 0.875rem;">📞 Teléfono</label>
                                <input type="tel" id="empPhone" class="form-input" value="${emp?.phone || ''}" placeholder="+1-809-555-1234">
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label" style="font-size: 0.875rem;">📧 Email</label>
                                <input type="email" id="empEmail" class="form-input" value="${emp?.email || ''}" placeholder="empleado@ejemplo.com">
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label" style="font-size: 0.875rem;">📝 Notas</label>
                                <textarea id="empNotes" class="form-textarea" placeholder="Observaciones, recordatorios..." style="min-height: 80px;">${emp?.notes || ''}</textarea>
                            </div>
                        ` : `
                            <!-- Campos ocultos pero con valores preservados -->
                            <input type="hidden" id="empPhone" value="${emp?.phone || ''}">
                            <input type="hidden" id="empEmail" value="${emp?.email || ''}">
                            <textarea id="empNotes" style="display: none;">${emp?.notes || ''}</textarea>
                        `}
                        
                        ${isEdit ? `<div class="modal-info" style="margin-top: 16px; padding: 12px; background: #1e293b; border-radius: 8px; border: 1px solid #334155;">
                            <div style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 8px; text-transform: uppercase; font-weight: 700;">
                                Información del Sistema
                            </div>
                            <div class="info-row" style="font-size: 0.75rem;">
                                <span class="info-label">ID:</span>
                                <span class="info-value">${emp.key || emp.id}</span>
                            </div>
                            <div class="info-row" style="font-size: 0.75rem;">
                                <span class="info-label">Creado:</span>
                                <span class="info-value">${emp.createdDate ? new Date(emp.createdDate).toLocaleDateString('es-DO') : 'N/A'}</span>
                            </div>
                            ${emp.lastStatusChange ? `<div class="info-row" style="font-size: 0.75rem;">
                                <span class="info-label">${emp.active ? 'Activado' : 'Desactivado'}:</span>
                                <span class="info-value">${new Date(emp.lastStatusChange).toLocaleDateString('es-DO')}</span>
                            </div>` : ''}
                        </div>` : ''}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="saveEmployee()">💾 Guardar</button>
                    </div>
                </div>
            </div>`;
}

function EmployeeProfileModal() {
    if (!state.showEmployeeProfile) return '';

    const empId = state.employeeProfile.employeeId;
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return '';

    const activeTab = state.employeeProfile.activeTab;

    return `<div class="modal-overlay" onclick="if(event.target === this) closeEmployeeProfile()" style="z-index: 2000;">
                <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column;">
                    <!-- Header -->
                    <div class="modal-header" style="flex-shrink: 0;">
                        <button onclick="closeEmployeeProfile()" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 1.25rem; padding: 4px 8px;">
                            ← Volver
                        </button>
                        <h2 class="modal-title" style="font-size: 1.25rem;">👤 ${emp.name}</h2>
                        <div style="display: flex; gap: 8px;">
                            <button onclick="openEmployeeForm('${emp.id}')" style="width: 32px; height: 32px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #06b6d4;">
                                ✏️
                            </button>
                            <button class="modal-close" onclick="closeEmployeeProfile()">✕</button>
                        </div>
                    </div>
                    
                    <!-- Tabs -->
                    <div style="display: flex; gap: 4px; padding: 0 20px; border-bottom: 1px solid #334155; flex-shrink: 0; overflow-x: auto;">
                        <button onclick="changeProfileTab('resumen')" style="padding: 12px 16px; background: ${activeTab === 'resumen' ? '#1e293b' : 'transparent'}; border: none; border-bottom: 2px solid ${activeTab === 'resumen' ? '#06b6d4' : 'transparent'}; color: ${activeTab === 'resumen' ? '#06b6d4' : '#94a3b8'}; cursor: pointer; font-size: 0.875rem; font-weight: 600; white-space: nowrap;">
                            📊 Resumen
                        </button>
                        <button onclick="changeProfileTab('nomina')" style="padding: 12px 16px; background: ${activeTab === 'nomina' ? '#1e293b' : 'transparent'}; border: none; border-bottom: 2px solid ${activeTab === 'nomina' ? '#06b6d4' : 'transparent'}; color: ${activeTab === 'nomina' ? '#06b6d4' : '#94a3b8'}; cursor: pointer; font-size: 0.875rem; font-weight: 600; white-space: nowrap;">
                            💰 Nómina
                        </button>
                        <button onclick="changeProfileTab('asistencia')" style="padding: 12px 16px; background: ${activeTab === 'asistencia' ? '#1e293b' : 'transparent'}; border: none; border-bottom: 2px solid ${activeTab === 'asistencia' ? '#06b6d4' : 'transparent'}; color: ${activeTab === 'asistencia' ? '#06b6d4' : '#94a3b8'}; cursor: pointer; font-size: 0.875rem; font-weight: 600; white-space: nowrap;">
                            📅 Asistencia
                        </button>
                        <button onclick="changeProfileTab('documentos')" style="padding: 12px 16px; background: ${activeTab === 'documentos' ? '#1e293b' : 'transparent'}; border: none; border-bottom: 2px solid ${activeTab === 'documentos' ? '#06b6d4' : 'transparent'}; color: ${activeTab === 'documentos' ? '#06b6d4' : '#94a3b8'}; cursor: pointer; font-size: 0.875rem; font-weight: 600; white-space: nowrap;">
                            📄 Documentos
                        </button>
                    </div>
                    
                    <!-- Content -->
                    <div class="modal-body" style="flex: 1; overflow-y: auto; padding: 20px;">
                        ${activeTab === 'resumen' ? ProfileTabResumen(emp) : ''}
                        ${activeTab === 'nomina' ? ProfileTabNomina(emp) : ''}
                        ${activeTab === 'asistencia' ? ProfileTabAsistencia(emp) : ''}
                        ${activeTab === 'documentos' ? ProfileTabDocumentos(emp) : ''}
                    </div>
                </div>
            </div>`;
}

function ProfileTabNomina(emp) {
    const { periodStart, periodEnd, deductionType, deductionValue } = state.employeeProfile;

    // Calcular nómina
    const payroll = payrollService.calculateEmployeePayroll(emp.id, periodStart, periodEnd, state.employeeProfile.deductions);

    // Formatear fechas
    const startDate = new Date(periodStart + 'T00:00:00');
    const endDate = new Date(periodEnd + 'T00:00:00');
    const startFormatted = startDate.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
    const endFormatted = endDate.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });

    // Contar días
    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const workedDays = payroll.breakdown.reduce((sum, b) => sum + b.days, 0);
    const totalHours = payroll.breakdown.reduce((sum, b) => sum + b.regularHours + b.holidayHours, 0);
    const totalOvertime = payroll.breakdown.reduce((sum, b) => sum + b.overtimeHours, 0);

    // Último pago
    const lastPayment = emp.lastPaymentDate ? new Date(emp.lastPaymentDate + 'T00:00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Ninguno';

    // Preview de deducción
    let deductionPreview = '';
    if (deductionType === 'fixed') {
        deductionPreview = `$${deductionValue.toLocaleString()}`;
    } else {
        deductionPreview = `$${payroll.deductions.toLocaleString()} (${deductionValue}% de $${payroll.bruto.toLocaleString()})`;
    }

    return `<div style="display: flex; flex-direction: column; gap: 20px;">
                <!-- Selector de Período -->
                <div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 12px;">
                        📅 PERÍODO DE ANÁLISIS
                    </div>
                    
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px;">
                        <div style="position: relative;">
                            <label style="font-size: 0.75rem; color: #94a3b8; display: block; margin-bottom: 4px;">Desde:</label>
                            <div onclick="toggleProfileStartPicker()" style="padding: 8px 12px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
                                <span style="color: #f1f5f9; font-size: 0.875rem;">${startFormatted}</span>
                                <span style="color: #06b6d4;">📅</span>
                            </div>
                            ${state.employeeProfile.showStartPicker ? ProfileStartDatePicker() : ''}
                        </div>
                        
                        <div style="position: relative;">
                            <label style="font-size: 0.75rem; color: #94a3b8; display: block; margin-bottom: 4px;">Hasta:</label>
                            <div onclick="toggleProfileEndPicker()" style="padding: 8px 12px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
                                <span style="color: #f1f5f9; font-size: 0.875rem;">${endFormatted}</span>
                                <span style="color: #06b6d4;">📅</span>
                            </div>
                            ${state.employeeProfile.showEndPicker ? ProfileEndDatePicker() : ''}
                        </div>
                    </div>
                    
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                        <button onclick="setProfilePeriod('7days')" style="padding: 6px 12px; background: ${state.employeeProfile.activePeriod === '7days' ? '#06b6d4' : '#0f172a'}; border: 1px solid ${state.employeeProfile.activePeriod === '7days' ? '#06b6d4' : '#334155'}; border-radius: 6px; color: ${state.employeeProfile.activePeriod === '7days' ? '#000' : '#94a3b8'}; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                            7 Días
                        </button>
                        <button onclick="setProfilePeriod('15days')" style="padding: 6px 12px; background: ${state.employeeProfile.activePeriod === '15days' ? '#06b6d4' : '#0f172a'}; border: 1px solid ${state.employeeProfile.activePeriod === '15days' ? '#06b6d4' : '#334155'}; border-radius: 6px; color: ${state.employeeProfile.activePeriod === '15days' ? '#000' : '#94a3b8'}; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                            15 Días
                        </button>
                        <button onclick="setProfilePeriod('month')" style="padding: 6px 12px; background: ${state.employeeProfile.activePeriod === 'month' ? '#06b6d4' : '#0f172a'}; border: 1px solid ${state.employeeProfile.activePeriod === 'month' ? '#06b6d4' : '#334155'}; border-radius: 6px; color: ${state.employeeProfile.activePeriod === 'month' ? '#000' : '#94a3b8'}; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                            Este Mes
                        </button>
                        <button onclick="setProfilePeriod('lastPayment')" style="padding: 6px 12px; background: ${state.employeeProfile.activePeriod === 'lastPayment' ? 'linear-gradient(135deg, #f59e0b, #fbbf24)' : 'transparent'}; border: 1px solid ${state.employeeProfile.activePeriod === 'lastPayment' ? 'transparent' : '#f59e0b'}; border-radius: 6px; color: ${state.employeeProfile.activePeriod === 'lastPayment' ? '#000' : '#f59e0b'}; cursor: pointer; font-size: 0.75rem; font-weight: 700;">
                            💰 Desde Último Pago
                        </button>
                    </div>
                    
                    <div style="font-size: 0.7rem; color: #64748b; margin-top: 8px;">
                        💡 Último pago: ${lastPayment}
                    </div>
                </div>
                
                <!-- Resumen Rápido -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;">
                    <div style="background: #1e293b; padding: 12px; border-radius: 8px; border: 1px solid #334155; text-align: center;">
                        <div style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 4px;">📅 Días</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: #06b6d4;">${workedDays}</div>
                        <div style="font-size: 0.65rem; color: #64748b;">de ${totalDays}</div>
                    </div>
                    <div style="background: #1e293b; padding: 12px; border-radius: 8px; border: 1px solid #334155; text-align: center;">
                        <div style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 4px;">⏱️ Horas</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: #10b981;">${Math.round(totalHours)}h</div>
                    </div>
                    <div style="background: #1e293b; padding: 12px; border-radius: 8px; border: 1px solid #334155; text-align: center;">
                        <div style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 4px;">⚡ Extras</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: #3b82f6;">${Math.round(totalOvertime)}h</div>
                    </div>
                    <div style="background: #1e293b; padding: 12px; border-radius: 8px; border: 1px solid #334155; text-align: center;">
                        <div style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 4px;">💰 Bruto</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: #f59e0b;">$${Math.round(payroll.bruto).toLocaleString()}</div>
                    </div>
                </div>
                
                <!-- Desglose por Posición -->
                <div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 16px;">
                        💼 DESGLOSE POR POSICIÓN
                    </div>
                    
                    ${payroll.breakdown.map(b => {
        const isExpanded = state.employeeProfile.expandedPositions && state.employeeProfile.expandedPositions[b.positionId];

        return `<div data-position-id="${b.positionId}" 
                                     style="background: #0f172a; padding: 12px; border-radius: 8px; border-left: 4px solid ${b.positionColor}; margin-bottom: 12px; cursor: pointer; transition: all 0.2s;" 
                                     onclick="togglePositionBreakdown('${b.positionId}')"
                                     onmouseover="this.style.background='#1a2332'" 
                                     onmouseout="this.style.background='#0f172a'">
                            
                            <!-- Resumen Compacto (siempre visible) -->
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <span class="position-arrow" style="font-size: 1.25rem; color: ${b.positionColor}; transition: transform 0.2s; display: inline-block; transform: rotate(${isExpanded ? '90deg' : '0deg'});">
                                        ▶
                                    </span>
                                    <span style="width: 12px; height: 12px; border-radius: 50%; background: ${b.positionColor};"></span>
                                    <span style="font-size: 0.95rem; font-weight: 700; color: #f1f5f9;">${b.positionName}</span>
                                </div>
                                <span style="font-size: 1.125rem; font-weight: 700; color: #06b6d4;">$${Math.round(b.subtotal).toLocaleString()}</span>
                            </div>
                            
                            <!-- Detalles Expandibles -->
                            <div class="position-details" style="display: ${isExpanded ? 'block' : 'none'}; margin-top: 12px; padding-top: 12px; border-top: 1px solid #334155; animation: slideDown 0.2s ease-out;">
                                    <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 12px;">
                                        💰 Tarifa: <span style="color: #f1f5f9; font-weight: 600;">$${Math.round(b.hourlyRate)}/hora</span> 
                                        · <span style="color: #06b6d4;">$${Math.round(b.hourlyRate * state.settings.regularHoursPerDay)}/día</span>
                                        · <span style="color: #64748b;">~$${Math.round(b.monthlyEquivalent).toLocaleString()}/mes</span>
                                    </div>
                                    
                                    <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.75rem; margin-bottom: 12px;">
                                        <div style="display: flex; justify-content: space-between;">
                                            <span style="color: #64748b;">• Días trabajados:</span> 
                                            <span style="color: #f1f5f9; font-weight: 600;">${b.days} días</span>
                                        </div>
                                        
                                        ${b.regularHours > 0 ? `
                                        <div style="display: flex; justify-content: space-between;">
                                            <span style="color: #64748b;">• Horas regulares:</span> 
                                            <span style="color: #10b981; font-weight: 600;">${b.regularHours.toFixed(1)}h × ${formatCurrency(b.hourlyRate)}/h = ${formatCurrency(b.regularAmount)}</span>
                                        </div>
                                        ` : ''}
                                        
                                        ${b.overtimeHours > 0 ? `
                                        <div style="display: flex; justify-content: space-between;">
                                            <span style="color: #64748b;">• Horas extras (${state.settings.overtimeFactor}x):</span> 
                                            <span style="color: #3b82f6; font-weight: 600;">${b.overtimeHours.toFixed(1)}h × ${formatCurrency(b.overtimeRate)}/h = ${formatCurrency(b.overtimeAmount)}</span>
                                        </div>
                                        ` : ''}
                                        
                                        ${b.holidayHours > 0 ? `
                                        <div style="display: flex; justify-content: space-between;">
                                            <span style="color: #64748b;">• Horas festivo (${state.settings.holidayFactor}x):</span> 
                                            <span style="color: #f59e0b; font-weight: 600;">${b.holidayHours.toFixed(1)}h × ${formatCurrency(b.holidayRate)}/h = ${formatCurrency(b.holidayAmount)}</span>
                                        </div>
                                        ` : ''}
                                    </div>
                                    
                                    <div style="border-top: 1px solid #334155; padding-top: 8px; margin-top: 8px;">
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <span style="font-size: 0.875rem; color: #94a3b8;">Subtotal:</span>
                                            <span style="font-size: 1.125rem; font-weight: 700; color: #06b6d4;">${formatCurrency(b.subtotal)}</span>
                                        </div>
                                    </div>
                            </div>
                        </div>`;
    }).join('')}
                    
                    <div style="border-top: 2px solid #06b6d4; padding-top: 12px; margin-top: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.95rem; font-weight: 700; color: #f1f5f9;">TOTAL BRUTO:</span>
                            <span style="font-size: 1.5rem; font-weight: 700; color: #06b6d4;">${formatCurrency(payroll.bruto)}</span>
                        </div>
                    </div>
                </div>
                
                <!-- Deducciones Múltiples -->
                <div id="deductions-section" style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4;">
                            💸 DEDUCCIONES
                        </div>
                        <button onclick="addDeduction()" 
                                style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.transform='scale(1.05)'"
                                onmouseout="this.style.transform='scale(1)'">
                            +
                        </button>
                    </div>
                    
                    ${payroll.deductionBreakdown && payroll.deductionBreakdown.length > 0 ? payroll.deductionBreakdown.map((ded, index) => `
                        <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 12px;">
                            <div style="display: flex; gap: 12px; align-items: start;">
                                <!-- Radio buttons de tipo -->
                                <div style="flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px;">
                                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                                        <input type="radio" 
                                               name="deductionType_${index}" 
                                               value="fixed" 
                                               ${ded.type === 'fixed' ? 'checked' : ''} 
                                               onchange="updateDeductionType(${index}, 'fixed')" 
                                               style="accent-color: #06b6d4;">
                                        <span style="color: #f1f5f9;">Monto</span>
                                    </label>
                                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                                        <input type="radio" 
                                               name="deductionType_${index}" 
                                               value="percentage" 
                                               ${ded.type === 'percentage' ? 'checked' : ''} 
                                               onchange="updateDeductionType(${index}, 'percentage')" 
                                               style="accent-color: #06b6d4;">
                                        <span style="color: #f1f5f9;">Porcentaje%</span>
                                    </label>
                                </div>
                                
                                <!-- Input de valor -->
                                <div style="flex: 1;">
                                    <input type="number" 
                                           class="form-input" 
                                           value="${ded.value.toFixed(2)}" 
                                           onchange="updateDeductionValue(${index}, this.value)"
                                           placeholder="0.00"
                                           min="0"
                                           step="${ded.type === 'fixed' ? '0.01' : '0.1'}"
                                           style="width: 100%; font-size: 0.875rem; padding: 8px;">
                                </div>
                                
                                <!-- Botón eliminar (solo si hay más de 1) -->
                                ${payroll.deductionBreakdown.length > 1 ? `
                                    <button onclick="removeDeduction(${index})" 
                                            style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: all 0.2s;"
                                            onmouseover="this.style.background='#dc2626'"
                                            onmouseout="this.style.background='#ef4444'">
                                        🗑️
                                    </button>
                                ` : ''}
                            </div>
                            
                            <!-- Preview de esta deducción -->
                            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #334155; font-size: 0.75rem; color: #94a3b8;">
                                Descuento: <span style="color: #ec4899; font-weight: 600;">
                                    ${ded.type === 'fixed'
            ? formatCurrency(ded.amount)
            : `${ded.value.toFixed(2)}% de ${formatCurrency(ded.appliedTo)} = ${formatCurrency(ded.amount)}`
        }
                                </span>
                                <br>
                                Restante: <span style="color: #10b981; font-weight: 600;">${formatCurrency(ded.appliedTo - ded.amount)}</span>
                            </div>
                        </div>
                    `).join('') : '<div style="text-align: center; color: #64748b; padding: 20px;">No hay deducciones</div>'}
                    
                    <!-- Total de deducciones -->
                    <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; margin-top: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.875rem; color: #94a3b8;">Total deducciones:</span>
                            <span style="font-size: 1.125rem; font-weight: 700; color: #ec4899;">-${formatCurrency(payroll.deductions)}</span>
                        </div>
                    </div>
                </div>
                
                <!-- Total Neto -->
                <div id="neto-total" style="background: linear-gradient(135deg, #10b981, #06b6d4); padding: 20px; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-size: 0.875rem; color: rgba(0,0,0,0.7); font-weight: 600; margin-bottom: 4px;">💰 NETO A PAGAR</div>
                            <div style="font-size: 2rem; font-weight: 900; color: #000;">${formatCurrency(payroll.neto)}</div>
                        </div>
                    </div>
                </div>
                
                <!-- Acciones -->
                <div style="display: flex; flex-wrap: wrap; gap: 12px;">
                    <button onclick="alert('📄 Generar PDF próximamente')" style="flex: 1; min-width: 200px; padding: 12px 16px; background: #1e293b; border: 1px solid #06b6d4; border-radius: 8px; color: #06b6d4; font-weight: 700; cursor: pointer; font-size: 0.875rem;">
                        📄 Generar Recibo PDF
                    </button>
                    <button onclick="alert('💬 Envío por WhatsApp próximamente')" style="flex: 1; min-width: 200px; padding: 12px 16px; background: linear-gradient(135deg, #25D366, #128C7E); border: none; border-radius: 8px; color: #fff; font-weight: 700; cursor: pointer; font-size: 0.875rem;">
                        💬 Enviar por WhatsApp
                    </button>
                    <button onclick="markAsPaid()" style="flex: 1; min-width: 200px; padding: 12px 16px; background: linear-gradient(135deg, #f59e0b, #fbbf24); border: none; border-radius: 8px; color: #000; font-weight: 700; cursor: pointer; font-size: 0.875rem;">
                        ✅ Marcar como Pagado
                    </button>
                </div>
            </div>`;
}

function ProfileStartDatePicker() {
    const days = getDaysInMonth(state.employeeProfile.startPickerMonth);
    const today = getDateKey(new Date());
    const selected = state.employeeProfile.periodStart;

    return `<div class="date-picker-popup" style="position: absolute; top: 100%; left: 0; right: 0; z-index: 100; margin-top: 4px;">
                <div class="date-picker-header">
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); changeProfileStartMonth(-1)">◀</button>
                    <div class="date-picker-month">${formatMonthYear(state.employeeProfile.startPickerMonth)}</div>
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); changeProfileStartMonth(1)">▶</button>
                </div>
                <div class="date-picker-grid">
                    ${['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => `<div class="date-picker-day-label">${d}</div>`).join('')}
                    ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        let cls = ['date-picker-day'];
        if (!currentMonth) cls.push('other-month');
        if (dKey === today) cls.push('today');
        if (dKey === selected) cls.push('selected');
        return `<div class="${cls.join(' ')}" onclick="event.stopPropagation(); selectProfileStartDate('${dKey}')">${date.getDate()}</div>`;
    }).join('')}
                </div>
                <div style="padding: 8px; border-top: 1px solid #334155;">
                    <button onclick="event.stopPropagation(); state.employeeProfile.showStartPicker = false; render();" 
                            style="width: 100%; padding: 6px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #94a3b8; font-size: 0.75rem; cursor: pointer;">
                        Cerrar
                    </button>
                </div>
            </div>`;
}

function ProfileEndDatePicker() {
    const days = getDaysInMonth(state.employeeProfile.endPickerMonth);
    const today = getDateKey(new Date());
    const selected = state.employeeProfile.periodEnd;

    return `<div class="date-picker-popup" style="position: absolute; top: 100%; left: 0; right: 0; z-index: 100; margin-top: 4px;">
                <div class="date-picker-header">
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); changeProfileEndMonth(-1)">◀</button>
                    <div class="date-picker-month">${formatMonthYear(state.employeeProfile.endPickerMonth)}</div>
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); changeProfileEndMonth(1)">▶</button>
                </div>
                <div class="date-picker-grid">
                    ${['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => `<div class="date-picker-day-label">${d}</div>`).join('')}
                    ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        let cls = ['date-picker-day'];
        if (!currentMonth) cls.push('other-month');
        if (dKey === today) cls.push('today');
        if (dKey === selected) cls.push('selected');
        return `<div class="${cls.join(' ')}" onclick="event.stopPropagation(); selectProfileEndDate('${dKey}')">${date.getDate()}</div>`;
    }).join('')}
                </div>
                <div style="padding: 8px; border-top: 1px solid #334155;">
                    <button onclick="event.stopPropagation(); state.employeeProfile.showEndPicker = false; render();" 
                            style="width: 100%; padding: 6px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #94a3b8; font-size: 0.75rem; cursor: pointer;">
                        Cerrar
                    </button>
                </div>
            </div>`;
}

// ============================================
// 📅 DATE PICKER para editar hireDate desde perfil
// ============================================
// ============================================
// 💰 CÁLCULO DE SALARIO MENSUAL ESTIMADO
// ============================================
function calculateMonthlyEstimate(emp) {
    let totalMonthly = 0;
    const breakdown = [];

    emp.positions.forEach(posId => {
        const pos = state.positions.find(p => p.id === posId);
        if (!pos) return;

        // Obtener sueldo (personalizado o estándar)
        const hourlySalary = emp.positionSalaries?.[posId] || pos.baseSalary || 0;

        // Obtener días laborales (personalizados o estándar)
        const workingDays = emp.customWorkingDays?.[posId] || pos.workingDays || [1, 2, 3, 4, 5];

        // Calcular: días/semana * 4.33 semanas/mes * horas/día * $/hora
        const daysPerWeek = workingDays.length;
        const hoursPerDay = state.settings.regularHoursPerDay || 8;
        const monthlyForPosition = daysPerWeek * 4.33 * hoursPerDay * hourlySalary;

        totalMonthly += monthlyForPosition;
        breakdown.push({
            position: pos.name,
            daysPerWeek: daysPerWeek,
            monthly: monthlyForPosition
        });
    });

    return { total: totalMonthly, breakdown };
}

function ProfileHireDatePicker(emp) {
    if (!state.profileHireDatePickerMonth) {
        state.profileHireDatePickerMonth = new Date(emp.hireDate + 'T00:00:00');
    }

    const days = getDaysInMonth(state.profileHireDatePickerMonth);
    const monthName = state.profileHireDatePickerMonth.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });

    return `<div style="position:relative; margin-top:8px;">
                <div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:12px; position:absolute; z-index:100; width:280px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <button onclick="changeProfileHireDateMonth(-1)" style="background:none; border:none; color:#06b6d4; cursor:pointer; font-size:1rem; padding:4px 8px;">◀</button>
                        <span style="font-size:0.75rem; color:#f1f5f9; font-weight:600; text-transform:capitalize;">${monthName}</span>
                        <button onclick="changeProfileHireDateMonth(1)" style="background:none; border:none; color:#06b6d4; cursor:pointer; font-size:1rem; padding:4px 8px;">▶</button>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:2px;">
                        ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        const isSelected = dKey === emp.hireDate;
        return `<div onclick="selectProfileHireDate('${emp.id}', '${dKey}')" 
                                         style="padding:6px; text-align:center; cursor:pointer; border-radius:4px; font-size:0.7rem; transition:all 0.15s; ${isSelected ? 'background:#06b6d4; color:#000; font-weight:700;' : currentMonth ? 'color:#94a3b8; hover:background:rgba(6,182,212,0.1);' : 'color:#4b5563; opacity:0.4;'}">
                                ${date.getDate()}
                            </div>`;
    }).join('')}
                    </div>
                </div>
            </div>`;
}

function ProfileTabResumen(emp) {
    const positions = emp.positions.map(posId => {
        const pos = state.positions.find(p => p.id === posId);
        return pos ? pos.name : posId;
    }).join(', ');

    const hireDate = emp.hireDate ? new Date(emp.hireDate + 'T00:00:00').toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }) : 'No registrada';
    const lastPayment = emp.lastPaymentDate ? new Date(emp.lastPaymentDate + 'T00:00:00').toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Ninguno';

    // Calcular salario mensual estimado
    const monthlyEst = calculateMonthlyEstimate(emp);

    return `<div style="display: flex; flex-direction: column; gap: 20px;">
                <div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 12px;">
                        🎯 POSICIONES ACTUALES
                    </div>
                    <div style="font-size: 1rem; color: #f1f5f9; font-weight: 600;">
                        ${positions}
                    </div>
                </div>

                <div style="background: linear-gradient(135deg, rgba(16,185,129,0.1), rgba(6,182,212,0.1)); padding: 18px; border-radius: 8px; border: 1px solid rgba(16,185,129,0.3);">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #10b981; margin-bottom: 10px;">
                        💰 SALARIO MENSUAL ESTIMADO
                    </div>
                    <div style="font-size: 1.8rem; font-weight: 900; color: #10b981; margin-bottom: 10px;">
                        ${formatCurrency(monthlyEst.total)}
                    </div>
                    <div style="font-size: 0.72rem; color: #8fa3c3; line-height: 1.6;">
                        ${monthlyEst.breakdown.map(b =>
        `<div style="margin-bottom:3px;">• ${b.position}: ${b.daysPerWeek} días/sem → ${formatCurrency(b.monthly)}</div>`
    ).join('')}
                    </div>
                    <div style="font-size: 0.68rem; color: #64748b; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(100,116,139,0.2);">
                        📊 Basado en ${state.settings.regularHoursPerDay}h/día × 4.33 semanas/mes
                    </div>
                </div>
                
                <div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 12px;">
                        📋 INFORMACIÓN BÁSICA
                    </div>
                    <div style="display: grid; gap: 10px; font-size: 0.875rem;">
                        <div><span style="color: #94a3b8;">Número:</span> <span style="color: #f1f5f9; font-weight: 600;">#${emp.number}</span></div>
                        <div style="display:flex; align-items:center; justify-content:space-between;">
                            <span style="color: #94a3b8;">Contratado:</span> 
                            <span style="color: #f1f5f9; font-weight: 600; cursor:pointer; padding:4px 10px; border-radius:6px; background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.2); transition:all 0.2s;" 
                                  onclick="state.showProfileHireDatePicker = !state.showProfileHireDatePicker; render();"
                                  onmouseover="this.style.background='rgba(6,182,212,0.15)'; this.style.borderColor='rgba(6,182,212,0.3)';"
                                  onmouseout="this.style.background='rgba(6,182,212,0.1)'; this.style.borderColor='rgba(6,182,212,0.2)';">
                                ${hireDate} 📅
                            </span>
                        </div>
                        ${state.showProfileHireDatePicker ? ProfileHireDatePicker(emp) : ''}
                        ${emp.phone ? `<div><span style="color: #94a3b8;">Teléfono:</span> <span style="color: #f1f5f9; font-weight: 600;">${emp.phone}</span></div>` : ''}
                        ${emp.email ? `<div><span style="color: #94a3b8;">Email:</span> <span style="color: #f1f5f9; font-weight: 600;">${emp.email}</span></div>` : ''}
                        <div><span style="color: #94a3b8;">Último pago:</span> <span style="color: #f1f5f9; font-weight: 600;">${lastPayment}</span></div>
                    </div>
                </div>
                
                ${emp.notes ? `<div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 12px;">
                        📝 NOTAS
                    </div>
                    <div style="font-size: 0.875rem; color: #f1f5f9; white-space: pre-wrap;">
                        ${emp.notes}
                    </div>
                </div>` : ''}
            </div>`;
}

function ProfileTabAsistencia(emp) {
    return `<div style="text-align: center; padding: 40px; color: #94a3b8;">
                <div style="font-size: 3rem; margin-bottom: 16px;">📅</div>
                <div style="font-size: 1.125rem; font-weight: 600; margin-bottom: 8px;">Calendario de Asistencia</div>
                <div style="font-size: 0.875rem;">Próximamente...</div>
            </div>`;
}

function ProfileTabDocumentos(emp) {
    const paymentHistory = emp.paymentHistory || [];

    return `<div style="display: flex; flex-direction: column; gap: 20px;">
                ${emp.notes ? `<div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 12px;">
                        📝 NOTAS Y OBSERVACIONES
                    </div>
                    <div style="font-size: 0.875rem; color: #f1f5f9; white-space: pre-wrap;">
                        ${emp.notes}
                    </div>
                </div>` : ''}
                
                <div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 12px;">
                        📜 HISTORIAL DE PAGOS
                    </div>
                    ${paymentHistory.length > 0 ? `
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${paymentHistory.slice().reverse().slice(0, 10).map(p => {
        const date = new Date(p.date + 'T00:00:00').toLocaleDateString('es-DO', { year: 'numeric', month: 'short', day: 'numeric' });
        return `<div style="background: #0f172a; padding: 10px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                                    <div>
                                        <div style="font-size: 0.875rem; color: #f1f5f9; font-weight: 600;">$${Math.round(p.amount).toLocaleString()}</div>
                                        <div style="font-size: 0.7rem; color: #94a3b8;">${date}</div>
                                    </div>
                                    <div style="font-size: 0.7rem; color: #64748b;">${p.period}</div>
                                </div>`;
    }).join('')}
                        </div>
                    ` : `<div style="text-align: center; padding: 20px; color: #64748b; font-size: 0.875rem;">
                        No hay pagos registrados
                    </div>`}
                </div>
            </div>`;
}

function LeaderFormModal() {
    const ldr = state.editingLeader;
    const isEdit = !!ldr;
    const title = isEdit ? `Editar Líder - ${ldr.name}` : 'Nuevo Líder';

    // Auto-expandir campos opcionales si tienen contenido
    const hasOptionalContent = ldr?.phone || ldr?.email || ldr?.notes;
    const showOptional = state.showOptionalFields || hasOptionalContent;

    return `<div class="modal-overlay" onclick="if(event.target === this) closeModal()">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2 class="modal-title">👑 ${title}</h2>
                        <button class="modal-close" onclick="closeModal()">✕</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label class="form-label">📝 Nombre Completo *</label>
                            <input type="text" id="ldrName" class="form-input" value="${ldr?.name || ''}" placeholder="Carlos López" required>
                        </div>
                        
                        <!-- Botón para expandir campos opcionales -->
                        <div style="margin: 20px 0;">
                            <button type="button" 
                                    onclick="state.showOptionalFields = !state.showOptionalFields; render();" 
                                    style="width: 100%; padding: 12px; background: transparent; border: 1px dashed #334155; border-radius: 8px; color: #94a3b8; cursor: pointer; font-size: 0.875rem; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px;"
                                    onmouseover="this.style.borderColor='#06b6d4'; this.style.color='#06b6d4'"
                                    onmouseout="this.style.borderColor='#334155'; this.style.color='#94a3b8'">
                                <span>${showOptional ? '▼' : '▶'}</span>
                                <span>${showOptional ? 'Ocultar' : 'Mostrar'} campos opcionales</span>
                                <span style="opacity: 0.6;">(teléfono, email, notas)</span>
                            </button>
                        </div>
                        
                        <!-- Campos opcionales colapsables -->
                        ${showOptional ? `
                            <div class="form-group" style="animation: slideDown 0.3s ease-out;">
                                <label class="form-label">📞 Teléfono</label>
                                <input type="tel" id="ldrPhone" class="form-input" value="${ldr?.phone || ''}" placeholder="+1-809-555-1234">
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label">📧 Email</label>
                                <input type="email" id="ldrEmail" class="form-input" value="${ldr?.email || ''}" placeholder="lider@ejemplo.com">
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label">📝 Notas</label>
                                <textarea id="ldrNotes" class="form-textarea" placeholder="Sueldo, horarios, responsabilidades...">${ldr?.notes || ''}</textarea>
                            </div>
                        ` : `
                            <!-- Campos ocultos pero con valores preservados -->
                            <input type="hidden" id="ldrPhone" value="${ldr?.phone || ''}">
                            <input type="hidden" id="ldrEmail" value="${ldr?.email || ''}">
                            <textarea id="ldrNotes" style="display: none;">${ldr?.notes || ''}</textarea>
                        `}
                        
                        ${isEdit ? `<div class="modal-info" style="margin-top: 16px;">
                            <div class="info-row">
                                <span class="info-label">Número de Líder:</span>
                                <span class="info-value">${ldr.number}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Posiciones que lidera:</span>
                                <span class="info-value">${state.positions.filter(p => p.leaderId === ldr.id && p.active).length}</span>
                            </div>
                        </div>` : ''}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="saveLeader()">💾 Guardar</button>
                    </div>
                </div>
            </div>`;
}

function PositionFormModal() {
    const pos = state.editingPosition;
    const isEdit = !!pos;
    const title = isEdit ? `Editar Posición - ${pos.name}` : 'Nueva Posición';

    const activeLeaders = state.leaders.filter(l => l.active);
    const selectedColor = pos?.color || COLOR_PALETTE[0];

    // ⚡ NUEVO: Tarifa por hora simple
    const hourlyRate = pos?.hourlyRate || '';
    const regularHours = state.settings.regularHoursPerDay || 8;
    const overtimeFactor = state.settings.overtimeFactor || 1.5;
    const holidayFactor = state.settings.holidayFactor || 2;

    // Calcular equivalentes
    const dailyRate = hourlyRate ? (hourlyRate * regularHours) : 0;
    const monthlyRate = hourlyRate ? (hourlyRate * regularHours * 30) : 0;
    const overtimeRate = hourlyRate ? (hourlyRate * overtimeFactor) : 0;
    const holidayRate = hourlyRate ? (hourlyRate * holidayFactor) : 0;

    return `<div class="modal-overlay" onclick="if(event.target === this) closeModal()">
                <div class="modal-content" style="max-width: 600px;">
                    <div class="modal-header">
                        <h2 class="modal-title">🎯 ${title}</h2>
                        <button class="modal-close" onclick="closeModal()">✕</button>
                    </div>
                    <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
                        <div class="form-group">
                            <label class="form-label">📝 Nombre de la Posición *</label>
                            <input type="text" id="posName" class="form-input" value="${pos?.name || ''}" placeholder="Ej: Albañil" required>
                        </div>
                        
                        <!-- ⚡ SISTEMA SIMPLE: SOLO TARIFA POR HORA -->
                        <div style="background: #1e293b; padding: 16px; border-radius: 12px; margin: 16px 0; border: 1px solid #334155;">
                            <h3 style="font-size: 1rem; color: #06b6d4; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                                💰 Configuración de Pago
                            </h3>
                            
                            <div class="form-group">
                                <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                                    ⏱️ Tarifa por Hora *
                                    <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                          title="Esta es la base para todos los cálculos">ⓘ</span>
                                </label>
                                <input type="number" 
                                       id="posHourlyRate" 
                                       class="form-input" 
                                       value="${hourlyRate}" 
                                       placeholder="150" 
                                       min="1" 
                                       step="1"
                                       onchange="updateHourlyRatePreview()"
                                       required>
                                <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">
                                    💡 Ingresa cuánto cobra por cada hora trabajada
                                </div>
                            </div>
                            
                            <!-- PREVIEW DE TARIFAS -->
                            <div id="hourlyRatePreview" style="background: #0f172a; padding: 12px; border-radius: 8px; margin-top: 12px; border: 1px solid #334155;">
                                <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 8px;">📊 Tarifas Calculadas:</div>
                                <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.875rem;">
                                    <div style="display: flex; justify-content: space-between;">
                                        <span style="color: #94a3b8;">🕐 Por hora (regular):</span>
                                        <span style="color: #10b981; font-weight: 600;">$${Math.round(hourlyRate || 0).toLocaleString()}/h</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between;">
                                        <span style="color: #94a3b8;">📅 Por día (${regularHours}h):</span>
                                        <span style="color: #06b6d4; font-weight: 600;">$${Math.round(dailyRate).toLocaleString()}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between;">
                                        <span style="color: #94a3b8;">📅 Por mes (~30 días):</span>
                                        <span style="color: #64748b; font-weight: 600;">~$${Math.round(monthlyRate).toLocaleString()}</span>
                                    </div>
                                    <div style="border-top: 1px solid #334155; margin: 4px 0; padding-top: 8px;"></div>
                                    <div style="display: flex; justify-content: space-between;">
                                        <span style="color: #94a3b8;">⚡ Horas extras (${overtimeFactor}x):</span>
                                        <span style="color: #3b82f6; font-weight: 600;">$${Math.round(overtimeRate).toLocaleString()}/h</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between;">
                                        <span style="color: #94a3b8;">☀️ Días festivos (${holidayFactor}x):</span>
                                        <span style="color: #f59e0b; font-weight: 600;">$${Math.round(holidayRate).toLocaleString()}/h</span>
                                    </div>
                                </div>
                                <div style="font-size: 0.7rem; color: #64748b; margin-top: 8px;">
                                    💡 Los factores se configuran en Ajustes
                                </div>
                            </div>
                        </div>

                        <!-- ⚡ SELECTOR DE DÍAS LABORALES -->
                        <div style="background: #1e293b; padding: 16px; border-radius: 12px; margin: 16px 0; border: 1px solid #334155;">
                            <h3 style="font-size: 1rem; color: #06b6d4; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                📅 Días Laborales
                            </h3>
                            <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 12px;">
                                Selecciona qué días de la semana trabaja esta posición por defecto
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px;">
                                ${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day, idx) => {
        const isChecked = pos?.workingDays?.includes(idx) ?? (idx >= 1 && idx <= 5);
        return `
                                        <label style="display: flex; flex-direction: column; align-items: center; cursor: pointer; padding: 8px; background: ${isChecked ? 'rgba(6,182,212,0.2)' : '#0f172a'}; border: 2px solid ${isChecked ? '#06b6d4' : '#334155'}; border-radius: 8px; transition: all 0.2s;" onmouseover="this.style.borderColor='#06b6d4'" onmouseout="this.style.borderColor='${isChecked ? '#06b6d4' : '#334155'}'">
                                            <input type="checkbox" 
                                                   name="workingDay" 
                                                   value="${idx}" 
                                                   ${isChecked ? 'checked' : ''}
                                                   style="margin-bottom: 6px;">
                                            <span style="font-size: 0.7rem; color: ${isChecked ? '#06b6d4' : '#94a3b8'}; font-weight: ${isChecked ? '700' : '500'};">${day}</span>
                                        </label>
                                    `;
    }).join('')}
                            </div>
                            <div style="font-size: 0.7rem; color: #64748b; margin-top: 12px;">
                                💡 Esto se usa para calcular el salario mensual estimado (días/sem × 4.33 × horas/día)
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">👑 Líder/Encargado (Opcional)</label>
                            <select id="posLeader" class="form-select">
                                <option value="">Sin líder asignado</option>
                                ${activeLeaders.map(ldr => `
                                    <option value="${ldr.id}" ${pos?.leaderId === ldr.id ? 'selected' : ''}>
                                        ${ldr.number} - ${ldr.name}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">🎨 Color Identificador</label>
                            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 12px;">
                                ${COLOR_PALETTE.map(color => `
                                    <label style="cursor: pointer; position: relative;">
                                        <input type="radio" name="posColor" value="${color}" ${selectedColor === color ? 'checked' : ''} style="position: absolute; opacity: 0;">
                                        <div style="width: 100%; aspect-ratio: 1; border-radius: 12px; background: ${color}; border: 4px solid ${selectedColor === color ? '#06b6d4' : 'transparent'}; transition: all 0.2s;"></div>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                        
                        ${isEdit ? `
                            <div class="modal-info" style="margin-top: 16px;">
                                <div class="info-row">
                                    <span class="info-label">Empleados:</span>
                                    <span class="info-value">${state.employees.filter(e => e.positions.includes(pos.id) && e.active).length}</span>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="savePosition()">💾 Guardar</button>
                    </div>
                </div>
            </div>`;
}

// ⚡ NUEVO: Actualizar preview de tarifas
window.updateHourlyRatePreview = function () {
    const hourlyRateInput = document.getElementById('posHourlyRate');
    if (!hourlyRateInput) return;

    const hourlyRate = Number.parseFloat(hourlyRateInput.value) || 0;
    const regularHours = state.settings.regularHoursPerDay || 8;
    const overtimeFactor = state.settings.overtimeFactor || 1.5;
    const holidayFactor = state.settings.holidayFactor || 2;
    const weekDates = weekDatesForPosition(state.editingPosition?.workingDays || [1, 2, 3, 4, 5]);

    const dailyRate = hourlyRate * regularHours;
    const monthlyRate = dailyRate * weekDates.length * 4.33;
    const WeeksRate = dailyRate * weekDates.length;
    const twoWeeksRate = WeeksRate * 2;
    const treeWeeksRate = WeeksRate * 3;
    const overtimeRate = hourlyRate * overtimeFactor;
    const holidayRate = hourlyRate * holidayFactor;

    // Actualizar display
    const preview = document.getElementById('hourlyRatePreview');
    if (preview) {
        preview.innerHTML = `
                    <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 8px;">📊 Tarifas Calculadas:</div>
                    <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.875rem;">
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: #94a3b8;">🕐 Por hora (regular):</span>
                            <span style="color: #10b981; font-weight: 600;">$${Math.round(hourlyRate, 2).toLocaleString()}/h</span>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: #94a3b8;">📅 Por día (${regularHours}h):</span>
                            <span style="color: #06b6d4; font-weight: 600;">$${Math.round(dailyRate, 2).toLocaleString()}</span>
                        </div>
                                                <div style="display: flex; justify-content: space-between;">
                            <span style="color: #94a3b8;">📅 1 semana:</span>
                            <span style="color: #64748b; font-weight: 600;">~$${Math.round(WeeksRate, 2).toLocaleString()}</span

                                                    <div style="display: flex; justify-content: space-between;">
                            <span style="color: #94a3b8;">📅 Por 2 semanas:</span>
                            <span style="color: #64748b; font-weight: 600;">~$${Math.round(twoWeeksRate, 2).toLocaleString()}</span

                                                    <div style="display: flex; justify-content: space-between;">
                            <span style="color: #94a3b8;">📅 Por 3 semanas:</span>
                            <span style="color: #64748b; font-weight: 600;">~$${Math.round(treeWeeksRate, 2).toLocaleString()}</span


                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: #94a3b8;">📅 Por mes (~30 días):</span>
                            <span style="color: #64748b; font-weight: 600;">~$${Math.round(monthlyRate).toLocaleString()}</span>
                        </div>
                        <div style="border-top: 1px solid #334155; margin: 4px 0; padding-top: 8px;"></div>
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: #94a3b8;">⚡ Horas extras (${overtimeFactor}x):</span>
                            <span style="color: #3b82f6; font-weight: 600;">$${Math.round(overtimeRate).toLocaleString()}/h</span>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: #94a3b8;">☀️ Días festivos (${holidayFactor}x):</span>
                            <span style="color: #f59e0b; font-weight: 600;">$${Math.round(holidayRate).toLocaleString()}/h</span>
                        </div>
                    </div>
                    <div style="font-size: 0.7rem; color: #64748b; margin-top: 8px;">
                        💡 Los factores se configuran en Ajustes
                    </div>
                `;
    }
};

// Función para actualizar preview de sueldo
window.updateSalaryPreview = function () {
    const amountInput = document.getElementById('posSalary');
    const periodInput = document.getElementById('posPeriod');
    const workDaysInputs = document.querySelectorAll('input[name="posWorkDays"]:checked');

    if (!amountInput || !periodInput) return;

    const amount = parseFloat(amountInput.value) || 0;
    const period = periodInput.value;
    const workDaysCount = workDaysInputs.length || 7;

    // Actualizar visuales de días
    document.querySelectorAll('.day-checkbox').forEach((el, idx) => {
        const checkbox = document.querySelector(`input[name="posWorkDays"][value="${idx}"]`);
        if (checkbox) {
            el.classList.toggle('active', checkbox.checked);
        }
    });

    // Calcular sueldos
    let dailySalary = 0;
    switch (period) {
        case 'day': dailySalary = amount; break;
        case 'week': dailySalary = amount / workDaysCount; break;
        case 'biweekly': dailySalary = amount / (workDaysCount * 2); break;
        case '3weeks': dailySalary = amount / (workDaysCount * 3); break;
        case 'month': dailySalary = amount / (workDaysCount * 4.33); break;
    }

    const previewDay = document.getElementById('preview-day');
    const previewWeek = document.getElementById('preview-week');
    const previewBiweekly = document.getElementById('preview-biweekly');
    const preview3weeks = document.getElementById('preview-3weeks');
    const previewMonth = document.getElementById('preview-month');

    if (previewDay) previewDay.textContent = '$' + dailySalary.toFixed(2);
    if (previewWeek) previewWeek.textContent = '$' + (dailySalary * workDaysCount).toFixed(2);
    if (previewBiweekly) previewBiweekly.textContent = '$' + (dailySalary * workDaysCount * 2).toFixed(2);
    if (preview3weeks) preview3weeks.textContent = '$' + (dailySalary * workDaysCount * 3).toFixed(2);
    if (previewMonth) previewMonth.textContent = '$' + (dailySalary * workDaysCount * 4.33).toFixed(2);
};

// Inicializar event listeners del modal de posición
window.initPositionModalListeners = function () {
    setTimeout(() => {
        const salaryInput = document.getElementById('posSalary');
        const periodInput = document.getElementById('posPeriod');
        const workDayInputs = document.querySelectorAll('input[name="posWorkDays"]');

        if (salaryInput) salaryInput.addEventListener('input', window.updateSalaryPreview);
        if (periodInput) periodInput.addEventListener('change', window.updateSalaryPreview);
        workDayInputs.forEach(input => {
            input.addEventListener('change', window.updateSalaryPreview);
        });

        window.updateSalaryPreview();
    }, 100);
};


function AdvancedAttendanceModal() {
    const emp = state.selectedEmployee;
    if (!emp) return '';
    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key] || {};
    const selP = att.selectedPosition || emp.positions?.[0] || null;
    const pos = state.positions.find(p => p.id === selP);

    // Determinar si es multi-posición
    const isMultiPosition = att.multiPosition || state.isFractionated || false;
    const hasMultiplePositions = emp.positions.length > 1;

    // Asegurar valores por defecto
    const hoursWorked = att.hoursWorked !== undefined ? att.hoursWorked : state.settings.regularHoursPerDay;
    const overtimeHours = att.overtimeHours || 0;
    const isHoliday = att.isHoliday || false;
    const notes = att.notes || '';

    // Inicializar positionHours si no existe
    let positionHours = att.positionHours || [];
    if (isMultiPosition && positionHours.length === 0) {
        // Si ya hay asistencia registrada con una posición, pre-llenarla
        if (att.present && att.selectedPosition && att.hoursWorked > 0) {
            // Pre-llenar con la posición actual
            positionHours = emp.positions.map(pid => ({
                positionId: pid,
                hours: pid === att.selectedPosition ? att.hoursWorked : 0,
                overtimeHours: pid === att.selectedPosition ? (att.overtimeHours || 0) : 0
            }));
        } else {
            // Inicializar vacío para todas las posiciones
            positionHours = emp.positions.map(pid => ({
                positionId: pid,
                hours: 0,
                overtimeHours: 0
            }));
        }
    }

    // Calcular total de horas fraccionadas
    const totalFractionated = positionHours.reduce((sum, ph) => sum + ph.hours, 0);

    // Obtener sueldo de la posición con compatibilidad
    const posSalary = pos?.salaryConfig?.amount ?? pos?.baseSalary ?? 0;
    let posSalaryDisplay;
    if (pos) {
        const config = pos.salaryConfig || { amount: posSalary, period: 'month', workDays: [] };
        posSalaryDisplay = payrollService.formatSalaryDisplay(config);
    } else {
        posSalaryDisplay = { full: '$0' };
    }

    // Generar opciones de posiciones para modo simple
    const positionOptions = emp.positions.map(pid => {
        const position = state.positions.find(p => p.id === pid);
        const positionSalary = position?.salaryConfig?.amount ?? position?.baseSalary ?? 0;
        return `<option value="${pid}" ${selP === pid ? 'selected' : ''}>${position.name} - $${positionSalary.toLocaleString()}</option>`;
    }).join('');

    return `<div class="modal-overlay" onclick="if(event.target === this) closeModal()">
                <div class="modal-content" style="max-width: 600px;">
                    <div class="modal-header">
                        <h2 class="modal-title">⚙️ Detalles de Asistencia</h2>
                        <button class="modal-close" onclick="closeModal()">✕</button>
                    </div>
                    <form class="modal-body" onsubmit="event.preventDefault(); saveAdvancedAttendance();">
                        <div class="modal-info">
                            <div class="info-row">
                                <span class="info-label">Empleado:</span>
                                <span class="info-value">${emp.number} - ${emp.name}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Fecha:</span>
                                <span class="info-value">${formatDateShort(state.selectedDate)}</span>
                            </div>
                        </div>
                        
                        <!-- Toggle para modo fraccionado -->
                        ${hasMultiplePositions ? `
                            <div class="form-group" style="margin-top: 16px; padding: 12px; background: #1e293b; border-radius: 8px; border: 1px solid #334155;">
                                <label class="form-checkbox" style="cursor: pointer;">
                                    <input type="checkbox" id="multiPositionMode" ${isMultiPosition ? 'checked' : ''} 
                                           onchange="state.isFractionated = this.checked; render();">
                                    <span class="form-label" style="margin: 0; font-weight: 600; color: #06b6d4;">🔄 Fraccionar por múltiples posiciones</span>
                                </label>
                                <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px; margin-left: 24px;">
                                    Permite distribuir las horas trabajadas entre diferentes posiciones
                                </div>
                            </div>
                        ` : ''}
                        
                        ${isMultiPosition && hasMultiplePositions ? `
                            <!-- MODO FRACCIONADO -->
                            <div style="margin-top: 16px;">
                                <div style="font-size: 0.875rem; color: #94a3b8; font-weight: 600; margin-bottom: 12px;">
                                    Distribución de Horas por Posición:
                                </div>
                                
                                ${emp.positions.map((pid, index) => {
        const position = state.positions.find(p => p.id === pid);
        const positionSalary = position?.salaryConfig?.amount ?? position?.baseSalary ?? 0;
        const ph = positionHours.find(p => p.positionId === pid) || { hours: 0, overtimeHours: 0 };

        return `
                                        <div style="background: #1e293b; padding: 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #334155;">
                                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                                <span style="width: 12px; height: 12px; border-radius: 50%; background: ${position?.color};"></span>
                                                <span style="font-weight: 600; color: #f1f5f9;">${position?.name}</span>
                                                <span style="margin-left: auto; font-size: 0.75rem; color: #64748b;">$${positionSalary.toLocaleString()}/día</span>
                                            </div>
                                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                                <div>
                                                    <label style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 4px;">Horas:</label>
                                                    <input type="number" 
                                                           id="posHours_${pid}" 
                                                           class="form-input" 
                                                           min="0" 
                                                           max="24" 
                                                           step="0.5" 
                                                           value="${ph.hours}"
                                                           style="padding: 6px 8px; font-size: 0.875rem;">
                                                </div>
                                                <div>
                                                    <label style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 4px;">Extras:</label>
                                                    <input type="number" 
                                                           id="posOvertime_${pid}" 
                                                           class="form-input" 
                                                           min="0" 
                                                           max="12" 
                                                           step="0.5" 
                                                           value="${ph.overtimeHours}"
                                                           style="padding: 6px 8px; font-size: 0.875rem;">
                                                </div>
                                            </div>
                                        </div>
                                    `;
    }).join('')}
                                
                                <!-- Total de horas -->
                                <div style="background: linear-gradient(135deg, #1e293b, #334155); padding: 12px; border-radius: 8px; border: 1px solid #06b6d4; text-align: center;">
                                    <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 4px;">Total de Horas:</div>
                                    <div id="totalHoursDisplay" style="font-size: 1.5rem; font-weight: 700; color: #10b981;">
                                        ${totalFractionated.toFixed(1)}h
                                    </div>
                                </div>
                            </div>
                        ` : `
                            <!-- MODO SIMPLE -->
                            ${emp.positions.length > 1 ? `
                                <div class="form-group">
                                    <label class="form-label">🎯 Posición</label>
                                    <select id="selectedPosition" class="form-select">
                                        ${positionOptions}
                                    </select>
                                </div>
                            ` : `
                                <input type="hidden" id="selectedPosition" value="${selP}">
                            `}
                            <div class="form-group">
                                <label class="form-label">⏱️ Horas Trabajadas</label>
                                <input type="number" id="hoursWorked" class="form-input" min="0" max="24" step="0.5" value="${hoursWorked}" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">⚡ Horas Extras</label>
                                <input type="number" id="overtimeHours" class="form-input" min="0" max="12" step="0.5" value="${overtimeHours}">
                            </div>
                        `}
                        
                        <div class="form-group">
                            <label class="form-checkbox">
                                <input type="checkbox" id="isHoliday" ${isHoliday ? 'checked' : ''}>
                                <span class="form-label" style="margin: 0">☀️ Día Festivo</span>
                            </label>
                        </div>
                        <div class="form-group">
                            <label class="form-label">📝 Notas</label>
                            <textarea id="notes" class="form-textarea" placeholder="Observaciones adicionales...">${notes}</textarea>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
                            <button type="button" class="btn btn-primary" onclick="saveAdvancedAttendance()">💾 Guardar</button>
                        </div>
                    </form>
                </div>
            </div>`;
}

// [LEGACY REMOVED] ReportsTab, EmployeeReportTab, EmployeeReportControls, etc -> AnalyticsUI.js
// [LEGACY REMOVED] ExportTab, generateExportDeductionsHTML -> PayrollUI.js
// ============================================
// SETTINGS TAB
// ============================================

function SettingsTab() {
    return `
                <div style="max-width: 900px; margin: 0 auto;">
                    <div style="margin-bottom: 24px;">
                        <h2 style="margin: 0 0 8px 0; font-size: 1.75rem; display: flex; align-items: center; gap: 12px;">
                            <span>⚙️</span>
                            <span class="gradient-text">Configuración del Sistema</span>
                        </h2>
                        <p style="margin: 0; color: #94a3b8; font-size: 0.875rem;">
                            Personaliza la configuración de tu sistema de asistencia
                        </p>
                    </div>
                    
                    <!-- ✨ Dashboard de Resumen -->
                    ${SettingsDashboard()}
                    
                    <!-- Navegación de Pestañas -->
                    <div class="nav-tabs" style="margin-bottom: 32px;">

                        <button class="nav-tab ${state.settingsActiveTab === 'data' ? 'active' : ''}" 
                                onclick="changeSettingsTab('data')">
                            <span>${icons.get('save')}</span><span class="tab-text"> Datos</span>
                        </button>

                        <button class="nav-tab ${state.settingsActiveTab === 'general' ? 'active' : ''}" 
                                onclick="changeSettingsTab('general')">
                            <span>${icons.get('settings')}</span><span class="tab-text"> General</span>
                        </button>

                        <button class="nav-tab ${state.settingsActiveTab === 'calendar' ? 'active' : ''}" 
                                onclick="changeSettingsTab('calendar')">
                            <span>${icons.get('calendar')}</span><span class="tab-text"> Calendario</span>
                        </button>
                    </div>
                    
                    <!-- Contenido de las Pestañas -->
                    ${state.settingsActiveTab === 'general' ? SettingsTabGeneral() : ''}
                    ${state.settingsActiveTab === 'data' ? SettingsTabData() : ''}
                    ${state.settingsActiveTab === 'calendar' ? SettingsTabCalendar() : ''}
                    
                    <div style="margin-top: 24px; display: flex; justify-content: flex-end;">
                        <button onclick="saveSettings()" class="btn btn-primary" style="padding: 12px 32px; font-size: 1rem;">
                            💾 Guardar Configuración
                        </button>
                    </div>
                </div>
            `;
}

// ============================================
// DASHBOARD DE CONFIGURACIÓN
// ============================================

function SettingsDashboard() {
    const storage = calculateStorageStats();
    const syncStatus = state.supabaseSyncStatus || {
        connected: false,
        localEmployees: state.employees.length,
        localAttendance: Object.keys(state.attendance).length,
        localDays: new Set(Object.values(state.attendance).map(a => a.date)).size
    };

    // Datos para el resumen colapsado
    const freeSpace = Math.round(100 - storage.percentage);
    const syncIcon = syncStatus.connected ? '✅' : '⚪';
    const syncText = syncStatus.connected ? 'Online' : 'Offline';
    const syncColor = syncStatus.connected ? '#10b981' : '#94a3b8';

    return `
                <details style="background: linear-gradient(135deg, #1e293b, #0f172a); border-radius: 12px; margin-bottom: 24px; border: 1px solid #334155; overflow: hidden;">
                    <summary style="padding: 16px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; list-style: none; user-select: none;">
                        <h3 style="margin: 0; color: #06b6d4; font-size: 1rem; display: flex; align-items: center; gap: 6px;">
                            <span>📊</span>
                            <span>Resumen del Sistema</span>
                        </h3>
                        
                        <div style="display: flex; align-items: center; gap: 12px; font-size: 0.8rem;">
                            <!-- Resumen Storage -->
                            <div style="display: flex; align-items: center; gap: 4px; color: ${freeSpace < 20 ? '#ef4444' : '#94a3b8'};">
                                <span>💾</span>
                                <span>${freeSpace}% libre</span>
                            </div>
                            
                            <!-- Resumen Sync -->
                            <div style="display: flex; align-items: center; gap: 4px; color: ${syncColor};">
                                <span>${syncIcon}</span>
                                <span style="display: none; @media (min-width: 400px) { display: inline; }">${syncText}</span>
                            </div>
                            
                            <span style="color: #64748b; font-size: 0.8rem;">▼</span>
                        </div>
                    </summary>
                    
                    <div style="padding: 0 16px 16px 16px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; border-top: 1px solid #334155; padding-top: 16px;">
                            ${StorageCard(storage)}
                            ${SyncCard(syncStatus)}
                            ${DataSummaryCard()}
                        </div>
                    </div>
                </details>
            `;
}

function StorageCard(stats) {
    const color = stats.percentage > 80 ? '#ef4444' :
        stats.percentage > 60 ? '#f59e0b' : '#10b981';

    return `
                <div style="background: #0f172a; border-radius: 8px; padding: 12px; border: 1px solid #334155;">
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                        <span style="font-size: 1rem;">💾</span>
                        <span style="font-weight: 600; color: #f1f5f9; font-size: 0.8rem;">Almacenamiento</span>
                    </div>
                    
                    <div style="font-size: 1.25rem; font-weight: 700; color: ${color}; margin-bottom: 2px; line-height: 1;">
                        ${stats.usedMB} <span style="font-size: 0.75rem; color: #64748b; font-weight: 400;">MB</span>
                    </div>
                    
                    <!-- Barra de progreso mini -->
                    <div style="background: #1e293b; height: 4px; border-radius: 2px; overflow: hidden; margin: 6px 0;">
                        <div style="background: ${color}; height: 100%; width: ${stats.percentage}%; transition: width 0.3s;"></div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #94a3b8;">
                        <span>${stats.percentage}% uso</span>
                        <span>${stats.available} libre</span>
                    </div>
                </div>
            `;
}

function SyncCard(status) {
    const isConnected = status.connected;
    const statusColor = isConnected ? '#10b981' : '#64748b';
    const statusIcon = isConnected ? '✅' : '⚪';
    const statusText = isConnected ? 'Conectado' : 'Sin conexión';

    const delta = isConnected ? (status.cloudEmployees - status.localEmployees) : 0;
    const deltaText = delta === 0 ? 'Sincronizado' :
        delta > 0 ? `+${delta} en nube` :
            `${delta} en nube`;
    const deltaColor = delta === 0 ? '#10b981' : '#f59e0b';

    return `
                <div style="background: #0f172a; border-radius: 12px; padding: 16px; border: 1px solid #334155;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                        <span style="font-size: 1.5rem;">☁️</span>
                        <span style="font-weight: 600; color: #f1f5f9; font-size: 0.95rem;">Sincronización</span>
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <span style="font-size: 1.5rem;">${statusIcon}</span>
                        <span style="font-size: 1.25rem; font-weight: 700; color: ${statusColor};">
                            ${statusText}
                        </span>
                    </div>
                    
                    ${isConnected ? `
                        <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 8px;">
                            Última sync: ${status.timeAgo}
                        </div>
                        
                        <div style="background: #1e293b; padding: 8px; border-radius: 6px; margin-top: 8px;">
                            <div style="font-size: 0.7rem; color: #64748b; margin-bottom: 4px;">Comparación:</div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.75rem;">
                                <span style="color: #94a3b8;">
                                    Local: <strong style="color: #06b6d4;">${status.localEmployees}</strong> emp
                                </span>
                                <span style="color: #94a3b8;">
                                    Nube: <strong style="color: #06b6d4;">${status.cloudEmployees}</strong> emp
                                </span>
                            </div>
                            <div style="font-size: 0.7rem; color: ${deltaColor}; margin-top: 4px; text-align: center;">
                                ${deltaText}
                            </div>
                        </div>
                    ` : `
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            Conecta a Supabase para sincronización en la nube
                        </div>
                    `}
                </div>
            `;
}

function DataSummaryCard() {
    const activeEmployees = state.employees.filter(e => e.active).length;
    const totalEmployees = state.employees.length;
    const activePositions = state.positions.filter(p => p.active).length;

    return `
                <div style="background: #0f172a; border-radius: 8px; padding: 12px; border: 1px solid #334155;">
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                        <span style="font-size: 1rem;">👥</span>
                        <span style="font-weight: 600; color: #f1f5f9; font-size: 0.8rem;">Datos Generales</span>
                    </div>
                    
                    <div style="display: flex; align-items: baseline; gap: 6px; margin-bottom: 8px;">
                        <div style="font-size: 1.25rem; font-weight: 700; color: #06b6d4;">
                            ${totalEmployees}
                        </div>
                        <div style="font-size: 0.7rem; color: #64748b;">
                            empleados (${activeEmployees} activos)
                        </div>
                    </div>
                    
                    <div style="background: #1e293b; padding: 6px; border-radius: 4px; margin-top: auto;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.7rem;">
                            <span style="color: #94a3b8;">Posiciones:</span>
                            <span style="color: #10b981; font-weight: 600;">${activePositions}</span>
                        </div>
                    </div>
                </div>
            `;
}

// ============================================
// PESTAÑA: GENERAL
// ============================================
function SettingsTabGeneral() {
    return `
                ${SettingsForm()}
            `;
}

// ============================================
// PESTAÑA: DATOS
// ============================================
function SettingsTabData() {
    return `
                    <!-- ═══════════════════════════════════════════════════════════ -->
                    <!-- Sincronización con Supabase -->
                    <!-- ═══════════════════════════════════════════════════════════ -->
                    <div style="background: linear-gradient(135deg, rgba(6,182,212,0.1), rgba(16,185,129,0.1)); border-radius: 12px; padding: 24px; margin-top: 20px; border: 2px solid ${useSupabase ? '#10b981' : '#334155'};">
                        <h3 style="margin: 0 0 12px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                            ☁️ Sincronización en la Nube
                        </h3>
                        
                        ${!useSupabase ? `
                            <!-- Estado: NO conectado -->
                            <div style="color: #94a3b8; margin-bottom: 16px; line-height: 1.7;">
                                <strong>Estado actual:</strong> Trabajando en modo local<br>
                                <span style="font-size: 0.875rem;">Los datos se guardan solo en este dispositivo (localStorage)</span>
                            </div>
                            
                            <div style="background: rgba(6,182,212,0.1); padding: 14px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid #06b6d4;">
                                <div style="font-size: 0.9rem; color: #e0f2fe; margin-bottom: 8px; font-weight: 600;">
                                    ✨ Beneficios de conectar con Supabase:
                                </div>
                                <ul style="margin: 0; padding-left: 20px; color: #94a3b8; font-size: 0.875rem; line-height: 1.8;">
                                    <li>📱 Accede desde celular, tablet y PC</li>
                                    <li>🔄 Sincronización automática entre dispositivos</li>
                                    <li>☁️ Tus datos seguros en la nube</li>
                                    <li>👥 Trabajo en equipo (próximamente)</li>
                                    <li>💾 Backup automático</li>
                                </ul>
                            </div>
                            
                            <button onclick="showSupabaseLogin()" class="btn-primary" style="width: 100%; padding: 14px; font-size: 1rem;">
                                🚀 Conectar con Supabase (Gratis)
                            </button>
                            
                            <div style="margin-top: 12px; padding: 10px; background: rgba(245,158,11,0.1); border-radius: 6px; font-size: 0.8rem; color: #fbbf24;">
                                💡 <strong>Primera vez:</strong> Haz clic en "Registrarse" para crear tu cuenta. Tus datos locales se migrarán automáticamente.
                            </div>
                        ` : `
                            <!-- Estado: Conectado -->
                            <div style="background: rgba(16,185,129,0.15); padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 2px solid #10b981;">
                                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                                    <div style="width: 10px; height: 10px; background: #10b981; border-radius: 50%; animation: pulse 2s infinite;"></div>
                                    <span style="color: #10b981; font-weight: 700; font-size: 1rem;">✅ Conectado a la Nube</span>
                                </div>
                                <div style="color: #94a3b8; font-size: 0.875rem;">
                                    <strong>Usuario:</strong> ${currentUser?.email || 'Desconocido'}<br>
                                    <strong>Auto-sync:</strong> ${autoSyncEnabled ? '🟢 Activado' : '🔴 Desactivado'}
                                </div>
                            </div>
                            
                            <!-- Botones de Sincronización Manual -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;">
                                <button onclick="uploadToCloud()" class="btn-primary" style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; background: linear-gradient(135deg, #3b82f6, #2563eb);">
                                    <span>📤</span>
                                    <span style="font-size: 0.9rem;">Subir Datos</span>
                                </button>
                                <button onclick="downloadFromCloud()" class="btn-primary" style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; background: linear-gradient(135deg, #06b6d4, #0891b2);">
                                    <span>☁️</span>
                                    <span style="font-size: 0.9rem;">Descargar</span>
                                </button>
                            </div>
                            
                            <!-- Toggle Auto-Sync -->
                            <div style="background: rgba(6,182,212,0.1); padding: 14px; border-radius: 8px; margin-bottom: 12px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                                    <div>
                                        <div style="font-weight: 600; color: #f1f5f9; font-size: 0.95rem; margin-bottom: 4px;">⚡ Sincronización Automática</div>
                                        <div style="font-size: 0.8rem; color: #94a3b8; line-height: 1.5;">
                                            ${autoSyncEnabled
            ? 'Los cambios se suben automáticamente después de 3 segundos de inactividad'
            : 'Usa los botones de arriba para sincronizar manualmente'}
                                        </div>
                                    </div>
                                    <button onclick="toggleAutoSync()" style="min-width: 60px; padding: 8px 16px; border-radius: 20px; border: 2px solid ${autoSyncEnabled ? '#10b981' : '#64748b'}; background: ${autoSyncEnabled ? '#10b981' : '#1e293b'}; color: white; font-weight: 700; cursor: pointer; transition: all 0.2s;">
                                        ${autoSyncEnabled ? 'ON' : 'OFF'}
                                    </button>
                                </div>
                            </div>
                            
                            <!-- Botón Desconectar -->
                            <button onclick="disconnectSupabase()" class="btn-secondary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
                                <span>🔌</span>
                                <span>Desconectar de la Nube</span>
                            </button>
                            
                            <div style="margin-top: 12px; padding: 12px; background: rgba(245,158,11,0.1); border-radius: 6px; font-size: 0.8rem; color: #fbbf24; line-height: 1.6;">
                                💡 <strong>Tip:</strong> Usa <strong>Subir Datos</strong> para enviar tus cambios locales a la nube, o <strong>Descargar</strong> para obtener los últimos datos de otro dispositivo.
                            </div>
                        `}
                    </div>
                    
                    <!-- Gestión de Datos -->
                    <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-top: 20px; border: 1px solid #334155;">
                        <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                            💾 Gestión de Datos
                        </h3>
                        
                        <!-- Sistema de Almacenamiento -->
                        <div style="background: #0f172a; border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid #334155;">
                            <div style="font-weight: 600; color: #f1f5f9; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 1.25rem;">💾</span>
                                <span>Tipo de Almacenamiento</span>
                            </div>
                            
                            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                                <label style="flex: 1; cursor: pointer;">
                                    <input type="radio" 
                                           name="storageTypeData" 
                                           value="localStorage" 
                                           ${!state.useIndexedDB ? 'checked' : ''}
                                           onchange="handleStorageTypeChange(this.value)"
                                           style="display: none;">
                                    <div style="padding: 10px; background: ${!state.useIndexedDB ? '#0891b2' : '#1e293b'}; border-radius: 8px; text-align: center; border: 1px solid ${!state.useIndexedDB ? '#0891b2' : '#334155'}; transition: all 0.2s;">
                                        <div style="font-weight: 600; font-size: 0.9rem; color: ${!state.useIndexedDB ? 'white' : '#94a3b8'};">📦 Local</div>
                                        <div style="font-size: 0.7rem; color: ${!state.useIndexedDB ? '#e0f2fe' : '#64748b'};">Max 5MB</div>
                                    </div>
                                </label>
                                
                                <label style="flex: 1; cursor: pointer;">
                                    <input type="radio" 
                                           name="storageTypeData" 
                                           value="indexedDB" 
                                           ${state.useIndexedDB ? 'checked' : ''}
                                           onchange="handleStorageTypeChange(this.value)"
                                           style="display: none;">
                                    <div style="padding: 10px; background: ${state.useIndexedDB ? '#0891b2' : '#1e293b'}; border-radius: 8px; text-align: center; border: 1px solid ${state.useIndexedDB ? '#0891b2' : '#334155'}; transition: all 0.2s;">
                                        <div style="font-weight: 600; font-size: 0.9rem; color: ${state.useIndexedDB ? 'white' : '#94a3b8'};">🗄️ IndexedDB</div>
                                        <div style="font-size: 0.7rem; color: ${state.useIndexedDB ? '#e0f2fe' : '#64748b'};">Ilimitado</div>
                                    </div>
                                </label>
                            </div>
                            
                            ${state.useIndexedDB ? `
                                <div style="background: #1e293b; padding: 8px; border-radius: 6px; border: 1px solid #334155;">
                                    <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 4px;">
                                        📊 Estadísticas:
                                    </div>
                                    <div id="indexeddb-stats" style="font-size: 0.7rem; color: #64748b;">
                                        Cargando...
                                    </div>
                                </div>
                            ` : ''}
                        </div>

                        <!-- Exportar Backup -->
                        <div style="background: #0f172a; border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid #334155;">
                            <div style="display: flex; align-items: start; gap: 12px; margin-bottom: 12px;">
                                <div style="font-size: 1.5rem;">📥</div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; color: #f1f5f9; margin-bottom: 4px;">Exportar Datos</div>
                                    <div style="font-size: 0.875rem; color: #94a3b8; line-height: 1.6;">
                                        Descarga todos tus datos en formato JSON para hacer un respaldo de seguridad.
                                    </div>
                                </div>
                            </div>
                            <button onclick="exportData()" class="btn btn-secondary" style="width: 100%;">
                                📥 Exportar Backup
                            </button>
                        </div>
                        
                        <!-- Importar Backup -->
                        <div style="background: #0f172a; border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid #334155;">
                            <div style="display: flex; align-items: start; gap: 12px; margin-bottom: 12px;">
                                <div style="font-size: 1.5rem;">📤</div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; color: #f1f5f9; margin-bottom: 4px;">Importar Datos</div>
                                    <div style="font-size: 0.875rem; color: #94a3b8; line-height: 1.6;">
                                        Carga un archivo de respaldo previamente exportado.
                                    </div>
                                    <div style="font-size: 0.75rem; color: #f59e0b; margin-top: 8px; display: flex; align-items: center; gap: 4px;">
                                        <span>⚠️</span>
                                        <span>Esto reemplazará todos tus datos actuales</span>
                                    </div>
                                </div>
                            </div>
                            <input type="file" id="import-file-input" accept=".json" style="display: none;" onchange="importData(event)">
                            <button onclick="document.getElementById('import-file-input').click()" class="btn btn-secondary" style="width: 100%;">
                                📤 Importar Backup
                            </button>
                        </div>
                        
                        <!-- Eliminar Todos los Datos -->
                        <div style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(220, 38, 38, 0.05)); border-radius: 12px; padding: 16px; border: 2px solid #dc2626;">
                            <div style="display: flex; align-items: start; gap: 12px; margin-bottom: 12px;">
                                <div style="font-size: 1.5rem;">🗑️</div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; color: #ef4444; margin-bottom: 4px;">Eliminar Todos los Datos</div>
                                    <div style="font-size: 0.875rem; color: #94a3b8; line-height: 1.6;">
                                        Elimina permanentemente toda la información del sistema. Esta acción no se puede deshacer.
                                    </div>
                                    <div style="font-size: 0.75rem; color: #ef4444; margin-top: 8px; font-weight: 600;">
                                        ⚠️ ADVERTENCIA: Se eliminarán empleados, posiciones, asistencia y configuración.
                                    </div>
                                </div>
                            </div>
                            <button onclick="deleteAllData()" style="width: 100%; padding: 12px 24px; border-radius: 10px; background: linear-gradient(135deg, #dc2626, #b91c1c); border: none; color: white; font-weight: 700; cursor: pointer; transition: all 0.2s; font-size: 0.875rem;" onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='0 8px 20px rgba(220, 38, 38, 0.4)'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'">
                                🗑️ Eliminar Todo
                            </button>
                        </div>
                        </div>
                    </div>
            `;
}

// ============================================
// PESTAÑA: CALENDARIO  
// ============================================

// ============================================
// PESTAÑA: CALENDARIO  
// ============================================
function SettingsTabCalendar() {
    return `
                <!-- Fecha de Pago Global -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        💰 Fecha de Pago Global
                    </h3>
                    <div class="form-group">
                        <label class="form-label">Día del mes para pagos periódicos</label>
                        <input type="number" 
                               id="globalPaymentDay" 
                               value="${state.settings.globalPaymentDay || ''}" 
                               class="form-input"
                               min="1" max="31"
                               placeholder="Ej: 15 (día 15 de cada mes)"
                               onchange="updateGlobalPaymentDay(this.value)">
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px; line-height: 1.6;">
                            Este día aparecerá marcado con 💰 en el calendario flotante de cada empleado.
                            Útil para identificar visualmente cuándo se realizan los pagos mensuales.
                        </div>
                    </div>
                </div>
                
                <!-- Días Festivos -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        ☀️ Días Festivos del Año
                    </h3>
                    <div style="font-size: 0.875rem; color: #94a3b8; margin-bottom: 16px;">
                        Click en un día para marcarlo/desmarcarlo como festivo. Los días festivos tendrán pago especial según el factor configurado.
                    </div>
                    ${SettingsHolidayCalendar()}
                    <div style="margin-top: 12px; font-size: 0.75rem; color: #64748b;">
                        📅 Total de días festivos configurados: <strong style="color: #f59e0b;">${state.settings.holidays.length}</strong>
                    </div>
                </div>
            `;
}

function SettingsForm() {
    const iconSetOptions = icons.getAvailableSets()
        .map(set => `<option value="${set}" ${state.settings.iconSet === set ? 'selected' : ''}>${set}</option>`)
        .join('');

    return `
                <!-- Información de la Empresa -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        🏢 Información de la Empresa
                    </h3>
                    <div class="form-group">
                        <label class="form-label">Nombre de la Empresa</label>
                        <input type="text" 
                               id="companyName" 
                               value="${state.settings.companyName}" 
                               class="form-input"
                               placeholder="Ej: Constructora El Progreso">
                    </div>
                </div>

                <!-- Iconos -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        ${icons.get('palette')} Iconos
                    </h3>
                    <div class="form-group">
                        <label class="form-label">Estilo de iconos</label>
                        <select id="iconSet" class="form-input" onchange="previewIconSet(this.value)">
                            ${iconSetOptions}
                        </select>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px; line-height: 1.6;">
                            Se aplica a toda la aplicación y queda guardado como preferencia.
                        </div>
                    </div>
                </div>

                <!-- Sistema de Almacenamiento MOVIDO a Pestaña Datos -->
                
                <!-- Auto-Guardado Eliminado -->
                
                <!-- Instalación como App (PWA) -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        📱 Instalar como Aplicación
                    </h3>
                    
                    <div style="background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 16px;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="font-size: 2.5rem;">📲</div>
                            <div>
                                <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">
                                    Instala esta app en tu dispositivo
                                </div>
                                <div style="font-size: 0.875rem; color: #94a3b8;">
                                    Acceso rápido sin abrir el navegador
                                </div>
                            </div>
                        </div>
                        
                        <div style="font-size: 0.75rem; color: #64748b; line-height: 1.6; margin-bottom: 16px;">
                            <strong style="color: #10b981;">Ventajas de instalar:</strong><br>
                            ✅ Icono en tu pantalla de inicio<br>
                            ✅ Funciona como app nativa<br>
                            ✅ Sin barra del navegador<br>
                            ✅ Más rápido de abrir<br>
                            ✅ Funciona offline (si activaste IndexedDB)
                        </div>
                        
                        <div id="install-pwa-status"></div>
                        
                        <button id="install-pwa-button" 
                                onclick="handleInstallPWA()" 
                                class="btn btn-primary" 
                                style="width: 100%; padding: 12px; font-size: 1rem; background: linear-gradient(135deg, #10b981, #059669); border: none;">
                            📱 Instalar Aplicación
                        </button>
                    </div>
                    
                    <details style="margin-top: 12px;">
                        <summary style="cursor: pointer; color: #94a3b8; font-size: 0.875rem; padding: 8px; background: #0f172a; border-radius: 6px;">
                            ℹ️ ¿Cómo instalar manualmente?
                        </summary>
                        <div style="margin-top: 12px; padding: 12px; background: #0f172a; border-radius: 6px; font-size: 0.75rem; color: #64748b; line-height: 1.8;">
                            <strong style="color: #06b6d4;">En Android (Chrome/Edge):</strong><br>
                            1. Menú (⋮) → "Agregar a pantalla de inicio"<br>
                            2. Confirmar instalación<br>
                            <br>
                            <strong style="color: #06b6d4;">En iPhone/iPad (Safari):</strong><br>
                            1. Botón "Compartir" (▢↑)<br>
                            2. "Agregar a pantalla de inicio"<br>
                            3. Confirmar<br>
                            <br>
                            <strong style="color: #06b6d4;">En PC (Chrome/Edge):</strong><br>
                            1. Icono de instalación en la barra de direcciones<br>
                            2. Click en "Instalar"
                        </div>
                    </details>
                </div>
                
                <!-- Jornada Laboral -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        ⏰ Jornada Laboral
                    </h3>
                    
                    <!-- Horas Regulares -->
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            <span>Horas Regulares por Día</span>
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Define cuántas horas se consideran como jornada normal">ⓘ</span>
                        </label>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <input type="number" 
                                   id="regularHoursPerDay" 
                                   value="${state.settings.regularHoursPerDay}" 
                                   min="1" 
                                   max="24" 
                                   step="0.5"
                                   class="form-input"
                                   style="flex: 1;">
                            <span style="color: #94a3b8; font-size: 0.875rem;">horas</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            💡 Las horas trabajadas por encima de este valor se considerarán extras
                        </div>
                    </div>
                    
                    <!-- ⚡ NUEVO: Factor Horas Extras -->
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            <span>Factor de Horas Extras</span>
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Multiplicador para calcular el pago de horas extras">ⓘ</span>
                        </label>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <input type="number" 
                                   id="overtimeFactor" 
                                   value="${state.settings.overtimeFactor || 1.5}" 
                                   min="1" 
                                   max="5" 
                                   step="0.1"
                                   class="form-input"
                                   style="flex: 1;">
                            <span style="color: #94a3b8; font-size: 0.875rem;">× (multiplicador)</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            💡 Ejemplo: Factor 1.5 = tiempo y medio, Factor 2 = doble pago
                        </div>
                    </div>
                    
                    <!-- Factor Festivos -->
                    <div class="form-group">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            <span>Factor de Días Festivos</span>
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Multiplicador para calcular el pago en días festivos">ⓘ</span>
                        </label>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <input type="number" 
                                   id="holidayFactor" 
                                   value="${state.settings.holidayFactor}" 
                                   min="1" 
                                   max="5" 
                                   step="0.5"
                                   class="form-input"
                                   style="flex: 1;">
                            <span style="color: #94a3b8; font-size: 0.875rem;">× (multiplicador)</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            💡 Ejemplo: Factor 2 = doble pago, Factor 1.5 = pago y medio
                        </div>
                    </div>
                </div>
                
                <!-- Configuración de Nómina -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        💰 Configuración de Nómina
                    </h3>
                    
                    <!-- ⚡ NUEVO: Porcentaje de deducción por defecto -->
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            💸 Porcentaje de Deducción por Defecto
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Este porcentaje se aplicará automáticamente al agregar deducciones">ⓘ</span>
                        </label>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <input type="number" 
                                   id="defaultDeductionPercentage" 
                                   value="${state.settings.defaultDeductionPercentage || 2}" 
                                   min="0" 
                                   max="100"
                                   step="0.5"
                                   class="form-input"
                                   style="flex: 1;">
                            <span style="color: #94a3b8; font-size: 0.875rem;">%</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            💡 Todas las nuevas deducciones usarán este porcentaje por defecto. Se puede cambiar individualmente en cada nómina.
                        </div>
                    </div>
                    
                    <!-- ⚡ NUEVO: Último día de pago global -->
                    <div class="form-group" style="margin-top: 16px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            📅 Último Día de Pago (Global)
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Configura el último día en que se pagó nómina a todos los empleados">ⓘ</span>
                        </label>
                        <input type="date" 
                               id="globalLastPaymentDate" 
                               value="${state.settings.globalLastPaymentDate || ''}" 
                               class="form-input">
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            💡 Esta fecha se usará en el preset "Desde Último Pago" para todos los empleados que no tengan una fecha individual configurada.
                        </div>
                    </div>
                </div>
            `;
}

function SettingsHolidayCalendar() {
    const month = state.settingsCalendarMonth;
    const year = month.getFullYear();
    const monthIndex = month.getMonth();

    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);
    const startDayOfWeek = firstDay.getDay();

    const days = [];

    // Días del mes anterior
    const prevMonthLastDay = new Date(year, monthIndex, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        days.push({ date: new Date(year, monthIndex - 1, prevMonthLastDay - i), currentMonth: false });
    }

    // Días del mes actual
    for (let i = 1; i <= lastDay.getDate(); i++) {
        days.push({ date: new Date(year, monthIndex, i), currentMonth: true });
    }

    // Días del mes siguiente
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
        days.push({ date: new Date(year, monthIndex + 1, i), currentMonth: false });
    }

    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    return `
                <div style="background: #0f172a; border-radius: 8px; padding: 16px;">
                    <!-- Header del calendario -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <button type="button" 
                                onclick="changeSettingsCalendarMonth(-1)" 
                                style="background: #1e293b; border: 1px solid #334155; color: #06b6d4; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; font-size: 1.25rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
                                onmouseover="this.style.borderColor='#06b6d4'; this.style.background='#334155'"
                                onmouseout="this.style.borderColor='#334155'; this.style.background='#1e293b'">
                            ◀
                        </button>
                        <div style="font-size: 1rem; font-weight: 700; color: #f1f5f9;">
                            ${formatMonthYear(month)}
                        </div>
                        <button type="button" 
                                onclick="changeSettingsCalendarMonth(1)" 
                                style="background: #1e293b; border: 1px solid #334155; color: #06b6d4; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; font-size: 1.25rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
                                onmouseover="this.style.borderColor='#06b6d4'; this.style.background='#334155'"
                                onmouseout="this.style.borderColor='#334155'; this.style.background='#1e293b'">
                            ▶
                        </button>
                    </div>
                    
                    <!-- Grid del calendario -->
                    <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">
                        <!-- Nombres de días -->
                        ${dayNames.map(name => `
                            <div style="text-align: center; padding: 8px; font-size: 0.75rem; font-weight: 600; color: #64748b;">
                                ${name}
                            </div>
                        `).join('')}
                        
                        <!-- Días -->
                        ${days.map(({ date, currentMonth }) => {
        const dateKey = getDateKey(date);
        const isHoliday = state.settings.holidays.includes(dateKey);
        const isToday = dateKey === getDateKey(new Date());
        const isFuture = dateKey > getDateKey(new Date());
        const isLastPayment = state.settings.lastPaymentDate === dateKey;
        const isNextPayment = state.settings.nextPaymentDate === dateKey;

        let bgColor = '#1e293b';
        let textColor = currentMonth ? '#f1f5f9' : '#475569';
        let borderColor = '#334155';
        let dayIcon = '';

        // Determinar color e icono según los marcadores
        if (isHoliday) {
            bgColor = 'linear-gradient(135deg, #f59e0b, #fbbf24)';
            textColor = '#fff';
            borderColor = '#f59e0b';
            dayIcon = '☀️';
        }
        if (isLastPayment) {
            dayIcon = dayIcon ? dayIcon + ' 💵' : '💵';
        }
        if (isNextPayment) {
            dayIcon = dayIcon ? dayIcon + ' 📅' : '📅';
        }

        if (isToday && !isHoliday) {
            borderColor = '#06b6d4';
        }

        // Deshabilitar clic en "último pago" para fechas futuras
        const isClickable = currentMonth && !(state.calendarMarkerMode === 'lastPayment' && isFuture);

        return `
                                <div onclick="${isClickable ? `handleCalendarDayClick('${dateKey}')` : ''}"
                                     style="
                                        background: ${bgColor};
                                        border: 2px solid ${borderColor};
                                        padding: 6px;
                                        border-radius: 8px;
                                        ${!currentMonth ? 'opacity: 0.3;' : ''}
                                        ${isClickable ? 'cursor: pointer;' : 'cursor: not-allowed; opacity: 0.5;'}
                                        min-height: 60px;
                                        display: flex;
                                        flex-direction: column;
                                        align-items: center;
                                        justify-content: center;
                                        transition: all 0.2s;
                                     "
                                     ${isClickable ? `onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.3)'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'"` : ''}>
                                    <div style="color: ${textColor}; font-size: 0.875rem; font-weight: ${isHoliday ? '700' : '500'}; margin-bottom: ${dayIcon ? '4px' : '0'};">
                                        ${date.getDate()}
                                    </div>
                                    ${dayIcon ? `<div style="font-size: 0.7rem; line-height: 1;">${dayIcon}</div>` : ''}
                                </div>
                            `;
    }).join('')}
                    </div>
                    
                    <!-- Toggle Buttons -->
                    <div style="display: flex; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #334155;">
                        <button onclick="setCalendarMarkerMode('holiday')" 
                                style="flex: 1; padding: 10px; background: ${state.calendarMarkerMode === 'holiday' ? '#f59e0b' : 'rgba(245,158,11,0.2)'}; border: 2px solid ${state.calendarMarkerMode === 'holiday' ? '#f59e0b' : 'rgba(245,158,11,0.3)'}; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s; font-size: 0.8rem; font-weight: ${state.calendarMarkerMode === 'holiday' ? '700' : '600'}; color: ${state.calendarMarkerMode === 'holiday' ? '#000' : '#f59e0b'};">
                            <span style="font-size: 1rem;">☀️</span>
                            <span>Festivo</span>
                        </button>
                        <button onclick="setCalendarMarkerMode('lastPayment')" 
                                style="flex: 1; padding: 10px; background: ${state.calendarMarkerMode === 'lastPayment' ? '#10b981' : 'rgba(16,185,129,0.2)'}; border: 2px solid ${state.calendarMarkerMode === 'lastPayment' ? '#10b981' : 'rgba(16,185,129,0.3)'}; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s; font-size: 0.8rem; font-weight: ${state.calendarMarkerMode === 'lastPayment' ? '700' : '600'}; color: ${state.calendarMarkerMode === 'lastPayment' ? '#000' : '#10b981'};">
                            <span style="font-size: 1rem;">💵</span>
                            <span>Último pago</span>
                        </button>
                        <button onclick="setCalendarMarkerMode('nextPayment')" 
                                style="flex: 1; padding: 10px; background: ${state.calendarMarkerMode === 'nextPayment' ? '#06b6d4' : 'rgba(6,182,212,0.2)'}; border: 2px solid ${state.calendarMarkerMode === 'nextPayment' ? '#06b6d4' : 'rgba(6,182,212,0.3)'}; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s; font-size: 0.8rem; font-weight: ${state.calendarMarkerMode === 'nextPayment' ? '700' : '600'}; color: ${state.calendarMarkerMode === 'nextPayment' ? '#000' : '#06b6d4'};">
                            <span style="font-size: 1rem;">📅</span>
                            <span>Próximo pago</span>
                        </button>
                    </div>
                    
                    <!-- Info de fechas -->
                    <div style="margin-top: 16px; padding: 12px; background: #1e293b; border-radius: 8px; border: 1px solid #334155;">
                        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.75rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: #94a3b8;">📅 Total de días festivos:</span>
                                <span style="color: #f59e0b; font-weight: 700;">${state.settings.holidays.length}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: #94a3b8;">💵 Último pago:</span>
                                <span style="color: #10b981; font-weight: 700;">${state.settings.lastPaymentDate ? new Date(state.settings.lastPaymentDate + 'T00:00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No configurado'}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: #94a3b8;">📅 Próximo pago:</span>
                                <span style="color: #06b6d4; font-weight: 700;">${state.settings.nextPaymentDate ? new Date(state.settings.nextPaymentDate + 'T00:00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No configurado'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
}

// Funciones para Settings
window.changeSettingsCalendarMonth = function (delta) {
    const month = state.settingsCalendarMonth;
    month.setMonth(month.getMonth() + delta);
    state.settingsCalendarMonth = new Date(month);
    render();
};

window.toggleHoliday = function (dateKey) {
    const holidays = state.settings.holidays;
    const index = holidays.indexOf(dateKey);

    if (index > -1) {
        // Remover
        holidays.splice(index, 1);
    } else {
        // Agregar
        holidays.push(dateKey);
        holidays.sort(); // Mantener ordenados
    }

    render();
};

// ═══ SISTEMA DE TOGGLE BUTTONS PARA CALENDARIO ═══
window.handleCalendarDayClick = function (dateKey) {
    const mode = state.calendarMarkerMode;

    if (mode === 'holiday') {
        // Modo festivo: toggle
        const holidays = state.settings.holidays;
        const index = holidays.indexOf(dateKey);
        if (index > -1) {
            holidays.splice(index, 1);
        } else {
            holidays.push(dateKey);
            holidays.sort();
        }
        saveApplicationData();
    } else if (mode === 'lastPayment') {
        // Modo último pago: solo si no es futuro
        const today = getDateKey(new Date());
        if (dateKey <= today) {
            // Toggle: si ya está marcado, lo quita
            if (state.settings.lastPaymentDate === dateKey) {
                state.settings.lastPaymentDate = null;
            } else {
                state.settings.lastPaymentDate = dateKey;
            }
            saveApplicationData();
        }
    } else if (mode === 'nextPayment') {
        // Modo próximo pago: cualquier fecha
        // Toggle: si ya está marcado, lo quita
        if (state.settings.nextPaymentDate === dateKey) {
            state.settings.nextPaymentDate = null;
        } else {
            state.settings.nextPaymentDate = dateKey;
        }
        saveApplicationData();
    }

    render();
};

// Cambiar modo de marcador activo
window.setCalendarMarkerMode = function (mode) {
    state.calendarMarkerMode = mode;
    render();
};


// ============================================
// ============================================
// ACTUALIZAR CONFIGURACIÓN DE FECHA DE PAGO GLOBAL
// ============================================

window.updateGlobalPaymentDay = function (day) {
    const dayNum = parseInt(day);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
        state.settings.globalPaymentDay = null;
    } else {
        state.settings.globalPaymentDay = dayNum;
    }
    saveApplicationData();
    showNotification(`💰 Fecha de pago actualizada: día ${dayNum || 'no configurado'}`, 'success');
};

// ============================================
// GESTIÓN DE TIPO DE ALMACENAMIENTO
// ============================================

window.handleStorageTypeChange = async function (storageType) {
    const wasUsingIndexedDB = state.useIndexedDB;
    const willUseIndexedDB = storageType === 'indexedDB';

    if (wasUsingIndexedDB === willUseIndexedDB) {
        return; // No hay cambio
    }

    try {
        if (willUseIndexedDB) {
            // Cambiar a IndexedDB
            Notification.info('⏳ Migrando datos a IndexedDB...');

            // Inicializar IndexedDB
            await indexedDBService.init();

            // Migrar datos desde localStorage
            const migrated = await indexedDBService.migrateFromLocalStorage();

            if (migrated) {
                state.useIndexedDB = true;
                Notification.success('✅ Migración completada - Ahora usando IndexedDB');

                // Mostrar estadísticas
                setTimeout(async () => {
                    await updateIndexedDBStats();
                }, 500);
            } else {
                // No había datos para migrar, solo activar
                state.useIndexedDB = true;
                Notification.success('✅ IndexedDB activado correctamente');
            }

        } else {
            // Cambiar a localStorage
            const confirmed = confirm(
                '⚠️ ¿Cambiar a localStorage?\n\n' +
                'IndexedDB tiene más capacidad y es más persistente.\n' +
                'localStorage tiene límite de 5-10MB.\n\n' +
                'Los datos actuales se mantendrán en IndexedDB como backup.\n\n' +
                '¿Continuar?'
            );

            if (confirmed) {
                state.useIndexedDB = false;

                // Guardar en localStorage inmediatamente
                saveApplicationData();

                Notification.success('✅ Cambiado a localStorage');
            } else {
                // Cancelar cambio, volver a IndexedDB
                document.querySelector('input[value="indexedDB"]').checked = true;
                return;
            }
        }

        // Guardar preferencia
        saveApplicationData();
        render();

    } catch (error) {
        debug.error('❌ Error al cambiar tipo de almacenamiento:', error);
        Notification.error('❌ Error al cambiar tipo de almacenamiento');

        // Revertir cambio
        state.useIndexedDB = wasUsingIndexedDB;
        render();
    }
};

// Actualizar estadísticas de IndexedDB
window.updateIndexedDBStats = async function () {
    try {
        const statsEl = document.getElementById('indexeddb-stats');
        if (!statsEl) return;

        const employeesCount = await indexedDBService.count('employees');
        const positionsCount = await indexedDBService.count('positions');
        const attendanceCount = await indexedDBService.count('attendance');
        const leadersCount = await indexedDBService.count('leaders');

        statsEl.innerHTML = `
                    • Empleados: <strong style="color: #06b6d4;">${employeesCount}</strong><br>
                    • Posiciones: <strong style="color: #06b6d4;">${positionsCount}</strong><br>
                    • Líderes: <strong style="color: #06b6d4;">${leadersCount}</strong><br>
                    • Registros de asistencia: <strong style="color: #06b6d4;">${attendanceCount}</strong><br>
                    • Estado: <strong style="color: #10b981;">✅ Funcionando correctamente</strong>
                `;
    } catch (error) {
        debug.error('Error obteniendo estadísticas:', error);
    }
};

// ============================================
// INSTALACIÓN PWA
// ============================================

window.handleInstallPWA = async function () {
    const button = document.getElementById('install-pwa-button');
    const status = document.getElementById('install-pwa-status');

    if (!installPrompt.canInstall()) {
        // Verificar si ya está instalada
        if (window.matchMedia('(display-mode: standalone)').matches) {
            status.innerHTML = `
                        <div style="padding: 12px; background: #10b981; color: white; border-radius: 8px; margin-bottom: 12px; text-align: center;">
                            ✅ La app ya está instalada
                        </div>
                    `;
            button.style.display = 'none';
        } else {
            status.innerHTML = `
                        <div style="padding: 12px; background: #f59e0b; color: white; border-radius: 8px; margin-bottom: 12px; font-size: 0.875rem;">
                            ℹ️ Instalación no disponible en este momento<br>
                            <span style="font-size: 0.75rem; opacity: 0.9;">
                                Usa las instrucciones manuales abajo ↓
                            </span>
                        </div>
                    `;
            button.disabled = true;
            button.style.opacity = '0.5';
            button.style.cursor = 'not-allowed';
        }
        return;
    }

    // Instalar
    const installed = await installPrompt.install();

    if (installed) {
        status.innerHTML = `
                    <div style="padding: 12px; background: #10b981; color: white; border-radius: 8px; margin-bottom: 12px; text-align: center;">
                        ✅ ¡App instalada correctamente!
                    </div>
                `;
        button.style.display = 'none';
    }
};

// Actualizar estado del botón de instalación al abrir settings
window.updateInstallPWAButton = function () {
    const button = document.getElementById('install-pwa-button');
    const status = document.getElementById('install-pwa-status');

    if (!button || !status) return;

    // Verificar si ya está instalada
    if (window.matchMedia('(display-mode: standalone)').matches) {
        status.innerHTML = `
                    <div style="padding: 12px; background: #10b981; color: white; border-radius: 8px; margin-bottom: 12px; text-align: center;">
                        ✅ App instalada - Estás usando la versión instalada
                    </div>
                `;
        button.style.display = 'none';
        return;
    }

    // Verificar si puede instalar
    if (!installPrompt.canInstall()) {
        status.innerHTML = `
                    <div style="padding: 12px; background: #f59e0b; color: white; border-radius: 8px; margin-bottom: 12px; font-size: 0.875rem;">
                        ℹ️ Instalación automática no disponible<br>
                        <span style="font-size: 0.75rem; opacity: 0.9;">
                            Usa las instrucciones manuales abajo ↓
                        </span>
                    </div>
                `;
        button.disabled = true;
        button.style.opacity = '0.5';
        button.style.cursor = 'not-allowed';
    } else {
        status.innerHTML = `
                    <div style="padding: 12px; background: #0891b2; color: white; border-radius: 8px; margin-bottom: 12px; text-align: center;">
                        ✨ ¡Instalación disponible!
                    </div>
                `;
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
    }
};

// ============================================
// FUNCIONES DE BACKUP MANUAL (CANVAS DE CLAUDE)
// ============================================

window.downloadBackupNow = function () {
    try {
        const backupData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            appName: state.settings.companyName,
            data: {
                employees: state.employees,
                positions: state.positions,
                leaders: state.leaders,
                attendance: state.attendance,
                settings: state.settings
            }
        };

        const json = JSON.stringify(backupData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        const filename = `asistencia-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        Notification.success(`✅ Backup descargado: ${filename}`);
        debug.log('💾 Backup manual creado');
    } catch (error) {
        debug.error('❌ Error creando backup:', error);
        Notification.error('❌ Error al crear backup');
    }
};

window.loadBackupFile = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const backup = JSON.parse(e.target.result);

            if (!backup.data) {
                throw new Error('Formato de backup inválido');
            }

            const confirmed = confirm(
                `⚠️ ¿Cargar backup?\n\n` +
                `Archivo: ${file.name}\n` +
                `Fecha: ${new Date(backup.timestamp).toLocaleString()}\n` +
                `Empresa: ${backup.appName || 'N/A'}\n\n` +
                `Esto reemplazará los datos actuales.\n\n` +
                `¿Continuar?`
            );

            if (!confirmed) {
                event.target.value = ''; // Reset input
                return;
            }

            // Cargar datos
            state.employees = backup.data.employees || [];
            state.positions = backup.data.positions || [];
            state.leaders = backup.data.leaders || [];
            state.attendance = backup.data.attendance || {};

            if (backup.data.settings) {
                Object.assign(state.settings, backup.data.settings);
            }

            // Guardar en storage
            saveApplicationData();

            // Re-renderizar
            render();

            Notification.success('✅ Backup cargado correctamente');
            debug.log('📤 Backup restaurado desde archivo');

            // Reset input
            event.target.value = '';

        } catch (error) {
            debug.error('❌ Error cargando backup:', error);
            Notification.error('❌ Error al cargar backup. Verifica el archivo.');
            event.target.value = '';
        }
    };

    reader.readAsText(file);
};

window.toggleAutoBackup = function (enabled) {
    state.autoBackupEnabled = enabled;
    saveApplicationData();

    if (enabled) {
        Notification.success('✅ Auto-backup activado');
        createAutoBackup();
    } else {
        Notification.info('ℹ️ Auto-backup desactivado');
    }
};

// ============================================
// Dashboard de Configuración - Funciones de Cálculo
// ============================================

/**
 * Calcula estadísticas de uso de localStorage
 */
function calculateStorageStats() {
    let totalSize = 0;

    // Calcular tamaño total del localStorage
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            const value = localStorage[key];
            totalSize += (key.length + value.length) * 2; // UTF-16 = 2 bytes por carácter
        }
    }

    const usedBytes = totalSize;
    const usedKB = (totalSize / 1024).toFixed(2);
    const usedMB = (totalSize / 1024 / 1024).toFixed(2);
    const limitMB = 5; // Límite aproximado de localStorage
    const percentage = Math.min(100, ((usedMB / limitMB) * 100).toFixed(0));

    return {
        usedBytes,
        usedKB,
        usedMB,
        limitMB,
        percentage: parseInt(percentage),
        available: (limitMB - usedMB).toFixed(2)
    };
}

/**
 * Obtiene el estado de sincronización con Supabase
 */
async function getSupabaseSyncStatus() {
    return await supabaseService.getSyncStatus();
}

/**
 * Formatea tiempo transcurrido (ej: "Hace 5 minutos")
 */
function getTimeAgo(date) {
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Hace un momento';
    if (minutes < 60) return `Hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    if (hours < 24) return `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
    return `Hace ${days} día${days > 1 ? 's' : ''}`;
}

/**
 * Actualiza el estado de sincronización (llama a getSupabaseSyncStatus y guarda en state)
 */
async function updateSyncStatus() {
    if (useSupabase && currentUser) {
        state.supabaseSyncStatus = await getSupabaseSyncStatus();
    }
}

window.previewIconSet = function (value) {
    state.settings.iconSet = applyIconSet(value);
    render();
};

window.saveSettings = function () {
    // Leer valores del formulario
    const companyName = document.getElementById('companyName').value.trim();
    const regularHoursPerDay = parseFloat(document.getElementById('regularHoursPerDay').value);
    const overtimeFactor = parseFloat(document.getElementById('overtimeFactor').value);
    const holidayFactor = parseFloat(document.getElementById('holidayFactor').value);

    // ⚡ Leer configuración de nómina
    const defaultDeductionPercentage = parseFloat(document.getElementById('defaultDeductionPercentage').value) || 2;
    const globalLastPaymentDate = document.getElementById('globalLastPaymentDate').value || null;
    const iconSet = document.getElementById('iconSet')?.value || state.settings.iconSet;

    // Validaciones
    if (!companyName) {
        showNotification('❌ El nombre de la empresa es requerido', 'error');
        return;
    }

    if (regularHoursPerDay < 1 || regularHoursPerDay > 24) {
        showNotification('❌ Las horas regulares deben estar entre 1 y 24', 'error');
        return;
    }

    if (overtimeFactor < 1 || overtimeFactor > 5) {
        showNotification('❌ El factor de horas extras debe estar entre 1 y 5', 'error');
        return;
    }

    if (holidayFactor < 1 || holidayFactor > 5) {
        showNotification('❌ El factor festivo debe estar entre 1 y 5', 'error');
        return;
    }

    if (defaultDeductionPercentage < 0 || defaultDeductionPercentage > 100) {
        showNotification('❌ El porcentaje de deducción debe estar entre 0 y 100', 'error');
        return;
    }

    // Guardar configuración
    state.settings.companyName = companyName;
    state.settings.regularHoursPerDay = regularHoursPerDay;
    state.settings.overtimeFactor = overtimeFactor;
    state.settings.holidayFactor = holidayFactor;

    // ⚡ Guardar configuración de nómina
    state.settings.defaultDeductionPercentage = defaultDeductionPercentage;
    state.settings.globalLastPaymentDate = globalLastPaymentDate;
    state.settings.iconSet = applyIconSet(iconSet);
    state.settings.updatedAt = Date.now();
    state.settings._isDirty = true;

    saveApplicationData(); // Guardar en localStorage
    showNotification('✅ Configuración guardada correctamente', 'success');
    render();
};

// ============================================
// GESTIÓN DE DATOS: EXPORTAR, IMPORTAR, ELIMINAR
// ============================================

window.exportData = async function () {
    try {
        // Crear objeto con todos los datos
        const exportData = {
            version: '1.0.0',
            exportDate: new Date().toISOString(),
            companyName: state.settings.companyName,
            data: {
                settings: state.settings,
                positions: state.positions,
                employees: state.employees,
                leaders: state.leaders,
                attendance: state.attendance,
                tempAssignments: state.tempAssignments || [],
                dayHoursConfig: state.dayHoursConfig || {}
            }
        };

        // Generar nombre de archivo
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `backup-${state.settings.companyName.replace(/\s+/g, '-')}-${dateStr}.json`;

        // Crear blob
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });

        // Mostrar menú de exportar
        showExportMenu({
            filename: filename,
            blob: blob,
            title: `Backup - ${state.settings.companyName}`,
            text: `Respaldo de datos del ${new Date().toLocaleDateString('es-DO')}`
        });

    } catch (error) {
        console.error('Error exportando datos:', error);
        showNotification('❌ Error al exportar datos', 'error');
    }
};

window.loadBackupFromFile = async function (file) {
    if (!file) return false;

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function (e) {
            try {
                const importedData = JSON.parse(e.target.result);

                // Validar estructura
                if (!importedData.data) {
                    throw new Error('Formato de archivo inválido');
                }

                // Confirmar antes de importar
                const confirmImport = confirm(
                    '⚠️ ADVERTENCIA\n\n' +
                    'Esto reemplazará TODOS tus datos actuales con los del archivo de respaldo.\n\n' +
                    'Se recomienda exportar tus datos actuales primero.\n\n' +
                    '¿Estás seguro de continuar?'
                );

                if (!confirmImport) {
                    resolve(false);
                    return;
                }

                // Importar datos
                state.settings = importedData.data.settings || state.settings;
                state.positions = importedData.data.positions || [];
                state.employees = importedData.data.employees || [];
                state.leaders = importedData.data.leaders || [];
                state.attendance = importedData.data.attendance || {};
                state.tempAssignments = importedData.data.tempAssignments || [];
                state.dayHoursConfig = importedData.data.dayHoursConfig || {};

                // Normalizar updatedAt para Smart Sync
                const now = Date.now();
                if (!state.settings.updatedAt) state.settings.updatedAt = now;
                state.leaders.forEach(l => { if (!l.updatedAt) l.updatedAt = now; });
                state.positions.forEach(p => { if (!p.updatedAt) p.updatedAt = now; });
                state.employees.forEach(e => { if (!e.updatedAt) e.updatedAt = now; });
                Object.values(state.attendance).forEach(a => { if (!a.updatedAt) a.updatedAt = now; });

                // Guardar en localStorage
                saveApplicationData();

                showNotification('✅ Datos importados correctamente', 'success');
                render();
                resolve(true);

            } catch (error) {
                console.error('Error importando datos:', error);
                showNotification('❌ Error al importar datos: ' + error.message, 'error');
                resolve(false);
            }
        };

        reader.onerror = function () {
            showNotification('❌ Error al leer el archivo', 'error');
            resolve(false);
        };

        reader.readAsText(file);
    });
};

window.importData = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    window.loadBackupFromFile(file);

    // Limpiar input
    event.target.value = '';
};

window.deleteAllData = function () {
    // Triple confirmación para acción destructiva
    const confirm1 = confirm(
        '⚠️ ADVERTENCIA: ELIMINAR TODOS LOS DATOS\n\n' +
        'Esta acción es PERMANENTE y NO se puede deshacer.\n\n' +
        'Se eliminarán:\n' +
        '• Todos los empleados\n' +
        '• Todas las posiciones\n' +
        '• Todo el historial de asistencia\n' +
        '• Toda la configuración\n\n' +
        '¿Estás COMPLETAMENTE SEGURO?'
    );

    if (!confirm1) return;

    const confirm2 = confirm(
        '🚨 ÚLTIMA ADVERTENCIA\n\n' +
        'Una vez eliminados, los datos NO se pueden recuperar.\n\n' +
        'Se recomienda EXPORTAR un backup antes de continuar.\n\n' +
        '¿Deseas continuar con la eliminación?'
    );

    if (!confirm2) return;

    // Pedir confirmación escribiendo texto
    const confirmText = prompt(
        'Para confirmar, escribe exactamente:\nELIMINAR TODO\n\n' +
        '(Escribe en mayúsculas)'
    );

    if (confirmText !== 'ELIMINAR TODO') {
        showNotification('❌ Cancelado: texto de confirmación incorrecto', 'error');
        return;
    }

    try {
        // Limpiar localStorage
        localStorage.clear();

        // Reiniciar estado a valores por defecto
        state.settings = {
            companyName: 'Mi Empresa',
            regularHoursPerDay: 8,
            holidayFactor: 2,
            iconSet: resolveIconSet(),
            holidays: []
        };
        state.positions = [];
        state.employees = [];
        state.attendance = {};
        state.tempAssignments = [];
        state.leaders = [];

        showNotification('✅ Todos los datos han sido eliminados', 'success');

        // Recargar página después de 2 segundos para reiniciar onboarding
        setTimeout(() => {
            location.reload();
        }, 2000);

    } catch (error) {
        console.error('Error eliminando datos:', error);
        showNotification('❌ Error al eliminar datos', 'error');
    }
};


function MultiPositionModal() {
    const emp = state.selectedEmployee;
    if (!emp) return '';

    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    let att = state.attendance[key] || {
        employeeId: emp.id,
        date: getDateKey(state.selectedDate),
        present: true,
        hoursWorked: 0,
        overtimeHours: 0,
        isHoliday: isDayHoliday(state.selectedDate),
        multiPosition: false,
        positionHours: [],
        notes: ''
    };

    // Inicializar positionHours si no existe
    if (!att.positionHours) {
        att.positionHours = [];
    }

    // Si no tiene positionHours pero tiene selectedPosition, inicializar
    if (att.positionHours.length === 0 && att.selectedPosition) {
        att.positionHours = [{
            positionId: att.selectedPosition,
            hours: att.hoursWorked || 0,
            overtimeHours: att.overtimeHours || 0
        }];
    }

    // Calcular totales
    const totalHours = att.positionHours.reduce((sum, ph) => sum + ph.hours, 0);
    const totalOvertime = att.positionHours.reduce((sum, ph) => sum + ph.overtimeHours, 0);

    // Posiciones usadas
    const usedPositions = att.positionHours.map(ph => ph.positionId);
    const availablePositions = emp.positions.filter(pid => !usedPositions.includes(pid));

    return `<div class="modal-overlay" onclick="if(event.target === this) closeModal()">
                <div class="modal-content" style="max-width: 600px;">
                    <div class="modal-header">
                        <h2 class="modal-title">⚙️ Detalles de Asistencia</h2>
                        <button class="modal-close" onclick="closeModal()">✕</button>
                    </div>
                    <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
                        <!-- Información del empleado -->
                        <div style="background: #1e293b; padding: 12px; border-radius: 8px; margin-bottom: 16px; border: 1px solid #334155;">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <div class="employee-number">${emp.number}</div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; color: #f1f5f9;">${emp.name}</div>
                                    <div style="font-size: 0.75rem; color: #94a3b8;">${formatDate(state.selectedDate)}</div>
                                </div>
                                ${isDayHoliday(state.selectedDate) ? '<div style="font-size: 1.5rem;">☀️</div>' : ''}
                            </div>
                        </div>
                        
                        <!-- Distribución de horas por posición -->
                        ${emp.positions.length > 1 ? `
                            <div style="margin-bottom: 20px;">
                                <div style="font-size: 0.875rem; font-weight: 600; color: #f1f5f9; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                    <span>🔄 Distribución por Posición</span>
                                    <span style="font-size: 0.75rem; color: #64748b; font-weight: 400;">(Opcional para empleados con múltiples posiciones)</span>
                                </div>
                                
                                <div style="display: flex; flex-direction: column; gap: 12px;">
                                    ${att.positionHours.length === 0 ? `
                                        <div style="text-align: center; padding: 30px 20px; background: #1e293b; border-radius: 8px; border: 2px dashed #334155;">
                                            <div style="font-size: 2rem; margin-bottom: 8px; opacity: 0.3;">🎯</div>
                                            <div style="font-size: 0.875rem; color: #94a3b8;">Sin distribución específica</div>
                                            <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">Las horas se registrarán en la posición principal</div>
                                        </div>
                                    ` : att.positionHours.map((ph, idx) => {
        const pos = state.positions.find(p => p.id === ph.positionId);
        return `
                                            <div style="background: #1e293b; padding: 12px; border-radius: 8px; border: 2px solid ${pos?.color || '#334155'};">
                                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                                                    <div style="width: 16px; height: 16px; border-radius: 50%; background: ${pos?.color || '#64748b'};"></div>
                                                    <div style="flex: 1; font-weight: 600; color: #f1f5f9;">${pos?.name || 'Posición desconocida'}</div>
                                                    <button onclick="removePositionHours(${idx})" 
                                                            style="background: transparent; border: 1px solid #ef4444; color: #ef4444; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; transition: all 0.2s;"
                                                            onmouseover="this.style.background='#ef4444'; this.style.color='#fff'"
                                                            onmouseout="this.style.background='transparent'; this.style.color='#ef4444'">
                                                        🗑️
                                                    </button>
                                                </div>
                                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                                                    <div>
                                                        <label style="font-size: 0.75rem; color: #94a3b8; display: block; margin-bottom: 4px;">⏱️ Horas Regulares</label>
                                                        <input type="number" value="${ph.hours}" min="0" max="24" step="0.5"
                                                               oninput="updatePositionHours(${idx}, 'hours', this.value)"
                                                               style="width: 100%; background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 8px; border-radius: 6px; font-size: 1rem;">
                                                    </div>
                                                    <div>
                                                        <label style="font-size: 0.75rem; color: #94a3b8; display: block; margin-bottom: 4px;">⚡ Horas Extras</label>
                                                        <input type="number" value="${ph.overtimeHours}" min="0" max="12" step="0.5"
                                                               oninput="updatePositionHours(${idx}, 'overtimeHours', this.value)"
                                                               style="width: 100%; background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 8px; border-radius: 6px; font-size: 1rem;">
                                                    </div>
                                                </div>
                                            </div>
                                        `;
    }).join('')}
                                </div>
                                
                                ${availablePositions.length > 0 ? `
                                    <button onclick="addPositionHours()" 
                                            style="width: 100%; background: #1e293b; border: 2px dashed #334155; color: #06b6d4; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                                            onmouseover="this.style.borderColor='#06b6d4'; this.style.background='rgba(6, 182, 212, 0.1)'" 
                                            onmouseout="this.style.borderColor='#334155'; this.style.background='#1e293b'">
                                        ➕ Agregar Otra Posición
                                    </button>
                                ` : ''}
                            </div>
                        ` : ''}
                        
                        <!-- Campos de horas (si no usa distribución) -->
                        ${att.positionHours.length === 0 ? `
                            <div style="margin-bottom: 20px;">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                                    <div class="form-group">
                                        <label class="form-label">⏱️ Horas Trabajadas</label>
                                        <input type="number" id="simpleHours" class="form-input" 
                                               value="${att.hoursWorked || getDayHours(state.selectedDate)}" 
                                               min="0" max="24" step="0.5">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">⚡ Horas Extras</label>
                                        <input type="number" id="simpleOvertimeHours" class="form-input" 
                                               value="${att.overtimeHours || 0}" 
                                               min="0" max="12" step="0.5">
                                    </div>
                                </div>
                            </div>
                        ` : ''}
                        
                        <!-- Resumen de totales -->
                        <div style="background: linear-gradient(135deg, #0f172a, #1e293b); padding: 16px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 20px;">
                            <div style="font-size: 0.875rem; color: #94a3b8; margin-bottom: 12px;">📊 Total del Día:</div>
                            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                                <div>
                                    <div style="font-size: 0.75rem; color: #64748b;">Horas Regulares</div>
                                    <div style="font-size: 1.75rem; font-weight: 700; color: #10b981;" id="totalHoursDisplay">${totalHours}h</div>
                                </div>
                                <div>
                                    <div style="font-size: 0.75rem; color: #64748b;">Horas Extras</div>
                                    <div style="font-size: 1.75rem; font-weight: 700; color: #3b82f6;" id="totalOvertimeDisplay">${totalOvertime}h</div>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Día festivo -->
                        <div class="form-group" style="margin-bottom: 20px;">
                            <label class="form-checkbox" style="cursor: pointer;">
                                <input type="checkbox" id="isHolidayCheck" ${att.isHoliday ? 'checked' : ''}>
                                <span class="form-label" style="margin: 0; display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 1.25rem;">☀️</span>
                                    <span>Día Festivo (Pago doble)</span>
                                </span>
                            </label>
                        </div>
                        
                        <!-- Notas -->
                        <div class="form-group">
                            <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                                <span>📝 Notas</span>
                                <span style="font-size: 0.75rem; color: #64748b; font-weight: 400;">(Opcional)</span>
                            </label>
                            <textarea id="attendanceNotes" class="form-textarea" 
                                      placeholder="Ej: Salió temprano por cita médica, trabajó en proyecto especial..."
                                      style="min-height: 80px;">${att.notes || ''}</textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
                        <button type="button" onclick="deleteCurrentAttendance()" 
                                style="background: transparent; border: 2px solid #ef4444; color: #ef4444; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.background='#ef4444'; this.style.color='#fff'"
                                onmouseout="this.style.background='transparent'; this.style.color='#ef4444'">
                            🗑️ Eliminar Asistencia
                        </button>
                        <button type="button" class="btn btn-primary" onclick="saveMultiPosition()">💾 Guardar</button>
                    </div>
                </div>
            </div>`;
}

function ContextMenu() {
    if (!state.contextMenu) return '';

    const { type, employeeId, date, x, y } = state.contextMenu;

    // ✅ Menú para vista semanal
    if (type === 'week') {
        return `<div class="context-menu" style="left:${x}px;top:${y}px;">
                    <div class="context-menu-item" onclick="openMultiPositionModalFromContext()">
                        <span class="context-menu-icon">⚙️</span>
                        <span>Ver Detalles</span>
                    </div>
                    <div class="context-menu-item danger" onclick="removeAttendance('${employeeId}', '${date}')">
                        <span class="context-menu-icon">🗑️</span>
                        <span>Eliminar Check</span>
                    </div>
                </div>`;
    }

    // Globo contextual para check activo (Vista Día)
    if (type === 'check-options') {
        return `<div class="context-menu" style="left:${x}px;top:${y}px;">
                    <div class="context-menu-item" onclick="openMultiPositionModalFromContext()">
                        <span class="context-menu-icon">⚙️</span>
                        <span>Ver Detalles</span>
                    </div>
                    <div class="context-menu-item danger" onclick="removeAttendance('${employeeId}', '${date}')">
                        <span class="context-menu-icon">🗑️</span>
                        <span>Eliminar</span>
                    </div>
                </div>`;
    }

    if (type === 'check') {
        return `<div class="context-menu" style="left:${x}px;top:${y}px;">
                    <div class="context-menu-item" onclick="openQuickEdit('${employeeId}', '${date}')">
                        <span class="context-menu-icon">⏱️</span>
                        <span>Editar Horas</span>
                    </div>
                    <div class="context-menu-item danger" onclick="removeAttendance('${employeeId}', '${date}')">
                        <span class="context-menu-icon">🗑️</span>
                        <span>Eliminar Check</span>
                    </div>
                </div>`;
    }

    // Default: menú genérico
    return `<div class="context-menu" style="left:${x}px;top:${y}px;">
                <div class="context-menu-item" onclick="openAdvancedModalFromContext()">
                    <span class="context-menu-icon">⚙️</span>
                    <span>Ver Detalles</span>
                </div>
                <div class="context-menu-item danger" onclick="removeAttendance('${employeeId}', '${date}')">
                    <span class="context-menu-icon">🗑️</span>
                    <span>Eliminar Check</span>
                </div>
            </div>`;
}

// ============================================
// DASHBOARD TAB
// ============================================

// [LEGACY REMOVED] DashboardTab, DashboardContent, Charts -> AnalyticsUI.js

// Funciones de exportación (placeholder)
// ============================================
// FUNCIONES DE EXPORTACIÓN
// ============================================

window.exportExcel = async function () {
    try {
        const startDate = state.dashboardStartDate;
        const endDate = state.dashboardEndDate;
        const reportData = calculateReportData(startDate, endDate);

        // Crear libro de Excel
        const wb = XLSX.utils.book_new();

        // HOJA 1: Resumen General
        const summaryData = [
            ['REPORTE DE ASISTENCIA Y HORAS'],
            ['Empresa:', state.settings.companyName],
            ['Período:', `${formatDateShort(startDate)} - ${formatDateShort(endDate)}`],
            ['Generado:', new Date().toLocaleString()],
            [],
            ['RESUMEN GENERAL'],
            ['Total Empleados', reportData.totalEmployees],
            ['Días Laborables', reportData.workDays],
            ['% Asistencia Promedio', reportData.avgAttendance + '%'],
            ['Total Horas', reportData.totalHours + 'h'],
            ['Horas Extras', reportData.overtimeHours + 'h'],
            ['Costo Total Aproximado', '$' + reportData.totalCost.toLocaleString()]
        ];

        const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
        ws1['!cols'] = [{ wch: 30 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, ws1, 'Resumen');

        // HOJA 2: Por Posición
        const positionData = [
            ['RESUMEN POR POSICIÓN'],
            [],
            ['Posición', 'Empleados', '% Asistencia', 'Total Horas', 'Monto Aproximado']
        ];

        reportData.byPosition.forEach(pos => {
            positionData.push([
                pos.name,
                pos.count,
                pos.attendance + '%',
                pos.totalHours + 'h',
                '$' + pos.approxCost.toLocaleString()
            ]);
        });

        positionData.push([]);
        positionData.push([
            'TOTAL',
            reportData.totalEmployees,
            reportData.avgAttendance + '%',
            reportData.totalHours + 'h',
            '$' + reportData.totalCost.toLocaleString()
        ]);

        const ws2 = XLSX.utils.aoa_to_sheet(positionData);
        ws2['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Por Posición');

        // HOJA 3: Detalle Diario
        const dailyData = [
            ['DETALLE DIARIO DE ASISTENCIA'],
            [],
            ['Fecha', 'Empleados Presentes', 'Empleados Ausentes', 'Total Horas', 'Horas Extras']
        ];

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateKey = getDateKey(new Date(d));
            const activeEmployees = state.employees.filter(e => e.active);

            let presentCount = 0;
            let totalHours = 0;
            let totalOvertime = 0;

            activeEmployees.forEach(emp => {
                const key = `${emp.id}-${dateKey}`;
                const att = state.attendance[key];
                if (att && att.present) {
                    presentCount++;
                    totalHours += att.hoursWorked || 0;
                    totalOvertime += att.overtimeHours || 0;
                }
            });

            dailyData.push([
                formatDateShort(new Date(d)),
                presentCount,
                activeEmployees.length - presentCount,
                totalHours + 'h',
                totalOvertime + 'h'
            ]);
        }

        const ws3 = XLSX.utils.aoa_to_sheet(dailyData);
        ws3['!cols'] = [{ wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, ws3, 'Detalle Diario');

        // Generar archivo
        const fileName = `Reporte_Asistencia_${getDateKey(startDate)}_${getDateKey(endDate)}.xlsx`;

        // Generar blob
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        // Mostrar menú de exportar
        showExportMenu({
            filename: fileName,
            blob: blob,
            title: `Reporte de Asistencia - ${state.settings.companyName}`,
            text: `Reporte del ${formatDateShort(startDate)} al ${formatDateShort(endDate)}`
        });

    } catch (error) {
        console.error('Error exportando Excel:', error);
        showNotification('❌ Error al exportar Excel', 'error');
    }
};

window.exportPDF = function () {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const startDate = state.dashboardStartDate;
        const endDate = state.dashboardEndDate;
        const reportData = calculateReportData(startDate, endDate);

        // Configuración
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        let yPosition = 20;

        // Título principal
        doc.setFontSize(20);
        doc.setTextColor(6, 182, 212); // Cyan
        doc.text('REPORTE DE ASISTENCIA', pageWidth / 2, yPosition, { align: 'center' });

        yPosition += 10;
        doc.setFontSize(12);
        doc.setTextColor(100, 100, 100);
        doc.text(state.settings.companyName, pageWidth / 2, yPosition, { align: 'center' });

        yPosition += 7;
        doc.setFontSize(10);
        doc.text(`${formatDateShort(startDate)} - ${formatDateShort(endDate)}`, pageWidth / 2, yPosition, { align: 'center' });

        yPosition += 15;

        // Resumen General
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text('📊 RESUMEN GENERAL', 14, yPosition);

        yPosition += 10;

        doc.autoTable({
            startY: yPosition,
            head: [['Métrica', 'Valor']],
            body: [
                ['Total Empleados', reportData.totalEmployees],
                ['Días Laborables', reportData.workDays],
                ['% Asistencia Promedio', reportData.avgAttendance + '%'],
                ['Total Horas', reportData.totalHours + 'h'],
                ['Horas Extras', reportData.overtimeHours + 'h'],
                ['Costo Total Aproximado', '$' + reportData.totalCost.toLocaleString()]
            ],
            theme: 'grid',
            styles: { fontSize: 10, cellPadding: 5 },
            headStyles: { fillColor: [6, 182, 212], textColor: 255, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [245, 245, 245] },
            margin: { left: 14, right: 14 }
        });

        yPosition = doc.lastAutoTable.finalY + 15;

        // Verificar si necesitamos nueva página
        if (yPosition > pageHeight - 80) {
            doc.addPage();
            yPosition = 20;
        }

        // Resumen por Posición
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text('🎯 RESUMEN POR POSICIÓN', 14, yPosition);

        yPosition += 10;

        const positionTableData = reportData.byPosition.map(pos => [
            pos.name,
            pos.count,
            pos.attendance + '%',
            pos.totalHours + 'h',
            '$' + pos.approxCost.toLocaleString()
        ]);

        // Agregar fila de totales
        positionTableData.push([
            'TOTAL',
            reportData.totalEmployees,
            reportData.avgAttendance + '%',
            reportData.totalHours + 'h',
            '$' + reportData.totalCost.toLocaleString()
        ]);

        doc.autoTable({
            startY: yPosition,
            head: [['Posición', 'Empleados', '% Asist.', 'Horas', 'Monto Aprox.']],
            body: positionTableData,
            theme: 'grid',
            styles: { fontSize: 9, cellPadding: 4 },
            headStyles: { fillColor: [6, 182, 212], textColor: 255, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [245, 245, 245] },
            footStyles: { fillColor: [220, 220, 220], fontStyle: 'bold' },
            margin: { left: 14, right: 14 }
        });

        // Pie de página
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(
                `Generado: ${new Date().toLocaleString()} - Página ${i} de ${totalPages}`,
                pageWidth / 2,
                pageHeight - 10,
                { align: 'center' }
            );
        }

        // Guardar PDF
        const fileName = `Reporte_Asistencia_${getDateKey(startDate)}_${getDateKey(endDate)}.pdf`;
        doc.save(fileName);

        showNotification('✅ PDF exportado correctamente', 'success');

    } catch (error) {
        console.error('Error exportando PDF:', error);
        showNotification('❌ Error al exportar PDF', 'error');
    }
};

window.exportCSV = function () {
    try {
        const startDate = state.dashboardStartDate;
        const endDate = state.dashboardEndDate;
        const reportData = calculateReportData(startDate, endDate);

        // Crear CSV con múltiples secciones
        let csv = '';

        // Header
        csv += `REPORTE DE ASISTENCIA Y HORAS\n`;
        csv += `Empresa,${state.settings.companyName}\n`;
        csv += `Período,${formatDateShort(startDate)} - ${formatDateShort(endDate)}\n`;
        csv += `Generado,${new Date().toLocaleString()}\n`;
        csv += `\n`;

        // Resumen General
        csv += `RESUMEN GENERAL\n`;
        csv += `Métrica,Valor\n`;
        csv += `Total Empleados,${reportData.totalEmployees}\n`;
        csv += `Días Laborables,${reportData.workDays}\n`;
        csv += `% Asistencia Promedio,${reportData.avgAttendance}%\n`;
        csv += `Total Horas,${reportData.totalHours}h\n`;
        csv += `Horas Extras,${reportData.overtimeHours}h\n`;
        csv += `Costo Total Aproximado,$${reportData.totalCost.toLocaleString()}\n`;
        csv += `\n`;

        // Por Posición
        csv += `RESUMEN POR POSICIÓN\n`;
        csv += `Posición,Empleados,% Asistencia,Total Horas,Monto Aproximado\n`;

        reportData.byPosition.forEach(pos => {
            csv += `${pos.name},${pos.count},${pos.attendance}%,${pos.totalHours}h,$${pos.approxCost.toLocaleString()}\n`;
        });

        csv += `TOTAL,${reportData.totalEmployees},${reportData.avgAttendance}%,${reportData.totalHours}h,$${reportData.totalCost.toLocaleString()}\n`;
        csv += `\n`;

        // Detalle Diario
        csv += `DETALLE DIARIO\n`;
        csv += `Fecha,Presentes,Ausentes,Total Horas,Horas Extras\n`;

        const activeEmployees = state.employees.filter(e => e.active);

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateKey = getDateKey(new Date(d));

            let presentCount = 0;
            let totalHours = 0;
            let totalOvertime = 0;

            activeEmployees.forEach(emp => {
                const key = `${emp.id}-${dateKey}`;
                const att = state.attendance[key];
                if (att && att.present) {
                    presentCount++;
                    totalHours += att.hoursWorked || 0;
                    totalOvertime += att.overtimeHours || 0;
                }
            });

            csv += `${formatDateShort(new Date(d))},${presentCount},${activeEmployees.length - presentCount},${totalHours}h,${totalOvertime}h\n`;
        }

        // Crear blob y descargar
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `Reporte_Asistencia_${getDateKey(startDate)}_${getDateKey(endDate)}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showNotification('✅ CSV exportado correctamente', 'success');

    } catch (error) {
        console.error('Error exportando CSV:', error);
        showNotification('❌ Error al exportar CSV', 'error');
    }
};

window.exportImage = function () {
    try {
        // Buscar el contenedor del gráfico actual
        const chartContainer = document.querySelector('.dashboard-container');

        if (!chartContainer) {
            showNotification('❌ No hay contenido para exportar', 'error');
            return;
        }

        showNotification('📸 Generando imagen...', 'info');

        html2canvas(chartContainer, {
            backgroundColor: '#0f172a',
            scale: 2, // Mayor calidad
            logging: false,
            useCORS: true
        }).then(canvas => {
            // Convertir canvas a blob
            canvas.toBlob(function (blob) {
                // Crear link de descarga
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                const startDate = state.dashboardStartDate;
                const endDate = state.dashboardEndDate;

                link.download = `Grafico_${state.dashboardChart}_${getDateKey(startDate)}_${getDateKey(endDate)}.png`;
                link.href = url;
                link.click();

                URL.revokeObjectURL(url);

                showNotification('✅ Imagen exportada correctamente', 'success');
            });
        }).catch(error => {
            console.error('Error exportando imagen:', error);
            showNotification('❌ Error al exportar imagen', 'error');
        });

    } catch (error) {
        console.error('Error exportando imagen:', error);
        showNotification('❌ Error al exportar imagen', 'error');
    }
};

// Función auxiliar para mostrar notificaciones (ya definida arriba - línea 1073)

function ExportMenu() {
    if (!state.showExportMenu) return '';

    const data = state.exportMenuData;
    const canShare = true;
    const isLoading = state.isExporting;
    const showShareOptions = !!state.showShareOptions;

    return `
                <div class="modal-overlay animate-fade-in" onclick="${isLoading ? '' : 'closeExportMenu()'}" style="background: rgba(0,0,0,0.3);">
                    <div class="export-menu animate-slide-up" 
                         onclick="event.stopPropagation()"
                         style="position: fixed; 
                                left: 50%; 
                                bottom: 20px; 
                                transform: translateX(-50%); 
                                background: #1e293b; 
                                border-radius: 16px; 
                                padding: 8px; 
                                box-shadow: 0 20px 60px rgba(0,0,0,0.5); 
                                border: 1px solid #334155;
                                max-width: 90%;
                                width: 320px;
                                z-index: 10001;">
                        
                        ${isLoading ? `
                            <!-- Loading State -->
                            <div style="padding: 40px 20px; text-align: center;">
                                <div style="display: inline-block; width: 50px; height: 50px; border: 4px solid #334155; border-top-color: #06b6d4; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                                <div style="margin-top: 16px; color: #94a3b8; font-weight: 600;">Procesando...</div>
                            </div>
                        ` : `
                            <!-- Header -->
                            <div style="padding: 12px 16px; border-bottom: 1px solid #334155;">
                                <div style="font-size: 0.875rem; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                                    Exportar
                                </div>
                                <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px; word-break: break-all;">
                                    ${data.filename}
                                </div>
                            </div>
                            
                            <!-- Opciones -->
                            <div style="padding: 4px;">
                                ${canShare ? `
                                    <button onclick="toggleShareOptions()" 
                                            class="export-menu-option"
                                            style="width: 100%; 
                                                   display: flex; 
                                                   align-items: center; 
                                                   gap: 12px; 
                                                   padding: 14px 16px; 
                                                   background: ${showShareOptions ? '#334155' : 'transparent'}; 
                                                   border: none; 
                                                   border-radius: 12px; 
                                                   color: #f1f5f9; 
                                                   cursor: pointer; 
                                                   transition: all 0.2s;
                                                   text-align: left;
                                                   font-size: 0.9375rem;"
                                            onmouseover="this.style.background='#334155'"
                                            onmouseout="this.style.background='${showShareOptions ? '#334155' : 'transparent'}'">
                                        <div style="width: 40px; 
                                                   height: 40px; 
                                                   background: linear-gradient(135deg, #06b6d4, #3b82f6); 
                                                   border-radius: 10px; 
                                                   display: flex; 
                                                   align-items: center; 
                                                   justify-content: center; 
                                                   font-size: 1.25rem;">
                                            📤
                                        </div>
                                        <div style="flex: 1;">
                                            <div style="font-weight: 600; color: #f1f5f9;">Compartir</div>
                                            <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Copiar datos al portapapeles</div>
                                        </div>
                                        <div style="color:#94a3b8;font-size:1rem;">${showShareOptions ? '▾' : '▸'}</div>
                                    </button>

                                    ${showShareOptions ? `
                                        <div style="padding: 6px 8px 10px 60px; display: grid; gap: 6px;">
                                            <button onclick="shareExportFull()" 
                                                    style="width: 100%; 
                                                           display: flex; 
                                                           align-items: center; 
                                                           gap: 10px; 
                                                           padding: 10px 12px; 
                                                           background: #0f172a; 
                                                           border: 1px solid #334155; 
                                                           border-radius: 10px; 
                                                           color: #f1f5f9; 
                                                           cursor: pointer; 
                                                           transition: all 0.2s;
                                                           text-align: left;
                                                           font-size: 0.875rem;"
                                                    onmouseover="this.style.borderColor='#06b6d4'"
                                                    onmouseout="this.style.borderColor='#334155'">
                                                <span style="color:#06b6d4; font-weight:700;">FULL</span>
                                                <span style="font-size:0.75rem;color:#94a3b8;">Respaldo completo</span>
                                            </button>
                                            <button onclick="shareExportMini()" 
                                                    style="width: 100%; 
                                                           display: flex; 
                                                           align-items: center; 
                                                           gap: 10px; 
                                                           padding: 10px 12px; 
                                                           background: #0f172a; 
                                                           border: 1px solid #334155; 
                                                           border-radius: 10px; 
                                                           color: #f1f5f9; 
                                                           cursor: pointer; 
                                                           transition: all 0.2s;
                                                           text-align: left;
                                                           font-size: 0.875rem;"
                                                    onmouseover="this.style.borderColor='#06b6d4'"
                                                    onmouseout="this.style.borderColor='#334155'">
                                                <span style="color:#10b981; font-weight:700;">MINI</span>
                                                <span style="font-size:0.75rem;color:#94a3b8;">Solo #, nombre y posiciÃ³n</span>
                                            </button>
                                        </div>
                                    ` : ''}
                                ` : ''}

                                <button onclick="openImportFullModal()" 
                                        class="export-menu-option"
                                        style="width: 100%; 
                                               display: flex; 
                                               align-items: center; 
                                               gap: 12px; 
                                               padding: 14px 16px; 
                                               background: transparent; 
                                               border: none; 
                                               border-radius: 12px; 
                                               color: #f1f5f9; 
                                               cursor: pointer; 
                                               transition: all 0.2s;
                                               text-align: left;
                                               font-size: 0.9375rem;
                                               margin-top: ${canShare ? '4px' : '0'};"
                                        onmouseover="this.style.background='#334155'"
                                        onmouseout="this.style.background='transparent'">
                                    <div style="width: 40px; 
                                               height: 40px; 
                                               background: linear-gradient(135deg, #f59e0b, #fbbf24); 
                                               border-radius: 10px; 
                                               display: flex; 
                                               align-items: center; 
                                               justify-content: center; 
                                               font-size: 1.25rem;">
                                        📥
                                    </div>
                                    <div style="flex: 1;">
                                        <div style="font-weight: 600; color: #f1f5f9;">Importar FULL</div>
                                        <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Pegar respaldo completo</div>
                                    </div>
                                </button>
                                
                                <button onclick="performDownload()" 
                                        class="export-menu-option"
                                        style="width: 100%; 
                                               display: flex; 
                                               align-items: center; 
                                               gap: 12px; 
                                               padding: 14px 16px; 
                                               background: transparent; 
                                               border: none; 
                                               border-radius: 12px; 
                                               color: #f1f5f9; 
                                               cursor: pointer; 
                                               transition: all 0.2s;
                                               text-align: left;
                                               font-size: 0.9375rem;
                                               margin-top: 4px;"
                                        onmouseover="this.style.background='#334155'"
                                        onmouseout="this.style.background='transparent'">
                                    <div style="width: 40px; 
                                               height: 40px; 
                                               background: linear-gradient(135deg, #10b981, #059669); 
                                               border-radius: 10px; 
                                               display: flex; 
                                               align-items: center; 
                                               justify-content: center; 
                                               font-size: 1.25rem;">
                                        💾
                                    </div>
                                    <div style="flex: 1;">
                                        <div style="font-weight: 600; color: #f1f5f9;">Descargar</div>
                                        <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Guardar en este dispositivo</div>
                                    </div>
                                </button>
                            </div>
                            
                            <!-- Botón Cancelar -->
                            <div style="padding: 8px 12px; border-top: 1px solid #334155; margin-top: 4px;">
                                <button onclick="closeExportMenu()" 
                                        style="width: 100%; 
                                               padding: 10px; 
                                               background: transparent; 
                                               border: 1px solid #334155; 
                                               border-radius: 8px; 
                                               color: #94a3b8; 
                                               cursor: pointer; 
                                               font-weight: 600;
                                               transition: all 0.2s;"
                                        onmouseover="this.style.background='#334155'; this.style.color='#f1f5f9'"
                                        onmouseout="this.style.background='transparent'; this.style.color='#94a3b8'">
                                    Cancelar
                                </button>
                            </div>
                        `}
                    </div>
                </div>
            `;
}

function ImportFullModal() {
    if (!state.showImportFullModal) return '';

    return `
                <div class="modal-overlay animate-fade-in" onclick="closeImportFullModal()" style="background: rgba(0,0,0,0.45); z-index: 10002;">
                    <div class="export-menu animate-slide-up"
                         onclick="event.stopPropagation()"
                         style="position: fixed;
                                left: 50%;
                                top: 50%;
                                transform: translate(-50%, -50%);
                                background: #1e293b;
                                border-radius: 16px;
                                padding: 16px;
                                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                                border: 1px solid #334155;
                                max-width: 92%;
                                width: 520px;">
                        <div style="font-size: 0.95rem; color: #f1f5f9; font-weight: 700; margin-bottom: 6px;">
                            Importar datos FULL
                        </div>
                        <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 12px;">
                            Pega aquÃ­ el JSON generado en Compartir FULL.
                        </div>
                        <textarea
                            oninput="setImportFullText(this.value)"
                            placeholder="{ ... }"
                            style="width: 100%;
                                   min-height: 220px;
                                   resize: vertical;
                                   background: #0f172a;
                                   color: #e2e8f0;
                                   border: 1px solid #334155;
                                   border-radius: 10px;
                                   padding: 12px;
                                   font-size: 0.8rem;
                                   line-height: 1.4;
                                   outline: none;"
                        >${state.importFullText || ''}</textarea>

                        <div style="display: flex; gap: 8px; margin-top: 12px;">
                            <button onclick="confirmImportFull()"
                                    style="flex: 1;
                                           padding: 10px 12px;
                                           background: linear-gradient(135deg, #06b6d4, #3b82f6);
                                           border: none;
                                           border-radius: 10px;
                                           color: #fff;
                                           font-weight: 700;
                                           cursor: pointer;">
                                Aceptar
                            </button>
                            <button onclick="closeImportFullModal()"
                                    style="flex: 1;
                                           padding: 10px 12px;
                                           background: transparent;
                                           border: 1px solid #334155;
                                           border-radius: 10px;
                                           color: #94a3b8;
                                           font-weight: 700;
                                           cursor: pointer;">
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            `;
}

function NoteModal() {
    if (!state.showNoteModal) return '';

    const emp = state.employees.find(e => e.id === state.noteModalEmployeeId);
    const empName = emp ? `${emp.number || ''} - ${emp.name}` : 'Empleado';

    return `
                <div class="modal-overlay animate-fade-in" onclick="closeNoteModal()" style="background: rgba(0,0,0,0.45); z-index: 10002;">
                    <div class="export-menu animate-slide-up"
                         onclick="event.stopPropagation()"
                         style="position: fixed;
                                left: 50%;
                                top: 50%;
                                transform: translate(-50%, -50%);
                                background: #1e293b;
                                border-radius: 16px;
                                padding: 16px;
                                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                                border: 1px solid #334155;
                                max-width: 92%;
                                width: 520px;">
                        <div style="font-size: 0.95rem; color: #f1f5f9; font-weight: 700; margin-bottom: 6px;">
                            Nota de asistencia
                        </div>
                        <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 12px;">
                            ${empName}
                        </div>

                        <div style="display: grid; gap: 10px; margin-bottom: 12px;">
                            <div>
                                <label style="font-size: 0.75rem; color: #94a3b8; display:block; margin-bottom: 6px;">Fecha</label>
                                <input type="date"
                                       value="${state.noteModalDate || getDateKey(new Date())}"
                                       onchange="setNoteModalDate(this.value)"
                                       style="width: 100%;
                                              background: #0f172a;
                                              color: #e2e8f0;
                                              border: 1px solid #334155;
                                              border-radius: 8px;
                                              padding: 8px 10px;
                                              font-size: 0.85rem;">
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: #94a3b8; display:block; margin-bottom: 6px;">Nota</label>
                                <textarea
                                    oninput="setNoteModalText(this.value)"
                                    placeholder="Escribe la nota..."
                                    style="width: 100%;
                                           min-height: 160px;
                                           resize: vertical;
                                           background: #0f172a;
                                           color: #e2e8f0;
                                           border: 1px solid #334155;
                                           border-radius: 10px;
                                           padding: 12px;
                                           font-size: 0.8rem;
                                           line-height: 1.4;
                                           outline: none;"
                                >${state.noteModalText || ''}</textarea>
                            </div>
                        </div>

                        <div style="display: flex; gap: 8px;">
                            <button onclick="saveNoteModal()"
                                    style="flex: 1;
                                           padding: 10px 12px;
                                           background: linear-gradient(135deg, #06b6d4, #3b82f6);
                                           border: none;
                                           border-radius: 10px;
                                           color: #fff;
                                           font-weight: 700;
                                           cursor: pointer;">
                                Guardar
                            </button>
                            <button onclick="deleteNoteModal()"
                                    style="padding: 10px 12px;
                                           background: #1e293b;
                                           border: 1px solid #ef4444;
                                           border-radius: 10px;
                                           color: #ef4444;
                                           font-weight: 700;
                                           cursor: pointer;">
                                Eliminar
                            </button>
                            <button onclick="closeNoteModal()"
                                    style="flex: 1;
                                           padding: 10px 12px;
                                           background: transparent;
                                           border: 1px solid #334155;
                                           border-radius: 10px;
                                           color: #94a3b8;
                                           font-weight: 700;
                                           cursor: pointer;">
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            `;
}

function NotesCenterModal() {
    if (!state.showNotesCenter) return '';

    const attendanceItems = Object.values(state.attendance || {});
    const notesByEmployee = new Map();

    attendanceItems.forEach(att => {
        const note = (att.notes || '').trim();
        if (!note) return;
        if (!notesByEmployee.has(att.employeeId)) {
            notesByEmployee.set(att.employeeId, []);
        }
        notesByEmployee.get(att.employeeId).push({
            date: att.date,
            note: note
        });
    });

    notesByEmployee.forEach((list) => {
        list.sort((a, b) => b.date.localeCompare(a.date));
    });

    const employeesWithNotes = state.employees
        .filter(emp => notesByEmployee.has(emp.id))
        .sort((a, b) => {
            const aNotes = notesByEmployee.get(a.id) || [];
            const bNotes = notesByEmployee.get(b.id) || [];
            const aDate = aNotes[0] ? aNotes[0].date : '';
            const bDate = bNotes[0] ? bNotes[0].date : '';
            if (aDate !== bDate) return bDate.localeCompare(aDate);
            const aNum = parseInt(a.number, 10);
            const bNum = parseInt(b.number, 10);
            if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
            return String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true });
        });

    const selectedId = state.notesCenterEmployeeId;
    const selectedEmp = selectedId ? state.employees.find(e => e.id === selectedId) : null;
    const selectedNotes = selectedId ? (notesByEmployee.get(selectedId) || []) : [];

    return `
                <div class="modal-overlay" style="background: #0b1220; z-index: 10001;">
                    <div style="position: fixed; inset: 0; display: flex; flex-direction: column; background: #0b1220;">
                        <div style="display:flex; align-items:center; gap:12px; padding: 14px 16px; border-bottom: 1px solid #1f2a44; background: #0f172a;">
                            ${selectedEmp ? `
                                <button onclick="backToNotesList()" title="Volver"
                                        style="width: 36px; height: 36px; border-radius: 10px; border: 1px solid #334155; background: transparent; color: #e2e8f0; cursor: pointer; font-size: 1.1rem;">
                                    ←
                                </button>
                            ` : `
                                <div style="width: 36px;"></div>
                            `}
                            <div style="flex:1;">
                                <div style="font-weight:700; color:#f1f5f9;">
                                    ${selectedEmp ? `${selectedEmp.name}` : 'Notas de empleados'}
                                </div>
                                <div style="font-size:0.75rem; color:#94a3b8;">
                                    ${selectedEmp ? `#${selectedEmp.number || ''}` : 'Solo empleados con notas'}
                                </div>
                            </div>
                            <button onclick="closeNotesCenter()" title="Cerrar"
                                    style="width: 36px; height: 36px; border-radius: 10px; border: 1px solid #334155; background: transparent; color: #e2e8f0; cursor: pointer; font-size: 1.1rem;">
                                ✕
                            </button>
                        </div>

                        <div style="flex: 1; overflow-y: auto; padding: 16px; background: #0b1220;">
                            ${!selectedEmp ? `
                                ${employeesWithNotes.length === 0 ? `
                                    <div style="text-align:center; padding: 60px 20px; color:#94a3b8;">
                                        <div style="font-size:3rem; margin-bottom:16px; opacity:0.4;">${icons.get('message')}</div>
                                        <div style="font-size:1rem;">AÃºn no hay notas guardadas</div>
                                    </div>
                                ` : employeesWithNotes.map(emp => {
                                    const lastNote = (notesByEmployee.get(emp.id) || [])[0];
                                    const preview = lastNote ? (lastNote.note.length > 60 ? `${lastNote.note.slice(0, 60)}...` : lastNote.note) : '';
                                    return `
                                        <button onclick="selectNotesEmployee('${emp.id}')"
                                                style="width: 100%;
                                                       text-align: left;
                                                       padding: 12px 14px;
                                                       border-radius: 14px;
                                                       border: 1px solid #1f2a44;
                                                       background: #0f172a;
                                                       color: #f1f5f9;
                                                       cursor: pointer;
                                                       margin-bottom: 10px;">
                                            <div style="display:flex; align-items:center; gap:10px;">
                                                <div style="width:36px; height:36px; border-radius:12px; background:#111827; display:flex; align-items:center; justify-content:center; font-weight:700; color:#06b6d4;">
                                                    ${emp.number || ''}
                                                </div>
                                                <div style="flex:1;">
                                                    <div style="font-weight:700;">${emp.name}</div>
                                                    <div style="font-size:0.75rem; color:#94a3b8;">${lastNote ? formatDateShort(lastNote.date) : ''}</div>
                                                </div>
                                            </div>
                                            <div style="font-size:0.8rem; color:#cbd5e1; margin-top:8px;">
                                                ${preview}
                                            </div>
                                        </button>
                                    `;
                                }).join('')}
                            ` : `
                                ${selectedNotes.length === 0 ? `
                                    <div style="text-align:center; padding: 60px 20px; color:#94a3b8;">
                                        <div style="font-size:2.5rem; margin-bottom:12px; opacity:0.4;">${icons.get('message')}</div>
                                        <div style="font-size:0.95rem;">No hay notas para este empleado</div>
                                    </div>
                                ` : selectedNotes.map(note => `
                                    <div style="text-align:center; color:#64748b; font-size:0.75rem; margin: 10px 0;">
                                        ${formatDateShort(note.date)}
                                    </div>
                                    <div onclick="openNoteEditor('${selectedEmp.id}', '${note.date}')"
                                         style="max-width: 90%;
                                                background: #111827;
                                                border: 1px solid #1f2a44;
                                                color: #e2e8f0;
                                                border-radius: 18px;
                                                padding: 12px 14px;
                                                margin-bottom: 10px;">
                                        <div style="white-space: pre-wrap; font-size: 0.9rem; line-height: 1.4;">
                                            ${note.note}
                                        </div>
                                    </div>
                                `).join('')}
                            `}
                        </div>

                        ${selectedEmp ? `
                            <div style="padding: 14px 16px; border-top: 1px solid #1f2a44; background: #0f172a;">
                                <button onclick="openNewNote('${selectedEmp.id}')"
                                        style="width: 100%;
                                               padding: 12px 14px;
                                               background: linear-gradient(135deg, #06b6d4, #10b981);
                                               border: none;
                                               border-radius: 12px;
                                               color: #000;
                                               font-weight: 800;
                                               cursor: pointer;">
                                    + Nueva nota
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
}

// ConfirmDialog eliminado - ahora usamos Modal.confirm()

function App() {
    // Si está el onboarding activo, mostrar solo eso
    if (state.showOnboarding) {
        return `
                    <div class="overlay" style="background: #0f172a; z-index: 10000;">
                        <div style="max-width: 100%; height: 100vh; overflow-y: auto;">
                            ${onboardingWizard.renderStep()}
                        </div>
                    </div>
                `;
    }

    // Banner de modo demo si está activo
    const demoBanner = state.usingDemoData ? `
                <div style="background: linear-gradient(90deg, #f59e0b, #fbbf24); color: #000; padding: 12px 20px; text-align: center; font-weight: 700; font-size: 0.875rem; position: sticky; top: 0; z-index: 999; display: flex; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <span>⚠️ MODO DEMO ACTIVO</span>
                    <span style="opacity: 0.8;">Los cambios NO se guardarán</span>
                    <button onclick="showConfirm({ title: '🔄 Reiniciar Sistema', message: '¿Estás seguro de reiniciar el sistema?\\nPodrás configurarlo desde cero.', confirmText: 'Sí, reiniciar', cancelText: 'Cancelar', type: 'warning', onConfirm: () => location.reload() })" style="background: rgba(0,0,0,0.2); border: none; padding: 6px 16px; border-radius: 6px; color: white; cursor: pointer; font-weight: 700; transition: all 0.2s;" onmouseover="this.style.background='rgba(0,0,0,0.4)'" onmouseout="this.style.background='rgba(0,0,0,0.2)'">
                        🔄 Reiniciar
                    </button>
                </div>
            ` : '';

    // ⚡ OPTIMIZACIÓN: Lazy loading con mapeo de tabs
    // ⚡ OPTIMIZACIÓN: Lazy loading con mapeo de tabs
    const tabMap = {
        'attendance': () => AttendanceTab(),
        'employees': () => EmployeesUI.EmployeesTab(),
        'positions': () => {
            state.employeeViewMode = 'positions';
            return EmployeesUI.EmployeesTab();
        },
        'employee-report': () => AnalyticsUI.ReportsTab(),
        'dashboard': () => {
            state.reportViewMode = 'dashboard';
            return AnalyticsUI.ReportsTab();
        },
        'export': () => PayrollUI.PayrollTab(),  // ⚡ NUEVO
        'settings': () => SettingsTab()
    };

    // ✅ Solo renderiza el tab activo
    const content = tabMap[state.activeTab]
        ? tabMap[state.activeTab]()
        : '<div style="text-align:center;padding:60px 20px;color:#64748b;"><div style="font-size:4rem;margin-bottom:16px;opacity:0.3;">🚧</div><div style="font-size:1.125rem;">En desarrollo</div></div>';

    // ⚡ OPTIMIZACIÓN: Lazy loading de modales
    const modalMap = {
        'advanced': () => AdvancedAttendanceModal(),
        'employee-form': () => EmployeeFormModal(),
        'leader-form': () => LeaderFormModal(),
        'position-form': () => PositionFormModal(),
        'multi-position': () => MultiPositionModal()
    };

    const modal = state.showModal && modalMap[state.modalType]
        ? modalMap[state.modalType]()
        : '';

    return `${demoBanner}${Header()}<main class="main-content"><div class="container">${content}</div></main>${FloatingCard()}${EmployeeProfileModal()}${modal}${ContextMenu()}${ExportMenu()}${ImportFullModal()}${NotesCenterModal()}${NoteModal()}`;
}

function updateHeaderOffset() {
    const header = document.querySelector('.header');
    if (header) {
        document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`);
    }
}

function render() {
    // ⚡ Optimizado con RenderOptimizer
    renderOptimizer.scheduleRender(() => {
        perfMonitor.start('render');

        // Preservar foco en el buscador de empleados si está activo
        const activeEl = document.activeElement;
        const keepSearchFocus = activeEl && activeEl.classList && activeEl.classList.contains('employee-search-input');
        const searchCursorPos = keepSearchFocus ? activeEl.selectionStart : null;
        const searchValue = keepSearchFocus ? activeEl.value : null;

        // Guardar posición del scroll antes de renderizar
        saveScrollPosition();

        // Renderizar con DocumentFragment para evitar layout thrashing
        const root = document.getElementById('root');
        const newHTML = App();
        const template = document.createElement('template');
        template.innerHTML = newHTML;
        root.replaceChildren(...template.content.childNodes);
        // Renderizar iconos Lucide despues de actualizar el DOM
        icons.refresh();
        updateHeaderOffset();

        // Restaurar foco del buscador si estaba activo
        if (keepSearchFocus) {
            requestAnimationFrame(() => {
                const input = document.querySelector('.employee-search-input');
                if (input) {
                    input.focus();
                    if (searchValue !== null && input.value !== searchValue) {
                        input.value = searchValue;
                    }
                    const pos = searchCursorPos !== null ? searchCursorPos : input.value.length;
                    if (input.setSelectionRange) {
                        input.setSelectionRange(pos, pos);
                    }
                }
            });
        }

        // Restaurar posición del scroll después de renderizar
        restoreScrollPosition();

        // Auto-guardar datos en LocalStorage
        saveApplicationData();

        // Emitir evento de render completado
        eventBus.emit('render:complete', {
            timestamp: Date.now(),
            activeTab: state.activeTab
        });

        perfMonitor.end('render');
    });
}

// Versión optimizada con debounce para búsquedas
const debouncedRender = renderOptimizer.debounceRender(render, 300);

// Versión optimizada con throttle para scroll
const throttledRender = renderOptimizer.throttleRender(render, 100);

// Event listener global para cerrar menú contextual y calendarios
document.addEventListener('click', function (e) {
    // Cerrar menú contextual
    if (state.contextMenu && !e.target.closest('.context-menu') && !e.target.closest('.check-container')) {
        state.contextMenu = null;
        render();
    }

    // Cerrar calendarios del dashboard
    if ((state.showStartDatePicker || state.showEndDatePicker) &&
        !e.target.closest('.date-picker') &&
        !e.target.closest('.date-display')) {
        state.showStartDatePicker = false;
        state.showEndDatePicker = false;
        render();
    }

    // Cerrar calendarios del reporte de empleados
    if ((state.showEmployeeReportStartPicker || state.showEmployeeReportEndPicker) &&
        !e.target.closest('.date-picker') &&
        !e.target.closest('.date-display')) {
        state.showEmployeeReportStartPicker = false;
        state.showEmployeeReportEndPicker = false;
        render();
    }
});

window.addEventListener('resize', () => {
    updateHeaderOffset();
});

// âš¡ NUEVO: Listener de scroll para controles flotantes
let lastScrollTime = 0;
window.addEventListener('scroll', () => {
    const scrolled = window.scrollY > 200;
    if (scrolled !== state.isScrolled) {
        // Usar requestAnimationFrame para evitar lag
        const now = Date.now();
        if (now - lastScrollTime > 50) { // Throttle de 50ms
            state.isScrolled = scrolled;
            render();
            lastScrollTime = now;
        }
    }
});


// ============================================
// DATOS DE PRUEBA
// ============================================

// Demo data moved to modules/data/DemoData.js
// ============================================
// ONBOARDING WIZARD
// ============================================

class OnboardingWizard {
    constructor() {
        this.steps = [
            'welcome',
            'mode-selection',
            'company',
            'hours',
            'positions',
            'employees',
            'done'
        ];
    }

    show() {
        // Solo mostrar si no está en modo demo Y no ha completado onboarding
        if (!state.usingDemoData && !localStorage.getItem('onboardingCompleted')) {
            state.showOnboarding = true;
            state.onboardingStep = 0;
            render();
        }
    }

    renderStep() {
        const step = this.steps[state.onboardingStep];

        switch (step) {
            case 'welcome': return this.renderWelcome();
            case 'mode-selection': return this.renderModeSelection();
            case 'company': return this.renderCompany();
            case 'hours': return this.renderHours();
            case 'positions': return this.renderPositions();
            case 'employees': return this.renderEmployees();
            case 'done': return this.renderDone();
            default: return '';
        }
    }

    renderWelcome() {
        return `
                    <div style="text-align: center; padding: 60px 40px;">
                        <div style="font-size: 5rem; margin-bottom: 24px; animation: bounce 2s ease-in-out infinite;">👷‍♂️</div>
                        <h1 style="font-size: 2.5rem; margin-bottom: 16px; background: linear-gradient(135deg, #06b6d4, #10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 900;">
                            ¡Bienvenido a Control de Asistencia!
                        </h1>
                        <p style="font-size: 1.25rem; color: #94a3b8; margin-bottom: 40px; max-width: 600px; margin-left: auto; margin-right: auto; line-height: 1.6;">
                            Sistema profesional para gestionar la asistencia de tu equipo de construcción
                        </p>
                        
                        <div style="background: linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(16, 185, 129, 0.1)); border-radius: 16px; padding: 32px; margin-bottom: 40px; max-width: 500px; margin-left: auto; margin-right: auto; border: 1px solid rgba(6, 182, 212, 0.2);">
                            <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Lo que puedes hacer:</div>
                            <div style="display: grid; gap: 12px; text-align: left;">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <div style="background: #10b981; width: 8px; height: 8px; border-radius: 50%;"></div>
                                    <span style="color: #f1f5f9; font-size: 0.875rem;">Registrar asistencia diaria</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <div style="background: #06b6d4; width: 8px; height: 8px; border-radius: 50%;"></div>
                                    <span style="color: #f1f5f9; font-size: 0.875rem;">Gestionar horas extras y festivos</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <div style="background: #f59e0b; width: 8px; height: 8px; border-radius: 50%;"></div>
                                    <span style="color: #f1f5f9; font-size: 0.875rem;">Generar reportes y exportar a Excel</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <div style="background: #8b5cf6; width: 8px; height: 8px; border-radius: 50%;"></div>
                                    <span style="color: #f1f5f9; font-size: 0.875rem;">Sincronizar en la nube (Supabase)</span>
                                </div>
                            </div>
                        </div>
                        
                        <div style="display: flex; flex-direction: column; gap: 16px; max-width: 400px; margin: 0 auto;">
                            <button onclick="onboardingWizard.next()" class="btn btn-primary" style="padding: 18px 48px; font-size: 1.25rem; font-weight: 700; box-shadow: 0 10px 30px rgba(6, 182, 212, 0.3);">
                                🚀 Comenzar desde Cero
                            </button>
                            
                            <button onclick="onboardingWizard.skipToCloudLogin()" class="btn btn-secondary" style="padding: 14px 36px; font-size: 1rem; font-weight: 600; background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.2)); border: 2px solid #10b981;">
                                ☁️ Ya tengo cuenta en la nube
                            </button>
                            
                            <button onclick="onboardingWizard.skipToRestoreBackup()" class="btn btn-secondary" style="padding: 14px 36px; font-size: 1rem; font-weight: 600; background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(236, 72, 153, 0.2)); border: 2px solid #8b5cf6;">
                                💾 Restaurar desde Backup
                            </button>
                        </div>
                        
                        ${this.renderProgress()}
                    </div>
                `;
    }

    renderModeSelection() {
        return `
                    <div style="padding: 20px; max-width: 900px; margin: 0 auto;">
                        <div style="text-align: center; margin-bottom: 32px;">
                            <h2 style="font-size: 1.5rem; margin-bottom: 12px; color: #f1f5f9; font-weight: 800;">¿Cómo quieres comenzar?</h2>
                            <p style="color: #94a3b8; font-size: 1rem;">Elige la opción que mejor se adapte a ti</p>
                        </div>
                        
                        <div style="display: flex; flex-direction: column; gap: 20px; margin-bottom: 24px;">
                            <!-- Opción: Datos de Prueba -->
                            <div onclick="onboardingWizard.selectMode('demo')" 
                                 style="background: linear-gradient(135deg, #1e293b, #0f172a); 
                                        border: 2px solid #06b6d4; 
                                        border-radius: 16px; 
                                        padding: 24px; 
                                        cursor: pointer; 
                                        transition: all 0.3s; 
                                        position: relative;">
                                
                                <div style="position: absolute; top: 12px; right: 12px; 
                                           background: linear-gradient(135deg, #06b6d4, #0891b2); 
                                           color: white; 
                                           padding: 4px 10px; 
                                           border-radius: 8px; 
                                           font-size: 0.65rem; 
                                           font-weight: 700;">
                                    RECOMENDADO
                                </div>
                                
                                <div style="font-size: 3rem; margin-bottom: 12px; text-align: center;">🎮</div>
                                
                                <h3 style="font-size: 1.25rem; 
                                           margin-bottom: 8px; 
                                           color: #06b6d4; 
                                           font-weight: 700; 
                                           text-align: center;">
                                    Explorar con Datos de Prueba
                                </h3>
                                
                                <p style="color: #94a3b8; 
                                          margin-bottom: 16px; 
                                          line-height: 1.5; 
                                          text-align: center; 
                                          font-size: 0.875rem;">
                                    Perfecto para conocer el sistema
                                </p>
                                
                                <div style="background: rgba(6, 182, 212, 0.1); 
                                           border-radius: 10px; 
                                           padding: 14px; 
                                           margin-bottom: 14px; 
                                           border-left: 3px solid #06b6d4;">
                                    <div style="font-size: 0.8rem; color: #f1f5f9; line-height: 1.6;">
                                        <div style="margin-bottom: 6px;">✓ 5 empleados de ejemplo</div>
                                        <div style="margin-bottom: 6px;">✓ 3 posiciones configuradas</div>
                                        <div style="margin-bottom: 6px;">✓ Asistencia de últimos 7 días</div>
                                        <div>✓ Puedes probar todas las funciones</div>
                                    </div>
                                </div>
                                
                                <div style="background: rgba(251, 191, 36, 0.1); 
                                           border-radius: 8px; 
                                           padding: 12px; 
                                           border-left: 2px solid #fbbf24;">
                                    <div style="font-size: 0.7rem; color: #fbbf24; font-weight: 600; margin-bottom: 4px;">
                                        💡 IMPORTANTE
                                    </div>
                                    <div style="font-size: 0.7rem; color: #94a3b8; line-height: 1.4;">
                                        Los datos de prueba NO se guardan. Puedes reiniciar cuando quieras para ingresar tus datos reales.
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Opción: Desde Cero -->
                            <div onclick="onboardingWizard.selectMode('scratch')" 
                                 style="background: linear-gradient(135deg, #1e293b, #0f172a); 
                                        border: 2px solid #334155; 
                                        border-radius: 16px; 
                                        padding: 24px; 
                                        cursor: pointer; 
                                        transition: all 0.3s;">
                                
                                <div style="font-size: 3rem; margin-bottom: 12px; text-align: center;">🚀</div>
                                
                                <h3 style="font-size: 1.25rem; 
                                           margin-bottom: 8px; 
                                           color: #10b981; 
                                           font-weight: 700; 
                                           text-align: center;">
                                    Configurar Desde Cero
                                </h3>
                                
                                <p style="color: #94a3b8; 
                                          margin-bottom: 16px; 
                                          line-height: 1.5; 
                                          text-align: center; 
                                          font-size: 0.875rem;">
                                    Para empezar con tus datos reales
                                </p>
                                
                                <div style="background: rgba(16, 185, 129, 0.1); 
                                           border-radius: 10px; 
                                           padding: 14px; 
                                           margin-bottom: 14px; 
                                           border-left: 3px solid #10b981;">
                                    <div style="font-size: 0.8rem; color: #f1f5f9; line-height: 1.6;">
                                        <div style="margin-bottom: 6px;">✓ Configuración guiada paso a paso</div>
                                        <div style="margin-bottom: 6px;">✓ Tus datos se guardan permanentemente</div>
                                        <div style="margin-bottom: 6px;">✓ Listo para producción</div>
                                        <div>✓ Toma solo 3-5 minutos</div>
                                    </div>
                                </div>
                                
                                <div style="background: rgba(6, 182, 212, 0.1); 
                                           border-radius: 8px; 
                                           padding: 12px; 
                                           border-left: 2px solid #06b6d4;">
                                    <div style="font-size: 0.7rem; color: #06b6d4; font-weight: 600; margin-bottom: 4px;">
                                        ✨ RECOMENDADO SI
                                    </div>
                                    <div style="font-size: 0.7rem; color: #94a3b8; line-height: 1.4;">
                                        Ya conoces el sistema o quieres empezar a usar en producción inmediatamente.
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div style="text-align: center;">
                            <button onclick="onboardingWizard.prev()" 
                                    class="btn btn-secondary" 
                                    style="padding: 12px 32px;">
                                ← Atrás
                            </button>
                        </div>
                        
                        ${this.renderProgress()}
                    </div>
                `;
    }

    selectMode(mode) {
        state.onboardingMode = mode;

        if (mode === 'demo') {
            // Cargar datos de prueba
            this.loadDemoData();
            // Saltar directo al final
            state.onboardingStep = this.steps.indexOf('done');
        } else if (mode === 'scratch') {
            // Limpiar todos los datos para empezar desde cero
            this.clearAllData();
            // Continuar con configuración desde cero
            this.next();
        }

        render();
    }

    clearAllData() {
        console.log('🧹 Limpiando datos de prueba...');

        // Limpiar posiciones (dejar array vacío)
        state.positions = [];

        // Limpiar líderes
        state.leaders = [];

        // Limpiar empleados
        state.employees = [];

        // Limpiar asistencias
        state.attendance = {};

        // Resetear settings a valores por defecto limpios
        state.settings = {
            companyName: 'Mi Empresa',
            regularHoursPerDay: 8,
            holidayFactor: 2,
            iconSet: resolveIconSet(),
            holidays: []
        };

        // Limpiar configuraciones de días
        state.dayHoursConfig = {};

        console.log('✅ Sistema limpio y listo para configurar');
    }

    loadDemoData() {
        state.usingDemoData = true;
        state.settings = { ...demoData.settings };
        state.settings.iconSet = resolveIconSet(state.settings.iconSet);
        applyIconSet(state.settings.iconSet);
        state.positions = JSON.parse(JSON.stringify(demoData.positions));
        state.employees = JSON.parse(JSON.stringify(demoData.employees));
        state.attendance = generateDemoAttendance();

        // NO guardar en localStorage
        debug.log('📊 Datos de prueba cargados (NO guardados)');
    }

    renderCompany() {
        return `
                    <div style="padding: 60px 40px; max-width: 600px; margin: 0 auto;">
                        <div style="text-align: center; margin-bottom: 40px;">
                            <div style="font-size: 4rem; margin-bottom: 20px;">🏗️</div>
                            <h2 style="font-size: 2rem; margin-bottom: 12px; color: #f1f5f9; font-weight: 800;">Paso 1: Tu Empresa</h2>
                            <p style="color: #94a3b8; font-size: 1.125rem;">¿Cómo se llama tu constructora?</p>
                        </div>
                        
                        <div style="margin-bottom: 40px;">
                            <label style="display: block; font-size: 0.875rem; color: #94a3b8; margin-bottom: 8px; font-weight: 600;">
                                Nombre de la Empresa
                            </label>
                            <input 
                                type="text" 
                                id="onboarding-company-name"
                                placeholder="Ej: Constructora El Progreso"
                                value="${state.settings.companyName}"
                                style="width: 100%; padding: 16px; font-size: 1.125rem; border-radius: 12px; border: 2px solid #334155; background: #0f172a; color: #f1f5f9; transition: all 0.2s;"
                                autofocus
                                onfocus="this.style.borderColor='#06b6d4'; this.style.boxShadow='0 0 0 3px rgba(6,182,212,0.1)'"
                                onblur="this.style.borderColor='#334155'; this.style.boxShadow='none'"
                            >
                        </div>
                        
                        <div style="display: flex; gap: 12px; justify-content: space-between;">
                            <button onclick="onboardingWizard.prev()" class="btn btn-secondary" style="flex: 1;">
                                ← Atrás
                            </button>
                            <button onclick="onboardingWizard.saveCompanyAndNext()" class="btn btn-primary" style="flex: 2;">
                                Siguiente →
                            </button>
                        </div>
                        
                        ${this.renderProgress()}
                    </div>
                `;
    }

    renderHours() {
        return `
                    <div style="padding: 60px 40px; max-width: 700px; margin: 0 auto;">
                        <div style="text-align: center; margin-bottom: 40px;">
                            <div style="font-size: 4rem; margin-bottom: 20px;">⏰</div>
                            <h2 style="font-size: 2rem; margin-bottom: 12px; color: #f1f5f9; font-weight: 800;">Paso 2: Jornada Laboral</h2>
                            <p style="color: #94a3b8; font-size: 1.125rem;">Define cuántas horas trabajan normalmente</p>
                        </div>
                        
                        <div style="margin-bottom: 40px;">
                            <label style="display: block; font-size: 0.875rem; color: #94a3b8; margin-bottom: 16px; font-weight: 600; text-align: center;">
                                Selecciona las horas regulares por día
                            </label>
                            
                            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">
                                ${[6, 8, 9, 10].map(h => `
                                    <button 
                                        onclick="selectHours(${h})"
                                        style="padding: 32px 16px; border-radius: 16px; border: 3px solid ${state.settings.regularHoursPerDay === h ? '#06b6d4' : '#334155'}; background: ${state.settings.regularHoursPerDay === h ? 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(6,182,212,0.05))' : '#1e293b'}; cursor: pointer; transition: all 0.3s; position: relative;"
                                        onmouseover="if(${state.settings.regularHoursPerDay !== h}) { this.style.borderColor='#475569'; this.style.transform='scale(1.05)'; }"
                                        onmouseout="if(${state.settings.regularHoursPerDay !== h}) { this.style.borderColor='#334155'; this.style.transform='scale(1)'; }"
                                    >
                                        ${state.settings.regularHoursPerDay === h ? '<div style="position: absolute; top: 8px; right: 8px; color: #06b6d4; font-size: 1.25rem;">✓</div>' : ''}
                                        <div style="font-size: 2.5rem; font-weight: 900; color: ${state.settings.regularHoursPerDay === h ? '#06b6d4' : '#f1f5f9'}; margin-bottom: 8px;">${h}</div>
                                        <div style="font-size: 0.875rem; color: #94a3b8; font-weight: 600;">horas</div>
                                    </button>
                                `).join('')}
                            </div>
                            
                            <div style="text-align: center; padding: 16px; background: rgba(6, 182, 212, 0.05); border-radius: 12px; border: 1px solid rgba(6, 182, 212, 0.2);">
                                <div style="color: #06b6d4; font-size: 0.875rem; font-weight: 600; margin-bottom: 4px;">💡 No te preocupes</div>
                                <div style="color: #94a3b8; font-size: 0.875rem;">Puedes cambiar esto después en Ajustes</div>
                            </div>
                        </div>
                        
                        <div style="display: flex; gap: 12px; justify-content: space-between;">
                            <button onclick="onboardingWizard.prev()" class="btn btn-secondary" style="flex: 1;">
                                ← Atrás
                            </button>
                            <button onclick="onboardingWizard.next()" class="btn btn-primary" style="flex: 2;">
                                Siguiente →
                            </button>
                        </div>
                        
                        ${this.renderProgress()}
                    </div>
                `;
    }

    renderPositions() {
        const positionsCount = state.positions.filter(p => p.active).length;

        return `
                    <div style="padding: 60px 40px; max-width: 800px; margin: 0 auto;">
                        <div style="text-align: center; margin-bottom: 40px;">
                            <div style="font-size: 4rem; margin-bottom: 20px;">🎯</div>
                            <h2 style="font-size: 2rem; margin-bottom: 12px; color: #f1f5f9; font-weight: 800;">Paso 3: Posiciones</h2>
                            <p style="color: #94a3b8; font-size: 1.125rem;">¿Qué tipos de trabajadores tienes?</p>
                        </div>
                        
                        <div style="margin-bottom: 32px;">
                            <div style="font-size: 0.875rem; color: #94a3b8; margin-bottom: 16px; font-weight: 600;">
                                Posiciones comunes (click para agregar):
                            </div>
                            <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px;">
                                ${['Ayudante', 'Albañil', 'Carpintero', 'Electricista', 'Plomero', 'Supervisor'].map(name => `
                                    <button 
                                        onclick="quickAddPosition('${name}')"
                                        style="padding: 12px 24px; border-radius: 10px; border: 2px solid #334155; background: #1e293b; color: #f1f5f9; cursor: pointer; font-size: 0.875rem; font-weight: 600; transition: all 0.2s;"
                                        onmouseover="this.style.borderColor='#06b6d4'; this.style.background='rgba(6,182,212,0.1)'; this.style.transform='translateY(-2px)'"
                                        onmouseout="this.style.borderColor='#334155'; this.style.background='#1e293b'; this.style.transform='translateY(0)'"
                                    >
                                        + ${name}
                                    </button>
                                `).join('')}
                            </div>
                            
                            ${positionsCount === 0 ? `
                                <div style="text-align: center; padding: 48px 32px; background: rgba(239, 68, 68, 0.05); border: 2px dashed #ef4444; border-radius: 16px;">
                                    <div style="font-size: 2.5rem; margin-bottom: 12px;">👆</div>
                                    <div style="color: #ef4444; font-weight: 600; margin-bottom: 8px;">Agrega al menos una posición</div>
                                    <div style="color: #94a3b8; font-size: 0.875rem;">Click en alguna de las opciones de arriba para continuar</div>
                                </div>
                            ` : `
                                <div style="background: #1e293b; border-radius: 16px; padding: 20px; border: 1px solid #334155;">
                                    <div style="font-size: 0.875rem; color: #94a3b8; margin-bottom: 16px; font-weight: 600;">Posiciones agregadas (${positionsCount}):</div>
                                    <div style="display: grid; gap: 12px; max-height: 300px; overflow-y: auto;">
                                        ${state.positions.filter(p => p.active).map(pos => `
                                            <div style="background: #0f172a; padding: 16px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #334155;">
                                                <div style="display: flex; align-items: center; gap: 16px;">
                                                    <div style="width: 20px; height: 20px; border-radius: 50%; background: ${pos.color}; box-shadow: 0 0 12px ${pos.color}50;"></div>
                                                    <span style="font-weight: 700; color: #f1f5f9; font-size: 1rem;">${pos.name}</span>
                                                </div>
                                                <button onclick="removePosition('${pos.id}')" style="color: #ef4444; background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 8px; padding: 8px 16px; cursor: pointer; transition: all 0.2s; font-weight: 600; font-size: 0.875rem;" onmouseover="this.style.background='#ef4444'; this.style.color='white'" onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'; this.style.color='#ef4444'">
                                                    🗑️ Eliminar
                                                </button>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            `}
                        </div>
                        
                        <div style="display: flex; gap: 12px; justify-content: space-between;">
                            <button onclick="onboardingWizard.prev()" class="btn btn-secondary" style="flex: 1;">
                                ← Atrás
                            </button>
                            <button 
                                onclick="onboardingWizard.next()" 
                                class="btn btn-primary" 
                                style="flex: 2; ${positionsCount === 0 ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
                                ${positionsCount === 0 ? 'disabled' : ''}
                            >
                                Siguiente →
                            </button>
                        </div>
                        
                        ${this.renderProgress()}
                    </div>
                `;
    }

    renderEmployees() {
        const employeesCount = state.employees.filter(e => e.active).length;

        return `
                    <div style="padding: 60px 40px; max-width: 800px; margin: 0 auto;">
                        <div style="text-align: center; margin-bottom: 40px;">
                            <div style="font-size: 4rem; margin-bottom: 20px;">👥</div>
                            <h2 style="font-size: 2rem; margin-bottom: 12px; color: #f1f5f9; font-weight: 800;">Paso 4: Empleados</h2>
                            <p style="color: #94a3b8; font-size: 1.125rem;">Agrega tu primer empleado (puedes agregar más después)</p>
                        </div>
                        
                        <form onsubmit="addOnboardingEmployee(event); return false;" style="background: #1e293b; border-radius: 16px; padding: 24px; margin-bottom: 32px; border: 1px solid #334155;">
                            <div style="display: grid; gap: 20px;">
                                <div>
                                    <label style="display: block; font-size: 0.875rem; color: #94a3b8; margin-bottom: 8px; font-weight: 600;">
                                        Nombre Completo *
                                    </label>
                                    <input 
                                        type="text" 
                                        id="onboarding-emp-name"
                                        placeholder="Ej: Juan Pérez"
                                        style="width: 100%; padding: 14px; border-radius: 10px; border: 2px solid #334155; background: #0f172a; color: #f1f5f9; font-size: 1rem; transition: all 0.2s;"
                                        required
                                        onfocus="this.style.borderColor='#06b6d4'"
                                        onblur="this.style.borderColor='#334155'"
                                    >
                                </div>
                                
                                <div>
                                    <label style="display: block; font-size: 0.875rem; color: #94a3b8; margin-bottom: 8px; font-weight: 600;">
                                        Posición *
                                    </label>
                                    <select 
                                        id="onboarding-emp-position"
                                        style="width: 100%; padding: 14px; border-radius: 10px; border: 2px solid #334155; background: #0f172a; color: #f1f5f9; font-size: 1rem; cursor: pointer; transition: all 0.2s;"
                                        required
                                        onfocus="this.style.borderColor='#06b6d4'"
                                        onblur="this.style.borderColor='#334155'"
                                    >
                                        ${state.positions.filter(p => p.active).map(pos => `
                                            <option value="${pos.id}">${pos.name}</option>
                                        `).join('')}
                                    </select>
                                </div>
                                
                                <button type="submit" class="btn btn-secondary" style="width: 100%; padding: 14px; font-weight: 700;">
                                    + Agregar Empleado
                                </button>
                            </div>
                        </form>
                        
                        ${employeesCount === 0 ? `
                            <div style="text-align: center; padding: 48px 32px; background: rgba(239, 68, 68, 0.05); border: 2px dashed #ef4444; border-radius: 16px;">
                                <div style="font-size: 2.5rem; margin-bottom: 12px;">👆</div>
                                <div style="color: #ef4444; font-weight: 600; margin-bottom: 8px;">Agrega al menos un empleado</div>
                                <div style="color: #94a3b8; font-size: 0.875rem;">Llena el formulario de arriba para continuar</div>
                            </div>
                        ` : `
                            <div style="background: #1e293b; border-radius: 16px; padding: 20px; border: 1px solid #334155; margin-bottom: 32px;">
                                <div style="font-size: 0.875rem; color: #94a3b8; margin-bottom: 16px; font-weight: 600;">Empleados agregados (${employeesCount}):</div>
                                <div style="display: grid; gap: 12px; max-height: 300px; overflow-y: auto;">
                                    ${state.employees.filter(e => e.active).map(emp => {
            const pos = state.positions.find(p => p.id === emp.position);
            return `
                                            <div style="background: #0f172a; padding: 16px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #334155;">
                                                <div>
                                                    <div style="font-weight: 700; color: #f1f5f9; margin-bottom: 4px; font-size: 1rem;">${emp.name}</div>
                                                    <div style="font-size: 0.875rem; color: #94a3b8; display: flex; align-items: center; gap: 8px;">
                                                        <div style="width: 12px; height: 12px; border-radius: 50%; background: ${pos?.color || '#64748b'};"></div>
                                                        ${pos?.name || 'Sin posición'}
                                                    </div>
                                                </div>
                                                <button onclick="removeEmployee('${emp.id}')" style="color: #ef4444; background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 8px; padding: 8px 16px; cursor: pointer; transition: all 0.2s; font-weight: 600; font-size: 0.875rem;" onmouseover="this.style.background='#ef4444'; this.style.color='white'" onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'; this.style.color='#ef4444'">
                                                    🗑️
                                                </button>
                                            </div>
                                        `;
        }).join('')}
                                </div>
                            </div>
                        `}
                        
                        <div style="display: flex; gap: 12px; justify-content: space-between;">
                            <button onclick="onboardingWizard.prev()" class="btn btn-secondary" style="flex: 1;">
                                ← Atrás
                            </button>
                            <button 
                                onclick="onboardingWizard.next()" 
                                class="btn btn-primary" 
                                style="flex: 2; ${employeesCount === 0 ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
                                ${employeesCount === 0 ? 'disabled' : ''}
                            >
                                Siguiente →
                            </button>
                        </div>
                        
                        ${this.renderProgress()}
                    </div>
                `;
    }

    renderDone() {
        const isDemo = state.onboardingMode === 'demo';

        return `
                    <div style="text-align: center; padding: 60px 40px; max-width: 700px; margin: 0 auto;">
                        <div style="font-size: 5rem; margin-bottom: 32px; animation: bounce 1s ease-in-out 3;">🎉</div>
                        <h1 style="font-size: 2.5rem; margin-bottom: 16px; background: linear-gradient(135deg, #06b6d4, #10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 900;">
                            ${isDemo ? '¡Modo Exploración Activado!' : '¡Todo Listo!'}
                        </h1>
                        <p style="font-size: 1.25rem; color: #94a3b8; margin-bottom: 48px; line-height: 1.6;">
                            ${isDemo
                ? 'Puedes explorar todas las funciones con datos de prueba. Los cambios NO se guardarán.'
                : 'Tu sistema está configurado y listo para usar en producción.'}
                        </p>
                        
                        ${isDemo ? `
                            <div style="background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.1)); border: 2px solid #fbbf24; border-radius: 16px; padding: 24px; margin-bottom: 40px;">
                                <div style="font-size: 1rem; color: #fbbf24; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                                    <span>⚠️</span>
                                    <span>MODO DEMO ACTIVO</span>
                                </div>
                                <div style="color: #f1f5f9; font-size: 0.875rem; line-height: 1.6; margin-bottom: 16px;">
                                    Estás usando datos de prueba. Puedes explorar libremente todas las funciones:
                                </div>
                                <div style="display: grid; gap: 8px; text-align: left; color: #f1f5f9; font-size: 0.875rem;">
                                    <div>✓ Marcar asistencia</div>
                                    <div>✓ Generar reportes</div>
                                    <div>✓ Exportar a Excel</div>
                                    <div>✓ Probar todas las funciones</div>
                                </div>
                                <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(251, 191, 36, 0.3); color: #fbbf24; font-size: 0.875rem; font-weight: 600;">
                                    Para ingresar tus datos reales, recarga la página y selecciona "Configurar Desde Cero"
                                </div>
                            </div>
                        ` : `
                            <div style="background: #1e293b; border-radius: 16px; padding: 32px; margin-bottom: 40px; border: 1px solid #334155;">
                                <div style="display: grid; gap: 16px; text-align: left;">
                                    <div style="padding-bottom: 16px; border-bottom: 1px solid #334155;">
                                        <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Empresa</div>
                                        <div style="font-weight: 700; color: #f1f5f9; font-size: 1.125rem;">${state.settings.companyName}</div>
                                    </div>
                                    <div style="padding-bottom: 16px; border-bottom: 1px solid #334155;">
                                        <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Jornada Laboral</div>
                                        <div style="font-weight: 700; color: #f1f5f9; font-size: 1.125rem;">${state.settings.regularHoursPerDay} horas/día</div>
                                    </div>
                                    <div style="padding-bottom: 16px; border-bottom: 1px solid #334155;">
                                        <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Posiciones</div>
                                        <div style="font-weight: 700; color: #f1f5f9; font-size: 1.125rem;">${state.positions.filter(p => p.active).length} configuradas</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Empleados</div>
                                        <div style="font-weight: 700; color: #f1f5f9; font-size: 1.125rem;">${state.employees.filter(e => e.active).length} registrados</div>
                                    </div>
                                </div>
                            </div>
                        `}
                        
                        <div style="background: linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(16, 185, 129, 0.1)); border-radius: 16px; padding: 24px; margin-bottom: 40px; border: 1px solid rgba(6, 182, 212, 0.3);">
                            <div style="font-weight: 700; margin-bottom: 16px; color: #06b6d4; font-size: 1.125rem;">💡 Consejos rápidos:</div>
                            <div style="display: grid; gap: 12px; text-align: left; color: #f1f5f9; font-size: 0.875rem; line-height: 1.6;">
                                <div style="display: flex; align-items: start; gap: 12px;">
                                    <div style="background: #10b981; min-width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 0.75rem;">1</div>
                                    <div>Ve a <strong>📋 Asistencia</strong> para marcar quién trabajó hoy</div>
                                </div>
                                <div style="display: flex; align-items: start; gap: 12px;">
                                    <div style="background: #06b6d4; min-width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 0.75rem;">2</div>
                                    <div>Usa <strong>Vista Semana</strong> para ver y editar toda la semana</div>
                                </div>
                                <div style="display: flex; align-items: start; gap: 12px;">
                                    <div style="background: #f59e0b; min-width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 0.75rem;">3</div>
                                    <div>Exporta backups desde <strong>⚙️ Ajustes</strong> regularmente</div>
                                </div>
                            </div>
                        </div>
                        
                        <button onclick="onboardingWizard.complete()" class="btn btn-primary" style="padding: 20px 64px; font-size: 1.25rem; font-weight: 800; box-shadow: 0 12px 40px rgba(6, 182, 212, 0.4); animation: pulse 2s ease-in-out infinite;">
                            ${isDemo ? '🎮 Empezar a Explorar →' : '🚀 Empezar a Usar →'}
                        </button>
                        
                        ${isDemo ? `
                            <div style="margin-top: 24px;">
                                <button onclick="location.reload()" style="background: none; border: 2px solid #64748b; color: #94a3b8; padding: 12px 24px; border-radius: 10px; cursor: pointer; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.borderColor='#06b6d4'; this.style.color='#06b6d4'" onmouseout="this.style.borderColor='#64748b'; this.style.color='#94a3b8'">
                                    🔄 Reiniciar para Configurar Desde Cero
                                </button>
                            </div>
                        ` : ''}
                        
                        ${this.renderProgress()}
                    </div>
                `;
    }

    renderProgress() {
        const total = this.steps.length;
        const current = state.onboardingStep + 1;
        const percentage = (current / total) * 100;

        return `
                    <div style="margin-top: 48px; text-align: center;">
                        <div style="background: #334155; height: 8px; border-radius: 4px; overflow: hidden; max-width: 400px; margin: 0 auto 12px;">
                            <div style="background: linear-gradient(90deg, #06b6d4, #10b981); height: 100%; width: ${percentage}%; transition: width 0.3s ease-out; border-radius: 4px;"></div>
                        </div>
                        <div style="color: #64748b; font-size: 0.875rem; font-weight: 600;">
                            Paso ${current} de ${total}
                        </div>
                    </div>
                `;
    }

    next() {
        if (state.onboardingStep < this.steps.length - 1) {
            state.onboardingStep++;
            render();
        }
    }

    prev() {
        if (state.onboardingStep > 0) {
            state.onboardingStep--;
            render();
        }
    }

    saveCompanyAndNext() {
        const input = document.getElementById('onboarding-company-name');
        if (!input) return;

        const name = input.value.trim();
        if (name.length < 2) {
            showNotification('❌ Por favor ingresa el nombre de la empresa', 'error');
            return;
        }

        state.settings.companyName = name;
        this.next();
    }

    complete() {
        if (state.onboardingMode === 'scratch') {
            // Guardar datos permanentemente
            localStorage.setItem('onboardingCompleted', 'true');
            saveApplicationData();
            showNotification('✅ ¡Sistema configurado! Tus datos se han guardado', 'success');
        } else {
            // Modo demo: NO guardar en localStorage
            showNotification('🎮 Modo exploración activo. Los cambios NO se guardarán', 'info');
        }

        state.showOnboarding = false;
        render();
    }

    skipToCloudLogin() {
        // Completar onboarding y abrir login de Supabase
        localStorage.setItem('onboardingCompleted', 'true');
        state.showOnboarding = false;

        // Primero renderizar para quitar el overlay de onboarding
        render();

        // Luego abrir modal de Supabase
        setTimeout(() => {
            showSupabaseLogin();
        }, 200);
    }

    skipToRestoreBackup() {
        // Completar onboarding y abrir restauración de backup
        localStorage.setItem('onboardingCompleted', 'true');
        state.showOnboarding = false;

        // Trigger file input para backup
        setTimeout(() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    try {
                        const text = await file.text();
                        const importedData = JSON.parse(text);

                        // Validar estructura (igual que importData)
                        if (!importedData.data) {
                            throw new Error('Formato de archivo inválido');
                        }

                        // Importar datos (igual que importData que sí funciona)
                        state.settings = importedData.data.settings || state.settings;
                        state.positions = importedData.data.positions || [];
                        state.employees = importedData.data.employees || [];
                        state.attendance = importedData.data.attendance || {};
                        state.tempAssignments = importedData.data.tempAssignments || [];

                        // Guardar en localStorage
                        saveApplicationData();

                        showNotification('✅ Backup restaurado correctamente', 'success');
                        render();
                    } catch (error) {
                        console.error('Error restaurando backup:', error);
                        showNotification('❌ Archivo de backup inválido: ' + error.message, 'error');
                    }
                }
            };
            input.click();
        }, 100);
    }
}

// Crear instancia global
const onboardingWizard = new OnboardingWizard();
window.onboardingWizard = onboardingWizard; // Expose to window for HTML onclick handlers

// Funciones auxiliares para onboarding
window.selectHours = function (hours) {
    state.settings.regularHoursPerDay = hours;
    render();
};

window.quickAddPosition = function (name) {
    const colors = ['#10b981', '#f59e0b', '#3b82f6', '#06b6d4', '#8b5cf6', '#ec4899'];
    const existingPos = state.positions.find(p => p.name === name && p.active);

    if (existingPos) {
        showNotification(`⚠️ La posición "${name}" ya existe`, 'error');
        return;
    }

    const newPosition = {
        id: generateUUID(), // ✅ UUID compatible con Supabase
        name: name,
        salaryConfig: {
            amount: 30000,
            period: 'month',
            workDays: [1, 2, 3, 4, 5, 6]
        },
        color: colors[state.positions.length % colors.length],
        leaderId: null,
        active: true,
        updatedAt: Date.now()
    };

    state.positions.push(newPosition);
    showNotification(`✅ Posición "${name}" agregada`, 'success');
    render();
};

window.removePosition = function (positionId) {
    state.positions = state.positions.filter(p => p.id !== positionId);
    render();
};

window.addOnboardingEmployee = function (event) {
    event.preventDefault();

    const nameInput = document.getElementById('onboarding-emp-name');
    const positionSelect = document.getElementById('onboarding-emp-position');

    if (!nameInput || !positionSelect) return;

    const name = nameInput.value.trim();
    const positionId = positionSelect.value;

    if (name.length < 2) {
        showNotification('❌ El nombre debe tener al menos 2 caracteres', 'error');
        return;
    }

    const newNumber = String(state.employees.length + 1).padStart(3, '0');
    const newEmployee = {
        id: generateUUID(), // ✅ UUID compatible con Supabase
        number: newNumber,
        name: name,
        position: positionId,
        positions: [positionId],
        active: true,
        updatedAt: Date.now()
    };

    state.employees.push(newEmployee);
    showNotification(`✅ Empleado "${name}" agregado`, 'success');

    // Limpiar formulario
    nameInput.value = '';

    render();
};

window.removeEmployee = function (employeeId) {
    state.employees = state.employees.filter(e => e.id !== employeeId);
    render();
};

// ============================================
// CSS ADICIONAL PARA ANIMACIONES
// ============================================

const additionalStyles = `
            @keyframes bounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-20px); }
            }
            
            @keyframes pulse {
                0%, 100% { box-shadow: 0 12px 40px rgba(6, 182, 212, 0.4); }
                50% { box-shadow: 0 16px 60px rgba(6, 182, 212, 0.6); }
            }
        `;

const styleTag = document.createElement('style');
styleTag.textContent = additionalStyles;
document.head.appendChild(styleTag);

// ============================================
// 🚀 INICIALIZACIÓN DE LA APLICACIÓN
// ============================================

(async function initializeApp() {
    console.log('🚀 ========================================');
    console.log('🚀 SISTEMA DE CONTROL DE ASISTENCIA');
    console.log('🚀 Versión: 6.5 (Logging Completo)');
    console.log('🚀 ========================================');

    try {
        // 1. Cargar datos de forma asíncrona (AWAIT CRÍTICO)
        console.log('📂 Cargando datos...');
        await loadApplicationData();

        // 2. Aplicar configuraciones de interfaz
        state.settings.iconSet = applyIconSet(state.settings.iconSet);

        // 3. Intentar restaurar auto-backup (solo si la carga falló completamente)
        if (state.employees.length === 0) {
            console.log('🔄 Intentando restaurar auto-backup...');
            restoreAutoBackup();
        }

        // 4. Inicializar Auth y Sincronización
        await supabaseService.initAuth();

        // 5. Preparar UI
        onboardingWizard.show();

        // 6. Renderizado Inicial
        console.log('🎨 Renderizando interfaz...');
        render();

        console.log('✅ Aplicación iniciada correctamente');
    } catch (error) {
        console.error('❌ Error fatal durante la inicialización:', error);
        // Intentar renderizar aunque sea un estado de error
        render();
    }
})();


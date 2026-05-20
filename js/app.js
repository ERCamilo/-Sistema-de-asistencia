import FirebaseService from './modules/services/FirebaseService.js';
import { saveApplicationData, saveToIndexedDB, loadApplicationData, validateDataIntegrity, prepareDataForNewAccount, createAutoBackup, restoreAutoBackup, sanitizePositions, loadDemoDataIntoDB } from './modules/services/PersistenceService.js';
import { BatchedSaver } from './modules/utils/BatchedSaver.js';
import { Header } from './modules/ui/Header.js';
import { debug } from './modules/utils/Debug.js';

// debug está disponible globalmente (window.debug) — usar `debug.enable()` desde
// la consola del navegador para activar logs verbosos durante desarrollo.

// 📦 IMPORTACIÓN DEL ESTADO CENTRAL (Fase 4 - Modularización)
import {
    state, stateManager, renderOptimizer, calculateStats
} from './modules/core/AppState.js';

import {
    DayView, WeekView, StatsGrid, Legend, PositionFilters, SearchBar,
    EmployeeRow, EmployeeRowCompact, WeekRow, WeekViewTotalsRow, renderSkeleton,
    DateControls, DateControlsCompact, getDayHours, getCheckColor
} from './modules/ui/AttendanceUI.js';
import { CalendarView } from './modules/ui/components/CalendarView.js';
import { RestoreUI } from './modules/ui/RestoreUI.js';
import { LegacyMigrator } from './modules/utils/LegacyMigrator.js';

// ... (Resto de importaciones existentes)
import * as EmployeesUI from './modules/features/employees/EmployeesUI.js';
// ...

import { debounce, renderInChunks, perfMonitor } from './modules/utils/Performance.js';

// ============================================
// 🏗️ SISTEMA POO - CLASES Y OBJETOS REUTILIZABLES
// ============================================

// ============================================
// 📢 CLASE NOTIFICATION (POO - Profesional)
// ============================================
import { Notification, NotificationSystem } from './modules/components/Notification.js';
import { Modal } from './modules/components/Modal.js';
import { Employee } from './modules/features/employees/Employee.js';
import { Position } from './modules/features/employees/Position.js';
import { Leader } from './modules/features/employees/Leader.js';
import { Attendance } from './modules/features/attendance/Attendance.js';
import { UndoManager } from './modules/utils/UndoManager.js';
import { DateUtils, parseDate, getDateKey, isDayHoliday, formatDate, formatDateShort, formatMonthYear, formatDateRangeWithMonth, wasEmployeeActiveOnDate, wasEmployeeActiveInRange } from './modules/utils/DateUtils.js';
import { formatCurrency } from './modules/utils/Formatters.js';

// 🛡️ SISTEMA DE REPORTE DE ERRORES: Manejado globalmente por index.html (Alpha Refactorizer)
import { IndexedDBService, indexedDBService } from './modules/services/IndexedDBService.js';
import { StorageService } from './modules/services/StorageService.js';
import { DataService } from './modules/services/DataService.js';
import { ValidationService } from './modules/services/ValidationService.js';
import { ComponentBase } from './modules/components/ComponentBase.js';
import { AttendanceService } from './modules/features/attendance/AttendanceService.js';
import { HolidayService } from './modules/features/attendance/HolidayService.js';
import { PayrollService } from './modules/features/payroll/PayrollService.js';
import { ChartService } from './modules/features/analytics/ChartService.js';
// Importación de datos demo eliminada (ahora se usa DemoSeed.js mediante PersistenceService)
import { initSettingsUI, SettingsTab as SettingsTabUI, SyncCard as SyncCardUI } from './modules/ui/SettingsUI.js';
import { TabComponent } from './modules/components/TabComponent.js';
import './modules/ui/AttendanceHandlers.js';

import { TableComponent } from './modules/components/TableComponent.js';
import { FormComponent } from './modules/components/FormComponent.js';
import { CalendarPickerComponent } from './modules/components/CalendarPickerComponent.js';
import { StatCardComponent } from './modules/components/StatCardComponent.js';
import { SearchComponent } from './modules/components/SearchComponent.js';
import { BadgeComponent } from './modules/components/BadgeComponent.js';
import { TooltipComponent } from './modules/components/TooltipComponent.js';
import { COLOR_PALETTE } from './modules/utils/Constants.js';
import icons from './modules/ui/IconSystem.js';
import { DOMDiff } from './modules/utils/DOMDiff.js';
import {
    DateRangeManager,
    DashboardDateManager,
    DashboardDateManagerV2,
    EmployeeReportDateManager,
    EmployeeReportDateManagerV2,
    AttendanceDateManager
} from './modules/utils/DateManagers.js';
import { render, setRootComponent, saveScrollPosition, restoreScrollPosition } from './modules/core/RenderManager.js';
import lazyLoader from './modules/utils/LazyLoader.js';
import syncManager from './modules/services/SyncManager.js';
import offlineManager from './modules/services/OfflineManager.js';
import workerPool from './modules/utils/WebWorkerPool.js';

import { firebaseConfig, APP_CONFIG } from './modules/config/Config.js';
import * as AnalyticsUI from './modules/features/analytics/AnalyticsUI.js';
import * as PayrollUI from './modules/features/payroll/PayrollUI.js';
import * as SyncUI from './modules/ui/SyncUI.js';
import { NotesCenter, NoteEditorModal, registerLegacyGlobals as registerNotesGlobals } from './modules/features/notes/index.js';
import { ExportMenu, ImportFullModal, registerLegacyGlobals as registerExportGlobals } from './modules/features/export/index.js';
import { EmployeeProfileModal, syncProfileToMaster, registerLegacyGlobals as registerProfileGlobals } from './modules/features/profile/index.js';

//agregado manualmente
import { eventBus } from './modules/core/Events.js';
import { onboardingWizard } from './modules/ui/Onboarding.js';
import { ModalManager } from './modules/ui/ModalManager.js';
import { VirtualScrollComponent } from './modules/components/VirtualScroll.js';
import { ExportService } from './modules/services/ExportService.js';
import { MaintenanceUI } from './modules/ui/MaintenanceUI.js';
import { SystemAlertsManager } from './modules/components/SystemAlertsManager.js';

// Inicializar SystemAlertsManager globalmente
window._systemAlerts = new SystemAlertsManager();
window._maintenanceUI = new MaintenanceUI();

// 💾 BatchedSaver compartido para escrituras de IndexedDB desde Firebase
// Acumula dateKeys que llegan en ráfaga y los persiste con una sola escritura
// cuando el navegador está ocioso (o como máximo tras 1 segundo).
// Reduce de N escrituras (una por día) a 1 escritura completa.
window._attendanceBatchedSaver = new BatchedSaver({
    flush: async (dateKeys, _meta) => {
        try {
            await saveToIndexedDB({ skipValidation: true });
            if (window.debug?.log) {
                window.debug.log(`💾 IndexedDB: batch de ${dateKeys.length} día(s) guardado en una sola escritura`);
            }
        } finally {
            // Liberar el flag tras persistir (estaba bloqueando el ciclo de save)
            window._isApplyingRemoteData = false;
        }
    },
    maxWaitMs: 1000,
    onError: (err) => console.warn('⚠️ Error persistiendo batch de asistencia remota:', err)
});

// ============================================
// 🎯 EVENT DELEGATION MAESTRO (app.js)
// Resolver genérico: data-app-fn="fnName" + opcional data-arg / data-arg2
// Flags adicionales: data-app-stop="1" (stopPropagation), data-app-close-on-self
// ============================================
const _APP_SPECIAL_ACTIONS = {
    'close-employee-profile': () => window.closeEmployeeProfile?.(),
    'close-modal': () => window.closeModal?.(),
    'close-export-menu': () => window.closeExportMenu?.(),
    'close-import-full': () => window.closeImportFullModal?.(),
    'close-note-modal': () => window.closeNoteModal?.(),
    'close-notes-center': () => window.closeNotesCenter?.(),
    'close-start-picker': (_, _el, e) => { e?.stopPropagation(); if (state.employeeProfile) state.employeeProfile.showStartPicker = false; window.render?.(); },
    'close-end-picker': (_, _el, e) => { e?.stopPropagation(); if (state.employeeProfile) state.employeeProfile.showEndPicker = false; window.render?.(); },
    'toggle-profile-hire-date-picker': () => { state.showProfileHireDatePicker = !state.showProfileHireDatePicker; window.render?.(); },
    'pdf-soon': () => window.Notification?.info?.('📄 Generar PDF próximamente'),
    'wa-soon': () => window.Notification?.info?.('💬 Envío por WhatsApp próximamente'),
    'demo-reset': () => window.showConfirm?.({
        title: '🔄 Reiniciar Sistema',
        message: '¿Estás seguro de reiniciar el sistema? Podrás configurarlo desde cero.',
        confirmText: 'Sí, reiniciar',
        cancelText: 'Cancelar',
        type: 'warning',
        onConfirm: () => location.reload()
    })
};

function _coerceArg(s) {
    if (s === undefined || s === null) return s;
    // Si parece número (incluyendo negativos y decimales), convertir
    if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    return s;
}

function _appResolveAndCall(fnName, args, target, event) {
    if (!fnName) return;
    // Acción especial
    if (_APP_SPECIAL_ACTIONS[fnName]) {
        _APP_SPECIAL_ACTIONS[fnName](args[0], target, event);
        return;
    }
    // Función global
    const fn = window[fnName];
    if (typeof fn !== 'function') return;
    fn(...args.map(_coerceArg));
}

function _handleAppClick(e) {
    // 1. stopPropagation puro (sin handler asociado)
    const stopOnly = e.target.closest('[data-app-stop-only]');
    if (stopOnly) e.stopPropagation();

    // 2. Close-on-self: el clic debe haber sido directamente sobre este elemento
    const closeOnSelf = e.target.closest('[data-app-close-on-self]');
    if (closeOnSelf && e.target === closeOnSelf) {
        const fnName = closeOnSelf.dataset.appCloseOnSelf;
        _appResolveAndCall(fnName, [], closeOnSelf, e);
        return;
    }

    // 3. Botón normal con data-app-fn
    const target = e.target.closest('[data-app-fn]');
    if (!target) return;

    if (target.dataset.appStop === '1') e.stopPropagation();

    const fnName = target.dataset.appFn;
    const args = [];
    if (target.dataset.arg !== undefined) args.push(target.dataset.arg);
    if (target.dataset.arg2 !== undefined) args.push(target.dataset.arg2);

    _appResolveAndCall(fnName, args, target, e);
}

function _handleAppKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-app-fn]');
    if (!target || target.tagName === 'BUTTON' || target.tagName === 'A') return;
    if (target.getAttribute('role') !== 'button') return;
    e.preventDefault();
    _handleAppClick(e);
}

document.addEventListener('click', _handleAppClick);
document.addEventListener('keydown', _handleAppKeydown);
import { EmployeeStatsService } from './modules/features/stats/EmployeeStatsService.js';
import { EmployeeFloatingCard } from './modules/ui/components/EmployeeFloatingCard.js';
import { InstallPromptManager } from './modules/services/InstallPromptManager.js';
import './modules/ui/MaintenanceUI.js';


const ICON_SET_STORAGE_KEY = 'icon-set';

function resolveIconSet(preferred) {
    const available = (icons && typeof icons.getAvailableSets === 'function') ? icons.getAvailableSets() : ['unicode'];
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
// COMPATIBILIDAD CON CÓDIGO VIEJO (Global Bridges)
// ============================================
globalThis.lazyLoader = lazyLoader;
globalThis.syncManager = syncManager;
globalThis.offlineManager = offlineManager;
globalThis.workerPool = workerPool;
globalThis.renderManager = renderManager;
globalThis.renderZone = renderManager.renderZone.bind(renderManager);
globalThis.Notification = Notification;
globalThis.Modal = Modal;
globalThis.eventBus = eventBus;
globalThis.perfMonitor = perfMonitor;
globalThis.IndexedDBService = IndexedDBService;
globalThis.indexedDBService = indexedDBService;
globalThis.Employee = Employee;
globalThis.Position = Position;
globalThis.Leader = Leader;
globalThis.Attendance = Attendance;

// ============================================
// COMPATIBILIDAD CON CÓDIGO VIEJO
// ============================================
// ============================================
// 📢 NOTIFICATIONSYSTEM (Importado)
// ============================================

function showNotification(message, type = 'info', duration) {
    if (type === 'loading') return Notification.loading(message);
    return Notification[type] ? Notification[type](message, duration) : Notification.info(message, duration);
}

// ============================================
// 🔄 SISTEMA UNDO — Botón "Deshacer"
// ============================================
// Movido a js/modules/utils/UndoManager.js
// Inicialización diferida para asegurar dependencias
document.addEventListener('DOMContentLoaded', async () => {
    try {
        UndoManager.init({
            saveFn: saveApplicationData,
            renderFn: render,
            showNotificationFn: showNotification
        });
    } catch (error) {
        console.error('❌ Error inicializando sistema:', error);
        showNotification(`🚨 Fallo de arranque: ${error.message}`, 'error', 0);
    }
});

// ============================================
// Puentes globales consolidados arriba

// ============================================
// 🌐 NAMESPACE APP (Encapsulación de Globales)
// ============================================
window.App = {
    state,
    render,
    saveApplicationData,
    showNotification,
    applyIconSet,
    resolveIconSet,
    loginWithGoogle: () => FirebaseService.loginWithGoogle(),
    logoutFirebase: () => FirebaseService.logout()
};

// Aliases para compatibilidad con HTML legacy (se irán eliminando en Fase 3/4)
window.render = render;
window.saveToLocalStorage = saveApplicationData;
window.showNotification = showNotification;
window.applyIconSet = applyIconSet;
window.resolveIconSet = resolveIconSet;
window.loginWithGoogle = window.App.loginWithGoogle;
window.logoutFirebase = window.App.logoutFirebase;

// ============================================
// 📅 INICIALIZACIÓN DE GESTORES DE FECHA (POO)
// ============================================
const attendanceDateManager = new AttendanceDateManager(state, saveApplicationData);

// PUENTES GLOBALES PARA ASISTENCIA
window.toggleDatePicker = (target, force) => attendanceDateManager.togglePicker(target, force);
window.changeDate = (delta) => attendanceDateManager.changeDate(delta);
window.selectAttendanceDate = (date) => attendanceDateManager.selectDate(date);
window.goToToday = () => attendanceDateManager.setToday();

window.DatePicker = (target) => {
    if (!state.showDatePicker) return '';
    const activeTarget = state.datePickerTarget || 'full';
    if (target && activeTarget !== target) return '';

    // Preparar indicadores (por ejemplo, puntos si hay notas o feriados)
    const indicators = {};
    // Podríamos agregar lógica aquí para mostrar puntos en días con notas o cambios especiales

    const component = new CalendarPickerComponent({
        selectedDate: state.selectedDate,
        viewDate: state.datePickerMonth,
        currentView: state.datePickerView,
        holidays: state.settings?.holidays || [],
        indicators: indicators,
        onDateSelect: 'window.selectAttendanceDate',
        onClose: () => attendanceDateManager.togglePicker(target, false)
    });
    return component.render();
};

// CERRAR CALENDARIO AL HACER CLIC FUERA
document.addEventListener('click', (e) => {
    if (state.showDatePicker) {
        // Si el elemento ya no está en el DOM, ignoramos el clic (probablemente fue un 
        // botón de navegación que disparó un re-render y se eliminó a sí mismo)
        if (!document.body.contains(e.target)) return;

        const isClickInside = e.target.closest('.calendar-picker') ||
            e.target.closest('.pill-display') ||
            e.target.closest('.calendar-picker-popup');
        if (!isClickInside) {
            attendanceDateManager.togglePicker(null, false);
        }
    }
});

// PUENTE A EMPLOYEES UI (Modales y Filtros reubicados)
Object.entries(EmployeesUI).forEach(([key, value]) => {
    if (typeof value === 'function') {
        window[key] = value;
    }
});

// NOTA: El listener de autenticación se ha consolidado en la función initializeApp() al final del archivo.

// ============================================
// ☁️ HANDLERS DE SINCRONIZACIÓN (Encapsulados en window.App.Sync)
// ============================================
window.App.Sync = {
    syncNow: async () => {
        try {
            state.syncStatus = 'syncing';
            render();
            await FirebaseService.saveFullState(state);
            if (state.settingsActiveTab === 'data') state.snapshots = await FirebaseService.listSnapshots();
            state.syncStatus = 'synced';
            showNotification('✅ Estado general sincronizado', 'success');
            render();
        } catch (e) {
            state.syncStatus = 'error';
            showNotification('❌ Error al sincronizar con Firebase', 'error');
            render();
        }
    },

    syncHistory: async () => {
        if (!window.currentUser) {
            showNotification('⚠️ Debes iniciar sesión con Google primero', 'warning');
            return;
        }
        try {
            state.syncStatus = 'syncing';
            render();
            showNotification('🚀 Iniciando sincronización masiva...', 'info');
            await FirebaseService.syncHistory(state.attendance);
            if (state.settingsActiveTab === 'data') state.snapshots = await FirebaseService.listSnapshots();
            state.syncStatus = 'synced';
            showNotification('✅ Todo el historial ha sido sincronizado', 'success');
            render();
        } catch (e) {
            state.syncStatus = 'error';
            showNotification('❌ Error en sincronización de historial', 'error');
            render();
        }
    },

    createSnapshot: async (type = 'manual') => {
        try {
            showNotification('📸 Creando snapshot...', 'info');
            await FirebaseService.createSnapshot(state, type);
            if (state.settingsActiveTab === 'data') {
                state.isLoadingSnapshots = true; render();
                state.snapshots = await FirebaseService.listSnapshots();
                state.isLoadingSnapshots = false;
            }
            showNotification('✅ Snapshot guardado en la nube', 'success');
            render();
        } catch (e) {
            console.error('Error creando snapshot:', e);
            showNotification('❌ Error al crear snapshot', 'error');
            state.isLoadingSnapshots = false; render();
        }
    },

    downloadFromCloud: async () => {
        const confirmed = await Modal.confirm({
            title: '⚠️ Sobrescribir datos locales',
            message: '¿SOBRESCRIBIR TODO LO LOCAL CON LA NUBE? Esto borrará tus datos actuales y cargará los de Google Drive/Firebase.',
            confirmText: 'Sí, sobrescribir',
            cancelText: 'Cancelar',
            type: 'danger'
        });
        if (!confirmed) return;
        const loader = showNotification('📥 Conectando a la nube...', 'loading');
        try {
            loader.update({ message: '📥 Descargando metadatos...' });
            const cloudState = await FirebaseService.getFullState();
            loader.update({ message: '📥 Descargando historial...' });
            const cloudAttendance = await FirebaseService.getAllAttendance();
            if (!cloudState) {
                loader.update({ message: '❌ No se encontraron datos en la nube', type: 'error', closable: true });
                return;
            }
            Object.assign(state, cloudState);
            state.attendance = cloudAttendance;
            saveApplicationData();
            loader.update({ message: '✅ Datos descargados correctamente', type: 'success' });
            render();
            setTimeout(() => location.reload(), 1500);
        } catch (e) {
            console.error('Error al descargar de la nube:', e);
            loader.update({ message: '❌ Error al descargar datos', type: 'error', closable: true });
        }
    },

    uploadToCloud: async () => {
        const confirmed = await Modal.confirm({
            title: '⚠️ Sobrescribir nube',
            message: '¿SOBRESCRIBIR LA NUBE CON LOS DATOS LOCALES? Esto reemplazará tus archivos en la nube con lo que tienes actualmente.',
            confirmText: 'Sí, subir',
            cancelText: 'Cancelar',
            type: 'danger'
        });
        if (!confirmed) return;
        const loader = showNotification('📤 Iniciando subida...', 'loading');
        try {
            loader.update({ message: '📤 Guardando estado general...' });
            await FirebaseService.saveFullState(state);
            loader.update({ message: '📤 Sincronizando historial...' });
            await FirebaseService.syncHistory(state.attendance);
            loader.update({ message: '✅ Datos subidos correctamente', type: 'success' });
            render();
        } catch (e) {
            console.error('Error al subir a la nube:', e);
            loader.update({ message: '❌ Error al subir datos', type: 'error', closable: true });
        }
    },

    deleteCloudData: async () => {
        const confirm1 = await Modal.confirm({
            title: '🚨 Advertencia crítica',
            message: 'BORRAR NUBE: ¿Estás seguro de eliminar TODOS tus datos en la nube?',
            confirmText: 'Continuar',
            cancelText: 'Cancelar',
            type: 'danger'
        });
        if (!confirm1) return;
        const confirm2 = await Modal.prompt({
            title: 'Confirmación final',
            message: 'Para confirmar escriba exactamente: BORRAR NUBE',
            placeholder: 'BORRAR NUBE',
            confirmText: 'Borrar nube',
            cancelText: 'Cancelar'
        });
        if (confirm2 !== 'BORRAR NUBE') return showNotification('❌ Cancelado', 'error');
        const loader = showNotification('🗑️ Borrando datos remotos...', 'loading');
        try {
            await FirebaseService.deleteCloudData();
            loader.update({ message: '✅ Datos en la nube eliminados', type: 'success' });
            render();
        } catch (e) {
            console.error('Error al borrar la nube:', e);
            loader.update({ message: '❌ Error al borrar datos', type: 'error', closable: true });
        }
    }
};

// Aliases para compatibilidad (Legacy HTML calls)
window.syncFirebaseNow = window.App.Sync.syncNow;
window.syncHistoryNow = window.App.Sync.syncHistory;
window.createFirebaseSnapshot = window.App.Sync.createSnapshot;
window.downloadFromCloudNow = window.App.Sync.downloadFromCloud;
window.uploadToCloudNow = window.App.Sync.uploadToCloud;
window.deleteCloudDataNow = window.App.Sync.deleteCloudData;

/**
 * 🗑️ ELIMINACIÓN DE SNAPSHOTS (Gestión de historial)
 */
window.deleteSnapshotHandler = async (snapshotId) => {
    if (!window.currentUser) return;
    
    const isConfirmed = await Modal.confirm({
        title: '¿Eliminar versión?',
        message: '¿Estás seguro de que deseas eliminar permanentemente esta versión? Esta acción no se puede deshacer.',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!isConfirmed) return;

    const loader = showNotification('🗑️ Eliminando versión...', 'loading');
    try {
        await FirebaseService.deleteSnapshot(snapshotId);
        // Actualizar lista local para refrescar UI inmediatamente
        if (state.snapshots) {
            state.snapshots = state.snapshots.filter(s => s.id !== snapshotId);
        }
        showNotification('✅ Versión eliminada', 'success');
        render();
    } catch (e) {
        console.error('Error al eliminar snapshot:', e);
        showNotification('❌ Error al eliminar la versión', 'error');
    } finally {
        if (loader && typeof loader.close === 'function') loader.close();
    }
};

window.bulkDeleteSnapshotsHandler = async (type) => {
    if (!window.currentUser) return;
    
    const typeLabel = type === 'auto' ? 'AUTOMÁTICAS' : 'MANUALES';
    const isConfirmed = await Modal.confirm({
        title: `¿Eliminar todas las versiones ${typeLabel}?`,
        message: `¿Estás seguro de que deseas eliminar TODAS las versiones ${typeLabel}? Esta acción es permanente.`,
        confirmText: 'Eliminar todas',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!isConfirmed) return;

    const loader = showNotification(`🗑️ Limpiando versiones ${typeLabel.toLowerCase()}...`, 'loading');
    try {
        const deletedCount = await FirebaseService.deleteSnapshotsByType(type);
        
        // Recargar la lista desde la nube para estar seguros
        state.isLoadingSnapshots = true;
        render();
        
        const freshSnapshots = await FirebaseService.listSnapshots(50);
        state.snapshots = freshSnapshots;
        state.isLoadingSnapshots = false;
        
        if (deletedCount > 0) {
            showNotification(`✅ Se eliminaron ${deletedCount} versiones`, 'success');
        } else {
            showNotification('ℹ️ No se encontraron versiones para eliminar', 'info');
        }
        render();
    } catch (e) {
        console.error('Error en limpieza masiva:', e);
        showNotification('❌ Error en limpieza masiva', 'error');
        state.isLoadingSnapshots = false;
        render();
    } finally {
        if (loader && typeof loader.close === 'function') loader.close();
    }
};


window.App.updateBackupFrequency = (value) => {
    state.settings.backupFrequency = value;
    saveApplicationData();
    showNotification(`⏰ Frecuencia de backup: ${value}`, 'info');
};

window.updateBackupFrequency = window.App.updateBackupFrequency;

window.App.updatePayPeriod = (field, value) => {
    if (!state.settings.payPeriod) {
        state.settings.payPeriod = { periodStart: '', periodLength: 15, payDay: '' };
    }
    if (field === 'periodLength') {
        value = parseInt(value, 10);
        if (isNaN(value) || value < 1) value = 15;
    }
    state.settings.payPeriod[field] = value;
    saveApplicationData();
    render();
};

window.App.advancePayPeriod = () => {
    const pp = state.settings.payPeriod;
    if (!pp || !pp.periodStart || !pp.periodLength) {
        showNotification('⚠️ Configura el inicio y duración primero', 'warning');
        return;
    }
    const startDate = new Date(pp.periodStart + 'T00:00:00');
    startDate.setDate(startDate.getDate() + pp.periodLength);
    const newStart = getDateKey(startDate);

    pp.periodStart = newStart;

    // Si hay un payDay, también avanzarlo
    if (pp.payDay) {
        const pd = new Date(pp.payDay + 'T00:00:00');
        pd.setDate(pd.getDate() + pp.periodLength);
        pp.payDay = getDateKey(pd);
    }

    saveApplicationData();
    render();
    showNotification('⏭️ Período de pago avanzado', 'success');
};

window.updatePayPeriod = window.App.updatePayPeriod;
window.advancePayPeriod = window.App.advancePayPeriod;

// Getters/Setters para mantener las variables globales sincronizadas (Migrado a Firebase)
let _autoSyncEnabled = false;

Object.defineProperties(window, {
    isSyncing: {
        get: () => state.syncStatus === 'syncing',
        set: (v) => state.syncStatus = v ? 'syncing' : 'synced'
    },
    autoSyncEnabled: {
        get: () => _autoSyncEnabled,
        set: (v) => _autoSyncEnabled = v
    }
});

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Helper Functions
// Movido a js/modules/utils/DateUtils.js y js/modules/utils/Formatters.js
// - saveScrollPosition / restoreScrollPosition movidas a modules/core/RenderManager.js
//   (importadas arriba) — ahora soportan [data-preserve-scroll] genérico
// - formatCurrency -> Formatters.js
// - DateUtils y funciones de fecha -> DateUtils.js

// Obtener horas configuradas para un día específico
// getDayHours movido a AttendanceUI.js
window.setDayHours = window.App.setDayHours;

// ✅ NUEVO: Configurar horas rápidas para vista semanal
window.App.setQuickWeekHours = function (hours) {
    const h = parseFloat(hours);
    if (isNaN(h) || h < 0.5 || h > 24) { Notification.error('Las horas deben estar entre 0.5 y 24'); return; }
    state.quickWeekHours = h;
    saveApplicationData();
    render();
};
window.setQuickWeekHours = window.App.setQuickWeekHours;

// ✅ NUEVO: Configurar período de perfil
window.App.setProfilePeriod = function (periodType) {
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
        // Usar período de pago unificado
        const pp = state.settings.payPeriod;
        if (pp?.periodStart) {
            startDate = pp.periodStart;
        } else {
            // Fallback a 15 días si no hay período configurado
            const start = new Date(today);
            start.setDate(today.getDate() - 15);
            startDate = getDateKey(start);
            NotificationSystem.info('ℹ️ No hay período configurado. Ve a Ajustes > Calendario para configurarlo.');
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

window.addAdvance = () => {
    const emp = state.employees.find(e => e.id === state.employeeProfile.employeeId);
    if (!emp) return;

    if (!emp.advances) emp.advances = [];
    
    const newIndex = emp.advances.length;
    emp.advances.push({
        amount: 0,
        interest: 0,
        date: getDateKey(new Date()),
        note: ''
    });

    // Abrir automáticamente en modo edición el nuevo adelanto
    if (!state.employeeProfile.editingAdvances) state.employeeProfile.editingAdvances = {};
    state.employeeProfile.editingAdvances[newIndex] = true;

    render();
    saveApplicationData();
};

window.saveAdvance = (index) => {
    // Cerrar modo edición
    if (state.employeeProfile.editingAdvances) {
        state.employeeProfile.editingAdvances[index] = false;
    }
    
    // Sincronizar y guardar
    syncProfileToMaster(state.employeeProfile.employeeId);
    saveApplicationData();
    render();
    showNotification('✅ Adelanto guardado correctamente', 'success');
};

window.editAdvance = (index) => {
    if (!state.employeeProfile.editingAdvances) state.employeeProfile.editingAdvances = {};
    state.employeeProfile.editingAdvances[index] = true;
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
// ============================================
// 🎯 MODALMANAGER (Inyectado desde módulo)
// ============================================
const modalManager = new ModalManager(state, render, NotificationSystem);

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
const holidayService = new HolidayService(state);

// 💰 CLASE PAYROLLSERVICE
const payrollService = new PayrollService(state);

// 📈 CLASE CHARTSERVICE
const chartService = new ChartService(state);
const employeeStatsService = new EmployeeStatsService(state, payrollService, chartService);
const employeeFloatingCard = new EmployeeFloatingCard(employeeStatsService);

// 🛠️ Inicializar SettingsUI
initSettingsUI({
    state,
    icons,
    holidayService,
    get currentUser() { return window.currentUser; },
    get currentUser() { return currentUser; },
    get autoSyncEnabled() { return autoSyncEnabled; },
    calculateStorageStats: () => calculateStorageStats()
});

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
const dataService = new DataService(state, storageService, indexedDBService);

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
SyncUI.initSyncUI(moduleContext);

// Expose Modules to Window (for HTML onclick handlers)
window.EmployeesUI = EmployeesUI;
window.AnalyticsUI = AnalyticsUI;
window.SyncUI = SyncUI;
window.PayrollUI = PayrollUI;

// Map Global Functions for Legacy Compatibility (Employees)
window.changeEmployeeViewMode = EmployeesUI.changeEmployeeViewMode;

// ═══ Handlers para Día Seleccionado (Festivos y Horas Base se manejan en AttendanceHandlers.js) ═══

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
window.deletePosition = EmployeesUI.deletePosition;
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



// Core State and Services moved to modules (AppState.js, FileService.js)

// ============================================
// 💾 CLASE CACHESERVICE (POO - Caché inteligente)
// ============================================
// Cache management moved to AppState.js / Services

// ============================================
// 💾 CLASE MEMOCACHE (POO - Caché de resultados para optimización)
// ============================================
// Movido a js/modules/utils/MemoCache.js

// Instancia global de cache (importada)









// ============================================
// 📜 VIRTUALSCROLLCOMPONENT (Importado)
// ============================================
// Clase manejada por el módulo js/modules/components/VirtualScroll.js

// ============================================
// 📱 INSTALLPROMPTMANAGER (Inyectado)
// ============================================
const installPrompt = new InstallPromptManager(eventBus, NotificationSystem, debug, render);

// ============================================
// 📤 EXPORTSERVICE (Inyectado)
// ============================================
const exportService = new ExportService(indexedDBService, NotificationSystem, debug);

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

    // Guardar notas
    att.notes = notesInput ? notesInput.value.trim() : '';

    // Si usa distribución multi-posición
    if (att.positionHours && att.positionHours.length > 0) {
        // Calcular totales
        const totalHours = att.positionHours.reduce((sum, ph) => sum + (parseFloat(ph.hours) || 0), 0);
        const totalOvertime = att.positionHours.reduce((sum, ph) => sum + (parseFloat(ph.overtimeHours) || 0), 0);

        if (totalHours === 0) {
            Notification.error('Debes asignar al menos 1 hora');
            return;
        }

        // Actualizar registro
        att.multiPosition = att.positionHours.length > 1;
        att.hoursWorked = totalHours;
        att.overtimeHours = totalOvertime;
        att.present = true; // ✅ Garantizar marcado como presente

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
            Notification.error('Debes asignar al menos 1 hora');
            return;
        }

        att.hoursWorked = hours;
        att.overtimeHours = overtime;
        att.present = true; // ✅ FIX: Garantizar que esté presente en modo simple para que cuente en estadísticas
        att.multiPosition = false;
        att.selectedPosition = emp.positions?.[0] || null;
        att.positionHours = [];
    }

    // Guardar en state
    att.updatedAt = Date.now();
    // ⚡ FIX REACTIVIDAD: Usamos un spread {...att} para que la referencia sea nueva.
    // Esto obliga al Proxy en AppState.js a detectar el cambio y reconstruir el índice de estadísticas.
    state.attendance[key] = { ...att };

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

    // ✅ Sincronizar con la base de datos (Zonal Sync)
    saveApplicationData({ dateKey: getDateKey(state.selectedDate) });

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

    saveApplicationData({ dateKey: getDateKey(state.selectedDate) });
    closeModal();
    render();
};

// Remover posición del modal
window.removePositionHours = async function (index) {
    const emp = state.selectedEmployee;
    if (!emp) return;

    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];

    if (att && att.positionHours) {
        att.positionHours.splice(index, 1);

        // Si no quedan posiciones, eliminar toda la asistencia
        if (att.positionHours.length === 0) {
            const confirmDelete = await Modal.confirm({
                title: 'Eliminar asistencia',
                message: 'No quedan posiciones asignadas. ¿Eliminar la asistencia completa?',
                confirmText: 'Eliminar',
                cancelText: 'Cancelar',
                type: 'danger'
            });
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

// ⚡ SINCRONIZACIÓN DEBUNCED PARA FIREBASE (Mirror Sync) - MOVIDO A PersistenceService.js
/*
const syncFirebaseMirrorDebounced = (function() {
    let timeout;
    return function(state) {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
            if (window.currentUser && !window._isApplyingRemoteData) {
                try {
                    await FirebaseService.saveFullState(state);
                } catch (e) {
                    console.error('⚠️ Error en sincronización debounced:', e);
                }
            }
        }, 2000); // 2 segundos de espera
    };
})();
*/

// MOVIDO A PersistenceService.js
/*
async function saveToIndexedDB(options = {}) {
    try {
        await indexedDBService.saveState(state, options);
        debug.log('💾 Datos guardados en IndexedDB');
        return true;
    } catch (error) {
        debug.error('❌ Error guardando en IndexedDB:', error);
        throw error;
    }
}
*/

// MOVIDO A PersistenceService.js
/*
async function saveApplicationData(options = {}) {
    if (window._isSavingData) return;
    window._isSavingData = true;

    if (!state.isDataLoaded) {
        console.warn('⚠️ Intento de guardado ignorado: los datos aún no se han cargado completamente.');
        window._isSavingData = false;
        return;
    }
    debug.log('🔵 saveApplicationData() iniciado', options.dateKey ? `para fecha: ${options.dateKey}` : '');

    // ☁️ Sincronización con Firebase (Fase 3 - Granular & Mirror Sync)
    // 🛡️ GUARD: Si estamos aplicando datos remotos, NO re-subir a Firebase (evita loop infinito)
    if (window.currentUser && !window._isApplyingRemoteData) {
        // 1. Sincronización Granular (solo si se especifica una fecha)
        if (options.dateKey) {
            const dayRecords = {};
            const suffix = `-${options.dateKey}`;
            Object.entries(state.attendance).forEach(([key, record]) => {
                if (key.endsWith(suffix)) {
                    dayRecords[key] = record;
                }
            });
            FirebaseService.saveDailyAttendance(options.dateKey, dayRecords).catch(e => 
                console.error(`⚠️ Error en sync granular (${options.dateKey}):`, e)
            );
        }

        // 2. Sincronización Espejo (Full State) - DEBOUCED
        syncFirebaseMirrorDebounced(state);

        // Lógica de Backup Automático (Snapshots)
        const freq = state.settings.backupFrequency || 'none';
        if (freq !== 'none') {
            const now = Date.now();
            const lastBackup = state.settings.lastSnapshotTimestamp || 0;
            const intervals = {
                daily: 24 * 60 * 60 * 1000,
                weekly: 7 * 24 * 60 * 60 * 1000,
                monthly: 30 * 24 * 60 * 60 * 1000
            };

            if (now - lastBackup > (intervals[freq] || Infinity)) {
                FirebaseService.createSnapshot(state, 'auto').then(() => {
                    state.settings.lastSnapshotTimestamp = now;
                    // No llamamos a saveApplicationData aquí para evitar bucles,
                    // se guardará en el siguiente paso de IndexedDB.
                }).catch(e => console.error('Error en backup automático:', e));
            }
        }
    }

    if (state.useIndexedDB) {
        debug.log('💾 Guardando en IndexedDB...');
        try {
            await saveToIndexedDB(options);
        } catch (error) {
            console.error('❌ Error guardando en IndexedDB:', error);
            
            // 🛰️ Manejo de conflictos de sincronización (ConstraintError)
            if (error.name === 'ConstraintError' || error.message.includes('ConstraintError')) {
                console.warn('⚡ Conflicto de integridad detectado. Abriendo gestor de conflictos...');
                new SyncConflictModal({
                    error: error.message,
                    onResolved: (type) => {
                        debug.log(`✅ Conflicto resuelto via: ${type}`);
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
    if (typeof cacheService !== 'undefined') {
        cacheService.invalidate('.*');
    }

    // 📡 Emitir evento de guardado
    eventBus.emit('data:saved', {
        timestamp: Date.now()
    });

    window._isSavingData = false;
}
*/

/**
 * 🔄 REGENERACIÓN DE IDs PARA CLONADO
 * Genera nuevos UUIDs para todos los datos locales para poder 
 * subirlos a una cuenta nueva de Supabase sin conflictos de Primary Key.
 */
// MOVIDO A PersistenceService.js
/*
async function prepareDataForNewAccount() {
    ...
}
*/

// MOVIDO A PersistenceService.js
/*
function createAutoBackup() {
    ...
}
*/

// MOVIDO A PersistenceService.js
/*
function restoreAutoBackup() {
    ...
}
*/

// MOVIDO A PersistenceService.js
/*
async function loadFromIndexedDB() {
    ...
}
*/

// MOVIDO A PersistenceService.js
/*
async function loadApplicationData() {
    ...
}
*/

// MOVIDO A PersistenceService.js
/*
function validateDataIntegrity() {
    ...
}
*/

// Alias para compatibilidad - MOVIDO A PersistenceService.js
// window.loadFromLocalStorage = loadApplicationData;


function exportDataToJSON() {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `asistencia-backup-${getDateKey(new Date())}.json`;
    link.click();

    debug.log('📥 Datos exportados');
}

function clearAllData() {
    // Usar el nuevo sistema robusto de DataService
    dataService.reset();
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


// getCheckColor ha sido migrado a AttendanceUI.js para mejor modularidad

function getWeekDates(date) {
    return DateUtils.getWeekDates(date);
}
// ⚡ Versión original (sin caché)
// Statistics calculation moved to AppState.js

// ⚡ NUEVO: Calcular nómina completa de un empleado en un período

// getDaysInMonth moved to js/modules/utils/DateUtils.js


// Event Handlers
window.changeTab = (tab) => {
    window.showLoader?.(true);

    setTimeout(() => {
        state.activeTab = tab;
        render();

        // Liberar bloqueo tras el renderizado inicial de pestaña
        window._isNavigating = false;
        window.hideLoader?.();

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
    });
};

// ⚡ NUEVO: Cambiar pestaña de configuración (Asíncrono para Snapshots)
window.changeSettingsTab = async (tab) => {
    state.settingsActiveTab = tab;
    render();

    // Fase 4: Si entramos en la pestaña de datos, cargar snapshots de la nube
    if (tab === 'data' && window.currentUser) {
        try {
            state.isLoadingSnapshots = true;
            render();

            const snaps = await FirebaseService.listSnapshots();
            state.snapshots = snaps;

            state.isLoadingSnapshots = false;
            render();
        } catch (e) {
            console.error('Error cargando snapshots:', e);
            state.isLoadingSnapshots = false;
            render();
        }
    }
};

// ⚡ NUEVO: Restaurar Snapshot desde Firebase (Fase 4)
window.restoreSnapshot = async (snapshotId) => {
    if (!window.currentUser) return;

    // Confirmación brutalmente honesta como pide el usuario
    const confirmed = await Modal.confirm({
        title: '⚠️ Advertencia de Restauración',
        message: '¿Estás REALMENTE seguro? Esta acción borrará TODO tu estado actual (empleados, posiciones y asistencia) para reemplazarlo por los datos de esta captura. No hay vuelta atrás.',
        confirmText: 'Sí, Sobreiscribir Todo',
        cancelText: 'Cancelar',
        type: 'danger'
    });

    if (!confirmed) return;

    try {
        state.isLoadingSnapshots = true;
        render();
        Notification.info('⏳ Restaurando sistema...', 0);

        const snapshot = await FirebaseService.getSnapshot(snapshotId);

        if (!snapshot || !snapshot.state) {
            throw new Error('El snapshot está vacío o corrupto');
        }

        // Aplicar datos al estado global
        state.employees = snapshot.state.employees || [];
        state.positions = snapshot.state.positions || [];
        state.attendance = snapshot.state.attendance || {};

        // Mezclar settings con precaución (mantener flags de sesión si existen)
        if (snapshot.state.settings) {
            state.settings = { ...state.settings, ...snapshot.state.settings };
        }


        // Persistencia crítica: IndexedDB y Mirror
        await saveApplicationData();

        Notification.clearAll();
        Notification.success('✅ Sistema restaurado con éxito', 5000);

        state.isLoadingSnapshots = false;
        render();

    } catch (e) {
        console.error('Error fatal en restauración:', e);
        Notification.error('❌ Error al restaurar: ' + e.message);
        state.isLoadingSnapshots = false;
        render();
    }
};


window.changeDate = async (days) => {
    window.showLoader?.(true);

    // Delay de 50ms para asegurar que el navegador pinte el loader antes del bloqueo de JS
    setTimeout(() => {
        // Si estamos en vista semanal, cambiar por semanas completas (7 días)
        if (state.viewMode === 'week') {
            state.selectedDate = DateUtils.addDays(state.selectedDate, days * 7);
        } else {
            state.selectedDate = DateUtils.addDays(state.selectedDate, days);
        }

        // ✅ Guardar cambios
        saveApplicationData();

        // ⚡ OPTIMIZACIÓN ZONAL: Actualizar suscripción por rango
        window.updateAttendanceSubscription?.();

        render();
        
        // Liberar bloqueo tras el renderizado
        window._isNavigating = false;
        window.hideLoader?.();
    });
};

window.goToToday = () => {
    window.showLoader?.(true);

    setTimeout(() => {
        state.selectedDate = DateUtils.today();
        state.today = DateUtils.today(); // Actualizar today también

        // ✅ Guardar cambios
        saveApplicationData();

        // ⚡ OPTIMIZACIÓN ZONAL: Actualizar suscripción por rango
        window.updateAttendanceSubscription?.();

        render();
        
        // Liberar bloqueo tras el renderizado
        window._isNavigating = false;
        window.hideLoader?.();
    });
};

window.changeViewMode = (mode) => {
    window.showLoader?.(true);

    // Mayor delay para asegurar persistencia visual antes del bloqueo
    setTimeout(() => {
        debug.log('⚡ Iniciando cambio de vista pesado...');
        state.viewMode = mode;
        state.isScrolled = false; // Resetear scroll al cambiar de vista

        // ✅ Guardar cambios
        saveApplicationData();

        // ⚡ OPTIMIZACIÓN ZONAL: Actualizar suscripción por rango
        window.updateAttendanceSubscription?.();

        render();

        // Liberar bloqueo tras el renderizado final para que el loader pueda ocultarse
        window._isNavigating = false;
        window.hideLoader?.();
    }, 150);
};

window.showDatePicker = (target = 'full') => window.toggleDatePicker(target);
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

// Eliminado el DatePicker duplicado y movido al inicio del archivo para consolidación.

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

    // ⚡ OPTIMIZACIÓN ZONAL: Actualizar suscripción por rango
    window.updateAttendanceSubscription?.();

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
            isHoliday: isDayHoliday(date, state.settings.holidays),
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

    // ✅ Guardar cambios con dateKey para sync granular
    saveApplicationData({ dateKey: getDateKey(date) });

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
        debug.log('⚡⚡⚡ Ultra-selective render: checkbox only');
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
            badgeContent += `<span style="margin-left: 4px; display: inline-flex; vertical-align: middle;" aria-label="Tiene nota" title="${att.notes.replace(/"/g, '&quot;')}">${icons.get('file', { size: 12 })}</span>`;
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
                        <button type="button" data-app-fn="openAdvancedAttendance" data-arg="${empId}" data-app-stop="1"
                                style="width: 40px; height: 40px; border-radius: 8px; background: #1e293b; border: 2px solid #334155; color: #06b6d4; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center;"
                                onmouseover="this.style.borderColor='#06b6d4'; this.style.background='rgba(6, 182, 212, 0.1)'"
                                onmouseout="this.style.borderColor='#334155'; this.style.background='#1e293b'"
                                aria-label="Agregar otra posición o modificar horas">
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
        att.updatedAt = Date.now();
        
        // ✅ Sincronizar con la base de datos (Zonal Sync)
        saveApplicationData({ dateKey: getDateKey(state.selectedDate) });
        
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
// Handlers de Tarjeta Flotante movidos a EmployeesUI.js y delegados a EmployeeFloatingCard.js
window.changeChartPeriod = (period) => { state.chartPeriod = period; render(); };

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE PROFILE handlers — moved to js/modules/features/profile/ in Sprint 6.
// closeEmployeeProfile, changeProfileTab, toggle/select/change Start/End/HireDate
// pickers, setProfilePeriod, togglePositionBreakdown, markAsPaid and the
// syncProfileToMaster helper all live there now and are exposed on window.*
// via registerProfileGlobals() at the bottom of this file.
//
// The deduction/bonus/advance editing handlers below (addDeduction, etc.)
// stay in app.js for now — they edit payroll math, not modal state. They
// belong to a future PayrollUI extraction.
// ═══════════════════════════════════════════════════════════════


window.addDeduction = () => {
    if (!state.employeeProfile.deductions) state.employeeProfile.deductions = [];

    const defaultPercentage = state.settings.defaultDeductionPercentage || 2;
    state.employeeProfile.deductions.push({
        id: `DED-${Date.now()}`,
        type: 'percentage',
        value: defaultPercentage
    });

    syncProfileToMaster(state.employeeProfile.employeeId);
    updatePayrollUI();
};

window.removeDeduction = (index) => {
    state.employeeProfile.deductions.splice(index, 1);
    syncProfileToMaster(state.employeeProfile.employeeId);
    updatePayrollUI();
};

window.updateDeductionType = (index, type) => {
    if (state.employeeProfile.deductions[index]) {
        state.employeeProfile.deductions[index].type = type;
        syncProfileToMaster(state.employeeProfile.employeeId);
        updatePayrollUI();
    }
};

window.updateDeductionValue = (index, value) => {
    if (state.employeeProfile.deductions[index]) {
        state.employeeProfile.deductions[index].value = parseFloat(value) || 0;
        syncProfileToMaster(state.employeeProfile.employeeId);
        updatePayrollUI();
    }
};

// 🎁 SISTEMA DE BONIFICACIONES / PAGOS
window.addBonus = () => {
    if (!state.employeeProfile.bonuses) state.employeeProfile.bonuses = [];

    state.employeeProfile.bonuses.push({
        id: `BON-${Date.now()}`,
        type: 'fixed',
        value: 0
    });

    syncProfileToMaster(state.employeeProfile.employeeId);
    updatePayrollUI();
};

window.removeBonus = (index) => {
    state.employeeProfile.bonuses.splice(index, 1);
    syncProfileToMaster(state.employeeProfile.employeeId);
    updatePayrollUI();
};

window.updateBonusType = (index, type) => {
    if (state.employeeProfile.bonuses[index]) {
        state.employeeProfile.bonuses[index].type = type;
        syncProfileToMaster(state.employeeProfile.employeeId);
        updatePayrollUI();
    }
};

window.updateBonusValue = (index, value) => {
    if (state.employeeProfile.bonuses[index]) {
        state.employeeProfile.bonuses[index].value = parseFloat(value) || 0;
        syncProfileToMaster(state.employeeProfile.employeeId);
        updatePayrollUI();
    }
};

// 📡 Event Listener para actualización de nómina post-render
eventBus.on('render:complete', () => {
    if (state.showEmployeeProfile && state.employeeProfile.activeTab === 'nomina') {
        updatePayrollSectionsTrigger();
    }
});

// 💵 SISTEMA DE ADELANTOS / PRÉSTAMOS
window.addAdvance = () => {
    if (!state.employeeProfile.advances) state.employeeProfile.advances = [];

    state.employeeProfile.advances.push({
        id: `ADV-${Date.now()}`,
        amount: 0,
        date: getDateKey(new Date()),
        interest: 0,
        note: ''
    });

    syncProfileToMaster(state.employeeProfile.employeeId);
    updatePayrollUI();
};

window.removeAdvance = (index) => {
    state.employeeProfile.advances.splice(index, 1);
    syncProfileToMaster(state.employeeProfile.employeeId);
    updatePayrollUI();
};

window.updateAdvanceValue = (index, amount) => {
    if (state.employeeProfile.advances[index]) {
        state.employeeProfile.advances[index].amount = parseFloat(amount) || 0;
        syncAdvancesAndSave(); // ⚡ Auto-save
        updatePayrollUI();
    }
};

window.updateAdvanceDate = (index, date) => {
    if (state.employeeProfile.advances[index]) {
        state.employeeProfile.advances[index].date = date;
        syncAdvancesAndSave(); // ⚡ Auto-save
        updatePayrollUI();
    }
};

window.updateAdvanceInterest = (index, interest) => {
    if (state.employeeProfile.advances[index]) {
        state.employeeProfile.advances[index].interest = parseFloat(interest) || 0;
        syncAdvancesAndSave(); // ⚡ Auto-save
        updatePayrollUI();
    }
};

window.updateAdvanceNote = (index, note) => {
    if (state.employeeProfile.advances[index]) {
        state.employeeProfile.advances[index].note = note;
        syncAdvancesAndSave(); // ⚡ Auto-save
        updatePayrollUI();
    }
};

window.saveAdvance = (index) => {
    syncAdvancesAndSave();
    showNotification('✅ Adelanto guardado correctamente', 'success');
};

/**
 * ⚡ Sincroniza adelantos del perfil al empleado y guarda en DB
 */
function syncAdvancesAndSave() {
    syncProfileToMaster(state.employeeProfile.employeeId);
}

// ⚡ NUEVO: Función principal para actualizar toda la interfaz de nómina
function updatePayrollUI(payrollOverride = null) {
    if (!state.showEmployeeProfile || state.employeeProfile.activeTab !== 'nomina') return;
    
    const empId = state.employeeProfile.employeeId;
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return;

    // Usar payroll pasado o recalcular si es necesario
    const payroll = payrollOverride || payrollService.calculateEmployeePayroll(
        empId,
        state.employeeProfile.periodStart,
        state.employeeProfile.periodEnd
    );

    // 1. Actualizar contenedores HTML si existen
    const sections = {
        '#deductions-section': generateDeductionsHTML,
        '#bonuses-section': generateBonusesHTML,
        '#advances-section': generateAdvancesHTML
    };

    Object.entries(sections).forEach(([selector, generator]) => {
        const container = document.querySelector(selector);
        if (container) container.innerHTML = generator(payroll);
    });

    // 2. Actualizar tarjetas de resumen en el modal
    const summaryMap = {
        '.profile-gross-card .profile-earnings-val': formatCurrency(payroll.brutoOriginal),
        '.profile-bonus-card .profile-earnings-val': `+${formatCurrency(payroll.bonuses)}`,
        '.profile-deduction-card .profile-earnings-val': `-${formatCurrency(payroll.deductions)}`,
        '.profile-advance-card .profile-earnings-val': `-${formatCurrency(payroll.advances)}`,
        '.profile-net-card .profile-earnings-val': formatCurrency(payroll.neto)
    };

    Object.entries(summaryMap).forEach(([selector, value]) => {
        const el = document.querySelector(selector);
        if (el) el.innerHTML = value;
    });

    // Caso especial para el neto si el selector anterior falla
    const backupNet = document.querySelector('[style*="color: #10b981"][style*="font-size: 2.2rem"]');
    if (backupNet && !document.querySelector('.profile-net-card')) {
        backupNet.innerHTML = formatCurrency(payroll.neto);
    }
}
window.updatePayrollUI = updatePayrollUI;

// ⚠️ Mantener alias por compatibilidad temporal con eventos inline
window.updateDeductionsSection = updatePayrollUI;

function updatePayrollSectionsTrigger() {
    updatePayrollUI();
}
window.updatePayrollSectionsTrigger = updatePayrollSectionsTrigger;

// ⚡ NUEVO: Generar HTML de deducciones (separado para reusabilidad)
function generateDeductionsHTML(payroll) {
    return `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4;">
                        💸 DEDUCCIONES
                    </div>
                    <button type="button" data-app-fn="addDeduction" 
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
                                <input type="number" inputmode="decimal" autocomplete="off" 
                                       class="form-input" 
                                       value="${ded.value.toFixed(2)}" 
                                       onchange="updateDeductionValue(${index}, this.value)"
                                       placeholder="0.00"
                                       min="0"
                                       step="${ded.type === 'fixed' ? '0.01' : '0.1'}"
                                       style="width: 100%; font-size: 0.875rem; padding: 8px;">
                            </div>
                            
                            <!-- Botón eliminar (siempre visible ahora) -->
                            <button type="button" data-app-fn="removeDeduction" data-arg="${index}" aria-label="Eliminar deducción"
                                    style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: all 0.2s;"
                                    onmouseover="this.style.background='#dc2626'"
                                    onmouseout="this.style.background='#ef4444'">
                                🗑️
                            </button>
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

// 🎁 SISTEMA DE BONIFICACIONES / PAGOS (AUX)
function generateBonusesHTML(payroll) {
    return `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #10b981; display: inline-flex; align-items: center; gap: 6px;">
                        ${icons.get('star', { size: 14 })} PAGOS / BONIFICACIONES
                    </div>
                    <button type="button" data-app-fn="addBonus"
                            style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.transform='scale(1.05)'"
                            onmouseout="this.style.transform='scale(1)'">
                        +
                    </button>
                </div>
                
                ${payroll.bonusBreakdown && payroll.bonusBreakdown.length > 0 ? payroll.bonusBreakdown.map((bon, index) => `
                    <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 12px;">
                        <div style="display: flex; gap: 12px; align-items: start;">
                            <div style="flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px;">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                                    <input type="radio" name="bonusType_${index}" value="fixed" ${bon.type === 'fixed' ? 'checked' : ''} onchange="updateBonusType(${index}, 'fixed')" style="accent-color: #10b981;">
                                    <span style="color: #f1f5f9;">Monto</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                                    <input type="radio" name="bonusType_${index}" value="percentage" ${bon.type === 'percentage' ? 'checked' : ''} onchange="updateBonusType(${index}, 'percentage')" style="accent-color: #10b981;">
                                    <span style="color: #f1f5f9;">%</span>
                                </label>
                            </div>
                            <div style="flex: 1;">
                                <input type="number" inputmode="decimal" autocomplete="off" class="form-input" value="${parseFloat(bon.value).toFixed(2)}" onchange="updateBonusValue(${index}, this.value)" style="width: 100%; font-size: 0.875rem; padding: 8px;">
                            </div>
                            <button type="button" data-app-fn="removeBonus" data-arg="${index}" aria-label="Eliminar bono" style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer;">${icons.get('delete', { size: 14 })}</button>
                        </div>
                    </div>
                `).join('') : '<div style="text-align: center; color: #64748b; padding: 20px;">No hay bonificaciones</div>'}
                
                <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; margin-top: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.875rem; color: #94a3b8;">Total:</span>
                        <span style="font-size: 1.125rem; font-weight: 700; color: #10b981;">+${formatCurrency(payroll.bonuses)}</span>
                    </div>
                </div>
    `;
}

function generateAdvancesHTML(payroll) {
    const advances = state.employeeProfile.advances || [];
    const totalAdvancesAccumulated = advances.reduce((sum, adv) => {
        const amount = parseFloat(adv.amount) || 0;
        const interest = parseFloat(adv.interest) || 0;
        return sum + (amount + (amount * interest / 100));
    }, 0);

    return `
        <div class="advances-section-wrapper" style="background: #1e293b; padding: 24px; border-radius: 16px; border: 1px solid #334155;">
            <!-- Header Refinado -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 40px; height: 40px; background: rgba(245, 158, 11, 0.1); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #f59e0b;">
                        ${icons.get('payroll', { size: 20 })}
                    </div>
                    <div>
                        <div style="font-size: 0.9rem; font-weight: 950; color: #f1f5f9; text-transform: uppercase; letter-spacing: 0.05em;">
                            Adelantos y Préstamos
                        </div>
                        <div style="font-size: 0.75rem; color: #64748b; font-weight: 500;">
                            ${advances.length} registros en este periodo
                        </div>
                    </div>
                </div>
                <button type="button" data-app-fn="addAdvance"
                        class="btn-add-advance"
                        style="background: #f59e0b; color: #0f172a; border: none; padding: 10px 18px; border-radius: 10px; font-weight: 900; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s;"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(245, 158, 11, 0.3)'"
                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                    ${icons.get('add', { size: 16 })} Nuevo Registro
                </button>
            </div>
            
            <div class="advances-container">
                ${advances.length > 0 ? advances.map((adv, index) => {
                    const isEditing = state.employeeProfile.editingAdvances && state.employeeProfile.editingAdvances[index];
                    const amount = parseFloat(adv.amount) || 0;
                    const interest = parseFloat(adv.interest) || 0;
                    const interestAmount = (amount * interest / 100);
                    const total = amount + interestAmount;

                    if (!isEditing) {
                        // 📏 VISTA REDUCIDA (Fila Dual-Layer)
                        const dateObj = new Date(adv.date + 'T00:00:00');
                        const day = dateObj.getDate();
                        const month = dateObj.toLocaleString('es-ES', { month: 'short' }).replace('.', '');
                        const dateLabel = `${day}-${month.charAt(0).toUpperCase() + month.slice(1)}`;

                        return `
                        <div class="advance-row-reduced" role="button" tabindex="0" data-app-fn="editAdvance" data-arg="${index}">
                            <div class="advance-reduced-main">
                                <div class="advance-reduced-data">
                                    <span class="advance-reduced-date">${dateLabel}</span>
                                    <span class="advance-reduced-amount">${formatCurrency(total)}</span>
                                    <span class="advance-reduced-interest">(${interest}%)</span>
                                </div>
                                <div class="advance-actions">
                                    <button type="button" data-app-fn="editAdvance" data-arg="${index}" data-app-stop="1" aria-label="Editar adelanto"
                                            class="btn-edit-advance" aria-label="Editar adelanto">
                                        ${icons.get('edit', { size: 14 })}
                                    </button>
                                    <button type="button" data-app-fn="removeAdvance" data-arg="${index}" data-app-stop="1" aria-label="Eliminar adelanto"
                                            class="btn-delete-advance" style="width: 28px; height: 28px;" aria-label="Eliminar adelanto">
                                        ${icons.get('delete', { size: 14 })}
                                    </button>
                                </div>
                            </div>
                            <div class="advance-reduced-note">
                                ${adv.note || 'Sin concepto'}
                            </div>
                        </div>
                        `;
                    }
                    
                    return `
                    <div class="advance-card">
                        <!-- Fila 1: Inputs Principales -->
                        <div class="advance-row-inputs">
                            <div class="advance-input-group">
                                <label>Monto Capital</label>
                                <input type="number" inputmode="decimal" autocomplete="off" value="${adv.amount}" 
                                       onchange="updateAdvanceValue(${index}, this.value)" 
                                       placeholder="0.00">
                            </div>
                            <div class="advance-input-group">
                                <label>Interés (%)</label>
                                <input type="number" inputmode="decimal" autocomplete="off" value="${adv.interest || 0}" 
                                       onchange="updateAdvanceInterest(${index}, this.value)" 
                                       placeholder="0%">
                            </div>
                            <div class="advance-input-group">
                                <label>Fecha</label>
                                <input type="date" value="${adv.date}" 
                                       onchange="updateAdvanceDate(${index}, this.value)">
                            </div>
                        </div>

                        <!-- Fila 2: Nota / Concepto -->
                        <div class="advance-row-note">
                            <input type="text" value="${adv.note || ''}" 
                                   placeholder="Añadir una nota o concepto del préstamo..." 
                                   onchange="updateAdvanceNote(${index}, this.value)">
                        </div>

                        <!-- Fila 3: Matemática Visual y Acción -->
                        <div class="advance-row-math">
                            <div class="advance-math-text">
                                <span>${formatCurrency(amount)}</span>
                                <span style="margin: 0 8px; opacity: 0.5;">+</span>
                                <span>${formatCurrency(interestAmount)} <small>(${interest}%)</small></span>
                                <span style="margin: 0 12px; font-weight: 900; color: #f59e0b;">=</span>
                                <strong class="advance-math-total">${formatCurrency(total)}</strong>
                            </div>
                            <div class="advance-actions">
                                <button type="button" data-app-fn="saveAdvance" data-arg="${index}" aria-label="Guardar adelanto"
                                        class="btn-save-advance"
                                        aria-label="Guardar cambios">
                                    ${icons.get('check', { size: 16 })}
                                </button>
                                <button type="button" data-app-fn="removeAdvance" data-arg="${index}" aria-label="Eliminar adelanto"
                                        class="btn-delete-advance"
                                        aria-label="Eliminar registro">
                                    ${icons.get('delete', { size: 16 })}
                                </button>
                            </div>
                        </div>
                    </div>
                `}).join('') : `
                    <div style="text-align: center; padding: 40px 20px; background: rgba(15, 23, 42, 0.3); border: 1px dashed #334155; border-radius: 14px;">
                        <div style="font-size: 2rem; margin-bottom: 12px; opacity: 0.5;">🏦</div>
                        <div style="color: #64748b; font-size: 0.9rem; font-weight: 500;">No hay adelantos o préstamos registrados</div>
                        <div style="color: #475569; font-size: 0.75rem; margin-top: 4px;">Usa el botón superior para crear uno nuevo</div>
                    </div>
                `}
            </div>

            <!-- Resumen de Sección -->
            <div style="margin-top: 24px; padding-top: 20px; border-top: 2px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                    Total Acumulado
                </span>
                <span style="font-size: 1.4rem; font-weight: 950; color: #f59e0b;">
                    ${formatCurrency(totalAdvancesAccumulated)}
                </span>
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
                    <button type="button" data-app-fn="addExportDeduction"
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


window.openQuickEdit = (empId, dateStr) => {
    state.selectedDate = parseDate(dateStr);
    modalManager.openAdvanced(empId, false);
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
// [REMOVED] saveAdvancedAttendance -> AdvancedAttendanceModal.js

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
            isHoliday: isDayHoliday(date, state.settings.holidays)
        });

        // 🔥 Unificación: Usar horas configuradas para el día, o el default
        const hours = (state.dayHoursConfig && state.dayHoursConfig[dateStr]) || (state.settings?.regularHoursPerDay || 8);

        // Crear registro de asistencia
        const newAttendance = {
            employeeId: empId,
            date: dateStr,
            present: true,
            hoursWorked: hours,
            overtimeHours: 0,
            isHoliday: isDayHoliday(date, state.settings.holidays),
            useTempPosition: false,
            notes: '',
            multiPosition: emp.positions?.length > 1,
            positionHours: emp.positions?.length > 0 ?
                [{ positionId: emp.positions[0], hours: hours }] :
                [],
            selectedPosition: emp.positions?.[0] || null,
            updatedAt: Date.now()
        };

        debug.log('⚡ Asistencia creada con', hours, 'horas (vista semanal)');

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

        saveApplicationData({ dateKey: dateStr });

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

    saveApplicationData({ dateKey: dateStr });
    render();
};
// Redefinición de markDayAsHoliday eliminada


// ═══ Marcadores de fechas de pago ═══
window.toggleLegend = () => { state.showLegend = !state.showLegend; render(); };
window.setEmployeeFilter = (filter) => {
    // Si se hace click en el filtro ya activo, desactivarlo
    state.employeeFilter = state.employeeFilter === filter ? null : filter;
    render();
};

// ═══════════════════════════════════════════════════════════
// FUNCIONES DE NUBE (Firebase)
// ═══════════════════════════════════════════════════════════

window.uploadToCloud = async function () {
    const loading = showNotification('📤 Sincronizando historial...', 'loading');
    try {
        await FirebaseService.syncHistory(state.attendance);
        await FirebaseService.saveFullState(state);
        showNotification('✅ Historial y estado sincronizados', 'success');
    } catch (e) {
        console.error('Error al subir a la nube:', e);
        showNotification('❌ Error al sincronizar historial', 'error');
    } finally {
        loading.close();
    }
};

window.downloadFromCloud = async function () {
    const confirm = await Modal.confirm({
        title: 'Descargar de la nube',
        message: '¿Descargar datos de la nube? Esto fusionará los datos remotos con los locales.',
        confirmText: 'Descargar',
        cancelText: 'Cancelar'
    });
    if (!confirm) return;

    const loading = showNotification('📥 Descargando datos...', 'loading');
    try {
        const remoteState = await FirebaseService.getFullState();
        if (remoteState) {
            // Fusión simple de metadatos (evitar duplicados por ID)
            const dedup = (arr) => arr ? [...new Map(arr.map(item => [item.id, item])).values()] : [];
            state.employees = dedup([...state.employees, ...(remoteState.employees || [])]);
            state.positions = dedup([...state.positions, ...(remoteState.positions || [])]);
            state.leaders = dedup([...state.leaders, ...(remoteState.leaders || [])]);

            // Cargar historial completo
            const remoteAttendance = await FirebaseService.getAllAttendance();
            state.attendance = { ...state.attendance, ...remoteAttendance };

            render();
            await saveApplicationData();
            showNotification('✅ Datos descargados y fusionados', 'success');
        } else {
            showNotification('ℹ️ No hay datos en la nube para descargar', 'info');
        }
    } catch (e) {
        console.error('Error al descargar de la nube:', e);
        showNotification('❌ Error al descargar datos', 'error');
    } finally {
        loading.close();
    }
};

window.deleteCloudDataNow = async function () {
    const confirm = await Modal.confirm({
        title: '⚠️ Eliminar datos de la nube',
        message: '¿ELIMINAR TODOS los datos de la nube? Esta acción no se puede deshacer y NO afectará tus datos locales.',
        confirmText: 'Eliminar nube',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!confirm) return;

    const loading = showNotification('🗑️ Eliminando datos remotos...', 'loading');
    try {
        await FirebaseService.deleteCloudData();
        showNotification('✅ Datos remotos eliminados de Firebase', 'success');
    } catch (e) {
        console.error('Error al eliminar datos:', e);
        showNotification('❌ Error al eliminar datos remotos', 'error');
    } finally {
        loading.close();
    }
};

window.manualSync = window.uploadToCloud;
window.toggleAutoSync = () => {
    // Firebase usa tiempo real por defecto, no necesita toggle manual para on/off
    showNotification('💡 Firebase sincroniza automáticamente en tiempo real', 'info');
};

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


// Notes Center handlers moved to js/modules/features/notes/NotesController.js (Sprint 3).
// They are still exposed on window.* via registerNotesGlobals() below for
// compatibility with the legacy data-app-fn event delegation.
registerNotesGlobals();
registerExportGlobals();
registerProfileGlobals();

// Expose payroll-section HTML generators on window so the Profile module can
// call into them without circular imports. These generators stay in app.js
// because they're tightly coupled to ~30 deduction/bonus/advance handlers
// that aren't part of Sprint 6's scope.
window.generateDeductionsHTML = generateDeductionsHTML;
window.generateBonusesHTML = generateBonusesHTML;
window.generateAdvancesHTML = generateAdvancesHTML;


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

// ✅ wasEmployeeActiveOnDate migrado a js/modules/utils/DateUtils.js

// ✅ wasEmployeeActiveInRange migrado a js/modules/utils/DateUtils.js

// Funciones de posiciones y estados movidas a EmployeesUI.js

// Funciones de posiciones y estados se manejan ahora íntegramente en EmployeesUI.js


document.addEventListener('click', (e) => {
    // Cerrar context menu si clic fuera, PERO no si el clic fue sobre el checkbox
    // que lo abre (el handler del checkbox necesita poder establecer state.contextMenu
    // sin que este listener lo cierre inmediatamente — antes del refactor a event
    // delegation, esto se evitaba con stopPropagation en el onclick inline).
    if (state.contextMenu
        && !e.target.closest('.context-menu')
        && !e.target.closest('.check-container')
        && !e.target.closest('.week-check-wrapper')) {
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
    return SyncUI.SyncIndicator();
}

// UI Components


function BottomNavigation() {
    return `<nav class="bottom-nav glass-effect">
                <button class="bottom-nav-tab ${state.activeTab === 'attendance' ? 'active' : ''}" 
                        type="button" data-app-fn="changeTab" data-arg="attendance"
                        title="Registrar asistencia diaria">
                    <span class="bottom-nav-icon">${icons.get('attendance')}</span>
                    <span class="bottom-nav-text">Asistencia</span>
                </button>
                <button class="bottom-nav-tab ${state.activeTab === 'employees' || state.activeTab === 'positions' ? 'active' : ''}" 
                        type="button" data-app-fn="changeTab" data-arg="employees"
                        title="Gestionar empleados y posiciones">
                    <span class="bottom-nav-icon">${icons.get('personnel')}</span>
                    <span class="bottom-nav-text">Personal</span>
                </button>
                <button class="bottom-nav-tab ${state.activeTab === 'employee-report' || state.activeTab === 'dashboard' ? 'active' : ''}" 
                        type="button" data-app-fn="changeTab" data-arg="employee-report"
                        title="Ver reportes y estadísticas">
                    <span class="bottom-nav-icon">${icons.get('reports')}</span>
                    <span class="bottom-nav-text">Reportes</span>
                </button>
                <button class="bottom-nav-tab ${state.activeTab === 'export' ? 'active' : ''}" 
                        type="button" data-app-fn="changeTab" data-arg="export"
                        title="Nómina">
                    <span class="bottom-nav-icon">${icons.get('payroll')}</span>
                    <span class="bottom-nav-text">Nómina</span>
                </button>
                <button class="bottom-nav-tab ${state.activeTab === 'settings' ? 'active' : ''}" 
                        type="button" data-app-fn="changeTab" data-arg="settings"
                        title="Configuración del sistema">
                    <span class="bottom-nav-icon">${icons.get('settings')}</span>
                    <span class="bottom-nav-text">Ajustes</span>
                </button>
            </nav>`;
}

// ⚡ Los componentes UI (StatsGrid, Legend, PositionFilters, EmployeeRow, DateControls, DateControlsCompact, DayView, WeekView, etc.)
// han sido movidos a ./modules/ui/AttendanceUI.js para mejor mantenimiento.

// ============================================
// 📊 REPORTES Y ESTADÍSTICAS — (Refactorizados)
// ============================================

// ============================================
// LEGACY EMPLOYEES UI — Removed (now in EmployeesUI.js)
// ============================================

// [LEGACY REMOVED] EmployeesTab, EmployeeCard, LeaderCard, PositionsTab, PositionCard -> EmployeesUI.js

/**
 * 📏 Fila de Empleado para Vista Semanal
 */
// ⚡ WeekRow movido a AttendanceUI.js

/**
 * ⚡ OPTIMIZACIÓN ZONAL: Actualizar solo una fila de empleado en DayView
 */
window.updateEmployeeRow = function (employeeId) {
    const rowEl = document.getElementById(`emp-row-${employeeId}`);
    if (!rowEl) return;

    const emp = state.employees.find(e => e.id === employeeId);
    if (!emp) return;

    // Generar el HTML de la fila (respetando el modo de visualización)
    const newHTML = state.listDisplayMode === 'compact' ? EmployeeRowCompact(emp) : EmployeeRow(emp);

    // Usar DOMDiff para actualizar solo lo necesario del DOM real
    if (DOMDiff && typeof DOMDiff.apply === 'function') {
        DOMDiff.apply(rowEl, newHTML);
    } else {
        rowEl.outerHTML = newHTML;
    }
};

/**
 * ⚡ OPTIMIZACIÓN ZONAL: Actualizar solo una fila de empleado en WeekView
 */
window.updateWeekRow = function (employeeId) {
    const rowEl = document.getElementById(`week-row-${employeeId}`);
    if (!rowEl) return;

    const emp = state.employees.find(e => e.id === employeeId);
    if (!emp) return;

    const week = getWeekDates(new Date(state.selectedDate));
    const newHTML = WeekRow(emp, week);

    if (DOMDiff && typeof DOMDiff.apply === 'function') {
        DOMDiff.apply(rowEl, newHTML);
    } else {
        rowEl.outerHTML = newHTML;
    }

    // También actualizar totales si es necesario
    window.updateWeekTotals?.();
};

/**
 * ⚡ OPTIMIZACIÓN ZONAL: Actualizar fila de totales en WeekView
 */
window.updateWeekTotals = function () {
    const totalsEl = document.getElementById('week-totals-row');
    if (!totalsEl) return;

    const week = getWeekDates(new Date(state.selectedDate));
    const newHTML = `
        <tr id="week-totals-row" style="background: linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(16, 185, 129, 0.1)); border-top: 2px solid #06b6d4;">
            <td style="padding: 12px 16px;">
                <div style="font-weight: 700; color: #06b6d4; font-size: 0.875rem;">TOTALES</div>
            </td>
            ${week.map(date => {
        const dKey = getDateKey(date);
        // ⚡ P3-OPT: Lookup O(1) en lugar de filter O(N)
        const dayAttendance = (state.attendanceByDate[dKey] || []).filter(a => a.present);
        const totalH = dayAttendance.reduce((sum, a) => sum + (a.hoursWorked || 0), 0);
        const count = dayAttendance.length;

        return `
                    <td style="text-align: center; padding: 12px 8px;">
                        <div style="color: #06b6d4; font-weight: 700; font-size: 1rem; margin-bottom: 4px;">${count}</div>
                        <div style="font-size: 0.7rem; color: #94a3b8;">${totalH.toFixed(1)}h</div>
                    </td>
                `;
    }).join('')}
        </tr>
    `;

    if (DOMDiff && typeof DOMDiff.apply === 'function') {
        DOMDiff.apply(totalsEl, newHTML);
    } else {
        totalsEl.outerHTML = newHTML;
    }
};
window.setSearchFilter = debounce((value) => {
    state.filters.search = value.trim().toLowerCase();

    // El sistema de RenderManager.render() ya se encarga de preservar el foco 
    // y usar DOMDiff para que el filtrado sea instantáneo y sin parpadeos.
    render();
}, 300);

window.toggleListDisplayMode = () => {
    state.listDisplayMode = state.listDisplayMode === 'relaxed' ? 'compact' : 'relaxed';
    render();
};

function DisplayModeFloatingToggle() {
    if (state.activeTab !== 'attendance') return '';

    return `
        <div class="floating-display-toggle glass-effect"
             role="button" tabindex="0"
             data-app-fn="toggleListDisplayMode"
             aria-label="Cambiar densidad de lista (${state.listDisplayMode === 'compact' ? 'Relajada' : 'Compacta'})">
            ${state.listDisplayMode === 'compact' ? '▤' : '⬛'}
        </div>
    `;
}

function AttendanceTab() {
    return `
        ${DateControls()}
        ${DateControlsCompact()}
        ${state.viewMode === 'day' ? DayView() : WeekView()}
    `;
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

    // 💰 Día de pago del período actual
    const pp = state.settings?.payPeriod;
    if (pp?.payDay === dateKey) {
        markers.push('💰');
    }

    if (markers.length === 0) return '';

    return `<div class="calendar-day-markers" style="position:absolute; bottom:2px; left:50%; transform:translateX(-50%); display:flex; gap:1px; font-size:0.6rem; line-height:1;">${markers.join('')}</div>`;
}

//fraficos de barras
/*const GraficosDeBarra = `            <div class="chart-compact">
                <div class="chart-compact-header">
                    <div class="chart-compact-title">📈 ${state.chartPeriod === 'all' ? 'Historial por Meses' : 'Asistencia y Horas'}</div>
                    <div class="chart-filter">
                        <button type="button" class="chart-filter-btn ${state.chartPeriod === 'week' ? 'active' : ''}" data-app-fn="changeChartPeriod" data-arg="week">7D</button>
                        <button type="button" class="chart-filter-btn ${state.chartPeriod === 'month' ? 'active' : ''}" data-app-fn="changeChartPeriod" data-arg="month">Mes</button>
                        <button type="button" class="chart-filter-btn ${state.chartPeriod === 'all' ? 'active' : ''}" data-app-fn="changeChartPeriod" data-arg="all">Todo</button>
                    </div>
                </div>
                <div class="chart-bars">
                    ${chartData.map(d => {
    const tot = (d.regular + d.overtime + d.holiday + d.absent) * scale;
    const rH = d.regular * scale;
    const oH = d.overtime * scale;
    const hH = d.holiday * scale;
    const aH = d.absent * scale;
    return `<div class="chart-bar-wrapper">
                            <div class="chart-bar" style="height:${Math.max(tot, 10)}px;">
                                ${d.absent > 0 ? `<div class="chart-segment absent" style="height:${aH}px;"></div>` : ''}
                                ${d.regular > 0 ? `<div class="chart-segment regular" style="height:${rH}px;"></div>` : ''}
                                ${d.overtime > 0 ? `<div class="chart-segment overtime" style="height:${oH}px;"></div>` : ''}
                                ${d.holiday > 0 ? `<div class="chart-segment holiday" style="height:${hH}px;"></div>` : ''}
                            </div>
                            <div class="chart-bar-label">${d.label || `${d.date.getDate()}/${d.date.getMonth() + 1}`}</div>
                        </div>`;
}).join('')}
                </div>
            </div>`;
*/

// La función FloatingCard() ha sido movida a js/modules/ui/components/EmployeeFloatingCard.js


// ============================================
// MODALS — Modularizados (Alpha Refactorizer)
// ============================================


// ============================================
// SETTINGS TAB — Delegado a SettingsUI.js
// ============================================

function SettingsTab() {
    return SettingsTabUI();
}

function SyncCard(status) {
    return SyncCardUI(status);
}



// Funciones para Settings
window.changeSettingsCalendarMonth = function (delta) {
    holidayService.changeCalendarMonth(delta);
    render();
};

// window.toggleHoliday eliminado (ahora en AttendanceHandlers.js)


// ═══ SISTEMA DE TOGGLE BUTTONS PARA CALENDARIO ═══
window.handleCalendarDayClick = function (dateKey) {
    holidayService.handleCalendarDayClick(dateKey, () => saveApplicationData());
    render();
};

// Cambiar modo de marcador activo en Calendario de Ajustes
window.changeSettingsCalendarMode = function (mode) {
    holidayService.state.settingsCalendarMode = mode;
    render();
};


// ============================================
// ============================================
// GESTIÓN DEL PERÍODO DE PAGO UNIFICADO
// ============================================

window.updatePayPeriod = function (field, value) {
    if (!state.settings.payPeriod) {
        state.settings.payPeriod = { periodStart: null, periodLength: 21, payDay: null };
    }
    if (field === 'periodLength') {
        const num = parseInt(value);
        if (!isNaN(num) && num >= 1 && num <= 60) {
            state.settings.payPeriod.periodLength = num;
        }
    } else if (field === 'periodStart' || field === 'payDay') {
        state.settings.payPeriod[field] = value || null;
    }
    saveApplicationData();
    render();
};

window.advancePayPeriod = function () {
    const pp = state.settings.payPeriod;
    if (!pp?.periodStart || !pp?.periodLength) {
        showNotification('❌ Configura el inicio y duración del período primero', 'error');
        return;
    }
    // Calcular nuevo inicio = periodStart + periodLength
    const oldStart = new Date(pp.periodStart + 'T00:00:00');
    const newStart = new Date(oldStart);
    newStart.setDate(newStart.getDate() + pp.periodLength);

    // Calcular nuevo payDay = newStart + periodLength - 1 + offset (misma distancia que antes)
    let newPayDay = null;
    if (pp.payDay) {
        const oldPayDay = new Date(pp.payDay + 'T00:00:00');
        const dayOffset = Math.round((oldPayDay - oldStart) / (1000 * 60 * 60 * 24));
        const calculatedPayDay = new Date(newStart);
        calculatedPayDay.setDate(calculatedPayDay.getDate() + dayOffset);
        newPayDay = getDateKey(calculatedPayDay);
    }

    pp.periodStart = getDateKey(newStart);
    pp.payDay = newPayDay;

    saveApplicationData();
    showNotification(`✅ Período avanzado. Nuevo inicio: ${new Date(pp.periodStart + 'T00:00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })}`, 'success');
    render();
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
            const confirmed = await Modal.confirm({
                title: '⚠️ Cambiar a localStorage',
                message: 'IndexedDB tiene más capacidad y es más persistente. localStorage tiene límite de 5-10MB. Los datos actuales se mantendrán en IndexedDB como backup. ¿Continuar?',
                confirmText: 'Cambiar',
                cancelText: 'Cancelar',
                type: 'danger'
            });

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
    reader.onload = async function (e) {
        try {
            const backup = JSON.parse(e.target.result);

            if (!backup.data) {
                throw new Error('Formato de backup inválido');
            }

            const confirmed = await Modal.confirm({
                title: '⚠️ ¿Cargar backup?',
                message: `Archivo: ${file.name} — Fecha: ${new Date(backup.timestamp).toLocaleString()} — Empresa: ${backup.appName || 'N/A'}. Esto reemplazará los datos actuales. ¿Continuar?`,
                confirmText: 'Cargar backup',
                cancelText: 'Cancelar',
                type: 'danger'
            });

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
    const iconSet = document.getElementById('iconSet')?.value || state.settings.iconSet;

    // Leer toggle legacy
    const legacyNavigationElement = document.getElementById('legacyNavigation');
    const legacyNavigation = legacyNavigationElement ? legacyNavigationElement.checked : !!state.settings.legacyNavigation;
    const scrollbarMode = document.getElementById('scrollbarMode')?.value || state.settings.scrollbarMode;
    const hideDuplicateAlertsElement = document.getElementById('hideDuplicateAlerts');
    const hideDuplicateAlerts = hideDuplicateAlertsElement ? hideDuplicateAlertsElement.checked : !!state.settings.hideDuplicateAlerts;

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
    state.settings.iconSet = applyIconSet(iconSet);
    state.settings.legacyNavigation = legacyNavigation;
    state.settings.scrollbarMode = scrollbarMode;
    state.settings.hideDuplicateAlerts = hideDuplicateAlerts;
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

/**
 * 📸 Creador de Snapshots accesible globalmente para RestoreUI
 */
window.createFirebaseSnapshot = async function (type = 'auto') {
    if (!window.currentUser) return null;
    try {
        const id = await FirebaseService.createSnapshot(state, type);
        return id;
    } catch (error) {
        console.error('Error creando snapshot:', error);
        throw error;
    }
};

/**
 * 🛠️ Aplica los datos de un backup al estado actual y guarda localmente
 */
async function applyBackupData(importedData) {
    try {
        const data = importedData.data;

        // Sobrescribir estado (Atomicity local)
        state.settings = data.settings || state.settings;
        state.positions = data.positions || [];
        state.employees = data.employees || [];
        state.leaders = data.leaders || [];
        state.attendance = data.attendance || {};
        state.tempAssignments = data.tempAssignments || [];
        state.dayHoursConfig = data.dayHoursConfig || {};

        // Sincronizar timestamps locales
        const now = Date.now();
        if (!state.settings.updatedAt) state.settings.updatedAt = now;
        state.employees.forEach(e => { if (!e.updatedAt) e.updatedAt = now; });
        state.positions.forEach(p => { if (!p.updatedAt) p.updatedAt = now; });
        Object.values(state.attendance).forEach(a => { if (!a.updatedAt) a.updatedAt = now; });

        // 🧹 Sanitización preventiva antes de guardar
        if (typeof sanitizePositions === 'function') {
            sanitizePositions(state);
        }

        // Guardar en IndexedDB
        await saveToIndexedDB({ clearFirst: true });

        showNotification('✅ Datos restaurados localmente', 'success');
        render(); // Refrescar UI

        return true;
    } catch (error) {
        console.error("Error aplicando backup:", error);
        showNotification('❌ Error al aplicar backup local: ' + error.message, 'error');
        return false;
    }
}

/**
 * 📁 Punto de entrada principal para importación de archivos
 */
window.importData = function (event) {
    const file = event.target.files[0];
    if (!file) return;
    window.loadBackupFromFile(file);
    event.target.value = ''; // Resetear input
};

/**
 * 📂 PROCESAR ARCHIVO DE BACKUP (Global para PWA y Onboarding)
 */
window.loadBackupFromFile = function (file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            let importedData = JSON.parse(e.target.result);

            // 🚛 Filtro de Migración Legacy
            if (LegacyMigrator.needsMigration(importedData)) {
                importedData = LegacyMigrator.migrate(importedData);
            }

            if (!importedData.data) throw new Error('Formato de archivo inválido');

            RestoreUI.showComparisonModal(importedData, state, {
                // Opción 1: Restaurar Local (Offline)
                onLocalRestore: async () => {
                    await applyBackupData(importedData);
                    setTimeout(() => location.reload(), 1200);
                },

                // Opción 2: Desconectar y Restaurar (Evitar impacto en nube antigua)
                onDisconnectRestore: async () => {
                    await FirebaseService.logout();
                    window.currentUser = null;
                    await applyBackupData(importedData);
                    showNotification('🚶 Sesión cerrada y backup restaurado localmente', 'info');
                    setTimeout(() => location.reload(), 1200);
                },

                // Opción 3: Reemplazo Total de la Nube
                onReplaceCloudRestore: async () => {
                    // 1. Aplicar localmente primero
                    const ok = await applyBackupData(importedData);
                    if (!ok) return;

                    // 2. Bloquear UI para proceso crítico
                    const syncLoader = document.createElement('div');
                    syncLoader.innerHTML = `
                        <div style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15, 23, 42, 0.98); display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:10050; color:white; font-family:sans-serif; gap:25px;">
                            <div class="sync-spinner" style="width:60px; height:60px; border:6px solid rgba(255,255,255,0.05); border-top:6px solid #ef4444; border-radius:50%; animation: spin 1s linear infinite;"></div>
                            <div style="text-align:center;">
                                <div style="font-weight:800; font-size:1.4rem; color:#f1f5f9; margin-bottom:8px;">🔥 REEMPLAZANDO NUBE...</div>
                                <div style="color:#94a3b8; font-size:0.95rem; max-width:300px; line-height:1.5;">Estamos borrando los datos antiguos y subiendo tu backup. No cierres esta ventana.</div>
                            </div>
                            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                        </div>`;
                    document.body.appendChild(syncLoader);

                    // 3. Limpieza profunda y subida (Modo Espejo)
                    try {
                        debug.log('☁️ Iniciando limpieza espejo en la nube...');
                        await FirebaseService.deleteCloudData();
                        await FirebaseService.saveFullState(state);
                        await FirebaseService.syncHistory(state.attendance);

                        showNotification('🚀 Nube actualizada con éxito', 'success');

                        // 🔄 Refrescar tras éxito
                        setTimeout(() => location.reload(), 1000);
                    } catch (err) {
                        console.error("Error sincronizando nube tras backup:", err);
                        showNotification('⚠️ Error al actualizar nube, pero los datos locales están guardados.', 'warning');
                        if (syncLoader) syncLoader.remove();
                        render();
                    }
                }
            });

        } catch (err) {
            showNotification('❌ Error al leer el backup: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
};

window.deleteAllData = function () {
    // Usar el nuevo sistema robusto de DataService (Borrado Local)
    dataService.reset();
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
        isHoliday: isDayHoliday(state.selectedDate, state.settings.holidays),
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

    return `<div class="modal-overlay" data-app-close-on-self="close-modal">
                <div class="modal-content" style="max-width: 600px;">
                    <div class="modal-header">
                        <h2 class="modal-title">⚙️ Detalles de Asistencia</h2>
                        <button type="button" class="modal-close" data-app-fn="close-modal" aria-label="Cerrar">✕</button>
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
                                ${isDayHoliday(state.selectedDate, state.settings.holidays) ? '<div style="font-size: 1.5rem;">☀️</div>' : ''}
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
                                                    <button type="button" data-app-fn="removePositionHours" data-arg="${idx}" aria-label="Quitar posición"
                                                            style="background: transparent; border: 1px solid #ef4444; color: #ef4444; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; transition: all 0.2s;"
                                                            onmouseover="this.style.background='#ef4444'; this.style.color='#fff'"
                                                            onmouseout="this.style.background='transparent'; this.style.color='#ef4444'">
                                                        🗑️
                                                    </button>
                                                </div>
                                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                                                    <div>
                                                        <label style="font-size: 0.75rem; color: #94a3b8; display: block; margin-bottom: 4px;">⏱️ Horas Regulares</label>
                                                        <input type="number" inputmode="decimal" autocomplete="off" value="${ph.hours}" min="0" max="24" step="0.5"
                                                               oninput="updatePositionHours(${idx}, 'hours', this.value)"
                                                               style="width: 100%; background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 8px; border-radius: 6px; font-size: 1rem;">
                                                    </div>
                                                    <div>
                                                        <label style="font-size: 0.75rem; color: #94a3b8; display: block; margin-bottom: 4px;">⚡ Horas Extras</label>
                                                        <input type="number" inputmode="decimal" autocomplete="off" value="${ph.overtimeHours}" min="0" max="12" step="0.5"
                                                               oninput="updatePositionHours(${idx}, 'overtimeHours', this.value)"
                                                               style="width: 100%; background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 8px; border-radius: 6px; font-size: 1rem;">
                                                    </div>
                                                </div>
                                            </div>
                                        `;
    }).join('')}
                                </div>
                                
                                ${availablePositions.length > 0 ? `
                                    <button type="button" data-app-fn="addPositionHours"
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
                                        <input type="number" inputmode="decimal" autocomplete="off" id="simpleHours" class="form-input" 
                                               value="${att.hoursWorked || getDayHours(state.selectedDate)}" 
                                               min="0" max="24" step="0.5">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">⚡ Horas Extras</label>
                                        <input type="number" inputmode="decimal" autocomplete="off" id="simpleOvertimeHours" class="form-input" 
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
                        <button type="button" class="btn btn-secondary" data-app-fn="close-modal">Cancelar</button>
                        <button type="button" data-app-fn="deleteCurrentAttendance"
                                style="background: transparent; border: 2px solid #ef4444; color: #ef4444; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.background='#ef4444'; this.style.color='#fff'"
                                onmouseout="this.style.background='transparent'; this.style.color='#ef4444'">
                            🗑️ Eliminar Asistencia
                        </button>
                        <button type="button" class="btn btn-primary" data-app-fn="saveMultiPosition">${icons.get('save', { size: 14 }) || ''} Guardar</button>
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
                    <div class="context-menu-item" role="button" tabindex="0" data-app-fn="openMultiPositionModalFromContext">
                        <span class="context-menu-icon">⚙️</span>
                        <span>Ver Detalles</span>
                    </div>
                    <div class="context-menu-item danger" role="button" tabindex="0" data-app-fn="removeAttendance" data-arg="${employeeId}" data-arg2="${date}">
                        <span class="context-menu-icon">🗑️</span>
                        <span>Eliminar Check</span>
                    </div>
                </div>`;
    }

    // Globo contextual para check activo (Vista Día)
    if (type === 'check-options') {
        return `<div class="context-menu" style="left:${x}px;top:${y}px;">
                    <div class="context-menu-item" role="button" tabindex="0" data-app-fn="openMultiPositionModalFromContext">
                        <span class="context-menu-icon">⚙️</span>
                        <span>Ver Detalles</span>
                    </div>
                    <div class="context-menu-item danger" role="button" tabindex="0" data-app-fn="removeAttendance" data-arg="${employeeId}" data-arg2="${date}">
                        <span class="context-menu-icon">🗑️</span>
                        <span>Eliminar</span>
                    </div>
                </div>`;
    }

    if (type === 'check') {
        return `<div class="context-menu" style="left:${x}px;top:${y}px;">
                    <div class="context-menu-item" role="button" tabindex="0" data-app-fn="openQuickEdit" data-arg="${employeeId}" data-arg2="${date}">
                        <span class="context-menu-icon">⏱️</span>
                        <span>Editar Horas</span>
                    </div>
                    <div class="context-menu-item danger" role="button" tabindex="0" data-app-fn="removeAttendance" data-arg="${employeeId}" data-arg2="${date}">
                        <span class="context-menu-icon">🗑️</span>
                        <span>Eliminar Check</span>
                    </div>
                </div>`;
    }

    // Default: menú genérico
    return `<div class="context-menu" style="left:${x}px;top:${y}px;">
                <div class="context-menu-item" role="button" tabindex="0" data-app-fn="openAdvancedModalFromContext">
                    <span class="context-menu-icon">⚙️</span>
                    <span>Ver Detalles</span>
                </div>
                <div class="context-menu-item danger" role="button" tabindex="0" data-app-fn="removeAttendance" data-arg="${employeeId}" data-arg2="${date}">
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



// ConfirmDialog eliminado - ahora usamos Modal.confirm()

/**
 * 🦴 Renderiza esqueletos de carga para una mejor percepción de velocidad.
 * @param {number} count - Número de elementos a mostrar.
 */
// ⚡ renderSkeleton movido a AttendanceUI.js

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
                    <button type="button" data-app-fn="demo-reset" style="background: rgba(0,0,0,0.2); border: none; padding: 6px 16px; border-radius: 6px; color: white; cursor: pointer; font-weight: 700; transition: all 0.2s;" onmouseover="this.style.background='rgba(0,0,0,0.4)'" onmouseout="this.style.background='rgba(0,0,0,0.2)'">
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

    // ⚡ OPTIMIZACIÓN: Lazy loading de modales (Vía DOM, no inyectados en HTML)
    const modalMap = {
        'advanced': () => '',
        'employee-form': () => '',
        'leader-form': () => '',
        'position-form': () => '',
        'multi-position': () => ''
    };

    const modal = state.showModal && modalMap[state.modalType]
        ? modalMap[state.modalType]()
        : '';

    return `${demoBanner}${Header({
        companyName: state.settings.companyName,
        SyncIndicator: SyncUI.SyncIndicator,
        openNotesCenter: () => window.openNotesCenter(),
        exportData: () => window.exportExcel(),
        activeTab: state.activeTab,
        changeTab: (tab) => window.changeTab(tab),
        legacyNavigation: state.settings.legacyNavigation
    })}<main class="main-content" ${state.settings.legacyNavigation ? 'style="padding-bottom: 24px;"' : ''}><div class="container">${content}</div></main>${state.settings.legacyNavigation ? '' : BottomNavigation()}${!state.settings.legacyNavigation ? '<button type="button" class="landscape-toggle-btn" data-app-fn="toggleBottomNav" aria-label="Mostrar/Ocultar Menú">☰</button>' : ''}${employeeFloatingCard.render()}${EmployeeProfileModal()}${modal}${ContextMenu()}${ExportMenu()}${ImportFullModal()}${NotesCenter()}${NoteEditorModal()}`;
}

// 🎯 Registrar el componente raíz para el motor modular
setRootComponent(App);

function updateHeaderOffset() {
    const header = document.querySelector('.header');
    if (header) {
        document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`);
    }
}

// El renderizado ahora se gestiona a través de modules/core/RenderManager.js
// No es necesario definir render(), debouncedRender o throttledRender aquí.

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

// ⚡ NUEVO: Listener de scroll para controles flotantes
let lastScrollTime = 0;
window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    const isScrolled = scrollY > 200;
    const showBackToTop = scrollY > 400;

    // 🚀 Control del botón "Ir Arriba"
    const backToTopBtn = document.getElementById('backToTop');
    if (backToTopBtn) {
        if (showBackToTop) backToTopBtn.classList.add('visible');
        else backToTopBtn.classList.remove('visible');
    }

    if (isScrolled !== state.isScrolled) {
        // Usar requestAnimationFrame para evitar lag
        const now = Date.now();
        if (now - lastScrollTime > 50) { // Throttle de 50ms
            state.isScrolled = isScrolled;
            const compactControls = document.querySelector('.date-controls-compact');
            if (compactControls) {
                const isWeekView = state.viewMode === 'week';
                if (isScrolled && state.activeTab === 'attendance') {
                    compactControls.classList.add('visible');
                } else {
                    compactControls.classList.remove('visible');
                }
            }
            lastScrollTime = now;
        }
    }
});

// [LEGACY ONBOARDING REMOVED - MOVED TO modules/ui/Onboarding.js]

// ============================================
// 🚀 INICIALIZACIÓN DE LA APLICACIÓN
// ============================================

(async function initializeApp() {
    // Banner de versión solo en debug mode (window.debug.enable() para activar)
    debug.log('🚀 ========================================');
    debug.log('🚀 SISTEMA DE CONTROL DE ASISTENCIA');
    debug.log('🚀 Versión: 6.6 (Sync Optimized)');
    debug.log('🚀 ========================================');

    const loader = document.getElementById('app-loader');
    let isInitialLoad = true;

    const showLoader = (isNavigation = false) => {
        if (loader) {
            if (isNavigation) window._isNavigating = true;
            
            // Solo actuar y loguear si no estaba ya visible
            if (loader.classList.contains('hidden') || loader.style.display === 'none') {
                debug.log(`🔄 Mostrando Loader... ${isNavigation ? '(Bloqueo de Navegación ACTIVO)' : ''}`);
                loader.style.display = 'flex';
                void loader.offsetWidth;
                loader.classList.remove('hidden');
            }
        }
    };

    const hideLoader = (force = false) => {
        if (loader) {
            // Ignorar si hay una navegación en curso y no hemos forzado el cierre
            if (window._isNavigating && !force) {
                return;
            }

            // Solo actuar y loguear si estaba visible
            if (!loader.classList.contains('hidden')) {
                debug.log('✨ Ocultando Loader...');
                loader.classList.add('hidden');
                setTimeout(() => {
                    if (loader.classList.contains('hidden')) {
                        loader.style.display = 'none';
                    }
                }, 500);
                return true; // Indicamos que realmente se ocultó
            }
        }
        return false;
    };

    // Exponer globalmente para uso en navegación
    window.showLoader = showLoader;
    window.hideLoader = hideLoader;

    // 📡 ESCUCHA AUTOMÁTICA: Ocultar loader cuando el render termine
    eventBus.on('render:complete', () => {
        if (!isInitialLoad) {
            const wasHidden = hideLoader();
            if (wasHidden) {
                debug.log('🎯 Render finalizado, loader ocultado.');
            }
        }
    });

    // Timeout de seguridad: Ocultar loader tras 6 segundos si Firebase falla
    const loaderTimeout = setTimeout(() => {
        if (isInitialLoad) {
            console.warn('⚠️ Firebase tardó demasiado. Ocultando loader por seguridad.');
            hideLoader();
            isInitialLoad = false;
        }
    }, 6000);

    try {
        // 1. Cargar datos de forma asíncrona (AWAIT CRÍTICO)
        debug.log('📂 Cargando datos...');
        await loadApplicationData();

        // 1.1 Unificar puestos y limpiar IDs (Migración Opción A)
        if (sanitizePositions(state)) {
            debug.log('💾 Guardando cambios de sanitización inicial...');
            await saveApplicationData({ force: true });
            render();
        }

        // 2. Aplicar configuraciones de interfaz
        state.settings.iconSet = applyIconSet(state.settings.iconSet);

        // 3. Intentar restaurar auto-backup (solo si la carga falló completamente)
        if (state.employees.length === 0) {
            debug.log('🔄 Intentando restaurar auto-backup...');
            restoreAutoBackup();
        }

        // 4. Inicializar Auth y Sincronización (Tiempo Real)
        FirebaseService.onAuthStateChanged(async (user) => {
            // Estandarización de Scope Global
            window.currentUser = user;
            if (window.App) window.App.currentUser = user;

            state.syncStatus = user ? 'synced' : 'idle';
            render(); // Actualización inmediata de UI (Perfil/SyncStatus)

            if (user) {
                showNotification(`✅ Sesión iniciada como ${user.email}`, 'success');

                // --- LÓGICA DE MIGRACIÓN INICIAL (Fase 2) ---
                if (state.isDataLoaded) {
                    try {
                        const cloudData = await FirebaseService.getFullState();
                        // Si no hay datos en la nube pero sí locales, migramos de inmediato
                        if (!cloudData && (state.employees.length > 0 || state.positions.length > 0)) {
                            debug.log('🚀 Migrando datos locales a la nube (Primera vez)...');
                            await FirebaseService.saveFullState(state);
                            if (Object.keys(state.attendance).length > 0) {
                                await FirebaseService.syncHistory(state.attendance);
                            }
                            showNotification('✅ Datos migrados a la nube', 'success');
                        }
                    } catch (e) {
                        console.error('Error en migración inicial:', e);
                    }
                }

                // Suscribirse a cambios en el estado (Mirror Sync)
                FirebaseService.subscribeToChanges((remoteData) => {
                    debug.log('📡 Cambio detectado en la nube...');

                    // 🛡️ FIX: Si la nube tiene datos más viejos que nuestro estado local, ignorar (y re-sincronizar).
                    // Esto previene que la caché offline de Firebase (O un guardado fallido) revierta los datos al pulsar F5.
                    const remoteTime = remoteData.settings?.localUpdatedAt || 0;
                    const localTime = state.settings?.localUpdatedAt || 0;
                    
                    if (localTime > remoteTime) {
                        debug.log(`🛡️ Persistencia: Nube (${remoteTime}) es más antigua que Estado Local (${localTime}). Redirigiendo...`);
                        // Si F5 frenó la sincronización, forzamos un save ahora que reinició
                        if (!window._forceSyncTimer) {
                            window._forceSyncTimer = setTimeout(() => {
                                FirebaseService.saveFullState(state);
                                window._forceSyncTimer = null;
                            }, 1000);
                        }
                        return; // Ignorar estos datos obsoletos para no destruir el state local
                    }

                    // 🛡️ GUARD: Evitar loop infinito de sincronización
                    // Sin este flag: cloud change → state update → render → save → firebase sync → cloud change → ∞
                    window._isApplyingRemoteData = true;
                    window._pendingRemoteSave = true; // Marcar que hay datos remotos para persistir

                    // Fusionar datos (con deduplicación por ID)
                    const dedup = (arr) => arr ? [...new Map(arr.map(item => [item.id, item])).values()] : [];
                    
                    // ⚡ FIX: Asegurar instancias correctas de clase al recibir de Firebase
                    let newEmployees = dedup(remoteData.employees || state.employees);
                    if (typeof Employee !== 'undefined') {
                        newEmployees = newEmployees.map(e => e instanceof Employee ? e : new Employee(e));
                    }

                    state.settings = { ...state.settings, ...remoteData.settings };
                    state.employees = newEmployees;
                    state.positions = dedup(remoteData.positions || state.positions);
                    state.leaders = dedup(remoteData.leaders || state.leaders);

                    if (remoteData.attendance) {
                        debug.log('⚠️ Ignorando attendance de Mirror Sync (gestionado por Zonal Sync)');
                    }

                    // 🛡️ Sanitización post-sincronización (Evita que la nube traiga basura vieja)
                    if (sanitizePositions(state)) {
                        debug.log('🧹 Datos de la nube sanitizados localmente.');
                    }

                    // Desactivar flag después de un tick para que el render/save no suba de vuelta.
                    // ⚡ FIX: Persistir datos remotos en IndexedDB para que F5 no muestre datos desactualizados.
                    setTimeout(() => {
                        window._isApplyingRemoteData = false;
                        if (window._pendingRemoteSave) {
                            window._pendingRemoteSave = false;
                            saveToIndexedDB().catch(e => console.warn('⚠️ Error persistiendo datos remotos localmente:', e));
                        }
                    }, 500);

                    if (isInitialLoad) {
                        clearTimeout(loaderTimeout);
                        hideLoader();
                        isInitialLoad = false;
                        // Forzar render inicial con datos de la nube
                        render();
                    }
                });

                // ⚡ OPTIMIZACIÓN ZONAL & FASE 3: Suscripción Dinámica por Rango
                window.updateAttendanceSubscription = function () {
                    if (window._attendanceUnsubscribe) {
                        window._attendanceUnsubscribe();
                    }

                    // Calcular rango: Mes actual +- 1 mes para suavidad
                    const date = new Date(state.selectedDate);
                    const startOfMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
                    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 2, 0);

                    const startDate = getDateKey(startOfMonth);
                    const endDate = getDateKey(endOfMonth);

                    // Evitar suscripciones redundantes si el rango no ha cambiado significativamente
                    if (state._currentSubRange === `${startDate}_${endDate}`) return;
                    state._currentSubRange = `${startDate}_${endDate}`;

                    window._attendanceUnsubscribe = FirebaseService.subscribeToAttendanceZonal({
                        startDate,
                        endDate,
                        onInitialLoad: (allAttendance) => {
                            window._isApplyingRemoteData = true;
                            
                            // 🛡️ LIMPIEZA DE ESTADO: Eliminar claves "cortas" (solo id) o inconsistentes
                            // Solo deben quedar claves con formato: employeeId-dateKey
                            const entries = Object.entries(allAttendance);
                            entries.forEach(([key, record]) => {
                                const shortKey = record.employeeId;
                                if (state.attendance[shortKey]) {
                                    delete state.attendance[shortKey];
                                }
                            });

                            state.attendance = { ...state.attendance, ...allAttendance };
                            // ⚡ Persistir asistencia remota usando BatchedSaver
                            // (acumula con onModified si llegan también en ráfaga)
                            Object.keys(allAttendance).forEach(key => {
                                const dateKey = key.split('-').slice(-3).join('-'); // YYYY-MM-DD
                                window._attendanceBatchedSaver.add(dateKey);
                            });
                            // Si onInitialLoad no añadió nada (sin records), liberar flag manualmente
                            if (!window._attendanceBatchedSaver.hasScheduledFlush) {
                                window._isApplyingRemoteData = false;
                            }
                            if (!isInitialLoad) render();
                        },
                        onModified: (dateKey, records) => {
                            window._isApplyingRemoteData = true;
                            
                            // 🛡️ LIMPIEZA DE ESTADO: Evitar duplicidad si Firebase envía claves incoherentes
                            Object.values(records).forEach(record => {
                                const shortKey = record.employeeId;
                                if (state.attendance[shortKey]) {
                                    delete state.attendance[shortKey];
                                }
                            });

                            state.attendance = { ...state.attendance, ...records };
                            // ⚡ Persistir vía BatchedSaver: si llegan N dateKeys en ráfaga
                            // (típico al arrancar), todos se persisten con una sola escritura.
                            window._attendanceBatchedSaver.add(dateKey);

                            // Actualización Zonal
                            const selectedDateKey = getDateKey(state.selectedDate);
                            const recordList = Object.values(records);

                            if (dateKey === selectedDateKey && state.activeTab === 'attendance' && state.viewMode === 'day') {
                                recordList.forEach(record => {
                                    if (record.employeeId) window.updateEmployeeRow?.(record.employeeId);
                                });
                            } else if (state.activeTab === 'attendance' && state.viewMode === 'week') {
                                const week = getWeekDates(new Date(state.selectedDate));
                                if (week.some(d => getDateKey(d) === dateKey)) {
                                    recordList.forEach(record => {
                                        if (record.employeeId) window.updateWeekRow?.(record.employeeId);
                                    });
                                    window.updateWeekTotals?.();
                                }
                            } else {
                                render();
                            }
                        }
                    });
                };

                // Iniciar primera suscripción
                window.updateAttendanceSubscription();
            } else {
                // Si no hay usuario, ocultamos el loader de inmediato (ya que no habrá sync)
                hideLoader();
                isInitialLoad = false;
                render(); // Asegurar que la UI de settings/auth se limpie
            }
        });

        // 5. Preparar UI
        onboardingWizard.show();
        initBackToTop();

        // ⚡ Refactorización Alpha: Exponer manejadores de EmployeesUI al scope global
        // Compat legacy: expone funciones globales para templates antiguos
        window.openEmployeeForm = EmployeesUI.openEmployeeForm;
        window.openLeaderForm = EmployeesUI.openLeaderForm;
        window.openPositionForm = EmployeesUI.openPositionForm;
        window.changeEmployeeViewMode = EmployeesUI.changeEmployeeViewMode;
        window.toggleEmployeeStatus = EmployeesUI.toggleEmployeeStatus;
        window.toggleLeaderStatus = EmployeesUI.toggleLeaderStatus;
        window.togglePositionStatus = EmployeesUI.togglePositionStatus;
        window.setEmployeeSearchFilter = EmployeesUI.setEmployeeSearchFilter;
        window.setEmployeePositionFilter = EmployeesUI.setEmployeePositionFilter;
        window.setEmployeeLeaderFilter = EmployeesUI.setEmployeeLeaderFilter;
        window.setEmployeeStatusFilter = EmployeesUI.setEmployeeStatusFilter;
        window.resetEmployeeFilters = EmployeesUI.resetEmployeeFilters;
        window.setPositionSearchFilter = EmployeesUI.setPositionSearchFilter;
        window.setPositionLeaderFilter = EmployeesUI.setPositionLeaderFilter;
        window.setPositionStatusFilter = EmployeesUI.setPositionStatusFilter;
        window.setPositionSortBy = EmployeesUI.setPositionSortBy;
        window.toggleLeaderEmployees = EmployeesUI.toggleLeaderEmployees;
        window.togglePositionEmployees = EmployeesUI.togglePositionEmployees;
        window.openEmployeeProfile = EmployeesUI.openEmployeeProfile;
        window.openEmployeeFloating = EmployeesUI.openEmployeeFloating;
        window.toggleBottomNav = () => { state.bottomNavHidden = !state.bottomNavHidden; };

        // 6. Renderizado Inicial
        debug.log('🎨 Renderizando interfaz...');
        render();

        debug.log('✅ Aplicación iniciada correctamente');
        hideLoader(); // 🚀 Ocultar el loader al completar el primer render
    } catch (error) {
        console.error('❌ Error fatal durante la inicialización:', error);
        // Intentar renderizar aunque sea un estado de error
        render();
    }

    // 📂 PWA FILE HANDLING (API launchQueue)
    // Permite que la app sea sugerida para abrir archivos .json (backups)
    if ('launchQueue' in window) {
        debug.log('📬 Launch Queue detectado. Esperando archivos...');
        window.launchQueue.setConsumer(async (launchParams) => {
            if (launchParams.files && launchParams.files.length > 0) {
                debug.log('📂 Archivo recibido vía PWA Launch Handler');
                for (const fileHandle of launchParams.files) {
                    const file = await fileHandle.getFile();
                    if (file.name.toLowerCase().endsWith('.json')) {
                        // Esperar un momento a que la UI esté lista
                        setTimeout(() => {
                            window.loadBackupFromFile(file);
                        }, 500);
                        break; // Solo procesar el primero
                    }
                }
            }
        });
    }
})();

/**
 * 🚀 Inicializa el botón flotante 'Ir Arriba' con efecto Glassmorphism
 */
function initBackToTop() {
    if (document.getElementById('backToTop')) return;

    const btn = document.createElement('div');
    btn.className = 'back-to-top';
    btn.id = 'backToTop';
    btn.innerHTML = '▲'; // Unicode arrow para máxima compatibilidad
    btn.title = 'Ir arriba';
    btn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.appendChild(btn);
}


import FirebaseService from './modules/services/FirebaseService.js';
import { saveApplicationData, saveToIndexedDB, loadApplicationData, validateDataIntegrity, prepareDataForNewAccount, createAutoBackup, restoreAutoBackup, sanitizePositions, loadDemoDataIntoDB } from './modules/services/PersistenceService.js';
import { attendanceSyncTracker } from './modules/services/AttendanceSyncTracker.js';
import { BatchedSaver } from './modules/utils/BatchedSaver.js';
import { Header } from './modules/ui/Header.js';
import { debug } from './modules/utils/Debug.js';

// debug está disponible globalmente (window.debug) — usar `debug.enable()` desde
// la consola del navegador para activar logs verbosos durante desarrollo.

// 📦 IMPORTACIÓN DEL ESTADO CENTRAL (Fase 4 - Modularización)
import {
    state, stateManager, renderOptimizer, calculateStats,
    invalidateEmployeeStats, buildAttendanceIndex, invalidateAllStats
} from './modules/core/AppState.js';

import {
    DayView, WeekView, StatsGrid, Legend, PositionFilters, SearchBar,
    EmployeeRow, EmployeeRowCompact, WeekRow, WeekViewTotalsRow, renderSkeleton,
    DateControls, DateControlsCompact, getDayHours, getCheckColor
} from './modules/ui/AttendanceUI.js';
import { CalendarView } from './modules/ui/components/CalendarView.js';
import { RestoreUI } from './modules/ui/RestoreUI.js';
import { SnapshotDiffModal } from './modules/ui/SnapshotDiffModal.js';
import { loadAndMigrateEmployees } from './modules/services/EmployeeLoader.js';
import { localStateIsEmpty, shouldAcceptRemote } from './modules/services/SyncWatermark.js';
import { checkLocalOwnership, claimLocalOwnership, clearLocalOwnership } from './modules/services/LocalDataOwner.js';
import { recordNestedTombstone } from './modules/services/NestedTombstones.js';
import { PettyCashStore } from './modules/features/pettycash/PettyCashStore.js';
import { sanitizePettyCashForSnapshot } from './modules/services/SnapshotSanitizer.js';
import { EmployeesLiveSync } from './modules/services/EmployeesLiveSync.js';
import { detectIncomingChanges } from './modules/services/IncomingChangeDetector.js';
import { IncomingChangeModal } from './modules/ui/IncomingChangeModal.js';
import { pauseCloudUpload, resumeCloudUpload, isSyncPaused, SYNC_PAUSE_ENABLED, isDownloadPaused, pauseCloudDownload, resumeCloudDownload } from './modules/services/SyncPauseService.js';
import { EmployeeRepository } from './modules/services/EmployeeRepository.js';
import { PositionRepository } from './modules/services/PositionRepository.js';
import { LeaderRepository } from './modules/services/LeaderRepository.js';
import { PositionsLiveSync } from './modules/services/PositionsLiveSync.js';
import { LeadersLiveSync } from './modules/services/LeadersLiveSync.js';
import { generateLoansReadonlySection } from './modules/features/profile/LoansReadonlySection.js';
import { renderSyncStatusBadge, attachLiveBadge } from './modules/ui/SyncStatusBadge.js';
import { SyncStatus } from './modules/services/SyncStatus.js';
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
import { escapeHTML as _escapeHTML_split } from './modules/utils/Sanitize.js';
// Local alias so the detail panel can use escapeHTML(...) without colliding
// with any other escapeHTML helper defined later in this file.
const escapeHTML = _escapeHTML_split;
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
import { render, setRootComponent, saveScrollPosition, restoreScrollPosition, setupHeaderHeightObserver } from './modules/core/RenderManager.js';
import lazyLoader from './modules/utils/LazyLoader.js';
import offlineManager from './modules/services/OfflineManager.js';
import workerPool from './modules/utils/WebWorkerPool.js';

import { firebaseConfig, APP_CONFIG } from './modules/config/Config.js';
import * as AnalyticsUI from './modules/features/analytics/AnalyticsUI.js';
import * as PayrollUI from './modules/features/payroll/PayrollUI.js';
import { PettyCashTab, registerPettyCashGlobals } from './modules/features/pettycash/PettyCashUI.js';
import * as SyncUI from './modules/ui/SyncUI.js';
import { NotesCenter, NoteEditorModal, registerLegacyGlobals as registerNotesGlobals } from './modules/features/notes/index.js';
import { ExportMenu, ImportFullModal, registerLegacyGlobals as registerExportGlobals } from './modules/features/export/index.js';
import { EmployeeProfileModal, syncProfileToMaster, registerLegacyGlobals as registerProfileGlobals } from './modules/features/profile/index.js';
import { migrateAllAdvances, registerLegacyGlobals as registerLoansGlobals } from './modules/features/loans/index.js';
import {
    WeatherChip,
    WeatherChipWithPanel,
    WeatherBar,
    registerLegacyGlobals as registerWeatherGlobals,
    registerAdapter as registerWeatherAdapter,
    setActiveProvider as setWeatherProvider
} from './modules/features/weather/index.js';
import { WeatherApiAdapter } from './modules/features/weather/adapters/WeatherApiAdapter.js';
import { monitorSWVersion } from './modules/utils/SWVersion.js';
import { ensureJsPDFLoaded, ensureHtml2CanvasLoaded } from './modules/utils/LazyCDN.js';

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

    createSnapshot: async (type = 'manual', reason = null) => {
        try {
            showNotification('📸 Creando snapshot...', 'info');
            await FirebaseService.createSnapshot(state, type, reason);
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

            // 🛡️ FIX: en el modelo migrado (schemaVersion>=2) empleados/cargos/
            // líderes viven en subcolecciones per-doc; data/current los tiene
            // vacíos. Object.assign de arriba dejó esos arreglos en []; los
            // recuperamos de la fuente correcta para no perderlos.
            const sv = (typeof state.settings?.schemaVersion === 'number') ? state.settings.schemaVersion : 0;
            if (sv >= 2) {
                // M1: loadAll() devuelve null ante fallo de lectura. `?? prev`
                // conserva lo que ya teníamos en vez de blanquear con un error.
                state.employees = (await EmployeeRepository.loadAll()) ?? state.employees;
                state.positions = (sv >= 3) ? ((await PositionRepository.loadAll()) ?? state.positions) : (cloudState.positions || []);
                state.leaders   = (sv >= 3) ? ((await LeaderRepository.loadAll())   ?? state.leaders)   : (cloudState.leaders || []);
            }
            if (typeof Employee !== 'undefined') state.employees = (state.employees || []).map(e => e instanceof Employee ? e : new Employee(e));
            if (typeof Position !== 'undefined') state.positions = (state.positions || []).map(p => p instanceof Position ? p : new Position(p));
            if (typeof Leader !== 'undefined') state.leaders = (state.leaders || []).map(l => l instanceof Leader ? l : new Leader(l));

            state.attendance = cloudAttendance; // historial completo (todos los días)
            // Reemplazo total del dataset → coherencia explícita (load-bearing tras Paso 4):
            // render() lee stats/índice antes del reload, así que debe correr sincrónico ya.
            invalidateAllStats();
            buildAttendanceIndex();
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

// ⚡ window.addAdvance / window.saveAdvance — moved to the canonical block
// below (~line 2096). Earlier duplicates were dead code (overwritten by the
// second definition). window.editAdvance lives there too now.

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

    const dateKey = getDateKey(state.selectedDate);

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
    // Spread {...att} → referencia nueva. Antes esto alcanzaba para que el Proxy
    // reconstruyera el índice; tras Paso 4 la coherencia es explícita (abajo).
    state.attendance[key] = { ...att };
    invalidateEmployeeStats(emp.id);
    buildAttendanceIndex(dateKey);

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
            invalidateEmployeeStats(emp.id);
            buildAttendanceIndex(dateKey);
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

    // dateKey capturado una vez: estable para la closure de undo (si el usuario
    // navega a otra fecha antes de deshacer, debe reconstruirse ESTE día, no el actual).
    const dateKey = getDateKey(state.selectedDate);
    const key = `${emp.id}-${dateKey}`;

    // ─── SNAPSHOT antes de eliminar ───
    const previousAtt = state.attendance[key]
        ? { ...state.attendance[key], positionHours: [...(state.attendance[key].positionHours || [])] }
        : null;

    // Eliminar directamente — sin confirm(). El botón Deshacer es el safety net.
    // ⚡ Fase 4 Paso 5: el delete + la coherencia van en un batch → 1 repintado (antes:
    // el del delete-trap + el manual del final). La coherencia (financiera) va DENTRO
    // del batch para que el repintado del cierre lea statsCache ya fresco.
    stateManager.batchSetState(() => {
        delete state.attendance[key];
        invalidateEmployeeStats(emp.id);
        buildAttendanceIndex(dateKey);
    });

    // ─── Registrar Undo (la restauración también mantiene coherencia) ───
    UndoManager.push(
        previousAtt,
        `Eliminación de ${emp.name}`,
        () => {
            if (previousAtt) state.attendance[key] = previousAtt;
            invalidateEmployeeStats(emp.id);
            buildAttendanceIndex(dateKey);
        }
    );

    // El repintado lo agenda batchSetState al cerrar; se elimina la llamada manual
    // que duplicaba el repintado (concern de render, no de datos).
    saveApplicationData({ dateKey });
    closeModal();
};

// Remover posición del modal
window.removePositionHours = async function (index) {
    const emp = state.selectedEmployee;
    if (!emp) return;

    const dateKey = getDateKey(state.selectedDate);
    const key = `${emp.id}-${dateKey}`;
    const att = state.attendance[key];

    if (att && att.positionHours) {
        // Quitar una posición NO toca att.hoursWorked (las stats mensuales suman
        // hoursWorked, no positionHours) → sin coherencia salvo que se borre el registro.
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
                invalidateEmployeeStats(emp.id);
                buildAttendanceIndex(dateKey);
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
                FirebaseService.createSnapshot(state, 'auto', 'daily-auto').then(() => {
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

// ⚡ Restaurar Snapshot desde Firebase
// Flujo (Snapshot UX B):
//   1. Descargar el snapshot.
//   2. Mostrar modal de diff (qué cambia, qué se perdería).
//   3. Si confirma: crear snapshot "pre-restore" del estado actual (red de
//      seguridad) y luego aplicar.
window.restoreSnapshot = async (snapshotId) => {
    if (!window.currentUser) return;

    let snapshot;
    try {
        Notification.info('⏳ Cargando snapshot para comparar...', 0);
        snapshot = await FirebaseService.getSnapshot(snapshotId);
        Notification.clearAll();
    } catch (e) {
        Notification.clearAll();
        console.error('Error descargando snapshot:', e);
        Notification.error('❌ No se pudo cargar el snapshot: ' + e.message);
        return;
    }

    if (!snapshot || !snapshot.state) {
        Notification.error('❌ El snapshot está vacío o corrupto');
        return;
    }

    // Mostrar modal de comparación. La restauración real ocurre en onRestore.
    SnapshotDiffModal.show(snapshot.state, state, {
        snapshotMeta: snapshot.metadata || {},
        onRestore: async () => {
            try {
                state.isLoadingSnapshots = true;
                render();
                Notification.info('🛟 Creando red de seguridad...', 0);

                // 1. Snapshot de seguridad ANTES de aplicar el cambio.
                try {
                    await FirebaseService.createSnapshot(state, 'pre-restore', 'pre-restore');
                } catch (snapErr) {
                    // No bloqueamos: mejor restaurar sin red que no restaurar.
                    console.warn('⚠️ No se pudo crear el snapshot pre-restore:', snapErr);
                }

                Notification.clearAll();
                Notification.info('⏳ Restaurando sistema...', 0);

                // 2. Aplicar datos al estado global.
                state.employees = snapshot.state.employees || [];
                state.positions = snapshot.state.positions || [];
                state.attendance = snapshot.state.attendance || {};

                // Mezclar settings con precaución (mantener flags de sesión si existen)
                if (snapshot.state.settings) {
                    state.settings = { ...state.settings, ...snapshot.state.settings };
                }

                // Reemplazo total del dataset → coherencia explícita antes del render().
                invalidateAllStats();
                buildAttendanceIndex();

                // 3. Persistencia: IndexedDB + mirror.
                await saveApplicationData();

                Notification.clearAll();
                Notification.success('✅ Sistema restaurado con éxito', 5000);
                state.isLoadingSnapshots = false;
                render();
            } catch (e) {
                console.error('Error fatal en restauración:', e);
                Notification.clearAll();
                Notification.error('❌ Error al restaurar: ' + e.message);
                state.isLoadingSnapshots = false;
                render();
            }
        }
    });
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
            () => {
                state.attendance[key] = previousAtt;
                invalidateEmployeeStats(empId);
                buildAttendanceIndex(getDateKey(date));
            }
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

        // Limpiar selección temporal después de usarla
        if (state.tempPositionSelection) {
            delete state.tempPositionSelection[key];
        }

        // ─── Registrar Undo: eliminar el registro que se acaba de agregar ───
        UndoManager.push(
            null,
            `Asistencia de ${emp.name}`,
            () => {
                delete state.attendance[key];
                invalidateEmployeeStats(empId);
                buildAttendanceIndex(getDateKey(date));
            }
        );
    }

    // Coherencia explícita tras la mutación (load-bearing tras Paso 4): cubre
    // ambas ramas (alta y baja). empId/date están en scope; granular por día.
    invalidateEmployeeStats(empId);
    buildAttendanceIndex(getDateKey(date));

    // ✅ Guardar cambios con dateKey para sync granular
    saveApplicationData({ dateKey: getDateKey(date) });

    // 📡 Feedback por ítem (patrón WhatsApp): anillo girando en el check
    // mientras el cambio sube a la nube; el espejo confirma por eventBus y
    // el tracker muestra UN solo contador ("N asistencias guardadas en la
    // nube"). Solo aplica con sesión — sin nube no hay nada que esperar.
    if (window.currentUser) {
        attendanceSyncTracker.markPending(empId);
    }

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
        att.updatedAt = Date.now();

        // ✅ Sincronizar con la base de datos (Zonal Sync) + toast honesto
        saveApplicationData({ dateKey: getDateKey(state.selectedDate), announce: `Cambiado a ${posName}` });
        
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
        saveApplicationData({ announce: 'Posición actualizada' }); // ✅ Guardar + toast honesto
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
    // 🪦 P1: registrar el tombstone ANTES del splice — sin esto, el merge
    // con la nube (unionById) resucitaba el item borrado.
    const _deleted = state.employeeProfile.deductions[index];
    if (_deleted?.id) recordNestedTombstone(state.employeeProfile, 'deductions', _deleted.id);
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
    // 🪦 P1: tombstone antes del splice (ver removeDeduction).
    const _deleted = state.employeeProfile.bonuses[index];
    if (_deleted?.id) recordNestedTombstone(state.employeeProfile, 'bonuses', _deleted.id);
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
// 📡 Resultado del espejo a Firestore → anillos de asistencia + contador.
// El tracker ignora la señal cuando no hay cambios propios pendientes.
eventBus.on('sync:mirror-result', ({ ok } = {}) => {
    if (ok) attendanceSyncTracker.cloudConfirmed();
    else attendanceSyncTracker.cloudFailed();
});

// 🔄 Un render completo recrea las filas y borra las clases del anillo en el
// DOM — re-aplicarlas mantiene el amarillo visible mientras la nube responde.
eventBus.on('render:complete', () => {
    attendanceSyncTracker.reapplyPending();
});

eventBus.on('render:complete', () => {
    if (state.showEmployeeProfile && state.employeeProfile.activeTab === 'nomina') {
        updatePayrollSectionsTrigger();
    }
});

// 💵 SISTEMA DE ADELANTOS / PRÉSTAMOS
//
// Note: the new "loans" data model (js/modules/features/loans/LoansService.js)
// is the source of truth going forward. The legacy `state.employeeProfile.advances`
// path is preserved for backward compatibility — existing UI templates still
// read from it. A migration runs on each profile open to mirror legacy data
// into emp.loans[].
window.addAdvance = () => {
    if (!state.employeeProfile.advances) state.employeeProfile.advances = [];

    const newIndex = state.employeeProfile.advances.length;
    state.employeeProfile.advances.push({
        id: `ADV-${Date.now()}`,
        amount: 0,
        date: getDateKey(new Date()),
        interest: 0,
        note: ''
    });

    // ⚡ FIX (Bug #2): Auto-open the new entry in edit mode so the user can
    // fill it in immediately (mirrors the UX of the old dead handler).
    if (!state.employeeProfile.editingAdvances) state.employeeProfile.editingAdvances = {};
    state.employeeProfile.editingAdvances[newIndex] = true;

    syncProfileToMaster(state.employeeProfile.employeeId);
    updatePayrollUI();
};

window.removeAdvance = (index) => {
    // 🪦 P1: tombstone antes del splice (ver removeDeduction).
    const _deleted = state.employeeProfile.advances[index];
    if (_deleted?.id) recordNestedTombstone(state.employeeProfile, 'advances', _deleted.id);
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
    // ⚡ FIX (Bug #2): Close edit mode for this row so the user sees the
    // saved summary (the dead-code version used to do this; the live
    // version didn't, leaving rows perpetually expanded).
    if (state.employeeProfile.editingAdvances) {
        state.employeeProfile.editingAdvances[index] = false;
    }
    syncAdvancesAndSave({ announce: 'Adelanto guardado' });
    updatePayrollUI();
    // El toast lo emite ahora el SaveOutcomeNotifier con el resultado REAL
    // (verde local+nube / amarillo solo-local / rojo si falló).
};

/**
 * ⚡ Sincroniza adelantos del perfil al empleado y guarda en DB
 */
function syncAdvancesAndSave(saveOptions = {}) {
    syncProfileToMaster(state.employeeProfile.employeeId, saveOptions);
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

// 🔄 UNIFICACIÓN DE PRÉSTAMOS:
// La sección "Adelantos y Préstamos" del perfil ahora es de SOLO LECTURA.
// El único lugar para registrar/editar es Cuentas por Cobrar. La implementación
// vive en LoansReadonlySection.js para que sea testeable en aislamiento.
function generateAdvancesHTML(/* payroll (no longer used) */) {
    const emp = state.employees?.find(e => e.id === state.employeeProfile?.employeeId);
    if (!emp) return '';
    return generateLoansReadonlySection(emp);
}

// Implementación vieja eliminada en la unificación de préstamos. Si necesitas
// referencia histórica, ver git blame de este archivo en commits anteriores.
function _legacyGenerateAdvancesHTML_REMOVED(payroll) {
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
        // ⚡ Fase 4 Paso 5: batchear los writes de UI (contextMenu + isProcessingClick) y
        // soltar el repintado manual → 1 repintado. Rama UI: sin asistencia ni coherencia.
        stateManager.batchSetState(() => {
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
        });

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

        // ⚡ Fase 4 Paso 5: batchear el alta + la coherencia → 1 repintado. FINANCIERO:
        // hoursWorked/present alimentan stats, la coherencia va DENTRO del batch.
        stateManager.batchSetState(() => {
            state.attendance[key] = newAttendance;
            invalidateEmployeeStats(empId);
            buildAttendanceIndex(dateStr);
        });

        // ─── Registrar Undo (ambas ramas re-mutan asistencia → coherencia adentro) ───
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
                invalidateEmployeeStats(empId);
                buildAttendanceIndex(dateStr);
            }
        );

        saveApplicationData({ dateKey: dateStr });

        // El repintado lo agenda batchSetState al cerrar; se elimina la llamada manual.
        state.isProcessingClick = false;
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

    // ⚡ Fase 4 Paso 5: batchear la baja in-place (6 campos) + la coherencia + el cierre
    // del contextMenu → 1 repintado (antes: uno por cada campo + el manual del final). La
    // coherencia (financiera: present:false/hoursWorked=0 cambian las stats) va DENTRO del
    // batch para que el repintado del cierre lea statsCache ya fresco.
    stateManager.batchSetState(() => {
        const att = state.attendance[key];
        if (att) {
            att.present = false;
            att.hoursWorked = 0;
            att.overtimeHours = 0;
            att.positionHours = [];
            att.updatedAt = Date.now();
            att._isDirty = true;
        }
        invalidateEmployeeStats(empId);
        buildAttendanceIndex(dateStr);
        state.contextMenu = null;
    });

    // ─── Registrar Undo (la restauración también mantiene coherencia) ───
    UndoManager.push(
        prevRemoveAtt,
        `Eliminación de ${emp?.name || empId} (${dateStr})`,
        () => {
            if (prevRemoveAtt) state.attendance[key] = prevRemoveAtt;
            invalidateEmployeeStats(empId);
            buildAttendanceIndex(dateStr);
        }
    );

    // El repintado lo agenda batchSetState al cerrar; se elimina la llamada manual.
    saveApplicationData({ dateKey: dateStr });
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
        loading.dismiss();
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

            // 🛡️ FIX: en el modelo migrado (schemaVersion>=2) los empleados/cargos/
            // líderes viven en subcolecciones per-doc, NO en data/current (que los
            // tiene vacíos). Leerlos de la fuente correcta; si no, caer al legacy.
            const sv = (typeof remoteState.settings?.schemaVersion === 'number')
                ? remoteState.settings.schemaVersion
                : (typeof remoteState.schemaVersion === 'number' ? remoteState.schemaVersion : 0);

            let remoteEmployees, remotePositions, remoteLeaders;
            if (sv >= 2) {
                // M1: en este camino de FUSIÓN (union con lo local), un fallo de
                // lectura (null) se trata como [] → no se fusiona nada remoto,
                // se conserva lo local. Nunca se blanquea.
                remoteEmployees = (await EmployeeRepository.loadAll()) ?? [];
                remotePositions = (sv >= 3) ? ((await PositionRepository.loadAll()) ?? []) : (remoteState.positions || []);
                remoteLeaders   = (sv >= 3) ? ((await LeaderRepository.loadAll())   ?? []) : (remoteState.leaders || []);
                if (state.settings && typeof state.settings === 'object') state.settings.schemaVersion = sv;
            } else {
                remoteEmployees = remoteState.employees || [];
                remotePositions = remoteState.positions || [];
                remoteLeaders   = remoteState.leaders || [];
            }

            state.employees = dedup([...state.employees, ...remoteEmployees]);
            state.positions = dedup([...state.positions, ...remotePositions]);
            state.leaders = dedup([...state.leaders, ...remoteLeaders]);

            // Reinstanciar a clases (los repos devuelven objetos planos)
            if (typeof Employee !== 'undefined') state.employees = state.employees.map(e => e instanceof Employee ? e : new Employee(e));
            if (typeof Position !== 'undefined') state.positions = state.positions.map(p => p instanceof Position ? p : new Position(p));
            if (typeof Leader !== 'undefined') state.leaders = state.leaders.map(l => l instanceof Leader ? l : new Leader(l));

            // Cargar historial completo
            const remoteAttendance = await FirebaseService.getAllAttendance();
            state.attendance = { ...state.attendance, ...remoteAttendance };
            // Merge de fechas/empleados arbitrarios → coherencia total antes del render().
            invalidateAllStats();
            buildAttendanceIndex();

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
        loading.dismiss();
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
        loading.dismiss();
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
registerLoansGlobals();
registerPettyCashGlobals();

// 🌤️ Weather: chip + panel handlers, outside-click closer, initial refresh.
//    AttendanceUI reads window.WeatherChip / WeatherChipWithPanel lazily, so
//    we expose those here as well — keeps AttendanceUI free of the import.
window.WeatherChip = WeatherChip;
window.WeatherChipWithPanel = WeatherChipWithPanel;
window.WeatherBar = WeatherBar;
registerWeatherGlobals();

// Register the real WeatherAPI.com adapter and activate it if the admin
// has configured an API key. Without a key, MockAdapter stays active.
(function _wireWeatherAdapter() {
    try {
        registerWeatherAdapter('weatherapi', WeatherApiAdapter);
        if (state.settings?.weatherApiKey) {
            setWeatherProvider(state, 'weatherapi');
        }
    } catch (err) {
        if (window.debug) window.debug.log(`Weather adapter registration: ${err.message}`);
    }
})();

// 🛡️ Surface the active Service Worker's CACHE_VERSION in state so the
//    Ajustes footer can show it next to the app version. Updates again
//    whenever a new SW activates (deploy / cache bump).
monitorSWVersion(state, render);

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
    // 🛡️ NOTE: the date-picker outside-click handler lives at line ~351 and
    // uses the current `.pill-display` / `.calendar-picker` / `.calendar-picker-popup`
    // class names. A previous duplicate handler here referenced obsolete classes
    // (`.date-display`, `.date-picker-popup`) that no longer exist, so it
    // closed the picker on the same click that opened it. Removed in favor of
    // the single canonical handler.
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
                        type="button" data-app-fn="openEmpleadosPersonal"
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
                        type="button" data-app-fn="openNomina"
                        title="Nómina">
                    <span class="bottom-nav-icon">${icons.get('payroll')}</span>
                    <span class="bottom-nav-text">Nómina</span>
                </button>
                <button class="bottom-nav-tab ${state.activeTab === 'pettycash' ? 'active' : ''}"
                        type="button" data-app-fn="changeTab" data-arg="pettycash"
                        title="Caja Chica">
                    <span class="bottom-nav-icon">${icons.get('dollar')}</span>
                    <span class="bottom-nav-text">Caja</span>
                </button>
                <button class="bottom-nav-tab ${state.activeTab === 'settings' ? 'active' : ''}"
                        type="button" data-app-fn="openAjustesGenerales"
                        title="Configuración del sistema">
                    <span class="bottom-nav-icon">${icons.get('settings')}</span>
                    <span class="bottom-nav-text">Ajustes</span>
                </button>
            </nav>`;
}

/**
 * 🏠 SIDEBAR NAVIGATION (desktop ≥1024px)
 *
 * Mirrors `BottomNavigation()` but rendered as a left-side rail. Uses the
 * same `data-app-fn="changeTab"` delegation, so every existing handler
 * (tab switching, scroll preservation, etc.) works without changes.
 *
 * Visibility is controlled entirely by CSS in `css/sidebar-shell.css`:
 *   - `body.has-sidebar` (already toggled by RenderManager)
 *   - hidden below 1024px
 *
 * Audit references: replaces the bottom-nav at desktop widths (audit
 * opportunity O1) and fixes the wasted horizontal space that the original
 * audit flagged on Asistencia.
 */
// Shortcut helpers that switch the main tab AND set the appropriate sub-tab
// in one go, so the sidebar can "deep link" into Cuentas por Cobrar /
// Calendario without the user needing two clicks.
window.openCuentasPorCobrar = () => {
    if (state) state.payrollViewMode = 'ledger';
    if (typeof window.changeTab === 'function') window.changeTab('export');
};

// 🟢 Badge de sincronización (Fase 3.2 + ajuste UX consolidado) —
// invocado desde el Header. Modo compacto: SOLO el icono, el texto va
// al tooltip (title). El estado se comunica enteramente por el icono y
// el color:
//   ✅ verde   = totalmente sincronizado.
//   🕒 ámbar  = aún sincronizando o desactualizado.
//   ❌ rojo   = error.
//   🔌 rojo   = sin conexión a Internet.
//   👤 gris   = sin sesión.
window.renderSyncStatusBadgeForHeader = () => {
    const badge = renderSyncStatusBadge({
        lastSyncedAt: SyncStatus.getLastSyncedAt(),
        hasError:     SyncStatus.hasError(),
        isAuthenticated: !!window.currentUser,
        isOnline: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
        compact: true
    });
    return `
        <button type="button"
                class="header-sync-center-btn"
                data-app-fn="openSyncCenterModal"
                aria-label="Abrir centro de sincronización"
                title="Abrir centro de sincronización">
            ${badge}
        </button>
    `;
};

// Conectar el live updater una sola vez al cargar app.js.
// Re-renderiza el badge cada 5s y en cada cambio de SyncStatus (sin trigger
// de render() global, que sería costoso).
if (typeof window !== 'undefined') {
    attachLiveBadge({
        getAuth:          () => !!window.currentUser,
        getOnline:        () => typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
        getUploadPaused:  () => SYNC_PAUSE_ENABLED && isSyncPaused(),
        compact:          true,  // El header usa modo icono-solo
        // Click en badge naranja "pausado" → confirmar y reanudar la subida.
        // Esto es la ÚNICA manera de salir del estado pausado desde la UI.
        onPausedClick: async () => {
            const confirmed = await Modal.confirm({
                title: '▶️ Reanudar subida a la nube',
                message:
                    'La subida a la nube está actualmente pausada — tus cambios locales no se ' +
                    'están enviando a Firebase ni a tus otros dispositivos.<br><br>' +
                    '¿Deseas reanudar la subida ahora? Se subirán inmediatamente todos los ' +
                    'cambios pendientes.',
                confirmText: '▶️ Sí, reanudar y subir',
                cancelText: 'Mantener pausado'
            });
            if (confirmed) {
                try {
                    await resumeCloudUpload();
                    showNotification('▶️ Subida a la nube reanudada. Sincronizando…', 'success');
                } catch (e) {
                    console.error('Error al reanudar:', e);
                    showNotification('❌ Error al reanudar la subida', 'error');
                }
            }
        }
    });
    // Cuando cambia el estado de conexión, refrescar inmediatamente.
    window.addEventListener('online',  () => SyncStatus.markSynced(SyncStatus.getLastSyncedAt() || Date.now()));
    window.addEventListener('offline', () => {
        // Forzar refresh visual sin tocar el ts real (lo dispara internalmente
        // notificando con el mismo timestamp existente).
        const ts = SyncStatus.getLastSyncedAt();
        if (ts !== null) SyncStatus.markSynced(ts);
    });
}
window.openCalendarioAjustes = () => {
    if (state) state.settingsActiveTab = 'calendar';
    if (typeof window.changeTab === 'function') window.changeTab('settings');
};

window.openDatosAjustes = () => {
    if (state) state.settingsActiveTab = 'data';
    if (typeof window.changeTab === 'function') {
        window.changeTab('settings');
    }
    // Si hay un usuario logueado en Firebase, cargar las snapshots de forma asíncrona
    if (window.currentUser && typeof FirebaseService !== 'undefined') {
        setTimeout(async () => {
            try {
                state.isLoadingSnapshots = true;
                if (typeof render === 'function') render();
                const snaps = await FirebaseService.listSnapshots();
                state.snapshots = snaps;
                state.isLoadingSnapshots = false;
                if (typeof render === 'function') render();
            } catch (e) {
                console.error('Error cargando snapshots en openDatosAjustes:', e);
                state.isLoadingSnapshots = false;
                if (typeof render === 'function') render();
            }
        }, 100);
    }
};

window.openNomina = () => {
    if (state) state.payrollViewMode = 'generator';
    if (typeof window.changeTab === 'function') window.changeTab('export');
};

window.openAjustesGenerales = () => {
    if (state) state.settingsActiveTab = 'general';
    if (typeof window.changeTab === 'function') window.changeTab('settings');
};

window.openEmpleadosPersonal = () => {
    if (state) state.employeeViewMode = 'employees';
    if (typeof window.changeTab === 'function') window.changeTab('employees');
};

window.openLideresPersonal = () => {
    if (state) state.employeeViewMode = 'leaders';
    if (typeof window.changeTab === 'function') window.changeTab('employees');
};

window.openPuestosPersonal = () => {
    if (state) state.employeeViewMode = 'positions';
    if (typeof window.changeTab === 'function') window.changeTab('employees');
};

function SidebarNavigation() {
    const t = state.activeTab;
    const cls = (...tabs) => tabs.includes(t) ? 'sidebar-item active' : 'sidebar-item';

    // Live counts for badges
    const activeEmployees = (state.employees || []).filter(e => e.active !== false).length;
    let activeLoans = 0;
    try {
        (state.employees || []).forEach(e => {
            (e.loans || []).forEach(l => { if (l.status === 'active') activeLoans++; });
        });
    } catch (_) { activeLoans = 0; }

    // "Cuentas por Cobrar" is active when on Nómina screen with the ledger sub-view
    const isCuentas = state.activeTab === 'export' && state.payrollViewMode === 'ledger';
    const cuentasCls = isCuentas ? 'sidebar-item active' : 'sidebar-item';

    // "Datos" is active when on Ajustes with the data sub-tab
    const isData = state.activeTab === 'settings' && state.settingsActiveTab === 'data';
    const dataCls = isData ? 'sidebar-item active' : 'sidebar-item';

    // "Calendario" is active when on Ajustes with the calendar sub-tab
    const isCal = state.activeTab === 'settings' && state.settingsActiveTab === 'calendar';
    const calCls = isCal ? 'sidebar-item active' : 'sidebar-item';

    // "Ajustes" (General) is active when on settings but not calendar or data
    const isAjustes = state.activeTab === 'settings' && !isCal && !isData;
    const ajustesCls = isAjustes ? 'sidebar-item active' : 'sidebar-item';

    const isPersonalActive = state.activeTab === 'employees' || state.activeTab === 'positions';

    const badge = (n) => n > 0 ? `<span class="sidebar-badge">${n}</span>` : '';

    return `<aside class="app-sidebar" aria-label="Navegación principal">
                <!-- Logo/Branding Box -->
                <div class="sidebar-brand-box" style="margin-bottom: 16px; padding: 10px; border-radius: 12px; background: #020617; border: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; height: 72px; overflow: hidden; flex-shrink: 0;">
                    <img src="feature_graphic (Custom) (1).jpeg" alt="Logo" style="max-height: 100%; max-width: 100%; object-fit: contain; border-radius: 6px;">
                </div>
                <button class="${cls('attendance')}" type="button" data-app-fn="changeTab" data-arg="attendance" aria-label="Asistencia" title="Asistencia">
                    <span class="sidebar-icon">${icons.get('attendance')}</span>
                    <span class="sidebar-label">Asistencia</span>
                    ${badge(activeEmployees)}
                </button>
                <button class="${isPersonalActive ? 'sidebar-item active' : 'sidebar-item'}" type="button" data-app-fn="openEmpleadosPersonal" aria-label="Personal" title="Personal">
                    <span class="sidebar-icon">${icons.get('personnel')}</span>
                    <span class="sidebar-label">Personal</span>
                </button>
                ${isPersonalActive ? `
                <div class="sidebar-subitems" style="padding-left: 20px; display: flex; flex-direction: column; gap: 2px; margin-top: 2px; margin-bottom: 4px;">
                    <button class="sidebar-item ${state.employeeViewMode === 'employees' || !state.employeeViewMode ? 'active' : ''}" type="button" data-app-fn="openEmpleadosPersonal" style="font-size: 13px; min-height: 36px; padding: 6px 12px;" aria-label="Empleados" title="Empleados">
                        <span class="sidebar-icon" style="font-size: 14px;">👥</span>
                        <span class="sidebar-label">Empleados</span>
                    </button>
                    <button class="sidebar-item ${state.employeeViewMode === 'leaders' ? 'active' : ''}" type="button" data-app-fn="openLideresPersonal" style="font-size: 13px; min-height: 36px; padding: 6px 12px;" aria-label="Líderes" title="Líderes">
                        <span class="sidebar-icon" style="font-size: 14px;">🔑</span>
                        <span class="sidebar-label">Líderes</span>
                    </button>
                    <button class="sidebar-item ${state.employeeViewMode === 'positions' ? 'active' : ''}" type="button" data-app-fn="openPuestosPersonal" style="font-size: 13px; min-height: 36px; padding: 6px 12px;" aria-label="Puestos" title="Puestos">
                        <span class="sidebar-icon" style="font-size: 14px;">💼</span>
                        <span class="sidebar-label">Puestos</span>
                    </button>
                </div>
                ` : ''}
                <button class="${cls('employee-report','dashboard')}" type="button" data-app-fn="changeTab" data-arg="employee-report" aria-label="Reportes" title="Reportes">
                    <span class="sidebar-icon">${icons.get('reports')}</span>
                    <span class="sidebar-label">Reportes</span>
                </button>
                <button class="${state.activeTab === 'export' && !isCuentas ? 'sidebar-item active' : 'sidebar-item'}" type="button" data-app-fn="openNomina" aria-label="Nómina" title="Nómina">
                    <span class="sidebar-icon">${icons.get('payroll')}</span>
                    <span class="sidebar-label">Nómina</span>
                </button>
                <button class="${cuentasCls}" type="button" data-app-fn="openCuentasPorCobrar" aria-label="Cuentas por Cobrar" title="Cuentas por Cobrar">
                    <span class="sidebar-icon">💳</span>
                    <span class="sidebar-label">Cuentas por Cobrar</span>
                    ${badge(activeLoans)}
                </button>
                <button class="${state.activeTab === 'pettycash' ? 'sidebar-item active' : 'sidebar-item'}" type="button" data-app-fn="changeTab" data-arg="pettycash" aria-label="Caja Chica" title="Caja Chica">
                    <span class="sidebar-icon">${icons.get('dollar')}</span>
                    <span class="sidebar-label">Caja Chica</span>
                </button>
                <div class="sidebar-divider"></div>
                <div class="sidebar-section">Sistema</div>
                <button class="${ajustesCls}" type="button" data-app-fn="openAjustesGenerales" aria-label="Ajustes" title="Ajustes">
                    <span class="sidebar-icon">${icons.get('settings')}</span>
                    <span class="sidebar-label">Ajustes</span>
                </button>
                <button class="${calCls}" type="button" data-app-fn="openCalendarioAjustes" aria-label="Calendario" title="Calendario">
                    <span class="sidebar-icon">📅</span>
                    <span class="sidebar-label">Calendario</span>
                </button>
                <button class="${dataCls}" type="button" data-app-fn="openDatosAjustes" aria-label="Datos" title="Datos">
                    <span class="sidebar-icon">${icons.get('save')}</span>
                    <span class="sidebar-label">Datos</span>
                </button>
                <div class="sidebar-foot">
                    <span class="sidebar-foot-dot"></span>
                    <div>
                        <div class="sidebar-foot-title">Sincronizado</div>
                        <div class="sidebar-foot-sub">v1.6.7 · Firebase</div>
                    </div>
                </div>
            </aside>`;
}

/**
 * 🧭 ATTENDANCE PAGE TITLE — compact contextual header above the day view.
 *
 * Renders the big "Asistencia diaria · <fecha>" h1 plus a sub-line showing
 * how many active employees there are and the default-hours setting. Hidden
 * on small screens via CSS to keep the mobile experience unchanged.
 */
function AttendancePageTitle() {
    const date = state.selectedDate instanceof Date ? state.selectedDate : new Date(state.selectedDate);
    const dateLabel = date.toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
    const dateLabelCap = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
    const activeCount = (state.employees || []).filter(e => e.active !== false).length;
    const defaultHours = state.settings?.regularHoursPerDay || 8;
    const modeLabel = state.viewMode === 'week' ? 'Semanal' : 'Diaria';
    return `<div class="page-title-row">
                <div>
                    <h1 class="page-title">Asistencia ${modeLabel.toLowerCase()} · <span class="page-title-accent">${escapeHTML(dateLabelCap)}</span></h1>
                    <div class="page-title-sub">${activeCount} trabajadores activos · Horas por defecto: <b>${defaultHours}h</b></div>
                </div>
            </div>`;
}

/**
 * 🪟 ATTENDANCE DETAIL PANEL (right column of the desktop split view)
 *
 * Phase-2 of the desktop redesign: renders a sticky right-side panel
 * with the currently-selected employee's at-a-glance info. Hidden on
 * <1024px via CSS. Used only on the Asistencia screen.
 *
 * Selection state lives in `state.selectedDetailEmployeeId`. If null
 * (first render), defaults to the first ACTIVE employee.
 */
function AttendanceDetailPanel() {
    try { return _AttendanceDetailPanelInner(); }
    catch (err) {
        // Defensive: if the detail panel throws, return an empty aside instead of
        // taking down the entire Asistencia render. The error is still logged so
        // the team can see it.
        console.error('❌ AttendanceDetailPanel falló:', err);
        return `<aside class="attendance-detail" data-error="1"></aside>`;
    }
}

function _AttendanceDetailPanelInner() {
    if (!state.employees || state.employees.length === 0) {
        return `<aside class="attendance-detail empty">
            <div class="detail-empty-state">
                <div class="detail-empty-icon">👥</div>
                <div class="detail-empty-title">Aún no hay empleados</div>
                <div class="detail-empty-sub">Crea uno desde la pestaña Personal para ver su detalle aquí.</div>
            </div>
        </aside>`;
    }

    // Resolve the selected employee — fall back to first active, then first.
    const selId = state.selectedDetailEmployeeId;
    let emp = selId ? state.employees.find(e => e.id === selId) : null;
    if (!emp) emp = state.employees.find(e => e.active !== false) || state.employees[0];

    // Normalise positions array (older records may only have positionId)
    if (!emp.positions) emp.positions = emp.positionId ? [emp.positionId] : [];

    // ----- Build position chips -----
    const positionChips = (emp.positions || []).map(pid => {
        const pos = state.positions.find(p => p.id === pid);
        if (!pos) return '';
        const color = pos.color || '#64748b';
        return `<span class="detail-pos-chip" style="color:${color};border-color:${color};">
            <span class="detail-pos-dot" style="background:${color};"></span>${escapeHTML(pos.name || 'Posición')}
        </span>`;
    }).join('');

    // ----- Compute stats over the CURRENT PAY PERIOD -----
    // Source: state.settings.payPeriod (configured in Ajustes → Calendario).
    // Range: [periodStart, periodStart + periodLength - 1]. We cap iteration
    // at the selected date so future days of the period don't pre-count.
    // If no period is configured, fall back to month-to-date silently and
    // surface a hint at the bottom of the stat grid.
    const today = state.selectedDate instanceof Date ? state.selectedDate : new Date(state.selectedDate);
    const pp = state.settings && state.settings.payPeriod;
    let rangeStart, rangeEnd, rangeMode;
    if (pp && pp.periodStart) {
        rangeStart = parseDate(pp.periodStart);
        rangeEnd = new Date(rangeStart);
        rangeEnd.setDate(rangeStart.getDate() + ((pp.periodLength || 15) - 1));
        rangeMode = 'period';
    } else {
        rangeStart = new Date(today.getFullYear(), today.getMonth(), 1);
        rangeEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        rangeMode = 'month';
    }
    // Iterate up to the earlier of (rangeEnd, today) so future days are excluded
    const iterEnd = rangeEnd < today ? rangeEnd : today;

    let periodHours = 0;
    let periodDays = 0;
    let overtimeHours = 0;
    try {
        for (let d = new Date(rangeStart); d <= iterEnd; d.setDate(d.getDate() + 1)) {
            const dk = getDateKey(new Date(d));
            const att = state.attendance[`${emp.id}-${dk}`];
            if (att && att.present) {
                periodDays++;
                periodHours += (att.hoursWorked || 0);
                const reg = state.settings?.regularHoursPerDay || 8;
                if ((att.hoursWorked || 0) > reg) overtimeHours += (att.hoursWorked - reg);
            }
        }
    } catch (e) { /* defensive */ }

    // ----- Visual summary cards: current week + period hours progress -----
    const regularHours = state.settings?.regularHoursPerDay || 8;
    const holidays = state.settings?.holidays || [];
    const firstWorkPosId = emp.positions?.[0];
    const firstWorkPos = state.positions.find(p => p.id === firstWorkPosId);
    const employeeWorkingDays = (
        emp.customWorkingDays?.[firstWorkPosId]
        || firstWorkPos?.workingDays
        || [1, 2, 3, 4, 5, 6]
    );
    const worksOnDay = (date) => {
        if (!Array.isArray(employeeWorkingDays) || employeeWorkingDays.length === 0) return true;
        return employeeWorkingDays.includes(date.getDay());
    };
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Monday
    let weekPresentDays = 0;
    let weekWorkDays = 0;
    const weekLabels = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    const weekDots = [];
    for (let i = 0; i < 7; i++) {
        const day = new Date(weekStart);
        day.setDate(weekStart.getDate() + i);
        const dk = getDateKey(day);
        const isWorkDay = worksOnDay(day) && !holidays.includes(dk);
        const att = state.attendance[`${emp.id}-${dk}`];
        const checkColor = getCheckColor(att, day);
        if (isWorkDay) weekWorkDays++;
        if (isWorkDay && att?.present) weekPresentDays++;
        weekDots.push(`
            <div class="detail-week-day ${att?.present ? `present ${checkColor}` : ''} ${!isWorkDay ? 'rest' : ''}">
                <span>${weekLabels[i]}</span>
                <i aria-hidden="true"></i>
            </div>
        `);
    }
    const weekAttendancePct = weekWorkDays > 0 ? Math.round((weekPresentDays / weekWorkDays) * 100) : 0;

    let periodTargetHours = 0;
    for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        const dk = getDateKey(new Date(d));
        if (worksOnDay(d) && !holidays.includes(dk)) periodTargetHours += regularHours;
    }
    const periodHoursPct = periodTargetHours > 0
        ? Math.min(100, Math.round((periodHours / periodTargetHours) * 100))
        : 0;

    // Approx salary based on first position tarifa × period hours.
    // TODO: if the employee worked under multiple positions in the period,
    // sum each position's rate × its own hours (per-position breakdown).
    const firstPos = state.positions.find(p => p.id === emp.positions[0]);
    const hourlyRate = (firstPos && firstPos.hourlyRate) || 0;
    const salaryEstimate = periodHours * hourlyRate;

    // Pending loan balance — sum across the employee's ACTIVE loans.
    // Inlined to avoid an import cycle; mirrors LoansService.getBalance().
    let pendingLoanBalance = 0;
    let activeLoanCount = 0;
    let nextLoanDueDate = null;
    try {
        (emp.loans || []).forEach(loan => {
            if (loan.status !== 'active') return;
            activeLoanCount++;
            const principal = Number(loan.principal || 0);
            const rate = Number(loan.interestRate || 0);
            const interest = loan.interestIncluded ? 0 : (principal * rate / 100);
            const due = principal + interest;
            const paid = (loan.payments || [])
                .filter(p => !p.voided)
                .reduce((s, p) => s + Number(p.amount || 0), 0);
            pendingLoanBalance += Math.max(0, due - paid);

            let allocated = 0;
            for (const inst of (loan.installments || [])) {
                const scheduled = Number(inst.scheduledAmount || 0);
                const upperBound = allocated + scheduled;
                if (paid >= upperBound) {
                    allocated = upperBound;
                    continue;
                }
                if (inst.dueDate && (!nextLoanDueDate || inst.dueDate < nextLoanDueDate)) {
                    nextLoanDueDate = inst.dueDate;
                }
                break;
            }
        });
        pendingLoanBalance = Math.round(pendingLoanBalance * 100) / 100;
    } catch (_) { pendingLoanBalance = 0; }
    const nextLoanDueLabel = nextLoanDueDate
        ? parseDate(nextLoanDueDate).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Sin cuota programada';

    // Format the range for display (e.g. "1 may – 21 may 2026")
    const rangeLabel = (() => {
        const optsShort = { day: 'numeric', month: 'short' };
        const optsFull = { day: 'numeric', month: 'short', year: 'numeric' };
        const sameYear = rangeStart.getFullYear() === rangeEnd.getFullYear();
        return `${rangeStart.toLocaleDateString('es', sameYear ? optsShort : optsFull)} – ${rangeEnd.toLocaleDateString('es', optsFull)}`;
    })();
    const rangeNote = rangeMode === 'period'
        ? `Período actual · ${escapeHTML(rangeLabel)}`
        : `Mes en curso · ${escapeHTML(rangeLabel)} <span style="color:#f59e0b;font-weight:600;">(configura el período en Ajustes → Calendario)</span>`;

    const detailInteractivePanel = renderAttendanceDetailWorkPanel(emp, today);

    // ----- Compose initials for avatar -----
    const initials = (emp.name || '?').split(/\s+/).map(s => s[0] || '').slice(0, 2).join('').toUpperCase();

    // ----- Status pill -----
    const isActive = emp.active !== false;
    const statusPill = isActive
        ? `<span class="detail-status-pill ok"><span class="detail-status-dot"></span>Activo</span>`
        : `<span class="detail-status-pill off"><span class="detail-status-dot"></span>Inactivo</span>`;

    // ----- Format money -----
    const money = (n) => '$' + (Number(n) || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return `<aside class="attendance-detail" data-emp-id="${emp.id}">
        <div class="detail-card">
            <div class="detail-head">
                <div class="detail-avatar">${escapeHTML(initials)}</div>
                <div class="detail-head-meta">
                    <div class="detail-name">${escapeHTML(emp.name || 'Sin nombre')}</div>
                    <div class="detail-sub">#${escapeHTML(String(emp.number || '—'))}${positionChips ? ' · ' + positionChips : ''}</div>
                </div>
                ${statusPill}
            </div>

            <div class="detail-stat-grid">
                <div class="detail-stat detail-week-stat">
                    <div class="detail-progress-title">Asistencia esta semana</div>
                    <div class="detail-week-days">
                        ${weekDots.join('')}
                    </div>
                    <div class="detail-progress-footer">
                        <span><strong>${weekPresentDays}</strong> / ${weekWorkDays} días asistidos</span>
                        <strong>${weekAttendancePct}%</strong>
                    </div>
                </div>
                <div class="detail-stat detail-hours-progress-stat">
                    <div class="detail-progress-head">
                        <div class="detail-progress-title">Horas del período</div>
                        <strong>${periodHoursPct}%</strong>
                    </div>
                    <div class="detail-hours-value">
                        <strong>${periodHours}h</strong>
                        <span>/ ${periodTargetHours}h</span>
                    </div>
                    <div class="detail-progress-track" aria-hidden="true">
                        <span style="width:${periodHoursPct}%;"></span>
                    </div>
                    <div class="detail-progress-note">Meta del período: ${periodTargetHours}h</div>
                </div>
                <div class="detail-stat detail-finance-stat salary">
                    <div class="detail-finance-icon salary" aria-hidden="true">$</div>
                    <div class="detail-finance-copy">
                    <div class="detail-stat-label">Salario (período)</div>
                    <div class="detail-stat-value ok">${money(salaryEstimate)}</div>
                    <div class="detail-stat-sub">Estimado por horas</div>
                    </div>
                </div>
                <div class="detail-stat detail-finance-stat loan">
                    <div class="detail-finance-icon loan" aria-hidden="true"><span></span></div>
                    <div class="detail-finance-copy">
                    <div class="detail-stat-label">Préstamo pendiente${activeLoanCount > 1 ? ` (${activeLoanCount})` : ''}</div>
                    <div class="detail-stat-value ${pendingLoanBalance > 0 ? 'warn' : 'muted'}">${money(pendingLoanBalance)}</div>
                    <div class="detail-stat-sub">Próx. cuota: ${escapeHTML(nextLoanDueLabel)}</div>
                    </div>
                </div>
            </div>
            <div class="detail-range-note">${rangeNote}${overtimeHours > 0 ? ` · <span style="color:#f59e0b;">⚡ ${overtimeHours}h extras</span>` : ''}</div>

            ${detailInteractivePanel}

            <div class="detail-section-title" style="display:flex;align-items:center;justify-content:space-between;">
                <span>Nota rápida (${escapeHTML(today.toLocaleDateString('es', { day: 'numeric', month: 'short' }))})</span>
                ${(state.attendance[`${emp.id}-${getDateKey(today)}`]?.notes) ? '<span style="font-size:10px;color:#10b981;text-transform:none;letter-spacing:0;">● guardada</span>' : ''}
            </div>
            <textarea class="detail-quick-note" id="detail-quick-note-${emp.id}" rows="3"
                placeholder="Anota algo sobre ${escapeHTML(emp.name.split(/\s+/)[0] || 'el empleado')} (ej. salió temprano por cita médica)…"
                data-emp-id="${emp.id}">${escapeHTML(state.attendance[`${emp.id}-${getDateKey(today)}`]?.notes || '')}</textarea>

            <div class="detail-actions">
                <button class="detail-btn ghost" type="button" data-app-fn="openEmployeeProfile" data-arg="${emp.id}">
                    📋 Ver perfil completo
                </button>
                <button class="detail-btn primary" type="button" data-app-fn="saveQuickNoteFromDetail" data-arg="${emp.id}">
                    💾 Guardar nota
                </button>
            </div>
        </div>
    </aside>`;
}

function getAttendanceDetailPositionHours(emp, att) {
    const positionIds = (emp.positions && emp.positions.length > 0)
        ? emp.positions
        : (emp.positionId ? [emp.positionId] : []);

    if (att?.positionHours?.length) {
        return positionIds.map(pid => {
            const ph = att.positionHours.find(item => item.positionId === pid);
            return {
                positionId: pid,
                hours: Number(ph?.hours || 0),
                overtimeHours: Number(ph?.overtimeHours || 0)
            };
        });
    }

    return positionIds.map((pid, idx) => ({
        positionId: pid,
        hours: idx === 0 ? Number(att?.hoursWorked || 0) : 0,
        overtimeHours: idx === 0 ? Number(att?.overtimeHours || 0) : 0
    }));
}

function renderAttendanceDetailWorkPanel(emp, selectedDate) {
    const activeTab = state.attendanceDetailPanelTab || 'calendar';
    const selectedDateKey = getDateKey(selectedDate);
    const calendarMonth = state.attendanceDetailCalendarMonth instanceof Date
        ? state.attendanceDetailCalendarMonth
        : new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const att = state.attendance[`${emp.id}-${selectedDateKey}`] || {};
    const positionHours = getAttendanceDetailPositionHours(emp, att);
    const totalHours = positionHours.reduce((sum, ph) => sum + Number(ph.hours || 0), 0);
    const totalOvertime = positionHours.reduce((sum, ph) => sum + Number(ph.overtimeHours || 0), 0);
    const selectedLabel = selectedDate.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });

    const tabButton = (tab, label) => `
        <button type="button"
                class="detail-panel-tab ${activeTab === tab ? 'active' : ''}"
                data-app-fn="setAttendanceDetailPanelTab"
                data-arg="${tab}">
            ${label}
        </button>
    `;

    const calendarContent = CalendarView({
        employee: emp,
        month: calendarMonth,
        navAction: 'changeAttendanceDetailMonth',
        selectedDate,
        selectAction: 'selectAttendanceDetailDate',
        showLegend: false
    });

    const hoursContent = `
        <div class="detail-hours-editor" data-emp-id="${emp.id}">
            <div class="detail-hours-editor-head">
                <div>
                    <span>Fecha activa</span>
                    <strong>${escapeHTML(selectedLabel)}</strong>
                </div>
                <span class="detail-hours-state ${att.present ? 'present' : 'absent'}">
                    ${att.present ? 'Con asistencia' : 'Sin asistencia'}
                </span>
            </div>

            <div class="detail-position-hours-list">
                ${positionHours.length ? positionHours.map(ph => {
                    const pos = state.positions.find(p => p.id === ph.positionId);
                    const color = pos?.color || '#06b6d4';
                    const positionSalary = pos?.salaryConfig?.amount ?? pos?.baseSalary ?? 0;
                    const config = pos?.salaryConfig || { amount: positionSalary, period: 'month', workDays: [] };
                    const display = payrollService.formatSalaryDisplay(config);
                    return `
                        <div class="detail-position-hours-card" style="--pos-color:${color};">
                            <div class="detail-position-hours-title">
                                <span class="detail-position-hours-dot"></span>
                                <strong>${escapeHTML(pos?.name || 'Posición')}</strong>
                                <small>${escapeHTML(display.full || '')}</small>
                            </div>
                            <div class="detail-position-hours-fields">
                                <label>
                                    <span>Horas</span>
                                    <input type="number" inputmode="decimal" min="0" max="24" step="0.5"
                                           data-detail-hours-input="hours"
                                           data-position-id="${ph.positionId}"
                                           value="${Number(ph.hours || 0)}"
                                           oninput="updateAttendanceDetailHoursTotal('${emp.id}')">
                                </label>
                                <label>
                                    <span>Extras</span>
                                    <input type="number" inputmode="decimal" min="0" max="12" step="0.5"
                                           data-detail-hours-input="overtime"
                                           data-position-id="${ph.positionId}"
                                           value="${Number(ph.overtimeHours || 0)}"
                                           oninput="updateAttendanceDetailHoursTotal('${emp.id}')">
                                </label>
                            </div>
                        </div>
                    `;
                }).join('') : `
                    <div class="detail-hours-empty">
                        Este empleado no tiene posiciones asignadas.
                    </div>
                `}
            </div>

            <div class="detail-hours-total-card">
                <div>
                    <span>Total de horas</span>
                    <strong id="detail-hours-total-${emp.id}">${totalHours.toFixed(1)}h</strong>
                </div>
                <div>
                    <span>Extras</span>
                    <strong id="detail-hours-overtime-${emp.id}">${totalOvertime.toFixed(1)}h</strong>
                </div>
            </div>

            <button class="detail-btn primary detail-hours-save" type="button"
                    data-app-fn="saveAttendanceDetailHours"
                    data-arg="${emp.id}">
                Guardar horas del día
            </button>
        </div>
    `;

    return `
        <div class="detail-tabbed-panel">
            <div class="detail-panel-tabs" role="tablist" aria-label="Detalle de asistencia">
                ${tabButton('calendar', 'Calendario')}
                ${tabButton('hours', 'Horas del día')}
            </div>
            <div class="detail-panel-body ${activeTab === 'calendar' ? 'is-calendar' : 'is-hours'}">
                ${activeTab === 'calendar' ? calendarContent : hoursContent}
            </div>
        </div>
    `;
}

window.setAttendanceDetailPanelTab = (tab) => {
    state.attendanceDetailPanelTab = tab === 'hours' ? 'hours' : 'calendar';
    if (typeof window.render === 'function') window.render();
};

window.changeAttendanceDetailMonth = (delta) => {
    const base = state.attendanceDetailCalendarMonth instanceof Date
        ? new Date(state.attendanceDetailCalendarMonth)
        : new Date(state.selectedDate);
    base.setMonth(base.getMonth() + Number(delta || 0));
    state.attendanceDetailCalendarMonth = base;
    if (typeof window.render === 'function') window.render();
};

window.selectAttendanceDetailDate = (dateKey) => {
    if (!dateKey) return;
    const selected = parseDate(dateKey);
    state.selectedDate = selected;
    state.attendanceDetailCalendarMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
    state.attendanceDetailPanelTab = 'hours';
    if (typeof window.render === 'function') window.render();
};

window.updateAttendanceDetailHoursTotal = (empId) => {
    const root = document.querySelector(`.detail-hours-editor[data-emp-id="${empId}"]`);
    if (!root) return;
    let totalHours = 0;
    let totalOvertime = 0;
    root.querySelectorAll('[data-detail-hours-input="hours"]').forEach(input => {
        totalHours += Number.parseFloat(input.value) || 0;
    });
    root.querySelectorAll('[data-detail-hours-input="overtime"]').forEach(input => {
        totalOvertime += Number.parseFloat(input.value) || 0;
    });
    const totalEl = document.getElementById(`detail-hours-total-${empId}`);
    const overtimeEl = document.getElementById(`detail-hours-overtime-${empId}`);
    if (totalEl) totalEl.textContent = `${totalHours.toFixed(1)}h`;
    if (overtimeEl) overtimeEl.textContent = `${totalOvertime.toFixed(1)}h`;
};

window.saveAttendanceDetailHours = (empId) => {
    const emp = state.employees.find(e => e.id === empId);
    const root = document.querySelector(`.detail-hours-editor[data-emp-id="${empId}"]`);
    if (!emp || !root) return;

    const dateKey = getDateKey(state.selectedDate);
    const key = `${emp.id}-${dateKey}`;
    const existing = state.attendance[key] || {};
    const positionHours = [];
    let totalHours = 0;
    let totalOvertime = 0;

    (emp.positions || []).forEach(pid => {
        const hoursInput = root.querySelector(`[data-detail-hours-input="hours"][data-position-id="${pid}"]`);
        const overtimeInput = root.querySelector(`[data-detail-hours-input="overtime"][data-position-id="${pid}"]`);
        const hours = Number.parseFloat(hoursInput?.value) || 0;
        const overtimeHours = Number.parseFloat(overtimeInput?.value) || 0;
        if (hours > 0 || overtimeHours > 0) {
            positionHours.push({ positionId: pid, hours, overtimeHours });
            totalHours += hours;
            totalOvertime += overtimeHours;
        }
    });

    // ⚡ Fase 4 Paso 5: batchear el write + la coherencia → 1 repintado (antes: el del
    // set-trap + el manual del final). FINANCIERO: hoursWorked/present alimentan stats,
    // la coherencia va DENTRO del batch para que el repintado del cierre lea statsCache fresco.
    stateManager.batchSetState(() => {
        state.attendance[key] = {
            ...existing,
            employeeId: emp.id,
            date: dateKey,
            present: totalHours > 0 || totalOvertime > 0,
            hoursWorked: totalHours,
            overtimeHours: totalOvertime,
            positionHours,
            multiPosition: positionHours.length > 1,
            selectedPosition: positionHours[0]?.positionId || emp.positions?.[0] || null,
            isHoliday: isDayHoliday(state.selectedDate, state.settings?.holidays),
            notes: existing.notes || '',
            updatedAt: Date.now(),
            lastAccessed: Date.now(),
            _isDirty: true
        };
        invalidateEmployeeStats(emp.id);
        buildAttendanceIndex(dateKey);
    });

    // El repintado lo agenda batchSetState al cerrar; se elimina la llamada manual.
    if (typeof saveApplicationData === 'function') saveApplicationData({ dateKey });
    if (window.showNotification) window.showNotification('Horas del día guardadas', 'success');
};

// Save handler for the quick-note textarea inside the AttendanceDetailPanel.
// Reads the textarea by id, upserts the note onto the attendance record for
// the currently-selected date, and persists. Reuses the existing notes
// data model so the note shows up in the rest of the app (Notes Center,
// employee profile, etc.) without any extra wiring.
window.saveQuickNoteFromDetail = (empId) => {
    if (!empId || !state) return;
    const ta = document.getElementById(`detail-quick-note-${empId}`);
    if (!ta) return;
    const text = (ta.value || '').trim();
    const dateKey = getDateKey(state.selectedDate);
    const key = `${empId}-${dateKey}`;
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return;

    if (!text) {
        // Empty textarea = clear the note (if any existed).
        if (state.attendance[key]) {
            state.attendance[key].notes = '';
            state.attendance[key].updatedAt = Date.now();
            state.attendance[key]._isDirty = true;
        }
    } else {
        const existing = state.attendance[key] || {
            employeeId: empId,
            date: dateKey,
            present: false,
            hoursWorked: 0,
            overtimeHours: 0,
            isHoliday: false,
            selectedPosition: emp.positions?.[0] || null,
            multiPosition: false,
            positionHours: [],
            notes: ''
        };
        existing.notes = text;
        existing.updatedAt = Date.now();
        existing._isDirty = true;
        state.attendance[key] = existing;
    }
    // El upsert puede CREAR un registro → debe entrar al índice (igual que
    // NotesController). Las notas no tocan stats, pero la invalidación es
    // idempotente y mantiene uniforme el patrón "escritura → coherencia".
    invalidateEmployeeStats(empId);
    buildAttendanceIndex(dateKey);

    // Toast honesto con el resultado real del guardado (local/nube).
    const _noteLabel = text ? 'Nota guardada' : 'Nota eliminada';
    if (typeof saveApplicationData === 'function') saveApplicationData({ announce: _noteLabel });
    if (typeof window.render === 'function') window.render();
};

// ⚡ Click delegation: select an employee for the right detail panel when the
// user clicks on a row body (not on any interactive child). Selection updates
// `state.selectedDetailEmployeeId` and triggers a re-render. Cheap because
// DOMDiff only patches the changed parts.
if (!window._detailSelectionDelegationAttached) {
    document.addEventListener('click', (e) => {
        // Skip if the click was on something interactive — let that handler run.
        if (e.target.closest('button, input, a, select, textarea, [data-att-action], [data-app-fn], [data-app-action]')) return;
        const row = e.target.closest('.employee-row');
        if (!row) return;
        const m = row.id && row.id.match(/^emp-row-(.+)$/);
        if (!m) return;
        if (state.selectedDetailEmployeeId === m[1]) return; // no-op
        state.selectedDetailEmployeeId = m[1];
        window.render?.();
    });
    window._detailSelectionDelegationAttached = true;
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
    if (DOMDiff && typeof DOMDiff.patchSelf === 'function') {
        DOMDiff.patchSelf(rowEl, newHTML);
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

    if (DOMDiff && typeof DOMDiff.patchSelf === 'function') {
        DOMDiff.patchSelf(rowEl, newHTML);
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

    if (DOMDiff && typeof DOMDiff.patchSelf === 'function') {
        DOMDiff.patchSelf(totalsEl, newHTML);
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

window.openAttendanceLayoutModal = () => {
    state.modalType = 'attendance-layout';
    state.showModal = true;
    render();
};

window.setAttendanceListColumns = (columns) => {
    const nextColumns = Number(columns) === 2 ? 2 : 1;
    state.attendanceListColumns = nextColumns;
    state.showModal = false;
    state.modalType = null;
    render();
};

window.setAttendanceCardSize = (mode) => {
    state.listDisplayMode = mode === 'compact' ? 'compact' : 'relaxed';
    state.showModal = false;
    state.modalType = null;
    render();
};

window.openSyncCenterModal = () => {
    state.modalType = 'sync-center';
    state.showModal = true;
    render();
};

// ⏸️ Toggle de pausa de subida a la nube desde el centro de sincronización.
// A diferencia del badge naranja (que solo reanuda), este switch activa Y
// desactiva la pausa, y deja el modal abierto para que el usuario vea el
// nuevo estado reflejado inmediatamente en el switch.
window.syncCenterTogglePause = async () => {
    try {
        if (isSyncPaused()) {
            await resumeCloudUpload();
            showNotification('▶️ Subida a la nube reanudada. Sincronizando…', 'success');
        } else {
            await pauseCloudUpload('Usuario activó la pausa desde el centro de sincronización.');
            showNotification('⏸️ Subida a la nube pausada. Tus cambios quedan solo en este equipo.', 'info');
        }
    } catch (e) {
        console.error('Error al cambiar el estado de pausa:', e);
        showNotification('❌ No se pudo cambiar el estado de la pausa', 'error');
    }
    render();
};

window.syncCenterToggleDownloadPause = async () => {
    try {
        if (isDownloadPaused()) {
            await resumeCloudDownload();
            showNotification('▶️ Descarga de la nube reanudada. Sincronizando…', 'success');
            // Forzar re-sync para traer los cambios que llegaron mientras estaba pausado.
            await window.syncFirebaseNow?.();
        } else {
            await pauseCloudDownload('Usuario activó la pausa desde el centro de sincronización.');
            showNotification('⏸️ Descarga pausada. Los cambios de la nube no se aplicarán en este equipo.', 'info');
        }
    } catch (e) {
        console.error('Error al cambiar el estado de pausa de descarga:', e);
        showNotification('❌ No se pudo cambiar el estado de la pausa de descarga', 'error');
    }
    render();
};

window.syncCenterSyncNow = async () => {
    state.showModal = false;
    state.modalType = null;
    render();
    await window.syncFirebaseNow?.();
};

window.syncCenterUploadToCloud = async () => {
    state.showModal = false;
    state.modalType = null;
    render();
    await window.uploadToCloud?.();
};

window.syncCenterDownloadFromCloud = async () => {
    state.showModal = false;
    state.modalType = null;
    render();
    await window.downloadFromCloud?.();
};

window.syncCenterCreateSnapshot = async () => {
    state.showModal = false;
    state.modalType = null;
    render();
    await window.createFirebaseSnapshot?.('manual');
};

window.syncCenterOpenBackups = () => {
    state.showModal = false;
    state.modalType = null;
    window.openDatosAjustes?.();
};

window.syncCenterResolveConflicts = () => {
    state.showModal = false;
    state.modalType = null;
    render();
    window.startMaintenanceWizard?.();
};

window.syncCenterOpenSettings = () => {
    state.showModal = false;
    state.modalType = null;
    if (state) state.settingsActiveTab = 'data';
    window.changeTab?.('settings');
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

function AttendanceLayoutModal() {
    const currentColumns = Number(state.attendanceListColumns) === 2 ? 2 : 1;
    const currentCardSize = state.listDisplayMode === 'compact' ? 'compact' : 'relaxed';
    const columnOption = (columns, title, description, icon) => `
        <button type="button"
                class="attendance-layout-option ${currentColumns === columns ? 'active' : ''}"
                data-app-fn="setAttendanceListColumns"
                data-arg="${columns}">
            <span class="attendance-layout-option-icon">${icon}</span>
            <span class="attendance-layout-option-text">
                <strong>${title}</strong>
                <small>${description}</small>
            </span>
            <span class="attendance-layout-option-check">${currentColumns === columns ? '✓' : ''}</span>
        </button>
    `;
    const sizeOption = (mode, title, description, icon) => `
        <button type="button"
                class="attendance-layout-option ${currentCardSize === mode ? 'active' : ''}"
                data-app-fn="setAttendanceCardSize"
                data-arg="${mode}">
            <span class="attendance-layout-option-icon">${icon}</span>
            <span class="attendance-layout-option-text">
                <strong>${title}</strong>
                <small>${description}</small>
            </span>
            <span class="attendance-layout-option-check">${currentCardSize === mode ? '✓' : ''}</span>
        </button>
    `;

    return `
        <div class="modal-overlay attendance-layout-overlay" data-app-close-on-self="close-modal">
            <div class="attendance-layout-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-layout-title">
                <div class="attendance-layout-header">
                    <div>
                        <h2 id="attendance-layout-title">Vista de empleados</h2>
                        <p>Elige la distribución y el tamaño de las tarjetas.</p>
                    </div>
                    <button type="button" class="attendance-layout-close" data-app-fn="close-modal" aria-label="Cerrar">×</button>
                </div>
                <div class="attendance-layout-section-title">Distribución</div>
                <div class="attendance-layout-options">
                    ${columnOption(1, 'Una columna', 'Formato actual, cómodo para revisar detalles.', '▤')}
                    ${columnOption(2, 'Dos columnas', 'Muestra más empleados a la vez en pantallas anchas.', '⊞')}
                </div>
                <div class="attendance-layout-section-title">Tamaño de tarjeta</div>
                <div class="attendance-layout-options">
                    ${sizeOption('relaxed', 'Normal', 'Tarjetas amplias con posiciones, notas y más contexto.', '▣')}
                    ${sizeOption('compact', 'Reducida', 'Filas más pequeñas para ver más personal sin desplazarte tanto.', '≡')}
                </div>
            </div>
        </div>
    `;
}

function SyncCenterModal() {
    const lastSyncedAt = SyncStatus.getLastSyncedAt();
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    const hasUser = !!window.currentUser;
    const userLabel = window.currentUser?.displayName || window.currentUser?.email || 'Sin sesión';
    const lastSyncLabel = lastSyncedAt
        ? new Date(lastSyncedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
        : 'Aún no sincronizado';
    const stateLabel = !isOnline
        ? 'Sin conexión'
        : !hasUser
            ? 'Sin sesión'
            : state.syncStatus === 'syncing'
                ? 'Sincronizando'
                : state.syncStatus === 'error'
                    ? 'Error'
                    : lastSyncedAt
                        ? 'Sincronizado'
                        : 'Pendiente';

    const isPaused = SYNC_PAUSE_ENABLED && isSyncPaused();
    const isDownloadPausedNow = isDownloadPaused();

    const action = (fn, icon, title, description, extraClass = '') => `
        <button type="button" class="sync-center-action ${extraClass}" data-app-fn="${fn}">
            <span class="sync-center-action-icon">${icon}</span>
            <span class="sync-center-action-copy">
                <strong>${title}</strong>
                <small>${description}</small>
            </span>
        </button>
    `;

    return `
        <div class="modal-overlay sync-center-overlay" data-app-close-on-self="close-modal">
            <div class="sync-center-modal" role="dialog" aria-modal="true" aria-labelledby="sync-center-title">
                <div class="sync-center-header">
                    <div>
                        <h2 id="sync-center-title">Sincronización</h2>
                        <p>Controla la nube, respaldos y conflictos desde un solo lugar.</p>
                    </div>
                    <button type="button" class="sync-center-close" data-app-fn="close-modal" aria-label="Cerrar">×</button>
                </div>

                <div class="sync-center-status">
                    <div>
                        <span>Estado</span>
                        <strong>${escapeHTML(stateLabel)}</strong>
                    </div>
                    <div>
                        <span>Última sincronización</span>
                        <strong>${escapeHTML(lastSyncLabel)}</strong>
                    </div>
                    <div>
                        <span>Cuenta</span>
                        <strong>${escapeHTML(userLabel)}</strong>
                    </div>
                </div>

                <div class="sync-pause-switches">
                    <button type="button"
                            class="sync-pause-row ${isPaused ? 'is-paused' : ''}"
                            role="switch"
                            aria-checked="${!isPaused}"
                            aria-label="Subida a la nube (activada = sincroniza con tus dispositivos)"
                            data-app-fn="syncCenterTogglePause">
                        <span class="sync-pause-copy">
                            <strong>${isPaused ? '⏸️ Subida a la nube pausada' : '☁️ Subida a la nube activa'}</strong>
                            <small>${isPaused
                                ? 'Tus cambios se guardan en este equipo pero NO se envían a tus otros dispositivos.'
                                : 'Tus cambios se sincronizan automáticamente con la nube y tus otros dispositivos.'}</small>
                        </span>
                        <span class="sync-pause-switch" aria-hidden="true">
                            <span class="sync-pause-switch-handle"></span>
                        </span>
                    </button>

                    <button type="button"
                            class="sync-pause-row ${isDownloadPausedNow ? 'is-paused' : ''}"
                            role="switch"
                            aria-checked="${!isDownloadPausedNow}"
                            aria-label="Descarga de la nube (activada = recibe cambios de otros dispositivos)"
                            data-app-fn="syncCenterToggleDownloadPause">
                        <span class="sync-pause-copy">
                            <strong>${isDownloadPausedNow ? '⏸️ Descarga de la nube pausada' : '📥 Descarga de la nube activa'}</strong>
                            <small>${isDownloadPausedNow
                                ? 'Los cambios de otros dispositivos NO se aplican en este equipo.'
                                : 'Los cambios de la nube se aplican automáticamente en este equipo.'}</small>
                        </span>
                        <span class="sync-pause-switch" aria-hidden="true">
                            <span class="sync-pause-switch-handle"></span>
                        </span>
                    </button>
                </div>

                <div class="sync-center-actions primary">
                    ${action('syncCenterSyncNow', '↻', 'Sincronizar ahora', 'Guarda y refresca los datos con la nube.')}
                    ${action('syncCenterUploadToCloud', '↑', 'Subir a la nube', 'Usa este equipo como fuente principal.')}
                    ${action('syncCenterDownloadFromCloud', '↓', 'Descargar de la nube', 'Trae la versión remota a este equipo.')}
                    ${action('syncCenterCreateSnapshot', '●', 'Crear punto de respaldo', 'Guarda una copia manual del estado actual.')}
                </div>

                <div class="sync-center-actions secondary">
                    ${action('syncCenterOpenBackups', '◷', 'Respaldos y restauración', 'Ver snapshots y recuperar versiones anteriores.', 'secondary')}
                    ${action('syncCenterResolveConflicts', '≋', 'Resolver conflictos', 'Revisar duplicados y datos inconsistentes.', 'secondary')}
                    ${action('syncCenterOpenSettings', '⚙', 'Configurar sincronización', 'Abrir los ajustes de datos y nube.', 'secondary')}
                </div>
            </div>
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
    const companyNameElement = document.getElementById('companyName');
    const companyName = companyNameElement ? companyNameElement.value.trim() : state.settings.companyName;

    const regularHoursPerDayElement = document.getElementById('regularHoursPerDay');
    const regularHoursPerDay = regularHoursPerDayElement ? parseFloat(regularHoursPerDayElement.value) : state.settings.regularHoursPerDay;

    const overtimeFactorElement = document.getElementById('overtimeFactor');
    const overtimeFactor = overtimeFactorElement ? parseFloat(overtimeFactorElement.value) : state.settings.overtimeFactor;

    const holidayFactorElement = document.getElementById('holidayFactor');
    const holidayFactor = holidayFactorElement ? parseFloat(holidayFactorElement.value) : state.settings.holidayFactor;

    // ⚡ Leer configuración de nómina
    const defaultDeductionPercentageElement = document.getElementById('defaultDeductionPercentage');
    const defaultDeductionPercentage = defaultDeductionPercentageElement ? (parseFloat(defaultDeductionPercentageElement.value) || 2) : (state.settings.defaultDeductionPercentage || 2);
    const iconSet = document.getElementById('iconSet')?.value || state.settings.iconSet;

    // Leer toggle legacy
    const legacyNavigationElement = document.getElementById('legacyNavigation');
    const legacyNavigation = legacyNavigationElement ? legacyNavigationElement.checked : !!state.settings.legacyNavigation;
    const scrollbarMode = document.getElementById('scrollbarMode')?.value || state.settings.scrollbarMode;
    const hideDuplicateAlertsElement = document.getElementById('hideDuplicateAlerts');
    const hideDuplicateAlerts = hideDuplicateAlertsElement ? hideDuplicateAlertsElement.checked : !!state.settings.hideDuplicateAlerts;
    const weatherEnabledElement = document.getElementById('weatherEnabled');
    const weatherEnabled = weatherEnabledElement ? weatherEnabledElement.checked : state.settings.weatherEnabled === true;
    const weatherApiKeyElement = document.getElementById('weatherApiKey');
    const weatherApiKey = weatherApiKeyElement ? weatherApiKeyElement.value.trim() : (state.settings.weatherApiKey || '');
    const weatherLocationInputElement = document.getElementById('weatherLocationInput');
    const weatherLocationRaw = weatherLocationInputElement ? weatherLocationInputElement.value.trim() : (state.settings.weatherLocationRaw || '');

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

    let weatherLocation = null;
    if (weatherEnabled && weatherLocationRaw) {
        const cleanLoc = weatherLocationRaw.replace(/^@/, '');
        const match = cleanLoc.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
        if (match) {
            const lat = parseFloat(match[1]);
            const lon = parseFloat(match[2]);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                    showNotification('❌ Coordenadas fuera de rango (Latitud: -90 a 90, Longitud: -180 a 180)', 'error');
                    return;
                }
                weatherLocation = { lat, lon, name: 'Ubicación Personalizada' };
            }
        }
        if (!weatherLocation) {
            showNotification('❌ Formato de coordenadas inválido. Debe ser: Latitud, Longitud (ej: 18.47, -69.89)', 'error');
            return;
        }
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
    state.settings.weatherEnabled = weatherEnabled;

    // Guardar ubicación y limpiar caché si cambia
    const prevLocRaw = state.settings.weatherLocationRaw || '';
    state.settings.weatherLocationRaw = weatherLocationRaw;
    state.settings.weatherLocation = weatherLocation;

    if (weatherLocationRaw !== prevLocRaw) {
        if (state.weather?.cache) {
            state.weather.cache.current = null;
            state.weather.cache.forecast = null;
            state.weather.cache.hourly = null;
            state.weather.cache.alerts = null;
        }
    }

    // Weather API key: cambiar provider segun presencia de key
    const prevKey = state.settings.weatherApiKey || '';
    state.settings.weatherApiKey = weatherApiKey;
    if (weatherApiKey && weatherApiKey !== prevKey) {
        // Key nueva o cambiada: activar adapter real e invalidar cache
        try {
            setWeatherProvider(state, 'weatherapi');
        } catch (_e) { /* adapter no registrado — no deberia pasar */ }
    } else if (!weatherApiKey && prevKey) {
        // Key eliminada: volver a mock
        try {
            setWeatherProvider(state, 'mock');
        } catch (_e) { /* siempre registrado */ }
    }
    state.settings.updatedAt = Date.now();
    state.settings._isDirty = true;

    // Toast honesto: verde solo si de verdad se guardó (local + nube).
    saveApplicationData({ announce: 'Configuración guardada' });
    render();
};

// ============================================
// GESTIÓN DE DATOS: EXPORTAR, IMPORTAR, ELIMINAR
// ============================================

window.exportData = async function () {
    try {
        // 💵 M3: incluir la caja chica en el backup. Se lee de PettyCashStore
        // (IndexedDB, la verdad durable) y NO de state.pettyCash, que puede
        // no estar cargado si nunca se abrió la pestaña en esta sesión.
        // sanitize garantiza que solo van datos (sin form/fotos/estado UI).
        let pettyCashBackup = null;
        try {
            pettyCashBackup = sanitizePettyCashForSnapshot(await PettyCashStore.loadLocal());
        } catch (e) {
            console.warn('⚠️ exportData: no se pudo leer caja chica (se exporta sin ella):', e);
        }

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
                dayHoursConfig: state.dayHoursConfig || {},
                ...(pettyCashBackup ? { pettyCash: pettyCashBackup } : {})
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
window.createFirebaseSnapshot = async function (type = 'auto', reason = null) {
    if (!window.currentUser) return null;
    try {
        const id = await FirebaseService.createSnapshot(state, type, reason);
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

        // Reemplazo total del dataset (+ normalización + sanitización ya aplicadas) →
        // coherencia explícita antes de persistir/render. invalidateAllStats() subsume
        // la invalidación que pediría sanitizePositions (limpia TODO el statsCache).
        invalidateAllStats();
        buildAttendanceIndex();

        // Guardar en IndexedDB
        await saveToIndexedDB({ clearFirst: true });

        // 💵 M3: restaurar la caja chica si el backup la trae (formato nuevo).
        // Backups viejos sin pettyCash: los stores locales quedan intactos
        // (clearFirst ya no los toca) — no se destruye lo que el archivo no
        // puede restaurar.
        if (data.pettyCash && typeof data.pettyCash === 'object') {
            try {
                await PettyCashStore.applyRemote('projects', data.pettyCash.projects || []);
                await PettyCashStore.applyRemote('periods', data.pettyCash.periods || []);
                await PettyCashStore.applyRemote('movements', data.pettyCash.movements || []);
                console.log('💵 Caja chica restaurada desde el backup');
            } catch (e) {
                console.warn('⚠️ No se pudo restaurar la caja chica del backup:', e);
            }
        }

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

window.exportPDF = async function () {
    try {
        // ⚡ Lazy-load jsPDF + auto-table plugin on first PDF export (Sprint 5).
        await ensureJsPDFLoaded();
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

window.exportImage = async function () {
    try {
        // Buscar el contenedor del gráfico actual
        const chartContainer = document.querySelector('.dashboard-container');

        if (!chartContainer) {
            showNotification('❌ No hay contenido para exportar', 'error');
            return;
        }

        showNotification('📸 Generando imagen...', 'info');

        // ⚡ Lazy-load html2canvas on first image export (Sprint 5).
        await ensureHtml2CanvasLoaded();
        window.html2canvas(chartContainer, {
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
        'attendance': () => {
            // Split view (day view only — week view already uses full width).
            // CSS in sidebar-shell.css makes this a 6fr/4fr grid at ≥1024px
            // and stacks vertically (with the detail panel hidden) below.
            const pageHeader = AttendancePageTitle();
            if (state.viewMode === 'week') return `${pageHeader}${AttendanceTab()}`;
            return `${pageHeader}<div class="attendance-split"><div class="attendance-main">${AttendanceTab()}</div>${AttendanceDetailPanel()}</div>`;
        },
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
        'pettycash': () => PettyCashTab(),
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
        'multi-position': () => '',
        'attendance-layout': () => AttendanceLayoutModal(),
        'sync-center': () => SyncCenterModal()
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
    })}${state.settings.legacyNavigation ? '' : SidebarNavigation()}<main class="main-content" ${state.settings.legacyNavigation ? 'style="padding-bottom: 24px;"' : ''}><div class="container">${content}</div></main>${state.settings.legacyNavigation ? '' : BottomNavigation()}${!state.settings.legacyNavigation ? '<button type="button" class="landscape-toggle-btn" data-app-fn="toggleBottomNav" aria-label="Mostrar/Ocultar Menú">☰</button>' : ''}${employeeFloatingCard.render()}${EmployeeProfileModal()}${modal}${ContextMenu()}${ExportMenu()}${ImportFullModal()}${NotesCenter()}${NoteEditorModal()}`;
}

// 🎯 Registrar el componente raíz para el motor modular
setRootComponent(App);

// ⚡ Header height tracking: read once + listen to resize (debounced) instead
// of reading offsetHeight on every render. Old approach caused ~1.9s of forced
// reflow during initial load (Sprint 5 profiling).
setupHeaderHeightObserver();

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

// ⚡ The window.resize listener for header offset is now installed by
// setupHeaderHeightObserver() above (debounced, observes the header element
// directly via ResizeObserver). Removed the unthrottled duplicate that used
// to live here.

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
// 🛡️ PROMPT POST-SANEAMIENTO
// ============================================

/**
 * Muestra un Modal.confirm si loadApplicationData encontró y corrigió
 * referencias huérfanas o IDs faltantes en los datos locales.
 *
 * Debe llamarse DESPUÉS de que el primer sync de Firebase se complete
 * (isInitialLoad = false) para que el usuario tome la decisión con los
 * datos ya mergeados y la UI lista.
 *
 * Si no hay usuario autenticado, limpia el flag silenciosamente.
 */
async function _checkSanitizationCloudSyncPrompt() {
    if (!state._pendingSanitizationCloudSync) return;

    const count = state._pendingSanitizationCloudSync;
    delete state._pendingSanitizationCloudSync;

    if (!globalThis.currentUser) {
        // No hay sesión → no se puede subir a la nube. Flag ya limpiado.
        return;
    }

    const confirmed = await Modal.confirm({
        title: '🛡️ Saneamiento de datos completado',
        message:
            `Al cargar, se encontraron y corrigieron <strong>${count}</strong> elemento(s) en ` +
            `tus datos locales (IDs faltantes, referencias huérfanas).<br><br>` +
            `¿Deseas subir estas correcciones a la nube ahora?`,
        confirmText: '☁️ Subir a la nube',
        cancelText: 'Solo mantener local'
    });

    if (confirmed) {
        saveApplicationData({ force: true });
        showNotification('☁️ Correcciones de integridad subidas a la nube', 'success');
    }
}

// ============================================
// ⚠️ OUTGOING CONFLICT GUARD
// ============================================

/**
 * Registra el listener de conflictos salientes (cloud más reciente que local).
 *
 * PersistenceService emite 'sync:outgoing-conflict' cuando detecta que la
 * nube tiene un timestamp más reciente que el estado local y se está
 * intentando subir datos.  Este listener pregunta al usuario qué hacer.
 *
 * Llamado UNA sola vez desde initializeApp, después de que loadApplicationData
 * termina (para que showNotification / Modal estén disponibles).
 */
function _initOutgoingConflictGuard() {
    eventBus.on('sync:outgoing-conflict', async ({ localTime, cloudTime }) => {
        // Formatear diferencia relativa para el mensaje
        const diffMs  = Math.max(0, cloudTime - localTime);
        const diffSec = Math.round(diffMs / 1000);
        const diffStr = diffSec < 60
            ? `${diffSec} segundo${diffSec !== 1 ? 's' : ''}`
            : `${Math.round(diffSec / 60)} minuto${Math.round(diffSec / 60) !== 1 ? 's' : ''}`;

        const cloudDate = cloudTime
            ? new Date(cloudTime).toLocaleString()
            : 'desconocida';

        const confirmed = await Modal.confirm({
            title: '⚠️ La nube tiene cambios más recientes',
            message:
                `La nube tiene cambios realizados hace <strong>${diffStr}</strong> ` +
                `que son más recientes que tus datos locales ` +
                `(última actualización en la nube: ${cloudDate}).<br><br>` +
                `Si subes ahora, esos cambios serán reemplazados por tus datos locales.<br><br>` +
                `¿Deseas continuar y reemplazar los datos de la nube?`,
            confirmText: '⬆️ Sí, reemplazar nube con mis datos',
            cancelText: '← No, conservar los cambios de la nube',
            type: 'warning'
        });

        // Limpiar flag de revisión pendiente — independientemente de la decisión.
        state._outgoingConflictReviewPending = false;

        if (confirmed) {
            // Local wins: true overwrite (not merge). Deletes orphan cloud docs,
            // writes the main doc WITHOUT merge:true, so cloud-only data is removed.
            state._lastKnownCloudUpdatedAt = state.settings?.localUpdatedAt || 0;
            try {
                await FirebaseService.replaceCloudFull(state);
                showNotification('⬆️ Tus datos locales reemplazaron los de la nube', 'success');
            } catch (e) {
                console.error('Error en replaceCloudFull:', e);
                showNotification('❌ Error al reemplazar los datos de la nube', 'error');
            }
        } else {
            // Cloud wins: don't push. The existing subscribeToChanges listener
            // will handle applying the newer remote data (or the user can accept
            // the incoming-change modal if it reappears).
            showNotification('← Se conservaron los cambios de la nube', 'info');
        }
    });
}

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

        // 1.0 Activar el guard de conflictos salientes (cloud más reciente que local).
        // Se registra AQUÍ (post-load) para que Modal y showNotification ya estén listos.
        _initOutgoingConflictGuard();

        // 1.0.b Si la app arranca con la pausa activa (flag por-dispositivo en
        // localStorage), avisar al usuario de forma visible — el badge naranja
        // puede pasar desapercibido y la pausa puede venir de una sesión anterior
        // en ESTE mismo dispositivo (nunca de la nube ni de otro equipo).
        if (SYNC_PAUSE_ENABLED && isSyncPaused()) {
            // Pequeño delay para que la notificación no se pierda en el barullo de carga.
            setTimeout(() => {
                showNotification(
                    '⏸️ La subida a la nube está pausada. Haz clic en el badge naranja del header para reanudar.',
                    'warning',
                    10000
                );
            }, 1500);
        }

        // 1.1 Unificar puestos y limpiar IDs (Migración Opción A)
        if (sanitizePositions(state)) {
            // Remapeo de positionId in-place afecta positionSalaries (claves de pago por
            // puesto) → invalidar stats. Sin buildAttendanceIndex (no cambian claves/fechas).
            invalidateAllStats();
            debug.log('💾 Guardando cambios de sanitización inicial...');
            await saveApplicationData({ force: true });
            render();
        }

        // 1.2 Migrar emp.advances[] (legacy) → emp.loans[] (Sprint loans, 2026-05-20).
        // Idempotent. Only writes back to DB if at least one record was migrated.
        migrateAllAdvances();

        // 2. Aplicar configuraciones de interfaz
        state.settings.iconSet = applyIconSet(state.settings.iconSet);

        // 3. Intentar restaurar auto-backup (solo si la carga falló completamente)
        if (state.employees.length === 0) {
            debug.log('🔄 Intentando restaurar auto-backup...');
            restoreAutoBackup();
        }

        // 🔐 C2: Resolución de conflicto de dueño de datos locales.
        // Se invoca cuando inicia sesión una cuenta distinta a la que generó
        // los datos locales de este dispositivo. Dos salidas seguras:
        //   - Borrar lo local y recargar (la nube de ESTA cuenta será la verdad).
        //   - Cerrar sesión y dejar lo local intacto.
        async function handleLocalOwnerMismatch(user) {
            console.warn('🔐 Datos locales pertenecen a otra cuenta. Sincronización bloqueada hasta resolver.');
            const wipeAndContinue = await Modal.confirm({
                title: '🔐 Este dispositivo tiene datos de otra cuenta',
                message:
                    `Iniciaste sesión como <b>${escapeHTML(user.email || user.uid)}</b>, pero los datos guardados ` +
                    `en este dispositivo pertenecen a otra cuenta.<br><br>` +
                    `Para proteger ambos lados, la sincronización está pausada.<br><br>` +
                    `<b>Borrar datos locales:</b> se eliminan los datos del dispositivo y se cargan ` +
                    `los de tu cuenta desde la nube (los datos de la otra cuenta NO se tocan en su nube).<br>` +
                    `<b>Cerrar sesión:</b> todo queda como estaba.`,
                confirmText: 'Borrar datos locales y continuar',
                cancelText: 'Cerrar sesión',
                type: 'danger'
            });

            if (wipeAndContinue) {
                try {
                    await indexedDBService.clearAll();
                } catch (e) {
                    console.error('❌ Error limpiando IndexedDB en cambio de cuenta:', e);
                }
                try {
                    localStorage.removeItem('asistencia-data');
                    localStorage.removeItem('migrated-to-idb');
                    localStorage.removeItem('asistencia_pending_cloud_deletes');
                    sessionStorage.removeItem('attendance-backup');
                } catch (e) { /* noop */ }
                clearLocalOwnership();
                claimLocalOwnership(user.uid);
                showNotification('🧹 Datos locales borrados. Cargando los datos de tu cuenta...', 'info');
                setTimeout(() => location.reload(), 900);
            } else {
                await FirebaseService.logout();
                window.currentUser = null;
                showNotification('🔒 Sesión cerrada. Los datos locales quedaron intactos.', 'info');
                render();
            }
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

                // 🔐 C2 (Auditoría 2026-06-09): guard de propiedad de los datos
                // locales. Si este dispositivo tiene datos de OTRA cuenta, NO
                // arrancar ninguna sincronización: la "migración inicial" de
                // abajo subiría la nómina del dueño anterior a esta cuenta.
                const _ownership = checkLocalOwnership(user.uid, {
                    localHasData: !localStateIsEmpty(state)
                });
                if (_ownership === 'mismatch') {
                    await handleLocalOwnerMismatch(user);
                    return; // El flujo continúa tras el wipe+reload o el logout.
                }
                claimLocalOwnership(user.uid);

                // 💵 Caja chica: cargar de Firestore + arrancar live sync (idempotente).
                window.startPettyCashSync?.();

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
                FirebaseService.subscribeToChanges(async (remoteData) => {
                    debug.log('📡 Cambio detectado en la nube...');

                    // 🛡️ Guardar el timestamp de la nube para que _executeSave pueda
                    // detectar conflictos salientes (local más viejo que la nube).
                    // Se actualiza siempre, incluso si los datos se descartan más abajo.
                    state._lastKnownCloudUpdatedAt =
                        remoteData?.settings?.localUpdatedAt || state._lastKnownCloudUpdatedAt || 0;

                    // 🛡️ FIX: Si la nube tiene datos más viejos que nuestro estado local, ignorar (y re-sincronizar).
                    // Esto previene que la caché offline de Firebase (O un guardado fallido) revierta los datos al pulsar F5.
                    const remoteTime = remoteData.settings?.localUpdatedAt || 0;
                    const localTime = state.settings?.localUpdatedAt || 0;
                    // 🛡️ FIX: si el estado local está VACÍO (navegador fresco), no hay
                    // nada que proteger → aceptar la nube aunque un guardado prematuro
                    // haya estampado un localUpdatedAt más reciente. Sin esto, los
                    // empleados/cargos/líderes nunca cargaban de la subcolección.
                    const localEmpty = localStateIsEmpty(state);

                    if (!shouldAcceptRemote({ localTime, remoteTime, localEmpty })) {
                        debug.log(`🛡️ Persistencia: Nube (${remoteTime}) es más antigua que Estado Local (${localTime}). Redirigiendo...`);
                        // 🕒 H4: NO re-subimos con un saveFullState CRUDO. Ese camino
                        // salta el chequeo de conflictos salientes de _executeSave y,
                        // bajo desfase de reloj entre dispositivos, podía pisar en
                        // silencio cambios REALES del otro dispositivo (reloj lento →
                        // timestamp "viejo"). En su lugar encolamos un guardado NORMAL:
                        //   - si lo local es genuinamente más nuevo (p.ej. un save que
                        //     F5 interrumpió) → sube como siempre;
                        //   - si hay conflicto saliente real → _executeSave emite
                        //     sync:outgoing-conflict y el usuario decide (no se
                        //     sobrescribe a ciegas por reloj).
                        if (!window._forceSyncTimer) {
                            window._forceSyncTimer = setTimeout(() => {
                                saveApplicationData();
                                window._forceSyncTimer = null;
                            }, 1000);
                        }
                        return; // Ignorar estos datos obsoletos para no destruir el state local
                    }

                    // ⏸️ Pausa de descarga (device-local): ignorar datos entrantes si el usuario la activó.
                    if (isDownloadPaused()) {
                        debug.log('⏸️ Descarga pausada — cambio de la nube ignorado (dispositivo local).');
                        return;
                    }

                    // 🛡️ TRACK 2: Pre-apply hook. Si NO es la carga inicial y los
                    // cambios entrantes son significant (borrados, divergencias
                    // de campos críticos, caída de préstamos, schemaVersion
                    // bajando), pausar y pedir confirmación al usuario en lugar
                    // de aplicar a ciegas. Si los cambios son triviales (nuevos
                    // empleados, email diff, schemaVersion subiendo) → aplica
                    // silencioso como antes.
                    if (!isInitialLoad
                        && !window._isApplyingRemoteData
                        && !window._pendingIncomingReview
                    ) {
                        try {
                            const changes = detectIncomingChanges(state, remoteData);
                            const hasSignificant = changes.some(c => c.severity === 'significant');
                            if (hasSignificant) {
                                window._pendingIncomingReview = true;
                                IncomingChangeModal.show(changes, {
                                    onApply: async () => {
                                        window._pendingIncomingReview = false;
                                        try { await applyRemoteData(); }
                                        catch (e) { console.error('Error aplicando cambios entrantes:', e); }
                                    },
                                    onRejectAndPause: () => {
                                        window._pendingIncomingReview = false;
                                        debug.log('⏸️ Cambios remotos rechazados. Subida a la nube pausada hasta que el usuario reanude.');
                                        pauseCloudUpload('Se rechazaron cambios entrantes significativos de la nube.');
                                    },
                                    onRejectAndReupload: () => {
                                        window._pendingIncomingReview = false;
                                        debug.log('🔄 Cambios remotos rechazados. Re-subiendo estado local a la nube.');
                                        if (typeof saveApplicationData === 'function') {
                                            saveApplicationData({ force: true });
                                        }
                                    },
                                    // Escape / × close: safe dismissal — no action taken.
                                    // Clear the flag so the modal can reappear on the next
                                    // sync cycle if changes are still significant.
                                    onDismiss: () => {
                                        window._pendingIncomingReview = false;
                                        debug.log('🙈 Modal de cambios entrantes dismissed sin acción. Reaparecerá en el próximo sync si los cambios siguen siendo significativos.');
                                    }
                                });
                                return;
                            }
                        } catch (e) {
                            // Si la detección falla por cualquier razón, NO bloquear
                            // la aplicación de cambios — caer al flujo legacy.
                            console.warn('⚠️ Pre-apply hook falló, aplicando sin revisar:', e);
                        }
                    }

                    // Sin cambios significativos (o es initial load) → aplicar
                    // directo como siempre.
                    await applyRemoteData();

                    // Cuerpo del apply real, extraído como función local para que
                    // tanto el flujo silencioso como el modal puedan invocarlo.
                    async function applyRemoteData() {

                    // 🛡️ GUARD: Evitar loop infinito de sincronización
                    // Sin este flag: cloud change → state update → render → save → firebase sync → cloud change → ∞
                    window._isApplyingRemoteData = true;
                    window._pendingRemoteSave = true; // Marcar que hay datos remotos para persistir

                    // Fusionar datos (con deduplicación por ID)
                    const dedup = (arr) => arr ? [...new Map(arr.map(item => [item.id, item])).values()] : [];

                    // ⚡ FASE 4.1: Migrar al modelo doc-por-empleado si aplica, y
                    // cargar empleados desde la fuente correcta (subcolección si
                    // ya migró, arreglo legacy si todavía no).
                    const loaderResult = await loadAndMigrateEmployees({
                        remoteData,
                        isDemo: !!state.usingDemoData,
                        migrate: (rd, opts) => FirebaseService.migrateIfNeeded(rd, opts),
                        loadEmployees: (rd) => FirebaseService.loadEmployeesIfMigrated(rd),
                        loadPositions: (rd) => FirebaseService.loadPositionsIfMigrated(rd),
                        loadLeaders: (rd) => FirebaseService.loadLeadersIfMigrated(rd)
                    });
                    if (loaderResult.migrated) {
                        debug.log(`✅ Migración v2 completada: ${loaderResult.count} empleado(s)`);
                    }
                    if (loaderResult.error) {
                        console.warn('⚠️ Migración/carga con error, usando fallback legacy:', loaderResult.error);
                    }

                    // ⚡ FIX: Asegurar instancias correctas de clase
                    let newEmployees = dedup(loaderResult.employees || state.employees);
                    if (typeof Employee !== 'undefined') {
                        newEmployees = newEmployees.map(e => e instanceof Employee ? e : new Employee(e));
                    }

                    state.settings = { ...state.settings, ...remoteData.settings };
                    // Propagar schemaVersion al state local para que las escrituras
                    // (saveFullState) sepan tomar el camino granular.
                    const effectiveSchemaVersion = loaderResult.migrated
                        ? 3
                        : (typeof remoteData.schemaVersion === 'number' ? remoteData.schemaVersion : state.settings.schemaVersion);
                    if (typeof effectiveSchemaVersion === 'number') {
                        state.settings.schemaVersion = effectiveSchemaVersion;
                    }
                    state.employees = newEmployees;
                    // ⚡ Schema v3: cargos y líderes vienen de su fuente granular
                    // (subcolección si schemaVersion>=3, arreglo legacy si no),
                    // resuelta por el loader. NO leer de remoteData directamente:
                    // a partir de v3 el parent doc ya no recibe estos arreglos.
                    state.positions = dedup(loaderResult.positions || remoteData.positions || state.positions);
                    state.leaders = dedup(loaderResult.leaders || remoteData.leaders || state.leaders);

                    // ⚡ FASE 2.1: si ya migramos al modelo per-doc, abrir el
                    // listener en tiempo real sobre la subcolección de empleados
                    // para que los cambios remotos lleguen sin recargar. La
                    // suscripción es idempotente — el guard de schemaVersion + el
                    // singleton interno garantizan una sola conexión activa.
                    if (state.settings.schemaVersion >= 2) {
                        EmployeesLiveSync.start({
                            subscribe: (cb) => EmployeeRepository.subscribe(cb),
                            onApply: (emps) => {
                                if (isDownloadPaused()) { debug.log('⏸️ Descarga pausada — LiveSync empleados ignorado.'); return; }
                                const merged = dedup(emps || []);
                                state.employees = (typeof Employee !== 'undefined')
                                    ? merged.map(e => e instanceof Employee ? e : new Employee(e))
                                    : merged;
                                debug.log(`📡 LiveSync: aplicada lista de ${state.employees.length} empleado(s) desde la nube`);
                                if (typeof render === 'function') render();
                            }
                        });
                    }

                    // ⚡ Schema v3: listeners en tiempo real para cargos y líderes
                    // sobre sus subcolecciones. Idempotentes (singletons internos).
                    if (state.settings.schemaVersion >= 3) {
                        PositionsLiveSync.start({
                            subscribe: (cb) => PositionRepository.subscribe(cb),
                            onApply: (positions) => {
                                if (isDownloadPaused()) { debug.log('⏸️ Descarga pausada — LiveSync cargos ignorado.'); return; }
                                const merged = dedup(positions || []);
                                state.positions = (typeof Position !== 'undefined')
                                    ? merged.map(p => p instanceof Position ? p : new Position(p))
                                    : merged;
                                debug.log(`📡 LiveSync: aplicada lista de ${state.positions.length} cargo(s) desde la nube`);
                                if (typeof render === 'function') render();
                            }
                        });
                        LeadersLiveSync.start({
                            subscribe: (cb) => LeaderRepository.subscribe(cb),
                            onApply: (leaders) => {
                                if (isDownloadPaused()) { debug.log('⏸️ Descarga pausada — LiveSync líderes ignorado.'); return; }
                                const merged = dedup(leaders || []);
                                state.leaders = (typeof Leader !== 'undefined')
                                    ? merged.map(l => l instanceof Leader ? l : new Leader(l))
                                    : merged;
                                debug.log(`📡 LiveSync: aplicada lista de ${state.leaders.length} líder(es) desde la nube`);
                                if (typeof render === 'function') render();
                            }
                        });
                    }

                    if (remoteData.attendance) {
                        debug.log('⚠️ Ignorando attendance de Mirror Sync (gestionado por Zonal Sync)');
                    }

                    // 🛡️ Sanitización post-sincronización (Evita que la nube traiga basura vieja)
                    if (sanitizePositions(state)) {
                        invalidateAllStats(); // positionId remap → stats stale (sin rebuild de índice)
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

                        // 🛡️ POST-SYNC INTEGRITY GUARD (2026-05-20)
                        // The cloud copy may contain orphans (refs to deleted positions/leaders)
                        // from before today's cleanup. Without this, every mirror-sync would
                        // re-introduce the same orphans we just cleaned, causing the same 51
                        // entries to be "corrected" repeatedly. Now we validate AFTER applying
                        // remote data and push the cleaned state back up — within a few sync
                        // cycles, both local and cloud converge to a clean state.
                        const remoteFixes = validateDataIntegrity();
                        if (remoteFixes > 0) {
                            debug.log(`🛡️ Mirror sync: ${remoteFixes} orphan(s) sanitized after remote apply`);
                            saveApplicationData({ force: true });
                        }
                    }, 500);

                    if (isInitialLoad) {
                        clearTimeout(loaderTimeout);
                        hideLoader();
                        isInitialLoad = false;
                        // Forzar render inicial con datos de la nube
                        render();
                        // 🛡️ Post-load sanitization prompt:
                        // Primera sync completada → datos mergeados → buen momento para preguntar.
                        _checkSanitizationCloudSyncPrompt();
                    }
                    } // ← cierra applyRemoteData()
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
                            if (isDownloadPaused()) {
                                debug.log('⏸️ Descarga pausada — carga inicial de asistencia ignorada.');
                                return;
                            }
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

                            // 🛡️ POST-SYNC INTEGRITY GUARD (2026-05-20)
                            // Attendance records may carry orphan positionHours / selectedPosition
                            // from before the position was deleted. Clean them here so the next
                            // mirror-sync save uploads a sanitized version to the cloud.
                            const attendanceFixes = validateDataIntegrity();
                            if (attendanceFixes > 0) {
                                debug.log(`🛡️ Zonal initial load: ${attendanceFixes} orphan(s) sanitized in attendance`);
                                // Use a one-tick delay so the flag clears first via BatchedSaver
                                setTimeout(() => {
                                    if (!window._isApplyingRemoteData) {
                                        saveApplicationData({ force: true });
                                    }
                                }, 600);
                            }

                            // Carga inicial = reemplazo de muchas fechas → coherencia TOTAL,
                            // sincrónica antes del render y DESPUÉS de validateDataIntegrity
                            // (que muta hoursWorked in-place). Nunca diferir a BatchedSaver.
                            invalidateAllStats();
                            buildAttendanceIndex();

                            if (!isInitialLoad) render();
                        },
                        onModified: (dateKey, records) => {
                            if (isDownloadPaused()) {
                                debug.log(`⏸️ Descarga pausada — modificación de asistencia [${dateKey}] ignorada.`);
                                return;
                            }
                            window._isApplyingRemoteData = true;

                            // 🛡️ LIMPIEZA DE ESTADO: Evitar duplicidad si Firebase envía claves incoherentes
                            Object.values(records).forEach(record => {
                                const shortKey = record.employeeId;
                                if (state.attendance[shortKey]) {
                                    delete state.attendance[shortKey];
                                }
                            });

                            state.attendance = { ...state.attendance, ...records };
                            // Una sola fecha (hot path por tick) → coherencia GRANULAR:
                            // invalidar solo los empleados tocados (por employeeId, NO split de clave)
                            // y reconstruir el bucket de ESTE día. NUNCA invalidateAllStats acá.
                            Object.values(records).forEach(r => { if (r.employeeId) invalidateEmployeeStats(r.employeeId); });
                            buildAttendanceIndex(dateKey);
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
                // No hay sesión → no se puede subir a la nube, limpiar flag.
                delete state._pendingSanitizationCloudSync;
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
    btn.innerHTML = icons.get('chevron-up', { size: 22 });
    btn.title = 'Ir arriba';
    btn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.appendChild(btn);
}


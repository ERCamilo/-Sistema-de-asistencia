import { DateUtils } from '../utils/DateUtils.js';
import icons from './IconSystem.js';
import { state } from '../core/AppState.js';
import { APP_CONFIG } from '../config/Config.js';
import { SettingsGeneralTab } from './settings/SettingsGeneralTab.js';
import { SettingsDataTab } from './settings/SettingsDataTab.js';
import { SettingsTabCalendar } from './settings/SettingsCalendarTab.js';
import { SettingsTestsTab } from './settings/SettingsTestsTab.js';
import { clearAppCaches } from '../services/CacheManager.js';

// ============================================
// EVENT DELEGATION (data-settings-action)
// ============================================
const _SETTINGS_ACTION_MAP = {
    'change-settings-tab': (tab) => window.changeSettingsTab?.(tab),
    'save-settings': () => window.saveSettings?.(),
    'login-with-google': () => window.loginWithGoogle?.(),
    'logout-firebase': () => window.logoutFirebase?.(),
    'sync-firebase-now': () => window.syncFirebaseNow?.(),
    'sync-history-now': () => window.syncHistoryNow?.(),
    'create-firebase-snapshot': () => window.createFirebaseSnapshot?.(),
    'start-maintenance-wizard': () => window.startMaintenanceWizard?.(),
    'export-data': () => window.exportData?.(),
    'open-import-input': () => document.getElementById('import-file-input')?.click(),
    'delete-all-data': () => window.deleteAllData?.(),
    'download-from-cloud': () => window.downloadFromCloudNow?.(),
    'upload-to-cloud': () => window.uploadToCloudNow?.(),
    'delete-cloud-data': () => window.deleteCloudDataNow?.(),
    'bulk-delete-snapshots': (type) => window.bulkDeleteSnapshotsHandler?.(type),
    'advance-pay-period': () => window.advancePayPeriod?.(),
    'install-pwa': () => window.handleInstallPWA?.(),
    'delete-snapshot': (id) => window.deleteSnapshotHandler?.(id),
    'restore-snapshot': (id) => window.restoreSnapshot?.(id),
    // Ayuda contextual
    'set-help-mode': (_, el) => {
        const newMode = el.value;
        if (window.helpController) {
            window.helpController.setMode(newMode);
            window.showNotification?.(`Modo de ayuda: ${newMode}`, 'info');
        }
    },
    'reset-help-seen': () => {
        if (window.helpController) {
            window.helpController.resetAllSeen();
            window.showNotification?.('Tooltips restablecidos. Aparecerán de nuevo al usar la app.', 'success');
        }
    },
    'run-browser-tests': () => window.runBrowserTests?.(),
    // Mantenimiento: limpiar el cache del navegador para forzar la última versión.
    'clear-cache': () => {
        const doClear = async () => {
            try {
                const { deletedCaches } = await clearAppCaches();
                window.showNotification?.(
                    `Cache limpiado (${deletedCaches}). Recargando para traer la última versión…`,
                    'success'
                );
                setTimeout(() => window.location.reload(), 600);
            } catch (err) {
                window.showNotification?.(`No se pudo limpiar el cache: ${err.message}`, 'error');
            }
        };
        if (window.showConfirm) {
            window.showConfirm({
                title: 'Limpiar cache y recargar',
                message: 'Se borrarán los archivos cacheados del navegador para forzar la última versión de la app. Tus datos (empleados, asistencia, configuración) NO se borran. La app se va a recargar. ¿Continuar?',
                confirmText: 'Sí, limpiar y recargar',
                cancelText: 'Cancelar',
                type: 'warning',
                onConfirm: doClear
            });
        } else {
            doClear();
        }
    }
};

function _handleSettingsClick(e) {
    const target = e.target.closest('[data-settings-action]');
    if (!target) return;
    const action = target.dataset.settingsAction;
    const handler = _SETTINGS_ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.id ?? target.dataset.value ?? null;
    handler(arg, target, e);
}

function _handleSettingsKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-settings-action]');
    if (!target || target.tagName === 'BUTTON' || target.tagName === 'A') return;
    if (target.getAttribute('role') !== 'button') return;
    e.preventDefault();
    _handleSettingsClick(e);
}

function _handleSettingsChange(e) {
    const target = e.target;
    if (target && target.type === 'checkbox') {
        const row = target.closest('.stg-switch-row');
        if (row) {
            row.classList.toggle('is-active', target.checked);
            row.setAttribute('aria-checked', target.checked ? 'true' : 'false');

            // Actualizar el estado en memoria de forma inmediata para evitar reversión visual en re-renderizados
            if (target.id === 'legacyNavigation') {
                state.settings.legacyNavigation = target.checked;
            } else if (target.id === 'hideDuplicateAlerts') {
                state.settings.hideDuplicateAlerts = target.checked;
            } else if (target.id === 'weatherEnabled') {
                state.settings.weatherEnabled = target.checked;
                
                // Caso especial: Mostrar/ocultar configuración del clima en tiempo real
                const configPanel = document.getElementById('weatherConfigPanel');
                if (configPanel) {
                    configPanel.style.display = target.checked ? 'block' : 'none';
                }
            }
        }
    }
}

let _settingsDelegationAttached = false;
function _attachSettingsDelegation() {
    if (_settingsDelegationAttached) return;
    document.addEventListener('click', _handleSettingsClick);
    document.addEventListener('keydown', _handleSettingsKeydown);
    document.addEventListener('change', _handleSettingsChange);
    _settingsDelegationAttached = true;
}
_attachSettingsDelegation();

let context = {};

export function initSettingsUI(dependencies) {
    context = dependencies;
}

function getState() { return context.state; }
function getIcons() { return context.icons; }

// ============================================
// SETTINGS TAB (entry point)
// ============================================

export function SettingsTab() {
    const state = getState();
    const icons = getIcons();

    // Fallback para pestaña activa si está indefinida
    const activeTab = state.settingsActiveTab || 'general';

    return `
                <div style="max-width: 900px; margin: 0 auto;">
                    <div class="stg-header" style="margin-bottom: 20px;">
                        <div>
                            <h3>
                                <span>${icons.get('settings', { size: 24 })}</span>
                                <span>Configuración del Sistema</span>
                            </h3>
                            <p>Personaliza la configuración de tu sistema de asistencia</p>
                        </div>
                    </div>
                    
                    <!-- Dashboard de Resumen -->
                    ${SettingsDashboard()}
                    
                    <!-- Navegación de Pestañas -->
                    <div class="nav-tabs" style="margin-bottom: 32px;">

                        <button class="nav-tab ${activeTab === 'data' ? 'active' : ''}" 
                                type="button" data-settings-action="change-settings-tab" data-value="data">
                            <span>${icons.get('save')}</span><span class="tab-text"> Datos</span>
                        </button>

                        <button class="nav-tab ${activeTab === 'general' ? 'active' : ''}" 
                                type="button" data-settings-action="change-settings-tab" data-value="general">
                            <span>${icons.get('settings')}</span><span class="tab-text"> General</span>
                        </button>

                        <button class="nav-tab ${activeTab === 'calendar' ? 'active' : ''}"
                                type="button" data-settings-action="change-settings-tab" data-value="calendar">
                            <span>${icons.get('calendar')}</span><span class="tab-text"> Calendario</span>
                        </button>

                        <button class="nav-tab ${activeTab === 'tests' ? 'active' : ''}"
                                type="button" data-settings-action="change-settings-tab" data-value="tests">
                            <span>${icons.get('info')}</span><span class="tab-text"> Tests</span>
                        </button>
                    </div>

                    <!-- Contenido de las Pestañas -->
                    ${activeTab === 'general' ? SettingsGeneralTab(context) : ''}
                    ${activeTab === 'data' ? SettingsDataTab(context) : ''}
                    ${activeTab === 'calendar' ? SettingsTabCalendar(context) : ''}
                    ${activeTab === 'tests' ? SettingsTestsTab() : ''}
                    
                    <div style="margin-top: 24px; display: flex; justify-content: flex-end;">
                        <button type="button" data-settings-action="save-settings" class="btn btn-primary" style="padding: 12px 32px; font-size: 1rem;">
                            Guardar Configuración
                        </button>
                    </div>

                    <!-- Versión y fecha de actualización -->
                    <div class="stg-footer">
                        <div style="display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center;">
                            <span>${icons.get('info', { size: 12 })}</span>
                            <span><strong>Versión ${APP_CONFIG.VERSION}</strong></span>
                            <span style="opacity: 0.5;">·</span>
                            <span title="Versión del Service Worker (caché PWA)">
                                SW <strong>${state.swVersion || '…'}</strong>
                            </span>
                            <span style="opacity: 0.5;">·</span>
                            <span>Actualizado: ${APP_CONFIG.LAST_UPDATED}</span>
                        </div>
                    </div>
                </div>
            `;
}

// ============================================
// DASHBOARD DE CONFIGURACIÓN
// ============================================

function SettingsDashboard() {
    const state = getState();
    const storage = context.calculateStorageStats();
    const syncStatus = {
        connected: !!window.currentUser,
        localEmployees: state.employees.length,
        // Fase 1 (U2c): un tombstone no cuenta como asistencia local real.
        localAttendance: Object.values(state.attendance).filter(a => a.deletedAt == null).length,
        localDays: new Set(Object.values(state.attendance).filter(a => a.deletedAt == null).map(a => a.date || '')).size
    };

    const freeSpace = Math.round(100 - storage.percentage);
    const syncText = syncStatus.connected ? 'Online' : 'Offline';
    const syncColor = syncStatus.connected ? 'success' : '';

    return `
                <div class="stg-panel" style="margin-bottom: 24px;">
                    <div class="stg-status-bar">
                        ${StorageCard(storage)}
                        ${SyncCard(syncStatus)}
                        ${DataSummaryCard()}
                    </div>
                </div>
            `;
}

function StorageCard(stats) {
    const colorClass = stats.percentage > 80 ? 'danger' :
        stats.percentage > 60 ? 'warning' : 'success';
    const color = stats.percentage > 80 ? '#ef4444' :
        stats.percentage > 60 ? '#f59e0b' : '#10b981';

    return `
                <div class="stg-status-cell">
                    <span class="stg-label">Almacenamiento</span>
                    <span class="stg-value ${colorClass}">${stats.usedMB} MB</span>
                    <div class="stg-progress">
                        <div class="stg-progress-bar" style="background: ${color}; width: ${stats.percentage}%;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #94a3b8; margin-top: 2px;">
                        <span>${stats.percentage}% uso</span>
                        <span>${stats.available} libre</span>
                    </div>
                </div>
            `;
}

export function SyncCard(status) {
    const currentUser = window.currentUser;
    const isConnected = !!currentUser;
    const statusColor = isConnected ? 'success' : '';
    const statusText = isConnected ? 'Conectado' : 'Sin conexión';

    return `
                <div class="stg-status-cell">
                    <span class="stg-label">Sincronización</span>
                    <span class="stg-value ${statusColor}">${statusText}</span>
                    ${isConnected ? `
                        <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${currentUser.email}
                        </div>
                    ` : `
                        <div style="font-size: 0.7rem; color: #64748b; margin-top: 6px;">
                            Conecta tu cuenta de Google
                        </div>
                    `}
                </div>
            `;
}

function DataSummaryCard() {
    const state = getState();
    const activeEmployees = state.employees.filter(e => e.active).length;
    const totalEmployees = state.employees.length;
    const activePositions = state.positions.filter(p => p.active).length;

    return `
                <div class="stg-status-cell">
                    <span class="stg-label">Datos</span>
                    <span class="stg-value accent">${totalEmployees}</span>
                    <div style="font-size: 0.7rem; color: #64748b; margin-top: 2px;">
                        empleados (${activeEmployees} activos)
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.7rem; margin-top: 6px; background: rgba(17, 24, 39, 0.5); padding: 4px 6px; border-radius: 4px;">
                        <span style="color: #94a3b8;">Posiciones:</span>
                        <span style="color: #10b981; font-weight: 600;">${activePositions}</span>
                    </div>
                </div>
            `;
}

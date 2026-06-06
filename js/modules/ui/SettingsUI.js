import { DateUtils } from '../utils/DateUtils.js';
import icons from './IconSystem.js';
import { state } from '../core/AppState.js';
import { APP_CONFIG } from '../config/Config.js';
import { SettingsGeneralTab } from './settings/SettingsGeneralTab.js';
import { SettingsDataTab } from './settings/SettingsDataTab.js';
import { SettingsTabCalendar } from './settings/SettingsCalendarTab.js';
import { SettingsTestsTab } from './settings/SettingsTestsTab.js';

// ============================================
// 🎯 EVENT DELEGATION (data-settings-action)
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
    // 💡 Ayuda contextual
    'set-help-mode': (_, el) => {
        const newMode = el.value;
        if (window.helpController) {
            window.helpController.setMode(newMode);
            window.showNotification?.(`💡 Modo de ayuda: ${newMode}`, 'info');
        }
    },
    'reset-help-seen': () => {
        if (window.helpController) {
            window.helpController.resetAllSeen();
            window.showNotification?.('🔄 Tooltips restablecidos. Aparecerán de nuevo al usar la app.', 'success');
        }
    },
    'run-browser-tests': () => window.runBrowserTests?.()
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

let _settingsDelegationAttached = false;
function _attachSettingsDelegation() {
    if (_settingsDelegationAttached) return;
    document.addEventListener('click', _handleSettingsClick);
    document.addEventListener('keydown', _handleSettingsKeydown);
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

    // ⚡ Fallback para pestaña activa si está indefinida (Bug de inicialización)
    const activeTab = state.settingsActiveTab || 'general';

    return `
                <div style="max-width: 900px; margin: 0 auto;">
                    <div style="margin-bottom: 24px;">
                        <h2 style="margin: 0 0 8px 0; font-size: 1.75rem; display: flex; align-items: center; gap: 12px;">
                            <span>${icons.get('settings', { size: 24 })}</span>
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
                            💾 Guardar Configuración
                        </button>
                    </div>

                    <!-- Versión y fecha de actualización -->
                    <div style="margin-top: 32px; padding: 16px; border-top: 1px solid #1e293b; text-align: center; color: #64748b; font-size: 0.75rem;">
                        <div style="display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center;">
                            <span>${icons.get('info', { size: 12 })}</span>
                            <span><strong style="color: #94a3b8;">Versión ${APP_CONFIG.VERSION}</strong></span>
                            <span style="opacity: 0.5;">·</span>
                            <span title="Versión del Service Worker (caché PWA)">
                                SW <strong style="color: #94a3b8;">${state.swVersion || '…'}</strong>
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
        localAttendance: Object.keys(state.attendance).length,
        localDays: new Set(Object.values(state.attendance).map(a => a.date || '')).size
    };

    const freeSpace = Math.round(100 - storage.percentage);
    const syncIcon = syncStatus.connected ? '✅' : '⚪';
    const syncText = syncStatus.connected ? 'Online' : 'Offline';
    const syncColor = syncStatus.connected ? '#10b981' : '#94a3b8';

    return `
                <details style="background: linear-gradient(135deg, #1e293b, #0f172a); border-radius: 12px; margin-bottom: 24px; border: 1px solid #334155; overflow: hidden;">
                    <summary style="padding: 16px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; list-style: none; user-select: none;">
                        <h3 style="margin: 0; color: #06b6d4; font-size: 1rem; display: flex; align-items: center; gap: 6px;">
                            <span>${icons.get('analytics', { size: 16 })}</span>
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
                                <span style="display: none;">${syncText}</span>
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

export function SyncCard(status) {
    const currentUser = window.currentUser;
    const isConnected = !!currentUser;
    const statusColor = isConnected ? '#10b981' : '#64748b';
    const statusIcon = isConnected ? '✅' : '⚪';
    const statusText = isConnected ? 'Conectado' : 'Sin conexión';

    return `
                <div style="background: #0f172a; border-radius: 12px; padding: 16px; border: 1px solid #334155;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                        <span style="font-size: 1.5rem;">☁️</span>
                        <span style="font-weight: 600; color: #f1f5f9; font-size: 0.95rem;">Sincronización (Firebase)</span>
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <span style="font-size: 1.5rem;">${statusIcon}</span>
                        <span style="font-size: 1.25rem; font-weight: 700; color: ${statusColor};">
                            ${statusText}
                        </span>
                    </div>
                    
                    ${isConnected ? `
                        <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${currentUser.email}
                        </div>
                    ` : `
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            Usa tu cuenta de Google para respaldar tus datos.
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

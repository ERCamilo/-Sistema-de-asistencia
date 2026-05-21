import { DateUtils } from '../utils/DateUtils.js';
import icons from './IconSystem.js';
import { state } from '../core/AppState.js';
import { APP_CONFIG } from '../config/Config.js';

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

                        <button class="nav-tab ${state.settingsActiveTab === 'data' ? 'active' : ''}" 
                                type="button" data-settings-action="change-settings-tab" data-value="data">
                            <span>${icons.get('save')}</span><span class="tab-text"> Datos</span>
                        </button>

                        <button class="nav-tab ${state.settingsActiveTab === 'general' ? 'active' : ''}" 
                                type="button" data-settings-action="change-settings-tab" data-value="general">
                            <span>${icons.get('settings')}</span><span class="tab-text"> General</span>
                        </button>

                        <button class="nav-tab ${state.settingsActiveTab === 'calendar' ? 'active' : ''}" 
                                type="button" data-settings-action="change-settings-tab" data-value="calendar">
                            <span>${icons.get('calendar')}</span><span class="tab-text"> Calendario</span>
                        </button>
                    </div>
                    
                    <!-- Contenido de las Pestañas -->
                    ${state.settingsActiveTab === 'general' ? SettingsTabGeneral() : ''}
                    ${state.settingsActiveTab === 'data' ? SettingsTabData() : ''}
                    ${state.settingsActiveTab === 'calendar' ? SettingsTabCalendar() : ''}
                    
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
    const state = getState();
    const currentUser = context.currentUser;

    return `
                    <!-- Sincronización con Firebase (Google) -->
                    <div style="background: linear-gradient(135deg, rgba(66, 133, 244, 0.1), rgba(52, 168, 83, 0.1)); border-radius: 12px; padding: 24px; margin-top: 20px; border: 2px solid ${currentUser ? '#4285F4' : '#334155'};">
                        <h2 style="margin: 0 0 12px 0; font-size: 1.25rem; color: #f1f5f9; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                            <span>☁️</span> Sincronización en la Nube
                        </h2>
                        
                        ${!currentUser ? `
                            <div style="color: #94a3b8; margin-bottom: 20px; line-height: 1.6;">
                                Conecta tu cuenta de Google para respaldar tus datos y acceder desde cualquier dispositivo.
                            </div>
                            
                            <button type="button" data-settings-action="login-with-google" class="btn-primary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 14px; background: white; color: #374151; font-weight: 600; border: 1px solid #d1d5db; transition: all 0.2s;">
                                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" height="20">
                                Continuar con Google
                            </button>
                        ` : `
                            <div style="background: rgba(16, 185, 129, 0.1); padding: 16px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #10b981; display: flex; align-items: center; gap: 12px;">
                                <img src="${currentUser.photoURL || ''}" style="width: 40px; height: 40px; border-radius: 50%; background: #334155;" onerror="this.src='https://ui-avatars.com/api/?name=${currentUser.displayName}'">
                                <div style="flex: 1;">
                                    <div style="color: #f1f5f9; font-weight: 600; font-size: 0.95rem;">${currentUser.displayName || 'Usuario'}</div>
                                    <div style="color: #94a3b8; font-size: 0.8rem;">${currentUser.email}</div>
                                </div>
                                <button type="button" data-settings-action="logout-firebase" style="padding: 6px 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">
                                    Salir
                                </button>
                            </div>

                            <!-- Herramientas de Nube -->
                            <div style="margin-bottom: 20px;">
                                <div style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Backup y Snapshots</div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
                                    <button type="button" data-settings-action="sync-firebase-now" class="btn-secondary" style="background: rgba(66, 133, 244, 0.1); color: #4285F4; border: 1px solid rgba(66, 133, 244, 0.2); padding: 12px; font-size: 0.85rem;">
                                       🔄 Sync Actual
                                    </button>
                                    <button type="button" data-settings-action="sync-history-now" class="btn-secondary" style="background: rgba(6, 182, 212, 0.1); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.2); padding: 12px; font-size: 0.85rem;">
                                       📅 Sync Historial
                                    </button>
                                    <button type="button" data-settings-action="create-firebase-snapshot" class="btn-secondary" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2); padding: 12px; font-size: 0.85rem; grid-column: span 2;">
                                       📸 Crear Snapshot Manual
                                    </button>
                                </div>
                                
                                <div class="form-group" style="margin-bottom: 0;">
                                    <label class="form-label" style="font-size: 0.85rem; color: #64748b;">Auto-Backup</label>
                                    <select id="backupFrequency" onchange="updateBackupFrequency(this.value)" class="form-input" style="background: #0f172a; border-color: #334155; font-size: 0.85rem; height: 38px;">
                                        <option value="none" ${state.settings.backupFrequency === 'none' ? 'selected' : ''}>Desactivado</option>
                                        <option value="daily" ${state.settings.backupFrequency === 'daily' ? 'selected' : ''}>Diario</option>
                                        <option value="weekly" ${state.settings.backupFrequency === 'weekly' ? 'selected' : ''}>Semanal</option>
                                        <option value="monthly" ${state.settings.backupFrequency === 'monthly' ? 'selected' : ''}>Mensual</option>
                                    </select>
                                </div>
                            </div>
                        `}
                    </div>

                    <!-- Fase 4: Historial de Snapshots -->
                    ${currentUser ? SnapshotHistory() : ''}
                    
                    <!-- Salud de Datos y Duplicados -->
                    <div style="background: linear-gradient(135deg, rgba(8, 145, 178, 0.1), rgba(15, 23, 42, 0.1)); border-radius: 12px; padding: 24px; margin-top: 20px; border: 1px solid #0891b2;">
                        <h3 style="margin: 0 0 12px 0; font-size: 1.125rem; color: #f1f5f9; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                            <span>🛡️</span> Salud de los Datos
                        </h3>
                        <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 20px; line-height: 1.6;">
                            Busca y resuelve inconsistencias, como empleados con números de ficha duplicados. Esto asegura que la nómina y las asistencias sean precisas.
                        </p>
                        <button type="button" data-settings-action="start-maintenance-wizard" class="btn-primary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px; background: #0891b2; border: none;">
                            🧹 Iniciar Asistente de Saneamiento
                        </button>
                    </div>

                    <!-- Gestión de Datos -->
                    <div style="margin-top: 32px; display: flex; flex-direction: column; gap: 24px;">
                        
                        <!-- Columna: Datos Locales -->
                        <div style="background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155;">
                            <h3 style="margin: 0 0 20px 0; font-size: 1.125rem; color: #f1f5f9; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                                <span>📱</span> Datos Locales (Este dispositivo)
                            </h3>

                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
                                <!-- Sistema de Almacenamiento -->
                                <div style="background: #0f172a; border-radius: 10px; padding: 16px; border: 1px solid #334155;">
                                    <div style="font-weight: 600; color: #94a3b8; margin-bottom: 12px; font-size: 0.85rem; text-transform: uppercase;">Almacenamiento Interno</div>
                                    <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                                        <label style="flex: 1; cursor: pointer;">
                                            <input type="radio" name="storageTypeData" value="localStorage" ${!state.useIndexedDB ? 'checked' : ''} onchange="handleStorageTypeChange(this.value)" style="display: none;">
                                            <div style="padding: 10px; background: ${!state.useIndexedDB ? '#0891b2' : '#1e293b'}; border-radius: 8px; text-align: center; border: 1px solid ${!state.useIndexedDB ? '#0891b2' : '#334155'};">
                                                <div style="font-weight: 600; font-size: 0.9rem; color: ${!state.useIndexedDB ? 'white' : '#94a3b8'};">📦 Local</div>
                                            </div>
                                        </label>
                                        <label style="flex: 1; cursor: pointer;">
                                            <input type="radio" name="storageTypeData" value="indexedDB" ${state.useIndexedDB ? 'checked' : ''} onchange="handleStorageTypeChange(this.value)" style="display: none;">
                                            <div style="padding: 10px; background: ${state.useIndexedDB ? '#0891b2' : '#1e293b'}; border-radius: 8px; text-align: center; border: 1px solid ${state.useIndexedDB ? '#0891b2' : '#334155'};">
                                                <div style="font-weight: 600; font-size: 0.9rem; color: ${state.useIndexedDB ? 'white' : '#94a3b8'};">🗄️ IndexedDB</div>
                                            </div>
                                        </label>
                                    </div>
                                    <div id="indexeddb-stats" style="font-size: 0.7rem; color: #64748b; line-height: 1.5;">${state.useIndexedDB ? 'Cargando estadísticas...' : 'Usando LocalStorage (límite 5MB)'}</div>
                                </div>

                                <!-- Backups Manuales -->
                                <div style="background: #0f172a; border-radius: 10px; padding: 16px; border: 1px solid #334155; display: flex; flex-direction: column; gap: 10px;">
                                    <div style="font-weight: 600; color: #94a3b8; margin-bottom: 2px; font-size: 0.85rem; text-transform: uppercase;">Archivo Backup (.json)</div>
                                    <button type="button" data-settings-action="export-data" class="btn-secondary" style="width: 100%; justify-content: center; padding: 10px;">📥 Descargar Backup</button>
                                    <button type="button" data-settings-action="open-import-input" class="btn-secondary" style="width: 100%; justify-content: center; padding: 10px;">📤 Cargar Backup</button>
                                    <input type="file" id="import-file-input" accept=".json" style="display: none;" onchange="importData(event)">
                                </div>
                            </div>

                            <!-- Borrado Local -->
                            <div style="margin-top: 16px; padding: 16px; background: rgba(239, 68, 68, 0.05); border-radius: 10px; border: 1px dashed rgba(239, 68, 68, 0.3);">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div style="flex: 1; padding-right: 16px;">
                                        <div style="color: #ef4444; font-weight: 700; font-size: 0.9rem; margin-bottom: 4px;">BORRADO LOCAL TOTAL</div>
                                        <div style="font-size: 0.75rem; color: #94a3b8;">Limpia este teléfono por completo. Los datos en la nube NO se borrarán.</div>
                                    </div>
                                    <button type="button" data-settings-action="delete-all-data" class="btn-danger" style="white-space: nowrap; padding: 10px 20px;">🗑️ Borrar Local</button>
                                </div>
                            </div>
                        </div>

                        <!-- Columna: Datos en la Nube -->
                        ${currentUser ? `
                        <div style="background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #4285F4;">
                            <h3 style="margin: 0 0 20px 0; font-size: 1.125rem; color: #f1f5f9; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                                <span>☁️</span> Gestión de Nube (Google Account)
                            </h3>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <!-- Override: Download -->
                                <div style="background: #0f172a; border-radius: 10px; padding: 16px; border: 1px solid #334155;">
                                    <div style="color: #4285F4; font-weight: 700; font-size: 0.85rem; margin-bottom: 8px;">DESCARGAR DE LA NUBE</div>
                                    <p style="font-size: 0.75rem; color: #94a3b8; margin: 0 0 12px 0;">Reemplaza todos los datos de este teléfono con lo que hay en la nube.</p>
                                    <button type="button" data-settings-action="download-from-cloud" class="btn-secondary" style="width: 100%; border-color: rgba(66, 133, 244, 0.4); color: #4285F4;">📥 Sobrescribir Local</button>
                                </div>

                                <!-- Override: Upload -->
                                <div style="background: #0f172a; border-radius: 10px; padding: 16px; border: 1px solid #334155;">
                                    <div style="color: #10b981; font-weight: 700; font-size: 0.85rem; margin-bottom: 8px;">SUBIR A LA NUBE</div>
                                    <p style="font-size: 0.75rem; color: #94a3b8; margin: 0 0 12px 0;">Fuerza que la nube guarde exactamente lo que tienes en este teléfono.</p>
                                    <button type="button" data-settings-action="upload-to-cloud" class="btn-secondary" style="width: 100%; border-color: rgba(16, 185, 129, 0.4); color: #10b981;">📤 Sobrescribir Nube</button>
                                </div>
                            </div>

                            <!-- Borrado Nube -->
                            <div style="margin-top: 16px; padding: 16px; background: rgba(239, 68, 68, 0.05); border-radius: 10px; border: 1px dashed rgba(239, 68, 68, 0.3);">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div style="flex: 1; padding-right: 16px;">
                                        <div style="color: #ef4444; font-weight: 700; font-size: 0.9rem; margin-bottom: 4px;">ELIMINAR DATOS DE LA NUBE</div>
                                        <div style="font-size: 0.75rem; color: #94a3b8;">Borra permanentemente tu respaldo en Google/Firebase. El teléfono no se verá afectado.</div>
                                    </div>
                                    <button type="button" data-settings-action="delete-cloud-data" class="btn-danger" style="white-space: nowrap; padding: 10px 20px; background: none; border: 1px solid #ef4444; color: #ef4444;">🗑️ Borrar Nube</button>
                                </div>
                            </div>
                            
                            <!-- NUEVO: Limpieza de Historial Masiva -->
                            <div style="margin-top: 16px; padding: 16px; background: rgba(15, 23, 42, 0.5); border-radius: 10px; border: 1px solid #334155;">
                                <div style="color: #94a3b8; font-weight: 700; font-size: 0.85rem; margin-bottom: 12px; text-transform: uppercase; display: flex; align-items: center; gap: 8px;">
                                    <span>🧹</span> Limpieza de Historial (Snapshots)
                                </div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                                    <button type="button" data-settings-action="bulk-delete-snapshots" data-value="auto" class="btn-secondary" style="font-size: 0.75rem; padding: 8px; border-color: rgba(239, 68, 68, 0.3); color: #94a3b8;">
                                        Borrar Todos los Autos
                                    </button>
                                    <button type="button" data-settings-action="bulk-delete-snapshots" data-value="manual" class="btn-secondary" style="font-size: 0.75rem; padding: 8px; border-color: rgba(239, 68, 68, 0.3); color: #94a3b8;">
                                        Borrar Todos los Manuales
                                    </button>
                                </div>
                                <p style="margin: 8px 0 0 0; font-size: 0.65rem; color: #64748b;">
                                    * Las versiones marcadas como 'Protegidas' (p. ej. pre-restauración) no se borrarán.
                                </p>
                            </div>
                        </div>
                        ` : ''}
                    </div>
            `;
}

// ============================================
// PESTAÑA: CALENDARIO  
// ============================================
function SettingsTabCalendar() {
    const state = getState();
    return `
                <!-- Panel Integrado de Calendario y Fechas -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155;">
                    <!-- Cabecera Integrada -->
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #334155;">
                        <div>
                            <h3 style="margin: 0 0 4px 0; font-size: 1.25rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                                ${icons.get('calendar', { size: 20 })} Control de Calendario y Pagos
                            </h3>
                            <div style="font-size: 0.85rem; color: #94a3b8;">
                                Configura tus cortes de pago y administra días festivos.
                            </div>
                        </div>
                        <button type="button" data-settings-action="advance-pay-period" class="btn btn-primary" style="font-size: 0.85rem; padding: 8px 16px; display: flex; align-items: center; gap: 8px;">
                            <span>⏭️</span> Avanzar Período
                        </button>
                    </div>
                    
                    <div style="display: flex; gap: 24px; flex-wrap: wrap;">
                        <!-- Columna Izquierda: Entradas de Configuración -->
                        <div style="flex: 1; min-width: 250px; display: flex; flex-direction: column; gap: 16px;">
                            <div style="background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                                <div style="font-weight: 600; color: #06b6d4; margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase;">Ajustes de Período</div>
                                
                                <div class="form-group" style="margin-bottom: 12px;">
                                    <label class="form-label" style="font-size: 0.8rem;">Inicio del Período</label>
                                    <input type="date" 
                                           value="${state.settings.payPeriod?.periodStart || ''}" 
                                           class="form-input"
                                           onchange="updatePayPeriod('periodStart', this.value)">
                                </div>
                                <div class="form-group" style="margin-bottom: 12px;">
                                    <label class="form-label" style="font-size: 0.8rem;">Duración (Días)</label>
                                    <input type="number" inputmode="decimal" 
                                           value="${state.settings.payPeriod?.periodLength || 21}" 
                                           min="1" max="60"
                                           class="form-input"
                                           onchange="updatePayPeriod('periodLength', this.value)">
                                </div>
                                <div class="form-group" style="margin: 0;">
                                    <label class="form-label" style="font-size: 0.8rem;">Día de Pago (Opcional)</label>
                                    <input type="date" 
                                           value="${state.settings.payPeriod?.payDay || ''}" 
                                           class="form-input"
                                           onchange="updatePayPeriod('payDay', this.value)">
                                </div>
                            </div>
                            
                            <div style="font-size: 0.75rem; color: #64748b; line-height: 1.6; background: rgba(59, 130, 246, 0.1); padding: 12px; border-radius: 8px; border-left: 3px solid #3b82f6;">
                                💡 <strong>Sincronización Interactiva:</strong> Usa los botones del calendario a la derecha para seleccionar fechas directamente de forma gráfica sin usar estos campos.
                            </div>
                            <div style="margin-top: auto; font-size: 0.75rem; color: #64748b; text-align: center; background: #0f172a; padding: 8px; border-radius: 6px;">
                                📅 Total Festivos: <strong style="color: #f59e0b;">${state.settings.holidays.length}</strong>
                            </div>
                        </div>

                        <!-- Columna Derecha: Calendario Visual Interactivo -->
                        <div style="flex: 2; min-width: 320px;">
                            ${SettingsHolidayCalendar()}
                        </div>
                    </div>
                </div>
            `;
}

function SettingsForm() {
    const state = getState();
    const icons = getIcons();
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

                <!-- Interfaz -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        🖥️ Interfaz de Navegación
                    </h3>
                    
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 12px; cursor: pointer; margin: 0;">
                            <input type="checkbox" id="legacyNavigation" ${state.settings.legacyNavigation ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #06b6d4; cursor: pointer;">
                            <span style="font-weight: 600; font-size: 1rem; color: #f1f5f9;">Usar Menú Superior Clásico</span>
                        </label>
                        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 8px; margin-left: 32px; line-height: 1.5;">
                            Si se activa, el menú se mostrará como pestañas en la parte superior en lugar de la barra flotante inferior.
                        </div>
                    </div>

                    <div class="form-group" style="margin-bottom: 0; padding-top: 16px; border-top: 1px solid #334155;">
                        <label class="form-label" style="margin-bottom: 8px; display: block;">Visibilidad del Mini-mapa (Barra Lateral)</label>
                        <select id="scrollbarMode" class="form-input" style="background: #0f172a; border-color: #334155;">
                            <option value="always" ${state.settings.scrollbarMode === 'always' ? 'selected' : ''}>✨ Siempre Visible</option>
                            <option value="on-scroll" ${state.settings.scrollbarMode === 'on-scroll' ? 'selected' : ''}>🔍 Solo al hacer scroll (Interactivo)</option>
                            <option value="hidden" ${state.settings.scrollbarMode === 'hidden' ? 'selected' : ''}>🚫 Ocultar Mini-mapa</option>
                        </select>
                        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 8px; line-height: 1.5;">
                            El mini-mapa muestra puntos de color para ausencias (rojo) y extras (azul) en toda la lista.
                        </div>
                    </div>

                    <div class="form-group" style="margin-bottom: 0; padding-top: 16px; border-top: 1px solid #334155;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 12px; cursor: pointer; margin: 0;">
                            <input type="checkbox" id="hideDuplicateAlerts" ${state.settings.hideDuplicateAlerts ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #06b6d4; cursor: pointer;">
                            <span style="font-weight: 600; font-size: 1rem; color: #f1f5f9;">Ocultar Alertas de Duplicados</span>
                        </label>
                        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 8px; margin-left: 32px; line-height: 1.5;">
                            Si se activa, el triángulo ⚠️ no se mostrará en el menú principal aunque existan conflictos.
                        </div>
                    </div>

                    <div class="form-group" style="margin-bottom: 0; padding-top: 16px; border-top: 1px solid #334155;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 12px; cursor: pointer; margin: 0;">
                            <input type="checkbox" id="weatherEnabled" ${state.settings.weatherEnabled === true ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #06b6d4; cursor: pointer;">
                            <span style="font-weight: 600; font-size: 1rem; color: #f1f5f9;">🌤️ Mostrar Barra de Clima</span>
                        </label>
                        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 8px; margin-left: 32px; line-height: 1.5;">
                            Muestra una barra con el pronóstico del clima encima de la lista de asistencia. Al desplegarla verás detalle del día y las próximas horas. Desactivado por defecto.
                        </div>
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

                <!-- 💡 Ayuda contextual -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        💡 Ayuda contextual
                    </h3>
                    <div class="form-group">
                        <label class="form-label">¿Cuándo mostrar los tooltips de ayuda?</label>
                        <select id="helpMode" class="form-input" data-settings-action="set-help-mode">
                            <option value="first-time" ${(state.settings.helpMode || 'first-time') === 'first-time' ? 'selected' : ''}>
                                Solo la primera vez (recomendado)
                            </option>
                            <option value="always" ${state.settings.helpMode === 'always' ? 'selected' : ''}>
                                Siempre (modo capacitación)
                            </option>
                            <option value="off" ${state.settings.helpMode === 'off' ? 'selected' : ''}>
                                Solo al pulsar el botón (?)
                            </option>
                        </select>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px; line-height: 1.6;">
                            Los tooltips muestran explicaciones cortas al lado de los campos.
                            Puedes pulsar el botón <span style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; border: 1px solid #475569; background: rgba(100, 116, 139, 0.15); color: #94a3b8; font-size: 0.65rem; font-weight: 700;">?</span>
                            en cualquier momento para verlos.
                        </div>
                    </div>
                    <button type="button" data-settings-action="reset-help-seen"
                        style="margin-top: 12px; padding: 8px 16px; background: #334155; border: 1px solid #475569; color: #e2e8f0; border-radius: 6px; cursor: pointer; font-size: 0.85rem;">
                        🔄 Volver a mostrar todos los tooltips
                    </button>
                </div>

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
                                type="button" data-settings-action="install-pwa" 
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
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        ${icons.get('clock', { size: 18 })} Jornada Laboral
                    </h3>
                    
                    <!-- Horas Regulares -->
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            <span>Horas Regulares por Día</span>
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Define cuántas horas se consideran como jornada normal">ⓘ</span>
                        </label>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <input type="number" inputmode="decimal" 
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
                    
                    <!-- Factor Horas Extras -->
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            <span>Factor de Horas Extras</span>
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Multiplicador para calcular el pago de horas extras">ⓘ</span>
                        </label>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <input type="number" inputmode="decimal" 
                                   id="overtimeFactor" 
                                   value="${state.settings.overtimeFactor || 1}" 
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
                            <input type="number" inputmode="decimal" 
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
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        ${icons.get('dollar', { size: 18 }) || icons.get('payroll', { size: 18 })} Configuración de Nómina
                    </h3>
                    
                    <!-- Porcentaje de deducción por defecto -->
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            💸 Porcentaje de Deducción por Defecto
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Este porcentaje se aplicará automáticamente al agregar deducciones">ⓘ</span>
                        </label>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <input type="number" inputmode="decimal" 
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
                </div>
            `;
}

function SettingsHolidayCalendar() {
    return context.holidayService.renderSettingsCalendar();
}

// ============================================
// COMPONENTE: HISTORIAL DE SNAPSHOTS (Fase 4)
// ============================================
function SnapshotHistory() {
    const state = getState();
    const snapshots = state.snapshots || [];
    const isLoading = state.isLoadingSnapshots;

    return `
        <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-top: 20px; border: 1px solid #334155;">
            <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                <span>🕒</span> Historial de Versiones (Snapshots)
            </h3>
            
            ${isLoading ? `
                <div style="padding: 20px; text-align: center; color: #94a3b8;">
                    <div class="spinner" style="margin: 0 auto 10px;"></div>
                    Cargando versiones desde la nube...
                </div>
            ` : snapshots.length === 0 ? `
                <div style="padding: 20px; text-align: center; color: #64748b; font-style: italic;">
                    No hay snapshots disponibles en esta cuenta.
                </div>
            ` : `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${snapshots.map(snap => `
                        <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; display: flex; align-items: center; justify-content: space-between;">
                            <div style="flex: 1;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                    ${snap.type === 'pre-restore' ? `
                                        <span style="font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid #10b981; font-weight: 700; display: flex; align-items: center; gap: 4px;">
                                            🛡️ PROTEGIDO
                                        </span>
                                    ` : `
                                        <span style="font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; background: ${snap.type === 'auto' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(6, 182, 212, 0.1)'}; color: ${snap.type === 'auto' ? '#10b981' : '#06b6d4'}; border: 1px solid currentColor;">
                                            ${snap.type === 'auto' ? 'AUTO' : 'MANUAL'}
                                        </span>
                                    `}
                                    <span style="color: #f1f5f9; font-weight: 600; font-size: 0.9rem;">
                                        ${DateUtils.formatDateTime(snap.createdAt)}
                                    </span>

                                </div>
                                <div style="color: #94a3b8; font-size: 0.75rem; display: flex; align-items: center; gap: 4px;">
                                    ${icons.get('personnel', { size: 12 })} ${snap.employeeCount} empleados <span style="opacity: 0.4;">|</span> ${icons.get('file', { size: 12 })} ${snap.attendanceCount} registros
                                </div>
                            </div>
                            <div style="display: flex; gap: 6px;">
                                <button type="button" data-settings-action="delete-snapshot" data-id="${snap.id}" aria-label="Eliminar snapshot"
                                        style="padding: 8px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"
                                        title="Eliminar permanentemente">
                                    🗑️
                                </button>
                                <button type="button" data-settings-action="restore-snapshot" data-id="${snap.id}" aria-label="Restaurar snapshot" 
                                        style="padding: 8px 16px; background: rgba(6, 182, 212, 0.1); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;">
                                    ⏪ Restaurar
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
            
            <p style="margin: 16px 0 0 0; font-size: 0.7rem; color: #64748b; line-height: 1.4;">
                ⚠️ <strong>Nota:</strong> Al restaurar una versión, se sobrescribirán los datos actuales. Asegúrate de crear un snapshot nuevo antes si no estás seguro.
            </p>
        </div>
    `;
}

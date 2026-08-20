import { DateUtils } from '../utils/DateUtils.js';
import icons from './IconSystem.js';
import { state, stateManager } from '../core/AppState.js';
import { saveApplicationData } from '../services/PersistenceService.js';
import { APP_CONFIG } from '../config/Config.js';
import { SettingsGeneralTab } from './settings/SettingsGeneralTab.js';
import {
    SETTINGS_DRAFT_FIELD_IDS,
    refreshSettingsDraftBar,
    discardSettingsDraft,
    guardSettingsDraftOnLeave
} from './settings/SettingsDraftBar.js';
import { SettingsDataTab } from './settings/SettingsDataTab.js';
import { SettingsTabCalendar } from './settings/SettingsCalendarTab.js';
import { SettingsTestsTab } from './settings/SettingsTestsTab.js';
import { openSafeModalPreview } from './ModalPreviewGallery.js';
import { openSafeNotificationPreview } from './NotificationPreviewGallery.js';
import { clearAppCaches } from '../services/CacheManager.js';
import { translateError } from '../services/ErrorTranslator.js';
import { logError } from '../services/ErrorLog.js';
import {
    buildDefaultMiniAttendanceAliasScope,
    miniAttendanceAliasStore
} from '../services/MiniAttendanceAliasStore.js';
import { getLocalOwnerUid } from '../services/LocalDataOwner.js';

// ============================================
// EVENT DELEGATION (data-settings-action)
// ============================================
const _SETTINGS_ACTION_MAP = {
    // Cambiar de sub-pestaña re-renderiza el formulario desde state y pisa el
    // draft: con draft sucio se pregunta antes (guardSettingsDraftOnLeave).
    'change-settings-tab': (tab) => guardSettingsDraftOnLeave({
        onProceed: () => window.changeSettingsTab?.(tab)
    }),
    // Tras guardar, render() reconstruye el formulario desde state y emite
    // 'render:complete' (async — ver RenderManager.js); SettingsDraftBar.js
    // está suscrito a ese evento y refresca la barra ahí, así que acá no hace
    // falta (ni sirve: el DOM todavía está viejo en este mismo tick). Si la
    // validación falla no hay render, y la barra correctamente queda visible.
    'save-settings': () => window.saveSettings?.(),
    'discard-settings-draft': () => discardSettingsDraft({}),
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
    'open-modal-preview': (kind) => openSafeModalPreview(kind),
    'open-notification-preview': (kind) => openSafeNotificationPreview(kind),
    'export-error-log': () => window.exportErrorLog?.(),
    'purge-orphan-attendance': () => window.purgeOrphanAttendanceHandler?.(),
    'save-splitx-url': () => {
        const input = document.getElementById('splitxCustomUrl');
        let val = input ? input.value.trim() : '';
        if (val) {
            if (!/^https?:\/\//i.test(val)) {
                val = 'http://' + val;
            }
            try {
                const parsed = new URL(val);
                const isAllowed = parsed.hostname === 'splitx.erlin.do' ||
                                  parsed.hostname === 'localhost' ||
                                  parsed.hostname === '127.0.0.1';
                if (!isAllowed) {
                    window.showNotification?.(
                        '❌ Por seguridad solo se permite https://splitx.erlin.do o entornos locales (localhost / 127.0.0.1)',
                        'error'
                    );
                    return;
                }
            } catch (e) {
                window.showNotification?.('❌ URL inválida. Debe ser un formato como http://127.0.0.1:8081', 'error');
                return;
            }
        }
        stateManager.batchSetState(() => {
            state.settings.splitxUrl = val;
            state.settings.updatedAt = Date.now();
            state.settings._isDirty = true;
        });
        saveApplicationData();
        window.showNotification?.(
            val ? `✅ URL de SplitX configurada: ${val}` : '✅ URL de SplitX restablecida a https://splitx.erlin.do',
            'success'
        );
        context?.render?.();
    },
    'reset-splitx-url': () => {
        stateManager.batchSetState(() => {
            state.settings.splitxUrl = '';
            state.settings.updatedAt = Date.now();
            state.settings._isDirty = true;
        });
        saveApplicationData();
        window.showNotification?.('✅ URL de SplitX restablecida a https://splitx.erlin.do', 'success');
        context?.render?.();
    },
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
                console.error('❌ Error limpiando cache:', err);
                logError(err, 'limpiar el cache');
                window.showNotification?.(`No se pudo limpiar el cache: ${translateError(err, { fallbackContext: 'limpiar el cache' })}`, 'error');
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
    },
    'clear-mini-attendance-aliases': () => {
        const doClear = async () => {
            try {
                const ownerUid = window.currentUser?.uid || getLocalOwnerUid() || 'local-device';
                const scope = buildDefaultMiniAttendanceAliasScope(ownerUid);
                const { forgottenCount } = await miniAttendanceAliasStore.forgetAll(scope, {
                    actorUid: ownerUid
                });
                window.showNotification?.(
                    forgottenCount
                        ? `${forgottenCount} coincidencia(s) de Mini eliminada(s).`
                        : 'No había coincidencias de Mini guardadas.',
                    'success'
                );
            } catch (err) {
                console.error('❌ Error borrando coincidencias de Mini:', err);
                logError(err, 'borrar coincidencias de Mini');
                window.showNotification?.(
                    `No se pudieron borrar las coincidencias: ` +
                    `${translateError(err, { fallbackContext: 'borrar coincidencias de Mini' })}`,
                    'error'
                );
            }
        };
        if (window.showConfirm) {
            window.showConfirm({
                title: 'Borrar coincidencias de Mini',
                message: 'Se olvidarán todas las relaciones guardadas entre personal de Mini y SA. ' +
                    'No se borrarán empleados ni asistencias.',
                confirmText: 'Sí, borrar coincidencias',
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

// ============================================
// CONVENCIÓN DE CONTROLES DE AJUSTES (leer antes de agregar/modificar uno)
// ============================================
// Hay DOS familias de controles en la pantalla de Ajustes, con tratamiento
// distinto. Si agregás un control nuevo, decidí a cuál pertenece:
//
// 1. CONTROLES AUTO-COMMIT (sin validación, efecto inmediato): se comprometen
//    SOLOS al cambiar. Los switches (checkboxes toggle) se registran en
//    AUTO_SAVE_SWITCH_IDS y los comete commitAutoSaveSwitch; las opciones
//    cerradas (radios) se registran en AUTO_SAVE_OPTION_VALUES y las comete
//    commitAutoSaveOption. Los selects de efecto inmediato tienen su propio
//    commit (iconSet → window.commitIconSet en app.js, modo de ayuda → acción
//    set-help-mode). El commit muta state vía batchSetState, estampa
//    updatedAt/_isDirty y dispara saveApplicationData, así el cambio persiste
//    en IndexedDB y viaja en vivo a los demás dispositivos (Fase 2B: doc
//    per-registro de settings). NO los leas en window.saveSettings desde el
//    DOM como si fueran borrador: ya están comprometidos en state.
//
// 2. INPUTS VALIDADOS (texto/número/selects del formulario: companyName,
//    factores, horas, clima, etc. — la lista viva es
//    SETTINGS_DRAFT_FIELD_IDS en SettingsDraftBar.js): son BORRADOR en el
//    DOM hasta que el usuario confirma con "Guardar Configuración"
//    (window.saveSettings los lee, valida y comete todos juntos). No los
//    mutes en el listener de change — romperías la validación y el camino
//    de "Descartar".
//
// Gap que motivó esto (field test Fase 2B): un switch que solo muta memoria
// se ve aplicado localmente pero se pierde en F5 y nunca sincroniza.
const AUTO_SAVE_SWITCH_IDS = new Set([
    'legacyNavigation',
    'hideDuplicateAlerts',
    'weatherEnabled',
    'attendancePositionWatermarks'
]);
const AUTO_SAVE_OPTION_VALUES = new Map([
    ['attendanceWatermarkVisibility', new Set(['always', 'present'])],
    ['attendanceWatermarkContent', new Set(['number', 'position'])]
]);

function commitAutoSaveSetting({ key, value, deps = {} } = {}) {
    const {
        state: st = state,
        batchSetState = (cb) => stateManager.batchSetState(cb),
        save = saveApplicationData,
        now = Date.now
    } = deps;

    batchSetState(() => {
        st.settings[key] = value;
        st.settings.updatedAt = now();
        st.settings._isDirty = true;
    });
    save();
    return { committed: true, key };
}

/**
 * Comete un switch auto-save: escribe el valor en state.settings (dentro de
 * batchSetState — escritura administrada, sin deuda del ratchet de
 * check-state-writes), estampa updatedAt/_isDirty (mismo contrato que
 * window.saveSettings) y dispara el guardado (debounced) para que persista
 * y sincronice.
 *
 * @param {object} args
 * @param {string} args.id id del checkbox (debe estar en AUTO_SAVE_SWITCH_IDS)
 * @param {boolean} args.checked valor nuevo del switch
 * @param {object} [args.deps] Overrides para test: state, batchSetState, save, now.
 * @returns {{committed: boolean, key?: string}}
 */
export function commitAutoSaveSwitch({ id, checked, deps = {} } = {}) {
    if (!id || !AUTO_SAVE_SWITCH_IDS.has(id)) return { committed: false };
    return commitAutoSaveSetting({ key: id, value: checked, deps });
}

/**
 * Comete una elección cerrada de Ajustes y rechaza valores fuera de su
 * dominio para evitar configuraciones imposibles por DOM manipulado.
 */
export function commitAutoSaveOption({ name, value, deps = {} } = {}) {
    const allowedValues = AUTO_SAVE_OPTION_VALUES.get(name);
    if (!allowedValues?.has(value)) return { committed: false };
    return commitAutoSaveSetting({ key: name, value, deps });
}

function _isDraftField(target) {
    return !!target?.id && SETTINGS_DRAFT_FIELD_IDS.includes(target.id);
}

// Caso especial: Mostrar/ocultar configuración del clima en tiempo real
function _toggleWeatherPanel(visible) {
    const configPanel = document.getElementById('weatherConfigPanel');
    if (configPanel) configPanel.style.display = visible ? 'block' : 'none';
}

function _toggleAttendanceWatermarkPanel(visible) {
    const configPanel = document.getElementById('attendanceWatermarkConfigPanel');
    if (configPanel) configPanel.style.display = visible ? 'grid' : 'none';
}

function _handleSettingsSwitch(target) {
    const row = target.closest('.stg-switch-row');
    if (!row) return;
    row.classList.toggle('is-active', target.checked);
    row.setAttribute('aria-checked', target.checked ? 'true' : 'false');
    commitAutoSaveSwitch({ id: target.id, checked: target.checked });
    if (target.id === 'weatherEnabled') _toggleWeatherPanel(target.checked);
    if (target.id === 'attendancePositionWatermarks') {
        _toggleAttendanceWatermarkPanel(target.checked);
    }
}

function _handleSettingsOption(target) {
    const result = commitAutoSaveOption({ name: target.name, value: target.value });
    if (!result.committed) return;

    target.closest('.stg-choice-group')
        ?.querySelectorAll('.stg-choice-option')
        .forEach(option => option.classList.toggle(
            'is-selected',
            option.querySelector('input')?.checked === true
        ));
}

function _handleSettingsChange(e) {
    const target = e.target;
    if (target?.type === 'checkbox') _handleSettingsSwitch(target);
    if (target?.type === 'radio') _handleSettingsOption(target);
    // Selects del formulario disparan 'change' (no siempre 'input'): refrescar
    // la barra de draft si el control editado es un campo borrador.
    if (_isDraftField(target)) refreshSettingsDraftBar(document);
}

// Detección de draft sucio: cualquier tipeo en un campo borrador del
// formulario de Ajustes recalcula y muestra/oculta la barra pegajosa.
function _handleSettingsInput(e) {
    if (_isDraftField(e.target)) refreshSettingsDraftBar(document);
}

let _settingsDelegationAttached = false;
function _attachSettingsDelegation() {
    if (_settingsDelegationAttached) return;
    document.addEventListener('click', _handleSettingsClick);
    document.addEventListener('keydown', _handleSettingsKeydown);
    document.addEventListener('change', _handleSettingsChange);
    document.addEventListener('input', _handleSettingsInput);
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
                    ${activeTab === 'tests' ? SettingsTestsTab(context) : ''}
                    
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

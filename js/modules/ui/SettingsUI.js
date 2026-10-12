import { DateUtils } from '../utils/DateUtils.js';
import icons from './IconSystem.js';
import { state, stateManager } from '../core/AppState.js';
import { saveApplicationData } from '../services/PersistenceService.js';
import { APP_CONFIG } from '../config/Config.js';
import { SettingsGeneralTab } from './settings/SettingsGeneralTab.js';
import {
    SETTINGS_DRAFT_FIELD_IDS,
    isSettingsDraftDirty,
    captureSettingsDraft,
    restoreSettingsDraft,
    refreshSettingsDraftBar,
    discardSettingsDraft,
    guardSettingsDraftOnLeave
} from './settings/SettingsDraftBar.js';
import { SettingsDataTab } from './settings/SettingsDataTab.js';
import { SettingsTabCalendar } from './settings/SettingsCalendarTab.js';
import { SettingsTestsTab } from './settings/SettingsTestsTab.js';
import './onboarding/OnboardingPreview.js';
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
import { escapeAttr } from '../utils/Sanitize.js';
import { DOMDiff } from '../utils/DOMDiff.js';
import { clearSettingsFormErrors, refreshSettingsFormErrors, showSettingsFormError } from './settings/SettingsFormFeedback.js';
import { StorageCard, SyncCard, getSettingsSyncStatus, attachSettingsDiagnostics, refreshDeviceSettingsDiagnostics } from './settings/SettingsDiagnostics.js';
export { SyncCard, refreshDeviceSettingsDiagnostics } from './settings/SettingsDiagnostics.js';

// ============================================
// EVENT DELEGATION (data-settings-action)
// ============================================
const _SETTINGS_ACTION_MAP = {
    'refresh-device-diagnostics': () => refreshDeviceSettingsDiagnostics(),
    'manage-voice-audio': () => window.openVoiceAudioStorage?.(),
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
    'discard-settings-draft': () => { clearSettingsFormErrors(); discardSettingsDraft({}); },
    'login-with-google': () => window.loginWithGoogle?.(),
    'logout-firebase': () => window.logoutFirebase?.(),
    'sync-firebase-now': () => window.syncFirebaseNow?.(),
    'sync-history-now': () => window.syncHistoryNow?.(),
    'create-firebase-snapshot': () => window.createFirebaseSnapshot?.(),
    'start-maintenance-wizard': () => window.startMaintenanceWizard?.(),
    'open-project-reconciliation': () => window.openProjectReconciliation?.(),
    'export-data': () => window.exportData?.(),
    'open-project-setup': () => guardSettingsDraftOnLeave({
        onProceed: () => window.openProjectSetupModal?.()
    }),
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
            const labels = { always: 'Mostrar siempre', 'first-time': 'Mostrar una vez', off: 'Ayuda automática desactivada' };
            window.showNotification?.(`Ayuda: ${labels[newMode] || 'Configuración actualizada'}`, 'info');
        }
    },
    'reset-help-seen': () => {
        if (window.helpController) {
            window.helpController.resetAllSeen();
            window.showNotification?.('Tooltips restablecidos. Aparecerán de nuevo al usar la app.', 'success');
        }
    },
    'run-browser-tests': () => window.runBrowserTests?.(),
    'open-onboarding-preview': () => window.showOnboardingPreview?.(),
    'reset-onboarding-preview': () => window.resetOnboardingPreview?.(),
    'start-boot-loader-test': () => {
        const delayInput = document.getElementById('bootLoaderTestDelaySeconds');
        const errorInput = document.getElementById('bootLoaderTestErrorSeconds');
        const reloadInput = document.getElementById('bootLoaderTestReloadEnabled');
        const delaySeconds = Number(delayInput?.value);
        const errorSeconds = Number(errorInput?.value);

        if (!Number.isFinite(delaySeconds) || delaySeconds <= 0
            || !Number.isFinite(errorSeconds) || errorSeconds <= delaySeconds) {
            window.showNotification?.(
                'El tiempo de error debe ser mayor que el aviso de demora, y ambos deben ser positivos.',
                'warning'
            );
            return;
        }

        const started = window.appBootLoader?.startSimulation?.({
            slowDelayMs: Math.round(delaySeconds * 1000),
            failureDelayMs: Math.round(errorSeconds * 1000),
            reloadEnabled: reloadInput?.checked === true
        });

        if (!started) {
            window.showNotification?.(
                'No se pudo iniciar la simulación mientras hay otra carga activa.',
                'warning'
            );
        }
    },
    'open-modal-preview': (kind) => openSafeModalPreview(kind),
    'open-notification-preview': (kind) => openSafeNotificationPreview(kind),
    'export-error-log': () => window.exportErrorLog?.(),
    'purge-orphan-attendance': () => window.purgeOrphanAttendanceHandler?.(),
    'save-splitx-url': () => {
        const input = document.getElementById('splitxCustomUrl');
        let val = input ? input.value.trim() : '';
        if (val) {
            if (!/^https?:\/\//i.test(val)) {
                val = val.startsWith('splitx.erlin.do') ? 'https://' + val : 'http://' + val;
            }
            try {
                const parsed = new URL(val);
                const isSplitXProd = parsed.hostname === 'splitx.erlin.do';
                const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

                if (isSplitXProd && parsed.protocol !== 'https:') {
                    window.showNotification?.(
                        '❌ Para producción se requiere obligatoriamente HTTPS (https://splitx.erlin.do)',
                        'error'
                    );
                    return;
                }

                if (!isSplitXProd && !isLocal) {
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
        const dirty = isSettingsDraftDirty();
        const snapshot = captureSettingsDraft();
        const signature = draft => JSON.stringify(draft && [draft.scope, draft.fields]);
        let clearing = false;
        const doClear = async () => {
            if (clearing) return;
            // A later edit must not be covered by an earlier confirmation.
            if (signature(captureSettingsDraft()) !== signature(snapshot)) {
                _SETTINGS_ACTION_MAP['clear-cache']();
                return;
            }
            clearing = true;
            try {
                const { deletedCaches } = await clearAppCaches();
                window.showNotification?.(
                    `Caché limpiada (${deletedCaches}). Recargando para traer la última versión…`,
                    'success'
                );
                setTimeout(() => window.location.reload(), 600);
            } catch (err) {
                clearing = false;
                logError(err, 'limpiar el cache');
                showSettingsFormError(`No se pudo limpiar la caché. Tus cambios pendientes se conservan. ${translateError(err, { fallbackContext: 'limpiar el cache' })}`);
            }
        };
        if (window.showConfirm) {
            window.showConfirm({
                title: 'Limpiar caché y recargar',
                message: dirty
                    ? 'Hay cambios sin guardar. Si recargas, se descartarán. Los datos ya guardados se conservan.'
                    : 'Se limpiarán los archivos de la aplicación y se recargará. Tus datos guardados se conservan.',
                confirmText: dirty ? 'Descartar cambios y recargar' : 'Limpiar y recargar',
                cancelText: dirty ? 'Seguir editando' : 'Cancelar',
                type: 'warning',
                onConfirm: doClear
            });
        } else if (dirty) {
            showSettingsFormError('Guarda o descarta los cambios pendientes antes de limpiar la caché y recargar.');
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
    if (target.tagName === 'SELECT') return;
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
    'voiceMvpEnabled',
    'voiceUsePreviousInterest',
    'voiceKeepLoanAudio',
    'newBottomNav',
    'voiceFeedback',
    'newReceiptCamera',
    'attendancePositionWatermarks'
]);
const AUTO_SAVE_OPTION_VALUES = new Map([
    ['voiceAudioRetentionDays', new Set(['1', '2', '3', '4', '5'])],
    ['attendanceWatermarkVisibility', new Set(['always', 'present'])],
    ['attendanceWatermarkContent', new Set(['number', 'position'])],
    ['loansCapacityStyle', new Set(['gauge', 'stacked'])],
    ['loansKpiDensity', new Set(['full', 'compact'])],
    ['miniConnectedReviewMode', new Set(['daily', 'compare'])],
    ['navCenterMode', new Set(['auto', 'plus', 'mic'])]
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
    if (target?.matches('select[data-settings-action]')) {
        _SETTINGS_ACTION_MAP[target.dataset.settingsAction]?.(null, target, e);
    }
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
let detachDiagnostics = null;

export function initSettingsUI(dependencies) {
    detachDiagnostics?.();
    context = dependencies;
    detachDiagnostics = attachSettingsDiagnostics(context);
}

function getState() { return context.state; }
function getIcons() { return context.icons; }

/** Apply pending state updates before reading the form, preserving edited fields. */
export function reconcileSettingsDraftBeforeSave(doc = document) {
    const screen = doc.getElementById('settings-screen');
    if (!screen) return;
    const snapshot = captureSettingsDraft(doc);
    DOMDiff.patchSelf(screen, SettingsTab());
    restoreSettingsDraft(snapshot, doc);
    refreshSettingsFormErrors(doc);
    refreshSettingsDraftBar(doc);
}

// The badge describes the persistence contract, not a completed save.
function addSettingsSaveModes(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    for (const control of template.content.querySelectorAll('input, select')) {
        const pending = SETTINGS_DRAFT_FIELD_IDS.includes(control.id);
        const automatic = AUTO_SAVE_SWITCH_IDS.has(control.id)
            || AUTO_SAVE_OPTION_VALUES.has(control.name)
            || ['iconSet', 'helpModeSelect', 'backupFrequency', 'mirrorCadence',
                'settingsPeriodStart', 'settingsPeriodLength', 'settingsPayDay'].includes(control.id);
        if (!pending && !automatic) continue;
        let label = control.closest('.stg-switch-row')?.querySelector('.stg-switch-copy strong')
            || (control.id && template.content.querySelector(`label[for="${control.id}"]`));
        if (!label && control.tagName === 'SELECT') {
            label = control.closest('.form-group')?.querySelector('label');
            label?.setAttribute('for', control.id);
        }
        if (!label && control.type === 'radio') {
            label = control.closest('fieldset')?.querySelector('legend') || control.closest('.stg-choice-group');
        }
        if (!label || label.querySelector('.settings-save-mode')) continue;
        const badge = document.createElement('span');
        badge.className = 'settings-save-mode';
        badge.textContent = pending ? 'Al guardar' : 'Automático';
        if (label.classList.contains('stg-choice-group')) badge.style.gridColumn = '1 / -1';
        label.append(badge);
    }
    return template.innerHTML;
}

// ============================================
// SETTINGS TAB (entry point)
// ============================================

export function SettingsTab() {
    const state = getState();
    const icons = getIcons();

    // Fallback para pestaña activa si está indefinida
    const activeTab = state.settingsActiveTab || 'general';
    let calendarContext = context;
    if (activeTab === 'calendar' && context.payrollRuntime) {
        const payrollView = context.payrollRuntime.getCurrentView();
        if (payrollView.enabled) {
            if (payrollView.status === 'idle') {
                context.payrollRuntime.ensureCurrentConfig()
                    .catch(() => null)
                    .finally(() => context.render?.());
            }
            calendarContext = {
                ...context,
                payrollSettings: payrollView.settingsView,
                payrollConfigStatus: payrollView.status,
                payrollProjectId: payrollView.projectId
            };
        }
    }

    return addSettingsSaveModes(`
                <div id="settings-screen" data-settings-draft-tab="${activeTab}" data-settings-draft-scope="${escapeAttr(JSON.stringify([activeTab, activeTab === 'calendar' ? calendarContext.payrollProjectId || 'global' : 'global']))}" style="max-width: 900px; margin: 0 auto;">
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
                                type="button" aria-label="Datos" data-settings-action="change-settings-tab" data-value="data">
                            <span>${icons.get('save')}</span><span class="tab-text"> Datos</span>
                        </button>

                        <button class="nav-tab ${activeTab === 'general' ? 'active' : ''}" 
                                type="button" aria-label="General" data-settings-action="change-settings-tab" data-value="general">
                            <span>${icons.get('settings')}</span><span class="tab-text"> General</span>
                        </button>

                        <button class="nav-tab ${activeTab === 'calendar' ? 'active' : ''}"
                                type="button" aria-label="Calendario" data-settings-action="change-settings-tab" data-value="calendar">
                            <span>${icons.get('calendar')}</span><span class="tab-text"> Calendario</span>
                        </button>

                        <button class="nav-tab ${activeTab === 'tests' ? 'active' : ''}"
                                type="button" aria-label="Tests" data-settings-action="change-settings-tab" data-value="tests">
                            <span>${icons.get('info')}</span><span class="tab-text"> Tests</span>
                        </button>
                    </div>

                    <p class="settings-save-guide">Automático: se guarda al cambiar. Al guardar: confirma los cambios en la barra inferior.</p>
                    <!-- Contenido de las Pestañas -->
                    ${activeTab === 'general' ? SettingsGeneralTab(context) : ''}
                    ${activeTab === 'data' ? SettingsDataTab(context) : ''}
                    ${activeTab === 'calendar' ? SettingsTabCalendar(calendarContext) : ''}
                    ${activeTab === 'tests' ? SettingsTestsTab(context) : ''}
                    

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
            `);
}

// ============================================
// DASHBOARD DE CONFIGURACIÓN
// ============================================

function SettingsDashboard() {
    return `
                <div class="stg-panel" style="margin-bottom: 24px;">
                    <div class="stg-status-bar">
                        ${StorageCard()}
                        ${SyncCard(getSettingsSyncStatus(context))}
                        ${DataSummaryCard()}
                    </div>
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

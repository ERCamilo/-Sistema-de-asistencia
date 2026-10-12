/**
 * SettingsTestsTab.js — Panel de pruebas del sistema en Configuración.
 *
 * Permite ejecutar la suite de pruebas con datos aislados directamente
 * desde el navegador, sin afectar datos reales del usuario.
 */

import icons from '../IconSystem.js';

const NAV_CENTER_MODES = [
    ['auto', 'Automático', 'Micrófono con conexión; "+" sin conexión o sin permiso de micrófono.'],
    ['plus', 'Siempre +', 'Foto de factura y buscar empleado; dictar queda en el menú.'],
    ['mic', 'Siempre micrófono', 'Mantén pulsado para dictar, aunque no haya conexión.']
];

// Prueba de la barra inferior de 5 posiciones (js/modules/ui/navigation/BottomNav.js).
function newBottomNavCard(settings = {}) {
    const on = settings.newBottomNav === true;
    const current = NAV_CENTER_MODES.some(([value]) => value === settings.navCenterMode) ? settings.navCenterMode : 'auto';
    const centerChoice = !on ? '' : `
                <strong style="display:block;font-size:.88rem;color:#e2e8f0;margin:14px 0 8px;">Botón central de la barra</strong>
                ${settings.voiceMvpEnabled === true ? '' : '<small style="display:block;color:#94a3b8;margin:-4px 0 10px;">El micrófono aparece cuando la prueba de voz está activa. Mientras tanto se muestra "+".</small>'}
                <div class="stg-choice-group">
                    ${NAV_CENTER_MODES.map(([value, label, hint]) => `
                    <label class="stg-choice-option ${current === value ? 'is-selected' : ''}">
                        <input type="radio" name="navCenterMode" value="${value}" ${current === value ? 'checked' : ''}>
                        <span class="stg-choice-copy">
                            <strong>${label}</strong>
                            <small>${hint}</small>
                        </span>
                    </label>`).join('')}
                </div>`;
    return `
            <section class="stg-card" aria-labelledby="new-bottom-nav-test-title" style="margin-bottom:20px;">
                <h3 id="new-bottom-nav-test-title">Barra inferior nueva</h3>
                <label class="stg-switch-row ${on ? 'is-active' : ''}" role="switch" aria-checked="${on}">
                    <input type="checkbox" id="newBottomNav" ${on ? 'checked' : ''}>
                    <span class="stg-switch-copy">
                        <strong>Usar la barra de 5 posiciones</strong>
                        <small>Asistencia · Personal · botón de captura · Finanzas · Más, con menús por sección. Solo en el teléfono.</small>
                    </span>
                    <span class="stg-switch-track" aria-hidden="true"><span class="stg-switch-handle"></span></span>
                </label>${centerChoice}
            </section>`;
}

// Prueba de la cámara de facturas a pantalla completa (PettyCashCamera.js).
function newReceiptCameraCard(settings = {}) {
    const on = settings.newReceiptCamera === true;
    return `
            <section class="stg-card" aria-labelledby="new-receipt-camera-test-title" style="margin-bottom:20px;">
                <h3 id="new-receipt-camera-test-title">Cámara de facturas nueva</h3>
                <label class="stg-switch-row ${on ? 'is-active' : ''}" role="switch" aria-checked="${on}">
                    <input type="checkbox" id="newReceiptCamera" ${on ? 'checked' : ''}>
                    <span class="stg-switch-copy">
                        <strong>Cámara a pantalla completa en Caja chica</strong>
                        <small>Varias fotos seguidas, con las facturas en una pila junto al disparador y vista previa de cada una. Si el navegador no lo permite, se usa la cámara del teléfono.</small>
                    </span>
                    <span class="stg-switch-track" aria-hidden="true"><span class="stg-switch-handle"></span></span>
                </label>
            </section>`;
}

function toolGroup(id, title, hint, content) {
    // Read the live disclosure state so a reactive patch does not close it.
    const current = document.getElementById(id);
    const open = current?.open ? 'open' : '';
    // These are temporary simulation values, not persisted settings.
    if (current && id === 'settings-diagnostics-tools') {
        const template = document.createElement('template');
        template.innerHTML = content;
        for (const fieldId of ['bootLoaderTestDelaySeconds', 'bootLoaderTestErrorSeconds', 'bootLoaderTestReloadEnabled']) {
            const live = current.querySelector(`#${fieldId}`);
            const next = template.content.querySelector(`#${fieldId}`);
            if (!live || !next) continue;
            if (live.type === 'checkbox') next.toggleAttribute('checked', live.checked);
            else next.setAttribute('value', live.value);
        }
        content = template.innerHTML;
    }
    return `<details id="${id}" class="settings-tool-group" ${open}>
        <summary><span><strong>${title}</strong><small>${hint}</small></span></summary>
        <div class="settings-tool-content">${content}</div>
    </details>`;
}

export function SettingsTestsTab(context) {
    const state = context?.state || {};
    const splitxActiveUrl = state.settings?.splitxUrl || 'https://splitx.erlin.do';

    const experiments = `            ${newBottomNavCard(state.settings)}
            ${newReceiptCameraCard(state.settings)}
            <section class="stg-card" aria-labelledby="voice-mvp-test-title" style="margin-bottom:20px;">
                <h3 id="voice-mvp-test-title">Prueba de voz</h3>
                <label class="stg-switch-row ${state.settings?.voiceMvpEnabled === true ? 'is-active' : ''}" role="switch" aria-checked="${state.settings?.voiceMvpEnabled === true}">
                    <input type="checkbox" id="voiceMvpEnabled" ${state.settings?.voiceMvpEnabled === true ? 'checked' : ''}>
                    <span class="stg-switch-copy"><strong>Activar instrucciones por voz</strong><small>Muestra el micrófono para grabar y revisar instrucciones de voz.</small></span>
                    <span class="stg-switch-track" aria-hidden="true"><span class="stg-switch-handle"></span></span>
                </label>
                <p>Mantén pulsado para grabar y suelta para terminar. Revisa el préstamo antes de registrarlo.</p>
                <label class="stg-switch-row ${state.settings?.voiceUsePreviousInterest === true ? 'is-active' : ''}" role="switch" aria-checked="${state.settings?.voiceUsePreviousInterest === true}">
                    <input type="checkbox" id="voiceUsePreviousInterest" ${state.settings?.voiceUsePreviousInterest === true ? 'checked' : ''}>
                    <span class="stg-switch-copy"><strong>Usar la tasa anterior del empleado en préstamos por voz</strong><small>Si no indicas interés, reutiliza su última tasa válida; sin una anterior usa 20 %. Una tasa indicada en la voz o editada tiene prioridad.</small></span>
                    <span class="stg-switch-track" aria-hidden="true"><span class="stg-switch-handle"></span></span>
                </label>
                <label class="stg-switch-row ${state.settings?.voiceKeepLoanAudio !== false ? 'is-active' : ''}" role="switch" aria-checked="${state.settings?.voiceKeepLoanAudio !== false}">
                    <input type="checkbox" id="voiceKeepLoanAudio" ${state.settings?.voiceKeepLoanAudio !== false ? 'checked' : ''}>
                    <span class="stg-switch-copy"><strong>Conservar audio de préstamos</strong><small>Solo en este navegador. Desactivarlo elimina los audios de préstamos guardados y no conserva los nuevos.</small></span>
                    <span class="stg-switch-track" aria-hidden="true"><span class="stg-switch-handle"></span></span>
                </label>
                <label class="stg-switch-row ${state.settings?.voiceFeedback !== false ? 'is-active' : ''}" role="switch" aria-checked="${state.settings?.voiceFeedback !== false}">
                    <input type="checkbox" id="voiceFeedback" ${state.settings?.voiceFeedback !== false ? 'checked' : ''}>
                    <span class="stg-switch-copy"><strong>Sonido y vibración al grabar</strong><small>Un tic y una vibración corta al empezar a escuchar, y otro al terminar. En iPhone solo suena: el navegador no permite vibrar.</small></span>
                    <span class="stg-switch-track" aria-hidden="true"><span class="stg-switch-handle"></span></span>
                </label>
                <h4>Tiempo de conservación desde el registro</h4>
                <div class="stg-choice-group" role="group" aria-label="Días de conservación de audio">
                    ${[1, 2, 3, 4, 5].map(days => `<label class="stg-choice-option ${Number(state.settings?.voiceAudioRetentionDays ?? 5) === days ? 'is-selected' : ''}"><input type="radio" name="voiceAudioRetentionDays" value="${days}" ${Number(state.settings?.voiceAudioRetentionDays ?? 5) === days ? 'checked' : ''}><span>${days} ${days === 1 ? 'día' : 'días'}</span></label>`).join('')}
                </div>
                <p data-voice-storage-status role="status">${context.currentUser ? 'Consultando el espacio de audios…' : 'Inicia sesión para gestionar tus audios.'}</p>
                <button type="button" class="btn btn-secondary" data-voice-storage-retry hidden>Reintentar consulta</button>
                <p data-voice-storage-warning role="status" hidden></p>
                <button type="button" class="btn btn-secondary" data-settings-action="manage-voice-audio" ${context.currentUser ? '' : 'disabled'}>Gestionar audios guardados</button>
                <p>Las búsquedas y los audios descartados se eliminan. Los vencidos se limpian al abrir la app y mientras está abierta. Límite local: 50 MiB.</p>
            </section>
`;
    const diagnostics = `            <div class="stg-header" style="margin-bottom: 20px;">
                <div>
                    <h3>Pruebas del Sistema</h3>
                    <p>
                        Ejecuta la suite de pruebas automáticas con <strong style="color:#e2e8f0;">datos de prueba aislados</strong>.
                        Ninguna prueba toca tus empleados, asistencias ni préstamos reales.
                    </p>
                </div>
                <button
                    type="button"
                    data-settings-action="run-browser-tests"
                    class="btn btn-primary"
                    style="flex-shrink: 0; padding: 10px 20px; font-size: 0.875rem; white-space: nowrap;">
                    Ejecutar Pruebas
                </button>
            </div>

            <div id="browser-test-results" style="font-family: monospace;">
                <div class="stg-card" style="color: var(--stg-text-secondary); font-size: 0.8rem; text-align: center;">
                    Presiona "Ejecutar Pruebas" para iniciar la verificación del sistema.
                </div>
            </div>

            <section class="stg-card" aria-labelledby="boot-loader-test-title" style="margin-top:20px;">
                <h4 id="boot-loader-test-title" style="margin-top:0;">Simulación de pantalla de carga</h4>
                <p id="boot-loader-test-help" style="color:#94a3b8;font-size:.84rem;line-height:1.5;">
                    Muestra el loader real y lo mantiene detenido para comprobar sus avisos. La simulación no guarda estos valores ni cambia el arranque normal.
                </p>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:12px;">
                    <label for="bootLoaderTestDelaySeconds" style="display:flex;flex-direction:column;gap:6px;font-size:.8rem;color:#cbd5e1;font-weight:600;">
                        Aviso de demora (segundos)
                        <input id="bootLoaderTestDelaySeconds" class="form-input" type="number" min="0.1" step="0.1" value="2" aria-describedby="boot-loader-test-help">
                    </label>
                    <label for="bootLoaderTestErrorSeconds" style="display:flex;flex-direction:column;gap:6px;font-size:.8rem;color:#cbd5e1;font-weight:600;">
                        Aviso de error (segundos)
                        <input id="bootLoaderTestErrorSeconds" class="form-input" type="number" min="0.2" step="0.1" value="5" aria-describedby="boot-loader-test-help">
                    </label>
                </div>
                <label for="bootLoaderTestReloadEnabled" style="display:flex;align-items:center;gap:9px;margin-top:14px;color:#cbd5e1;font-size:.84rem;cursor:pointer;">
                    <input id="bootLoaderTestReloadEnabled" type="checkbox" checked>
                    Mostrar la opción «Recargar aplicación» al llegar al error
                </label>
                <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:16px;">
                    <button type="button" class="btn btn-primary" data-settings-action="start-boot-loader-test">
                        Mostrar loader detenido
                    </button>
                    <span style="color:var(--stg-text-secondary);font-size:.78rem;">Podrás cerrarlo desde la propia pantalla de carga.</span>
                </div>
            </section>

`;
    const development = `            <!-- Integración SplitX en Pruebas / Desarrollo -->
            <section class="stg-card" aria-labelledby="splitx-integration-title" style="margin-top:20px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                    ${icons.get('splitx', { size: 22 })}
                    <h4 id="splitx-integration-title" style="margin:0;">Conexión de prueba con SplitX</h4>
                </div>
                <p style="color:#94a3b8;font-size:.84rem;line-height:1.5;">
                    Usa una dirección local para probar SplitX. En blanco, se usa <code>https://splitx.erlin.do</code>.
                </p>
                <div style="display:flex;flex-direction:column;gap:8px;max-width:520px;margin-top:12px;">
                    <label for="splitxCustomUrl" style="font-size:0.8rem;color:#cbd5e1;font-weight:600;">URL de destino para SplitX:</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input type="url" 
                               id="splitxCustomUrl" 
                               class="form-input" 
                               style="flex:1;min-width:0;font-size:0.85rem;"
                               placeholder="https://splitx.erlin.do (o ej. http://127.0.0.1:8081)" 
                               value="${state.settings?.splitxUrl || ''}">
                        <button type="button" 
                                class="btn btn-primary" 
                                data-settings-action="save-splitx-url"
                                style="white-space:nowrap;font-size:0.85rem;padding:6px 14px;">
                            Guardar URL
                        </button>
                        <button type="button" 
                                class="btn btn-secondary" 
                                data-settings-action="reset-splitx-url"
                                title="Restablecer a URL por defecto (https://splitx.erlin.do)"
                                style="white-space:nowrap;font-size:0.85rem;padding:6px 10px;">
                            Por defecto
                        </button>
                    </div>
                    <div style="margin-top:4px;font-size:0.78rem;color:var(--stg-text-secondary);">
                        URL activa: <strong style="color:#38bdf8;">${splitxActiveUrl}</strong>
                    </div>
                </div>
            </section>

            <section class="stg-card" aria-labelledby="modal-preview-title" style="margin-top:20px;">
                <h4 id="modal-preview-title" style="margin-top:0;">Vista previa segura de modales</h4>
                <p style="color:#94a3b8;font-size:.84rem;line-height:1.5;">Abre componentes reales con datos de ejemplo. Sus acciones están desconectadas: no guardan, suben ni borran información.</p>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    <button type="button" class="btn btn-secondary" data-settings-action="open-modal-preview" data-value="outgoing-conflict">Conflicto nube/local</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-modal-preview" data-value="incoming-changes">Cambios entrantes</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-modal-preview" data-value="restore-backup">Restaurar backup</button>
                </div>
            </section>

            <section class="stg-card" aria-labelledby="notification-preview-title" style="margin-top:20px;">
                <h4 id="notification-preview-title" style="margin-top:0;">Muestras de notificaciones</h4>
                <p style="color:#94a3b8;font-size:.84rem;line-height:1.5;">Prueba los diferentes estados visuales, botones de acción interactivos, animación de reintento y apilamiento.</p>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="success">Éxito</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="warning-retry">Aviso con reintento</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="error">Error</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="info">Info</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="loading">Carga y transición</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="update">Actualización PWA</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="stack">Varios avisos</button>
                </div>
            </section>
`;
    return `
        <section class="stg-panel" aria-labelledby="settings-experiments-title">
            <div class="stg-header"><div><h3 id="settings-experiments-title">Funciones en prueba</h3><p>Activa las funciones que quieras probar.</p></div></div>
            ${experiments}
        </section>
        <section class="stg-panel" aria-labelledby="settings-help-title">
            <div class="stg-header"><div><h3 id="settings-help-title">Ayuda y diagnóstico</h3><p>Repasa la guía o comprueba la aplicación.</p></div></div>
                        <!-- Onboarding v2 — guía de inicio real -->
            <section class="stg-card" aria-labelledby="onboarding-preview-title" style="margin-top:20px;">
                <h4 id="onboarding-preview-title" style="margin-top:0;">Guía de inicio</h4>
                <p style="color:#94a3b8;font-size:.84rem;line-height:1.5;">
                    Repasa la guía de inicio. Sus acciones usan tus datos reales; reiniciar borra el progreso de la guía en este navegador.
                </p>
                <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:16px;">
                    <button type="button" class="btn btn-primary" data-settings-action="open-onboarding-preview">
                        Abrir la guía de inicio
                    </button>
                    <button type="button" class="btn btn-secondary" data-settings-action="reset-onboarding-preview" style="font-size:.8rem;padding:6px 12px;">
                        Reiniciar progreso guardado
                    </button>
                    <span style="color:var(--stg-text-secondary);font-size:.78rem;">Ciérrala con Esc o con la × de la esquina superior.</span>
                </div>
            </section>

            ${toolGroup('settings-diagnostics-tools', 'Comprobar la aplicación', 'Pruebas automáticas y simulación de carga', diagnostics)}
            ${toolGroup('settings-development-tools', 'Herramientas de desarrollo', 'SplitX y muestras de ventanas y avisos', development)}
        </section>
    `;
}

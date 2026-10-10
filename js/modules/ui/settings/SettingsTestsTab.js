/**
 * SettingsTestsTab.js — Panel de pruebas del sistema en Configuración.
 *
 * Permite ejecutar la suite de pruebas con datos aislados directamente
 * desde el navegador, sin afectar datos reales del usuario.
 */

import icons from '../IconSystem.js';

export function SettingsTestsTab(context) {
    const state = context?.state || {};
    const splitxActiveUrl = state.settings?.splitxUrl || 'https://splitx.erlin.do';

    return `
        <div class="stg-panel">
            <section class="stg-card" aria-labelledby="voice-mvp-test-title" style="margin-bottom:20px;">
                <h3 id="voice-mvp-test-title">Prueba de voz</h3>
                <label class="stg-switch-row ${state.settings?.voiceMvpEnabled === true ? 'is-active' : ''}" role="switch" aria-checked="${state.settings?.voiceMvpEnabled === true}">
                    <input type="checkbox" id="voiceMvpEnabled" ${state.settings?.voiceMvpEnabled === true ? 'checked' : ''}>
                    <span class="stg-switch-copy"><strong>Activar botón de voz · MVP</strong><small>Muestra el micrófono para grabar y revisar instrucciones de voz.</small></span>
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
                <h4>Tiempo de conservación desde el registro</h4>
                <div class="stg-choice-group" role="group" aria-label="Días de conservación de audio">
                    ${[1, 2, 3, 4, 5].map(days => `<label class="stg-choice-option ${Number(state.settings?.voiceAudioRetentionDays ?? 5) === days ? 'is-selected' : ''}"><input type="radio" name="voiceAudioRetentionDays" value="${days}" ${Number(state.settings?.voiceAudioRetentionDays ?? 5) === days ? 'checked' : ''}><span>${days} ${days === 1 ? 'día' : 'días'}</span></label>`).join('')}
                </div>
                <p data-voice-storage-status>Calculando el espacio de audios…</p>
                <p data-voice-storage-warning role="status" hidden></p>
                <button type="button" class="btn btn-secondary" data-settings-action="manage-voice-audio">Gestionar audios guardados</button>
                <p>Las búsquedas y los audios descartados se eliminan. Los vencidos se limpian al abrir la app y mientras está abierta. Límite local: 50 MiB.</p>
            </section>
            <div class="stg-header" style="margin-bottom: 20px;">
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
                <div class="stg-card" style="color: #475569; font-size: 0.8rem; text-align: center;">
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
                    <span style="color:#64748b;font-size:.78rem;">Podrás cerrarlo desde la propia pantalla de carga.</span>
                </div>
            </section>

            <!-- Onboarding v2 — guía de inicio real -->
            <section class="stg-card" aria-labelledby="onboarding-preview-title" style="margin-top:20px;">
                <h4 id="onboarding-preview-title" style="margin-top:0;">Guía de inicio (Onboarding v2)</h4>
                <p style="color:#94a3b8;font-size:.84rem;line-height:1.5;">
                    Abre la misma guía real que se muestra en el primer arranque, con acciones sobre datos reales.
                    Úsala para repasarla o relanzarla; reiniciar borra el progreso guardado en este navegador.
                </p>
                <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:16px;">
                    <button type="button" class="btn btn-primary" data-settings-action="open-onboarding-preview">
                        Abrir la guía de inicio
                    </button>
                    <button type="button" class="btn btn-secondary" data-settings-action="reset-onboarding-preview" style="font-size:.8rem;padding:6px 12px;">
                        Reiniciar progreso guardado
                    </button>
                    <span style="color:#64748b;font-size:.78rem;">Ciérrala con Esc o con la × de la esquina superior.</span>
                </div>
            </section>
            <!-- Integración SplitX en Pruebas / Desarrollo -->
            <section class="stg-card" aria-labelledby="splitx-integration-title" style="margin-top:20px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                    ${icons.get('splitx', { size: 22 })}
                    <h4 id="splitx-integration-title" style="margin:0;">Entorno de SplitX (Desarrollo / Pruebas)</h4>
                </div>
                <p style="color:#94a3b8;font-size:.84rem;line-height:1.5;">
                    Configura una dirección local personalizada (ej: <code>http://127.0.0.1:8081</code> o <code>http://localhost:5500</code>) para probar la integración con SplitX antes del despliegue. Si se deja en blanco o se restablece, se usará la URL de producción.
                </p>
                <div style="display:flex;flex-direction:column;gap:8px;max-width:520px;margin-top:12px;">
                    <label for="splitxCustomUrl" style="font-size:0.8rem;color:#cbd5e1;font-weight:600;">URL de destino para SplitX:</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input type="url" 
                               id="splitxCustomUrl" 
                               class="form-input" 
                               style="flex:1;min-width:240px;font-size:0.85rem;"
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
                    <div style="margin-top:4px;font-size:0.78rem;color:#64748b;">
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
                <h4 id="notification-preview-title" style="margin-top:0;">Vista previa de notificaciones (Toasts)</h4>
                <p style="color:#94a3b8;font-size:.84rem;line-height:1.5;">Prueba los diferentes estados visuales, botones de acción interactivos, animación de reintento y apilamiento.</p>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="success">Éxito</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="warning-retry">Warning con Reintentar</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="error">Error</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="info">Info</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="loading">Carga y transición</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="update">Actualización PWA</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-notification-preview" data-value="stack">Ráfaga (Stacking)</button>
                </div>
            </section>
        </div>
    `;
}

/**
 * SettingsGeneralTab.js - Componente de la pestaña General
 * Estilo visual: SyncCenter (stg-* classes)
 */
export function SettingsGeneralTab(context) {
    const state = context.state;
    const icons = context.icons;
    const iconSetOptions = icons.getAvailableSets()
        .map(set => `<option value="${set}" ${state.settings.iconSet === set ? 'selected' : ''}>${set}</option>`)
        .join('');

    return `
                <!-- Información de la Empresa -->
                <div class="stg-panel">
                    <div class="stg-header">
                        <div>
                            <h3>Información de la Empresa</h3>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">Nombre de la Empresa</label>
                        <input type="text" 
                               id="companyName" 
                               value="${state.settings.companyName}" 
                               class="form-input"
                               placeholder="Ej: Constructora El Progreso">
                    </div>
                </div>

                <!-- Interfaz -->
                <div class="stg-panel">
                    <div class="stg-header" style="margin-bottom: 14px;">
                        <div>
                            <h3>Interfaz de Navegación</h3>
                        </div>
                    </div>
                    
                    <label class="stg-switch-row ${state.settings.legacyNavigation ? 'is-active' : ''}" 
                           role="switch" aria-checked="${!!state.settings.legacyNavigation}">
                        <input type="checkbox" id="legacyNavigation" ${state.settings.legacyNavigation ? 'checked' : ''}>
                        <span class="stg-switch-copy">
                            <strong>Usar Menú Superior Clásico</strong>
                            <small>Si se activa, el menú se mostrará como pestañas en la parte superior en lugar de la barra flotante inferior.</small>
                        </span>
                        <span class="stg-switch-track" aria-hidden="true">
                            <span class="stg-switch-handle"></span>
                        </span>
                    </label>

                    <label class="stg-switch-row ${state.settings.hideDuplicateAlerts ? 'is-active' : ''}"
                           role="switch" aria-checked="${!!state.settings.hideDuplicateAlerts}">
                        <input type="checkbox" id="hideDuplicateAlerts" ${state.settings.hideDuplicateAlerts ? 'checked' : ''}>
                        <span class="stg-switch-copy">
                            <strong>Ocultar Alertas de Duplicados</strong>
                            <small>Si se activa, el triángulo no se mostrará en el menú principal aunque existan conflictos.</small>
                        </span>
                        <span class="stg-switch-track" aria-hidden="true">
                            <span class="stg-switch-handle"></span>
                        </span>
                    </label>

                    <label class="stg-switch-row ${state.settings.weatherEnabled === true ? 'is-active' : ''}"
                           role="switch" aria-checked="${state.settings.weatherEnabled === true}">
                        <input type="checkbox" id="weatherEnabled" ${state.settings.weatherEnabled === true ? 'checked' : ''}>
                        <span class="stg-switch-copy">
                            <strong>Mostrar Barra de Clima</strong>
                            <small>Muestra una barra con el pronostico del clima encima de la lista de asistencia. Desactivado por defecto.</small>
                        </span>
                        <span class="stg-switch-track" aria-hidden="true">
                            <span class="stg-switch-handle"></span>
                        </span>
                    </label>

                    <div id="weatherConfigPanel" class="stg-card" style="margin-top: 4px; margin-left: 0; display: ${state.settings.weatherEnabled === true ? 'block' : 'none'};">
                        <div class="stg-card-title">Configuración del Clima</div>
                        <div class="form-group" style="margin-bottom: 16px;">
                            <label class="form-label" style="font-size: 0.85rem; color: #94a3b8;">
                                API Key de WeatherAPI.com
                            </label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="password"
                                       id="weatherApiKey"
                                       value="${state.settings.weatherApiKey || ''}"
                                       placeholder="Pega tu API key aqui"
                                       class="form-input"
                                       style="flex: 1; font-family: monospace; font-size: 0.85rem;"
                                       autocomplete="off">
                                <button type="button"
                                        onclick="const inp = document.getElementById('weatherApiKey'); inp.type = inp.type === 'password' ? 'text' : 'password';"
                                        style="background: #334155; border: none; color: #94a3b8; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; white-space: nowrap;">
                                    Ver/Ocultar
                                </button>
                            </div>
                            <div style="font-size: 0.72rem; color: #64748b; margin-top: 8px; line-height: 1.5;">
                                Sin API key se muestran datos de ejemplo (mock). Registrate gratis en
                                <a href="https://www.weatherapi.com/signup.aspx" target="_blank" rel="noopener" style="color: #06b6d4; text-decoration: underline;">weatherapi.com</a>
                                para obtener datos reales (1M llamadas/mes gratis, sin tarjeta).
                            </div>
                        </div>

                        <hr class="stg-divider">

                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label" style="font-size: 0.85rem; color: #94a3b8;">
                                Ubicación de Referencia (Coordenadas de Google Maps)
                            </label>
                            <input type="text"
                                   id="weatherLocationInput"
                                   value="${state.settings.weatherLocationRaw || ''}"
                                   placeholder="Ej: 18.4716, -69.8927 o @18.4716,-69.8927"
                                   class="form-input"
                                   style="width: 100%; font-size: 0.85rem; box-sizing: border-box;"
                                   autocomplete="off">
                            <div style="font-size: 0.72rem; color: #64748b; margin-top: 8px; line-height: 1.5;">
                                Puedes copiar y pegar coordenadas de Google Maps directamente haciendo clic derecho en el mapa o copiando el fragmento con <code>@</code> de la barra de direcciones. Por defecto usa Santo Domingo, RD.
                            </div>
                        </div>
                        ${state.settings.weatherApiKey ? `
                            <div style="font-size: 0.72rem; color: #10b981; border-top: 1px solid #243044; padding-top: 8px; margin-top: 12px;">
                                Provider activo: ${state.settings.weatherProvider || 'weatherapi'}
                            </div>
                        ` : ''}
                    </div>

                    <hr class="stg-divider">

                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label" style="margin-bottom: 8px; display: block;">Visibilidad del Mini-mapa (Barra Lateral)</label>
                        <select id="scrollbarMode" class="form-input">
                            <option value="always" ${state.settings.scrollbarMode === 'always' ? 'selected' : ''}>Siempre Visible</option>
                            <option value="on-scroll" ${state.settings.scrollbarMode === 'on-scroll' ? 'selected' : ''}>Solo al hacer scroll (Interactivo)</option>
                            <option value="hidden" ${state.settings.scrollbarMode === 'hidden' ? 'selected' : ''}>Ocultar Mini-mapa</option>
                        </select>
                        <div style="font-size: 0.73rem; color: #94a3b8; margin-top: 8px; line-height: 1.5;">
                            El mini-mapa muestra puntos de color para ausencias (rojo) y extras (azul) en toda la lista.
                        </div>
                    </div>
                </div>

                <!-- Iconos -->
                <div class="stg-panel">
                    <div class="stg-header">
                        <div>
                            <h3>
                                <span>${icons.get('palette')}</span>
                                <span>Iconos</span>
                            </h3>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">Estilo de iconos</label>
                        <select id="iconSet" class="form-input" onchange="commitIconSet(this.value)">
                            ${iconSetOptions}
                        </select>
                        <div style="font-size: 0.73rem; color: #64748b; margin-top: 8px; line-height: 1.6;">
                            Se aplica a toda la aplicación y queda guardado como preferencia.
                        </div>
                    </div>
                </div>

                <!-- Ayuda contextual -->
                <div class="stg-panel">
                    <div class="stg-header">
                        <div>
                            <h3>Ayuda Contextual (Tooltips)</h3>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label class="form-label">Modo de Visualización de Ayuda</label>
                        <select id="helpModeSelect" class="form-input" data-settings-action="set-help-mode">
                            <option value="always" ${state.settings.helpMode === 'always' ? 'selected' : ''}>Mostrar Siempre</option>
                            <option value="once" ${state.settings.helpMode === 'once' ? 'selected' : ''}>Ocultar tras ver una vez</option>
                            <option value="hidden" ${state.settings.helpMode === 'hidden' ? 'selected' : ''}>Desactivar todos</option>
                        </select>
                        <div style="font-size: 0.73rem; color: #94a3b8; margin-top: 8px; line-height: 1.5;">
                            Controla si aparecen globos informativos de ayuda al pasar el cursor o hacer clic sobre etiquetas con el icono.
                        </div>
                    </div>
                    <hr class="stg-divider">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.8rem; color: #94a3b8;">¿Viste algunos tooltips y quieres que vuelvan a aparecer?</span>
                        <button type="button" data-settings-action="reset-help-seen" class="btn btn-secondary" style="padding: 8px 16px; font-size: 0.8rem;">
                            Restablecer Vistos
                        </button>
                    </div>
                </div>

                <!-- Mantenimiento -->
                <div class="stg-panel">
                    <div class="stg-header">
                        <div>
                            <h3>Mantenimiento</h3>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <span style="font-size: 0.8rem; color: #94a3b8; flex: 1; min-width: 200px; line-height: 1.5;">
                            ¿No ves la última versión de la app? Limpia el cache del navegador para forzar la actualización.
                            <strong style="color: #cbd5e1;">No se borran tus datos</strong> (empleados, asistencia, configuración).
                        </span>
                        <button type="button" data-settings-action="clear-cache" class="btn btn-secondary" style="padding: 8px 16px; font-size: 0.8rem; white-space: nowrap;">
                            Limpiar cache y recargar
                        </button>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px;">
                        <span style="font-size: 0.8rem; color: #94a3b8; flex: 1; min-width: 200px; line-height: 1.5;">
                            Si algo falló, exportá el registro de errores técnicos para compartirlo con soporte.
                        </span>
                        <button type="button" data-settings-action="export-error-log" class="btn btn-secondary" style="padding: 8px 16px; font-size: 0.8rem; white-space: nowrap;">
                            Exportar log de errores
                        </button>
                    </div>
                </div>
    `;
}

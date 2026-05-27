/**
 * SettingsGeneralTab.js - Componente de la pestaña General
 */
export function SettingsGeneralTab(context) {
    const state = context.state;
    const icons = context.icons;
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
                            <span style="font-weight: 600; font-size: 1rem; color: #f1f5f9;">Mostrar Barra de Clima</span>
                        </label>
                        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 8px; margin-left: 32px; line-height: 1.5;">
                            Muestra una barra con el pronostico del clima encima de la lista de asistencia. Al desplegarla veras detalle del dia y las proximas horas. Desactivado por defecto.
                        </div>
                        ${state.settings.weatherEnabled === true ? `
                            <div style="margin-top: 12px; margin-left: 32px; padding: 12px; background: #0f172a; border-radius: 8px; border: 1px solid #334155; display: flex; flex-direction: column; gap: 16px;">
                                <div>
                                    <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; display: block; color: #94a3b8;">
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

                                <div style="border-top: 1px solid #334155; padding-top: 16px;">
                                    <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; display: block; color: #94a3b8;">
                                        Ubicación de Referencia (Coordenadas de Google Maps)
                                    </label>
                                    <input type="text"
                                           id="weatherLocationInput"
                                           value="${state.settings.weatherLocationRaw || ''}"
                                           placeholder="Ej: 18.4716, -69.8927 o @18.4716,-69.8927"
                                           class="form-input"
                                           style="width: 100%; font-size: 0.85rem; background: #0f172a; border-color: #334155; box-sizing: border-box;"
                                           autocomplete="off">
                                    <div style="font-size: 0.72rem; color: #64748b; margin-top: 8px; line-height: 1.5;">
                                        Puedes copiar y pegar coordenadas de Google Maps directamente haciendo clic derecho en el mapa o copiando el fragmento con <code>@</code> de la barra de direcciones. Por defecto usa Santo Domingo, RD.
                                    </div>
                                </div>
                                ${state.settings.weatherApiKey ? `
                                    <div style="font-size: 0.72rem; color: #10b981; border-top: 1px solid #334155; padding-top: 8px;">
                                        Provider activo: ${state.settings.weatherProvider || 'weatherapi'}
                                    </div>
                                ` : ''}
                            </div>
                        ` : ''}
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
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        💡 Ayuda Contextual (Tooltips)
                    </h3>
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label class="form-label">Modo de Visualización de Ayuda</label>
                        <select id="helpModeSelect" class="form-input" style="background: #0f172a; border-color: #334155;" data-settings-action="set-help-mode">
                            <option value="always" ${state.settings.helpMode === 'always' ? 'selected' : ''}>✨ Mostrar Siempre</option>
                            <option value="once" ${state.settings.helpMode === 'once' ? 'selected' : ''}>👁️ Ocultar tras ver una vez</option>
                            <option value="hidden" ${state.settings.helpMode === 'hidden' ? 'selected' : ''}>🚫 Desactivar todos</option>
                        </select>
                        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 8px; line-height: 1.5;">
                            Controla si aparecen globos informativos de ayuda al pasar el cursor o hacer clic sobre etiquetas con el icono ⓘ.
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 16px; border-top: 1px solid #334155;">
                        <span style="font-size: 0.8rem; color: #94a3b8;">¿Viste algunos tooltips y quieres que vuelvan a aparecer?</span>
                        <button type="button" data-settings-action="reset-help-seen" class="btn btn-secondary" style="padding: 8px 16px; font-size: 0.8rem;">
                            🔄 Restablecer Vistos
                        </button>
                    </div>
                </div>

                <!-- Parámetros de Asistencia -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        ⚙️ Parámetros de Asistencia y Horas
                    </h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                        <div class="form-group">
                            <label class="form-label">Horas Laborales por Día</label>
                            <input type="number" inputmode="decimal" id="regularHoursPerDay" value="${state.settings.regularHoursPerDay}" min="4" max="16" class="form-input">
                        </div>
                        <div class="form-group">
                            <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                                Factor Extra Ordinario
                                <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                      title="Multiplicador para horas extras normales">ⓘ</span>
                            </label>
                            <input type="number" inputmode="decimal" id="overtimeFactor" value="${state.settings.overtimeFactor}" min="1" max="3" step="0.25" class="form-input">
                        </div>
                        <div class="form-group">
                            <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                                Factor Feriado
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

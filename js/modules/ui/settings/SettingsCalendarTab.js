/**
 * SettingsCalendarTab.js - Componente de la pestaña Calendario
 * Estilo visual: SyncCenter (stg-* classes)
 */
export function SettingsTabCalendar(context) {
    const state = context.state;
    const icons = context.icons;
    return `
                <!-- Panel Integrado de Calendario y Fechas -->
                <div class="stg-panel">
                    <!-- Cabecera Integrada -->
                    <div class="stg-header" style="padding-bottom: 16px; border-bottom: 1px solid var(--stg-border-card); margin-bottom: 20px;">
                        <div>
                            <h3>
                                <span>${icons.get('calendar', { size: 20 })}</span>
                                <span>Control de Calendario y Pagos</span>
                            </h3>
                            <p>Configura tus cortes de pago y administra días festivos.</p>
                        </div>
                        <button type="button" data-settings-action="advance-pay-period" class="btn btn-primary" style="font-size: 0.85rem; padding: 8px 16px; display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                            Avanzar Período
                        </button>
                    </div>
                    
                    <div style="display: flex; gap: 24px; flex-wrap: wrap;">
                        <!-- Columna Izquierda: Entradas de Configuración -->
                        <div style="flex: 1; min-width: 250px; display: flex; flex-direction: column; gap: 16px;">
                            <div class="stg-card">
                                <div class="stg-card-title">Ajustes de Período</div>
                                
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
                            
                            <div class="stg-callout">
                                <strong>Sincronización Interactiva:</strong> Usa los botones del calendario a la derecha para seleccionar fechas directamente de forma gráfica sin usar estos campos.
                            </div>
                            <div style="margin-top: auto; font-size: 0.75rem; color: #64748b; text-align: center; background: var(--stg-card-bg); padding: 8px; border-radius: 6px;">
                                Total Festivos: <strong style="color: #f59e0b;">${state.settings.holidays.length}</strong>
                            </div>
                        </div>

                        <!-- Columna Derecha: Calendario Visual Interactivo -->
                        <div style="flex: 2; min-width: 320px;">
                            ${SettingsHolidayCalendar(context)}
                        </div>
                    </div>
                </div>

                <!-- Parámetros de Asistencia -->
                <div class="stg-panel" style="margin-top: 16px;">
                    <div class="stg-header">
                        <div>
                            <h3>Parámetros de Asistencia y Horas</h3>
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                        <div class="form-group">
                            <label class="form-label">Horas Laborales por Día</label>
                            <input type="number" inputmode="decimal" id="regularHoursPerDay" value="${state.settings.regularHoursPerDay}" min="4" max="16" class="form-input">
                        </div>
                        <div class="form-group">
                            <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                                Factor Extra Ordinario
                                <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                      title="Multiplicador para horas extras normales">i</span>
                            </label>
                            <input type="number" inputmode="decimal" id="overtimeFactor" value="${state.settings.overtimeFactor}" min="1" max="3" step="0.25" class="form-input">
                        </div>
                        <div class="form-group">
                            <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                                Factor Feriado
                                <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                      title="Multiplicador para calcular el pago en días festivos">i</span>
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
                                <span style="color: #94a3b8; font-size: 0.875rem;">x (multiplicador)</span>
                            </div>
                            <div style="font-size: 0.73rem; color: #64748b; margin-top: 8px;">
                                Ejemplo: Factor 2 = doble pago, Factor 1.5 = pago y medio
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                                Factor Día No Laborable
                                <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                      title="Multiplicador por defecto para horas trabajadas en días fuera de horario / días libres">i</span>
                            </label>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <input type="number" inputmode="decimal" 
                                       id="restDayFactor" 
                                       value="${state.settings.restDayFactor || 1.5}" 
                                       min="1" 
                                       max="5" 
                                       step="0.25"
                                       class="form-input"
                                       style="flex: 1;">
                                <span style="color: #94a3b8; font-size: 0.875rem;">x (multiplicador)</span>
                            </div>
                            <div style="font-size: 0.73rem; color: #64748b; margin-top: 8px;">
                                Multiplicador base si la posición o el líder no definen uno propio
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Configuración de Nómina -->
                <div class="stg-panel">
                    <div class="stg-header">
                        <div>
                            <h3>
                                <span>${icons.get('dollar', { size: 18 }) || icons.get('payroll', { size: 18 })}</span>
                                <span>Configuración de Nómina</span>
                            </h3>
                        </div>
                    </div>

                    <!-- Porcentaje de deducción por defecto -->
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            Porcentaje de Deducción por Defecto
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Este porcentaje se aplicará automáticamente al agregar deducciones">i</span>
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
                        <div style="font-size: 0.73rem; color: #64748b; margin-top: 8px;">
                            Todas las nuevas deducciones usarán este porcentaje por defecto. Se puede cambiar individualmente en cada nómina.
                        </div>
                    </div>
                </div>
            `;
}

function SettingsHolidayCalendar(context) {
    return context.holidayService.renderSettingsCalendar();
}

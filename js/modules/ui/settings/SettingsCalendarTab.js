/**
 * SettingsCalendarTab.js - Componente de la pestaña Calendario
 */
export function SettingsTabCalendar(context) {
    const state = context.state;
    const icons = context.icons;
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
                            ${SettingsHolidayCalendar(context)}
                        </div>
                    </div>
                </div>
            `;
}

function SettingsHolidayCalendar(context) {
    return context.holidayService.renderSettingsCalendar();
}

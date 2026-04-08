/**
 * ⚙️ AdvancedAttendanceModal.js - Detalles de Asistencia Avanzada
 * Parte de la Fase 4: Modularización y Componentización
 */

import { state } from '../../core/AppState.js';
import { payrollService } from '../../services/index.js';
import { getDateKey, formatDateShort, isDayHoliday } from '../../utils/DateUtils.js';
import { Modal } from '../../components/Modal.js';
import { debug } from '../../utils/Debug.js';

/**
 * ⚙️ CLASE: AdvancedAttendanceModal
 */
export class AdvancedAttendanceModal {
    static open(empId, forceMultiPosition = false) {
        let emp = state.selectedEmployee;
        
        // Si se pasa un empId, buscarlo en el estado
        if (empId) {
            emp = state.employees.find(e => e.id === empId);
            state.selectedEmployee = emp; // Mantener sincronía de estado
        }

        if (!emp) return;

        const dateKey = getDateKey(state.selectedDate);
        const key = `${emp.id}-${dateKey}`;
        const att = state.attendance[key] || {};
        
        // Si se fuerza multi-posición, asegurar un formato coherente si no existe
        if (forceMultiPosition && (!att.positionHours || att.positionHours.length === 0)) {
            att.present = true; // Por defecto si abren el modal detallado
        }
        
        const modal = new Modal({
            title: '⚙️ Detalles de Asistencia',
            subtitle: emp.name,
            content: this.renderContent(emp, att),
            variant: 'drawer',
            position: 'right',
            closable: true,
            backdrop: true,
            buttons: [
                {
                    text: 'Cancelar',
                    class: 'btn-secondary',
                    onClick: function() { this.close(); }
                },
                {
                    text: '💾 Guardar Cambios',
                    class: 'btn-primary',
                    style: 'background: linear-gradient(135deg, #06b6d4, #10b981); color: white; border: none;',
                    onClick: function() { 
                        if (saveAdvancedAttendance()) {
                            this.close();
                        }
                    }
                }
            ]
        });

        modal.open();
        
        // Inicializar listeners si es necesario
        this.initListeners(emp);
    }

    static renderContent(emp, att) {
        const selP = att.selectedPosition || emp.positions?.[0] || null;
        const hasMultiplePositions = emp.positions && emp.positions.length > 1;
        
        // Asegurar valores por defecto
        const hoursWorked = att.hoursWorked !== undefined ? att.hoursWorked : (state.settings?.regularHoursPerDay || 8);
        const overtimeHours = att.overtimeHours || 0;
        const isHoliday = att.isHoliday || false;
        const notes = att.notes || '';

        // Inicializar positionHours si está vacío
        let positionHours = att.positionHours || [];
        if (positionHours.length === 0) {
            if (att.present && att.selectedPosition && att.hoursWorked > 0) {
                positionHours = emp.positions.map(pid => ({
                    positionId: pid,
                    hours: pid === att.selectedPosition ? att.hoursWorked : 0,
                    overtimeHours: pid === att.selectedPosition ? (att.overtimeHours || 0) : 0
                }));
            } else {
                positionHours = emp.positions.map(pid => ({
                    positionId: pid,
                    hours: 0,
                    overtimeHours: 0
                }));
            }
        }

        const totalFractionated = positionHours.reduce((sum, ph) => sum + ph.hours, 0);

        return `
            <div class="modal-info" style="margin-bottom: 20px;">
                <div class="info-row" style="display: flex; justify-content: space-between;">
                    <span class="info-label" style="color: #64748b; font-size: 0.85rem;">Fecha:</span>
                    <span class="info-value" style="color: #f1f5f9; font-weight: 600;">${formatDateShort(state.selectedDate)}</span>
                </div>
            </div>
            
            <form id="advancedAttendanceForm">
                ${this.renderMultiPositionFields(emp, positionHours, totalFractionated)}
                
                
                <div class="form-group" style="margin-top: 16px;">
                    <label class="form-label" style="display: block; margin-bottom: 8px; color: #94a3b8; font-size: 0.85rem;">📝 Notas</label>
                    <textarea id="notes" class="form-textarea" placeholder="Observaciones adicionales..." style="width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; padding: 10px; min-height: 80px;">${notes}</textarea>
                </div>
            </form>
        `;
    }

    static renderMultiPositionFields(emp, positionHours, totalFractionated) {
        return `
            <div style="margin-top: 16px;">
                <div style="font-size: 0.875rem; color: #94a3b8; font-weight: 600; margin-bottom: 12px;">
                    Distribución de Horas por Posición:
                </div>
                
                ${emp.positions.map(pid => {
                    const position = state.positions.find(p => p.id === pid);
                    const positionSalary = position?.salaryConfig?.amount ?? position?.baseSalary ?? 0;
                    const config = position?.salaryConfig || { amount: positionSalary, period: 'month', workDays: [] };
                    const display = payrollService.formatSalaryDisplay(config);
                    const ph = positionHours.find(p => p.positionId === pid) || { hours: 0, overtimeHours: 0 };

                    return `
                        <div style="background: #1e293b; padding: 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #334155;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                <span style="width: 12px; height: 12px; border-radius: 50%; background: ${position?.color || '#06b6d4'};"></span>
                                <span style="font-weight: 600; color: #f1f5f9; font-size: 0.9rem;">${position?.name}</span>
                                <span style="margin-left: auto; font-size: 0.75rem; color: #64748b;">${display.full}</span>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                <div>
                                    <label style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 4px;">Horas:</label>
                                    <input type="number" 
                                           id="posHours_${pid}" 
                                           class="form-input pos-hour-input" 
                                           min="0" 
                                           max="24" 
                                           step="0.5" 
                                           value="${ph.hours}"
                                           onchange="updateAdvancedTotalHours()"
                                           style="width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; padding: 6px 8px; font-size: 0.875rem;">
                                </div>
                                <div>
                                    <label style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 4px;">Extras:</label>
                                    <input type="number" 
                                           id="posOvertime_${pid}" 
                                           class="form-input" 
                                           min="0" 
                                           max="12" 
                                           step="0.5" 
                                           value="${ph.overtimeHours}"
                                           style="width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; padding: 6px 8px; font-size: 0.875rem;">
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
                
                <div style="background: linear-gradient(135deg, #1e293b, #334155); padding: 12px; border-radius: 8px; border: 1px solid #06b6d4; text-align: center;">
                    <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 4px;">Total de Horas:</div>
                    <div id="totalHoursDisplay" style="font-size: 1.5rem; font-weight: 700; color: #10b981;">
                        ${totalFractionated.toFixed(1)}h
                    </div>
                </div>
            </div>
        `;
    }

    static initListeners(emp) {
        // Asignar funciones globales temporales para compatibilidad con el HTML inyectado
        window.updateAdvancedTotalHours = () => {
            let total = 0;
            emp.positions.forEach(pid => {
                const input = document.getElementById(`posHours_${pid}`);
                if (input) total += parseFloat(input.value) || 0;
            });
            const display = document.getElementById('totalHoursDisplay');
            if (display) display.textContent = `${total.toFixed(1)}h`;
        };
    }
}

/**
 * 💾 Función para guardar los detalles (Mantenida para compatibilidad interna)
 */
export function saveAdvancedAttendance() {
    debug.log('🔵 Guardando asistencia avanzada...');

    const emp = state.selectedEmployee;
    if (!emp) return false;

    const dateKey = getDateKey(state.selectedDate);
    const key = `${emp.id}-${dateKey}`;

    const positionHours = [];
    let totalHours = 0;
    let totalOvertime = 0;

    emp.positions.forEach(pid => {
        const hoursInput = document.getElementById(`posHours_${pid}`);
        const overtimeInput = document.getElementById(`posOvertime_${pid}`);

        if (hoursInput) {
            const hours = parseFloat(hoursInput.value) || 0;
            const overtime = parseFloat(overtimeInput.value) || 0;

            if (hours > 0 || overtime > 0) {
                positionHours.push({
                    positionId: pid,
                    hours: hours,
                    overtimeHours: overtime
                });
                totalHours += hours;
                totalOvertime += overtime;
            }
        }
    });

    const attendanceRecord = {
        employeeId: emp.id,
        date: dateKey,
        present: totalHours > 0 || totalOvertime > 0,
        hoursWorked: totalHours,
        overtimeHours: totalOvertime,
        positionHours: positionHours,
        multiPosition: positionHours.length > 1,
        isHoliday: isDayHoliday(state.selectedDate, state.settings?.holidays),
        notes: document.getElementById('notes')?.value || '',
        selectedPosition: positionHours.length > 0 ? positionHours[0].positionId : (emp.positions?.[0] || null),
        updatedAt: Date.now(),
        lastAccessed: Date.now()
    };

    // Guardar en el estado (Proxy activará la actualización del índice por fecha)
    state.attendance[key] = attendanceRecord;
    
    // Sincronizar y renderizar
    if (window.saveToLocalStorage) window.saveToLocalStorage({ dateKey });
    if (window.render) window.render();
    if (window.showNotification) window.showNotification('✅ Detalles guardados correctamente', 'success');

    return true;
}

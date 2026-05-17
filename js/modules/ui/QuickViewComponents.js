/**
 * 🎨 SISTEMA DE COMPONENTES PRINCIPALES (Fase 3 - Modularización)
 * Este módulo contiene las pestañas principales y los modales complejos de la aplicación.
 */

import { state, getEmployeeTotalHours } from '../core/AppState.js';
import { DateControls, DayView, WeekView } from './AttendanceUI.js';
import icons from './IconSystem.js';
import { formatMonthYear } from '../utils/DateUtils.js';
import { CalendarView } from './components/CalendarView.js';
import { EmployeeProfileModal } from './modals/EmployeeProfileModal.js';
import { AdvancedAttendanceModal } from './modals/AdvancedAttendanceModal.js';

// Re-exportar componentes necesarios
export {
    BottomNavigation, ContextMenu, ExportMenu, ImportFullModal, NotesCenterModal, NoteModal
} from './AttendanceUI.js';
export { EmployeeProfileModal, AdvancedAttendanceModal };

/**
 * 📅 PESTAÑA DE ASISTENCIA
 */
export function AttendanceTab() {
    return `${DateControls()}${state.viewMode === 'day' ? DayView() : WeekView()}`;
}

/**
 * 👤 TARJETA FLOTANTE DE EMPLEADO (Quick View)
 */
export function FloatingCard() {
    const emp = state.floatingCardEmployee;
    if (!emp || !state.showFloatingCard) return '';

    // Estadísticas rápidas
    const l7 = new Date(); l7.setDate(l7.getDate() - 6);
    const h7 = getEmployeeTotalHours(emp.id, l7, new Date());
    const fm = new Date(); fm.setDate(1);
    const hm = getEmployeeTotalHours(emp.id, fm, new Date());

    return `
        <div class="floating-card-overlay glass-effect" data-fc-action="close-floating-card">
            <div class="floating-card modern-scroll" data-fc-action="stop-propagation">
                <!-- Cabecera Premium -->
                <div class="floating-card-header" style="background: linear-gradient(135deg, #0f172a, #1e293b); padding: 24px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; gap: 16px;">
                    <div style="width: 50px; height: 50px; background: #06b6d4; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; font-weight: 800; color: #000;">
                        ${emp.name.charAt(0)}
                    </div>
                    <div style="flex: 1;">
                        <div style="font-size: 0.7rem; color: #06b6d4; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">ID #${emp.number || '---'}</div>
                        <div style="font-size: 1.1rem; font-weight: 700; color: #f1f5f9;">${emp.name}</div>
                    </div>
                    <button class="close-btn" type="button" data-fc-action="close-floating-card" aria-label="Cerrar" style="background: rgba(255,255,255,0.05); border: none; border-radius: 50%; width: 32px; height: 32px; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center;">✕</button>
                </div>
                
                <div class="floating-card-body" style="padding: 24px;">
                    <!-- Stats Grid -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
                        <div style="background: rgba(30, 41, 59, 0.5); padding: 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px;">Últimos 7 días</div>
                            <div style="font-size: 1.2rem; font-weight: 800; color: #06b6d4;">${h7}h</div>
                        </div>
                        <div style="background: rgba(30, 41, 59, 0.5); padding: 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px;">Este mes</div>
                            <div style="font-size: 1.2rem; font-weight: 800; color: #10b981;">${hm}h</div>
                        </div>
                    </div>

                    <!-- Calendario Centrado -->
                    <div class="calendar-section">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-weight: 700; color: #f1f5f9; font-size: 0.85rem;">
                            ${icons.get('calendar', { size: 16, color: '#06b6d4' })}
                            <span>Asistencia Mensual</span>
                        </div>
                        
                        ${CalendarView({ 
                            employee: emp, 
                            month: state.floatingCardMonth, 
                            navAction: 'window.changeFloatingMonth',
                            showLegend: true 
                        })}
                    </div>
                </div>

                <!-- Footer Acciones -->
                <div style="padding: 16px 24px 24px; border-top: 1px solid rgba(255,255,255,0.05); background: rgba(15, 23, 42, 0.2);">
                    <button type="button" data-fc-action="open-employee-profile" data-id="${emp.id}"
                            style="width: 100%; padding: 14px; background: linear-gradient(135deg, #06b6d4, #10b981); border: none; border-radius: 12px; color: #0f172a; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: 0 4px 15px rgba(6,182,212,0.2);">
                        ${icons.get('user', { size: 18, color: '#0f172a' })}
                        <span>Ver Perfil Detallado</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * 📝 FORMULARIOS (Placeholders)
 */
export function EmployeeFormModal() { return ''; }
export function LeaderFormModal() { return ''; }
export function PositionFormModal() { return ''; }
export function MultiPositionModal() { return ''; }

/**
 * ⚙️ CONFIGURACIÓN Y SINCRONIZACIÓN
 */
export function SettingsTab() { return ''; }
export function SyncCard() { return ''; }
export function AdvancedAttendanceModalComponent() {
    return AdvancedAttendanceModal.open();
}

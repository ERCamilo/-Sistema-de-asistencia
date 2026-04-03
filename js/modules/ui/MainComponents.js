/**
 * 🎨 SISTEMA DE COMPONENTES PRINCIPALES (Fase 3 - Modularización)
 * Este módulo contiene las pestañas principales y los modales complejos de la aplicación.
 */

import { state } from '../core/AppState.js';
import {
    DateControls, DayView, WeekView, StatsGrid, Legend, PositionFilters, SearchBar,
    EmployeeRow, EmployeeRowCompact, WeekRow, WeekViewTotalsRow, renderSkeleton,
    getCheckColor
} from './AttendanceUI.js';

import * as EmployeesUI from '../features/employees/EmployeesUI.js';
import * as AnalyticsUI from '../features/analytics/AnalyticsUI.js';
import * as PayrollUI from '../features/payroll/PayrollUI.js';
import * as SettingsUI from './SettingsUI.js';
import * as SyncUI from './SyncUI.js';
import {
    getDateKey, getDaysInMonth, formatMonthYear, formatDateShort
} from '../utils/DateUtils.js';

import { getEmployeeTotalHours } from '../core/AppState.js';

import { formatCurrency } from '../utils/Formatters.js';

import { EmployeeProfileModal } from './modals/EmployeeProfileModal.js';
import { AdvancedAttendanceModal } from './modals/AdvancedAttendanceModal.js';

// Re-exportar componentes de AttendanceUI que necesita el App() de forma directa
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
 * 📅 MARCADORES DE FECHA — FloatingCard
 */
function getDateMarker(emp, dateKey) {
    const markers = [];

    // 🎯 Fecha de contratación
    if (emp.hireDate === dateKey) {
        markers.push('🎯');
    }

    // 🔴/🟢 Última activación/desactivación
    if (emp.statusHistory && emp.statusHistory.length > 0) {
        const lastChange = emp.statusHistory[emp.statusHistory.length - 1];
        if (lastChange.date === dateKey) {
            markers.push(lastChange.active ? '🟢' : '🔴');
        }
    }

    // 💵 Fecha del último pago
    if (state.settings?.lastPaymentDate === dateKey) {
        markers.push('💵');
    }

    // 📅 Fecha del próximo pago
    if (state.settings?.nextPaymentDate === dateKey) {
        markers.push('📅');
    }

    if (markers.length === 0) return '';

    return `<div class="calendar-day-markers" style="position:absolute; bottom:2px; left:50%; transform:translateX(-50%); display:flex; gap:1px; font-size:0.6rem; line-height:1;">${markers.join('')}</div>`;
}

/**
 * 👤 TARJETA FLOTANTE DE EMPLEADO (Quick View)
 */
export function FloatingCard() {
    if (!state.showFloatingCard || !state.floatingCardEmployee) return '';
    const emp = state.floatingCardEmployee;
    const days = getDaysInMonth(state.floatingCardMonth);
    const dayN = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
    const today = getDateKey(new Date());
    const l7 = new Date(); l7.setDate(l7.getDate() - 6);
    const h7 = getEmployeeTotalHours(emp.id, l7, new Date());
    const fm = new Date(); fm.setDate(1);
    const hm = getEmployeeTotalHours(emp.id, fm, new Date());

    // Asumimos que chartService está global o se inyectará
    const chartData = window.chartService?.getChartData(emp.id, state.chartPeriod) || [];
    const maxVal = chartData.length > 0 ? Math.max(...chartData.map(d => (d.regular || 0) + (d.overtime || 0) + (d.holiday || 0) + (d.absent || 0))) : 1;
    const maxH = Math.max(maxVal, 1);
    const scale = 140 / maxH;

    return `
        <div class="overlay" onclick="window.closeFloatingCard()"></div>
        <div class="floating-card" onclick="event.stopPropagation()">
            <!-- Cabecera Rediseñada con Avatar -->
            <div class="floating-card-header" style="padding: 24px; background: linear-gradient(135deg, #0f172a, #1e293b); border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 16px;">
                <!-- Avatar Compacto -->
                <div style="width: 54px; height: 54px; background: ${emp.positions?.length > 0 ? (state.positions.find(p => p.id === emp.positions[0])?.color || '#06b6d4') : '#06b6d4'}; border-radius: 16px; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 800; color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); flex-shrink: 0;">
                    ${emp.name.charAt(0)}
                </div>

                <div style="flex-grow: 1;">
                    <div style="font-size: 0.7rem; color: #06b6d4; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 2px; opacity: 0.9;">Vistazo Rápido</div>
                    <div style="font-size: 1.2rem; font-weight: 900; color: #f1f5f9; line-height: 1.2; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 1.1rem;">👤</span> ${emp.name}
                    </div>
                </div>
                <button class="floating-card-close" onclick="window.closeFloatingCard()" style="position: static; color: #94a3b8; font-size: 1.2rem; background: none; border: none; cursor: pointer;">✕</button>
            </div>

            <div class="stats-compact">
                <div class="stat-compact">
                    <div class="stat-compact-label">Últimos 7 días</div>
                    <div class="stat-compact-value">${h7}h</div>
                </div>
                <div class="stat-compact">
                    <div class="stat-compact-label">Este mes</div>
                    <div class="stat-compact-value">${hm}h</div>
                </div>
            </div>

            <div class="calendar-compact">
                <div class="calendar-nav">
                    <button class="calendar-nav-btn" onclick="window.changeFloatingMonth(-1)">◀</button>
                    <div class="calendar-month">${formatMonthYear(state.floatingCardMonth)}</div>
                    <button class="calendar-nav-btn" onclick="window.changeFloatingMonth(1)">▶</button>
                </div>
                <div class="calendar-header">
                    ${dayN.map(d => `<div class="calendar-header-day">${d}</div>`).join('')}
                </div>
                <div class="calendar-grid">
                    ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        const aKey = `${emp.id}-${dKey}`;
        const att = state.attendance[aKey];
        const isT = dKey === today;
        let cls = ['calendar-day'];
        if (!currentMonth) cls.push('other-month');
        if (att && att.present) {
            cls.push('has-attendance');
            const col = getCheckColor(att, date, state.settings).replace('check-', '');
            cls.push(col);
        }
        if (isT) cls.push('today');
        return `<div class="${cls.join(' ')}"><div>${date.getDate()}</div>${att && att.present ? `<div class="calendar-day-hours">${att.hoursWorked}h</div>` : ''}${getDateMarker(emp, dKey)}</div>`;
    }).join('')}
                </div>
            </div>

            <div class="chart-compact">
                <div class="chart-compact-header">
                    <div class="chart-compact-title">📈 ${state.chartPeriod === 'all' ? 'Historial por Meses' : 'Asistencia y Horas'}</div>
                    <div class="chart-filter">
                        <button class="chart-filter-btn ${state.chartPeriod === 'week' ? 'active' : ''}" onclick="window.changeChartPeriod('week')">7D</button>
                        <button class="chart-filter-btn ${state.chartPeriod === 'month' ? 'active' : ''}" onclick="window.changeChartPeriod('month')">Mes</button>
                        <button class="chart-filter-btn ${state.chartPeriod === 'all' ? 'active' : ''}" onclick="window.changeChartPeriod('all')">Todo</button>
                    </div>
                </div>
                <div class="chart-bars">
                    ${chartData.map(d => {
        const tot = (d.regular + d.overtime + d.holiday + d.absent) * scale;
        const rH = d.regular * scale;
        const oH = d.overtime * scale;
        const hH = d.holiday * scale;
        const aH = d.absent * scale;
        return `<div class="chart-bar-wrapper"><div class="chart-bar" style="height:${Math.max(tot, 10)}px;">${d.absent > 0 ? `<div class="chart-segment absent" style="height:${aH}px;"></div>` : ''}${d.regular > 0 ? `<div class="chart-segment regular" style="height:${rH}px;"></div>` : ''}${d.overtime > 0 ? `<div class="chart-segment overtime" style="height:${oH}px;"></div>` : ''}${d.holiday > 0 ? `<div class="chart-segment holiday" style="height:${hH}px;"></div>` : ''}</div><div class="chart-bar-label">${d.label || `${d.date.getDate()}/${d.date.getMonth() + 1}`}</div></div>`;
    }).join('')}
                </div>
            </div>

            <!-- 📝 VISTA PREVIA DE NOTAS GENERALES -->
            ${emp.notes && emp.notes.trim() ? `
                <div style="padding: 12px 16px; border-top: 1px solid #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: rgba(15, 23, 42, 0.5);" 
                     title="${emp.notes.replace(/"/g, '&quot;')}">
                    <div style="color: #94a3b8; font-size: 0.8rem; display: flex; align-items: center; gap: 8px;">
                        <span>📝</span>
                        <span style="overflow: hidden; text-overflow: ellipsis;">${emp.notes}</span>
                    </div>
                </div>
            ` : ''}

            <div style="padding: 16px; border-top: 1px solid #334155;">
                <button onclick="window.openEmployeeProfile('${emp.id}')" style="width: 100%; padding: 14px; background: linear-gradient(135deg, #06b6d4, #10b981); border: none; border-radius: 12px; color: #000; font-weight: 800; cursor: pointer; font-size: 0.9rem; transition: all 0.2s; box-shadow: 0 4px 12px rgba(6,182,212,0.2);">
                    👤 Ver Perfil Completo
                </button>
            </div>
        </div>`;
}


/**
 * 📝 FORMULARIO DE EMPLEADO (Placeholder - Se implementará en EmployeesUI)
 */
export function EmployeeFormModal() { return ''; }

/**
 * 👑 FORMULARIO DE LÍDER (Placeholder)
 */
export function LeaderFormModal() { return ''; }

/**
 * 🎯 FORMULARIO DE POSICIÓN (Placeholder)
 */
export function PositionFormModal() { return ''; }

/**
 * ⚙️ DETALLES DE ASISTENCIA AVANZADOS
 * (Ahora delegado al componente modular)
 */
export function AdvancedAttendanceModalComponent() {
    return AdvancedAttendanceModal.open();
}

/**
 * ⚙️ PESTAÑA DE AJUSTES (Delegado a SettingsUI)
 */
export function SettingsTab() {
    return SettingsUI.SettingsTab();
}

/**
 * 🔄 TARJETA DE SINCRONIZACIÓN (Delegado a SettingsUI)
 */
export function SyncCard(status) {
    return SettingsUI.SyncCard(status);
}

/**
 * 🎯 OTROS MODALES (Placeholder)
 */
export function MultiPositionModal() { return ''; }

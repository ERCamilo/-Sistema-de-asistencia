/**
 * 📅 CalendarView.js - Componente Reutilizable de Calendario
 * Genera la cuadrícula mensual con resaltado de periodos, días de pago y asistencia.
 */

import { state } from '../../core/AppState.js';
import { getDateKey, getDaysInMonth, formatMonthYear, isDateInPayPeriod, isPayday } from '../../utils/DateUtils.js';
import { getCheckColor } from '../AttendanceUI.js';
import icons from '../IconSystem.js';

// Delegación: los botones de CalendarView usan data-cv-nav-action + data-cv-delta
// para resolver dinámicamente la función global a llamar (preserva la API original).
let _cvDelegationAttached = false;
if (!_cvDelegationAttached) {
    document.addEventListener('click', (e) => {
        const t = e.target.closest('[data-cv-nav-action]');
        if (!t) return;
        const fn = window[t.dataset.cvNavAction];
        if (typeof fn === 'function') fn(parseInt(t.dataset.cvDelta || '0', 10));
    });
    _cvDelegationAttached = true;
}

/**
 * Renderiza un calendario mensual para un empleado específico.
 * @param {Object} options - Configuración del calendario
 * @param {Object} options.employee - El objeto empleado
 * @param {Date} options.month - El mes a mostrar
 * @param {String} options.navAction - El handler global para cambiar mes (ej: 'window.changeFloatingMonth')
 * @param {Boolean} [options.showLegend=false] - Si mostrar la leyenda al pie
 */
export function CalendarView({ employee, month, navAction, showLegend = false }) {
    if (!employee || !month) return '<div class="empty-state">No hay datos</div>';

    const days = getDaysInMonth(month);
    const dayNames = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
    const todayKey = getDateKey(new Date());
    const payPeriod = state.settings.payPeriod;

    // Generar las celdas de los días
    const daysHTML = days.map(d => {
        const dKey = getDateKey(d.date);
        const isCurrentMonth = d.currentMonth;
        const isToday = dKey === todayKey;
        
        // Datos de asistencia
        const attKey = `${employee.id}-${dKey}`;
        const att = state.attendance[attKey];
        const isPresent = att && att.present;
        const checkColor = getCheckColor(att, d.date);
        
        // Estados de Pago
        const isInPeriod = isDateInPayPeriod(dKey, payPeriod);
        const isPaid = isPayday(dKey, payPeriod);
        
        // Clases CSS
        const classes = [
            'calendar-day',
            !isCurrentMonth ? 'other-month' : '',
            isToday ? 'today' : '',
            isPresent ? 'has-attendance' : '',
            checkColor,
            isInPeriod ? 'calendar-day-pay-period' : '',
            isPaid ? 'calendar-payday' : ''
        ].filter(Boolean).join(' ');

        // Tooltip y Marcadores
        const tooltip = isToday ? 'Hoy (Día Actual)' : (isPresent ? `${att.hoursWorked}h trabajadas` : (isPaid ? 'Día de Pago' : ''));
        const todayIcon = isToday ? '<span class="today-marker">🎯</span>' : '';
        const paydayIcon = isPaid ? `<div class="payday-indicator" title="Día de Pago">${icons.get('zap', { size: 10 })}</div>` : '';
        const moneyIcon = isPaid ? `<span class="money-badge">💰</span>` : '';

        return `
            <div class="${classes}" title="${tooltip}">
                <span class="day-number">${d.date.getDate()}</span>
                ${isPresent ? `<span class="hours-dot">${att.hoursWorked}h</span>` : ''}
                ${todayIcon}
                ${paydayIcon}
                ${moneyIcon}
            </div>
        `;
    }).join('');

    return `
        <div class="calendar-container premium-calendar">
            <div class="calendar-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <button class="nav-btn" type="button" data-cv-nav-action="${navAction}" data-cv-delta="-1" aria-label="Mes anterior">${icons.get('chevron-left')}</button>
                <div class="calendar-month-title" style="font-weight: 700; color: #f1f5f9; font-size: 0.9rem;">
                    ${formatMonthYear(month)}
                </div>
                <button class="nav-btn" type="button" data-cv-nav-action="${navAction}" data-cv-delta="1" aria-label="Mes siguiente">${icons.get('chevron-right')}</button>
            </div>
            
            <div class="calendar-grid">
                ${dayNames.map(name => `<div class="calendar-day-name">${name}</div>`).join('')}
                ${daysHTML}
            </div>

            ${showLegend ? `
                <div class="calendar-mini-legend" style="margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.05); display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px; font-size: 0.7rem; color: #94a3b8;">
                        <div style="width: 12px; height: 12px; border: 2px solid #06b6d4; border-radius: 3px;"></div>
                        <span>Periodo Pago</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; font-size: 0.7rem; color: #94a3b8;">
                        <div style="width: 12px; height: 12px; border: 2px solid #fbbf24; background: rgba(251,191,36,0.1); border-radius: 3px;"></div>
                        <span>Día de Pago 💰</span>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

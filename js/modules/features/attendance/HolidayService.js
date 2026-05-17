// ============================================
// ☀️ HOLIDAY SERVICE
// Gestión de días festivos, calendario de configuración,
// y toggle de marcadores de calendario.
// ============================================

import { getDateKey, isDayHoliday, formatMonthYear } from '../../utils/DateUtils.js';

// ============================================
// 🎯 EVENT DELEGATION (data-holiday-action)
// ============================================
const _HOLIDAY_ACTION_MAP = {
    'change-settings-calendar-month': (delta) => window.changeSettingsCalendarMonth?.(parseInt(delta, 10)),
    'change-settings-calendar-mode': (mode) => window.changeSettingsCalendarMode?.(mode),
    'handle-calendar-day-click': (dateKey) => window.handleCalendarDayClick?.(dateKey)
};

function _handleHolidayClick(e) {
    const target = e.target.closest('[data-holiday-action]');
    if (!target) return;
    const action = target.dataset.holidayAction;
    const handler = _HOLIDAY_ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.value ?? target.dataset.id ?? null;
    handler(arg, target, e);
}

let _holidayDelegationAttached = false;
if (!_holidayDelegationAttached) {
    document.addEventListener('click', _handleHolidayClick);
    _holidayDelegationAttached = true;
}

export class HolidayService {
    constructor(state) {
        this.state = state;
    }

    // ═══ Core: Toggle de festivo en la vista de asistencia ═══

    /**
     * Marcar/desmarcar el día seleccionado como festivo.
     * Persiste el cambio llamando a saveFn.
     */
    toggleSelectedDayHoliday(saveFn) {
        const key = getDateKey(this.state.selectedDate);
        const idx = this.state.settings.holidays.indexOf(key);
        if (idx > -1) {
            this.state.settings.holidays.splice(idx, 1);
        } else {
            this.state.settings.holidays.push(key);
        }
        saveFn();
    }

    /**
     * Toggle festivo para una fecha específica (dateKey string).
     * Usado por el calendario de ajustes.
     */
    toggleHoliday(dateKey, saveFn) {
        const holidays = this.state.settings.holidays;
        const index = holidays.indexOf(dateKey);
        if (index > -1) {
            holidays.splice(index, 1);
        } else {
            holidays.push(dateKey);
            holidays.sort();
        }
        if (saveFn) saveFn();
    }

    /**
     * Verifica si una fecha es festivo.
     */
    isDayHoliday(dateInput) {
        return isDayHoliday(dateInput, this.state.settings.holidays);
    }

    // ═══ Calendario de configuración ═══

    /**
     * Navegar el calendario de configuración (+1 = mes siguiente, -1 = anterior)
     */
    changeCalendarMonth(delta) {
        const month = this.state.settingsCalendarMonth;
        month.setMonth(month.getMonth() + delta);
        this.state.settingsCalendarMonth = new Date(month);
    }

    /**
     * Manejar click en un día del calendario de configuración.
     * Togglea festivo.
     */
    handleCalendarDayClick(dateKey, saveFn) {
        const mode = this.state.settingsCalendarMode || 'holiday';
        if (mode === 'holiday') {
            this.toggleHoliday(dateKey, saveFn);
        } else if (mode === 'periodStart') {
            if (!this.state.settings.payPeriod) this.state.settings.payPeriod = { periodLength: 15 };
            this.state.settings.payPeriod.periodStart = dateKey;
            if (saveFn) saveFn();
        } else if (mode === 'payDay') {
            if (!this.state.settings.payPeriod) this.state.settings.payPeriod = { periodLength: 15 };
            this.state.settings.payPeriod.payDay = dateKey;
            if (saveFn) saveFn();
        }
    }

    // ═══ Renderizado del calendario de configuración ═══

    /**
     * Genera el HTML del calendario de festivos/pagos para la sección de Configuración.
     */
    renderSettingsCalendar() {
        const month = this.state.settingsCalendarMonth;
        const year = month.getFullYear();
        const monthIndex = month.getMonth();

        const firstDay = new Date(year, monthIndex, 1);
        const lastDay = new Date(year, monthIndex + 1, 0);
        const startDayOfWeek = firstDay.getDay();

        const days = [];

        // Días del mes anterior
        const prevMonthLastDay = new Date(year, monthIndex, 0).getDate();
        for (let i = startDayOfWeek - 1; i >= 0; i--) {
            days.push({ date: new Date(year, monthIndex - 1, prevMonthLastDay - i), currentMonth: false });
        }

        // Días del mes actual
        for (let i = 1; i <= lastDay.getDate(); i++) {
            days.push({ date: new Date(year, monthIndex, i), currentMonth: true });
        }

        // Días del mes siguiente
        const remainingDays = 42 - days.length;
        for (let i = 1; i <= remainingDays; i++) {
            days.push({ date: new Date(year, monthIndex + 1, i), currentMonth: false });
        }

        // Rango del período de pago
        const pp = this.state.settings?.payPeriod;
        let pStart = null, pEnd = null;
        if (pp?.periodStart && pp?.periodLength) {
            pStart = new Date(pp.periodStart + 'T00:00:00');
            pEnd = new Date(pStart);
            pEnd.setDate(pEnd.getDate() + pp.periodLength - 1);
        }

        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

        return `
                <div style="background: #0f172a; border-radius: 8px; padding: 16px;">
                    <!-- Header del calendario -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <button type="button"
                                data-holiday-action="change-settings-calendar-month" data-value="-1"
                                aria-label="Mes anterior"
                                style="background: #1e293b; border: 1px solid #334155; color: #06b6d4; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; font-size: 1.25rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
                                onmouseover="this.style.borderColor='#06b6d4'; this.style.background='#334155'"
                                onmouseout="this.style.borderColor='#334155'; this.style.background='#1e293b'">
                            ◀
                        </button>
                        <div style="font-size: 1rem; font-weight: 700; color: #f1f5f9;">
                            ${formatMonthYear(month)}
                        </div>
                        <button type="button"
                                data-holiday-action="change-settings-calendar-month" data-value="1"
                                aria-label="Mes siguiente"
                                style="background: #1e293b; border: 1px solid #334155; color: #06b6d4; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; font-size: 1.25rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
                                onmouseover="this.style.borderColor='#06b6d4'; this.style.background='#334155'"
                                onmouseout="this.style.borderColor='#334155'; this.style.background='#1e293b'">
                            ▶
                        </button>
                    </div>
                    <!-- Selector de Modo de Calendario -->
                    <div style="display: flex; gap: 8px; margin-bottom: 16px; background: #1e293b; padding: 4px; border-radius: 8px;">
                        ${['holiday', 'periodStart', 'payDay'].map(mode => {
                            const isSelected = (this.state.settingsCalendarMode || 'holiday') === mode;
                            const labels = {
                                holiday: '☀️ Festivo',
                                periodStart: '🗓️ Inicio Período',
                                payDay: '💰 Día de Pago'
                            };
                            return `
                                <button type="button"
                                        data-holiday-action="change-settings-calendar-mode" data-value="${mode}"
                                        style="flex: 1; padding: 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s; border: none;
                                               background: ${isSelected ? '#3b82f6' : 'transparent'}; 
                                               color: ${isSelected ? '#ffffff' : '#94a3b8'};">
                                    ${labels[mode]}
                                </button>
                            `;
                        }).join('')}
                    </div>
                    
                    <!-- Grid del calendario -->
                    <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">
                        <!-- Nombres de días -->
                        ${dayNames.map(name => `
                            <div style="text-align: center; padding: 8px; font-size: 0.75rem; font-weight: 600; color: #64748b;">
                                ${name}
                            </div>
                        `).join('')}
                        
                        <!-- Días -->
                        ${days.map(({ date, currentMonth }) => {
        const dateKey = getDateKey(date);
        const isHoliday = this.state.settings.holidays.includes(dateKey);
        const isToday = dateKey === getDateKey(new Date());
        
        let inPeriod = false;
        if (pStart && pEnd) {
            inPeriod = date >= pStart && date <= pEnd;
        }
        const isPayDay = pp?.payDay === dateKey;

        let bgColor = '#1e293b';
        if (inPeriod && currentMonth && !isHoliday) {
            bgColor = '#1e3a5f'; // Un azul sutil para el rango
        }

        let textColor = currentMonth ? '#f1f5f9' : '#475569';
        let borderColor = inPeriod && currentMonth ? '#3b82f6' : '#334155';
        let dayIcon = '';

        // Determinar color e icono según los marcadores
        if (isHoliday) {
            bgColor = 'linear-gradient(135deg, #f59e0b, #fbbf24)';
            textColor = '#fff';
            borderColor = '#f59e0b';
            dayIcon = '☀️';
        }
        if (isPayDay) {
            dayIcon = dayIcon ? dayIcon + ' 💰' : '💰';
            borderColor = '#10b981';
            if (!isHoliday && currentMonth) bgColor = 'linear-gradient(135deg, #059669, #10b981)';
            if (!isHoliday && currentMonth) textColor = '#fff';
        }

        if (isToday && !isHoliday && !isPayDay) {
            borderColor = '#06b6d4';
        }

        const isClickable = currentMonth;

        return `
                                <div ${isClickable ? `role="button" tabindex="0" data-holiday-action="handle-calendar-day-click" data-value="${dateKey}"` : ''}
                                     style="
                                        background: ${bgColor};
                                        border: 2px solid ${borderColor};
                                        padding: 6px;
                                        border-radius: 8px;
                                        ${!currentMonth ? 'opacity: 0.3;' : ''}
                                        ${isClickable ? 'cursor: pointer;' : 'cursor: not-allowed; opacity: 0.5;'}
                                        min-height: 60px;
                                        display: flex;
                                        flex-direction: column;
                                        align-items: center;
                                        justify-content: center;
                                        transition: all 0.2s;
                                     "
                                     ${isClickable ? `onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.3)'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'"` : ''}>
                                    <div style="color: ${textColor}; font-size: 0.875rem; font-weight: ${isHoliday ? '700' : '500'}; margin-bottom: ${dayIcon ? '4px' : '0'};">
                                        ${date.getDate()}
                                    </div>
                                    ${dayIcon ? `<div style="font-size: 0.7rem; line-height: 1;">${dayIcon}</div>` : ''}
                                </div>
                            `;
    }).join('')}
                    </div>
                </div>
            `;
    }
}

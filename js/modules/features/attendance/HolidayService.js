// ============================================
// ☀️ HOLIDAY SERVICE
// Gestión de días festivos, calendario de configuración,
// y toggle de marcadores de calendario.
// ============================================

import { getDateKey, isDayHoliday, formatMonthYear } from '../../utils/DateUtils.js';

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
     * Cambiar modo de marcador del calendario (holiday, lastPayment, nextPayment)
     */
    setCalendarMarkerMode(mode) {
        this.state.calendarMarkerMode = mode;
    }

    /**
     * Manejar click en un día del calendario de configuración.
     * Según el modo, togglea festivo o marca fecha de pago.
     */
    handleCalendarDayClick(dateKey, saveFn) {
        const mode = this.state.calendarMarkerMode;

        if (mode === 'holiday') {
            this.toggleHoliday(dateKey, saveFn);
        } else if (mode === 'lastPayment') {
            const today = getDateKey(new Date());
            if (dateKey <= today) {
                if (this.state.settings.lastPaymentDate === dateKey) {
                    this.state.settings.lastPaymentDate = null;
                } else {
                    this.state.settings.lastPaymentDate = dateKey;
                }
                saveFn();
            }
        } else if (mode === 'nextPayment') {
            if (this.state.settings.nextPaymentDate === dateKey) {
                this.state.settings.nextPaymentDate = null;
            } else {
                this.state.settings.nextPaymentDate = dateKey;
            }
            saveFn();
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

        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

        return `
                <div style="background: #0f172a; border-radius: 8px; padding: 16px;">
                    <!-- Header del calendario -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <button type="button" 
                                onclick="changeSettingsCalendarMonth(-1)" 
                                style="background: #1e293b; border: 1px solid #334155; color: #06b6d4; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; font-size: 1.25rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
                                onmouseover="this.style.borderColor='#06b6d4'; this.style.background='#334155'"
                                onmouseout="this.style.borderColor='#334155'; this.style.background='#1e293b'">
                            ◀
                        </button>
                        <div style="font-size: 1rem; font-weight: 700; color: #f1f5f9;">
                            ${formatMonthYear(month)}
                        </div>
                        <button type="button" 
                                onclick="changeSettingsCalendarMonth(1)" 
                                style="background: #1e293b; border: 1px solid #334155; color: #06b6d4; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; font-size: 1.25rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
                                onmouseover="this.style.borderColor='#06b6d4'; this.style.background='#334155'"
                                onmouseout="this.style.borderColor='#334155'; this.style.background='#1e293b'">
                            ▶
                        </button>
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
        const isFuture = dateKey > getDateKey(new Date());
        const isLastPayment = this.state.settings.lastPaymentDate === dateKey;
        const isNextPayment = this.state.settings.nextPaymentDate === dateKey;

        let bgColor = '#1e293b';
        let textColor = currentMonth ? '#f1f5f9' : '#475569';
        let borderColor = '#334155';
        let dayIcon = '';

        // Determinar color e icono según los marcadores
        if (isHoliday) {
            bgColor = 'linear-gradient(135deg, #f59e0b, #fbbf24)';
            textColor = '#fff';
            borderColor = '#f59e0b';
            dayIcon = '☀️';
        }
        if (isLastPayment) {
            dayIcon = dayIcon ? dayIcon + ' 💵' : '💵';
        }
        if (isNextPayment) {
            dayIcon = dayIcon ? dayIcon + ' 📅' : '📅';
        }

        if (isToday && !isHoliday) {
            borderColor = '#06b6d4';
        }

        // Deshabilitar clic en "último pago" para fechas futuras
        const isClickable = currentMonth && !(this.state.calendarMarkerMode === 'lastPayment' && isFuture);

        return `
                                <div onclick="${isClickable ? `handleCalendarDayClick('${dateKey}')` : ''}"
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
                    
                    <!-- Toggle Buttons -->
                    <div style="display: flex; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #334155;">
                        <button onclick="setCalendarMarkerMode('holiday')" 
                                style="flex: 1; padding: 10px; background: ${this.state.calendarMarkerMode === 'holiday' ? '#f59e0b' : 'rgba(245,158,11,0.2)'}; border: 2px solid ${this.state.calendarMarkerMode === 'holiday' ? '#f59e0b' : 'rgba(245,158,11,0.3)'}; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s; font-size: 0.8rem; font-weight: ${this.state.calendarMarkerMode === 'holiday' ? '700' : '600'}; color: ${this.state.calendarMarkerMode === 'holiday' ? '#000' : '#f59e0b'};">
                            <span style="font-size: 1rem;">☀️</span>
                            <span>Festivo</span>
                        </button>
                        <button onclick="setCalendarMarkerMode('lastPayment')" 
                                style="flex: 1; padding: 10px; background: ${this.state.calendarMarkerMode === 'lastPayment' ? '#10b981' : 'rgba(16,185,129,0.2)'}; border: 2px solid ${this.state.calendarMarkerMode === 'lastPayment' ? '#10b981' : 'rgba(16,185,129,0.3)'}; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s; font-size: 0.8rem; font-weight: ${this.state.calendarMarkerMode === 'lastPayment' ? '700' : '600'}; color: ${this.state.calendarMarkerMode === 'lastPayment' ? '#000' : '#10b981'};">
                            <span style="font-size: 1rem;">💵</span>
                            <span>Último pago</span>
                        </button>
                        <button onclick="setCalendarMarkerMode('nextPayment')" 
                                style="flex: 1; padding: 10px; background: ${this.state.calendarMarkerMode === 'nextPayment' ? '#06b6d4' : 'rgba(6,182,212,0.2)'}; border: 2px solid ${this.state.calendarMarkerMode === 'nextPayment' ? '#06b6d4' : 'rgba(6,182,212,0.3)'}; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s; font-size: 0.8rem; font-weight: ${this.state.calendarMarkerMode === 'nextPayment' ? '700' : '600'}; color: ${this.state.calendarMarkerMode === 'nextPayment' ? '#000' : '#06b6d4'};">
                            <span style="font-size: 1rem;">📅</span>
                            <span>Próximo pago</span>
                        </button>
                    </div>
                    
                    <!-- Info de fechas -->
                    <div style="margin-top: 16px; padding: 12px; background: #1e293b; border-radius: 8px; border: 1px solid #334155;">
                        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.75rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: #94a3b8;">📅 Total de días festivos:</span>
                                <span style="color: #f59e0b; font-weight: 700;">${this.state.settings.holidays.length}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: #94a3b8;">💵 Último pago:</span>
                                <span style="color: #10b981; font-weight: 700;">${this.state.settings.lastPaymentDate ? new Date(this.state.settings.lastPaymentDate + 'T00:00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No configurado'}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: #94a3b8;">📅 Próximo pago:</span>
                                <span style="color: #06b6d4; font-weight: 700;">${this.state.settings.nextPaymentDate ? new Date(this.state.settings.nextPaymentDate + 'T00:00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No configurado'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
    }
}

import icons from '../IconSystem.js';
import { CalendarView, getPayPeriodCalendarDays } from './CalendarView.js';

export function normalizeAttendanceDetailCalendarView(value) {
    return value === 'full' ? 'full' : 'period';
}

export function hasConfiguredPayPeriod(payPeriod) {
    return getPayPeriodCalendarDays(payPeriod).length > 0;
}

export function AttendanceDetailCalendar({
    employee,
    selectedDate,
    calendarMonth,
    activeView = 'period',
    payPeriod,
    navAction = 'changeAttendanceDetailMonth',
    selectAction = 'selectAttendanceDetailDate'
}) {
    const view = normalizeAttendanceDetailCalendarView(activeView);
    const periodConfigured = hasConfiguredPayPeriod(payPeriod);
    const viewButton = (value, label) => `
        <button type="button"
                class="detail-calendar-view-option ${view === value ? 'active' : ''}"
                role="tab"
                aria-selected="${view === value}"
                data-app-fn="setAttendanceDetailCalendarView"
                data-arg="${value}">
            ${label}
        </button>
    `;

    let content;
    if (view === 'period' && !periodConfigured) {
        content = `
            <div class="detail-calendar-period-empty" data-calendar-period-empty>
                <span class="detail-calendar-period-empty-icon" aria-hidden="true">
                    ${icons.get('calendar', { size: 24 })}
                </span>
                <strong>Configura el período actual</strong>
                <p>Define la fecha de inicio y la duración para mostrar aquí únicamente los días que se están liquidando.</p>
                <button type="button"
                        class="detail-calendar-configure-btn"
                        data-app-fn="openCalendarioAjustes">
                    Configurar período
                </button>
            </div>
        `;
    } else {
        content = CalendarView({
            employee,
            month: calendarMonth,
            navAction,
            selectedDate,
            selectAction,
            showLegend: false,
            displayMode: view === 'period' ? 'period' : 'month',
            payPeriod
        });
    }

    return `
        <section class="detail-calendar-view" data-detail-calendar-view="${view}">
            <div class="detail-calendar-view-switch"
                 role="tablist"
                 aria-label="Rango visible del calendario">
                ${viewButton('period', 'Período actual')}
                ${viewButton('full', 'Calendario completo')}
            </div>
            ${content}
        </section>
    `;
}

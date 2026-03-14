import { ComponentBase } from './ComponentBase.js';
import { parseDate, getDateKey } from '../utils/DateUtils.js';

export class CalendarPickerComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: { 
        //   selectedDate: Date o String,
        //   onDateSelect: function,
        //   minDate?, 
        //   maxDate?,
        //   highlightedDates?: [] 
        // }

        // 💡 Convertir selectedDate a Date si es string
        const date = props.selectedDate
            ? (typeof props.selectedDate === 'string' ? parseDate(props.selectedDate) : props.selectedDate)
            : new Date();

        this.state = {
            viewDate: date
        };
    }

    getDaysInMonth(date) {
        const year = date.getFullYear();
        const month = date.getMonth();
        return new Date(year, month + 1, 0).getDate();
    }

    getFirstDayOfMonth(date) {
        const year = date.getFullYear();
        const month = date.getMonth();
        return new Date(year, month, 1).getDay();
    }

    renderHeader() {
        const { viewDate } = this.state;
        const monthNames = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];

        return `
                    <div class="calendar-header">
                        <button type="button" class="calendar-nav" onclick="calendarPicker.prevMonth()">‹</button>
                        <div class="calendar-title">
                            ${monthNames[viewDate.getMonth()]} ${viewDate.getFullYear()}
                        </div>
                        <button type="button" class="calendar-nav" onclick="calendarPicker.nextMonth()">›</button>
                    </div>
                `;
    }

    renderDays() {
        const { selectedDate, onDateSelect, highlightedDates = [] } = this.props;
        const { viewDate } = this.state;

        const daysInMonth = this.getDaysInMonth(viewDate);
        const firstDay = this.getFirstDayOfMonth(viewDate);

        const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const weekDaysHTML = weekDays.map(day =>
            `<div class="calendar-weekday">${day}</div>`
        ).join('');

        let daysHTML = '';

        // Espacios antes del primer día
        for (let i = 0; i < firstDay; i++) {
            daysHTML += '<div class="calendar-day calendar-day-empty"></div>';
        }

        // 💡 Convertir selectedDate a string si es Date
        const selectedDateKey = selectedDate
            ? (typeof selectedDate === 'string' ? selectedDate : getDateKey(selectedDate))
            : null;

        // Días del mes
        for (let day = 1; day <= daysInMonth; day++) {
            const currentDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
            const dateKey = getDateKey(currentDate);

            const isSelected = selectedDateKey === dateKey;
            const isToday = getDateKey(new Date()) === dateKey;
            const isHighlighted = highlightedDates.includes(dateKey);

            const classes = [
                'calendar-day',
                isSelected ? 'calendar-day-selected' : '',
                isToday ? 'calendar-day-today' : '',
                isHighlighted ? 'calendar-day-highlighted' : ''
            ].filter(Boolean).join(' ');

            daysHTML += `
                        <div class="${classes}" onclick="${onDateSelect}('${dateKey}')">
                            ${day}
                        </div>
                    `;
        }

        return `
                    <div class="calendar-weekdays">${weekDaysHTML}</div>
                    <div class="calendar-days">${daysHTML}</div>
                `;
    }

    prevMonth() {
        const newDate = new Date(this.state.viewDate);
        newDate.setMonth(newDate.getMonth() - 1);
        this.setState({ viewDate: newDate });
        if (window.render) window.render(); // Re-render global
    }

    nextMonth() {
        const newDate = new Date(this.state.viewDate);
        newDate.setMonth(newDate.getMonth() + 1);
        this.setState({ viewDate: newDate });
        if (window.render) window.render(); // Re-render global
    }

    render() {
        return `
                    <div class="calendar-picker">
                        ${this.renderHeader()}
                        ${this.renderDays()}
                    </div>
                `;
    }
}

import { ComponentBase } from './ComponentBase.js';
import { parseDate, getDateKey } from '../utils/DateUtils.js';
import icons from '../ui/IconSystem.js';

/**
 * Componente de Selector de Calendario Premium.
 * Soporta navegación de mes/año, indicadores visuales, y feriados.
 */
export class CalendarPickerComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: { 
        //   selectedDate: Date o String,
        //   onDateSelect: function,
        //   onClose?: function,
        //   holidays?: string[], (dateKeys)
        //   indicators?: object, (dateKey -> Array de indicadores {type, value, color})
        //   autoClose?: boolean
        // }

        const date = props.selectedDate
            ? (typeof props.selectedDate === 'string' ? parseDate(props.selectedDate) : props.selectedDate)
            : new Date();

        const viewDate = props.viewDate 
            ? (typeof props.viewDate === 'string' ? parseDate(props.viewDate) : new Date(props.viewDate))
            : new Date(date.getFullYear(), date.getMonth(), 1);

        this.state = {
            viewDate: viewDate,
            currentView: props.currentView || 'calendar', // 'calendar', 'months', 'years'
            yearPage: viewDate.getFullYear()
        };

        this._handleKeyDown = this._handleKeyDown.bind(this);
        this.initEventListeners();
    }

    initEventListeners() {
        window.addEventListener('keydown', this._handleKeyDown);
    }

    dispose() {
        window.removeEventListener('keydown', this._handleKeyDown);
    }

    _handleKeyDown(e) {
        if (e.key === 'Escape' && this.props.onClose) {
            this.props.onClose();
        }
    }

    // ─── Navegación y Estados ──────────────────────────────────────

    switchView(view) {
        this.setState({ currentView: view });
        if (window.state) window.state.datePickerView = view;
        this.renderGlobal();
    }

    prev() {
        const { currentView, viewDate, yearPage } = this.state;
        if (currentView === 'calendar') {
            viewDate.setMonth(viewDate.getMonth() - 1);
            if (window.state) window.state.datePickerMonth = new Date(viewDate);
        } else if (currentView === 'years') {
            this.setState({ yearPage: yearPage - 12 });
        }
        this.renderGlobal();
    }

    next() {
        const { currentView, viewDate, yearPage } = this.state;
        if (currentView === 'calendar') {
            viewDate.setMonth(viewDate.getMonth() + 1);
            if (window.state) window.state.datePickerMonth = new Date(viewDate);
        } else if (currentView === 'years') {
            this.setState({ yearPage: yearPage + 12 });
        }
        this.renderGlobal();
    }


    selectMonth(mIdx) {
        const { viewDate } = this.state;
        viewDate.setMonth(mIdx);
        if (window.state) window.state.datePickerMonth = new Date(viewDate);
        this.setState({ currentView: 'calendar' });
        this.renderGlobal();
    }

    selectYear(year) {
        const { viewDate } = this.state;
        viewDate.setFullYear(year);
        if (window.state) window.state.datePickerMonth = new Date(viewDate);
        this.setState({ currentView: 'months' });
        this.renderGlobal();
    }

    renderGlobal() {
        if (window.render) window.render();
    }

    // ─── Renderizado ───────────────────────────────────────────────

    renderHeader() {
        const { viewDate, currentView, yearPage } = this.state;
        const monthNames = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];

        let title = '';
        if (currentView === 'calendar') {
            title = `<span onclick="calendarPicker.switchView('months')" style="cursor:pointer">${monthNames[viewDate.getMonth()]}</span> 
                     <span onclick="calendarPicker.switchView('years')" style="cursor:pointer">${viewDate.getFullYear()}</span>`;
        } else if (currentView === 'months') {
            title = `<span onclick="calendarPicker.switchView('years')" style="cursor:pointer">${viewDate.getFullYear()}</span>`;
        } else {
            title = `${yearPage - 5} - ${yearPage + 6}`;
        }

        const showNav = currentView !== 'months';

        return `
            <div class="calendar-header">
                ${showNav ? `<button type="button" class="calendar-nav" onclick="calendarPicker.prev()">${icons.get('chevron-left')}</button>` : '<div></div>'}
                <div class="calendar-title">${title}</div>
                ${showNav ? `<button type="button" class="calendar-nav" onclick="calendarPicker.next()">${icons.get('chevron-right')}</button>` : '<div></div>'}
            </div>
        `;
    }

    renderMonths() {
        const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const currentMonth = this.state.viewDate.getMonth();
        
        return `
            <div class="calendar-grid-jumper">
                ${monthNames.map((name, i) => `
                    <div class="jumper-item ${i === currentMonth ? 'active' : ''}" onclick="calendarPicker.selectMonth(${i})">
                        ${name}
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderYears() {
        const { yearPage } = this.state;
        const currentYear = this.state.viewDate.getFullYear();
        const years = [];
        for (let i = yearPage - 5; i <= yearPage + 6; i++) {
            years.push(i);
        }

        return `
            <div class="calendar-grid-jumper">
                ${years.map(y => `
                    <div class="jumper-item ${y === currentYear ? 'active' : ''}" onclick="calendarPicker.selectYear(${y})">
                        ${y}
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderDays() {
        const { selectedDate, onDateSelect, holidays = [], indicators = {} } = this.props;
        const { viewDate } = this.state;

        const year = viewDate.getFullYear();
        const month = viewDate.getMonth();
        
        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const weekDaysHTML = weekDays.map(day => `<div class="calendar-weekday">${day}</div>`).join('');

        let daysHTML = '';

        // Días mes anterior
        for (let i = firstDayOfMonth - 1; i >= 0; i--) {
            const dayNum = daysInPrevMonth - i;
            daysHTML += `<div class="calendar-day calendar-day-other">${dayNum}</div>`;
        }

        const selectedDateKey = selectedDate ? (typeof selectedDate === 'string' ? selectedDate : getDateKey(selectedDate)) : null;
        const todayKey = getDateKey(new Date());

        // Días mes actual
        for (let day = 1; day <= daysInMonth; day++) {
            const dateKey = getDateKey(new Date(year, month, day));
            const isSelected = selectedDateKey === dateKey;
            const isToday = todayKey === dateKey;
            const isHoliday = holidays.includes(dateKey);
            const dayIndicators = indicators[dateKey] || [];

            const classes = [
                'calendar-day',
                isSelected ? 'calendar-day-selected' : '',
                isToday ? 'calendar-day-today' : '',
                isHoliday ? 'calendar-day-holiday' : ''
            ].filter(Boolean).join(' ');

            const indicatorsHTML = dayIndicators.length > 0 
                ? `<div class="calendar-indicators">
                    ${dayIndicators.map(ind => `
                        <span class="indicator-${ind.type}" style="${ind.color ? `color:${ind.color}` : ''}">${ind.value || ''}</span>
                    `).join('')}
                   </div>` 
                : '';

            daysHTML += `
                <div class="${classes}" onclick="calendarPicker.handleDateClick('${dateKey}')">
                    ${day}
                    ${indicatorsHTML}
                </div>
            `;
        }

        // Rellenar hasta completar 42 celdas (6 semanas)
        const totalCells = 42;
        const currentCellCount = firstDayOfMonth + daysInMonth;
        for (let i = 1; i <= totalCells - currentCellCount; i++) {
            daysHTML += `<div class="calendar-day calendar-day-other">${i}</div>`;
        }

        return `
            <div class="calendar-weekdays">${weekDaysHTML}</div>
            <div class="calendar-days">${daysHTML}</div>
        `;
    }

    handleDateClick(dateKey) {
        console.log('📅 [DEBUG] Seleccionando fecha:', dateKey, 'onDateSelect:', this.props.onDateSelect);
        
        if (typeof this.props.onDateSelect === 'function') {
            this.props.onDateSelect(dateKey);
        } else if (typeof this.props.onDateSelect === 'string') {
            // Resolver cadena global (ej: "window.selectDate")
            const parts = this.props.onDateSelect.replace('window.', '').split('.');
            let fn = window;
            for (const part of parts) {
                fn = fn?.[part];
            }
            if (typeof fn === 'function') {
                fn(dateKey);
            } else {
                console.error('❌ No se encontró la función:', this.props.onDateSelect);
            }
        }

        if (this.props.autoClose !== false && this.props.onClose) {
            this.props.onClose();
        }
    }


    render() {
        window.calendarPicker = this;
        const { currentView } = this.state;

        let content = '';
        if (currentView === 'calendar') content = this.renderDays();
        else if (currentView === 'months') content = this.renderMonths();
        else if (currentView === 'years') content = this.renderYears();

        return `
            <div class="calendar-picker" onclick="event.stopPropagation()">
                ${this.renderHeader()}
                ${content}
            </div>
        `;
    }
}

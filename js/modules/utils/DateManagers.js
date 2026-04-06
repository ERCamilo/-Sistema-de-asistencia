import { getDateKey, parseDate, formatMonthYear } from './DateUtils.js';

// ============================================
// 💡 REFACTORIZACIÓN POO - Clase base para manejadores de fecha
// ============================================
export class DateRangeManager {
    constructor(state, config, onSave) {
        this.state = state;
        this.onSave = onSave; // Callback para guardar cambios
        this.config = {
            startDateKey: config.startDateKey || 'startDate',
            endDateKey: config.endDateKey || 'endDate',
            showStartPickerKey: config.showStartPickerKey || 'showStartPicker',
            showEndPickerKey: config.showEndPickerKey || 'showEndPicker',
            startPickerMonthKey: config.startPickerMonthKey || 'startPickerMonth',
            endPickerMonthKey: config.endPickerMonthKey || 'endPickerMonth',
            name: config.name || 'DateRange'
        };
    }

    // Inicializar fechas si no existen
    initializeDates() {
        if (!this.state[this.config.startDateKey]) {
            const now = new Date();
            this.state[this.config.startDateKey] = getDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
            console.log(`✨ ${this.config.name} Start Date inicializada:`, this.state[this.config.startDateKey]);
        }

        if (!this.state[this.config.endDateKey]) {
            this.state[this.config.endDateKey] = getDateKey(new Date());
            console.log(`✨ ${this.config.name} End Date inicializada:`, this.state[this.config.endDateKey]);
        }

        if (!this.state[this.config.startPickerMonthKey]) {
            this.state[this.config.startPickerMonthKey] = parseDate(this.state[this.config.startDateKey]);
        }
        if (!this.state[this.config.endPickerMonthKey]) {
            this.state[this.config.endPickerMonthKey] = parseDate(this.state[this.config.endDateKey]);
        }
    }

    // Toggle calendario de fecha inicio
    toggleStartPicker() {
        this.state[this.config.showStartPickerKey] = !this.state[this.config.showStartPickerKey];
        this.state[this.config.showEndPickerKey] = false;

        if (this.state[this.config.showStartPickerKey]) {
            this.state[this.config.startPickerMonthKey] = parseDate(this.state[this.config.startDateKey]);
        }
    }

    // Toggle calendario de fecha fin
    toggleEndPicker() {
        this.state[this.config.showEndPickerKey] = !this.state[this.config.showEndPickerKey];
        this.state[this.config.showStartPickerKey] = false;

        if (this.state[this.config.showEndPickerKey]) {
            this.state[this.config.endPickerMonthKey] = parseDate(this.state[this.config.endDateKey]);
        }
    }

    // Cambiar mes del calendario de inicio
    changeStartMonth(delta) {
        const month = this.state[this.config.startPickerMonthKey];
        month.setMonth(month.getMonth() + delta);
        this.state[this.config.startPickerMonthKey] = new Date(month);
    }

    // Cambiar mes del calendario de fin
    changeEndMonth(delta) {
        const month = this.state[this.config.endPickerMonthKey];
        month.setMonth(month.getMonth() + delta);
        this.state[this.config.endPickerMonthKey] = new Date(month);
    }

    // Seleccionar fecha de inicio
    selectStartDate(isoDate) {
        const dateStr = isoDate.split('T')[0];
        this.state[this.config.startDateKey] = dateStr;
        this.state[this.config.showStartPickerKey] = false;
        console.log(`✨ ${this.config.name} Start Date seleccionada:`, dateStr);
        if (this.onSave) this.onSave();
    }

    // Seleccionar fecha de fin
    selectEndDate(isoDate) {
        const dateStr = isoDate.split('T')[0];
        this.state[this.config.endDateKey] = dateStr;
        this.state[this.config.showEndPickerKey] = false;
        console.log(`✨ ${this.config.name} End Date seleccionada:`, dateStr);
        if (this.onSave) this.onSave();
    }

    // Establecer esta semana
    setThisWeek() {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const sunday = new Date(today);
        sunday.setDate(today.getDate() - dayOfWeek);
        const saturday = new Date(today);
        saturday.setDate(today.getDate() + (6 - dayOfWeek));

        this.state[this.config.startDateKey] = getDateKey(sunday);
        this.state[this.config.endDateKey] = getDateKey(saturday);
        if (this.onSave) this.onSave();
    }

    // Establecer este mes
    setThisMonth() {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        this.state[this.config.startDateKey] = getDateKey(firstDay);
        this.state[this.config.endDateKey] = getDateKey(lastDay);
        if (this.onSave) this.onSave();
    }

    // Establecer últimos 30 días
    setLast30Days() {
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);

        this.state[this.config.startDateKey] = getDateKey(thirtyDaysAgo);
        this.state[this.config.endDateKey] = getDateKey(today);
        if (this.onSave) this.onSave();
    }

    // Establecer periodo de pago actual
    setPayPeriod() {
        const pp = this.state.settings?.payPeriod;
        if (pp?.periodStart) {
            const start = new Date(pp.periodStart + 'T00:00:00');
            const len = pp.periodLength || 15;
            const end = new Date(start);
            end.setDate(end.getDate() + len - 1);
            
            this.state[this.config.startDateKey] = getDateKey(start);
            this.state[this.config.endDateKey] = getDateKey(end);
            if (this.onSave) this.onSave();
        } else {
            if (window.showNotification) window.showNotification('❌ No hay período configurado. Ve a Ajustes.', 'warning');
            else if (window.showAlert) window.showAlert('❌ No hay período configurado.', 'warning');
        }
    }
}

// ============================================
// 💡 CLASE DashboardDateManagerV2
// ============================================
export class DashboardDateManagerV2 extends DateRangeManager {
    constructor(state, onSave) {
        super(state, {
            startDateKey: 'dashboardStartDate',
            endDateKey: 'dashboardEndDate',
            showStartPickerKey: 'showStartDatePicker',
            showEndPickerKey: 'showEndDatePicker',
            startPickerMonthKey: 'startDatePickerMonth',
            endPickerMonthKey: 'endDatePickerMonth',
            name: 'Dashboard'
        }, onSave);
    }
}

// ============================================
// 💡 CLASE EmployeeReportDateManagerV2
// ============================================
export class EmployeeReportDateManagerV2 extends DateRangeManager {
    constructor(state, onSave) {
        super(state, {
            startDateKey: 'employeeReportStartDate',
            endDateKey: 'employeeReportEndDate',
            showStartPickerKey: 'showEmployeeReportStartPicker',
            showEndPickerKey: 'showEmployeeReportEndPicker',
            startPickerMonthKey: 'employeeReportStartPickerMonth',
            endPickerMonthKey: 'employeeReportEndPickerMonth',
            name: 'EmployeeReport'
        }, onSave);
    }
}

// ============================================
// 💡 CLASE DashboardDateManager (Legacy/V1)
// ============================================
export class DashboardDateManager {
    constructor(state, onSave) {
        this.state = state;
        this.onSave = onSave;
    }

    // Inicializar fechas si no existen
    initializeDates() {
        if (!this.state.dashboardStartDate) {
            // Primer día del mes actual
            const now = new Date();
            this.state.dashboardStartDate = getDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
            console.log('💡 Dashboard Start Date inicializada:', this.state.dashboardStartDate);
        }

        if (!this.state.dashboardEndDate) {
            // Hoy
            this.state.dashboardEndDate = getDateKey(new Date());
            console.log('💡 Dashboard End Date inicializada:', this.state.dashboardEndDate);
        }

        // Inicializar meses de los calendarios
        if (!this.state.startDatePickerMonth) {
            this.state.startDatePickerMonth = parseDate(this.state.dashboardStartDate);
        }
        if (!this.state.endDatePickerMonth) {
            this.state.endDatePickerMonth = parseDate(this.state.dashboardEndDate);
        }
    }

    // Toggle calendario de fecha inicio
    toggleStartPicker() {
        this.state.showStartDatePicker = !this.state.showStartDatePicker;
        this.state.showEndDatePicker = false; // Cerrar el otro

        if (this.state.showStartDatePicker) {
            this.state.startDatePickerMonth = parseDate(this.state.dashboardStartDate);
        }

        console.log('💡 Toggle Start Picker:', this.state.showStartDatePicker);
    }

    // Toggle calendario de fecha fin
    toggleEndPicker() {
        this.state.showEndDatePicker = !this.state.showEndDatePicker;
        this.state.showStartDatePicker = false; // Cerrar el otro

        if (this.state.showEndDatePicker) {
            this.state.endDatePickerMonth = parseDate(this.state.dashboardEndDate);
        }

        console.log('💡 Toggle End Picker:', this.state.showEndDatePicker);
    }

    // Cambiar mes del calendario de inicio
    changeStartMonth(delta) {
        const month = this.state.startDatePickerMonth;
        month.setMonth(month.getMonth() + delta);
        this.state.startDatePickerMonth = new Date(month);
        console.log('💡 Start Picker Month:', formatMonthYear(this.state.startDatePickerMonth));
    }

    // Cambiar mes del calendario de fin
    changeEndMonth(delta) {
        const month = this.state.endDatePickerMonth;
        month.setMonth(month.getMonth() + delta);
        this.state.endDatePickerMonth = new Date(month);
        console.log('💡 End Picker Month:', formatMonthYear(this.state.endDatePickerMonth));
    }

    // Seleccionar fecha de inicio
    selectStartDate(isoDate) {
        const dateStr = isoDate.split('T')[0]; // Convertir ISO a YYYY-MM-DD
        this.state.dashboardStartDate = dateStr;
        this.state.showStartDatePicker = false;

        console.log('💡 Start Date seleccionada:', dateStr);
        if (this.onSave) this.onSave();
    }

    // Seleccionar fecha de fin
    selectEndDate(isoDate) {
        const dateStr = isoDate.split('T')[0]; // Convertir ISO a YYYY-MM-DD
        this.state.dashboardEndDate = dateStr;
        this.state.showEndDatePicker = false;

        console.log('💡 End Date seleccionada:', dateStr);
        if (this.onSave) this.onSave();
    }

    // Establecer esta semana
    setThisWeek() {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const sunday = new Date(today);
        sunday.setDate(today.getDate() - dayOfWeek);
        const saturday = new Date(today);
        saturday.setDate(today.getDate() + (6 - dayOfWeek));

        this.state.dashboardStartDate = getDateKey(sunday);
        this.state.dashboardEndDate = getDateKey(saturday);

        console.log('💡 Esta Semana:', this.state.dashboardStartDate, 'a', this.state.dashboardEndDate);
        if (this.onSave) this.onSave();
    }

    // Establecer este mes
    setThisMonth() {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        this.state.dashboardStartDate = getDateKey(firstDay);
        this.state.dashboardEndDate = getDateKey(lastDay);

        console.log('💡 Este Mes:', this.state.dashboardStartDate, 'a', this.state.dashboardEndDate);
        if (this.onSave) this.onSave();
    }

    // Establecer últimos 30 días
    setLast30Days() {
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);

        this.state.dashboardStartDate = getDateKey(thirtyDaysAgo);
        this.state.dashboardEndDate = getDateKey(today);

        console.log('💡 Últimos 30 días:', this.state.dashboardStartDate, 'a', this.state.dashboardEndDate);
        if (this.onSave) this.onSave();
    }
}

// ============================================
// 💡 CLASE EmployeeReportDateManager (Legacy/V1)
// ============================================
export class EmployeeReportDateManager {
    constructor(state, onSave) {
        this.state = state;
        this.onSave = onSave;
    }

    // Inicializar fechas si no existen
    initializeDates() {
        if (!this.state.employeeReportStartDate) {
            // Primer día del mes actual
            const now = new Date();
            this.state.employeeReportStartDate = getDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
            console.log('💡 Employee Report Start Date inicializada:', this.state.employeeReportStartDate);
        }

        if (!this.state.employeeReportEndDate) {
            // Hoy
            this.state.employeeReportEndDate = getDateKey(new Date());
            console.log('💡 Employee Report End Date inicializada:', this.state.employeeReportEndDate);
        }

        // Inicializar meses de los calendarios
        if (!this.state.employeeReportStartPickerMonth) {
            this.state.employeeReportStartPickerMonth = parseDate(this.state.employeeReportStartDate);
        }
        if (!this.state.employeeReportEndPickerMonth) {
            this.state.employeeReportEndPickerMonth = parseDate(this.state.employeeReportEndDate);
        }
    }

    // Toggle calendario de fecha inicio
    toggleStartPicker() {
        this.state.showEmployeeReportStartPicker = !this.state.showEmployeeReportStartPicker;
        this.state.showEmployeeReportEndPicker = false; // Cerrar el otro

        if (this.state.showEmployeeReportStartPicker) {
            this.state.employeeReportStartPickerMonth = parseDate(this.state.employeeReportStartDate);
        }

        console.log('💡 Toggle Employee Report Start Picker:', this.state.showEmployeeReportStartPicker);
    }

    // Toggle calendario de fecha fin
    toggleEndPicker() {
        this.state.showEmployeeReportEndPicker = !this.state.showEmployeeReportEndPicker;
        this.state.showEmployeeReportStartPicker = false; // Cerrar el otro

        if (this.state.showEmployeeReportEndPicker) {
            this.state.employeeReportEndPickerMonth = parseDate(this.state.employeeReportEndDate);
        }

        console.log('💡 Toggle Employee Report End Picker:', this.state.showEmployeeReportEndPicker);
    }

    // Cambiar mes del calendario de inicio
    changeStartMonth(delta) {
        const month = this.state.employeeReportStartPickerMonth;
        month.setMonth(month.getMonth() + delta);
        this.state.employeeReportStartPickerMonth = new Date(month);
        console.log('💡 Employee Report Start Picker Month:', formatMonthYear(this.state.employeeReportStartPickerMonth));
    }

    // Cambiar mes del calendario de fin
    changeEndMonth(delta) {
        const month = this.state.employeeReportEndPickerMonth;
        month.setMonth(month.getMonth() + delta);
        this.state.employeeReportEndPickerMonth = new Date(month);
        console.log('💡 Employee Report End Picker Month:', formatMonthYear(this.state.employeeReportEndPickerMonth));
    }

    // Seleccionar fecha de inicio
    selectStartDate(isoDate) {
        const dateStr = isoDate.split('T')[0]; // Convertir ISO a YYYY-MM-DD
        this.state.employeeReportStartDate = dateStr;
        this.state.showEmployeeReportStartPicker = false;

        console.log('💡 Employee Report Start Date seleccionada:', dateStr);
        if (this.onSave) this.onSave();
    }

    // Seleccionar fecha de fin
    selectEndDate(isoDate) {
        const dateStr = isoDate.split('T')[0]; // Convertir ISO a YYYY-MM-DD
        this.state.employeeReportEndDate = dateStr;
        this.state.showEmployeeReportEndPicker = false;

        console.log('💡 Employee Report End Date seleccionada:', dateStr);
        if (this.onSave) this.onSave();
    }

    // Establecer esta semana
    setThisWeek() {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const sunday = new Date(today);
        sunday.setDate(today.getDate() - dayOfWeek);
        const saturday = new Date(today);
        saturday.setDate(today.getDate() + (6 - dayOfWeek));

        this.state.employeeReportStartDate = getDateKey(sunday);
        this.state.employeeReportEndDate = getDateKey(saturday);

        console.log('💡 Employee Report Esta Semana:', this.state.employeeReportStartDate, 'a', this.state.employeeReportEndDate);
        if (this.onSave) this.onSave();
    }

    // Establecer este mes
    setThisMonth() {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        this.state.employeeReportStartDate = getDateKey(firstDay);
        this.state.employeeReportEndDate = getDateKey(lastDay);

        console.log('💡 Employee Report Este Mes:', this.state.employeeReportStartDate, 'a', this.state.employeeReportEndDate);
        if (this.onSave) this.onSave();
    }

    // Establecer últimos 30 días
    setLast30Days() {
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);

        this.state.employeeReportStartDate = getDateKey(thirtyDaysAgo);
        this.state.employeeReportEndDate = getDateKey(today);

        console.log('💡 Employee Report Últimos 30 días:', this.state.employeeReportStartDate, 'a', this.state.employeeReportEndDate);
        if (this.onSave) this.onSave();
    }
}

// ============================================
// 💡 NUEVA CLASE SingleDateManager (POO)
// ============================================
/**
 * Gestiona una única fecha seleccionada.
 * Centraliza la lógica de cambio de fecha y control de calendario flotante.
 */
export class SingleDateManager {
    constructor(state, config = {}, onSave) {
        this.state = state;
        this.onSave = onSave;
        this.config = {
            dateKey: config.dateKey || 'selectedDate',
            showPickerKey: config.showPickerKey || 'showDatePicker',
            pickerTargetKey: config.pickerTargetKey || 'datePickerTarget',
            name: config.name || 'SingleDate'
        };
    }

    /**
     * Alternar visibilidad del selector de fechas
     * @param {string} target - El identificador del componente que lo abre (full, compact, etc)
     * @param {boolean|null} force - Si se especifica, fuerza el estado (true = abrir, false = cerrar)
     */
    togglePicker(target = 'full', force = null) {
        const currentShow = this.state[this.config.showPickerKey];
        const currentTarget = this.state[this.config.pickerTargetKey];

        if (force !== null) {
            this.state[this.config.showPickerKey] = force;
            if (force) this.state[this.config.pickerTargetKey] = target;
        } else if (currentShow && currentTarget === target) {
            this.state[this.config.showPickerKey] = false;
        } else {
            this.state[this.config.showPickerKey] = true;
            this.state[this.config.pickerTargetKey] = target;
        }
        
        console.log(`💡 ${this.config.name} Toggle Picker:`, this.state[this.config.showPickerKey], 'Target:', target);
    }

    /**
     * Cambiar la fecha por un delta (unidades de días)
     */
    changeDate(days) {
        const current = parseDate(this.state[this.config.dateKey]);
        current.setDate(current.getDate() + days);
        this.state[this.config.dateKey] = current; // Proxied state handles the update
        
        console.log(`💡 ${this.config.name} Date cambiado por ${days} días:`, getDateKey(current));
        if (this.onSave) this.onSave();
    }

    /**
     * Seleccionar una fecha específica (desde calendario)
     */
    selectDate(dateKey) {
        this.state[this.config.dateKey] = parseDate(dateKey);
        this.state[this.config.showPickerKey] = false;
        
        console.log(`💡 ${this.config.name} Date seleccionado:`, dateKey);
        if (this.onSave) this.onSave();
    }

    /**
     * Establecer fecha a hoy
     */
    setToday() {
        this.state[this.config.dateKey] = new Date();
        if (this.onSave) this.onSave();
    }
}

// ============================================
// 💡 CLASE AttendanceDateManager (Especializada)
// ============================================
/**
 * Extensión de SingleDateManager para la vista de Asistencia.
 * Implementa saltos inteligentes (7 días si está en modo semana).
 */
export class AttendanceDateManager extends SingleDateManager {
    constructor(state, onSave) {
        super(state, {
            dateKey: 'selectedDate',
            showPickerKey: 'showDatePicker',
            pickerTargetKey: 'datePickerTarget',
            name: 'Attendance'
        }, onSave);
    }

    /**
     * Cambio de fecha inteligente según viewMode
     */
    changeDate(delta) {
        const isWeek = this.state.viewMode === 'week';
        const jump = isWeek ? (delta * 7) : delta;
        super.changeDate(jump);
    }
}

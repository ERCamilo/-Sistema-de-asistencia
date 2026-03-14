// ============================================
// 💡 DATE UTILS
// ============================================

// 💡 Helper: Crear Date desde string YYYY-MM-DD sin problemas de timezone
export function parseDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return new Date();
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

export function getDateKey(d) {
    // 💡 Si ya es string en formato correcto, devolverlo
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return d;
    }

    // 💡 Convertir a Date si es string
    const date = typeof d === 'string' ? parseDate(d) : d;

    // Corregir zona horaria: restar offset para obtener fecha local correcta
    const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return localDate.toISOString().split('T')[0];
}

export function isDayHoliday(dateInput, holidays = []) {
    // Acepta tanto string (YYYY-MM-DD) como Date object
    const dateStr = typeof dateInput === 'string' ? dateInput : getDateKey(dateInput);
    return holidays.includes(dateStr);
}

// Formateadores de fecha
export function formatDate(d) {
    // 💡 Convertir string a Date si es necesario
    const date = typeof d === 'string' ? parseDate(d) : d;
    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${days[date.getDay()]}, ${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`;
}

export function formatDateShort(d) {
    // 💡 Convertir string a Date si es necesario
    const date = typeof d === 'string' ? parseDate(d) : d;
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const dayName = days[date.getDay()];
    return `${dayName}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatMonthYear(d) {
    // 💡 Convertir string a Date si es necesario
    const date = typeof d === 'string' ? parseDate(d) : d;
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

// 💡 NUEVA: Formatear rango de fechas con información del mes
export function formatDateRangeWithMonth(startDateStr, endDateStr) {
    const startDate = typeof startDateStr === 'string' ? parseDate(startDateStr) : startDateStr;
    const endDate = typeof endDateStr === 'string' ? parseDate(endDateStr) : endDateStr;

    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const monthsShort = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    const startMonth = startDate.getMonth();
    const endMonth = endDate.getMonth();
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();

    // Si es el mismo mes y año
    if (startMonth === endMonth && startYear === endYear) {
        return `${icons.get('sparkles')} ${months[startMonth]} ${startYear} (${startDate.getDate()}-${endDate.getDate()})`;
    }

    // Si es el mismo año pero diferentes meses
    if (startYear === endYear) {
        return `${icons.get('sparkles')} ${monthsShort[startMonth]}-${monthsShort[endMonth]} ${startYear} (${startDate.getDate()} ${monthsShort[startMonth]} - ${endDate.getDate()} ${monthsShort[endMonth]})`;
    }

    // Años diferentes
    return `${icons.get('sparkles')} ${startDate.getDate()} ${monthsShort[startMonth]} ${startYear} - ${endDate.getDate()} ${monthsShort[endMonth]} ${endYear}`;
}

export const DateUtils = {
    // Obtener fecha de hoy
    today() {
        return getDateKey(new Date());
    },

    // Añadir días a una fecha string
    addDays(dateStr, days) {
        const date = parseDate(dateStr);
        date.setDate(date.getDate() + days);
        return getDateKey(date);
    },

    // Restar días a una fecha string
    subtractDays(dateStr, days) {
        return this.addDays(dateStr, -days);
    },

    // Verificar si es el día de hoy
    isToday(dateStr) {
        return dateStr === this.today();
    },

    // Verificar si dos fechas son iguales
    isSame(dateStr1, dateStr2) {
        return dateStr1 === dateStr2;
    },

    // Formatear fecha string para mostrar
    format(dateStr) {
        return formatDate(parseDate(dateStr));
    },

    // Formatear fecha string corto
    formatShort(dateStr) {
        return formatDateShort(parseDate(dateStr));
    },

    // Obtener inicio de semana (domingo)
    getWeekStart(dateStr) {
        const date = parseDate(dateStr);
        const day = date.getDay();
        date.setDate(date.getDate() - day);
        return getDateKey(date);
    },

    // Obtener array de fechas de la semana
    getWeekDates(dateStr) {
        const startStr = this.getWeekStart(dateStr);
        const dates = [];
        for (let i = 0; i < 7; i++) {
            dates.push(this.addDays(startStr, i));
        }
        return dates;
    },

    // Comparar fechas (-1: dateStr1 < dateStr2, 0: iguales, 1: dateStr1 > dateStr2)
    compare(dateStr1, dateStr2) {
        return dateStr1.localeCompare(dateStr2);
    },

    // Verificar si es festivo
    isHoliday(dateStr, holidays = []) {
        return holidays.includes(dateStr);
    }
};

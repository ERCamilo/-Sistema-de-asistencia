import icons from '../ui/IconSystem.js';

// ============================================
// 💡 DATE UTILS
// ============================================

// 💡 Helper: Crear Date desde string YYYY-MM-DD sin problemas de timezone
export function parseDate(dateStr) {
    if (!dateStr) return new Date();
    if (dateStr instanceof Date) return dateStr;
    if (typeof dateStr !== 'string') return new Date();

    // 💡 Soporta formato estándar YYYY-MM-DD para evitar problemas de timezone
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
    }
    
    // 💡 Fallback para strings ISO u otros formatos detectables por el constructor
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? new Date() : d;
}

export function getDateKey(d) {
    // 💡 Si ya es string en formato grueso, devolverlo
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return d;
    }

    // 💡 Convertir a Date si es string
    const date = typeof d === 'string' ? parseDate(d) : d;

    // Usar componentes locales para evitar problemas de offset de zona horaria y DST
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

export function formatDateTime(d) {
    const date = typeof d === 'string' ? parseDate(d) : d;
    const base = formatDate(date);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${base} - ${hours}:${minutes}`;
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

// 💡 NUEVA: Obtener array de días para un calendario mensual completo (incluye días del mes anterior/siguiente)
export function getDaysInMonth(date) {
    const y = date.getFullYear(), m = date.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const days = [];
    const start = first.getDay();
    for (let i = 0; i < start; i++) days.push({ date: new Date(y, m, -start + i + 1), currentMonth: false });
    for (let i = 1; i <= last.getDate(); i++) days.push({ date: new Date(y, m, i), currentMonth: true });
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) days.push({ date: new Date(y, m + 1, i), currentMonth: false });
    return days;
}

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
        return `${icons.get('zap')} ${months[startMonth]} ${startYear} (${startDate.getDate()}-${endDate.getDate()})`;
    }

    // Si es el mismo año pero diferentes meses
    if (startYear === endYear) {
        return `${icons.get('zap')} ${monthsShort[startMonth]}-${monthsShort[endMonth]} ${startYear} (${startDate.getDate()} ${monthsShort[startMonth]} - ${endDate.getDate()} ${monthsShort[endMonth]})`;
    }

    // Años diferentes
    return `${icons.get('zap')} ${startDate.getDate()} ${monthsShort[startMonth]} ${startYear} - ${endDate.getDate()} ${monthsShort[endMonth]} ${endYear}`;
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

    // Obtener inicio de semana (Lunes)
    getWeekStart(dateStr) {
        const date = parseDate(dateStr);
        const day = date.getDay() || 7; // Convertir 0 (Domingo) a 7
        date.setDate(date.getDate() - (day - 1));
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
    },

    // Formatear fecha y hora
    formatDateTime(d) {
        return formatDateTime(d);
    }
};

/**
 * 📅 Obtener texto con el rango de fechas de la semana (Lunes-Domingo)
 */
export function getWeekRangeText(dateInput) {
    const d = typeof dateInput === 'string' ? parseDate(dateInput) : new Date(dateInput);
    const day = d.getDay() || 7; // Convertir 0 (Domingo) a 7
    
    // Obtener Lunes
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day - 1));
    
    // Obtener Domingo
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    const start = monday.toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });
    const end = sunday.toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });
    
    return `${start} - ${end}`;
}

/**
 * 🔍 Verifica si un empleado estaba activo en una fecha específica
 */
export function wasEmployeeActiveOnDate(employee, date, attendance = {}) {
    const dateKey = typeof date === 'string' ? date : getDateKey(date);
    // Normaliza a YYYY-MM-DD para comparar como string de forma fiable
    // (tolera ISO con hora, p.ej. hireDate "2026-05-15T00:00:00.000Z").
    const norm = (d) => String(d || '').slice(0, 10);

    // 1. Fecha de contratación
    const hire = norm(employee.hireDate);
    if (hire && dateKey < hire) return false;

    // 2. Asistencia explícita ese día → siempre significa activo
    // Fase 1 (U2c): un tombstone (deletedAt seteado) no es asistencia real —
    // solo cuenta si la clave sigue viva.
    const attKey = `${employee.id}-${dateKey}`;
    if (attendance[attKey] && attendance[attKey].deletedAt == null) return true;

    // 3. Fecha de terminación (si existe)
    const term = norm(employee.terminationDate);
    if (term && dateKey > term) return false;

    // 4. Historial de estados
    if (!employee.statusHistory || employee.statusHistory.length === 0) {
        return employee.active !== false;
    }

    // ⚠️ Decidir por FECHA, no por timestamp. Ordenar por timestamp y luego
    // elegir por fecha rompía el caso de reactivación tras un merge
    // multi-dispositivo: si la reactivación quedaba con un timestamp menor
    // que la desactivación previa (relojes desfasados), se elegía la
    // desactivación vieja y el empleado desaparecía pese a estar activo.
    const sorted = [...employee.statusHistory]
        .filter(c => c && c.date)
        .sort((a, b) => {
            const da = norm(a.date), db = norm(b.date);
            if (da !== db) return da < db ? -1 : 1;
            return (a.timestamp || 0) - (b.timestamp || 0);
        });

    let wasActive = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
        if (norm(sorted[i].date) <= dateKey) {
            wasActive = sorted[i].active;
            break;
        }
    }

    // Si no hay ningún cambio en/antes de la fecha, la fecha es anterior al
    // primer cambio registrado: el empleado estaba activo desde su ingreso.
    if (wasActive === null) return true;
    return wasActive;
}

/**
 * 🔎 Decide si un empleado debe APARECER en la lista de asistencia de una
 * fecha, y si debe llevar un MARCADOR visual de "no activo según el registro".
 *
 * Regla:
 *   - Si estuvo activo ese día (historial) → visible, sin marcador.
 *   - Si NO estuvo activo ese día pero está activo HOY y la fecha es >= su
 *     fecha de ingreso → visible CON marcador (caso típico: se activó un día
 *     tarde, o se desactivó por error). Sigue siendo totalmente funcional.
 *   - En cualquier otro caso (inactivo hoy y ese día, o antes del ingreso)
 *     → oculto.
 *
 * @returns {{ visible: boolean, flagged: boolean }}
 */
export function isEmployeeVisibleOnDate(employee, date, attendance = {}) {
    const dateKey = typeof date === 'string' ? date : getDateKey(date);
    if (wasEmployeeActiveOnDate(employee, dateKey, attendance)) {
        return { visible: true, flagged: false };
    }
    if (employee.active === true) {
        const hire = employee.hireDate ? String(employee.hireDate).slice(0, 10) : null;
        if (!hire || dateKey >= hire) {
            return { visible: true, flagged: true };
        }
    }
    return { visible: false, flagged: false };
}

/**
 * 📅 Verifica si un empleado estuvo activo en un rango de fechas de forma eficiente.
 */
export function wasEmployeeActiveInRange(employee, startDate, endDate, attendance = {}, attendanceByDate = {}) {
    const start = typeof startDate === 'string' ? startDate : getDateKey(startDate);
    const end = typeof endDate === 'string' ? endDate : getDateKey(endDate);

    // 1. Verificación O(1): ¿Tiene récords en los días del rango?
    // En lugar de iterar sobre todas las llaves, iteramos sobre los días del rango (generalmente 7)
    const sDate = parseDate(start);
    const eDate = parseDate(end);
    
    for (let d = new Date(sDate); d <= eDate; d.setDate(d.getDate() + 1)) {
        const dKey = getDateKey(d);
        // Fase 1 (U2c): un tombstone (deletedAt seteado) no cuenta como activo.
        const rec = attendance[`${employee.id}-${dKey}`];
        if (rec && rec.deletedAt == null) return true;
    }

    // 2. Si no hay asistencia en el rango, verificar estado en los límites
    return wasEmployeeActiveOnDate(employee, start, attendance) || wasEmployeeActiveOnDate(employee, end, attendance);
}

/**
 * 💰 Utilidades de Periodo de Pago
 */
export function isDateInPayPeriod(dateKey, payPeriod) {
    if (!payPeriod || !payPeriod.periodStart) return false;
    const start = payPeriod.periodStart;
    const len = payPeriod.periodLength || 15;
    const startDate = parseDate(start);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + len - 1);
    const end = getDateKey(endDate);
    
    return dateKey >= start && dateKey <= end;
}

export function isPayday(dateKey, payPeriod) {
    if (!payPeriod || !payPeriod.payDay) return false;
    return dateKey === payPeriod.payDay;
}

// 🌐 EXPOSICIÓN GLOBAL (Para compatibilidad con handlers legacy)
export const Utils = { isDateInPayPeriod, isPayday };
window.getDaysInMonth = getDaysInMonth;
window.formatDateShort = formatDateShort;
window.getDateKey = getDateKey;
window.parseDate = parseDate;
window.isDateInPayPeriod = isDateInPayPeriod;
window.isPayday = isPayday;

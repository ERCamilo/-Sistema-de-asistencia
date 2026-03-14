import { getDateKey } from '../../utils/DateUtils.js';

export class ChartService {
    constructor(state) {
        this.state = state;
    }

    getChartData(empId, period) {
        const emp = this.state.employees.find(e => e.id === empId);
        if (!emp) return [];
        let start, end;
        const today = new Date();

        if (period === 'week') {
            end = new Date(today);
            start = new Date(today);
            start.setDate(start.getDate() - 6);

            // Generar datos por día
            const data = [];
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const key = `${empId}-${getDateKey(new Date(d))}`;
                const att = this.state.attendance[key];
                let regular = 0, overtime = 0, holiday = 0, absent = 8;
                if (att && att.present) {
                    if (att.isHoliday) {
                        holiday = att.hoursWorked;
                        absent = 0;
                    } else if (att.hoursWorked > this.state.settings.regularHoursPerDay) {
                        regular = this.state.settings.regularHoursPerDay;
                        overtime = att.hoursWorked - this.state.settings.regularHoursPerDay;
                        absent = 0;
                    } else {
                        regular = att.hoursWorked;
                        absent = 0;
                    }
                }
                data.push({ date: new Date(d), regular, overtime, holiday, absent, label: `${d.getDate()}/${d.getMonth() + 1}` });
            }
            return data;
        } else if (period === 'month') {
            end = new Date(today);
            start = new Date(today.getFullYear(), today.getMonth(), 1);

            // Generar datos por día del mes
            const data = [];
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const key = `${empId}-${getDateKey(new Date(d))}`;
                const att = this.state.attendance[key];
                let regular = 0, overtime = 0, holiday = 0, absent = 8;
                if (att && att.present) {
                    if (att.isHoliday) {
                        holiday = att.hoursWorked;
                        absent = 0;
                    } else if (att.hoursWorked > this.state.settings.regularHoursPerDay) {
                        regular = this.state.settings.regularHoursPerDay;
                        overtime = att.hoursWorked - this.state.settings.regularHoursPerDay;
                        absent = 0;
                    } else {
                        regular = att.hoursWorked;
                        absent = 0;
                    }
                }
                data.push({ date: new Date(d), regular, overtime, holiday, absent, label: `${d.getDate()}` });
            }
            return data;
        } else if (period === 'all') {
            // Modo TODO: Agrupar por MESES, cada mes es una barra
            start = new Date(emp.hireDate);
            end = new Date(today);

            const monthsData = [];

            // Iterar por cada mes desde contratación hasta hoy
            let currentMonth = new Date(start.getFullYear(), start.getMonth(), 1);

            while (currentMonth <= end) {
                const monthStart = new Date(currentMonth);
                const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

                // Si el mes final es el mes actual, usar 'today' como fin
                const effectiveEnd = monthEnd > end ? end : monthEnd;

                // Calcular totales del mes
                let monthRegular = 0, monthOvertime = 0, monthHoliday = 0, monthAbsent = 0;
                let daysCount = 0;

                for (let d = new Date(monthStart); d <= effectiveEnd; d.setDate(d.getDate() + 1)) {
                    const key = `${empId}-${getDateKey(new Date(d))}`;
                    const att = this.state.attendance[key];

                    if (att && att.present) {
                        if (att.isHoliday) {
                            monthHoliday += att.hoursWorked;
                        } else if (att.hoursWorked > this.state.settings.regularHoursPerDay) {
                            monthRegular += this.state.settings.regularHoursPerDay;
                            monthOvertime += (att.hoursWorked - this.state.settings.regularHoursPerDay);
                        } else {
                            monthRegular += att.hoursWorked;
                        }
                    } else {
                        // Día ausente cuenta como 8h ausentes
                        monthAbsent += 8;
                    }
                    daysCount++;
                }

                const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
                monthsData.push({
                    date: new Date(currentMonth),
                    regular: monthRegular,
                    overtime: monthOvertime,
                    holiday: monthHoliday,
                    absent: monthAbsent,
                    label: `${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`,
                    daysCount: daysCount
                });

                // Siguiente mes
                currentMonth.setMonth(currentMonth.getMonth() + 1);
            }

            return monthsData;
        }

        return [];
    }
}

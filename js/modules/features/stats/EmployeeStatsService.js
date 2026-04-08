/**
 * 📊 EmployeeStatsService.js - Lógica de Negocio para Estadísticas de Empleados
 * Separa los cálculos de la interfaz de usuario para permitir su reutilización.
 */

import { getDateKey, parseDate } from '../../utils/DateUtils.js';

export class EmployeeStatsService {
    constructor(state, payrollService, chartService) {
        this.state = state;
        this.payrollService = payrollService;
        this.chartService = chartService;
    }

    /**
     * Calcula el total de horas trabajadas por un empleado en un rango de fechas.
     */
    getEmployeeTotalHours(empId, start, end) {
        let total = 0;
        const startDate = parseDate(start);
        const endDate = parseDate(end);
        
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const key = `${empId}-${getDateKey(new Date(d))}`;
            const att = this.state.attendance[key];
            if (att && att.present) total += (att.hoursWorked || 0);
        }
        return total;
    }

    /**
     * Genera un resumen de datos para la Tarjeta Flotante.
     * @param {string} empId - ID del empleado.
     * @param {Date} referenceDate - Fecha de referencia (hoy por defecto).
     * @returns {Object} Datos calculados.
     */
    getFloatingCardSummary(empId, referenceDate = new Date()) {
        const emp = this.state.employees.find(e => e.id === empId);
        if (!emp) return null;

        const now = referenceDate;
        const todayKey = getDateKey(now);

        // 1. Horas últimos 7 días
        const l7 = new Date(now);
        l7.setDate(now.getDate() - 6);
        const h7 = this.getEmployeeTotalHours(empId, l7, now);

        // 2. Horas de la semana actual (Lunes a Hoy)
        const day = now.getDay() || 7;
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - (day - 1));
        const hw = this.getEmployeeTotalHours(empId, weekStart, now);

        // 3. Horas del mes actual
        const fm = new Date(now.getFullYear(), now.getMonth(), 1);
        const hm = this.getEmployeeTotalHours(empId, fm, now);

        // 4. Horas del periodo de pago actual
        let hp = 0;
        let gross = 0;
        const pStartKey = this.state.settings?.payPeriod?.periodStart;
        const pLen = this.state.settings?.payPeriod?.periodLength || 15;

        if (pStartKey && this.payrollService) {
            const start = parseDate(pStartKey);
            const end = new Date(start);
            end.setDate(start.getDate() + pLen - 1);
            const pEndKey = getDateKey(end);
            const effectiveEnd = (todayKey < pEndKey) ? todayKey : pEndKey;

            hp = this.getEmployeeTotalHours(empId, pStartKey, effectiveEnd);
            const payroll = this.payrollService.calculateEmployeePayroll(empId, pStartKey, effectiveEnd);
            gross = payroll.bruto;
        }

        // 5. Datos de gráfico
        const chartData = this.chartService ? this.chartService.getChartData(empId, this.state.chartPeriod || 'week') : [];

        return {
            employee: emp,
            stats: { h7, hw, hm, hp, gross },
            chartData
        };
    }
}

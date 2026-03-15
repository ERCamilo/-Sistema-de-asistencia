import { getDateKey } from '../../utils/DateUtils.js';

export class PayrollService {
    constructor(state) {
        this.state = state;
    }

    getSalaryConfig(employee) {
        if (!employee.salaryConfig) {
            // Migrar datos antiguos
            if (employee.customSalary) {
                return {
                    type: 'custom',
                    amount: employee.customSalary,
                    period: 'month',
                    workDays: [1, 2, 3, 4, 5, 6]
                };
            } else {
                const pos = this.state.positions.find(p => p.id === employee.positions[0]);
                if (pos?.salaryConfig) {
                    return pos.salaryConfig;
                }
                return { amount: 0, period: 'month', workDays: [] };
            }
        }

        if (employee.salaryConfig.type === 'standard') {
            const pos = this.state.positions.find(p => p.id === employee.salaryConfig.positionId);
            if (pos?.salaryConfig) {
                return pos.salaryConfig;
            }
            return { amount: 0, period: 'month', workDays: [] };
        }

        return employee.salaryConfig;
    }

    calculateDailySalary(salaryConfig) {
        const { amount, period, workDays } = salaryConfig;
        const daysPerWeek = workDays.length > 0 ? workDays.length : 7;

        switch (period) {
            case 'day':
                return amount;
            case 'week':
                return amount / daysPerWeek;
            case 'biweekly':
                return amount / (daysPerWeek * 2);
            case '3weeks':
                return amount / (daysPerWeek * 3);
            case 'month':
                // Aproximado: 4.33 semanas por mes
                return amount / (daysPerWeek * 4.33);
            default:
                return 0;
        }
    }

    calculateSalaryForPeriod(salaryConfig, days) {
        const dailySalary = this.calculateDailySalary(salaryConfig);
        return dailySalary * days;
    }

    formatSalaryDisplay(salaryConfig) {
        const { amount, period, workDays } = salaryConfig;
        const periodNames = {
            day: 'día',
            week: 'semana',
            biweekly: 'quincena',
            '3weeks': '3 semanas',
            month: 'mes'
        };

        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const workDaysText = workDays.length === 0 ? 'Todos los días' :
            workDays.length === 7 ? 'Todos los días' :
                workDays.map(d => dayNames[d]).join(', ');

        return {
            amount: `$${amount.toLocaleString()}`,
            period: periodNames[period] || period,
            workDays: workDaysText,
            full: `$${amount.toLocaleString()}/${periodNames[period]}`
        };
    }

    // ⚡ NUEVO: Calcular nómina completa de un empleado en un período
    calculateEmployeePayroll(empId, startDateKey, endDateKey, deductions = null) {
        const emp = this.state.employees.find(e => e.id === empId);
        if (!emp) return { bruto: 0, neto: 0, deductions: 0, breakdown: [] };

        const start = new Date(startDateKey + 'T12:00:00');
        const end = new Date(endDateKey + 'T12:00:00');

        // Agrupar por posición
        const positionData = {};

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateKey = getDateKey(new Date(d));
            const attKey = `${empId}-${dateKey}`;
            const att = this.state.attendance[attKey];

            if (!att || !att.present) continue;

            // Determinar qué posición(es) trabajó ese día
            let positionsWorked = [];

            if (att.positionHours && att.positionHours.length > 0) {
                // Multi-posición
                positionsWorked = att.positionHours.map(ph => ({
                    positionId: ph.positionId || att.selectedPosition || emp.positions[0],
                    hours: ph.hours || 0,
                    overtimeHours: ph.overtimeHours || 0
                }));
            } else {
                // Posición simple
                const posId = att.selectedPosition || emp.positions[0];
                positionsWorked = [{
                    positionId: posId,
                    hours: att.hoursWorked || 0,
                    overtimeHours: att.overtimeHours || 0
                }];
            }

            // Acumular por posición
            positionsWorked.forEach(pw => {
                if (!positionData[pw.positionId]) {
                    positionData[pw.positionId] = {
                        days: 0,
                        regularHours: 0,
                        overtimeHours: 0,
                        holidayHours: 0
                    };
                }

                positionData[pw.positionId].days++;

                if (att.isHoliday) {
                    positionData[pw.positionId].holidayHours += pw.hours;
                } else {
                    positionData[pw.positionId].regularHours += pw.hours;
                }

                positionData[pw.positionId].overtimeHours += pw.overtimeHours;
            });
        }

        // Calcular subtotales por posición
        const breakdown = [];
        let totalBruto = 0;

        Object.keys(positionData).forEach(posId => {
            const pos = this.state.positions.find(p => p.id === posId);
            if (!pos) return;

            const data = positionData[posId];

            // 💡 NUEVO SISTEMA SIMPLE: Solo tarifa por hora
            // 1. Obtener hourlyRate base
            let hourlyRate = pos.hourlyRate || 0;

            // 2. Si el empleado tiene sueldo personalizado para esta posición, usar ese
            if (emp.positionSalaries && emp.positionSalaries[posId]) {
                hourlyRate = emp.positionSalaries[posId];
            }

            // 3. Si no tiene hourlyRate, intentar calcular desde salaryConfig (migración)
            if (!hourlyRate && pos.salaryConfig?.amount) {
                hourlyRate = pos.salaryConfig.amount / 30 / this.state.settings.regularHoursPerDay;
            }

            // 4. Calcular tarifas con factores globales
            const overtimeFactor = this.state.settings.overtimeFactor || 1.5;
            const holidayFactor = this.state.settings.holidayFactor || 2;

            const overtimeRate = hourlyRate * overtimeFactor;
            const holidayRate = hourlyRate * holidayFactor;

            // 5. Calcular montos (TODO ES MULTIPLICACIÓN DIRECTA)
            const regularAmount = data.regularHours * hourlyRate;
            const overtimeAmount = data.overtimeHours * overtimeRate;
            const holidayAmount = data.holidayHours * holidayRate;
            const subtotal = regularAmount + overtimeAmount + holidayAmount;

            // 6. Calcular sueldo mensual equivalente (para mostrar)
            const monthlyEquivalent = hourlyRate * this.state.settings.regularHoursPerDay * 30;

            breakdown.push({
                positionId: posId,
                positionName: pos.name,
                positionColor: pos.color,
                hourlyRate: hourlyRate,
                monthlyEquivalent: monthlyEquivalent,  // Para display
                days: data.days,
                regularHours: data.regularHours,
                overtimeHours: data.overtimeHours,
                holidayHours: data.holidayHours,
                overtimeRate: overtimeRate,
                holidayRate: holidayRate,
                regularAmount: regularAmount,
                overtimeAmount: overtimeAmount,
                holidayAmount: holidayAmount,
                subtotal: subtotal
            });

            totalBruto += subtotal;
        });

        // ⚡ NUEVO: Calcular deducciones encadenadas
        // Si se pasaron deducciones explícitas (exportación global), usarlas.
        // Si no, usar las del perfil activo (comportamiento original).
        const deductionsList = deductions ?? this.state.employeeProfile?.deductions ?? [];
        const deductionBreakdown = [];
        let currentAmount = totalBruto;
        let totalDeductions = 0;

        deductionsList.forEach((ded, index) => {
            let deductionAmount = 0;

            if (ded.type === 'fixed') {
                deductionAmount = ded.value;
            } else {  // percentage
                deductionAmount = (currentAmount * ded.value) / 100;
            }

            deductionBreakdown.push({
                id: ded.id || `DED-${index + 1}`,
                type: ded.type,
                value: ded.value,
                amount: deductionAmount,
                appliedTo: currentAmount  // Monto sobre el que se aplicó
            });

            currentAmount -= deductionAmount;
            totalDeductions += deductionAmount;
        });

        const neto = totalBruto - totalDeductions;

        return {
            bruto: totalBruto,
            deductions: totalDeductions,
            deductionBreakdown: deductionBreakdown,  // ${icons.get('info')} NUEVO: Desglose detallado
            neto: neto,
            breakdown: breakdown
        };
    }
}

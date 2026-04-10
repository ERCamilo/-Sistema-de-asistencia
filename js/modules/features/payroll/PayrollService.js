import { getDateKey } from '../../utils/DateUtils.js';

const WEEKS_PER_MONTH = 52 / 12; // 4.333333333333333


export class PayrollService {
    constructor(state) {
        this.state = state;
    }

    getSalaryConfig(employee) {
        // ⚡ NUEVO: Priorizar sueldos por posición (Nuevo Sistema)
        const hasPositionSalaries = employee.positionSalaries && Object.keys(employee.positionSalaries).length > 0;

        if (hasPositionSalaries) {
            const firstPosId = employee.positions?.[0];
            const hourlyRate = employee.positionSalaries[firstPosId];

            if (hourlyRate) {
                const workDays = employee.positions?.[0] ?
                    (this.state.positions.find(p => p.id === employee.positions?.[0])?.workingDays || [1, 2, 3, 4, 5, 6]) :
                    [1, 2, 3, 4, 5, 6];

                const regularHours = this.state.settings?.regularHoursPerDay || 8;
                const monthlyAmount = hourlyRate * regularHours * (workDays.length * WEEKS_PER_MONTH);

                return {
                    type: 'custom',
                    amount: monthlyAmount, // Alta resolución
                    period: 'month',
                    workDays: workDays
                };
            }
        }

        if (!employee.salaryConfig) {
            // Migrar datos antiguos (Sistema Legacy)
            if (employee.customSalary) {
                return {
                    type: 'custom',
                    amount: employee.customSalary,
                    period: 'month',
                    workDays: [1, 2, 3, 4, 5, 6]
                };
            } else {
                const pos = this.state.positions.find(p => p.id === employee.positions?.[0]);
                if (pos?.salaryConfig) {
                    return pos.salaryConfig;
                }
                // Fallback a hourlyRate de la posición si existe
                if (pos?.hourlyRate) {
                    const regularHours = this.state.settings?.regularHoursPerDay || 8;
                    const workDays = pos.workingDays || [1, 2, 3, 4, 5, 6];
                    return {
                        type: 'standard',
                        amount: pos.hourlyRate * regularHours * (workDays.length * WEEKS_PER_MONTH), // Alta resolución
                        period: 'month',
                        workDays: workDays
                    };
                }
                return { amount: 0, period: 'month', workDays: [] };
            }
        }

        if (employee.salaryConfig.type === 'standard') {
            const posId = employee.salaryConfig.positionId || employee.positions?.[0];
            const pos = this.state.positions.find(p => p.id === posId);
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
                return amount / (daysPerWeek * (WEEKS_PER_MONTH / 2));
            case '3weeks':
                return amount / (daysPerWeek * (WEEKS_PER_MONTH / 1.333)); // Aproximado para 3 semanas
            case 'month':
                return amount / (daysPerWeek * WEEKS_PER_MONTH);
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
    calculateEmployeePayroll(empId, startDateKey, endDateKey, deductions = null, bonuses = null, advances = null) {
        const emp = this.state.employees.find(e => e.id === empId);
        if (!emp) return { bruto: 0, neto: 0, deductions: 0, advances: 0, breakdown: [] };

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
                    positionId: ph.positionId || att.selectedPosition || emp.positions?.[0],
                    hours: ph.hours || 0,
                    overtimeHours: ph.overtimeHours || 0
                }));
            } else {
                // Posición simple
                const posId = att.selectedPosition || emp.positions?.[0];
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

                const isHoliday = att.isHoliday || (this.state.settings.holidays || []).includes(dateKey);

                if (isHoliday) {
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
                // USAR PRECISIÓN TOTAL: No redondear la tasa por hora.
                // 30 días es el estándar de nómina mensual para este sistema.
                hourlyRate = pos.salaryConfig.amount / 30 / this.state.settings.regularHoursPerDay;
            }

            // 4. Calcular tarifas con factores globales
            const overtimeFactor = this.state.settings.overtimeFactor || 1;
            const holidayFactor = this.state.settings.holidayFactor || 2;

            const overtimeRate = hourlyRate * overtimeFactor;
            const holidayRate = hourlyRate * holidayFactor;

            // 5. Calcular montos (TODO ES MULTIPLICACIÓN DIRECTA)
            const regularAmount = data.regularHours * hourlyRate;
            const overtimeAmount = data.overtimeHours * overtimeRate;
            const holidayAmount = data.holidayHours * holidayRate;
            const subtotal = regularAmount + overtimeAmount + holidayAmount;

            // 6. Calcular sueldo mensual equivalente (para mostrar)
            const workDaysCount = (pos.workingDays && pos.workingDays.length > 0) ? pos.workingDays.length : 6;
            const monthlyEquivalent = hourlyRate * this.state.settings.regularHoursPerDay * (workDaysCount * WEEKS_PER_MONTH);

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

        // 🎁 NUEVO: Calcular bonificaciones / pagos extra
        const bonusesList = bonuses ?? this.state.employeeProfile?.bonuses ?? [];
        const bonusBreakdown = [];
        let totalBonuses = 0;

        bonusesList.forEach((bon, index) => {
            const val = parseFloat(bon.value) || 0;
            // El bono porcentual se calcula sobre el Bruto base original (antes de sumarle este u otros bonos)
            let bonusAmount = (bon.type === 'fixed') ? val : (totalBruto * val) / 100;

            bonusBreakdown.push({
                id: bon.id || `BON-${index + 1}`,
                name: bon.name || `Bono ${index + 1}`,
                type: bon.type,
                value: val,
                amount: bonusAmount,
                appliedTo: totalBruto
            });

            totalBonuses += bonusAmount;
        });

        // ⚡ NUEVO: Calcular deducciones encadenadas
        // Si se pasaron deducciones explícitas (exportación global), usarlas.
        // Si no, usar las del perfil activo (comportamiento original).
        const deductionsList = deductions ?? this.state.employeeProfile?.deductions ?? [];
        const deductionBreakdown = [];
        let totalDeductions = 0;

        deductionsList.forEach((ded, index) => {
            const val = parseFloat(ded.value) || 0;
            let deductionAmount = (ded.type === 'fixed') ? val : (totalBruto * val) / 100;

            deductionBreakdown.push({
                id: ded.id || `DED-${index + 1}`,
                name: ded.name || `Deducción ${index + 1}`,
                type: ded.type,
                value: val,
                amount: deductionAmount,
                appliedTo: totalBruto
            });

            totalDeductions += deductionAmount;
        });

        // 🏦 NUEVO: Calcular adelantos y préstamos
        const advancesList = advances ?? this.state.employeeProfile?.advances ?? [];
        const advanceBreakdown = [];
        let totalAdvances = 0;

        advancesList.forEach((adv, index) => {
            const amount = parseFloat(adv.amount) || 0;
            const interest = parseFloat(adv.interest) || 0;
            const included = adv.interestIncluded || false;

            // Total = Monto + (Si no está incluido, sumar interés del monto)
            const totalToCollect = amount + (included ? 0 : (amount * interest / 100));

            advanceBreakdown.push({
                id: adv.id || `ADV-${index + 1}`,
                name: adv.name || `Adelanto ${index + 1}`,
                amount: amount,
                interest: interest,
                interestIncluded: included,
                total: totalToCollect,
                date: adv.date || startDateKey
            });

            totalAdvances += totalToCollect;
        });

        const totalBrutoConBonos = totalBruto + totalBonuses;
        const neto = totalBrutoConBonos - totalDeductions - totalAdvances;

        return {
            brutoOriginal: totalBruto, // Salario base por posiciones
            bruto: totalBrutoConBonos, // Salario base + bonificaciones
            deductions: totalDeductions,
            deductionBreakdown: deductionBreakdown,
            bonuses: totalBonuses,
            bonusBreakdown: bonusBreakdown,
            advances: totalAdvances,
            advanceBreakdown: advanceBreakdown,
            neto: neto,
            breakdown: breakdown
        };
    }

    /**
     * Calcula una estimación del sueldo mensual basado en las posiciones actuales
     */
    calculateMonthlyEstimate(employee) {
        let totalMonthly = 0;
        const breakdown = [];
        const regularHoursPerDay = this.state.settings?.regularHoursPerDay || 8;

        (employee.positions || []).forEach(posId => {
            const pos = this.state.positions.find(p => p.id === posId);
            if (!pos) return;

            // Obtener sueldo (personalizado o estándar)
            const hourlySalary = (employee.positionSalaries && employee.positionSalaries[posId]) || pos.hourlyRate || 0;

            // Obtener días laborales
            const workingDays = pos.workingDays || [1, 2, 3, 4, 5, 6];

            const daysPerWeek = workingDays.length;
            const monthlyForPosition = daysPerWeek * WEEKS_PER_MONTH * regularHoursPerDay * hourlySalary;

            totalMonthly += monthlyForPosition;
            breakdown.push({
                position: pos.name,
                daysPerWeek: daysPerWeek,
                monthly: monthlyForPosition
            });
        });

        return { total: totalMonthly, breakdown };
    }
}

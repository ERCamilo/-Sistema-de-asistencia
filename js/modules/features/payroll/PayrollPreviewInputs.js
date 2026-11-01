import { getDateKey, parseDate } from '../../utils/DateUtils.js';

/** Only calculation inputs: changing a view filter or a loan selection is not a salary edit. */
export function payrollPreviewInputKey(ctx, config, period, adjustmentSelections = []) {
    const attendance = [];
    if (period?.periodStart && period?.periodEnd) {
        for (let day = parseDate(period.periodStart); getDateKey(day) <= period.periodEnd; day.setDate(day.getDate() + 1)) {
            const date = getDateKey(day);
            for (const employee of ctx.employees || []) {
                const record = ctx.getAttendance(employee.id, date);
                if (record) attendance.push([employee.id, date, record]);
            }
        }
    }
    return JSON.stringify({
        projectId: ctx.projectId,
        periodStart: period?.periodStart,
        periodEnd: period?.periodEnd,
        employees: (ctx.employees || []).map(employee => ({
            id: employee.id, number: employee.number, name: employee.name, active: employee.active,
            positions: employee.positions, position: employee.position,
            positionSalaries: employee.positionSalaries, customWorkingDays: employee.customWorkingDays,
            bonuses: employee.bonuses, deductions: employee.deductions
        })),
        positions: ctx.positions,
        leaders: ctx.leaders,
        restDayFactor: ctx.settings?.restDayFactor,
        config,
        attendance,
        bonuses: ctx.exportConfig?.bonuses || [],
        deductions: ctx.exportConfig?.deductions || [],
        adjustmentSelections
    });
}

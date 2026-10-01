/**
 * 💵 AttendanceDetailEarnings — sueldo del período en el panel de detalle de
 * Asistencia (escritorio).
 *
 * Antes era "horas × tarifa de la primera posición", que ignoraba el sueldo
 * propio del empleado por posición (por hora o por día), las horas extra,
 * feriados y días libres, y los días en otras posiciones. Ahora usa el mismo
 * cálculo que Nómina (bruto, sin bonificaciones ni descuentos), con la
 * configuración de la obra activa.
 */

import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { getActivePayrollSettings } from '../payroll/ActivePayrollSettings.js';
import { capturePayrollProjectContext } from '../payroll/PayrollProjectContext.js';
import { PayrollService, calculateEmployeePayrollWithContext } from '../payroll/PayrollService.js';

const round2 = value => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;

/**
 * @returns {{gross: number, breakdown: Array, available: boolean}}
 */
export function computeAttendanceDetailEarnings(state, employeeId, startKey, endKey) {
    if (!employeeId || !startKey || !endKey || startKey > endKey) {
        return { gross: 0, breakdown: [], available: true };
    }
    try {
        let payroll;
        if (isProjectsEnabled()) {
            const ctx = capturePayrollProjectContext(state);
            if (!ctx?.isScoped) return { gross: 0, breakdown: [], available: false };
            payroll = calculateEmployeePayrollWithContext(
                ctx, getActivePayrollSettings(state), employeeId, startKey, endKey, [], [], [], []
            );
        } else {
            payroll = new PayrollService(state).calculateEmployeePayroll(employeeId, startKey, endKey, [], [], []);
        }
        return {
            gross: round2(payroll?.brutoOriginal ?? payroll?.bruto ?? 0),
            breakdown: Array.isArray(payroll?.breakdown) ? payroll.breakdown : [],
            available: true
        };
    } catch (_) {
        return { gross: 0, breakdown: [], available: false };
    }
}

export default computeAttendanceDetailEarnings;

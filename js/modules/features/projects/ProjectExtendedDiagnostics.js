/** Read-only diagnostics. Financial snapshots and embedded plans are never rewritten. */
import { isPayrollAdjustmentInstallmentPlan } from '../payroll/PayrollAdjustmentInstallmentPlan.js';

const id = value => String(value ?? '').trim();
const list = value => Array.isArray(value) ? value.filter(record => record && typeof record === 'object') : [];
export function diagnoseExtendedProjectData(data = {}, projects = []) {
    const known = new Set(list(projects).map(project => id(project.id)).filter(Boolean));
    const employees = list(data.employees);
    const employeeIds = new Set(employees.map(employee => id(employee.id)).filter(Boolean));
    const issues = [];
    const ownershipReason = record => !id(record.projectId) ? 'Sin obra asignada'
        : !known.has(id(record.projectId)) ? 'La obra de origen no está disponible' : '';
    const add = (kind, key, label, reason, projectId) =>
        issues.push({ kind, key: String(key), label, reason, projectId: id(projectId) });
    for (const [index, closure] of list(data.payrollClosures).entries()) {
        const reason = ownershipReason(closure);
        if (reason) add('closures', closure.id || index,
            [closure.periodStart, closure.periodEnd].filter(Boolean).join(' — ') || 'Cierre de nómina',
            reason, closure.projectId);
    }
    for (const [index, config] of list(data.projectPayrollConfigs).entries()) {
        const reason = ownershipReason(config);
        if (reason) add('configs', config.projectId || index, 'Configuración de nómina', reason, config.projectId);
    }
    for (const employee of employees) {
        for (const kind of ['bonuses', 'deductions']) {
            for (const [index, plan] of list(employee[kind]).entries()) {
                if (!isPayrollAdjustmentInstallmentPlan(plan)) continue;
                let reason = ownershipReason(plan);
                if (!reason && id(plan.projectId) !== id(employee.projectId)) reason = 'La obra del plan no coincide con la del empleado';
                if (id(plan.employeeId) && id(plan.employeeId) !== id(employee.id)) reason = 'El empleado del plan no coincide con su registro';
                if (reason) add('plans', id(employee.id) + ':' + kind + ':' + (plan.id || index),
                    [employee.number, employee.name, plan.name || (kind === 'bonuses' ? 'Bonificación' : 'Deducción')].filter(Boolean).join(' · '),
                    reason, plan.projectId);
            }
        }
    }
    const attendance = Array.isArray(data.attendance)
        ? data.attendance.map((record, index) => [String(record?.key || index), record])
        : Object.entries(data.attendance || {});
    for (const [key, record] of attendance) {
        if (!record || typeof record !== 'object') continue;
        if (!employeeIds.has(id(record.employeeId))) add('attendance', key,
            record.date || 'Asistencia sin fecha',
            id(record.employeeId) ? 'El empleado no está disponible' : 'El registro no identifica al empleado',
            record.projectId);
    }
    return issues;
}

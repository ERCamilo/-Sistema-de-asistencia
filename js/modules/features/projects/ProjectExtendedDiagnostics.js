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
                if (reason) {
                    add('plans', id(employee.id) + ':' + kind + ':' + (plan.id || index),
                        [employee.number, employee.name, plan.name || (kind === 'bonuses' ? 'Bonificación' : 'Deducción')].filter(Boolean).join(' · '),
                        reason, plan.projectId);
                    issues[issues.length - 1].planSelection = { employeeId: id(employee.id), kind, planId: id(plan.id) };
                }
            }
        }
    }
    // Payroll payments retain their historical work; never infer it from the employee's current work.
    for (const employee of employees) {
        for (const loan of list(employee.loans)) {
            for (const [index, payment] of list(loan.payments).entries()) {
                if (payment.source !== 'payroll' && !payment.payrollProjectId && !payment.payrollBatchId) continue;
                const projectId = id(payment.payrollProjectId || payment.payrollBatchSnapshot?.projectId);
                if (!known.has(projectId)) add('payments', id(employee.id) + ':' + id(loan.id) + ':' + (payment.id || index),
                    [employee.number, employee.name, payment.date || 'Pago de préstamo'].filter(Boolean).join(' · '),
                    projectId ? 'La obra original del pago no está disponible' : 'El pago de nómina no identifica su obra',
                    projectId);
            }
        }
    }
    const cashProjects = new Set(list(data.pettyCash?.projects).map(record => id(record.id)));
    const periods = new Map(list(data.pettyCash?.periods).map(record => [id(record.id), record]));
    for (const [key, period] of periods) {
        if (!cashProjects.has(id(period.projectId))) add('cashLinks', 'period:' + key,
            period.name || 'Período de caja chica', 'La caja del período no está disponible localmente', '');
    }
    for (const [index, movement] of list(data.pettyCash?.movements).entries()) {
        const period = periods.get(id(movement.periodId));
        const reason = !period ? 'El período del movimiento no está disponible localmente'
            : id(movement.projectId) !== id(period.projectId) ? 'La caja del movimiento no coincide con la de su período' : '';
        if (reason) add('cashLinks', 'movement:' + (movement.id || index), movement.description || movement.date || 'Movimiento de caja chica', reason, '');
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

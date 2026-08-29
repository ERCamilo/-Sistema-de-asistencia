import {
    ADJUSTMENT_PLAN_KIND,
    isPayrollAdjustmentInstallmentPlan,
    normalizeEmployeeAdjustmentEntries
} from './PayrollAdjustmentInstallmentPlan.js';
import { assertTandaBBlockedWhenScoped } from '../../config/TandaBGate.js';

const VALID_KINDS = new Set(Object.values(ADJUSTMENT_PLAN_KIND));

function employeeId(value) {
    return value == null ? '' : String(value).trim();
}

function adjustmentIds(employee) {
    return new Set([
        ...(Array.isArray(employee?.bonuses) ? employee.bonuses : []),
        ...(Array.isArray(employee?.deductions) ? employee.deductions : [])
    ].map(adjustment => employeeId(adjustment?.id)).filter(Boolean));
}

function validateEmployees(employees) {
    if (!Array.isArray(employees)) throw new Error('La lista de empleados es obligatoria');
    const byId = new Map();
    for (const employee of employees) {
        const id = employeeId(employee?.id);
        if (!id) throw new Error('Todos los empleados deben tener identificador');
        if (byId.has(id)) throw new Error(`El empleado ${id} está duplicado`);
        byId.set(id, employee);
    }
    return byId;
}

function validatePlan(plan, employeeById, incomingIds) {
    if (!isPayrollAdjustmentInstallmentPlan(plan)) {
        throw new Error('Solo se pueden adjuntar planes de ajustes modernos');
    }
    if (!VALID_KINDS.has(plan.kind)) {
        throw new Error('El tipo de plan debe ser una bonificación o una deducción');
    }
    if (plan.type !== 'fixed') {
        throw new Error('El plan debe ser de monto fijo');
    }

    const ownerId = employeeId(plan.employeeId);
    if (!ownerId) throw new Error('El plan debe indicar su empleado');
    const employee = employeeById.get(ownerId);
    if (!employee) throw new Error(`No se encontró el empleado ${ownerId}`);

    const planId = employeeId(plan.id);
    if (!planId) throw new Error(`El plan del empleado ${ownerId} no tiene identificador`);
    if (incomingIds.has(planId)) throw new Error(`El identificador ${planId} está duplicado`);
    if (adjustmentIds(employee).has(planId)) {
        throw new Error(`El identificador ${planId} ya existe dentro del empleado ${ownerId}`);
    }
    incomingIds.add(planId);

    return { employee, ownerId, planId, kind: plan.kind };
}

/**
 * Pure all-or-nothing attachment. Validation of the complete batch happens
 * before any replacement employee is created, so callers never receive a
 * partially applied result.
 */
export function attachPayrollAdjustmentPlans(employees, plans) {
    assertTandaBBlockedWhenScoped('PayrollAdjustmentPlanRepository.attachPayrollAdjustmentPlans');
    const employeeById = validateEmployees(employees);
    if (!Array.isArray(plans) || plans.length === 0) {
        throw new Error('Debes proporcionar al menos un plan');
    }

    const incomingIds = new Set();
    const validated = plans.map(plan => ({
        plan,
        ...validatePlan(plan, employeeById, incomingIds)
    }));
    const additionsByEmployee = new Map();

    for (const item of validated) {
        const additions = additionsByEmployee.get(item.ownerId) || {
            bonuses: [],
            deductions: []
        };
        additions[item.kind].push(normalizeEmployeeAdjustmentEntries([item.plan])[0]);
        additionsByEmployee.set(item.ownerId, additions);
    }

    return employees.map(employee => {
        const id = employeeId(employee.id);
        const additions = additionsByEmployee.get(id);
        if (!additions) return employee;

        const next = { ...employee };
        for (const kind of VALID_KINDS) {
            if (additions[kind].length === 0) continue;
            next[kind] = [
                ...(Array.isArray(employee[kind]) ? employee[kind] : []),
                ...additions[kind]
            ];
        }
        return next;
    });
}
